# style-B 共用层设计规格（Gate G0）

- 日期：2026-10-26
- 状态：**设计提案，待批准**。本文件不含代码改动；批准前不动 `miniprogram/`。
- 上游：`docs/ui-ux-redesign/style-b-fidelity-matrix-2026-10-26.md`（差距证据）· `style-b-implementation-taskbook-2026-10-26.md`（切片与验收）· `docs/ui-ux-redesign/reference/global-prototype-2026-10-20.jpg` 与 `reference/screens-2026-10-20/`
- 权威：逐屏保真以**仓库里的 10-20 板**为准（用户 2026-10-26 裁决）。本文件只在“板与本仓库既有硬约束冲突”的地方登记偏离，不重新讨论权威。

---

## 0. 口径与方法

### 0.1 证据档

板上读数全部是 **E2**：图由用户提供，但 bundle、注入数据、设备三项均未证。因此：

- 只给**区间与中位数**，不给“精确到 1px”的结论。
- 换算：板 1024×1536，单屏截图宽约 151 板 px；按逻辑宽 390 计，1 板 px ≈ 2.58 逻辑 px，3× 裁切图 1 px ≈ 0.86 逻辑 px。
- 测量手段：行列亮度跃迁 / 墨带（ink band）/ 比例；JPEG 噪声约 ±2–3 逻辑 px，人眼判读再叠加 ±2 px ⇒ **容差 ±3–5 逻辑 px**。
- 板上 8 屏并非同一张设计文件导出：纸面亮度在 4–10 RGB 内浮动，个别标题字号相差 1–2 px。**这是生成图的内部不一致，不当作设计意图**；跨屏取波段，不逐屏取点。

### 0.2 这份文档裁决什么

1. 板上量到的**间距 / 尺寸 / 卡片形态**如何映射到现有 token（不新增 token）。
2. 8 个 L2 组件的契约与状态，供各切片并行实施时只读不改。
3. 8 个有板参考的页面，首屏的**结构块顺序**（这就是验收单元）。
4. 共用层会触发哪些门禁、哪些必须保持绿、哪些需要有意重钉。
5. 板与仓库冲突处的默认裁决（C12–C21）。

### 0.3 不裁决什么

- 不改 `cloudfunctions/`、schema、`domain/`、`utils/journey.js`、天气阈值、`--chart-ramp`。
- 不改 tabBar 的四个页面（home / weather-hub / notices / me）。板上第 2、3 个 tab 图标是同一枚占位方块、文字不可读，**不能据此推断信息架构**。
- 不引入金额、收藏、分类字段、中央 FAB、团队/个人任务域。
- 不把板的暖纸色与 webfont 搬进来（C12）。

---

## 1. 板上读数 → 现有 token 映射

### 1.1 结论先行

- **新增 token：0。**
- **新增全局类：1**（`.sheet-top`，只用既有 `--surface` / `--radius-sheet`）。
- **改值的既有类：5**（`.stack-sections`、`.person-row`、`.avatar`、`.list-row`、`.searchbar`）。
- **改值的组件样式：3**（`activity-card`、`activity-hero`、`fact-grid`）+ 2 个组件契约扩展（`brand-header.variant`、`activity-card.flat`）+ 1 个组件重做（`next-up-card` 图片 hero）。

差距的主因不是“少组件”，而是**纵向呼吸不足 + 卡片形态太扁**：章节 28→40、人员/列表行 +12~16、头图 148/240→240/320。颜色和字阶基本已经在位。

### 1.2 间距与尺寸

