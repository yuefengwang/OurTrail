# E2E Coverage Matrix（业务覆盖矩阵）

> **Round 2 实测校准（2026-10-04，脚本重算）**：领域命令全集 = **39** 种（`commands.js` summaries 实数，
> 不是 37）。A 层 `e2e-test.js` 覆盖 **15** 种；B 层 `e2e-ui-test.js` 覆盖 **13** 种；两层并集 **16** 种；
> **23 种两层皆零 E2E**（这 23 种都有单测/smoke 兜底，但「有单测」不等于「端到端验过」）：
>
> ```
> activity.copy  activity.delete  activity.edit  assignment.remove  assignment.swap
> attendance.returnPlan  companion.remove  export.record  group.setTogether  incident.report
> incident.resolve  membership.revoke  membership.save  notice.delivery  notice.publish
> notice.read  position.report  position.revoke  signup.edit  signup.promote
> vehicle.complete  vehicle.depart  vehicle.remove
> ```
>
> 其中 `membership.*` / `notice.*` / `position.*` / `incident.*` 四条业务线（授权、通知、定位、异常）
> 端到端为零，且它们恰好是安全与协作语义的承载面——这是当前覆盖地图最大的空白，留给 Golden Path 之后批次。
> 复算方法见本文「统计方法」代码块（把 37 改成 39 即为当前口径）。

> 本轮审计实测。统计方法（可复算，不靠印象）：
> ```bash
> # 每层的命令类型覆盖面
> grep -o "type: '[a-z.]*'" tools/e2e-test.js    | sort -u   # A 层 15 种
> grep -o "type: '[a-z.]*'" tools/e2e-ui-test.js | sort -u   # B 层 13 种
> # 某个命令在哪些层出现（A/B/其余）
> grep -l "'incident.report'" tools/e2e-test.js tools/e2e-ui-test.js
> grep -rl "'incident.report'" cloudfunctions/trailApi/smoke-test.js tools/scenario-*.js
> ```
> 领域命令全集来自 `cloudfunctions/trailApi/domain/commands.js:15-30`（`summaries` 映射，**39 种**）。

## 一、图例

- **A** = `tools/e2e-test.js` 服务链路 E2E（真实 `exports.main` + 内存桩持久层）
- **B-UI** = `tools/e2e-ui-test.js` 中**该动作确实经真实界面元素完成**（tap / 元素 / 组件 data）
- **B-BIZ** = B 层里用 `cloudCall` 直发云函数完成的（只证明业务，**不**证明用户能做成）
- **单测** = `smoke-test.js` / `scenario-*.js`（域层或页面对象级，绕过 `index.js` 或桩掉 `api.js`）
- `—` = 该层无覆盖

## 二、主矩阵

