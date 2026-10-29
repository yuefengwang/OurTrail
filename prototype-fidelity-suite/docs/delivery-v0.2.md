# v0.2 交付报告：能力补全与泛化准备

**范围**：`prototype-fidelity-suite/`（保真套件 + 四个新技能 + 版本化知识库 + 独立夹具）
**未提交**：本报告所描述的全部改动仍在工作树中，没有 commit / push / 部署。
**读数时间**：2026-10-29（所有数字为本机本次复跑所得，不是引用上一轮文档）。

---

## 0. 边界与禁令的遵守情况

| 任务书禁令 | 本轮实际 | 证据 |
|---|---|---|
| 不得修改成熟原型 | 只读。`docs/prototypes/ourtrail-explore-v3/` 的 6 个 M 文件 mtime 停在 **10-27 23:04**，早于本轮（10-29） | `ls -l --time-style`；`git diff --stat -- docs/prototypes/ourtrail-explore-v3` |
| 不得修改活动/天气业务页面 | `miniprogram/`、`cloudfunctions/` 本轮 **零改动** | `git status` 全量（改动只出现在 `prototype-fidelity-suite/` 内） |
| 不得批量重构其他小程序页面 / 改全局样式 | 未执行 | 同上 |
| 不得合并主分支 / 部署生产 / 改业务数据 | 未执行；无任何网络写操作 | 本报告无 commit 记录 |
| 不得删除已有测试或降低验收阈值 | 既有 20 套全绿；新增断言只增不减。§6 中发现的每一个缺陷都改了**实现或文档**，没有一条是靠放宽断言转绿的 | `node tests/run.js` → 20 套 / 1095 / 0；`docs/audit-v0.1.md` §4 的五态分类仍在 |
| 不得把天气专用设计提升为全局规范 | DNA 里 7 条"全页成立"的规则一律保留为 `global 候选`，`kb confirm` 必须具名 | `pf dna summarize` 输出原文；`design/lib/dna-invariants.js` 的 `GLOBAL_FROM_ONE_FAMILY` |
| 设计方不得自己签字 | `pf review` 的判据落在 `design/review/review.js`，输入是 plan + 渲染产物（只读），并单独检查"评审者 ≠ 设计者"与"每维带证据" | `tests/reviewer.test.js`（92） |
| 禁止把测试预期硬编码进实现 | 9 类夹具由独立 Agent 编写，执行器 `tests/fixtures/run.js` 不认识任何场景 id，判据全部由 `fixture.json` 的声明式 matcher 表达 | §4 |
| 不在业务页面上跑修复实验 | 修复实验只在 `examples/generic-web/` 的通用夹具与仓库外副本上做 | `docs/experiments.md` §2–§7 |

本轮**允许**新增的东西（独立测试页面、示例工程、Skill、Schema、工具）是主要产出面。

---

## 1. 九项交付物：五态分类

状态取自任务书 §10 的五个词：**已实现且实测通过 / 已实现但未验证 / 仅有接口或设计 / 因环境限制 BLOCKED / 尚未实现**。

