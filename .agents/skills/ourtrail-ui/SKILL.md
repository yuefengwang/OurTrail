---
name: ourtrail-ui
description: OurTrail 小程序（原生 WXML/WXSS/CommonJS）的 UI 设计系统、设计方法论与审查验证规范。凡在 miniprogram/ 下新建页面或组件、设计界面、调整布局/样式/间距/配色、改进信息层级与信息密度、优化交互与状态反馈、做只读 UI/UX 审计或代码走查、按真机截图做视觉审查、用微信开发者工具/miniprogram-automator 验证交互，或多 Agent 协作改同一批 UI 时使用——即使用户只说"看下这页""这里太乱""顺手改一下""帮我审一下"而没有提"设计系统"四个字。
---

# OurTrail UI/UX 工程规范

**本 skill 是设计背景与工程约束，不是审计结论。** 它给出的是判据与证据要求；任何"这样设计好不好"的结论仍须由具体那轮的取证实证，允许被质疑并推翻（推翻链记进当轮报告，不改本文件的既有条目——除非取证证明条目本身错了）。

设计语言：森林绿 × 嫩叶绿 × 纸面底，圆角卡片，**文字承载语义（色相只是辅助）**。整体从高仿真原型 `docs/prototypes/ourtrail-app` 移植；原型是**设计语言来源**，其 AGENTS.md 明令不得运行/构建/扩展，也不得当作规范本体引用。

产品定位决定 UI 的底线：零金额、纯工具的熟人圈户外同行履约工具。所以界面要**替用户做判断但不冒充权威**——状态必须说清"现在怎样 + 接下来会怎样"，凡由天气数据派生的结论一律用概率语气，不承诺救援/保险，不把"没数据"印成"没有"。

## 1. 冲突时谁优先

自上而下，上级压下级；判不出或必须越级时**登记待裁决，不自行改数、不自行改样式**：

1. 微信平台硬限制（渲染器与基础库决定的能力边界）
2. 根 `AGENTS.md` 的铁律（尤其 13/14/17/19/21/22/24 与真机门槛 32–35）
3. 已验证的架构约束：domain → projection → label 单向；状态与"下一步"只出自 `utils/journey.js`；配色与全局类只出自 `app.wxss`
4. `miniprogram/app.wxss` 现状（设计系统的真身，实时值以此为准）
5. 本 skill 及其 references
6. 现有页面/组件的实现惯例
7. 任何人（含负责人）的单次审美偏好

> 第 3、4 级高于第 5 级的实际含义：**规范与代码不一致时，先判规范是 STALE 还是代码是 DEBT**，判据见 [references/audit-verification.md](references/audit-verification.md) 的 §0，不许默认"以代码为准"或"以规范为准"。

## 2. 四种工作模式（先定性，再动手）

| 模式 | 用于 | 必经步骤 | 最低证据 | 禁止 |
|---|---|---|---|---|
| **M1 Design / Build** | 新建页面或组件、重设计一屏 | ①定用户唯一主任务与信息顺序（`ui-methodology.md` §0）②查 `app.wxss` 与组件清单里有无等价物 ③选结构（`ui-methodology.md` §2，不是默认套 `.card`）④写四态与危险操作 ⑤静态门 + 结构改动后真机 | 静态门 exit 0；新建/改组件结构必须有真机回读（见 §4） | 未定主任务就开写；发明新色值/新 token；把 `docs/prototypes/` 当实现参考 |
| **M2 Improve / Refactor** | 优化现有页面（观感、密度、层级、流程） | ①先复述"这页现在解决什么、哪些设计是对的必须保留" ②定位问题与根因（数据/结构/样式/文案哪一层）③最小改动面 ④改前改后同条件对照 | 问题清单 + 改动面清单 + 对照证据（截图或 DOM 读数） | 无理由全量重写；顺手改业务逻辑；把"我喜欢的风格"当成问题 |
| **M3 Audit（只读）** | UI/UX 审查、代码走查、验收前自查 | ①以真实代码为证据逐条核实 ②每条发现标证据档 E1/E2/E3/E4 与严重度（定义 `audit-verification.md` §1–§2）③规范偏离 ≠ 体验缺陷，分开写 ④按 §4 模板出报告 | 每条发现带 `file:line`；E2 必须写出推断链；E3 必须标"未验证" | 改代码；因"不符合规范"自动判严重；因"符合规范"判体验良好；把未执行的检查标通过 |
| **M4 Visual / Runtime Verification** | 截图审查、开发者工具驱动、真机回归 | ①记录环境（工具版本/基础库/视口宽度/页面/数据是真实还是注入）②证 bundle 新鲜 ③操作 + 后果观测 ④落盘截图与读数（模板 `audit-verification.md` §5） | §4 的三道门槛；**截图不存在时不得声称完成视觉验证** | 把静态审计、截图审查、自动化点击、真机测试混为同一种证据；用 `page.data()` 读数冒充像素证据 |

