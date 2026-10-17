# OurTrail UI Skill 现状审计报告

轮次：2026-10-14 技能升级第一轮 · 分支 `win/ui-skill-methodology`（worktree `D:/OurTrail-skill-uplift`）
范围：仅 `.agents/skills/ourtrail-ui/**`；业务代码零改动。配套验证见 `skill-validation-report.md`，变更摘要见 `skill-change-summary.md`。

## 0. 结论摘要

1. **旧 skill 是一份合格的"样式维护手册"，但不是 UI/UX 工程方法论**：286 行里 100% 面向"改动方"，对只读审计、截图审查、真机验证、需求不清、并行冲突五类任务**零路由**（用基线测试实证，见 §5）。
2. **规则本身大体站得住**：31 条受审规则里 17 条 VERIFIED，但**3 条是文档 STALE、5 条是"规范与现状不一致"的 DEBT、4 条属 DESIGN_DECISION 却被写成了平台限制**。不修正就会让后续 agent 拿错尺子。
3. **最危险的缺口不是缺规则，而是缺"证据档"**：旧文没有区分"源码可判"与"必须看见像素"，导致 agent 会自然地把 `check.js` 通过写成"页面正常"。而实测结论是：**14 条核心规则里只有 1 条（状态词单源）有常驻自动门**，其余 13 条无任何闸门。
4. 升级采取"重排 + 补齐 + 收窄绝对规则"，**未删除任何有事故背景的条目**；被证伪的两条原文保留并加前向指针（§6/§7）。

## 1. 基线与安全门前置

| 项 | 实测 |
|---|---|
| 本地 `master` HEAD | `553fd6d`（含 quick-create 合并） |
| GitHub `origin/master` | `78d7db9`；`rev-list --left-right` = **2 / 0** ⇒ 本地领先 2、落后 0 |
| 基线选择 | 以本地 `553fd6d` 为分支基点（GitHub 侧无本地缺失内容，取本地不丢东西） |
| 隔离方式 | `git worktree add D:/OurTrail-skill-uplift -b win/ui-skill-methodology`；**未动用户工作区** |
| 用户工作区 | 开工前后 `git status --porcelain` 均为空；分支仍 `master` |
| 静态门 | 本 worktree `node tools/check.js` 与 `node tools/check-handlers.js` 均 exit 0（文档改动不应影响，跑一次以排除误伤） |
| 子 Agent 写入检查 | 5 路探针派前后各跑 `git status`：无改动 |

⚠ **需负责人知晓**：本地 master 比 GitHub 领先 2 个提交（`703a14e` + `553fd6d`）。本轮未推送、未提交，不影响；但若 GitHub 才是唯一权威，说明这两提交尚未转发。

## 2. 取证方式

5 路并行探针（组件作用域 / token 与类名 / 平台约束与闸门能力 / 方法论资产挖掘 / 旧 skill 基线测试），全部要求 `file:line` 与实测计数，测不到写 `NOT_MEASURED`。承重引用随后由主 agent 独立抽样复验 63 条（见验证报告 §3，其中 1 条行号偏差已修正）。

## 3. 规则逐条分类

类别：**P** 平台硬限制 / **A** 架构约束 / **S** 设计规范 / **R** 设计建议。裁决动作：保留 · 收窄 · 订正 · 补录 · 降级为建议。

