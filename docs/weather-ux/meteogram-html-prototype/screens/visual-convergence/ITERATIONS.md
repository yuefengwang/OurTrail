# Visual Convergence Iterations — Weather V2

Baseline: cf89b94 · 2026-10-07 · 基线套件读数 38 套件 / 2488 断言（2026-10-07 记录，Task 5 复测确认）

- 基线矩阵：13 张 = 375 主矩阵 9（litang/emeishan/chengdu × 24/48/72）+ 375 选时 2（litang sel16 / emeishan sel6）+ 390 抽查 1（chengdu-24h）+ 414 抽查 1（litang-72h），全部真实数据（天气缓存过门，无 setData 合成）。
- 驱动：`~/.ourtrail-mp-auto/drive-shots.js` · ws 9421 · 微信开发者工具服务端口 61253 · 截图时机型 iPhone 6/7/8（375，localstorage index 1）。
- **收尾提醒：机型当前为 375，用户原设置是 index 7（iPhone 12/13 Pro，390）——Task 9 结束前用 `set-device.js` 还原。**
- 判读工具：`look_at` 本会话不可用（multimodal-looker 无响应），全部改用 `read` 直接读 PNG 逐张判读；对照物 `screens/horizon-{litang,emeishan,chengdu}-{24,48,72}-375.png` 与 `screens/375-default.png`。**对照物身份注（Iteration 4 核验）**：`horizon-*.svg` 是运行时 `meteogram-svg.js` 的输出快照（行标题 x=0 @ y=18/82/130/326 = Iter3 前坐标、day header 用 今天/明天/后天——HTML 原型 `meteogram.js` 两者皆无；screens/README「与小程序 `<image>` 逐字节一致的源图」自证），**不是 HTML 原型**；HTML 原型对照物是 `375-default.png` / `real-*.png` / `v1–v6/`。

## Visual Issue Ranking（Phase 0 实测产出）

### P0-1 蓝色降水柱（spec §4.1 首轮强制）

- **成都 24h（chengdu-24h-375px / chengdu-24h-390px）**：3 根深青柱 + 2 根浅柱挤在 11–14h，在近乎全空白（晴）的版面上是**全图唯一高饱和元素**——视线第一落点是降水柱而不是温度曲线。
- **理塘 48h（litang-48h-375px）**：深青柱簇（11–14h）叠在一块横跨 ~11–16h 的浅蓝 POP 底带上，**POP 块面积约为柱体 3 倍**，整块读作「一大片蓝」而非「几点雨」；litang-72h-414px 同款大 POP 块。
- **峨眉 72h（emeishan-72h-375px）**：Day3 连续柱成排出现，深青饱和 + 密度最高的样本。
- **对照原型**（horizon-chengdu-72-375 / horizon-litang-24-375）：结构同源（柱 + 浅蓝 POP 带），但基线柱体更宽、深青更饱和，**空图日（成都）把差距放大**。
- **选中态**（litang-24h-375px-sel16）：crosshair 穿过柱区时**未见柱体高亮**——selected bar 方案尚不存在，A/B 时一并设计。
- 方向按 spec §4.1 A–F 实做两轮比选（柱宽 / 饱和 / POP 不透明度与高度 / 连续雨 vs 阵雨分色 / 与 CF 间距），**禁止只把蓝色变浅**。

### P1-1 375px 左轴标签互撞与截断（spec §4 P1「375px 层级」）

- 「云量·高度 m」与 `6000` 刻度**逐字重叠**成乱码状（全部 9 张 375 主矩阵 + 390/414 抽查均复现）。
- 「风 km/h」被截成「风 k…」且与 `2000` 刻度重叠（同上全量复现）。
- 温度 hi/lo 双行刻度（成都 `23°/18°`、理塘 `7°/−2°`）与「降水 mm/h」标签及 `0.x` 刻度挤在同一行（chengdu-24h、litang-24h/48h/72h）。
- ~~原型同位置：标签与刻度**不叠字** → 这是小程序实现回归~~ **（Iteration 3 前提证伪；Iteration 4 对照物身份再修正）**：Iter3 所比的「冻结原型 SVG」实为 `horizon-*.svg` = **运行时渲染器快照**（见头部身份注）——HTML 原型 V3 起已删面板标题条、`meteogram.js` 行标题 **0 处**，故**行标题×刻度互撞是运行时独有**（标题为满足 visual-audit `x="0"` 契约保留），「原型同样叠字／共同设计缺陷」表述不成立；刻度×刻度互叠（temp 三档 4px）才是原型同款恒等。375 绝对第一优先级下「首轮必修 + Iter3 挪标题 KEEP」结论不变（Iteration 3 处置见下）。

### P1-2 Cloud Field 视觉权重

- **成立的部分（KEEP 方向）**：理塘 24h 高层深核（≈5000–5800m）是图内第一主角，与原型一致；峨眉 sel6 的 YOU 琥珀段清晰可读。
- **问题**：成都 72h 右侧深灰块下探 2500m 以下，压住「你 · 500 m（剖面下方）」标签右端（chengdu-72h-375px）；峨眉 72h 中部大斜带灰阶过渡偏糊、深核边界拖尾比原型 horizon-emeishan-48 长（需同数据对照确认是否数据差异而非渲染差异）。
- **白色斜纹缝隙**（emeishan-72 / chengdu-72 灰块内斜向白缝）：与原型 horizon-chengdu-72 **同款**（等值带拓扑同源），暂记非缺陷，迭代中复核。
- **Iteration 4 关闭（2026-10-08）**：三子项均非渲染缺陷——① YOU 标签运行时与 horizon 同款 paint-order 白描边，fresh 重拍完整可读（灰块邻近≠遮挡）；② 「拖尾比原型 horizon-emeishan-48 长」的对照无效（horizon=运行时快照且 48 vs 72 窗口+数据批次不同；`cloud-field-svg.js` 自基线零漂移、`meteogram-svg.js` 仅 Iter1/Iter3 改动）；③ 白斜纹与 horizon 同款拓扑维持非缺陷。无改码，本项关闭；KEEP 方向（理塘深核主角、峨眉琥珀段）不变。详见 Iteration 4。

### P1-3 小时 chip 网格挤占首屏 + 读数条层级倒置

