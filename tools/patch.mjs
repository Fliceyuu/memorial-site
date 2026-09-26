/**
 * patch.mjs — 对站点文件做一次性字面替换（改完即弃的小工具）
 * 用法: node tools/patch.mjs <目标文件> <替换清单.json>
 * 替换清单: [{ "find": "...", "replace": "...", "count": 1 }]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [target, listFile] = process.argv.slice(2)
if (!target || !listFile) {
  console.error('用法: node tools/patch.mjs <file> <edits.json>')
  process.exit(2)
}

const edits = JSON.parse(await readFile(resolve(listFile), 'utf8'))
let text = await readFile(resolve(target), 'utf8')

for (const [i, edit] of edits.entries()) {
  const occurrences = text.split(edit.find).length - 1
  const want = edit.count === undefined ? 1 : edit.count
  if (occurrences !== want) {
    console.error(`✗ 第 ${i + 1} 条：期望出现 ${want} 次，实际 ${occurrences} 次`)
    process.exit(1)
  }
  text = text.split(edit.find).join(edit.replace)
  console.log(`✓ 第 ${i + 1} 条已应用（${occurrences} 处）`)
}

await writeFile(resolve(target), text, 'utf8')
console.log(`已写回 ${target}`)
