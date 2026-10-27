# 活动详情页 L2/L3 重构 · Design Spec

> 工件 1/4。方法依据：`docs/ui-ux-redesign/refactor-methodology-2026-10-23.md` §2.1、§3。
> 基线代码：`master` `46fd7c5`。当前主工作树在 `agent/ourtrail-style-a-20261023`，活动页四文件与 master 逐字相同；工作树另有 style-A 未提交改动，**不属于本轮**。
> 本文件只定义目标，不改代码。所有数值取自 `miniprogram/app.wxss` 现有 token 与既有类；设计图的精确间距以图为准，仓库内没有对应像素值时以实测基线为准（见 `BASELINE.md`），不凭空编造。

---

## 0. 本轮声明：改哪几层

| 层 | 本轮 | 说明 |
|---|---|---|
| L0 内容/文案 | 少量 | 只为消除重复与补充缺失说明；不重写活动文案 |
| L1 样式/token | 微调 | 只复用现有 token 与类；**零新色值、零新 token** |
| **L2 组件边界** | **是** | 新增 `activity-hero`、`fact-grid`、`chapter`、`equipment-grid` 与两个纯函数 |
| **L3 页面构图/阅读顺序** | **是** | 首屏（hero / 信息卡 / 指标条）、行程合并、底部固定操作 |
| L4 数据/内容模型 | 否 | 不新增 schema 字段；时长/最高海拔/装备图标全部派生 |
| L5 流程/状态机 | 否 | 状态与下一步仍只出自 `utils/journey.js` |

**不做**：整体区块重排（S4，需单独产品裁决）、自定义导航（S3 裁决）、价格/收藏（红线）。

判定：本轮 Gap Matrix 中 B/C/D 项均非 0；若实施后只剩 token 与局部模板变化，即判本轮失败（方法论 §6）。

---

## 1. 读者与唯一主任务

两类读者共用一页，但**阅读顺序由参与者决定**：

- **参与者**（主读者）：被群里链接带进来，手机竖屏，要在一屏内回答「去哪、什么时候、怎么集合、难不难、带什么、多少钱、安不安全、怎么报名」。
- **组织者**（次读者）：发布后回来查看状态、进入工作台、分享、处理同行人。

**唯一主任务**：让参与者在读完后完成报名（或明确知道自己当前不能报名/该做什么）。
**次任务**：让组织者在同一页完成状态检查与分享。
主操作永远只有一个，且由 `utils/journey.js` 给出（`nextActionLabel` / `nextActionTarget` / `status` / `milestone`，见 `miniprogram/utils/journey.js:99-157`）。页面不新增状态词。

---

## 2. 目标解剖（设计图 12 项 → 页面区块）

设计图的 12 项与现有实现的关系见 `GAP.md`。目标解剖按**实施切片**标注：

| # | 区块 | 目标内容 | 数据来源 | 切片 |
|---|---|---|---|---|
| 0 | 页首状态 | 草稿提示 / 发布成功卡 / denied / loading | 现有 | S0 保留 |
| 1 | **Hero** | 全宽封面；顶部状态徽标 + 日期；底部叠标题、路线名、领队 | `cover/coverIsReal/badgeText/startAtLabel/title/routeTitle/leader` | **S1** |
| 2 | **信息卡** | 2×2：时间 / 集合 / 人数 / 强度 | `factTime/factPickup/confirmed+capacity/minParticipants/difficultyLabel` | **S1** |
| 3 | 状态 callout | 当前状态 + 时间锚点 + 计数 + 怎么去 | `journey` | S0 保留 |
| 4 | 分区锚点 | 横向 chips，只跳转不隐藏 | `sectionNav` | S0 保留 |
| 5 | 01 简介 | 导语/图文块/亮点（自动摘要不再渲染：字段已被信息卡取代） | 现有 `description/contentView/highlights` | S2 节奏 |
| 6 | 02 路线与集合 | **四指标条** + 地图 + 海拔剖面 + **节点时间轴** + 上车点 | 现有 + 派生 | **S1 指标；S2 时间轴迁出** |
| 7 | 03 行程安排 | 节点时间轴 + 日程依据 + 组织者说明 | 现有 `points/organizerIntro` | **S2** |
| 8 | 04 天气 | 出发日天气事实 + 风险 + 双入口 | 现有 | S0 保留 |
| 9 | 05 费用 | 费用说明/包含/不含/退出约定 + 零金额声明 | 现有 | S2 语义 |
| 10 | 06 装备 | 必带/建议 **图标网格**，文字始终保留 | 现有 + 受控映射 | **S2** |
| 11 | 07 安全 | 风险提示 | 现有 | S2 节奏 |
| 12 | 08 报名后 | 进群与行前准备 | 现有 | S2 节奏 |
| — | 同行人 | **S2 起不编号**（原位保留）；移动到正文后属 S4 | 现有 | S2 去号 / S4 移位 |
| — | 通知/协作任务 | 不编号；页尾入口 | 现有 | S0 保留 |
| — | **底部操作** | sticky 底栏；状态矩阵 | `journey` + 现有权限布尔 | **S3** |

