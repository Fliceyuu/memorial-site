/**
 * publish.mjs — 发布到 GitHub Pages（干净树 + 冒烟测试 + API 推送 + 逐字节校验）
 *
 * 本机 git 的凭据助手会弹图形窗口导致 push 挂起，所以这里走 GitHub REST API。
 * 踩过的坑都固化成自检了：
 *   · 路径必须用 '/' 手工拼接（Windows 上 path.join 会给反斜杠）
 *   · 建树必须显式记录父子关系（否则新建的顶层目录，如 assets，进不了根树）
 *   · 根树必须包含 assets 与 tools，否则拒绝推进分支
 *
 * 用法:
 *   node tools/publish.mjs --dry          只列出差异
 *   node tools/publish.mjs --push         推送
 *   node tools/publish.mjs --push --writeback   推送后把规范化文件写回工作区
 */
import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STAGE = join(ROOT, '.publish')
const API = 'https://api.github.com'
const ownerRepo = 'Fliceyuu/memorial-site'
const branch = 'main'
const [owner, repo] = ownerRepo.split('/')

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const PUSH = argv.includes('--push')
const WRITEBACK = argv.includes('--writeback')

const IGNORE_DIRS = new Set(['.git', '.publish', 'node_modules', 'preview'])
const IGNORE_FILES = new Set(['.github-token.json', '.github-auth.json', '.git-askpass.sh', 'dbg3.mjs', 'dbg4.mjs', 'fix-join.mjs'])
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.yml', '.yaml', '.gitignore', ''])

const MESSAGE = [
  '补上 assets 静态资源，修正发布脚本的目录树构建',
  '',
  '发布脚本此前有两个问题，导致 assets/css 与 assets/js 两棵子树没有进入提交：',
  '1. 父目录键用 join(\'\') 拼接，assets/css 变成 assetscss；',
  '2. 根条目直接取根分组，新建的顶层目录不会自动挂到根上。',
  '现已改为显式记录父子关系，并在推送前硬校验根树包含 assets 与 tools。',
].join('\n')

const joinRel = (prefix, name) => (prefix ? prefix + '/' + name : name)
const sha1 = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex')

/* ================================================ 1. 构造干净树 */
if (existsSync(STAGE)) await rm(STAGE, { recursive: true, force: true })
await mkdir(STAGE, { recursive: true })

async function copyClean(dir, prefix) {
  for (const name of await readdir(dir)) {
    if (IGNORE_FILES.has(name)) continue
    const full = join(dir, name)
    const st = await stat(full)
    if (st.isDirectory()) {
      if (IGNORE_DIRS.has(name)) continue
      await copyClean(full, joinRel(prefix, name))
      continue
    }
    if (!st.isFile()) continue
    const rel = joinRel(prefix, name)
    const dest = join(STAGE, rel)
    await mkdir(dirname(dest), { recursive: true })
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
    let buf = await readFile(full)
    if (TEXT_EXT.has(ext)) {
      let txt = buf.toString('utf8').replace(/\r\n/g, '\n')
      if (!txt.endsWith('\n')) txt += '\n'
      buf = Buffer.from(txt, 'utf8')
    }
    await writeFile(dest, buf)
  }
}
await copyClean(ROOT, '')

async function listFiles(dir, prefix, out) {
  for (const name of await readdir(dir)) {
    const full = join(dir, name)
    const st = await stat(full)
    if (st.isDirectory()) await listFiles(full, joinRel(prefix, name), out)
    else out.push(joinRel(prefix, name))
  }
  return out
}
const files = (await listFiles(STAGE, '', [])).sort()
if (files.some((f) => f.includes('\\'))) {
  console.error('路径含反斜杠，分组会出错')
  process.exit(1)
}
console.log('规范树：' + files.length + ' 个文件')

/* ================================================ 2. 冒烟测试 */
console.log('在副本上跑冒烟测试…')
try {
  for (const args of [['--page=home'], ['--page=person', '--id=p3']]) {
    const out = execFileSync(process.execPath, [join(STAGE, 'tools', 'smoke.mjs'), ...args], { cwd: STAGE, encoding: 'utf8' })
    if (!out.includes('全部通过')) throw new Error('未通过：' + args.join(' '))
  }
  console.log('  两页均通过 ✓')
} catch (err) {
  console.error('冒烟测试失败，终止：' + (err.stdout || err.message))
  process.exit(1)
}

/* ================================================ 3. 后端 API */
const token = JSON.parse(await readFile(join(ROOT, '.github-token.json'), 'utf8')).token
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'memorial-site-publish',
  'Content-Type': 'application/json',
}
async function api(method, path, body, okStatuses) {
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch (err) {
    /* 非 JSON */
  }
  return { ok: (okStatuses || [200, 201]).includes(res.status), status: res.status, json, text }
}

