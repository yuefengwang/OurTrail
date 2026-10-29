# UI Alignment Review: Pass（三处已改并真机回读；两条 polish 待裁决）

## Summary

天气 V3 详情页（`pages/weather-hub` → `components/weather-detail`）与 `docs/prototypes/ourtrail-explore-v3/weather.html` 的对照里，**改前证据**（IDE 模拟器 306×660 截图 / 390 CSS 宽）暴露三处问题：逐时图把一整段干窗印成 8 组「0.0 / 0%」，云层剖面脚注四行里有三行在复述轴行与图例已经说过的话，页头节点行在**加载中与取数不成立**两态下只剩一个图钉（弹层还是空的）。**三处本轮都已改掉。**

改后**已按授权重编译并在 IDE 模拟器回读**（`close --project` → `open` → `auto`，**未** `quit`）：真实取数两例（折多山干窗 / 峨眉山有雨窗）+ 注入生产形状地点两态（加载在途 / 日期超范围）共 **21 条断言全 ✓**，像素 6 张，bundle 新鲜度由新文案与新行为自证。证据档 **E3**（截图 + DOM/组件读数），不是「只有静态门」。

仍未闭合的两件事：① 物理手机与 375/414 宽度未覆盖；② 两条 polish（首页空态留白、风行标签节奏）属设计判断，未动。

## Reference Mapping

- Screen / route：`pages/weather-hub`（单页两屏：`wx:if` 选点页 / `wx:else` 详情页，`weather-hub.wxml:150-161`）；屏 2 由 `components/weather-detail` 承载，四个镜像 tab：逐时预报 / 云层剖面 / 沿途天气 / 日月天相
- Reference：`docs/prototypes/ourtrail-explore-v3/weather.html` + `weather.css`（用户自有、未跟踪，只读引用；行号以本工作树为准）。原型只提供视觉词汇，不是逐像素基准——V3 的已裁决差异见「Acceptable Differences」
- Implementation：`miniprogram/components/weather-detail/*`、`miniprogram/utils/weather-v3-hourly-svg.js`（逐时图为纯 SVG 字符串 → data URI → `<image mode="widthFix">`）
- Viewport / device scale：IDE 模拟器 390 CSS 宽（截图 306×660，约 0.785 缩放）；375 / 414 未取。改前帧来自 18:51 会话（auto 9421），改后帧来自授权重编译后的 20:2x 会话（auto 9431）
- Mode：conformance（改前实现 vs 原型）+ regression（改后 vs 改前基线，仅纯函数与浏览器渲染两层）
- Dynamic regions / masks：无遮罩。截图里的时间戳（18:52 / 20:27）、真实预报数值、`Open-Meteo` 来源徽标属动态内容，不作为对齐判据。**改前与改后帧同为真实取数**：改前帧出自 `capture-v3c.js` 的 `enterDetail(PLACE, {hour:13, period:24, tab})`，改后帧出自 `tools/drive-after.js` 的 `goPoint(…)`，两条都走线上 `trailApi.getWeather` → Open-Meteo（`eleSource: 'manual'` 只声明海拔出处）。折多山与峨眉山的当日逐时值另经 API 直查复核：干窗 24/24 全 0、峨眉山 14 小时有降水 ⇒ 两种窗口都真实存在，不是造出来的对照

## Must Fix

### ① 逐时图：一整段干窗被印成 8 组「0.0 / 0%」

