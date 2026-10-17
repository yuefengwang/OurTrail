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
| `--paper` | `#F6F3EC` | 页面底（暖纸面） | **由 `#F5F5F0` 微调暖**：编辑式基调 |
| `--surface` / `--white` | `#FFFFFF` | 卡片/弹层底 | 既有，未动 |
| `--stone` | `#EDE9DE` | 次表面：分区带、chip 底、灰底表面 | 新增：石色，替代部分 `--forest-soft` 的中性场景 |
| `--stone-line` | `#DCD5C4` | 暖表面上的分隔线 | 新增 |
| `--ink` | `#202A26` | 正文 | 既有 |
| `--muted` | `#5F6E66` | 次要文字（`--paper` 上 4.6:1，勿再调淡） | 既有 |
| `--line` | `#DEE3DB` | 冷调分隔线（白卡上的边框） | 既有 |
| `--danger/--warning/--info/--success` | `#B43D3B / #8C5A12 / #346583 / #276145` | 语义色 + 既有 `-soft` 浅底 | 既有 |
| 天相/图表色（`--golden` `--blue-hour` `--chart-*` 等） | 见 design-system.md 既有表 | 天气可视化专用 | 既有，**本轮不动**（天气算法与配色不因视觉重构改变） |

**为什么不是「全局换绿」**：绿是品牌锚不是背景墙。纸面暖白 + 石色承担 80% 的表面，
森林绿只出现在品牌动作（主按钮/导航/hero 压底）与强调文字上——克制才像成熟产品。

### 2.2 照片与遮罩（编辑式核心）

| token | 值 | 用途 |
|---|---|---|
| `--scrim-hero` | `linear-gradient(180deg, rgba(18,46,40,0) 0%, rgba(18,46,40,0.42) 55%, rgba(18,46,40,0.9) 100%)` | hero 照片自下而上的压底，保证白字可读 |
| `--scrim-top` | `linear-gradient(180deg, rgba(18,46,40,0.32) 0%, rgba(18,46,40,0) 40%)` | 照片顶部微压，融合状态栏 |

照片资源：`miniprogram/assets/photos/`（9 张，720×450 JPEG，合计约 520KB）。
**来源与授权见 `assets/photos/README.md`**——Unsplash 授权实景，经 picsum.photos 裁切；
它们是**场景氛围封面，不是活动实拍**（活动模型没有图片字段，见 §5.2）。

### 2.3 字号与行高（编辑式层级）

| 类 | 值 | 用途 |
|---|---|---|
| `.display` | 30px / 1.28 / 700 / letter-spacing -0.4px | 活动大标题（hero 内） |
| `.page-title` | 28px / 1.3 / 700 / -0.6px | 页面大标题（root 页）——既有未动 |
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
- 边框：卡片 1px `--line`；暖表面 1px `--stone-line`；分隔一律 1px 发丝线（`.hairline`），不用阴影分组。
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
| `miniprogram/app.wxss` | 新增 token（`--forest-deep/--stone/--stone-line/--scrim-*`）+ 编辑式类（`.display/.lede/.kicker/.section-head/.fact-row/.hero-cover*/.hairline/.stack-sections`）+ `--paper` 暖调 |
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
