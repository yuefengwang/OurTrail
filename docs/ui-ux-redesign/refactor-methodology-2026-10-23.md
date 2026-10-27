# 从一张设计图重构现有系统：方法论与本仓库落地

> 目标：回答「为什么之前的重构像换汤不换药」以及「以一张设计图为起点，怎样做真正的大尺度重构」。
> 本文是方法论文档，不改产品代码。所有现状判断都带 `file:line`，设计图判断以用户提供的活动详情稿（12 项标注）为准。

## 0. 先说实话：之前为什么是「换汤不换药」

前三轮实际改的是：

- token 值、冷暖色、圆角、间距；
- 全局类与局部类名；
- 局部模板顺序、文案、按钮权重；
- 测试与证据。

没有改的是：

- 页面的**构图语法**（`.stack` + `.card` + `.fact-row` 的纵向卡片堆）；
- 页面的**阅读顺序**（同行人/行程/天气在路线之前）；
- 页面的**组件边界**（400 行 WXML 仍是一个整页，而不是若干可独立验收的区块）；
- 页面的**首屏构图**（导航、hero、信息卡、指标条、底部操作的关系）。

三个原因：

1. **约束把可动面压到了 L1**：每轮都带着「不改 schema/云函数/domain/业务状态机、零新 token」的边界，能动的只剩样式与局部模板。
2. **把设计图当成了风格参考，而不是页面规格**：只提取了「森林绿、纸面底、白卡、下划线页签」，没有提取「区块解剖、阅读顺序、首屏构图、组件状态」。
3. **缺少两道验收**：没有结构差分（section order / component tree），也没有固定基线的视觉回归。于是每轮都能说「改了不少」，但结构没动。

结论：不是做不了大尺度重构，而是没有按**迁移工程**立项。大尺度重构需要先声明改哪一层，再按可回滚的切片迁移，并用结构断言与视觉基线验收。

## 1. 先定义「大尺度」：UI 重构的五层

| 层级 | 内容 | 典型改动 | 能否称为重构 |
|---|---|---|---|
| L0 内容/文案 | 标题、说明、空态话术 | 改字 | 否 |
| L1 样式/token | 色、字阶、间距、圆角、阴影 | 改 CSS 变量与类 | 否（视觉收敛） |
| L2 组件边界 | 把整页拆成可独立验收的组件；定义 props/events/states | 新增 `hero`、`stat-grid`、`equipment-grid`、`sticky-cta` | 是 |
| L3 页面构图/阅读顺序 | 区块顺序、首屏结构、信息层级、导航与操作位置 | hero 叠标题、浮动信息卡、章节重排、底部固定操作 | 是 |
| L4 数据/内容模型 | 新增字段、内容块、派生数据 | 装备图标/说明、时长、最高海拔 | 是（需 schema/云函数或受控映射） |
| L5 流程/状态机 | 新增步骤、状态、权限、支付/收藏 | 收藏、支付、报名流程变更 | 是（但属于产品变更） |

规则：

- **每轮必须声明改了哪几层**。只改 L0/L1 的轮次不得称为重构。
- 本设计图的目标是 **L2 + L3**，少量 L4（装备图标/说明、时长/最高海拔派生），不碰 L5。
- 约束决定上限：不允许 L4 时，装备图标只能做**受控映射**；不允许 L5 时，收藏/支付/价格语义不做。

## 2. 七阶段管线（通用，不绑定框架）

### 2.1 Design Spec：把图拆成可实现的规格

不要从「看起来像」开始，先产出一页规格：

- **Anatomy**：区块清单与顺序（hero、信息卡、简介、图集、路线、地图、剖面、行程、费用、装备、注意、底部操作）。
- **Grid / Spacing / Type**：内容宽、左右留白、区块间距、字号/行高/字重层级。
- **Color roles**：主色、纸面、线条、辅助文字、危险/成功/警告；只映射到现有 token，不新造色。
- **Component states**：默认、空、长文本、图片失败、草稿、已发布、owner、participant、busy。
- **Content model**：每个区块的数据来源；标记 `已有 / 可派生 / 需新数据 / 不适用`。
- **Platform notes**：导航形态、安全区、分享、原生 picker、sticky 与 tabBar 的关系。

