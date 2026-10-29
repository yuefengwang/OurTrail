# OurTrail 试点报告 · weather-hub 首页

> 试点对象：微信小程序 `pages/weather-hub/weather-hub`（首页「选源」屏）对齐冻结原型
> `docs/prototypes/ourtrail-explore-v3/weather.html`。日期 2026-10-28。
> 证据根目录：`prototype-fidelity-suite/examples/ourtrail/`（`captures/`、`reports/pilot-real/`、`reports/pilot-injected/`）。

## 0. 一句话结论

**页面未通过保真验收（FAIL），但失败原因已被逐条归因到代码与原型两侧的具体声明**：12 处几何失败里
只有 3 个「声明本身写错」，其余是同一个根因（缺失全局 `box-sizing`）在三个容器上的连锁，以及一个
继承行高（`22px`）在两个方向上互相抵消后的残余。**没有修改任何产品代码**（weather-hub 属冻结模块），
修补提案见 §9，全部 `BLOCKED` 等待授权。

---

## 1. 范围与授权边界

| 项 | 取值 |
|---|---|
| 原型 | `docs/prototypes/ourtrail-explore-v3/weather.html` + `weather.css`（**冻结，只读**） |
| 目标 | `miniprogram/pages/weather-hub/weather-hub.{wxml,wxss,js}`（**冻结模块，本轮零改动**） |
| 本轮改动的仓库文件 | 只有 `prototype-fidelity-suite/` 下的工具、示例配置与报告；**产品代码 0 行** |
| 未执行（按任务书禁则） | 改业务逻辑 / 改冻结模块 / 动生产数据 / 真实账号有副作用操作 / 推远程 / 合并主分支 / 删文件 / 批量改页面 / 改全局设计规范 / 装高风险依赖 |
| 开发者工具 | 复用已在运行的共享会话；只做 `open/auto` 级非破坏操作，未 `quit` |

小程序侧没有 DOM 求值通道（`appservice App.CDPEnable` 未实现），因此几何来自
`miniprogram-automator` 元素 API（`offset/size/style/text`），像素来自模拟器截图。这一点决定了
本轮证据的形态：**能读到的节点 = 配置里声明过的选择器**（目标侧快照 12 个节点，原型侧 127 个）。

## 2. 证据链（每一条结论都可回查）

| 证据 | 值 |
|---|---|
| 代码版本（两侧同源） | `4922e151581e9ffbf8ee338cebe3fd47444c19a2` |
| 原型侧 | `web` 适配器，viewport 390×844，dpr 1，截图 sha256 `7da6065a…69d9` |
| 目标侧 | `wechat-miniprogram` 适配器，viewporot 390×844，dpr 3，截图 sha256 `09e9dcc2…4fa2` |
| 截图缩放 | 目标截图 **0.7846 × 0.7820** CSS px（306×660）⇒ 区域裁剪两侧各自归一化后再比，几何不依赖该缩放 |
| 对齐 | 锚点 `header`，重定基 dy 平移 **15px**（外壳高度差），尺寸永不重定基 |
| 报告 | `reports/pilot-real/visual-diff-report.json` · `fidelity-validation-report.json` · `report.html` · `regions/*.png`（每对 prototype/target/diff 三张） |
| 交互证据 | `reports/pilot-real/interaction/*.png`，每条断言带 `verification: real-action-and-observation` |

`reports/` 下另有 8 个时间戳目录，是本轮排查（box-sizing、行高、声明修复）的中间轮次；**权威成对证据是
`pilot-real` 与 `pilot-injected`**，中间轮次保留为过程证据，不作为结论依据。

## 3. 状态 `real`：15 对读数

维度判定：**geometry FAIL 12/22 · typography FAIL 5/26 · appearance FAIL 8/24 · state PASS 4/4 ·
interaction PASS 4/4 · 总判定 FAIL**。没有单一总分。