| 项目 | 板上读数 @390（E2） | 现值与出处 | 决定 | 落点 |
|---|---|---|---|---|
| 页面左右内边距 | 18–33，中位 25 | 20（`app.wxss:85`） | **保持 20**：在容差带内，且 `b4-pad-final-value-test.js:546` 钉住 `.page` 终值 | 不改 |
| 章节间距（区与区） | 40–48 | 28（`app.wxss:111`） | **40** | `.stack-sections` |
| 卡片内边距 | 16–20 | 16（`app.wxss:136`） | 保持 16 | 不改 |
| 卡片圆角 | 不可测（JPEG 边缘） | 14 / 20 / 8 / 5（`app.wxss:67-70`） | 保持 | 不改 |
| 人员行节距 | 88–96 | 72（16×2 + 40，`app.wxss:557` + `:566`） | **84**：padding 18 + 头像 44 + `min-height:84` | `.person-row` / `.avatar` |
| 列表行节距 | 76–84 | 72–80（`app.wxss:588`） | **padding 18**（两行内容时终值 76–84） | `.list-row` |
| 事实网格行距 | 60–70 | 16（`fact-grid.wxss:54`） | **20** | `fact-grid.wxss` |
| 搜索条高度 | 44–48 | 36（`app.wxss:730`） | **44 = `var(--touch-target)`** | `.searchbar` |
| 搜索条圆角 | 全圆 | 8（`app.wxss:732`） | **999px**（与 `.chip` 同形，`app.wxss:608`） | `.searchbar` |
| 首页头图 | 300–330 | 无（当前是文字卡） | **min-height 320** | `next-up-card` |
| 活动 hero | 300–340 | 240（`app.wxss:367`） | **320，仅 `activity-hero` 本地覆盖**；全局 `.hero-cover-media` 不动（路线详情等共用） | `activity-hero.wxss` |
| featured 封面 | 216–245 | 148（`activity-card.wxss:16`） | **240** | `activity-card.wxss` |
| plain 封面 | 180–210 | 168（`activity-card.wxss:50`） | **200** | `activity-card.wxss` |
| compact 缩略图 | 80–88 | 80（`activity-card.wxss:67`） | **保持 80**：`entry-layout-test.js:54` 明确钉住 | 不改 |
| Tab 页底部留白 | — | `calc(32px + 84px + env(...))` 各页载体 | 保持（B4 规则） | 不改 |

### 1.3 字阶与触控

| 项目 | 板上读数 | 现值 | 决定 |
|---|---|---|---|
| 主标题（hero / display） | 30–32 | 30（`app.wxss:123`） | 保持 30 |
| 列表/区块标题 | 20–22 | 20（`app.wxss:150`） | 保持 20 |
| 正文 | 14–15 | 14（`--text-body`，`app.wxss:63`） | 保持 14；hero 标题内文可用 15 |
| 说明/副行 | 12 | 12（`--text-caption`，`app.wxss:62`） | 保持 |
| 眉题 | 11 | 11（`app.wxss:115`） | 保持 |
| 触控目标 / 主操作高 | 44 / 48 | `--touch-target` / `--action-height`（`app.wxss:71-72`） | 保持 |

### 1.4 需要新增的（唯一落点）

| 新增项 | 类型 | 为什么不能复用 | 落点 | 消费方 |
|---|---|---|---|---|
| `.sheet-top` | 全局类（非 token） | 首页与活动详情都需要“白面从沉浸头图下沿盖上来”：`background:var(--surface); border-radius:var(--radius-sheet) var(--radius-sheet) 0 0; margin:-20px -20px 0; padding:20px 20px 0`。页面内各写一份就是第二个真值源 | `miniprogram/app.wxss`，紧接 `.card` 块之后（`:140` 后） | home（Slice 1）、activity（Slice 2） |

**没有需要新增的 token。** 如果实施中发现某个值确实无 token 可用，按铁律 17 先停手、在本文件补一行并交裁决，不许在组件里发明色值。

### 1.5 明确不照搬的板上元素

| 板上元素 | 不照搬的原因 | 归入 |
|---|---|---|
| 暖米纸面 / 大面积米色分区 | 全仓冷白纸 `#F5F5F0`（`app.wxss:7-12` 有迁移说明），换色是 token 迁移，不是本轮 | C12 |
| 展示型无衬线 webfont | 小程序不引外部字体；系统字体栈已是唯一实现 | C12 |
| 价格（¥680 / ¥200）、剩余名额营销位 | 零金额产品定位；板上是模板混入 | C3（既有） |
| 首页分类筛选（徒步/露营/登山/日期） | 无分类字段，不能在前端伪造 | C19 |
| 活动/工作台顶部自绘返回键 | 下钻页保留原生导航（D2）；板上的自绘栏是另一套导航模型 | C20 |
| 行程节点实拍图 | `Activity`/路线节点无图片字段 | C21 |
| 装备页（02-5）的“必选/建议”分页 + 勾选清单 | 该屏导航题名是「装备清单」，与活动详情章节不是同一载体；映射未证实，不据此改 `equipment-grid` | C14（修订） |
| 路线概览四宫格图标 | 需要给 `fact-grid` 增第三形态与图标数据契约；先做结构，图标留作后续 | C18 |

---

## 2. 八个 L2 组件契约

### 2.0 所有组件共同遵守

- 每个 `Component()` **只有一个 `options` 键**，且全局类引用者必须 `styleIsolation:'apply-shared'`。
- 只用 `app.wxss` 的 token 与全局类；组件内不出现新色值、不出现 `var(--x, #fallback)` 之外的字面色。图标 `color` 属性例外（拿不到 `var()`），沿用 `#FFFFFF` / `#163E35` 的字面量并注明来源。
- 组件只负责**画**与**回抛事件**；状态词、计数、可见性、权限一律由页面/`journey.js` 决定。
- 缺数据不是零：空数组要出空态/隐藏，不印“0”。
- 结构变化必须同批跑 `node tools/check.js`、`node tools/check-handlers.js`，并更新消费页的证据包。