产出：一页 spec + 逐项标注表 + **红线清单**（不可照抄的产品冲突）。

### 2.2 Gap Matrix：现状差分（防「换汤不换药」的核心工件）

逐区块填五列：

| 列 | 说明 |
|---|---|
| 现状 | 当前实现与 `file:line`；已具备 / 部分 / 缺失 |
| 变更类 | A 仅 token；B 重组构图；C 新组件；D 数据/内容；E 平台/行为 |
| 目标 | 设计图要求的结构，不写「更好看」 |
| 风险 | 影响哪些页面/状态/测试 |
| 验收 | 结构断言 + 视觉基线 + 交互用例 |

**检查**：如果矩阵里 B/C/D 全是 0，这一轮就是 reskin，不是重构。

### 2.3 Strategy：选迁移方式，不做大爆炸

- **Strangler Fig**：新实现与旧实现并行，流量逐步切走，旧路径最后删除。适合页面级替换。
- **Branch by Abstraction**：在旧实现前加一层稳定接口，新实现挂在接口后面，切换实现而不改调用方。适合组件/数据源替换。
- **垂直切片**：每个切片独立可上线、可回滚；切片内部再按「组件 → 页面 → 状态」推进。
- 小程序没有 feature flag 基建：可用 `?layout=v2`（仅开发/灰度）、独立预览页、或 dev-only 的 `pages/lab` 组件画廊；**不要一次性替换用户路径**。
- 先做 behavior-preserving 的结构移动，再做行为变更；两类改动分开提交，避免「重构 + 改需求」混在一起无法归因。

### 2.4 Component Workshop：组件驱动开发（CDD）

- 先把区块做成**独立组件**：`hero`、`info-strip`、`stat-grid`、`section`、`equipment-grid`、`sticky-cta`。
- 组件契约：props 入、events 出、不直接读页面 data、不复制业务判断。
- 每个组件在隔离环境跑状态矩阵：默认/空/长文本/图裂/草稿/已发布/owner/participant。
- 小程序没有 Storybook：
  - 用已登记 `DEV_ONLY` 的 `pages/lab` 做**组件画廊**（fixtures 只进开发页，不进用户路径）；
  - 或用 `miniprogram-simulate` 做组件单测（装在仓库外，保持零 npm 依赖铁律）。
- 这一步是「大尺度」的地基：页面从 400 行 WXML 变成若干有契约、有状态矩阵的区块。

### 2.5 Recompose：页面重组

- 新页面壳只做编排：读取现有 selector 投影 → 组装组件。
- 状态与「下一步」仍只出自 `utils/journey.js`；页面不新增状态词。
- **先结构后像素**：先让 section order、首屏层级、组件边界正确，再调字阶/间距/圆角。
- 保留业务操作区（同行人、天气、任务、通知）的可用性；它们不该为了「像设计图」被删掉，应作为次级/组织者工具区重新编排。

### 2.6 Visual Regression + Design QA：验收

- **固定条件**：固定视口（如 306×660 与 390×844）、固定数据夹具、固定滚动位置、固定状态。
- **两层对比**：
  - 结构断言：section 顺序、组件存在、关键几何读数（高度/间距/触控尺寸）；
  - 像素对比：基线截图 diff；差异要能解释，不能只看「像不像」。
- **工具**：
  - Web：Playwright `toHaveScreenshot()`、Chromatic/Percy；
  - 小程序：`miniprogram-automator` 截图 + 仓库外 `pixelmatch`（基线入库，diff 产物不入库）；
  - 设计 QA 清单：布局、字阶、色彩角色、间距、状态、文案、可访问性、平台差异。
