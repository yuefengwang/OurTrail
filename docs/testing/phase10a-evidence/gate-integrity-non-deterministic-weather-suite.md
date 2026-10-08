# 门禁完整性发现：`outdoor-intelligence-ui-test.js` 不是确定性套件（天气线，本轮禁区）

· 时间：2026-10-08 01:45 复跑发现；同一分支同一工作树，无相关改动
· 现象：`passed=46 failed=1` → `✗ applySelection 命中 IN_CLOUD 窗口`；连跑 3 次同样 1 红
· 对照：**同一天 22:40 与次日 00:0x 两次全量门禁里它是 46/0**（Phase 9 收口 2724/0、Phase 10A 首跑 2738/0 都含它）

## 机制（读码即得，不是猜）

`tools/outdoor-intelligence-ui-test.js`：
- 第 46 行 `const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)` —— 用**真实时钟**装配 fixture 日期；
- 第 49+ 行 `fetchJson('https://api.open-meteo.com/v1/forecast?...')` —— **打线上 Open-Meteo 实时预报**，
  后续 `IN_CLOUD` 机会是否存在、`applySelection` 命中的是哪个小时，都由**当次外网返回的数据**决定；
- 第 115–118 行 `const target = emeCard.items.find(it => it.type === 'IN_CLOUD')` → 断言直接建立在这个 `target` 上。

⇒ 该套件的期望值来自"外部世界此刻的天气"，不是来自仓库代码与固定输入。它今天红、昨天绿，
**与任何人的改动都无关**。

## 为什么这比"某个天气 bug"更严重

AGENTS.md 把门禁定义成提交前的强制闸门（铁律 3），而 `e2e-result.js` 的语义明确规定
"门槛不过/通道退化 ⇒ INCONCLUSIVE，**永远不是 PASS**"。一个依赖外网实时数据的套件放进闸门，会得到两种坏结果：
1. **假红**：别人（或我）改的是毫不相关的东西，门禁却因为成都今晚没入云而红 ⇒ 久而久之大家开始 `--no-verify` 式绕过，闸门失效；
2. **假绿**：更糟的是反向——某天真坏了但外网数据恰好让断言"看起来成立"。

## 定性 / 归属

- 级别：**P1（门禁可信度）**；对天气线产品本身只是 P3（它测的仍是真代码路径，只是判据不稳）。
- 归属：**不在本轮范围**。任务书 §13 与 §8 明令"不碰 Weather Module"，Phase 10A 也禁止扩大范围 ⇒ **只登记不修**。
- 给天气线负责人的建议（不需要联网也能定判据的方向，具体方案由 owner 定）：
  把这类断言拆成两栏——**几何/契约**类用冻结 fixture（本仓库已有先例：
  `pages/cloud-field-poc/` 的冻结 fixtures、`meteogram-draw-test` 的记录式 2D 上下文），
  **真实数据**类可以保留外网调用但必须降级为"信息性"（不进 `failed`，像 `bugs`/`inconclusive` 那样单列计数），
  否则就不该出现在 `tools/check.js` 之后的强制闸门里。

## 对本轮结论的影响（如实）

Phase 10A 的无头门禁因此记为 **42/43 绿 + 1 条非本轮、非确定性的红（已归档归因）**。
我本轮触碰的 8 套（`e2e-*` 六套 + smoke + lab-dryrun）与 11 个 `scenario-*` 全部 0 失败。
