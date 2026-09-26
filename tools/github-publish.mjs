/**
 * github-publish.mjs — 用已授权的 token 创建公开仓库、配置 topics、开启 GitHub Pages
 *
 * 用法: node tools/github-publish.mjs [仓库名]
 * 前置: node tools/github-auth.mjs start / poll
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN_FILE = resolve(ROOT, '.github-token.json')
const API = 'https://api.github.com'

const repoName = (process.argv[2] || 'memorial-site').trim()
const description = '哥特维多利亚风格的四人青春纪念站：时间轴、相册墙、留言献花与私人唱片。纯静态、零依赖、可离线运行。'

const saved = JSON.parse(await readFile(TOKEN_FILE, 'utf8'))
const token = saved.token
if (!token) throw new Error('token 为空，请先完成授权')

const login = saved.login || (await whoami())

async function whoami() {
  const r = await fetch(API + '/user', { headers: headers() })
  if (!r.ok) throw new Error('token 无效：' + r.status)
  const me = await r.json()
  return me.login
}

function headers(extra) {
  return Object.assign(
    {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'memorial-site-publish',
      'Content-Type': 'application/json',
    },
    extra || {}
  )
}

async function call(method, path, body, okStatuses) {
  const res = await fetch(API + path, {
    method,
    headers: headers(),
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

console.log('账号：' + login)

/* 1. 建仓库（已存在则直接使用） */
let repoRes = await call('POST', '/user/repos', {
  name: repoName,
  description,
  homepage: 'https://' + login + '.github.io/' + repoName + '/',
  private: false,
  has_issues: true,
  has_wiki: false,
  has_projects: false,
  auto_init: false,
})

if (repoRes.status === 422 && JSON.stringify(repoRes.json).includes('already exists')) {
  console.log('仓库已存在，直接使用：' + repoName)
  repoRes = await call('GET', '/repos/' + login + '/' + repoName)
}

if (!repoRes.ok) {
  console.error('创建仓库失败：' + repoRes.status + '\n' + repoRes.text)
  process.exit(1)
}
const fullName = repoRes.json.full_name
console.log('仓库就绪：' + fullName + '  (' + repoRes.json.html_url + ')')

/* 2. topics，便于被发现 */
const topics = ['memorial', 'tribute', 'gothic', 'victorian', 'vanilla-js', 'static-site', 'github-pages', 'no-dependencies', 'indexeddb', 'chinese']
const tp = await call('PUT', '/repos/' + fullName + '/topics', { names: topics }, [200])
console.log(tp.ok ? '已设置 topics：' + topics.join(', ') : 'topics 设置失败（不影响使用）：' + tp.status)

/* 3. 开启 GitHub Pages（main 分支根目录） */
let pages = await call('POST', '/repos/' + fullName + '/pages', {
  source: { branch: 'main', path: '/' },
}, [201, 200, 409])

if (pages.status === 409) {
  pages = await call('PUT', '/repos/' + fullName + '/pages', {
    source: { branch: 'main', path: '/' },
  }, [200, 204])
}

if (pages.ok || pages.status === 409) {
  console.log('GitHub Pages 已启用（main / 根目录）')
} else {
  console.log('Pages 启用返回 ' + pages.status + '：' + pages.text.slice(0, 220))
  console.log('（若失败，可在仓库 Settings → Pages 手动选择 main / (root)）')
}

console.log('\n线上地址（首次部署约需 1–2 分钟）：')
console.log('  https://' + login + '.github.io/' + repoName + '/')
