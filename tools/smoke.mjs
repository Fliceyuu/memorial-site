/**
 * smoke.mjs — 无浏览器的冒烟测试
 * 用极简 DOM 桩在 Node 中真实执行 store.js / media.js / app.js，逐个核对：
 *   · 脚本无异常
 *   · data-text / data-edit 绑定路径均能取到内容
 *   · 没有"带 data-text 的容器吃掉子元素"的隐患
 *   · 时间轴 / 留言 / 相册墙 / 唱片机 / 编辑模式 / 献花 均可用
 *
 * 用法: node tools/smoke.mjs [--page=home|person] [--id=p2]
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFile(resolve(ROOT, p), 'utf8')

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v === undefined ? true : v]
  })
)
const WHICH = argv.page === 'person' ? 'person' : 'home'
const PID = argv.id || 'p1'

const problems = []
const notes = []
const note = (s) => notes.push('  · ' + s)
const fail = (s) => problems.push('  ✗ ' + s)

/* ------------------------------------------------------------ DOM 桩 */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'path', 'circle', 'rect', 'use', 'stop', 'ellipse', 'line', 'polygon'])

function parseAttrs(str) {
  const attrs = {}
  const re = /([:@a-zA-Z_][-.:\w]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m
  while ((m = re.exec(str))) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : ''
  }
  return attrs
}

class ClassList {
  constructor(el) { this.el = el }
  get set() { return new Set((this.el.attributes.class || '').split(/\s+/).filter(Boolean)) }
  write(s) { this.el.attributes.class = Array.from(s).join(' ') }
  add(...c) { const s = this.set; c.forEach((x) => x && s.add(x)); this.write(s) }
  remove(...c) { const s = this.set; c.forEach((x) => s.delete(x)); this.write(s) }
  toggle(c, force) {
    const has = this.set.has(c)
    const on = force === undefined ? !has : !!force
    if (on) this.add(c); else this.remove(c)
    return on
  }
  contains(c) { return this.set.has(c) }
}

