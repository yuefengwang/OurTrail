# OurTrail 户外编辑式设计系统（2026-10-16 UI 重构轮）

> 本文件是本轮 UI/UX 重构的**唯一规范源**。实现落在 `miniprogram/app.wxss`（token + 全局类）
> 与各页面 `.wxss`；页面结构与数据契约一律不变（只做视觉层），所有门禁读数见总报告。
>
> 定位：OurTrail 从「Demo 化卡片墙」升级为**真实户外产品**——
> 户外编辑式的品牌气质（决定我是谁）、Strava 式活动表达（决定活动内容怎么读）、
> AllTrails 式户外信息（决定路线/天气怎么讲）、高效的协作交互（决定工作台怎么用）。

---

## 1. 视觉方向

### 1.1 三个参考的融合原则

| 参考 | 借鉴什么 | 不搬什么 |
|---|---|---|
| 户外杂志编辑式 | 大幅实景、照片与内容的主次、留白节奏、眉题/大标题/辅助信息的层级 | 不做成杂志：不牺牲信息密度与操作效率，大图只占首屏该占的高度 |
| Strava | 真实活动与参与关系是内容主体；时间/地点/难度/参与情况结构清晰 | 品牌配色、商标、具体布局 |
| AllTrails | 路线/距离/海拔/难度/天气有明确标签、单位与解释；用事实支撑决策 | 不把数据粉成评分/徽标/彩色卡片 |

**同一产品原则**：不同页面布局可以不同（详情页编辑式、工作台任务式、天气页数据式），
但字体、颜色、间距、按钮、状态规则必须同源。禁止拼贴，禁止全网统一卡片模板。

### 1.2 品牌气质关键词

自然、克制、可靠、有温度。视觉重量排序：**内容 > 操作 > 装饰**。
任何装饰（等高线、照片、色块）不得与正文抢注意力；任何颜色不得单独承载语义（文字先行）。

---

## 2. Design Tokens

全部挂在 `page` 上（WXSS 无 `:root`）；组件内经 `var()` 继承。
**新增 token 必须登记在本表**；新增语义色先在 app.wxss 定义再使用（禁止发明字面量）。

### 2.1 颜色（在既有森林绿体系上演进，不推倒重来）

| token | 值 | 用途 | 备注 |
|---|---|---|---|
| `--forest` | `#163E35` | 主品牌：主按钮、导航栏、强调文字 | 既有，未动 |
| `--forest-deep` | `#122E28` | hero 照片的深色压底、页头沉浸区 | 新增：比 forest 更深，照片上更稳 |
| `--leaf` | `#D6EA8A` | 嫩叶强调（徽标/hero 上的亮点） | 既有，未动 |
| `--paper` | `#F5F5F0` | 页面底（冷白纸面） | **2026-10-23 视觉收敛**：暖纸 `#F6F3EC` → 冷近白；与 `app.json` `window.backgroundColor` 同值，改一处必须改两处 |
| `--surface` / `--white` | `#FFFFFF` | 卡片/弹层底 | 既有，未动 |
| `--stone` | `#EDEFEA` | 次表面：搜索条、筛选 chip、分区带、灰底表面 | 2026-10-23 由暖米 `#EDE9DE` 改为冷中性，与冷白纸面同族 |
| `--stone-line` | `#D9DED7` | 冷表面上的分隔线（比 `--line` 淡一级） | 2026-10-23 由 `#DCD5C4` 改为冷中性 |
| `--ink` | `#202A26` | 正文 | 既有 |
| `--muted` | `#5F6E66` | 次要文字（`--paper` 上 4.91:1，勿再调淡） | 既有；纸面换冷后复算通过 4.5:1 |
| `--line` | `#DEE3DB` | 冷调分隔线（白卡上的边框） | 既有 |
| `--danger/--warning/--info/--success` | `#B43D3B / #8C5A12 / #346583 / #276145` | 语义色 + 既有 `-soft` 浅底 | 既有 |
| 天相/图表色（`--golden` `--blue-hour` `--chart-*` 等） | 见 design-system.md 既有表 | 天气可视化专用 | 既有，**本轮不动**（天气算法与配色不因视觉重构改变） |

**为什么不是「全局换绿」**：绿是品牌锚不是背景墙。冷白纸面 + 石色承担 80% 的表面，
森林绿只出现在品牌动作（主按钮/导航/hero 压底）与强调文字上——克制才像成熟产品。

### 2.2 照片与遮罩（编辑式核心）

