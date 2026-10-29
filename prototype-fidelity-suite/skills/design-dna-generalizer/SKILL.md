---
name: design-dna-generalizer
description: 把一份业务结构说明（不再有现成原型可抄）变成可运行的页面设计：信息架构、组件选型、交互方案、HTML 原型、设计决策与规则引用。结构只取自 brief，选型只取自知识库里**对该页允许**的规则，选不到就留下缺口而不是编一个形态。用于"这一屏该长什么样""能不能沿用我们现有的语言，但不要照搬天气页"。
---

# design-dna-generalizer

从「业务流程 + 功能 + 状态」出发，用库里的规则拼出一屏新页面；
拼不出来的地方**明写缺口**，而不是拿一个长得差不多的原型顶上去。

它和保真套件方向相反：保真套件问「实现和原型差多少」，本技能问
「还没有原型的那一屏，按我们已确证的约定应该长什么样」。

## 何时用

- 新页面／新页面族还没有设计稿，但业务结构已经能说清（有哪些区块、每块要干什么）。
- 要把既有视觉语言用到**不相关的业务**上，同时不想把天气页／活动页的排版整块搬过去。
- 需要一份能落到实现的设计规格：不只是图，还要说清每个决定引用了哪条规则。
- 评审前想先自查：这一屏的每个元素，是库里有出处，还是我自己编的。

不适用：修复真实实现与原型的偏差（用 `visual-fidelity-analyzer`）；从原型里抽规则
（用 `design-dna-extractor`）；审查已完成的实现（用 `design-consistency-reviewer`）。
**本轮也不用于整改 OurTrail 现有的活动／天气业务页面**——那些页面是只读知识来源。

## 硬约束

1. **结构由业务给，不由模板推导。** `brief.sections` 的集合与顺序就是页面的集合与顺序；
   代码里没有任何"按页面名挑骨架"的分支。`validatePlan` 用 `SECTION_ORDER_NOT_FROM_BRIEF`
   把这件事钉住：改顺序、加区块、少区块都会被拒。
2. **功能不许丢、不许造。** 每个 `functions[]` 条目必须在产物里恰好出现一次
   （`FUNCTION_DROPPED` / `FUNCTION_DUPLICATED` / `FUNCTION_MOVED_SECTION` / `FUNCTION_INVENTED`）。
   "为了视觉简洁删掉一块"在这条约束下不可表达。
3. **适用范围决定能不能借。** `global` 规则任何页面可用；`page-family` 只有 brief 显式声明了
   该族才可用（并标为借用）；`page` 规则永远不许用在新页面上——那是一屏自己的排版，
   照搬它就是"机械复制"。被挡掉的规则连同挡它的范围一起记进 `rejected`。
4. **选不到就是缺口。** 角色/交互解析不出来时写 `ROLE_UNRESOLVED` / `INTERACTION_UNRESOLVED`，
   并说明为什么（"只在 weather 上量到""本页未声明家族"）。没有兜底形态、没有默认间距。
5. **没有测量就没有数字。** 布局用相对单位；只有库里量到的 token 才写成具体值。
   你没量过的 24px 不是你决定的，是编的。
6. **每个断言都带出处。** 渲染出的每个节点是 `data-grounding="rule:<id>"` 或 `"brief"`，
   没有第三种取值；`unmeasured` 节点数必须等于未解析的缺口数。

## 输入

| 输入 | 说明 |
|---|---|
| `brief.id` / `brief.title` | 页面身份。**不参与任何选择**：改名不改变设计 |
| `brief.family` | 声明本页属于哪一族；留空即"不借家族规则" |
| `brief.platform` | 目标平台与视口；约束（无 hover / 触摸为主）随产物写进 spec |
| `brief.constraints` | 业务硬约束，原样进 spec，不被设计决定覆盖 |
| `brief.sections[]` | `id` / `role` / `surface` / `functions[]`；顺序即页面顺序 |
| `brief.sections[].functions[]` | `id` / `label` / `kind` / `role` / `states[]`；`kind` 与 `role` 取封闭词表 |
| `brief.interactions[]` | 期望的交互模型：`tab-switch` / `confirm-dialog` / `status-feedback` / `text-entry` |
| 知识库 | `--kb <file>`，缺省用 `design/knowledge/ourtrail/design-dna.json` |

`states` 写的是"这个功能必须支持哪些状态"，不是"这一版渲染成哪个状态"；
渲染取 `default → filled → 第一个` 作为静态预览，其余状态由 `data-states` 声明。

### 三个封闭词表（写 brief 前先看这张表）

| 字段 | 允许值 | 权威出处 |
|---|---|---|
| `functions[].kind` | `display` / `list` / `action` / `input` / `navigation` / `feedback` | design/generalize/plan.js 第 32 行（FUNCTION_KINDS） |
| `functions[].role` | `button` / `chip` / `icon` / `list` / `metric` / `nav` / `note` / `row` / `row-date` / `row-meta` / `row-metrics` / `row-title` / `section` / `status` / `tab` / `text` | 同文件 ROLES（导出为 ROLE_NAMES，按字母序） |
| `functions[].states` | `default` / `loading` / `empty` / `filled` / `error` / `disabled` / `selected` / `confirming` | 同文件第 34 行（STATE_WORDS） |
| `interactions[]` | `tab-switch` / `confirm-dialog` / `status-feedback` / `text-entry` | 同文件 INTERACTION_ARIA 的键（导出为 INTERACTION_NAMES） |

