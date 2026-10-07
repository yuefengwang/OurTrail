# Weather V2 Overnight Visual Convergence Sprint 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **本计划由 Sisyphus 在本会话内联执行**（spec 决策：不派子 agent 执行循环——视觉判读必须由能看图的主体完成）。

**Goal:** 把微信 DevTools 实际渲染的 Weather V2 通过「截图→判读→修改→测试→重截」串行循环收敛到冻结 HTML/SVG 原型的视觉质量，最终给出 PASS/FAIL/CONDITIONAL PASS 裁决。

**Architecture:** 方案 C——Phase 0 先抓改前基线截图矩阵 + 视觉问题排行榜，Phase 1..N 逐轮处理排行榜最高项（KEEP 才 commit），Phase Final 全套回归 + 最终截图矩阵 + 报告。所有产物落 `docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/`。

**Tech Stack:** 微信开发者工具 CLI（`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`，已验证 `{"login":true}`）+ miniprogram-automator（装在仓库外 `~/.ourtrail-mp-auto`）+ 零依赖 node 测试脚本 + 手机（目测判读由我执行）。

**Spec:** `docs/superpowers/specs/2026-10-07-visual-convergence-sprint-design.md`

**前置事实（已验证）:**
- 工作区 clean，HEAD `686fa7c`，与 origin 同步；**只 commit 不 push**
- 本机 DevTools CLI 存在且已登录
- 38 门禁套件 / 2488 断言全绿（基线读数）
- 原型基线图已存在：`docs/weather-ux/meteogram-html-prototype/screens/`（375-default、390-full、414-full、horizon-{litang,emeishan,chengdu}-24/48/72-375 等）

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `~/.ourtrail-mp-auto/drive-shots.js` | 截图驱动脚本（仓库外，零依赖铁律） | Create |
| `docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/ITERATIONS.md` | 视觉迭代日志（每轮即时追加） | Create |
| `.../visual-convergence/baseline/*.png` | Phase 0 改前基线 | Create |
| `.../visual-convergence/iter-N-*.png` | 每轮前后对比截图 | Create |
| `.../visual-convergence/final/*.png` | 最终截图矩阵 | Create |
| `miniprogram/utils/meteogram-svg.js` | 温度/降水/轴渲染（P0 降水主战场） | Modify |
| `miniprogram/utils/cloud-field-svg.js` | Cloud Field 灰阶渲染（P1 主战场） | Modify |
| `miniprogram/utils/oi-presentation.js` | OI 呈现层（P2，禁改 model） | Modify |
| `miniprogram/pages/weather/weather.wxml` / `.wxss` | 页面层级/排版（P1 375px） | Modify |
| `tools/weather-v2-visual-convergence-test.js` | 本轮视觉不变量回归测试 | Create |
| `tools/check.js` 等 38 套件 | 回归护栏（不改内容制造 PASS） | Run only |
| `docs/weather-ux/visual-convergence-notes.md` | runtime rendering lessons 等沉淀 | Create |

---

## Phase 0 — Baseline 与工具链（先证据，后动手）

### Task 1: DevTools 自动化链路打通

**Files:**
- Create: `~/.ourtrail-mp-auto/drive-shots.js`（仓库外目录）
- 参考: `docs/e2e-mp/drive.js`（现成模板）、`docs/e2e-mp/automation-playbook.md`（坑清单，动手前必读）

- [ ] **Step 1: 阅读 automation-playbook.md**

Run: `cat docs/e2e-mp/automation-playbook.md`
Expected: 掌握 `quit` vs `close`、旧句柄失效、busy 状态、退出码语义。

- [ ] **Step 2: 在仓库外初始化驱动环境（幂等）**

```bash
mkdir -p ~/.ourtrail-mp-auto && cd ~/.ourtrail-mp-auto
[ -f package.json ] || npm init -y
[ -d node_modules/miniprogram-automator ] || npm i miniprogram-automator
```
Expected: `node_modules/miniprogram-automator` 存在。**绝不把 node_modules 装进仓库。**

