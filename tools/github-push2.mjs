/**
 * github-push2.mjs — 通过 GitHub Contents API 推送整个站点
 *
 * 空仓库无法使用 Git Data API 建 blob（返回 409 Git Repository is empty），
 * 而 Contents API 在空仓库上可用（首次 PUT 即建立初始提交）。
 * 之后 git 仓库非空，Git Data API 与 Pages 都随之可用。
 *
 * 用法: node tools/github-push2.mjs [owner/repo] [branch] [并发数]
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.github.com'

const ownerRepo = process.argv[2] || 'Fliceyuu/memorial-site'
const branch = process.argv[3] || 'main'
const CONCURRENCY = Math.max(1, Math.min(8, parseInt(process.argv[4] || '4', 10)))
const [owner, repo] = ownerRepo.split('/')

const saved = JSON.parse(await readFile(join(ROOT, '.github-token.json'), 'utf8'))
const token = saved.token
if (!token) throw new Error('token 为空')

const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'memorial-site-publish',
  'Content-Type': 'application/json',
}

const MESSAGE = [
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

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'preview'])
const IGNORE_FILES = new Set(['.github-token.json', '.github-auth.json', '.git-askpass.sh', '.probe'])

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

/** 读取远端已存在文件的 blob sha（更新时需要） */
async function existingSha(path) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${branch}`, { headers })
  if (res.status !== 200) return null
  const json = await res.json()
  return json && json.sha ? json.sha : null
}

async function putFile(f, sha) {
  const buf = await readFile(f.full)
  const body = {
    message: MESSAGE,
    content: buf.toString('base64'),
    branch,
  }
  if (sha) body.sha = sha
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodeURI(f.path)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(f.path + ' → ' + res.status + ' ' + text.slice(0, 200))
  }
  return text.length
}

const files = (await walk(ROOT, '')).sort((a, b) => (a.path < b.path ? -1 : 1))
console.log(`推送 ${files.length} 个文件到 ${owner}/${repo}@${branch}（并发 ${CONCURRENCY}），合计 ${(files.reduce((a, b) => a + b.size, 0) / 1024).toFixed(0)} KB`)

let done = 0
let failed = 0
const queue = files.slice()

async function worker(id) {
  for (;;) {
    const f = queue.shift()
    if (!f) return
    try {
      let sha = await existingSha(f.path)
      await putFile(f, sha)
      done += 1
      if (done % 4 === 0 || done === files.length) {
        console.log(`  已推送 ${done}/${files.length}  … 最近: ${f.path}`)
      }
    } catch (err) {
      // 并发下可能出现 409（同分支同时提交）——重试一次
      let retried = false
      for (let i = 0; i < 4 && !retried; i += 1) {
        await new Promise((r) => setTimeout(r, 900 * (i + 1)))
        try {
          const sha = await existingSha(f.path)
          await putFile(f, sha)
          done += 1
          retried = true
          console.log(`  重试成功: ${f.path} (${done}/${files.length})`)
        } catch (err2) {
          if (i === 3) {
            failed += 1
            console.error('  ✗ 失败: ' + f.path + ' → ' + err2.message)
          }
        }
      }
    }
  }
}

await Promise.all(new Array(CONCURRENCY).fill(0).map((_, i) => worker(i)))

console.log(`\n完成：成功 ${done} 个，失败 ${failed} 个`)

/* 空仓库被首次提交填充后，Git Data API 与 Pages 才可用 */
const pages = await fetch(`${API}/repos/${owner}/${repo}/pages`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ source: { branch, path: '/' } }),
})
const pt = await pages.text()
if (pages.ok) console.log('GitHub Pages 已启用（' + branch + ' / 根目录）')
else if (pages.status === 409) console.log('GitHub Pages 已存在，无需重复启用')
else console.log('Pages 启用返回 ' + pages.status + '：' + pt.slice(0, 240))

console.log('\n线上地址：https://' + owner.toLowerCase() + '.github.io/' + repo + '/')
process.exit(failed ? 1 : 0)
