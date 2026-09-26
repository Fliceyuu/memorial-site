/**
 * fetch-fonts.mjs — 下载并内联哥特/维多利亚风字体（可选步骤）
 *
 * 用法:  node tools/fetch-fonts.mjs
 * 产物:  assets/css/fonts.css   (woff2 以 base64 内联，离线双击 index.html 也能显示)
 *
 * 若本机无网络，跳过此脚本即可 —— 站点自带完整的衬线字体回退方案，外观仍然成立。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

// 每个字族只取 latin 子集，控制体积
const FAMILIES = [
  { name: 'UnifrakturCook', query: 'UnifrakturCook:wght@700', subsets: ['latin'] },
  { name: 'Cormorant Garamond', query: 'Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400', subsets: ['latin', 'latin-ext'] },
]

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const api = (query) => `https://fonts.googleapis.com/css2?family=${query}&display=swap`

function parseFaces(css) {
  const faces = []
  const blocks = css.split('@font-face').slice(1)
  for (const raw of blocks) {
    const block = raw.slice(0, raw.indexOf('}'))
    const pick = (key) => {
      const m = block.match(new RegExp(`${key}:\\s*([^;]+);`))
      return m ? m[1].trim() : ''
    }
    const subsetMatch = raw.match(/\/\*\s*([a-z-]+)\s*\*\//)
    faces.push({
      family: pick('font-family').replace(/['"]/g, ''),
      style: pick('font-style') || 'normal',
      weight: pick('font-weight') || '400',
      unicodeRange: pick('unicode-range'),
      subset: subsetMatch ? subsetMatch[1] : 'latin',
      url: (block.match(/url\((https:[^)]+\.woff2)\)/) || [])[1],
    })
  }
  return faces
}

async function get(url, as = 'text') {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : res.text()
}

const out = [
  '/* 自动生成 —— node tools/fetch-fonts.mjs',
  ' * Google Fonts 的 woff2 已内联为 base64：整站离线可用，file:// 双击打开亦生效。',
  ' * 该文件缺失也不影响站点运行（theme.css 已声明 System 回退字体栈）。',
  ' */',
  '',
]
let bytes = 0
let count = 0

for (const fam of FAMILIES) {
  const css = await get(api(fam.query))
  const faces = parseFaces(css).filter((f) => f.url && fam.subsets.includes(f.subset))
  if (!faces.length) throw new Error(`no faces matched for ${fam.name}`)
  for (const face of faces) {
    const buf = await get(face.url, 'buffer')
    bytes += buf.length
    count += 1
    out.push('@font-face {')
    out.push(`  font-family: '${face.family}';`)
    out.push(`  font-style: ${face.style};`)
    out.push(`  font-weight: ${face.weight};`)
    out.push('  font-display: swap;')
    out.push(`  src: url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');`)
    if (face.unicodeRange) out.push(`  unicode-range: ${face.unicodeRange};`)
    out.push('}')
    out.push('')
    console.log(`  + ${face.family} ${face.style} ${face.weight} [${face.subset}] ${(buf.length / 1024).toFixed(1)} KB`)
  }
}

await mkdir(resolve(ROOT, 'assets/css'), { recursive: true })
await writeFile(resolve(ROOT, 'assets/css/fonts.css'), out.join('\n'), 'utf8')
console.log(`\nfonts.css 已生成：${count} 个字体文件，原始 ${(bytes / 1024).toFixed(0)} KB`)
