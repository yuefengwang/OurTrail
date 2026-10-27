# OurTrail 全局原型对齐 · 开发计划

- **日期**：2026-10-20
- **输入**：`docs/ui-ux-redesign/reference/global-prototype-2026-10-20.jpg`（用户提供的全局原型）
- **性质**：只读盘点 + 开发计划；本文件不实施代码、不改 schema、不部署
- **基线**：`app.json` 20 页 / 13 个组件目录 / 4 个 tab / trailApi 14 个 action、42 个命令；2026-10-16~17 已完成一轮编辑式视觉重构
- **证据档**：本文件中的现状条目均为 E1（源码文本可直接核实）；视觉观感结论只到 E2，真机未跑

---

## 0. 一句话结论

原型真正值得吸收的是 **「发现 → 判断 → 协作 → 天气」四段式决策结构**；
不能照搬的是它的 **付费活动 marketplace 商业外壳**。
当前代码已经完成“视觉换皮”，本轮要补的是三类 **决策层能力**：
① 发现的筛选与地图；② 详情页的路线剖面、装备分组与活动级天气摘要；③ 协作任务清单。
天气模块保持现有深度，只补活动级摘要与视觉收口，不重写算法。

---

## 1. 原型与产品的三条边界（先定，不然后面每页都会跑偏）

| 原型表达 | OurTrail 现实 | 处理 |
|---|---|---|
| ¥680 / ¥580、费用明细、立即报名 | 零金额、纯工具；当前只有 `feeNote` 文本，不收款、不退款 | **不搬价格与支付**；费用区改为「费用与 AA 约定」事实说明 |
| 4.9 ★ / 32 条评价 / 领队认证 | 没有评价、认证、平台保障模型 | **不建评价体系**；用「已确认 N 人 / 名额 / 风险等级 / 组织者说明」替代 |
| 按目的地/难度/交通方式筛选公开活动 | `discover` 目前只有搜索；活动级没有难度、交通方式字段；出行方式是 **报名人级** `Trip.mode` | 难度可做（组织者标注）；交通方式筛选 **不采纳**，除非新增活动级字段并改变语义 |
| 陌生人公开报名、平台客服 | 熟人圈子履约工具；分享链接 + 名单 + 分车 + 签到 | **不搬陌生社交与平台担保**；发现页保留“个人发起、未认证”的诚实提示 |
| 大幅活动实拍图 | 活动模型没有图片字段；当前用 `utils/covers.js` 按 id 稳定选氛围图，并在页脚声明“非实拍” | 暂缓真实活动封面；若要做，需云存储上传 + schema 可选字段 + 内容审核 |
| D1/D2/D3 图文行程 | 当前有路线节点、时间、起止时间，但没有分日行程结构 | 先用“按轨迹时间推算的节点日程”；**不伪造 D1/D2/D3**；结构化行程列入后续 |

**总原则**：原型的版式、层级、留白、卡片节奏可以学；它的交易模型、评价模型、陌生人市场模型不学。

---

## 2. 现状盘点（与原型四组页面对齐）

### 2.1 发现（原型 01）

**已有**
- `home` 是“我的活动”主页：三视角合并、协作任务、我的/最近/已结束筛选、搜索、featured 大卡（`pages/home/home.js:40-135`）。
- `discover` 是公开活动列表：只显示未出发、未取消、未归档的活动，按发布时间倒序，最多 50 条，支持关键词搜索（`domain/selectors.js:440-457`）。
- 活动卡已有封面缩略图 / featured 大图，封面按活动 id 稳定散列（`components/activity-card/activity-card.wxml:6-42`）。

**缺口**
- 没有日期、难度、目的地筛选，没有排序切换（`pages/discover/discover.js:43-46` 只传 `search`）。
- 没有列表/地图双视图。好消息：`discoverView` 已经带 `routeSnapshot.points` 的坐标（`selectors.js:83-86`），地图 **不需要新增后端字段**，用起点坐标即可。
- 首页与发现页的职责没有在视觉上拉开：原型左一是“发现落地页”，当前 `home` 是“我的活动”，不能直接互换，否则领队的待办会消失。

### 2.2 活动详情（原型 02）

**已有**
- 编辑式 hero、状态浮层、里程/爬升/人数三指标（`pages/activity/activity.wxml:17-46`）。
- 同行人、行程三时间、路线地图、节点时间轴、风险、装备、费用、通知、报名/工作台主操作（`activity.wxml:57-241`）。
- 路线节点已有 `time` / `ele` 可选字段（`domain/schema.js:128-137`），活动详情投影保留节点高程（`selectors.js:26-34`）。

