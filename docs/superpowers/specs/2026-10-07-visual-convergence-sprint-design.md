# Weather V2 — Overnight Visual Convergence Sprint 设计规格

**日期:** 2026-10-07 · **状态:** 待用户评审 · **执行者:** Sisyphus（本会话亲自执行）

---

## 1. 背景与目标

前两轮的产出与缺口（考古结论，详见 SYNC.md:120）：

- zcode 的 Visual Fidelity Audit 因 GLM quota 中断，但其修复已全部落地（`fde5316`…`686fa7c`，master 与 origin 同步，工作区干净）。
- 功能/数学/测试面已全绿（38 套件 / 2488 断言 / 0 failed）。
- **但用户在真实 DevTools 中看到的核心视觉问题未解决**：蓝色降水柱像一排 UI 柱、Cloud Field 灰阶偏"灰色热力图"、375px 整体层级不够"成熟天气产品"。

**目标（唯一）：** 通过持续的「截图 → 判断 → 修改 → 测试 → 再截图」循环，把 DevTools 实际渲染的 Weather V2 收敛到冻结的 HTML/SVG 原型视觉质量，并在收敛后回答 §19 的问题——一个普通户外用户会不会认为这是"真正设计过的天气产品"。

**明确不是：** 一次 Audit、一次报告任务、"测试全绿即 PASS"。

---

## 2. 关键决策（已与用户确认）

