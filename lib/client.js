// dsh-palette client half
//
// 設定側欄「調色盤」：逐個覆蓋 DSH 的顏色變量。
//   · 語義色（--dsw-alias-*）：成品語義位，改一個只影響該語義。
//   · 原材料（--dsw-static-*）：色階樓梯，改一級會連鎖影響所有派生位。
//
// 數據通路：
//   讀 GET /dsh-palette/config → { store, defaults }
//   寫 POST /dsh-palette/save  → <DSH_HOME>/palette.json
//   即時生效 globalThis.__dshPalette.set(...)，由 Host 注入的 script 寫成
//   body 的 inline custom property —— inline 優先於任何樣式表，
//   所以不論同時掛了哪個皮膚插件都不會被打敗。
//
// 顯示值一律以瀏覽器實際計算結果為準（見 measure），
// 因此皮膚插件在 static 層做的改動也會正確反映出來。
window.__ModuleLoader__.load({
  id: 'dsh-palette',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement
    const NS = 'dshPalette'

    const ALIAS_PREFIX = '--dsw-alias-'
    const STATIC_PREFIX = '--dsw-static-'

    const zh = {
      panelName: '調色盤',
      panelHint: '逐個色位覆蓋 DSH 的顏色。改完即時生效，不需重啟。',
      light: '淺色', dark: '深色',
      resetAll: '全部重設', exportJson: '匯出 JSON', importJson: '匯入',
      overridden: '{n} 個已覆蓋',
      system: '跟隨主題', override: '已覆蓋',
      loadFailed: '讀取設定失敗', saveFailed: '儲存失敗', saved: '已儲存',
      importHint: '貼上之前匯出的 JSON，然後按「匯入」。', apply: '套用',
      invalidJson: 'JSON 格式不正確', resetOne: '重設',
      aliasTitle: '語義色（alias）',
      aliasHint: '改一個只影響該語義位。這是最常用的層。',
      staticTitle: '原材料（static）',
      staticHint: '⚠ 色階樓梯：改一級會連鎖影響所有由它派生的語義色。想在這裡改品牌橙，就先改 deepseek 那一組。',
      affects: '影響 {n} 個位',
      noEffect: '未被引用',
      backdropLabel: '設定頁遮罩',
      backdropHint: '關閉後，設定頁與對話框背後那層半透明遮罩會變透明（預設關閉）。',
    }
    const en = {
      panelName: 'Palette',
      panelHint: 'Override DSH colours one token at a time. Changes apply immediately.',
      light: 'Light', dark: 'Dark',
      resetAll: 'Reset all', exportJson: 'Export JSON', importJson: 'Import',
      overridden: '{n} overridden',
      system: 'Follows theme', override: 'Overridden',
      loadFailed: 'Failed to load settings', saveFailed: 'Save failed', saved: 'Saved',
      importHint: 'Paste previously exported JSON, then press Import.', apply: 'Apply',
      invalidJson: 'Invalid JSON', resetOne: 'Reset',
      aliasTitle: 'Semantic colours (alias)',
      aliasHint: 'Changing one affects only that semantic slot. This is the usual layer.',
      staticTitle: 'Raw palette (static)',
      staticHint: '⚠ Colour steps: changing one cascades into every semantic colour derived from it.',
      affects: 'affects {n} slots',
      noEffect: 'unreferenced',
      backdropLabel: 'Modal backdrop',
      backdropHint: 'When off, the translucent mask behind settings and dialogs becomes transparent (off by default).',
    }

    /** 語義色分組；第一個 match 命中即採用，最後一組兜底。 */
    const ALIAS_GROUPS = [
      { id: 'bg', zh: '背景', en: 'Background', test: (n) => n.startsWith(`${ALIAS_PREFIX}bg-`) },
      { id: 'label', zh: '文字', en: 'Text', test: (n) => n.startsWith(`${ALIAS_PREFIX}label-`) },
      { id: 'border', zh: '邊框', en: 'Borders', test: (n) => n.startsWith(`${ALIAS_PREFIX}border-`) },
      { id: 'brand', zh: '品牌 / 連結', en: 'Brand & links', test: (n) => n.startsWith(`${ALIAS_PREFIX}brand-`) || n === `${ALIAS_PREFIX}link` },
      { id: 'button', zh: '按鈕', en: 'Buttons', test: (n) => n.startsWith(`${ALIAS_PREFIX}button-`) },
      { id: 'interactive', zh: '互動狀態', en: 'Interactive', test: (n) => n.startsWith(`${ALIAS_PREFIX}interactive-`) },
      { id: 'state', zh: '狀態色', en: 'States', test: (n) => n.startsWith(`${ALIAS_PREFIX}state-`) },
      { id: 'code', zh: '程式碼 / 差異 / Markdown', en: 'Code, diff & Markdown', test: (n) => n.startsWith(`${ALIAS_PREFIX}code-`) || n.startsWith(`${ALIAS_PREFIX}file-diff-`) || n.startsWith(`${ALIAS_PREFIX}markdown-`) },
      { id: 'chrome', zh: '選單 / 滾動條 / 提示', en: 'Menus, scrollbars & tooltips', test: () => true },
    ]

    /** 常用語義色的中文名；其餘顯示去掉前綴的原名。 */
    const LABELS = {
      'bg-base': '主背景', 'bg-layer-1': '面板層 1', 'bg-layer-2': '面板層 2', 'bg-layer-3': '面板層 3',
      'bg-overlay': '浮層背景', 'bg-module-platform': '平台模組', 'bg-multi-select': '多選背景',
      'bg-skeleton': '骨架屏', 'bg-document-preview': '文件預覽', 'bg-document-selection': '選取高亮',
      'bg-mask-1': '遮罩 1', 'bg-mask-2': '遮罩 2', 'bg-mask-3': '遮罩 3', 'bg-mask-drop': '拖放遮罩', 'bg-mask-photo': '圖片遮罩',
      'label-primary': '主文字', 'label-secondary': '次文字', 'label-tertiary': '三級文字',
      'label-caption': '註解文字', 'label-dimmed': '淡化文字', 'label-primary-bluish': '藍調主文字',
      'label-primary-dimmed': '淡化主文字', 'label-primary-foreground': '主文字前景', 'label-primary-inverted': '反色文字',
      'label-deep-diving': '思考中標籤', 'label-deep-diving-shimmer': '思考中閃光', 'label-shimmer': '閃光文字',
      'border-l1': '邊框 L1', 'border-l2': '邊框 L2', 'border-l3': '邊框 L3', 'border-l4': '邊框 L4',
      'border-l2-darkmode-thin': '深色細邊框', 'border-inverted': '反色邊框', 'border-inverted2': '反色邊框 2',
      'brand-primary': '品牌主色', 'brand-primary-invert': '品牌反色', 'brand-text': '品牌文字', link: '連結',
      'button-primary-fill': '主按鈕填色', 'button-primary-hover': '主按鈕懸停', 'button-primary-dimmed': '主按鈕淡化',
      'button-info-fill': '資訊按鈕', 'button-info-hover': '資訊按鈕懸停', 'button-contrast-fill': '對比按鈕',
      'button-elevated-fill': '浮起按鈕', 'button-floating-fill': '浮動按鈕', 'button-floating-hover': '浮動按鈕懸停',
      'button-ghost-active-fill': '幽靈按鈕啟用', 'button-ghost-active-hover': '幽靈按鈕懸停',
      'button-ghost-active-border': '幽靈按鈕邊框', 'button-tool-bar-fill': '工具列', 'button-tool-bar-hover': '工具列懸停',
      'interactive-bg-hover': '懸停背景', 'interactive-bg-active': '啟用背景', 'interactive-bg-hover-accent': '強調懸停',
      'interactive-bg-hover-danger': '危險懸停', 'interactive-bg-hover-solid': '實色懸停',
      'state-error-primary': '錯誤主色', 'state-error-secondary': '錯誤次色',
      'state-warn-primary': '警告主色', 'state-warn-secondary': '警告次色', 'state-warn-tertiary': '警告三色', 'state-warn-label': '警告文字',
      'state-success-primary': '成功主色', 'state-success-secondary': '成功次色', 'state-success-tertiary': '成功三色',
      'state-business-primary': '商務主色（品牌）', 'state-business-tertiary': '商務三色（品牌）', 'state-idle-primary': '閒置主色',
      'code-diff-added': '新增程式碼', 'code-diff-deleted': '刪除程式碼',
      'file-diff-added-bg': '新增檔背景', 'file-diff-added-gutter': '新增檔邊欄', 'file-diff-added-marker': '新增檔標記',
      'file-diff-deleted-bg': '刪除檔背景', 'file-diff-deleted-gutter': '刪除檔邊欄', 'file-diff-deleted-marker': '刪除檔標記',
      'markdown-code-block': '程式碼塊', 'markdown-code-block-banner': '程式碼塊標題',
      'markdown-inline-code': '行內程式碼', 'markdown-placeholder': '佔位符', 'markdown-tag': '標籤', 'markdown-citation': '引用',
      'menu-group-header-fill': '選單組標題', 'menu-icon': '選單圖示',
      'scrollbar-bg-l1': '滾動條底 1', 'scrollbar-bg-l2': '滾動條底 2',
      'scrollbar-hover-l1': '滾動條懸停 1', 'scrollbar-hover-l2': '滾動條懸停 2',
      'toast-bg': '提示框底', 'toast-label': '提示框文字', 'tooltip-bg': '工具提示底',
      'tooltip-key-bg': '工具提示鍵底', 'turn-trigger-bg': '回合按鈕底', 'turn-trigger-bg-hover': '回合按鈕懸停',
      'switch-thumb': '開關滑塊',
    }

    /** 原材料色系標籤。 */
    const STATIC_FAMILIES = {
      'neutral-bluish': '中性灰（背景 / 文字 / 邊框主來源）',
      neutral: '中性',
      deepseek: '品牌色（連結 / 資訊按鈕 / 商務）',
      blue: '藍',
      red: '紅（錯誤）',
      green: '綠（成功）',
      amber: '琥珀（警告）',
    }

    /** 把任意 CSS 色彩字面量收成 input[type=color] 能吃的 #rrggbb。 */
    function normalizeHex(value) {
      if (typeof value !== 'string') return null
      const s = value.trim().toLowerCase()
      if (s === '' || s === 'transparent' || s === 'none' || s.includes('transparent')) return null
      const hex = /^#([0-9a-f]{3,8})$/.exec(s)
      if (hex) {
        let digits = hex[1]
        if (digits.length === 3 || digits.length === 4) digits = digits.slice(0, 3).split('').map((c) => c + c).join('')
        return `#${digits.slice(0, 6)}`
      }
      const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s)
      if (rgb) return `#${[1, 2, 3].map((i) => Math.round(Number(rgb[i])).toString(16).padStart(2, '0')).join('')}`
      return null
    }

    /**
     * 由瀏覽器算出每個變量在指定 scheme 下的實際顏色。
     *
     * 先讀 computed custom property（var() 已被替換），
     * 遇到 color-mix 之類沒有被替換的值，再用一個隱藏探針真正算一次。
     * Scheme 切換在同一個同步 task 內完成，瀏覽器不會畫出中間狀態。
     */
    function measure(names, side, store) {
      const body = document.body
      const saved = body.hasAttribute('data-ds-dark-theme')
      const wantDark = side === 'dark'
      if (saved !== wantDark) body.toggleAttribute('data-ds-dark-theme', wantDark)
      const out = {}
      let probe = null
      for (const name of names) {
        const computed = getComputedStyle(body).getPropertyValue(name).trim()
        let hex = normalizeHex(computed)
        if (hex === null && computed !== '' && !computed.includes('transparent')) {
          if (probe === null) {
            probe = document.createElement('span')
            probe.setAttribute('aria-hidden', 'true')
            probe.style.cssText = 'display:block;position:absolute;width:0;height:0;visibility:hidden;pointer-events:none'
            body.append(probe)
          }
          probe.style.color = ''
          probe.style.color = `var(${name})`
          hex = normalizeHex(getComputedStyle(probe).color)
        }
        out[name] = hex
      }
      probe?.remove()
      if (saved !== wantDark) body.toggleAttribute('data-ds-dark-theme', saved)
      applyNow(store)
      return out
    }

    /** 由全域 API 即時寫入 inline；API 缺失時自己寫 body.style。 */
    function applyNow(store) {
      const body = document.body
      // 先清走本插件寫過的所有 inline 變量。只清「目前仍在 store 裡的 key」
      // 會留下殘影：重設刪掉 key 之後舊值仍在 body.style 上，看起來像重設無效。
      for (let i = body.style.length - 1; i >= 0; i--) {
        const prop = body.style[i]
        if (prop.startsWith(ALIAS_PREFIX) || prop.startsWith(STATIC_PREFIX)) body.style.removeProperty(prop)
      }
      const api = globalThis.__dshPalette
      if (api && typeof api.set === 'function') { api.set(store); return }
      const side = body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
      for (const [key, value] of Object.entries(store?.[side] ?? {})) body.style.setProperty(key, value)
    }

    /** 原材料分組：--dsw-static-<family>-<step>。 */
    function staticFamily(name) {
      const m = /^--dsw-static-(.+?)-\d/.exec(name)
      return m ? m[1] : 'other'
    }

    const CSS = [
      '.dshp-wrap{display:flex;flex-direction:column;gap:12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dshp-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-warn{margin:0 0 8px;padding:8px 10px;border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dshp-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px}',
      '.dshp-tabs{display:inline-flex;gap:4px;padding:2px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}',
      '.dshp-tab{height:26px;padding:0 12px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshp-tab[data-on]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.12)}',
      '.dshp-btn{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshp-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshp-btn:disabled{opacity:.35;cursor:default}',
      '.dshp-count{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}',
      '.dshp-check>input{width:13px;height:13px;accent-color:var(--dsw-static-deepseek-500);cursor:pointer}',
      // 關閉遮罩：設定頁／對話框背後那層 mask 變透明、去掉背景模糊。
      'body[data-dshp-backdrop="off"]{--dsw-alias-bg-mask-1:transparent;--dsw-alias-bg-mask-2:transparent;--dsw-alias-bg-mask-3:transparent;--dsw-alias-bg-mask-drop:transparent;--dsw-mask-blur:none}',
      '.dshp-sec{margin:10px 0 2px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-group{border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshp-head{display:flex;align-items:center;gap:8px;width:100%;padding:9px 0;border:0;background:transparent;font:inherit;font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}',
      '.dshp-caret{width:10px;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-tag{margin-left:auto;font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-row{display:flex;align-items:center;gap:9px;padding:3px 0 3px 18px}',
      '.dshp-swatch{width:22px;height:22px;flex:none;border-radius:5px;border:1px solid var(--dsw-alias-border-l2)}',
      '.dshp-swatch[data-none]{background:repeating-conic-gradient(var(--dsw-alias-border-l2) 0 25%,transparent 0 50%) 0 0/8px 8px}',
      '.dshp-name{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshp-name>em{font-style:normal;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-left:6px}',
      '.dshp-name>small{display:block;font-size:10px;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-hex{width:92px;height:24px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:transparent;font-family:var(--dsw-font-family-monospace,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-primary)}',
      '.dshp-color{width:24px;height:24px;padding:0;border:0;background:none;cursor:pointer}',
      '.dshp-color::-webkit-color-swatch-wrapper{padding:0}',
      '.dshp-color::-webkit-color-swatch{border:1px solid var(--dsw-alias-border-l2);border-radius:5px}',
      '.dshp-dot{width:5px;height:5px;flex:none;border-radius:50%;background:var(--dsw-static-deepseek-500)}',
      '.dshp-dot[data-hidden]{visibility:hidden}',
      '.dshp-io{width:100%;min-height:88px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;font-family:var(--dsw-font-family-monospace,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-primary);resize:vertical}',
      '.dshp-status{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-status[data-err]{color:var(--dsw-alias-state-error-primary)}',
    ].join('\n')

    /** 面板自身的檢視狀態（淺/深 tab、各組摺疊）存在瀏覽器，刷新後保留。 */
    const UI_KEY = 'dsh-palette:ui'

    /** 讀回上次的面板檢視狀態；壞資料一律當沒有記錄。 */
    function readUi() {
      try {
        const raw = JSON.parse(localStorage.getItem(UI_KEY) ?? 'null')
        return raw !== null && typeof raw === 'object' ? raw : null
      } catch {
        return null
      }
    }

    function Panel() {
      const [side, setSide] = React.useState(() => (readUi()?.side === 'dark' ? 'dark' : 'light'))
      const [open, setOpen] = React.useState(() => {
        const saved = readUi()?.open
        return saved !== null && typeof saved === 'object' ? saved : { 'a:bg': true }
      })
      // 設定頁／對話框背後的遮罩；預設關閉。
      const [backdrop, setBackdrop] = React.useState(() => readUi()?.backdrop === true)
      const [store, setStore] = React.useState({ light: {}, dark: {} })
      const [defaults, setDefaults] = React.useState({ light: {}, dark: {}, static: { light: {}, dark: {} } })
      const [measured, setMeasured] = React.useState({})
      const [phase, setPhase] = React.useState('loading')
      const [note, setNote] = React.useState('')
      const [noteErr, setNoteErr] = React.useState(false)
      const [io, setIo] = React.useState('')
      const [showIo, setShowIo] = React.useState(false)
      const saveTimer = React.useRef(0)
      const previewTimer = React.useRef(0)
      const pendingRef = React.useRef(null)
      const storeRef = React.useRef(store)
      storeRef.current = store

      React.useEffect(() => {
        fetch('/dsh-palette/config', { headers: { accept: 'application/json' } })
          .then((r) => r.json())
          .then((data) => {
            const next = { light: data.store?.light ?? {}, dark: data.store?.dark ?? {} }
            setStore(next)
            setDefaults(data.defaults ?? { light: {}, dark: {}, static: { light: {}, dark: {} } })
            setPhase('ready')
            applyNow(next)
          })
          .catch(() => { setPhase('error'); setNoteErr(true); setNote(zh.loadFailed) })
      }, [])

      React.useEffect(() => () => {
        clearTimeout(saveTimer.current)
        clearTimeout(previewTimer.current)
      }, [])

      // 記住面板檢視狀態，刷新後唔會縮返去預設。
      React.useEffect(() => {
        try {
          localStorage.setItem(UI_KEY, JSON.stringify({ side, open, backdrop }))
        } catch {
          // 私密模式等情況寫不入 storage：只是失去記憶，不影響調色。
        }
      }, [side, open, backdrop])

      // 遮罩開關：寫在 body 的 data 屬性上，由 CSS 規則把遮罩變透明。
      React.useEffect(() => {
        document.body.dataset.dshpBackdrop = backdrop ? 'on' : 'off'
      }, [backdrop])

      const aliasNames = React.useMemo(() => Object.keys(defaults.light ?? {}).sort(), [defaults])
      const staticNames = React.useMemo(() => Object.keys(defaults.static?.light ?? {}).sort(), [defaults])
      const allNames = React.useMemo(() => [...aliasNames, ...staticNames], [aliasNames, staticNames])

      /** 每個 static 被哪些 alias 直接引用 —— 用來顯示影響範圍。 */
      const staticRefs = React.useMemo(() => {
        const map = {}
        for (const [alias, value] of Object.entries(defaults.light ?? {})) {
          for (const m of String(value).matchAll(/var\((--dsw-static-[a-z0-9-]+)\)/g)) {
            const list = map[m[1]] ?? (map[m[1]] = [])
            list.push(alias.slice(ALIAS_PREFIX.length))
          }
        }
        return map
      }, [defaults])

      // 當前 scheme 未量度過就量一次（切 tab 才量，不在每次 render 做）。
      React.useEffect(() => {
        if (phase !== 'ready' || measured[side] !== undefined) return
        const values = measure(allNames, side, storeRef.current)
        setMeasured((prev) => ({ ...prev, [side]: values }))
      }, [phase, side, allNames, measured])

      const rows = []

      const aliasGroups = React.useMemo(() => {
        const buckets = new Map(ALIAS_GROUPS.map((g) => [g.id, []]))
        for (const name of aliasNames) buckets.get(ALIAS_GROUPS.find((g) => g.test(name)).id).push(name)
        return ALIAS_GROUPS.map((g) => ({ ...g, key: `a:${g.id}`, names: buckets.get(g.id) })).filter((g) => g.names.length > 0)
      }, [aliasNames])

      const staticGroups = React.useMemo(() => {
        const buckets = new Map()
        for (const name of staticNames) {
          const family = staticFamily(name)
          if (!buckets.has(family)) buckets.set(family, [])
          buckets.get(family).push(name)
        }
        return [...buckets.entries()].map(([family, names]) => ({
          id: family, key: `s:${family}`, zh: STATIC_FAMILIES[family] ?? family, en: family, names,
        }))
      }, [staticNames])

      const overriddenCount = Object.keys(store[side] ?? {}).length

      /** 一個 token 改動時真正需要重新量度的名單。 */
      function affected(name) {
        if (!name.startsWith(STATIC_PREFIX)) return [name]
        const refs = (staticRefs[name] ?? []).map((alias) => ALIAS_PREFIX + alias)
        return [name, ...refs]
      }

      function scheduleSave(next) {
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          fetch('/dsh-palette/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dsh-palette': '1' },
            body: JSON.stringify(next),
          })
            .then((r) => r.json())
            .then((res) => {
              if (!res?.ok) throw new Error('save')
              setNoteErr(false); setNote(zh.saved)
            })
            .catch(() => { setNoteErr(true); setNote(zh.saveFailed) })
        }, 400)
      }

      /**
       * 結算一次改動：更新 state、重算受影響色位、排程儲存。
       * 只在拖動停手之後呼叫，避免每一格像素都炸一次。
       * @param {{light: object, dark: object}} next 新的覆蓋表。
       * @param {string | undefined} changed 剛改動的變量名；未提供則重算全部。
       */
      function commit(next, changed) {
        setStore(next)
        applyNow(next)
        const names = changed ? affected(changed) : allNames
        const values = measure(names, side, next)
        setMeasured((prev) => ({ ...prev, [side]: { ...(prev[side] ?? {}), ...values } }))
        scheduleSave(next)
      }

      function setToken(name, value) {
        // 即時預覽只寫這一個變量 —— 拖動調色盤時每一格都走這條快路徑。
        const body = document.body
        if (value) body.style.setProperty(name, value)
        else body.style.removeProperty(name)
        const sideMap = { ...(store[side] ?? {}) }
        if (!value) delete sideMap[name]
        else sideMap[name] = value
        pendingRef.current = { next: { ...store, [side]: sideMap }, changed: name }
        // 停手 150ms 後才結算：更新 state、重算、儲存。
        clearTimeout(previewTimer.current)
        previewTimer.current = setTimeout(() => {
          const pending = pendingRef.current
          pendingRef.current = null
          if (pending) commit(pending.next, pending.changed)
        }, 150)
      }

      function resetAll() {
        commit({ ...store, [side]: {} })
      }

      function exportJson() {
        setIo(JSON.stringify(store, null, 2))
        setShowIo(true)
      }

      function importJson() {
        try {
          const parsed = JSON.parse(io)
          commit({ light: parsed?.light ?? {}, dark: parsed?.dark ?? {} })
          setNoteErr(false); setNote(zh.saved)
        } catch {
          setNoteErr(true); setNote(zh.invalidJson)
        }
      }

      function tokenRow(name, label, sub) {
        const override = store[side]?.[name]
        const hex = override !== undefined ? normalizeHex(override) : measured[side]?.[name] ?? null
        const colorValue = hex && /^#[0-9a-f]{6}$/.test(hex) ? hex : '#000000'
        const refs = name.startsWith(STATIC_PREFIX) ? (staticRefs[name]?.length ?? 0) : null
        return h('div', { className: 'dshp-row', key: name },
          h('span', { className: 'dshp-dot', 'data-hidden': override === undefined ? '' : undefined }),
          h('span', { className: 'dshp-swatch', 'data-none': hex === null ? '' : undefined, style: hex ? { background: hex } : undefined }),
          h('span', { className: 'dshp-name', title: name }, label, h('em', null, sub),
            refs !== null ? h('small', null, refs ? zh.affects.replace('{n}', String(refs)) : zh.noEffect) : null),
          h('input', {
            className: 'dshp-color',
            type: 'color',
            // key 只用「變量名 + scheme」：把顏色值也放進 key 會令每次結算都
            // 銷毀重建 input，正在打開的原生調色板 popup 就會被關掉。
            key: `${name}:${side}`,
            defaultValue: colorValue,
            // 非受控，但外部改動（重設／匯入）要反映：元素沒有焦點時才同步，
            // 用戶正在拖動（元素有焦點）時絕不覆蓋。
            ref: (el) => {
              if (!el) return
              if (document.activeElement !== el && el.value !== colorValue) el.value = colorValue
            },
            onInput: (e) => setToken(name, e.target.value),
          }),
          h('input', {
            className: 'dshp-hex',
            value: override ?? (hex ?? ''),
            placeholder: zh.system,
            spellCheck: false,
            onChange: (e) => {
              const v = e.target.value.trim()
              if (v === '') setToken(name, null)
              else if (/^#[0-9a-fA-F]{3,8}$/.test(v)) setToken(name, v)
            },
          }),
          h('button', {
            className: 'dshp-btn',
            disabled: override === undefined,
            onClick: () => setToken(name, null),
            title: zh.resetOne,
          }, '↺'),
        )
      }

      function groupBlock(group, isStatic) {
        const isOpen = open[group.key] === true
        const overridden = group.names.filter((n) => store[side]?.[n] !== undefined).length
        const head = h('button', {
          className: 'dshp-head',
          onClick: () => setOpen((prev) => ({ ...prev, [group.key]: !isOpen })),
        },
          h('span', { className: 'dshp-caret' }, isOpen ? '▾' : '▸'),
          h('span', null, side === 'light' ? group.zh : group.en),
          h('span', { className: 'dshp-tag' }, `${group.names.length}${overridden ? ` · ${overridden}` : ''}`),
        )
        const body = isOpen ? group.names.map((name) => tokenRow(
          name,
          isStatic ? name.slice(STATIC_PREFIX.length) : (LABELS[name.slice(ALIAS_PREFIX.length)] ?? name.slice(ALIAS_PREFIX.length)),
          isStatic ? '' : name.slice(ALIAS_PREFIX.length),
        )) : []
        return h('div', { className: 'dshp-group', key: group.key }, head, body)
      }

      rows.push(h('div', { className: 'dshp-bar', key: 'bar' },
        h('div', { className: 'dshp-tabs' },
          h('button', { className: 'dshp-tab', 'data-on': side === 'light' ? '' : undefined, onClick: () => setSide('light') }, zh.light),
          h('button', { className: 'dshp-tab', 'data-on': side === 'dark' ? '' : undefined, onClick: () => setSide('dark') }, zh.dark),
        ),
        h('button', { className: 'dshp-btn', onClick: resetAll }, zh.resetAll),
        h('button', { className: 'dshp-btn', onClick: exportJson }, zh.exportJson),
        h('button', { className: 'dshp-btn', onClick: () => setShowIo((v) => !v) }, zh.importJson),
        h('label', { className: 'dshp-check', title: zh.backdropHint },
          h('input', {
            type: 'checkbox',
            checked: backdrop,
            onChange: (e) => setBackdrop(e.target.checked),
          }),
          zh.backdropLabel,
        ),
        h('span', { className: 'dshp-count' }, zh.overridden.replace('{n}', String(overriddenCount))),
      ))

      if (showIo) {
        rows.push(h('div', { key: 'io' },
          h('textarea', {
            className: 'dshp-io',
            value: io,
            placeholder: zh.importHint,
            onChange: (e) => setIo(e.target.value),
            spellCheck: false,
          }),
          h('div', { className: 'dshp-bar', style: { marginTop: '6px' } },
            h('button', { className: 'dshp-btn', onClick: importJson }, zh.apply),
            h('span', { className: 'dshp-status', 'data-err': noteErr ? '' : undefined }, note),
          ),
        ))
      }

      rows.push(h('p', { className: 'dshp-sec', key: 'sec-a' }, zh.aliasTitle))
      rows.push(h('p', { className: 'dshp-hint', key: 'hint-a' }, zh.aliasHint))
      for (const group of aliasGroups) rows.push(groupBlock(group, false))

      rows.push(h('p', { className: 'dshp-sec', key: 'sec-s' }, zh.staticTitle))
      rows.push(h('p', { className: 'dshp-warn', key: 'warn-s' }, zh.staticHint))
      for (const group of staticGroups) rows.push(groupBlock(group, true))

      rows.push(h('p', { className: 'dshp-status', key: 'status', 'data-err': noteErr ? '' : undefined }, note))

      if (phase === 'loading') return h('div', { className: 'dshp-wrap' }, h('p', { className: 'dshp-hint' }, '…'))
      if (phase === 'error') return h('div', { className: 'dshp-wrap' }, h('p', { className: 'dshp-hint' }, zh.loadFailed))

      return h('div', { className: 'dshp-wrap' },
        h('p', { className: 'dshp-hint', key: 'hint' }, zh.panelHint),
        ...rows,
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }))
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = CSS
        document.head.append(style)
        return () => style.remove()
      })
      // 遮罩開關要在「未打開設定頁」時就生效，所以載入時先套用一次存好的選擇。
      try {
        const saved = JSON.parse(localStorage.getItem(UI_KEY) ?? 'null')
        document.body.dataset.dshpBackdrop = saved?.backdrop === true ? 'on' : 'off'
      } catch {
        document.body.dataset.dshpBackdrop = 'off'
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-palette',
        order: 40,
        label: () => t('panelName'),
        locale: NS,
      }, Panel))
    }

    module.exports = { inject: ['slots', 'locale'], apply }
    return module.exports
  },
})
