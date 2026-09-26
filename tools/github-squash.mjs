/**
 * github-squash.mjs — 把仓库整理成单一、干净的初始提交
 *
 * Contents API 每上传一个文件就产生一次提交，公开仓库的历史会很难看。
 * 这里用 Git Data API 复用远端已有 blob 重建整棵树，然后强制更新 main。
 * 同时：删除误入库的 .probe、把小写的 Pages 主页地址写回仓库设置。
 *
 * 用法: node tools/github-squash.mjs [owner/repo] [branch]
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.github.com'
const ownerRepo = process.argv[2] || 'Fliceyuu/memorial-site'
const branch = process.argv[3] || 'main'
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
  const ok = (okStatuses || [200, 201]).includes(res.status)
  return { ok, status: res.status, json, text }
}

const DROP = new Set(['.probe'])

/** 递归收集远端树：path -> sha（含空目录处理） */
async function collect(treeSha, prefix, out) {
  const res = await api('GET', `/repos/${owner}/${repo}/git/trees/${treeSha}`)
  if (!res.ok) throw new Error('读取树失败 ' + treeSha + ' → ' + res.status)
  for (const e of res.json.tree) {
    const path = prefix ? prefix + '/' + e.path : e.path
    if (e.type === 'tree') {
      await collect(e.sha, path, out)
    } else if (e.type === 'blob') {
      if (DROP.has(path)) {
        console.log('  丢弃: ' + path)
        continue
      }
      out.push({ path, sha: e.sha, mode: e.mode })
    }
  }
  return out
}

const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`)
if (!ref.ok) throw new Error('读取分支失败：' + ref.status)
const oldSha = ref.json.object.sha
const oldCommit = await api('GET', `/repos/${owner}/${repo}/git/commits/${oldSha}`)
const oldTree = oldCommit.json.tree.sha

console.log('现有提交 ' + oldSha.slice(0, 8) + '，提交数：')
const history = await api('GET', `/repos/${owner}/${repo}/commits?sha=${branch}&per_page=100`)
console.log('  ' + (history.json || []).length + ' 次提交将被压缩为 1 次')

const files = []
await collect(oldTree, '', files)
console.log('保留文件 ' + files.length + ' 个')

/* 按目录分组重建树 */
const dirs = new Map()
const ensure = (d) => {
  if (!dirs.has(d)) dirs.set(d, [])
  return dirs.get(d)
}
for (const f of files) {
  const parts = f.path.split('/')
  const name = parts.pop()
  const dir = parts.join('/')
  ensure(dir).push({ path: name, mode: f.mode || '100644', type: 'blob', sha: f.sha })
}

const dirShas = new Map()
const dirPaths = Array.from(dirs.keys()).filter((d) => d !== '').sort((a, b) => b.split('/').length - a.split('/').length)
for (const dir of dirPaths) {
  const created = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree: dirs.get(dir) }, [201])
  if (!created.ok) throw new Error('建树失败 ' + dir + ' → ' + created.status + ' ' + created.text.slice(0, 200))
  dirShas.set(dir, created.json.sha)

  const parts = dir.split('/')
  const name = parts.pop()
  const parent = parts.join('/')
  ensure(parent).push({ path: name, mode: '040000', type: 'tree', sha: created.json.sha })
}

const rootTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree: dirs.get('') }, [201])
if (!rootTree.ok) throw new Error('建根树失败：' + rootTree.status + ' ' + rootTree.text.slice(0, 300))
console.log('新根树：' + rootTree.json.sha)

const message = [
  '四人纪念：哥特维多利亚风格的四人青春纪念站',
  '',
  '纯静态、零依赖、可离线运行。包含四人拱廊、共同时间轴、瀑布相册墙、',
  '留言与献花、个人页（肖像 / 专属时间轴 / 私人影音 / 唱片机）。',
  '',
  '- 文字均可在页面上直接编辑，改动存于 localStorage',
  '- 照片、视频、音乐经 IndexedDB 保存在访客本机，不上传服务器',
  '- 背景音为纯 WebAudio 合成的管风琴持续音，无需音频文件',
  '- 字体以 base64 内联，离线双击 index.html 亦完整呈现',
  '- 附无浏览器冒烟测试与 DevTools 协议截图工具',
  '- 附设备码授权与 API 推送脚本（绕开本机凭据助手弹窗）',
  '',
  '示例人物与故事均为虚构演示内容。',
  '许可：代码 MIT，文案与纹样 CC BY 4.0。',
].join('\n')

const now = new Date().toISOString()
const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
  message,
  tree: rootTree.json.sha,
  parents: [],
  author: { name: 'Fliceyuu', email: 'Fliceyuu@users.noreply.github.com', date: now },
  committer: { name: 'Fliceyuu', email: 'Fliceyuu@users.noreply.github.com', date: now },
}, [201])
if (!commit.ok) throw new Error('建提交失败：' + commit.status + ' ' + commit.text.slice(0, 300))
console.log('新提交（无父提交，历史归零）：' + commit.json.sha)

const upd = await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
  sha: commit.json.sha,
  force: true,
}, [200])
if (!upd.ok) throw new Error('更新分支失败：' + upd.status + ' ' + upd.text.slice(0, 300))
console.log('已强制更新 ' + branch + ' ✓')

/* 仓库主页地址统一小写 */
const fixed = await api('PATCH', `/repos/${owner}/${repo}`, {
  homepage: 'https://' + owner.toLowerCase() + '.github.io/' + repo + '/',
}, [200])
console.log(fixed.ok ? '仓库主页地址已规范为 ' + fixed.json.homepage : '主页地址更新失败：' + fixed.status)
