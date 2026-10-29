---
name: interaction-fidelity-validator
description: 把"点了之后应该发生什么"写成可执行的交互契约，在目标运行时真的点一次并读到后果，产出 PASS/FAIL/UNVERIFIED/BLOCKED。用于"这个交互实现对不对""改完有没有把别的流程弄坏"；截图只作证据，动作执行成功不等于通过。
---

# interaction-fidelity-validator

视觉能证明"画对了"，证明不了"点得动"。这一层的判定只有一句话：
**动作真的执行了，且它的后果被读到了，才算 PASS。**

## 何时用

- 目标运行时可达（小程序自动化端口在听；Web 侧可用 Playwright）。
- 需要验收的交互有明确、可观测的后果（状态字段、元素出现/消失、文本、计数）。
- 视觉已经 PASS 或 FAIL，但"流程是否还通"没有证据。

不适用：状态来自注入夹具（那只能作视觉证据）；原生 picker/相册/分享面板
（平台能力不可驱动 → `BLOCKED`，不是 `FAIL`）。

## 输入 / 输出

| 输入 | 输出 |
|---|---|
| `pf.config.json#pages[].interactions[]`（`do[]` + `expect{}`） | `contracts/<page>/interaction-contract.json`：声明 + 驱动信息 + 观测 |
| 目标运行时与页面路径 | `reports/<run>/interactions/*.png`（声明了 `screenshot: true` 的检查） |
| 捕获快照（用于校对选择器确实存在） | 评分卡 `interaction` 维度：逐检查状态与断言明细 |

## 依赖与前置

- `pf doctor` 必须显示驱动可用；小程序侧还要求开发者工具已开自动化端口且登录。
- 状态必须是**真实数据**（`dataSource: real`）。注入态由状态维度拦下，不允许混入交互结论。
- 选择器来自目标侧真实 class/具名节点；先用快照确认命中，别把"找不到"当"没触发"。

## 步骤

1. **写检查**：每条 `interactions[]` 包含
   - `do[]`：`tap` / `input` / `wait` / `waitFor`（四选一，按顺序执行）；
   - `expect{}`：`exists` / `notExists` / `textEquals` / `textIncludes` / `count` / `dataEquals`；
   - 默认每条检查前会 `reLaunch` 回起点（`reset: false` 可关），避免上一条的状态污染下一条。
2. **期望必须指向"动作的后果"**：`homeTab: "points"`、`.overlay--dialog` 出现、
   `.overlay__title` 文本等于"输入经纬度"。断言动作前后都不变的静态文案，等于没测。
3. 单独跑交互（不改视觉结论）：`node cli/pf.js interactions --project <dir> --page <id> --state <id>`；
   或随 `validate` 一起跑。
4. **逐检查读状态**：
   | 状态 | 含义 | 能说什么 |
   |---|---|---|
   | PASS | 动作执行 + 全部断言为真 | 这条路径成立 |
   | FAIL | 有断言为假，或动作目标不存在/执行抛错 | 实现或契约有问题，带 `observed` 实际值 |
   | UNVERIFIED | 动作跑了，但没有任何断言能读到后果（空 `expect`、`data` 不可用、未知期望键） | **不是通过**，是证据不足 |
   | BLOCKED | 驱动不可用/连不上 | 环境问题，整页交互结论不可得 |
5. **把 `verification: real-action-and-observation` 当门槛**：没有这个标记的记录不能引用为交互证据。
6. 交互结果交给 orchestrator：`FAIL` 拉低整页；`BLOCKED`/未跑把 `PASS` 降为 `UNVERIFIED`。
   **交互永远不能把 UNVERIFIED 抬成 PASS。**

## 质量门

- 每条检查至少一个期望，且期望里至少有一个只有动作后才会成立。
- `expect` 里不允许出现未知键——实现会把它记成 UNVERIFIED，但契约本身应视为错误。
- 空 `expect` = UNVERIFIED；"点了没报错"不是结论。
- 截图不是断言：`screenshotPath` 只用于人工复核，判定只看 `assertions[]`。
- `dataEquals` 在 Web 驱动下恒为 UNVERIFIED（页面没有可读 data 通道），要么改用 DOM 断言，要么如实记 UNVERIFIED。
- 同一选择器多实例时明确写 `index`；越界行为**两侧不同**：小程序驱动把 `index` 夹到最后一个元素、不报错
  （`core/lib/interaction.js:178`），Web 驱动直接用 `nth(index)` ⇒ 落空报 `tap target not found`
  （同文件 `:251`）——两种都不是"看不见的错误"，先数一遍实例。
- 契约复跑时，只有**声明集合未变**才会沿用已记录观测；改了步骤就重新跑，不许张冠李戴。

## 失败处理

| 现象 | 处置 |
|---|---|
| `cannot connect to ws://127.0.0.1:9421` | `BLOCKED`：确认开发者工具已开服务端口并登录、项目已打开且自动化端口在听 |
| `tap target not found` | 选择器错或元素不在当前状态 → 先看快照，再改契约 |
| 动作成功但断言全 null | 后果不可读（无 `data`、文本被拼接）→ 换一个可观测的后果或记 UNVERIFIED |
| 连续两条互相影响 | 检查没复位；确认 `reset` 未被关掉，或把前置步骤写进同一条 |
| 原生面板（picker/相册/分享） | 平台 C 类：记 `BLOCKED`，并登记为 `acceptedDifferences`，不写成 FAIL |
| 注入数据下"交互通过" | 不成立：状态维度会先把该状态标为不可作交互证据 |

## 示例

试点页声明了 4 条检查（切 tab ×2、打开/关闭经纬度对话框）。本轮开发者工具自动化端口未监听：

```text
interaction: UNVERIFIED
  tab-points      BLOCKED  cannot connect to ws://127.0.0.1:9421
  tab-routes      BLOCKED  同上
  manual-dialog   BLOCKED  同上
  manual-close    BLOCKED  同上
verdict FAIL · geometry:FAIL typography:FAIL appearance:PASS state:PASS interaction:UNVERIFIED
```

正确读法：视觉三项照常成立，**交互一项没有任何证据**；
不能写"交互逻辑看起来没问题"，也不能因为它 `UNVERIFIED` 就把整页当通过了。

## 与其他技能的关系

- 上游：`target-platform-adapter`（驱动与选择器）、`prototype-inspector`（快照校对选择器）。
- 下游：`fidelity-repair-agent`（按 FAIL 的 `observed` 修）、`fidelity-orchestrator`（聚合）。
- 交互契约的字段与判定语义见 `docs/architecture.md` §6；两条 E2E 的分工参见宿主仓库的
  `docs/testing/e2e-result-semantics.md`（BUSINESS 与 UI 是两个维度）。