### 2.1 `brand-header`

- 文件：`miniprogram/components/brand-header/brand-header.{js,wxml,wxss}`；布局来源 `utils/header-layout.js`。
- **props**：`title: String = ''`；**新增** `variant: 'solid' | 'overlay' = 'solid'`。
- 结构：`root → spacer（占位）+ bar（fixed/absolute 二选一）→ icon(trailMark) + “OurTrail” +（有 title 时）· + title`。
- 状态：
  - `solid`（默认）：固定纸面条，`--paper` 底 + `--line` 下边；spacer 高度 = 实测栏高。现有 home/notices/weather-hub 行为不变。
  - `overlay`：`position:absolute`（**不 fixed**，随头图滚走），透明底、无下边框，spacer 高度 0，词标与 title 用 `--white` / `--on-forest-muted`。宿主页必须自己保证首块是全出血头图，并让内容从 y=0 开始。
- 尺寸：栏高、右侧避让全部来自 `header-layout.layoutFor`；`padding-left:20`；词标 16/22/700；title 14/22/600。
- 不变式：只用于一级 tab 页（D2）；overlay 不占文档流；不接管状态栏颜色；不读页面数据。
- 门：`tools/entry-layout-test.js:61-64`（home 必须 custom nav + 注册）；`nav-chrome` 只看页面 JSON，不看本组件。
- 页面边界：页面只传 `title` / `variant`，不传颜色、高度、避让值。

### 2.2 `chapter`

- 文件：`miniprogram/components/chapter/*`。
- **props 冻结**：`no / kicker / title / sub / gap(Number, 12)`。`activity-l2-structure-test.js:219-221` 按精确键集钉住，**本轮不改**。
- 结构：`.section-head`（编号+kicker 同行 → `.list-head__title` → `.section-sub`）+ `.chapter__body`（`margin-top:{{gap}}px` + slot）。
- 状态：四项全空时只出 slot（不印空标题）；编号为空不插点。
- 尺寸：标题 20/28/600；kicker 11/16/600/1.2；sub 12/18；正文间距由页面 `gap` 给（活动天气章节 8，其余 12）。
- 门：`activity-l2-structure-test.js:204-246`（9 个 chapter / 8 个编号 / 属性精确 / 标题类复用）。

### 2.3 `fact-grid`

- 文件：`miniprogram/components/fact-grid/*`。
- **props**：`items: Array`；`variant: 'card' | 'stats'`。
- `items[]`：`{ key, label, value, unit, sub }`。空串 / `null` / `undefined` 不占格；数值 `0` 保留；奇数个末项通栏。
- 结构：两列 flex（`calc(50% - 6px)`，仓库无 `display:grid` 约定）；`card` 形态每格带标签/值；`stats` 形态 26px 森林绿数值。
- **本轮唯一改动**：`row-gap 16 → 20`（`fact-grid.wxss:54`）。
- 状态：`items` 为空时整块不渲染（页面负责给出处，不在这里印“暂无”）。
- 不变式：只排版，不格式化、不排序、不去重；值从页面来。
- 门：`activity-l2-structure-test.js:150-171`（过滤/0/奇数通栏/两列 calc/无 grid）。
- **本轮不增 `icon` 字段/第三形态**（C18）。

### 2.4 `activity-card`

- 文件：`miniprogram/components/activity-card/*`。
- **props**：`title / date / when / featured / compact / collab / cover / activityId / routeName / chips / people / pending / roleNote / badge`；**新增** `flat: Boolean = false`。
- 形态：
  - `featured`：240px 封面 + 压底标题（22/1.35）+ 三槽正文；无缩略图。
  - `plain`：200px 封面 + 标题 18/24 + 三槽。
  - `compact`：80px 缩略图 + 标题列 + 三槽（`entry-layout-test.js:54` 钉住 80）。
  - `flat`：**只给 discover**——去白卡底/边框/圆角，改为纸面上的行：`padding:12px 0; border-bottom:1px solid var(--line); border-radius:0`；其余形态不变。
- 状态：封面失败两步回退（实拍→氛围图→森林绿纯色，`activity-card.js:54-72`）；无封面按 `activityId` 稳定取图（`utils/covers.coverFor`，`covers.js:32`）；长标题换行不截断（禁止 ellipsis / line-clamp）；chips 单行不换行、超出按优先级截断（`utils/card-view`）。
- 不变式：日期/状态在媒体之外（`entry-layout-test.js:46-54`）；协作入口 `catchtap`；组件内不做权限或状态判断；不出现新色值。
- 门：`entry-layout-test.js:46-58`、`:82`；`a20-owner-hero` 按字节比对页面传入的 cards 数组（**不要在组件里改传参对象**）。

