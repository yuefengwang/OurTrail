# OurTrail 全局 UI/UX 重构 · 本轮总报告（户外编辑式视觉升级）

- **日期**：2026-10-16 ~ 2026-10-17（夜间无人值守执行）
- **隔离工作区**：`d:/OurTrail-ui`（git worktree，分支 `win/ui-redesign-editorial`，基线 `381efae`）
- **主工作区**：`d:/OurTrail`（分支 `win/ui-fix-round2-wave1`，含他人在途未提交改动，**本轮零触碰**）
- **设计规范**：`docs/ui-ux-redesign/design-system.md`（本轮唯一规范源）
- **真机证据**：`docs/ui-ux-redesign/screens/before|after/`、`docs/ui-ux-redesign/evidence/`

---

## A. 执行摘要

### A.1 本轮实际完成了什么

1. **只读审计**（阶段 A）：仓库/分支/并发状态、20 个页面与 13 个组件的全量盘点、测试基线
   （73 套 exit 0 / 4 套非绿）、微信开发者工具真机渲染基线截图（含空态与真实夹具数据两套）。
2. **设计系统**（阶段 B）：户外编辑式 Token 与组件规范落地为 `app.wxss` 新增 token 与全局类
   （`--forest-deep/--stone/--stone-line/--scrim-hero/--scrim-top`、`.display/.lede/.kicker/.hairline/
   .stack-sections/.section-head/.fact-row/.hero-cover*/.photo-note`），纸面暖调 `#F5F5F0 → #F6F3EC`；
   9 张 Unsplash 授权实景照片入包（`assets/photos/`，520KB）+ 稳定散列选取器 `utils/covers.js`。
3. **活动详情视觉标杆**（阶段 C）：编辑式封面 hero（实景大图 + 状态浮层 + 森林底信息区）、
   分区眉题体系、事实行、封面诚实性脚注；**结构与数据契约零变化**。
4. **推广**（阶段 E）：home / discover 的活动卡改为「封面缩略图 + 文字」与「大图 featured」；
   me 页最近活动加封面缩略图；workspace 指标带 + 分区头；weather / weather-hub / staff / vehicle
   随全局 token 自动对齐（结构未动）。
5. **真实验收**：微信开发者工具真实渲染 + **12 项真实交互全部通过** + 长标题边界用例 +
   全量回归测试（见 F）。

### A.2 最明显的视觉与体验改善

- 活动详情从「深绿纯色块 + 等高线装饰」变为**真实山景封面 + 编辑式层级**（见 E 组对照）；
  同一屏内状态徽标、日期、里程/爬升/人数仍一眼可读，主操作位置不变。
- 发现页/首页活动列表从「同质化文字卡墙」变为**照片引导的编辑式列表**，不同活动拿到不同封面
  （按活动 id 稳定散列，同一活动恒同一张）。
- 全站纸面转暖、分隔改发丝线、分区有眉题——主要页面共享同一套字体/颜色/间距/状态规则。

### A.3 是否完成真实小程序渲染验收

**是。** 微信开发者工具（IDE 服务端口 33278 + 自动化端口 9420，miniprogram-automator 驱动），
iPhone 12/13 模拟器（390×844），**真实云端数据**（夹具活动「[UI] 赵公山 · 东线穿越」：
建档→发布→整组报名→审核→分车→推进 gathering 全链路真实 dispatch 建档）。
截图与交互读数入库（`screens/`、`evidence/`）。

### A.4 哪些事项没有完成

- **逐页重构未全覆盖**：signup / editor / routes / route / route-edit / staff / vehicle /
  weather-chart / notices / anotices / lab / privacy / cloud-field-poc 本轮**未逐页重构**，
  只继承 token 演进（暖纸面/石色/新类可用）。其中 staff/vehicle 已有既定结构且被测试钉死，未动。
- **天气页**按任务要求只做 token 级对齐，**算法/图表/数据零改动**（它本身已高度 token 化）。
- **小屏（≤375px 宽）模拟未验证**：自动化通道无法切换模拟器机型（见 B.4 限制）。
  已用 390 宽设备 + 39 字长标题边界用例部分覆盖。
- **真机硬件能力**（相机/定位/蓝牙）未涉及，本轮无相关改动。

---

## B. 审计结果

### B.1 仓库与并发状态（开工时实测）