| # | 交付物 | 状态 | 实测证据（可复跑） | 明确未覆盖的部分 |
|---|---|---|---|---|
| 1 | v0.1 独立审计（§1） | **已实现且实测通过** | `docs/audit-v0.1.md`：七问逐条回答 + 复跑读数 + 主张→五态分类；审计过程本身又揭出两处真缺陷（见 §4 与 §6） | 审计对象是 v0.1 套件，不覆盖 v0.2 新增部分 |
| 2 | Design DNA 提取能力（§2） | **已实现且实测通过**（提取）／**已实现但未验证**（可信度） | `pf dna` 产出 **128 条规则**，schema 校验 + 不变量校验全过；每条带 `source/evidence/scope/confidence/confirmation`；测量事实与推断结论分列 | 规则"是否符合设计意图"需要设计负责人逐条确认——`confirmation.status` 全部仍是 `candidate` |
| 3 | 版本化设计知识库（§3） | **已实现且实测通过** | `pf kb seed/query/conflicts/impact/confirm/verify` 六个子命令；`tests/knowledge-base.test.js` 65；查询支持 page/family/category/level/kind/status/text；`kb verify` 会区分"同语料被改"与"根本是别的项目的语料"（`--corpus`） | 知识库目前只装了 OurTrail 一个项目；"跨项目合并"只有 schema 约束，没有第二个语料 |
| 4 | Generalization Skill（§4） | **已实现且实测通过**（对未知页 s04 的端到端）／**部分未验证** | `pf design --brief … --kb …` 产出 `design-spec.md` + `design-plan.json` + `design-decisions.json` + 可运行 `index.html`；`tests/generalizer.test.js`；夹具 s03/s04 覆盖组件变体与未见页面 | 生成结果"好不好看/够不够用"只能由 §5 的独立评审判；本项目上未做真实页面替换（禁令） |
| 5 | 独立设计审查（§5） | **已实现且实测通过** | `pf review --plan … [--html …]`：七维 + 评审独立性 + 逐条证据与修复建议；`tests/reviewer.test.js` 92；夹具 s07 走交互状态核验 | 独立性是**流程性**的（独立输入、具名 actor、禁自签），不是模型层面的真独立 |
| 6 | Fidelity Suite 七项增强（§6） | **七项全部落地**，其中 3 项带实测实验 | ①组件/区块真填充：`specimen` 页 3 组件 + 3 区块逐值校验；②bundle 新鲜度：编译源树内容指纹（有序 `sha256(relpath\0sha256)`）+ 指纹先于截图的时序 + 复验稳定性，且明确**不**主张"模拟器编译了这棵树"；③多状态多视口：实验 F（375/414 布局级，配 390px 固定机身阴性对照）；④级联归因：`core/lib/cascade.js`；⑤更细验收：`props[]`/`axis`/`maxAbsPx` + `ACCEPTANCE_INVALID`（窄条目没匹配到任何差异也报错）；⑥补齐字重/图标/阴影：字重按声明比较、渐变按颜色+停靠点归一、资源按文件名或 data 指纹、阴影拆 x/y/blur/spread/颜色；⑦有界修复+回滚：`core/lib/repair.js` + 实验 C | 小程序侧 A/B 成组实验仍 **BLOCKED**（注入偏差要改冻结页面）；图标内部路径变形、阴影视觉观感仍只到"像素/墨迹不同"，归因不到声明；20px 以上字重的**像素级**检出仍失败（见 §6.2） |
| 7 | 独立验证夹具（§7） | **已实现且实测通过** | `node tests/fixtures/run.js` → **9 场景（9 ran, 0 blocked）· 373 断言 / 0 失败 / exit 0**；9 类全覆盖、8 个对抗样本；执行器零场景知识，判据全在 `fixture.json` 声明式表达 | 不覆盖真机像素与小程序 A/B 注入；见 §4.4 的"不能证明什么" |
| 8 | 多 Agent 分工执行（§8） | **已实现且实测通过** | 分工与写入面见 §7：实现/文档由主 Agent 承担，夹具内容由**不掌握实现的独立 Agent** 产出，写入面按目录边界切分 | 没有做到"夹具 Agent 完全没见过实现"——它读过仓库文档与 CLI，只是不参与实现；独立性靠**写入面隔离 + 判据不复用实现**，不是信息隔离 |
| 9 | 交付报告与未见页面试验计划（§10） | **本文件** | §1–§7 | 试验计划只有计划，未执行（禁令） |

---

## 2. 本次实测读数

| 命令 | 读数 | 退出码 |
|---|---|---|
| `node tests/run.js` | **20 套 / passed=1095 / failed=0**（20 套逐套读数见下表） | 0 |
| `node examples/generic-web/experiments/run.js` | **128 断言 / 0 失败**（实验 A–F） | 0 |
| `node tests/fixtures/run.js` | **9 场景（9 ran / 0 blocked）· 373 断言 / 0 失败**（368 场景内 + 5 结构门；逐场景见 §4） | 0 |
| `node cloudfunctions/…`（本仓无此路径） | 不适用 | — |
| `node cli/pf.js dna summarize` | **128 条规则 VALID**；177 个色值未 token 化（8 个重复 ≥3 次）；7 条全局候选待确认 | 0 |
| `git status --short` | 改动全部落在 `prototype-fidelity-suite/` 内；`examples/generic-web/{captures,reports,contracts}` 是实验产物（原本就以入库形式存在，跑一次就会变脏，见 §6.4） | — |