**缺口**
- 没有详情分区导航；长页只能一路滚。
- 没有难度标识；`Activity` 只有单个 `equipment` 数组（`schema.js:169-177`），没有“必带/建议”分组。
- 没有海拔剖面。节点高程已有，但连续轨迹点 `TrackPoint` 只有 lat/lng（`schema.js:146`），投影还把 `track` 的 ele 剥掉了（`selectors.js:67`）。
- 没有分日行程结构；没有活动级天气摘要（当前只有“天气参考”入口，`activity.wxml:121-124`）。
- 没有真实活动封面；当前是氛围图 + 诚实脚注（`activity.wxml:232`）。

### 2.3 协作（原型 03）

**已有**
- 组织者工作台：总览 / 名单 / 分车 / 现场四个分区（`pages/workspace/workspace.js:8`）。
- 名单批量审核、导出、敏感资料；分车、自动分配、座位图；现场签到/出发/到家/异常/位置上报（各 panel）。
- 活动通知发布与已读状态（`domain/schema.js:280-283`；`utils/notices-page.js`）。

**缺口**
- **没有任务清单**。`domain/schema.js` 没有 Task 实体，`workspace` 也没有任务分区。原型里的“公共装备 / 食物采购 / 行程记录 / 发布任务”属于新的协作域，不是现有面板能拼出来的。
- 通知只有 `content` 与受众，没有“现场通知 / 天气提醒 / 系统消息”分类（`schema.js:280-283`）。可以做展示分组，但不要用文案猜类型。
- 成员管理、交通安排已有；缺的是与任务、通知之间的交叉入口。

### 2.4 天气（原型 04）

**已有（比原型更深）**
- 7 日概览条、24/48/72h 切窗、统一 Meteogram、云层剖面、天相标记、OI 机会卡（`pages/weather/weather.wxml:53-180`）。
- 路线节点/轨迹点组查询、活动节点天气、缓存软降级、失败重试（`pages/weather/weather.js`、`utils/weather-cache.js`）。
- 天气文案已有概率语气与“不是出发许可”的边界（`weather.wxml:12`）。

**缺口**
- 原型把天气放在“活动上下文”里（出发窗口、路线天气、决策建议）；当前活动详情只有一个入口，用户要跳页后才看到完整信息。
- 天气页本身的视觉密度已经很高，不能为了像原型而删图表；只补顶部“出发窗口/风险摘要”和章节层级。

### 2.5 原型没有、但当前已支持的页面

| 页面 | 当前能力 | 本轮处理 |
|---|---|---|
| `signup` | 报名、同行人、出行方式、代报 | 只做设计语言对齐；不改状态机 |
| `editor` | 发布门、可后补路线、风险、装备、集合点 | 增加难度/装备分组字段时同步；不做结构重写 |
| `routes` / `route` / `route-edit` | V2 路线库、共享、分段天气 | 路线详情复用新的海拔剖面；列表做视觉收口 |
| `staff` / `vehicle` | 协作者/车长任务页 | 只对齐层级与触控；不改面板逻辑 |
| `me` / `notices` / `anotices` | 资料、最近活动、通知 | 用同一套眉题/分区/事实行做展示优化 |
| `weather-chart` / `space-time` | 全屏图表、时空天相 | 保持数据密度，只统一 token 与文案 |

---

## 3. 后端能力缺口与设计

### 3.1 不需要改后端的能力

| 能力 | 复用点 | 说明 |
|---|---|---|
| 发现页地图 | `discoverView.routeSnapshot.points[].coordinates`（`selectors.js:83-86`） | 取第一个有坐标的节点作为活动标记；无坐标活动只出现在列表 |
| 活动级天气摘要 | `getWeatherByPoint` / `getWeather`（`api.js`） | 用一个起点坐标 + 出发日取数；不新增天气算法 |
| 详情分区导航 | 现有 WXML 结构与页面内锚点 | 纯前端 |
| 现有页面视觉收口 | `app.wxss` token/全局类 | 纯前端 |

### 3.2 兼容性 schema 扩展（可选字段，旧数据不需要迁移）

> 严格 schema：新增字段必须同时进所有重复 spec，且必须是 `specOpt`，否则存量数据整库校验失败（ADR-0003）。