- [ ] **Step 3: 写截图驱动脚本 `~/.ourtrail-mp-auto/drive-shots.js`**

功能要求（完整代码骨架）：

```js
// ~/.ourtrail-mp-auto/drive-shots.js
// 用法: node drive-shots.js <wsEndpoint> <outDir> <width> <location> <horizon> [selectedHour]
// 依赖 miniprogram-automator；width=375|390|414；location=litang|emeishan|chengdu；horizon=24|48|72
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

async function main() {
  const [,, ws, outDir, width, location, horizon, hour] = process.argv
  if (!ws || !outDir || !width || !location || !horizon) {
    console.error('USAGE: node drive-shots.js <wsEndpoint> <outDir> <width> <location> <horizon> [hour]')
    process.exit(2)
  }
  const mp = await automator.connect({ wsEndpoint: ws })
  const page = await mp.reLaunch('/pages/weather/weather')
  await page.waitFor(4000)
  // 1) 注入观察点/选中状态：location → 真实三地点；horizon → 24/48/72；hour → selected
  //    真实数据不可用时 page.setData 合成数据（必须在迭代日志标注「合成」）
  //    注入门槛链（AGENTS.md 坑 #3）：denied=''、loading=false、loadingWeather=false、dayCards 非空
  //    spaceNodes 形态: [{t:'HH:mm', d:'YYYY-MM-DD', alt, name}]，不传 km
  await page.setData({ /* 见门檻链 */ })
  await page.waitFor(3000)
  // 2) 横向宽度由模拟器 viewport 控制（connect 后 setViewport 或 reLaunch 前配置）
  const raw = String(await mp.screenshot())
  const name = `${location}-${horizon}h-${width}${hour ? `-sel${hour}` : ''}.png`
  fs.writeFileSync(path.join(outDir, name), Buffer.from(raw, 'base64')) // 坑 #1: 必须 Buffer.from
  console.log('SAVED', name)
  await mp.disconnect() // disconnect 不 quit（playbook: quit 会杀 IDE）
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: 启动自动端口并连通**

```bash
cli close --project /Users/yfwang/OurTrail --port 33278 2>/dev/null || true
cli open  --project /Users/yfwang/OurTrail --port 33278
sleep 25
cli auto  --project /Users/yfwang/OurTrail --auto-port 9421 --trust-project --port 33278
```
Expected: 输出含 `autoPort`，记下 `ws://127.0.0.1:<port>`。若 33278 不对，先查实际服务端口（`cli islogin` 输出过 61253，二者都试）。

- [ ] **Step 5: 冒烟一张**

```bash
node ~/.ourtrail-mp-auto/drive-shots.js ws://127.0.0.1:<port> /tmp/visual-smoke 375 chengdu 24
```
Expected: `/tmp/visual-smoke/chengdu-24h-375.png` 存在且 >20KB；用 `look_at` 工具打开确认能看到 Meteogram。**若失败按 playbook 恢复（close+open 重启），不硬扛。**

### Task 2: Phase 0 基线截图矩阵 + Visual Issue Ranking

**Files:**
- Create: `docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/baseline/*.png`
- Create: `docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/ITERATIONS.md`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/{baseline,final}
```

- [ ] **Step 2: 抓 375 主矩阵 9 张（真实数据优先）**

```bash
WS=ws://127.0.0.1:<port>
OUT=docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/baseline
for loc in litang emeishan chengdu; do
  for h in 24 48 72; do
    node ~/.ourtrail-mp-auto/drive-shots.js "$WS" "$OUT" 375 "$loc" "$h"
  done