class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase()
    this.attributes = {}
    this.children = []
    this.parentElement = null
    this.listeners = {}
    this._text = ''
    this._style = {}
    this.style = new Proxy(this._style, {
      set: (t, k, v) => { t[k] = String(v); return true },
      get: (t, k) => (k === 'setProperty'
        ? (name, value) => { t[name] = String(value) }
        : k === 'getPropertyValue'
          ? (name) => t[name] || ''
          : k === 'removeProperty'
            ? (name) => { delete t[name] }
            : t[k]),
    })
    this.dataset = new Proxy({}, {
      get: (t, k) => (k in t ? t[k] : this.attributes['data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())]),
      set: (t, k, v) => {
        t[k] = v
        this.attributes['data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())] = v
        return true
      },
      has: (t, k) => k in t || ('data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) in this.attributes,
    })
    this.classList = new ClassList(this)
  }

  get className() { return this.attributes.class || '' }
  set className(v) { this.attributes.class = String(v) }
  get id() { return this.attributes.id || '' }
  set id(v) { this.attributes.id = String(v) }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('')
    return this._text
  }
  set textContent(v) { this.children = []; this._text = String(v) }
  set innerHTML(html) { this.children = parseHTML(String(html), this); this._text = '' }
  get innerHTML() { return this.children.map((c) => c.outerHTML).join('') }
  get outerHTML() { return '<' + this.tagName.toLowerCase() + '>' + this.innerHTML + '</' + this.tagName.toLowerCase() + '>' }
  get firstElementChild() { return this.children[0] || null }
  get contentEditable() { return this.attributes.contenteditable || 'inherit' }

  appendChild(c) { c.parentElement = this; this.children.push(c); return c }
  append(...cs) { cs.forEach((c) => (typeof c === 'string' ? this.appendChild(new TextNode(c)) : this.appendChild(c))) }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentElement = null; return c }
  remove() { if (this.parentElement) this.parentElement.removeChild(this) }
  setAttribute(k, v) {
    this.attributes[k] = String(v)
    if (k === 'src' && this.tagName === 'IMG') this.src = String(v)
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null }
  hasAttribute(k) { return k in this.attributes }
  removeAttribute(k) { delete this.attributes[k] }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  removeEventListener(type, fn) {
    if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter((f) => f !== fn)
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this
    ev.preventDefault = ev.preventDefault || (() => {})
    ev.stopPropagation = ev.stopPropagation || (() => {})
    const run = (el) => {
      (el.listeners[ev.type] || []).slice().forEach((fn) => fn.call(el, ev))
      if (el.parentElement) run(el.parentElement)
    }
    run(this)
    return true
  }
  click() { this.dispatchEvent({ type: 'click' }) }
  focus() { this.dispatchEvent({ type: 'focus' }) }
  blur() { this.dispatchEvent({ type: 'blur' }) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  querySelectorAll(sel) { return descendants(this).filter((el) => matches(el, sel)) }
  matches(sel) { return matches(this, sel) }
  closest(sel) { let cur = this; while (cur) { if (matches(cur, sel)) return cur; cur = cur.parentElement } return null }
  getBoundingClientRect() { return { top: 10, left: 10, width: 800, height: 600, bottom: 610, right: 810 } }
  getContext() {
    return {
      canvas: this,
      clearRect: () => {}, beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
      moveTo: () => {}, lineTo: () => {}, save: () => {}, restore: () => {}, fillRect: () => {},
      set fillStyle(v) { void v },
      get fillStyle() { return '#000' },
    }
  }
}

class TextNode extends El {
  constructor(t) { super('#text'); this._text = String(t) }
  get outerHTML() { return this._text }
}

function parseHTML(html, parent) {
  const out = []
  const stack = [{ el: parent, children: out }]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/gi
  let last = 0
  let m
  const pushText = (txt) => {
    if (!txt) return
    const top = stack[stack.length - 1]
    const node = new TextNode(txt)
    node.parentElement = top.el
    top.children.push(node)
  }
  while ((m = re.exec(html))) {
    pushText(html.slice(last, m.index))
    last = re.lastIndex
    if (m[0].startsWith('<!')) continue
    if (m[1]) { if (stack.length > 1) stack.pop(); continue }
    const tag = m[2]
    const el = new El(tag)
    el.attributes = parseAttrs(m[3] || '')
    const top = stack[stack.length - 1]
    el.parentElement = top.el
    top.children.push(el)
    if (!m[4] && !VOID_TAGS.has(tag.toLowerCase())) stack.push({ el, children: el.children })
  }
  pushText(html.slice(last))
  return out
}

function descendants(root) {
  const out = []
  const walk = (el) => el.children.forEach((c) => { if (c.tagName !== '#TEXT') { out.push(c); walk(c) } })
  walk(root)
  return out
}

function matchSimple(el, sel) {
  sel = String(sel).trim()
  if (!sel) return true
  const parts = sel.match(/^(?:([a-zA-Z][\w-]*))?((?:[.#][\w-]+)*)((?:\[[^\]]*\])*)$/)
  if (!parts) return false
  if (parts[1] && el.tagName !== parts[1].toUpperCase()) return false
  const classes = (parts[2].match(/\.[\w-]+/g) || []).map((s) => s.slice(1))
  if (classes.some((c) => !el.classList.contains(c))) return false
  const ids = (parts[2].match(/#[\w-]+/g) || []).map((s) => s.slice(1))
  if (ids.some((i) => el.id !== i)) return false
  const attrs = parts[3].match(/\[[^\]]*\]/g) || []
  return attrs.every((a) => {
    const body = a.slice(1, -1)
    const [k, v] = body.split('=')
    if (v === undefined) return el.hasAttribute(k.trim())
    return el.getAttribute(k.trim()) === v.replace(/^["']|["']$/g, '')
  })
}

function matches(el, sel) {
  return String(sel).split(',').some((one) => matchSimple(el, one))
}

/* ------------------------------------------------------------ 载入页面 */
const file = WHICH === 'person' ? 'person.html' : 'index.html'
const html = await read(file)

const bodyEl = new El('body')
bodyEl.attributes = parseAttrs((html.match(/<body([^>]*)>/) || [, ''])[1])
// 刻意保留模板里的 data-person 默认值，让 URL 参数成为唯一身份来源（与浏览器行为一致）
bodyEl.children = parseHTML(
  html.replace(/^[\s\S]*?<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, ''),
  bodyEl
)

const byId = (id) => descendants(bodyEl).find((el) => el.id === id)
const store = new Map()
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const document = {
  body: bodyEl,
  documentElement: new El('html'),
  readyState: 'complete',
  hidden: false,
  title: 't',
  createElement: (t) => new El(t),
  querySelector: (s) => descendants(bodyEl).find((el) => matchSimple(el, s)) || (matchSimple(bodyEl, s) ? bodyEl : null),
  querySelectorAll: (s) => descendants(bodyEl).filter((el) => matches(el, s)),
  getElementById: byId,
  addEventListener: () => {},
  removeEventListener: () => {},
}

const sandbox = {
  console,
  localStorage,
  document,
  location: {
    href: 'file:///C:/site/' + file + (WHICH === 'person' ? '?id=' + PID : ''),
    pathname: '/' + file,
    search: WHICH === 'person' ? '?id=' + PID : '',
    replace: () => {},
    reload: () => {},
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
  navigator: { userAgent: 'node' },
  performance: { now: () => Date.now() },
  devicePixelRatio: 1,
  innerWidth: 1440,
  innerHeight: 900,
  scrollY: 0,
  scrollTo: () => {},
  AudioContext: undefined,
  webkitAudioContext: undefined,
  indexedDB: undefined,
  FileReader: class { readAsDataURL() { throw new Error('noop') } },
  Blob: class {},
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
  URLSearchParams,
  URL: URL,
  prompt: () => null,
  confirm: () => false,
  alert: () => {},
  fetch: () => Promise.reject(new Error('no network')),
  Audio: class {
    constructor() {
      this.src = ''
      this.paused = true
      this.volume = 1
      this.currentTime = 0
      this.duration = NaN
      this._listeners = {}
    }
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn) }
    removeEventListener(t, fn) { if (this._listeners[t]) this._listeners[t] = this._listeners[t].filter((f) => f !== fn) }
    async play() { this.paused = false; return undefined }
    pause() { this.paused = true }
  },
}

class IOP {
  constructor(cb) { this.cb = cb }
  observe(el) { this.cb([{ isIntersecting: true, target: el }], this) }
  unobserve() {}
  disconnect() {}
}
sandbox.IntersectionObserver = IOP

/* ------------------------------------------------------------ 执行脚本 */
const vm = await import('node:vm')
const context = Object.assign(Object.create(null), sandbox)
context.window = context
context.globalThis = context
context.self = context
vm.createContext(context)

const run = async (f) => {
  const code = await read(f)
  try {
    vm.runInContext(code, context, { filename: f })
    note('已执行 ' + f)
    return true
  } catch (err) {
    fail(f + ' 执行异常：' + err.message + '\n' + String(err.stack || '').split('\n').slice(1, 4).join('\n'))
    return false
  }
}

await run('assets/js/store.js')
await run('assets/js/media.js')
await run('assets/js/app.js')
await new Promise((r) => setTimeout(r, 60))

const Store = context.Store
const App = context.App
if (!Store) fail('window.Store 未挂载')
if (!App) fail('window.App 未挂载')

/* ------------------------------------------------------------ 断言 */
note('页面：' + file + (WHICH === 'person' ? '?id=' + PID : ''))

/* 1. 绑定路径有效性 */
const paths = new Set()
{
  const re = /data-(?:text|edit)="([^"]+)"/g
  let m
  while ((m = re.exec(html))) paths.add(m[1])
}
for (const p of paths) {
  const real = WHICH === 'person' ? p.split('p1').join(PID) : p
  const v = Store.getPath(real, undefined)
  if (v === undefined || v === '') fail(file + ' 绑定路径取不到内容：' + p + (real !== p ? ' → ' + real : ''))
}
note(paths.size + ' 个绑定路径全部有效')

/* 2. 容器不得吞掉子元素 */
let swallowed = 0
for (const el of bodyEl.querySelectorAll('[data-text]')) {
  const inner = descendants(el)
  if (!inner.length) continue
  const bound = inner.filter((c) => c.hasAttribute('data-text') || c.hasAttribute('data-edit'))
  if (bound.length) {
    swallowed += 1
    fail('容器 <' + el.tagName.toLowerCase() + ' class="' + el.className + '" data-text="' + el.getAttribute('data-text') + '"> 含 ' + bound.length + ' 个绑定子元素，渲染时会被清空')
  }
}
if (!swallowed) note('data-text 容器未吞掉子元素绑定')

/* 3. 渲染结果 */
const tl = bodyEl.querySelector('[data-timeline]')
if (!tl || tl.children.length < (WHICH === 'person' ? 2 : 5)) fail('时间轴渲染条目过少：' + (tl ? tl.children.length : 'null'))
else note('时间轴渲染 ' + tl.children.length + ' 条')

const notesBox = bodyEl.querySelector('[data-notes]')
if (!notesBox || notesBox.children.length < 1) fail('留言板渲染为空')
else note('留言板渲染 ' + notesBox.children.length + ' 条')

const wallEl = bodyEl.querySelector('[data-wall]')
if (!wallEl || wallEl.children.length < 2) fail('相册墙渲染条目过少：' + (wallEl ? wallEl.children.length : 'null'))
else note('相册墙渲染 ' + wallEl.children.length + ' 格（含上传格）')

if (WHICH === 'person') {
  const playlist = bodyEl.querySelector('[data-playlist]')
  if (!playlist || playlist.children.length < 2) fail('歌单为空')
  else note('歌单渲染 ' + playlist.children.length + ' 项')

  const strip = bodyEl.querySelector('[data-strip]')
  if (!strip || strip.children.length !== 3) fail('其余三人应为 3 位，实际 ' + (strip ? strip.children.length : 'null'))
  else note('其余三人条渲染 3 位')

  const pager = bodyEl.querySelector('[data-pager]')
  if (!pager || pager.children.length !== 2) fail('前后翻阅链接缺失')
  else note('前后翻阅 2 个链接')

  const me = Store.person(PID) || {}
  const expect = { name: me.name, nameEn: me.nameEn, sigil: me.sigil, dates: me.dates, verse: me.verse, epithet: me.epithet, quote: me.quote, words: me.words }
  const bound = bodyEl.querySelectorAll('[data-text]')
  let checked = 0
  for (const el of bound) {
    const key = el.getAttribute('data-text').split('.').pop()
    if (!(key in expect)) continue
    checked += 1
    if (el.textContent.trim() !== String(expect[key]).trim()) {
      fail('人物页「' + key + '」渲染为「' + el.textContent + '」，应为「' + expect[key] + '」')
    }
  }
  note('身份字段已按 id=' + PID + ' 替换（data-text 核对 ' + checked + ' 处：' + me.name + ' / ' + me.nameEn + ' / ' + me.dates + '）')

  // 可编辑元素同样必须先显示这个人的内容，而不是模板默认值
  let editChecked = 0
  for (const el of bodyEl.querySelectorAll('[data-edit]')) {
    const key = el.getAttribute('data-edit').split('.').pop()
    if (!(key in expect)) continue
    editChecked += 1
    if (el.textContent.trim() !== String(expect[key]).trim()) {
      fail('可编辑元素「' + el.getAttribute('data-edit') + '」显示为「' + el.textContent.trim() + '」，应为「' + expect[key] + '」')
    }
  }
  note('可编辑元素已回填本人的内容（核对 ' + editChecked + ' 处）')
}

/* 4. 编辑模式 */
const toggles = bodyEl.querySelectorAll('[data-edit-toggle]')
if (!toggles.length) fail('页面上没有编辑模式入口')
else {
  toggles[0].click()
  await new Promise((r) => setTimeout(r, 20))
  if (!bodyEl.classList.contains('is-editing')) fail('点击编辑入口后未进入编辑模式')
  else note('编辑模式可进入（data-edit ' + bodyEl.querySelectorAll('[data-edit]').length + ' 个）')
  toggles[0].click()
  if (bodyEl.classList.contains('is-editing')) fail('编辑模式无法退出')
}

/* 5. 数据层 */
const firstNote = Store.all.notes[0]
const before = firstNote.flowers
Store.flowerNote(firstNote.id, 1)
if (Store.all.notes[0].flowers !== before + 1) fail('献花计数未生效')
else note('献花计数 ' + before + ' → ' + Store.all.notes[0].flowers)

Store.addNote({ name: '测试', text: '一条测试留言', personId: WHICH === 'person' ? PID : '' })
const found = Store.notesOf(WHICH === 'person' ? PID : '').filter((n) => n.name === '测试')
if (!found.length) fail('留言未能写入并回读')
else note('留言可写入并回读')

/* 6. 静态资源 */
const files = ['assets/css/fonts.css', 'assets/css/theme.css', 'assets/css/pages.css', 'assets/js/store.js', 'assets/js/media.js', 'assets/js/app.js']
for (const f of files) {
  try {
    const c = await read(f)
    if (!c.length) fail('文件为空：' + f)
  } catch (err) {
    fail('引用但缺失：' + f)
  }
}
note('引用的 ' + files.length + ' 个静态资源均存在')

/* ------------------------------------------------------------ 报告 */
console.log('\n=== 冒烟测试：' + file + (WHICH === 'person' ? '?id=' + PID : '') + ' ===')
notes.forEach((n) => console.log(n))
if (problems.length) {
  console.log('\n=== 问题 ===')
  problems.forEach((p) => console.log(p))
  process.exit(1)
}
console.log('\n全部通过 ✓')