### 2.5 `next-up-card`（重做）

- 文件：`miniprogram/components/next-up-card/*`。
- **props 不变**：`empty / activityId / title / facts`。页面契约（`bind:open` / `bind:create` / `data-id="{{nextUp.id}}"`）保持，`entry-layout-test.js:65-69` 依赖它。
- 新结构（有活动）：
  - 图片 hero：`min-height:320px`，封面按 `activityId` 用 `covers.coverFor` 派生（与活动卡同源），`aspectFill`。
  - 压底：`--scrim-hero`；左上 kicker「下一次同行」（11/16/600/1.2，`--on-forest-muted`）；底部标题（30/1.28/700，白）+ 一行 facts（12/18）。整卡可点，卡内**无**实心按钮。
  - 封面失败：回退氛围图；再失败转 `--forest-deep` 纯色，文字全保留。
  - 长标题：底部对齐、卡片随内容增高（`min-height`，不固定 `height`），**不裁字**。
- 空态（`empty`）：保留现有白卡 + 细线 + 升 primary「发起活动」的形态；同屏只有这一个主按钮。
- 不变式：零新域字段、零额外请求；封面派生留在组件内（与 `activity-card` 同一条理由：cards 投影按字节被门比对）。
- 门：`entry-layout-test.js:65-69`；`journey-graph` 只看可达性。

### 2.6 `activity-hero`

- 文件：`miniprogram/components/activity-hero/*`。
- **props 冻结**（`activity-l2-structure-test.js:193-196` 精确键集）：`title / routeTitle / leader / badgeText / startAtLabel / cover / coverIsReal / coverFailed`。**不新增 `variant` / `size`**；森林绿兜底已经由 `coverFailed` + `.hero-cover` 底色承担。
- 结构：`.hero-cover` 全出血（页面 `activity.wxss` 的 `.activity-hero-bleed { margin:0 -20px }`）→ 媒体盒（**本地覆盖 320px**）→ scrim → 顶部 badge + 日期 → body（`margin-top:-72px`，标题 30，路线/领队 14）。
- 状态：实拍封面 / 氛围图兜底 / 双失败（纯色）；两条 `binderror` 分开（`:176-183`）。
- 不变式：正文叠进照片下沿，但不遮日期；标题换行不裁；不在组件里选封面。
- 门：`activity-l2-structure-test.js:140`（bleed）、`:172-197`（两个错误事件、属性键集）。

### 2.7 `route-profile`

- 文件：`miniprogram/components/route-profile/*`；数据来源 `utils/route-profile.js`。
- **props 冻结**：`track / points / title`。
- 结构：标题行（可选）+ SVG 剖面（data URI）+ 距离/范围读数；空态按原因给一句实话（无高程 / 无坐标 / 点不足）。
- 尺寸：SVG 圆角 8；读数 12/18；空态 14/22。
- 状态：`empty` 必须说明“为什么画不出 + 补什么能画”，不印空图框。
- 本轮不改；板上 02-3 的“海拔剖面”是独立路线页的形态，不作为活动章节的改造依据。

### 2.8 `equipment-grid`

- 文件：`miniprogram/components/equipment-grid/*`；分类 `utils/equipment-icons.js`。
- **props 冻结**：`required / suggested`（`activity-l2-structure-test.js:311` 精确键集）。
- 结构：两组四列（`25% - 6px`）、32px 图标砖、12/16 文本；空数组整组不渲染。
- 本轮不改。**修订 C14**：02-5 的导航题名是「装备清单」且带独立报名按钮，与活动详情章节不是同一载体；在没有确认它对应哪一页之前，不把“分页 + 勾选清单”套到 `equipment-grid` 上。

---

## 3. 八个页面首屏文字线框

标记：`▣` 组件 · `⟂` 全出血 · `⌁` 页面级间距。数字为逻辑 px。

### 3.1 home（Slice 1）

主任务：**今天要不要出发、去哪场**。首屏只回答这一件事。

```
[0] status-panel denied / loading（占满内容区）
[1] .home-hero  ⟂  min-height 320，padding-top 0
    ├ brand-header variant=overlay（词标 16 / 白，不占位）
    ├ next-up-card  320 图 hero（kicker 11 · title 30 · facts 12）
    └ 空态：forest 块 + 「发起活动」primary
[2] .sheet-top  margin-top -20，上圆角 20
    ├ searchbar 44 pill
    ├ home-actions 48（发起 primary：wx:if=nextUp；发现 secondary）
    ├ segmented.tabs-line ×4（我组织/最近/已结束/协作）44
    ├ 区块头「推荐活动」20/28 + 12 副行
    └ activity-card 列表（1 个 wx:for=cards）
[3] 列表：首张 featured（封面 240），其余 compact（缩略图 80）
[4] custom-tab-bar
```