done
```
Expected: 9 张 png。三地点依赖真实观察点数据——若页面无数据，先按真实链路配置观察点（weather-hub 页），仍不可得则 setData 合成并在 log 标注。

- [ ] **Step 3: 抓 selected 06:00/16:00 点检 + 390/414 抽查**

```bash
node ~/.ourtrail-mp-auto/drive-shots.js "$WS" "$OUT" 375 litang 24 16
node ~/.ourtrail-mp-auto/drive-shots.js "$WS" "$OUT" 375 emeishan 24 06
node ~/.ourtrail-mp-auto/drive-shots.js "$WS" "$OUT" 390 chengdu 24
node ~/.ourtrail-mp-auto/drive-shots.js "$WS" "$OUT" 414 litang 72
```
Expected: 4 张。

- [ ] **Step 4: 判读全部基线截图，产出 Visual Issue Ranking**

用 `look_at` 逐张打开 baseline + 对照 `screens/horizon-*-375.png`（原型）与 `screens/375-default.png`。按 spec §4 模板排序 P0/P1/P2，写入 `ITERATIONS.md` 头部：

```markdown
# Visual Convergence Iterations — Weather V2
Baseline: 686fa7c · 2026-10-07 · 基线套件读数 38/2488

## Visual Issue Ranking（Phase 0 实测产出）
P0-1: <蓝色降水柱实况描述 + 出现在哪些截图>
P0-2: <...>
P1-1: <...>
...
## Iteration 0（基线，非迭代）
Problem: 基线留档
Before: baseline/….png
Decision: KEEP（存档）
Reason: 后续每轮的对照物
```

- [ ] **Step 5: Commit 基线**

```bash
git add docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/
git commit -m "test(weather-v2): Visual Convergence 基线截图矩阵 + 问题排行榜（Phase 0）"
```
Expected: clean tree，ahead 3。

---

## Phase 1..N — 视觉迭代循环（核心；预计 8–20 轮）

### Task 3: 单轮迭代标准操作（重复执行单元）

> 本 Task 是**循环体**，每轮按序执行一次。每轮只处理排行榜当前最高项。

**Files:**
- Modify（按问题域）: `miniprogram/utils/meteogram-svg.js`（降水）/ `miniprogram/utils/cloud-field-svg.js`（CF 灰阶）/ `miniprogram/pages/weather/weather.wxss`（375px 层级）/ `miniprogram/utils/oi-presentation.js`（OI，仅呈现层）
- Create: `screens/visual-convergence/iter-N-*.png`、ITERATIONS.md 追加

- [ ] **Step 1: 取排行榜最高未处理项，写下假设**

在 ITERATIONS.md 追加 `## Iteration N` + Problem + Hypothesis。

- [ ] **Step 2: 修改渲染/presentation 层（红线内）**

红线（spec §5）：不改真实数据 / sky.js / CF 数学 / OI model / Space-Time；375px 优先。
P0 降水首轮候选（spec §4.1，A/B 各做一轮再比选）：
- 变体 A: 低饱和冷色 + opacity 0.55 + 柱宽收窄 15%
- 变体 B: 柱宽再窄 + 仅 selected 高亮，其余退为底纹

- [ ] **Step 3: 跑相关专项测试 + 静态门禁**

```bash
node tools/check.js && node tools/check-handlers.js
node tools/meteogram-svg-test.js   # 按问题域选: cloud-field-svg / weather-cloud-field / outdoor-intelligence-ui / weather-v2-visual-audit
```
Expected: `ALL CHECKS PASSED` + 该套件 0 failed。**失败则修码不修测试。**

- [ ] **Step 4: 重启 DevTools 编译并截同机位 after 图**

坑 #2：**改完必须 `cli close` + `cli open` 重开**，否则模拟器用旧 bundle（上一轮因此误判很久）。

```bash
cli close --project /Users/yfwang/OurTrail --port 33278
cli open  --project /Users/yfwang/OurTrail --port 33278 && sleep 25
cli auto  --project /Users/yfwang/OurTrail --auto-port 9421 --trust-project --port 33278
node ~/.ourtrail-mp-auto/drive-shots.js ws://127.0.0.1:<port> <.../visual-convergence> 375 <同一地点> <同一horizon>
```
Expected: `iter-N-*.png` 落盘。

- [ ] **Step 5: 并排判读 before/after + 原型**

用 `look_at` 同时打开 `baseline/*.png`、`iter-N-*.png`、原型 `screens/horizon-*.png`。回答：**是否明显改善且不引入新问题？**

