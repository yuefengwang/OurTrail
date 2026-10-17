# Skill 变更摘要（原始文件 ↔ 新文件）

分支 `win/ui-skill-methodology`（worktree `D:/OurTrail-skill-uplift`）· 2026-10-14 · 未 commit、未 push。

## 1. 文件清单

| 文件 | 原 | 新 | 性质 |
|---|---|---|---|
| `.agents/skills/ourtrail-ui/SKILL.md` | 39 行 | **114 行** | 重写为入口：触发/优先级/四模式/14 条核心规则/最低验证/路由/协作契约/红旗 |
| `references/design-system.md` | 126 行 | **175 行** | 保留全表 + 订正 2 处 STALE + 补录 11 个数值 token + 色值债登记 + 深色模式事实 |
| `references/platform-pitfalls.md` | 71 行 | **99 行** | 14 条 → 17 条，全部补 现象/适用条件/根因/正确处理/最小验证 + `[现行]/[防回归]/[保守约定]` |
| `references/review-checklist.md` | 50 行 | **113 行** | 40 项平铺 → T1–T8 八档，每项含 对象/判据/证据 |
| `references/ui-methodology.md` | — | **118 行（新）** | §0–§10 设计方法论 + 十维质量标准表 |
| `references/audit-verification.md` | — | **96 行（新）** | STALE vs DEBT、证据档、严重度、误判防线、两份模板、常驻红、多 agent |
| `docs/skill-uplift/skill-audit-report.md` | — | 新 | 31 条规则裁决 + 7 个重点问题回答 + 11 条缺口处置 |
| `docs/skill-uplift/skill-validation-report.md` | — | 新 | 检查矩阵 + 63 条抽样复验 + 两个自查缺陷 + 剩余风险 |
| `docs/skill-uplift/skill-change-summary.md` | — | 本文件 | — |
| 合计（skill 本体） | 286 行 | 715 行 | 主文件占比 16%（细节按节号可寻，不需整份读入） |

## 2. 被改写或删除的绝对规则（逐条：旧句 → 新表述 → 证据）

| # | 旧原句 | 新表述 | 依据 |
|---|---|---|---|
| 1 | 「**组件必须声明** `options:{styleIsolation:'apply-shared'}`」（无条件） | 「组件的 WXML/WXSS **引用了 `app.wxss` 的类时**必须声明」，并列出 `meteogram`（全类本地，不需要）与 `privacy-popup`（死代码）为反例 | 12/14 组件承重；`meteogram*`/`.lg` 均在自身 wxss（`.lg` = `meteogram.wxss:22`） |
| 2 | 「所有可点击元素 ≥44px 高」（checklist 硬性） | 「**反复点击的主目标** ≥44px；新增/改动时必须引用 token；行内小控件可豁免并写理由」（R 档） | `--touch-target` 实测仅 7 处引用且全在 `app.wxss`/`roam-scrubber`，页面 wxss 0 引用；且 CSS 高度 ≠ 命中区，无真机证据 |
| 3 | 「一页最多一个实心主按钮」 | 「一页的实心主按钮**预算＝一个"本页唯一推进动作"**；互斥分支/分步/弹层各算一次，须能指认互斥证据；判不出运行时组合降级 E2/E3」 | 实测 4 处反例（`route-edit:30+159`、`editor:171+456`、`activity:231-232`），另有 3 处取决于运行时布尔（`workspace:70+91`）静态不可判 |
| 4 | 「denied/loading/empty/error 一律用 `<status-panel>`」 | 保留为默认路径，**加三类边界**：静态页豁免（`staff`/`privacy`/`cloud-field-poc`）、等价合规（`callout` + 明确出路）、已登记 DEBT（`weather-hub:74/:80/:107`） | 16/20 页在用；4 页无状态分支且属静态/工具页 |
| 5 | 「数据提交一律 `api.dispatchAndSync`」 | 加判据「本页是否还要继续展示刚改的数据」，并把 `signup.js:378` 写成**合规例外**（CAS 链自行推进 + 提交后离开本页） | 34 : 1 实测 |
| 6 | 「WXSS 不支持 `color-mix()`」（陈述为平台事实） | 「`[保守约定]`：仓库内零正例零反例；WebView 渲染下可用性随用户端内核变化，**无法从仓库证真** ⇒ 按不依赖处理；要用现代 CSS 先真机证」 | `color-mix(`/`dvh`/`:root` 各 1 命中且都在 `app.wxss:2` 注释里；`clamp/min/max/aspect-ratio` 0 命中；`gap` 73 处在用 |
| 7 | 「`.page { padding-bottom: calc(32px + 84px + env(...)) }`」（写成 app.wxss 的全局规则） | 「`app.wxss` 的 `.page` 只有 32px；**这条 calc 属于各 tab 页自己的 wxss**（5 页实测），另有 `.tabbar-safe` 占位块与 `.has-sticky`=120px」 | `app.wxss:68/:72/:482` + 5 个页 wxss 行号 |
| 8 | 组件清单里的 `.sky-card/.sky-title/.sky-text` | 替换为真实类名（`.cond-card`、`.cond-pheno`、`.cond-silent`、`.sky-look{,-label,-text}` 等）并标注**定义在页面级 `weather.wxss`** | 全库检索 NOT_FOUND；`weather.wxss:142/:180/:188/:197` |
| 9 | 「禁止发明新色值」（无现状说明） | 保留规则 + **色值债登记表**（5 个活文件逐处）+ 报违规前四道排除（`var()` 兜底 / 注释 / tab-bar / 死代码） | 61 处原始命中逐文件分类，真实违反仅 5 个活文件 |
| 10 | 「`node tools/check.js` ALL PASSED」列为交付项 1 | 保留但补**门的天花板**：14 条核心规则中只有 #12 状态词单源有常驻门，其余 13 条（含 apply-shared、色值、四态、44px、token 登记）**没有任何自动闸门** | `check.js` 8 步与 `check-handlers.js` 两段判据逐项核对 |

