# OurTrail 业务状态机逆向（代码事实版）

> **依据**：GitHub HEAD `1acd55e`（2026-10-04），工作树与 HEAD 一致（仅未跟踪的 docs/testing/）。
> **方法声明**：本文全部结论逐条来自当前代码（`cloudfunctions/trailApi/**`、`miniprogram/**`、`tools/**`），
> 未采信 README、测试名称或任何规格描述。与 `docs/product/` 规格冲突处，以代码为准并在 §14 标注。
> **用途**：P0/P1 E2E 测试设计的唯一业务事实来源。设计测试时不需要再读 domain 源码；
> 但每条规则的出处都给了 `文件:行号`，需要深挖时可直达。

---

## 0. 阅读地图

| 关注点 | 唯一权威位置 |
|---|---|
| 动作路由、幂等信封、CAS、evidence 覆写、鉴权总闸 | `cloudfunctions/trailApi/index.js` |
| 全局 revision、事务 CAS、collection 映射、文档主键 | `cloudfunctions/trailApi/store.js` |
| 命令调度、幂等回执、事件/通知自动发布 | `domain/commands.js` |
| 活动创建/编辑/发布/推进/取消/删除 | `domain/activity.js` |
| 报名提交/审核/递补/取消/编辑/同行组 | `domain/signup.js` |
| 车辆与乘车安排 | `domain/transport.js` |
| 现场履约（签到/上车/出发/返程/节点/到家/位置/异常/发车） | `domain/field.js` |
| 资料/同行人/协作授权 | `domain/profile.js` |
| 通知发布/已读/投递、导出审计 | `domain/notices.js` |
| 分车预览（纯函数，绝不重排已有座位） | `domain/allocation.js` |
| 全部授权判断 | `domain/permissions.js` |
| 落库前关系完整性 | `domain/invariants.js` |
| 全部实体字段与状态枚举 | `domain/schema.js` |
| 各读取动作的投影与权限门 | `domain/selectors.js` |
| 客户端唯一云调用层（requestId 生成、CONFLICT 自愈） | `miniprogram/utils/api.js` |

实体 → collection（`store.js:7-22`，主键规则 `store.js:25-29`）：

| State 数组 | collection | 文档主键 |
|---|---|---|
| profiles / routes / activities / groups / signups / vehicles / memberships / incidents / events / notices | `ot_*` 同名 | `record.id` |
| **assignments / attendance / positions** | `ot_*` 同名 | **`signupId`**（一人一文档；position.report 用同键覆写） |
| receipts | `ot_receipts` | `actorId + '__' + requestId` |
| （全局）revision | `ot_meta/main` | `{revision, savedAt}` |
| （旁路）天气缓存 | `weather_cache` | 坐标 2dp 网格+日期，仅 getWeather/getWeatherByPoint 读写 |

---

## 1. 全局机制（所有命令共享）

### 1.1 调用拓扑

小程序任何页面 → `utils/api.js`（唯一 `wx.cloud.callFunction` 站点）→ 云函数 `trailApi`（appid `wx1227a277a3f2f7ea`，环境 `cloud1-d9ghcm034574b9d55`，`miniprogram/config.js`）。
另有第二个云函数 `trailApiLab`（预演沙盒，见 §15.8），生产页面只在 `pages/lab` 使用它。

`index.js:264-267`：无 openid 时除 `getWeather`/`getWeatherByPoint`（`lib/weather.js:222` FREE_ACTIONS）外一律 `AUTH_REQUIRED`。
**注意 `getWeather` 只校验活动与节点存在，不校验请求者与活动的关系**（`index.js:153-158`）——知道 activityId+pointId 的任何人（含未登录）都能查该点天气。天气本身是公开数据，属设计取舍，测试可当已知事实。

### 1.2 dispatch 十步管道（`index.js:112-136` + `commands.js:101-140`）

每个写操作 = 一个 command：`{ actor:{userId:openid}, requestId, expectedRevision, fingerprint, payload }`。

1. **payload 必须是对象**，否则 `INVALID_INPUT`（index.js:113-115）。
2. `loadState`：**全量读 15 个 collection** + `ot_meta`（store.js:70-82）。V1 规模可接受，是第一堵扩展墙。
3. `now` = 服务端北京时间 ISO 串（index.js:25-27）。**一切时间判断以服务端时钟为准**。
4. `overrideEvidence`：深遍历 payload，把所有形如 `{at, by, note}` 的三元组**强制覆写**为 `{at: now, by: actorId, note: note.slice(0,2000)}`（index.js:38-53）。**客户端无法伪造证据的时间与操作者**；客户端确实传 `at:'', by:''`（如 field-panel.js:174-176）。
5. `requestId`：客户端未传则服务端 `genId('request')`（index.js:121）。客户端 `api.dispatch` 总是生成 `req-<base36时间><随机>`（api.js:95-104），**全部调用点都不传第三参 → 每次点击都是新 requestId**（见 §1.4）。
6. `expectedRevision`：未传/非整数时**默认取服务端当前 revision**（index.js:122）——等于放弃客户端乐观锁，只剩服务端读-写窗口内的 CAS。
7. `fingerprint` = sha256(canonicalPayload(clean))（键排序、数组保序，contracts.js:22-30）；必须匹配 `^[a-f0-9]{64}$`。
8. `reduceCommand`（commands.js:101-140）依次：
   a. schema 校验（strictObject：多余键直接拒，schema.js:79-84）+ now 是 instant + fingerprint 格式 → `INVALID_INPUT`；
   b. **权限** `canExecute`（permissions.js:108-263）→ `FORBIDDEN/NOT_FOUND/AUTH_REQUIRED/CONSENT_REQUIRED`；
   c. **幂等回执查找**（actorId+requestId，commands.js:116-121）：命中且 fingerprint 相同 → **replayed 成功返回**（不 bump revision、不写事件、targetIds 取回执）；命中但 fingerprint 不同 → `REQUEST_REUSED`；
   d. **revision 比对**：`state.revision !== expectedRevision` → `CONFLICT`（commands.js:122）；
   e. 在 deepClone 的 candidate 上执行 handler；
   f. `recordChange`：写 event + 自动发布 notice（§1.6）；`notice.read` 与 `activity.delete` **不写 event**（commands.js:57）；
   g. `revision+1`、`savedAt`、写 receipt；
   h. 回执截到最近 **600** 条（commands.js:88-94）、events/notices 各截到最近 **800** 条（commands.js:135-136）——**静默截断**；
   i. `assertInvariants(candidate)`：任何一条不满足 → **整个命令回滚**，candidate 丢弃，revision 不变（commands.js:137-138）。
9. `persistState`（store.js:108-132）：单事务内**重读 `ot_meta/main`，CAS 校验 `meta.revision === before.revision`**（注意是 loadState 时刻的 revision，不是客户端传的 expectedRevision——后者已在 8d 比对过）→ 写 diff → `revision+1`。CAS 失败 → `CONFLICT`；其他事务失败 → `STORAGE_UNAVAILABLE`（「这次修改没有保存，原安排未改变」）。
10. 返回 `{ targetIds, replayed, revision }`。信封统一 `{ok:true,data}|{ok:false,error:{code,message}}`（index.js:269-272）。

**推论（并发模型）**：revision 是**全局单计数器**（ot_meta/main）。任何两个**不相关活动**上的并发写也会互相 CONFLICT。客户端 `dispatchAndSync` 收到 CONFLICT 会 toast + 自动 reload，用户需重按（api.js:111-119）。

### 1.3 requestId / 幂等的真实语义