| token | 值 | 用途 |
|---|---|---|
| `--scrim-hero` | `linear-gradient(180deg, rgba(18,46,40,0) 0%, rgba(18,46,40,0.42) 55%, rgba(18,46,40,0.9) 100%)` | hero 照片自下而上的压底，保证白字可读 |
| `--scrim-top` | `linear-gradient(180deg, rgba(18,46,40,0.6) 0%, rgba(18,46,40,0.4) 45%, rgba(18,46,40,0) 100%)` | overlay 品牌栏的顶部压深（2026-10-26 改档：0.3/40% → 0.6/200px 波段，够覆盖「状态栏 + 44 导航」整条白字；唯一消费者 `brand-header--overlay::before`） |

照片资源：`miniprogram/assets/photos/`（9 张，720×450 JPEG，合计约 520KB）。
**来源与授权见 `assets/photos/README.md`**——Unsplash 授权实景，经 picsum.photos 裁切；
它们是**场景氛围封面，不是活动实拍**（活动模型没有图片字段，见 §5.2）。

### 2.3 字号与行高（编辑式层级）

| 类 | 值 | 用途 |
|---|---|---|
| `.display` | 30px / 1.28 / 700 / letter-spacing -0.4px | 活动大标题（hero 内） |
| `.page-title` | 24px / 1.3 / 700 / -0.6px | 页面大标题（root 页）；2026-10-26 由 28px 收一档，见 §11 |
| `.section-title` | 16px / 24 / 600 | 区块标题——既有未动 |
| `.lede` | 15px / 24 / 400 | 导语（活动描述首段） |
| `.kicker` | 11px / 16 / 600 / letter-spacing 1.2px / `--muted` | 眉题（区块上的小标签，中文不用大写改用字距） |
| 正文 | 14px / 22（page 默认） | 既有 |
| `.small` | 12px / 18 | 既有 |
| `.tabular` | font-variant-numeric | 时间/里程/人数/海拔一律等宽 |

**禁止**用大号数字堆专业感；指标数字沿用 `.metric-value`（26px）封顶，一屏不超过一组。

### 2.4 间距、圆角、边框

- 纵向节奏：`.stack` 16px / `.stack-gap3` 12px；**区块间距 28px**（编辑式呼吸感，新增 `.stack-sections`）。
- 页面内边距 24/20（既有）；hero 照片区内边距 20px。
- 圆角：tag 5 / button 8 / card 14 / sheet 20（既有，**不新增圆角档**）。
- 边框：卡片 1px `--line`；冷表面 1px `--stone-line`；分隔一律 1px 发丝线（`.hairline`），不用阴影分组。
- **白卡靠 1px 发丝边 + 底色差立住**（2026-10-23）：冷白纸面上卡片不加阴影，`.card` 带 1px `--line` 边框。
  **`.notice-card` 自 2026-10-26 起不是卡片**：它按参考板 03-5 改成消息流的一行——无圆角、无底色、
  只留底边发丝线，未读态只切左侧 2px 边线颜色（`--forest`；两条读态都占位，避免文字左缘错位）。
- **阴影只留给浮层**（overlay/sticky-action），内容表面零阴影。

### 2.5 触控与操作

- `--touch-target` 44px / `--action-height` 48px（既有）。
- 主操作一屏一个 `.button.primary`；次要动作用 `.button.secondary`/`.text`。
- 固定底栏 `.sticky-action` 必须配 `.page.has-sticky`（平台门禁 §5 已钉）。

---

## 3. 组件体系（先复用，再新建）

既有组件全部保留；本轮**不新建自定义组件**，新增能力全部以全局类 + 页面局部样式实现
（组件化门槛：有复用价值、跨页面一致的状态机。封面 hero 目前只有一个页面成熟使用，
先做类，等第二个页面验证后再决定是否提组件——避免为组件化而组件化）。

| 类/组件 | 场景 | 边界与不适用 |
|---|---|---|
| `.hero-cover` + `.hero-cover-img/.hero-cover-scrim/.hero-cover-body` | 活动详情首屏：封面照 + 状态徽标 + 标题 + 指标 | 只用于「一个活动/一条路线」的详情首屏；列表、工作台、天气页不用（各自有更好的表达） |
| `.section-head`（`.kicker` + `.section-title` + `.section-sub`） | 长页分区标题 | 短于 3 个区块的页面不用（工作台顶部已有总览） |
| `.fact-row` / `.fact-value` | 路线/集合/费用等「标签—值」事实行 | 需要操作的行仍用 `.list-row`；事实行不可点 |
| `.callout`（既有，视觉微调） | 状态/风险/提示 | 状态卡仍是 `view.callout.{{tone}}` 结构（门禁钉点），只改间距与字重 |
| `.badge`（既有） | 状态徽标，文字承载语义 | 不用徽标表达没有文案支撑的状态 |
| `<status-panel>`（既有） | denied/loading/empty/error 四态 | 不自己写裸「暂无数据」 |
| `<person-row>`（既有） | 参与者一行一人 | 名单里不嵌卡片 |
| `.metrics`（既有） | hero 内三指标 | 只允许 hero 内反白出现一次 |
| `.timeline`（既有） | 路线节点 | 节点行保持可点（`hover-class` 条件绑定是门禁钉点） |
| `.sticky-action`（既有） | 报名/发布等主操作固定底栏 | 非 tab 页才用；tab 页底部是 tabBar |
| `.empty-state`/`.status-skeleton`（既有） | 空态/骨架 | 空态必须说清「缺什么、去哪补」 |

