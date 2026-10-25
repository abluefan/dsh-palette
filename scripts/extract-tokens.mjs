// 從 DSH 官方 design-platform.css 抽出全部 --dsw-alias-* 的淺色/深色預設值。
// 只抽 alias 層（成品語義色），不抽 static 原材料階梯。
//
// 逐行解析：每個宣告獨立一行，block 邊界是行首的 `selector {` 與 `}`。
// 這比一次性正則可靠 —— 值裡含 color-mix(...)、var(...) 的括號不會干擾。
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'design-platform.css'   // 换成你本机 DSH 源码里的 design-platform.css 路径
const OUT = 'tokens.json'          // 相对当前工作目录

const css = readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const blocks = new Map()
let selector = null
let skipped = 0
for (const raw of css.split('\n')) {
  const line = raw.trim()
  if (line === '') continue
  if (line === '}') { selector = null; continue }
  if (line.endsWith('{')) { selector = line.slice(0, -1).trim(); continue }
  if (selector === null) continue
  const decls = [...line.matchAll(/(--dsw-(?:alias|static)-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  if (decls.length === 0) { if (line.includes('--dsw-alias-')) skipped++; continue }
  const values = blocks.get(selector) ?? {}
  for (const d of decls) values[d[1]] = d[2].trim()
  blocks.set(selector, values)
}

const pick = (block, prefix) => Object.fromEntries(
  Object.entries(block).filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)),
)

const lightBlock = blocks.get('body') ?? {}
const darkBlock = blocks.get('body[data-ds-dark-theme]') ?? {}

const light = pick(lightBlock, '--dsw-alias-')
const dark = { ...light, ...pick(darkBlock, '--dsw-alias-') }

const extraDark = Object.keys(darkBlock).filter((n) => n.startsWith('--dsw-alias-') && !(n in lightBlock)).sort()
if (extraDark.length) {
  console.log('深色獨有的鍵（補進兩邊）:', extraDark.join(', '))
  for (const name of extraDark) light[name] = darkBlock[name]
}

// static 原材料階梯：給面板解析「var(--dsw-static-*)」用。
const staticLight = pick(lightBlock, '--dsw-static-')
const staticDark = { ...staticLight, ...pick(darkBlock, '--dsw-static-') }

writeFileSync(OUT, JSON.stringify({
  generatedFrom: 'packages/client/ui-theme/src/styles/design-platform.css',
  count: Object.keys(light).length,
  light,
  dark,
  static: { light: staticLight, dark: staticDark },
}, null, 2) + '\n', 'utf8')

console.log(`寫入 ${OUT}`)
console.log(`淺色 ${Object.keys(light).length} 個 / 深色 ${Object.keys(dark).length} 個`)
console.log(`深色缺漏補回 ${Object.keys(lightBlock).filter((n) => !(n in darkBlock)).length} 個`)
if (skipped) console.log(`⚠ 有 ${skipped} 行含 alias 但解析不到，需檢查`)

const kinds = {}
for (const v of Object.values(light)) {
  const kind = v.startsWith('var(') ? 'var' : v.startsWith('color-mix') ? 'color-mix' : 'literal'
  kinds[kind] = (kinds[kind] ?? 0) + 1
}
console.log('淺色值類型分佈:', kinds)