- C16：`cards` 在 JS 侧先剔除 `nextUp.id`，再算 `featuredId`；避免同一活动在 hero 与列表各出现一次。
- 空态：hero 变成邀请卡，`home-actions` 的 primary 同步消失（`entry-layout-test.js:72-76` 的既有契约）。
- 不新增分类筛选（C19）。

### 3.2 discover（Slice 1）

主任务：**在已发布活动里筛出可去的**。

```
[0] 原生导航「全部活动」
[1] searchbar 44 pill
[2] segmented views 44（保留现有视图切换）
[3] discover-toolbar：筛选 chips（目的地/难度/日期）+ 视图 + 结果数
[4] discover-note 12/18（完整原话，不缩成 callout）
[5] activity-card flat + compact ×N（缩略图 80，行底发丝线）
[6] map-card 260
[7] overlay kind=sheet（筛选；全高近似 01-4 的视觉，但仍是 sheet，不新增路由）
```

- 同屏最多 2 个 `activity-card` 节点：列表 1 + 地图选中卡 1（`entry-layout-test.js:82`）。
- flat 只改表面，不动数据与事件。
- 价格、剩余名额营销位不实现（C3）。

### 3.3 activity（Slice 2）

主任务：**这场活动值不值得去、我该做什么**。

```
[0] 原生导航（返回；不做板上自绘返回键，C20）
[1] .activity-hero-bleed ⟂
    └ activity-hero：媒体 320 + scrim + badge/日期 + 标题 30 + 路线/领队
[2] .sheet-top  margin-top -20
    ├ fact-grid variant=card（难度/距离/爬升/天数……页面已有 infoFacts）
    └ state callout（现在怎样 + 下一步）
[3] 吸顶锚点（segmented.tabs-line 外观，非真 tab；D6）
[4] .stack-sections（40）
    ├ intro 01 · peers 02 · itinerary 03 · weather 04（gap 8）
    ├ route 05（stats + map + route-profile）
    ├ safety 06 · equipment 07 · fee 08 · signup 09
    └ 页尾两行（通知 / 任务）
[5] sticky-action（报名/审核 + 分享；has-sticky 120 底留白）
```

- 章节顺序与 9 个 chapter 不动（`activity-l2-structure-test.js:248-268`）。
- 板上行程节点实拍图不实现（C21）；装备章节保持四列图标网格（C14 修订）。
- 天气章节的卡片顺序归 Slice 4，不在这里改。

### 3.4 workspace（Slice 3a）

主任务：**这场活动现在卡在哪、我要做什么**。

```
[0] 原生导航「活动协作」
[1] identity hero：森林绿块（从导航下开始）
    ├ 活动标题（20/28）+ 日期/人数一行
    └ 右上/下方一个轻量入口（不加第二个 primary）
[2] .sheet-top（上圆角 20，盖住 hero 下沿 20）
    ├ segmented.tabs-line ×4：总览/名单/分车/现场（标签不改，E2E 依赖）
    ├ metric strip 4 格（12/18 标签 + 26 数值）——C17 保留
    ├ tab0：出发前检查队列（行：图标 20 + 标题 16 + 计数 12 + 右侧状态）
    ├ milestone
    ├ 4 个工具白卡（2×2）
    └ phase timeline
[3] tab 页底留白
```

- 不把 metric 移进 hero（会动 `operations-layout` 的固定顺序，且丢掉一眼可见的总量）；改为**去卡片的紧凑条**，视觉上让位给检查队列。
- 主按钮仍在 header 内、`wx:if="{{canManage}}"`（`operations-layout-test.js:188` 钉住）。

### 3.5 名单 / 交通（Slice 3b，工作台内面板）

```
名单
[0] 汇总卡：已报名 10 人 / 待确认 3 人（两格）
[1] searchbar 44 pill
[2] person-row ×N：头像 44 · 姓名 16/600 · 副行 12 · 右侧状态 chip
    padding 18 + min-height 84，行底发丝线（不是嵌套卡片）
[3] 批量操作条（勾选后出现；不新增 primary）

交通
[0] metric band：车辆 / 剩余座位 /（既有第三项）
[1] 车辆卡：缩略图 + 车牌 + 司机 + 座位占用
[2] seat-grid（4 座 + 过道；既有）
[3] 添加车辆 primary（同屏唯一）
```