### 2.1 首屏构图（S1 的目标）

```
┌──────────────────────────────┐
│  封面（全宽，240px 媒体盒）    │
│  [状态徽标]          [日期]    │
│  ── 渐变压暗 ──               │
│  活动标题（30/1.28/700，白）   │
│  路线名 · 领队（on-forest）    │
└──────────────────────────────┘
   ┌────────────────────────┐   ← 信息卡上浮 24px
   │ 时间        集合        │
   │ 人数        强度        │
   └────────────────────────┘
   照片诚实性脚注（纸面背景）
   状态 callout
   分区锚点
```

- **标题不截断**：`editor.wxml` 允许 100 字标题，仓库既有规则是活动标题「断行而不是 ellipsis」（`app.wxss:315-316` 注释、M-16）。做法是媒体盒保持文档流 240px，标题区负 margin 上浮 72px 并向下生长；长标题最多把 hero 往下撑高，不裁字。禁止 `-webkit-line-clamp`。
- **封面诚实性脚注**：从费用区（`activity.wxml:375-377`）移到 **信息卡之后**（信息卡上浮压住 hero，脚注必须落在纸面背景上才可读），**全页只出现一次**；文案逐字保留（实拍 / 氛围图 / 正文图片三态）。它不能压在照片上。
- **状态徽标与强度不重复**：顶部只留状态徽标 + 日期；强度只进信息卡。

### 2.2 路线四指标（S1）

放在「路线与集合」章节标题下、地图之前：

| 指标 | 取值 | 缺省处理 |
|---|---|---|
| 里程 | `routeSnapshot.distanceKm` + km | 无值不占格，不印「0 km」 |
| 累计爬升 | `routeSnapshot.ascentM` + m | 无值不占格 |
| 最高海拔 | `route-profile.elevationRange()` 派生 | 无高程不占格，章节内补一句「路线没有可用高程，暂不显示最高海拔」 |
| 预计用时 | `route-schedule.durationBetween(startAt,endAt)` 得分钟，拆成 `value`（数字）+ `unit`（小时/分）+ `sub`（跨日说明）；**不直接印 `durationText()`**，它在 26px 指标格里会折成两行 | 缺结束时间不占格 |

**布局**：2×2，不用四列。306px 模拟器下内容宽约 266px，四列每格约 60px；`4,660 m` 的 26px 数字 + 四字标签会溢出（本仓库已经有过「图表 viewBox 宽于实际显示宽度导致标签不可读」的教训，见 `utils/route-profile.js:1-12`）。2×2 是 306px 下的硬约束；只有在 375/390 实测证明四列可读时才允许在更宽视口启用四列，且必须有几何读数。

---

## 3. 阅读顺序与切片边界

### 3.1 S1–S3 期间保持现有 DOM 顺序

当前顺序（`activity.wxml`）：

```
hero(27-62) → callout(64-71) → actions(73-94) → nav(97-107)
→ 简介(109-137) → 说明/事实(139-159) → 同行人(161-184)
→ 行程(186-195) → 天气(197-232) → 路线与集合(234-321)
→ 安全(323-335) → 装备(337-355) → 费用(357-378) → 报名后(380-386)
→ 通知/任务(388-401)
```

S1–S3 只做三类移动：

1. **事实区溶解**（S1）：时间/集合/人数/强度进信息卡；费用摘要/报名摘要回到各自章节；评分保留为可选的「同行评分」小块。
2. **节点时间轴迁入行程**（S2）：`activity.wxml:264-299` 的时间轴 + `scheduleBasis`（`:263`）移到行程章节；路线章节保留地图、剖面、上车点。时间轴行点击定位后必须滚动到地图（`#meeting-block`），否则定位反馈在折叠线下方看不见；行内「天气 / 导航」用 `catchtap`，不触发滚动。
3. **操作区下移**（S3）：`:73-94` 的顶部操作改为底部 sticky；不改变操作的条件矩阵。