| # | 旧条目（出处） | 裁决 | 实测证据 | 处置 |
|---|---|---|---|---|
| 1 | 组件必须声明 `styleIsolation:'apply-shared'`（SKILL:19, pitfalls §1） | **CONDITIONAL**（规则过宽） | 14 个组件中 12 个承重；`meteogram` 的 `meteogram*`/`.lg` 全在自身 wxss（`app.wxss` 无此类）⇒ 不需要；`privacy-popup` 死代码无声明 | 改写为"**引用全局类时**必须声明"，并把 `meteogram` 列为反例、tab-bar 列为例外（SKILL #1） |
| 2 | `options` 每组件只出现一次（SKILL:17 隐含, pitfalls §2 前身） | **VERIFIED / 防回归** | 守卫注释实存 `form-field.js:1-3`、`overlay.js:1-3`；修复提交 `daa0508` | 保留并升级为独立条目 + 可 grep 的最小验证（`grep -c "^\s*options:"` ≤1） |
| 3 | 具名 slot 需 `multipleSlots` | **VERIFIED** | 实测 `form-field.js:6` true、`roam-scrubber.js:18` true（`wxml:34` 有具名 slot）、`overlay.js:6` **显式 false** | 补录进 pitfalls §2，并写明"改造 overlay 用具名 slot 必须同时改 false" |
| 4 | WXSS 不支持 `color-mix()`（SKILL:20, pitfalls §3） | **UNVERIFIED**（保守约定） | 全库 `color-mix(` 命中 1 处且在 `app.wxss:2` 注释；代码 0 使用 ⇒ **零正例也零反例**；`skylineRenderEnable:false` ⇒ WebView 渲染，可用性随用户端内核变化 | 保留结论但改标 `[保守约定]`，写明证据层级"仓库只能证到代码怎么写" |
| 5 | 无 `:root`（用 `page`） | **CONDITIONAL / 事实成立** | 40 个自定义属性全部定义在 `page{}` 块（`app.wxss:4-56`）；`:root` 0 使用 | 同 #4 标注证据层级 |
| 6 | `100dvh` 不稳 | **UNVERIFIED** | `dvh` 0 使用；替代写法在用（`app.wxss:70`、`weather-chart.wxss:5` 用 `100vh`） | 同上 |
| 7 | `custom-tab-bar` 自包含 + 字面量 | **VERIFIED** | `index.wxss` 5 处字面量、0 `var()`；`index.js:4` 仍声明 apply-shared 但只 `button-hover` 依赖全局 | 保留为例外位（SKILL #2） |
| 8 | Tab 页 `padding-bottom: calc(32px + 84px + env(...))`（SKILL:23） | **STALE（措辞错位）** | `app.wxss:68` 的 `.page` 实为 `24px 20px 32px`；该 calc 在 `home/notices/anotices/me/weather-hub` 各自 wxss；`app.wxss:72` `.has-sticky`=120px；`app.wxss:482` 另有 `.tabbar-safe` | 订正归属，并补事故原文（`weather-hub.wxss:4-5`：末行被拦腰截断、删除按钮点不到，2026-09-30 实测） |
| 9 | 状态四件套一律 `<status-panel>`（SKILL:30） | **CONDITIONAL + 现存 DEBT** | 20 页中 16 页在用（标签 40 处）；`staff`/`privacy`/`cloud-field-poc` 0 状态分支（静态页）；`weather-hub.wxml:74` 裸文本空态、`:80/:107` 用 `callout danger` 顶替 error | 写清豁免枚举 + 等价合规 + 已登记 DEBT，不判为"全库违规" |
| 10 | 提交一律 `dispatchAndSync`（SKILL:32） | **CONDITIONAL** | 34 : 1；唯一裸 `dispatch` = `signup.js:378` CAS 链，提交后 `redirectTo` 离开本页（:417/:559） | 保留规则、把该处写成"合规例外 + 判据（本页是否还要展示刚改的数据）" |
| 11 | 一页最多一个实心主按钮（checklist:38） | **DESIGN_DECISION + DEBT** | 实测反例：`route-edit.wxml:30`+`:159`、`editor.wxml:171`+`:456`、`activity.wxml:231-232`（同 `.form-actions`）；各页 primary 计数 activity 6 / editor 5 / signup 4 … | 收窄为"一个**唯一推进动作**预算"，例外须指认互斥证据（`wx:if`/`wx:else`、`step`、弹层）；运行时才同屏的记 E2/E3 不判死 |
| 12 | 危险操作用文字样式，红实心只在弹窗（checklist:39） | **CONDITIONAL + DEBT** | 反例 `route.wxml:189`、`lab.wxml:76`（页面主体 `.button danger block`）；`lab` 是 DEV_ONLY 工具页 | 保留；对工具页与页面主体区分处理，登记为债不擅改 |
| 13 | 触控目标 ≥44px（design-system:68, checklist:17） | **CONDITIONAL（写成硬性＝过宽）** | `--touch-target:44px`(`app.wxss:54`)、`--action-height:48px`(:55)，各仅 7 处引用且全在 `app.wxss`/`roam-scrubber`，**页面 wxss 0 引用**；且 CSS 高度 ≠ 命中区，无真机证据 | 降为 **R 档**："新增/改动可点元素必须引用 token"，行内小控件可豁免并写理由；真机命中区列入待验证 |
| 14 | `hover-class="button-hover"` / 禁用三层 | **VERIFIED** | checklist:17-19 与代码一致；`app.wxss:123/124` 定义 `.button.disabled`/`.button-hover` | 保留并升级 SKILL #9 |
| 15 | 座位 4 座 + 1 过道 | **VERIFIED / 防回归** | `app.wxss:406/:425` 定义存在，表达式未回退 25% | 保留（pitfalls §7） |
| 16 | 长文本 word-break / `.tabular` | **VERIFIED** | `app.wxss:95` `.tabular` 实存且被引用 | 保留（pitfalls 新 §9） |
| 17 | 禁 `wx.getUserProfile` | **VERIFIED** | 平台废弃；`app.json` 已声明 `permission.scope.userLocation`(:55-59)、`requiredPrivateInfos`(:60-63)、`__usePrivacyCheck__`(:67) | 保留（pitfalls §15）并补配置事实 |
| 18 | 内容安全走云函数 `checkText` | **VERIFIED** | 云函数侧既有实现 | 保留（pitfalls §16） |
| 19 | 颜色 token 表 29 条（design-system:9-27） | **VERIFIED** | 与 `app.wxss:5-43` 逐值一致；`--chart-ramp` 代码含 `90deg` 前缀（旧表省略） | 补 `90deg` + 标行号 |
| 20 | 数值 token（radius/touch/action/motion/text-*） | **STALE：文档缺失** | `app.wxss` 实存 11 个数值 token（:45-56），旧 `design-system.md` **一个都没登记**，而 `--motion` 已被 `overlay.wxss:14/29/47/48` 消费 | 新增登记小节（值 + 行号 + 消费现状 + 类别） |
| 21 | `.sky-card/.sky-title/.sky-text`（design-system:94） | **STALE：不存在** | 全库检索 NOT_FOUND；真实类是 `.cond-card`(`weather.wxss:142`)、`.cond-pheno`、`.cond-silent`、`.cond-label/grade/stars/why/main`、`.sky-look{,-label,-text}`(:180/:188/:197)、`.ag-grade`、`.reason-note` | 替换为真实类名，并标注"页面级而非 `app.wxss`"；旧文保留前向指针 |
| 22 | `.section-head/.section-sub`（design-system:93） | **CONDITIONAL（位置未说明）** | 定义在 `pages/weather/weather.wxss:136/:139`，非 `app.wxss`；`.lg` 在 `meteogram.wxss:22` | 标出定义位置 + "要跨页复用即属新的规范动作，需登记" |
| 23 | `MARK_STYLE` 8 key ↔ `sky.hourMarks` | **VERIFIED** | `layout.js:51-60` 8 key 与 `sky.js:194-225` 产出 8 key 无分叉；`sky.js:446` 的 `key:'light'` 属 `summarize` 不属 hourMarks | 保留并写"别误当第 9 个天相" |
| 24 | 画布不能取 `var()` | **VERIFIED (P)** | `meteogram.js:24-48` 的 `const C` 11 条带 `// = --token` 源注释 | 保留（SKILL #13） |
| 25 | `meteogram.js:34` 注释"阵雨柱无 token" | **STALE** | `app.wxss:27` 已有同值 `--chart-showers` | 登记为文档级过期（**未改代码**，画布仍需字面量） |
| 26 | 组件/页面不发明色值（SKILL:17 段, checklist:7） | **S 类 + DEBT** | 12 文件 61 处原始命中；真实违反仅 5 个活文件（`home`2/`discover`2/`activity`1/`weather`2/`overlay`2+4 兜底）；`me.wxss` 4 处全是 `var(--x,#fallback)`（合规）；`privacy-popup` 7 处属死代码 | 建"色值债登记"表 + 报违规前的四道排除（兜底/注释/tab-bar/死代码） |
| 27 | 静态门能保什么（SKILL/checklist 均称"必跑 check.js"） | **VERIFIED 但能力被高估** | `check.js` 228 行 8 步（`:26-36/:39-70/:73-95/:98-110/:113-123/:129-159/:161-166/:168-191/:197-220`）；`check-handlers.js:83-86/:93-111`。**apply-shared / 色值 / 四态 / 44px / token 登记 五项全无门** | 写成"门的天花板"专段，避免把 check.js 通过当合规 |
| 28 | 状态与下一步单源（journey.js） | **VERIFIED + 有门** | `tools/journey-graph-test.js` 常驻（铁律 22） | SKILL #12，作为唯一常驻门样本 |
| 29 | 深色模式 | **新增事实（A 类）** | `app.json` 无 `darkmode` 键、无 `darkmode.json` ⇒ 只有一套配色 | 新增说明，防"缺深色适配"被当缺陷报 |
| 30 | 天气线可迁移的设计准则（未进旧 skill） | **新增资产** | `docs/weather-ux/weather-ux-design.md:7-8,:23,:58-59,:66,:82`；沉默闸 `qa/v2-silence-gate-2026-10-10/README.md:29-47,:97,:101`；`inkOn` `meteogram/layout.js:106-113` | 搬入 `ui-methodology.md` §1/§5/§8（含"减话必须点名""弃权≠否定""裁切必须自陈"） |
| 31 | 原型 `StatusPanel.tsx` 契约引用 | **VERIFIED（行号已修正）** | 实际在 `:5-8`（kind 五值:5 / title:6 / **detail:7 必填** / action?:8）；旧写法 `:4-7` 偏一行 | 已在 `ui-methodology.md:64` 订正 |

