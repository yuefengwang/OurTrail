# OurTrail 全业务生命周期深度审计（2026-10-08）

**范围**：`cloudfunctions/trailApi/domain/*` 全量 + `index.js`/`store.js` 的读写边界 + `miniprogram/` 消费投影的部分。
**基线**：`2e504f2`（出行方式 self/shared 解耦）。工作分支 `win/trip-mode-decoupling`。
**方法与既有门禁的分工**：`smoke-test`/`scenario-*`/`e2e-*` 证明的是「已经想到的场景」；
本次新增的 6 套 `tools/lifecycle-*-test.js` 证明的是「任意命令序列下业务事实是否始终一致」，
并附带一条独立重写的不变量判据（`tools/lifecycle-harness.js` 的 `checkOracles`）来防「把不变量改松就算通过」。

> 中继（Mac）此刻不可达，`git pull` 超时失败，故本轮**未推送**，全部改动留在本地分支。
> 云端 `trailApi` 经下载逐文件比对确认 **与 HEAD 逐字节一致**（只有 CRLF 差异），见 §10。

---

## 1. 当前完整状态模型（以代码事实为准）

### 1.1 Activity 阶段机

```
draft ──activity.publish──▶ published ──▶ gathering ──▶ active ──▶ closing ──▶ archived
  │                            │             │
  │                            └── cancelled ◀┘   （仅「出发前」）
  └──activity.delete（仅草稿）    └──activity.transition→cancelled 也从 draft 合法（就地作废）
```

| 转移 | 硬前提（除阶段外） | 代码位置 |
|---|---|---|
| draft→published | 完整标题/时间/集合点/路线节点/风险；截止 ≤ 开始 < 结束；可同时「发布即报名」 | `activity.js:116` |
| published→gathering | 不存在 pending 报名（候补不阻塞） | `activity.js:161` |
| gathering→active | 每个 confirmed 都有出发定论；`joined` 者必须已签到，拼车乘客还必须有去程上车 | `activity.js:163-171` |
| gathering→active（副作用） | `coordinating` 的人自动留下一条未闭环 `late` 异常 | `activity.js:172-182` |
| active→closing | 必须写明原因 | `activity.js:183` |
| closing→archived | 所有 confirmed 的出发定论非空且非 coordinating；joined 者必须到家；无未闭环异常 | `activity.js:185-190` + `invariants.js:61-67` |
| →cancelled | 仅 draft/published/gathering；任何上车/出发/到家事实或车辆行车事实存在时禁止；参与者司机需先更换 | `activity.js:143-158` |

`archived`/`cancelled` 是终态：`activity.transition` 无合法出边（穷举 7×7 见 `lifecycle-transitions-test.js` §1）。

### 1.2 Signup 状态机

`pending|confirmed|waitlisted|rejected|cancelled|removed`（`schema.js:178`）。
提交时 `approvalMode` 决定落在 pending 还是 confirmed；满员必须显式走 waitlist（整组要么全进要么全不进）。
`cancelled` = 本人/提交者主动；`removed` = 领队单方移除——两者由 `isOwnSignup` 分流（`signup.js:151`）。
`activity.transition→cancelled` 把所有 live 报名写成 `cancelled`。

### 1.3 现场履约（Attendance）子状态

```
checkIn        : ∅ → manual | simulation（可覆盖刷新，见 §11 R2）
departure      : ∅ → joined | not_departed | coordinating
                 joined  ─ 不可回退（唯一不可逆的出发口）
                 coordinating / not_departed ─ 在 gathering/active/closing 都可再定论（本轮修复）
boardingByLeg  : outbound/return，∅ ⇄ 事实；车辆该程已发车后不可抹去（迟到补上车除外）
returnPlan     : assigned ⇄ independent（命令侧，仅 shared）；own 只由 trip.mode 派生
nodes          : 追加去重，不可引用已被删掉的路线节点
home           : ∅ → 事实（不可逆），且要求 departure=joined
position       : 一人一条；revoke 不可逆，且不受阶段门限制
```

Vehicle 侧 `legs[outbound|return].departed/completed` 一旦写入永不改写（`field.js:41,56`），
这是全系统唯一绝对不可逆的行车事实层，也是 §4 里 F1 那条矛盾的锚点。