- `weather.wxml` 顺序为 `cf-hours → cf-readout`：0..N 方形 chip 阵列插在图表与读数条之间——24h 占 3 行、48h ≥4 行、**72h 达 7 行（litang-72h-375px 见 0–56+）**，读数条与图例被推到折叠线以下。
- 原型**没有这个网格**：点图即读，图下直接是读数条/图例（horizon-*-375）。chip 方块（白底描边圆角）也是全页最「组件库」的元素，与工程图气质冲突。
- 附带疑点：未选中时读数条疑似空灰条（chengdu-24h 图下圆条无文字）——待核验是否 ro-l1 空态。

### P1-4 Crosshair 选中层与原型对齐

- **（Iteration 6 更正）** 原条目前提被证伪：白圆原型同参存在（`meteogram.js` L705，r=2.3）；chip 高亮随 Iter5 删 cf-hours 网格已消失；列洗 0.035、竖线 0.5/0.4、时间牌 22×11 双侧同参。真实缺口是**反向的**——运行时缺原型三件克制小高亮（降水柱 outline 0.7 / 风圆 r=2·0.8 / 阵风圆 r=1.7·0.7），Iteration 6 补齐。

### P2-1 OI presentation 去重（Task 4 专章）——**前提证伪，Task 4 关闭（2026-10-08）**

- ~~chengdu-48h 底部已见「今天值得关注」卡；重复情况需滚到页尾补拍核验，Task 4 处理（只动 `oi-presentation.js`，禁改 model）。~~
- **实测证伪**：48/72h 不是「重复」而是**整卡缺失**——`applyWeather` 按 `viewSpan` 互斥构建（24h→`oiCard`，48/72h→`oiHorizon`），但 WXML 外层 gate 只有 `wx:if="{{oiCard}}"`，horizon 卡被整块挡死（probe：`oiCard=false oiHorizon=true`，`.oi-card count=0`）；且 `.oi-card count=0` 自 `18bbb3a`（早于基线）即如此。设计意图佐证 `docs/weather-ux/outdoor-intelligence/README.md` L42-43（Phase 4 明文定义 horizon 卡按日分组）。
- **Phase-0 矛盾（记录不追查）**：排名「chengdu-48h 底部已见卡」与代码史矛盾（gate 从一开始就挡死，不可能见到），无法解释，以现状取证为准。
- **反向缺陷（真机实证）**：24h `onOiTap` 死接线——元素传 `data-hour`、handler 只读 `dataset.h` → NaN 早退，tap 全部无效（`probe-oi-tap.js`：修复前 tapZone/oi-item 快照不变；修复后双 CHANGED=true）。
- **范围调整（先例同 P1-4）**：改码落在页面表现层 `weather.wxml` / `weather.js`（外层 gate、agenda 过滤、`onOiTap` 双键兜底），非排名预设的 `oi-presentation.js`——后者零改动，model/sky 红线未触。
- 留置不处理：`weather.wxml` L266 `oiMultiDay` 分支从未赋值（死分支，删之超范围）。

### P2-2 图例形态 —— **已收敛（2026-10-08，Iteration 7 KEEP）**

- ~~基线 = 单行纯文字 caption（「灰阶 = 云量等值带…」）；原型 = 两行带色块/图标图例（horizon-litang-24 底部）。收敛候选，低优先。~~
- **已实现**：`weather.wxml` caption → 两行 `.chart-legend`（行1 图形变量 swatch / 行2 约定解释），色值全部走 token（3 个复用 + 5 个 `--chart-*` 新增 = SVG 运行时字面量双写，已登记 design-system.md）。首轮 4 行溢出、收间距后 375px 恰 2 行（见 Iteration 7 专章）。
- 偏差记录：行2 保留「琥珀段 = 你在云中」（原型 README 边界为「不进图例」；基线 caption 原有此句，属保留非新增）；「10→100%」按原型 V4 图例压缩决策降级为「淡→浓」。

### P2-3 48/72h 压缩噪声 —— **证据关闭（2026-10-08，Iteration 8 CLOSE）**

- ~~网格线与风箭头密度较 24h 高，但与原型同构，暂未见明显劣化；迭代中复核，不预设问题。~~
- **复核结论**：48/72h 真机三张（chengdu-48/72 + litang-72）与冻结原型 `horizon-chengdu-72-375.png` 同窗对照——网格 6h 一标签、风箭头 2-3h 一支、日分隔线、day header hi/lo 彩标全同构，无叠字/截断/糊化，无劣化，无改码关闭（见 Iteration 8）。附带核验：P2-2 两行图例在 48/72h 同样恰好 2 行。

## Iteration 0（基线，非迭代）

Problem: 基线留档
Before: baseline/（13 张：litang-{24,48,72} + litang-24-sel16 + litang-72-414 + emeishan-{24,48,72} + emeishan-24-sel6 + chengdu-{24,48,72} + chengdu-24-390）
Decision: KEEP（存档）
Reason: 后续每轮的对照物

## Iteration 1 — P0-1 降水柱 · 变体 A

Problem: 深青双柱是全图唯一高饱和元素（成都 24h 空图最抢眼）、柱体偏宽，视觉权重压过温度曲线。
Hypothesis: 按 plan §4.1 变体 A —— 柱体加 fill-opacity 0.55（#346583/#2E8B8B 保底色相不动，白底上视觉读作低饱和冷色）+ 柱宽收窄 15%（0.31→0.2635 列宽系数），降水回到「何时下雨」的功能指示位，不再抢主角。
范围: 仅 `meteogram-svg.js` 降水双柱 rect；POP≥50 底带、色相、数据、测试契约不动。
对照: chengdu-24h（空图日柱最抢眼）+ litang-48h（柱簇+POP 块）同机位重拍 vs baseline vs 原型 horizon-chengdu-72-375。

### Iteration 1 — Change / Before / After / Decision

