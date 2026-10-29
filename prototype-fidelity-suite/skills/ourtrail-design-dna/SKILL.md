---
name: ourtrail-design-dna
description: OurTrail 的项目级设计知识库（不是通用技能）：把 design-dna-extractor 抽出的规则装进一个带版本号、带变更日志、带影响分析的仓库内数据文件，支持查询、署名确认、冲突检查与「改这条会动到谁」。用于「这些规则里到底认了哪几条」「两条规则打不打得起来」「改一个 token 要重测哪些组件」「这批原型换了，我的知识库过期没有」。
---

# ourtrail-design-dna

把「我们这套原型里有哪些设计约定」从一份**一次性抽取报告**变成一件**有版本、有人签名、能对账**的资产。

与 `design-dna-extractor` 的分工是一条线：抽取器只读原型、只产出 `candidate`、**没有权力确认任何事**；
本技能管的是那之后——规则进库、人署名、冲突对账、改动影响面。所以本技能**本身不含任何设计事实**：
规则住在仓库内的数据文件里，技能目录只有说明书。把规则抄进技能目录，
下一次原型变更时就会有两份互相矛盾的真值。

## 何时用

- 想知道「我们到底认了几条规则、还有多少是没人签字的候选」。
- 要改一条现有规则（阈值、取值、适用范围），得先知道它会牵动哪些组件与页面。
- 两条规则看起来互相矛盾，需要判断是**真冲突**还是**只是长得像**。
- 原型改过了，要判断知识库是不是过期了（而不是等到新页面按旧规则做完才发现）。
- 新规则要正式生效——需要一条**署名**的确认记录，而不是聊天里说过一句。

不适用：从原型里抽规则（用 `design-dna-extractor`）、按规则设计新页面（用 `design-dna-generalizer`）、
判断某个实现是否偏离规则（用 `design-consistency-reviewer`）。

## 硬约束

1. **规则只住一个地方**：`design/knowledge/ourtrail/design-dna.json`。
   技能目录不存规则副本、不存阈值表、不存"我们约定圆角 18"这类事实句。
2. **入库不改变可信度**。`seed` 把抽取结果原样搬进来，`confirmation.status` 仍是 `candidate`。
   从候选到确认只有一条路：`confirm --id … --by <人>`。**匿名确认不算确认**，命令直接拒绝。
3. **版本号只在内容真的变了时才涨**。同样的规则再写一次（字段逐项相同）返回 `changed: false`，
   `revision` 不动、变更日志不写——否则"第 137 版"会被读成"改了 137 次"。
4. **冲突只在同一 subject 上找**。`--green` 与 `--blue` 不冲突（两个不同的变量）；
   同一个 `--green` 被两条规则记成两个不同的值才是。subject 由规则的值机械推导，不由分类或页面名推导。
5. **影响面只由证据推导**。谁用了某个变量、谁共享某个选择器、谁是某组件的子部件——
   全部来自规则自己声明的证据与作用域；**页面名不参与推导**（否则"在天气页出现过"就会被读成"天气页依赖它"）。
6. **变更日志只追加**。条目按时间保留最近 N 条，按 `at`/`revision` 判序，**不按数组位置**——
   数组位置与写入时间在回读之后没有关系。
7. **过期是可检测的**：库记着语料的文件指纹，`verify` 拿当前抽取结果对一遍，
   语料动了就报 `stale` 并点名是哪个文件变了/多了/少了。

## 输入

| 输入 | 位置 | 说明 |
|---|---|---|
| 抽取产物 | `design/dna-extract/out/dna.json` | `pf dna` 的产物；`seed` 的默认来源 |
| 知识库文件 | `design/knowledge/ourtrail/design-dna.json` | 默认库路径；可用 `--file` 指向别处 |
| 人的身份 | `--by <name>` | 确认/更新时的署名；缺失即拒绝 |
| 时间 | `--at <ISO>` | 缺省取当前时间；**测历史时用它固定时刻** |

命令都在套件根目录执行，路径一律相对，不写机器路径。

## 步骤

1. 要建库或重建：`node cli/pf.js dna` 先抽一遍，再 `node cli/pf.js kb seed`。
   库已存在时 `seed` 会**拒绝覆盖**（`KB_EXISTS`）——覆盖会把已签名的确认打回候选。
2. 建库后先 `node cli/pf.js kb verify`：形状、不变量、语料新鲜度、冲突，一次看全。
3. 查：`node cli/pf.js kb query --category token --level global --json`。
   支持 `--id --category --kind --confidence --level --page --family --status --text`；只做筛选，不排序重要性。
   `--family` 是**页面族**。没有"组件族"查询面（同一签名的多个实例只能按 `--text <tag>`
   或 `kb impact --id` 组合找）：这是已知缺口，刻意先只把页面族这一个维度做准。
4. 对账：`node cli/pf.js kb conflicts` —— 有冲突退出码 1。
5. 改之前先问影响：`node cli/pf.js kb impact --id <ruleId>`。
6. 正式生效：`node cli/pf.js kb confirm --id <ruleId> --by <name> --note <为什么>`；
   判定不成立用 `--reject`（同样是署名动作，不是删除）。

## 输出

