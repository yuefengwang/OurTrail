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
- 原型同位置（horizon-litang-24-375）：标签落在面板角上、与刻度**不叠字** → 这是小程序实现回归，非设计差异。375 是绝对第一优先级，此项与 P0-1 并列首轮必修。

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
