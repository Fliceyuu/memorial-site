/**
 * github-push.mjs — 不依赖 git 的网络层，直接用 GitHub REST API 推送提交
 *
 * 为什么需要它：本机 git 的凭据助手是 Git Credential Manager，会弹图形窗口，
 * 在无交互环境里会让 `git push` 永久挂起。此脚本改用 HTTPS + token 直接建对象与引用。
 *
 * 用法: node tools/github-push.mjs [owner/repo] [branch]
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { dirname, join, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.github.com'

const ownerRepo = process.argv[2] || 'Fliceyuu/memorial-site'
const branch = process.argv[3] || 'main'
const [owner, repo] = ownerRepo.split('/')

const saved = JSON.parse(await readFile(join(ROOT, '.github-token.json'), 'utf8'))
const token = saved.token
if (!token) throw new Error('token 为空')

const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'memorial-site-publish',
}

async function api(method, path, body, okStatuses) {
  const res = await fetch(API + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch (err) {
    /* 非 JSON */
  }
  const ok = (okStatuses || [200, 201]).includes(res.status)
  return { ok, status: res.status, json, text }
}

/* ------------------------------------------------------------ 对象构造 */
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')
const SHA_RE = /^[0-9a-f]{40}$/

/** 走 git 的松散对象格式：zlib( "<type> <size>\0" + 内容 ) */
function looseObject(type, content) {
  return deflateRawSync(Buffer.concat([Buffer.from(type + ' ' + content.length + '\0'), content]))
}

function treeEntry(mode, name, sha) {
  return Buffer.concat([Buffer.from(mode + ' ' + name + '\0'), Buffer.from(sha, 'hex')])
}

function treeContent(entries) {
  // git 要求条目按名称排序，且目录名视同带 '/' 后缀参与排序
  const sorted = entries.slice().sort((a, b) => {
    const an = a.mode === '40000' ? a.name + '/' : a.name
    const bn = b.mode === '40000' ? b.name + '/' : b.name
    return an < bn ? -1 : an > bn ? 1 : 0
  })
  return Buffer.concat(sorted.map((e) => treeEntry(e.mode, e.name, e.sha)))
}

/* ------------------------------------------------------------ 收集文件 */
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'preview'])
const IGNORE_FILES = new Set(['.github-token.json', '.github-auth.json', '.git-askpass.sh'])

async function walk(dir, prefix) {
  const out = []
  for (const name of await readdir(dir)) {
    if (IGNORE_FILES.has(name)) continue
    const full = join(dir, name)
    const st = await stat(full)
    if (st.isDirectory()) {
      if (IGNORE_DIRS.has(name)) continue
      out.push(...(await walk(full, posix.join(prefix, name))))
    } else if (st.isFile()) {
      out.push({ path: posix.join(prefix, name), full, size: st.size })
    }
  }
  return out
}

const files = await walk(ROOT, '')
files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
console.log('待推送文件 ' + files.length + ' 个，合计 ' + (files.reduce((a, b) => a + b.size, 0) / 1024).toFixed(0) + ' KB')

/* ------------------------------------------------------------ 建 blob 与 tree */
const existingTree = new Map() // path -> sha（已存在于远端）

const rootEntries = []
const dirEntries = new Map() // dirPath -> entries[]