| 事实 | 出处 | 测试含义 |
|---|---|---|
| 服务端幂等 = 同 `actorId+requestId` 且同 fingerprint → 重放成功（返回旧 targetIds，`replayed:true`） | commands.js:116-121 | 重放路径**必须**在 E2E 覆盖（A 层 e2e-test 已覆盖一条） |
| 同 requestId 不同内容 → `REQUEST_REUSED` | commands.js:120 | 需直接以 API 层构造 |
| 回执窗口是**全局最近 600 条**（跨所有用户共享） | commands.js:88-94 | 被挤出窗口后，同 requestId 重放按**新命令**执行——业务守卫（WRONG_PHASE 等）成为唯一防线 |
| 小程序端从不复用 requestId（`dispatch` 每次新造，无调用方传第三参） | api.js:95-104；grep 全部调用点证实 | 真实客户端的「双击」= 两条命令，靠业务守卫拦截（如二次 review 报 WRONG_PHASE）；`REQUEST_REUSED` 对真实客户端近乎不可达 |
| `signup.js` 的档案回写 `syncTasks` 用裸 `dispatch` 逐条 CAS 链 | signup.js:331-340 | 主命令与回写是**两条独立命令**，中间可被他人插入写 |

### 1.4 事件与通知自动发布（`commands.js:53-86`）

除 `notice.read`、`activity.delete` 外，每条成功命令写一条 `ot_events`（summary 来自 summaries 表；`activity.transition` 拼接 reason）。同时：

| 命令类型 | 自动 notice 受众 |
|---|---|
| `activity.publish` / `activity.edit` / `activity.transition` | `{kind:'activity'}`（全体可读活动的人） |
| `signup.*` / `assignment.*` | `{kind:'signups'}` = 本命令目标 + **所有乘车安排相对上一次发生增/删/换车/换座的人**（before/after 对比，commands.js:71-79） |
| `vehicle.*` / `attendance.*` / `incident.*` / `position.*` / `export.record` / `membership.*` / `profile.*` | **无自动通知**（只写 event） |
| `notice.publish` | 自己就是 notice，`sourceEventId` 回填 |

自动 notice 内容固定为 `「<summary>，请打开活动查看最新安排。」`。

### 1.5 错误码总表（`contracts.js:4-9`）

`AUTH_REQUIRED` `FORBIDDEN` `NOT_FOUND` `INVALID_INPUT` `WRONG_PHASE` `CONFLICT` `REQUEST_REUSED` `CAPACITY` `DUPLICATE_PERSON` `GROUP_SCOPE` `VEHICLE_FULL` `SEAT_TAKEN` `PICKUP_MISMATCH` `DRIVER_CONFLICT` `UNRESOLVED_DEPARTURE` `UNRESOLVED_SAFETY` `CONSENT_REQUIRED` `STORAGE_UNAVAILABLE` `OFFLINE` `CORRUPT_SNAPSHOT`

- **`OFFLINE` 与 `CORRUPT_SNAPSHOT` 当前从未被任何代码抛出**（grep 证实仅出现在枚举定义）——客户端网络层用自造的 `NETWORK` 码（api.js:33-44）。测试断言不要指望这两个码。
- 语义速查：`WRONG_PHASE`=阶段/资格门；`CAPACITY`=名额；`DUPLICATE_PERSON`=同人重复报名；`GROUP_SCOPE`=同行组约束；`VEHICLE_FULL`/`SEAT_TAKEN`/`PICKUP_MISMATCH`/`DRIVER_CONFLICT`=分车四守卫；`UNRESOLVED_DEPARTURE`=人员去向未清点；`UNRESOLVED_SAFETY`=安全事实未收口；`CONSENT_REQUIRED`=授权缺失。

---

## 2. Activity 生命周期

### 2.1 状态集合（schema.js:155）

```
draft → published → gathering → active → closing → archived
   \        \        \
    →(delete) └────────┴──→ cancelled
```

共 7 态。`acceptingSignups` 是与 phase **独立**的布尔闸（published 可手动关闸；任何 transition 都会置 false）。前端标签：draft=草稿、published=行前准备、gathering=正在集合、active=正在同行、closing=返程报平安、archived=已归档、cancelled=已取消（utils/format.js:74）。

### 2.2 转换表

权限基线：除 `activity.create` 外全部 **owner-only**（permissions.js:246-260）；`activity.copy` 也是 owner-of-source。

| # | 转换 | command | 前置条件（业务+不变量） | 失败码 | 成功后副作用 | UI 入口 |
|---|---|---|---|---|---|---|
| A1 | ∅→draft | `activity.create` | input 过 ActivityInput（partial 校验，可为空壳）；**不变量要求 ownerId 已有 profile** | INVALID_INPUT | 新 activity(phase=draft, acceptingSignups=false)；临时路线（routeId=null 且快照非空）落一条 `ot_routes` 私有路线；event+自动 notice（activity 受众） | editor 保存（editor.js:552-596，先做 profile 闸门预检） |
| A2 | draft→published | `activity.publish` | **仅 draft**；full 校验：标题/时间/截止≤开始<结束/≥1集合点(名称+地址+集合时间)/≥1节点/≥1风险 全非空（activity.js:18-29）；`participation` 只能是发起者本人（不能代同行人，activity.js:122-124） | WRONG_PHASE / INVALID_INPUT / CAPACITY（participation 超容量时） | phase=published、acceptingSignups=true、publishedAt=now；participation 会**直接创建一条 confirmed 报名+attendance**（走 registerParticipants）；event+activity 受众 notice | editor 发布确认（editor.js:818-827，先静默 persistCurrent 再 publish——两阶段两命令） |
| A3 | draft→∅ | `activity.delete` | **仅 draft**（permissions.js:239-245 双重校验） | WRONG_PHASE / FORBIDDEN | **级联删除** signups/attendance/groups/memberships/notices/vehicles/assignments/incidents/positions/events；私有路线保留；**不写 event**；notice 无 | editor 删除草稿（editor.js:768） |
| A4 | published→gathering | `activity.transition next=gathering` | **无 pending 报名**（activity.js:157-158） | WRONG_PHASE / UNRESOLVED_DEPARTURE | phase=gathering、acceptingSignups=false；event+notice | workspace 阶段推进（workspace.js:125-153，NEXT_PHASE 表） |
| A5 | gathering→active | `activity.transition next=active` | 每个 **confirmed** 报名都有 departure 记录；departure=joined 者必须已签到，且**拼车乘客**（非参与者司机）必须已上去程车（activity.js:159-167） | WRONG_PHASE / UNRESOLVED_DEPARTURE | phase=active；**为仍在 coordinating 的 confirmed 自动创建 kind='late' 的 open incident**（activity.js:168-178）；event+notice | workspace |
| A6 | active→closing | `activity.transition next=closing` | **reason 必填**（activity.js:179-180） | WRONG_PHASE / INVALID_INPUT | phase=closing；event（summary 带 reason）+notice | workspace（弹层要求填原因） |
| A7 | closing→archived | `activity.transition next=archived` | 每个 confirmed：departure 已核实且非 coordinating；joined 者**必须已记 home**；**无任何 open incident**（activity.js:181-186；invariants.js:60-66 双重把关） | WRONG_PHASE / UNRESOLVED_SAFETY | phase=archived；此后工作数据（readContact/selectTransport 车辆司机电话/敏感读/敏感导出）**全部关闭**（permissions.js:27-29 workDataAvailable） | workspace |
| A8 | draft\|published\|gathering→cancelled | `activity.transition next=cancelled` | **无任何现场事实**：无 departure=joined、无任何上车、无 home、无车辆 leg departed/completed（activity.js:141-145）；**无参与者司机**（activity.js:146-147） | WRONG_PHASE / UNRESOLVED_SAFETY / DRIVER_CONFLICT | phase=cancelled、acceptingSignups=false；全部 current 报名→cancelled；assignments 全删；positions 全部 revoke；**attendance 记录保留**；event+notice | workspace「取消活动」独立 danger 块 |
| A9 | 任意→任意（受限） | `activity.edit` | 见 §2.3；**不允许跳过/回退**任何 phase（activity.transition 只接受上表 next 值，其余 WRONG_PHASE，activity.js:187-189） | WRONG_PHASE / INVALID_INPUT / CAPACITY / FORBIDDEN | 见 §2.3 | editor |
| A10 | 任意→新 draft | `activity.copy` | **source 的 owner**（permissions.js:246-260）；**无阶段限制**——已发布/集合中/已归档/已取消均可复制 | NOT_FOUND / FORBIDDEN | 新 draft：id/owner 换新、acceptingSignups=false、startAt/endAt/deadlineAt/publishedAt 清空、集合点 meetingAt 清空；复制他人路线时 routeId 置空并落新私有路线（activity.js:78-93）——**但 owner-only 使跨人分支实际不可达** | editor「从我的活动复制」（templateId 只来自自己的活动） |

