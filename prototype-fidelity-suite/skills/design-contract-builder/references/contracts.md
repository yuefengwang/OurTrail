# 十份契约：字段、生产者、消费者、状态语义

版本字段一律 `"schemaVersion": "1.0.0"`，每份都有 `kind` 常量（schema 里用 `const` 钉死）。
"声明"指它描述**应该是什么**；"证据"指它来自**一次真实测量**。二者不可互换。

| # | 契约 | 生产者 | 消费者 | 关键字段 |
|---|---|---|---|---|
| 1 | `project-config`（`pf.config.json`） | 人 / `pf init` | 全部命令 | pages、states、mappings、alignment、tolerances |
| 2 | `prototype-manifest` | `pf contract` | analyzer、adapter | 原型来源、states、选择器映射声明、provenance |
| 3 | `page-state-manifest` | `pf contract` | validator、report | 每个状态的进入方式、`injection`、`usableAsInteractionEvidence`、coverage |
| 4 | `design-tokens` | `pf contract` | analyzer、repair | 五组令牌 + `source.kind` + `drift{shared, onlyPrototype, onlyTarget}` |
| 5 | `component-contracts` | `pf contract` | repair | 组件结构/尺寸/状态；空数组＝未声明 |
| 6 | `platform-mappings` | `pf contract`（审查归 adapter 技能） | analyzer | `pairs[]`（id/role/criticality/选择器）、`acceptedDifferences[]`、`coverage` |
| 7 | `capture-manifest` | `pf capture` / adapter | analyzer、validator | 平台、URL/路由、代码版本、viewport、DPR、截图 sha256、`dataSource`、`verification` |
| 8 | `visual-diff-report` | `pf diff` | analyzer、repair | `regions[]`（几何读数、样式失败项、像素比、状态） |
| 9 | `interaction-contract` | `pf contract` / `pf interactions` | validator | 每条检查的 `do[]`、`expect{}`、`status`、`observed` |
| 10 | `fidelity-validation-report` | `pf validate` | orchestrator、人 | `status`、`scorecard`（四维 + 关键失败）、`interaction`、`evidence[]`、`limitations[]` |
| 附 | `page-layout` | `pf contract` | repair | 分区顺序/层级/节奏；支撑契约，不替代第 1–10 条 |

## 状态语义（五值，跨契约统一）

| 值 | 含义 | 允许的下一步 |
|---|---|---|
| `PASS` | 至少一条证据支持"符合"，且没有相反证据 | 可进入下一层 |
| `FAIL` | 有证据表明不符合（含读数/像素/缺失） | 进入定位与修复 |
| `UNVERIFIED` | 没测到，或仪器量不出 | 补证据；**不得**当作 PASS |
| `BLOCKED` | 环境/权限导致无法测量（驱动不在、端口关闭） | 恢复环境后重跑 |
| `NOT_APPLICABLE` | 明确不适用，且写清为什么 | 不参与判定 |

规则：缺失证据默认 UNVERIFIED；`NOT_APPLICABLE` 必须点名**哪一侧**不适用；
交互只能把 PASS 拉成 UNVERIFIED，永远不能把 UNVERIFIED 提成 PASS。

## 值的来源（provenance）

| kind | 什么时候用 | 反例 |
|---|---|---|
| `measured` | 从捕获的计算样式/几何/像素算出来 | 从设计稿眼睛估一个 16px |
| `inferred` | 由间接量推出（如 `行数 = 高度 / 行高`） | 把推断值写成 measured |
| `confirmed` | 人明确确认过 | 自己"觉得对"就标 confirmed |
| `unknown` | 没有输入 | 用默认值假装有值 |

微信侧 `lineCount` 必须同时带 `lineCountSource: "inferred"`；浏览器侧才是 `measured`。

## 声明 vs 证据（本套件最容易犯的错）

| 句子 | 是否合法 | 为什么 |
|---|---|---|
| "映射声明里写了 `.wh-title`" | 合法（声明） | 只说明想比这一对 |
| "`.wh-title` 存在，所以标题符合原型" | **不合法** | 存在不是符合 |
| "注入数据后渲染正确" | 合法，仅限渲染路径 | `dataSource: injected`，不能证明数据链路 |
| "交互检查 4 条全过" | 需附 `status` 原文 | BLOCKED 不是"过" |
| "截图是 2026-10-28 的" | 合法但不够 | 还要代码版本与哈希 |

## 契约之间的关系

- `capture-manifest` 是唯一能回答"这张图从哪来"的凭证；报告里的每条证据都要能指回它。
- `visual-diff-report.regions[].id` 必须等于 `platform-mappings.pairs[].id`，否则
  `tests/contracts.test.js` 的交叉一致门会红。
- `coverage` 必须闭合：`declared = resolved + unverified + notApplicable`
  （外加 missing 两侧的显式计数），出现第三个数就是漏算。
