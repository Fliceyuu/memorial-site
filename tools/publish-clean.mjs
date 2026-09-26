/**
 * publish-clean.mjs — 从工作区构造一棵规范的干净树并推送到 GitHub
 *
 * 背景：本机 git 开了 core.autocrlf=true，工作区文件被改成 CRLF，
 * 导致「本地 ↔ 远端」的 blob 哈希对不上，无法判断哪些是真改动。
 * 这里不再纠结本地 .git，而是：
 *   1. 把站点文件复制到 .publish/（排除 .git / preview / 授权文件）
 *   2. 文本文件一律规范为 LF（保证与远端字节一致，可重复校验）
 *   3. 在副本上跑冒烟测试，确认发布的那一份是好的
 *   4. 用 Git Data API 推送（复用远端未变 blob，只上传差异）
 *   5. 需要时把规范化的文件写回工作区
 *
 * 用法:
 *   node tools/publish-clean.mjs --dry        只看差异
 *   node tools/publish-clean.mjs --push       推送
 *   node tools/publish-clean.mjs --writeback  推送后把规范化文件写回工作区
 */
import { readFile, writeFile, mkdir, readdir, stat, rm, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve, posix } from 'node:path'
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
const IGNORE_FILES = new Set(['.github-token.json', '.github-auth.json', '.git-askpass.sh'])
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.yml', '.yaml', '.gitignore', ''])

const MESSAGE = [
  '更新站点与工具',
  '',
  '- README 填入线上地址与仓库链接',
  '- 新增 API 推送 / 历史压缩 / 本地同步 / 干净发布工具',
  '- 移除键值探测用的临时文件',
].join('\n')

/* ---------------------------------------------------- 1. 构造干净树 */
if (existsSync(STAGE)) await rm(STAGE, { recursive: true, force: true })
await mkdir(STAGE, { recursive: true })

// Windows 上 path.join/posix.join 会给出反斜杠，必须手工拼成正斜杠，
// 否则 'assets/css/theme.css' 会被当成单个文件名，整棵目录树都进不了提交。
const joinRel = (prefix, name) => (prefix ? prefix + '/' + name : name)

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
      // 规范为 LF，并统一末尾换行
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
console.log('规范树：' + files.length + ' 个文件')
if (files.some((f) => f.includes('\\'))) {
  console.error('路径出现反斜杠，分组会出错：' + files.filter((f) => f.includes('\\')).join(', '))
  process.exit(1)
}
const mustHave = ['index.html', 'person.html', 'assets/css/theme.css', 'assets/js/app.js', 'README.md']
const missing = mustHave.filter((m) => !files.includes(m))
if (missing.length) {
  console.error('规范树缺少关键文件：' + missing.join(', '))
  process.exit(1)
}

/* ---------------------------------------------------- 2. 冒烟测试 */
console.log('\n在副本上跑冒烟测试…')
try {
  for (const args of [['--page=home'], ['--page=person', '--id=p3']]) {
    const out = execFileSync(process.execPath, [join(STAGE, 'tools', 'smoke.mjs'), ...args], {
      cwd: STAGE,
      encoding: 'utf8',
    })
    const tail = out.trim().split('\n').filter((l) => l.includes('全部通过') || l.includes('✗'))
    console.log('  ' + args.join(' ') + ' → ' + (tail.join(' | ') || '(无结论)'))
    if (!out.includes('全部通过')) throw new Error('冒烟测试未通过')
  }
} catch (err) {
  console.error('冒烟测试失败，终止发布：' + (err.stdout || err.message))
  process.exit(1)
}

/* ---------------------------------------------------- 3. 与远端比对 */
const token = JSON.parse(await readFile(join(ROOT, '.github-token.json'), 'utf8')).token
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'memorial-site-publish',
  'Content-Type': 'application/json',
}
async function api(method, path, body, okStatuses) {
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch (err) {
    /* 非 JSON */
  }
  return { ok: (okStatuses || [200, 201]).includes(res.status), status: res.status, json, text }
}