两层不要混：`kind` 说的是**这段业务是干什么的**（表单录入就是 `input`），
`role` 说的是**它由哪种内容形态承载**（`text` = 标题/正文/时间这类文字节点）。
所以 `input` 只出现在 `kind` 里，`role` 里没有它——写成 `role: "input"` 会被
`BRIEF_INVALID` 拒掉并列出全部允许值。词表以代码为准，本表只是把代码里的
枚举抄到文档里；**报错信息里打印的就是权威清单**，两者不一致时以报错为准并修本表。

## 步骤

1. `node cli/pf.js kb verify` —— 库不健康就不要基于它生成设计。
2. 写 brief。区块与功能**从业务流程数出来**，不要先想版面再倒推功能。
3. `node cli/pf.js design --brief <brief.json> --out <dir>`。
4. 看首行结论：`已选型 N / 未取证 M`。未取证即缺口，逐条读 `!` 行给出的原因。
5. 缺口分两种处理：业务确实需要的 → 补证据（回到原型量）或接受"这一版没有约定"；
   业务不需要的 → 从 brief 里删掉这个功能，而不是留在产物里当装饰。
6. 交给 `design-consistency-reviewer` 独立复核；**生成者不得自己宣布通过**。

## 输出

| 文件 | 内容 |
|---|---|
| `design-plan.json` | 机器可校验的计划（`schemas/design-plan.schema.json`） |
| `index.html` | 单文件可运行原型，零外部依赖 |
| `design-spec.md` | 人读规格：信息架构 / 组件 / 布局 / 交互 / 状态 / 缺口 / 被挡掉的规则 |
| `design-decisions.json` | 每条决定的规则引用 |

`coverage` 必须闭合：`resolved + unresolved === functions`，
`interactionsResolved <= interactionsRequested`。不闭合的计划不允许离开工具。

## 质量门

全部成立才算"可用于评审"：

- `pf design` 退出码 0（`1` = 计划自身不自洽，`2` = brief/库不可用）；
- `design-plan.json` 通过 `schemas/design-plan.schema.json`；
- `validatePlan` 返回空：功能齐、顺序来自 brief、每条引用都存在且范围允许、缺口都留痕；
- 每条 `decisions[].ruleRefs` 非空，且每个 id 在**本页可用的规则**里；
- `index.html` 里没有 `unmeasured` 之外的"无出处"节点，也没有 `data-grounding` 取值之外的第三种；
- 产物里不出现源页面的类名（生成器不得靠复制样式表过关）。

**注意：门全绿只证明"结构完整、出处可追"，不证明"这一屏好看或好用"。**
后者需要独立评审与真实渲染，属 UNVERIFIED 到那时为止。

## 失败处理

| 现象 | 处置 |
|---|---|
| `BRIEF_MISSING` / `BRIEF_INVALID` | brief 不是"业务结构"：补 `title`、补区块、修 `kind`/`role` 词表内的取值；不要靠生成器猜 |
| 缺口数量接近功能数量 | 正常结局而非故障：库里没有该页可用的形态证据。要么补证据，要么接受缺口 |
| `RULE_REF_ILL_SCOPED` | 有人手工往计划里塞了不可用的规则；删掉它或先给它补够覆盖再声明为 global |
| `SECTION_ORDER_NOT_FROM_BRIEF` | 手改了区块顺序；顺序只能来自 brief |
| `FUNCTION_DROPPED` / `FUNCTION_INVENTED` | 手增删了功能；功能集由业务定义，不由设计决定 |
| 生成的 HTML 打不开 | 检查是否被外部字体/图标引用；产物必须是零外部依赖的自包含文件 |
| 未取证那项其实是业务必需的 | **不要**用 `page` 范围的规则临时补上——那正是"机械复制"。补证据或记为待定 |

## 示例

```bash
node cli/pf.js kb verify
node cli/pf.js design --brief design/generalize/example-brief.json --out design/generalize/out
# design VALID · community-book-lending · 4 区块 / 4 功能
#   已选型 1 · 未取证 3 · 交互 1/2
#   rules cited 25 · rejected by scope 90 · gaps 4
#   ! ROLE_UNRESOLVED @ head/show-title
#   ! ROLE_UNRESOLVED @ search/filter-books
#   ! ROLE_UNRESOLVED @ shelf/list-books
#   ! INTERACTION_UNRESOLVED @ interactions/status-feedback
```

这份 brief 与 OurTrail 的户外业务无关（社区图书借阅），是刻意的：
它证明技能不是靠"认得这是哪个页面"来出活的。
`已选型 1` 是真实读数——库里只有一条组件规则够格用于未声明家族的新页，
其余都被范围挡掉并逐条记录，而不是悄悄套用天气页的卡片。

## 与其他技能的关系

- 上游：`design-dna-extractor`（抽规则）→ `ourtrail-design-dna`（入库、确认、查冲突、算影响面）。
  本技能**只读**知识库，不改它，也不把缺口写回成规则。
- 下游：`design-consistency-reviewer`（用同一份库独立判定产物是否偏离），
  需要落到某平台时接 `target-platform-adapter`。
- 它**不**判定原型好不好、不删减业务功能、不改产品代码、不替代人的验收。