**不做**：把同行人移到正文后、把费用/装备提到安全前、把路线提到行程前——这些是 S4，单独裁决。S1–S3 不得顺手重排。

### 3.2 章节编号

`secNo`（`activity.js:407-424`）必须与模板可见条件逐条同源。S1 溶解事实区、S2 合并行程后，编号会变化：

- 事实区不再进入编号；若保留评分小块，作为「同行评分」不编号（或并入简介尾部）。
- 行程仍是编号章节；路线仍是编号章节。
- 任何新增/删除可见章节，必须同批改 `sectionNav`（`activity.js:392-403`）、`secNo` 与模板 `wx:if`，并由 `tools/scenario-activity-test.js` 断言。

---

## 4. 栅格 / 字阶 / 间距

### 4.1 画布

| 项 | 值 | 来源 |
|---|---|---|
| 参考宽度 | 375px；强制验证 306×660 | 既有真机基线 |
| 页面左右留白 | 20px | `app.wxss:84-88` `.page` |
| 页面上下 | 24px / 32px | 同上 |
| Hero 全宽 | `margin: 0 -20px`（不用 `100vw`） | 页面级包装；不改编 `.page` |
| 信息卡上浮 | `margin-top: -24px` | 页面级 |
| 区块间距 | 28px | `app.wxss:111` `.stack-sections` |
| 章节标题到内容 | 12px（天气 8px 维持现状） | 现有 `.stack` / `.stack-gap3` |
| 卡片内边距 | 16px | `app.wxss:135-140` `.card` |
| 触控 | 主按钮 48px；主目标 ≥44px | `--action-height` / `--touch-target`（`app.wxss:71-72`） |

**Hero 全宽**：在页面根节点下加页面级包装 `.activity-hero-bleed { margin: 0 -20px; }`，不把 `.page` 的 padding 改 0；这样 denied/loading 与其他页面不受影响。禁止 `width: 100vw`（微信 WebView 横向滚动条会引入 1-2px 抖动）。

**信息卡与 hero 的叠压**：信息卡 `position: relative; z-index: 1; margin-top: -24px`。hero 是普通文档流，不上 `position: fixed`，避免滚动穿透与地图层叠。照片诚实性脚注排在信息卡**之后**，因为信息卡已经压住 hero 底部，脚注若插在两者之间会破坏叠压并在照片上不可读。

### 4.2 字阶

| 用途 | 字号/行高/字重 | 来源 |
|---|---|---|
| 眉题（章节编号 + 类目） | 11/16/600/1.2 | `.kicker` `app.wxss:114-120` |
| 章节标题 | 20/28/600/-0.3 | `.list-head__title` `app.wxss:150` |
| 章节副说明 | 12/18 muted | `.section-sub` `app.wxss:146` |
| Hero 标题 | 30/1.28/700/-0.4，白 | `.display` `app.wxss:122-128` |
| Hero 路线/领队 | 14/20，`--on-forest-muted` | `.hero-sub` 现用法 |
| 正文 | 14/22 | `page` `app.wxss:77-78` |
| 导语 | 15/24 | `.lede` `app.wxss:130` |
| 图文段落 | 16/1.8 | `activity.wxss:32-38` |
| 信息卡标签 / 值 | 12/18 muted；16/22/600 ink | 现有 `--text-caption` / `--text-input` |
| 指标值 / 单位 / 标签 | 26/1.3/600；12；12/18 | `.metric-value` 等 `app.wxss:484-493` |
| 底部主按钮 | 16/600，高 48 | `.button` / `--action-height` |

**不新增字号**。`15px` 与 `20px` 都不是 token 化字阶，前者是既有 `.lede`，后者是 `.list-head__title` 的既有值；章节标题直接复用该类，不在组件里另写一份 20px。

### 4.3 组件内样式

- 新组件一律 `options: { styleIsolation: 'apply-shared' }`（引用全局类的前提；见 `ourtrail-ui` 规则 1）。
- 组件 WXSS 只放**布局与微调**；颜色全部 `var(--token)`，不写字面量。
- 页面 WXSS 不反向给组件内部写选择器；需要页面级定位的（全宽、叠压）放在页面包装上。
- `id` 锚点留在页面级包装（`#sec-*`、`#meeting-block`），不放组件内部，保证现有 `pageScrollTo`/`scroll-into-view` 路径不变。