| pair | 状态 | 类别 | 关键读数 |
|---|---|---|---|
| header | FAIL | spacing, pixel | `padding` 22/20/14/20 → 14/20/14/20（Δ8）；像素 10.8% |
| eyebrow | FAIL | typography, position, ink | dy −8、dh +8（`size` 已接受）；`font-weight` 650/600、`line-height` normal/22px |
| title | FAIL | typography, ink | `font-weight` 730/700；dh +0.5（`size` 已接受） |
| sub | PASS | — | 宽度差 110（已接受）；dh −0.19 在容差内 |
| actions | FAIL | size, pixel | dh **+34** |
| primary | FAIL | size, other, pixel | dh **+32**；`box-sizing` border-box/content-box |
| primary-sub | FAIL | size, typography, spacing, position, ink | dy +10.01、dw −60（文案后缀）、dh +8；`line-height` normal/22px；`margin` 4/0 |
| action-row | FAIL | size, other, position, pixel | dy +32.01、dh **+2**；`box-sizing` 不同 |
| recent / recent-title / asset-row / asset-name | NOT_APPLICABLE | target-missing | 账号无个人计划 ⇒ 模板 `wx:if` 正确地不渲染；已按状态接受 |
| tabs | FAIL | other, position, pixel | dy **−89.99**；`box-sizing` 不同（高度实测相同） |
| list | FAIL | size, position | dy −89.99、dh +2 |
| foot | FAIL | size, text-wrap, position | dy −105.4、dh +17；文本不等（`text` 已接受），行数 +1 |

`appearance` 维度 8 条失败**全部**来自渲染证据（pixel/ink），没有一条来自外观类声明——
这一页的"看起来不一样"不是配色/圆角问题。

## 4. 归因：四条系统性原因（全部实测，不是推测）

### G1 · 原型全局 border-box，小程序盒模型是 content-box

- 原型 `style.css:2`：`*{box-sizing:border-box}`。
- 目标 `weather-hub.wxss` 全文只有 `:166` 一处 `box-sizing: border-box`（`.wh-search`），其余盒模型为默认 content-box。
- 实测：`.wh-primary` 声明 `min-height:60px; padding:15px 16px; border:1px` ⇒ 外框 **92 = 60 + 15×2 + 1×2**，
  与报告 dh **+32** 逐 px 吻合（探针 `tmp/probe-primary.json`：`size.height=92`、`style.height=60px`、
  `padding=15px 16px`、`border-top-width=1px`、`box-sizing=content-box`）。
- 同一根因的另外两处：`.wh-row-btn`（`min-height:46` + 上下 border 1px ⇒ 48）使 `action-row` **+2**；
  `.wh-tabs` 声明不同但**高度实测相同（dh 0）**——这正是"声明差异"与"视觉差异"必须分开报告的例子。

### G2 · 未声明行高的文字继承了 `page { line-height: 22px }`

- `miniprogram/app.wxss:82`（`page` 块内，块起于 `:4`）：`line-height: 22px`。
- 原型这些类都没有 `line-height`，浏览器按 `normal` 排：10px 字 ⇒ 14px 行、13px 字 ⇒ 17px 行。
- 实测：`eyebrow` 14→22、`primary-sub` 14→22（real 状态）；注入计划态下 `recent-title` 17→22、
  `asset-name` 17→22，容器 `recent` 124→153、`asset-row` 69→87、`list` 128→163。
- **方向性提醒**：页面头部 `padding-top` 少了 8px（G4）与 `eyebrow` 行高多了 8px（G2）**恰好抵消**，
  所以 `title`/`sub` 的 dy 都是 0。只看 dy 会得出"头部没问题"的错误结论——行高差被藏在了两个方向的抵消里。

### G3 · 中间字重（650 / 730 / 680）在实现里被取整

- 原型 `weather.css:32` `.home-eyebrow{font-weight:650}`、`:33` `h1{font-weight:730}`、`:44`/`:48`/`:61` 650、`:53` 680。
- 目标用 600 / 700。报告逐项写出 `650→600`（Δ50）、`730→700`（Δ30）。
- 这是**视觉语言层面的差**：原型按可变字体写细分级字重，系统字体在 iOS/Android 上通常只能落到
  最近的可用字面或合成插值。是否接受属产品/设计裁决，见 §9 P3。

### G4 · 头部顶部内边距 22 vs 14（载体差之外的 8px）

- 原型 `weather.css:31` `.home-header{padding:22px 20px 14px}`；目标 `weather-hub.wxss:14` `padding:14px 20px 14px`。
- 已接受的是 header 的**绝对 dy**（外壳高度差，锚点重定基 15px）；**padding 的 8px 差仍单独判 FAIL**——
  它不是外壳，是页内间距。

### G5 · `primary-sub` 少了原型给的 4px 上边距

- 原型 `weather.css:39` `.home-action-primary small{…margin-top:4px}`；目标 `.wh-primary-sub`（`weather-hub.wxss:46`）没有 margin。
- 报告 `margin` [4,0,0,0] → [0,0,0,0]。

## 5. 级联分解（把"差了 90px"拆成有名有姓的几笔）

`tabs` 的 dy = **−89.99**：

