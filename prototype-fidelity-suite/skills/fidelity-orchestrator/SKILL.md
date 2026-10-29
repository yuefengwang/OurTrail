---
name: fidelity-orchestrator
description: 按"捕获→对齐→测量→归因→定点修复→复核"编排整条保真验收，分配角色与文件所有权、执行停止条件、登记不等同的证据状态。用于一条页面/一批页面的端到端验收；也用于判断这一轮能不能宣布完成、哪些结论只能记 UNVERIFIED/BLOCKED。
---

# fidelity-orchestrator

编排者的产出不是"都挺好"，而是一份**可以被反驳的账**：
每个结论有 run 目录、有角色、有状态、有下一步。

## 何时用

- 一次完整的原型→实现验收（单页或一批页）。
- 修复轮次之间需要判定"哪些说完、哪些没说完"。
- 需要向评审者交付：报告、证据、未决项、需要产品/授权决策的清单。

## 输入 / 输出

| 输入 | 输出 |
|---|---|
| `pf.config.json`（页面、状态、映射、容差、交互） | 编排记录（每轮：谁做了什么、gate 是否过、状态与理由） |
| `pf doctor` 结果 | 交付包：run 目录 + `report.html` + 验收 JSON + 修复记录 + 未决清单 |
| 各角色的结论（PASS/FAIL/UNVERIFIED/BLOCKED/NOT_APPLICABLE） | 停止条件的触发记录与交接说明 |

## 依赖与前置

- 七个技能都已可用（A–G，见 `references/roles.md`）。
- **编排者自己不做测量、不做修复**：一旦亲自改代码或亲自宣布通过，
  "独立复核"就消失了，必须如实改写记录。

## 步骤

1. **环境门**：`pf doctor`。缺驱动/缺模块 ⇒ 相应阶段记 `BLOCKED`，
   不允许用"另一台机器上应该能跑"来补。
2. **捕获**：A 捕原型（只读、不改原型目录）；C 捕目标（同一状态、同一视口、真实数据优先）。
   两侧 `capture-manifest` 的 `codeVersion`/`viewport`/`dpr`/`scale`/`dataSource` 必须齐。
3. **对齐**：C 声明一对一映射、criticality、样式属性、`pixel` 开关、对齐锚点、
   A/B/C 类平台差异。未解析选择器 ⇒ 该对 UNVERIFIED，不许静默丢弃。
4. **契约**：B 产出声明并逐条标 `measured/inferred/confirmed/unknown`；
   `pf contract` 通过 schema 门（含反例）。
5. **测量**：D 跑 `diff` + `validate`，按五维读，不读总分；每条 FAIL 归因到配对。
6. **交互**：F 在真实运行时跑声明检查；`BLOCKED` 原样登记，截图不作断言。
7. **修复循环**（E 改、D 复核）：
   - 一轮只允许一个来源的改动；
   - 复核必须同时证明"目标差异消失"与"其它配对未回归"；
   - 最多 3 轮/配对；不收敛或引入回归 ⇒ 回退并停止。
8. **收尾**：G 汇总状态，逐项标注证据与缺口，列出需要**产品裁决**或**授权**的条目，
   交付时说明"这一轮能证明什么、不能证明什么"。

## 质量门（gate）

| Gate | 判据 | 不通过时 |
|---|---|---|
| G0 环境 | doctor 全绿或明确缺口 | 相关阶段 BLOCKED |
| G1 捕获 | 两侧截图 + 快照 + 清单齐；代码版本是当前树 | 重捕，不解释旧图 |
| G2 映射 | 每对选择器在快照里命中；criticality 已声明 | UNVERIFIED，回 C |
| G3 声明 | 契约过 schema；无 `unknown` 冒充测量 | 回 B |
| G4 测量 | 每条 FAIL 有 pairId/类别/数值/裁剪图 | 补证据，不下结论 |
| G5 交互 | 每条检查有"动作后才会成立"的期望 | 回 F 重写 |
| G6 收敛 | 目标差异消除 + 零新增回归 | 回退，停止循环 |
| G7 交付 | 未决项（UNVERIFIED/BLOCKED/productDecision/授权）逐条列出 | 不许宣称完成 |