| 项 | 实测值 |
|---|---|
| 分支 / HEAD | `win/ui-fix-round2-wave1` @ `381efae`（2026-10-16 六个提交的「fix round 2」波） |
| 未提交改动 | `miniprogram/utils/api.js`（toast 文案预算 M-11）、`miniprogram/pages/workspace/workspace.wxml`（F-01 门槛提示） |
| 未跟踪文件 | `.idea/`、`tools/t1-r01-*.js`、`tools/t2-m11-*.js`（均属他人在途任务） |
| 处置 | **零触碰、零 stash、零 reset**；按 PARALLEL_DEV 约定开独立 worktree 隔离实施 |
| 远端 | 未 fetch / 未 push / 未动 master（本机中继主机不可达，与上轮记录一致） |

### B.2 页面盘点（app.json 实测 20 页 + 自定义 tabBar）

tabBar：**活动(home) / 天气(weather-hub) / 通知(notices) / 我的(me)**。

| 页面 | 角色 | 业务任务 | 本轮动作 |
|---|---|---|---|
| `home` | 参与者/领队 | 我的活动、协作任务、筛选搜索 | 编辑式卡片（缩略图 + featured 大图） |
| `discover` | 访客/参与者 | 发现已发布活动、搜索 | 同上（缩略图 + featured 大图） |
| `activity` | 全员 | 活动详情、状态、报名入口、自助操作 | **视觉标杆**（封面 hero + 分区体系） |
| `workspace` | 领队 | 总览/名单/分车/现场、阶段推进 | 指标带 + 分区头（结构不动） |
| `staff` / `vehicle` | 协作者/车长 | 现场任务、本车任务 | 仅 token 继承（staff 是零事件薄壳，被门禁钉死） |
| `weather` / `weather-hub` / `weather-chart` | 全员 | 山地天气、天相、出行窗口 | token 对齐；**算法与图表零改动** |
| `me` | 全员 | 资料、最近活动、路线库、协作码、授权 | 最近活动加封面缩略图 |
| `signup` / `editor` / `routes` / `route` / `route-edit` | 参与者/领队 | 报名、创建编辑、路线库 | 未逐页重构（仅 token 继承） |
| `notices` / `anotices` / `privacy` / `lab` / `cloud-field-poc` | 全员/内部 | 通知、隐私、实验 | 未改动（notices 继承 token） |

**弹层/抽屉**（非独立页面，已计入宿主页）：overlay sheet/dialog（activity 同行人操作、workspace
阶段确认、me 各编辑面）、privacy-popup（死代码，未动）。

### B.3 审计发现的主要 UI 问题（改造前）

1. 活动详情首屏是**深绿纯色块 + SVG 等高线装饰**——Demo 感的主要来源；没有任何实景。
2. 列表卡同质化：纯文字卡墙，无照片引导，扫视成本高。
3. 分区标题只有一行 `section-title`，长页没有"章节感"；区块间距 16px 等距堆叠。
4. 分隔靠卡片背景分组而非发丝线；阴影/圆角感知偏"管理后台"。
5. 工作台指标行裸露在纸面上，与正文无分组关系。
6. 「我的」页低频功能（路线库/协作码/授权）与高频（最近活动）视觉权重相同。

### B.4 环境与工具限制（实测）

- 微信开发者工具本机可用：服务端口 33278 已开、已登录；CLI/自动化通道（9420）可用。
- **自动化通道无法切换模拟器机型**（无 CLI/automator 接口）⇒ 小屏渲染记 UNVERIFIED。
- 会话会 Wedged（playbook §3）：改代码后首次驱动出现过"控制组正常、其余页 `page.data()` 返回 {}
  + 空白截图"的假红形态；`cli quit → open → auto` 重启后恢复，**所有读数均取自恢复后的会话**。
- 云端 trailApi 已在运行（路线库轮部署过）；本轮 `cloudfunctions/` 零改动 ⇒ 不需重新部署。
- 门禁夹具里他人在途的 `tools/t1-r01-*`/`t2-m11-*` 不在本 worktree（只在其主工作区未跟踪）。

---

## C. 设计系统

完整规范见 **`docs/ui-ux-redesign/design-system.md`**（视觉方向、Token 表、组件清单与边界、
业务状态统一表达、图片/图标策略、分域信息架构、落地清单、验收口径）。要点：

- **方向**：户外编辑式（品牌气质）× Strava 式活动表达（内容主体）× AllTrails 式户外信息
  （路线/天气的专业表达）× 高效协作交互（工作台）。同一产品，不同页面不同布局，同源规则。
- **Token**：森林绿 `#163E35` 仍是品牌锚，但**绿只做品牌动作与 hero 压底**；纸面暖白
  `#F6F3EC` + 石色 `#EDE9DE` 承担 80% 表面；新增 `--forest-deep/--stone/--stone-line/--scrim-*`。
  天相/图表色一概未动（天气算法与配色不因视觉重构改变）。