- **证据档**：E1 源码文本 / E2 运行时读数 / E3 真机截图 / E4 用户验收；不混档。
- **DoD 三分**：结构 DoD（区块/顺序/组件）、视觉 DoD（基线/几何/对比度）、交互 DoD（真实 tap + 后果）。

### 2.7 Cutover & Cleanup：切换与清理

- 旧实现保留到新实现通过验收；切换后删除旧分支/旧类/旧模板。
- 更新设计系统文档与 SYNC；记录回滚点。
- 用 characterization tests 证明「行为未变」或「按预期变」；不要用「页面能打开」代替。

## 3. 用这张设计图做一次实际拆解

设计图 12 项标注对照当前实现（`miniprogram/pages/activity/activity.wxml` 等）：

| # | 设计项 | 现状 | 证据 | 变更类 | 判断 |
|---|---|---|---|---|---|
| 1 | 封面图 + 标题 | 部分 | hero 已有 `activity.wxml:27-62`；标题在图片下方 `:43`；原生导航 `activity.json:1` | L3 + E | 要「叠标题/自定义导航」是构图与平台改动，不只是 CSS |
| 2 | 活动基本信息卡 | 部分 | 事实区在 `:139-159`，是列表行，不是浮动信息卡 | L3 | 内容已有，位置与容器要重组 |
| 3 | 活动简介 | 已有 | `:109-137`；`contentView` 渲染段落 | — | 保留，调排版节奏 |
| 4 | 风景图片 | 已有 | `:119-129`；`utils/content-view.js` 支持单/双/三列 | L1/L2 | 只需图集构图与圆角统一 |
| 5 | 路线四指标 | 部分 | 距离/爬升在 hero `:45-60`；最高海拔在剖面；时长未作为指标 | L2 + D | 新建 `stat-grid`；时长可由起止时间派生，最高海拔可从剖面取 |
| 6 | 地图与轨迹 | 已有 | `:239-252` | — | 保留 |
| 7 | 海拔剖面 | 已有 | `:259-261`，`route-profile` 组件 | — | 保留 |
| 8 | 行程安排 | 部分 | 三行事实 `:186-195`；节点时间轴在路线区 `:264-299` | L3 | 合成一个按时间推进的行程时间轴 |
| 9 | 费用说明 | 已有 | `:357-378`；`feeSummary/feeIncludes/feeExcludes` | — | 保留；**不要引入价格/支付语义**（产品零金额） |
| 10 | 装备要求 | 部分 | `:337-355` 只有文字 badge | L2 + D | 图标网格需要受控映射或新字段；先做映射，避免动 schema |
| 11 | 注意事项 | 已有 | `:323-335` | L1/L3 | 改成编号清单，数据不变 |
| 12 | 底部操作 | 部分 | 操作在页面顶部 `:73-94`；全局有 `.sticky-action` `app.wxss:247`，但本页未用 | L2/L3 + E | 加固定底栏；**收藏不是现有能力**，需产品裁决 |

统计：12 项里 **6 项已具备、6 项部分具备、0 项完全缺失**。真正的差距不在内容能力，而在 L2/L3：

- 首屏构图（导航/hero/信息卡/指标条/底部操作）；
- 阅读顺序（当前：简介 → 事实 → 同行人 → 行程 → 天气 → 路线 → 安全 → 装备 → 费用；设计：主题 → 信息 → 简介/风光 → 路线 → 行程 → 费用 → 装备 → 注意 → 报名）；
- 组件边界（整页 WXML 而非可独立验收的区块）；
- 状态矩阵（草稿/已发布/owner/participant/busy）在新区块里的表现。

### 3.1 本图里不能照抄的部分