| 业务域 | Domain 模块 | 后端 API（action / 命令） | A 服务 E2E | B-UI（用户真做成） | B-BIZ（只证后端） | 错误路径 | 权限路径 | 当前可信度 |
|---|---|---|---|---|---|---|---|---|
| Profile | `profile.js` | `profile.save` · `read{profile}` · `getPhoneNumber` | A-001/002/007 | 我的页装配（B-u） | 演员建档走 lab seed | 无 openid→`AUTH_REQUIRED`（A-058） | 读他人需用途（A-048/049/050） | **MEDIUM**：写读回环有，`getPhoneNumber` 零 E2E |
| Companion | `profile.js` | `companion.save` · `companion.remove` | A-008 | — | — | 无 | `proxyAuthority` 代报授权（A-048 侧） | **LOW**：`companion.remove` 无任何 E2E |
| Activity | `activity.js` | `activity.create/edit/copy/publish/transition/delete` | A-003/004/015/036/040/042/044/053/054 | 页头指标对账·归零（B-u） | 阶段推进全部走命令（B-BIZ） | 越级推进 `CONFLICT`（A-019/020）、`UNRESOLVED_DEPARTURE`（A-036）、`UNRESOLVED_SAFETY`（A-044）、归档后 `finished`（A-054） | organizer/participant 视角闸（A-006） | **MEDIUM**：6 个阶段里 5 个转移在 A 层硬验；`activity.edit/copy/delete` 零 E2E |
| Signup | `signup.js` | `signup.submit/review/promote/cancel/edit` · `group.setTogether` | A-009~013 | 报名页准入闸 + 档案回填 + 授权 checkbox 真 tap（B-u） | 审核确认走命令（B-BIZ） | 读他人拒绝（A-048/049） | `permittedActions` 闸门（A-006） | **MEDIUM**：整组报名+审核+幂等在 A 层硬验；`promote/edit/setTogether` 零 E2E |
| Vehicle | `transport.js` | `vehicle.save/remove/depart/complete` | A-014/023/024 | 车辆卡渲染（soft） | `vehicle.save` 走命令（B-BIZ） | 参与者司机占座→`DRIVER_CONFLICT`（A-024） | 组织者专属（A-059 侧） | **MEDIUM**：`vehicle.depart/complete`（发车/完成本程）零 E2E——这是真实在跑的车长流程 |
| Assignment | `transport.js` + `allocation.js` | `assignment.commit/set/remove/swap` · `previewAssignments` | A-016~022/025~029 | UI 预览 CTA→方案弹层→提交→组件反馈（B-u，本轮补齐） | 云侧降级 commit（B-BIZ，记 UI 未验证） | 过期 rev `CONFLICT`（A-019）、`SEAT_TAKEN`/`PICKUP_MISMATCH`（仅域层单测） | 非组织者预览被拒（A-059） | **MEDIUM**：`assignment.remove/swap` 零 E2E |
| Attendance | `field.js` | `attendance.checkin/board/departure/returnPlan/node/home` | A-030~043/051~053 | 现场弹层签到→出发→到家（各 1 人经 UI tap，B-u） | 其余人批量命令兜底（B-BIZ，本轮显式记 `uiUnverified`） | 司机免上车被拒（A-033）、未核实不能 active（A-036）、未闭环不能归档（A-044） | `staffCan(checkin/home/node)` 未在 E2E 出现 | **MEDIUM**：`returnPlan` 零 E2E；批量路径只证后端 |
| Position | `field.js` | `position.report` · `position.revoke` | — | — | — | 30 分钟过期、撤回后不可改（仅域层） | `Consent.proxyHome` / `consentExpiresAt`（仅域层） | **LOW**：整条位置线 E2E 为零 |
| Incident | `field.js` | `incident.report` · `incident.resolve` | — | — | — | 有未处理事件不能归档（域层） | `staffCan(incident)` | **LOW**：安全相关链路 E2E 为零 |
| Notice | `notices.js` | `notice.publish/read/delivery` · `readNoticeManagement` | — | — | — | `notice.read` 不产生事件（域层） | owner-only 管理读（未 E2E） | **LOW**：定向通知 P0-3 刚改过，无 E2E 兜底 |
| Export | `selectors.js` | `readExport` · `export.record` | A-045/055 | — | — | 归档后导出被拒（A-055） | 用途门槛 + 先写审计（A-045/055） | **MEDIUM**：`export.record` 审计写入未 E2E |
| Permissions（协作） | `permissions.js` | `membership.save/revoke` · `readAccess` · `readSensitive` · `readContact` | — | — | — | 过期即失效（域层，严格小于） | 车长视角永不得 roster/field/sensitive（域层） | **LOW**：整条协作授权线 E2E 为零（`readAccess/readSensitive/readContact` 三个 action 全未触达） |
| Revision / CAS | `store.js` | `dispatch(expectedRevision)` | A-019/020 | — | `robustDispatch` 会吞 `CONFLICT` 重试（B） | 过期 revision→`CONFLICT` 且零副作用（A-020） | — | **MEDIUM**：单客户端串行；并发双写 CAS 无 E2E |
| Idempotency | `commands.js` | `dispatch(requestId)` | A-013 | — | lab seed 依赖确定性 requestId | 同 id 重放 `replayed`（A-013）；`REQUEST_REUSED` 仅 B 层日志处理 | — | **MEDIUM** |

## 三、命令类型覆盖总账（实测计数）

37 个命令类型中：

| 状态 | 数量 | 明细 |
|---|---|---|
| A 层覆盖 | **15** | `profile.save` `companion.save` `activity.create` `activity.publish` `activity.transition` `signup.submit` `signup.review` `vehicle.save` `assignment.commit` `assignment.set` `attendance.checkin` `attendance.board` `attendance.departure` `attendance.node` `attendance.home` |
| B 层以 UI 完成 | **4** | `activity.create`（沙盒经云侧建，UI 侧只渲染）· 分车预览/提交（`previewAssignments`+`assignment.commit`，本轮补齐 UI 证据）· `attendance.checkin`/`departure`/`home`（各 1 人经弹层 tap）· `consent` 勾选（本地，不提交） |
| 两层 E2E 都没有 | **22** | `activity.edit` `activity.copy` `activity.delete` `signup.promote` `signup.edit` `group.setTogether` `vehicle.remove` `vehicle.depart` `vehicle.complete` `assignment.remove` `assignment.swap` `attendance.returnPlan` `position.report` `position.revoke` `incident.report` `incident.resolve` `membership.save` `membership.revoke` `notice.publish` `notice.read` `notice.delivery` `export.record` `companion.remove` |
| 有单测/场景测试兜底 | 22 中 22 | 全部至少在 `smoke-test.js` 或某个 `scenario-*-test.js` 里出现（实测 `other ≥ 2`） |