Change: `meteogram-svg.js` 降水双柱 `fill-opacity="0.55"` + 柱宽系数 0.31 → 0.2635（min 1.5px 保护保留）；色相/POP 底带/数据不动。
Before: baseline/chengdu-24h-375px.png、baseline/litang-48h-375px.png（深青柱为全图唯一高饱和元素）
After: iter-1-chengdu-24h-375px.png、iter-1-litang-48h-375px.png（柱明显减重变窄，「何时下雨」仍一眼可读，POP 带未被误伤）
Decision: KEEP / Reason: 达到变体 A 预期——降水回到功能指示位不抢主角；无新问题；check.js + check-handlers + meteogram-svg-test 25/0 全绿。
备注: 按 plan §4.1 A/B 各做一轮再比选——本条是候选 A，Iteration 2 做候选 B 后一并比选定稿。

## Iteration 2 — P0-1 降水柱 · 变体 B

Problem: 变体 A 已减重但仍是静态权重——需要验证「常态退为底纹、选中才高亮」是否比恒定中等权重更符合层级目标。
Hypothesis: 按 plan §4.1 变体 B —— 柱宽再窄（0.2635 → 0.20 列宽）+ 基础层所有柱退为底纹（fill-opacity 0.3），选中小时的柱在 crosshair 选中层以全不透明重绘高亮；「何时下雨」由底纹给出，「此刻多大」由选中高亮给出。
范围: 仅 `meteogram-svg.js` 基础层柱 opacity/宽度 + 选中层新增选中柱重绘；数据/色相/POP 带/测试不动。
对照: 同机位 chengdu-24h + litang-48h，与 Iteration 1（候选 A）+ 原型三方比选。

### Iteration 2 — Change / Before / After / Decision

Change: 基础层柱 fill-opacity 0.55 → 0.30、柱宽 0.2635 → 0.20；选中层新增选中小时柱全不透明重绘。
Before: iter-1-*.png（变体 A）
After: iter-2-chengdu-24h-375px.png、iter-2-litang-48h-375px.png（柱成苍白底纹）
Decision: REJECT / Reason: 默认态（未选中）下柱太弱——成都空图日「何时下雨」不再一眼可辨；理塘 48h 里 POP 底带反而比柱更抢眼，层级倒挂。spec §4.1 目标「一眼看出何时下雨、多大」变体 B 不达标。**变体 A 胜出，P0-1 定稿为 Iteration 1 状态。**
回滚: `git checkout -- miniprogram/utils/meteogram-svg.js`（本轮未提交改动，回到 70a8258 = 变体 A）

## Iteration 3 — P1-1 375px 左轴标签互撞与截断

Problem: 「云量·高度 m」压 `6000 m`、「风 km/h」被 `2000` 刻度叠成「风 k…」、温度双行刻度贴「降水 mm/h」、降水 max 刻度贴行标题——全部 375/390/414 截图复现，是 P1-1。
Hypothesis: 行标题（x=0）与刻度（x=L-5 end 锚定）在同一 y 带水平相撞 + L=38 给刻度的余量不足。先读冻结原型 SVG 的真实布局（轴字号/位置/标题是否并入刻度），按原型方式重排，不发明新样式。
约束: `weather-v2-visual-audit-test.js:57` 要求存在 `x="0"` 行标题——可以移位不可删除。

### Iteration 3 — 前提证伪 + Change / Before / After / Decision

前提证伪: 冻结对照 SVG 与运行时**坐标逐项相同**（标题 y=18/82/130/326、刻度锚点 x=L-5、L=38）→ 当时据此判「原型同款叠字，是共同设计缺陷而非实现回归」。**（Iteration 4 更正）**：该对照 SVG 实为 `horizon-*.svg` = 运行时渲染器自身快照，比对是运行时 vs 运行时；HTML 原型（`meteogram.js`）V3 起已删面板标题条、行标题 0 处，行标题×刻度互撞实为**运行时独有**。修复动作与 KEEP 结论不受影响（挪走的是真实运行时叠字），仅「共同设计缺陷」定性作废，已同步修正至上方 Ranking P1-1。
冲突清单（CJK 字形 ≈ y−7.2..y，数字 ≈ y−5.4..y）: 降水标题 82 ↔ max 86.5（~1px）；云量标题 130 ↔ precip `0` 128.5（重 ~5px）、↔ `6000 m` 134.5（~1px）；风标题 326 ↔ cloud `2000` 324.5（重 ~5px）。temp 三档 62.5/66.5/70.5 互叠 4px 系数据无关恒等（tzTop=56/tzBot=72 仅 16px），原型同款，**判定出本轮范围，仅记录**。
Hypothesis: 行标题移入各行左侧 gutter 净空带（各行 y+12~+16），保持 x=0/字号/颜色不变——刻度一字不动，只挪标题。
Change: `meteogram-svg.js` L416-419 四行标题 y：18→36（`ROWS.iconTemp.y+16`）、82→100（`ROWS.precip.y+16`）、130→148（`ROWS.cloud.y+16`）、326→340（`ROWS.wind.y+12`）；x=0、font-size 7.5、fill 不动；行顶注释改为记录避让原因的中文注释。
测试约束核查: visual-audit 只钉 `<text x="0"` 存在性（x 未动）+ L−5≥26（L=38 未动）；meteogram-svg-test 只钉 crosshair `y1="18"`（L456 独立于标题，标题用 `y=`）；grep 全 tools/ 无任何断言钉标题 y 或文案。四套门禁实跑：check ✓ / check-handlers ✓ / meteogram-svg 25/0 / visual-audit 38/0。
Before: baseline/chengdu-24h-375px.png、baseline/litang-24h-375px.png（标题贴行顶压最近刻度）
After: iter-3-litang-24.png、iter-3-chengdu-24.png（放大裁图判读：`0.1`→`降水 mm/h`→`0`→`6000 m`→`云量 · 高度 m`→5000/4000/3000/2000→`风 km/h`→45/23/0 全链相邻字形净距 ≥4px；三条分隔线与标题净距 ≥11px；云量标题尾部越 L=38 的 ~3px 压云带风险两地点 6000m 一带均为空白，未兑现；温度标题与图标 x 向错开）
Decision: KEEP / Reason: P1-1 三个复现点（云量/风/降水标题互撞）全部消除；温度标题同步归位保持四标签同构；temp 三档互叠为原型同款恒等，按范围约束不动；四套门禁全绿；无新问题。截断问题（「风 k…」）同因消除——叠字源移走后标题完整可读。