- **¥298/人**：OurTrail 是零金额纯工具，不收款、不处理支付/退款。费用区只能做「费用说明/AA 约定」，不能做价格主视觉。
- **收藏**：当前没有收藏数据模型与入口；为了一个图标新增 L5 能力，需产品决策。
- **自定义导航**：设计把返回/分享叠在封面上；小程序要 `navigationStyle: custom` + 安全区 + 右侧胶囊避让，属平台硬约束，必须真机验证。
- **大图实拍**：设计用四姑娘山照片；仓库里没有这批素材。没有真实素材时不能用「看起来像」的假图冒充实拍；继续走现有封面诚实标注与氛围图回退。
- **「立即报名」**：CTA 文案与可用性必须由 `journey.js` 的状态决定；不能因为设计图写了「立即报名」就在所有状态都显示报名。

## 4. 本仓库的落地规则

- 静态门（`node tools/check.js` + `node tools/check-handlers.js`）是底线，不是页面正常的证明。
- 改 WXML/WXSS/组件结构后必须真机（IDE 模拟器或物理机）验证；证据分 E1–E4，不混档。
- `domain → projection → label` 单向；状态与下一步只出自 `utils/journey.js`。
- 不新增色值/token；确需新语义色，先进 `app.wxss` 并登记。
- 零 npm 依赖：组件画廊/像素 diff 的依赖装在仓库外。
- 不动 schema/云函数/domain 的约束下，L2/L3 仍可做；L4 先做受控映射，确需新字段时单独裁决并计入部署。
- 每个切片：组件 → 隔离状态 → 页面组装 → 静态门 → 真机截图 → 与基线对比 → SYNC 记录。

## 5. 下一轮建议：先交 4 个工件，再做 3 个切片

### 5.1 动代码前先交

1. **Design Spec**：12 项解剖 + 网格/字阶/间距 + 状态矩阵 + 红线。
2. **Gap Matrix**：逐区块 `file:line` + A/B/C/D/E + 风险 + 验收。
3. **Component Contract List**：每个新组件的 props/events/states/空态。
4. **Visual Baseline Plan**：视口、数据夹具、滚动位置、状态清单、基线存放与审批方式。

### 5.2 三个垂直切片（每个都可独立回滚）

- **S1 首屏**：hero 叠标题 + 浮动信息卡 + 四指标条（距离/爬升/最高海拔/预计用时）。不改数据模型；时长与最高海拔走派生。
- **S2 正文节奏**：章节统一为 `section` 组件；行程合并为时间轴；装备改图标网格（受控映射）；费用区保留零金额语义。
- **S3 底部操作**：`sticky-action` 底栏 + 状态矩阵（草稿/已发布/owner/participant/busy）+ 自定义导航裁决。
- **S4（可选）**：阅读顺序重排与组织者工具区降级；这一项影响业务流，单独裁决、单独验收。

每个切片完成后：结构断言 + 固定基线截图 + 真实 tap 后果 + 旧路径清理，才算完成。

## 6. 防「换汤不换药」检查表

1. 本轮声明改的是哪几层？只有 L0/L1 → 不是重构。
2. Gap Matrix 里 B/C/D 项数是否为 0？为 0 → 只是 reskin。
3. 是否新增/删除了页面级节点或组件？
4. 阅读顺序或首屏构图是否改变？
5. 是否有 before/after 的结构断言（section order、组件树、几何读数）？
6. 是否有固定视口/固定夹具的像素或几何对比？
7. 旧实现是否在验收后被删除（Strangler 完成）？
8. 业务行为是否有 characterization tests 证明「未变」或「按预期变」？

前 5 条都答「否」，就不该叫重构。

## 7. 为什么 skill 本身解决不了这件事

- `ui-designer`：从零产出新原型（React/Tailwind），是「造一个新东西」，不是「把旧系统迁移过去」。
- `refactoring-ui`：视觉层级与尺度规则，作用在已有构图内，天然是 L1。
- `ourtrail-ui`：约束、审计、证据档与真机门槛，保证「不违规」，不负责「如何迁移」。
- `grill-me`：把决策问清楚，不产出迁移工程。

技能是护栏，不是迁移方案。迁移需要：规格 → 差分 → 策略 → 组件工作台 → 重组 → 视觉回归 → 切换。

## 8. 参考来源