- **组件**：不新建自定义组件；新增能力全部为全局类（封面 hero 目前只有一个页面成熟使用，
  类级复用，验证第二个页面后再决定提组件——不为组件化而组件化）。
- **图片策略**：9 张 Unsplash 授权实景（`assets/photos/README.md` 登记来源）；按活动 id 稳定
  散列；加载失败回退纯色；**页面脚注明示"封面为场景氛围图，非本次活动实拍"**（活动模型无图片
  字段，不可擅改 schema——要做真活动图需服务端加字段，列入 G）。

---

## D. 实施结果

### D.1 活动详情 `pages/activity`（视觉标杆）

- **改动前问题**：首屏深绿纯色块 + 装饰性等高线；标题/信息层级弱；区块无章节感。
- **设计决策**：定高媒体盒（240px 实景封面）+ 状态浮层（徽标 + 日期药丸）+ 森林底信息区
  （`.display` 大标题 / 路线名副题 / 发丝线三指标）；正文区分区眉题（同行人/行程/路线与集合/
  安全/装备/费用与约定）；时间三行改事实行；页尾封面诚实性脚注。
- **涉及文件**：`activity.{js,wxml,wxss}`、`app.wxss`、`utils/covers.js`（新）、`assets/photos/*`（新）。
- **业务逻辑**：零变化（数据字段、命令、权限、地图/时间轴交互全部原样；WXML 只增不改语义）。
- **真机证据**：`screens/after/activity*.png`；交互 I-02a/b/c（结构在位 + 封面绘制 350×240）。

### D.2 首页/发现 `pages/home` `pages/discover` + `components/activity-card`

- **改动前问题**：同质化文字卡墙；featured 卡只有深绿底 + 等高线。
- **设计决策**：普通卡 = 左 84px 缩略图 + 右文字；featured = 148px 媒体盒大图 + 森林底信息区 +
  嫩叶 CTA；照片失败回退（缩略图隐藏/封面藏起）。
- **涉及文件**：`activity-card.{js,wxml,wxss}`、`home.{js,wxml}`、`discover.{js,wxml}`。
- **业务逻辑**：零变化（`.activity-card__title` 与 `<article bindtap>` 契约保留——e2e 钉点）。
- **真机证据**：`screens/after/{home,discover}*.png`；交互 I-01a/I-02a。

### D.3 领队工作台 `pages/workspace`

- **改动前问题**：三个指标数字裸露；待办/进程分区无眉题。
- **设计决策**：指标收进石色带（发丝线分三格，**不做成三张卡片**——工作台不是仪表盘）；
  「当前待办」「活动进程」加分区眉题；其余（面板挂载显隐、sync-key、阶段推进、门槛提示）原样。
- **涉及文件**：`workspace.{wxml,wxss}`。
- **业务逻辑**：零变化。
- **真机证据**：`screens/after/workspace*.png`；交互 I-03a/b/c、I-04。
- **注意**：主工作区他人在途的 `workspace.wxml` F-01 修改不在本 worktree 基线上，本轮的
  wxml 改动避开了那两行（`transitionHint` 提示行），合并时不会冲突。

### D.4 天气 `pages/weather` / `weather-hub` / `weather-chart`

- **按任务约束只做 token 级对齐**：暖纸面与石色随 `app.wxss` 自动生效；图表色板、天相色、
  算法、数据流、切窗/日卡交互**零改动**。
- **真机证据**：`screens/after/weather*.png`；交互 I-05a（日卡选中）、I-05b（48 小时切窗）。

### D.5 我的 `pages/me`

- 最近活动行加 44px 封面缩略图（失败回退纯文字行）；其余（自动保存契约、sheet 作用域）原样。
- **真机证据**：`screens/after/me*.png`；交互 I-06a/b。

### D.6 全局 `app.wxss` / UI skill 登记

- 新增 token 与编辑式类；`--paper` 暖调；同步登记到 `.agents/skills/ourtrail-ui/references/design-system.md`
  （遵守本项目「新 token 必须登记」的既定规矩）。

---

## E. 视觉对照

同一夹具（`[UI] 赵公山 · 东线穿越`，gathering 阶段，2 人已确认）、同一设备（390×844）、
同一滚动位。相对路径均相对于 `docs/ui-ux-redesign/`。