## Iteration 4 — P1-2 Cloud Field 视觉权重（证据关闭，无改码）

Problem: P1-2 三个子项需在现行构建上核验——① 成都 72h 右侧深灰块是否压住「你 · 500 m（剖面下方）」标签右端；② 峨眉 72h 中部大斜带拖尾是否比 horizon-emeishan-48 长（渲染差异 vs 数据差异）；③ 灰块内白色斜纹是否缺陷。附带核验对照物 `horizon-*` 的真实身份与 Iter3 修复在 72h 的保持性。
Hypothesis: 三子项均非渲染缺陷——① YOU 标签运行时与 horizon 同款 paint-order 白描边（`meteogram-svg.js` ↔ `meteogram.js` 同一编码），灰块邻近≠遮挡；② `horizon-*.svg` 实为运行时渲染器快照（非 HTML 原型），48 vs 72 窗口与数据批次都不同，「比原型长」的对照本身不成立；③ 等值带拓扑同源，同渲染器同款。
证据（2026-10-08，375 机位、真实数据、门禁过后重拍）:
- 环境注记: 首轮截图 GATE-FAIL（dayCards=0，`cloud.callFunction:fail Error: access_token missing`，DevTools 云凭证失效）→ 全量重启开发者工具（quit + pkill → open → auto 9421）后 gate READY（dayCards=7，updatedAt 09:33）；非代码问题。
- 对照物身份: `horizon-*.svg` 行标题 `x="0"` @ y=18/82/130/326（= Iter3 前运行时坐标）+ day header 用 今天/明天/后天（`meteogram-svg.js:424` 同源，`meteogram.js` 0 处）→ = 运行时快照；HTML 原型 V3 起删面板标题条，`meteogram.js` 行标题 0 处。已同步修正头部身份注 / Ranking P1-1 / Iter3 前提证伪段。
- 渲染器漂移: `git diff cf89b94..HEAD -- miniprogram/utils/cloud-field-svg.js` 为空（最后改动 ef35517 在基线前）；`meteogram-svg.js` 仅 19 行（Iter1 降水柱 + Iter3 标题 y）。
- ① 标签: fresh 裁图（成都 72h label/tight + 峨眉 3,079 m）白描边完整、全字可读；灰块邻近未遮挡。
- ② 拖尾: fresh 峨眉 72h 与 horizon-em72 同窗对照结构同源（48h 对照窗口不可比）；hi/lo 读数差异 = 数据批次差。
- ③ 白斜纹: fresh 两地点裁图与 horizon 同款（marching-squares 等值带拓扑），维持非缺陷。
- 保持性: 72h 左轴四行标题与刻度全链净距清晰（Iter3 修复跨窗口成立）；temp 三档互叠仍为记录在案的出范围项（原型同款恒等）。
- 门禁（无改码复跑）: check.js ✓ / check-handlers weather ✓（19 handlers）/ meteogram-svg-test 25/0 / weather-v2-visual-audit 38/0。
范围: 无 Change——三子项均非红线内可修的渲染缺陷，不改码（CF 核心数学本身也在红线内）。
对照: baseline/chengdu-72h-375px.png、baseline/emeishan-72h-375px.png vs 本会话 fresh 重拍（同机位同参数）。

### Iteration 4 — Change / Before / After / Decision

Change: 无代码改动；仅本文档（Iteration 4 条目 + 对照物身份四处修正）。
Before: baseline/chengdu-72h-375px.png、baseline/emeishan-72h-375px.png
After: iter-4-chengdu-72.png、iter-4-emeishan-72.png（09:34 重拍归档：标签可读、左轴净空、斜带/斜纹与 horizon 同款、无新问题）
Decision: CLOSE（证据关闭，无改码故无回滚对象）/ Reason: ①③非缺陷（白描边按设计工作、拓扑同款）；②对照物身份与窗口差异解释全部形状差，渲染器自基线零漂移；KEEP 方向不变，P1-2 关闭。

## Iteration 5 — P1-3 小时 chip 网格挤占首屏 + 读数条空态

Problem: `cf-hours` 方形 chip 阵列插在图表与读数条之间——24h 占 3 行、48h ≥4 行、72h 达 7 行（baseline/litang-72h-375px 见 0–56+），读数条与图例被推到折叠线以下；且未选中时读数条是四行全空的灰条（baseline/chengdu-24h-375px，`unified.readout` 文案写在 JS 里但 WXML 从未渲染）。HTML 原型无 chip 网格：点图即读，图下直接是读数条。
Hypothesis: 删网格 + `.cf-stage` 整条 bindtap（`onCfTap` 坐标反解列 → 与 OI/看图共用 `selectHour` 链路）+ 读数条空态渲染 `unified.readout` 提示，三件事一次收敛；选时能力不丢（OI tap 区仍走 selectHour）。
范围: `weather.wxml`（删 cf-hours 块、cf-stage 加 bindtap、读数条 wx:if/wx:else）/ `weather.wxss`（删 .cf-hours/.cf-hour、加 .ro-hint）/ `weather.js`（`onCloudHour` → `onCfTap`、`hours: field.times` 删除、readout 文案改「点图上任意小时查看读数。」）；测试零依赖（grep tools/ 无 unified/cf-hour/onCloudHour 引用）。
坐标手法（同 `meteogram.js onTap`）: `e.detail.x` 页面坐标 − `.cf-stage` `boundingClientRect().left` → ×`geo.width/rect.width` 归一 → `h = floor((x − L) / (plotW/horizon))` 钳位 `[0, horizon−1]` → `selectHour(addDays(date, ⌊h/24⌋), cfPad(h%24)+':00')`。

### Iteration 5 — Change / Before / After / Decision

