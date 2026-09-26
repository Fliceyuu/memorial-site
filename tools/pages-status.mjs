/**
 * pages-status.mjs — 查 GitHub Pages 的构建状态，必要时触发重建，并轮询直到 assets 可访问
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.github.com'
const [owner, repo] = ['Fliceyuu', 'memorial-site']
const B = `https://${owner.toLowerCase()}.github.io/${repo}/`

const token = JSON.parse(await readFile(join(ROOT, '.github-token.json'), 'utf8')).token
const H = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'memorial-site-publish',
  'Content-Type': 'application/json',
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ref = await (await fetch(`${API}/repos/${owner}/${repo}/git/ref/heads/main`, { headers: H })).json()
const head = ref.object.sha
console.log('main HEAD = ' + head.slice(0, 8))

const pages = await (await fetch(`${API}/repos/${owner}/${repo}/pages`, { headers: H })).json()
console.log('Pages = ' + JSON.stringify({ status: pages.status, url: pages.html_url, source: pages.source, build_type: pages.build_type }))

const builds = await (await fetch(`${API}/repos/${owner}/${repo}/pages/builds?per_page=5`, { headers: H })).json()
console.log('\n最近构建：')
for (const b of builds) {
  console.log('  ' + String(b.status).padEnd(10) + String(b.commit || '').slice(0, 8) + '  ' + b.created_at + '  ' + (b.error ? JSON.stringify(b.error).slice(0, 120) : ''))
}
const latest = builds[0]
if (latest && latest.commit && latest.commit !== head) {
  console.log('\n最新构建的提交 ' + latest.commit.slice(0, 8) + ' 落后于 HEAD ' + head.slice(0, 8) + '，触发重建…')
  const r = await fetch(`${API}/repos/${owner}/${repo}/pages/builds`, { method: 'POST', headers: H })
  console.log('触发结果：' + r.status)
} else if (latest) {
  console.log('\n最新构建已对应 HEAD。')
}

console.log('\n轮询线上 assets…')
for (let i = 0; i < 30; i += 1) {
  const css = await fetch(B + 'assets/css/theme.css?cb=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } })
  const js = await fetch(B + 'assets/js/app.js?cb=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } })
  const ok = css.status === 200 && js.status === 200
  console.log('  第' + String(i + 1).padStart(2) + '次：theme.css=' + css.status + '  app.js=' + js.status + (ok ? '   ✓ 已可用' : ''))
  if (ok) break
  await sleep(15000)
}