- C15：保留 3 个指标与座位图；板上只画了 2 个指标，但座位图是分车的唯一操作面。
- `person-row__body { min-width:0 }` 不动（`swx1-style-gates-test.js:388-390`）。

### 3.6 tasks（Slice 3c）

主任务：**谁负责哪件事，现在到哪一步**。

```
[0] 原生导航「任务清单」
[1] identity：eyebrow + 活动名；标题 20/28；**不再放 primary**
[2] segmented.tabs-line（保留现有状态筛选；不改成板上“个人/团队”，C6）
[3] task-row：状态点 + 标题 16/600 + 状态 badge + 负责人 12 + 截止 12
    padding 18、行底发丝线；行内次级动作在展开区
[4] empty / error / message
[5] sticky footer：新建任务 primary 48（wx:if=canManage）+ 安全区
    page 挂 .has-sticky（120 底留白）
```

- 主按钮从顶部移到底部：板上唯一明确的主操作位置；`e2e-task` 按文案点击，不按位置。
- 板上“全部/个人/团队”依赖任务归属域，V1 没有该字段（C6）。

### 3.7 notices / anotices（Slice 3c）

`notices`（tab，无板）：只吃共用层节奏。

```
[0] brand-header solid
[1] 区块头（20/28）+ 副行
[2] 通知行：标题 16/600 + 时间 12 + 一行摘要；未读用左侧 2px 森林线（不加色块）
[3] 空态 status-panel
```

`anotices`（板上 03-5「现场通知」）：

```
[0] 原生导航「现场通知」
[1] 消息流（不再是白卡堆叠）：
    ├ person-row 头：头像 44 + 姓名 16/600 + 时间 12
    ├ 正文 15/24
    ├ 可选图片（圆角 8，占满内容宽）
    └ 文本动作（「查看天气」）——不是实心按钮
[2] 组织者发布区（现有 composer，原样保留在流下方）
[3] 空态 / 错误
```

- 去掉页内口号「重要安排，不错过。」（板上无此句；导航题名已承担身份）。该句无门禁钉住。

### 3.8 weather / weather-hub（Slice 4）

`weather`（板 04-2 / 04-4 是同一模块的子屏）：

```
[0] 原生导航
[1] identity：地点 + 日期（20/28），不再用口号当标题
[2] 天相结论卡（D7 的既有顺序：先结论）
[3] 统一图（chart card；375/390/414 可读）
[4] 降水概率条
[5] 详细数据 chapter（温度 / 降水 / 风速 / 云量）
[6] 陈旧横幅 / 重试（现有语义不动）
[7] 无高程 / 无坐标 / 空态：status-panel + 出路
```

- 不新造阈值，不改 `--chart-ramp`，不移动 `meteogram` 的图元契约。

`weather-hub`（tab）：

```
[0] brand-header solid
[1] 工具块：地图选点 / 手填坐标 / GPX / 已存观察点
[2] 每个块内部沿用共用层节奏；不做 04-1 的“活动出发窗口”简报（C7：那是活动上下文的屏，
    tab 页没有 activityId，硬套就要伪造上下文）
```

---

## 4. 改动面清单（只列文件与函数，不写代码）

### 4.1 Slice 0（共用层，唯一写者）

| 文件 | 动作 | 具体位置 |
|---|---|---|
| `miniprogram/app.wxss` | 改值 | `.stack-sections`（`:111`）gap 28→40 |
| 同上 | 改值 | `.person-row`（`:557`）padding 16→18、加 `min-height:84` |
| 同上 | 改值 | `.avatar`（`:566`）40→44 |
| 同上 | 改值 | `.list-row`（`:588`）padding 16→18 |
| 同上 | 改值 | `.searchbar`（`:726`）height 36→`var(--touch-target)`、radius→999px、padding 0 16、gap 8 |
| 同上 | **新增类** | `.sheet-top`（`:140` 后） |
| `components/brand-header/brand-header.js` | 加属性 | `properties.variant`（String，`solid`） |
| `components/brand-header/brand-header.wxml` | 结构 | 根/条 class 绑定 variant；overlay 时 spacer 高 0；icon color 按 variant 给 `#FFFFFF` / `#163E35`（注明 token 来源） |
| `components/brand-header/brand-header.wxss` | 新增规则 | `.brand-header--overlay` / `__bar--overlay` |
| `components/next-up-card/next-up-card.js` | 重写展示层 | `require('../../utils/covers')`；`data.coverSrc/coverFallback/coverFailed`；observer `activityId`；`onCoverError`；保留 `onOpen/onCreate` |
| `components/next-up-card/next-up-card.wxml` | 重写有活动分支 | 图 hero + scrim + kicker/title/facts；empty 分支不动 |
| `components/next-up-card/next-up-card.wxss` | 重写 | 320 min-height、压底排版、两步回退 |
| `components/activity-card/activity-card.js` | 加属性 | `properties.flat`（Boolean，false） |
| `components/activity-card/activity-card.wxml` | class 映射 | flat 类 |
| `components/activity-card/activity-card.wxss` | 改值/新增 | featured 148→240、plain 168→200；`.activity-card--flat` |
| `components/activity-hero/activity-hero.wxss` | 新增作用域规则 | `.act-hero .hero-cover-media { height:320px }`（全局 240 不动） |
| `components/fact-grid/fact-grid.wxss` | 改值 | row-gap 16→20 |
| `docs/ui-ux-redesign/design-system.md` | 登记 | 5 个类值变更 + `.sheet-top`；无新 token |
| `docs/ui-ux-redesign/evidence/style-b-slice0-2026-10-2x/` | 证据 | 静态门读数 + 组件行为套件读数 + 消费页真机 |