1. **难度**（P0，发现筛选和详情徽标都需要）
   - 位置：`RouteSnapshot`、`Route`、`RouteInput`（`schema.js:147-162`、`:321`）。
   - 值：`specOpt(specEnum(['easy','moderate','hard']))`，中文「轻松 / 中等 / 挑战」；没有值就是「未标注」。
   - **不允许**从里程/爬升自动推导；这是组织者的判断，自动分级会造出没有依据的“难度”。
   - 编辑器路线步骤增加 picker；`format.js` 增加唯一标签表；`routeCompleteness` 不因缺难度而阻塞发布。
   - 发现筛选按 `routeSnapshot.difficulty` 过滤；未标注的活动在“全部”里出现，在具体难度筛选里不出现，并明确说明。

2. **装备分组**（P1，详情页）
   - `Activity` 增加 `equipmentSuggested: specOpt(specArr(specText))`；`equipment` 继续作为“必带”。
   - 旧数据：`equipment` 全部按必带显示；`equipmentSuggested` 缺失按空数组读。
   - 编辑器装备步骤拆两块；`activityView` / `discoverView` 都要带上。

3. **连续高程**（P1，详情页剖面）
   - `TrackPoint` 增加 `ele: specOpt(specNum(-500, 9000))`（`schema.js:146`）。
   - `miniprogram/utils/gpx.js` 的 `simplifyTrack` 保留采样点的 `ele`；`lib/weather.js` 的 GCJ/WGS 副本与此无关，不动。
   - `selectors.activityView` 的 `track` 投影保留 `ele`（当前 `selectors.js:67` 明确剥掉）；`selectRoute` 同步。
   - 没有连续高程时，用命名节点高程画“节点剖面”，并明确标注“非连续剖面”；两者都没有时不画曲线、说明缺什么。**不允许插值伪造地形。**

4. **结构化行程**（P2，先不做）
   - 若要做 D1/D2/D3，需要 `itinerary` 数组（天、标题、说明、节点引用）与新编辑器步骤；这是独立产品功能，不在本轮。

5. **真实活动封面**（P2，先不做）
   - 需要可选 `coverFileId`、上传入口、失败回退、内容审核与存储清理；当前氛围图 + 诚实脚注可继续用。

### 3.3 新领域：协作任务（P1，独立纵向切片）

**目标**：把“公共装备 / 食物采购 / 行程记录 / 发布任务”变成活动内的轻量 checklist，不做工作流引擎、不做跨活动任务中心。

**数据模型（V1）**

```js
Task = {
  id, activityId,
  title,                 // 必填
  note,                  // 可选说明
  category,              // 'gear' | 'food' | 'logistics' | 'other'
  assigneeName,           // 展示用；V1 不引入跨账号指派授权
  status,                // 'todo' | 'doing' | 'done'
  dueAt,                 // 可选
  created, updated       // Evidence（at/by/note 由服务端覆盖）
}
```

- 新集合 `ot_tasks`；`store.js` 的 `COLLECTIONS`、`schema.js` 的 `stateSpec`、`smoke-test.js` 的 `emptyState()` 三处必须同批改。
- 命令：`task.create` / `task.update` / `task.status` / `task.remove`；进 `commands.js` 的 `handle` 与 `summaries`，进 `permissions.canExecute`。
- 权限（V1，保守）：
  - 组织者：读写。
  - 有 `roster` 能力的协作者：只读。
  - 当前报名人（pending/confirmed/waitlisted）：只读；被指派为负责人时也只读（避免新增“任务负责人可改状态”的第二套权限，等 V2 再开）。
  - 其他人：拒绝。
- 读取：新增 `read {kind:'tasks', activityId}`；或并入 `activityView` 的 `tasks` 字段。推荐独立 `kind:'tasks'`，因为任务页需要独立刷新，且任务增长不应把活动详情响应撑大。
- 事件：写命令通过 `recordChange` 记 ActivityEvent；不自动发通知（任务完成不是全队通知）。
- 上限：每活动 100 条；超过时拒绝并说明，不做静默截断。
- 测试：`tools/tasks-test.js`（领域权限、CAS、跨活动隔离、上限、败者零副作用）+ `scenario-tasks-test.js`（页面/面板）+ `smoke-test.js` + `lab-dryrun-test.js`。
- 部署：**`cloudfunctions/` 改动 ⇒ 必须重新部署 trailApi**；改完 domain 后跑 `node tools/sync-lab.js`，否则 `lab-dryrun` 会红。