---

## 4. 业务状态的统一表达

视觉状态必须与业务状态一致，**文案与语义单源在 `utils/journey.js` / `utils/format.js`**：

| 业务状态 | 视觉表达 | 说明 |
|---|---|---|
| 草稿（未发布） | `badge.neutral`「草稿」+ callout warning「未发布预览」 | 既有 |
| 报名开放（new） | `badge.info` + 主操作「填写报名资料」 | 既有 |
| 待审核（pending） | `badge.warning`「待审核」 | 既有 |
| 已确认（confirmed） | `badge.success`「已确认」 | 既有 |
| 候补（waitlisted） | `badge.neutral`「候补中」 | 既有 |
| 正在集合（gathering） | callout 主状态 + 主操作「我已到达 · 去签到」 | 既有 |
| 已签到/已出发/已到家 | person-row 副标题中的事实串 | 既有 |
| 已取消/已结束 | `badge.neutral` + 只读态，不给主操作 | 既有 |
| 车辆/座位待安排 | 事实行「车辆待安排」（不说「无」而说「待安排」） | 既有 |
| 操作失败 | `callout.danger` + 可行动文案（`utils/api.js` 话术） | 既有 |
| 无权操作 | 不渲染该按钮，或 `status-panel denied` 说明原因 | 既有 |

本轮**不新增、不删除、不改写任何状态转换**；只统一视觉表达。

---

## 5. 图片与图标策略

### 5.1 图片原则

1. 优先项目已有合法资源；本轮新增 9 张 Unsplash 授权实景（见 `assets/photos/README.md`）。
2. 图片必须与场景相关（山/林/雪/晨昏光），不用无关素材；**同一活动每次进来是同一张**
   （`utils/covers.js` 按活动 id 稳定散列），不同活动不重样。
3. 裁切：`mode="aspectFill"`，hero 固定 300px 高；焦点居中。
4. 加载失败：`binderror` 回退为森林绿纯色 hero（`.hero-cover.img-failed` 隐藏照片层）——
   不允许出现破图 icon。
5. 包体：照片合计约 520KB（720×450 JPEG）；`miniprogram/` 总体积须 < 2MB 主包上限。

### 5.2 诚实性边界（重要）

活动模型**没有图片字段**（不可改数据库结构），因此封面是**场景氛围图而非活动实拍**。
页面底部以 `.small.muted` 明示「封面为场景氛围图，非本次活动实拍」。
后续若要做真活动图，需服务端加字段（列入剩余工作，不在本轮动 schema）。

### 5.3 图标

沿用 `components/icon`（SVG data-URI，唯一叶子组件），风格尺寸不变；
装饰性图标不得替代文字；业务动作图标不改义。

---

## 6. 分域信息架构（本轮落地范围）

| 域 | 页面 | 本轮动作 |
|---|---|---|
| A 发现与探索 | `home` `discover` | 编辑式眉题 + 封面缩略图进 `activity-card`；搜索/筛选不挤占内容 |
| B 活动详情与参与 | `activity` `signup` | **视觉标杆**：hero-cover 编辑式首屏；signup 仅 token 对齐 |
| C 领队工作台 | `workspace` `staff` `vehicle` | 待办优先；指标行收敛；复用同一套 token 与按钮 |
| D 出行协作 | `staff` `vehicle` `field-panel` | 触控目标与对比度按户外强光原则核一遍；不改交互逻辑 |
| E 天气与户外决策 | `weather` `weather-hub` `weather-chart` | **信息标杆**：算法与图表零改动；仅统一 token/眉题/留白 |
| F 个人与账户 | `me` `notices` `anotices` | 眉题 + 分区头 + 封面缩略 |

**导航不变**：tabBar 仍是 活动/天气/通知/我的（app.json 已定，用户习惯与深层链接不可破）。

---

## 7. 落地清单（改哪些文件）