Slice 0 **不改任何页面、不改任何门禁、不改 `cloudfunctions/`**。

### 4.2 后续切片（规划用）

| 切片 | 页面/组件文件 | 关键函数 |
|---|---|---|
| 1 home/discover | `pages/home/home.{wxml,js,wxss}`、`pages/discover/discover.{wxml,js,wxss}` | `home.js` 的 `featuredId` / 列表派生处加 C16 去重；discover 两个 card 加 `flat` |
| 2 activity | `pages/activity/activity.{wxml,wxss}`（必要时 js 只调锚点偏移） | 不改 `buildChapters`/`secNo` |
| 3a workspace | `pages/workspace/workspace.{wxml,wxss}` | 不改 `TABS` 文案与 `tab` 逻辑 |
| 3b 名单/交通 | `components/person-row/person-row.wxss`、`components/transport-panel/*`、工作台面板 wxml | 不改投影、不改座位布局 |
| 3c tasks/notices/anotices | `pages/tasks/*`、`pages/notices/*`、`pages/anotices/*` | 仅移动 primary、去口号、改行形态 |
| 4 weather | `pages/weather/*`、`pages/weather-hub/*` | 不改 `buildCondCards`/阈值/重试语义 |
| 5a/5b/5c 其余 13 页 | 各页 wxss 为主 | 只吃共用层节奏，不改结构 |

---

## 5. 门禁风险

### 5.1 Slice 0 后必须**保持绿**（不允许改门禁）

| 套件 | 钉住的判据 | 为什么本层安全 |
|---|---|---|
| `tools/check.js` | 语法 / 标签 / 注册 / 全局类作用域（G10） | 只改值、加一个全局类；`apply-shared` 不动 |
| `tools/check-handlers.js` | WXML 事件 → JS handler | `next-up-card` 保留 `onOpen/onCreate`，新增 `onCoverError` 在模板被引用 |
| `tools/entry-layout-test.js` | compact 缩略图 80（`:54`）、首页单一 cards 列表（`:58`）、brand-header/next-up 契约（`:61-69`）、discover 两卡（`:82`） | 80 不动；props/事件/data-id 不动；`flat` 是新属性，不替换 compact/featured |
| `tools/activity-l2-structure-test.js` | hero 属性键集（`:193-196`）、chapter 键集（`:219-221`）、bleed（`:140`）、`.stack-sections` 唯一（`:250`） | 只改 hero 媒体高度；属性/结构不动；`.stack-sections` 的**值**未被钉住 |
| `tools/operations-layout-test.js` | 工作台顺序、person-row 存在（`:154`） | 本层不碰工作台；person-row 只改 padding/头像 |
| `tools/swx1-style-gates-test.js` | `.person-row__body min-width:0`（`:388-390`）、`.seg` 读 token | 未动 min-width 与 `.seg` |
| `tools/b4-pad-final-value-test.js` | `.page` padding 终值（`:546`）、tab 底留白 | 不碰 `.page`；只改 `.list-row`/`.person-row` 内边距 |
| `tools/page2-gates-test.js` / `m02-class-scope-test.js` / `t4-e08-test.js` / `ui-consistency-test.js` | 全局类解得出、slot/options 唯一、token 引用 | 新类在 `app.wxss` 定义，组件全部 apply-shared |
| `tools/journey-graph-test.js` | 页面可达、状态词单源 | 本层无状态词、无新页 |

**结论：Slice 0 不需要重钉任何门。** 如果实跑出现红，先判“是不是本层真的改了判据”，不许直接改断言。

### 5.2 后续切片中需要**有意重钉**的（with teeth）