/* ================================================ 4. 与远端比对 */
const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`, undefined, [200, 404])
const headSha = ref.ok && ref.json && ref.json.object ? ref.json.object.sha : null
const remote = new Map()
if (headSha) {
  const c = await api('GET', `/repos/${owner}/${repo}/git/commits/${headSha}`)
  async function collect(treeSha, prefix) {
    const t = await api('GET', `/repos/${owner}/${repo}/git/trees/${treeSha}`)
    for (const e of t.json.tree) {
      const p = joinRel(prefix, e.path)
      if (e.type === 'tree') await collect(e.sha, p)
      else remote.set(p, e.sha)
    }
  }
  await collect(c.json.tree.sha, '')
}
console.log('远端 ' + (headSha ? headSha.slice(0, 8) : '(空仓库)') + '，' + remote.size + ' 个文件')

const changed = []
const same = []
for (const rel of files) {
  const buf = await readFile(join(STAGE, rel))
  const sha = sha1(buf)
  if (remote.get(rel) === sha) same.push({ rel, sha })
  else changed.push({ rel, sha, buf })
}
const removed = Array.from(remote.keys()).filter((p) => !files.includes(p))
console.log('差异：改动 ' + changed.length + '，未变 ' + same.length + '，远端多余 ' + removed.length)
changed.forEach((f) => console.log('  ~ ' + f.rel))
removed.forEach((p) => console.log('  - ' + p))

if (!changed.length && !removed.length) {
  console.log('\n远端已最新。')
  if (WRITEBACK) await writeBack(files)
  process.exit(0)
}
if (!PUSH) {
  console.log('\n[dry] 未推送。')
  process.exit(0)
}

/* ================================================ 5. 上传 blob */
/** 目录 → 条目列表；每个条目带 {path, mode, type, sha} */
const dirs = new Map()
const ensureDir = (d) => {
  if (!dirs.has(d)) dirs.set(d, new Map())
  return dirs.get(d)
}
const addEntry = (dir, entry) => ensureDir(dir).set(entry.path, entry)

for (const f of changed) {
  const created = await api('POST', `/repos/${owner}/${repo}/git/blobs`, { content: f.buf.toString('base64'), encoding: 'base64' }, [201])
  if (!created.ok) {
    console.error('上传失败 ' + f.rel + '：' + created.status)
    process.exit(1)
  }
  f.remoteSha = created.json.sha
}
for (const f of [...changed, ...same]) {
  const parts = f.rel.split('/')
  const name = parts.pop()
  addEntry(parts.join('/'), { path: name, mode: '100644', type: 'blob', sha: f.remoteSha || f.sha })
}

/* ================================================ 6. 建树（自底向上，显式父子关系） */
/* 踩过的坑：只遍历"含文件的目录"会漏掉 assets 这种"只含子目录"的中间层，
   于是 assets/css 建好了却挂不到根上。这里先把全部需要的目录补全。 */
const dirSet = new Set(dirs.keys())
for (const dir of Array.from(dirSet)) {
  let d = dir
  while (d.includes('/')) {
    d = d.slice(0, d.lastIndexOf('/'))
    dirSet.add(d)
  }
}
// 由深到浅：先建叶子目录，再建中间层，最后是根
const buildOrder = Array.from(dirSet)
  .filter((d) => d !== '')
  .sort((x, y) => y.split('/').length - x.split('/').length || (x < y ? -1 : 1))

console.log('待建目录（由深到浅）：' + buildOrder.join(' , '))
for (const dir of buildOrder) {
  const tree = Array.from(dirs.get(dir).values())
  const created = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree }, [201])
  if (!created.ok || !created.json || !created.json.sha) {
    console.error('建树失败 ' + dir + '：' + created.status + ' ' + created.text.slice(0, 200))
    process.exit(1)
  }
  const parts = dir.split('/')
  const name = parts.pop()
  const parent = parts.join('/')
  addEntry(parent, { path: name, mode: '040000', type: 'tree', sha: created.json.sha })
  const subs = tree.filter((e) => e.type === 'tree').length
  console.log('  子树 ' + dir.padEnd(12) + ' → ' + created.json.sha.slice(0, 10) +
    '  (' + tree.length + ' 项' + (subs ? '，含 ' + subs + ' 个子目录' : '') + ')  挂到 [' + (parent || '根') + ']')
}

const rootEntries = Array.from(dirs.get('').values())
const rootNames = rootEntries.map((e) => e.path + (e.type === 'tree' ? '/' : '')).sort()
console.log('根条目：' + rootNames.join(', '))

for (const need of ['assets', 'tools']) {
  const e = rootEntries.find((x) => x.path === need)
  if (!e || e.type !== 'tree') {
    console.error('✗ 根树缺少 ' + need + ' 子树，拒绝推送')
    process.exit(1)
  }
}
console.log('根树自检通过：assets + tools 均已挂上 ✓')

const rootTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree: rootEntries }, [201])
if (!rootTree.ok || !rootTree.json.sha) {
  console.error('建根树失败：' + rootTree.status + ' ' + rootTree.text.slice(0, 300))
  process.exit(1)
}

/* ================================================ 7. 提交并推进分支 */
const now = new Date().toISOString()
const author = { name: 'Fliceyuu', email: 'Fliceyuu@users.noreply.github.com', date: now }
const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
  message: MESSAGE,
  tree: rootTree.json.sha,
  parents: headSha ? [headSha] : [],
  author,
  committer: author,
}, [201])
if (!commit.ok) {
  console.error('建提交失败：' + commit.status + ' ' + commit.text.slice(0, 300))
  process.exit(1)
}
if (headSha) {
  const upd = await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: commit.json.sha }, [200])
  if (!upd.ok) {
    console.error('更新分支失败：' + upd.status + ' ' + upd.text.slice(0, 300))
    process.exit(1)
  }
} else {
  await api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: 'refs/heads/' + branch, sha: commit.json.sha }, [201])
}
console.log('\n已推送 ' + commit.json.sha.slice(0, 8) + ' → ' + ownerRepo + '@' + branch + ' ✓')

if (WRITEBACK) await writeBack(files)

async function writeBack(list) {
  let n = 0
  for (const rel of list) {
    const src = join(STAGE, rel)
    const dst = join(ROOT, rel)
    const buf = await readFile(src)
    const cur = existsSync(dst) ? await readFile(dst) : null
    if (!cur || !cur.equals(buf)) {
      await mkdir(dirname(dst), { recursive: true })
      await writeFile(dst, buf)
      n += 1
    }
  }
  console.log('已把 ' + n + ' 个规范化文件写回工作区')
}