读数口径：断言数一律取每个脚本自己打印的 `passed=N`，不引用任何文档里写死的总数。

**与上一版文档里的 1075 为什么不同**（两处都只增不减）：`tests/skills.test.js` 新增"文档里的封闭词表必须与 `design/generalize/plan.js` 完全一致"的门（92 → 104，+12）；`tests/knowledge-base.test.js` 新增"别的项目的语料不是过时语料"的三分支判定（57 → 65，+8）。1075 是这两处落地之前测的。逐套读数（2026-10-29 本次复跑）：

`acceptance 37 · artifacts 26 · bundle 33 · cascade 39 · contract 53 · contracts 137 · design-dna 43 · diff 20 · generalizer 63 · geometry 52 · interaction 34 · knowledge-base 65 · png 17 · regions 30 · repair 42 · reviewer 92 · schema 80 · score 105 · skills 104 · write-safety 23 = 1095`

---

## 3. 能力与文件（分层）

**CLI（零依赖 CommonJS）**：`doctor / init / capture / contract / diff / validate / interactions / verify / repair / dna / kb{seed,query,conflicts,impact,confirm,verify} / design / review / schema`，退出码 0 PASS · 1 FAIL · 2 环境或 UNVERIFIED。

| 层 | 本轮新增/改动 |
|---|---|
| 核心算法 | `core/lib/{cascade,acceptance,bundle,repair}.js` 新增；`contract/geometry/score/report/artifacts/util/png/interaction` 增强 |
| 适配器 | `adapters/web/capture.js`（截图写入走 `writeFileRetry`，修 Windows 杀软锁文件导致的假 BLOCKED）、`adapters/wechat-miniprogram/capture.js`（bundle 内容指纹） |
| 技能 | 11 个 `skills/<name>/SKILL.md`：原有 7 个 + `design-dna-extractor`、`ourtrail-design-dna`、`design-dna-generalizer`、`design-consistency-reviewer` |
| 知识库/生成/评审 | `design/dna-extract/`（sources + 提取器 + 产物）、`design/knowledge/`（KB + 项目库）、`design/generalize/`（plan + render + 产物）、`design/review/`、`design/lib/`（不变量、walker） |
| Schema | 17 份；本轮补 `project-config` 的 `namedViewport/viewports/mapping.dynamicText`，并新增一条"示例配置必须过自己的 schema"的门 |
| 测试 | `tests/` 20 套（1095）＋`tests/fixtures/` 独立夹具（§4）＋`examples/generic-web/experiments/` 实验 A–F（128） |
| 文档 | `docs/{architecture,experiments,limitations-roadmap,reuse-guide,pilot-ourtrail,research-report,audit-v0.1}.md` + 本文件 |

---

## 4. 独立夹具：结果与发现

一次完整运行（2026-10-29，`node tests/fixtures/run.js`）：

```
9 scenarios (9 ran, 0 blocked) · 373 assertions passed, 0 failed
rc=0
```

373 = **368 条场景内断言 + 5 条套件级结构门**。每条场景的断言数恒等于它 `fixture.json` 里声明的 `steps + checks`——执行器不做任何隐式断言，所以下表是**声明式可核对**的，不是"跑了多少算多少"：

| 场景 | 类 | 对抗 | steps | checks | 断言 | 结论 |
|---|---|---|:-:|---|---|---|
| `s01-rule-extraction` | rule-extraction | ✓ | 8 | 22 | 30 | PASS |
| `s02-kb-conflict` | kb-conflict | ✓ | 2 | 12 | 14 | PASS |
| `s03-component-variant` | component-variant | ✓ | 1 | 22 | 23 | PASS |
| `s04-unseen-page` | unseen-page | | 3 | 55 | 58 | PASS |
| `s05-function-preservation` | function-preservation | ✓ | 3 | 45 | 48 | PASS |
| `s06-visual-deviation` | visual-deviation | ✓ | 1 | 45 | 46 | PASS |
| `s07-interaction-state` | interaction-state | ✓ | 4 | 30 | 34 | PASS |
| `s08-post-repair-regression` | post-repair-regression | ✓ | 7 | 82 | 89 | PASS |
| `s09-missing-evidence` | missing-evidence | ✓ | 4 | 22 | 26 | PASS |
| **合计** | **9 类全覆盖** | **8** | 33 | 335 | **368** | **0 失败** |