**UI 形态**
- 推荐独立页 `pages/tasks/tasks`，从工作台总览和活动详情进入；不把工作台强行扩成 5 个 tab（现有 4 个已经满，任务页又需要给参与者只读入口）。
- 页面：顶部活动名 + “任务清单”标题；筛选「全部 / 待办 / 已完成」；按负责人分组；组织者可新建/编辑/勾选完成；参与者只读；空态说明“还没有任务，组织者可以在这里分工”。
- 任务页与通知页交叉入口：任务页底部“发布现场通知”跳到 `anotices`，不在任务页重做通知编辑器。

### 3.4 明确不做

- 评价/评分/星级、支付/退款/价格、领队认证/平台保障、陌生人私信/聊天、实时位置追踪、活动相册、活动级交通方式筛选（除非先改产品模型）。

---

## 4. 前端工作包

### P0-1 设计基元与图标（Wave 0）

- 图标：现有 `components/icon/icon.js` 有 activity/bell/person/pin/car/check/route/cloud/sun/shield/search/plus/back/arrow/more/close/copy/users/clock/edit/home/alert/download/settings（`icon.js:5-30`）。新增 `filter`、`map`、`list`、`task`、`calendar`、`chevron-up/down`；仍走 SVG data-URI，不引 iconfont。
- 颜色：现有 token 已覆盖原型的森林绿/纸面/页岩灰/暖石色语义（`app.wxss:4-77`；`design-system.md:37-52`）。**不整体替换 `--forest`**；原型的陶土色若只做装饰，按规范不新增；只有出现明确语义（如难度/风险）才在 `app.wxss` 登记并同步 `design-system.md`。
- 字体：保持系统字体栈 + `.tabular`；不引外部字体（包体与加载成本不值得）。
- 复用优先：筛选 chip、结果计数、章节导航先做页面局部类；只有 2 个以上页面共用才提升为全局类/组件。
- 验收：`node tools/check.js`、`node tools/check-handlers.js` exit 0；图标在真机 SVG 渲染正常。

### P0-2 发现页：筛选 + 列表/地图（Wave 1）

**页面**
- `pages/discover/discover` 顶部：标题 + 一句定位 + 「列表 / 地图」 segmented。
- 筛选行：日期范围、难度（组织者标注）、目的地关键词；排序「最新发布 / 最近出发」。
- 筛选面板用 `overlay kind="sheet"`，不把筛选控件铺满首屏。
- 结果计数与清除条件；无结果空态说明“哪个条件把结果清空了”。
- 地图视图：`<map>` + 活动标记；标记点击选中活动并在底部出现活动卡；无坐标活动不画点，列表里仍可见，并有一句“地图仅显示有路线坐标的活动”。
- 首页：保持“我的活动”主任务；把现有「发现活动」入口升级为带封面的编辑式入口，不把首页改成公开信息流。

**后端**
- `read {kind:'discover'}` 增加可选 `filters`（`dateFrom`/`dateTo`/`difficulty`）与 `sort`；在 `selectors.js:440-457` 内过滤、排序；没有参数时行为与现在逐字节一致。
- `discoverView` 增加 `difficulty`（从 `routeSnapshot` 读）；地图继续用已有 `points[].coordinates`，不新增坐标字段。
- 搜索仍在服务端；目的地关键词先走 `title + routeSnapshot.title + description`，不新造地区表。

**测试**
- 新增 `tools/discover-filter-test.js`：日期边界、难度未标注、组合筛选、草稿/取消/归档排除、50 条上限、排序稳定、无 PII。
- 扩展 `tools/scenario-discover-test.js`：列表/地图切换、筛选 sheet、清除、空态、地图标记数量 = 有坐标活动数。
- 真机：筛选组合、地图标记、返回列表后条件保持；375/390 两个宽度。

### P0-3 活动详情：分区导航 + 剖面 + 装备 + 天气摘要（Wave 1~2）

1. **分区导航（先做锚点，不做隐藏式 tab）**
   - 在 hero 下加“概览 / 行程 / 路线 / 装备 / 费用”锚点条，点击滚动到对应 section。
   - 保留首屏的状态 callout、主操作、同行人；不把报名入口藏进 tab。
   - 理由：当前详情页的任务是“判断 + 报名/进入工作台”，不是单纯浏览；隐藏式 tab 会让主操作与状态离开首屏。
   - 如果后续真机证明锚点条太挤，再评估 tab；不在第一版同时做两套。