---

## 5. 色彩角色

只使用 `app.wxss:4-81` 已登记的值：

| 角色 | token | 用途 |
|---|---|---|
| 主行动 / 品牌 | `--forest` | 主按钮、地图轨迹、章节强调 |
| 嫩叶 | `--leaf` / `--leaf-on-forest` | 仅 hero 徽标、精选卡、协作入口 |
| 纸面 | `--paper` | 页面底 |
| 卡片 | `--surface` / `--white` | 信息卡、正文卡 |
| 分隔 | `--line` / `--stone-line` | 发丝线，不用阴影 |
| 次要文字 | `--muted` | 标签、说明 |
| Hero 反白 | `--white` / `--on-forest-muted` / `--on-forest-line` | 标题、路线、分隔 |
| 状态 | `--success` / `--warning` / `--danger` / `--info` 及其 soft | callout / 风险 |
| 遮罩 | `--scrim-hero` / `--scrim-top` | 封面压暗 |

**禁止**：新增色值、`color-mix()`、`:root`、`100dvh`、组件内色值字面量。装备图标颜色走 `icon` 组件的 `color` 属性，传 `--forest` 对应的 `#163E35` 字面量（icon 组件是 canvas/SVG 字符串，不能吃 `var()`；这是平台例外，已有先例）。

---

## 6. 状态矩阵

### 6.1 页面态

| 状态 | Hero / 信息卡 | 章节 | 底部操作 | 分享 |
|---|---|---|---|---|
| loading | 不渲染 | 不渲染 | 不渲染 | 小程序默认菜单（页面未就绪） |
| denied | 不渲染 | 不渲染 | 不渲染 | 默认 |
| 草稿（owner） | Hero + 信息卡 + 草稿提示 | 无天气/事实；其余可预览 | 主：返回编辑与发布 | **隐藏**（`activity.js:525-527`） |
| 已发布 · 参与者未报名 | Hero + 信息卡 + 状态 callout | 全部 | 主：填写报名资料；次：分享 | 允许 |
| 已发布 · 参与者已确认 | 同上 | 全部 | 主：按 `journey` 的下一步（签到/同行状态/返程） | 允许 |
| 已发布 · owner | 同上 | 全部 | 主：进入工作台；次：分享 | 允许 |
| justPublished（owner） | 发布成功卡置顶 | 全部 | **不显示 sticky**；成功卡内的分享是唯一 primary | 允许 |
| busy | 不变 | 不变 | 所有**写操作**主/次按钮 disabled（`.disabled` + `bindtap=""` + handler 守卫）；分享不写数据，**保持可点** | 允许 |

### 6.2 组件态

| 组件 | 态 | 行为 |
|---|---|---|
| `activity-hero` | 实拍封面 | 图片 + 遮罩 + 标题 |
| | 氛围图 | 同一布局；脚注改口（不在组件内，页面渲染） |
| | 加载失败 | `img-failed` 隐藏图片，媒体盒高度保留，森林底；标题仍可读 |
| | 长标题（100 字） | 不截断，hero 向下生长；不遮挡顶部徽标/日期 |
| | 缺路线/领队 | 对应行不渲染，不留空行 |
| `fact-grid` | 有 1–4 项 | 2 列；最后一项奇数时占满整行（或按视觉基线决定留白，不能出现半个空卡） |
| | 0 项 | 整体不渲染 |
| | 长值（时间范围/多上车点） | 值换行，不撑破卡片；标签不换行 |
| `chapter` | 有副说明 / 无副说明 | 副说明条件渲染 |
| | 无编号（S4 的未编号块） | 只渲染 kicker + title |
| `equipment-grid` | 必带/建议都空 | 显示「组织者未填写装备清单。」（逐字保留） |
| | 有未知词条 | 用通用背包图标；文字完整显示 |
| | 超长词条 | 文字换行，图标不被挤压 |
| sticky | busy / disabled | 样式禁用、点击无 handler、handler 内守卫三层一致 |

---

## 7. 内容模型（不碰 schema）

