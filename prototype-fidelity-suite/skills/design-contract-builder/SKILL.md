---
name: design-contract-builder
description: 把捕获到的原型变成可校验的设计契约——原型清单、状态清单、设计令牌、组件契约、页面布局。用于"把原型固化成可以验收的规格""这些颜色/字号/间距到底是多少"；所有值都标 measured/inferred/confirmed/unknown，声明不等于证据。
---

# design-contract-builder

把「原型看起来是这样」翻译成「规格写的是这样」，并且让每一条都能追回一次捕获。
这一层的输出是**声明（declaration）**，不是结论：声明可以被证伪，不能被当成证据。

## 何时用

- 原型已经捕获完成（`prototype-inspector`），需要一份可校验的规格。
- 需要回答"主标题到底几号字、行高多少、间距多大、圆角几个像素"。
- 目标实现完成，需要一份"该长什么样"的清单来对比。

## 输入 / 输出

| 输入 | 输出（`contracts/<page>/`） |
|---|---|
| `captures/<page>/<state>/prototype/snapshot.json` + `capture-manifest.json` | `prototype-manifest.json`：原型来源、页面、状态、选择器映射声明 |
| 同上 + `pf.config.json` 的 `states[]` | `page-state-manifest.json`：每个状态的进入方式、注入键、是否可作交互证据 |
| 两侧 capture（含目标侧时） | `design-tokens.json`：五组令牌（colors/typography/radius/shadows/spacing）+ 两侧漂移 |
| `pf.config.json` 的 `components[]` | `component-contracts.json`：组件的结构/尺寸/状态契约 |
| `pf.config.json` 的 `sections[]` | `page-layout.json`：分区顺序、层级、节奏 |

`platform-mappings.json` 由 `target-platform-adapter` 负责，`interaction-contract.json`
由 `interaction-fidelity-validator` 负责 —— `pf contract` 会一并写出，但审查责任不在本技能。

## 依赖与前置

- 捕获已通过 `prototype-inspector` 的质量门（否则本层写出来的都是"没测到"的声明）。
- 运行 `node cli/pf.js contract --project <dir> --page <id> --state <id>`。

## 步骤

1. 先跑一次 `pf contract`，看它**报缺什么**（缺选择器、缺状态、缺 components）。
2. 逐组审查 `design-tokens.json`：
   - `tokens.<group>[].source.kind` 必须是 `measured`（从计算样式算出来的），
     不许手填一个"我知道它大概是 #163E35"；
   - `drift.<group>.onlyPrototype` 是**待解释清单**，不是待自动对齐清单——
     有的差异是外壳、有的差异是 bug，还有的是目标侧确实没这个值。
3. 补 `pf.config.json` 的 `components[]` / `sections[]`；为空时产物里是空数组，
   **空数组意味着"没声明"，不意味着"没有组件"**，必须记成 UNVERIFIED 覆盖。
4. 复跑 `pf contract`，再跑 `node tests/run.js`（契约门会逐份校验）。
5. 把"哪些声明还缺证据"写进交付说明，交给 orchestrator。

## 质量门

- 产物通过 `schemas/*.schema.json`（`tests/contracts.test.js` 逐份验证；含反例，证明 schema 会咬）。
- 每个令牌都有 `source.kind ∈ {measured, inferred, confirmed, unknown}`；
  推断值必须在 `note` 里说明推断依据。
- `page-state-manifest` 里带 `injectData` 的状态必须标 `dataSource: injected`
  且 `usableAsInteractionEvidence: false`。
- 空 `components` / `sections` 必须显式登记为 UNVERIFIED 覆盖，不许当成"无内容"。
- 声明与捕获不能互相打脸：声明里的选择器必须在 `snapshot.nodes` 里存在，
  否则该条是 UNVERIFIED（不是"实现了就是对的"）。

## 失败处理

| 现象 | 处置 |
|---|---|
| `pf contract` 报错（如缺 pageId/映射缺选择器） | 先修配置；不要绕过命令手写 artifacts |
| 令牌只有一侧有值 | 保留 `onlyPrototype` / `onlyTarget`，标 UNVERIFIED，不自动补另一侧 |
| 同一值在两侧写法不同（`#fff` vs `rgb(255,255,255)`） | 由工具归一后再比；不要在文档里手工换算，会漂 |
| 组件契约只能靠截图判断 | 记 `inferred` 并说明"来自像素而非计算样式" |

## 示例

```bash
node cli/pf.js contract --project examples/ourtrail --page weather-hub-home --state real
# 写出 7 份声明（本技能负责其中 5 份）
node tests/run.js   # 契约门：schema + 反例
```

## 与其他技能的关系

- 上游：`prototype-inspector`（提供捕获）、`target-platform-adapter`（提供配对）。
- 下游：`visual-fidelity-analyzer`（用声明去判实现）、`fidelity-repair-agent`
  （按声明定位要改什么）。
- 详见 `references/contracts.md`：十份契约的字段、生产者/消费者、状态语义。