2. **难度**
   - hero 状态区或行程区增加难度徽标；`未标注` 不显示假星级，只显示「难度未标注」。
   - 路线库与编辑器同步显示/选择。

3. **海拔剖面**
   - 新增纯函数 `miniprogram/utils/route-profile.js`：输入轨迹/节点高程，输出 SVG 几何与读数；不含业务阈值。
   - 新增组件 `components/route-profile/`：
     - 连续模式：`track` 有 ≥2 个 `ele`；
     - 节点模式：只有命名节点 `ele`，明确标“节点高程，非连续剖面”；
     - 无数据：说明缺什么（无轨迹高程 / 无节点高程），不画曲线。
   - 接入活动详情与路线详情；高度、标签、单位在 375/390/414 宽度不重叠。
   - 数据依赖 3.2.3 的 `TrackPoint.ele` 与投影；没有后端扩展前只能做节点模式，**不能**用节点插值冒充连续剖面。

4. **装备分组**
   - 详情装备区分「必带」「建议」；旧数据 `equipment` 全部进必带；空组不渲染空标题。
   - 编辑器装备步骤同步拆两组；`scenario-editor-test.js` 覆盖。

5. **活动级天气摘要**
   - 活动详情“行程/天气”区加一张摘要卡：
     - 出发窗口（用 `startAt`/`endAt`，不新造窗口）；
     - 起点天气：天气短语、温度区间、降水概率、风（来自 `getWeatherByPoint` 的第一天/出发时段）；
     - 风险一句：来自现有 `risks`，不把天气模型包装成保证；
     - 「查看路线天气」入口到 `pages/weather`。
   - 新增纯函数 `miniprogram/utils/weather-brief.js`，只做展示组合，不新增阈值；缺数据/超 14 天/失败各有说明。
   - 缓存/陈旧数据沿用 `weather-cache.js` 语义；旧数据必须带时效。

6. **分日行程（先做诚实版）**
   - 路线节点有 `time` 时，按天分组显示“按轨迹时间推算”；没有时间时显示“未提供分日行程”，不编造 D1/D2/D3。
   - 结构化行程（每天标题/说明/图片）列入 P2。

7. **封面**
   - 继续使用 `utils/covers.js` 氛围图 + 页脚诚实说明；真实活动封面放入 P2，等产品确认。

### P1-1 协作任务页（Wave 3）

- 新页 `pages/tasks/tasks`（5 步注册：文件、`app.json`、`usingComponents`、`styleIsolation`、`check.js`）。
- 入口：`workspace` 总览加“任务清单”行；`activity` 详情加“协作任务”只读入口（仅对可见成员显示）。
- 页面结构：活动头 + 进度摘要（待办 N / 完成 N）+ 筛选 + 负责人分组 + 任务行（状态、标题、说明、截止时间）。
- 组织者操作：新建/编辑 sheet、勾选完成、删除（二次确认，说明影响范围）。
- 参与者：只读，不显示“新建”。
- 组件策略：先页面内实现；若任务行与现有 `list-row` 足够，不新建组件。
- 测试：`tools/scenario-tasks-test.js`（页面状态、权限、空态、失败态、busy 防重）、`tools/tasks-test.js`（领域）、`smoke-test.js`、`lab-dryrun-test.js`。
- 真机：组织者建任务 → 参与者看到 → 完成 → 筛选；至少 3 个真实交互。

### P1-2 天气与活动上下文（Wave 2）

- 活动详情摘要卡（见 P0-3.5）。
- `weather` 页顶部加“出发窗口 / 风险摘要”区：只组合现有 `dayCards`/`oiCard`/`callout` 字段，不新增天气阈值；如果做不出“出发窗口”的可靠结论，就只说“所选日期的天气”，不冒充窗口。
- `weather-hub` 保持工具入口；加“从活动查看”的说明或入口，不改成活动列表。
- 视觉：统一眉题、分区、卡片节奏；图表与算法零改动。
- 测试：`weather-page-test.js` 现有断言不回退；新增 `weather-brief-test.js` 只测摘要组合；真机确认日卡/切窗/图表交互不回归。

### P2 现有页面设计语言收口（Wave 4）