判定提示：负责人说"看下/审下" → M3；说"太乱/不顺/优化" → M2；说"做个新的/加一屏" → M1；给了截图或要求"验证/确认渲染" → M4。模式混用时按最严的那档交证据，并说明哪些结论来自哪档。

## 3. 核心规则（每条标：类别 / 现状 / 有无自动门）

类别：**P** 平台硬限制 · **A** 架构约束 · **S** 设计规范 · **R** 设计建议（可按页面调整）。
现状：**VERIFIED** 实测成立 · **CONDITIONAL** 有成立条件与例外 · **DEBT** 现状违反（新增代码不得再违反，既存不属本轮修） · **UNVERIFIED** 仓库内无可核证据。

| # | 规则 | 类别 | 现状 | 自动门 | 判据与适用条件 |
|---|---|---|---|---|---|
| 1 | 组件的 WXML/WXSS 引用了 `app.wxss` 的**类**时，必须声明 `options: { styleIsolation: 'apply-shared' }`；`options` 键每 `Component()` 只许出现一次 | P | VERIFIED | 无 | 16 个组件里 14 个靠它承重；`meteogram` 全类本地 ⇒ 不需要；`privacy-popup` 死代码无声明。CSS 变量靠继承不受隔离影响，**只有选择器匹配受影响**——"var() 有值但 `.card` 没样式"就是它。详 [references/platform-pitfalls.md](references/platform-pitfalls.md) §1–§2 |
| 2 | `custom-tab-bar/index.wxss` 必须完全自包含、颜色写字面量 | A | VERIFIED | 无 | 实测 5 处字面量、零 `var()`，属规则允许的例外位 |
| 3 | 新语义色只能进 `app.wxss` 并在 `design-system.md` 登记；页面/组件内不得另发明色值 | S | **DEBT** | 无 | 实测 12 文件 61 处原始命中；真实违反＝`home/discover/weather/activity/overlay` 5 个活文件（明细 [references/design-system.md](references/design-system.md) §现状色值债登记）。**报违规前先看那行是不是 `var(--x, #fallback)` 兜底或注释** |
| 4 | Tab 页底部留白 `calc(32px + 84px + env(safe-area-inset-bottom))`；含 `.sticky-action` 的页用 `.page.has-sticky`（120px） | P | VERIFIED | 无 | `app.wxss` 的 `.page` 只给 32px（`:68`），**这条 calc 属于各 tab 页自己的 wxss**（home/notices/anotices/me/weather-hub）；`app.wxss:482` 另有 `.tabbar-safe` 占位块。漏了会表现为"列表最后几行被 tabBar 拦腰截断、按钮点不到" |
| 5 | denied / loading / empty / error 四态一律用 `<status-panel>`，empty 必须解释"为什么空 + 下一步" | S | CONDITIONAL | 无 | 20 页里 16 页在用。**豁免**：纯静态无数据源的页（`staff`/`privacy`/`cloud-field-poc`，实测 0 状态分支）；**等价合规**：页面用 `<callout>` + 明确出路自陈该态也不算违规（须能指出四问齐备）。**已登记 DEBT**：`weather-hub.wxml:74` 裸文本空态、`:80/:107` 用 `callout danger` 顶替 error 态 |
| 6 | 提交类写命令一律 `api.dispatchAndSync(payload, this.revision, this)` | A | CONDITIONAL | 无 | 实测 34 : 1。唯一裸 `dispatch`＝`pages/signup/signup.js:378` 的 CAS 链（逐条基于上一条 `res.revision` 推进，且提交后 `redirectTo` 离开本页）——重读反而会打断链路，属**合规例外**，不是反例。判据：本页是否还要继续展示刚改的数据 |
| 7 | 一页的实心主按钮（`.button.primary`）预算＝**一个"本页唯一推进动作"** | R | DEBT | 无 | 互斥分支（`wx:if`/`wx:else`、分步 `step`）、弹层内部、独立 sheet 各算一次预算，须能指认互斥证据。实测反例：`route-edit.wxml:30`+`:159`、`editor.wxml:171`+`:456`（step1 同屏两个）、`activity.wxml:231-232`（同 `.form-actions` 两个）；`route.wxml:189`+`lab.wxml:76` 是页面主体上的红实心 danger（应降为文字样式，红实心只在确认弹窗内） |
| 8 | 反复点击的主目标 ≥44px（`--touch-target`），主操作高 48px（`--action-height`） | R | CONDITIONAL | 无 | token 在 `app.wxss:54-55`，`--touch-target` 实测 5 处引用全在 `app.wxss`（`roam-scrubber` 已随时空天相下线）⇒ 规则的真实适用范围是：**新增/改动可点元素时必须引用 token**，不是"全库已合规"。行内小控件（文字链接、表格内联图标）按 R 处理，写明豁免理由即可 |
| 9 | 可点元素带 `hover-class="button-hover"`；禁用态＝`.disabled` + `bindtap` 置空串 + handler 内 busy/条件守卫（三层一致） | S | VERIFIED | 无 | 缺任一层即"样式正常、文案正确、点了没反应"（铁律 21 的成因之一）。`busy` 期间不得重复触发 |
| 10 | 危险操作（取消活动/删车/移除同行/取消报名）＝文字或次要按钮入口 + `overlay kind="dialog"` 二次确认 + 需要后果的地方自陈影响范围，原因必填 | S | CONDITIONAL | 无 | 正面样本 `route.wxml:188`；违反样本见 #7。确认弹窗里的红实心是**允许**的，别误报 |
| 11 | WXSS 不用 `color-mix()` / `:root` / `100dvh`，混合色取 `app.wxss` 预算好的字面量 | P(保守约定) | UNVERIFIED | 无 | 仓库内**零反例也零正例**：`color-mix(`/`dvh`/`:root` 只在 `app.wxss:2` 注释里出现，代码 0 使用；`clamp()/min()/max()/aspect-ratio` 亦 0 命中。本项目 `skylineRenderEnable: false` ⇒ WebView 渲染，现代 CSS 可用性随用户端内核版本变化，**无法从仓库证真**，故按"不依赖"处理。`gap`（73 处）、`calc`（14 处）、`env()`（12 处）是已被现状使用的，可继续用 |
| 12 | 状态词与"下一步"只出自 `utils/journey.js` + `utils/format.js`；WXML 不比较服务端枚举原文，只认 JS/投影算好的布尔 | A | VERIFIED | 有：`tools/journey-graph-test.js` | 页面里再打一份 `'待完善'`/`'草稿'` 就是第二次定义。方向永远 domain → projection → label |
| 13 | 画布（canvas 2d / SVG 字符串）内的色**不能**取 `var()`，只能字面量，且必须带 `// = --token` 来源注释 | P | VERIFIED | 部分（`weather-page-test` 交叉核对） | `meteogram.js` 的 `const C` 现有 11 条带源注释；`MARK_STYLE` 8 个 key 与 `sky.hourMarks` 8 个 key 实测无分叉——增删 key 必须同批改 `sky.js` + `meteogram/layout.js`（`space-time` 已下线），否则图表**静默丢标记** |
| 14 | 界面文案的概率语气与诚实性：天气派生结论用"可能/概率较大"，断言式承诺（含"不会有"这类绝对否定）禁止；分数不得伪装成成功率；缺数据不得印成有利事实 | S(有门) | VERIFIED | 有：`oi-claim-gate-test`、`elevation-semantics-test`、`weather-v2-test` | 出自铁律 12/26/34，天气线已用四组门钉住。新建任何"由外部数据派生的展示"都适用，不只天气 |

