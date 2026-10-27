# 快速创建与可后补路线 — 设计 Spec

**日期：** 2026-10-14 · **基线：** `78d7db9`（master）
**需重新部署 trailApi：是**（切片 1–2 动 `cloudfunctions/trailApi/domain/`）· **trailApiLab 同步：是**（`tools/sync-lab.js`）
**诉求来源：** 用户 2026-10-14 原话：「轨迹能够解析出来的项，全部设置为可忽略，不必选层级吧，方便快速创建活动，也允许后续更改。避免冷启动代价太大的问题。」

---

## 1. 背景：冷启动代价花在哪

现状创建活动有两条路，**发布门却只有一道**：

| 路径 | 轨迹自动给出 | 仍要手填 |
|---|---|---|
| 导 GPX | 路线名称（文件名）、节点（名称/类型/坐标/时刻/高程）、里程、爬升、轨迹折线、风险建议、装备建议 | 活动名称、三个时间、上车点、名额 |
| 不导轨迹 | 无 | 以上全部，且要点名每个节点、逐条写风险问答 |

而 `domain/activity.js:18-29`（`validateInput(full=true)`）+ `domain/invariants.js:55-57`（每条命令落库前全量断言）把 **8 项**钉在发布门上：标题、三个时间、≥1 上车点（名称+地址+集合时间）、路线名称、≥1 路线节点（每个有名称）、≥1 风险（问答齐全）。其中 **5 项恰好是轨迹可解析项**。结论：发布门在惩罚「不带轨迹的发起」——熟人圈一句「周六青城山，早八点地铁口集合」本该能先发，细节后补。

**关键勘察结论（2026-10-14 实测）：**

| 层 | 现状 | 放开后的风险点 |
|---|---|---|
| `schema.js` | `RouteSnapshot.title/points/risks` 本就允许空串/空数组 | **零 schema 改动**；阻塞全在校验层 |
| `invariants.js:55-57` | 非 draft/非 cancelled 强制 pickups/points/risks 非空，经 `commands.js:164` 对**每条命令**生效 | 只改 `activity.js` 不改它 ⇒ 该活动此后任何命令全红 |
| `activity.js:110` | published 的 edit 也跑 `full` 校验 | 不放宽 ⇒「发布后补」存不进去空值 |
| 阶段锁 `activity.js:104` | gathering/active 整体锁死 `routeSnapshot`/`pickupPoints` | 发布时留空的路线，出发后**永远补不回来** |
| 下游耐受 | points 空：`field.js:145` 节点确认必拒、`selectors.js:607` 仍广播 `attendance.node` 且 `pointId=''`（必然红字的按钮）；risks 空：域内零消费者；pickups 空：`signup.js:35` 拼车禁入、`invariants.js:81` 车辆禁建 | 渲染层普遍有兜底（`space-time` 显「还没有可画的路线节点」、报名页 `PICKUP_MISSING`），**缺的是显式待完善，不是兜底** |
| 独立 oracle | `tools/lifecycle-harness.js:212` `O-PUBLISH-SHAPE` 不复用 invariants，自带同一断言 | 必须同源修改，否则 6 套生命周期门禁红 |
| Lab 副本 | `cloudfunctions/trailApiLab/domain/` 逐行同款 | `node tools/sync-lab.js` 双份落盘 |

## 2. 范围

**做：**

1. **发布门重定义**：必填只剩「这是一场什么活动」——标题 + 三个时间（截止 ≤ 出发 < 结束不变）+ 名额（默认 24，前端已钳制 1–500）。集合上车点维持必填（决策 D1 推荐案），但成本再降（一键派生，§3.5）。
2. **轨迹可解析项全部改可选**：路线名称、节点、里程、爬升、轨迹折线、风险、装备。**条目级完整性保留**——填了的必须完整（节点有名称、风险有问答、上车点三要素齐），整体可为空。
3. **「知情跳过 + 显式待完善」**：可忽略 ≠ 静默缺失。编辑器分「阻断项 / 可后补项」两张清单；发布确认层明示后补项；详情页、工作台待办、首页卡片全部显式说「待完善」并可一键跳编辑。
4. **发布后可补**（决策 D2 推荐案）：published 全可补；gathering/active 的阶段锁从「整体 JSON 锁」改为「只增不改」。
5. **selectors 单源补投影**：`completeness` 派生字段 + `attendance.node` 不再对空路线广播。

