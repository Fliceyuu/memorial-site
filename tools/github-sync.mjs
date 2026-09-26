/**
 * github-sync.mjs — 把线上仓库同步回本地（文件 + .git 对象）
 *
 * 本机 git 的推送链路不可用（凭据助手弹窗），所以本地仓库用 API 对齐：
 *   1. 从远端提交树逐文件下载并写入工作区（内容一致时不改动，保留你未提交的编辑）
 *   2. 用 API 取回的 blob/tree/commit 生成 .git 松散对象，并更新 refs/heads/main
 * 之后 `git log` / `git status` / `git diff` 都能正常工作。
 *
 * 用法: node tools/github-sync.mjs [owner/repo] [branch] [--dry]
 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { dirname, join, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.github.com'
const ownerRepo = process.argv[2] || 'Fliceyuu/memorial-site'
const branch = process.argv[3] || 'main'
const DRY = process.argv.includes('--dry')
const [owner, repo] = ownerRepo.split('/')

const token = JSON.parse(await readFile(join(ROOT, '.github-token.json'), 'utf8')).token
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'memorial-site-publish',
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? Object.assign({ 'Content-Type': 'application/json' }, headers) : headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch (err) {
    /* 非 JSON */
  }
  return { ok: res.ok, status: res.status, json, text }
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
    } else if (st.isFile()) out.push(posix.join(prefix, name))
  }
  return out
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')
const loose = (type, content) => deflateRawSync(Buffer.concat([Buffer.from(type + ' ' + content.length + '\0'), content]))
const gitObjectPath = (sha) => join(ROOT, '.git', 'objects', sha.slice(0, 2), sha.slice(2))

async function writeObject(type, content) {
  const sha = sha1(Buffer.concat([Buffer.from(type + ' ' + content.length + '\0'), content]))
  const p = gitObjectPath(sha)
  if (!existsSync(p)) {
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, loose(type, content))
  }
  return sha
}

async function writeObjectRaw(sha, type, content) {
  const p = gitObjectPath(sha)
  if (!existsSync(p)) {
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, loose(type, content))
  }
}

/* 1. 取远端引用与提交 */
const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`)
if (!ref.ok) throw new Error('读取分支失败：' + ref.status)
const headSha = ref.json.object.sha
const commitRes = await api('GET', `/repos/${owner}/${repo}/git/commits/${headSha}`)
if (!commitRes.ok) throw new Error('读取提交失败：' + commitRes.status)
const commit = commitRes.json
console.log('远端 ' + branch + ' = ' + headSha.slice(0, 8) + '  ' + commit.message.split('\n')[0])

/* 2. 遍历树，下载文件 */
const remote = new Map() // path -> { sha, mode }
async function collect(treeSha, prefix) {
  const t = await api('GET', `/repos/${owner}/${repo}/git/trees/${treeSha}`)
  if (!t.ok) throw new Error('读取树失败：' + t.status)
  for (const e of t.json.tree) {
    const path = prefix ? prefix + '/' + e.path : e.path
    if (e.type === 'tree') await collect(e.sha, path)
    else remote.set(path, { sha: e.sha, mode: e.mode })
  }
}
await collect(commit.tree.sha, '')
console.log('远端文件 ' + remote.size + ' 个')

let updated = 0
let unchanged = 0
let created = 0
for (const [path, info] of remote) {
  const blob = await api('GET', `/repos/${owner}/${repo}/git/blobs/${info.sha}`)
  if (!blob.ok) throw new Error('下载 blob 失败 ' + path + '：' + blob.status)
  const content = Buffer.from(blob.json.content, 'base64')
  const full = join(ROOT, path)
  let same = false
  if (existsSync(full)) {
    const local = await readFile(full)
    same = local.equals(content)
  }
  if (same) {
    unchanged += 1
  } else if (DRY) {
    console.log('  [dry] 将写入 ' + path)
    updated += 1
  } else {
    await mkdir(dirname(full), { recursive: true })
    const isNew = !existsSync(full)
    await writeFile(full, content)
    if (isNew) created += 1
    else updated += 1
  }
  if (!DRY) await writeObjectRaw(info.sha, 'blob', content)
}
console.log(`文件同步：新增 ${created}，更新 ${updated}，内容一致 ${unchanged}`)

/* 3. 本地多余文件提示（不自动删） */
const localFiles = await walk(ROOT, '', [])
const extra = localFiles.filter((p) => !remote.has(p))
if (extra.length) {
  console.log('仅存在于本地（保留未动）：' + extra.join(', '))
}

/* 4. 重建本地 .git 对象与引用 */
if (!DRY) {
  async function rebuildTree(treeSha) {
    const t = await api('GET', `/repos/${owner}/${repo}/git/trees/${treeSha}`)
    const entries = []
    for (const e of t.json.tree) {
      if (e.type === 'tree') {
        const sub = await rebuildTree(e.sha)
        entries.push({ mode: '40000', name: e.path, sha: sub })
      } else {
        entries.push({ mode: e.mode, name: e.path, sha: e.sha })
      }
    }
    const body = Buffer.concat(
      entries
        .sort((a, b) => {
          const an = a.mode === '40000' ? a.name + '/' : a.name
          const bn = b.mode === '40000' ? b.name + '/' : b.name
          return an < bn ? -1 : an > bn ? 1 : 0
        })
        .map((e) => Buffer.concat([Buffer.from(e.mode + ' ' + e.name + '\0'), Buffer.from(e.sha, 'hex')]))
    )
    await writeObjectRaw(treeSha, 'tree', body)
    return treeSha
  }
  await rebuildTree(commit.tree.sha)

  const commitBody = Buffer.concat([
    Buffer.from('tree ' + commit.tree.sha + '\n'),
    ...commit.parents.map((p) => Buffer.from('parent ' + p.sha + '\n')),
    Buffer.from('author ' + commit.author.name + ' <' + commit.author.email + '> ' + Math.floor(new Date(commit.author.date).getTime() / 1000) + ' +0000\n'),
    Buffer.from('committer ' + commit.committer.name + ' <' + commit.committer.email + '> ' + Math.floor(new Date(commit.committer.date).getTime() / 1000) + ' +0000\n'),
    Buffer.from('\n' + commit.message + '\n'),
  ])
  const localCommit = await writeObject('commit', commitBody)
  console.log('本地提交对象 ' + localCommit.slice(0, 8) + (localCommit === headSha ? '（与远端一致 ✓）' : '（注意：与远端 sha 不同）'))

  await mkdir(join(ROOT, '.git', 'refs', 'heads'), { recursive: true })
  await writeFile(join(ROOT, '.git', 'refs', 'heads', branch), headSha + '\n')
  await writeFile(join(ROOT, '.git', 'HEAD'), 'ref: refs/heads/' + branch + '\n')
  const packed = join(ROOT, '.git', 'packed-refs')
  if (existsSync(packed)) {
    const txt = await readFile(packed, 'utf8')
    await writeFile(packed, txt.replace(new RegExp('#?\\s*[0-9a-f]{40} refs/heads/' + branch + '\\n', 'g'), ''))
  }
  console.log('已更新 .git/refs/heads/' + branch + ' → ' + headSha.slice(0, 8))
}