**不可达转换**：published→draft、任何→published（除 A2）、active/closing→cancelled（WRONG_PHASE，activity.js:141）、archived→任何、cancelled→任何。

### 2.3 activity.edit 的分阶段锁定（activity.js:94-111）

| 当前 phase | 允许修改 |
|---|---|
| draft | 任意字段（partial 校验）；保存后强制 acceptingSignups=false |
| published | 任意字段但走 **full 校验**；引用保护：报名/车辆引用的集合点不可删（activity.js:33-37）、attendance 引用的路线节点不可删（activity.js:38-43）；capacity 不得低于 pending+confirmed（activity.js:31-32） |
| gathering / active | **lockedKeys**：title/startAt/deadlineAt/acceptingSignups/capacity/approvalMode/routeId/routeSnapshot/pickupPoints 必须逐字节不变；endAt 只能**延长**（activity.js:98-104） |
| closing / archived / cancelled | **只读**（activity.js:95） |

细节事实：
- published 阶段可以把 `acceptingSignups` 置 false（提前关闸）或把 deadline **提前**——报名窗口是 phase+acceptingSignups+deadline 三条件与（§3.2）。
- **延长 endAt 会重新打开位置上报窗口**（§7），但**已上报位置的 consentExpiresAt 是上报时刻的快照，不会随 endAt 延长**——延长后旧位置过期，需参与者重新上报（field.js:108-110 + selectors.js:358）。这是「关联数据不自动同步」的已知设计点。
- capacity 缩小到 pending+confirmed 以下 → `CAPACITY`。

### 2.4 detailState（客户端派生态，非存储状态）

`selectors.js:472-488` 派生 12 态：`new / pending / confirmed / ready / gathering / checked / active / closing / finished / waitlist / closed / cancelled`。规则：cancelled→cancelled；archived→**finished**；primary signup pending→pending、waitlisted→waitlist；confirmed 时按 phase 映射（gathering 分 checked/gathering、active→active、closing→closing、published 且「自行前往或已有车」→ready 否则 confirmed）；无报名时 published+开放→new 否则 closed。**E2E 断言活动终态用 detailState='finished'**（archived 在 UI 文案里叫「已归档」，detailState 里叫 finished）。

---

## 3. Signup 生命周期

### 3.1 状态集合（schema.js:178）

```
pending | confirmed | waitlisted | rejected | cancelled | removed
```

`isCurrentSignup = pending|confirmed|waitlisted`（permissions.js:23-25）——只有这三态占用名额、可编辑、可分车。
前端标签：pending=待审核、confirmed=已确认、waitlisted=候补中、rejected=未通过、cancelled=已取消、removed=已移除（format.js:75）。

### 3.2 转换表

| # | 转换 | command | 前置条件 | 权限 | 失败码 | 成功后 | UI 入口 |
|---|---|---|---|---|---|---|---|
| S1 | ∅→pending（manual）或 ∅→confirmed（automatic） | `signup.submit mode=apply` | phase=published 且 acceptingSignups 且 **now < deadlineAt**（activity.js:102-104）；整组参与者每人：资料合法（姓名/电话/紧急联系人齐，signup.js:25-28）、trip 的上车点属于本活动、`dataUse` 同意必勾、companion 还需 `proxyAuthority`；提交者必须有 profile（signup.js:39-40）；**占用后 pending+confirmed ≤ capacity** | 每个参与者 personRef 必须是**本人或本人名下同行人**（permissions.js:111-113,195） | WRONG_PHASE / FORBIDDEN / CONSENT_REQUIRED / INVALID_INPUT / NOT_FOUND / **DUPLICATE_PERSON**（与任何 current 报名同人，signup.js:51）/ **CAPACITY**（整组放不下） | 建 groupId（整组一条）+ N 条 signup + N 条 attendance（signup.js:66-77）；event + 以这组 signupIds 为受众的 notice | signup 页提交（signup.js:342-381）；**CAPACITY 时客户端弹询问转 waitlist 重提** |
| S2 | ∅→waitlisted | `signup.submit mode=waitlist` | 同 S1，但**必须整组放不下**（放得下反而 INVALID_INPUT「整组仍有名额」，signup.js:65）；**不受 capacity 检查** | 同 S1 | WRONG_PHASE / INVALID_INPUT / DUPLICATE_PERSON | 同 S1 但 status=waitlisted（也建 attendance，也占 group） | signup 页「候补」 |
| S3 | ∅→confirmed | （发布时参与）`activity.publish` 的 participation | 见 A2；同样吃 capacity | owner 且 personRef=本人 | 同 S1 | 直接 confirmed（**跳过审核**） | editor 发布确认「我也参加」 |
| S4 | pending→confirmed \| rejected | `signup.review decision=confirm\|reject` | phase=**published**（gathering 起不可再审）；所有目标 status=pending（signup.js:117-119） | **owner-only**（staff 无审核能力） | WRONG_PHASE / FORBIDDEN / NOT_FOUND | 批量置 confirmed/rejected；confirmed 才可分车；event+signups 受众 notice | workspace 名单面板批量审核（roster-panel.js:174-195） |
| S5 | waitlisted→**pending** | `signup.promote` | phase=published；所有目标 waitlisted；keepTogether 组必须**整组同递补**（组内还有别的 waitlisted 而未选中 → GROUP_SCOPE，signup.js:123-128）；**occupied+批量 ≤ capacity**（signup.js:130） | owner-only | WRONG_PHASE / GROUP_SCOPE / CAPACITY | 批量置 **pending（不是 confirmed，还需再审）** | roster-panel「递补」 |
| S6 | current→cancelled \| removed | `signup.cancel` | phase ∈ {published, gathering}（activity.js:112）；目标 current；**travelLocked=false**（无 joined 出发/无上车/无 home/所乘车无 leg 历史，signup.js:82-88）；**非参与者司机**（signup.js:133-135） | owner 或 own（本人/提交者，permissions.js:197） | WRONG_PHASE / DRIVER_CONFLICT / FORBIDDEN / NOT_FOUND | isOwnSignup(actor)→**cancelled**，否则（owner 移除他人报名）→**removed**；**assignments 立即删除**（座位释放）；**positions 全部 revoke**；attendance 保留 | roster-panel 批量取消（reason 必填）；activity 页参与者自取消（activity.js:539-547） |
| S7 | 资料修改 | `signup.edit` | 窗口：published 且未过截止（owner 或 own）**或** gathering 且 **owner**（现场协调，signup.js:150-153）；目标 current 且 travelLocked=false | owner/own **且** `canReadSensitive(purpose)`（编辑=读敏感资料，permissions.js:198-200） | WRONG_PHASE / FORBIDDEN / CONSENT_REQUIRED / INVALID_INPUT | 覆写 participant/trip；**trip 改变（mode 变或 shared 换上车点）→ 该人 assignment 静默删除**（signup.js:158-161） | signup 页编辑模式（purpose 闸门 → readForm 回填 → 提交，signup.js:452-480） |
| S8 | 同行组开关 | `group.setTogether` | phase ∈ {published, gathering}；组成员无 travelLocked；**开 keepTogether 时 confirmed 成员必须已同车**（signup.js:169-172） | owner 或该组 submittedByUserId（permissions.js:201-202） | WRONG_PHASE / GROUP_SCOPE / NOT_FOUND | group.keepTogether 翻转；不变量：keepTogether 组的 confirmed 必须同车（invariants.js:107-111） | roster-panel（roster-panel.js:267） |