- `editor`：章节导航、字段分组、错误/待补清单；不改发布门与命令。
- `signup`：事实行、出行方式分组、主操作唯一化；不改 CAS 链。
- `routes/route/route-edit`：列表卡、路线 hero、剖面复用、难度显示。
- `me/notices/anotices`：眉题、日期分组、受众徽标、空态说明。
- `staff/vehicle`：触控目标、状态徽标、单主操作；结构不动。
- `weather-chart/space-time`：只统一字体/颜色/留白，保持图表密度。

---

## 5. 分批实施顺序与依赖

| Wave | 内容 | 依赖 | 交付门槛 |
|---|---|---|---|
| **0** | 图标、设计基元、文案/字段盘点、测试基线 | 无 | 静态门 exit 0；不改业务 |
| **1** | schema 可选字段（难度/装备建议/轨迹高程）+ selectors + 发现筛选 + 详情锚点/难度/节点剖面 | Wave 0 | 新字段旧数据兼容；`smoke-test`、`lab-dryrun`、新 `discover-filter`/`route-profile` 绿 |
| **2** | 活动级天气摘要 + 天气页视觉收口 + 连续剖面（如 Wave 1 已落 track ele） | Wave 1 | 天气算法零改动；`weather-page-test` 不回退；真机 |
| **3** | 任务领域 + 任务页 + 工作台/详情入口 | 可与 Wave 1 并行；需独占 `schema/commands/permissions/selectors` 的写权 | `tasks-test`、`scenario-tasks`、`smoke`、`lab-dryrun`；重新部署 trailApi |
| **4** | 现有页面视觉收口 + 可选结构化行程/真实封面 | Wave 1~3 | 逐页静态门 + 真机；不改业务状态机 |

**并行约束（多 Agent）**
- `domain/schema.js`、`domain/selectors.js`、`domain/commands.js`、`domain/permissions.js`、`store.js` 是共享文件，同一时间只允许一个 Agent 写；Wave 1 与 Wave 3 的后端必须串行，或由同一个后端 Agent 一次做完。
- 页面文件按页归属：`discover`、`activity`、`tasks`、`weather` 各自一个 owner；`app.wxss`、`icon.js`、`format.js` 由 Wave 0 owner 统一改。
- 每个 Agent 交付前跑 `git status`，不得把别人的未提交改动卷进来。

---

## 6. 文件级改动清单（预估）

### 后端（Wave 1 / 3）

| 文件 | 改动 |
|---|---|
| `cloudfunctions/trailApi/domain/schema.js` | 难度/装备建议/`TrackPoint.ele`/Task 实体/命令 payload；所有重复 spec 同步 |
| `cloudfunctions/trailApi/domain/selectors.js` | `discoverView` 难度；`activityView` 装备建议与 track ele；discover 过滤/排序；`tasks` 视图 |
| `cloudfunctions/trailApi/domain/commands.js` | task 命令 switch + summaries |
| `cloudfunctions/trailApi/domain/permissions.js` | task 读写权限 |
| `cloudfunctions/trailApi/domain/tasks.js`（新） | task 处理器 |
| `cloudfunctions/trailApi/store.js` | `ot_tasks` 集合 |
| `cloudfunctions/trailApi/smoke-test.js` | `emptyState()` + 新断言 |
| `tools/sync-lab.js` | 同步 lab 副本；改完 domain 必跑 |
| `cloudfunctions/trailApiLab/domain/*` | 由 `sync-lab.js` 生成，不手改 |

### 前端（Wave 1~4）

| 文件 | 改动 |
|---|---|
| `miniprogram/pages/discover/*` | 筛选、排序、列表/地图、空态 |
| `miniprogram/pages/activity/*` | 锚点导航、难度、剖面、装备分组、天气摘要、分日行程（诚实版） |
| `miniprogram/pages/tasks/*`（新） | 任务页 |
| `miniprogram/pages/workspace/*` | 任务入口、分区头微调 |
| `miniprogram/pages/weather/*`、`weather-hub/*` | 摘要区与视觉收口 |
| `miniprogram/pages/editor/*`、`route-edit/*`、`route/*`、`routes/*` | 难度/装备建议/剖面 |
| `miniprogram/components/route-profile/*`（新） | 剖面渲染与三态 |
| `miniprogram/components/icon/icon.js` | 新图标 |
| `miniprogram/utils/route-profile.js`（新） | 剖面几何纯函数 |
| `miniprogram/utils/weather-brief.js`（新） | 天气摘要纯函数 |
| `miniprogram/utils/format.js` | 难度标签、任务状态/分类标签（单源） |
| `miniprogram/app.wxss` | 只在有复用价值时加类/token；同步 `design-system.md` |