| 文件 | 改动 |
|---|---|
| `miniprogram/app.wxss` | 新增 token（`--forest-deep/--stone/--stone-line/--scrim-*`）+ 编辑式类（`.display/.lede/.kicker/.section-head/.fact-row/.hero-cover*/.hairline/.stack-sections`）+ `--paper`（2026-10-16 暖调，**2026-10-23 已回归冷白，见 §10**） |
| `miniprogram/utils/covers.js`（新） | 封面散列选择（纯函数、零依赖、可测） |
| `miniprogram/assets/photos/*` + `README.md`（新） | 9 张授权实景 + 来源登记 |
| `pages/activity/activity.{js,wxml,wxss}` | hero-cover 首屏、分区头、事实行、诚实性脚注 |
| `pages/home` `pages/discover` `pages/me` | 眉题/分区头/卡片封面（第二阶段推广） |
| `pages/workspace` `pages/weather` `pages/weather-hub` | token 与留白对齐，结构不动 |
| 其余页面 | 仅继承 token 演进，零改动或最小改动 |

## 8. 验收口径

1. `node tools/check.js` + `check-handlers.js` exit 0。
2. 全量 `tools/*-test.js` 与基线一致（新增失败必须归因到本轮且修复）。
3. 微信开发者工具真机截图：同一夹具数据前后对照（`docs/ui-ux-redesign/screens/before|after`）。
4. 真实交互：导航/报名入口/工作台 tab/天气时间轴各至少一次真实 tap。
5. 小屏（iPhone SE 375×667）与长标题边界各一例。

## 9. Night V1 登记（2026-10-22，T001）

新增共用类（`app.wxss` 末尾「Night V1 共用类」分区，只增不改、零新色值、零新 token）：

| 类 | 语义 | 取色/取尺 |
|---|---|---|
| `.searchbar` | 图标内嵌圆角搜索条（列表页顶部） | `--stone` / `--radius-button` / 高 36px |
| `.searchbar__input` | 搜索条内输入区 | `--text-body` / `--ink` |

指标行**不新增**：复用存量 `.metrics / .metric / .metric-value / .metric-unit / .metric-label`
（app.wxss:437–447，6 页在用，含 M-16 溢出处置）。T001 首版曾追加 `.metrics__*` 平行体系，
被 G11（同选择器关键布局属性双写）当场拦下 ⇒ 已删除，改为复用存量。

明确**不新增**（盘点实测已存在）：`.segmented/.seg`、`.field/.input`、`.filter-chip`、`.hero-cover*`、
activity-card 媒体形态。浅色导航栏由页面 json 承担（`app.json` 冻结），不进 WXSS。

## 10. 全局视觉收敛 A（2026-10-23，用户选 A）

依据用户提供的 `OurTrail_UI_交付包/01_全局视觉参考.png`，只取**结构规则**，不抄参考图的品牌与具体色号：
冷白纸面、白色表面靠细线立住、森林绿只做唯一主操作、leaf 退回点缀、内容分区用下划线页签、列表密度提高。
4 个 tab、页面 IA、详情页 hero 均不变。

| 项 | 收敛后 | 说明 |
|---|---|---|
| 纸面 `--paper` | `#F5F5F0` | 冷近白；`--muted` 在其上 4.91:1；`app.json` `window.backgroundColor` 同值，12 个页面 json 的浅色导航同步 |
| 石色 `--stone` / `--stone-line` | `#EDEFEA` / `#D9DED7` | 冷中性族；搜索条、筛选 chip、分区带使用 |
| `.card` | 白底 + 1px `--line` | 零阴影；卡片靠边框与底色差立住 |
| `.notice-card` | **扁平行**（2026-10-26）：透明底、无圆角、底边 1px `--line`；未读只切左侧 2px 边线颜色 | 通知是可读的消息流（板 03-5），不是卡片堆；行形态只在 `app.wxss` 一处，两份通知页都不许本地覆盖 |
| `.segmented.tabs-line` | 文字 + 2px 森林绿下划线（`.on::after`） | 内容分区切换的形态变体；沿用 `.segmented/.seg/.on` 类名，E2E 选择器契约不变。分段控件默认形态（白底药丸）保留给筛选/步骤条 |
| `custom-tab-bar` 选中态 | `#163E35` 字 + 600 字重 + 透明底 | 去掉 `#ECF0EF` 药丸底；触控高度与圆角仍归 `.tab` |
| `activity-card` | 卡片本体可点，不再重复印「查看活动安排」实心/leaf 入口 | 协作入口保留为 leaf chip 行（`collab` 非空时才出现）；leaf 只做点缀，不承载列表里的重复主操作 |
| 列表密度 | 活动列表容器 `.stack` → `.stack-gap3`（12px） | home / discover；卡片内部 padding 不变 |

