# OurTrail 独立 QA 审查报告（Independent QA Review）

- **审查对象**：GitHub HEAD `1acd55e`（merge: 双机日志合流），master 分支，工作区干净（本文档除外）。
- **审查方法**：纯静态走读，自后端域层（13 个纯模块 + index/store）到客户端（api.js、editor、signup、activity、workspace、三个面板组件、notices-page、draft），逐条追踪「命令 → 不变量 → 持久化 → 页面反馈」的完整链路。
- **独立性声明**：本报告**不引用现有测试的通过状态作为结论依据**，不执行任何既有 E2E，不修改任何代码。所有结论均给出 `文件:行号` 级证据，供复核。
- **等级定义**：
  - **P0**：会静默丢失/损坏用户数据、越权访问敏感数据、或核心流程不可用。**本轮未发现**。
  - **P1**：真实用户在正常使用节奏（弱网、多人、双机）下大概率撞上，造成错误结果、重复数据或误导性失败。
  - **P2**：特定但常见的前置下出现；有正确性影响或明显误导，用户可自行恢复但体验受损。
  - **P3**：边界、竞态窗口极窄、或纯观感问题。

---

## 一、系统级结构性风险（先读这节，后面的场景大量引用这里）

### R-1 全局 revision 被「读类写操作」消耗，分车提交被频繁踢爆（P1，系统性）

**机制**：整个 State 共享一个全局 `revision`（`store.js`），任何 dispatch——包括**零数据变化的 `notice.read`**（`domain/notices.js:28` 第二次已读时不改任何字段）和 `export.record`（只追加审计事件）——都会使 `candidate.revision += 1`（`domain/commands.js:127`）并落库。

**引爆点**：`assignment.commit` 有第二重强校验 `preview.baseRevision !== candidate.revision → CONFLICT「分车预览已过期，请重新生成」`（`domain/transport.js:131`），而 `baseRevision` 是 `previewAssignments` 那一刻的全局 revision（`domain/allocation.js:92`）。

**后果**：组织者在「分车」页生成预览 → 任何一个群友在此期间点了一下通知「已读」或产生任何写 → 提交必失败。越是多人活跃的晚上（正是分车的典型时段），越容易陷入「预览→过期→重预览→再过期」的循环。相关联：同一页面上的两次连续命令（第一次成功后 revision 已变）也会互踢，见场景 NAV-6 / ATT-1。

**为什么现有测试测不到**：单账号顺序测试里没有「其他人读通知」这个并发源；`lab-dryrun` 类测试是串行的，revision 永远干净。

### R-2 幂等机制端到端断裂，且两个断点方向相反（P1，系统性）

**断点 (a)——客户端从未启用 requestId**：`api.js:95-104` 的 `dispatch(payload, expectedRevision, requestId)` 有第三参，但不传时**每次随机生成**。`dispatchAndSync`（`api.js:111`）不透传 requestId；grep 全仓库，**没有任何页面/组件传入过稳定 requestId**。服务端的回执幂等表（`ot_receipts`，`domain/commands.js:116-121`）因此是**死机制**。

**后果**：弱网下「请求已到服务端但响应超时」，用户重试 → 新 requestId → 命令**重复执行**。受影响命令矩阵（按危害排序）：
- `incident.report` → **重复异常记录**（`domain/field.js:21-26` 无去重）
- `activity.create` → **重复草稿**
- `notice.publish` → **重复通知**
- `membership.save` → 客户端每次现场生成 membershipId（`roster-panel.js:362`）→ **同一人出现重复 staff 授权**（vehicle_contact 有同车去重，staff 没有）
- `export.record` → 审计事件重复（噪声）
- 兜底较好的：`signup.submit`（DUPLICATE_PERSON 拦截）、`attendance.*`（覆盖写）、`position.report`（替换写）、`vehicle.save`/`assignment.set`（按 id upsert）。

**断点 (b)——即使未来启用 requestId 也会误判**：`index.js:119-123` 先 `overrideEvidence(clean, now, actorId)`（把 Evidence 类对象的 `at` 覆写为**本次服务端时间**），**然后**才计算指纹。含 Evidence 的命令（`attendance.checkin`、`attendance.departure`——`schema.js:189/223-226` 要求客户端必须伪造 `at/by` 才能过 schema）在重试时服务端时间已变 → 规范化 payload 不同 → 指纹不同 → 命中回执后走 `REQUEST_REUSED`「此请求号已用于另一份内容」（`domain/commands.js:118-120`）。**即：先修 (a) 让客户端复用 requestId，重试会立刻全部变成 REQUEST_REUSED 假失败。** 两断点必须一起修。

**为什么现有测试测不到**：纯逻辑测试直接调 `reduceCommand`，指纹由测试方自备；E2E 不做「响应丢失后重试」的注入。

### R-3 activity 页 `run()` 不回写 revision——同一弹层第二个操作必冲突（P1）

`pages/activity/activity.js:446-453`：`api.dispatchAndSync(payload, this.revision, this).then(() => { ... return this.reload() })` —— **忽略返回值里的 `res.revision`**，只靠异步 `reload()` 刷新。对比其余全部调用点都同步回写（`field-panel.js:194`、`transport-panel.js:201`、`roster-panel.js:189`、`me.js:188`、`signup.js:365`、`editor.js:578`）。

**后果**：成功后的 toast 期间 `busy` 已复位而 reload 尚未返回（一次云函数往返，弱网下数秒）。用户连续操作（给 A 签到→给 B 签到；先取消→再编辑；上报位置→记录节点）时，第二个命令携带**过期 revision** → 服务端 CONFLICT → `dispatchAndSync` toast「**安排已被他人更新**，已刷新，请重试」——**错误归因**（明明没有他人）。命中后弹层里的 `selError` 还会叠加显示服务端原文「安排已更新，本次修改没有保存…」，双重提示互相矛盾。

### R-4 编辑器「本地草稿无条件覆盖服务器」+ 整对象提交 = 跨设备静默丢改动（P1）