const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`, undefined, [200, 404])
let headSha = ref.ok && ref.json && ref.json.object ? ref.json.object.sha : null
const remote = new Map()
if (headSha) {
  const commit = await api('GET', `/repos/${owner}/${repo}/git/commits/${headSha}`)
  async function collect(treeSha, prefix) {
    const t = await api('GET', `/repos/${owner}/${repo}/git/trees/${treeSha}`)
    for (const e of t.json.tree) {
      const p = prefix ? prefix + '/' + e.path : e.path
      if (e.type === 'tree') await collect(e.sha, p)
      else remote.set(p, e.sha)
    }
  }
  await collect(commit.json.tree.sha, '')
  console.log('\n远端 HEAD ' + headSha.slice(0, 8) + '，' + remote.size + ' 个文件')
}

const blobSha = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex')
const changed = []
const same = []
for (const rel of files) {
  const buf = await readFile(join(STAGE, rel))
  const sha = blobSha(buf)
  if (remote.get(rel) === sha) same.push({ rel, sha })
  else changed.push({ rel, sha, buf })
}
const removed = Array.from(remote.keys()).filter((p) => !files.includes(p))

console.log('差异：改动 ' + changed.length + '，未变 ' + same.length + '，远端多余 ' + removed.length)
changed.forEach((f) => console.log('  ~ ' + f.rel))
removed.forEach((p) => console.log('  - ' + p))

if (!changed.length && !removed.length) {
  console.log('\n远端已是最新，无需推送。')
  process.exit(0)
}
if (!PUSH) {
  console.log('\n[dry] 未推送。加 --push 执行。')
  process.exit(0)
}

/* ---------------------------------------------------- 4. 推送 */
const entries = new Map()
const put = (dir, e) => {
  if (!entries.has(dir)) entries.set(dir, [])
  entries.get(dir).push(e)
}
const addFile = (rel, sha) => {
  const parts = rel.split('/')
  const name = parts.pop()
  put(parts.join('/'), { path: name, mode: '100644', type: 'blob', sha })
}

for (const f of changed) {
  const created = await api('POST', `/repos/${owner}/${repo}/git/blobs`, {
    content: f.buf.toString('base64'),
    encoding: 'base64',
  }, [201])
  if (!created.ok) {
    console.error('上传失败 ' + f.rel + '：' + created.status + ' ' + created.text.slice(0, 200))
    process.exit(1)
  }
  addFile(f.rel, created.json.sha)
}
for (const f of same) addFile(f.rel, f.sha)

if (process.env.PUBLISH_DEBUG) {
  console.log('\n[debug] 分组结果：')
  for (const [dir, list] of entries) {
    console.log('  [' + (dir === '' ? '(根)' : dir) + '] → ' + list.map((e) => e.path + '(' + e.type + ')').join(', '))
  }
}
const dirPaths = Array.from(entries.keys()).filter((d) => d !== '').sort((a, b) => b.split('/').length - a.split('/').length)
for (const dir of dirPaths) {
  const created = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree: entries.get(dir) }, [201])
  if (!created.ok) {
    console.error('建树失败 ' + dir + '：' + created.status + ' ' + created.text.slice(0, 200))
    process.exit(1)
  }
  const parts = dir.split('/')
  const name = parts.pop()
  // 父目录键必须用 '/' 拼接：写成 join('') 会把 assets/css 变成 assetscss，整棵子树丢失
  put(parts.join('/'), { path: name, mode: '040000', type: 'tree', sha: created.json.sha })
}

const rootTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree: entries.get('') || [] }, [201])
if (!rootTree.ok) {
  console.error('建根树失败：' + rootTree.status + ' ' + rootTree.text.slice(0, 300))
  process.exit(1)
}

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

/* ---------------------------------------------------- 5. 写回工作区 */
if (WRITEBACK) {
  let n = 0
  for (const rel of files) {
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
  console.log('已把 ' + n + ' 个规范化文件写回工作区（本地与远端现在逐字节一致）')
}