> **读数方法说明**：「B 层以 UI 完成」只有 4~5 项，与「B 层跑了 30 多项 ✓」的印象差距很大。
> 这个差距正是本轮要消灭的东西——细节见 `e2e-credibility-report.md` §2。

## 四、读面（action）覆盖

| action | A | B | 备注 |
|---|---|---|---|
| `read` | A-002/005/006 等（只用到 `kind:'profile'` 与 `kind:'activity'`） | 是（5 页装配间接覆盖 home/discover/notices） | `selectors.js:246` 的 5 个 kind 中，A 层只走 2 个；`discover`/`notices` 的**响应契约**在 B 层也没被断言 |
| `readForm` | 是（A-046~050、056） | 否 | 用途门槛四条路径都在 A 层 |
| `readTransport` | 是（A-022/027/029） | 是（面板对账） | — |
| `readExport` | 是（A-045/055） | 否 | — |
| `readAccess` / `readSensitive` / `readNoticeManagement` / `readContact` | **否** | **否** | 四个 Result 形读面完全无 E2E |
| `previewAssignments` | 是（A-016~018、059） | 是（降级路径） | — |
| `dispatch` | 是 | 是 | — |
| `getWeather` | **否** | **否** | 天气链路只有 `weather-page-test`（契约级），且要真网络 |
| `getPhoneNumber` | **否** | **否** | 依赖真实 `code`，无 E2E |

## 五、核心业务状态机（全部从代码读出，非推断）

枚举原文位置：`domain/schema.js:155`（Phase）· `:178`（SignupStatus）· `:206`（Capability）·
`:218-227`（Departure / CheckIn / ReturnPlan）· `:232-236`（Attendance）· `:242`（IncidentKind）。

### 1) Activity.phase

```
draft ──activity.publish──▶ published ──transition──▶ gathering ──transition──▶ active ──transition──▶ closing ──transition──▶ archived
                                │                        │
                                └────── transition ──────┴──▶ cancelled   （仅 draft/published/gathering 可取消）
```

| 边 | 前置（代码原文条件） | 违反时的错误码 | A 层 | B 层 UI 可触发？ |
|---|---|---|---|---|
| `draft→published` | `activity.publish`（发布即报名本人）；发布需完整标题/时间/集合/路线点/风险 | `INVALID_INPUT` | A-004 | 是（editor/publish 面板，**无 E2E**） |
| `published→gathering` | 名单中**无 pending**（`activity.js:157-158`） | `UNRESOLVED_DEPARTURE` | A-015 | 是（工作台阶段弹层，命令驱动 B-BIZ） |
| `gathering→active` | 每个 confirmed 都要有 `departure`；`departure.kind=joined` 还要 `checkIn`，拼车乘客（`trip.mode=shared` 且非参与者司机）还要 `boardingByLeg.outbound`（`activity.js:159-167`） | `UNRESOLVED_DEPARTURE` | A-036（负）/A-040（正） | 同上 |
| ↑ 副作用 | `departure.kind=coordinating` 者，进入 active 时**自动开一条未解决的 `late` Incident**（`activity.js:168-178`） | — | **未覆盖** | 否 |
| `active→closing` | 必须写 reason（`activity.js:179-180`） | `INVALID_INPUT` | A-042 | 同上 |
| `closing→archived` | 人人 `departure` 且非 coordinating；`joined` 者须 `home`；**且无未解决 Incident**（`activity.js:181-186`） | `UNRESOLVED_SAFETY` | A-044（负）/A-053（正） | 同上 |
| 任意→`cancelled` | 只在 `draft/published/gathering`；已有出发/上车/到家事实或任一 vehicle leg 已发车/完成 → 禁；有参与者司机 → 禁（须先换司机）；连带清 assignments、撤位置、roster→`cancelled`（`activity.js:136-155`） | `WRONG_PHASE` / `UNRESOLVED_SAFETY` / `DRIVER_CONFLICT` | **零覆盖** | 是（工作台） |
| 其它跳级/回退 | — | `WRONG_PHASE`「不允许跳过或回退」 | A-019 近似 | — |
| 每次 transition | `acceptingSignups = false`（`:191`） | — | A-006 侧证 | — |

现场类命令的阶段闸（`field.js:20`）：`draft/published/archived/cancelled` → `WRONG_PHASE`「当前活动阶段不能记录现场履约」；
即现场动作只在 **gathering / active / closing** 三阶段可用。B 层实测与此一致（closing 阶段弹层动作集不同）。