`pages/editor/editor.js:161`：`if (saved && !denied) initial = saved` —— 本地草稿**无条件**压过刚读到的服务器数据，没有时间戳/内容版本对比（Activity 实体根本没有 `updatedAt` 字段，`schema.js:157-165`）。正常路径保存成功会 `clearDraft`（`editor.js:579/770/821`），但以下链路残留草稿且覆盖服务器：

1. **双机**：设备 A 编辑未保存（草稿落盘）→ 设备 B 编辑并保存 → A 重新打开编辑器 → **B 的修改被 A 的旧草稿盖在表单里**，A 一保存即静默覆盖（`activity.edit` 是整对象替换，`domain/activity.js:107 Object.assign(activity, input)`）。
2. **保存失败残留**：`persistCurrent` 失败（网络）→ 草稿仍在 → 用户改天进来直接在旧表单上保存，中间服务器上的任何变化被覆盖。
3. **与 CAS 重试联动放大**：CONFLICT 时 `dispatchAndSync` 调 `page.reload()`（editor 的 reload 同样草稿优先）→ 用户基于旧草稿重试 → 把冲突对方的修改**整对象覆盖**，CAS 形同虚设。

`miniprogram/AGENTS.md` 与 git log（f8f0b33「本地草稿防 reload 覆盖」）表明 signup/me 页修过同类问题，**editor 页是漏网点**。

### R-5 座位/容量/上车点的服务端不变量是唯一防线，UI 零预检（P2 集合）

以下操作 UI 都放行、靠 `assertInvariants`（`domain/invariants.js`）在提交时用一句域文案拦下：
- 把人指派到已占座位 → `SEAT_TAKEN`「同一个座位不能安排两位参与者」（`invariants.js:103`；`transport-panel.js:238-252` 不检查目标座位占用）
- 改座号标签导致已分配座号失效 → `INVALID_INPUT`「所选座号不属于这辆车」（`invariants.js:101`）
- 减核载/加 blockedSeats 低于现有乘客 → `VEHICLE_FULL`（`invariants.js:88`）
- 车辆勾掉某乘客的上车点 → `PICKUP_MISMATCH`（`invariants.js:99`）
- 跨车 swap 碰到同行组/上车点约束 → `GROUP_SCOPE`/`PICKUP_MISMATCH`（`invariants.js:107-111`）

数据不会坏（不变量兜得住），但组织者在集合现场的时间压力下连续收到谜语文案，且**必须先手动解除冲突再重试**，UI 不指路。

### R-6 `signup.cancel` 的 reason 是「必填但丢弃」的黑洞（P2）

客户端两处强制填写：活动页 `activity.js:539-543`「取消报名需要说明原因」、名册批量 `roster-panel.js:180-183`「取消需要填写原因」。服务端 `schema.js:329` 声明了 `reason: specText`，但 `domain/signup.js:132-143` 的 cancel 分支**从不读取它**，事件摘要也不含（`commands.js:59-61` 只有 transition 拼 reason）。用户以为自己传达了原因，组织者永远看不到。

### R-7 通知系统的三个静默消失点（P2/P3）

- **车辆删除** → `vehicle.remove` 级联删 vehicle_contact membership（`transport.js:122`），但历史 `audience.kind==='vehicle'` 通知仍在；`canReadNotice` 对 vehicle 受众要求车辆仍存在（`permissions.js:95-97` requireVehicles 失败 → false）→ **这些通知从所有人的通知列表静默消失**，且 `notice.read` 永久 FORBIDDEN。
- **参与者被移除/取消** → 活动级通知要求 `isCurrentSignup`（`permissions.js:101`）→ 被移除者不再看到后续活动通知（合理），但自动通知受众计算（`commands.js:71-79`）会把「座位被释放」也解释成受众，**被移除者的历史通知仍可读**（`own` 不查状态）——行为不一致但方向安全。
- **通知量**：每次 signup./assignment. 命令都为受影响者生成新通知（`commands.js:80-85`），无聚合。频繁调整分车 = 同一人收一打「乘车安排已更新」。

### R-8 其他值得记录的结构点（P3）

- `home` 视角的 `openedActivityIds` 由客户端 LRU 提供（`draft.js:70-76`，`selectors.js:264`）→ **任何拿到活动 id 的人可永久读取该活动全文**（非草稿活动本身就不校验关系，`selectors.js:319-322` 只挡 draft）；被移除参与者也会一直在家页看到卡片。对「邀请链接」语义可接受，但要知道这一点。
- `genId`（`contracts.js:36-38`）毫秒时间戳+31bit 随机，两实例同毫秒碰撞概率可忽略，但 `recordKey` 按 id 幂等覆盖（`store.js:25-29`），碰撞=静默覆盖，记录在案。
- `loadState` 每次全量读 15 个集合（`store.js:70-82`），V1 可接受；`ensureCollections` 在**每个** action 入口跑一遍 `createCollection`（`index.js:261`），纯开销。
- 免登录白名单确认只有 `getWeather`/`getWeatherByPoint`（`lib/weather.js:222`），无越权读取面。
- 客户端校验与服务端不一致的例子：手机号客户端要求 11 位（`signup.js:287`），服务端 `Person.phone` 只是非空字符串（`schema.js:116`）——API 直调可写入 2000 字符「电话」并进入名单导出与车辆联络视图。

---

## 二、场景库

格式：每场景含 ID / 角色 / 前置 / 操作 / 预期 UI / 预期 page.data / 预期 backend / 失败条件 / 等级 / 为什么易错。「backend」指 `ot_*` 集合与 revision 的期望终态。

### Activity（活动）

**ACT-1 双机草稿覆盖他人修改（P1）** ← R-4
- 角色：唯一 owner，两台设备（或两处会话）。
- 前置：活动已发布；设备 A 打开编辑器（草稿自动落盘），改动未保存。
- 操作：设备 B 修改活动简介并保存成功；随后设备 A 直接点「保存」。
- 预期 UI：A 应看到 B 的修改仍在（或明确合并提示）。
- 预期 page.data：`form.description` 应等于 B 保存后的值。
- 预期 backend：`ot_activities` 文档 description 为 B 的版本，revision 只因 B +1。
- 失败条件：A 保存后 description 变回 A 草稿中的旧值，且无任何冲突提示。
- 为什么易错：草稿无版本对比、实体无 updatedAt、保存是整对象替换、CONFLICT 重试路径也走草稿优先 reload。现有 E2E 全部单会话。

