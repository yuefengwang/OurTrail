---
name: fidelity-repair-agent
description: 按已定位的差异做最小、可回滚的实现侧修复，并在每轮后重测证明"目标差异消失、其它区域没变坏"。用于"把这几处对不齐的地方修掉"；只改目标实现，不碰原型、不放宽容差、不顺手重做组件。
---

# fidelity-repair-agent

修复的唯一合法起点是**一条已经量过的差异**。没有 `pairId`、没有裁剪图、没有数值的
"整体再调一下"，不是修复，是把基线弄丢。

## 何时用

- `visual-fidelity-analyzer` 已产出 FAIL，且归因落到目标实现的源码。
- 交互契约 FAIL（动作没产生声明的后果），且原因在实现侧。
- 上一轮修复引入了回归，需要定位并回退。

不适用：原型本身有问题、产品决定要改设计、平台不可弥合 → 交 orchestrator 裁决。

## 输入 / 输出

| 输入 | 输出 |
|---|---|
| 某次 run 的 `visual-diff-report.json`（含 `pairId`、类别、数值、裁剪图） | 目标仓库的**最小补丁**（每轮一个来源） |
| 目标实现的样式/模板源码（只读查看，精确到文件与属性） | 修复记录：base run → 改动 → 新 run → 差值对比 |
| `pf.config.json` 的容忍值与 `acceptedDifferences` | 未收敛时的回退证明（`git diff` 为空 + 新 run 与 base 一致） |

## 依赖与前置

- 工具链：`pf capture --side target` → `pf diff` → `pf validate`；基线 run 目录必须先留存。
- **授权边界**（任务书原文，逐条生效）：不改原型目录、不改冻结模块、不改生产数据、
  不批量重构页面、不改全局设计规范；对未授权文件只能出**补丁建议**并标 `BLOCKED`。
- 只读优先：先用 `grep`/阅读定位，不要为了"看看效果"先改再测。

## 步骤

1. **确认起点可用**：base run 的 `provenance` 是当前代码版本、目标捕获 `dataSource` 与
   将要复测的状态一致。不一致就先重捕，别拿旧图当基线。
2. **判断根因层级**，四选一（选错会白改）：
   | 层级 | 判据 | 处置 |
   |---|---|---|
   | 实现 | 声明值对，实现写错/漏写 | 本技能修 |
   | 声明 | 原型或契约本身写错（如 token 取错节点） | 回 `design-contract-builder` |
   | 映射 | 选择器指到了错的元素 | 回 `target-platform-adapter` |
   | 产品决定 | 文案/结构/交互模式本就不同 | 交 orchestrator，记 `productDecision` |
3. **一次只改一个原因**：同一个来源导致的多对差异可一起改；不同来源分开提交，
   否则复测变红时无法判断是哪一处造成的。
4. **写补丁**：只动目标实现里与读数直接相关的属性/结构；不重命名、不重组样式表、
   不"顺手统一"。补丁必须能一句话说明"改了什么、为什么这个读数会变"。
5. **复测（同一状态、同一视口）**：
   ```bash
   node cli/pf.js capture  --project <dir> --page <id> --state <id> --side target
   node cli/pf.js diff     --project <dir> --page <id> --state <id>
   node cli/pf.js validate --project <dir> --page <id> --state <id>
   ```
6. **双条件验收**（缺一即回退）：
   - 目标配对：对应类别从 FAIL → PASS（或至少数值进入容忍带且不再 critical）；
   - 其它配对：逐一与 base 对比，**不许出现新的 FAIL/UNVERIFIED**。
7. 收敛失败按第 7 条停止条件处理：同一配对连续 3 轮不改善、或修复让别处变红 → 回退到 base，
   把"试过什么、读数如何"写进记录，交 orchestrator。

## 质量门

- 原型目录零改动（用 `git status` 证明，不靠记忆）。
- 容忍值、`acceptedDifferences`、冻结模块**零改动**；确实需要动，先停下来要授权。
- 每条修复记录都含：`pairId`、类别、base 值 → 新值、证据 run 目录。
- "看起来对齐了"不算；必须有一次 `diff` 的读数变化。
- 回退必须干净：`git diff` 为空，且新 run 与 base 的配对读数逐项相同。
- 修复期间不切换到另一份数据夹具（换了夹具，前后不可比）。

## 失败处理

| 现象 | 处置 |
|---|---|
| 改完读数没变 | 补丁没生效（编译缓存/选择器未命中/被更高优先级规则覆盖）→ 先证明生效：抓一次目标快照看计算值 |
| 读数变了但方向相反 | 归因错层（例如把外壳差异当版式差异）→ 回步骤 2 |
| 目标配对好了，另一对变红 | 回退，重新按"共同来源"拆分改动 |
| 修复需要重做组件结构 | 超出"最小修复"→ 交 orchestrator 决策，不自行重构 |
| 修复只在注入数据下成立 | 说明是夹具形状问题，不是版式修复；如实标注 |
| 驱动不可达导致无法复测 | 记 `BLOCKED`，保留补丁为**未验证**，不宣称完成 |

## 示例

试点里 `primary` 的 `h 60 → 92` 是真实缺陷。合法产出是**补丁建议**而不是直接改：

```text
pairId: primary    类别: size    base: dh 32 (60→92)
来源: <目标页样式里按钮的 min-height / padding>
建议: 只调与高度相关的属性，保持圆角/背景/字号不动
验收: 该对 size PASS，且 header/title/其余 11 对读数不变
状态: BLOCKED —— 该文件属未授权修改范围，等负责人批准后执行
```

`header` 的 `padding-top 22 → 14` 同理：读数清楚、原因清楚，但改的是受保护样式文件，
所以本轮交付的是"证据 + 建议"，不是"已修复"。

## 与其他技能的关系

- 上游：`visual-fidelity-analyzer`（must）、`design-contract-builder`（声明值）、
  `interaction-fidelity-validator`（交互失败项）。
- 下游：回到 `visual-fidelity-analyzer` 复测；`fidelity-orchestrator` 记录轮次与裁决。
- 修复不收敛时不是"再试试"，而是停止并把证据交给裁决——这是任务书的停止条件之一。
