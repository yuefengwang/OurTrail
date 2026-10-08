# domain/ — 业务内核

13 modules, ~2409 lines of **pure JS with no `wx-server-sdk` import**（`wc -l` 实测，2026-10-04）. All authorization, all business rules, and every response shape the client ever sees live here. The client imports **none** of it — `SYNC.md:32` records that as a settled architecture decision (「客户端不引入 domain 代码」). Keeping the directory SDK-free is what lets `../smoke-test.js` run the whole reducer / invariants / selectors / allocation stack under plain Node.

| Module | LOC | Refs | Role |
|---|---|---|---|
| `selectors.js` | 493 | 2 | The read side — every response shape |
| `schema.js` | 375 | 4 | The entity model. Single source of truth |
| `permissions.js` | 270 | 7 | Authorization only, no business rules |
| `activity.js` | 218 | 1 | `handleActivity` |
| `transport.js` | 186 | 1 | `handleTransport`, `hasLegHistory` |
| `signup.js` | 180 | 2 | `handleSignup`, `registerParticipants`, `travelLocked` |
| `invariants.js` | 165 | 4 | `assertInvariants` — whole-state integrity |
| `commands.js` | 142 | 2 | `reduceCommand` — the only write path |
| `field.js` | 117 | 1 | `handleField` — 现场 |
| `allocation.js` | 93 | 3 | `planAssignments` — auto-分车 |
| `profile.js` | 71 | 1 | `handleProfile`, `ensureMembershipId` |
| `notices.js` | 52 | 2 | `handleNotices` |
| `contracts.js` | 40 | **12** | ERROR_CODES, `canonicalPayload`, `genId`, `deepClone` |

`contracts.js` and `permissions.js` are the highest-centrality modules in the repo — a change there ripples everywhere.

Ported from the React prototype's TypeScript at `docs/prototypes/ourtrail-app/src/domain/` (`model.ts` → `schema.js`; the other 12 map 1:1). **Read that tree for intent when a rule is unclear. This directory is authoritative and has drifted since.**

## THE ENTITY MODEL — `schema.js`

A hand-rolled zod replacement (source comment: 「极简严格校验器：替代原型的 zod schema」). `strictObject` semantics: **no extra keys, no coercion.** ~35 specs composed from `specObj` / `specArr` / `specEnum` / `specStr` / `specId` / `specText` / `specInstant`.

Spec line numbers worth knowing: `Coordinates` 113 · `Person` 116 · `Profile` 126 · `RoutePoint` 128 · `RouteSnapshot` 141 · `PickupPoint` 151 · `Activity` 157 · `Trip` 167 · `Consent` 171 · `SignupGroup` 175 · `Signup` 179 · `Driver` 185 · `Evidence` 189 · `Vehicle` 192 · `Assignment` 199 · `Membership` 207 · `Attendance` 232 · `PositionReport` 238 · `Incident` 243 · `ActivityEvent` 247 · `Notice` 263 · `Receipt` 267 · `State` 272. The `Payload` command union is at 315; exports at 365.

`State` is **one in-memory object of arrays**, not a relational graph — `store.loadState()` hydrates all of it on every request.

Enums: `Phase` (155) `draft | published | gathering | active | closing | archived` + `cancelled` · `SignupStatus` (178) `pending | confirmed | waitlisted | rejected | cancelled | removed` · `Capability` (206) `roster | checkin | node | incident | position | home | sensitive` · `IncidentKind` (242) `late | withdrawal | injury | other` · `UnassignedReason` (306) `no_vehicle | pickup_mismatch | group_too_large | no_seat`.

## THE WRITE PATH — `commands.js:101`

`reduceCommand(state, command, context)` is the **only** way state changes. Order matters:

1. schema validation
2. `canExecute` authorization
3. receipt lookup — same actor + `requestId` + fingerprint ⇒ `replayed:true`; same `requestId` with **different** content ⇒ `REQUEST_REUSED`
4. revision check ⇒ `CONFLICT`
5. `handle()` — the dispatch switch at 35–46
6. `recordChange` — automatic `ActivityEvent` + notice fanout
7. `assertInvariants(state)` on the result

39 command types (`commands.js` summaries 实测), grouped:

- `activity.` create · edit · copy · publish · transition · delete
- `signup.` submit · review · promote · cancel · edit, plus `signup.group.setTogether`
- `vehicle.` save · remove · depart · complete, plus `assignment.` commit · set · remove · swap
- `attendance.` checkin · board · departure · returnPlan · node · home, plus `position.report` / `position.revoke`, plus `incident.report` / `incident.resolve`
- `membership.` save · revoke
- `notice.` publish · read · delivery, plus `export.record` · `profile.save` · `companion.save` / `companion.remove`