判据变更：`tools/swx1-style-gates-test.js` T2.6 的选中 tab 终值由「白/浅底药丸」改为「透明底」，其余色阶/对比度门保持原值。


## 11. Style B 批次一（2026-10-26，用户选「按参考板重新设计」）

依据用户提供的全浅色参考板（品牌行 + 图在上卡片 + 吸顶分段 + 底栏三 tab），只借**结构与工艺**，
不借品牌与色号：无中央 FAB、不做活动市场、无分类维度。**零新增 token / 零新增色值**。

| 新增/变更 | 形态 | 取尺与边界 |
|---|---|---|
| `components/brand-header` | 自绘品牌行：`trailMark` 图标 + `OurTrail` + 可选页名，固定栏 + 同高占位块 | 底 `--paper`、线 `--line`、词标 `--forest` 16px/700；**只挂在 4 个 tab 页**（页面 json `navigationStyle: custom`），子页仍走原生导航栏；高度由 `utils/header-layout.js` 从状态栏与胶囊菜单算，不写死 |
| `components/next-up-card` | 首页「下一次同行」状态卡：眉题 + 活动名 + 一行事实（日期 · 剩余 · 已确认 N/M · 待审核 N） | 深森林底（`--forest-deep`）+ 白字；**整卡可点、卡内不放实心按钮**（一屏一个主操作）；空态改邀请卡，主按钮「发起活动」在卡内 |
| `.page-title` | 28px/700 → **24px/700** | 全批唯一一处全局字阶改动；判据 `tools/m02-class-scope-test.js` PV4 同步改期望值 |
| 详情页吸顶分段条 | 全局 `.segmented.tabs-line` + 页面层 `.section-nav { position: sticky; top: 0; background: var(--paper) }` | 6 段（介绍/行程/路线/安全/装备/约定）覆盖 9 个既有锚点；当前项由 `IntersectionObserver` 逐锚点观测得出，观测窗上沿让开条高 45px；点按仍走 `onSectionNav` |
| 通知页页头 | 两个分区头并成一个（`kicker 通知` + `重要安排，不错过。`）；条数/排序/未读说明降为一行细字 | 同一屏不再连出两次「通知」；`anotices` 是子页，不挂品牌头 ⇒ 两份 wxml 自本轮起**允许页头不同**，正文仍须同构（`tools/page2-gates-test.js` M-18 判据已按此收窄） |
| `activity-card` 正文分槽 | 标题 + 一行 chips + 人数/角色行 | 卡内旧字段（status/info/metrics/meta）保留给既有断言，新槽位只做加法 |

明确不改：`cloudfunctions/**`、`custom-tab-bar/**`、`utils/journey.js`、天气线任何文件。

## 12. Style B Slice 0 共用层（2026-10-26）

依据 `style-b-shared-layer-spec-2026-10-26.md` §1 / §4.1 落地：**零新增 token、零新增色值**，
新增 1 个全局类（`.sheet-top`）。Slice 0 不改任何页面、不改任何门禁。

| 全局类（`app.wxss`） | 变更前 → 变更后 | 依据 / 边界 |
|---|---|---|
| `.stack-sections` | gap 28 → **40** | 参考板长页的区块之间有明显空行；只改值，类名与「正文唯一外层」契约不动 |
| `.person-row` | padding 16/16 → **18/18**，新增 `min-height: 84px` | 板 03-2 的人行约 95px 节距（含分隔线）：44 头像 + 上下 18 |
| `.avatar` | 40 → **44** | 与 `--touch-target` 同高 |
| `.list-row` | padding 16/16 → **18/18** | 与 person-row 同节距 |
| `.searchbar` | 高 36 → **`var(--touch-target)`**；padding 0 10 → **0 16**；gap 6 → **8**；圆角 `--radius-button` → **999px** | 板 01-2 / 03-2 的搜索条既是可点目标、又是药丸形 |
| `.sheet-top`（新） | `margin:-20px -20px 0`；`padding:20px 20px 0`；上两角 `--radius-sheet`；底 `--surface` | 媒体在上、内容在下时的「白面抬起」；负边距抵掉 `.page` 的 20px 左右留白 |

组件层（不新增 token）：