| 页面 | 改造前 | 改造后 |
|---|---|---|
| 活动详情 | `screens/before/activity.png` | `screens/after/activity.png` |
| 活动详情（中段） | `screens/before/activity-scroll.png` | `screens/after/activity-scroll1.png` |
| 发现 | `screens/before/discover.png` | `screens/after/discover.png` |
| 发现（列表） | `screens/before/discover-scroll.png` | `screens/after/discover-scroll1.png` |
| 首页（活动卡） | `screens/before/home-scroll.png` | `screens/after/home-cards.png` |
| 工作台 | `screens/before/workspace.png` | `screens/after/workspace.png` |
| 我的 | `screens/before/me.png` | `screens/after/me-scroll.png` |
| 天气 | `screens/before/weather.png` | `screens/after/weather.png` |
| 边界：39 字长标题 | —（旧版同款会溢出） | `screens/after/edge-long-title.png` |

空态基线（改造前，无夹具）：`screens/before/{home,discover,me,weather,activity,workspace,staff,vehicle,notices}.png`。

---

## F. 验收矩阵

判定口径：**通过**= 已执行且有实际证据；**失败**= 已执行未达预期；**未验证**= 环境不具备；
**不适用**= 与本轮范围无关。

### F.1 真机交互（`evidence/interaction-readings.json` + `-round2.json`，全部真实 tap + 后果观测）

| 用例 | 结果 | 证据 |
|---|---|---|
| I-01a 首页→「发现活动」→discover | **通过** | 路由变为 pages/discover/discover |
| I-02a 发现页点卡片→活动详情 | **通过** | 路由 + title 回读 |
| I-02b 详情页编辑式结构在位 | **通过** | hero 图 350×240 · fact-row 3 · kicker 6 |
| I-02c 封面图绘制路径通 | **通过** | size 非零（绝对定位+百分比高不绘制，已改定高媒体盒，见 G②） |
| I-03a 详情页→「进入工作台」 | **通过** | 路由 + 后续 tab 交互 |
| I-03b 工作台点「名单」→面板显隐 | **通过** | roster-panel class hide→'' |
| I-03c 工作台总览编辑式对齐 | **通过** | section-head 2 · 指标带在位（首轮为时序假红，round2 复核通过） |
| I-04 工作台点「分车」 | **通过** | transport-panel 显示 |
| I-05a 天气页点日卡 | **通过** | 选中态上到第二张（day-card→day-card on） |
| I-05b 天气页切 48 小时 | **通过** | viewSpan 24→48（首轮为句柄假红，round2 复核通过） |
| I-06a 我的页最近活动封面 | **通过** | 44×44，3 行 |
| I-06b 点最近活动→详情 | **通过** | 路由 |
| 长标题边界（39 字） | **通过** | 4 行折行稳定，无溢出无遮挡（`edge-long-title.png`） |
| 封面加载失败回退 | **未验证** | 需要构造坏图路径，未注入（代码路径已实现：binderror→img-failed） |

### F.2 回归（全量 `tools/*-test.js`）

- **基线**（开工时主工作区实测，`evidence/gate-baseline-mainworktree.txt`）：77 个 `*-test.js` 逐套跑，
  **73 套 exit 0 / 4 套非绿** = 3 套设备套件无会话（exit 2 INCONCLUSIVE）
  + 1 套天气线常驻非确定性红 `outdoor-intelligence-ui`（46/1，AGENTS.md 登记在册）。
- **本轮**（worktree 实测，`evidence/gate-headless-sweep.txt`）：无头套件逐套独立跑
  **72 套 exit 0 / 0 失败**（3 套设备套件按基线惯例单独处理）。其中与本轮改动直接相关的：
  `style-semantics-test 92/0`、`g2-platform-gate 15/0`、`trip2-gates 76/0`、
  `scenario-activity 136/0`、`scenario-discover 21/0`、`scenario-me 143/0`、
  `scenario-workspace 114/0`、`weather-page 189/0`、`journey-graph 15/0`、
  `fixround2-assertions 83/0`（**他人在途门禁，本轮未碰其文件仍全绿**）。
  连基线上的常驻红 `outdoor-intelligence-ui` 本轮也绿（47/0，仍按惯例登记为偶发项，不因一次绿宣布消失）。
- `e2e-golden-path-test`：带真实会话复跑 exit 2、passed=12 failed=2 unverified=2——与 AGENTS.md 登记的
  **存量 GP-01（NO_REVISION）红读数一致**（文档记载「`passed=12 failed=2`，NO_REVISION」同款），
  归因于先于本轮存在的问题，未擅动公共门禁。`e2e-ui`/`e2e-ui-state` 因设备会话被驱动脚本占用
  出现挂起，按 playbook 处置后未取得有效读数（基线同为环境性 INCONCLUSIVE）。