套件级结构门（5 条，与场景内容无关，防的是"夹具被悄悄删掉"）：≥9 个场景**真跑过**（blocked 不计入）、9 个类各有一个跑过的场景、≥3 个对抗样本、id 唯一、每个场景至少 1 个 step 和 1 个 check。

### 4.1 九个场景各自回答的问题

每条都写成"正向必须过 + 反面必须不过"，判据全部在 `fixture.json` 里声明，执行器 `run.js` 不认识任何场景 id：

| 场景 | 正向 | 反面（同样必须成立） |
|---|---|---|
| s01 | 从**没见过的 4 页 / 2 族**原型抽出规则，每条自带证据/范围/可信度，未确认一律 `candidate` | 两页共有的变量只能是 `page-family`——即使别族页面上出现了**完全相同的色值**，也不许抬成全局；`impact` 对无引用规则给空列表而不是猜 |
| s02 | 同一 subject（`css-var:--leaf`）两条规则给不同值 ⇒ 报冲突、退出码 1 | 无关规则（`--paper`）不得被连带标记；那条"看起来像正常改名的旧 token"格式完全合法、证据自洽，库仍必须拒绝 |
| s03 | 同一卡片的两个视觉实例（102px 带图标 / 76px 无图标）识别为**同一组件族**，差异显式披露为 `varies` + 例外 | 结构相似、语义不同的 `.order` 卡片必须保持为另一条规则，两条不得合并；高度不得被压成单一中位值 |
| s04 | 未见页面（社区药箱盘点）只引用库中**对本页可用**的规则，骨架来自 brief 的区块顺序 | 不得把花园/报修原型的排版整块搬过来；缺依据的决策必须标成 `gap` 而不是编一个 `ruleRef` |
| s05 | 含 8 个业务功能的 brief 全部落到计划与渲染，含各自声明状态 | 为了版面整洁删掉筛选、打印凭据、认领失败提示中的任何一项都必须判失败 |
| s06 | 三处小偏差（4px padding / 底色 / 右移 8px）⇒ 整页 FAIL，按 `pairId` 与声明归因 | 对照区 `s-ctrl` 必须 PASS；只给一个总分的实现过不了（要 `regions[].styles[]` 到具体属性与两侧值） |
| s07 | "真动作 + 后果被观测到"才 PASS | 按钮看得见但**没监听器**、监听器在但**文案不是声明那句**、声明里**没有后果**——三种都不通过 |
| s08 | 有界修复把已定位漂移改回原型值后复验通过，邻居区 `r-value`/`r-note` 前后都 PASS | 锚点不唯一 ⇒ 必须拒绝；修好目标却改坏邻居 ⇒ 必须**逐字节回滚**（`rollback[].byteIdentical=true`、`restoredVerdict=FAIL`） |
| s09 | `m-ok` 是真证据的阳性对照：verdict PASS、3 个区比过、交互检查 PASS | 目标页不存在 / 证据元素从不出现 ⇒ 退出码 2、`verdict=BLOCKED`、**不留任何** diff 或评分产物（`fileMissing` 逐项钉）；`--wait` 那种"等久一点"的修法也不许变绿 |

s09 的阳性对照是这一类的关键：没有 `m-ok`，一个"什么都 UNVERIFIED"的实现能让整个场景全绿。

### 4.2 分诊：夹具错，还是能力缺陷