Change: `weather.wxml` L119-135（cf-stage `bindtap="onCfTap" hover-class="button-hover"`；删 10 行 cf-hours 网格；读数条 `<block wx:if="{{unified.r1}}">` 四行 + `wx:else` 提示）；`weather.wxss` 删 `.cf-hours`/`.cf-hour`/`.cf-hour.on`（11 行）、加 `.ro-hint`（11px var(--muted)）；`weather.js` `onCloudHour` → `onCfTap`（坐标反解 + 静默降级）、card 删 `hours: field.times`、readout 文案改「点图上任意小时查看读数。」。
测试: 四套门禁实跑 check ✓ / check-handlers weather ✓（19 handlers，onCfTap 解析到）/ meteogram-svg 25/0 / visual-audit 38/0；e2e-ui/e2e-ui-state/golden-path grep 无 cf-hour 引用。
证据（2026-10-08，375 机位、真实数据、改码后 cli close→open→auto 重开重拍）:
- 默认态: iter-5-chengdu-24h（3 行 chip → 0，读数条显示提示不再空灰）、iter-5-litang-72h（7 行 chip → 0，读数条+图例直接跟图）。
- 点图链路硬校验: `drive-shots --stage-tap` tap `.cf-stage` 后轮询 `unified.r1 && selSrc` 双落地才截图，否则退出码 3 —— 实跑 exit 0，日志 `stage-tap absHour=10 r1=10:00 · 21° 阴`；iter-5-chengdu-24h-375px-tap 裁图见 crosshair 10:00 绿时刻度 + 读数三级全填（10:00 · 21° 阴 / 云量 87% · 云区 2,150–2,325 m / 风 5 km/h · 阵 15 · 北风）。
- 48/72h 选时: OI tap 区（data-hour）仍走 selectHour，drive-shots selHour 改走该路径，未命中如实记 `sel-miss` 不冒充。
Before: baseline/chengdu-24h-375px.png、baseline/litang-72h-375px.png
After: iter-5-chengdu-24h-375px.png、iter-5-litang-72h-375px.png、iter-5-chengdu-24h-375px-tap.png
Decision: KEEP / Reason: P1-3 两个复现点全消（chip 网格 0 行、读数条空态有提示文案）；点图即读对齐原型且有硬校验证据；选时能力未丢（OI 区 + 点图两路共用 selectHour）；四套门禁全绿；无新问题（hover-class 用全局 button-hover，无新色值）。

## Iteration 6 — P1-4 Crosshair 选中层与原型对齐

Problem: P1-4 排名前提是「白圆/chip 高亮是运行时额外元素、原型只有细线+时间牌+轻列洗」。逐参核对冻结原型 `meteogram.js` ⑨ 段后前提**证伪**：白圆 r=2.3、列洗 0.035、竖线 0.5/0.4、时间牌 22×11 全部双侧同参；chip 高亮随 Iter5 删 cf-hours 网格已消失。真实缺口反向——运行时选中层缺原型的三件克制小高亮：降水柱 outline（0.7 描边）、风速交点圆（r=2/0.8）、阵风交点圆（r=1.7/0.7），选中时读不出「此刻降水多大、风/阵风在曲线哪个位置」。
Hypothesis: 按原型 ⑨ 段逐参补齐三件高亮，选中层即与原型同构；不降重（原降重前提已失效），不发明新样式。
范围: 仅 `meteogram-svg.js` `renderUnifiedSelection` 选中层新增三段图元；基础层/数据/sky/OI/几何与测试契约不动。

### Iteration 6 — Change / Before / After / Decision

Change: `meteogram-svg.js` +15 行（temp 白圆后、时间牌前）——① 降水 outline：`p+sh≥0.05` 时描边框住基础层实际双柱并四周留 1px（`bw` 柱宽系数 0.2635 与基础层同源；**不复用 yPrec**——其 h-4 刻度与柱高 h-6 不同源，注释已记录）；② 风圆 r=2 sw=0.8、③ 阵风圆 r=1.7 sw=0.7（`geo.wind.y(row.wind||gust)`，null→0 与基础层曲线同源）；④ `geo.wind` 缺失整体跳过（48/72h 回退画布不受影响）。
测试: 新增 stroke-width 0.7/0.8/0.7 与断言的 `stroke-width="0.5"` 计数不冲突（meteogram-svg-test L45 split===2、multiday L123 count===1 各自仍过）。四套门禁实跑：check ✓ / check-handlers weather ✓ / meteogram-svg 25/0 / visual-audit 38/0。
证据（2026-10-08，375 机位、真实数据、改码后 cli close→open→auto 重开重拍；`drive-shots` 已升级 waitSel 硬校验——轮询 `unified.r1 && selSrc` 双落地否则退出码 3，OI tap 未命中如实记 `tap-miss→api` 不冒充）:
- 降水正例: 峨眉山 sel12（r1=12:00 · 17° 毛毛雨 · 降水 1.7 mm，探针 `probe-precip.js` 选定小时）——iter-6-emeishan-24h-sel12-{before,after} 全图 + 裁图 iter-6-crop-em12-precip-{before,after}：Before 裸双柱，After 墨绿 1px 描边框住选中小时双柱。
- 风/阵风圆四对: litang13（iter-6-crop-wind13-{before,after}：Before 裸曲线，After 双白圆骑在风/阵风曲线上）+ litang16 / emeishan6 / emeishan12 同判（crops 留 `~/.ourtrail-mp-auto/shots/iter6-crops/`）。
- 条件渲染: 理塘 sel13 无降水（探针 litang NONE）→ 无 outline，正确；`litang13-wind-*` 裁图对 md5 相同系裁剪脚本误用同源，未入库，以 `wind13-*` 与全图为准。
- 附带观察（非本轮引入，Before/After 同现，留作后续）: 理塘读数 r2 出现「海拔 undefined m 云量 null%」——`weather.js` 读 `u.geo.userAlt` 与 `inferState` cUser 在该数据形状下未取到值，既有隐患，另开一轮处理。
Before: iter-6-emeishan-24h-sel12-before.png、iter-6-litang-24h-sel13-before.png（选中层仅竖线+temp 白圆+时间牌+列洗）
After: iter-6-emeishan-24h-sel12-after.png、iter-6-litang-24h-sel13-after.png + 4 张裁图（三件高亮全部落地，参数与原型 ⑨ 段一致）
Decision: KEEP / Reason: P1-4 排名前提证伪并更正（见 Ranking）；反向缺口补齐后选中层与原型同构；四套门禁全绿；无新问题（无新色值，全部 #163e35/token 白）。

## Task 4 — P2-1 OI 去重 · 前提证伪与反向缺陷修复

