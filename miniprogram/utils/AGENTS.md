# utils/ — 纯逻辑层

11 files. **9 of the 11 are deliberately free of any `wx.*` API** so `tools/*-test.js` can `require()` them directly under plain Node. That property is the reason this directory is testable at all — do not break it.

| File | LOC | wx-free | Role |
|---|---|---|---|
| `api.js` | ~128 | **NO** | The only `wx.cloud.callFunction` site in the entire mini program. 15 exports（含 `getWeatherByPoint`）. |
| `draft.js` | ~92 | **NO** | wx storage 的两个落点之一：本地草稿 + 最近查看 + `wxStorage` 通用适配器（供注入式纯 util 用，见 `watch-points.js`）。 |
| `format.js` | 128 | yes | UTC+8 formatting + every label-copy map + WMO `weatherPhrase` |
| `util.js` | 111 | yes | `distanceKm` (haversine), `maskPhone`/`maskId`, `relativeDeadline`, `buildRosterTsv` (clipboard), `buildRosterCsv` (BOM + full PII, for insurance), `wmoText`, `reportText` |
| `astro.js` | 283 | yes | NOAA solar/lunar math, twilights, 银心 season + azimuth |
| `sky.js` | 433 | yes | 天相 probability engine, 6 phenomena |
| `route-schedule.js` | 110 | yes | GPX offsets → per-node arrival day/time |
| `gpx.js` | 318 | yes | GPX parser + GCJ↔WGS transforms + track simplification |
| `chart-store.js` | 14 | yes | Module-singleton bus, weather page → landscape chart page |
| `watch-points.js` | ~180 | yes | 观察点/轨迹点组（P3 独立天气）。**注入式 storage**：`createWatchPoints(storage)` 工厂，页面注入 `draft.wxStorage`、测试注入内存 Map——它是 wx-free 的同时仍走 wx 存储 |
| `notices-page.js` | ~172 | yes | `makeNoticesPage(getActivityId, opts)` page factory（`opts.tabBarIndex` 供 Tab 页自报选中态） |

Measured reference centrality (files requiring each): `api.js` 15 · `format.js` 12 · `draft.js` 7 · `astro.js` 5 · `sky.js` 3 · `route-schedule.js` 3 · `gpx.js` 3 · `chart-store.js` 3 · `notices-page.js` 2 · `util.js` 0.

## THE PURITY RULE

`api.js` and `draft.js` are the **only** permitted `wx` dependencies. Everything else must stay pure so a Node script can import it with no stubbing. If a pure util genuinely needs wx storage, invert the dependency instead of reaching for `wx`（`watch-points.js` 先例：`createWatchPoints(storage)` 工厂 + `draft.js` 导出 `wxStorage` 适配器）.

Consequences worth knowing before you touch these files:
- **Time is Beijing time, hardcoded UTC+8, no timezone library and no DST.** `format.js` does the offset arithmetic by hand.
- `astro.js` computes the sun's azimuth with `atan2` because `acos` overflows near the zenith. Its 银心 (galactic center) azimuth comes from an empirical 25–40°N curve — the source comment says explicitly 「不是星历」 (not an ephemeris). Do not "upgrade" it to a real ephemeris; the tests pin the empirical curve.
- `sky.js` opens with 「这是『概率判断』，不是预报产品」. All output uses probability language and every conclusion carries its evidence, a bearing, and a time window.

## `api.js` — TWO RESULT SHAPES（都会 reject）

This trips people up, so check which family you are calling. `call()` resolves to `r.data` and **throws** on `{ok:false}` or any transport failure.

- **Unwrapped payload:** `read`, `dispatch`, `getWeather`, `readOr`. The server returns `{ok:true,data}` or `{ok:false,error:{code,message}}`, so these hand you the plain object and reject with a normalized `Error` carrying `.code`（transport failures get `code = 'NETWORK'`，`-504003` / `FUNCTIONS_TIME_LIMIT` / timeout 会被正则映射成中文重新部署提示）。`readOr` 再多走一步：它自己拆掉 `r.value`，`!r.ok` 时抛错。
- **Result-shaped `{ok, value|error}`:** `readForm`, `readTransport`, `readSensitive`, `readContact`, `readExport`。**不是因为客户端透传，而是服务端把这些动作的 payload 包进了 `okValue()`**（`domain/contracts.js:17`）——所以 `call()` 解包后拿到的仍是一个 Result，调用方必须自己判 `result.ok` 再读 `result.value`。`previewAssignments` 同形，但额外把 throw 转成 `{ok:false}`，**它是唯一永不 reject 的**。
- **⚠️ 关键：上面每一族在传输失败时都会 reject。** `result.ok === false` 只覆盖服务端 Result 那条路；网络异常、云函数未部署、`wx.cloud` 本身报错，走的是 reject。**所以每个调用点都必须有 `.catch()`** —— 只写 `result => result.ok ? … : …` 会在「云函数没部署」时静默失败，这正是 F8 那类 bug 的成因。

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
| `watch-points.js` | `node tools/watch-points-test.js` | 37 |
| `sky`+`astro`+`route-schedule` + `lib/weather` + weather 页（含 local 模式） | `node tools/weather-page-test.js` | 129 |
| `api.js` (monkey-patched) + `draft.js` | `node tools/scenario-editor-test.js` | 137 |
| `lib/weather` 纯函数（byPoint 校验/缓存 key/免鉴权集合） | `node cloudfunctions/trailApi/smoke-test.js` §15 | （并入 smoke） |

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
