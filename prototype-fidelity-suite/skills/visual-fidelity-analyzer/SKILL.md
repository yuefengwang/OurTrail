---
name: visual-fidelity-analyzer
description: 把原型与实现的两次真实渲染逐配对量出来，产出 visual-diff-report 与五维评分卡（几何/字体/外观/状态/交互），并把每条差异归因到可定位的证据。用于"实现到底偏了多少""这次改动有没有让别的区域变差"；只测量与归因，不修代码。
---

# visual-fidelity-analyzer

这一层**只回答"差在哪、差多少、凭什么这么说"**。改不改、怎么改是
`fidelity-repair-agent` 的事；这一步先动代码，就没有基线可回归。

## 何时用

- 两侧都已捕获（`prototype-inspector`）且映射已声明（`target-platform-adapter`）。
- 改完一轮实现，需要知道"目标差异消失了没有、别处有没有变坏"。
- 需要给评审者一份可追溯的验收记录（每个结论都能点回到某次运行的某张图）。

## 输入 / 输出

| 输入 | 输出（`reports/<page>-<state>-<ts>/`） |
|---|---|
| `captures/<page>/<state>/{prototype,target}/`（snapshot + screenshot + capture-manifest） | `visual-diff-report.json`：逐配对的几何/样式/文本/像素 + 裁剪图路径 |
| `pf.config.json` 的 mappings / alignments / tolerances / acceptedDifferences | `regions/<pair>-{prototype,target,diff}.png` |
| `contracts/<page>/page-state-manifest.json` | `fidelity-validation-report.json`：评分卡 + 交互结果 + 证据清单 + 限制 |
| | `report.html`：离线自包含（图片内嵌 data URI） |

## 依赖与前置

- `node cli/pf.js diff` → `validate`（或一步 `verify`）。`diff` 只读捕获，`validate` 只读 diff。
- 交互驱动不可达时不要阻断视觉结论：`validate` 会把交互记 `BLOCKED` 并把页面从 `PASS` 拉到 `UNVERIFIED`。
- `pf doctor` 先过；退出码 2 是环境/配置问题，不是产品缺陷。

## 步骤

1. **先看 provenance，再看数字。** 每份 `capture-manifest` 的 `codeVersion` / `viewport` /
   `dpr` / `screenshot.scale` / `dataSource` 决定这次读数能不能用：
   - `dataSource: injected` ⇒ 只能作视觉证据，不能作交互证据；
   - 设备截图缩放过（如 306×660 对 390×844）⇒ 区域裁剪已归一化，但**不可宣称逐像素 1:1**；
   - `codeVersion` 与当前工作树不一致 ⇒ 这是旧证据，重捕，不要解释。
2. `node cli/pf.js diff --project <dir> --page <id> --state <id>`，然后逐区域读：
   - 先看 `status` 与 `categories`（`position/size/gap/font/color/pixel/ink/text/wrap/style`），
     再看具体数值；`acceptedDifferences` 已由配置扣除，**不要自己去"心算接受"**。
   - `pixelMode: informational` 的文本叶节点按墨迹签名判定（bbox 2px、墨量比 0.3），
     不是逐像素相似度；字阶/字重/行高/字距/颜色/行数仍逐项判。
3. `node cli/pf.js validate …` 得到评分卡。**按维度读，不读总分**——
   本工具也没有总分。`geometry / typography / appearance / state / interaction` 各自
   `{checks, metrics, verdict}`；`criticalFailures[]` 与 `nonCriticalFailures[]` 带 `pairId`。
4. **归因（不是修）**：每条 FAIL 写成
   「哪个配对 · 哪个类别 · 差多少 · 最可能的来源（文件与属性）」。
   归因必须可被下一轮证伪：写"`.wh-title` 的 font-size 是 34px，声明是 30px"，
   不写"标题偏大"。
5. **分类处置**：能由实现修正的 → 交 `fidelity-repair-agent`；需要产品裁决的
   （文案、外壳、交互模式不同）→ 交 orchestrator 记 `productDecision`；
   平台不可弥合的 → 记 `acceptedDifferences` 并写明仍比什么。
6. 交付时附：run 目录、报告 HTML、被引用的截图路径、留 UNVERIFIED 的项与原因。

## 质量门

- 每个 FAIL 都能追到 `pairId` + 裁剪图 + 数值；没有"看起来偏了"这类条目。
- 三类证据分离：测量（数字）、推断（如"可能少了 4px padding"）、确认（人看过的图）。
- `criticalFailures` 必须单独列出并出现在结论首段；预算只对非 critical 生效，**不许拿通过数对冲 critical**。
- UNVERIFIED ≠ PASS：缺捕获、缺驱动、维度没测到，都必须原样写成 UNVERIFIED 并给原因。
- 如果应用了对齐（`alignment.anchor`），在结论里说明"只重定基 dy，尺寸未重定基"。
- 报告中出现的每个数字，都必须能在同一 run 目录的 JSON 里找到出处。

## 失败处理

| 现象 | 处置 |
|---|---|
| `RUN_MISSING` / `DIFF_MISSING` | 先 `capture` 再 `diff`；不要手写报告 |
| 退出码 2 且信息含 `cannot connect to ws://…` | 环境问题：交互 `BLOCKED`，视觉结论照常出 |
| 两侧截图尺寸/缩放不同 | 区域已归一化比较；在限制里写明，禁止宣称 1:1 |
| 区域 0 个 | 映射没声明（`mappings[]` 为空或选择器全未命中）→ 回 `target-platform-adapter` |
| 同一配对两轮之间"自己变好/变坏" | 先查捕获是否来自不同代码版本或不同数据状态 |
| 报告与截图观感不一致 | 以**本次 run 的 JSON + 裁剪图**为准，旧截图作废 |

## 示例

```bash
node cli/pf.js diff     --project examples/ourtrail --page weather-hub-home --state real
node cli/pf.js validate --project examples/ourtrail --page weather-hub-home --state real
# verdict FAIL · geometry:FAIL typography:FAIL appearance:PASS state:PASS interaction:UNVERIFIED
```

同一次运行里三个 critical 的**归因不同**，这正是本技能存在的理由：

| 配对 | 读数 | 归因 |
|---|---|---|
| `header` | `padding-top 22 → 14`（spacing）+ 像素 12.2% | 真差异，可修；`dy 15` 是已接受的外壳差异，不要顺手"修掉" |
| `title` | `font-weight 730 → 700`（typography）+ 墨迹 | 真差异；`dw 110` 来自原型演示徽标占位（size 已接受），不是标题排版问题 |
| `primary` | `h 60 → 92`（size） | 真差异：按钮高了 32px |

把三条写成"3 个 critical 失败"而不区分，会让修复者去改宽度、去对齐外壳，
而真正的缺陷是行高与内边距。

## 与其他技能的关系

- 上游：`prototype-inspector`（捕获）、`target-platform-adapter`（映射 + acceptedDifferences）、
  `design-contract-builder`（声明值）。
- 下游：`fidelity-repair-agent`（按 pairId 修）、`interaction-fidelity-validator`（E 维度）、
  `fidelity-orchestrator`（聚合与裁决）。
- 详见 `references/scorecard.md`：五维定义、判定次序、预算语义、评分卡证明不了什么。
