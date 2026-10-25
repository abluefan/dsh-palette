# dsh-palette

DSH 的调色盘 —— 逐项覆盖语义色与原材料色，写进 `body` 的 inline custom property。

## 为什么用 inline custom property

两个好处，缺一不可：

1. **无 FOUC** —— 页面加载时同步写入，paint 之前就完成
2. **不与皮肤插件冲突** —— inline 优先级高于任何样式表，不需要 `!important`

## 覆盖范围

| 前缀 | 含义 |
|---|---|
| `--dsw-alias-*` | 语义色（成品）—— 101 个，分 9 组 |
| `--dsw-static-*` | 原材料色阶 —— 77 个，按色系分组（改一级会连锁） |

浅色 / 深色分别存储。

## 功能

- 设置页「调色盘」面板
- 拖动即时预览（只写单个变量）；停手 150ms 才结算保存
- 单体重设 / 当前 scheme 全部重设
- 导出 / 导入 JSON
- 设置页遮罩开关（默认关闭）

## 存储

`$DSH_HOME/palette.json`

```json
{
  "light": { "--dsw-alias-bg-base": "#87f5f7" },
  "dark":  { "--dsw-alias-bg-base": "#101418" }
}
```

key 可以是 alias 或 static，同一层 map。

## 安装

### ① 通过插件市场（推荐）

在 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 的目录里找到本插件，
或在 dsh 的 **插件 → 发现** 里搜索 `dsh-palette`，点安装。

### ② 手动安装

任选一种，**不要两种同时用**：

**A. 复制 + 手写 insert（适合本地开发）**

1. 把本目录复制到 `$DSH_HOME/profiles/web/node_modules/dsh-palette/`
2. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 加：

   ```yaml
   - insert:
       - id: dsh-palette
         name: 'dsh-palette'
   ```

3. 重启 dsh，或让 Loader 重载配置

**B. `dsh plugin add`（需要包已发布到 npm）**

```sh
dsh plugin --profile web add dsh-palette
```

> ⚠ 用 B 之后，包名会进 `dsh.profile.bundles`，bundles 层会读本包自带的
> `cordis.patch.yml`；此时**不要**再做 A 的第 2 步 —— 同一个 id 会被插两次，
> DSH 启动会直接失败。

## 工具

`scripts/extract-tokens.mjs` —— 从 DSH 源码的 `design-platform.css` 抽出全部 `--dsw-alias-*` 的浅色/深色预设值（只抽 alias 层，不抽 static 原材料阶梯）。

路径在脚本开头改。

## 合法性校验

写入前会过两道白名单：

- 变量名只允许 `--dsw-alias-*` / `--dsw-static-*`
- 值必须是安全的 CSS 色彩字面量

坏数据一律退化成空表，不阻塞启动。

## 环境

- DSH ≥ 0.2.1
