/**
 * capture.mjs — 用 Edge 的 DevTools 协议做确定性截图
 *
 * 用法: node tools/capture.mjs [目标...]
 *   target = <名称>:<页面>:<锚点或滚动元素选择器>
 *   例:     node tools/capture.mjs hero:index.html arch:index.html#four
 *           node tools/capture.mjs person:person.html?id=p3
 *
 * 与 --screenshot 的区别：先导航、等 load、滚动、等揭示动画与字体就绪，
 * 再截图，因此每次结果一致。
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'preview')
const PORT = 9333
const WIDTH = 1440
const HEIGHT = 950

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]
const BROWSER = CANDIDATES.find((p) => existsSync(p))
if (!BROWSER) {
  console.error('未找到 Chromium 内核浏览器')
  process.exit(2)
}

const DEFAULT_TARGETS = [
  '01-hero:index.html',
  '02-arch:index.html#four',
  '03-time:index.html#timeline',
  '04-wall:index.html#gallery',
  '05-letter:index.html#letters',
  '06-person:person.html?id=p3',
  '07-records:person.html?id=p3#records',
]

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForDevtools(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch (err) {
      /* 端口还没起来，稍后重试 */
    }
    await sleep(200)
  }
  throw new Error('DevTools 端口未就绪')
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), 'memorial-cdp-'))

  const child = spawn(
    BROWSER,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--mute-audio',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  )

  try {
    const version = await waitForDevtools(20000)
    console.log('浏览器：' + version['Browser'])
    const listRes = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    const pages = await listRes.json()
    const page = pages.find((p) => p.type === 'page') || pages[0]
    if (!page) throw new Error('没有可用的页面目标')

    const ws = new WebSocket(page.webSocketDebuggerUrl)
    const pending = new Map()
    const waiters = []
    let nextId = 1

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else res(msg.result)
      } else if (msg.method) {
        for (let i = waiters.length - 1; i >= 0; i -= 1) {
          if (waiters[i].method === msg.method) {
            const w = waiters.splice(i, 1)[0]
            w.resolve(msg.params)
          }
        }
      }
    })

    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', rej, { once: true })
    })

    const send = (method, params) =>
      new Promise((res, rej) => {
        const id = nextId++
        pending.set(id, { resolve: res, reject: rej })
        ws.send(JSON.stringify({ id, method, params: params || {} }))
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id)
            rej(new Error(method + ' 超时'))
          }
        }, 30000)
      })

    const waitEvent = (method, timeoutMs) =>
      new Promise((res, rej) => {
        const w = { method, resolve: res }
        waiters.push(w)
        setTimeout(() => {
          const i = waiters.indexOf(w)
          if (i !== -1) {
            waiters.splice(i, 1)
            rej(new Error('等待 ' + method + ' 超时'))
          }
        }, timeoutMs)
      })

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || '求值异常')
      return r.result.value
    }

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    })

    for (const target of targets) {
      const [name, ...rest] = target.split(':')
      const spec = rest.join(':')
      const hashAt = spec.indexOf('#')
      const pagePart = hashAt === -1 ? spec : spec.slice(0, hashAt)
      const frag = hashAt === -1 ? '' : spec.slice(hashAt)
      const qAt = pagePart.indexOf('?')
      const pathPart = qAt === -1 ? pagePart : pagePart.slice(0, qAt)
      const query = qAt === -1 ? '' : pagePart.slice(qAt + 1)
      // __URL__ 表示直接截线上地址，而非本地文件
      const base = pathPart === '__URL__'
        ? 'https://fliceyuu.github.io/memorial-site/'
        : 'file:///' + resolve(ROOT, pathPart).replace(/\\/g, '/')
      const url = base + '?' + (query ? query + '&' : '') + 'preview=1' + frag
      const label = name.padEnd(12)

      try {
        const loaded = waitEvent('Page.loadEventFired', 15000)
        await send('Page.navigate', { url })
        await loaded
      } catch (err) {
        console.log(label + '导航警告：' + err.message)
      }

      await sleep(700)

      // 精确滚动：优先锚点 id，其次 CSS 选择器
      if (frag) {
        const sel = frag.slice(1)
        await evaluate(`(() => {
          const el = document.getElementById(${JSON.stringify(sel)}) || document.querySelector(${JSON.stringify(sel)});
          if (el) { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -74); }
          return window.scrollY;
        })()`)
        await sleep(400)
      }

      // 保证所有揭示动画已收尾，截图才稳定
      await evaluate(`(() => {
        document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
        return true;
      })()`)
      await sleep(1100)
      await evaluate(
        'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true'
      )
      await sleep(300)

      if (process.env.PROBE) {
        const probe = await evaluate(`(() => {
          const rows = [];
          document.querySelectorAll('[data-edit],[data-text],[data-portrait],[data-portrait-edit]').forEach((el) => {
            const keys = ['edit', 'text', 'portrait', 'portraitEdit'].filter((k) => el.dataset[k]);
            rows.push(keys.map((k) => k + '=' + el.dataset[k]).join(',') + ' | <' + el.tagName.toLowerCase() + '> "' + (el.textContent || '').trim().slice(0, 22) + '"');
          });
          const h1 = document.querySelector('h1');
          return { rows, h1edit: h1 && h1.dataset.edit, h1text: h1 && h1.textContent.trim(), personId: document.body.dataset.person };
        })()`)
        console.log(probe.rows.join('\n'))
        console.log('h1 data-edit=' + probe.h1edit + ' 文本=' + probe.h1text + ' personId=' + probe.personId)
      }

      const info = await evaluate(`(() => {
        const y = window.scrollY
        const h = document.documentElement.scrollHeight
        const vis = Array.from(document.querySelectorAll('.reveal')).filter(e => e.classList.contains('is-in')).length
        const total = document.querySelectorAll('.reveal').length
        return {
          y, h, vis, total, title: document.title,
          pid: document.body.dataset.person || '(none)',
          page: document.body.dataset.page || '(none)',
          href: location.href,
          storeKeys: Object.keys((window.Store && window.Store.all.people) || {}).join(','),
          p3name: ((window.Store && window.Store.person('p3')) || {}).name || '(null)',
        }
      })()`)

      const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const file = join(OUT, name + '.png')
      await writeFile(file, Buffer.from(png.data, 'base64'))
      const size = (await readFile(file)).length
      console.log(
        label + String(size).padStart(9) + ' B  y=' + info.y + ' h=' + info.h +
        ' 揭示 ' + info.vis + '/' + info.total +
        ' page=' + info.page + ' pid=' + info.pid + ' p3=' + info.p3name + ' people=' + info.storeKeys +
        ' | ' + info.title
      )
      console.log(label + 'href: ' + info.href)
    }

    ws.close()
  } finally {
    child.kill()
  }
}

try {
  await main()
} catch (err) {
  console.error('截图失败：' + err.message)
  process.exit(1)
}
// 浏览器子进程的网络句柄仍活着，这里显式结束，避免脚本挂住
process.exit(0)