## 4. 最低验证要求

**静态门（必跑）**：`node tools/check.js`（既有静态步骤 + 一段平台门，逐条打印 `Gn` 标题与命中读数）与 `node tools/check-handlers.js`（handler 解析 + dataset 契约）。判据本体在 `tools/t4-e08-platform-rules.js` / `tools/e08-remaining-rules.js` / `tools/m02-class-scope-rules.js`，每段落门前都实测命中 0 且自带合成夹具自证。
⚠ 天花板仍然在，但**不再是"只有一条有门"**（2026-10-17 复量）：§1/§2/§3/§5/§8/§13 已有常驻门，§6/§10/§11 部分有门（picker 的 `range-key` 只配 warning），仍只有人工清单与本 skill 兜着的是 §4/§7/§9/§14/§15/§16/§17——这几条要么需要像素/运行时证据（真机），要么是产品判断。**"过了 check.js" ≠ "过了 UI 规范"**，反过来也别把"某页过了批次套件"当"全仓合规"：色值/尺寸类套件是按批次写入集查的。

**改过 WXML/WXSS/组件结构后**：静态门通过 **≠** 页面正常。`docs/e2e-mp/README.md` 记录过 5 个真机 bug 里 4 个是"数据对、渲染不对"，逻辑测试天然测不到。真机门槛三道，缺一条就不是页面级证据（铁律 32⑥/33⑦⑧）：

