# Style B 批次二 · 实现级设计（2a：天气中心 + 天气详情）

日期：2026-10-26 · 基线：`6e1faec`（批次一已真机验收并本地提交）· 决策来源：`style-b-decision-record-2026-10-26.md` D2 / D7 / D8

批次二共 16 页；按决策记录「批次一验收后立即做天气页，单独截首屏一屏再继续其余页」，
本文件只覆盖天气两页（2a）。其余 14 页的逐页 Gap Matrix 在 2a 真机截图之后再出，不提前写没读过的页。

## S8｜天气中心页（`pages/weather-hub`，第 4 个 tab 页）

| 项 | 现状 | 目标 | 文件 |
|---|---|---|---|
| 导航 | 原生绿导航 + `eyebrow 天气` + `page-title 先看天，再上山。` + `section-sub` | `navigationStyle: custom` + `<brand-header />`（D2 的第四个 tab 页）；页内标题块整体删除（D8：同一身份不再自报第三次） | `weather-hub.json` / `.wxml` |
| 主行动 | 地图选点（primary）+ 输入经纬度（secondary） | 不变；品牌栏之后紧接主行动 | `.wxml` |
| 卡片 | GPX 卡 / 观察点卡 / 轨迹点组卡 | 结构不动（已走 `.card` + `.card-header` + `.list-row` 契约） | — |

门禁影响：`brand-header` 进入第 4 个 tab 页的 usingComponents；`page2-gates`（weather-hub 夹具）、`m02-class-scope`（card-label 作用域清单含 weather-hub）、`weather-hub-gpx`、`entry-layout` 的 tab 页清单需复跑。无门钉过 `先看天，再上山。`（只在 `docs/product/*-P3.md` 的页头描述里出现，属产品文档的历史描述，不改）。

## S9｜天气详情页（`pages/weather`，D7「条件 → 图 → 详解」）

### 现状的次序（同一层，`wx:else` 分支内）

页头（eyebrow + page-title）→ 概率免责 → 点卡/节点 picker → 日期 → 草稿按钮 →
[逐时天气 section + 7 日条 + 24/48/72 窗 + meteogram / 云场卡 + OI 卡] →
今日户外时间轴 → 徒步提示 callouts → **天相条件（总评 + 5 张结论卡 + 沉默行）** → 逐小时表 → 出处

问题：首屏先给「读哪张表的说明」，不给「今晚有没有戏」；结论卡在时间轴与安全提示之后，
要滚很久才看到自己最想知道的那几行。

### 目标次序

```
页头（保留，24px，非 tab 页）→ 概率免责
点卡/节点 + 日期 + 草稿按钮        ← 控全局的输入，留在最前
徒步提示 callouts                  ← 安全优先，从图后面上移到这里（数据到了才出现）
条件 strip（新）：总评 · 天相 pill 行  +  沉默卡（紧跟其后，独立一张）
逐时天气（section + 7 日条 + 窗切换 + meteogram/云场 + OI 卡；选中小时的读数在云场卡内）
详解：天相详解（逐项结论卡）→ 今日户外时间轴 → 逐小时表 → 出处
```

### 条件 strip 的数据来源（零新阈值、零第二实现）

| 元素 | 来源 | 约束 |
|---|---|---|
| 「现在」读数 | ~~`unified.r1 / r2 / r3 / r4` 搬进 strip~~ → **留在云场卡内**（见下方偏离记录） | 不重算、不换口径；`r3` 保留 `stKey` 类（云中态警告色） |
| pill 行 | `condCards` 逐项投影 `{key, title, stars}`（`buildCondCards` 已过滤 silent 与 light） | 与明细卡同源；星串逐字节相同（`page2-gates §5b` 钉住） |
| 总评 | `condOverall` 的 `stars` + `label` + `tone`，**只在 strip 出现一次**（明细区的总评卡已删） | 不再算一次 |
| 沉默行 | `condSilent.text`，**独立一张 `.card.cond-silent` 紧跟 strip**（明细区的那张已删） | 与明细区不重复；全页恰 1 处（门钉住） |
| `skyInputLoading` / `skyInputNote` | 原在明细区，现移进 strip（strip 的可见条件包含这两项，否则「正在补充…」会消失） | 不复制、只搬家 |
| 位置 | strip 与沉默卡都在「徒步提示 callouts」之后、「逐时天气」之前 | 都在 `dayCards` 分支内 ⇒ 数据到了才出现 |
| pill 是否可点 | **不可点** | 纯状态行：零新 handler、零滚动副作用；明细紧跟在图后面，不需要二次导航 |