| 文件 / 命令 | 内容 |
|---|---|
| `design-dna.json` | 规则集（`rules`）+ 语料指纹（`corpus`）+ 版本号（`revision`）+ 变更日志（`changelog`）+ 设计决策记录（`decisions`） |
| `kb query` | 命中的规则逐行：id / 分类 / 范围（`page`；跨多页时才叠加 `(Np)`）/ 可信度 / 确认状态 / 陈述原文 |
| `kb conflicts` | 每条冲突：`code` / 涉及规则 / 严重度 / 一句话说明 |
| `kb impact` | 受影响的页面、组件、以及**每条依赖的理由**（用了某变量 / 共享某选择器 / 是某签名的子部件） |
| `kb verify` | `revision` / 规则数 / 已确认数 / 候选数 / 范围分布 / 语料是否仍匹配 / 冲突 |

`kb verify` 的语料比对只对**同源**的抽取产物有意义：它按文件名比对指纹。缺省用本仓库的
`design/dna-extract/out/dna.json`；给别的项目的库跑这条命令时，必须用 `--corpus <dna.json>`
指向那个项目自己的抽取产物，否则工具会明确打印 `corpus freshness UNVERIFIED … shares none of them`，
而不是把"两份不同的语料"误报成"你的库过时了"。

```jsonc
// changelog 里的一条（只追加，带署名与时间）
{ "revision": 129, "at": "2026-10-29T10:00:00.000Z", "by": "yuefengwang",
  "action": "confirm", "id": "token.var.green", "fields": ["confirmation"],
  "note": "三页共用，已与设计确认" }
```

## 质量门

一个库要能交给下游使用，下列全部成立：

- `kb verify` 退出 0：符合 `schemas/design-dna-kb.schema.json`，且 `verifyKb()` 零违规；
- 每条规则的 `confirmation.status === "confirmed"` 时必有 `confirmation.by`（匿名确认 = 拒绝）；
- `summary.confirmed` 与实际已确认条数一致，`revision` 与变更日志最后一条一致；
- `changelog` 每条都有 `at`；只有真的变了才产生条目（`changed: false` 不涨版本）；
- `corpus` 与当前抽取结果一致，或差异被明确打印成 `stale` 并点名字文件；
- `kb conflicts` 退出 0，或每条冲突都已经被处理（改值 / 改适用范围 / 记一条例外并写进 `decisions`）；
- `kb impact` 对每条被引用的规则给出**非空理由**；说不出理由的依赖不许出现。

任一不成立 ⇒ 本库 UNVERIFIED，不得用于新页面设计。

## 失败处理

| 现象 | 含义与处置 |
|---|---|
| `KB_EXISTS`（seed 拒绝覆盖） | 库里有确认记录。要重建先另存旧文件；`--force` 会把确认全部打回候选，属于故意破坏 |
| `KB_MISSING` | 还没建库：先 `pf dna` 再 `kb seed` |
| `KB_SCHEMA_INVALID` / `KB_INVARIANT_VIOLATION` | 库被手工改坏了。按打印的路径修，不要放宽 schema |
| `RULE_NOT_FOUND` | id 拼错或在别的库里：`kb query --text <关键词>` 先找到真名 |
| `kb confirm` 报缺 `--by` | 这是设计选择不是缺陷：没有署名的确认不改变任何事的可信度 |
| 同一个 subject 报 `VALUE_CONFLICT` | 两条规则对同一件东西给了两个值。先定哪个对，再改另一条的适用范围或删它 |
| `SCOPE_DISAGREEMENT` | 同一 subject 一条说全局一条说本族。通常是把**局部做法**写成了全局——先查证据覆盖了几页 |
| `EVIDENCE_OUTSIDE_SCOPE` | 适用范围里点了证据里没有的页面。截断不许把页面截掉，补证据或收窄范围 |
| `stale` 且 changed 名单很长 | 原型大改：重抽 → 逐条比对 → 只 `confirm` 仍然成立的，不要整库重建 |
| `corpus freshness UNVERIFIED … shares none of them` | **没有比对**，不是"库过时"：这个库不是从本仓库的语料建的。用 `--corpus <该项目的 dna.json>` 再跑一次 |
| 变更日志超过上限 | 按 `at` 淘汰最旧的，**不许按数组下标砍**（回读顺序≠写入顺序） |

## 示例

```bash
node cli/pf.js kb verify
# kb VALID · revision 128 · 128 rules · confirmed 0 · candidates 128
#   scope {"global":34,"page-family":20,"page":74}
#   corpus matches the current extraction

node cli/pf.js kb conflicts
# no conflicts among 128 rules (revision 128)

node cli/pf.js kb impact --id token.var.green
# rule      token.var.green
# subject   css-var:--green
# pages     activity-detail、activity-list、weather
# dependent rules
#   component.span-mine-status  (使用了 --green（…）)
#   component.span-row-date     (使用了 --green（…）)
#   exception.sheet-overrides   (使用了 --green（…）)

node cli/pf.js kb confirm --id token.var.green --by yuefengwang --note 三页共用，与设计确认
# confirmed token.var.green · revision 129 · fields confirmation
```

## 与其他技能的关系

- 上游：`design-dna-extractor`（产出候选规则；本技能只做搬运，不改它们的可信度）。
- 下游：`design-dna-generalizer`（设计新页面时把库当唯一规则来源，并引用规则 id）、
  `design-consistency-reviewer`（用库判定实现是否偏离，冲突项要能指回具体 rule id）。
- 与 `fidelity-orchestrator` 的分工：后者管**一次比对**的 gate 与交付，本技能管**跨比对的规则资产**。
- 它**不判定**哪条规则好、不删规则（只 `reject`）、不改原型、不写产品代码。