### 2) Signup.status

`pending · confirmed · waitlisted · rejected · cancelled · removed`（`schema.js:178`）

| 触发 | 迁移 | 条件 | A 层 | E2E 缺口 |
|---|---|---|---|---|
| `signup.submit` (mode=apply) | →`pending`（`approvalMode=manual`）/ `confirmed`（automatic） | 闸在 `permittedActions` + 阶段 + `deadlineAt` | A-009/A-012 | automatic 路径无 E2E |
| ↑ 占位 | `occupied()` 只数 `pending + confirmed`（`signup.js:8`） | 满员→整组显式 waitlist | A-010 侧证 | `CAPACITY` 无 E2E |
| `signup.review` | `pending→confirmed / rejected` | 组织者 | A-011/A-012 | — |
| `signup.promote` | `waitlisted→confirmed` | 组织者 | **零** | 仅域层单测 |
| `signup.cancel` | →`cancelled` / `removed` | 本人或组织者 | **零**（B 层 fixture 里调用但不断言） | — |
| `group.setTogether` | 改 `keepTogether` | 组成员 | **零** | `GROUP_SCOPE` 无 E2E |

### 3) Vehicle / Assignment

- `Vehicle = { label, plate, legalCapacity(1..60), drivers[≥1], blockedSeats, seatLabels|null, pickupPointIds[], legs{outbound,return} }`（`schema.js:192-198`）
- `Driver.kind = participant(signupId) | service(name,phone,userId)`（`:185-188`）
- `Assignment = { activityId, signupId, vehicleId, seatLabel|null }`，**按 signupId 一文档**（`store.js`）
- 乘客容量 `passengerCapacity = legalCapacity − drivers.length − blockedSeats`（`allocation.js:8-10`）
- 分配器：**绝不重排已有座位**；只给未安排者发座；整组（`keepTogether`）为单元；
  上车点必须被该车覆盖；`UnassignedReason ∈ no_vehicle | pickup_mismatch | group_too_large | no_seat`（`allocation.js:69-101`）
- 不变量（`invariants.js:90-112`）→ 错误码：一人不得两车（invalid）、非 confirmed 不得分车（`WRONG_PHASE`）、
  参与者司机占座（`DRIVER_CONFLICT`）、自行到达者占座（invalid）、上车点不匹配（`PICKUP_MISMATCH`）、
  座号不属于该车（invalid）、同车同号（`SEAT_TAKEN`）、keepTogether 组跨车（`GROUP_SCOPE`）
- E2E 实况：A 层覆盖 `DRIVER_CONFLICT / PICKUP_MISMATCH(未) / SEAT_TAKEN(未) / GROUP_SCOPE(未)` 中的 **1 个**；
  `assignment.remove / swap`、`vehicle.remove / depart / complete` **两层皆零**。

### 4) Attendance（一人一条，按 signupId）

```
checkIn{manual|simulation}   boardingByLeg{outbound,return}   departure{joined|not_departed|coordinating}
returnPlan{assigned|independent}   nodes[]{pointId,evidence}   home{evidence}
```

| 命令 | 前置（代码） | A 层 | B 层 UI |
|---|---|---|---|
| `attendance.checkin` | 阶段 ∈ gathering/active/closing；`evidence.at/by` 由服务端 `overrideEvidence` 覆写 | A-030 | 弹层「确认现场签到」（1 人） |
| `attendance.board` | 需已有座位安排（拼车乘客） | A-031/038；司机被拒 A-033 | **无 UI 入口**（在车长任务页） |
| `attendance.departure` | 三种 outcome；`coordinating` 需 note | A-032/035/039 | 弹层「核实已随队出发」（1 人） |
| `attendance.node` | 需 `pointId` 属于路线 | A-041 | 命令，无 UI |
| `attendance.home` | closing 阶段；需 note | A-043/051/052 | 弹层「核实安全到家」（1 人） |
| `attendance.returnPlan` | — | **零** | **零** |

### 5) 弹层动作集（真机实测，非文档）

`probe-overlay` 在 gathering 阶段的活动上打开现场弹层，面板作用域可见按钮：

```
["现场记录", "确认现场签到", "核实已随队出发", "核实未出发", "标记迟到协调", "记录下撤报备", "记录其他异常"]
```

对应 `field-panel.js:122-143` 的按阶段动作表。⇒ **「核实未出发 / 标记迟到协调 / 记录下撤报备 / 记录其他异常」
这 4 个 UI 动作真实存在、可点，但两层 E2E 一条都没测**；其中 `not_departed` 与 `coordinating`
正是归档安全门（`UNRESOLVED_SAFETY`）的输入，属于 P0 语义。
