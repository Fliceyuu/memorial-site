/**
 * github-verify.mjs — 核对远端仓库是否与本地发布树逐字节一致
 *
 * 逐文件比较 blob 的 git SHA-1（即内容哈希），而不是"看起来一样"。
 * 用法: node tools/github-verify.mjs [owner/repo] [branch]
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.github.com'
const ownerRepo = process.argv[2] || 'Fliceyuu/memorial-site'
const branch = process.argv[3] || 'main'
const [owner, repo] = ownerRepo.split('/')

const STAGE = join(ROOT, '.publish')
const base = existsSync(STAGE) ? STAGE : ROOT
const IGNORE_DIRS = new Set(['.git', '.publish', 'node_modules', 'preview'])
const IGNORE_FILES = new Set(['.github-token.json', '.github-auth.json', '.git-askpass.sh'])

const token = JSON.parse(await readFile(join(ROOT, '.github-token.json'), 'utf8')).token
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'memorial-site-publish',
}

const blobSha = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex')
const joinRel = (p, n) => (p ? p + '/' + n : n)

async function listLocal(dir, prefix, out) {
  for (const name of await readdir(dir)) {
    if (IGNORE_FILES.has(name)) continue
    const full = join(dir, name)
    const st = await stat(full)
    if (st.isDirectory()) {
      if (IGNORE_DIRS.has(name)) continue
      await listLocal(full, joinRel(prefix, name), out)
    } else if (st.isFile()) {
      out.push(joinRel(prefix, name))
    }
  }
  return out
}

const remote = new Map()
async function walkRemote(treeSha, prefix) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/git/trees/${treeSha}`, { headers })
  if (!res.ok) throw new Error('读取远端树失败：' + res.status)
  const json = await res.json()
  for (const e of json.tree) {
    const p = joinRel(prefix, e.path)
    if (e.type === 'tree') await walkRemote(e.sha, p)
    else if (e.type === 'blob') remote.set(p, { sha: e.sha, size: e.size })
  }
}

const refRes = await fetch(`${API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers })
if (!refRes.ok) throw new Error('读取分支失败：' + refRes.status)
const headSha = (await refRes.json()).object.sha
const commitRes = await fetch(`${API}/repos/${owner}/${repo}/git/commits/${headSha}`, { headers })
const commit = await commitRes.json()
await walkRemote(commit.tree.sha, '')

const localFiles = (await listLocal(base, '', [])).sort()
console.log('比对来源：' + (base === STAGE ? '.publish/（规范发布树）' : '工作区'))
console.log('远端 ' + branch + ' = ' + headSha.slice(0, 8) + '  ' + commit.message.split('\n')[0])
console.log('本地 ' + localFiles.length + ' 个文件 / 远端 ' + remote.size + ' 个文件\n')

const mismatch = []
const missingRemote = []
const missingLocal = []

for (const rel of localFiles) {
  const buf = await readFile(join(base, rel))
  const sha = blobSha(buf)
  const r = remote.get(rel)
  if (!r) missingRemote.push(rel)
  else if (r.sha !== sha) mismatch.push({ rel, local: sha, remote: r.sha, localSize: buf.length, remoteSize: r.size })
}
for (const rel of remote.keys()) {
  if (!localFiles.includes(rel)) missingLocal.push(rel)
}

if (missingRemote.length) console.log('✗ 远端缺失：\n  ' + missingRemote.join('\n  '))
if (mismatch.length) {
  console.log('✗ 内容不一致：')
  mismatch.forEach((m) => console.log('  ' + m.rel + '  本地 ' + m.localSize + 'B/' + m.local.slice(0, 8) + '  远端 ' + m.remoteSize + 'B/' + m.remote.slice(0, 8)))
}
if (missingLocal.length) console.log('✗ 仅远端存在（本地树里没有）：\n  ' + missingLocal.join('\n  '))

const ok = !missingRemote.length && !mismatch.length && !missingLocal.length
console.log(ok ? '\n✓ 全部逐字节一致（' + localFiles.length + ' 个文件）' : '\n✗ 存在差异')
process.exit(ok ? 0 : 1)