**未删除**：旧 skill 的 29 条色 token、`MARK_STYLE` 对应表、四条历史坑、canvas 色板 11 条源注释、14 条平台坑、40 项 checklist 判据、"refactoring-ui 诊断表"署名（该 skill 不在仓库，内容不外包）。

## 3. 新增能力（旧文件完全没有的）

| 能力 | 落点 |
|---|---|
| 四种工作模式 + 模式定性提示 + 混用时按最严档交证据 | SKILL §2 |
| 冲突优先级七级阶梯（含"规范 vs 代码不一致先判 STALE/DEBT"） | SKILL §1 → audit §0 |
| 证据档 E1–E4 与状态词四值；"结论强度不得超过证据档" | audit §1 |
| 严重度四档 + 规范偏离/体验缺陷分栏 + 不许降级 | audit §2 |
| 只读审计报告七字段模板 + 分区闭合自查 | audit §4 |
| M4 验证记录模板（环境/门槛链/污染自证/落盘约定/invalid 处置） | audit §5 |
| 被动收图降级规则；"跑不动≠不用跑"（禁测要写成缺口不是免证据） | SKILL §4 + §7 |
| 设计方法论：主任务、层级与阅读顺序、结构选型表、密度七信号、操作三级、六态、跨页流程、五类形态要点、可读性四档宽度、复用/扩展/新建判据 | ui-methodology §0–§9 |
| 十维质量标准表（问题 / 别误判 / 代码证据 / 何时必须截图 / 严重度起点） | ui-methodology §10 |
| 天气线设计准则的可迁移子集（三层不混排、减话必须点名、弃权≠否定、裁切自陈、`inkOn`、分数不伪装成功率） | ui-methodology §1/§5/§8 |
| 邻居文档指针网（只引用不重复）+ references 不可达时的降级条款 | SKILL §5 |
| 多 Agent 协作契约（独立核实 / 去重键 / 争议保留 / 单文件单改者 / 质疑义务） | SKILL §6 → audit §8 |
| 常驻红与 ENV-ABORT 登记（不重诊清单） | audit §7 |

## 4. 与多 Agent UI/UX 审计任务的配合方式

当轮任务书给范围与维度分配，skill 给判据与证据要求：M3 只读档输出问题清单（七字段）+ 不改代码；M4 档负责截图/驱动并交记录模板；实施 Agent 只碰 P/A 类硬约束，S/R 类偏离要在改动清单里给理由；所有轮次细节（本轮的 7 个重点问题）留在任务书，不进 skill。

## 5. 仍需截图 / 开发者工具 / 真机才能定论的事项

1. **触控命中区**（CSS `min-height:44px` 是否等于可点区域，含密集行内控件）——真机 tap。
2. **文字放大 + 375/414 两档**下的断裂：`route.wxml:95` 一行五标量、图例与标签、按钮文案——天气线已证 390 档，另两档真机仍缺。
3. **tab 页底部留白在全面屏**（`.tabbar-safe` 与实际 tabBar 高度的叠加）——真机滚到底点末行删除按钮。
4. **overlay 关闭态不可命中**——真机在关闭态点击覆盖区。
5. **canvas 图表位置漂移**（`type="2d"` 锁偏移 + 100/320ms 重测）——真机滚动后看是否压正文。
6. **现代 CSS 的实际可用性**（`color-mix()`/`dvh`/`clamp()`）——需在目标基础库与用户端内核上实验，或取微信官方权威说明；本轮维持 UNVERIFIED。
7. **4 处主按钮/危险色反例是否真的同屏出现**（取决于运行时布尔组合）——真机按状态矩阵取样。
8. **深色模式**（当前无 `darkmode` 配置，若立项需真机验对比度与 `map`/canvas 表现）。
9. **原生 `map` 圆角在低版本基础库的降级表现**——真机多版本。

## 6. 明确未做的事

未改任何业务代码（`miniprogram/**`、`cloudfunctions/**`、`tools/**` 零改动）；未 commit / push / 部署；未启动全局 UI 重构；未执行正式多 Agent 审计；未写 `SYNC.md`（任务书范围与根 AGENTS.md 的登记要求冲突，留给负责人裁决，见验证报告 §7.5）。
