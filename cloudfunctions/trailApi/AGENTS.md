# cloudfunctions/trailApi/ — 服务端

**ONE production** cloud function. The 13 are `action` values multiplexed through a single `ROUTES` map (`index.js:244`). A second function is structurally possible but strongly discouraged — there is no shared package, so you would fork `domain/`, and the revision-CAS design spans the whole state.

Only dependency in the entire server: `wx-server-sdk ~3.0.1`. No weather SDK, no LLM SDK, no map/route package, no ORM, no test framework. `package.json` declares **no scripts**. Weather is a raw keyless `https.get` to `api.open-meteo.com` (`lib/weather.js:139`); only `crypto`, `https`, and `zlib` are Node builtins in use.

## STRUCTURE

```
index.js          250  exports.main(event); the ROUTES table; overrideEvidence;
                      the dispatch funnel; getCachedForecast; getPhoneNumber
store.js          137  16 ot_* collections (14 mapped + ot_meta + weather_cache),
                      loadState, diffCollections, persistState (revision CAS in a
                      transaction), ensureCollections
config.json         8  { timeout: 20, permissions: { openapi: [security.msgSecCheck] } }
domain/          2409  13 pure modules, zero wx-server-sdk → see domain/AGENTS.md
lib/weather.js    217  Open-Meteo proxy, GCJ→WGS, cloud-band reconstruction
smoke-test.js     404  106 domain assertions; runs with NO wx-server-sdk
```

There is no `common/`, `utils/`, or `_shared` module. Sharing is relative `require` inside one deployed package.

## THE 13 ACTIONS

`exports.main` resolves `ROUTES[event.action]`, injects the actor as `cloud.getWXContext().OPENID` (never from the payload), and always returns `{ok:true, data}` or `{ok:false, error:{code, message}}`. `getWeather` is the only action that does not require an OPENID.

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
2. `sha256(canonicalPayload(clean))` → the idempotency fingerprint.
3. `reduceCommand` — schema validation → `canExecute` → receipt lookup → revision check → handler → `recordChange` event/notice fanout → `assertInvariants`. The business detail of this step belongs to `domain/AGENTS.md`.
4. `store.persistState(db, before, next, before.revision, now)` — the concurrency boundary.

## STORE (`store.js`)

Document-per-record, not one blob — this exists to stay under the 512 KB single-document limit. `COLLECTIONS` (`store.js:7`) maps 14 state keys to `ot_*` collections; each document's `_id` is `record.id` **except** `assignments` / `attendance` / `positions` (keyed by `record.signupId`) and `receipts` (keyed `actorId + '__' + requestId`). Plus `ot_meta` (doc `main`, the global `{revision, savedAt}` CAS counter) and `weather_cache` (key `w_<lat.2>_<lng.2>_<date>`, 30-min TTL).

`diffCollections` JSON-compares before/after and writes only changed docs, then applies them inside one `db.runTransaction`: re-read `ot_meta/main`, throw `ConflictError` (`.code === 'CONFLICT'`) unless `revision === expectedRevision`, write, bump revision. **Any non-CONFLICT storage throw is masked as `STORAGE_UNAVAILABLE` with the message 「这次修改没有保存，原安排未改变。」**

`ensureCollections` runs on **every** invocation and swallows errors — it is simultaneously the auto-create and the de-facto migration. There are no seed, backfill, or migration scripts. Adding a collection is one line in `COLLECTIONS`, but you must also update `emptyState()` in `smoke-test.js:23` and `stateSpec` in `schema.js`, or invariants will reject writes.

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