### 3.3 关键事实与边界

- **cancelled/removed/rejected 是终态**：无任何转换出终态。但同人（user/companion 键）可以**重新提交一条新报名**（DUPLICATE_PERSON 只查 current 报名，signup.js:41）。
- **候补不能被 reject**：review 只吃 pending；候补退出只能走 `signup.cancel`（lab-dryrun 剧本注释同证）。
- **`signup.cancel` 的 `reason` 字段被服务端完整丢弃**：schema 收下（schema.js:329），handler 不读、event summary 不含、无任何落点（grep signup.js 无 `reason`）。客户端却强制必填——纯仪式性输入。
- **removed vs cancelled**：同一命令 `signup.cancel`，actor 与报名的关系决定终态文案（owner 强制移除他人=removed；自己/提交者取消=cancelled）。
- promote 后是 **pending**，还需要一次 review 才 confirmed——两次操作、两次 revision。
- automatic 模式活动：S1 直接 confirmed，**没有任何审核环节**；此时名单面板的审核按钮自然无目标。
- 已确认者被 S6 取消后其 attendance 记录仍在（departure 等字段原样）——只有不变量「joined 需 confirmed+签到」（invariants.js:129）约束：**已 joined 的人本来就被 travelLocked 挡住不可取消**，所以不会出现「cancelled 但 departure=joined」的合法路径。

---

## 4. Attendance（现场履约，每 signup 一条记录，随报名创建）

### 4.1 字段级子状态（schema.js:218-241）

```
checkIn:      null → {manual|simulation, evidence, coordinates?}        （可重复覆写，见下）
departure:    null → joined | not_departed | coordinating               （joined 不可逆）
boarding:     outbound: null ⇄ evidence；return: null ⇄ evidence        （发车后冻结，lateArrival 特例除外）
returnPlan:   assigned（默认）⇄ independent(+evidence)
nodes:        [] ⊆ 路线节点（幂等追加）
home:         null → evidence                                            （幂等）
```

**lateArrival 特例**：`phase==='active' && departure.kind==='coordinating'`（field.js:61）——该人可以在 active 阶段补签到、补去程上车、核实出发（集合期命令的门全部为 `phase==='gathering' || lateArrival` 放行）。

### 4.2 命令守卫表（全部 field.js；phase 门先拒 draft/published/archived/cancelled，field.js:20）

| command | 阶段门 | 其他前置 | 权限（permissions.js） | 失败码 | 幂等性（重复调用） |
|---|---|---|---|---|---|
| `attendance.checkin` | gathering ∥ lateArrival | manual 必须有 note；**simulation 只能本人**（field.js:66） | owner ∥ own ∥ staff(cap=checkin) | WRONG_PHASE / FORBIDDEN / INVALID_INPUT | **无守卫：重复签到直接覆写证据**（field.js:67-69） |
| `attendance.departure` | gathering ∥ lateArrival | **joined→其他 = 拒**（field.js:83）；非 joined 需 note 且**未上过去程车**（矛盾检查，field.js:84）；joined 需已签到 +（拼车非司机）已上去程（field.js:85） | owner ∥ staff(cap=checkin)（**参与者本人不能自报出发**） | WRONG_PHASE / UNRESOLVED_DEPARTURE | joined 后再报 joined=覆写证据（成功） |
| `attendance.board` (leg) | outbound: gathering∥lateArrival；return: active∥closing | outbound 需已签到且 departure≠not_departed（field.js:74）；return 需 departure=joined 且 returnPlan=assigned（field.js:75）；**车辆该程已发车→拒**，唯一例外=lateArrival 且 outbound 且 boarded=true 且未上过（field.js:76） | owner ∥ **该人所用车辆的 vehicle_contact**（permissions.js:212-214；本人/owner 之外无路径） | WRONG_PHASE / UNRESOLVED_DEPARTURE / INVALID_INPUT | boarded=true 幂等；**boarded=false 可在发车前抹掉**（field.js:77） |
| `attendance.returnPlan` | active ∥ closing | departure=joined；需 note；**return 已上车或该车 return 已发车→拒**（field.js:92） | owner ∥ staff(cap=**incident**)（注意：用的是 incident 能力） | WRONG_PHASE / INVALID_INPUT | 双向可切换（independent⇄assigned） |
| `attendance.node` | **active only** | departure=joined；pointId ∈ routeSnapshot（field.js:97） | owner ∥ own ∥ staff(cap=node) | WRONG_PHASE / NOT_FOUND | 同节点幂等 no-op（成功、bump revision） |
| `attendance.home` | **closing only** | departure=joined；**本人可空 note，代确认必须逐人 note**（field.js:102） | owner ∥ staff(cap=home) ∥ 全部本人 ∥ 全部「proxyAuthority+proxyHome」的代办（permissions.js:207-211） | WRONG_PHASE / INVALID_INPUT | 已 home 再调=no-op 成功 |
| `vehicle.depart` (leg) | outbound: gathering∥active；return: active∥closing | **本车全部已分乘客清点完毕**：outbound 每人已上车 **或** departure ∈ {not_departed, coordinating}（departure=null 也拦）；return 每个 joined+assigned 者已上 return（field.js:43-47） | owner ∥ vehicleCan（该车联系人，permissions.js:215-216） | WRONG_PHASE / UNRESOLVED_DEPARTURE | 已发车再调=no-op 成功 |
| `vehicle.complete` (leg) | 同 depart 阶段门 | **该程必须已发车**（field.js:40） | 同上 | WRONG_PHASE | 已完成再调=no-op 成功 |

### 4.3 权限不对称（设计事实，测试要按此断言）

- **签到/节点**：参与者本人可以自己操作（own）。
- **出发核实 / 上车记录**：本人**不能**自助——出发核实 owner+staff(checkin)；上车 owner+vehicle_contact。这是「清点是组织方事实」的建模。
- **到场签到的 simulation 方法**（本人定位签到）只有本人能发（field.js:66）；owner/staff 代签只能 manual+note（activity.js:466-482 的降级链）。
- 所有 evidence 的 at/by 由服务端覆写（§1.2 步骤 4），客户端传空串即可。

---

## 5. Vehicle（车辆档案 + legs 子状态机）

状态：每车 `legs.outbound.{departed,completed}` 与 `legs.return.{departed,completed}`，各为 evidence|null（schema.js:191-198）。

```
          depart            complete
(null) ─────────→ (departed) ─────────→ (departed+completed)     ←每程独立，方向无关
   ↑ 重建/修改在此区间合法（hasLegHistory=false）
```

| command | 阶段门 | 前置 | 权限 | 失败码 |
|---|---|---|---|---|
| `vehicle.save`（新建/编辑） | **published ∥ gathering ∥ draft**（注意 draft 可预置车辆；assignment 不行，transport.js:86-88） | 编辑时无任何 leg 历史（transport.js:97）；司机校验：participant 司机必须本场 confirmed 且**不占用乘客座**（transport.js:55-60）；同一身份（user:/companion:）不得在本场开两辆车（transport.js:65-69）；`legalCapacity − drivers − blockedSeats ≥ 0`；seatLabels 唯一且数量=乘客位 | owner（participant 司机的 signupId 会进 requireSignups 校验） | WRONG_PHASE / DRIVER_CONFLICT / VEHICLE_FULL / INVALID_INPUT |
| `vehicle.remove` | published ∥ gathering ∥ draft | 无 leg 历史；**无任何 assignment**（transport.js:118-120）；级联删该车 vehicle_contact 授权 | owner | WRONG_PHASE / CONFLICT / NOT_FOUND |
| `vehicle.depart` / `vehicle.complete` | 见 §4.2 | 见 §4.2 | owner ∥ vehicleCan | WRONG_PHASE / UNRESOLVED_DEPARTURE |