**ACT-2 编辑器清空「名额」字段静默回退 24（P2）**
- 角色：owner。前置：活动容量 50，已报名 10 人，published。
- 操作：编辑器里清空名额输入框（误触或以为要重填）→ 保存。
- 预期 UI：应提示「名额不能为空」或按原值保存。
- 预期 page.data：`form.capacity` 保持 '50'。
- 预期 backend：capacity 仍 50。
- 失败条件：`editor.js:203` `Number('')||24` → capacity 静默变 24；occupied(10)≤24 时服务端放行，`counters.remaining` 从 40 变 14，报名者看到名额骤减。
- 为什么易错：`||24` 兜底把「空输入」当「默认值」，空值与 0 值语义混写。

**ACT-3 集合/行程中编辑活动触碰锁定字段（P2）**
- 角色：owner。前置：phase=gathering。
- 操作：从工作台进编辑器，只改「费用说明」保存；再做一次，同时改了标题或删了一个未被引用的集合点。
- 预期 UI：前者成功；后者给出「集合或行程中仅可修改说明、装备、费用和取消说明，并延长结束时间」。
- 预期 backend：前者 revision+1；后者不变。
- 失败条件：前者被拒（键序/数组序假阳性，`domain/activity.js:98-104` 用 `JSON.stringify` 逐键比较，跨客户端版本键序漂移即误伤）；或后者被放行。
- 为什么易错：编辑器 WXML 无 gathering 阶段的结构编辑门控（grep 无命中），全靠服务端 JSON 字符串比较，对键序敏感。

**ACT-4 候补滞留：带候补进入集合阶段（P2）**
- 角色：owner + 1 候补用户。
- 前置：published，capacity 满，1 人 waitlisted。
- 操作：owner 处理完 pending 后点「开始集合」。
- 预期 UI：应提示「仍有候补人员，进入集合后其将无法递补」或提供处理入口。
- 预期 backend：允许进入 gathering（`activity.js:157-158` 只挡 pending，不挡 waitlisted）；此后 `signup.promote` 因 phase!=='published' 永久失败。
- 失败条件：候补者在活动页长期显示「候补中」且无任何出口、无通知说明。
- 为什么易错：跨模块——transition 的校验面与 signup.promote 的 phase 门不同步。

**ACT-5 删除草稿后另一入口仍可达（P3）**
- 操作：editor 里删除草稿 → 返回后点分享卡片/历史入口再开该 id。
- 预期：`selectView` 返回 `NOT_FOUND`「找不到此活动」，页面 denied 态干净。
- 失败条件：白屏、undefined 渲染或可继续编辑。
- 为什么易错：级联清理（`activity.js:194-212`）覆盖 9 个集合，容易漏某个投影路径。

### Signup（报名）

**SGU-1 最后名额整组提交，容量不足 → 候补弹层 → 候补竞态（P1 验证链）**
- 角色：报名者；并行另一报名者。
- 前置：remaining=2，报名表勾选本人+1 同行人（3 人时用剩余 1 的变体）。
- 操作：提交 → 服务端 CAPACITY → 页面弹「名额不足，是否候补」→ 选候补重提；期间名额被他人占掉又释放。
- 预期 UI：CAPACITY 时弹层、候补提交成功提示「报名已提交（候补）」；若名额已恢复，候补提交应被拒并说明。
- 预期 page.data：`capacityAsk:true` → 重提后 `busy` 状态正确、草稿清空。
- 预期 backend：status='waitlisted'；若 fits 则服务端 `INVALID_INPUT`「整组仍有名额，请正常提交报名」（`signup.js:65`）。
- 失败条件：候补被拒时文案不可理解、或重复扣/放名额。
- 为什么易错：`occupied` 在两个快照间漂移，CAPACITY→waitlist 的二次提交语义反直觉。

**SGU-2 取消原因黑洞（P2）** ← R-6
- 角色：报名者自取消；或 owner 批量移除。
- 操作：活动页取消报名，理由「家中有事」；名册批量取消理由「重复报名」。
- 预期 backend：`ot_signups.status` 变 cancelled/removed，**reason 应可追溯**。
- 失败条件：两个集合与 `ot_events` 里都找不到 reason 的任何痕迹（当前实现即如此）。
- 为什么易错：schema 收字段、handler 不消费；三处 UI（两处必填一处发送）都假定它有意义。

**SGU-3 被拒/取消后重新报名全链路（P1 验证点）**
- 角色：曾被 reject 的报名者。
- 前置：activity published、acceptingSignups、未过截止。
- 操作：打开活动页 → 报名入口应可见（`detailState='new'`，`activity.js:273` 双条件）→ 重新提交。
- 预期 backend：`registerParticipants` 只对 current（pending/confirmed/waitlisted）查重（`signup.js:41`）→ 新报名成立。
- 失败条件：入口被 `detailState` 误判为 closed（例如 primary 选中旧 cancelled 记录导致状态串扰），或服务端 DUPLICATE_PERSON 误伤。
- 为什么易错：`primary` 选择器（`selectors.js:338-340`）会把非 current 的 self signup 推为 primary，detailState 与 permittedActions 双信号源可能不同步。

**SGU-4 编辑报名改上车点 → 座位静默释放（P2）**
- 角色：已分车 confirmed 报名者。前置：已 assignment 到 A 车 03 座，trip=集合点1。
- 操作：报名编辑把上车点改为集合点2 → 保存成功。
- 预期 UI：提示应包含「已改出行安排，原座位已释放」；工作台 unassigned 计数 +1。
- 预期 backend：`signup.js:158-161` tripChanged → assignment 删除；自动通知受众含此人（座位变化检测 `commands.js:71-79`）。
- 失败条件：页面/活动页仍显示旧车旧座（缓存行），或组织者分车面板人数对不上。
- 为什么易错：跨模块副作用（报名编辑 → 分车变化）只体现在通知文案「报名资料与出行安排已更新」，行内状态容易陈旧。

