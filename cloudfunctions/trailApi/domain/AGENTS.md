# domain/ — 业务内核

13 modules, ~1795 lines of **pure JS with no `wx-server-sdk` import**. All authorization, all business rules, and every response shape the client ever sees live here. The client imports **none** of it — `SYNC.md:32` records that as a settled architecture decision (「客户端不引入 domain 代码」). Keeping the directory SDK-free is what lets `../smoke-test.js` run the whole reducer / invariants / selectors / allocation stack under plain Node.

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

37 command types, grouped:

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

`isOwner`, `isOwnSignup`, `isSelfSignup`, `hasProxyConsent`, `staffCan`, `vehicleCan`, `canReadSensitive`, `canReadNotice`, `canExecute` (exports at 265 — a switch over all 37 commands).

- `staffCan(state, actor, activityId, capability, signupIds, now)` = `StaffScope` ∩ `Capability[]` ∩ unexpired. **The expiry boundary is strict less-than: `expiresAt === now` is already expired.**
- `vehicleCan` never grants roster / field / sensitive capability.
- `isOwnSignup` includes the submitter, not just the person — that is what makes 代报 (proxy signup) work.
- `hasProxyConsent` gates reading another person's contact data and filing position/home for them, via `Consent.proxyAuthority` / `Consent.proxyHome`.

## ALLOCATION — `allocation.js`

`planAssignments(state, actor, activityId, now)`. Doc comment: 纯函数式分车预览，**绝不重排已有座位**.

Excludes drivers from passenger capacity via `passengerCapacity`; collapses signups into **units** (a whole `SignupGroup` when `keepTogether`, else per-signup); for each unit considers only the vehicle that group is *already* on; requires every member's `trip.pickupPointId` to be in `vehicle.pickupPointIds`; takes the first vehicle with room; otherwise emits a `UnassignedReason`. Uses a hand-rolled digit-block-aware `naturalCompare` instead of `Intl.Collator({numeric:true})`. Calls `assertInvariants` before returning. Uses a lazy `require('../invariants')` at line 45 to break a require cycle — keep it lazy.

## SEMANTICS THAT MUST NOT REGRESS

Enforced here, not in the client. All of these have a test or a pin behind them:

- A `SignupGroup` occupies capacity as a **unit**. `manual` approvalMode ⇒ pending, `automatic` ⇒ confirmed. When full, the **whole group** must explicitly waitlist.
- Phase gates: `published→gathering` requires no pending; `gathering→active` requires every actual traveller verified departed (check-in + outbound boarding); `closing→archived` requires all home with no open incidents; cancellation is only possible before departure.
- `PositionReport`: one latest per person, `consentExpiresAt` = the activity's `endAt`, non-revisable after revocation, **stale after strictly 30 minutes**.
- Reading sensitive data requires a declared `purpose`; exporting a sensitive roster writes an `export.record` audit **first**.
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