- Martin Fowler, Strangler Fig Application — https://martinfowler.com/bliki/StranglerFigApplication.html
- Branch by Abstraction（Confluent 课程）— https://developer.confluent.io/courses/microservices/branch-by-abstraction/
- Azure Architecture Center, Strangler Fig Pattern — https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig
- Brad Frost, Atomic Design Methodology — https://atomicdesign.bradfrost.com/chapter-2/
- Storybook, Why Storybook / Component-Driven Development — https://storybook.js.org/docs/get-started/why-storybook
- Playwright, Visual comparisons — https://playwright.dev/docs/test-snapshots
- Chromatic, Visual Test Driven Development — https://www.chromatic.com/blog/visual-test-driven-development/
- W3C Design Tokens Community Group — https://www.w3.org/community/design-tokens/
- Design Tokens Format Module — https://www.designtokens.org/tr/drafts/format/
- Design QA 流程与清单（OverlayQA）— https://overlayqa.com/blog/what-is-design-qa/
- Refactoring UI（视觉层级与尺度规则）— https://refactoringui.com/

## 9. 跨页面实施规格与计划（2026-10-23）

> 执行：按独占文件集拆分实现，主会话核对真实差分、集成与开发者工具证据。用户授权自主推荐，不重复开审批，不提交、不推送、不部署。

**Goal:** 将活动入口、组织现场、路线和个人中心从等权卡片堆改成任务驱动的页面族。

**Architecture:** 本轮改变 L2 组件展示契约与 L3 页面构图、客户端浏览交互；不改变领域状态机、权限、schema 或云函数。保留现有投影与命令链，不为新构图增加读取。

**Tech Stack:** 原生 WXML/WXSS/CommonJS；既有 app.wxss token；Node 真实 Page 测试；微信开发者工具。

### 9.1 Design Spec 与差分矩阵

| 页面族 | 当前差距 | 目标构图及变更类 | 必留契约 | 验收 |
|---|---|---|---|---|
| home / activity-card | 普通卡媒体占 168px，重复人数与路线统计；所有卡视觉权重接近 | B/C：重点卡保留场景摄影，其余改图文横排；同一活动仍只出现一次；标题、日期、状态优先 | 三视角去重、协作双入口 catchtap、搜索与四档筛选 | 双角色不重复；组件紧凑态/长标题/图失败；入口点击后果 |
| discover | 说明挤占搜索前的位置；筛选编辑直接污染已应用条件 | B/C/E：搜索→结果工具条→列表/地图；筛选 draft→apply，取消不改变结果；保留完整个人发起提示 | 请求字段、日期校验、最多本次结果的地图点，不伪称附近或全量 | 取消/应用/重置/乱序响应；地图选卡与无坐标；真实输入和切换 |
| workspace / vehicle / staff / tasks | 说明、总览和操作等权；长页工具压过当前任务 | B：任务与下一步优先、阶段/角色信息紧凑；操作工具降为次级分组，危险入口仍可发现 | hidden 常驻三面板；sync-key 与 written；原权限、确认层、必填原因 | 宿主/面板同步与状态矩阵；切区不重挂；真实工具导航 |
| routes | 72px 无内容媒体空槽；metrics 与 statsText 重复 | B：文字路线资产列表；编号/标题/距离爬升节点/来源与引用，各事实只展示一次 | mine/shared 分组；不替共享接收者增加发起权限 | 双组、空值、长名；打开与新建导航 |
| route | 先氛围大图再地图；发起入口在长页底部 | B/C：紧凑路线头→地图→剖面→节点→天气→风险→协作/引用；owner 固定主操作，编辑次级、删除明确分组 | 既有地图装配、分段天气、owner、共享全量写、删除 CONFLICT | 空路线/图缺失/长名/owner及共享者；底栏留白与导航 |
| me | 身份前重复说明标题；最近活动与工具混在同容器 | B：无大标题的头像昵称身份头＋统计带；最近出行独立；路线库与安全资料分组 | chooseAvatar/nickname、自动保存800ms、草稿、所有sheet、位置撤回与隐私 | 未激活/有草稿/无活动/长昵称；打开与关闭sheet；不写真实资料 |