**SGU-5 编辑模式用途闸门的权限矩阵（P2）**
- 矩阵：本人编辑自己（无需用途）／owner 编辑自己代报的同行人（`canReadSensitive` 需非空 purpose，`permissions.js:79-81`）／owner 集合阶段协调（`gatheringCoordination`，`signup.js:151`）／他人报名被 owner 编辑时 purpose 必须 ≥1 字符。
- 失败条件：owner 在编辑代报人时未填用途 → `readForm` FORBIDDEN，文案「敏感资料仅供本人…」让 owner 以为被越权拦截。
- 为什么易错：purpose 既是读取闸门又是审计字段，语义重载。

**SGU-6 集合阶段 travelLocked 边界（P2）**
- 操作序列：owner 在 gathering 对未出发者 signup.edit 改时间/上车点（应成功）→ 对已 boarding 的人执行（应拒「报名资料已锁定…」`signup.js:152-154`）→ 对 departure=not_departed 的人取消（travelLocked 只锁 joined/boarding/home，应放行，`signup.js:82-88`）。
- 失败条件：锁的范围与文案不符（如 not_departed 也被锁，或 joined 反而能改）。

**SGU-7 报名表草稿 × 「我的」资料回填合并（P3）**
- 操作：先填一半报名表（草稿落盘）→ 去「我的」改姓名 → 回报名表。
- 预期：草稿中已填字段保留，空字段从新档案补齐（`signup.js:152-167` fillFromProfile）。
- 失败条件：整份被档案覆盖丢输入，或整份保留导致姓名与档案不一致提交。

### Review（审核）

**REV-1 批量审核夹带已变更记录（P2）**
- 前置：owner 勾选 3 个 pending；期间 1 人自行取消报名。
- 操作：不刷新直接批量「通过」。
- 预期：服务端 `WRONG_PHASE`「只有待确认报名可以审核」（`signup.js:118`），**整批失败**；UI 刷新后可重选。
- 失败条件：整批静默部分成功；或错误文案不可理解；或 workspace「名单」tab 停留期间根本不知道状态变了（见 NAV-6）。
- 为什么易错：批量操作是全有全无语义 + 页面数据陈旧窗口。

**REV-2 审核/取消与报名者自取消竞态（P2）**
- 操作：owner 点「通过」的同时报名者在另一端取消。
- 预期：全局 revision CAS 保证一胜一负；负方收到 CONFLICT → 自动 reload + 重试提示。
- 失败条件：两边都报成功（不可能，若出现即 CAS 被绕过，升级 P0 处理）。
- 为什么易错：这是 CAS 机制的正面用例，值得真机确认文案与恢复流。

**REV-3 递补（promote）整组约束与容量（P2）**
- 操作：keepTogether 组 3 人候补，只勾 1 人递补 → 应 `GROUP_SCOPE`「请同时递补仍在候补的全部同行组成员」；全组 3 人递补但名额仅 2 → `CAPACITY`（`signup.js:120-131`）。
- 失败条件：部分递补放行破坏同车组，或容量按个人而非整组计算。
- 为什么易错：组、容量、阶段三个维度交叉。

### Vehicle（车辆）

**VEH-1 有乘客时改座号标签（P2）** ← R-5
- 操作：A 车 3 人已按 01/02/03 分配；编辑车辆把座号改为 A,B,C 保存。
- 预期：服务端拒「所选座号不属于这辆车」，数据不变；UI 应提前提示「先移除乘客或保留原座号」。
- 失败条件：保存成功导致悬挂座号引用；或错误文案无法行动。
- 为什么易错：编辑器打开时（`transport-panel.js:303-334`）预填旧座号文本，改掉即与 assignments 脱钩，只有不变量知道。

**VEH-2 减核载/加禁用位低于现有乘客（P2）**
- 操作：legal 7→5（乘客 5 人）保存。
- 预期：`VEHICLE_FULL`「XX 的乘客人数超过可用乘客位」（`invariants.js:88`），数据不变。
- 失败条件：放行造成超载事实，或文案不含车名无法定位。

**VEH-3 勾掉乘客所需上车点（P2）**
- 操作：编辑车辆取消勾选某已分车乘客的上车点。
- 预期：`PICKUP_MISMATCH`「车辆不经过这位参与者的上车点」。
- 失败条件：放行；或报错指向不清（组织者不知道是哪位乘客）。

**VEH-4 删除车辆 → 车辆通知静默消失（P2）** ← R-7
- 操作：先移除全部乘客 → 删除车辆。
- 预期 UI：成功；vehicle_contact 授权一并消失（成员列表刷新）。
- 预期 backend：vehicle 删除、memberships 级联、历史 vehicle 受众通知保留但**从列表不可达**（`permissions.js:95-97`）。
- 失败条件：通知列表残留可点但「已读」永远报错；或级联漏删导致不变量拒绝后续命令。
- 为什么易错：受众校验要求车辆存在，删除车辆让历史通知变成不可满足的引用。

**VEH-5 参与者司机取消链（P1）**
- 前置：confirmed 用户被登记为 A 车参与者司机（无乘客座位）。
- 操作：该用户在活动页取消报名。
- 预期：服务端 `DRIVER_CONFLICT`「请先更换参与者司机，再取消该报名」（`signup.js:134-136`）；owner 在分车面板更换司机后取消成功。
- 失败条件：取消成功但司机引用悬挂（invariant `invariants.js:80` 应拒绝后续一切命令）；或文案不指路导致死锁感。
- 为什么易错：司机身份横跨 signup/vehicle 两个集合，取消入口在参与者页面，修复入口却在组织者分车面板——跨角色跨页面。

**VEH-6 已发车车辆禁止改配置/删除（P2）**
- 操作：vehicle.depart 后尝试编辑/删除该车、assignment.set 到该车。
- 预期：分别 `WRONG_PHASE`（`transport.js:97/117`）与「车辆已发车，不能修改乘车安排」（`transport.js:35`）。
- 失败条件：hasLegHistory 判定漏某 leg 字段。

### Assignment（分车）

