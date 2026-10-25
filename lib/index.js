/**
 * dsh-palette — Host half.
 *
 * 提供兩件事：
 *   1. 頁面載入時把用戶的 alias 覆蓋值寫成 body 的 inline custom property
 *      （同步執行，paint 前完成 ⇒ 無 FOUC；inline 優先於任何 stylesheet ⇒ 不與皮膚衝突）。
 *   2. 兩個本機端點讓設定頁面板讀寫覆蓋值，存成 <DSH_HOME>/palette.json。
 *
 * 只覆蓋 --dsw-alias-*（成品語義色）與 --dsw-static-*（原材料階梯）；
 * 兩者都寫成 inline custom property，因此優先於任何皮膚插件的樣式表。
 *
 * @module dsh-palette
 */
import { readFileSync } from 'node:fs'
import { writeFile, mkdir, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-palette'

/** 覆蓋值只允許安全的 CSS 色彩字面量。 */
const VALUE_RE = /^[#a-zA-Z0-9(),.%/\s-]{1,200}$/
/** 變量名只允許 alias 與 static 兩層。 */
const NAME_RE = /^--dsw-(?:alias|static)-[a-z0-9-]+$/
/** 單次寫入的 body 上限。 */
const MAX_BODY = 128 * 1024

/** 存放覆蓋值的檔案路徑。 */
function storePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'palette.json')
}

/** 讀取已儲存的覆蓋值；任何壞資料都退化成空表，不阻塞啟動。 */
function readStore() {
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf8'))
    return { light: sanitize(raw?.light), dark: sanitize(raw?.dark) }
  } catch {
    return { light: {}, dark: {} }
  }
}

/** 只保留合法的 alias 名與安全值。 */
function sanitize(input) {
  const out = {}
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [key, value] of Object.entries(input)) {
    if (!NAME_RE.test(key)) continue
    if (typeof value !== 'string' || !VALUE_RE.test(value)) continue
    out[key] = value.trim()
  }
  return out
}

/**
 * 產生注入到頁面的 script：先寫入初始值，再暴露即時更新 API。
 * @param {{light: Record<string, string>, dark: Record<string, string>}} store 目前的覆蓋值。
 * @returns {string} 要放入 body 開頭的同步 script 內容。
 */
function bootScript(store) {
  const payload = JSON.stringify(store).replace(/</g, '\\u003c')
  return `(() => {
  const CFG = globalThis.__DSH_PALETTE__ = ${payload}
  const body = document.body
  const isDark = () => body.hasAttribute('data-ds-dark-theme')
  const apply = () => {
    // 清走所有本插件寫過的 inline 變量，而不是只清「目前仍在 store 裡的 key」：
    // 重設刪掉 key 之後舊值仍留在 body.style 上，看起來就像重設沒作用。
    for (let i = body.style.length - 1; i >= 0; i--) {
      const prop = body.style[i]
      if (prop.startsWith('--dsw-alias-') || prop.startsWith('--dsw-static-')) body.style.removeProperty(prop)
    }
    const want = (isDark() ? CFG.dark : CFG.light) || {}
    for (const key of Object.keys(want)) body.style.setProperty(key, want[key])
  }
  globalThis.__dshPalette = {
    get: () => CFG,
    set(next) {
      CFG.light = next.light || {}
      CFG.dark = next.dark || {}
      apply()
    },
    apply,
  }
  apply()
  new MutationObserver(apply).observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
})()`
}

/** 以最小的成本回一個 JSON 回應。 */
function json(res, code, value) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

/** 只有 owner 或 loopback 可以讀寫。 */
function reject(ctx, req, res) {
  const connection = ctx.get('connection')
  const rejection = connection?.requestRejection(req)
  if (rejection !== undefined) { res.statusCode = rejection; res.end(); return true }
  if (connection === undefined
    && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) {
    res.statusCode = 403; res.end(); return true
  }
  return false
}

/** 讀完整個請求 body，超過上限回 undefined。 */
function readBody(req) {
  return new Promise((resolve, rejectPromise) => {
    const chunks = []
    let size = 0
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) { cleanup(); req.resume(); resolve(undefined); return }
      chunks.push(chunk)
    }
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')) }
    const onError = (error) => { cleanup(); rejectPromise(error) }
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
  })
}

/** 原子寫入：先寫暫存檔再改名，避免半寫狀態。 */
async function writeStore(store) {
  const target = storePath()
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(store, null, 2) + '\n', 'utf8')
  await rename(tmp, target)
}

/**
 * @param {object} ctx Cordis host context.
 * @returns {void}
 */
export function apply(ctx) {
  const store = readStore()

  ctx.on('webserver/index-inject', (table) => {
    // body 開頭、ui-theme boot script 之後、shell script 之前：同步執行 ⇒ paint 前已套用。
    table.push({ kind: 'script', placement: 'body', text: bootScript(readStore()) })
  })

  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], (child) => {
    // 預設值（官方 alias 的原始值），讓面板可以「單項重設」與「全部重設」。
    let defaults = { light: {}, dark: {} }
    try {
      const raw = JSON.parse(readFileSync(new URL('../tokens.json', import.meta.url), 'utf8'))
      defaults = {
        light: raw.light ?? {},
        dark: raw.dark ?? {},
        static: { light: raw.static?.light ?? {}, dark: raw.static?.dark ?? {} },
      }
    } catch {
      // tokens.json 缺失時面板仍可運作，只是沒有重設基準。
    }

    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: '/dsh-palette/config',
      handler: async (req, res) => {
        if (reject(ctx, req, res)) return
        if (req.method !== 'GET') { res.setHeader('allow', 'GET'); json(res, 405, { error: 'method' }); return }
        json(res, 200, { store: readStore(), defaults })
      },
    }))

    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: '/dsh-palette/save',
      handler: async (req, res) => {
        if (reject(ctx, req, res)) return
        if (req.method !== 'POST') { res.setHeader('allow', 'POST'); json(res, 405, { error: 'method' }); return }
        if (req.headers['x-dsh-palette'] !== '1') { json(res, 403, { error: 'forbidden' }); return }
        let raw
        try { raw = await readBody(req) } catch { json(res, 500, { error: 'read' }); return }
        if (raw === undefined) { json(res, 413, { error: 'too-large' }); return }
        let parsed
        try { parsed = JSON.parse(raw) } catch { json(res, 400, { error: 'invalid-json' }); return }
        const next = { light: sanitize(parsed?.light), dark: sanitize(parsed?.dark) }
        try { await writeStore(next) } catch { json(res, 500, { error: 'write' }); return }
        json(res, 200, { ok: true, store: next })
      },
    }))
  })
}