借参考图的空间组织、摄影裁切、主次关系，不借价格、支付、收藏、虚构统计或假地图。色彩沿用森林绿与近白纸面；页面各有中心，不统一套大 hero。

### 9.2 组件契约

- activity-card：现有 props/events 不破坏；新增 compact 展示态只改构图。open 仍打开详情，collab 仍以 key 发出并阻止冒泡；空值不造事实，图片失败保持文字信息。
- chapter：继续用既有编号/标题/说明及 slot 契约组织路线章节，不读页面 data，不新增业务逻辑。
- fact-grid：继续消费纯展示 items；路线摘要只映射已有距离、爬升、节点等事实。
- 三个工作台业务面板：不拆写流程，不复制权限计算，不把 hidden 换成 wx:if。
- me 的编辑 sheet：维持现有字段/事件/作用域；结构移动不改变自动保存与隐私授权。

### 9.3 文件责任与实施步骤

1. 入口切片独占 `pages/home/*`、`pages/discover/*`、`components/activity-card/*`，测试扩展 `home-collab-list-test`、`scenario-discover-test`、`a20-owner-hero-test`。
2. 组织切片独占 `pages/workspace/*`、`pages/vehicle/*`、`pages/staff/*`、`pages/tasks/*`，只改页面编排；测试扩展各真实 scenario，面板同步跑 `e2e-panel-sync-test`。
3. 个人路线切片独占 `pages/routes/*`、`pages/route/*`、`pages/me/*`，测试使用 `scenario-me-test` 及独立路线展示结构/真实页面行为判据。
4. 每个写者先添加失败断言并实际运行，再改生产实现，再运行对应套件；结构断言不冒充视觉证据。不改共享静态门来迎合新样式，旧结构假红需证明原保护行为仍成立。
5. 主会话独占全局样式与文档；先核差分，再执行 `tools/check.js`、`tools/check-handlers.js`、受影响全部套件及布局门；最后统一开发者工具回读。

### 9.4 视觉基线与停止条件

- 改前：以当前脏工作树独立快照为基线，不拿 HEAD 代替，因为本轮前已有活动详情与视觉修改。快照带程序生成的逐文件 SHA-256 清单。
- 改前/后使用相同生产形状的合成投影、相同 CSS 视口、滚动点；通过实际 reload 装配，而不是手拼 cards 来答绿。每例重新启动页面并检查 loading/denied 与关键对象。
- 截图分别标合成数据、CSS viewport、PNG尺寸和 bundle 身份；不记录真实姓名、电话、位置或身份码。开发者工具只 close/open 项目，不 quit，不做云写。
- 真实点击仅覆盖无副作用浏览：搜索、筛选取消与应用、列表/地图、面板切换、导航、sheet打开关闭。原生 picker/分享等驱动不了时记 INCONCLUSIVE，不伪造操作。
- 停止条件：每个切片有结构变化、回归结果、有效截图及关键浏览后果；缺口明确列出，不将静态全绿称为全面视觉通过。

### 9.5 证据术语更正

§2.6 旧简写中的“E2 运行时读数 / E4 用户验收”不准确。以 `.agents/skills/ourtrail-ui/references/audit-verification.md` 为准：E1 源码事实，E2 实现推断（附推断链），E3 真实渲染/DOM/交互，E4 主观观感判断。主观认可不是测试档位升级；注入渲染与真实用户操作分栏记录。

### 9.6 执行记录（2026-10-23，收口）

**交付面**：11 个页面（home / discover / activity / workspace / vehicle / staff / tasks / routes / route / me，含 workspace 现场面板态）按三组独占文件集落地；新增 L2 组件 `activity-hero` / `chapter` / `fact-grid` / `equipment-grid`，其中 `chapter` 被 activity / route / me 三页复用。`cloudfunctions/` 零改动（`git diff --name-only -- cloudfunctions` 为空）⇒ 不需要重新部署 trailApi。