司机身份冲突键：service 司机= `activityId:userId`（userId=null 的外雇司机不参与查重）；participant 司机=signupId（invariants.js:77-87）。
**参与者司机不建 assignment、不占乘客位、发车清点时天然豁免上车**（allocation.js:51、field.js:43-47、e2e-test §4 回归点）。

---

## 6. Assignment（无显式状态，由不变量+冻结规则约束）

不变量总集（invariants.js:90-111）：assignment 的 signup 必须 confirmed、trip=shared、车辆途经其上车点（PICKUP_MISMATCH）、座位唯一（SEAT_TAKEN）、一人最多一条（同 signupId 主键天然保证）、参与者司机不得有乘客位（DRIVER_CONFLICT）、keepTogether 组 confirmed 必须同车（GROUP_SCOPE）、车辆乘客数 ≤ 乘客位（VEHICLE_FULL）。**任何命令落库前整体重查，违反=整条命令回滚。**

冻结规则 `editableAssignments`（transport.js:19-38）：目标 signup 已有 departure/任何上车记录 → 拒；涉及的车辆（新旧）任一程有 leg 历史 → 拒。

| command | 前置 | 权限 | 特殊失败 |
|---|---|---|---|
| `assignment.commit`（预览提交） | preview.activityId 一致；**preview.baseRevision === 当前 revision**（transport.js:131）；preview 无重复 signup；**已有 assignment 只能原样出现——不能删不能改**（transport.js:134-140），只允许纯新增 | owner | CONFLICT（预览过期/试图覆盖）/ WRONG_PHASE / 四座位码 |
| `assignment.set`（手动指派/改派） | editableAssignments | owner | 同上 |
| `assignment.remove` | editableAssignments 且已存在（否则 NOT_FOUND） | owner | WRONG_PHASE |
| `assignment.swap` | 两人都已分车且 editable；**交换后由不变量兜底**（上车点不匹配→PICKUP_MISMATCH 整单回滚） | owner | NOT_FOUND / PICKUP_MISMATCH / GROUP_SCOPE / SEAT_TAKEN |

预览来自 `previewAssignments`（读动作，owner-only，published∥gathering，allocation.js:36-44）：
纯函数规划，**绝不重排/删除已有座位**，只补未分配者；按 keepTogether 组整组、按旧车优先、按自然序座位分配；放不下给 `unassigned[]{signupId, reason∈{no_vehicle, pickup_mismatch, group_too_large, no_seat}}`（allocation.js:66-91）。**预览与提交之间任何写都会使 baseRevision 过期 → CONFLICT「分车预览已过期」。**

---

## 7. Position（位置上报）

```
∅ ──report──→ live(reportedAt, consentExpiresAt=上报时endAt快照) ──report(覆写)──→ live'
                       └────────────── revoke ──────────────→ revoked(revokedAt=now，终态)
```

- `position.report`（field.js:105-111）：phase=**active**；departure=joined；**仅本人**（isSelfSignup，permissions.js:217）；payload `consent=true`（否则 CONSENT_REQUIRED）；**activity.endAt 必须在未来**（过期→ CONSENT_REQUIRED「请领队延长行程后重新授权」）；**每 signup 只保留最新一条**（同主键覆写）。每次上报=一次独立授权，受众投影在 `now < consentExpiresAt` 时可见（selectors.js:355-369），30 分钟无更新标记 stale。
- `position.revoke`（field.js:15-19）：**唯一绕过 field 阶段门的命令**（在阶段检查之前处理）——任何 phase 都可撤；幂等 no-op。权限：本人 ∥ proxyAuthority 代报 ∥（own 但无代理→CONSENT_REQUIRED）。
- 联动：`signup.cancel` 与活动 `cancelled` 都会**自动 revoke** 该人全部 live position（signup.js:140-142、activity.js:150-152）；不变量强制「非 revoked 的 position 的 signup 必须 confirmed 且活动非 cancelled」（invariants.js:133-138）。
- 投影：active 阶段、confirmed、revokedAt=null、未过期、坐标合法才出现在 view.positions；组织者看全部、staff 按 cap=position、本人/代办看自己（selectors.js:361-363）。

---

## 8. Incident（异常记录）

```
∅ ──report──→ open(resolution=null) ──resolve(note)──→ resolved(终态)
```

- `incident.report`（field.js:21-26）：phase ∈ {gathering, active, closing}；subjectIds 非重且 ≥1；description 必填；kind ∈ {late, withdrawal, injury, other}。权限：owner ∥ 全部目标是自己报名 ∥ staff(cap=incident) 逐人判定（permissions.js:221-222）。
- `incident.resolve`（field.js:27-33）：同一阶段门；note 必填；已 resolved 再调=no-op 成功。权限：owner ∥ staff(cap=incident)。
- **自动创建**：gathering→active 时为 coordinating 的 confirmed 自动开 `kind='late'`（activity.js:168-178）；该 incident 不关闭会**同时卡死 A7 归档**（UNRESOLVED_SAFETY）。
- subject 报名后来被 cancel：incident 不回收（不变量只要求 subject 仍属于本活动——cancelled 的 signup 仍在 ot_signups 里，成立）。

---

## 9. Membership（协作授权）

两种角色（schema.js:207-216）：
- `staff`：capabilities ⊆ {roster, checkin, node, incident, position, home, sensitive}（7 能力枚举，schema.js:206）+ scope {all | selected[signupIds]}。
- `vehicle_contact`：绑定单个 vehicleId。

| command | 前置 | 权限 | 失败码 |
|---|---|---|---|
| `membership.save`（upsert） | phase ∉ {archived, cancelled}（profile.js:12）；`expiresAt > now`（profile.js:18）；被授权账号必须有 profile（找不到→提示对方复制身份码，profile.js:19）；staff 必须有 ≥1 能力且 selected scope 非空（profile.js:20-23）；**同车 vehicle_contact 旧授权被顶替**（profile.js:24-26） | **owner-only** | WRONG_PHASE / INVALID_INPUT / NOT_FOUND |
| `membership.revoke` | phase ∉ {archived, cancelled} | owner-only | WRONG_PHASE / NOT_FOUND |

生效语义：`staffCan`/`vehicleCan` 都要求 `now < expiresAt`（**严格小于，等于即失效**，permissions.js:35,47）。
**关键限制**：staff 能力枚举里**没有审核（review/promote）、分车、活动编辑、通知发布**——这些是 owner 专属（permissions.js:246-260 全在 owner-only 组）。staff 的 roster 只影响读取投影（selectors.js:345），不影响 canExecute 的命令面。

---

## 10. Notice（通知）

受众三形态（schema.js:252-256）：`activity`（全活动可读者）/ `signups[signupIds]` / `vehicle[vehicleId]`。

| command | 阶段门 | 权限 | 备注 |
|---|---|---|---|
| `notice.publish` | ∉ {archived, cancelled}（notices.js:11-13） | owner-only | content 必填；signups 受众去重；**无订阅消息真实推送**——NOTICE_TMPL_IDS 为空串，客户端「发送通知」降级为复制文案（config.js） |
| `notice.read` | **任何阶段可读**（阶段门豁免） | `canReadNotice`：受众=activity→owner∥current 报名者∥有效 membership 持有者；signups→owner∥受众中 own 的人；vehicle→owner∥该车联系人∥confirmed 且分在该车的报名者（permissions.js:84-105） | readBy 幂等记录（已读再读=no-op，仍 bump revision）；**不写 event** |
| `notice.delivery` | ∉ {archived, cancelled} | **owner-only**（车辆联系人不能记录投递） | channel=copy → status ∈ {copied, failed}；channel=subscription_simulation → status ∈ {simulated_success, failed, not_authorized}（copied 非法，notices.js:31-35） |