- Category: data（信息密度 / 事实重复）
- Evidence: `h-a.png`、`h-b.png`（改前，逐时 tab 与滚动后的图例区）。降水行 8 个标注位全是 `0.0`，概率行 8 个全是 `0%`，24 小时里没有一根柱——同一句话印了 16 遍，把温度线下方整条带填成噪声
- Observed: 逐格标注；`LABEL_EVERY = 3`（`weather-v3-hourly-svg.js:42`）⇒ 24h 窗口 8 组
- Expected: 一个窗口级事实只说一次，且**不删事实**：改成带范围的一句话，列位置/网格/轴行都不动
- Likely cause: 降水段只有「逐时画柱 + 每 3 小时标一次数」一条路径，没有「整段都干」的形态
- Recommended frontend fix（已实施）：`weather-v3-hourly-svg.js:326` 新增 `drySpan`——`list.length > 0` 且 `rain/pops` **每一小时都 `fin` 且全为 0** 才压缩；`if (drySpan)` 时只画 `text(2, Y.precipValueY + 21, list.length + ' 小时降水 0 · 概率 0%', 10, C.muted, 'start')`（`:330`），否则原样走逐格柱与标注（`:331` 起的 else 分支一行未改）。**有任何缺测就退回逐格**：缺测仍是 `—`，不能被合进这句话里
- Designer decision needed: 无（事实不删，只改印法）
- Verification:
  - `weather-v3-hourly-svg-test` 121/0，新增 §3b 9 条：整段干 ⇒ 一句话且 0 个 `>0.0</text>`、0 个 `>0%</text>`、0 个 `<rect x=`；48h 窗口文案随之变 `48 小时…`；**9 点缺测 ⇒ 不合并**、8+8 个标注、出现 `>—</text>`；**4 点 0.2mm ⇒ 不合并**、24 根柱；概率全 20% 且降水 0 ⇒ 不合并
  - `mutate-weather-v3` 18/0（M11「关掉压缩」、M12「无视有没有雨一律合并」各被抓到，0 漏网）
  - 真实数据证明分支会被走到：Open-Meteo 30.0512 / 101.8156、2026-10-28（Asia/Shanghai）24 小时 `precipitation` 与 `precipitation_probability` **全为 0**（`readings.json` → `postChange.realDataDryWindow`）
  - 形态：`preview-dry-vs-wet.png`（生产构建器直出，同屏对照）
  - **真机回读（E3）**：`tools/drive-after.js` 用例 A 真实折多山 ⇒ 组件 `hourlySrc` 解码后 `data-seg="precip"` 内 `>0.0</text>` **0 个**、`>N%</text>` **0 个**、`<rect x=` **0 根**、出现「24 小时降水 0 · 概率 0%」、全图 `>—</text>` 0 个（本例无缺测）；用例 B 真实峨眉山 ⇒ 同一位置 **24 根柱 / 3 个 `0.0` / 8 个概率标注**、**不出现**窗口级一句话（双向证明，不是只测「减了」）。像素 `after-dry-top.png` 与 `after-wet-top.png`

### ② 云层剖面脚注：四行里有三行在复述轴上与图例已经印过的内容

- Category: typography（文案密度）
- Evidence: `h-b.png`（改前脚注四行）。层界 `≤3km / 3–8km / ≥8km` 已印在三条轴行上；「颜色越深＝云量越多（图例 0–100%）」正下方就是 0/50/100% 的图例；「每 3 小时印一个整数」是图的节奏，读一眼就知道
- Observed: 4 行 10px 灰字，其中 3 行与同屏其它元素重复
- Expected: 只留**图上和轴上都读不到**的四件事实：口径出处、高度是海平面以上（含「低云含雾」一句，轴行只印 `≤3km` 说不出来）、不是云底/云顶、带内横线＝缺测
- Likely cause: 脚注把「解释图怎么读」写成了完整清单，没有和轴行 / 图例去重
- Recommended frontend fix（已实施）：`weather-detail.wxml:180` 压成一句
  > 高度区间按取数端点（Open-Meteo 逐时预报）的海平面以上（海拔）口径（低云含雾），不是这块云的云底或云顶。带里的颜色越深＝这一小时该层云量越多，每 3 小时印一个整数；带里那条横线＝这一小时没有该层读数，不是 0%。
- Designer decision needed: 无
- Verification: `weather-v3-structure-test` 133/0（脚注结构门要求保留的四个事实逐条仍在；改写时一度把「这块云」写成「这层云」被该门拦下 ⇒ 已还原措辞，**没有放松门**）；`page2-gates` 119/0、`swx1/swx2 style-gates` 45/111 全 0。**真机回读（E3）**：`after-dry-note.png` 里脚注 **5 行 → 3 行**（改前见 `h-d.png`），DOM `text` 读数含「（低云含雾）」、不含旧句「三层的高度区间」，也不含 `≤3km / 3–8km / ≥8km` 字面（这三项由 A5/A6/A7 三条断言判定，见 `after-readings.json`）

### ③ 加载中 / 取数不成立时，页头节点行只剩图钉与箭头（弹层还是空的）

