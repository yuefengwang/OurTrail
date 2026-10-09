# cloudfunctions/trailApi/ — 服务端

**ONE production** cloud function. The 13 are `action` values multiplexed through a single `ROUTES` map (`index.js:256`). A second function is structurally possible but strongly discouraged — there is no shared package, so you would fork `domain/`, and the revision-CAS design spans the whole state.

Only dependency in the entire server: `wx-server-sdk ~3.0.1`. No weather SDK, no LLM SDK, no map/route package, no ORM, no test framework. `package.json` declares **no scripts**. Weather is a raw keyless `https.get` to `api.open-meteo.com` (`lib/weather.js:139`); only `crypto`, `https`, and `zlib` are Node builtins in use.

## STRUCTURE

```
index.js          288  exports.main(event); the ROUTES table; overrideEvidence;
                      the dispatch funnel (NO_REVISION gate); getCachedForecast; getPhoneNumber
store.js          200  16 ot_* collections (14 mapped + ot_meta + weather_cache),
                      loadState (meta + 14 collections read CONCURRENTLY — see per-request work),
                      diffCollections, persistState (revision CAS in a transaction),
                      ensureCollections (memoized per db instance: createCollection only on first
                      call in a container), ensureMeta (read failure ≠ missing doc: fail closed,
                      never blind-set revision 0)
config.json         8  { timeout: 20, permissions: { openapi: [security.msgSecCheck] } }
domain/          2409  13 pure modules, zero wx-server-sdk → see domain/AGENTS.md
lib/weather.js    337  Open-Meteo proxy, GCJ→WGS, cloud-band reconstruction
smoke-test.js     756  173 domain assertions; runs with NO wx-server-sdk
```

（ sizes 实测于 2026-10-09 可靠性加固轮，`wc -l` + `node cloudfunctions/trailApi/smoke-test.js`。）

There is no `common/`, `utils/`, or `_shared` module. Sharing is relative `require` inside one deployed package.

## THE 13 ACTIONS

`exports.main` resolves `ROUTES[event.action]`, injects the actor as `cloud.getWXContext().OPENID` (never from the payload), and always returns `{ok:true, data}` or `{ok:false, error:{code, message}}`. Only the two weather actions skip the OPENID check (`lib/weather.js:278` `FREE_ACTIONS` = `getWeather` + `getWeatherByPoint`) — weather is non-personal data by design; every other action fails `AUTH_REQUIRED` without it.

| action | Input | Returns `data` |
|---|---|---|
| `read` | `{request:{kind, …}}` | `{view, revision, now}` |
| `readForm` | `{activityId, signupId, purpose}` | Result |
| `readTransport` | `{activityId}` | Result |
| `readAccess` | `{activityId}` | Result (owner-only collaboration grants) |
| `readNoticeManagement` | `{activityId}` | Result (owner-only) |
| `readSensitive` | `{activityId, signupId, purpose}` | Result — **纯读，服务端不写审计**（此前本文声称「writes an audit record on read」不实，2026-10-04 回代码校正；可追责性只来自客户端自律的 `export.record` 命令）|
| `readContact` | `{activityId, signupId}` | Result |
| `readExport` | `{activityId, signupIds, mode, purpose}` | Result (CSV text) |
| `previewAssignments` | `{activityId}` | bare `plan`, **not** a Result |
| `dispatch` | `{payload, requestId, expectedRevision}` | `{targetIds, replayed, revision}` |
| `getWeather` | `{activityId, pointId, date}` | `{status, hours, days, detail, series, pointElevation}` |
| `getWeatherByPoint` | `{lat, lng, date}` | 同上（按坐标直取，供未挂活动的路线点用） |
| `getPhoneNumber` | `{code}` | `{phone}` |

`read` sub-dispatches on `request.kind` inside `selectors.js:246` — `profile` | `home` | `discover` | `notices` | `activity`; anything else returns a `deniedView('FORBIDDEN')`. `kind:'activity'` also takes `perspective` (`participant|organizer|staff|vehicle`) and `vehicleId`.

**`dispatch` is the only write path.** All 39 command types funnel through it.