### 文档/门禁

- `SYNC.md`：每轮变更日志，注明是否需重新部署 trailApi。
- `AGENTS.md`：更新门禁套件数量与断言数（以脚本自打印 `passed=N` 为准）。
- `docs/ui-ux-redesign/design-system.md`：新增类/token 必须登记。
- `docs/testing/release-coverage-matrix.md`：任务命令/错误码加入覆盖矩阵（若新增错误码）。

---

## 7. 验证与上线

### 7.1 每批必跑

```bash
node tools/check.js
node tools/check-handlers.js
node cloudfunctions/trailApi/smoke-test.js
node tools/journey-graph-test.js
node tools/scenario-discover-test.js      # 修改发现页后
node tools/scenario-activity-test.js      # 修改详情页后
node tools/scenario-editor-test.js        # 修改编辑器后
node tools/scenario-workspace-test.js     # 修改工作台后
node tools/weather-page-test.js           # 修改天气页后
node tools/lab-dryrun-test.js             # 改过 domain 后
node tools/sync-lab.js                    # 改过 domain 后
```

新增套件：
- `tools/discover-filter-test.js`
- `tools/route-profile-test.js`
- `tools/tasks-test.js`
- `tools/scenario-tasks-test.js`
- `tools/weather-brief-test.js`

### 7.2 真机（微信开发者工具）

- 每轮改 WXML/WXSS/组件结构后必须真机；静态门通过 ≠ 页面正常。
- 三道门槛：bundle 新鲜（新文案自证）、注入载荷是生产形状全集、每个用例 `reLaunch` + 独立 `updatedAt` + 污染自证。
- 必测：发现筛选组合 / 地图标记 / 返回列表条件保持；详情锚点 / 剖面三态 / 装备分组 / 天气摘要；任务新建→参与者可见→完成→筛选；375 与 390 两个宽度。
- 未跑就写 `UNVERIFIED`/`NOT_RUN`，不得用 `page.data()` 读数冒充像素证据。

### 7.3 部署

- 动过 `cloudfunctions/`：重新部署 `trailApi`，并把控制台超时改回 20 秒（CLI 部署不继承）。
- 改过 `domain/` 或 `store.js`：先 `node tools/sync-lab.js`，再跑 `lab-dryrun`。
- 前端照片/包体：新增资源前先算主包体积；当前氛围图约 520KB，主包上限 2MB。

---

## 8. 风险与默认决策

| 风险/决策 | 默认值 | 理由 |
|---|---|---|
| 难度来源 | **组织者标注**，三档 + 未标注 | 自动推导会造出没有依据的难度；未标注必须可见 |
| 详情布局 | **锚点导航**，不做隐藏式 tab | 保留首屏状态与主操作；tab 会藏起报名/工作台入口 |
| 任务权限 | **V1 组织者写、协作者/报名人只读** | 避免新增第二套跨账号授权；负责人可改状态放 V2 |
| 真实活动封面 | **暂缓**，继续氛围图 + 诚实脚注 | 需要上传、存储、审核、schema；不是本轮 P0 |
| 活动级交通方式筛选 | **不采纳** | 当前 `Trip.mode` 是报名人级，活动级筛选会改变语义 |
| 评价/价格/支付 | **不做** | 与零金额纯工具定位冲突 |
| 导航 | **不变**：活动/天气/通知/我的 | 用户习惯与深层链接；发现仍是二级页 |
| 字体 | **系统字体 + tabular** | 外部字体包体/加载成本高，收益低 |

**需要产品拍板的最小集合**：
1. 难度是否按“组织者标注”落地（推荐是）。
2. 是否接受详情页先用锚点导航、不做 tab（推荐是）。
3. 任务 V1 是否只让组织者写（推荐是）。
4. 真实活动封面是否继续暂缓（推荐是）。

---

## 9. 验收口径（整轮）