- [ ] **Step 6a: KEEP 路径 — 日志 + commit**

ITERATIONS.md 追加 `Change/Before/After/Decision: KEEP/Reason`，然后：

```bash
git add <改动文件> docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/
git commit -m "weather: refine runtime meteogram visual fidelity — Iteration N <问题简述>"
```

- [ ] **Step 6b: REJECT 路径 — 留痕不提交**

ITERATIONS.md 追加 `Decision: REJECT/Reason`，`git checkout -- <改动文件>` 回滚（**仅回滚本轮未提交改动，绝不 reset**），截图与 log 保留。→ 回 Step 2 换假设。

- [ ] **Step 7: 判断是否还有明显 P0/P1**

排行榜还有项 → 回 Step 1（Iteration N+1）。无明显 P0/P1 且 375 稳定 → 进 Task 4。

**循环退出纪律（回应「不要完成 checklist 就停」）**：每轮 KEEP 后必须自问「打开这张图，一个普通户外用户会觉得这是设计过的产品吗？」答 NO → 继续下一轮，不写报告。

### Task 4（穿插于循环内）: OI presentation 去重（P2）

**Files:**
- Modify: `miniprogram/utils/oi-presentation.js`（仅呈现；`outdoor-intelligence` model 判定禁改）

- [ ] **Step 1: 复现「值得关注」三连**

截 OI 卡图，确认 00:00–05:00 银河 / 21:00–23:00 银河 / 07:00–09:00 彩虹 均带重复 tier 词。

- [ ] **Step 2: 改为编号+类型+时间的 editorial 层级**

```js
// 目标呈现（示意；按现有 oi-presentation.js 结构落地）:
// 01 银河窗口  00:00–05:00
// 02 彩虹可能  07:00–09:00
```
去掉每行重复的「值得关注」，tier 用序号/字重表达。

- [ ] **Step 3: 测试**

```bash
node tools/outdoor-intelligence-ui-test.js && node tools/outdoor-intelligence-test.js
```
Expected: 46 + 24 断言 0 failed。**若测试断言了旧文案，先确认它是「呈现契约」还是「model 契约」——呈现契约允许随设计更新，model 契约不许动。**

- [ ] **Step 4: 截图判读 → KEEP 则 commit（回 Task 3 Step 6a 格式）**

---

## Phase Final — 收口（仅当循环退出条件满足）

### Task 5: 全套回归 + 性能验证

- [ ] **Step 1: 跑 38 门禁全量 sweep**

```bash
node tools/check.js && node tools/check-handlers.js && \
node cloudfunctions/trailApi/smoke-test.js && <按 AGENTS.md COMMANDS 段全量> ...
```
Expected: 每套件 `failed=0`，exit 0。任一失败 → 修码（不修测试）→ 重跑。

- [ ] **Step 2: 性能抽查**

在 ITERATIONS.md 记录：SVG 尺寸（24h <100KB、72h 目标 <160KB，量 `cfUri` 输出字节）、selection 响应体感 <5ms（DevTools console 打点）。超预算 → 回 Task 3 找方案，记录。

### Task 6: 最终截图矩阵 + Before/After 三组

- [ ] **Step 1: 重抓 final 矩阵**

```bash
OUT=docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/final
# 375 × 3 地点 × 3 horizon = 9 张
# + 理塘16:00 / 峨眉山06:00 / 成都16:00 selected
# + 390/414 抽查 24h+72h
```
Expected: ≥15 张。

- [ ] **Step 2: 拼 Before/After 对照**

从 `baseline/` 选三组同机位与 `final/` 对应图，命名 `beforeafter-{litang16,emeishan06,chengdu16}.png`（或并排目录）。

- [ ] **Step 3: Commit**

```bash
git add docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/
git commit -m "test(weather-v2): Visual Convergence 最终截图矩阵 + Before/After 三组"
```

### Task 7: `tools/weather-v2-visual-convergence-test.js`

