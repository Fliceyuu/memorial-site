/**
 * github-auth.mjs — GitHub 设备码授权（OAuth Device Flow）
 *
 * 用法:
 *   node tools/github-auth.mjs start    生成设备码并打印（脚本随即结束）
 *   node tools/github-auth.mjs poll     轮询直到你在浏览器里确认，然后取回 token
 *   node tools/github-auth.mjs whoami   用已保存的 token 查一次身份
 *
 * token 保存在仓库内的 .github-token.json（已被 .gitignore 排除），
 * 推送完成后请执行: node tools/github-auth.mjs forget
 */
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATE = resolve(ROOT, '.github-auth.json')
const TOKEN = resolve(ROOT, '.github-token.json')

// GitHub CLI 的公开 client_id：设备流专用，无 client_secret
const CLIENT_ID = '178c6fc778ccc68e1d6a'
const SCOPE = 'repo'
const API = 'https://api.github.com'
const OAUTH = 'https://github.com'

const readJson = async (p) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'))
  } catch (err) {
    return null
  }
}

async function post(path, body) {
  // 设备流的两个端点挂在 github.com 上，不在 api.github.com
  const res = await fetch(OAUTH + path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch (err) {
    /* 非 JSON */
  }
  return { status: res.status, json, text }
}

async function start() {
  const { status, json, text } = await post('/login/device/code', {
    client_id: CLIENT_ID,
    scope: SCOPE,
  })
  if (status !== 200 || !json || !json.device_code) {
    console.error('申请设备码失败：' + status + ' ' + text)
    process.exit(1)
  }
  await writeFile(
    STATE,
    JSON.stringify(
      {
        device_code: json.device_code,
        user_code: json.user_code,
        verification_uri: json.verification_uri,
        interval: json.interval || 5,
        expires_at: Date.now() + (json.expires_in || 900) * 1000,
      },
      null,
      2
    ),
    'utf8'
  )
  console.log('========================================')
  console.log('  一次性验证码:  ' + json.user_code)
  console.log('  请在浏览器打开: ' + json.verification_uri)
  console.log('  有效期: ' + Math.round((json.expires_in || 900) / 60) + ' 分钟')
  console.log('========================================')
  console.log('（授权时只需勾选 repo 权限；确认后我这边会自动继续。）')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function poll() {
  const state = await readJson(STATE)
  if (!state || !state.device_code) {
    console.error('没有待授权的设备码，请先运行: node tools/github-auth.mjs start')
    process.exit(1)
  }
  if (Date.now() > state.expires_at) {
    console.error('设备码已过期，请重新运行 start')
    process.exit(1)
  }
  const deadline = state.expires_at
  const interval = Math.max(5, state.interval) * 1000

  for (;;) {
    await sleep(interval)
    const { json } = await post('/login/oauth/access_token', {
      client_id: CLIENT_ID,
      device_code: state.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
    if (json && json.access_token) {
      const me = await fetch(API + '/user', {
        headers: { Authorization: 'Bearer ' + json.access_token, Accept: 'application/vnd.github+json' },
      })
      const profile = me.ok ? await me.json() : null
      await writeFile(
        TOKEN,
        JSON.stringify(
          {
            token: json.access_token,
            login: profile ? profile.login : '',
            name: profile ? profile.name : '',
            scope: json.scope || SCOPE,
            at: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      )
      await unlink(STATE).catch(() => {})
      console.log('授权成功 ✓')
      console.log('  账号: ' + (profile ? profile.login : '(已取到 token)'))
      console.log('  姓名: ' + (profile ? profile.name || '(未设置)' : ''))
      console.log('  token 已存入 .github-token.json（已加入 .gitignore）')
      return
    }
    const err = json && json.error
    if (err === 'authorization_pending') {
      process.stdout.write('.')
      continue
    }
    if (err === 'slow_down') {
      await sleep(3000)
      continue
    }
    if (err === 'expired_token') {
      console.error('\n设备码已过期，请重新运行 start')
      process.exit(1)
    }
    if (err === 'access_denied') {
      console.error('\n你在浏览器里拒绝了本次授权。')
      process.exit(1)
    }
    if (Date.now() > deadline) {
      console.error('\n等待超时，请重新运行 start')
      process.exit(1)
    }
    console.log('\n继续等待授权…（' + (err || '未知状态') + '）')
  }
}

async function whoami() {
  const saved = await readJson(TOKEN)
  if (!saved || !saved.token) {
    console.error('还没有 token，请先 start + poll')
    process.exit(1)
  }
  const res = await fetch(API + '/user', {
    headers: { Authorization: 'Bearer ' + saved.token, Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) {
    console.error('token 无效：' + res.status)
    process.exit(1)
  }
  const me = await res.json()
  console.log(JSON.stringify({ login: me.login, name: me.name, public_repos: me.public_repos, plan: me.plan && me.plan.name }, null, 2))
}

const cmd = process.argv[2] || 'start'
if (cmd === 'start') await start()
else if (cmd === 'poll') await poll()
else if (cmd === 'whoami') await whoami()
else if (cmd === 'forget') {
  await unlink(TOKEN).catch(() => {})
  await unlink(STATE).catch(() => {})
  console.log('已删除本地保存的 token 与设备码')
} else {
  console.error('未知命令：' + cmd)
  process.exit(2)
}