for (const f of files) {
  const buf = await readFile(f.full)
  // 与远端同路径且内容一致时无需重传（这里没有本地索引，仅做占位）
  const sha = sha1(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf]))
  const created = await api('POST', `/repos/${owner}/${repo}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  }, [201])
  if (!created.ok) {
    console.error('上传 blob 失败：' + f.path + ' → ' + created.status + ' ' + created.text.slice(0, 200))
    process.exit(1)
  }
  f.sha = created.json.sha

  const parts = f.path.split('/')
  const fileName = parts.pop()
  const dirPath = parts.join('/')
  if (!dirEntries.has(dirPath)) dirEntries.set(dirPath, [])
  dirEntries.get(dirPath).push({ mode: '100644', name: fileName, sha: f.sha })
  if (dirPath === '') rootEntries.push({ mode: '100644', name: fileName, sha: f.sha })
}

/* 自底向上建目录树 */
const dirPaths = Array.from(dirEntries.keys()).filter((p) => p !== '').sort((a, b) => b.split('/').length - a.split('/').length)
const dirShas = new Map()

for (const dirPath of dirPaths) {
  const content = treeContent(dirEntries.get(dirPath))
  const created = await api('POST', `/repos/${owner}/${repo}/git/trees`, {
    tree: dirEntries.get(dirPath).map((e) => ({ path: e.name, mode: e.mode, type: 'blob', sha: e.sha })),
  }, [201])
  if (!created.ok) {
    console.error('建目录树失败：' + dirPath + ' → ' + created.status + ' ' + created.text.slice(0, 200))
    process.exit(1)
  }
  dirShas.set(dirPath, created.json.sha)
  void content

  const parts = dirPath.split('/')
  const name = parts.pop()
  const parent = parts.join('/')
  if (!dirEntries.has(parent)) dirEntries.set(parent, [])
  dirEntries.get(parent).push({ mode: '40000', name, sha: created.json.sha })
  if (parent === '') rootEntries.push({ mode: '40000', name, sha: created.json.sha })
}

const rootTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, {
  tree: rootEntries.map((e) => ({ path: e.name, mode: e.mode, type: e.mode === '40000' ? 'tree' : 'blob', sha: e.sha })),
}, [201])
if (!rootTree.ok) {
  console.error('建根树失败：' + rootTree.status + ' ' + rootTree.text.slice(0, 300))
  process.exit(1)
}
console.log('根树：' + rootTree.json.sha)

/* ------------------------------------------------------------ 提交与引用 */
const message = [
  '四人纪念：哥特维多利亚风格的四人青春纪念站',
  '',
  '纯静态、零依赖、可离线运行。包含四人拱廊、共同时间轴、瀑布相册墙、',
  '留言与献花、个人页（肖像 / 专属时间轴 / 私人影音 / 唱片机）。',
  '',
  '- 所有文字可在页面上直接编辑，改动存于 localStorage',
  '- 照片、视频、音乐经 IndexedDB 保存在访客本机，不上传服务器',
  '- 背景音为纯 WebAudio 合成的管风琴持续音，无需音频文件',
  '- 字体以 base64 内联，离线双击 index.html 亦完整呈现',
  '- 附无浏览器冒烟测试与 DevTools 协议截图工具',
  '',
  '示例人物与故事均为虚构演示内容。',
].join('\n')

let parentSha = null
const refRes = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`, undefined, [200, 404])
if (refRes.ok && refRes.json && refRes.json.object) {
  parentSha = refRes.json.object.sha
  console.log('已有分支 ' + branch + '，父提交 ' + parentSha.slice(0, 7))
}

const commitRes = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
  message,
  tree: rootTree.json.sha,
  parents: parentSha ? [parentSha] : [],
  author: { name: 'Fliceyuu', email: 'Fliceyuu@users.noreply.github.com', date: new Date().toISOString() },
  committer: { name: 'Fliceyuu', email: 'Fliceyuu@users.noreply.github.com', date: new Date().toISOString() },
}, [201])
if (!commitRes.ok) {
  console.error('创建提交失败：' + commitRes.status + ' ' + commitRes.text.slice(0, 300))
  process.exit(1)
}
console.log('提交：' + commitRes.json.sha)

if (parentSha) {
  const upd = await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    sha: commitRes.json.sha,
    force: false,
  }, [200])
  if (!upd.ok) {
    console.error('更新分支失败：' + upd.status + ' ' + upd.text.slice(0, 300))
    process.exit(1)
  }
} else {
  const crt = await api('POST', `/repos/${owner}/${repo}/git/refs`, {
    ref: 'refs/heads/' + branch,
    sha: commitRes.json.sha,
  }, [201])
  if (!crt.ok) {
    console.error('创建分支失败：' + crt.status + ' ' + crt.text.slice(0, 300))
    process.exit(1)
  }
}
console.log('已推送到 ' + owner + '/' + repo + ' 的 ' + branch + ' 分支 ✓')

/* ------------------------------------------------------------ 开启 Pages */
const pages = await api('POST', `/repos/${owner}/${repo}/pages`, { source: { branch, path: '/' } }, [201, 200, 409])
if (pages.ok) console.log('GitHub Pages 已启用（' + branch + ' / 根目录）')
else if (pages.status === 409) console.log('GitHub Pages 已存在')
else console.log('Pages 启用返回 ' + pages.status + '：' + pages.text.slice(0, 200))

console.log('\n线上地址：https://' + owner.toLowerCase() + '.github.io/' + repo + '/')