---

## 2. 角色 × 能力矩阵（授权的真实出处）

`permissions.canExecute` 是唯一闸门，客户端不import domain（架构定案）。

| 命令族 | 领队(owner) | 本人/提交者 | 参与者(代报) | staff(能力+范围+未过期) | vehicle_contact(仅本车) |
|---|---|---|---|---|---|
| activity.*（edit/publish/transition/copy/delete） | ✅ | ✗ | ✗ | ✗ | ✗ |
| signup.submit | ✅(限本人) | ✅ | ✅(需同行人在档) | ✗ | ✗ |
| signup.review / promote | ✅ | ✗ | ✗ | ✗ | ✗ |
| signup.cancel | ✅(→removed) | ✅(→cancelled) | ✅(组内他人) | ✗ | ✗ |
| signup.edit | ✅ + 需 purpose | ✅ | ✅ 需 proxyAuthority | ✗ | ✗ |
| assignment.* / vehicle.save/remove | ✅ | ✗ | ✗ | ✗ | ✗ |
| attendance.checkin | ✅ | ✅ | ✅ | checkin | ✗ |
| attendance.board | ✅ | ✗ | ✗ | ✗ | 仅本车被分配者 |
| attendance.departure / returnPlan | ✅ | ✗ | ✗ | checkin / incident | ✗ |
| attendance.node | ✅ | ✅ | ✅ | node | ✗ |
| attendance.home | ✅ | ✅ | 需 proxyHome | home | ✗ |
| vehicle.depart / complete | ✅ | ✗ | ✗ | ✗ | ✅ 本车 |
| position.report | ✗（必须本人） | ✅ | ✗ | ✗ | ✗ |
| incident.report | ✅ | ✅ | ✅ | incident（逐人范围） | ✗ |
| notice.publish/delivery | ✅ | ✗ | ✗ | ✗ | 仅记录本车通知投递 |
| export.record（sensitive） | ✅ + 需 purpose + 工作期 | ✅ | ✅ | sensitive | ✗ |

关键实现细节：`staffCan` 要求**同一条** membership 同时具备 capability 且覆盖该 signup，
过期边界是严格小于（`expiresAt === now` 即已过期）；`vehicleCan` 永不授予 roster/field/sensitive。

---

## 3. 核心 invariant（域内 + 本轮独立重写的 oracle）

`invariants.js`（落库前整库校验）与 `tools/lifecycle-harness.js:checkOracles`（本轮按业务规格另写一遍）
构成两套互不依赖的判据。§4 的变异自证证明两者都会对 20 类人为违规报红——**任一边被改松，另一边仍会红**。

| 族 | 内容 |
|---|---|
| 主键与引用 | 各集合 id 唯一；attendance ↔ signup 双射；assignments/attendance/positions 以 signupId 为主键（不是 activityId！见 F3）；报名/分配/授权/通知/事件/异常都不得跨活动引用 |
| 座位 | 一人一车；同车同座号唯一；座号表长度=核载−司机−不可用位且唯一；乘客数 ≤ 可用位；self 不得占座；非 confirmed 不得占座；参与者司机不得占乘客位；同场只开一辆车 |
| 出行方式 | `trip.mode=self` ⇒ 无上车点要求、无座位、无上车事实、返程为派生 `own`；`shared` 且 live ⇒ 上车点必须在本场集合点内 |
| 履约次序 | joined ⇒ 已签到且仍 confirmed；home ⇒ joined；返程上车 ⇒ joined 且按原车返程；另行返程必须有依据 |
| 活动级 | pending+confirmed ≤ capacity；live 报名内同一人不得重复；cancelled 不留招募/活报名/座位；archived 要求出发定论与到家且无未闭环异常 |
| 位置 | 一人一条；有效上报只允许落在 confirmed 且活动未取消的人身上 |
| 同行组 | keepTogether 的 confirmed 成员必须同车 |

---

## 4. 发现的问题（含定位方式）

全部先复现、再定根因、再改；下表每条都能在对应测试里找到断言。