### 与初版设计的偏离（实施时发现，写清原因）

1. **「现在」读数不搬进 strip。** `unified.r1..r4` 只在「点了某小时」之后才有值（`applyUnifiedSelection`），
   默认态下 `r1 === ''`、`readout === '点图上任意小时查看读数。'`。把一句「点图上任意小时」印在**图的上方**是
   指路指反；而 strip 与云场卡各印一份读数则是同一条结论印两遍。⇒ 读数留在云场卡内唯一一处。
2. **总评卡从明细区删除，而不是复制。** 最初方案是 strip 与明细区各一张，那会让「天相条件 ★★★★」在长页里
   出现两次；现在是 strip 唯一一处，明细区只剩逐项卡。
3. **沉默说明是 strip 之后的独立卡，不是 strip 里的一行。** 放进 strip 需要复用 `.cond-silent` 的左边条，
   而那条样式语义是「不是结论、也没有评级」，塞进结论卡内部会自相矛盾；独立卡保持既有视觉语法不变，
   同时仍在首屏内。
4. **「此点」卡从页首下移到图上方（D7 补完）。** 原方案把它与点/节点 picker、日期一起留在页首当「控全局的输入」，
   真机实测那张卡单独占 **226px**，加页头与免责后 preamble 到首卡已 631px（视图可用高 753）⇒ strip 只有 101px
   余量，和 D7「先回答今晚有没有戏」正相反。改为：页首只留 picker + 日期 + 草稿按钮（控件），「此点」卡带着它的
   「存入我的观察点」动作整体落到 **24/48/72h 切窗之后、meteogram 之前**——图上那根虚线就是这里的海拔，
   「坐标/海拔」放在图上方是在解释这张图。卡内只保留 `card-header`（名称 + 动作）与一行 `point-meta`，
   高度 226 → 94。**没有删动作、没有改字段**：`onSavePoint` 接线与 `pointCard.*` 取值一字未动。
5. **`.cond-grade` 容器 `<text>` → `<view>`。** 微信的 `<text>` 不能当 flex 容器，写在它上面的 `gap: 6px`
   被静默丢弃（DOM 文本、`page.data()` 全部正常，只有像素读得出来）：真机 390×844 实测「★★☆☆☆条件较差」
   贴成一串。改容器类型 + `page2-gates §5b` 新增「容器必须是 view / 星串与档位必须是两个 text 子节点」，
   另加真机像素断言（两节点矩形间隙 6px，容差 3–10）。
6. **区头两处样式修正（真机发现，静态门与逻辑测试都测不到）。** ① 页级 `.section-head` 此前只覆盖
   `display/align/justify`，`flex-direction` 仍继承 `app.wxss:145` 的 `column` ⇒「全图展示」被排成标题下方的
   居中一行（多占 40px，且视觉上像说明文字）。② 微信 `<button>` 的 UA 样式是 **固定宽 184px + 左右 `auto`**，
   auto 外边距会先吸收剩余空间，`justify-content: space-between` 因此失效（实测按钮 left 135 / width 184，
   没有靠右）。修法是**成对**的：方向只加在 `.section-head.has-action`（另两个区头「今日户外时间轴」「天相详解」
   的正确形状就是竖排标题+说明，不能被拍平），button 在作用域内 `width: auto; margin: 0`。两条都进
   `page2-gates §5b` 的**级联终值**断言（`flex-direction: row` 的赢家必须是页级 sheet，另两个区头必须解析为
   `column`），配变异自证（改回 `column` ⇒ 2 红；删 `width/margin` ⇒ 1 红，改完文件 sha256 还原一致）。

