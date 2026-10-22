# DESIGN_SYSTEM（草案）— 全局设计规则与 Token（night-v2，2026-10-22）

**单源声明**：token 与全局类的**真身**是 `miniprogram/app.wxss` 的 `page` 块与全局类区；规则解释真身是 `.agents/skills/ourtrail-ui/references/design-system.md`。本文件是**面向总览图的草案视图**：只引用、不复制值；新增 token 数＝**0**（铁律 17）。行号以 2026-10-22 实测为准（会漂，定位用 grep）。

## 1. 色彩（app.wxss:5-56 实测）

- 品牌：`--forest #163E35`（动作/hero 压底）、`--leaf #D6EA8A`（森林底上的反白强调）。
- 纸面：`--paper #F6F3EC`（页底）、`--surface #FFFFFF`（卡）、`--stone #EDE9DE`（次表面/chip）、`--stone-line`。
- 文字：`--ink #202A26` / `--muted #5F6E66`（paper 上 ≈4.6:1，勿调淡）/ `--on-forest-muted`。
- 语义：success/warning/danger/info + 四枚 `-soft` 底（徽标/callout 专用）。
- 天相/图表字面量色板：`--golden/--blue-hour/--chart-*`（canvas/SVG 取不到 var()，双写需同步注释源）。
- **导航bar**：重设计家族＝`navigationBarBackgroundColor #F6F3EC + navigationBarTextStyle black`（routes.json 实测先例）；默认深绿仅存于未重设计页，本轮三页收敛。

## 2. 字阶与排版（app.wxss:58-62、98-168 实测）

- `--text-caption 12 / --text-body 14 / --text-input 16 / --text-title 18`；页标题 `.page-title` 28/700/-0.6px。
- 层级工具：`.kicker`（眉题，字距做层级不靠色）/ `.eyebrow` / `.section-title` 16/600 / `.section-sub` 12 muted / `.card-label` 15/600。
- 身份名（me 昵称）本轮升 `--text-title` 18/600，与「资料卡即身份」的读法一致（拼板 8.2 头像+名为 hero）。

## 3. 间距/圆角/分层（app.wxss:63-69、80-107 实测）

- 圆角：tag 5 / button 8 / card 14 / sheet 20。
- 节奏：`.stack` 16 / `.stack-gap3` 12 / `.stack-sections` 28（章节呼吸）/ `.cluster` 8。
- 页边距 `.page` 24/20/32；tab 页尾留白 `calc(32px + 84px + env(safe-area-inset-bottom))` 归各 tab 页自己的 wxss（唯一规则登记在 ourtrail-ui design-system.md；判据 b4-pad-final-value-test）。
- 分层：纸底→白卡→stone 次表面；阴影不用（靠底色分层）。

## 4. 组件与状态

- 按钮：`.button.primary`（一页一预算）/ `.secondary` / `.text` / `.danger`（实心红只进确认弹窗；行内危险动作＝text+danger 色）；hover 一律 `button-hover`；禁用三层一致（.disabled + bindtap 空串 + handler 守卫）。
- 徽标 `.badge` 六态（success/warning/danger/info/neutral/on-forest）。
- 四态一律 `<status-panel>`（denied/loading/empty/error；empty 必解释为什么+下一步）；等价合规：callout+出路自陈。
- 列表 `.list-row`（44px 命中）+ `.list-main/.list-sub`；卡内行组 `padding:4px 16px` 先例（me/recent）。
- 通知卡 `.notice-card`（gap12/pad16/radius14/surface）+ `.unread` 森林 3px 左边线（app.wxss:285-294 实测）。
- 指标带 `.metrics/.metric-value/.metric-label`（数字 tabular、标签 muted）。
- 弹层 `overlay kind=sheet|dialog`；表单 `form-field`；头像 `.avatar-btn/.avatar-img/.avatar-fallback`（64 与 36 两档）。

## 5. 总览图读取规则（本轮固化）

1. 缩略图只取构图/组织/层级，不取精确值；值一律回 app.wxss token。
2. 总览图有、仓库无数据源的元素＝记差异不造（PAGE_REFERENCE_MAP §2）。
3. 已有 house style（编辑式眉题+大标题+章节卡）优先于拼板局部样式；冲突登记待裁决。
4. 文字承载语义，色相只辅助；天气派生文案概率语气（铁律 12）。

## 6. 门禁

- 静态：`tools/check.js`（含平台门 G1–G11）+ `check-handlers.js`。
- 样式批次门：swx1/swx2（色值字面量/重复定义/解析围栏）、t4-e08、m02（类作用域单源）、b4-pad（留白终值）、b4-e05（行内 style 单向 ratchet）、page2、ui-consistency。
- 真机：改 WXML/WXSS 后必须重编译截图（铁律 32⑥ 三门槛）。