| # | 严重度 | 问题 | 类别 | 证据入口 |
|---|---|---|---|---|
| F1 | 高 | 本车的参与者司机被核实为「未出发」，车辆照样能 `depart`/`complete` ⇒ 同时留下「车开走了」和「它的司机没来」两条互相打脸的事实，且归档门完全不报 | B 脏状态 / E 事实矛盾 | `lifecycle-allocation-test.js` §3c |
| F2 | 中 | 已取消/已移除/未通过的报名永久钉住其上车点：领队删不掉一个没人再用的集合点（`activity.edit` 与整库 invariant 都按「任意报名」而非「活报名」判定） | C 僵化形态 | `lifecycle-cancellation-test.js` §4 |
| F3 | 中（潜伏） | `activity.delete` 的级联按 `p.activityId` 过滤 positions，而 `PositionReport` 根本没有该字段 ⇒ 一条都删不掉；一旦出现孤儿位置记录，`位置记录的参与者不存在` 会让此后**全库每一次写入**一起被拒 | A 半成功（级联漏项） | `lifecycle-transitions-test.js` §6b |
| F4 | 中 | `permittedActions` 在「这一程尚未发车」时也广播 `vehicle.complete`（域内必拒 WRONG_PHASE），发车后又继续广播 `vehicle.depart`；且返程阶段与去程阶段共用一个 leg 值 | 「UI 给了按钮，domain 必拒」 | `lifecycle-projection-test.js` §3c |
| F4b | 中 | 集合阶段仍广播 `signup.review`/`signup.promote`，而域内这两个命令只认 published。候补队列可以带进 gathering，于是「递补候补」是一个**注定红字**的按钮 | 同上 | `lifecycle-projection-test.js` §3b |
| F5 | 高 | `not_departed` 是死路：活动进入 active 后，被误判或改变主意的到场者既不能补签到也不能改口径（`lateArrival` 只认 `coordinating`），他在整段行程里再也无法被记为随队出行，安全档案里永远没有他 | D 可达但不可完成 | `lifecycle-transitions-test.js` §5 |
| F6 | 高 | `coordinating` 随活动进入 closing 后彻底无法定论（`attendance.departure` 阶段门只放 gathering/active），而归档条件恰恰要求定论 ⇒ **活动永久无法归档** | D 可达但不可完成 | `lifecycle-transitions-test.js` §4b/§4c |
| F7 | 中 | 删除车辆 / 更换司机会连带抹掉参与者司机已产生的履约事实（`vehicle.remove` 只守乘客不守司机）。删除后此人立刻变成「需要乘车且欠去程上车」，而在 active 阶段这个义务再无任何合法路径可补 | E 历史事实被覆盖 | `lifecycle-allocation-test.js` §3b |
| F8 | 中 | `pages/vehicle/vehicle.wxml` 用中文文案决定徽标配色（`item.status === '已上车' \|\| '另行返程'`），违反本仓库明令的「严禁用文案给业务状态投票」；去程里已核实「未出发」的人被显示成带警示色的「未上车」，把「本程不载他」误报成「他欠一次上车」 | 领域/显示混叠 | `lifecycle-projection-test.js` §7（静态门） |
| F9 | 中 | **测试自身的假绿**：`tools/e2e-ui-test.js` 用「面板里有没有 `.list-row`」来证明「分车方案渲染出来了」，而 `.list-row` 同时存在于面板正文的车辆卡与同行组列表 ⇒ 弹层根本没打开也会记成 UI PASS（实测：`planOpen=false` 时该断言仍然 ✓） | 判据无效 | 本轮改造后的读数 |

---

## 5. 修复内容