| # | 现象 | 分诊 | 处置 |
|---|---|---|---|
| 1 | s09 的 `m-wait` 在配置里声明了 `waitForSelector`，`pf verify` 却打出 `PASS capture:target · 5 nodes` 并给出 `verdict FAIL`（首次单跑：23 过 / 8 失败） | **能力缺陷**：CLI 静默丢参 | schema `schemas/project-config.schema.json:119` 声明了该键、适配器 `adapters/web/capture.js:171` 早就支持它、`examples/ourtrail/pf.config.json:14` 也在用，**唯独** `cli/pf.js` 的 `doCapture().common` 没转发。已修（含一行说明为什么这行不能删），修后 s09 26/26；全量 373/0 |
| 2 | s09 目录里留着上一轮留下的 `captures/ contracts/ reports/` 空目录 | **夹具卫生**，不是判据问题 | 执行器把场景目录整份拷到 `os.tmpdir()` 再跑，残留文件可能让 `fileMissing` 类断言**假绿**。已删除；规矩：新场景目录只放 `fixture.json` 与夹具资产，产物一律不许入库 |
| 3 | `--only s09` 报 "28 passed, 3 failed" | **读法问题**，不是失败 | 那 3 条是套件级结构门（≥9 场景 / 9 类覆盖 / ≥3 对抗）。`--only` 在定义上不可能满足它们，只用于开发期定位；**通过与否以全量运行为准** |
| 4 | 工作笔记里出现 s08 92 / s09 28 | **计数口径漂移** | 断言数 = `steps + checks`（s08 7+82=89，s09 4+22=26）。旧数来自场景定稿前的副本，且把结构门算进了场景内。§4 一律用全量运行实测值 |
| 5 | s09 原来另有一份 `target-wait.html`，除缺 `#m-evidence` 外还改了 `<title>` 与 `#m-note` 文案 | **夹具自带的混淆**（独立 Agent 自陈的第 2 条发现） | 那样一来 `waitForSelector` 一旦失效，"变红"的理由会是**文本差异**而不是"声明的证据元素不出现"，刚好掩盖因果。改为 m-wait 直接复用 `target.html`（与 m-ok 同一张页面）并只声明 `waitForSelector`，唯一变量就是那条声明；`target-wait.html` 已删除 |

s01–s08 在各自定稿后**第一次全量运行即全绿**（当时结构门因缺 missing-evidence 类仍红），没有为了让它们变绿而修改任何断言；唯一因缺陷而红过的是 s09。

### 4.3 Agent A 的九条"文档 vs 行为"差异：分诊台账

Agent A（写 s01–s05 的独立 Agent）在自评里给出九条"文档说的与实测不一致"。逐条分诊如下——这张表本身就是任务书 §7 那句话的兑现：**发现文档与实现矛盾时，改文档或改实现，不许为变绿改期望**。

| # | Agent A 报的现象 | 分诊 | 处置 / 证据 |
|---|---|---|---|
| 1 | 字面色值让 DNA 抽取报 `[SCOPE_NOT_BACKED_BY_EVIDENCE]`（`token.literal-colours` 声称覆盖 `garden-detail`，证据只提到 `garden-browse`） | **不变量按设计工作**，不是缺陷 | 抽取器拒绝让只有单页证据的规则声称更大范围，正是 §2 禁止的"把局部做法提升成全局"。实现未改；门在 `design/lib/dna-invariants.js:83`。收窄的是夹具语料的 `scope`，不是判据 |
| 2 | brief 的 `role` 词表没有 `input`，而 schema 的 `kind` 有 | **文档缺口**（不是能力缺口） | 两层词表本就不同：`kind` 是"这段业务干什么"，`role` 是"由什么形态承载"。已在 `skills/design-dna-generalizer/SKILL.md` 补三词表对照，并写明写成 `role:"input"` 会被拒 |
| 3 | 状态词表在文档里没列 | 同上 | 同一张表列出 8 个允许值 + 出处行号；另加一条常驻门：**文档里的封闭词表必须与 `design/generalize/plan.js` 逐字一致**（`tests/skills.test.js` 92→104，+12） |
| 4 | 执行器无法寻址根数组（`pf kb query --json` 产物是 `[{…}]`） | **夹具工具缺陷** | 已修：`tests/fixtures/run.js:56/81` 支持 `$[0].b` 与 `$[*].b` |
| 5 | `kb query` 对单页 scope 不打印页面数 | **复现，判为表述取舍（不修）** | `cli/pf.js:1364` 确实只在 `pages.length > 1` 时打 `(Np)`；单页时行内已给 `page`，计数恒为 1 无信息量，要清单用 `kb impact --id`（`:1434` 完整列 `pages`）。这是显示取舍，不是判据放宽 |
| 6 | `kb verify --file` 没有 `--from`，任何场景库都会误报"语料过时" | **能力缺陷** | 已修：`corpusFreshness()` 区分「同源已过期 / 同源匹配 / **别的语料** / 无从比对」；`kb verify` 新增 `--corpus <dna.json>`；`tests/knowledge-base.test.js` 57→65（+8） |
| 7 | `dna-summary.md` 说"高 76px"，而 `dna.json` 的 `varies.height` 是 `["102px","76px"]` | **能力缺陷（欠披露）** | 已修：实例不一致时陈述改成 `高 76–102px（中位 …）`，并在 `exceptions[]` 列出不一致属性与实际取值；产物已重新生成 |
| 8 | 未测量节点 5 个，而 gaps 7 个 | **复现读数，判定不是不一致** | 两个数覆盖不同集合：`coverage.functions.unresolved = 5` 是函数维，`gaps 7 = ROLE_UNRESOLVED 5 + INTERACTION_UNRESOLVED 2`。s04 实测 `已选型 0 · 未取证 5 · 交互 0/2` |
| 9 | 没有组件族查询面（`--family` 是**页面**族） | **已知缺口，接受** | 替代路径：`kb query --text <tag>`（如 `button` 命中 38 条）+ `kb impact --id`。刻意不新增第二套查询语法——先把"页面族"这一个维度做准 |