| 决策 | 结论 |
|---|---|
| 执行者 | **Sisyphus 本会话亲自跑**（不派子 agent 执行循环、不回交 zcode）——看图判断由我能看图的主体完成，且不受 GLM quota 影响 |
| 工作方式 | **方案 C：baseline 前置 + 串行内联循环**（方案 A 的循环 + 强制先抓改前基线；方案 B 的并行 A/B 变体仅作单点问题的后备手段） |
| Git | **只 commit 不 push**。每轮视觉改动 KEEP 后本地 commit；天亮后用户拍板终审再 push。禁止 reset / hard reset / force push / 覆盖历史 / 删除 prototype 或截图 |
| DevTools | 本机 Mac 链路已验证：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli` 存在且 `{"login":true}`；用 `cli auto` + miniprogram-automator 自动截图，模板 `docs/e2e-mp/drive.js`，驱动库装在仓库外 |

---

## 3. 阶段划分

### Phase 0 — Baseline（先证据，后动手）

1. 记录 git 状态（branch/HEAD/最近提交/clean），不 reset。
2. 通读原型与渲染层：`docs/weather-ux/`（prototype / meteogram-html-prototype / meteoblue-web-poc / outdoor-intelligence）、`miniprogram/utils/{meteogram-svg,cloud-field-svg,weather-cloud-field,oi-presentation}.js`、`miniprogram/pages/weather/`。
3. 启动 DevTools 自动化，抓**改前**截图矩阵：
   - **375px 主矩阵**：理塘3500m / 峨眉山3079m / 成都500m × horizon 24/48/72 = 9 张（真实数据）
   - selected 06:00 / 16:00 点检
   - 390 / 414 抽查（24h + 72h）
   - 全部落 `screens/visual-convergence/baseline/`
4. 产出 **Visual Issue Ranking**（P0/P1/P2 排行榜，写入 iteration log 头部）。

### Phase 1..N — 视觉迭代循环（核心，预计 8–20 轮）

每轮严格按序：

```
取排行榜当前最高问题 → 修改 renderer/UI 层 → 相关专项测试 + check.js + check-handlers
→ DevTools 重截同机位 → 与 baseline/原型对比 → 我亲自判读
→ 明显改善？ 否→继续改同一问题；是→KEEP：写 iteration log + 本地 commit → 下一个问题
```

Iteration log 格式（`screens/visual-convergence/ITERATIONS.md`，每轮即时追加，不最后补写）：

```markdown
## Iteration N
Problem: …（排行榜项）
Hypothesis: …
Change: …（文件+要点）
Before: baseline/….png  After: iter-N-….png
Decision: KEEP / REJECT
Reason: …
```

**一轮只处理一个最大问题。** REJECT 也要留痕（截图与 log 不删）。

### Phase Final — 收口

1. 全套回归（38 门禁套件 + smoke + check/check-handlers）。
2. 生成最终 Screenshot Matrix：`screens/visual-convergence/final/`（375×3 地点×3 horizon 至少 9 张 + Before/After 至少 3 组：理塘16:00 / 峨眉山06:00 / 成都16:00 + 390/414 抽查）。
3. 新增自动化测试 `tools/weather-v2-visual-convergence-test.js`（断言本轮视觉改动的不变量；**不修改已有测试制造 PASS**）。
4. 更新 `docs/weather-ux/`：runtime rendering lessons / precipitation encoding / cloud field encoding / responsive constraints / horizon visual rules。
5. **Visual Convergence Report**（§24 十六项），最终裁决 **PASS / FAIL / CONDITIONAL PASS**——不因"功能完成"而 PASS。

---

## 4. 问题域优先级（初始排行榜种子，Phase 0 以实测截图重排）

1. **P0 — 蓝色降水柱**：bar width/opacity/saturation/color、selected bar、连续降水 vs 阵雨、POP≥50% 底带、与 Cloud Field 的间距、24/48/72 密度。禁止"只把蓝色变浅"；按 §6 的 A–F 方案实际做 A/B 截图比选后定稿。目标：一眼看出"何时下雨、多大"，但不成为全图最抢眼元素。
2. **P1 — Cloud Field 视觉权重**：五档灰阶的 opacity/compositing/clipping/rendering order 可调；深核表达力、浅云退让、层级清晰度、3500m YOU 线可见度、用户海拔附近轻微优先。
3. **P1 — 375px 层级**：左轴/右轴/时间轴/CF/降水/风/crosshair/day header，无裁切溢出重叠贴边。
4. **P1 — Crosshair 视觉重量**。
5. **P2 — OI presentation**：消除"值得关注"重复，改为 tier+type+time+evidence 的 editorial 层级（**不改 MODEL**）。
6. **P2 — 日期 header 密度 / 48-72h 压缩噪声**。

**最终层级目标**：L1 当前天气（温度/时间/状态）→ L2 天气变化（降水/CF/风）→ L3 OurTrail 解读（YOU/入云/OI）。CF 不得抢过温度，降水柱不得压过一切，crosshair 不得比数据抢眼。

---

## 5. 硬约束（红线）

- **不改**：真实天气数据、cloud cover values、pressure levels、`sky.js`、Cloud Field 核心数学、OI model 判断、Space-Time 几何。
- **可改**：presentation/rendering（fill/opacity/grayscale/compositing/clipping/order/width/color）、WXML/WXSS、OI 呈现层、页面组装层。
- **不重复**已被证伪的路径：Test C（2× supersample/root 包络）在微信 `<image>` 上无效（SYNC.md:120 已记录），不再重测。
- 375px 绝对第一优先级，成熟后再查 390/414。
- 性能预算：selection < 5ms、cache hit 近 0、24h SVG < 100KB、72h SVG 尽量 < 160KB；性能回退需记录并换方案。
- 每轮改动后跑相关专项测试；最终全套回归。**不为让测试通过而改测试。**
- 中断安全：每轮 KEEP 即 commit、log 即时落盘——session/provider 再挂不丢成果。

---

## 6. 完成条件（全部满足才 PASS）

A 375px 无明显布局问题 · B 蓝色降水柱不再成为视觉噪声 · C CF 像 atmospheric field 而非灰色热力图 · D 温度/降水/云/风构成统一 Meteogram 视觉语言 · E YOU 线成清晰空间参照 · F Crosshair 不抢视觉 · G 48/72h 无压缩噪声 · H OI 像 editorial recommendation · I 三真实地点均成立 · J 由 DevTools 实际截图（非浏览器 SVG）证明。

若任一不满足：**FAIL / CONDITIONAL PASS**，不得为结束任务宣布 PASS。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 会话/配额中断 | 每轮 KEEP 即 commit（不 push 即无远端污染），log 即时落盘 |
| 真实数据三地点不可达 | Phase 0 先验证；退化路径仅用于渲染验证并如实标注（不篡改数据） |
| 视觉判断主观偏差 | 每轮必须 Before/After 同机位对照 + 对照冻结原型，只认截图不认感觉 |
| 测试全绿但视觉仍差 | 完成条件只认 §6 十项与最终报告，测试仅作回归护栏 |