| # | 改法 | 文件 |
|---|---|---|
| F1 | `vehicle.depart`/`vehicle.complete` 前检查本车参与者司机的出发定论；反向也堵：`attendance.departure` 不得把「已兼任有车且该车已有行车事实」的人写成 `not_departed` | `domain/field.js` |
| F2 | 上车点引用约束收窄到 live 报名（`isCurrentSignup`），编辑门与整库 invariant 同步收窄，两处共用同一判据 | `domain/invariants.js`、`domain/activity.js`、`tools/lifecycle-harness.js`（oracle 同口径） |
| F3 | positions 级联改为按被删报名的 `signupId` 过滤，与 attendance 同一口径 | `domain/activity.js` |
| F4 | 投影按 field.js 的「阶段↔程」表 + 该程 `departed/completed` 实际状态决定广播；`depart` 只在未发车时给，`complete` 只在已发车且未完成时给 | `domain/selectors.js` |
| F4b | `signup.review` 仅在 published 且 `counters.pending>0` 时广播；`signup.promote` 仅在 published 且 `counters.waitlisted>0` 时广播 | `domain/selectors.js` |
| F5/F6 | 把两条门从内联表达式提成具名判据并放宽到业务上正确的范围：`lateArrivalDoor = active ∧ 未定论(coordinating\|not_departed)`（签到/上车补录门）、`departureDoor = gathering ∨ (active\|closing) ∧ 未定论`（出发定论门）。**没有放松任何终态条件**：archived 仍要求非 coordinating、joined 仍要求签到与必要上车 | `domain/field.js`、`domain/selectors.js`（投影改读同一对判据，不再自行判一次） |
| F7 | `vehicle.save` 摘除司机、`vehicle.remove` 删车时，对本车「已有履约事实的参与者司机」用既有 `travelLocked` 判据拦下，错误码沿用同族的 `DRIVER_CONFLICT`；无事实时不受影响（对照组断言在测试里） | `domain/transport.js` |
| F8 | 徽标文案与 tone 全部在 JS 里由结构化事实算出，WXML 只消费 `item.tone`；去程「本程不载他」改为陈述去向（`F.DEPARTURE_LABELS`）而不是点名未上车 | `miniprogram/pages/vehicle/vehicle.js`、`vehicle.wxml` |
| F9 | UI 测试的分车证据改成：点击前读数（busy/vehicles/planOpen）+ `planOpen===true` + `planChanged.length>0`，`.list-row` 降级为辅助信息；失败时把「弹层状态 + 面板实际按钮」全带进证据 | `tools/e2e-ui-test.js` |

**没有做的一件事**：F1 那条矛盾我没有写成整库 invariant。理由——本项目无迁移/回填脚本，
而线上可能存在「车已发车 + 司机记为未出发」的历史数据；整库校验会让该库此后**每一次写入**被拒
（就是 F3 的危害形态）。因此改为在两个写入端各拦一次，并把这条规则放进**测试侧独立 oracle**
（新数据一旦被造出来就会红），既封死路径又不制造锁库。这是本轮唯一一处「有意不放进 invariants.js」的判断。

---

## 6. 新增测试（6 套，全部可无头进门禁）

| 套件 | 断言 | 覆盖 |
|---|---|---|
| `tools/lifecycle-harness.js` | — | 确定性时钟/id 的世界驱动器；每步自动跑 `assertInvariants` + `checkOracles` + 「被拒必须逐字节零副作用」+ revision/receipt 计数 |
| `lifecycle-transitions-test.js` | 214 | 7×7 阶段穷举与阶梯表、mixed（self+拼车乘客+参与者司机）全链贯通、归档封口（39 命令逐一试 + 白名单 4 条）、取消态封口、级联键、报名窗口时间×阶段耦合、两条死路探测 |
| `lifecycle-cancellation-test.js` | 71 | §6 要求的八个取消时点全覆盖 + 名额/候补递补联动 + 整组取消 + 司机/发车交叉 + 集合点收敛（F2）+ 取消∥分车交错 + 幂等重放 |
| `lifecycle-allocation-test.js` | 109 | 容量/占座/司机冲突/self 分配/上车点错配/删车/换司机/预留位压缩/取消释放座位；预览「不重排已有座位、不把 self 排进车、过期预览作废、篡改预览被拒」；F1/F7 的正反对照 |
| `lifecycle-projection-test.js` | 132 | 逐行标志 ↔ 域内结论一致性（欠上车的补得上、不欠的记不了）；阶段门与投影同向；`permittedActions` 可用性差分探测（每个广播出来的动作都必须存在真能成功的实例）；F4/F4b；视角最小暴露（participant/staff/vehicle 三层含泄漏扫描）；导出 CSV「不适用」口径；`detailState` 12 态；客户端中文文案判状态的静态门（F8） |
| `lifecycle-concurrency-test.js` | 126 | 8 类命令的同 requestId 重放；同内容换号 ≠ 重放；同号换内容 = REQUEST_REUSED；5 组「同一版本并发写」败者零副作用 + 重读后确定性结论；抢同座终局；重复签到/上车/核实/到家/发车的幂等与「证据不被覆盖」；归档后 9 类迟到操作（含带陈旧版本号）全部零副作用；取消+分车+递补交错；递补整批原子性 |
| `lifecycle-fuzz-test.js` | 47 | 60 个随机场景 ×45 步（1745 条被接受命令 / 1500+ 条被拒命令）零违背；场景先真实推进到 gathering/active/closing/archived 再随机（带阶段覆盖守卫，防止「只在 published 打转的假绿」）；13 条终态性质 + 反空断言；13 类非法 ID/残缺输入攻击的零副作用；**20 类人为违规的变异自证**（oracle 与 invariants.js 两边必须同时报红）；8 个固化种子 + 400 步长程回归 |