## THE DISPATCH FUNNEL (`index.js:112` `actionDispatch`)

1. `deepClone` the payload, then `overrideEvidence` — recursively rewrites every object that is exactly the 3-key `{at, by, note}` shape, overwriting `at` with server time and `by` with the server OPENID. **Client-supplied `at`/`by` are discarded; only `note` survives (≤2000 chars).**
2. **`expectedRevision` must be an integer on arrival** (`index.js:129`) — otherwise `fail('NO_REVISION', …)`. It used to default to the server's current revision, which silently disabled both CAS guards at once (`commands.js` revision check becomes a tautology and the schema's `specCount` gets a legal-looking fake value) — an old mini-program package could still send it, since only `utils/api.js` gated it client-side. Same error code as the client gate so pages take the "reopen the page" path instead of "keep your input and retry". Regression: `tools/e2e-revision-guard-test.js`.
3. `sha256(canonicalPayload(clean))` → the idempotency fingerprint.
4. `reduceCommand` — schema validation → `canExecute` → receipt lookup → revision check → handler → `recordChange` event/notice fanout → `assertInvariants`. The business detail of this step belongs to `domain/AGENTS.md`.
5. `store.persistState(db, before, next, before.revision, now)` — the concurrency boundary.
6. **`exports.main` 的出口归类（2026-10-09 第二轮）**：只有 `code ∈ ERROR_CODES` 的失败才原样回给客户端，其余一律 `INTERNAL` + 固定中文话术（按读/写分岔：对读请求说「本次修改没有生效」是凭空承诺一件没发生的事）。未归类异常的英文原文/堆栈**只进日志**，绝不进用户界面。每次请求（成功或失败）打**一行**结构化日志：`{ev:'api',a,c,rid,u,ok,code,ms,rp,rev,det}`，`u` 是 openid 的 sha256 前 8 位 —— 不落 openid 原文、不落 payload 内容（姓名/电话/健康备注/坐标一律不进日志）。加新错误码必须同时进 `contracts.js` 的 `ERROR_CODES` 和 `miniprogram/utils/journey.js` 的 `CODE_TITLES`，否则「每个错误码都有人话」那条门静默放过它（`NO_REVISION` 曾漏）。回归：`tools/failure-semantics-test.js`。
7. **`ensureCollections` 在 `try` 之前**：它内部的逐个 `.catch(() => null)` 会把集合层故障吞成"继续"，所以不是绕过信封的抛口（本轮实测过：`createCollection` 整体 reject 仍走正常信封）。别把它挪进 try 来"修"一个不存在的问题。

## STORE (`store.js`)

Document-per-record, not one blob — this exists to stay under the 512 KB single-document limit. `COLLECTIONS` (`store.js:7`) maps 14 state keys to `ot_*` collections; each document's `_id` is `record.id` **except** `assignments` / `attendance` / `positions` (keyed by `record.signupId`) and `receipts` (keyed `actorId + '__' + requestId`). Plus `ot_meta` (doc `main`, the global `{revision, savedAt}` CAS counter) and `weather_cache` (key `w_<lat.2>_<lng.2>_<date>`, 30-min TTL).

**`loadCollection` 回读的是 `orderBy('_id','asc')`，所以数组顺序 = 文档键字典序，不是写入顺序。** 对 receipts（键以 openid 开头）尤其致命：openid 是随机串，与时间毫无关系。任何"保留最近 N 条 / 取最后一条"的写法都必须显式按时间字段判 —— `commands.js` 的 `pruneRecent` 就是为这件事存在；把 `slice(-N)` 请回来会静默删掉"键序最靠前那个人"的幂等记忆（回归：`tools/receipt-window-test.js`）。同理 `diffCollections` 是按 `recordKey` 建 Map 比 JSON 的，**与顺序无关**，所以规范化排序不会造成额外写。

`diffCollections` JSON-compares before/after and writes only changed docs, then applies them inside one `db.runTransaction`: re-read `ot_meta/main`, throw `ConflictError` (`.code === 'CONFLICT'`) unless `revision === expectedRevision`, write, bump revision. **Any non-CONFLICT storage throw is masked as `STORAGE_UNAVAILABLE` with the message 「这次修改没有保存，原安排未改变。」**