| 目标 | 字段 / 派生 | 现有位置 | 是否新增数据 |
|---|---|---|---|
| Hero 标题/路线/领队 | `title` / `routeSnapshot.title` / `leader` | `activity.js:454-470`、`:496` | 否 |
| 封面三态 | `coverFileId` / `covers.coverFor` / `coverFailed` | `activity.js:425-426`、`:249-259` | 否 |
| 信息卡时间 | 值＝`F.dtLabel(startAt)`；副行＝`至 <end> · 截止 <deadline>`（缺项各自省略）。原 `factTime` 的整段 23 字在 111px 格里会折 4 行 | `activity.js:359-363`、`:427` | 否（替换 `factTime`） |
| 信息卡集合 | 首个上车点 + 时间 + 「等 N 个」 | `activity.js:428-431` | 否（现为 `factPickup`） |
| 信息卡人数 | `confirmed / capacity` + `minParticipants` | `activity.js:432`、`:470-471` | 否 |
| 信息卡强度 | `F.difficultyLabel(routeSnapshot.difficulty)` | `activity.js:468` | 否 |
| 里程/爬升 | `routeSnapshot.distanceKm/ascentM` | `activity.js:466-467` | 否 |
| 最高海拔 | `route-profile.elevationRange()` | 新增派生 | **否**（读现有 track/points） |
| 预计用时 | `route-schedule.durationBetween(startAt,endAt)`（分钟）→ 指标 `value/unit/sub` | 新增派生 | **否** |
| 行程时间轴 | `points`（含 `scheduleLabel`） | `activity.js:364-380` | 否 |
| 装备图标 | `equipment` / `equipmentSuggested` + 关键词映射 | `schema.js:188-190` | **否** |
| 费用 | `feeSummary/feeIncludes/feeExcludes/feeNote/cancellationNote` | `activity.js:491` 等 | 否 |
| 照片诚实性 | `coverIsReal` / `hasContentImages` | `activity.js:425`、`:385` | 否 |
| CTA | `journey` 投影 | `activity.js:439-445` | 否 |

**约束**：`domain → projection → label` 单向。页面不再从中文文案反推状态；装备图标映射只做「词 → 图标名」，不做业务判断；最高海拔/用时只在页面派生，不写回 domain。

---

## 8. 平台约束

1. **原生导航**：S1/S2 保留 `activity.json` 的原生导航标题「活动详情」。设计图把返回/分享叠在封面上，需要 `navigationStyle: custom` + 状态栏安全区 + 胶囊避让，属 S3 裁决；未裁决前不实现。
2. **非 tab 页**：活动详情不在 tabBar 中，sticky 用 `.page.has-sticky` 的 120px 底部留白（`app.wxss:89`），不套 tab 页的 `calc(32px + 84px + env(...))` 规则。
3. **sticky 与 overlay**：`.sticky-action` `z-index: 50`（`app.wxss:247-262`），`overlay` `z-index: 200`（`overlay.wxss:7`），弹层必须盖住底栏。sticky 必须带 `padding-bottom: calc(12px + env(safe-area-inset-bottom))`（沿用全局类）。
4. **地图**：原生 `<map>` 在 sticky 下方；地图区域不要被底栏遮住关键操作；地图 marker 点击保持现有 `onMapMarkerTap`。
5. **分享**：草稿 `wx.hideShareMenu` 必须在，发布后恢复；`open-type="share"` 按钮的可见性按状态矩阵。分享卡 `imageUrl` 只允许实拍封面（`prepareShareImage`，`activity.js:262-272`），氛围图不冒充实拍。
6. **锚点**：`sectionNav` 只跳转，不隐藏内容；`pageScrollTo` 的 selector 必须命中页面级 `id`。
7. **图片失败**：保留现有两条 `binderror` 路径（实拍 / 氛围图分开），不要把两个 `image` 合成一个 `src` 切换；旧请求的 error 会在回退后到达。
8. **长文本**：活动标题 100 字、正文块任意长、装备词条任意长；所有新增容器必须有 `min-width: 0` / `overflow-wrap: anywhere` 的考虑，禁止横向滚动。
9. **无障碍**：图标不是唯一信号（装备必须带文字）；主操作 ≥48px；正文对比度 ≥4.5:1（`--muted` 在 `--paper` 上约 4.9:1，见 `app.wxss:7-11`）。
10. **性能**：不新增网络请求；`elevationRange` 只做一次采样，不重复构建 SVG；hero 图片保持单张；章节组件不引入额外 setData。