另外，Agent A 自陈一次误写：`pf dna --help` 实际执行了抽取并重写 `design/dna-extract/out/*`。该目录本轮本来就是生成产物（未跟踪），见 §6.4；入库前需要显式决定。

### 4.4 夹具能证明什么、不能证明什么

- **能**：CLI 的行为契约（退出码、产物出现/缺席、报告字段与归因链）、"判不了"与"不合格"的分界、修复的有界性与回滚的字节级同一性、以及**测试预期与实现的可分离**（执行器零场景知识，判据全声明式）。
- **不能**：真机像素。s06 比的是同一渲染器下的几何与样式读数，不是硬件渲染结果；小程序侧 A/B 注入仍 **BLOCKED**（§6.1）；"生成出来好不好看"也没有被夹具回答——s04/s05 只证明**结构性保真与功能不丢**，审美判断在 §5 的独立评审里。

---

## 5. 未见页面试验计划（**未执行**）

**目的**：验证 §4 的生成能力在"语料里没有这一屏"时是否还成立。任务书禁止在真实业务页上做修复实验，**也禁止提前重构**，所以这份文件只是计划。

**语料现状（实测）**：DNA 只读了 3 个页面 / 9 个状态，来自 **2 个族**（`activity-list`、`activity-detail`、`weather`）。这决定了"未见"的定义：**第三族**。

**候选目标（按"业务结构丰富度 × 只读可得性"排序）**

| 候选页 | 族 | 为什么适合当未见页面 | 只读取材来源 |
|---|---|---|---|
| `pages/routes`（路线库） | 路线 | 有列表/空态/私有与共享双身份，结构与 activity 列表**不同**（无日期轴、有里程爬升） | `miniprogram/pages/routes/*`、`cloudfunctions/trailApi/domain/routes.js` |
| `pages/tasks`（协作任务清单） | 任务 | 有状态机（待办/进行中/已完成）+ 分类标签，交互面比语料里任何一屏都密 | `miniprogram/pages/tasks/*`、`domain/tasks.js` |
| `pages/notices`（公告） | 公告 | 最简：无列表交互，用来验证"生成器不会为了好看硬加组件" | `miniprogram/pages/notices/*` |

**步骤（每页 6 步，任何一步失败即停并记录）**

