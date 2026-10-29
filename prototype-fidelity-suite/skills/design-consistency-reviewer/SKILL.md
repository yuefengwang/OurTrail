---
name: design-consistency-reviewer
description: 对一个已经生成、已经渲染出来的页面设计做独立评审：用版本化知识库判定 token 一致性、组件选择合理性、信息组织、交互逻辑、功能完整性、业务例外与新规则冲突，每条结论都带可复核的证据和可执行的修复。设计者不能给自己的设计签字——评审人与设计人相同（或任一方未记录）时，总结论最高只能是 UNVERIFIED。
---

# design-consistency-reviewer

给一份 `design-plan` 加一个真的渲染出来的 `index.html`，回答一个问题：**这份设计能不能交给实现**。
答案不是感觉，是八个各判各的维度加一组可复核的发现——没有总分，也没有"总体还行"。

## 何时用

- `design-dna-generalizer` 刚产出一页设计，要判定它是否守住业务结构与知识库约束；
- 知识库里有规则被确认、被否决或被改写，需要复查已经生成的设计有没有过期；
- 有人问"这屏为什么是这个样子"，需要把每个决定指回一条规则或一处缺口；
- 交付前做最后一道门：`FUNCTION_*`、`SECTION_*`、`INTERACTION_*` 这类机械可判的东西不该留给人眼。

**不用于**：

- 还没有产物、只有想法的阶段——那是 `design-dna-generalizer` 的输入问题；
- 像素级"像不像"——`visual-fidelity-analyzer` 比对的是两侧截图，这里比对的是设计与知识库；
- 给新规则发通行证——确认由人签字（`ourtrail-design-dna`），评审只引用，不代签。

## 硬约束

1. **只读产物，不读意图。** 每条发现都要引用一个真实存在的东西：一个变量名、一处带行号的色值、一个缺失的 `data-function`、一段缺失的关闭态规则。写不出证据的"我觉得"不进报告。
2. **复用知识库自己的判据。** 适用范围与冲突检测直接调用 `design/generalize/plan.js` 与 `design/knowledge/kb.js`；评审器另写一套规则，就会和生成器互相矛盾而没人有错。
3. **设计者不能自己验收。** `actor === designer`，或者缺 `--designer`、缺 `--actor`，总结论封顶 `UNVERIFIED`。这条是机械判断，不是礼貌提醒。
4. **没有总分。** 八个维度分别给 `PASS / FAIL / UNVERIFIED / NOT_APPLICABLE`；任一维 FAIL，总结论 FAIL，不允许用其他维度的通过把它抵消掉。
5. **看不到就是 UNVERIFIED。** 没有 `index.html`、页面没渲染出该契约、例外只有人能判——这些既不等于设计错了，也不等于验过。
6. **例外不许默认通过。** 能机器判的逐条判（"不引入新色值" → 每个色值是否都有 token 出处；"某变量无人消费" → 本页是否真的只用不引）；机器判不了的列进报告，等一个人逐条落笔。

## 输入

| 参数 | 必填 | 是什么 |
|---|---|---|
| `--plan` | 是 | `design-plan.json`：结构、选型、决策与规则引用 |
| `--html` | 否 | 生成的原型；缺省取 plan 同目录的 `index.html`，没有就按"看不到"处理 |
| `--kb` | 否 | 知识库；缺省用项目自带的那份 |
| `--actor` | 否 | 评审人。不写 → 独立性无法证明 |
| `--designer` | 否 | 设计人。与 `--actor` 相同 → 自审 |
| `--out` | 否 | 报告目录，缺省 `plan 同目录/review/` |

## 步骤

1. **生成侧**：`pf design --brief <brief.json> --out <dir>` 产出计划与原型。
2. **换人**：由另一个人（或另一个执行者）跑 `pf review --plan <dir>/design-plan.json --actor <评审人> --designer <设计人>`。
3. **读阻断项**：`review.md` 的 blockers 是 critical 与 major 的合并列表，先处理这些。
4. **修，不改记录**：改页面或改计划；知识库里的测量值是被比对的那一侧，不为了让报告变绿而改它。
5. **重跑**：改了页面就重新生成；只改了计划就重跑评审。两次报告都要留档。
6. **交付**：`design-review-report.json`（机器可读、过 schema）+ `review.md`（人读），随设计一起交。

## 输出

| 文件 | 内容 |
|---|---|
| `design-review-report.json` | 八维结论、每条发现的 `code / where / severity / evidence / fix`、counts、overall、reason |
| `review.md` | 同一份结论的人读版本：每维一节、每条发现三行（证据 / 修复）、需要人判的项单列 |

八个维度：`tokens`（token 一致性）· `components`（组件使用合理性）· `structure`（信息组织）·
`interactions`（交互逻辑）· `completeness`（功能完整性）· `exceptions`（业务例外合理性）·
`rules`（与新规则冲突）· `process`（评审独立性）。

## 质量门

- 退出码：`0` = PASS，`1` = FAIL，`2` = UNVERIFIED 或参数/环境问题。UNVERIFIED 永远不是 0。
- 报告必须通过 `schemas/design-review-report.schema.json`；不合规的报告即使结论是 PASS 也不交。
- 每条发现必须带至少一条证据与一条可执行修复；`fix` 写成"改成什么"，不写"注意一下"。
- `PASS` 的含义只有一句：**这八个维度上没有找到有证据的错误**。它不表示好看、好用，也不替代真机渲染。