## 4. 负责人点名的七个重点，逐条回答

1. **`apply-shared` 该不该无条件强制所有组件？** 不该。它是"引用全局类"的条件规则（#1）。无条件强制的代价是制造无意义声明与噪音，且 `meteogram` 就是合法反例。但 `options` 只写一次是硬约束（#2），这一条必须无条件。
2. **WXSS 兼容性约束有无平台依据？** 有外部来源（微信 Skyline/WebView 文档区分渲染器），但**仓库内既无正例也无反例**（#4-6）。本项目是 WebView 渲染，所以"不依赖现代 CSS"是正确工程选择，但文档必须说清它是**保守约定**而不是已证实的平台限制——否则 agent 会把它当"实测过的事实"复述。
3. **是否所有状态都必须统一 `status-panel`？** 是默认路径但非绝对（#9）：静态 shim 页豁免，`callout` + 明确出路的等价合规也可接受，`weather-hub` 是登记在案的 DEBT。
4. **是否所有提交都适用 `dispatchAndSync`？** 除"提交后自行推进 revision 链且立即离开本页"之外都适用（#10）。
5. **"一页最多一个实心主按钮"等视觉规则要不要上下文？** 要（#11/#12）。已改写为可判形式：互斥分支、分步、弹层各算独立预算，且**判不出运行时组合时降级为 E2/E3**，不许静态判死。
6. **触控尺寸规则适用范围是否合理？** 原写法不合理（#13）：token 存在但页面层 0 引用，且"高度 44px"≠"命中区 44px"。已降为 R 档并把真机命中区列入待验证。
7. **token 与公共组件是否真被主要页面复用？** 颜色 token 全量复用一致（#19）；`<status-panel>` 16/20 页（#9）；`dispatchAndSync` 34 站点（#10）；**但 11 个数值 token 未登记（#20）、`.sky-*` 三类不存在（#21）、5 个活文件仍有字面量色（#26）** ⇒ 复用总体成立，旧文档在两处与现状脱节。