**ASG-1 预览过期循环（P1）** ← R-1
- 角色：owner + 多名群友。
- 操作：owner 生成自动分车预览 → 期间任一群友点通知「已读」→ owner 提交。
- 预期 UI：CONFLICT「分车预览已过期，请重新生成」；点「重新生成」恢复。
- 预期 backend：无写入，revision 仅因已读 +1。
- 失败条件：提交成功但落了过期预览；或弹层卡死无法重生成；或错误提示让 owner 以为网络问题反复重试旧预览。
- 为什么易错：预览与提交是两次独立交互，中间的全局 revision 被无关写消耗；单账号测试永远测不到。

**ASG-2 预览→手动指派→旧预览提交（P2）**
- 操作：生成预览 → 关闭弹层 → 手动把某人指派到车 X → 重开旧预览提交。
- 预期：`CONFLICT`「分车预览不能删除或覆盖已有座位，请使用明确的调整操作」（`transport.js:135-140`）。
- 失败条件：提交成功把手动指派回滚成预览方案。
- 为什么易错：同一面板两个入口写同一集合，预览快照没有失效机制。

**ASG-3 占座冲突无预警（P2）** ← R-5
- 操作：点已占座位 → 选择另一个人 → 确定。
- 预期 UI：应提示「该座位已有 X」；实际会直接提交并收到 `SEAT_TAKEN`。
- 失败条件：两人同时占一座落库（不可能，invariant 拦）；或文案不指明是谁。
- 为什么易错：座位图有占用渲染（`transport-panel.js:88-99`）但 openAssign 不利用它做前置校验。

**ASG-4 跨车交换撞同行组/上车点（P2）**
- 操作：把 keepTogether 组成员与外车成员 swap。
- 预期：`GROUP_SCOPE` 或 `PICKUP_MISMATCH`；数据不变。
- 失败条件：成功后同车组散落两车（invariant 拦不住即为 P0 级）。

**ASG-5 上车事实后改安排（P2）**
- 操作：某人 boardingByLeg.outbound 已记录 → assignment.set/swap/remove。
- 预期：`WRONG_PHASE`「已有上车或出发核实记录，不能修改乘车安排」（`transport.js:22-27`）。
- 为什么易错：锁的是「事实」不是「阶段」，必须用 attendance 记录而非 phase 判断，容易漏。

### Attendance（现场履约）

**ATT-1 弹层连续操作第二发必冲突（P1）** ← R-3
- 角色：owner（或本人）。
- 操作：弱网（开发者工具 Network → Slow 3G）下在活动页弹层先「确认现场签到」成功，立即给下一人（或同一人记节点）操作。
- 预期 UI：第二发应静默成功（revision 已同步回写）。
- 实际预期（当前代码）：CONFLICT + toast「安排已被他人更新」+ selError 叠加服务端文案，**错误归因**。
- 预期 page.data：第二发前 `this.revision` 应已等于第一次返回的 revision。
- 失败条件：如上（当前即失败）；或 reload 快于点击掩盖问题导致测试不稳定。
- 为什么易错：`run()` 忽略 `res.revision`；弱网拉长窗口使其必然复现。

**ATT-2 出发核实的顺序依赖（P2）**
- 操作矩阵：未签到先「核实已随队出发」→ `UNRESOLVED_DEPARTURE`「请先核实签到及必要的去程上车」（`field.js:85`）；shared 非司机未上车先核出发 → 同上；先「核实未出发」再上车 → board 被「请先签到并核实是否随队出发」（`field.js:74`）拦下。
- 失败条件：顺序漏洞让未签到的人带上 joined 出发事实（invariant `invariants.js:129` 将拒绝一切后续命令，死锁全场）。
- 为什么易错：departure/board/checkin 三方互相前置，状态机靠四段代码共同维护。

**ATT-3 发车清点门槛与迟到窗口（P2）**
- 操作：A 车乘客中 1 人未上车且 departure 为空 → vehicle.depart → `UNRESOLVED_DEPARTURE`「仍有本车人员未上车或未核实去向」；把该人标记 coordinating 后再发车 → 成功；发车后该人迟到补 board（lateArrival 分支 `field.js:76`）→ 成功；尝试改写他人已上车事实 → 拒。
- 失败条件：发车成功漏人；或迟到补上路径在 UI 上不可达。

**ATT-4 收尾与归档门（P1 验证点，正向）**
- 操作：closing 阶段留 1 人未确认到家 / 1 条未解决异常 → 「归档」。
- 预期：`UNRESOLVED_SAFETY`「仍有出发情况、到家或异常未核实，不能归档」（`activity.js:181-187` + `invariants.js:60-66` 双保险）；逐人确认后归档成功。
- 失败条件：带未核实事实归档成功（即安全闸失效，升 P0）。
- 为什么易错：`departure.kind==='joined'&&!home` 与 `coordinating`、`not_departed` 的组合枚举容易漏。

**ATT-5 重复 no-op 写也消耗 revision（P3）** ← R-1
- 操作：对已记录节点再次「确认到达此节点」。
- 预期：`field.js:98` 静默 no-op 成功；backend revision 仍 +1（空 diff 只写 meta）。
- 失败条件：nodes 重复导致 invariant「节点记录重复」拒绝（当前有 `!record.nodes.some` 防御）。

### Position（位置）

**POS-1 endAt 过期后上报被拒 + 延长解锁（P2）**
- 前置：active，`activity.endAt` 已过（组织者原估过短）。
- 操作：本人「上报位置」→ `CONSENT_REQUIRED`「本场位置授权时间已结束，请领队明确延长行程后重新授权」（`field.js:108`）；owner 编辑器延长 endAt（gathering/active 允许延长，`activity.js:98-104`）→ 再次上报成功。
- 失败条件：UI 不显示 endAt 与剩余授权窗口，用户只会看到一句拒绝；owner 不知道去延长。
- 为什么易错：授权窗口绑定 endAt，而 endAt 的延长入口在另一个页面的另一个字段。

**POS-2 closing 阶段位置数据不可见（P3）**
- 前置：active 末尾有人上报，随后进入 closing。
- 预期：`selectors.js:355` phase!=='active' → positions=[] → 现场面板位置区清空。收尾时最后已知位置丢失（设计取舍，记录）。

**POS-3 上报-撤回-再上报（P3）**
- 操作：上报 → 「我的」撤回 → 再上报。
- 预期：`position.report` filter+push 重建记录（`field.js:109-110`），`revokedAt` 回到 null；invariant「取消报名或活动后必须撤回有效位置」保持满足。
- 失败条件：撤回后再上报导致 invariant 拒绝一切命令（当前实现可重建，安全）。

