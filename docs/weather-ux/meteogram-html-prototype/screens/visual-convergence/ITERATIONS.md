# Visual Convergence Iterations — Weather V2

Baseline: cf89b94 · 2026-10-07 · 基线套件读数 38 套件 / 2488 断言（2026-10-07 记录，Task 5 复测确认）

- 基线矩阵：13 张 = 375 主矩阵 9（litang/emeishan/chengdu × 24/48/72）+ 375 选时 2（litang sel16 / emeishan sel6）+ 390 抽查 1（chengdu-24h）+ 414 抽查 1（litang-72h），全部真实数据（天气缓存过门，无 setData 合成）。
- 驱动：`~/.ourtrail-mp-auto/drive-shots.js` · ws 9421 · 微信开发者工具服务端口 61253 · 截图时机型 iPhone 6/7/8（375，localstorage index 1）。
- **收尾提醒：机型当前为 375，用户原设置是 index 7（iPhone 12/13 Pro，390）——Task 9 结束前用 `set-device.js` 还原。**
- 判读工具：`look_at` 本会话不可用（multimodal-looker 无响应），全部改用 `read` 直接读 PNG 逐张判读；对照物 `screens/horizon-{litang,emeishan,chengdu}-{24,48,72}-375.png` 与 `screens/375-default.png`。

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
- ~~原型同位置：标签与刻度**不叠字** → 这是小程序实现回归~~ **（Iteration 3 前提证伪）**：逐项比对冻结原型 SVG 与运行时坐标——标题 y、刻度锚点、L 值**完全相同**，原型同样叠字，只是 1x 截图模糊不易察觉。P1-1 是**共同的设计缺陷**而非小程序实现回归，但 375 是绝对第一优先级，此项与 P0-1 并列首轮必修的结论不变（Iteration 3 处置见下）。

### P1-2 Cloud Field 视觉权重

- **成立的部分（KEEP 方向）**：理塘 24h 高层深核（≈5000–5800m）是图内第一主角，与原型一致；峨眉 sel6 的 YOU 琥珀段清晰可读。
- **问题**：成都 72h 右侧深灰块下探 2500m 以下，压住「你 · 500 m（剖面下方）」标签右端（chengdu-72h-375px）；峨眉 72h 中部大斜带灰阶过渡偏糊、深核边界拖尾比原型 horizon-emeishan-48 长（需同数据对照确认是否数据差异而非渲染差异）。
- **白色斜纹缝隙**（emeishan-72 / chengdu-72 灰块内斜向白缝）：与原型 horizon-chengdu-72 **同款**（等值带拓扑同源），暂记非缺陷，迭代中复核。

### P1-3 小时 chip 网格挤占首屏 + 读数条层级倒置

- `weather.wxml` 顺序为 `cf-hours → cf-readout`：0..N 方形 chip 阵列插在图表与读数条之间——24h 占 3 行、48h ≥4 行、**72h 达 7 行（litang-72h-375px 见 0–56+）**，读数条与图例被推到折叠线以下。
- 原型**没有这个网格**：点图即读，图下直接是读数条/图例（horizon-*-375）。chip 方块（白底描边圆角）也是全页最「组件库」的元素，与工程图气质冲突。
- 附带疑点：未选中时读数条疑似空灰条（chengdu-24h 图下圆条无文字）——待核验是否 ro-l1 空态。

### P1-4 Crosshair 视觉重量

- 选时实况（sel16/sel6）四件套：竖线 + 温度曲线交点**白圆** + 绿色时间牌 + 下方 chip 高亮；原型只有「细线 + 绿时间牌 + 轻列洗」。白圆与 chip 高亮是额外中等强度元素，列洗在截图里几乎不可见。A/B 时降重。

### P2-1 OI presentation 去重（Task 4 专章）

- chengdu-48h 底部已见「今天值得关注」卡；重复情况需滚到页尾补拍核验，Task 4 处理（只动 `oi-presentation.js`，禁改 model）。

### P2-2 图例形态

- 基线 = 单行纯文字 caption（「灰阶 = 云量等值带…」）；原型 = 两行带色块/图标图例（horizon-litang-24 底部）。收敛候选，低优先。

### P2-3 48/72h 压缩噪声

- 网格线与风箭头密度较 24h 高，但与原型同构，暂未见明显劣化；迭代中复核，不预设问题。

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

前提证伪: 冻结原型 SVG 与运行时**坐标逐项相同**（标题 y=18/82/130/326、刻度锚点 x=L-5、L=38）→ 原型同款叠字，「实现回归」表述已同步修正至上方 Ranking P1-1。这不是回归修复，是**共同设计缺陷的修复**。
冲突清单（CJK 字形 ≈ y−7.2..y，数字 ≈ y−5.4..y）: 降水标题 82 ↔ max 86.5（~1px）；云量标题 130 ↔ precip `0` 128.5（重 ~5px）、↔ `6000 m` 134.5（~1px）；风标题 326 ↔ cloud `2000` 324.5（重 ~5px）。temp 三档 62.5/66.5/70.5 互叠 4px 系数据无关恒等（tzTop=56/tzBot=72 仅 16px），原型同款，**判定出本轮范围，仅记录**。
Hypothesis: 行标题移入各行左侧 gutter 净空带（各行 y+12~+16），保持 x=0/字号/颜色不变——刻度一字不动，只挪标题。
Change: `meteogram-svg.js` L416-419 四行标题 y：18→36（`ROWS.iconTemp.y+16`）、82→100（`ROWS.precip.y+16`）、130→148（`ROWS.cloud.y+16`）、326→340（`ROWS.wind.y+12`）；x=0、font-size 7.5、fill 不动；行顶注释改为记录避让原因的中文注释。
测试约束核查: visual-audit 只钉 `<text x="0"` 存在性（x 未动）+ L−5≥26（L=38 未动）；meteogram-svg-test 只钉 crosshair `y1="18"`（L456 独立于标题，标题用 `y=`）；grep 全 tools/ 无任何断言钉标题 y 或文案。四套门禁实跑：check ✓ / check-handlers ✓ / meteogram-svg 25/0 / visual-audit 38/0。
Before: baseline/chengdu-24h-375px.png、baseline/litang-24h-375px.png（标题贴行顶压最近刻度）
After: iter-3-litang-24.png、iter-3-chengdu-24.png（放大裁图判读：`0.1`→`降水 mm/h`→`0`→`6000 m`→`云量 · 高度 m`→5000/4000/3000/2000→`风 km/h`→45/23/0 全链相邻字形净距 ≥4px；三条分隔线与标题净距 ≥11px；云量标题尾部越 L=38 的 ~3px 压云带风险两地点 6000m 一带均为空白，未兑现；温度标题与图标 x 向错开）
Decision: KEEP / Reason: P1-1 三个复现点（云量/风/降水标题互撞）全部消除；温度标题同步归位保持四标签同构；temp 三档互叠为原型同款恒等，按范围约束不动；四套门禁全绿；无新问题。截断问题（「风 k…」）同因消除——叠字源移走后标题完整可读。