**不做（明确排除）：**

- 集合上车点改可选（D1 备选 B；连锁清单见 §6.1，拍板后另开切片）
- 三步向导结构重组（步骤标签/渐进披露不动，只改文案与清单）
- 报名、车辆、分车链路任何放松（拼车约束一字不动）
- 提醒/通知自动催办（待完善只做可见与可达，不 push）

## 3. 设计

### 3.1 字段两分类（对「不必选层级」的落地）

只有两类，没有中间层（没有"软必填""推荐填"——那正是层级）：

| 类 | 字段 | 语义 |
|---|---|---|
| **必填（拦路）** | `title`、`startAt`/`endAt`/`deadlineAt`（顺序校验保留）、`capacity`（默认 24）、`pickupPoints`（D1=A 时） | 缺一项，发布按钮点名拦截 |
| **可忽略（可后补）** | `routeSnapshot.title`、`routeSnapshot.points`、`routeSnapshot.risks`、`routeSnapshot.distanceKm/ascentM/track`、`equipment` | 缺失不拦路；**以显式「待完善」出现在每个该出现的界面上**，发布后随时可补 |

可忽略项的缺失永远长成「待完善 + 去补的入口」，不长成空白、更长成"工具坏了"（继承 AGENTS.md 铁律：看不见的缺失在替看得见的结论投票）。

### 3.2 发布门（域层，切片 1）

`domain/activity.js` `validateInput(state, ownerId, input, full, activityId)` 的 `full` 分支改写：

```js
if (full) {
  if (!input.title.trim() || !input.startAt || !input.endAt || !input.deadlineAt
    || !input.pickupPoints.length                                  // D1=A；D1=B 时去掉
    || input.pickupPoints.some(p => !p.name.trim() || !p.address.trim() || !p.meetingAt)) {
    return failure('INVALID_INPUT', '发布需要完整的标题、活动时间与集合信息。')
  }
  // 条目级完整：填了的必须完整，整体可为空
  if (input.routeSnapshot.points.some(p => !p.name.trim())
    || input.routeSnapshot.risks.some(r => !r.title.trim() || !r.advice.trim())) {
    return failure('INVALID_INPUT', '已填写的路线节点需要名称，风险提示需要问题与应对方式。')
  }
  if (时间顺序不合法) return failure('INVALID_INPUT', '截止时间不能晚于开始时间，结束时间必须晚于开始时间。')
}
```

`domain/invariants.js:55-57` 同源放宽（去掉 `points.length`/`risks.length` 断言；pickups 视 D1）；`tools/lifecycle-harness.js:212` `O-PUBLISH-SHAPE` 同步改写。错误码不变（仍 `INVALID_INPUT`），不新增码。

存量活动全部满足更松的规则，**无数据迁移**。已填完整的活动发布载荷前后逐字节相同（对拍验收，§4）。

### 3.3 阶段锁「只增不改」（域层，切片 2）

`activity.js:104` 的 `lockedKeys` 整体 JSON 比对拆成三组：

| 组 | 键 | gathering/active 规则 |
|---|---|---|
| 交易性 | `title`、`startAt`、`deadlineAt`、`capacity`、`approvalMode`、`acceptingSignups`、`routeId` | 维持整体锁（这些是跟已报名者谈定的交易） |
| 信息性数组 | `routeSnapshot.points`、`routeSnapshot.risks`、`pickupPoints` | **只增不改**：按 id 逐条 JSON 比对，已存在的条目必须逐字节相同；纯新增放行 |
| 信息性标量/文本 | `routeSnapshot.title/distanceKm/ascentM/track`、`description`、`equipment`、`feeNote`、`cancellationNote` | 可改（纯展示，无履约后果） |