1. 原型四组页面都能在当前产品里找到对应路径，且没有引入价格/评价/陌生人市场模型。
2. 发现页：筛选、排序、列表/地图、空态、无坐标活动说明全部可用；条件返回后保持。
3. 详情页：锚点导航可用；难度/装备分组/剖面/天气摘要四块中至少三块有真实数据路径；无数据时说明缺什么，不伪造。
4. 协作页：任务 CRUD、权限、空态、失败态、CAS 正常；通知入口不割裂。
5. 天气页：现有算法与图表零改动；摘要只读现有数据；概率语气与陈旧数据时效不回退。
6. 所有新增门禁绿；既有套件不得因本轮出现新的常驻红；真机证据按 390/375 两档归档。
7. `cloudfunctions/` 若改动，交付说明必须写「需重新部署 trailApi」+ `sync-lab` 已跑。

---

## 10. 建议的开工顺序

**先 Wave 1（发现 + 详情基础），再 Wave 2（天气摘要），最后 Wave 3（任务）。**
原因：
- 发现与详情是原型的最大视觉/决策缺口，且大部分能复用现有数据（地图坐标、节点高程、天气接口），风险最低。
- 任务需要新集合、命令、权限、选择器与重新部署，是独立纵向切片，适合在发现/详情稳定后单独推进。
- 天气算法已经很强，先补“活动上下文摘要”即可，不应在视觉轮里动引擎。

---

## 11. Wave 1 / Wave 2 落地状态（2026-10-20）

**Wave 1 已完成**
- 后端可选字段：路线难度、装备建议、轨迹高程；发现筛选/排序；活动与路线投影。
- 发现页：日期/难度筛选、最新发布/最近出发排序、列表/地图、结果计数、筛选空态。
- 活动详情：分区锚点、难度徽标、必带/建议装备、海拔剖面（连续/节点/无数据）。
- 路线详情复用剖面；编辑器/路线库接难度与建议装备。
- 新增 `tools/discover-filter-test.js`（21）与 `tools/route-profile-test.js`（27）；受影响套件与关键 E2E 已跑，`check.js`/`check-handlers.js` 全绿。
- `cloudfunctions/` 已改 ⇒ **需要重新部署 trailApi**；`sync-lab` 已跑。

**Wave 2 已完成**
- 活动详情「出发日天气」：只查起点、只看出发日；精确小时缺失时只给全天，不拿 00:00 冒充；超 14 天/不可用/无出发时间/无起点各有文案；陈旧数据带取数时间。
- 新增 `utils/weather-brief.js`（纯组合、不新增阈值/不重算天相）与 `tools/weather-brief-test.js`（21）；`scenario-activity` 138→144。
- 移除了路线区重复的「天气参考」入口；天气页本身已具备日卡/OI 摘要，未重复堆叠。
- `cloudfunctions/` 零改动 ⇒ Wave 2 不新增部署面（Wave 1 的 trailApi 重部署仍在账上）。
- 真机截图 `activity-weather-card.png` 已在 306×660 验证可读。

**Wave 3 已完成（代码与门禁）**
- 新增 `domain/tasks.js`、`ot_tasks` 集合、`task.create/update/status/remove`、`read {kind:'tasks'}`；owner-only 写、参与者/协作者只读、归档/取消只读、草稿删除级联。
- 新增 `pages/tasks/tasks`（列表/筛选/计数/新建/编辑/状态/删除），入口在工作台与活动详情。
- 新增 `tools/tasks-test.js`（27）、`tools/scenario-tasks-test.js`（24）与 `tools/e2e-task-test.js`（28，A 层信封）；smoke 176、lab-dryrun 165、lifecycle-* 与 quick-create 全绿。
- **`cloudfunctions/` 已改 ⇒ 已部署 trailApi + trailApiLab**（Active/timeout 20，线上包逐字节一致）；`sync-lab` 已跑。
- 真机已截图 owner/参与者/新建 sheet；并用真实账号「测试活动」跑通真实云端创建→进行中→删除，活动本身未改动。

**真机**
- 已获授权 `close --project` → `open` → `auto`（不 `quit` IDE）刷新 bundle；重编译后断言 `viewBox=0 0 280 160`。
- `activity-route-profile.png`：y 轴 4,660 / 3,930 / 3,200，x 轴 0 / 43.9 km，在 306×660 视口可读 ⇒ **剖面 VERIFIED**。
- 发现筛选 sheet、列表/地图切换、详情分区锚点已重拍。
- **地图底图 UNVERIFIED**：腾讯地图 attribution、2 个 marker、失败兜底文案可见，但瓦片空白，判断为 IDE 地图瓦片/网络环境；真实底图需真机复核。
- 证据与结论上限见 `docs/ui-ux-redesign/evidence/wave1-2026-10-20/README.md`。