1. **业务功能清单**：从只读源码列出该页全部业务功能与状态机，写成 `brief.json`（`role` 必须取自 `design/generalize/plan.js` 的封闭词表，三张表的对照见 §4.3 #2/#3 与 `skills/design-dna-generalizer/SKILL.md`）。
2. **取规则**：`pf kb query --family <新族>` 必须返回"库里没有这个族"而不是猜；允许的兜底只有 `scope.level=global` 且已具名确认的规则。
3. **生成**：`pf design --brief … --kb …`，要求产出里每条决策带 `ruleRef` 或显式 `gap`（"库里没有依据"）。
4. **功能保真核验**：逐条对照第 1 步清单——**少一条功能即 FAIL**，不得以"视觉更简洁"为由裁掉。
5. **独立评审**：`pf review --plan … --html …` 由**未参与生成的 actor** 执行，输出七维结论与逐条修复建议。
6. **不落地**：产物只进 `design/generalize/out/<page>/`，**不回写 `miniprogram/`**。

**预判风险（写在这里，便于将来对账）**

- 语料只有 2 族，"全局规则"极可能不足 → 生成器会把大量决策标成 `gap`，这是**正确行为**，不应被当成失败。
- 任务页的交互密度超过语料，`interaction` 维大概率低分；若它反而高分，先怀疑评审判据太松。

---

## 6. 已知限制与残留风险

### 6.1 仪器层

| 限制 | 实测依据 | 后果 |
|---|---|---|
| 微信侧没有 DOM/CSSOM | `docs/limitations-roadmap.md` §2.1（`App.CDPEnable unimplemented`） | 样式只能读元素级声明；伪元素、继承中间值、规则来源拿不到 |
| 微信截图非 1×（0.7846/0.7820） | 试点 306×660 | 细线、抗锯齿只能按墨迹签名比，不逐像素 |
| 目标侧快照只含已声明选择器 | 试点 12 节点 vs 原型 127 | 几何覆盖 = 映射覆盖，不是整页 |
| 只有 Chromium 一个引擎 | 本机 Playwright | 跨引擎栅格差异未覆盖 |

### 6.2 判定层

- **20px 以上的字重变化**：像素层检不出（b-weight 1.087 ⇒ PASS），只能靠声明比较；两侧都缺声明时只能 `UNVERIFIED`。
- **接受项只到类别粒度**：`acceptedDifferences` 没有按轴切分，混合配对无法只接受一半。
- **图标/阴影**：图标内部路径变形、复杂阴影与渐变方向仍只报"像素不同"，归因不到声明（§6 第 7 项只做到几何 + 墨量）。

### 6.3 流程层（本轮没有执行）

| 项 | 状态 | 原因 |
|---|---|---|
| OurTrail 实现层修复（P1–P5） | **BLOCKED** | 目标在冻结模块，任务书禁止为试点解冻 |
| 小程序侧实验 A/B 成组 | **NOT_RUN / BLOCKED** | 注入偏差要改冻结页面 |
| 未见页面试验（§5） | **未执行** | 任务书禁止提前重构，且产物需负责人裁决 |
| 小程序 bundle 新鲜度的真机验证 | **未验证** | 需要重开共享的微信开发者工具会话，未获授权 |

### 6.4 工作树噪声（不是缺陷，但会误导"我有没有改错东西"）

`examples/generic-web/` 的 `captures/`、`contracts/`、`reports/` 是**入库的实验产物**，跑一次实验就会改写 173 个已跟踪文件并新增若干 `reports/<run>/`。复核本轮改动时请用：

```bash
git status --short | grep -v 'examples/generic-web/\(captures\|contracts\|reports\)'
```

本轮工作树实测（2026-10-29）：**202 个已跟踪文件被改**，其中 **170 个是实验产物**（`examples/generic-web/{captures,contracts,reports}/`），真正的源码/文档改动是 32 个；**75 个未跟踪项**，其中要区分两类：

| 类别 | 路径 | 说明 |
|---|---|---|
| 源码与夹具（**应当入库**） | `core/lib/{acceptance,bundle,cascade,repair}.js`、`design/{dna-extract/extract.js,sources.json,knowledge/kb.js,generalize/{plan,render}.js,review/review.js,lib/*,example-brief.json}`、`schemas/design-*.schema.json`、4 个新技能目录、`tests/{acceptance,bundle,cascade,design-dna,generalizer,knowledge-base,repair,reviewer,write-safety}.test.js`、`tests/fixtures/`、`examples/generic-web/f/fluid.html`、两份新报告 | 新增能力本体 |
| 生成产物（**需要显式决定**） | `design/dna-extract/out/{dna.json,dna-summary.md}`、`design/knowledge/ourtrail/design-dna.json`、`design/generalize/out/**`（含 `review/`） | 由 `pf dna` / `pf kb seed` / `pf design` / `pf review` 产生；可重生成，但也是本轮 §4.3 #7 的验收对象 |