- Category: state
- Evidence: `route-a-header-2x.png`（2× 最近邻放大，取自 `route-a.png` 同一帧）。页头「长坪沟·两日」下方那行是「图钉 + 空 + 箭头」，`.wv3-node` 的 `min-height: 27px` 把这块空位撑住，读起来像渲染坏了
- Observed: `placeSub` 为空串；同时 `nodeOptions` 只在成功装配时产出 ⇒ 这一行点开的节点弹层是空列表
- Expected: 无论取数成功与否，节点行都应有一句自己的文案，弹层也应能打开
- Likely cause（file:line）: `weather-detail.js` 的 `resetContext()` 只 `setData({ placeName, error, errorCode })`，**不写 `placeSub`**；而 `placeSub` / `nodeOptions` / `isPoint` 只在成功装配时由 `weather-v3-view.js` 产出。于是「正在查询」与「这次没取到」两态共用了一个空白节点行
- 已实施的修法（生产文件 2 个）：把「地点侧字段」抽成 view 的四个导出并**由两态共用同一个出处**——`isPointPlace` / `placeNameText` / `placeSubText` / `nodeOptionsOf`（[weather-v3-view.js:305](file:///D:/OurTrail/miniprogram/utils/weather-v3-view.js#L305)）；组件加 `syncHeader()`（[weather-detail.js:211](file:///D:/OurTrail/miniprogram/components/weather-detail/weather-detail.js#L211)）在 `resetContext()` 里调用，`onNodePick` 也调（无结果时 `rebuild()` 会静默返回，换节点后旧文案必须自己跟上）。成功装配的 `buildDetailView` 改成调同一批函数 ⇒ **占位句与数据到位后那句话是同一个字符串**，不是两份文案在赛跑。顺带修掉两个同源毛病：缺海拔仍印「海拔待确认」不印 0 m；节点没名字时不留悬空分隔符（旧输出是「 · 3,200 m」）
- Designer decision needed: 无（未新增状态词，全部复用现成词表：`未命名地点` / `海拔待确认`）
- Verification:
  - 纯函数与真组件：`weather-v3-structure-test` **133 → 144**（§9 十条：有名/无名/缺海拔/单点/半坐标/选中位 + 反复制门——组件 JS 里不得再出现坐标与「海拔待确认」「未命名地点」字面量，坐标格式化本体全仓只许出现一次）；`scenario-weather-v3-test` **59 → 71**（§8 十二条，走真组件 + 真 utils：在途、三次重试全失败、失败态换节点、成功装配与占位逐字相同）
  - 一条**既有静态门被本轮证伪并改写**：原检查用正则钉 `nodeOptions: allNodes.map(...)` 的**源码文本**，把表达式搬进具名函数（行为一模一样）就假红 ⇒ 按铁律 30① 改成打真实 `nodeOptionsOf` 读行为，没有删断言
  - 变异自证：`mutate-weather-v3` **18 → 24 / 0 漏网**，新增 **M13**（悬空分隔符回来）、**M14**（缺海拔印 0 m）、**M15**（弹层选中位恒指第一项）、**M16**（成功装配另拼一份页头文案 ⇒ 占位与装配分叉）
  - **真机回读（E3）**：`tools/drive-header.js` 10 条断言全 ✓——加载在途那一帧读到 `loading === true` 且节点行已是「取证观景台 · 3,800 m」（旧 bundle 此时是空串，所以这条同时是 bundle 新鲜度门），弹层 3 项勾在第 2 项；数据到位后逐字不变；日期超范围态（`errorCode = outOfRange`）节点行仍是「取证营地 · 3,500 m」，换节点后文案与选中位一起移动。像素 `after-header-loading.png` / `after-header-error.png`，读数 `header-readings.json`
  - 取证边界：地点是**注入的生产形状载荷**（三个命名节点，为的是让「节点名」这一支可判），天气与状态机走真实通路；未注入 `place = null` 的深链宿主（该宿主目前不存在）

## Polish

### ④ 首页空态：一句话之后是约一整屏的空白

- Category: spacing
- Evidence: `before-home.png`（个人计划 tab、无计划）。`wh-quiet`（`weather-hub.wxss:124`，`padding: 16px 0`）与 `wh-foot`（`weather-hub.wxml:146`，`padding: 12px 0 4px`）之后到 tab 栏是一大片空白
- Observed: 空态贴顶、页面留白全在下方
- Expected（建议，非缺陷）: 空态在剩余视口里居中，或把「选一条路线」做成一个可点的下一步；也接受保持现状（空态本来就该是空的）
- Recommended fix: 若采纳，把 `wh-quiet` 包一层 `min-height: calc(100vh - …)` 的容器做垂直居中——需先裁决，因为它改的是信息位置而不是样式收敛
- Designer decision needed: 是

### ⑤ 风行标签：方向前缀与裸速度交错，节奏不齐

- Category: typography
- Evidence: `h-a.png`、`h-b.png` 风行。标注每 3 小时一个（`LABEL_EVERY = 3`）、方向每 6 小时一个（`DIR_EVERY = 6`，`weather-v3-hourly-svg.js:42/44`），格式是 `(dirText ? dirText + ' ' : '') + 速度`（`:360`）
- Observed: 350px 宽时 cell ≈ 12.54px ⇒ 标注步长 ≈ 37.6px；带方向前缀的那几个标签墨宽明显更宽，与相邻裸数字不齐
- Expected: 不重叠即可（本轮实测/估算均未见碰撞）；若要更整齐，方向另起一行或改箭头
- Recommended fix: 不建议本轮动——方向词是「风从哪来」的事实，改成箭头要新增图形词汇，属设计变更
- Designer decision needed: 是（保持现状 / 方向另起一行 / 换箭头）

## Acceptable Differences

1. **日条卡片内部布局**：生产把「周几 / 日期 / 天气 / 活动日」四行竖排在 5 张等宽卡里（`weather-detail.wxss:45-67`，`.wv3-day` 为 flex column，`isActivityDay` 为假时用一个空格占位以保持等高等，`weather-detail.wxml:48-49`）；原型紧凑态用 `grid-template-columns:1fr 1fr` 把周几与日期并排，并 `.day-mark{display:none}`（`weather.css:22`）。生产多出的「活动日」行是有意保留的第三类事实
2. **24 小时一屏 vs 横向滚动**：生产 `FIT_HOURS = 24`、`cellFor()` 由可用宽度反推（`weather-v3-hourly-svg.js:37/88-92`），350px 图宽时 cell ≈ 12.54px；原型 `hour-buttons button{width:42px}` 横向滚动。已裁决，不重开
3. **逐时图例的 96px 色阶条**：原型 `cloud-ramp{width:112px}`（`weather.css` 云层刻度）只属于云层剖面，逐时图例是本轮之外的**生产侧新增**元素；宽度不向 112px 对齐（曾考虑，核对后撤回：原型里并不存在这个图例）
4. **「活动日」标记**：原型紧凑态隐藏，生产保留（见差异 1），用于路线/计划场景指明出发日

## Setup / Evidence Issues

- **改后像素已补，但过程有三次失败要如实记下**：本轮初版报告写「改后真机像素不存在」，用户选 A 授权后按 `close --project 'D:\OurTrail'` → `open`（**未** `quit`）→ `auto` 重编译回读。驱动自身缺陷（**不是产品红**，都在当场修掉后重跑）：① 先找 `weather-detail` 再 `goPoint` ⇒ 组件只在屏 2 的 `wx:else` 里，必然找不到；② `goPoint` 会被未就绪的页面静默吞掉 ⇒ 改成「按 `placeName` 回读确认，不确认就重试」；③ 两条断言把**映射后的数组**当原始对象读（`nodeOptions[1].indexOf(...)` / `nodeOptions === 3`）⇒ 报红的是探针不是页面，改成读原始 `selected` 字段后同一状态全 ✓。另有一次 `mp.screenshot()` 超时（两张 wet 帧由 `tools/shot-wet.js` 补拍并复核同源读数）；页头那轮第一次 `auto` 拿到 9431 后端口在连接前掉线 ⇒ 重新走一遍 close/open/auto 换 9432 才通
- **两轮取证的数据来源不同，分开算**：逐时图两例（折多山 / 峨眉山）是**真实取数**；页头两例（加载在途 / 日期超范围）的**地点是注入的生产形状载荷**（三个命名节点），天气与状态机仍走真实通路——因为「节点名 + 海拔」这句话只有多节点路线才判得出来，而真实路线的名字不受本轮控制
- **375 / 414 未取，物理手机未跑**：本报告所有宽度相关结论只对 IDE 模拟器 390 成立
- **沿途天气 tab 取证不全**：首轮驱动在该 tab 取数超时，`route-a.png` 与 `route-b.png` md5 相同 ⇒ 实际只拿到 1 帧有效状态；页头缺陷正好落在这一帧上，故额外做了 `route-a-header-2x.png`（System.Drawing 2× 最近邻）供判读
- **18 张改前帧作废并已隔离** `invalid/`：`before-hourly-*` 四张互相同 md5（tab 切换未生效）、`hourly-a` = `before-route-top`、`before-route-mid` = `before-sky-mid`、`h-e`/`h-f` 与 `h-d` 同 md5、`before-cloud-top/mid` 拍到的还是加载态。它们**不参与**本报告任何结论
- **改前读数的出处标注**：`readings.json` 的 `readout / cloudBounds / elevLabel / cloudSel / skyFacts / hours` 是 18:51 会话（auto 9421）的组件读数；`cloudSel.r3` 为空是因为该节点没有可信高程，属预期分支

## Artifacts

- Expected（参考）：`docs/prototypes/ourtrail-explore-v3/weather.html`、`weather.css`
- Actual（改前，唯一有效帧）：`h-a.png`（逐时首屏）、`h-b.png`（图例 + 旧脚注 + 三层云带）、`h-c.png`（scrubber + 六行读数）、`h-d.png`（同一页再滚一段：图例 + 旧脚注 + 读数 + 「云层在哪个高度」入口）、`cloud-a/b/c.png`、`sky-a/b/c.png`、`route-a.png` / `route-b.png`、`route-a-header-2x.png`、`before-home.png`
- 改后（非真机）：`preview-dry-vs-wet.png`（生产 `buildHourlySvg` 直出，width=350，干窗 vs 有雨）；复现脚本 `render-preview.js`，它生成的页面 `index.html`（两份 SVG 原样内联）
- 改后（真机 E3）：`after-dry-top.png`、`after-dry-note.png`、`after-wet-top.png`、`after-wet-note.png` + 读数 `after-readings.json` + 驱动 `tools/drive-after.js`、`tools/shot-wet.js`；页头两态 `after-header-loading.png`、`after-header-error.png` + 读数 `header-readings.json` + 驱动 `tools/drive-header.js`
- 读数：`readings.json`（改前组件读数 + `postChange`：真实干窗复取、门禁计数、浏览器渲染、设备 VERIFIED）、`after-readings.json`（逐时图 11 条）与 `header-readings.json`（页头 10 条）
- 作废帧：`invalid/`（18 张，清单见上）

## Verification Checklist

- [x] `node tools/weather-v3-hourly-svg-test.js` → 121/0（含新增 §3b 9 条）
- [x] `node tools/weather-v3-structure-test.js` → 144/0（含新增 §9 十条；一条钉源码文本的旧门按铁律 30① 改写为行为断言）
- [x] `node tools/mutate-weather-v3.js` → 24/0，M1–M16 **0 漏网**（锚点命中 ≠ 1 即计漏网）
- [x] `node tools/ab-weather-v3.js` → 47/0（已裁决差异的可见集合不变）
- [x] `node tools/weather-v3-visual-test.js` → 38/0
- [x] `scenario-weather-v3 71/0`（新增 §8 十二条）、`weather-page 227/0`、`page2-gates 119/0`、`meteogram-readability 87/0`、`weather-resilience 45/0`、`swx1 45/0`、`swx2 111/0`、`t4-e08 41/0`、`b4-pad-final-value 33/0`、`ui-consistency 19/0`、`journey-graph 15/0`
- [x] `node tools/check.js` → ALL CHECKS PASSED；`node tools/check-handlers.js` → 死 handler 仍只有存量 `editor#onNumber`
- [x] 真实取数确认压缩分支在生产数据上会走（24 小时降水/概率全 0）
- [x] **改后真机回读**：授权重编译后 `tools/drive-after.js` 11 条断言全 ✓（干窗压缩 + 脚注去重 + bundle 新鲜度 + 双向不压缩），像素 4 张
- [x] **页头占位真机回读**：`tools/drive-header.js` 10 条断言全 ✓（加载在途 / 日期超范围 / 失败态换节点），像素 2 张
- [ ] 375 / 414 宽度复测（未做）
- [ ] 物理手机（未做；本轮全部为 IDE 模拟器）
- [ ] 首页空态与风行标签的处置（Polish ④⑤，待设计裁决）