自动通知见 §1.4。归档/取消后 publish/delivery 被拒、read 放行——`notices.js:11` 的类型豁免名单只有 `notice.read` 和 `export.record`。

---

## 11. Export（导出=审计命令）

`export.record`（notices.js:41-46 + permissions.js:228-238）：
- signupIds 非空去重；mode ∈ {ordinary, sensitive}；sensitive 必须 purpose 非空**且**对每个人过 `canReadSensitive`。
- **阶段门豁免**：archived/cancelled 活动 **ordinary 导出仍可执行**（§10 引用的类型豁免）；sensitive 导出被 `workDataAvailable` 拦截（归档后敏感数据关闸）。
- 权限 **owner-only**（staff 即便有 sensitive 能力也只能逐人 readSensitive，不能整表导出）。
- 成功写 event，summary=「普通/敏感名单导出：<purpose>」（commands.js:59-61）。

客户端两步流（roster-panel.js:205-231）：先 `dispatch(export.record)`（审计落库）→ 再 `readExport`（读动作，同一权限面，selectors.js:210-231 生成 CSV；单元格全引号+公式注入中和，selectors.js:206-209）→ 剪贴板。**若第二步失败：审计已记录但用户未拿到数据**——审计语义是「导出意图」，不是「导出成功」。

敏感读取面（`canReadSensitive`，permissions.js:71-82）：本人 ∥ proxyAuthority 代报 ∥（purpose 非空 + 工作数据可用 + owner/staff(sensitive)）。own 但无代理授权 → CONSENT_REQUIRED（不是 FORBIDDEN）。`readContact` 另有 roster 能力与「confirmed+已分车者的车辆联系人」通道（selectors.js:146-159）。

---

## 12. Profile / Companion

- `profile.save`：任意登录用户；**首次调用创建档案**（read profile 对无档案者返回空壳，selectors.js:250-253）；姓名+电话必填。**档案是一切的前置**：activity.create（不变量）、signup.submit（handler）、membership.save（被授权方）都要求 profile 存在。
- `companion.save` / `companion.remove`：只能管理自己 profile 下的同行人（permissions.js:115-118）；companion.save 前置 profile 已存在（NOT_FOUND）。
- `getPhoneNumber`（动作，非命令）：用微信 code 换手机号；未开通「手机号快速验证」→ FORBIDDEN 可操作话术（index.js:201-217）。
- 客户端「我的」页：输入停止 800ms 自动落库（me.js:185 附近）；位置授权撤回入口来自 home 投影的 `meta.positionRows`（selectors.js:280-285）。

---

## 13. 权限总矩阵（canExecute，permissions.js:194-262）

| 命令 | owner | 参与者(own/self) | staff（能力） | 车辆联系人 |
|---|---|---|---|---|
| activity.create / profile.save | —（任意登录用户） | — | — | — |
| companion.save/remove | —（仅限本人名下） | — | — | — |
| activity.edit / publish / copy / transition / delete | ✅ | ❌ | ❌ | ❌ |
| signup.submit | ✅（代本人/同行人） | ✅（本人/同行人） | ❌ | ❌ |
| signup.review / promote | ✅ | ❌ | ❌（无审核能力） | ❌ |
| signup.cancel | ✅ | ✅（own） | ❌ | ❌ |
| signup.edit | ✅（+purpose 过敏感门，除非编辑 own 报名） | ✅（own，同前） | ❌ | ❌ |
| group.setTogether | ✅ | ✅（该组提交者） | ❌ | ❌ |
| vehicle.save / remove / assignment.* | ✅ | ❌ | ❌ | ❌ |
| attendance.checkin | ✅ | ✅（own，含代同行人） | ✅（checkin） | ❌ |
| attendance.departure | ✅ | ❌（本人不能自报） | ✅（checkin） | ❌ |
| attendance.board | ✅ | ❌ | ❌ | ✅（本人车的乘客） |
| attendance.returnPlan | ✅ | ❌ | ✅（**incident** 能力） | ❌ |
| attendance.node | ✅ | ✅（own） | ✅（node） | ❌ |
| attendance.home | ✅ | ✅（self；或 proxyHome 代确认） | ✅（home） | ❌ |
| vehicle.depart / complete | ✅ | ❌ | ❌ | ✅（本车） |
| position.report | ❌ | ✅（仅 self，不含代报） | ❌ | ❌ |
| position.revoke | ❌ | ✅（self ∥ proxy） | ❌ | ❌ |
| incident.report | ✅ | ✅（own） | ✅（incident，逐人 scope 判定） | ❌ |
| incident.resolve | ✅ | ❌ | ✅（incident） | ❌ |
| notice.publish / delivery | ✅ | ❌ | ❌ | ❌ |
| notice.read | ✅ | ✅（按受众，permissions.js:84-105） | ✅（有效 membership） | ✅（按受众） |
| export.record | ✅（sensitive 另过逐人敏感门） | ❌ | ❌（sensitive 能力**不能**导出） | ❌ |
| membership.save / revoke | ✅ | ❌ | ❌ | ❌ |

读取面速查：`readTransport` / `readAccess` / `readNoticeManagement` / `previewAssignments` = owner-only；`readForm` = 敏感门 + 编辑权；`readSensitive` / `readContact` / `readExport` 见 §11；主投影 `read` 的视角门（draft 仅 owner 可见、organizer/staff/vehicle 视角校验、参与者只看 own 名单）在 selectors.js:318-347。

---

## 14. 文档 vs 代码差异（以代码为准）

| # | 文档说法 | 代码事实 |
|---|---|---|
| D1 | V1 规格「活动状态：草稿、招募中、已满、已截止、已结束、已取消」（V1 §5.x） | 7 态 phase 是 draft/published/gathering/active/closing/archived/cancelled；「已满/已截止」是计算值（remaining=0 / deadline 已过），**不是状态**；gathering/active/closing 三阶段在 V1 规格里没有对应命名（`已结束`≈archived） |
| D2 | V1 规格「报名状态：已报名、候补、已取消、被移除、已截止」 | 6 态是 pending/confirmed/waitlisted/rejected/cancelled/removed；**「已截止」不是状态**；文档漏了 rejected（未通过） |
| D3 | 多角色文档 §7.3「协作人员从任务链接直达协作视图」 | staff 页是薄壳（scenario-staff-test：零模块依赖、缺参守卫为空串）；**没有深度链接自动授权**——授权必须 owner 手动输入对方身份码创建 membership |
| D4 | 订阅消息/「候补转正提醒」 | NOTICE_TMPL_IDS 为空，真实推送不存在；投递是 `notice.delivery` 的模拟审计（copy/subscription_simulation） |
| D5 | AGENTS.md 称「ONE cloud function trailApi」 | `cloudfunctions/trailApiLab` 是第二个已存在的云函数（预演沙盒，写同一套 ot_* 库，见 §15.8） |
| D6 | 错误码表含 OFFLINE / CORRUPT_SNAPSHOT | **从未抛出**；客户端网络层用自造 `NETWORK` |

---

## 15. 特别关注清单（宽松转换 / 边界 / 已知缺口）

### 15.1 代码允许的「宽松」转换（测试应按现状断言，不是 bug 清单）