`endAt` 只可延长的既有规则不变。**为什么安全**：删改已被既有引用守卫拦住（`activity.js:36-44`：报名/车辆引用的上车点不能删、履约记录引用的节点不能删）；纯新增不改变任何已发生事实，`attendance.node`/分车/报名只认当时存在的条目。

### 3.4 显式待完善（客户端，切片 3）

**单源投影**：`selectors.activityView/discoverView` 增派生字段

```js
completeness: { route: !!title.trim(), points: !!points.length, risks: !!risks.length, pickups: !!pickupPoints.length }
```

一处派生，所有消费方不再各自判空（现在 home/discover 各自 `|| '路线待完善'` 就是漂移源）。

**编辑器 `pages/editor`：**

- `missingForPublish()` 收窄为阻断清单（标题/时间/顺序/名额/上车点）；新 `deferredForPublish()` 给可后补清单（路线名称、≥1 节点、≥1 风险，仅在该类整体缺失或条目不全时出现，各带 `step`）。
- `onPublishIntent()`：有阻断 ⇒ 照旧跳步骤点名；无阻断但有后补 ⇒ 静默保存后弹发布确认，弹层内多一行「路线节点、风险提示尚未填写，发布后随时可补」+「去补上」（跳第一个后补步骤）/「仍然发布」。**知情跳过，不是静默跳过。**
- GPX 卡片补对称文案：「没有轨迹也能先发布——路线、风险都可以发布后补」；步骤 1/3 标题加「（可后补）」轻提示。

**详情页 `pages/activity`：** 节点/风险/上车点三个区块补「待完善」空态卡（点击进编辑器对应步骤）；`routeTitle` 已有「路线待完善」兜底；里程/爬升为 0 时不显示（现状会印「路线待完善 · 0 km」——home/discover 同款修正）。

**工作台待办 `utils/journey.js` `leaderQueue`：** draft 项 detail 改口径（「需要标题、时间与集合点」）；published 后若 `completeness.route/points/risks` 有缺，增**非阻塞**项「完善路线与风险」→ 跳编辑。非阻塞：不拦路，但看得见。

**现场/空图：** `field-panel` 节点选择器空时显示「这场活动还没有路线节点，可先在编辑里补」；`space-time` 已有空图文案不动；`selectors.js:607` `attendance.node` 广播加 `points.length > 0` 门（贯彻该文件 :590-591 自述的原则：不广播，UI 就没有必然红字的按钮）。

### 3.5 一键派生集合点（切片 4）

GPX 应用后若上车点为空，「用起点作为集合点」按钮：带起点坐标与名称，集合时间默认出发前 30 分（复用 `onPickupQuickTime` 的 `-30` 口径）。路线库预填入口同款。把 D1=A 的必填成本压到一次点击。

### 3.6 Lab 与部署

切片 1–2 改完跑 `node tools/sync-lab.js`（复制 `store.js` + `domain/*.js` + `node --check` 产物），重新部署 trailApi。客户端改动不涉及部署。

## 4. 切片计划与验收