| 组件 | 变更 |
|---|---|
| `brand-header` | 新增 `variant`（`solid` 默认 / `overlay`）：overlay 透明、`absolute`（非 fixed）、占位块 0、白字白图标（icon 写字面量并注明 `--white`/`--forest` 来源） |
| `next-up-card` | 有活动分支改照片 hero（`min-height:320px`，`covers.coverFor(activityId)` 氛围图，失败换一张→纯色森林底）；空态分支不变，props 与 `open/create` 事件不变 |
| `activity-card` | `featured` 媒体 148 → **240**、`plain` 168 → **200**；新增 `flat` 属性（去底色/边框/圆角，供发现页平铺行；与 `compact` 正交，80 缩略图不变） |
| `activity-hero` | 组件作用域 `.hero-cover-media` 240 → **320**；全局 `.hero-cover-media` 保持 240（路线库等 hero 不受影响） |
| `fact-grid` | `.fact-grid--card` row-gap 16 → **20** |

门禁：`check.js` G10 / `entry-layout`（80 缩略图、props、事件）/ `activity-l2-structure`（hero·chapter 属性键集、`.stack-sections` 唯一）/
`b4-pad-final-value`（`.page` 基线）全部按原值保持，**Slice 0 未改任何门禁断言**。

## 13. Style B Slice 4：天气页信息层级（2026-10-26）

依据板 `reference/screens-2026-10-20/04-2-weather-hourly.png` / `04-4-weather-detail.png`。
**零新增 token、零新增色值**；类全部落在 `pages/weather/weather.wxss`（页面级，不进 `app.wxss`）。

| 类（`weather.wxss`） | 形态 | 依据 / 边界 |
|---|---|---|
| `.hour-strip` / `.hour-strip__item` | 图上方逐时摘要带：`flex` 等分 **8 列**，每列三行（简字 12/600 → 温度 12/600 `--ink` → 时刻 10 `--muted`），列内 `gap:1px` | 板 04-2 的"图标 + 温度"横带。不引图标资源 ⇒ WMO 简字 + 复用 `.day-phrase` 的 tone。固定 8 列而不是≤9：375 宽下 9 列只有 37px，三字简字会折行 |
| `.pop-strip` / `.pop-strip__label` / `.pop-strip__row` / `.pop-strip__v` | 图下方降水概率：标签独占一行，数值行同 `flex:1 0 0` ⇒ 与摘要带按列对齐；颜色 `--info` | 板上是 2×5 两行（按天折行），我们收成一行 8 列：折行会让"哪一列对应图上哪小时"要靠拼接才能读。整行由 `popShown` 控制，个别缺印「—」 |
| `.brief-rows` | 详细数据四行的卡片（`padding-top/bottom: 2px`） | 行形态复用 `app.wxss` `.fact-row`；这里只收掉卡片内边距与行内边距叠出的双份留白 |

结构次序（`tools/page2-gates-test.js §5b` 钉）：`点卡 → .hour-strip → 图表 → .pop-strip → OI 卡`。
详细数据 = `.section-head.has-action`（文字链「展开逐小时全表」）+ 4 × `.fact-row` 默认可见，
14 列全表仍由 `showDetail` 收起；数据来源 / 更新时间紧随其后（与板 04-4 的底部两行对位，不重复印）。

统计口径：`buildHourStrip` 的步长 = 窗长 / 8（24→3h、48→6h、72→9h），列表键为 `d + 'T' + t`
（跨天唯一）；`buildBriefRows` 只印当日 min–max，缺读数整行印「—」，同值不印假区间。

门禁：`page2-gates 124/0`、`weather-page 219/0`、`check.js ALL CHECKS PASSED`；
变异 7 条 0 漏网。证据 `evidence/style-b-slice4-2026-10-26/README.md`。**真机 NOT_RUN**。

## 14. Style B Slice 5a：我的 / 报名 / 编辑器的收敛（2026-10-26）

这三页**没有 10-20 逐屏板**（`style-b-fidelity-matrix-2026-10-26.md` §2.3），所以本片的验收不是"逐屏保真"，
而是任务书 Slice 5 的口径：**只做 token 与组件收敛，导航 / 四态 / 底部留白不得回归**。零新增色值、零新增字阶。

| 收敛点 | 前 | 后 | 出处 |
|---|---|---|---|
| 行卡内边距 | `class="card" style="padding:4px 16px;"` 内联 5 份（me 3 / editor 2） | `class="card rows"` | `app.wxss` `.card.rows`（唯一出处） |
| 常用同行人行 | 私有 `.list-row` + `.who` + `.avatar-img.sm`（36px）+ `.avatar-fallback.sm-text`（15px 无源字阶） | 共享 `<person-row>`（44px 头像 / 16·600 姓名 / 操作插槽），编辑·移除仍在其 slot 内 | `components/person-row/`，登记于 §组件清单 |
| `me.wxss` 私有小头像规则 | 2 条 | 删除（全站人行头像只剩 44 一个出处） | — |

