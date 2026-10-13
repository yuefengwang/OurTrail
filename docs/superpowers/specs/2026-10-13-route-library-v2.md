# V2.0 路线库 — 实施 Spec

**日期：** 2026-10-13 · **基线：** `1108bb6`（master，= origin/master）
**分支：** `win/route-library-v2` · **需重新部署 trailApi：是**（切片 1 起动 `cloudfunctions/`）
**对应产品文档：** `docs/product/V2-路线与交通协作网络.md`（§5 路线库 / §5.7 一键生成 / §6 分段天气）

---

## 1. 背景：已有的地基（勘察结论，2026-10-13）

| 层 | 现状 |
|---|---|
| 集合 | `ot_routes` 已在 `store.js` COLLECTIONS，随全量 loadState 读写 |
| 数据模型 | `domain/schema.js`：`Route = {id, ownerId, title, distanceKm, ascentM, points[], risks[], track?}`；`RouteSnapshot` 与之同构少 ownerId；`RouteRisk = {id, title, advice}`；`RoutePoint = {id, name, kind, coordinates?, time?, ele?}` |
| 写入路径 | **只有一条隐式路径**：`activity.create/edit` 时 `persistPrivateRoute`（`domain/activity.js:49-57`）把 routeSnapshot 深克隆成私有路线并回填 `activity.routeId`。**没有任何 `route.*` 命令** |
| 读取路径 | `index.js` ROUTES 13 个 action 无一读 route；`selectors.js` 无 routeView。`ot_routes` **从未被读出给客户端** |
| 权限 | `permissions.js` 0 处 route；归属校验只嵌在 `activity.js:14`（routeId 必须属于本人）与 `invariants.js:27-29` |
| 客户端 | 无 route 页面（17 页）；`pages/editor` 已有完整 GPX 导入（`utils/gpx.js`：parseGpx/measure/simplifyTrack/suggestTrailInfo/wgsToGjs 等）；活动详情页内联 `<map>` 渲染 routeSnapshot |
| 天气 | `getWeather(activityId, pointId, date)` 按节点查（index.js:165-210）；`getWeatherByPoint(lat,lng,date)` 纯坐标；`utils/route-schedule.js` 已能按出发时刻推算每节点 `arriveAt/elapsedMin/dayIndex` |
| 坐标约定 | **GCJ-02 全站存储**；GPX 导入时 WGS-84→GCJ-02（gpx.js）；云函数查天气前 gcjToWgs |
| Lab 副本 | `cloudfunctions/trailApiLab/domain/` 与生产 domain 当前逐字节一致 ⇒ 每片改动必须双份同步 |

## 2. 范围

**做（本 spec 四个切片）：**

1. **路线独立生命周期**（领域层）：`route.create / route.update / route.delete` + `readRoutes` 读取 action（列表 + 单条）。路线从"活动副产品"变成用户可主动管理的资产。
2. **路线库 UI**：`pages/routes`（我的路线列表）+ `pages/route`（详情：地图/节点/风险/统计/被引用活动）。入口挂「我的」页，不动 tabBar。
3. **从路线一键生成活动**：editor 增加「从路线库选择」，预填后走既有 `activity.create`（routeId 归属校验已存在）。
4. **路线分段天气**：route 详情页逐节点展示天气（复用 `getWeatherByPoint`，零云函数改动）；有出发时刻时按 `route-schedule` 的预计到达日切日。

**不做（明确排除，留 V2.1+/V3）：**

- 公开路线 / 圈子路线（V3）；路线审核流；社区反馈
- 独立版本表（用快照冻结语义替代，见 §3.4）
- KML/KMZ 导入（P2 spec 已排期，另行）
- 风险点照片、节点图文（需云存储）
- 评价与信用（V2.2）
- 司机/车辆/供应商（V2.1）

## 3. 设计

### 3.1 数据模型变更（schema 严格模式：RouteSnapshot 与 Route 必须同步）

```js
Route / RouteSnapshot 新增（全部 optional，旧活动零影响）：
  updatedAt    instant   路线最近保存时间（selectors 列表排序/展示用）
  source       enum['gpx','manual','copy']   来源标记；persistPrivateRoute 落 'copy'
  visibility   enum['private','shared']      默认 'private'（specDefault 保证旧记录可读）
  sharedWith   id[]      被授权协作者的 userId 列表（身份码授权，同 membership 模式）

RouteRisk 新增（optional）：
  severity     enum['low','mid','high']
  coordinates  Coordinates | null   风险点坐标（活动详情地图可标；无坐标不标）

RoutePoint 不改。
```

`sharedWith` 是**身份码（userId）列表**而非 openid 明文——与 `membership` 既有协作授权同构，`readAccess` 已有先例。