### Incident（异常）

**INC-1 弱网重试产生重复异常（P1）** ← R-2(a)
- 操作：提交「提前退出同行」报备 → 响应超时 → 重试。
- 预期 backend：应只有一条（requestId 幂等）。**当前预期失败**：两条 incident。
- 失败条件：`ot_incidents` 出现同 subject 同描述两条；现场面板出现两个待解决异常，归档前要解决两次。
- 为什么易错：无幂等键、无内容去重；重试是弱网下的本能操作。

**INC-2 重复 resolve 显示成功但内容不变（P2）**
- 操作：解决异常（note=X）→ 重新打开记录页再次填写 note=Y 提交。
- 预期 UI：第二次提交成功，但 `field.js:31` `if (!incident.resolution)` 保留首个 → note 仍 X。用户以为已更新。
- 失败条件：UI 展示的「核实结果」与库内不一致且无提示。

**INC-3 staff 分管范围与多主体异常（P2）**
- 前置：staff 授权 scope=selected 仅含报名 A；异常 subjects=[A,B]。
- 预期：staff 看不到也解不了（`selectors.js:351-353` 要求 subjectIds 全部在范围内）；owner 可处理。
- 失败条件：staff 能看到部分主体的异常（泄露 B 的涉事信息）或能 resolve。

### Notice（通知）

**NOT-1 已读写放大（P1，并入 R-1 验证）**
- 操作：3 个群友各点 2 条通知「已读」，同时 owner 在分车页提交。
- 预期 backend：每次已读 revision+1（`commands.js:127` 无条件）；owner 至少一次 CONFLICT。
- 为什么易错：读行为产生写竞争，违背直觉；单账号不可复现。

**NOT-2 车辆删除后通知蒸发（P2）** ← R-7/VEH-4。

**NOT-3 定向通知受众校验（P2）**
- 操作：owner 发布「指定报名人员」给 2 人；分别验证：未勾人被前端拦（`notices-page.js:180-183`）、受众signup被取消后通知对 owner 仍可见（signups 受众的 canReadNotice 不要求 current，`permissions.js:91-94`）、`notice.read` 双击第二发 CONFLICT（revision 已被第一发消耗，`notices-page.js:197-202` 不回写 revision！与 ATT-1 同病：`onMarkRead` 的 `.then(() => this.reload())` 也忽略 res.revision——**连续点两条通知的「已读」第二发必冲突**）。
- 失败条件：连续已读第二发报「安排已被他人更新」。

### Permission（权限）

**PRM-1 staff 授权全链路 + 过期瞬时（P1 验证链）**
- 操作：owner 在名册「协作」填身份码授予 checkin+node（scope=all，到期时间 1 分钟后）→ 该 staff 账号进入 staff 视角现场面板 → 成功签到他人 → 到期后刷新 → denied「此活动的协作授权不存在或已过期」（`selectors.js:324`）；到期前已打开的面板再操作 → `staffCan` 用服务端 now 判过期 → FORBIDDEN。
- 失败条件：过期边界（expiresAt==now）行为不一致；或 UI 在到期后仍显示可操作且报错误导。
- 为什么易错：权限过期是时间函数，客户端 permittedActions 是读取时快照，两端时钟/时刻不同。

**PRM-2 车辆联络越权矩阵（P2）**
- 操作：vehicle_contact 尝试 assignment.set / signup.review / readTransport。
- 预期：全部 FORBIDDEN（owner-only，`permissions.js:250-260`；readTransport owner-only `selectors.js:181`）。vehicle_contact 只能 board 本车乘客与 depart/complete 本车（`permissions.js:212-216`）。
- 失败条件：任一越权成功。

**PRM-3 代报同意链（P2）**
- 矩阵：`proxyHome` 未授权时代办「安全到家」→ `CONSENT_REQUIRED`（`permissions.js:207-211`）；`proxyAuthority` 缺失时代办编辑 → 同上；本人操作不受影响。
- 失败条件：绕过同意位写入 home/evidence。

### Revision / CAS

**CAS-1 存储层 CAS 兜底验证（P2，防御深度）**
- 操作：构造 expectedRevision 缺失/为字符串的 dispatch（需开发者工具注入或 lab 通道）。
- 预期：`index.js:122` 回退 before.revision → 语义 CAS 失效，但 `store.persistState` 事务内 meta 比对（`store.js:112-116`）仍拒绝 → 客户端收到 CONFLICT。
- 失败条件：绕过事务直接落库（升 P0）。
- 为什么易错：两层 CAS 一层故意放水（回退）、一层必须兜住，是唯一防止并发丢写的底线。

**CAS-2 CONFLICT 双提示叠加（P3）**
- 操作：任意命令 CONFLICT。
- 预期：toast「安排已被他人更新，已刷新，请重试」+ 页面错误区显示服务端「安排已更新，本次修改没有保存…」同屏出现（`api.js:111-119` + 各调用点 catch）。
- 失败条件：用户被两条不同措辞的失败提示搞糊涂后重复提交。

### Idempotency（幂等）

**IDE-1 重试重复矩阵（P1）** ← R-2(a)：`incident.report`/`activity.create`/`notice.publish`/`membership.save` 四个高危 + 兜底良好的 `signup.submit`/`attendance.*`/`vehicle.save` 对照组。

**IDE-2 REQUEST_REUSED 陷阱（P1，结构性，当前不可达）** ← R-2(b)：一旦客户端启用稳定 requestId，含 Evidence 命令的重试全部误判。验证方法：lab 通道手工带同一 requestId 重发 attendance.checkin。

**IDE-3 receipts 600 窗口（P3）**：窗口外重放按新请求（`commands.js:89-94`），记录为已知取舍。

### 页面返回 / 刷新（NAV）

**NAV-1 编辑器 switchTab 去「我的」补档案再返回（P2）**
- 操作：新用户直接写完活动 → 保存被 profileGate 拦 → switchTab 补档案 → 重新进编辑器。
- 预期：草稿完整恢复（`editor.js:597` 注释的设计意图），补全档案后可直接保存。
- 失败条件：switchTab 关闭编辑器丢表单；或恢复的草稿与服务器草稿冲突时表现混乱（连到 ACT-1）。