Growth caps at `commands.js:89-136` **silently truncate history**: receipts ≤ 600, events ≤ 800, notices ≤ 800.

## THE READ PATH — `selectors.js:246`

`selectView` branches on `request.kind`: `profile` | `home` | `discover` | `notices` | `activity`; anything else returns `deniedView('FORBIDDEN')`. `activityView` at 373. `DETAIL_STATES` at 472 = 12 states: `new, pending, confirmed, ready, gathering, checked, active, closing, finished, waitlist, closed, cancelled`. Also exports `selectTransport`, `selectSignupForm`, `selectSensitive`, `selectContact`, `selectExport`, `selectAccess`, `selectNoticeManagement`.

**These are WHITELISTED PROJECTIONS — they BUILD a minimal per-perspective view; they never build a full object and filter afterwards.** An `activity` row is exactly 13 keys, and phone / medical / emergency are stripped. The driver view's serialized JSON is asserted to not contain `medical`, `emergency`, `consentExpiresAt`, or another vehicle's data. Widening a projection is a security change, not a convenience change.

## AUTHORIZATION — `permissions.js`

`isOwner`, `isOwnSignup`, `isSelfSignup`, `hasProxyConsent`, `staffCan`, `vehicleCan`, `canReadSensitive`, `canReadNotice`, `canExecute` (exports at 265 — a switch over all 39 commands).

- `staffCan(state, actor, activityId, capability, signupIds, now)` = `StaffScope` ∩ `Capability[]` ∩ unexpired. **The expiry boundary is strict less-than: `expiresAt === now` is already expired.**
- `vehicleCan` never grants roster / field / sensitive capability.
- `needsOutboundBoarding(state, signup)` was the **single source** for "this person must have an outbound boarding record before 随队出发 can be verified". As of 2026-10-08 it is one of **nine travel-obligation predicates that now form the only place the codebase decides whether a participant needs vehicle service**: `isVehicleTraveller` · `participantDriverSignupIds` · `isParticipantDriver` · `passengerAssignment` · `needsVehicleService` · `needsSeatAssignment` · `needsOutboundBoarding` · `returnBoardingApplies` · `needsReturnBoarding` (permissions.js:55-115). `activity.js`, `allocation.js`, `field.js` and `selectors.js` all call them — none of the four former duplicate formulations survives. **Do not re-derive the rule anywhere else, and never infer the mode from a display label**: `selectors.rowView` publishes `tripMode` / `pickupPointId` / `hasPassengerAssignment` / `needsSeatAssignment` / `needsOutboundBoarding` / `needsReturnBoarding`, and the client branches on those. `trip.mode = 'self'` means vehicle/driver/seat/boarding **do not apply** — it is not "skipped", and it must not lower any `shared` constraint. `ReturnPlan` gained a derived third branch `own` (自行往返, no evidence, written only by `signup.js` `returnPlanFor()`); old stored rows keep an inert `assigned` that the predicates refuse to turn into an obligation, which is why no backfill is needed.
- `isOwnSignup` includes the submitter, not just the person — that is what makes 代报 (proxy signup) work.
- `hasProxyConsent` gates reading another person's contact data and filing position/home for them, via `Consent.proxyAuthority` / `Consent.proxyHome`.

## ALLOCATION — `allocation.js`

`planAssignments(state, actor, activityId, now)`. Doc comment: 纯函数式分车预览，**绝不重排已有座位**.

Excludes drivers from passenger capacity via `passengerCapacity`; collapses signups into **units** (a whole `SignupGroup` when `keepTogether`, else per-signup); for each unit considers only the vehicle that group is *already* on; requires every member's `trip.pickupPointId` to be in `vehicle.pickupPointIds`; takes the first vehicle with room; otherwise emits a `UnassignedReason`. Uses a hand-rolled digit-block-aware `naturalCompare` instead of `Intl.Collator({numeric:true})`. Calls `assertInvariants` before returning. Uses a lazy `require('../invariants')` at line 45 to break a require cycle — keep it lazy.

## SEMANTICS THAT MUST NOT REGRESS

Enforced here, not in the client. All of these have a test or a pin behind them:

- A `SignupGroup` occupies capacity as a **unit**. `manual` approvalMode ⇒ pending, `automatic` ⇒ confirmed. When full, the **whole group** must explicitly waitlist.
- Phase gates: `published→gathering` requires no pending; `gathering→active` requires every actual traveller verified departed (check-in + outbound boarding); `closing→archived` requires all home with no open incidents; cancellation is only possible before departure.
- **出发定论的两道门只有一个出处**（2026-10-08 生命周期审计，`field.js` 顶部具名导出，`selectors.permittedActions` 直接消费同一对函数，不得自行重述）：
  `lateArrivalDoor = active ∧ departure ∈ {coordinating, not_departed}`（签到与去程上车的补录门）、
  `departureDoor = gathering ∨ ((active ∨ closing) ∧ 未定论)`（出发情况的可改门）。
  两条都是**为了消灭死路**而放宽的，不是放松终态：archived 仍禁止 coordinating，joined 仍要求签到 + 必要上车，
  「已随队出发」依旧不可回退。放宽前存在两条不可完成形态（not_departed 者在 active 无法补录；
  coordinating 者随活动进 closing 后全库再无任何命令能给它定论 ⇒ 永久无法归档）。
- `vehicle.depart` / `vehicle.complete` 会检查本车参与者司机的出发定论：车要动，司机就不能记为「未出发」（F1）。
  `vehicle.remove` / `vehicle.save` 换司机则用 `travelLocked` 拦住「已有履约事实的司机」——删车会连带抹掉他这条事实
  并把他变成在 active 阶段无法再补齐乘车义务的待分车者（F7）。
- **整库 invariant 有锁库风险**：`assertInvariants` 校验整个 State，任何「线上历史数据可能已长成那样」的规则写进这里，
  会让此后每一次写入一起被拒（本项目无迁移脚本）。这类规则改在写入端各拦一次 + 放进 `tools/lifecycle-harness.js`
  的 `checkOracles` 看守新数据。F1 的司机/发车矛盾就是这样处理的，没有进 invariants.js。
- 上车点引用只约束 **live 报名**（`isCurrentSignup`）：`cancelled/removed/rejected` 是历史行，
  不钉住集合点（F2）。注意 `activity.pickupPoints` 的**语义**未变——它是全场集合点，
  published 活动仍必须 ≥1 个（self 也拿它当出发点），2026-10-08 上一轮 §18 的决策仍然成立。
- `PositionReport`: one latest per person, `consentExpiresAt` = the activity's `endAt`, non-revisable after revocation, **stale after strictly 30 minutes**.
- Reading sensitive data requires a declared `purpose`（**门槛在读取侧，但服务端不落任何审计记录**）；`export.record` 是**客户端主动发的命令**，服务端不强制——「先写审计」是自律而非机制，2026-10-04 回代码确认.
- `notice.read` produces **no** event. `recordChange` fans out to everyone for publish/edit/transition, and to affected people for `signup.*` / `assignment.*`.

## ADD A COMMAND

1. Add the payload variant to the `Payload` map in `schema.js:315`.
2. Add a `case` to the `handle()` switch in `commands.js:35-46`, plus its label in the adjacent `summaries` map (that label is what `recordChange` writes into the event summary).
3. Implement the handler in the matching module, or create a new module and `require` it in `commands.js`.
4. Add a branch to `canExecute` in `permissions.js` — **a command with no permission branch is unauthorized-by-accident, not authorized.**
5. Add invariants if it creates cross-record relations.
6. Add cases to `../smoke-test.js`.

**Strict-mode trap:** a new field must be added to *every* duplicate spec or the whole dataset fails validation, and must be declared optional so already-stored data stays valid (ADR-0003).

**Adding a collection** touches three places: the `COLLECTIONS` map in `../store.js:7`, `emptyState()` in `../smoke-test.js:23`, and `stateSpec` in `schema.js`. Miss one and invariants reject every write.

## ANTI-PATTERNS

- **Do not move authorization into the client, and do not import domain code into `miniprogram/`.** The client submits `{payload, requestId, expectedRevision}` and nothing more.
- **Do not use `structuredClone`, `crypto.randomUUID`, or `String.replaceAll`** — cloud-function Node compatibility. Use `deepClone` / `genId` (SYNC.md:101).
- **Do not clamp inconsistency in `invariants.js`.** An over-capacity activity must surface `remaining === -1`, never `0`. Silently normalizing hides the bug that produced it; a prototype test pins this.
- **Do not widen a projection after the fact.** Add the field to the whitelisted view deliberately, and decide whether it is authorized for that perspective.
- **Do not reorder existing seats in `planAssignments`.** It is a preview planner for unassigned people only.
- **Be aware of the 600 / 800 / 800 truncation** on receipts, events, and notices before building anything that reads history back.
- **A missing `canExecute` branch is a hole, not a default-deny.** Check it exists.
- **Keep this directory free of `wx-server-sdk`.** One import breaks `../smoke-test.js` and with it the project's only backend test.