## 失败处理

| 看到什么 | 含义 | 怎么处理 |
|---|---|---|
| `SELF_REVIEW` / `NO_REVIEWER` / `NO_DESIGNER` | 独立性不成立 | 换一个人复评；同一人兼做时，报告只能停在 UNVERIFIED |
| `NO_RENDERED_ARTIFACT` | 没有可审的页面 | 传 `--html`，或先跑生成；不要用计划代替页面 |
| `UNDECLARED_VAR` / `TOKEN_NOT_IN_PLAN` / `TOKEN_VALUE_DRIFT` / `UNGROUNDED_COLOUR` | 色值与 token 不一致或凭空出现 | 以知识库的测量值为准改页面；需要新值就先入库再引用 |
| `TOKEN_RULE_ILL_SCOPED` / `RULE_REF_ILL_SCOPED` | 借了本页用不了的规则 | 换成本页可用的规则；族规则要先声明家族 |
| `SILENT_UNMEASURED` | 没选到形态却连缺口都没留 | 补 `ROLE_UNRESOLVED` 缺口，写明为什么选不到 |
| `COMPONENT_NOT_RENDERED` / `COMPONENT_RULE_UNKNOWN` | 计划说的形态页面上没有，或规则不存在 | 按签名渲染；换了形态就把计划一起改 |
| `SECTION_ORDER_DRIFT` / `SECTION_MISSING` / `SECTION_INVENTED` | 页面结构与业务给的顺序不一致 | 区块顺序只取自 `brief.sections`，两边必须一致 |
| `INTERACTION_UNMET` / `INTERACTION_NOT_RENDERED` | 业务要的交互没有契约，或契约没渲染 | 补证据入库，或把它从需求里删掉——不留点了没反应的控件 |
| `DIALOG_OPEN_BY_DEFAULT` / `CLOSED_OVERLAY_HIT_TESTS` | 浮层默认打开，或关闭态仍吃点击 | 关闭态同时不可见、不命中：`hidden` + `display: none` |
| `FUNCTION_MISSING` / `FUNCTION_DUPLICATED` / `FUNCTION_MOVED_SECTION` / `FUNCTION_INVENTED` | 业务功能丢了、重了、挪了、多了 | 一个功能一个落点，位置按计划；增删功能都属业务决定 |
| `STATE_NOT_DECLARED` | 功能声明支持的状态页面上没有 | 补 `data-states` 并在实现里真的支持 |
| `CONSTRAINT_VIOLATED` | 业务明写的约束被违反 | 按约束改，不要改约束去迁就实现 |
| `DEAD_TOKEN_CITED` / `EXCEPTION_NEEDS_HUMAN` | 引用了无人消费的 token，或例外只有人能判 | 前者要么真用要么别引；后者逐条确认并写进评审记录 |
| `UNCONFIRMED_RULES` / `CONFLICTING_RULES_CITED` | 依据仍是 candidate，或两条被引用的规则互相矛盾 | 前者标注"依据未确认"；后者先 `pf kb conflicts` 解决库里冲突 |

## 示例

对一个真实生成物跑一次，读数是：

```
review FAIL · community-book-lending · tokens PASS · components UNVERIFIED · structure PASS ·
  interactions FAIL · completeness PASS · exceptions UNVERIFIED · rules UNVERIFIED · process PASS
  findings 4 (critical 1 / major 3 / minor 0)
  ✗ critical INTERACTION_UNMET @ status-feedback
  ✗ major DEAD_TOKEN_CITED @ token.var.green-bright
  ✗ major EXCEPTION_NEEDS_HUMAN @ exceptions
  ✗ major UNCONFIRMED_RULES @ rules
```

这条读数值得照抄的不是结论，而是它的**诚实程度**：三处 UNVERIFIED 都不是"没查"，而是
"这个库里本来就没有该角色形态 / 这些例外只有人能判 / 这些规则还没人签字"。
把它硬拉成 PASS 的唯一办法是放松判据，而那正是本技能存在的理由。

互相独立的干净夹具（合成知识库 + 三个功能）在 `tests/reviewer.test.js` 里走完整闭环：
干净产物在换人评审时 PASS；把评审人改成设计人后立刻落到 UNVERIFIED；删掉 `index.html` 后五个维度一起变 UNVERIFIED；
往产物里注入一处裸色值、一处重复功能、一次区块换序、一个默认打开的浮层，都能拿到对应的 code 与行号。

## 与其他技能的关系

- `design-dna-extractor` → 只读原型抽出带出处的规则；
- `ourtrail-design-dna` → 有版本、有署名确认的知识库，本技能引用的就是它；
- `design-dna-generalizer` → 业务结构 + 知识库 → 页面设计；**它不能评审自己的产物**；
- 本技能 → 独立评审设计与知识库的一致性，产出可归档的评审报告；
- `visual-fidelity-analyzer` → 评审**实现**与原型之间的像素差异，那是另一条链路；
- `fidelity-orchestrator` → 什么时候跑哪一步、谁签字。
