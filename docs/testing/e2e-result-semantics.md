# E2E 测试结果语义（Result Semantics）

> E2E 结果语义的定义文件，两套 E2E（A 层 `tools/e2e-test.js`、B 层 `tools/e2e-ui-test.js`）按本模型输出。
> 实现：`tools/e2e-result.js`（Round 2 已落地，2026-10-04）；判别力自证：`tools/e2e-fault-probe-test.js`（31 项变异）。配套文档：`e2e-test-inventory.md`（逐项清单）、
> `e2e-coverage-matrix.md`（业务覆盖）、`e2e-credibility-report.md`（可信度结论）。

## 一、两个独立维度

**Backend（业务）与 UI 是两个独立维度，互相不可替代。**

- **BUSINESS**：动作经真实命令通道到达服务端后，**后端状态是否正确**。证据来源：
  dispatch 返回信封、read / readTransport / readExport / readForm 回读、领域不变量。
- **UI**：**用户在真实界面.runtime 上能否完成这个动作**。证据来源（按强度递减）：
  1. 真实原生 tap（element.tap()）触发页面/组件行为；
  2. 元素级断言（element 存在、class、text、数量）；
  3. page.data() / 组件 data()（页面 runtime 数据，强于纯后端、弱于元素级）。

推论（本轮审计的立论）：

```
Backend PASS  ≠  UI PASS
Screenshot 存在 ≠  UI PASS
Fallback 成功   ≠  UI PASS
脚本没报错      ≠  PASS
```

## 二、四态结论

| 状态 | 含义 | 退出码 |
|---|---|---|
| `PASS` | 所要求的验证层**全部**通过 | 0 |
| `FAIL` | 至少一个要求验证层**明确失败**（断言为假） | 1 |
| `INCONCLUSIVE` | 测试**无法完成**所要求的验证（如 UI 自动化通道退化、环境不可用）——不是失败，但**不是 PASS** | 2 |
| `SKIPPED` | 明确没有执行（本轮两套件无此状态；保留语义供后续使用） | — |

`passed=N failed=M` 行保留用于向后兼容（与其它 `tools/*-test.js` 的门禁约定一致），
但 B 层的**权威结论是 verdict 块**，不再是退出码 0 本身。

## 三、断言分类

- **HARD_BACKEND_ASSERTION**：只能由真实后端状态 / 云函数返回 / 回读成立。
  A 层全部断言属此类。
- **HARD_UI_ASSERTION**：必须经真实 UI runtime 成立。账本里分两档（强度不同，都不许由后端代证）：
  - `L.u(name, cond, evidence)` —— **纯渲染观测**（元素数量 / class / 文本 / page.data / 组件 data），
    不依赖操作，通道健康即可断言；
  - `L.uEffect(name, cond, evidence)` —— **某次用户操作的后果**。若本块内还没有一次**成功的**
    `L.uiTap` / `L.uiInput`，这条直接记 INCONCLUSIVE，拿不到 PASS。
  业务维度用 `L.b(name, cond, evidence)`；环境前置用 `L.env(name, cond, evidence)`（不成立即中断，
  结论 INCONCLUSIVE，**不算断言失败也不算通过**）；无法验证用 `L.uiUnverified(name, reason)`。
  **`checkSoft` 已废除**——它的「失败不计数」正是把「从未通过」洗成「跳过」的通道（F1-09 自证）。
  每条断言都必须带非空 `evidence`，账本拒记无据结论。
- **A 层的 UI 维度恒为 `N/A`**：它不触及渲染，因此它的 PASS 只代表服务链路，
  永远不能被引用成「UI 已验证」。
- **门槛与静默**：块用 `L.block(name, planned, run, gate)` 表达。gate 不过 ⇒ 整块按「未验证」
  记一条并写明原因；块跑完但 `recorded < planned` ⇒ 补记「计划 N 项实记 M 项」的 INCONCLUSIVE。
  这两条合起来关掉「渲染门槛不过 ⇒ 整段静默不执行 ⇒ 看起来全绿」的老路（F1-06 / F1-07 自证）。
- **通道健康度**：`L.setChannel("healthy"|"degraded", evidence)` 由控制组探针（`$$ view` 是否非空）
  决定。块内抛异常时：healthy ⇒ FAIL（真缺陷），degraded ⇒ INCONCLUSIVE（无法验证）——
  两者都**不是** PASS（F1-11 / F1-12 自证）。
- **INCONCLUSIVE**：原本要求 UI 验证的操作，UI 通道失败而云侧 fallback 成功时——
  该步骤记 `BUSINESS: PASS / UI: INCONCLUSIVE`，**OVERALL 不得为 PASS**。

## 四、verdict 块（B 层输出格式）

```
==== VERDICT ====
BUSINESS: PASS|FAIL            （n 通过 / m 失败）
UI:       PASS|FAIL|INCONCLUSIVE（n 通过 / m 失败 / k 项 SOFT-SKIP）
OVERALL:  PASS|FAIL|INCONCLUSIVE
reason:   <INCONCLUSIVE 时必填：哪些 UI 验证未完成、经何路径降级>
```

计算规则（`tools/e2e-result.js` 实测行为）：

1. 任一维度出现断言失败 → 该维度 FAIL，OVERALL = FAIL，退出码 **1**；
2. 存在 `uiUnverified` / 门槛未过 / 计划条数缺口 / 块异常（通道退化时）→ 该维度 INCONCLUSIVE，
   OVERALL = INCONCLUSIVE（除非已有 FAIL），退出码 **2**；
3. 某维度**一条断言都没记** → 该维度 INCONCLUSIVE（没验过不等于通过）；
4. 环境（自动化连接 / 模拟器 / cli.bat）前置不成立 → `L.env` 抛 AbortRun 中断本轮，
   OVERALL = INCONCLUSIVE，退出码 **2**，不记为断言失败；
5. 全部通过且无上述缺口 → OVERALL = PASS，退出码 **0**。

源码完整性自检：`auditSource(src)` 抓六类退化——恒真断言 / checkSoft / callMethod 绕过 /
空 catch / fire-and-forget 命令 / 把 `page.$()` 当数组用（`Array.isArray`）。
B 层启动时先自检自身源码；`tools/e2e-fault-probe-test.js` 的 F2/F3 组证明这套自检真的有判别力
（注入违规必须被指认、合规写法必须不报错、当前两套 E2E 源码必须 0 违规）。

## 五、fallback 的合法用途（与 §12 自愈审计一致）

| 用途 | 合法性 | 结果记法 |
|---|---|---|
| 测试环境恢复（cleanup / 沙盒建档 / fixture） | ✅ 合法 | 计入 BUSINESS |
| 对比验证（UI 操作 → backend 回读） | ✅ 合法且**必须** | 回读结果参与对应维度 |
| 通道故障诊断（记 `UI channel degraded` 后用 backend 判业务状态） | ✅ 合法 | BUSINESS 照常判定，**UI 记 INCONCLUSIVE** |
| 被测动作本身改走云侧命令冒充 UI 通过 | ❌ **禁止** | 必须记 uiUnverified，OVERALL ≠ PASS |

## 六、截图的定位

截图**只能作为 Evidence**（复现证据 / 调试证据 / UX 评审素材），不参与任何 PASS 判定。
B 层有 9 处 `shot()` 调用点（其中两处按分支互斥，单次运行实际落盘 ≤8 张，目录
`~/.ourtrail-e2e/shots/`），均不进入断言条件——此定位在本轮保持不变，
且输出行已显式标注「仅作 Evidence」。