1. **bundle 新鲜**：`close`+`open` 重编译后再驱动；新鲜度要能自证（新文案出现在屏上，或 `SYNC.md:560` 的 `bundleFresh` 探针）。
2. **注入载荷是生产形状全集**：先断言渲染门槛链（如天气页 `denied=''`/`loading=false`/`loadingWeather=false`/`dayCards.length>0`/`unified!=null`），否则元素根本不在 DOM 里，读数是假的。
3. **多用例打穿缓存 + 污染自证**：每例前 `reLaunch`、给不同 `updatedAt`，两例读数必须互不相同，相同即判整批截图无效。

**别人递来的截图（无法自证 bundle 新鲜与数据来源时）**：仍可用于**排版事实**（叠压、截断、重叠、对比度）与 token 落值核对，证据档上限 **E2**；不得写"已做视觉验证"或"修复后正常"，整批结论标 `UNVERIFIED(截图来源与 bundle 未证)`，并在报告里点名缺哪一项才能升 E3/VERIFIED。

**证据不得混档**：M3 静态审计 / M4 截图审查 / 自动化点击 / 真机人工，四类手段各有结论边界（写在 `audit-verification.md` §1）；`review-checklist.md` 把它们细成 T1–T8 八档执行步骤——**四档是证据强度，八档是检查工序，不是同一维度**，别把它们当同义词。自动化侧已知事实：`e2e-ui-test.js` 的截图明文"仅作 Evidence，不参与判定"；一条 UI PASS 必须由"一次真实 tap/input + 它的后果观测"构成（`automation-playbook.md:188`，实现 `tools/e2e-result.js:87-100`）；门槛不过或通道退化记 **INCONCLUSIVE（exit 2），永远不是 PASS**。仓库内**没有任何像素比对工具**，截图审查只有人眼。

**跑不动 ≠ 不用跑**：`NOT_RUN`/`INCONCLUSIVE`/`ENV-ABORT` 只用于**环境性不可达**（本机无开发者工具、会话僵死、未获授权动共享会话）。负责人口头要求"别测了/赶时间"**不构成**豁免：照旧执行不可协商项（静态门），把被压缩的验证项在交付里写成**缺口 + 结论上限**，交他裁决；静默跳过并宣称完成是违规。

## 5. 读哪份参考