```
−124   recent 整块在目标不存在（数据状态差，已接受）
 +32   primary 的盒模型差（G1）
  +2   action-row 的 1px 上下 border（G1）
────
 −90   ← 与实测 −89.99 一致（0.01 为亚像素取整）
```

`foot` 的 dy = **−105.4** = tabs 的 −89.99 − list 的 +2（行高）+ 脚注自身从两行变一行（−17，文案决定）。

**为什么 `tabs`/`list`/`foot` 不直接接受**：它们的位移是"已接受的数据差"与"未接受的盒模型/行高差"的混合。
一个位移里混着两种成因时，接受它等于把真缺陷一起豁免。这三个 pair 保持 FAIL 是本轮**有意**的选择。

## 6. 状态 `injected-plan`：把数据态差补回来

真实账号没有个人计划，`recent`/`asset-row` 在目标侧根本不存在（正确的 `wx:if`）。为把这两块的版式也量到，
注入与原型演示计划同名的夹具（`plansState=ready` + 一条计划），得到 **15 对全部可测**（目标快照 16 节点）：

- `recent` 124→**153**（dh +29）、`recent-title` 17→22、`asset-row` 69→87、`asset-name` 17→22、`list` 128→163。
- 新增的 5 个 FAIL 全部落在 **G2（行高）与 G3（字重）**，没有新根因。
- 该状态的报告带警示：**`Target capture used injected data: visual evidence only, not acceptable as interaction evidence.`**
  注入态只作版式证据，不当交互证据。

## 7. 交互契约：4/4 PASS（含一次真实的"声明缺陷"修复）

| 用例 | 断言 | 结果 |
|---|---|---|
| `tab-points` | `data.homeTab === 'points'`；`.wh-tab.on` 文本含「常用地点」 | PASS |
| `tab-routes` | `data.homeTab === 'routes'` | PASS |
| `manual-dialog` | `manualOpen===true`；`.overlay--dialog` 存在；标题含「输入经纬度」 | PASS |
| `manual-close` | `manualOpen===false` | PASS |

每次都是**真实 tap → 观测后果**，并留了截图（`reports/pilot-real/interaction/*.png`）。

`tab-points` 第一次是 **FAIL**，原因不在页面在**声明**：原断言要求 `.wh-quiet`（空态文案）出现，
而该账号有 2 个已存地点，空态正确不渲染。改成断言"与数据无关的后果"（激活 tab 文本 + `homeTab`）后通过。
**这是一次声明层的修复，不是实现层修复**——页面一行没动。记入实验 C 的第一条（§8）。

## 8. 实验 C 记录（修复有效性）

### C-1 · 契约声明修复（试点内，`tab-points`）

| 项 | 内容 |
|---|---|
| 修复前差异 | `tab-points` FAIL：`textIncludes(.wh-quiet, '常用地点')` 读不到节点 |
| 根因 | 断言把一个**依赖数据状态**的节点（空态）当成不变量；账号有 2 条已经存地点 |
| 修改内容 | `pf.config.json`：`.wh-quiet` 断言 → `.wh-tab.on` 文本 + `data.homeTab` |
| 修复后差异 | interaction 3/4 → **4/4**；视觉区域读数**逐字节不变**（同一批报告，diff 仍 10 failing） |
| 是否引入新问题 | 无（视觉报告前后一致） |
| 迭代次数 | **1** |

### C-2 · 实现层修复（`examples/generic-web`，与 OurTrail 无关）

试点模块冻结，实现层修复无法在本仓库执行，因此在一个通用 Web 基样上做了完整闭环
（`examples/generic-web/c-repair/before.html` → 修复 → 复测，`experiments/run.js --only c`，40 条断言）：

| 项 | 内容 |
|---|---|
| 修复前差异 | 8 对里 7 对 FAIL：`b-label`（字号 12→14、行高 16→18）、`b-card`（圆角 8→12）、`b-btn`（margin-top 16→10）；级联：`b-clock/b-desc/b-img` dy +2、`b-btn/b-note` dy −4、`b-card` dh +2 |
| 根因定位 | 报告逐条给出**声明**：`font-size` 12/14、`border-radius` 8/12、`margin` [16,0,0,0]/[10,0,0,0]；`b-note` 没有任何自身失败声明 ⇒ 纯级联 |
| 修改内容 | 三处声明改回原型值（每处锚点命中数必须恰为 1，否则该条修复不成立） |
| 修复后差异 | 8 对全部 PASS；几何 0、像素 0、ink PASS；退出码 0 |
| 是否引入新问题 | 无（原先 PASS 的 `b-title` 仍 PASS） |
| 迭代次数 | **1**（首轮即收敛） |