| 切片 | 内容 | 验收 |
|---|---|---|
| 1 域层发布门 | `activity.js` full 改写 + `invariants.js` 放宽 + `lifecycle-harness.js` 同源改写 + `e2e-domain-negative-test.js:185-197` 期望更新 + 新建 `tools/quick-create-test.js` + Lab 同步 | 新套件覆盖：空路线发布 ok / 有节点无风险 ok / 条目缺名拒 / 时间顺序拒 / published 后补节点 ok / 完整活动发布载荷与 `git archive 78d7db9` 对拍逐字节相同；全量门禁零回归 |
| 2 阶段锁只增不改 | `activity.js` lockedKeys 三组化 + `e2e-interleave-test.js` C6 更新（改 title 仍 WRONG_PHASE；新增节点 ok；改已有节点名 WRONG_PHASE；删被引用节点 INVALID_INPUT） | 同上 + 变异自证（「整体锁恢复」「新增也禁」「只禁新增不禁改」各 1 条） |
| 3 待完善机制 | `selectors.js` completeness + editor 双清单/发布弹层 + activity 空态 + journey 非阻塞待办 + field-panel 空态 + attendance.node 广播门 + `scenario-editor-test.js:470-521` 重写 + `journey-test.js` 更新 | 对拍：完整表单发布链路前后一致（阻断集合只瘦不胖）；空表单发布链路：阻断清单只剩标题/时间/名额/上车点；e2e-ui 不回归 |
| 4 一键派生 | GPX/路线库预填后「用起点作为集合点」+ 各处文案对称 | 真机走查（GPX 导入 → 一键派生 → 发布）；无轨迹流：标题+时间+一个上车点 → 发布 |

**铁律（继承 AGENTS.md）：** 每切片独立可回滚；用户可见变化必须对拍/变异自证；完整活动的行为零变化要对拍到字节级；真机未跑记 UNVERIFIED；`cloudfunctions/` 改动 ⇒ 双副本同步 + 重新部署。

## 5. 风险

| 风险 | 应对 |
|---|---|
| 放宽 invariants 后漏改某处独立 oracle | 摸底已列全 6 处（invariants/activity/lifecycle-harness/e2e-domain-negative/scenario-editor/trip-mode 间接），切片 1 逐个人工过 |
| 空路线活动混入报名期，参与者看不到风险说明 | completeness 投影 + 发布确认知情跳过 + 详情页待完善卡 + 工作台非阻塞待办，四层可见 |
| gathering 只增不改被滥用成「边出发边改路线」 | 交易性键仍锁；数组只增不改；既有引用守卫兜底；变异测试盯「恢复整体锁」 |
| D1=B（上车点可选）若拍板要做 | 连锁：signup shared 禁选文案、vehicle.save 前置提示、allocation/transport 空态、journey 增「设集合点后才能拼车」——按 §6.1 清单另开切片，不混入本 spec |
| 门禁夹具里的时间引信 | 新套件一律 `Date.now()` 偏移，不写绝对日期（2026-10-10 e2e 红教训） |

## 6. 待决策（实现前需拍板）

### D1 集合上车点：维持必填，还是也改可选？

- **A（推荐）维持必填 + §3.5 一键派生。** 上车点不是轨迹可解析项，且是拼车/分车/车辆/报名的锚（`signup.js:35`、`invariants.js:81`、`allocation.js:76`）。必填成本已被地图选点 + 自动命名 + 集合时间快捷 chips 压得很低，GPX 流程再压到一次点击。
- **B 改可选。** 冷启动真·最小 = 标题 + 三个时间。连锁：shared 报名禁选（UI 收起 + 域层已有校验兜底改文案）、`vehicle.save` 前置「先设集合点」、transport/allocation 面板空态、journey 增非阻塞「设集合点后才能拼车」、`trip-mode-test.js:400-403` 周边重写。工作量约为 A 的 3 倍，且拼车链路整体降级需要显式话术而非静默失败。

### D2 gathering/active 阶段锁：改成「只增不改」？

- **做（推荐）。** 否则发布时留空的路线出发后永远补不回来，「允许后续更改」落空；而把完整性门挪到 `published→gathering` 推进处，等于把冷启动代价挪到出发前夜，更糟。
- **不做。** 则需在 transition 入口加「还缺路线节点/风险」确认门，且接受「无清点活动」形态。

### D3 「不必选层级」的解读

本 spec 按「**不设必填层级，字段只分必填/可忽略两类**」落地（§3.1）。若原意是别的（如去掉三步向导、或指点名方式），请纠正后我再改设计。