**NAV-2 signup redirectTo 后返回 / 杀进程（P3）**
- 操作：提交成功跳活动页 → 左上角返回；以及提交中途杀进程再进。
- 预期：返回后草稿已清（不重复提交入口）；杀进程恢复时草稿仍在且可继续。
- 失败条件：草稿残留导致「已报名的人再看到完整报名表」（服务端 DUPLICATE_PERSON 兜底，文案要可懂）。

**NAV-3 半提交状态恢复（P3）**：现场面板 busy 中杀进程 → 页面重建 busy=false，无悬挂锁（无客户端锁机制，自然恢复）。backend 可能已落一条（见 IDE-1）。

**NAV-4 下拉刷新与 onShow 重读（P3）**：activity/workspace/notices 均 onShow reload；验证从工作台返回活动页能看到最新 counters。

**NAV-5 通知 Tab 高亮（P3）**：自定义 tabBar selected 由 onShow 自报（`notices-page.js:37-40` 注释记录的既往 bug），回归确认。

**NAV-6 workspace 名单页陈旧数据（P2）**
- 操作：停在「名单」tab 不动；期间 2 人新报名、1 人取消。
- 预期 UI：应有任何「数据可能已过期」信号或提交前复核。
- 实际：tab 切换不重读（`workspace.js:111-115` 只 setData），批量审核按旧名单发 → 服务端对已取消者 WRONG_PHASE 整批失败；对新增者无感知。
- 为什么易错：tab 是本地视图不是路由，onShow 不触发。

### 网络异常（NET）

**NET-1 弱网 dispatch 超时但服务端已成功（P1）** ← R-2(a)/INC-1：DevTools 自定义网络 100% 丢包率模拟「发出未归」。重试后核对 `ot_incidents`/`ot_notices`/`ot_activities` 重复度。

**NET-2 read 超时（P3）**：denied 文案「网络异常，请稍后再试」，重进恢复；数据无副作用。

**NET-3 云函数 20s 超时文案（P3）**：-504003 映射文案是否可行动（`api.js:38`）。

**NET-4 完全离线（P3）**：wx.cloud 抛错 → NETWORK 文案；不出现 undefined 弹窗。

### 重复点击（DBL）

**DBL-1 busy 防重抽查（P2）**：发布/取消活动/审核提交弹层的确定键在 in-flight 期间连点 → 应只发一次。`busy` 标志各处齐备（`editor.js:557`、`workspace.js:140`、`roster-panel.js:186`），真机验证 WXML 是否都绑定了 disabled/遮罩。

**DBL-2 双击发布 → 假失败（P2）**
- 操作：发布确认弹层快速双击「确认发布」。
- 预期：第二次应被 busy 拦截；若漏拦 → 第二次 `WRONG_PHASE`「只有草稿活动可以发布」→ 用户看到红色失败但活动其实已发布（backend 成功页面显示失败，正中「跨模块症状」清单）。
- 为什么易错：publish() 无 busy 检查（`editor.js:789` 只查 savedId；doPublish 也无）， participate 分支还异步读 profile 拉长窗口。

**DBL-3 双击「已读」/「签到」（P2）**：第一发成功后 revision 未回写的调用点（activity.js run、notices-page onMarkRead）第二发 CONFLICT；有回写的调用点 no-op 幂等但空耗 revision。

### 多人并发（CCU）

**CCU-1 最后名额双人抢（P1）**
- 操作：两台开发者工具（两个 openid），remaining=1，同时提交。
- 预期：一人 confirmed，另一人 CONFLICT→刷新→CAPACITY→候补弹层。
- 失败条件：双双成功（超卖，若出现直接 P0）。
- 为什么易错：`occupied` 快照 + 全局 CAS 是唯一防线，值得真机实测一次。

**CCU-2 组织者编辑 vs 报名流（P2）**：owner 在 gathering 编辑活动（延长 endAt）与参与者 signup.edit 并发 → 一胜一 CONFLICT；胜者生效后败方 reload 恢复。验证 CONFLICT 恢复流不丢各自输入。

**CCU-3 board 与 depart 赛跑（P2）**：清点中最后一人 board 的同时车长点发车 → 或 depart 被未清点拦、或 board 被「车辆已发车」拦（`field.js:76`）；迟到补上窗口（lateArrival）兜底。两个失败文案都要可懂。

**CCU-4 owner 双设备编辑（P1）** ← ACT-1/R-4：并发编辑同一活动，验证静默覆盖。

### 空数据（EMP）

**EMP-1 新用户冷启动链（P2）**
- 操作：全新 openid → 首页 → 发现页报名 → 报名页应拒「请先到我的保存姓名与联系电话」（`signup.js:79-81`）→ 补档案 → 回报名页可提交；直接进编辑器建活动 → profileGate 拦截（`editor.js:561-570`）。
- 失败条件：空 profile 导致 `readTransport`/`read` 崩溃或 home 视角报错（`selectors.js:250-253` 空壳 profile 兜底）。

**EMP-2 活动无坐标路线（P3）**：所有 points/pickups 无 coordinates → 地图 `visible:false`（`activity.js:72-73`），不渲染残缺地图。

**EMP-3 无报名直接分车（P3）**：previewAssignments 返回空 assignments/unassigned → commit 空方案 → revision+1 的空写成功。验证不报错、面板计数 0。

**EMP-4 天气空数据门槛链（P2，真机专项）**：`denied=''`+`loading=false`+`loadingWeather=false`+`dayCards` 空 → 图表区不出现；注入合成 dayCards 后 canvas 出现（`docs/e2e-mp/README.md` 记录的渲染门槛链，纯逻辑测试不可见）。

### 边界数据（BND）

**BND-1 手机号格式（P3）**：客户端 11 位强校验 vs 服务端任意非空字符串——API 直调写 2000 字符 phone → 名册/导出/车辆联络视图渲染。验证 UI 不破版、导出 CSV 转义正常（`csvCell` 已做注入中和，`selectors.js:206-209`）。