## 5. 旧版能力缺口（基线测试 RED）

同一份 6 场景试卷只给旧 SKILL.md（references 不可见）跑出来的缺口，逐条与处置：

| # | 缺口 | 处置 |
|---|---|---|
| G1 | 没有"只读审计"任务形态，全文只服务改动方 | §2 四模式 + M3 专行；`audit-verification.md` §4 报告字段 |
| G2 | 无严重度体系，只能靠"硬性/照抄"两节的语气隐含定级 | `audit-verification.md` §2 四档 + §10 表起点列 |
| G3 | 无证据分级与"能声称到哪一步"的边界 | §1 E1–E4 + 状态词四值；SKILL §4"证据不得混档" |
| G4 | 路由不覆盖视觉层级/密度/可用性/交互/动效 | §5 路由表按主题串到 `ui-methodology.md` 节号 |
| G5 | 验证止于静态自查，无"改结构必须真机"防线 | SKILL §4 三道门槛 + checklist T5–T7 |
| G6 | 新建页面前置项缺失（app.json/usingComponents/tab 归属） | 指向 `miniprogram/AGENTS.md:103`「5 steps」，不重复维护 |
| G7 | 需求不清时没有动作（该问还是该猜） | `ui-methodology.md` §0"定不出来 ⇒ 两候选 + 登记待裁决" |
| G8 | 并行冲突无裁决机制 | SKILL §6 + `audit-verification.md` §8 |
| G9 | 组件变体不可枚举、references 不可达时无降级 | SKILL §5 降级条款（含 E1 一行式定义） |
| G10 | 条文自相矛盾风险：结论给了但可核对写法在 pitfalls 里 | SKILL 表内每条自带判据与适用条件 |
| G11 | 无历史例外/死代码登记 ⇒ 审计必误报 | `audit-verification.md` §3 十条误判防线 + `design-system.md` 债登记 |