`ensureCollections` is memoized per **db instance** (`store.js:61`): it pays the 16 `createCollection` round trips once per container and 0 on every later call (a boolean would let a swapped test db skip creation; a stored promise lets concurrent cold-start callers share one attempt; failures clear the memo so the next call retries). It still swallows per-collection errors — it is simultaneously the auto-create and the de-facto migration. There are no seed, backfill, or migration scripts. Adding a collection is one line in `COLLECTIONS`, but you must also update `emptyState()` in `smoke-test.js:23` and `stateSpec` in `schema.js`, or invariants will reject writes.

`loadState` (`store.js:109`) fires the `ot_meta` read and all 14 collection reads **concurrently** (`Promise.all`) — serial `await` made wall clock 15×RTT on every request. The snapshot was never atomic; the write path's revision CAS is what prevents lost updates, not read ordering. `ensureMeta` (`store.js:92`) distinguishes "doc missing" (first deploy → create) from "can't read right now" (→ `STORAGE_UNAVAILABLE`): a transient read failure must never blind-`set({revision: 0})`, which would rewind the global counter and put every online client into false CONFLICT (`tools/meta-revision-guard-test.js`).

## ANTI-PATTERNS

- **Cloud-function edits require redeploying `trailApi`; nothing hot-reloads.** `config.json`'s `timeout: 20` (vs the 3 s default) *also* only takes effect on redeploy — the console value is the sole authority. This is the project's most repeated time sink.
- **`config.json` declares `security.msgSecCheck` but the code calls `cloud.openapi.phonenumber.getPhoneNumber`** — undeclared. It works via the verified-entity path, but do not assume declared permissions are the ones in use.
- **No secrets exist and no infrastructure reads them.** Zero `process.env`, zero API keys, no `.env`. Identity is `cloud.getWXContext().OPENID`; the server is env-agnostic via `cloud.DYNAMIC_CURRENT_ENV`. Do not introduce a hardcoded env id.
- **The actor is server-injected — never read identity from `event`.** Collaboration targets arrive as a 身份码 (an openid the user copies from 「我的」), but authorization still resolves against `cloud.getWXContext()`.
- **Never trust `payload` structure before `overrideEvidence`.** The override is what makes the audit log unforgeable.
- **`loadState` reads 15 collections on every single action** (all 14 in `COLLECTIONS` + `ot_meta`) — full state hydration per request. `weather_cache` is not part of it; only `getWeather` touches that. Fine at V1 scale; it is the first scaling wall. Don't "optimize" it locally without changing the CAS design.
- **Do not use `structuredClone`, `crypto.randomUUID`, or `String.replaceAll`** — cloud-function Node compatibility. Use `deepClone` / `genId` from `domain/contracts.js` (SYNC.md:101).
- **`gcjToWgs` is duplicated on purpose.** A cloud function deploys as an isolated package and cannot `require` from `miniprogram/`. `lib/weather.js` and `miniprogram/utils/gpx.js` must change together; `tools/weather-page-test.js` cross-checks them.
- **Open-Meteo wants WGS-84; the DB and `map` want GCJ-02.** Convert at this boundary, never in the page.
- **`weather_cache` is a 30-minute TTL keyed on rounded coordinates** — a forecast is never fresher than 30 min regardless of client needs.

## TESTING

`node cloudfunctions/trailApi/smoke-test.js` → `passed=106 failed=0`。另有服务链路端到端 `node tools/e2e-test.js`（62 项，把客户端真实信封直接打进 `exports.main`）与 `node tools/e2e-fault-probe-test.js`（31 项结果模型自证）. It exercises the full reducer / invariants / selectors / allocation stack **without importing `wx-server-sdk`** — that is the whole reason `domain/` is a separate, dependency-free directory. `exports._internal` on `index.js` is the test hook that lets the test reach `assertInvariants` without pulling in the SDK.

**Any change to `domain/`, `store.js`, or a command handler must keep this suite runnable under plain Node.** Adding an `index.js`/`store.js` dependency into `domain/` breaks the project's only backend test.