另：`tests/fixtures/scenario-*/` 下**不许**出现 `captures/`、`contracts/`、`reports/`——执行器会把整个场景目录拷进临时目录，残留会污染 `fileMissing` 类断言（§4.2 #2）。

### 6.5 独立性上的诚实边界

- 夹具的**判据**由独立 Agent 写，但执行器与格式由实现方定——"格式"本身会影响能表达什么判据。
- 设计评审的"独立性"靠**角色隔离 + 独立输入 + 禁自签**，不是模型层面的独立；同一模型在两个角色下仍可能共享同一套审美偏好。
- DNA 的 7 条全局候选在未经具名确认前，`pf design` 只能把它们当作**候选**引用，不能升级为规范。

---

## 7. 多 Agent 分工与写入面

| 角色 | 谁做 | 写入面 | 判据来源 |
|---|---|---|---|
| Architect / Integrator | 主 Agent | 全局（`cli/`、`core/`、`skills/`、`schemas/`、`docs/`） | 任务书 §1–§9 |
| Skill Engineer | 主 Agent | `skills/`、`design/` | 任务书 §2–§5 |
| Platform Engineer | 主 Agent | `adapters/`、`core/lib/{bundle,repair,acceptance}.js` | 任务书 §6 |
| QA Engineer（夹具） | **独立 Agent A**（s01–s05）、**独立 Agent B**（s06–s08）、**独立 Agent C → D**（s09） | 只写 `tests/fixtures/scenario-*/` | 只读仓库文档 + 真跑 CLI；判据写进 `fixture.json` |
| 独立评审 | `pf review` 的 `--actor/--designer` 分离 | 只写 `design/review/out/` | DNA 规则 + 渲染产物 |

**夹具作者的实际交付（如实记账，不美化）**：

- Agent A 交出 s01–s05 + 一份独立复跑报告（含 9 条 discrepancies，见 §4.3）。
- Agent B 交出 s06、s07、s08 三个场景后**异常中断**，s09 未产出；中断前的产物已全部通过结构门与自身判据，故保留。
- Agent C 只留下 s09 的三个页面与 `pf.config.json`（页面骨架与阴性场景设计是可用的），**异常中断**前未写 `fixture.json`。
- Agent D 接手 s09：不改 C 的页面，只写 `fixture.json` 并用真跑读数校准期望。

两次中断都是执行环境层面的失败（工具报错退出），不是判据问题；记录在此是因为"谁写的夹具"决定了这些判据的独立性边界。

三条协同约定（都经本轮实测检验过）：

1. **夹具作者不写实现**，实现方不改夹具的期望值——发现不一致时改文档或改实现，不改期望（§4 里每一条 discrepancy 都按这个处理）。
2. **写入面互斥**：夹具 Agent 只碰 `tests/fixtures/`，主 Agent 不碰 `scenario-*/fixture.json` 的期望字段。
3. **格式先定、内容后填**：`fixture.json` 的格式与执行器由主 Agent 先落地并自证（含 `$[0].x` 这类根数组取值的修复），再由夹具 Agent 在格式内表达判据。

## 8. 待裁决

1. **DNA 规则确认**：128 条规则全部 `candidate`。要不要安排一次逐条确认（`pf kb confirm --id … --by …`）？确认前，§5 的生成路径只能引用 `global` 候选。
2. **§5 的候选页选择**：`routes` / `tasks` / `notices` 三选一先做，还是三页一起做？（三页一起做的风险是评审会变成"批量验收"，单页更接近真实协作。）
3. **小程序侧实验的授权**：bundle 新鲜度与 A/B 成组实验都需要动共享的开发者工具会话，需要一次明确授权。