新增断言合计 **699**。

---

## 7. 并发测试结果

- 内存层①（`reduceCommand` 的 expectedRevision + requestId 幂等 + 状态类守卫）全部符合预期：**任何基于同一版本的第二条写命令都拿到 CONFLICT 且状态逐字节不变**；败者重读后得到确定性结论（SEAT_TAKEN / WRONG_PHASE / CAPACITY…），不存在「两条都落库」。
- 「cancel ∥ assign」交错终局自洽：要么 cancelled 且无座位，要么 confirmed 且有座位，没有中间态。
- 「archive ∥ 迟到操作」：9 类迟到写命令（含带陈旧 revision 的重复尝试）全部被拒且零副作用。
- 存储层②（真云端事务 CAS）不在本轮改动面上，沿用既有结论：`e2e-concurrency`(44, bugs=2 常驻红测)、`e2e-client-cas`(54, bugs=1)、`e2e-interleave`(67)、`e2e-panel-sync`(40) 全绿，本轮重跑通过。

## 8. cancellation 测试结果

八个时点逐一给出确定结论：确认前 / 确认后 / 分车后 / 仅签到后 —— 允许；
上车后 / 出发后 / 行程中 / 返程中 —— 由 `travelLocked` 与阶段门拒绝，并提示走现场异常与返程流程。
取消会：解除座位、撤回有效位置、释放名额（名额与 `unassigned` 计数同步）、不影响同行组的同车约束。
兼任参与者司机的人必须**先更换司机**才能被取消（既有规则，本轮新增正反对照）。
活动整体取消与单人取消的口径一致：仅出发前可作废，且不会抹掉已产生的签到事实。

## 9. projection 审计结果

- 域内 `trip.mode` 与投影 `tripMode` 在所有可达形态上一致；不存在「domain shared / UI 自行前往」。
  `pickup` 只在集合点真的被收掉时对**终态历史行**显示「上车点信息缺失」，已确认者不可能出现该措辞。
- 三个乘车义务标志（`needsSeatAssignment`/`needsOutboundBoarding`/`needsReturnBoarding`）与域内结论做了双向差分：标志说「不欠」的人，命令必被拒；说「欠」的人，阶段门必挡住推进。
- `counters` 自洽：`selfTravel + vehicleTravel = confirmed`、`assigned + unassigned = vehicleTravel`、`remaining` 是裸减法（不夹 0）。
- `detailState` 只读结构化标志；老数据 `self + returnPlan:'assigned'` 被投影归一为 `own`，且**存储记录不被投影偷偷改写**。
- 白名单投影未放宽：参与者/协作/车长三个视角的序列化结果都不含 `medical`/`emergency`/`consentExpiresAt`，车长看不到他车乘客与异常。
- 修掉两处「广播了但域内必拒」（F4 / F4b）；客户端仅剩的「用文案判状态」一处（F8）已消除，并由 `lifecycle-projection-test.js` §7 的静态门常驻看守。

## 10. E2E 结果