`signup.wxss`（6 行）与 `editor.wxss`（51 行）经核已是 token 驱动，其内联 style 是**带注释理由的布局覆盖**
（44px 触点、nowrap、吸顶栏内文字按钮 flex:0），本片不动——批次二 b 已登记"editor / signup 既有层级不改"。
残留登记：`editor.wxml` 内联 `font-weight:600` 8 处 + `signup.wxml` 1 处，是全仓最后一族重复的内联字重；
它不产生数值漂移（只用 600 一档），收它需要新造一个全局类，留待有板或另有判据时再做，不为此页造新 API。

**首屏结构审查（`me`，390 宽）**：`.stack-sections` 的 40px 段距是**逐兄弟**施加的，而首屏里
身份区 → 统计带 → 待保存横幅 → 激活引导卡 是同一个逻辑单元（"我是谁 + 还差什么"）的四个兄弟，
于是它们之间吃掉 3 × 40 = 120px，而一个 `chapter` 自己的题头到正文只有 12–16px。
读下来的后果是"留白比内容先出场"，真正的下一步（最近活动 / 路线库）被推到折叠线以下。
这是**结构判断**而非收敛，已交负责人裁决（选项与推荐见 `evidence/style-b-slice5a-2026-10-26/README.md` §4），本片未自行改。

门禁：`personal-route-layout 60→65/0`（新增 5 条：组件在用且操作在插槽内 / 无第二套头像尺寸 /
`.card.rows` 单源 / 内联 style 棘轮 ≤ 11 / json 登记）、`scenario-me 145/0`、`scenario-editor 227/0`、
`scenario-signup 106/0`、`page2-gates 124/0`、`swx1 45/0`、`swx2 110/0`、`m02-class-scope 66/0`、
`t4-e08 41/0`、`ui-consistency 19/0`、`journey-graph 15/0`、`b4-pad-final-value 33/0`、
`check.js ALL CHECKS PASSED`（G10 命中 0，app.wxss 类名 136→137）、`check-handlers` 仅存量 `editor#onNumber`。
变异 6 条 0 漏网（`evidence/style-b-slice5a-2026-10-26/tools/mutate-5a.js`：每条恰好红 1 项、还原逐字节相等、还原后复跑全绿）。
**真机 NOT_RUN**。

## 15. Style B Slice 5b：路线四页与报名页的重复出处归一（2026-10-26）

同 §14 的口径（无逐屏板 ⇒ 只做收敛，不改结构）。审计结果：四页 wxss **零原始色值、零无源字号**，
真正剩下的问题全是**同一句话被抄在几页里**，以及抄的过程中漏掉的那一半。

| 新增共用类（`app.wxss`） | 内容 | 来由 |
|---|---|---|
| `.metrics.compact .metric .metric-value` | `--text-title` / 行距 24 / `letter-spacing:0` | `routes.wxss` 与 `route.wxss` 各存一份**逐字相同**的紧凑指标（四列横排每列约 67px，26px 大字会压邻列）。`.card-label` 事故的同族形态 |
| `.row-title` | `font-weight:600` + `overflow-wrap:anywhere`（**两半必须同处**） | `style="font-weight:600;"` 在 route / route-edit / editor / signup 抄了 14 份，而 M-16 的断词保护只写在 `route.wxss` 的 `.route-node-name` 里 ⇒ 同一个用户输入名称（节点名/风险名/上车点名/参与人名，`maxlength=80`）在编辑与报名侧**没有**断词保护 |

删除项：`.route-meta { gap: 8px }`（两页各一份，而 `.cluster` 缺省 gap 本就是 8px ⇒ 两份都是空转的死覆盖，
定义与模板使用点一起删）；`route.wxss` 的 `.route-node-name` 只留 `display:block; margin-top:2px`（排布差）。
token 化：`weather-chart` 的 `.fc-modes .seg` 触点 `44px` → `var(--touch-target)`。

内联 style 变化：route 11→10、route-edit 19→17、editor 109→99、signup 18→17，routes / weather-chart 恒 0（合计 −14）。
判据只咬**独立** `style="font-weight:600;"` 形态：`editor.wxml:638` 的「完成/编辑」是带语义色的**文字动作**，
不是行标题，保留内联并在此登记为例外。