| 你要做的事 | 读这个 |
|---|---|
| 取色/字号/间距/圆角/类名/组件契约/canvas 色板/色值债清单 | [references/design-system.md](references/design-system.md)（实时值只在这里 + `app.wxss`） |
| 定主任务 §0 · 层级与阅读顺序 §1 · 结构选型 §2 · 密度与噪声信号 §3 · 主/次/危险操作 §4 · 六态 §5 · 跨页流程 §6 · 表单弹层筛选列表工作台 §7 · 长文本窄屏缩放对比度 §8 · 复用还是新建 §9 · 质量标准十维 §10 | [references/ui-methodology.md](references/ui-methodology.md) |
| STALE vs DEBT §0 · 证据档 §1 · 严重度 §2 · 误判防线 §3 · 审计报告字段 §4 · 验证记录模板 §5 · 退出码 §6 · 常驻红 §7 · 多 Agent 可复核性 §8 | [references/audit-verification.md](references/audit-verification.md) |
| 交付前逐项自查：T1 静态 / T2 一致性 / T3 交互状态 / T4 层级密度 / T5 截图 / T6 自动化 / T7 真机 / T8 回归登记 | [references/review-checklist.md](references/review-checklist.md) |
| 样式不生效 §1–§3 · 层叠与遮挡 §4–§6 · 布局 §7–§9 · WXML §10–§14 · 微信能力 §15–§17 · 门与能力边界 §工具 | [references/platform-pitfalls.md](references/platform-pitfalls.md) |

**降级条款**：references 读不到（换机器、子 Agent 无文件权限、路径丢失）时，不得凭本节表格推断细节——明写"参考不可达"，把结论降到 **E1（源码文本可直接核实的事实）** 范围，需要像素/交互的部分标 UNVERIFIED。

邻居文档只引用不重复：`AGENTS.md`（根，铁律全集）· `miniprogram/AGENTS.md`（页面骨架、新页面 5 步注册、组件清单）· `miniprogram/utils/AGENTS.md`（wx-free purity 规则，它决定 util 能否被 Node 直测）· `docs/e2e-mp/*`（真机驱动与恢复）· `docs/testing/e2e-result-semantics.md`。

## 6. 多 Agent 协作契约

- **本 skill 是共同背景，不是结论。** 每个 Agent 必须独立核实自己引用的每条事实；不许引用另一个 Agent 的未验证结论当证据。
- **维度分工不越界**：布局/视觉/交互/用户旅程/平台风险可以分给不同 Agent，但同一个文件的改动只允许一个 Agent 做（铁律：一次只做一件事），其余只提发现。
- **发现去重按 `file:line` + 判据**，不按文案描述；同处不同判据算两条。
- **争议与不确定项保留**，写明两方主张与各自证据档，交负责人裁决；不许折中，不许沉默丢弃。
- 审计 Agent **不得因为"符合本 skill"就停止质疑设计本身**（§3 里 #7/#8/#3 就是"规范与现状都不理想"的例子）。实施 Agent 遵守经核实的硬约束（P/A 类），偏离 S/R 类必须在改动清单里给理由。
- 任何 Agent 不得把未实际执行的检查标为通过；跑不动的（如无开发者工具那台机器）记 **INCONCLUSIVE / ENV-ABORT**，不是 PASS，也不是产品红。
- 实质性改动登记 `SYNC.md` 变更日志；动过 `cloudfunctions/` 必须标「需重新部署 trailApi」。

## 7. Red flags（出现即停手回到对应模式）

- "过了 `check.js` 所以页面没问题" → §4 的天花板：平台/作用域那几条现在有常驻门，但 §4/§7/§9/§14/§15/§16/§17 与语义层（色值、四态、尺寸、token 登记）仍在门外
- `page.data()` 读数正常 ⇒ "渲染出来了" → data 不是像素（铁律 32⑥a）
- 截图文件不存在但结论含"视觉验证通过" → 改 M3 或标 UNVERIFIED
- 截图有、但来源与 bundle 未证 ⇒ "修复后正常" → 上限 E2 + `UNVERIFIED`（§4 被动收图条）
- "负责人说别测了" ⇒ 静默跳过验证并宣称完成 → 缺口如实登记 + 结论上限，不是免证据放行（§4 跑不动≠不用跑）
- "这页太乱，我重写成卡片列表" → 先回答"这页唯一主任务是什么、哪些是对的必须留"（M2 ①）
- 拿 `class="card"` 当默认结构套任何内容 → 结构选型由任务与信息顺序决定（`ui-methodology.md` §2）
- 发现某处"不符合规范"就直接判高危 → 先分规范偏离/体验缺陷，再定证据档（M3）
- 组件里没有 `options` 但样式看着正常 → 查它是否真的引用了全局类（#1 的适用条件）
- 想新加一个色值/圆角/字号 → 先全局搜等价物（#3）
- 把某轮审计的任务提示词整份抄进本 skill → skill 长期复用，轮次细节留在当轮任务书