**A 层（服务链路，真实信封打进 `exports.main`，内存桩 DB）——全部 PASS：**
`e2e-test 71` · `e2e-permission 96` · `e2e-domain-negative 86(+3)` · `e2e-fault-probe 34` ·
`e2e-concurrency 44(bugs=2 常驻红测)` · `e2e-client-cas 54(bugs=1)` · `e2e-interleave 67` ·
`e2e-panel-sync 40` · `e2e-release-gap 51`。
其中 `e2e-domain-negative` 的 J 段原有一条断言（「active 阶段非迟到协调不可签到 → WRONG_PHASE」）
是被 F5 的**有意规则变更**推翻的：已改为「对已定论（joined）的人仍必须拒」并补了「对未定论者可补录」的正面断言。

**B 层（真微信模拟器）——FAIL，且与本轮改动无因果关系（诊断进行中，见 §11 R6）：**
已确立的事实链：
1. 线上 `trailApi` 包经 `cli cloud functions download` 逐文件比对，与 HEAD **完全一致**（含 `selectors.js`，差异仅 CRLF）；
   本轮的 domain 修复**不在**那次运行所打的云端里。
2. 失败的 11 条全部源自同一条链：分车方案弹层未打开 → 云端 0 条安排 → 拼车乘客无法记上车 →
   `gathering→active` 被硬门挡住 → 节点/到家/归档全部连带失败。
3. 弹层相关的 `transport-panel` / `field-panel` 三个文件本轮一行未改（客户端只动了 `pages/vehicle/`）。
4. 这条链在 HEAD 上**多次运行都确定性复现**（非通道抖动；同轮其它块的抖动已证实存在并另计）。
5. 加装「点击前面板读数」诊断后拿到确切原因：**点击那一刻 `transport-panel` 的 `busy === true`**。
   「预览自动分车方案」的绑定是 `bindtap="{{busy || !vehicles.length ? '' : 'onPreview'}}"`，
   于是那次 tap 打在一个「样式正常、文案正确、处理器已被摘掉」的按钮上——tap 本身返回成功，什么都不会发生。
   面板里六个写 `busy` 的地方各自都有 then/catch 双向清零，所以这不是漏写一次 setData，而是状态残留；
   同时刻其它读数是 `vehicles=1 / planOpen=false / error=""`——不是没车，也不是云端报错。
   面板全部主按钮共用这一个门，因此整个分车面板当场假死。
   这正是本仓库反复登记过的「点了没反应」类缺陷：静态门禁与纯逻辑测试都测不到，只有真机看得见。
   确切触发点需要下一轮真机迭代定位（本轮把可复现读数留在测试里，不留谜团）。

云端配置核对（部署后必做项）：`timeout = 20`、`runtime = Nodejs16.13`、`status = Active` ✓ 未被改动。
**未部署**：CLI 的 deploy 不继承控制台超时，会把 20 秒降回默认值并打断天气链，
因此本轮没有擅自部署共享云函数——这也是 B 层看不到 F1/F4/F5/F6/F7 修复效果的直接原因。

## 11. Invariant 结果与剩余风险

域内不变量：`smoke-test 173` 全绿；6 套新套件每步之后都重跑 `assertInvariants`，
随机扫描 60×45 步 + 8 个固化种子 + 400 步长程全部零违背。
判据自证：20 类人为违规在 `checkOracles` 与 `invariants.js` 两边**同时**报红，未破坏基线全绿。