| 切片 | 套件 | 原因 | 重钉方式 |
|---|---|---|---|
| 3a | `operations-layout` | 若把 metric strip 改为紧凑条，节点结构变化 | 断言新顺序 + `metric` 数量不变；配一条“删掉 metric 必须红”的夹具 |
| 3c | `e2e-task` | 新建任务 primary 移到底部 | 仍按文案点击；补一条“footer 存在且可点”的 UI 断言，而不是放宽 |
| 3c | 页面文本门（`journey-graph` / 文案门） | anotices 去掉口号 | 只删无判据依赖的展示句；若某门按文案定位，改判据不删文案 |
| 2 | `activity-l2-structure` | 若 stat sheet 的包裹节点改变 | 保留章节顺序与 9 个 chapter；只允许外层容器变化，并配“章节顺序反了必须红” |

### 5.3 不碰的门

`e2e-client-cas` / `lifecycle-*` / `e2e-permission` / `revision` 系列 / 天气数值系列：本层不改 domain、命令、投影、阈值，理论零影响。实跑仍要跑一遍静态门与相关页面套件，不能以“应该没影响”代替读数。

---

## 6. 默认裁决与新偏离登记

| 编号 | 裁决 | 依据 | 影响 |
|---|---|---|---|
| **C12** | 保留冷白纸与系统字体；不迁移暖纸/webfont | `app.wxss:7-12` 的迁移记录；换色是 token 工程，不是本轮 | 板与实现在色温上仍会有差异，属于**已登记偏离** |
| **C13**（修订） | 发现筛选仍是全高 sheet，不新增筛选路由 | 板 01-4 是独立页；新增页面会破坏 `journey-graph` 的页面图闭合 | sheet 内部按 01-4 的标题/分组/应用按钮重排 |
| **C14**（修订） | 不据 02-5 改造 `equipment-grid` | 02-5 导航题名「装备清单」，与活动详情章节载体不一致，映射未证实 | 装备章节保持四列图标网格；待确认页面归属后再议 |
| **C15** | 交通保留 3 个指标 + 座位图 | 座位图是分车唯一操作面；板上只画 2 指标是简化示意 | 视觉上压缩指标条，不删功能 |
| **C16** | 首页 `cards` 先剔除 `nextUp.id`，再算首张 featured | `home.js` 现状 `featuredId = filtered[0].id` 与 `nextUp` 可指向同一活动 | hero 与列表不重复；空列表时走既有空态 |
| **C17** | 工作台 metric strip 保留为紧凑条，不删 | 板上 tab0 只有检查清单，但计数是“总量”信息；删了会让用户失去一眼判断 | 去卡片化、缩到一行，让检查队列成为视觉主块 |
| **C18** | `fact-grid` 本轮不加图标列/第三形态 | 需要新数据契约与第三 variant，会牵动 `activity-l2` 的精确断言；先做结构 | 02-2 的图标四宫格留有差距，登记为后续 |
| **C19** | 首页不实现分类筛选（徒步/露营/登山） | 无分类字段，前端自造映射＝假数据 | 保留关系型四档筛选 |
| **C20** | 活动/工作台保留下钻页原生导航 | D2；自绘返回栏是另一套导航模型 | 板上“照片顶到状态栏 + 自绘返回”只在 home（tab）实现 |
| **C21** | 行程节点不配实拍图 | `Activity`/路线节点无图片字段 | 时间轴保持文字 + 时间；不拿氛围图冒充节点 |

板上其余“看起来该有”但本仓库没有数据来源的元素（价格、名额营销、团队任务、图片消息），一律按 C1–C11 的既有裁决处理，不在这里重开。

---

## 7. 批准后的执行与停止条件

1. **G0 批准** → 只做 Slice 0（§4.1）。完成后交：`check.js` / `check-handlers` 读数、受影响的 8 个套件读数、8 个组件的行为套件读数、`design-system.md` 登记 diff。
2. Slice 0 **不宣称“页面已保真”**：组件视觉要等消费页接入后在真机核验；Slice 0 的证据上限是“静态门 + 组件行为 + 样式终值”。
3. 每个后续切片按 §3 的结构块逐块验收：块在不在、顺序对不对、高度/间距是否落在本文件的带内、空/错/缺数据三态是否齐备。**“门绿了”不是验收通过。**
4. 真机门槛照旧：`close` + `open` 重编译 → 断言渲染门槛链 → 多用例 `reLaunch` + 不同 `updatedAt` + 污染自证；截图不存在时记 `NOT_RUN`，通道不可用记 `ENV-ABORT`。
5. 遇到本文件没覆盖的冲突：停手、在 §6 补一行“待裁决”，不自行发明 token 或第二套状态词。
