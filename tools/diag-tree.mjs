/**
 * diag-tree.mjs — 诊断：本地重建的树与远端树到底差在哪
 * 只读，不写入任何东西。
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STAGE = join(ROOT, '.publish')
const API = 'https://api.github.com'
const [owner, repo, branch] = ['Fliceyuu', 'memorial-site', 'main']

const token = JSON.parse(await readFile(join(ROOT, '.github-token.json'), 'utf8')).token
const H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'diag' }

const blobSha = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex')
const joinRel = (p, n) => (p ? p + '/' + n : n)

async function listLocal(dir, prefix, out) {
  for (const name of await readdir(dir)) {
    const full = join(dir, name)
    const st = await stat(full)
    if (st.isDirectory()) await listLocal(full, joinRel(prefix, name), out)
    else out.push(joinRel(prefix, name))
  }
  return out
}

const locals = (await listLocal(STAGE, '', [])).sort()
const groups = new Map()
for (const rel of locals) {
  const parts = rel.split('/')
  const name = parts.pop()
  const dir = parts.join('/')
  if (!groups.has(dir)) groups.set(dir, [])
  groups.get(dir).push(name)
}
console.log('本地分组：')
for (const [dir, names] of groups) console.log('  [' + (dir || '(根)') + '] ' + names.join(', '))

/* 远端现状 */
const ref = await (await fetch(`${API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers: H })).json()
const commit = await (await fetch(`${API}/repos/${owner}/${repo}/git/commits/${ref.object.sha}`, { headers: H })).json()
console.log('\n远端 HEAD ' + ref.object.sha.slice(0, 8))
const root = await (await fetch(`${API}/repos/${owner}/${repo}/git/trees/${commit.tree.sha}`, { headers: H })).json()
console.log('远端根条目：' + root.tree.map((e) => e.path + '(' + e.type + ')').join(', '))

/* 深浅比较：assets 子树 */
const remoteAssets = root.tree.find((e) => e.path === 'assets')
if (!remoteAssets) {
  console.log('\n✗ 远端根里根本没有 assets —— 说明推送时 assets 子树没挂到根上')
} else {
  console.log('远端 assets 树 = ' + remoteAssets.sha)
  const sub = await (await fetch(`${API}/repos/${owner}/${repo}/git/trees/${remoteAssets.sha}`, { headers: H })).json()
  console.log('远端 assets 子条目：' + sub.tree.map((e) => e.path + '(' + e.type + ')').join(', '))
}

/* 逐个文件看本地 blob sha 与远端是否一致 */
console.log('\n本地文件 blob sha：')
for (const rel of locals) {
  if (!rel.startsWith('assets/')) continue
  const buf = await readFile(join(STAGE, rel))
  console.log('  ' + rel.padEnd(28) + blobSha(buf).slice(0, 12) + '  ' + buf.length + 'B')
}