Problem: P2-1 排名前提是「chengdu-48h 底部已见『今天值得关注』卡，重复需核验」。实测前提**证伪**——48/72h 不是重复而是**整卡缺失**：`applyWeather` 按 `viewSpan` 互斥构建（24h→`oiCard`，48/72h→`oiHorizon`），WXML 外层 gate 却只有 `wx:if="{{oiCard}}"`，horizon 卡（含按日分组 L2、timeline、silenceNote）被整块挡死（probe：`oiCard=false oiHorizon=true`，`.oi-card count=0`；自 `18bbb3a` 即如此，早于基线）。设计意图佐证 `outdoor-intelligence/README.md` L42-43。附带发现第二个真机缺陷：24h `onOiTap` 死接线——元素传 `data-hour`、handler 只读 `dataset.h` → NaN 早退，时间轴/列表 tap 全部无效（只能靠 `selectHour` api 回退）。
Hypothesis: 外层 gate 放宽为 `oiCard || oiHorizon` 并给 24h 专属块加互斥门，horizon 卡即渲染且 24h 块不串位；`onOiTap` 双键兜底（`ds.h ?? ds.hour`）恢复 tap 联动；agenda L2 过滤扩至 `oiHorizon` 完成 48/72h 去重（原过滤只看 `oiCard`，48/72h 下永真 → L2 与 horizon 卡重复）。
范围: 仅 `weather.wxml`（外层 gate / astroNote 三元 / 24h timeline 门 / oi-list 门 / silenceNote 门）与 `weather.js`（agenda 过滤 L607 扩 `oiHorizon`、`onOiTap` 双键兜底）。**`oi-presentation.js` / model / sky 零改动**（范围调整：改码落在页面表现层，非排名预设文件，先例同 Iteration 4/6 的排名更正）。

### Task 4 — Change / Before / After / Decision

Change: ① `weather.wxml` L141 外层 `wx:if` → `{{oiCard || oiHorizon}}`，astroNote 改三元取活跃卡；② 24h timeline 块加 `wx:if="{{oiCard}}"`、oi-list 门改 `{{viewSpan === 24 && oiCard}}`（防切窗瞬时 `viewSpan` 已翻、卡数据未翻的 `null.items`）、silenceNote 门改 `{{oiCard && oiCard.silenceNote}}`；③ `weather.js` L607 agenda 过滤 → `(unified && (oiCard || oiHorizon))`；④ `onOiTap` 读键 `ds.h != null ? ds.h : ds.hour` 双兜底（24h 元素 `data-hour`、horizon 元素 `data-h`）。标题「今天值得关注」保持静态（48/72h 无设计规格文案，最小 diff）。
测试: 门禁 7 套实跑——check ✓ / check-handlers weather ✓（19 handlers）/ meteogram-svg 25/0 / visual-audit 38/0 / weather-page 136/0 / multiday 44/0 / **outdoor-intelligence-ui 46 过 1 败**。该败例（`applySelection 命中 IN_CLOUD 窗口` L118）**与本任务无关**：`git stash` 后在 HEAD 同败（隔离证实）；`probe-incloud.js` 归因——测试实时抓取今日真实预报，`items[0]` 银河窗口 00:00–05:00 与 `items[2]` IN_CLOUD 03:00–04:00 重叠，`applySelection(3)` 首匹配被银河抢走（数据依赖的既有测试脆弱性，非回归；红线不改测试制造 PASS，留记录）。grep 确认无测试 pin `data-hour`/`onOiTap`/`oiCard`/agenda 过滤。
证据（2026-10-08，375 机位、真实数据、改码后 cli close→open→auto 重开）:
- 48h 卡渲染: `probe-oi.js` `.oi-card count: 1`（修复前 0）、`oiHorizon=true oiGroups=2`、`.oi-title found: true`；截图 task4-before/chengdu-48h（纯 agenda，无卡）→ task4-after/chengdu-48h（「今天值得关注」horizon 卡 + 今天/明天分组 + timeline 全渲染）。
- 24h tap 恢复: `probe-oi-tap.js`（已修伪阴性——tapZone 先选中 item[0] 同小时，直接再点快照必同；改为先 `selectHour` 挪到 10:00 再点回 00:00）——tapZone CHANGED=true、oi-item CHANGED=true、selectHour api CHANGED=true；48h 视图 `data-h` tap 同 CHANGED=true。
- 24h 无回归: task4-24h（修复前）vs task4-after/chengdu-24h（修复后）逐张对照——卡内容、timeline、silenceNote、下方 agenda 完全一致。
- 留置: `weather.wxml` L266 `oiMultiDay` 死分支（从未赋值）；「海拔 undefined m 云量 null%」既有隐患（Iter6 已记，另开一轮）；Phase-0 排名与代码史矛盾（见 Ranking，记录不追查）。
Before: ~/.ourtrail-mp-auto/shots/task4-before/chengdu-48h-375px.png、~/.ourtrail-mp-auto/shots/task4-24h/chengdu-24h-375px.png
After: ~/.ourtrail-mp-auto/shots/task4-after/chengdu-{48h,24h}-375px.png
Decision: KEEP / Reason: P2-1 前提证伪（去重→整卡缺失）并按设计文档修复渲染；反向缺陷 24h 死 tap 同轮修复且真机三信号全通；24h 像素级无回归；6/7 门禁全绿，唯一败例 stash 隔离 + probe 归因为既有数据依赖，非本轮引入。

## Iteration 7 — P2-2 图例形态 · 两行 swatch 图例