**五值状态**（不得自造第六种）：`PASS` / `FAIL` / `UNVERIFIED` / `BLOCKED` / `NOT_APPLICABLE`。
`BLOCKED` 与 `UNVERIFIED` 都**不是**通过；`NOT_APPLICABLE` 必须写明是哪一侧、为什么。

## 停止条件（触发即停，不改口径）

1. 原型无法运行或无法解析；
2. 目标无法捕获；
3. 契约与渲染冲突且无法解释；
4. 工具输出不可靠（读数互相矛盾、截图与 JSON 不符）；
5. 越过授权边界（冻结模块、生产数据、未授权文件、真实账号副作用操作）；
6. 修复不收敛（同配对 3 轮无改善）；
7. 修复让其他区域明显变差。

触发后写出：触发点、已有证据、已回退到什么状态、需要谁做什么决定。

## 角色与文件所有权

七个角色与产物归属见 `references/roles.md`。三条硬规则：

- **一个文件同一时间只有一个写者。** `pf.config.json` 由编排者统一落笔，
  其它角色提交"某个 section 的修改建议"，避免并发改同一文件。
- **测量者不改代码，修复者不宣布通过。** 复核由独立角色/独立轮次完成；
  若确实是同一执行者，记录里写 `self-verified (same actor)`，不许写成独立复核。
- **原型目录只读**；目标侧受保护文件（冻结模块、全局设计规范）只能出补丁建议并标 `BLOCKED`。

## 失败处理

| 现象 | 处置 |
|---|---|
| 某阶段缺工具（Playwright/automator） | 该阶段 `BLOCKED`；其余阶段继续，交付时说明缺口 |
| 同一页面第二次跑读数不同 | 先查数据状态与代码版本；不同夹具不可比 |
| 修复后"看起来好了"但 diff 没变 | 补丁没生效或捕获是旧的；回到 G1 |
| 两条结论互相矛盾（如契约说 A、渲染说 B） | 停止（第 3 条），保留两侧证据交裁决 |
| 需要改容差才能过 | 这是产品决定，不是修复；记 `productDecision`，不改数值 |

## 示例

试点页一轮的收尾账（数字来自 `reports/weather-hub-home-real-*`）：

```text
G0 PASS  doctor: node ok, adapters [web, wechat-miniprogram]
G1 PASS  两侧捕获齐；目标截图 306×660（缩放 0.78）已登记
G2 PASS  15 对映射；4 对可选缺失 → NOT_APPLICABLE
G3 PASS  11 份契约过 schema；components/sections 为空 ⇒ 登记 UNVERIFIED 覆盖
G4 FAIL  header(padding 22→14, 像素 12.2%) · title(weight 730→700) · primary(h 60→92)
G5 BLOCK  ws://127.0.0.1:9421 未监听 → interaction UNVERIFIED（4 条 BLOCKED）
G6 —     primary/header 需改受保护样式文件 → 出建议，等授权
G7 —     交付：FAIL + 3 个待授权补丁 + 1 个产品裁决（文案差异）
```

这段账的意思是：**视觉不合格（有真实差异），交互没有证据，修复没有获准**——
三件事分开写，任何一件都不能被另外两件"看起来还行"抵消。

## 与其他技能的关系

- 编排 A `prototype-inspector` → C `target-platform-adapter` → B `design-contract-builder`
  → D `visual-fidelity-analyzer` → F `interaction-fidelity-validator`
  → E `fidelity-repair-agent` → D 复核。
- 角色/产物/所有权矩阵：`references/roles.md`。
- 判定次序与五维语义：`docs/architecture.md` §5、`skills/visual-fidelity-analyzer/references/scorecard.md`。