**BND-2 capacity=1 + 发起者本人参与（P3）**：发布即满员，remaining=0；本人报名占用唯一名额后他人只能候补。

**BND-3 超长文本（P3）**：2000 字符 description/medical/note → 编辑器、名册行、异常卡片的折行与性能。

**BND-4 集合时间在过去 / deadline==startAt（P3）**：服务端只校验 deadline≤start<end（`activity.js:26-29`），meetingAt 无约束 → 可建「集合时间是昨天」的活动；报名在 deadline==startAt 时刻关闭语义。

**BND-5 座号全角逗号（P3）**：座号输入「01，02」（全角逗号）→ 客户端 split(',') 得 1 个标签 → 数量不符被前端文案拦（`transport-panel.js:434`）。

**BND-6 staff 过期时间边界（P3）**：expiresAt=now±1s 的判定一致性（`permissions.js:35` 严格小于）。

---

## 三、最值得真机 DevTools E2E 验证的 Top 30

按「逻辑测试测不到 + 用户伤害大」双因子挑选。标注配套双账号/网络条件。

| # | 场景 | 验证核心 | 条件 |
|---|------|----------|------|
| 1 | ATT-1 弹层连续两操作 | 弱网下第二发 CONFLICT + 错误归因文案（R-3） | Slow 3G |
| 2 | ASG-1/NOT-1 预览过期循环 | 双账号：B 点已读期间 A 提交分车（R-1） | 双工具实例 |
| 3 | INC-1/NET-1 弱网重试重复报备 | 丢包注入后重试 → ot_incidents 双条（R-2a） | 丢包 100%→恢复 |
| 4 | ACT-1/CCU-4 双机草稿覆盖 | A 未保存草稿、B 保存、A 再保存（R-4） | 双会话 |
| 5 | CCU-1 最后名额双人抢 | 一胜一 CAPACITY，不超卖 | 双工具实例 |
| 6 | VEH-5 司机取消链 | DRIVER_CONFLICT 文案 + 修复路径跨页可达 | — |
| 7 | ATT-4/INC-3 归档安全门 | 未到家/未解决异常阻断归档（正向 P0 探针） | — |
| 8 | ATT-2 出发核实顺序 | 未签到核 joined 被拦；错误顺序不产生死锁态 | — |
| 9 | ASG-3 占座冲突 | 已占座位指派他人 → SEAT_TAKEN 文案 | — |
| 10 | ASG-4 跨车 swap 撞约束 | GROUP_SCOPE/PICKUP_MISMATCH 文案可行动 | — |
| 11 | VEH-1 改座号有乘客 | 保存被拒、旧座号引用不悬挂 | — |
| 12 | VEH-2/3 减核载/漏上车点 | VEHICLE_FULL/PICKUP_MISMATCH 指向清晰 | — |
| 13 | SGU-1 满员整组→候补 | CAPACITY 弹层→候补→fits 竞态文案 | — |
| 14 | SGU-3 被拒后重报名 | detailState 'new' 与 permittedActions 双信号一致 | — |
| 15 | SGU-2 取消原因去向 | UI 必填、ot_events/集合无痕（R-6 确认） | 查库 |
| 16 | SGU-4 改上车点释放座位 | unassigned 计数与行内车辆标签即时一致 | — |
| 17 | REV-1 批量审核夹带变更 | 整批 WRONG_PHASE 后可恢复 | 双账号 |
| 18 | REV-3 递补组约束 | GROUP_SCOPE 与 CAPACITY 双门槛 | — |
| 19 | POS-1 endAt 过期上报 | CONSENT_REQUIRED → 延长 endAt → 解锁全链 | 跨页面 |
| 20 | PRM-1 staff 授权全链路 | 授权→staff 视角→操作→过期→denied | 双账号+短时效 |
| 21 | PRM-2 车辆联络越权矩阵 | board 本车可以、分车/审核不可 | 双账号 |
| 22 | NOT-2/VEH-4 删车后通知蒸发 | 通知列表不再出现、无报错残留 | 查库+UI |
| 23 | NAV-6 名单页陈旧数据 | 停留期间外部变更 → 批量操作撞 WRONG_PHASE | 双账号 |
| 24 | DBL-2 双击发布假失败 | 第二击不产生 WRONG_PHASE 红色假错误 | — |
| 25 | CAS-2 CONFLICT 双提示 | toast 与错误区文案不同屏矛盾 | — |
| 26 | EMP-1 新用户冷启动 | 空档案→报名被拦→编辑器 profileGate→补全回流 | 新 openid |
| 27 | EMP-4 天气空数据门槛链 | denied/loading/dayCards 四态渲染 | 合成数据 |
| 28 | ACT-2 名额清空回退 24 | 空输入保存后 remaining 变化可被用户感知 | 查库 |
| 29 | ACT-4 候补滞留进集合 | 进入 gathering 后候补者 UI 状态与出口 | — |
| 30 | IDE-2 REQUEST_REUSED 陷阱 | lab 通道同 requestId 重发含 Evidence 命令（R-2b 结构确认） | lab/注入 |

---

## 四、与现有测试体系的关系（为什么「全绿」不等于没问题）

1. **单账号串行假设**：现有 24 个逻辑套件 + 场景套件全部单 actor 串行执行，天然测不到 R-1（读类写冲突）、R-2a（弱网重试）、CCU 全组——它们的共同前提是「第二个并发源」。
2. **断言 data 而非像素/时序**：`run()` 漏回写 revision（R-3）这类「时序窗口」问题，在同步 mock 的测试 harness 里窗口宽度为零。
3. **域层自洽 ≠ 端到端闭环**：schema/permissions/invariants 三层拦住了所有数据损坏路径（这也是没有 P0 的原因），但**把大量跨模块失败推给了「用户在正确时机看到正确文案并知道下一步」**——文案质量与恢复路径只有真机能评。
4. **本报告的所有「预期失败」项**（ATT-1、ASG-1、INC-1、ACT-1、SGU-2、DBL-2 等）都是从代码路径推导的**可证伪预测**：Top 30 里每一项都给出了明确的失败判据，跑通即推翻，跑挂即坐实——这正是独立 QA 该交付的东西。