| # | 剩余风险 | 状态 |
|---|---|---|
| R1 | **重试键不稳定**：`api.js dispatch` 在调用方不传 requestId 时每次生成新的，`dispatchAndSync` 也不传 ⇒ 幂等只对「同一意图同一号」生效。若命令已在服务端落库而响应丢失（超时/断网），用户再点一次就是**第二条命令**：`vehicle.save`/`notice.publish`/`incident.report`/`activity.create` 会产生重复记录（`signup.submit` 会被 DUPLICATE_PERSON 挡住，`attendance.*` 多为覆盖语义所以无害）。修法需要一个「一次用户意图一个号」的客户端约定，属于产品/交互决策，本轮只登记不动 | 未修（需决策） |
| R2 | `attendance.checkin` 可被重复提交覆盖证据时间戳（不丢事实，丢的是「首次签到时刻」） | 记录为设计现状 |
| R3 | 没有任何履约事实时，仍可删除一辆载有参与者司机的车（司机身份随车消失，此人回到「待安排车辆」）。只在有事实时拦截，符合「先解除义务再动承载它的记录」的既有口径 | 有意保留 |
| R4 | `companion.remove` 后，历史报名的 `personRef` 指向已不存在的同行人。因报名自带 `participant` 快照，记录仍可读；invariant 只校 ownerId 一致性 | 有意保留（快照语义） |
| R5 | `tools/outdoor-intelligence-ui-test.js` 1 条常驻非确定性红（打线上 Open-Meteo + 真实时钟），本轮三次运行均红，与天气线归因一致，未重复诊断 | 已归档 |
| R6 | B 层 golden path 在 HEAD 上断链：`transport-panel` 的 `busy` 残留在 true，使面板所有主按钮的 `bindtap` 变成空串（点了没反应），分车提交不发生 → 下游清点/推进/归档全红。已排除本轮改动、已排除云端（线上包=HEAD）、已排除通道抖动。下一步：定位是哪一次写命令把 `busy` 留下（六个写入点都有双向清零，怀疑与 `sync-key`/`written` 触发的重读竞态有关） | OPEN（诊断已定到 `busy`） |
| R7 | F5/F6 放宽了「事后纠正门」，因此 `not_departed` 在语义上重新变成「可撤销的临时判断」。若产品希望它是终局结论，应改成「必须走异常报备才能翻案」——那是业务口径决策，本轮按「不得存在永久死路」的保守方向处理 | 待产品确认 |

## 12. 性能与代码质量发现（实测，不是推测）

在 schema 上限（capacity 500）下用真实 reducer 计时：

| 规模 | `selectView(organizer)` | `previewAssignments` | `assertInvariants` |
|---|---|---|---|
| 100 人 / 4 车 / 20 座 | 首次 3.2 ms，稳态 ~1.4 ms/次 | 1.6 ms | 0.8 ms |
| 300 人 / 8 车 / 40 座 | 首次 6.6 ms，稳态 ~4.2 ms/次 | 3.2 ms | 2.1 ms |
| 500 人 / 12 车 / 40 座 | 首次 10.9 ms，稳态 ~8.6 ms/次 | 5.4 ms | 3.7 ms |

结论：**读投影成本相对 `loadState`（每请求 15 次集合读）可以忽略**，V1 规模下不做优化，
也不该动 CAS 设计。已识别的超线性项是 `selectors.rowView` 每行都重新
`assignments.find × vehicles.some`（`passengerAssignment`）与 `permittedActions` 每行调 `canExecute`，
增长约 n^1.5——若将来放开容量上限，第一处该改的是把「按 signupId 的座位索引」在一次视图里建一次复用。
其它已核对项：`activity.edit` 的时间顺序/引用完整性检查、`recordChange` 的通知受众差集、
`pruneReceipts/events/notices` 的 600/800/800 上限、`canonicalPayload` 指纹、`csvCell` 公式注入中和——均无发现重复实现或静默兜底。
本轮新增的具名判据（`lateArrivalDoor`/`departureDoor`）同时被写侧与读侧消费，消除了投影自行重述阶段门这件事。

---

## 附：验收对照

| 要求 | 结果 |
|---|---|
| Domain tests | PASS（smoke 173 + 本轮 6 套 699） |
| Invariant tests | PASS（含 20 类变异自证） |
| E2E（A 层服务链路） | PASS（6 套 371 断言 + 常驻红测按设计保留） |
| UI E2E（B 层真机） | **FAIL — HEAD 既有断链，非本轮引入**；已消除其假绿判据并给出证据链，未伪报 PASS（§10 / R6） |
| Concurrency tests | PASS |
| Projection audit | PASS（F4/F4b/F8 已修，静态门常驻） |
| 云端部署 | **未执行**（CLI 部署会把 20 秒超时降回默认，属共享资源破坏性变更）；域修复要生效需人工「上传并部署：云端安装依赖」并复核超时 |