---

## 9. 红线（设计图不能照抄的部分）

| 设计图项 | 裁决 | 原因 |
|---|---|---|
| ¥298/人、价格主视觉 | **拒绝** | OurTrail 零金额、纯工具，不收款/不处理支付退款；费用区只能做说明与 AA 约定 |
| 收藏图标 | **拒绝** | 没有收藏数据模型与入口；新增属 L5 产品变更 |
| 自定义导航 | **暂缓** | 平台硬约束（安全区/胶囊），必须真机验证；S3 单独裁决 |
| 四姑娘山实拍 | **拒绝冒充** | 仓库没有该素材；继续用 `covers.js` 氛围图并保留诚实脚注 |
| 「立即报名」固定文案 | **拒绝** | CTA 必须由 `journey.js` 的状态决定；不同状态显示不同下一步 |
| 大标题压图 | **采用，但不截断** | 采用叠标题构图；100 字标题必须完整可读，不能 ellipsis |
| 底部固定报名栏 | **采用，但按状态矩阵** | 只在状态允许时出现；不制造第二个 primary |

---

## 10. 验收 DoD

### 10.1 结构 DoD（E1/E2）

- [ ] `activity-hero` / `fact-grid` / `chapter` / `equipment-grid` 四个组件存在并被活动页注册；`check.js` 双向注册通过。
- [ ] Hero 标题在封面构图内；100 字标题不被截断（DOM 文本等于源标题，几何上不溢出横向）。
- [ ] 信息卡 2×2 渲染时间/集合/人数/强度；缺失项不占格；旧的事实区重复行已删除。
- [ ] 路线指标条显示里程/爬升/最高海拔/用时（有值才显示）；无高程/无结束时间有明确说明，不印 0。
- [ ] 节点时间轴只出现一次（行程章节），路线章节不再重复。
- [ ] 装备区每个词条都有文字 + 图标；未知词条有通用图标；空态文案逐字保留。
- [ ] 照片诚实性脚注全页只出现一次，位置在 hero 之后。
- [ ] 底部 sticky 在 `justPublished` 不出现；其余状态按矩阵出现，页尾留白 120px。
- [ ] `sectionNav` 的 id 与模板可见章节逐条同源；`secNo` 不跳号。

### 10.2 视觉 DoD（E3）

- [ ] 306×660：hero 标题、信息卡、指标条、章节标题、sticky 均不截断/不叠压；信息卡上浮不遮标题。
- [ ] 306×660：`4,660 m` 等四位数指标不溢出；2×2 布局可读。
- [ ] 390×844（**只有实际跑过才勾**）：同一组读数；未跑记 UNVERIFIED，不写「通过」。
- [ ] 封面失败：无破图，媒体盒高度保留，标题可读。
- [ ] 长标题/长装备词条：换行正确，无横向滚动。
- [ ] 对比度：hero 反白文字、muted 说明、按钮文字均达 4.5:1（人工核对 + 证据记录）。

### 10.3 交互 DoD（E3/E4）

- [ ] 每个状态的真实 tap：主 CTA 的后果（跳转/弹层/禁用）符合状态矩阵；busy 期间重复 tap 无效。
- [ ] 分享按钮在草稿隐藏、发布后出现；`justPublished` 只有一个 primary 分享。
- [ ] 分区锚点真实滚动到目标章节；不隐藏内容。
- [ ] 地图 marker/导航、剖面、装备、费用入口可点（沿用现有 handler）。
- [ ] 证据分档：E1 源码/静态门、E2 运行时读数、E3 真机截图、E4 用户验收；INCONCLUSIVE 不算 PASS。

### 10.4 门禁

- [ ] `node tools/check.js`、`node tools/check-handlers.js`。
- [ ] `tools/scenario-activity-test.js` 增加结构断言；`tools/route-profile-test.js` 增加 `elevationRange`；`tools/route-schedule-test.js` 增加 `durationBetween`；新增 `tools/equipment-icons-test.js`。
- [ ] `tools/t4-e08-test.js`（组件 options / 具名 slot / 全局类作用域）、`tools/b4-pad-final-value-test.js`（非 tab 页 sticky 留白）、`tools/journey-graph-test.js`。
- [ ] 已知先于本轮存在的红（如 `m02-class-scope-test.js` 的 privacy `.section-title`）不混入本轮验收；实施前在基线里复跑并记录，不抄历史计数。