Problem: 统一 Meteogram 卡图注是单行纯文字 caption（`weather.wxml` L134「灰阶 = 云量等值带（浅→深 = 10→100%）· 虚线 = 此点海拔 · 琥珀段 = 你在云中 · 箭头 = 风向（吹向）」），与原型两行带色块图例不同构：文字说「灰阶」读者看不见色阶、说「琥珀段」看不见琥珀色，图上五种曲线/柱色（温度/降水/阵雨/风速/阵风）零图例。
Hypothesis: 按原型 `renderLegend()` 两行结构重写——行1 图形变量（swatch + 标签）、行2 约定解释（虚线/琥珀/箭头）；swatch 色值全走 token：`--ink`(#202A26=C.temp)、`--info`(#346583=C.rain)、`--forest`(#163E35=C.you) 三个既有复用，showers/wind/gust/inCloud/ramp 新增 `--chart-*`（值 = `meteogram-svg.js` `C` 色板与 `cloud-field-svg.js` `BANDS` 字面量双写，同步契约先例同 `--golden`）；字号 10px（本页 `.chip-tag`/`.day-*` 已有先例，原型 8.5px 等比）。375px 卡内宽 303px（page 20×2 + card 16×2）下首轮宽度估算临界，预留 flex-wrap 兜底。
范围: `weather.wxml` L134 一处（L111 经典 canvas caption 不动，`.chart-caption` 类保留供其使用）；`weather.wxss` 新增 `.chart-legend` 段；`app.wxss` `--blue-hour` 后 +5 token；`design-system.md` token 表 +3 行。数据/sky/OI/SVG 几何/测试零改动。

### Iteration 7 — Change / Before / After / Decision

Change: ① `weather.wxml` 单行 caption → `<view class="chart-legend">` 两行 `.lg-row`——行1：`[ramp] 云量 淡→浓 · [ink]温度 · [info]降水 · [showers]阵雨 · [wind]风速 · [gust]阵风`，行2：`[dashed] 虚线 = 此点海拔 · [amber] 琥珀段 = 你在云中 · ↗ 箭头 = 风向（吹向）`；② `weather.wxss` +22 行（`.chart-legend` 10px/16 var(--muted)、`.lg-row` flex-wrap、`.lg-item`、`.sw-ramp` 34×9 渐变带、`.sw-line` + 修饰类、`.sw-dash`/`.sw-amber`/`.sw-arrow`），附同步契约中文注释（改色三处同步，同 --golden 先例）；③ `app.wxss` +9 行 5 token（`--chart-showers #2E8B8B` / `--chart-wind #3D8A7F` / `--chart-gust #9FC4D8` / `--chart-in-cloud rgba(180,118,26,0.65)` / `--chart-ramp` 五档灰阶 linear-gradient）附「SVG 拿不到 var() 只能双写」同步注释；④ `design-system.md` +3 行登记。
首轮溢出与修正: 首轮渲染 4 行（行1 尾「阵风」折行、行2 尾「箭头」折行——两行均超 303px；该轮截图未留档，/tmp 被终版覆盖，如实记录）。收间距复拍：`.lg-item` margin 6→4、`.sw-line` 14→12 且 margin 3→2、`.sw-ramp` margin 3→2、`.lg-dim` 3→2 → 第二轮两地点均恰好 2 行。
测试: 门禁 8 项实跑——check ✓ / check-handlers weather ✓（19 handlers）/ meteogram-svg 25/0 / cloud-field-svg 27/0 / visual-audit 38/0 / weather-page 136/0 / weather-v2 45/0 / outdoor-intelligence-ui 46 过 1 败（`applySelection 命中 IN_CLOUD 窗口` 既有数据依赖败例，Task 4 已 stash 隔离归因，不重复）。cloud-field-svg 链跑中曾单次 26/1（未捕获 ✗ 行），其后独立复跑 5 次全 27/0 → 判为性能断言类偶发 flake；本轮 diff 仅 4 文件（wxml/wxss/app.wxss/design-system.md），未触 `cloud-field-svg.js` 任何字节。grep 复核：tools/ 无断言钉本图例文案/类名/`--chart-*` token。
证据（2026-10-08，375 机位、真实数据、改码后 cli close→open→auto 重开两轮重拍）:
- 行数: iter-7-chengdu-24h-375px.png、iter-7-litang-24h-375px.png —— 行1「▬ 云量 淡→浓 ─温度 ─降水 ─阵雨 ─风速 ─阵风」、行2「┈ 虚线 = 此点海拔 ─ 琥珀段 = 你在云中 ↗ 箭头 = 风向（吹向）」，各恰 2 行，无第三行、无截断、无横向溢出。
- 色对齐: 温度墨黑(--ink=C.temp)、降水蓝(--info=C.rain)、阵雨青(--chart-showers=C.showers)、风速深青(--chart-wind=C.wind)、阵风浅蓝(--chart-gust=C.gust)、ramp 五档灰阶与云场面板同带(=BANDS)、虚线森林绿(--forest)、琥珀橙(--chart-in-cloud=C.inCloud)——截图逐一目视与 SVG 字面量同值。
- 已知偏差（记录）: 行2 含「琥珀段 = 你在云中」与原型 README「你不进图例」边界不一致——基线 caption 原有该句，属保留非新增；「10→100%」按原型 V4「图例压缩」决策降级为「淡→浓」。
Before: baseline/chengdu-24h-375px.png、baseline/litang-24h-375px.png（单行纯文字 caption）
After: iter-7-chengdu-24h-375px.png、iter-7-litang-24h-375px.png（两行 swatch 图例，375px 恰 2 行）
Decision: KEEP / Reason: 原型两行结构落地且 375px 恰 2 行收口；色值零发明（3 个既有 token 复用 + 5 个新 token 全部 = SVG 运行时字面量双写并登记 design-system.md）；7/8 门禁全绿 + 1 既有败例归因不重复；无新问题（L111 经典 caption 与其 `.chart-caption` 类未触）。

## Iteration 8 — P2-3 48/72h 压缩噪声（证据关闭，无改码）

Problem: P2-3 排名前提「网格线与风箭头密度较 24h 高，但与原型同构，暂未见明显劣化；迭代中复核，不预设问题」——48/72h 下时间轴标签 00/06/12/18 每日重复、风箭头行跨 48/72h 排布，需核验是否比 24h/原型有可见劣化（标签叠字、箭头糊成一片、行挤压）。
证据（2026-10-08，375 机位、真实数据、无改码复拍）:
- runtime 三张: iter-8-chengdu-48h-375px.png（两日头）、iter-8-chengdu-72h-375px.png、iter-8-litang-72h-375px.png（三日头）——时间轴 00/06/12/18×日 无叠字无截断；风箭头约 2-3h 一支、方向可辨未糊化；日分隔强线与 day header（今天/明天/后天 + hi/lo 彩标）齐全。
- 对照冻结原型: `screens/horizon-chengdu-72-375.png` 同窗逐项对照——网格 6h 一标签、箭头密度、日分隔、day header 全部同构；原型图上多出的选中态 crosshair 时间牌（明天 14:00）系其截图带选中，非密度差异。
- 附带核验: P2-2 两行图例在 48/72h 同样恰好 2 行（iter-8 三张全现），跨 viewSpan 保持。
- 已知出范围项（复现但不动）: temp 轴 23°/19° 两档互叠为 Iteration 3 记录在案的原型同款恒等。
- 门禁（无改码）: 沿用 P2-2 轮全套 8 项结果——本轮 diff 仅 ITERATIONS.md + 3 张截图；提交前 check.js 复跑。
范围: 无 Change——排名前提即「不预设问题」，复核后无劣化，不改码（先例同 Iteration 4）。

### Iteration 8 — Change / Before / After / Decision

Change: 无代码改动；仅本文档（Ranking P2-3 关闭注 + 本条目）+ 3 张证据截图入库。
Before: 无（非改码轮；基线同机位对照见 baseline/chengdu-48h-375px.png、baseline/chengdu-72h-375px.png）
After: iter-8-chengdu-48h-375px.png、iter-8-chengdu-72h-375px.png、iter-8-litang-72h-375px.png（对照物 horizon-chengdu-72-375.png）
Decision: CLOSE（证据关闭，无回滚对象）/ Reason: 48/72h 网格/箭头/日分隔与原型同构无可见劣化；P2-2 图例跨 viewSpan 保持 2 行；P2-3 关闭，Ranking 已同步。

## Iteration 9 — 真机读数 bug 修复 ·「海拔 undefined m 云量 null%」+ 解读行缺失

Problem: 统一卡选中小时后第二行读数打出 `海拔 undefined m 云量 null%`，第三行 OurTrail 解读（你在云中/头顶有云层）整行不渲染（375px 真机截图实证，见 before 图）。Iter6 已记录该隐患、Task 4 收尾留置「另开一轮」，本轮兑现。
根因（代码取证，非猜测）: `weather.js` `applyUnifiedSelection` 读 `u.geo.userAlt`，但 `meteogram-svg.js` `buildUnified` 返回体把海拔嵌在 `cloud.userAlt` 下、**顶层没有 userAlt** → 两处读到 `undefined`：① `inferState(sample, hour, undefined, covered)` 三路比较（inCovered/belowHi/aboveLo）全为 false → `key`/`cUser` 恒 null → r3 恒空、r2 走 else 分支；② `cfFmtM(undefined)` 与 `null + '%'` 裸拼串把 `undefined`/`null` 打到屏上。null 与 undefined 在 `inferState` 内语义不同（`undefined-200=NaN` → key 恒 null；`null-200=-200` 可跑出 mid），故 elevation 缺失时须传 `undefined` 保持「无解读」语义，不能传 null。
范围: 仅 `weather.js` 两处（L670 inferState 取值源 + L681 r2 拼串 null 守卫，附中文 bug 现场回归注释——规则 18）+ `tools/weather-page-test.js` 新增 §11b。**不改** meteogram-svg 返回形状、inferState/denseSpanAt 阈值、sky/OI/CF 任何数学。

### Iteration 9 — Change / Before / After / Decision

Change: ① `weather.js` `applyUnifiedSelection` 内取 `const userAlt = u.geo.cloud && Number.isFinite(u.geo.cloud.userAlt) ? u.geo.cloud.userAlt : undefined`，`inferState` 改传 `userAlt`；② r2 else 分支两处 null 守卫 → `'海拔 ' + (userAlt != null ? cfFmtM(userAlt) : '—') + ' m 云量 ' + (st.cUser != null ? st.cUser + '%' : '—')`；③ `weather-page-test.js` §11b 三形态 13 断言——A（3500m 在覆盖区内 → `海拔 3,500 m 云量 65%` + 你在云中）、B（云量 80% 厚层 → span 云区行 `3,150–3,750 m`——span 不依赖 userAlt，**改前即绿 = 回归护栏**）、C（500m 在覆盖区下 → `海拔 500 m 云量 —` + 头顶有云层），三形态各带 r1-r4 无 undefined/null 泄漏断言。
测试: §11b 改前红 7 / 绿 6（A r2/r3/泄漏、B r3、C r2/r3/泄漏红；B r2 护栏绿），全文件 142 passed/7 failed；修复后 **149 passed/0 failed**。门禁 38 套全量实跑：37 绿 + `outdoor-intelligence-ui` 46 过 1 败（`applySelection 命中 IN_CLOUD 窗口` L118，Task 4 已 stash 隔离归因的既有数据依赖败例，非本轮引入）；`check.js` ALL CHECKS PASSED、`check-handlers.js weather` 19 handlers ✓。`cloud-field-svg` 链跑单次 26/1（未捕获 ✗ 行）后独立复跑 27/0——判为性能断言偶发 flake（同 Iteration 7 记录），本轮 diff 未触其字节。
证据（2026-10-08，375 机位、真实数据、改码后 cli close→open→auto 重开）:
- 理塘（elevation 3500）: r2 `海拔 undefined m 云量 null%` → **`海拔 3,500 m 云量 0%`**（数字干净）；r3 为空是正确语义——13:00 用户海拔处云量 0%、无 in/sea/mid 信号，不编解读（r2 的 0% 证明 userAlt 已正确进入 inferState）。
- 成都（elevation 500，C 形态）: r2 **`海拔 500 m 云量 —`**（em-dash 而非 null%）+ r3 **`→ 头顶有云层` 解读行渲染出现**（改前整行缺失）——r3 恢复的直接实证。
- 375px 无回归: 分段控件/坐标轴/图例/读数四行全部完整无溢出（两张 after 图）。
Before: iter-9-litang-24h-sel13-before.png（`海拔 undefined m 云量 null%`、r3 缺失）
After: iter-9-litang-24h-sel13-after.png、iter-9-chengdu-24h-sel13-after.png
Decision: KEEP / Reason: bug 根因取证确凿（字段路径错误 + 裸拼串），修复最小（2 处取值/守卫，渲染数学零改动）；测试先红后绿（7 红 → 0 红，B 形态护栏改前即绿防误伤）；38 套门禁除既有归因败例全绿；真机双地点前后对照实证 r2/r3 均恢复。