### 非目标（写清楚，防止顺手改判据）

- 不碰任何阈值、不碰 `utils/sky.js`、`utils/conditions.js`、`utils/agenda.js`、`utils/cloud-field-svg.js`；
- 不碰 `--chart-ramp` 与 meteogram / 云场 SVG 的任何几何；
- 不新增数据字段、不改云函数、不改 `journey.js`；
- 不折叠任何正文（D6 的同一条纪律：正文不折叠、不做真 tab）。

### 新增样式（`weather.wxss`，只用既有 token）

`.cond-strip`（卡内两行：读数 + pill 行）、`.cond-pill`（小圆角、`--paper` 内的细边）、
`.cond-pill__stars`（tabular）、`.cond-strip__silent`（12px muted）。
不引入新色值；pill 的 tone 复用既有 `ag-grade` 的 tone 类，不自造第二套配色。

## 验收（2a）

1. `node tools/check.js` → `ALL CHECKS PASSED`；`check-handlers.js` 无新增死 handler。
2. 受影响套件：`weather-page`、`page2-gates`、`weather-hub-gpx`、`m02-class-scope`、`entry-layout`、`swx2`、`t4-e08`、`b4-pad-final-value`、`scenario-editor`（无改动也应复跑）、`journey-graph`、`ui-consistency`。
3. 真机：重编译后截 `weather-hub` 首屏与 `weather` **首屏一屏**（D7 的单独截图），
   断言「条件 strip 完整在可用区内 + 图标题可见」，证据落 `docs/ui-ux-redesign/evidence/style-b-2a-2026-10-26/`。
4. 不 push、不部署；`cloudfunctions/` 零改动 ⇒ 不需要重新部署。

## 验收结果（2026-10-26 实测）

| 项 | 读数 |
|---|---|
| `check.js` | exit 0 `ALL CHECKS PASSED`（G10 作用域单元 42 · token 3143 · 类名 134 · 命中 0） |
| `check-handlers.js` | exit 0（42 个模板宿主；死 handler 仍只有存量 `editor.js#onNumber`） |
| 套件 | `page2-gates 117/0` · `weather-page 209/0` · `weather-v2 103/0` · `swx2 110/0` · `t4-e08 41/0` · `b4-pad 33/0` · `m02 66/0` · `entry-layout 41/0` · `header-layout 38/0` · `weather-hub-gpx 23/0` · `journey-graph 15/0` · `ui-consistency 19/0` · `meteogram-readability 86/0` · `cloud-field-svg 29/0` · `weather-resilience 45/0` |
| 真机驱动 | **18 条断言全过**，`exceptions=0 consoleErrors=0`（`readings.json`） |
| 首屏（视口 753） | strip 417.2–511.2 · 沉默卡 526.7–604.7 · 区头 624.7–694.7 —— **全部在可用区内** |
| 区头 | 标题 636.7–660.7 / 按钮 296–370（74×48，右沿 370 = 内容右沿） / head 高 70；另两个区头仍 50（竖排） |
| 星串与档位 | `starsRight 299 / gradeLeft 305 ⇒ gap 6px` |
| 来源说明 | 单行 h=18，文本含 `Open-Meteo.com`（未断行） |
| 「此点」卡 | top **991.7**（图之上、切窗之下），高度 94（原 226） |

真机发现的 3 条缺陷（`<text>` 当 flex 容器吞 gap / 区头方向未重置 + UA 按钮宽 184 与 auto 外边距 /
点卡 226px 挤掉首屏）逐条修复并配门；未验证项（375 宽、原生 picker/分享/相册/键盘、
`skyInputsSettled` 在真实网络下的时序、IDE 环境专属表现）在证据目录 README 里逐条列明，不当作通过。
