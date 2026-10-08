# OurTrail 设计系统参考（token 表 + 组件清单）

来源：`app.wxss`（原型 tokens.css/components.css 移植）。改动前先确认这里没有等价物。

## 颜色 token（page 级 CSS 变量，组件内可用 var()）

| token | 值 | 用途 |
|---|---|---|
| `--forest` | #163E35 | 主色：主按钮底、导航栏、hero 卡底、强调文字 |
| `--leaf` | #D6EA8A | 嫩叶：hero 上的徽标/强调（`.badge.on-forest` 底为 --leaf-on-forest #2D533F） |
| `--paper` | #F5F5F0 | 页面底色 |
| `--surface` / `--white` | #FFFFFF | 卡片/弹层底（`--white` 供画布色板引用） |
| `--ink` | #202A26 | 正文 |
| `--muted` | #5F6E66 | 次要文字（对比度 4.6:1，勿再调淡） |
| `--line` | #DEE3DB | 边框/分隔线 |
| `--control-line` | #8C9791 | 输入框边框；亦为「入云」天相色 |
| `--danger/--warning/--info/--success` | #B43D3B / #8C5A12 / #346583 / #276145 | 语义色，配套 `-soft` 浅底 |
| `--forest-soft` | #ECF0EF | 主色浅底（次按钮、头像底、选中 tab） |
| `--success-soft` / `--warning-soft` / `--danger-soft` / `--info-soft` | #EBF0EE / #F4F0E9 / #FAF1F1 / #F0F3F6 | 语义色浅底 |
| `--golden` | #D6A33C | **天相**：黄金/晚霞窗口。由 `MARK_STYLE.golden` 提升而来，改色须同步 |
| `--blue-hour` | #6C7C93 | **天相**：蓝调时刻。同上，须同步 `MARK_STYLE.blueHour` |
| `--chart-showers` / `--chart-wind` / `--chart-gust` | #2E8B8B / #3D8A7F / #9FC4D8 | **Weather V2 图例**：阵雨柱/风速线/阵风线。由 `meteogram-svg.js` `C` 色板提升，改色须同步 |
| `--chart-in-cloud` | rgba(180,118,26,0.65) | **Weather V2 图例**：琥珀段「你在云中」。同上（`C.inCloud`） |
| `--chart-ramp` | linear-gradient(#eeeeea→#d4d6d0→#b0b2ab→#84867f→#5a5c56) | **Weather V2 图例**：云量五档灰阶带。= `cloud-field-svg.js` `BANDS`（3 测试 pin），改色须同步 |
| `--on-forest-muted` / `--on-forest-line` | #D0D8D7 / #4E6C65 | 森林底上的次要文字/线 |
| `--leaf-on-forest` | #2D533F | 森林底上的嫩叶底；亦为「星空」天相色 |
| `--focus` | #346583 | 聚焦态描边（= `--info`） |

**天相色与 token 的对应（`MARK_STYLE` ↔ `app.wxss`）**

`components/meteogram/layout.js` 的 `MARK_STYLE` 是天相配色的**唯一来源**。8 个 key 全部有 token 了：

| MARK_STYLE key | 色值 | token |
|---|---|---|
| `cloudSea` 云海 | #346583 | `--info` |
| `star` 星空 | #2D533F | `--leaf-on-forest` |
| `galaxy` 银河 | #163E35 | `--forest` |
| `rainbow` 彩虹 | #8C5A12 | `--warning` |
| `alpenglow` 光染 | #B43D3B | `--danger` |
| `inCloud` 入云 | #8C9791 | `--control-line` |
| `golden` 黄金 | #D6A33C | `--golden` |
| `blueHour` 蓝调 | #6C7C93 | `--blue-hour` |

**已知的历史坑，勿重犯：**

- **温度线不许用红。** `--danger` #B43D3B 与 `alpenglow` 光染是同一色值，图例里的红色分不清是温度还是光染。温度线用 `--ink` 中性墨色。
- **色块上的字用 `inkOn()` 判，不要写死白字。** 黄金 #D6A33C 这类浅色配白字对比度只有 ~1.9:1，图上浅色标记的白字一直看不清。
- **天相 key 增删必须同批改三处**：`utils/sky.js` 的 `hourMarks`、`meteogram/layout.js` 的 `MARK_STYLE`、以及任何消费方（如 `space-time/layout.js`）。key 分叉会让图表**静默丢标记**。

**禁止发明新色值。** 需要新语义色时：在 app.wxss 加 token + 在本表登记。

## 字号与行高

| 类 | 值 | 用途 |
|---|---|---|
| `.page-title` | 28px/1.3 字重700 字距-0.6px | 页面大标题（仅 root 页与重要节点） |
| `.section-title` | 16px/24 700 | 区块标题 |
| `.eyebrow` | 12px/18 600 字距0.72px muted | 眉题（OURTRAIL · 一起走过） |
| 正文 | 14px/22（page 默认） | |
| `.small` | 12px/18 | 说明/副文本 |
| 输入框 | 16px（防 iOS 聚焦缩放） | |
| `.field-label` | 13px/18 400 muted | 表单标签是辅助信息，值才是主角 |

## 间距与圆角

- 纵向节奏：`.stack` 16px、`.stack-gap3` 12px、`.form-actions` 12px；页面内边距 24/20。
- 圆角：tag 5 / button 8 / card 14 / sheet 20。
- 触控目标 ≥44px（`--touch-target`），主操作高 48px（`--action-height`）。

## 组件清单（改 UI 先复用）

| 组件/类 | 用法要点 |
|---|---|
| `.button` + `primary/secondary/danger/text/leaf` | view 或 button 均可；必须 `hover-class="button-hover"`；禁用态加 `.disabled` 并把 bindtap 置空串 |
| `.card` / `.card-header` | 内容卡；header 用于"标题 + 右侧动作" |
| `.badge` + `success/warning/danger/info/neutral/on-forest` | 状态徽标，文字承载语义 |
| `.callout` + 同上变体 | 提示块（左边线 3px 语义色），`callout-title` 加粗 |
| `<status-panel>` | denied/loading(skeleton)/empty/error/offline + 可选 actionLabel |
| `<person-row>` | 头像（无头像回退首字）+ 姓名 + 徽标 + 副标题 + 操作插槽 |
| `<form-field>` | label + slot + hint + error；错误时外层 `.field.invalid` |
| `<overlay kind="sheet|dialog">` | 底部弹层/居中确认；内容放 `.stack`；危险操作用 dialog + danger 按钮 |
| `<activity-card>` | 活动卡；`featured` 森林底 + 等高线装饰；`info` 属性传指标行 |
| `.segmented > .seg(.on)` | 分段切换（工作台四分区、筛选） |
| `.list-row` + `.list-main/.list-sub` | 行列表（图标或箭头收尾） |
| `.timeline/.timeline-item` | 路线节点时间轴（::before 圆点） |
| `.seat-grid/.seat(.occupied/.aisle/.selected)` | 座位示意：**4 座 + 1 过道 = 每行 5 列**，座位宽 `calc((100% - 48px) / 4)`、过道固定 16px，勿改回 25%（过道占位会错行） |
| `.metrics/.metric` | 三列指标（hero 内自动反白） |
| `.hero` | 森林底精选卡，子元素加 `.hero-body` 保证叠在装饰层上 |
| `.tabbar/.tab(.on)` | 仅 custom-tab-bar 内使用（自包含样式） |
| `.code-text` | 身份码等等宽强调 |
| `.tabular` | 数字对齐（时间/里程/人数） |
| `.map-card/.map-canvas` | 原生 `map` 组件外框（260px、14px 圆角、`overflow:hidden`）。低版本基础库非同层渲染时圆角会失效，接受降级、**不在 map 上叠普通 view**。marker 图标用 `assets/markers/*.png`（`tools/gen-map-markers.js` 生成；iconPath 不支持 base64），序号用 marker `label`，信息用原生 callout，白底 forest 字。地图元素配色：轨迹线 `#163E35AA` 宽 4 `arrowLine`、降级虚线 `#8C9791AA` 宽 2 `dottedLine`；marker=起点 forest/途中白底 forest 描边/终点 leaf+forest 描边/上车点 info 蓝，均为圆点造型（选中态放大到 30 即可，无需单独图）。 |
| `.section-head/.section-title/.section-sub` | 页面内分区标题（把长页分成几段，如天气页的"客观指标 / 结论"）。标题 700 正文号，右侧 `.section-sub` 12px muted |
| `.sky-card/.sky-title/.sky-text` | 结论卡（天相判断等）。`.sky-look` 为 forest-soft 底的方向/时段条，左侧 `.sky-look-label` 是白底 forest 药丸标签 |

## canvas 自绘图表（meteogram）

天气页 `<meteogram>` 是自绘图表，**画布内的颜色不能取 CSS 变量**（canvas 拿不到 `var()`），故在 `meteogram.js` 顶部 `const C` 维护一份字面量色板。凡是 `app.wxss` 已有 token 的值，`meteogram.js` 里都逐行标了 `// = --token` 来源——**照着标好的抄，不要凭记忆**。

| 用途 | 色值 | token |
|---|---|---|
| 夜间底 / 白昼底 | `#F0F1EC` / `#FFFFFF` | 无 / `--white` |
| 网格线 | `#E4E8E1` | 无 |
| 轴文字 | `#5F6E66` | `--muted` |
| 温度线 / 面积 | `#202A26` / `rgba(32,42,38,0.08)` | `--ink` 及其 8% |
| 降水柱 / 阵雨柱 | `#346583` / `#2E8B8B` | `--info` / 无 |
| 三层云量 低/中/高 | `#346583` / `#6C7C93` / `#8C9791` | `--info` / `--blue-hour` / `--control-line` |
| 所选日高亮带 / 左边线 | `rgba(22,62,53,0.12)` / `rgba(22,62,53,0.35)` | `--forest` 12% / 35% |
| 当前时刻线 | `#163E35` | `--forest` |
| 天相窗口标记 | 见上文「天相色与 token 的对应」，取自 `MARK_STYLE` | 8 个均有 |

- **温度线是中性墨色 `--ink`，不是红。** 曾经用 `--danger` #B43D3B，但它与 `alpenglow` 光染同色，图例里分不清是温度还是光染；中性墨色也让「客观指标」这层不与语义色抢注意力。**改回红色会把这个坑重新埋回去。**
- **三层云量用实色 + `ctx.globalAlpha` 表达浓淡，不要用自带 alpha 的色值。** alpha 相乘会让低云量几乎完全看不见（这是修过的 bug）。
- 列宽 22px、图高 `CHART_H = 202`；canvas 宽度在数据到达后才设定，否则 `SelectorQuery` 量到旧值。
- 绘制时按 `pixelRatio` 缩放：`node.width = cssWidth × dpr` 后再 `ctx.scale(dpr, dpr)`，否则文字发虚。
- **`type="2d"` canvas 在 `node.width` 赋值瞬间锁定图层偏移，不随后续回流。** 异步布局稳定后需重新测量（`meteogram.js` 在 100ms / 320ms 各测一次），否则图表浮在正文之上。
- 组件必须声明 `options: { styleIsolation: 'apply-shared' }`（图例文字用 app.wxss 的 `.lg`）。**`options` 只能写一次**——写成两个同名字段后者覆盖前者，`apply-shared` 会被静默丢弃（form-field 与 overlay 曾因此散架）。
- 太阳位置相关的窄窗口（黄金/蓝调只有十几分钟）**不能按"整点的太阳高度角"标记**，要按天文时刻窗口与整点相交判定，否则整段漏掉。
- 色块上的文字用 `layout.js` 的 `inkOn(hex)` 判亮暗，**不要写死白字**。


## 页面模板

- **root 页**（home/notices/me）：`.eyebrow` + `.page-title` + 一句 `.muted` 副标题开头；底部留白 `calc(32px + 84px + env(safe-area-inset-bottom))`。
- **子页**：原生导航栏（深绿底白字），内容区从 `eyebrow + page-title` 或直接正文开始；操作区用 `.sticky-action`（固定底栏）或 `.form-actions`。
- **工作台类**（workspace/staff）：顶部指标 `.metrics` + `.segmented` 分区 + 面板组件。