- `check.js` / `check-handlers.js`：exit 0（含本轮新增 `utils/covers.js`、新 binderror handler、
  209 处相对 require 全部可解析）。

### F.3 编译与包体

- 开发者工具编译通过（真实运行即编译通过）。
- 包体：`miniprogram/` 1,107KB → **1,646KB**（新增照片 525KB），低于 2MB 主包上限，余量约 350KB。

---

## G. 剩余工作（按优先级）

1. **逐页推广（用户体验影响最大，成本中）**：`signup`（报名表单是转化关键）、`editor`（创建流程）、
   `routes`/`route`/`route-edit`（路线库三页）。已备好 token 与类，按 D.2/D.1 模式复用，
   每页改完跑 `check.js` + 对应 scenario 测试 + 真机截图。
2. **封面绘制的平台坑备忘（阻塞后续页面）**：`<image>` 用「绝对定位 + 百分比高」在部分基础库上
   **不绘制**（本轮真机实测：size 正常但不绘制）。**后续所有封面一律用「定高媒体盒 + 文档流
   image」模式**（`design-system.md` §2.2 与 app.wxss 注释已钉住）。
3. **小屏渲染验证（未验证项）**：需要人工在开发者工具切到 iPhone SE（375×667）复看
   hero/卡片/工作台；或等 automator 支持机型切换。
4. **真活动封面图（业务增强，需服务端）**：活动模型加图片字段 + 上传链路，才能把"氛围图"
   升级为"活动实拍"；当前脚注是诚实下限。涉及 schema 变更，须走 ADR。
5. **staff/vehicle 深度对齐**：本轮只继承 token；两页被 trip2/golden-path 门禁钉死结构，
   要改需先补测试再动（建议单独一轮）。
6. **天气页信息层级**：本轮按要求未动；若要进一步编辑化（如事实层/结论层的眉题体系），
   须先冻结天气门禁读数（weather-page-test 189 条）再逐项改。

---

## H. Git 与交付状态

| 项 | 状态 |
|---|---|
| 起始分支/版本 | `win/ui-fix-round2-wave1` @ `381efae`（主工作区，含他人在途未提交改动） |
| 本轮分支 | `win/ui-redesign-editorial`（worktree `d:/OurTrail-ui`，基线 `381efae`） |
| 本轮提交 | **2 个本地提交**（未推送）：`851b68b` feat(ui) 主提交（80 文件，+1269/−53）、`8839b0a` chore(docs) 删草稿 |
| 改动文件 | `miniprogram/app.wxss`；`pages/activity/{js,wxml,wxss}`；`pages/home/{js,wxml}`；`pages/discover/{js,wxml}`；`pages/me/{js,wxml,wxss}`；`pages/workspace/{wxml,wxss}`；`components/activity-card/{js,wxml,wxss}`；**新增** `utils/covers.js`、`assets/photos/*`(9 图 + README)、`docs/ui-ux-redesign/*`（规范/报告/截图/证据） |
| 未触碰 | `cloudfunctions/`（零改动 ⇒ 不需重新部署）；他人在途的 `utils/api.js`、`workspace.wxml` F-01 行；所有 tools/ 门禁；主工作区零改动 |
| 推送 | **未推送**（PARALLEL_DEV 铁律：不推 master；本分支也未推远端；本机中继主机不可达） |
| 潜在冲突 | 与他人在途任务（fix round 2）**无文件重叠**；`workspace.wxml` 的 F-01 两行本轮避开；`app.wxss`/`activity-card` 为其未涉文件。合并顺序建议：先合 fix round 2，再 `git merge --no-ff win/ui-redesign-editorial` |

---

## 附：本轮方法论备忘（给下一轮）

1. **会话 Wedged 的假红形态**：控制组（reLaunch 首页）正常、其余页 `page.data()` 返回 `{}` +
   空白截图 ⇒ 按 playbook §3 `cli quit → open → auto` 重启，**不要改产品**。
2. **设备套件挂起**：全量 sweep 里跑设备套件会与驱动脚本抢 9420 会话而挂起；正确做法是无头套件
   批量跑 + 设备套件带新会话单独跑。
3. **绝对定位 + 百分比高的 `<image>` 不绘制**：见 G②，这是本轮唯一"数据对、渲染不对"的坑，
   与 AGENTS.md 记的 P4 教训同族——**静态门禁与逻辑测试天然看不见它**。
