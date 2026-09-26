/**
 * github-push.mjs — 用 GitHub REST API 推送本地工作区（不依赖 git 的网络层）
 *
 * 为什么需要它：本机 git 的凭据助手是 Git Credential Manager，会弹图形窗口，
 * 在无交互环境里会让 `git push` 永久挂起。这里改用 HTTPS + token：
 * 复用远端已有 blob（sha 相同则跳过上传），重建整棵树，然后在当前 HEAD 之上提交。
 *
 * 用法:
 *   node tools/github-push.mjs [owner/repo] [branch] [提交信息]
 *   node tools/github-push.mjs --dry          只看会有哪些改动，不推送
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.github.com'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const positional = args.filter((a) => !a.startsWith('--'))
const ownerRepo = positional[0] || 'Fliceyuu/memorial-site'
const branch = positional[1] || 'main'
const message =
  positional.slice(2).join(' ') ||
  [
    '更新站点与工具',
    '',
    '- README 填入线上地址与仓库链接',
    '- 新增 API 推送 / 历史压缩 / 本地同步工具',
  ].join('\n')
const [owner, repo] = ownerRepo.split('/')

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

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'preview'])
const IGNORE_FILES = new Set(['.github-token.json', '.github-auth.json', '.git-askpass.sh'])

async function walk(dir, prefix, out) {
  for (const name of await readdir(dir)) {
    if (IGNORE_FILES.has(name)) continue
    const full = join(dir, name)
    const st = await stat(full)
    if (st.isDirectory()) {
      if (IGNORE_DIRS.has(name)) continue
      await walk(full, posix.join(prefix, name), out)
    } else if (st.isFile()) out.push({ path: posix.join(prefix, name), full })
  }
  return out
}

const blobSha = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex')

/* 1. 远端现状 */
let headSha = null
let remoteFiles = new Map()
const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`, undefined, [200, 404])
if (ref.ok && ref.json && ref.json.object) {
  headSha = ref.json.object.sha
  const commit = await api('GET', `/repos/${owner}/${repo}/git/commits/${headSha}`)
  async function collect(treeSha, prefix) {
    const t = await api('GET', `/repos/${owner}/${repo}/git/trees/${treeSha}`)
    for (const e of t.json.tree) {
      const p = prefix ? prefix + '/' + e.path : e.path
      if (e.type === 'tree') await collect(e.sha, p)
      else remoteFiles.set(p, e.sha)
    }
  }
  await collect(commit.json.tree.sha, '')
  console.log('远端 HEAD ' + headSha.slice(0, 8) + '，已有 ' + remoteFiles.size + ' 个文件')
} else {
  console.log('远端为空仓库，将建立初始提交')
}

/* 2. 本地文件 → 判断差异 */
const localFiles = (await walk(ROOT, '', [])).sort((a, b) => (a.path < b.path ? -1 : 1))
const changed = []
const same = []
for (const f of localFiles) {
  const buf = await readFile(f.full)
  f.buf = buf
  f.sha = blobSha(buf)
  if (remoteFiles.get(f.path) === f.sha) same.push(f)
  else changed.push(f)
}
const removed = Array.from(remoteFiles.keys()).filter((p) => !localFiles.some((f) => f.path === p))

console.log('本地 ' + localFiles.length + ' 个文件：变化 ' + changed.length + '，未变 ' + same.length + (removed.length ? '，远端多余 ' + removed.length : ''))
changed.forEach((f) => console.log('  ~ ' + f.path))
removed.forEach((p) => console.log('  - ' + p + '（将从远端移除）'))

if (!changed.length && !removed.length) {
  console.log('\n没有任何变化，无需提交。')
  process.exit(0)
}
if (DRY) {
  console.log('\n[dry] 未推送。')
  process.exit(0)
}

/* 3. 上传变化的 blob */
const entries = new Map() // dir -> [{path,mode,type,sha}]
const put = (dir, e) => {
  if (!entries.has(dir)) entries.set(dir, [])
  entries.get(dir).push(e)
}
const addFile = (path, sha) => {
  const parts = path.split('/')
  const name = parts.pop()
  put(parts.join('/'), { path: name, mode: '100644', type: 'blob', sha })
}

for (const f of changed) {
  const created = await api('POST', `/repos/${owner}/${repo}/git/blobs`, {
    content: f.buf.toString('base64'),
    encoding: 'base64',
  }, [201])
  if (!created.ok) {
    console.error('上传 blob 失败 ' + f.path + '：' + created.status + ' ' + created.text.slice(0, 200))
    process.exit(1)
  }
  addFile(f.path, created.json.sha)
}
for (const f of same) addFile(f.path, f.sha)

/* 4. 自底向上建档 */
const dirPaths = Array.from(entries.keys()).filter((d) => d !== '').sort((a, b) => b.split('/').length - a.split('/').length)
for (const dir of dirPaths) {
  const created = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree: entries.get(dir) }, [201])
  if (!created.ok) {
    console.error('建树失败 ' + dir + '：' + created.status + ' ' + created.text.slice(0, 200))
    process.exit(1)
  }
  const parts = dir.split('/')
  const name = parts.pop()
  put(parts.join(''), { path: name, mode: '040000', type: 'tree', sha: created.json.sha })
}

const rootTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree: entries.get('') || [] }, [201])
if (!rootTree.ok) {
  console.error('建根树失败：' + rootTree.status + ' ' + rootTree.text.slice(0, 300))
  process.exit(1)
}

/* 5. 提交并推进分支 */
const now = new Date().toISOString()
const author = { name: 'Fliceyuu', email: 'Fliceyuu@users.noreply.github.com', date: now }
const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
  message,
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
  const upd = await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: commit.json.sha, force: false }, [200])
  if (!upd.ok) {
    console.error('更新分支失败：' + upd.status + ' ' + upd.text.slice(0, 300))
    process.exit(1)
  }
} else {
  const crt = await api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: 'refs/heads/' + branch, sha: commit.json.sha }, [201])
  if (!crt.ok) {
    console.error('建分支失败：' + crt.status + ' ' + crt.text.slice(0, 300))
    process.exit(1)
  }
}
console.log('已推送 ' + commit.json.sha.slice(0, 8) + ' → ' + owner + '/' + repo + '@' + branch + ' ✓')