### 3.2 命令族（domain/routes.js）

| type | 权限 | 行为 |
|---|---|---|
| `route.create` | 任何登录用户 | 入参 = RouteSnapshot 字段；落 `state.routes`（ownerId=actor, id=genId, source, updatedAt, visibility='private'）；返回 targetIds=[routeId] |
| `route.update` | owner | 整单替换 points/risks/track/title/distance/ascent/sharedWith/visibility；updatedAt=now |
| `route.delete` | owner | **仅当无活动引用**（`activities.some(a => a.routeId === id)` → `CONFLICT`「有 N 个活动正在使用此路线」）；删除不产事件（草稿级资产，无受众） |

- 幂等/CAS/回执：走 `commands.js` 既有 `reduceCommand` 管道，本模块只提供 `handleRoutes`，与 `handleActivity` 等同构。
- `recordChange`：route 命令不挂活动 ⇒ 提前 return（同 `activity.delete` 的处理）。
- 错误码复用 `contracts.js`：`INVALID_INPUT / FORBIDDEN / NOT_FOUND / CONFLICT`，不新增码。

### 3.3 读取（selectors + index.js）

- `selectors.js`：`routeView(route, actorId, state)` → 私有字段投影（sharedWith 不投影给非 owner 客户端？——**投影给 owner 即可**，列表页只给 owner 用，sharedWith 在详情页编辑授权时回显）；`routeListItem`（列表用：title/distance/ascent/points 数/risks 数/updatedAt/source/被引用活动数）。
- `index.js`：新增 action `readRoutes`（payload: `{routeId?}`）——无 routeId 返回本人路线列表（含被授权 Shared 的），有则返回单条 + 其引用活动 id 列表。权限：owner 或 sharedWith 含 actor，否则 NOT_FOUND（不泄露存在性）。
- `utils/api.js` 对应封装 + 各调用点 `.catch()`。

### 3.4 版本语义（不做版本表的依据）

`activity.create` 时 routeSnapshot 已深克隆冻结（现有 `persistPrivateRoute` 语义）⇒ 「活动关联当时使用的路线」天然成立。route.update 不影响历史活动。V2.5 再评估显式版本。

### 3.5 分段天气（切片 4，零云函数改动）

- 复用 `getWeatherByPoint(lat,lng,date)`：节点无坐标 → 该节点记「无坐标」不查。
- 日期选择：默认今天起 14 天窗口内；若用户在 route 详情页填了「计划出发时刻」，用 `route-schedule.schedule(points, startAt)` 的 `arriveDate` 逐节点切日（已有纯函数 + 测试）。
- 展示：每节点一行/一卡（温度/降水/风/云量徽标），与活动页天气卡视觉同源（`pages/weather` 的卡组件模式）。

## 4. 切片计划与验收

| 切片 | 内容 | 验收 |
|---|---|---|
| 1 领域层 | `domain/routes.js` + schema/selectors/commands/index 落点 + **trailApiLab 同步** | `tools/routes-test.js`（新建，覆盖：CRUD、越权、删除被引用冲突、sharedWith 授权读、幂等回放、schema 严格拒绝旧字段）+ 全量门禁 63 套零回归 |
| 2 UI | `pages/routes` + `pages/route` + api 封装 + 「我的」页入口 | check.js 四件套/组件注册门过；`tools/e2e-ui-test.js` 不回归；真机走查（列表→详情→地图） |
| 3 一键生成 | editor「从路线库选择」→ 预填 → activity.create(routeId) | 对拍：预填结果与手工 GPX 导入等价；归属校验（他人路线 FORBIDDEN）有测试 |
| 4 分段天气 | route 详情逐节点天气 + 出发时刻推算 | 复用 gpx/route-schedule 既有测试；真机抽样 |

**铁律（继承 AGENTS.md）：** 每个切片独立可回滚；生产行为变化必须对拍/变异自证；真机未跑记 UNVERIFIED 不冒充 PASS；`cloudfunctions/` 改动 ⇒ 两个副本同步 + 重新部署 trailApi（流程见 `docs/e2e-mp/automation-playbook.md`）。

## 5. 风险

| 风险 | 应对 |
|---|---|
| schema 严格模式加字段破坏存量活动 | 全部 optional + specDefault；对拍旧 activity.create 载荷 |
| readRoutes 全量 loadState 性能 | routes 集合小（私有资产）；列表投影在 selectors 纯函数内完成 |
| 删除路线与活动快照的耦合 | 删除前引用计数检查（CONFLICT），不做级联 |
| 双云函数副本漂移 | 每片改动同一提交内双份落盘，diff --no-index 校验一致 |