## 6. 保留的既有资产（一条都没删）

29 条色 token 表、`MARK_STYLE` 对应表、温度线不红/`inkOn`/天相 key 三处同步、canvas 色板与 11 条源注释、座位 4+1 与宽度表达式、map 配色与 marker 生成器、`.tabular`、overlay 关闭态 CSS 块、14 条平台坑全部条目、checklist 的 40 项判据（含"refactoring-ui 诊断表"署名，作为来源凭证保留，内容不外包——该 skill 不在仓库里）。

## 7. 新增能力

- **四种工作模式**及其必经步骤、最低证据、禁止事项（含"减话类改动必须双向可证"的移植：M2 改前改后同条件对照）。
- **证据档 E1–E4 + 状态词四值**，并给出"结论强度不得超过证据档"的可执行表述。
- **STALE vs DEBT vs 规则过宽** 三分裁决法（四问顺序）。
- **严重度四档 + 规范偏离/体验缺陷分栏**（防止"符合规范＝体验良好"和"违反条文＝高危"两种误判）。
- **设计方法论 10 节 + 十维质量标准表**：每维含"什么问题 / 别误判 / 代码证据 / 何时必须截图 / 严重度起点"。全部信号可指认（如同屏同级容器数、重复句、`label:value` 同构行数）。
- **被动收图降级规则**（别人递来的截图上限 E2 + `UNVERIFIED`）与**"禁测≠免测"红旗**。
- **门的能力边界表**：14 条规则里哪些有闸门、哪些只有本 skill 在管。

## 8. 与多 Agent UI/UX 审计的配合方式

`audit-verification.md` §8 + SKILL §6 是接口：skill 提供共同判据与证据要求，**当轮任务书提供范围**。约定了去重键（`file:line` + 判据）、独立核实义务、争议保留（不折中、不丢弃、多数票无效）、单文件单改者、以及"审计 Agent 不得因符合 skill 而停止质疑设计"。轮次细节（如本轮的 7 个重点问题）不进 skill。

## 9. 顺带发现项的处置

| 发现 | 证据 | 处置 |
|---|---|---|
| `miniprogram/AGENTS.md` 页面与文件计数已过期：`:9`「16 pages」、`:16`「16 dirs」、`:25`「## PAGES (14)」、`:12`「app.wxss 484 lines / 33 properties」、`:34`「## COMPONENTS (11)」、`utils/ 20 files」 | 实测 `app.json` pages=20（tabBar 4 页含 `weather-hub`）、`pages/` 目录 20 个、`wc -l app.wxss`=502、自定义属性 40 个、组件目录 13 个、`utils/*.js` 23 个 | **已订正**（负责人批准"补索引 + 过期计数"）：PAGES 补 `weather-hub/lab/cloud-field-poc/route/routes/route-edit` 六页及实测 LOC 与 DEV_ONLY 说明；COMPONENTS 补 `space-time`(492+466) 与 `roam-scrubber`(129)，并修掉同行既有过期值 `meteogram 507+92`→`719+132`（宿主只有 `weather.json` 注册，非两页） |
| 根 `AGENTS.md:98`「lines 5–40 (33 CSS custom properties)」、`:128`「app.wxss (493)」、`:20`「33 tokens」、`:28`「its 3 references」 | 属性分布在 `:5-56` 共 40 个；文件 502 行；skill 现有 5 份 reference | **已订正**并补索引：READ-FIRST 第 1 条改写为"5 references + 四模式 + 门能力"摘要 |
| `meteogram.js:34` 注释"无 token"已过时 | `app.wxss:27` `--chart-showers` 同值 | **未改**——属业务代码注释，本轮禁改；已登记在 `design-system.md` 与 pitfalls 相关条目 |
| 5 个活文件的字面量色值、4 处主按钮/危险色违规 | 见 §3 #11/#12/#26 | **未改**——本轮不改业务代码，已全部登记为 DEBT，留给 UI 重构轮 |
