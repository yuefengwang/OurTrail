# utils/ — 纯逻辑层

10 files. **8 of the 10 are deliberately free of any `wx.*` API** so `tools/*-test.js` can `require()` them directly under plain Node. That property is the reason this directory is testable at all — do not break it.

| File | LOC | wx-free | Role |
|---|---|---|---|
| `api.js` | 121 | **NO** | The only `wx.cloud.callFunction` site in the entire mini program. 14 exports. |
| `draft.js` | 78 | **NO** | The only other wx-dependent file — wx storage. |
| `format.js` | 128 | yes | UTC+8 formatting + every label-copy map + WMO `weatherPhrase` |
| `util.js` | 111 | yes | `distanceKm` (haversine), `maskPhone`/`maskId`, `relativeDeadline`, `buildRosterTsv` (clipboard), `buildRosterCsv` (BOM + full PII, for insurance), `wmoText`, `reportText` |
| `astro.js` | 283 | yes | NOAA solar/lunar math, twilights, 银心 season + azimuth |
| `sky.js` | 433 | yes | 天相 probability engine, 6 phenomena |
| `route-schedule.js` | 110 | yes | GPX offsets → per-node arrival day/time |
| `gpx.js` | 318 | yes | GPX parser + GCJ↔WGS transforms + track simplification |
| `chart-store.js` | 14 | yes | Module-singleton bus, weather page → landscape chart page |
| `notices-page.js` | 160 | yes | `makeNoticesPage()` page factory |

Measured reference centrality (files requiring each): `api.js` 15 · `format.js` 12 · `draft.js` 7 · `astro.js` 5 · `sky.js` 3 · `route-schedule.js` 3 · `gpx.js` 3 · `chart-store.js` 3 · `notices-page.js` 2 · `util.js` 0.

## THE PURITY RULE

`api.js` and `draft.js` are the **only** permitted `wx` dependencies. Everything else must stay pure so a Node script can import it with no stubbing.

Consequences worth knowing before you touch these files:
- **Time is Beijing time, hardcoded UTC+8, no timezone library and no DST.** `format.js` does the offset arithmetic by hand.
- `astro.js` computes the sun's azimuth with `atan2` because `acos` overflows near the zenith. Its 银心 (galactic center) azimuth comes from an empirical 25–40°N curve — the source comment says explicitly 「不是星历」 (not an ephemeris). Do not "upgrade" it to a real ephemeris; the tests pin the empirical curve.
- `sky.js` opens with 「这是『概率判断』，不是预报产品」. All output uses probability language and every conclusion carries its evidence, a bearing, and a time window.

## `api.js` — TWO RESPONSE FLAVOURS

This trips people up, so check which family you are calling:

- **Unwrap and throw:** `read`, `dispatch`, `getWeather`. Server returns `{ok:true,data}` or `{ok:false,error:{code,message}}`; these resolve to the payload and throw a normalized `Error` carrying `.code` (transport failures get `code = 'NETWORK'`, and `-504003` / `FUNCTIONS_TIME_LIMIT` / timeout are regex-mapped to a Chinese redeploy hint).
- **Result passthrough, unthrown:** `readForm`, `readTransport`, `readSensitive`, `readContact`, `readExport`, `previewAssignments`. The page must check `result.ok` itself and read `result.value`.

`dispatch` auto-generates `requestId = 'req-' + base36(Date.now()) + random` when the caller omits it, and tags `err.needRefresh = true` on `CONFLICT`. `dispatchAndSync(payload, expectedRevision, page)` is what pages actually call: on `CONFLICT` it toasts 「安排已被他人更新，已刷新，请重试」 and invokes `page.reload()`. **It requires an argument with a duck-typed `reload()` method** — that is the interface contract.

## `notices-page.js` — THE FACTORY PATTERN

`module.exports = function makeNoticesPage(getActivityId) { return { data, onLoad, onShow, … } }`

Consumed as `Page(makeNoticesPage(() => null))` by `pages/notices/notices.js` and `Page(makeNoticesPage(function () { return this._options ? this._options.id : null }))` by `pages/anotices/anotices.js`. **Copy this for any new shared page logic** — there is no mixin, no `Behavior()`, no base page, and `app.js` `globalData` is never used.

## `chart-store.js` — WHY IT EXISTS

A module-level `let payload` with `set`/`get`/`clear`, carrying `{series, marks, night, selected, pointName, date}` from `pages/weather` to `pages/weather-chart`. It deliberately bypasses `wx.navigateTo` because 168 hourly points would blow the URL query limit. In-memory only — a cold entry to the chart page finds it empty.

## WHICH TEST COVERS WHAT

| Util | Suite | Cases |
|---|---|---|
| `astro.js` | `node tools/astro-test.js` | 60 |
| `gpx.js` (incl. both `gcjToWgs` copies) | `node tools/gpx-test.js` | 47 |
| `sky.js` | `node tools/sky-test.js` | 65 |
| `route-schedule.js` | `node tools/route-schedule-test.js` | 41 |
| `sky`+`astro`+`route-schedule` + `lib/weather` | `node tools/weather-page-test.js` | 91 |
| `api.js` (monkey-patched) + `draft.js` | `node tools/scenario-editor-test.js` | 126 |

## ADDING A FILE HERE

1. CommonJS `module.exports` only — no ESM, no barrel files, no subdirectories.
2. **wx-free** unless it is `api.js` or `draft.js`. If it genuinely needs `wx`, it belongs in one of those two files instead.
3. Must be requirable by a `tools/*-test.js` script with no stubbing.
4. Add a matching test. A util with no test is an untested util.
5. Time formatting belongs in `format.js`; do not open a second date library.

## ANTI-PATTERNS

- **Do not add `wx.*` to a pure util.** It silently removes it from Node test coverage.
- **`gcjToWgs` exists twice on purpose** — `lib/weather.js:4` states it: a cloud function deploys as an isolated package and cannot `require` the mini program directory, so the transform is duplicated. Change both sides; `tools/weather-page-test.js` cross-checks them and will fail if they drift.
- **Never read `this.data` for a value you are about to set in the same `setData`.** Move dependent work into the `setData` callback. This caused the first-screen date race fixed in `aafe4a9`.
- **Do not mirror page logic inside a test.** `SYNC.md:162` records a test that was backing a stale contract precisely because it re-implemented the page's builder. Extract the logic to a module and have the test assert the real function — that is why `components/meteogram/layout.js` exists.
- **WXS regex must use `getRegExp()`** — literals are unsupported (`wxs/text.wxs:2`).
- **`sky.js`'s mark keys must stay in sync with `components/meteogram/layout.js` `MARK_STYLE`.** The chart and the prose conclusions share one threshold set; if the keys diverge, the chart silently drops a mark.
- **A node with no GPX timestamp yields 「无时间信息」 — never fabricate an arrival time by interpolating on distance.** `route-schedule.js` is deliberately silent rather than wrong.
- **`gpx.js` caps input at 8 MB / 12 points** and back-fills `time`/`ele` onto named waypoints from the nearest track point, because named waypoints normally lack both but are exactly the anchors users compare the sky against. Do not "simplify" that back-fill away.