1. **重复签到覆写**：`attendance.checkin` 无已签到守卫，可无限覆写证据（field.js:67-69）。UI 层有 `!row.checkedIn` 门（selectors permittedActions + activity 页），但 API 层直发即可覆写。
2. **no-op 成功族**：`vehicle.depart/complete`、`attendance.node/home`、`incident.resolve`、`position.revoke`、`notice.read` 重复调用 = 成功返回 + **revision 照样 +1 + receipt 照样写**（部分还写 event）。
3. **activity.copy 无阶段限制**：已取消/已归档活动可被 owner 复制成新 draft。
4. **`signup.cancel` 的 reason 被静默丢弃**（§3.3）。
5. **expectedRevision 缺省 = 服务端当前值**：不传即等于跳过客户端乐观锁（§1.2 步骤 6）。
6. **automatic 模式活动没有任何审核环节**；promote 产物是 pending 还需二审。
7. **归档后 ordinary 导出仍可用**，sensitive 关闸（§11）。

### 15.2 revision/CAS 边界

- 全局 revision：无关活动的并发写互相 CONFLICT——E2E 并发用例无需同活动。
- CAS 用 loadState 时刻的 revision（不是客户端传值）在事务内复核（store.js:114）。
- invariants 失败 = 整命令回滚，revision 不动（commands.js:137-138）。
- 非 CAS 事务失败 → STORAGE_UNAVAILABLE，原状态保证未变。
- `preview.baseRevision` 是分车链路的第二把 CAS 锁（transport.js:131）。

### 15.3 requestId 边界

- 全局 600 条回执窗口（跨用户 LRU）；挤出后同 requestId 重放=新命令。
- 同 requestId 异指纹 → REQUEST_REUSED；回放前**仍会先过权限检查**（commands.js:114 在回执查找之前）——被撤销授权后重放旧命令会 FORBIDDEN 而非 replay。
- 真实客户端从不复用 requestId（§1.3）。

### 15.4 「状态成功但关联数据不同步」清单

1. **报名后的档案回写链**：signup.submit 成功后 profile/companion 回写是独立命令链，失败仅 toast「资料同步失败可在我的补存」（signup.js:366-372）——设计内已知缺口。
2. **signup.edit 改 trip 静默删除 assignment**：此人从分车表消失（signup.js:158-161）；自动 notice 会通知 assignment 变化（§1.4）。
3. **延长 endAt 不延长已上报位置的 consentExpiresAt**（§2.3/§7）——需重新上报才恢复可见。
4. **export.record 成功 + readExport 失败** = 审计已记、数据未达（§11）。
5. **membership 过期/撤销**不回收已发布 notice 的可读性判定（readBy 与 audience 在发布时定格）。
6. **activity.delete/cancelled 的 attendance 残留**：草稿删除级联清 attendance；**cancelled 保留 attendance**（仅 assignment 删除、position revoke）——不变量允许（signup 还在，1:1 保持）。

### 15.5 权限面的已知事实（供安全/边界用例取材）

1. `getWeather` 无关系校验（§1.1）。
2. `attendance.checkin` 的 `own` 允许提交者代同行人签到；`simulation` 方法严格 self-only。
3. `attendance.returnPlan` 用的是 **incident** 能力（域代码注释外的事实）。
4. staff 即便有 sensitive 能力也无导出权（export owner-only）。
5. notice.read 的 vehicle 受众含「confirmed 且已分在该车」的报名者——上车安排变化会实时改变可见性。
6. `activity.copy` 的跨 owner 路线分支因 owner-only 权限实际不可达（dead branch）。

### 15.6 静默截断

receipts 600 / events 800 / notices 800（§1.2 步骤 8h）：超限丢最旧，**读取投影不会报错**——长生命周期活动的通知列表会静默缺历史。

### 15.7 前端「认为成功」的三类点

1. `dispatchAndSync` 的 CONFLICT 自愈只刷新+提示，**不自动重试**——用户重按即新 requestId 新命令。
2. no-op 成功族（§15.1-2）会让 UI toast「已保存/已发车」，尽管数据未变。
3. editor 发布是「先静默保存（create/edit）→ 再确认发布」两条命令；发布失败时活动停留 draft（正确），但保存已发生。

### 15.8 trailApiLab（第二个云函数，测试基建事实）

`cloudfunctions/trailApiLab`：`seed` 在内存对**同一套 ot_* 库**的状态连算整阶段命令（与 trailApi 相同的 reduceCommand/幂等语义）后单事务 CAS 落库；`cleanup` 按活动**标题前缀**删除（stages.PREFIX），并全局清扫 attendance/positions 孤儿；演员档案 `u-lab-*`；白名单存 `ot_meta/lab_allowlist`。**E2E 用 lab 造数时不要把非前缀活动卷进 cleanup**；lab 的 CAPACITY 自动转候补重试（seed 内置）会掩盖客户端真实的 CAPACITY 交互路径。

---

## 16. 当前测试覆盖盘点（按断言内容，不按套件名）

**已覆盖（与业务状态机直接相关）：**