门禁：`personal-route-layout 65→71/0`（+6 条，含六页内联 style 棘轮）、`routes 75/0`、`scenario-editor 227/0`、
`scenario-signup 106/0`、`scenario-activity 212/0`、`page2-gates 124/0`、`swx1 45/0`、`swx2 110/0`、`m02 66/0`、
`t4-e08 41/0`、`ui-consistency 19/0`、`b4-c11 171/0`、`ra-field-panel 72/0`、`check.js ALL CHECKS PASSED`
（G10 命中 0 ｜ class token 3193 ｜ **app.wxss 类名 137→139**）、`check-handlers` 仅存量 `editor#onNumber`。
变异 14 条 0 漏网（N8 专测"只留字重丢掉断词"必须红；N12 专测 signup 那一页不是搭便车通过）。
证据与真机前置：`evidence/style-b-slice5b-2026-10-26/README.md`。**真机 NOT_RUN**。

## 16. Style B Slice 5c：五页审查 + 判据升成全仓（2026-10-26）

`vehicle` / `staff` / `lab` / `privacy` / `cloud-field-poc` 全部**无逐屏板**，后三页另按覆盖矩阵排除在视觉批次外
（DEV_ONLY 预演 / 法务正文 / POC）。审计结论：五页 wxss **零原始色值**；`vehicle.wxss` 自述"本页不写任何
min-height 字面量（M-07）"经 grep 复算**属实**（`min-height:` 字面量 0 处）。

实际改动只有 **`lab.wxml` 两处类名替换**（活动标题 `class="row-title" style="min-width:0;word-break:break-all;"`
—— **`break-all` 原样保留**，它是该页对 64 位身份码串的既有强断策略，比 `anywhere` 更狠，不能被"收敛"顺手换掉；
阶段卡标题 `class="row-title"`）。其余四页一行未动 ⇒ 它们的"导航 / 四态 / 底部留白不回归"是**按构造成立**，不是测出来的。

本片真正的交付是**把 §15 那条页级判据升成全仓**，并先证明那把尺能产生差：
`全仓独立的内联字重行标题为 0；复合内联字重只剩登记的这 2 处` 扫全部页面 + 全部组件的 wxml，
例外是**逐条点名比对**（不是"≤2 就算过"）。变异 `evidence/style-b-slice5c-2026-10-26/tools/mutate-5c.js`
**6 条 0 漏网**，宽度矩阵刻意的：P2 打在**本轮一行未动的 staff**、P3 打在**同样未动的 vehicle**（且用复合形态，
专验名单是逐条比而非数个数）、P4 把已登记的 `activity` 例外从复合改成独立（例外不许反过来保护新写法）、
P5 打在 `components/roster-panel`（组件目录也在面内）、P6 打掉 `.row-title` 的**字重**那一半（5b 的 N8 打掉的是断词那一半）。

**判读为"不动"的一处，理由要留档**：`--text-title` + 26px + 600 这个三元组在 `me.wxss:32`（工具入口标题）、
`routes.wxss:26`（路线标题）、`staff.wxss:11`（身份头标题）各抄一份。**没有合并**——同值不同义（铁律 31②）：
三者是三种屏上的三种对象，今天同值不构成绑在一起改的理由；且它不产生行为缺口（三处各自的颜色与断词策略都已到位）。
对照 §15 里做了的两条：`.card.rows` 是"同一含义抄 5 份"，`.row-title` 是"同一含义抄 14 份**且漏了另一半**"——
都有"含义同一"的证据，这一条没有。见到第四份复制时先判语义。
其余登记未动：`cloud-field-poc.wxss` 的 15/11/10px 无源字号（POC 排除）、`privacy.wxss` 的 `27rpx`（文件头已写明属 E-09 的账）、
`staff` / `vehicle` 的 `.stack`/`.cluster` 布局覆盖内联（由 §15 棘轮管住只许变少）。

门禁：`personal-route-layout 71→72/0`（+1 条全仓门；`check()` 顺带补 `extra` 参数，失败时打印命中清单而不是只有一句 FAIL）、
`scenario-lab 20/0`、`lab-dryrun 165/0`、`scenario-vehicle 66/0`、`scenario-staff 26/0`、
`routes 75/0`、`scenario-editor 227/0`、`scenario-signup 106/0`、`scenario-activity 212/0`、`scenario-me 145/0`、
`page2-gates 124/0`、`swx1 45/0`、`swx2 110/0`、`m02 66/0`、`t4-e08 41/0`、`ui-consistency 19/0`、
`journey-graph 15/0`、`b4-pad-final-value 33/0`、`check.js ALL CHECKS PASSED`（G10 命中 0 ｜ class token 3195 ｜ 139 类名）。
**真机 NOT_RUN**；结论上限 E1 + E2；`cloudfunctions/` 零改动 ⇒ 不需要重新部署。