**与 §9.3 的偏离（如实登记）**：

1. **结构套件不是严格的“先红后绿”**。三组写者连同主会话先落结构、再补结构判据并跑到绿；这些套件钉的是新构图的承重契约（如 `activity-l2-structure` 的 hero/chapter/fact-grid 组合、`entry-layout` 的身份头与唯一主按钮、`personal-route-layout` 的路线行事实不重复），但没有在旧实现上先演示红。它们的证据档是“钉住现状的回归门”，不是“TDD 失败先行”的证明。
2. **activity-card 的契约变化比 §9.2 多一条**：原计划只加 compact 展示态；像素复核发现 featured 分支根本没渲染 metrics，导致首页精选卡丢掉距离/爬升。修法是在既有 props 上补渲染并给森林底指标值换纸白，没有新增字段或读取。
3. **workspace 的“排除主待办与 idle”集合运算收回 JS**（`queueRest`）。`t1-r01` 的求值器判不了复合 `wx:if`，且铁律 22 本就要求模板只读给定布尔/列表——修法没有放宽门。
4. **routes 的序号用 JS 预算 `indexText`**：WXML mustache 内的 `&lt;` 触发编译错误，而 `check.js` 抓不到这类错误；这条是在开发者工具重编译阶段才暴露并修掉的。

**回归**：

- `check.js` → `ALL CHECKS PASSED`（G10 类作用域命中 0：40 个作用域单元 / 3133 个 class token / 134 个 app.wxss 类名）；`check-handlers.js` → 通过，死 handler 存量仍 1 条（`editor.js#onNumber`）。
- 全量 sweep：**110 套 / passed=7002 / failed=14 / redSuites=4**。四个红套件全部用 `git archive HEAD`（`e05e559`，不含本轮改动）在仓库外复现同读数：`cold-start-work 8/2`、`g2-platform-gate 14/1`、`t1-r01 28/1`（T25）、`trip2-gates 66/10`。本轮唯一引入的红（`t1-r01` T27）已按上条修复并回到 HEAD 读数。
- B 层三套未跑：`e2e-ui-test` / `e2e-ui-state-test` 已有登记过期与夹具时序问题，`e2e-golden-path-test` 会取消共享云端历史活动并新建非 `[预演]` 活动，超出本轮授权 ⇒ **NOT_RUN，不是 PASS**。

**运行时证据**：`docs/ui-ux-redesign/evidence/crosspage-l2-2026-10-23/`（before 13 帧 / after 13 帧、两份脱敏 manifest、README）。11 页 gates 失败 0、residual 0、exceptions 0；守卫账本 `blocked=[]`，mutations 仅 `ourtrail.opened.v1` / `ourtrail.openid`（本地 LRU 与匿名标识）。bundle 新鲜度由只存在于新代码的文案/结构自证（首页精选卡指标、工作台常驻事实带、before 仍是旧问候语）。`page.data()` 不作像素证据；星级、计数、按钮态等读的是实际渲染文本/class。

**仍未闭合（不冒充通过）**：地图底图瓦片在 IDE 空白 ⇒ 底图 UNVERIFIED；原生 picker / 相册 / 分享面板未驱动；`staff` 只有 denied 态、`vehicle` 只有“已完成 + 零乘车人”极端数据、`tasks` 是注入夹具；截图左缘 x=0–9 的细碎字形带是截图通道伪影（前后两组同现），不是布局元素；未在物理手机上验证手势/键盘/安全区。以上均不阻塞本轮的 L2/L3 结构结论，但不能写成“全页面视觉验证通过”。

**边界**：未 commit / 未 push / 未部署；未清理共享云端测试数据；未覆盖用户未跟踪文件（`OurTrailNightBu.txt`、两个交付包、`OurTrail全局UI重设计.txt`，收口前已用 `git status` 复核仍在）。