- [ ] **Step 1: 写测试（照抄仓库测试风格：自定义 check/section + process.exit）**

断言内容 = 本轮**实际改过的视觉不变量**（示例，按落地改动取舍）：
- 降水柱参数在合法域（opacity ≤ 选定值、宽比 ∈ 区间、色值来自 app.wxss token 而非硬编码——「禁止发明新色值」）
- OI 呈现行不含重复 tier 词（对呈现序列断言）
- 既有不变量不回归（YOU 锚点、covered 透传、跨宽度归一化——复用 visual-audit 的口径）

```bash
node tools/weather-v2-visual-convergence-test.js
```
Expected: `passed=N failed=0`。

- [ ] **Step 2: Commit**

```bash
git add tools/weather-v2-visual-convergence-test.js
git commit -m "test(weather-v2): visual convergence 不变量回归套件"
```

### Task 8: 文档沉淀

- [ ] **Step 1: 写 `docs/weather-ux/visual-convergence-notes.md`**

五节：runtime rendering lessons / precipitation visual encoding（最终 A–F 选型及理由）/ cloud field visual encoding / responsive constraints（375 优先规则）/ horizon visual rules（24/48/72 差异化）。

- [ ] **Step 2: SYNC.md 追加变更日志条目**

格式沿用现有条目：根因 → 修复 → 测试读数（新套件数字）；若本轮只动 miniprogram 层则**不标**「需重新部署 trailApi」。

- [ ] **Step 3: Commit**

```bash
git add docs/weather-ux/visual-convergence-notes.md SYNC.md
git commit -m "docs(weather-v2): Visual Convergence 收口——runtime rendering 经验 + SYNC 变更日志"
```

### Task 9: 最终报告（§24 十六项）与裁决

- [ ] **Step 1: 逐项对照 spec §6 的 A–J 完成条件**

用 `look_at` 打开 `final/` 矩阵逐项核验，每项写 PASS/FAIL + 截图证据路径。

- [ ] **Step 2: 产出 Visual Convergence Report**

写入 `docs/weather-ux/visual-convergence-report.md`（或 SYNC.md 附录），十六项：baseline / 最大视觉问题 / Iteration 数 / 每轮修复 / precipitation 最终方案 / Cloud Field 最终方案 / runtime rendering 结论 / 375-390-414 / 24-48-72 / 三地点 / OI / 性能 / 全套测试读数 / 截图路径 / Remaining Issues / **PASS-FAIL**。

- [ ] **Step 3: 诚实裁决**

任一 A–J 不满足 → `FAIL` 或 `CONDITIONAL PASS`（列出条件）。**不因"功能都完成"而 PASS。**

- [ ] **Step 4: 终审 commit（不 push）**

```bash
git add <报告+文档>
git commit -m "docs(weather-v2): Visual Convergence 最终报告 — <PASS/FAIL/CONDITIONAL>"
git log --oneline <本轮起点..HEAD>   # 整理夜间提交清单
```

**交还用户**：报告 + 提交清单 + 本地 ahead N，等你天亮拍板 push（你已定：push 由你终审后执行）。

---

## Self-Review 记录

1. **Spec 覆盖**: §3 Phase 0→Task 1-2；§3 循环→Task 3；§4 排行榜→Task 2 Step 4 + Task 3 Step 1；§4 OI→Task 4；§3/§24 收口→Task 5-9；§5 红线散布于 Task 3 Step 2/Task 7（禁改测试）；§6 完成条件→Task 9 Step 1；中断安全→Task 3 Step 6a 即时 commit。无缺口。
2. **占位符扫描**: drive-shots.js 内 setData 细节标注「见门槛链」并给出门槛链四条件与 spaceNodes 形态（AGENTS.md 坑 #3/#数据注入），属可执行指引而非 TBD；无 TODO/待定。
3. **一致性**: `screens/visual-convergence/` 均按 spec 引用约定解析为 `docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/`；ws 端口统一 `<port>` 占位（Task 1 Step 4 运行时获得）；ITERATIONS.md 路径前后一致。