## 9. 修补提案（全部 `BLOCKED`：等授权，本轮未执行）

> 依据任务书：「天气、隐私及其他既有冻结模块必须遵守项目当前约束，不得为了试点擅自解除冻结。」
> 以下只提案，不落地。每条都写明验证方式，授权后照此复测即可。

**P1（G1）盒模型** · 二选一

- **P1a 局部**（推荐先做）：在 `weather-hub.wxss` 给 `.wh-primary`、`.wh-row-btn`、`.wh-actions`、`.wh-tabs`
  等有 padding/border 的盒显式加 `box-sizing: border-box`。影响面仅本页；预期 `primary` dh 32→0、
  `actions` 34→2、`action-row` 2→0。验证：重跑 `--state real`，这三对 `size` 类别消失。
- **P1b 全局**：`app.wxss` 加 `*{box-sizing:border-box}`，与原型 `style.css:2` 对齐。**属全局设计规范变更**，
  会改动所有页面已按 content-box 调好的高度（例：`min-height:46px` 的行高只有本页量过），
  必须全量回归 21 页 + 相关门禁后才可考虑。

**P2（G2）行高**：给 `.wh-eyebrow`、`.wh-primary-sub`、`.wh-recent-title`、`.wh-asset-name` 写显式行高
（原型的实测值：10px 字→14px，13px 字→17px）。**不要改 `app.wxss:82` 的 22px**——那是全站正文的基线行高，
改它等于改所有页面。验证：`eyebrow` dh 8→0、`primary-sub` dh 8→0；注入态下 `recent` 29→0、`asset-row` 18→0
（容器差值应随之归零，这是判据，不接受"看起来好了"）。

**P3（G3）字重口径**：650/730/680 是否照写进 WXSS，取决于系统字体能否稳定兑现。建议**先实测**
（iOS/Android 各一档 + ink 判据对照）再定；在此之前该差异记 `UNVERIFIED`，**不擅自改成 600/700 说"已经一致"**。

**P4（G4）头部间距**：把 `.wh-header` 的 `padding-top` 改 22px（对齐原型），或接受 8px 差并写明理由。
前者会让整页下移 8px、改变首屏密度；后者要改 `acceptedDifferences`（属"接受视觉差异"，需产品确认）。

**P5（G5）`primary-sub` 上边距**：补 `margin-top: 4px`。影响：主入口块内文字下移 4px（dy 10→6）。

## 10. 覆盖与局限（必须与结论一起读）

1. **目标侧几何只覆盖声明过的选择器**（12/127 节点）。`.wh-row-btn`、`.wh-recent`、`.wh-asset` 等未映射节点
   没有独立读数，只能通过容器 dh 间接察觉——`action-row` 的 +2 就是因此才被看到。
2. **接受差异是"类别级"的**：`primary-sub` 的 `size` 里同时装着"已接受的 dw −60（文案后缀）"和"真实的 dh +8（行高）"；
   `foot` 的 `size`+`text-wrap` 是"已接受文案决定"的后果。类别级无法只切一条轴，所以这两对保持 FAIL——
   宁可多报，不把真缺陷一起豁免。这是设计选择，不是遗漏（记入路线图）。
3. **注入态不是交互证据**：`injected-plan` 的报告自带该警示，且它只用于版式；交互结论只取 `real`。
4. **截图不是 1×**（0.7846×0.7820）：区域裁剪两侧各自归一化，像素比例因此可比，但不能把像素坐标当 CSS px。
5. **本轮无 bundle 新鲜度反证**：目标侧截图由共享开发者工具会话产生，未做 `close/open` 重编译（未获授权）。
   两侧 `codeVersion` 相同不等于"模拟器一定在跑这份代码"——这条按 `UNVERIFIED` 记。
6. **没有测量到的项**：真机（非模拟器）、375/414 宽度、滚动后区域、暗色模式、字体回退差异。

## 11. 需要裁决的三件事

| # | 问题 | 默认建议 |
|---|---|---|
| D1 | P1 走局部还是全局？ | **局部（P1a）**。全局 `*{box-sizing}` 会动已调好的 21 页，收益不抵风险 |
| D2 | 650/730 字重是否照写？（P3） | 先实测两平台再决定；未测前保持 `UNVERIFIED` |
| D3 | 头部 8px 与文案后缀这类差异，接受还是修？（P4/§10-2） | 修 P4；文案类按现状**接受并写明理由**，不要为了变绿去改文案 |