| 层 | 套件 | 覆盖 |
|---|---|---|
| 域纯函数 | smoke-test（86） | create/publish(含发布即报名)、submit+review、车辆+分车+参与者司机、**完整现场链**（签到→上车→出发→active→节点→closing→home→archived）、同 requestId 重放、读取投影、越权编辑、删草稿、discover、路线 track |
| 域链 E2E（A 层，打真 exports.main） | tools/e2e-test（7 节） | 信封/幂等重放/**CAS 冲突**、参与者司机不占位、**evidence 服务端覆写**、归档后工作数据关闸、未知动作/未登录/越权预览 |
| 沙盒全链 | lab-dryrun（165）、trailapilab（25） | 0→5 阶段全剧本（含候补取消、发车、异常、归档）、幂等重跑、阶段前置护栏、鉴权矩阵、cleanup |
| 页面场景 | scenario-*（11 套） | UI 装配、payload 形状、CONFLICT 自愈（activity/signup/vehicle）、CAPACITY→waitlist 询问（signup）、发布两阶段（editor）、阶段推进弹层（workspace）、清点/发车（vehicle）、通知三受众（notices） |
| UI E2E（B 层，真模拟器） | tools/e2e-ui-test | workspace 全链预演；**只读+表单，刻意不 tap 提交类按钮**（写路径全靠 A 层） |

**明显未覆盖（按 §2-13 反推）：**

1. **Signup 分支矩阵**：promote 的 GROUP_SCOPE（keepTogether 整组同递补）与 CAPACITY 整批拒绝；waitlist 模式在「仍有名额」时的 INVALID_INPUT；rejected 终态；cancelled 人重新报名（DUPLICATE_PERSON 只查 current）。
2. **removed vs cancelled** 的双语义分支（owner 移除他人 vs 自取消）。
3. **travelLocked 全矩阵**（joined/上车 outbound/上车 return/home/车辆 leg 历史 五事实分别封死 cancel/edit/assignment 修改）。
4. **Vehicle legs 边界**：return 程阶段门（active|closing）、complete 前置 departed、UNRESOLVED_DEPARTURE 三态放行/拦截（null 拦、not_departed/coordinating 放）、**lateArrival 发车后补上车特例**、boarded=false 发车前抹除。
5. **取消活动的三重护栏**：UNRESOLVED_SAFETY（现场事实）、DRIVER_CONFLICT（参与者司机）、active/closing 拒取消。
6. **归档安全门**：coordinating 未收口 / joined 未 home / open incident 三种 UNSAFETY。
7. **gathering→active 自动创建 late incident** 及其连锁卡归档。
8. **departure 翻转规则**（joined 不可逆、非 joined 与上车事实矛盾检查）。
9. **returnPlan 双向切换**与 return 上车/发车后的冻结。
10. **assignment.swap 的不变量回滚**（PICKUP_MISMATCH/GROUP_SCOPE/SEAT_TAKEN 整单拒绝）；**commit 的 baseRevision 过期与「不能删改已有座位」**。
11. **REQUEST_REUSED**（同号异内容）与回执 600 窗口挤出后的重放语义。
12. **expectedRevision 缺省路径**（不传=按服务端当前 revision 应用）。
13. **position 全线**：CONSENT_REQUIRED（endAt 已过）、每 signup 单条覆写、revoke 后投影消失、**endAt 延长后旧 consentExpiresAt 不变**、signup.cancel/活动取消自动 revoke。
14. **notice 受众三形态的 canReadNotice 正负路径** + 归档后 publish/delivery 拒 / read 放行 + delivery channel/status 组合校验。
15. **export**：archived ordinary 放行 / sensitive 拒；staff(sensitive) 不能导出；审计事件 summary。
16. **membership**：expiresAt 严格小于边界（=now 即失效）、同车联系人顶替、过期后 staffCan 全灭。
17. **activity.edit 的 lockedKeys**（gathering/active 只能延 endAt）与引用保护（集合点/节点删除拦截）、capacity 下限 CAPACITY。
18. **signup.edit 的 gathering 协调窗**（owner-only）与 trip 改变删 assignment。
19. **事件/通知自动发布的受众正确性**（assignment 变化扩散）；**800/600 截断后的读取**。
20. **双客户端真并发**（同 revision 双写一胜一 CONFLICT + CONFLICT 后自愈重试，目前只有 A 层单点模拟）。
21. **getPhoneNumber 错误路径**（未开通权限的 FORBIDDEN 话术）。
22. **no-op 成功族**的 revision+1 行为（重复 depart/read 等不应炸但会推进版本）。

---

## 17. 建议优先加入 E2E 的 20 个业务场景

> 排序原则：P0 = 安全/资金外的最高业务风险（人员安全收口、座位与名单一致性、幂等与并发）；
> P1 = 状态机分支覆盖。所有场景默认按 §16「未覆盖」空白设计，A 层（e2e-test 风格打 exports.main）即可覆盖绝大部分，
> 标注 [B] 的需要 B 层真机（涉及 UI 通道）。

| # | P | 场景 | 关键断言（预期结果） |
|---|---|---|---|
| 1 | P0 | **归档安全门三连** | joined 未 home → UNRESOLVED_SAFETY；coordinating 未收口 → UNSAFETY；有 open incident → UNSAFETY；补齐后归档成功且 detailState=finished、readContact/readSensitive(带用途) 被拒 |
| 2 | P0 | **取消活动的护栏** | 有 joined 出发/任何上车/home → UNRESOLVED_SAFETY；有参与者司机 → DRIVER_CONFLICT；active 阶段直接拒；draft/published/gathering 无事实时成功：报名→cancelled、assignment 清空、position 全 revoke、attendance 保留 |
| 3 | P0 | **发车清点门 UNRESOLVED_DEPARTURE** | 乘客 departure=null → 拒发车；not_departed/coordinating → 放行；return 程要求 joined+assigned 者全部上车；发车后 board 篡改被拒 |
| 4 | P0 | **lateArrival 特例链** | gathering 未签到标 coordinating → active（自动生成 late incident）→ active 补签到+补上车（唯一发车后可上车路径）→ 后续 incident.resolve 收口才能归档 |
| 5 | P0 | **幂等与回执边界** | 同 requestId 同指纹 → replayed=true 且 revision 不变；同 requestId 异指纹 → REQUEST_REUSED；不同用户同 requestId 各自独立成功；灌 601 条回执后首条重放 → 按新命令执行（命中业务守卫或成功双写） |
| 6 | P0 | **CAS 双层** | 客户端旧 expectedRevision → CONFLICT；不传 expectedRevision → 成功应用；preview.baseRevision 过期 → CONFLICT「分车预览已过期」；两并发写同 revision → 一胜一 CONFLICT（全局 revision 语义） |
| 7 | P0 | **assignment 不变量回滚** | swap 造成 PICKUP_MISMATCH / SEAT_TAKEN / GROUP_SCOPE → 整单拒绝、座位原状；commit 试图删除/覆盖已有座位 → CONFLICT |
| 8 | P0 | **travelLocked 全矩阵** | departure=joined / outbound 已上车 / return 已上车 / home / 所乘车已发车 五事实分别使 signup.cancel、signup.edit、assignment.set/remove/swap 被 WRONG_PHASE 拒 |
| 9 | P1 | **signup 状态机补全** | promote 整组 GROUP_SCOPE（keepTogether 余留候补）、CAPACITY 整批拒、成功后是 pending 需二审；waitlist 在有名额时 INVALID_INPUT；rejected 后同人重新报名成功 |
| 10 | P1 | **removed vs cancelled** | owner 取消他人（非自己提交）→ removed；本人/提交者取消 → cancelled；两者都释放座位与分车 |
| 11 | P1 | **报名窗口三条件** | phase=published + acceptingSignups + now<deadline 各断其一：关闸后拒、deadline 当秒拒（>= 语义）、gathering 后拒 |
| 12 | P1 | **automatic 模式直通** | approvalMode=automatic 提交 → 直接 confirmed（无需 review）→ 可直接分车；与 manual 混合回归 |
| 13 | P1 | **position 生命周期** | 非 active 拒 / 非 joined 拒 / consent=false 拒 / endAt 已过 CONSENT_REQUIRED / 二次上报覆写（仅一条）/ revoke 后投影消失 / **owner 延长 endAt 后旧位置仍过期，重新上报恢复** / signup.cancel 自动 revoke |
| 14 | P1 | **notice 受众与归档门** | 三受众各自的 canReadNotice 正/负用例（vehicle 受众含 confirmed+已分车者）；归档后 publish/delivery 拒、read 放行；delivery channel/status 组合（subscription_simulation+copied → INVALID_INPUT） |
| 15 | P1 | **export 审计语义** | 归档后 ordinary 导出成功 / sensitive 被拒；staff(sensitive 能力) 导出被拒；export.record 成功而 CSV 读取失败时事件已落库（审计=意图） |
| 16 | P1 | **membership 边界** | expiresAt=now → 已失效（严格<）；同车第二联系人顶替第一条；staff 能力里无审核/分车（review/promote/vehicle.save 全 FORBIDDEN）；sensitive 能力逐人 scope 生效 |
| 17 | P1 | **activity.edit 阶段锁** | gathering 改 title/capacity/pickupPoints → WRONG_PHASE；只延 endAt → 成功；published 删被引用集合点/节点 → INVALID_INPUT；capacity 低于占用 → CAPACITY |
| 18 | P1 | **signup.edit 协调窗与 trip 改动** | gathering 时参与者自己编辑被拒、owner 编辑成功；改 trip.mode/pickupPointId → assignment 静默删除且事件通知扩散到该人 |
| 19 | P1 | **no-op 成功族** | 重复 vehicle.depart/complete、attendance.node/home、incident.resolve、notice.read → 全部 ok、revision 逐次 +1、无重复副作用（home/nodes/incident 不重复写） |
| 20 | [B] P1 | **B 层真机链** | 真机 tap 走通「报名→CAPACITY 询问转候补→owner 递补→二审→分车预览→提交→签到（定位/降级人工）→出发核实→发车」UI 通道；CONFLICT 自愈 toast 后重按成功；CONFLICT 标记 needRefresh 不吞错误 |

---

## 附：E2E 断言可用的确定性钩子

- 全链终态判定：`read` 视图 `detailState`（§2.4）+ `counters`（confirmed/pending/waitlisted/remaining/unassigned/unchecked/pendingHome/openIncidents，selectors.js:375-384）。
- 落库回读：`readTransport`（vehicles.legs + assignments）、`readAccess`（memberships）、`readNoticeManagement`（readBy/deliveries）、`readExport`（CSV 文本）。
- 事件流：`ot_events`（kind=命令类型、summary、actorId）；A 层可用 stub db 直接断言。
- 幂等探针：dispatch 返回 `{targetIds, replayed, revision}` 三元组。
- 沙盒造数：trailApiLab seed/cleanup（§15.8），活动标题必须带前缀。
