# utils/ — 纯逻辑层

27 files (2026-10-21 复点 `ls miniprogram/utils/*.js`). **All but `api.js` / `draft.js` are deliberately free of any `wx.*` API** so `tools/*-test.js` can `require()` them directly under plain Node. That property is the reason this directory is testable at all — do not break it.

| File | LOC | wx-free | Role |
|---|---|---|---|
| `api.js` | ~132 | **NO** | The only `wx.cloud.callFunction` site in the entire mini program. 16 exports（含 `getWeatherByPoint` / `getSkyContext`）. |
| `draft.js` | ~92 | **NO** | wx storage 的两个落点之一：本地草稿 + 最近查看 + `wxStorage` 通用适配器（供注入式纯 util 用，见 `watch-points.js`）。 |
| `format.js` | 128 | yes | UTC+8 formatting + every label-copy map + WMO `weatherPhrase` |
| `journey.js` | 322 | yes | **状态与「下一步」的唯一翻译层**（2026-10-08 旅程重构新增）：`phaseLabel/phaseScene/phaseTone`、`signupLabel`、`statusFilterOptions`、`incidentOptions`、`remaining/dayPrefix`、`participantNext`、`leaderQueue`、`tripMixLine/fieldMetric/transportLock`、`TRANSITION_LABEL`、`transitionBlocker`、`timeline`（✓/●/○）、`explain`（每个 `ERROR_CODES` 都有中文标题+原因+出路）、`busyStale`。**页面只插值，不再自造状态词，也不在 WXML 里比较服务端枚举。** 测试：`tools/journey-test.js`（138）；结构门：`tools/journey-graph-test.js`（12）。方向仍是 domain → projection → label（根 AGENTS.md 铁律 19/22）。 |
| `util.js` | 111 | yes | `distanceKm` (haversine), `maskPhone`/`maskId`, `relativeDeadline`, `buildRosterTsv` (clipboard), `buildRosterCsv` (BOM + full PII, for insurance), `wmoText`, `reportText` |
| `astro.js` | ~360 | yes | NOAA solar math, twilights, 月相 + 月球高度/升落 + 银心高度/方位（`moonPosition` / `galaxyPosition`） |
| `sky.js` | ~1064 | yes | 天相 probability engine, 6 phenomena；跨夜窗口 / 低云按海拔 / 缺测失败关闭 / 方向云（spatial）/ 地形地平线（terrain）/ 透明度 seeing（atmosphere）/ 光污染（lightPollution） |
| `route-schedule.js` | 110 | yes | GPX offsets → per-node arrival day/time |
| `gpx.js` | 318 | yes | GPX parser + GCJ↔WGS transforms + track simplification |
| `chart-store.js` | 14 | yes | Module-singleton bus, weather page → landscape chart page |
| `watch-points.js` | ~180 | yes | 观察点/轨迹点组（P3 独立天气）。**注入式 storage**：`createWatchPoints(storage)` 工厂，页面注入 `draft.wxStorage`、测试注入内存 Map——它是 wx-free 的同时仍走 wx 存储 |
| `weather-cache.js` | ~95 | yes | 天气本地缓存（2026-10-14 韧性轮新增）：查询失败时的**软降级**数据源——同一个点、同一天不久前取到过就照常展示，但必须带时效横幅（「X 小时前的数据」）。同款注入式 storage 工厂 + 假钟注入；CAP=6（单键 1MB 上限，wx storage 一条返回体约百 KB）、只收 `status==='ready'`、`MAX_AGE_MS=12h`（更旧的旧预报不冒充现在的天气）。**只在失败路径出场，不替代成功路径**；测试：`tools/weather-resilience-test.js` §1 |
| `notices-page.js` | ~270 | yes | `makeNoticesPage(getActivityId, opts)` page factory（`opts.tabBarIndex` 供 Tab 页自报选中态；定向候选名单有 `targetsLoading`/`targetsError` 两个独立态，见下） |
| `route-profile.js` | 171 | yes | 活动/路线海拔剖面纯函数：连续轨迹高程 / 节点高程 / 无数据三态；输出 SVG 字符串，调用方只负责编码成 data-URI。**不插值伪造地形**；轨迹高程缺口不跨线连接。测试：`tools/route-profile-test.js` |
| `weather-brief.js` | 88 | yes | 活动详情「出发日天气」摘要：只组合 `getWeatherByPoint` 已返回的逐日/逐时事实，缺数据/超 14 天/陈旧三态分开；没有精确出发小时就只给全天，不拿 00:00 冒充。**不新增阈值、不重算天相、不承诺天气**。测试：`tools/weather-brief-test.js` |
| `solar-arc.js` | ~200 | yes | 日月标签「今日日照轨迹」：太阳高度曲线 + 日出日落 + 黄金/蓝调色带 + 选中时刻，输出 SVG 字符串。**只画真实天文量**，不叠加山体遮挡；`astro.js` 是唯一判据来源，色板是字面量（SVG 取不到 `var()`）并逐条注明来源 token。测试：`tools/solar-arc-test.js`（64） |
| `sky-ephemeris.js` | 295 | yes | 日月标签其余三块的事实层：24h 天穹带（按太阳高度角每 5 分钟采样分段 + 日出日落线 + 选中点）、晨昏时刻表（晨 4 行 / 暮 4 行按时间下行）、月相盘（半椭圆明暗界线 + 南北半球镜像）与月出月落（含极区「当日不升/不落」、跨日「（次日）」）。只 `require('./astro')`，**不新造天文判据**；判不出的形态各有各的话（`—` = 该阶段不出现 ≠ 缺测），海拔只认 `typeof number`。测试：`tools/sky-ephemeris-test.js`（99） |

Measured reference centrality (files requiring each, 2026-10-08 复点): `format.js` 15 · `api.js` 13 · `journey.js` 7 · `draft.js` 7 · `astro.js` 5 · `sky.js` 4 · `route-schedule.js` 3 · `gpx.js` 3 · `chart-store.js` 3 · `notices-page.js` 2 · **`util.js` 0（死模块，见下）**.

**`util.js` 是零引用死模块，且这句话现在被门钉住了。** `tools/journey-graph-test.js` 把它登记进 `DEAD_MODULES`：名单导出早已走服务端 `readExport`，而它内部的 `buildRosterTsv/buildRosterCsv` 仍按 `status === 'active'` 说话——那个取值在域里已经不存在（`LIVE_SIGNUP = pending/confirmed/waitlisted`）。仓库的先例是「停用但保留文件」（`components/privacy-popup` 同例），所以没有删；**一旦被 require，词汇单源那条门会先红**，届时必须先改它的旧文案。它的 `relativeDeadline`（与 `format.js` 逐字节相同、与 `journey.remaining` 同语义）已于本轮删除——倒计时只有 `journey.js` 一个出处。

## THE PURITY RULE

`api.js` and `draft.js` are the **only** permitted `wx` dependencies. Everything else must stay pure so a Node script can import it with no stubbing. If a pure util genuinely needs wx storage, invert the dependency instead of reaching for `wx`（`watch-points.js` 先例：`createWatchPoints(storage)` 工厂 + `draft.js` 导出 `wxStorage` 适配器）.

Consequences worth knowing before you touch these files:
- **Time is Beijing time, hardcoded UTC+8, no timezone library and no DST.** `format.js` does the offset arithmetic by hand.
- `astro.js` computes the sun's azimuth with `atan2` because `acos` overflows near the zenith. Moon and galactic-center positions are computed from date + lat/lng (`moonPosition` / `galaxyPosition`); the old empirical 25–40°N `galaxyBearing` table was removed in 2026-10 because it ignored longitude/latitude. `tools/astro-test.js` pins full-moon/new-moon and galactic-center transit. **Do not reintroduce a clock-only azimuth table.**
- `sky.js` uses `series` to build the selected date's night (`astroDusk` → next day's `astroDawn`); without `series` it falls back to the old calendar-day window. Missing cloud/precip readings must yield `unknown`, never `0`; `cloudAboveAt` decides whether low cloud is above or below the observer's elevation.
- `getSkyContext` (cloud action) returns four optional blocks: `spatial` (8 方位 × 3 距离云/降水), `terrain` (16 方位 DEM 地平线), `atmosphere` (7Timer seeing/transparency + CAMS AOD), `lightPollution` (DarkSkySites SQM/Bortle). The page loads it **non-blocking** and re-renders when it arrives; every block must be optional. `lightPollution: null` means "explicitly missing" and caps star/galaxy at 69; `undefined` (no sky context at all) keeps the old behaviour. The DarkSkySites key lives only in the cloud function env `DARKSKY_API_KEY` — never in the mini program.
- `sky.js` opens with 「这是『概率判断』，不是预报产品」. All output uses probability language and every conclusion carries its evidence, a bearing, and a time window.

## `api.js` — TWO RESULT SHAPES（都会 reject）

This trips people up, so check which family you are calling. `call()` resolves to `r.data` and **throws** on `{ok:false}` or any transport failure.

- **Unwrapped payload:** `read`, `dispatch`, `getWeather`, `readOr`. The server returns `{ok:true,data}` or `{ok:false,error:{code,message}}`, so these hand you the plain object and reject with a normalized `Error` carrying `.code`（transport failures get `code = 'NETWORK'`，`-504003` / `FUNCTIONS_TIME_LIMIT` / timeout 会被正则映射成中文提示）。**用户可见话术面向户外人员**（2026-10-14 韧性轮）：`transportText` 按成因给「下一步」（重试/检查网络/重开小程序），部署指引与控制台超时配置这类开发者字眼一律不进界面——技术原文只进 `e.raw` 与 `console.warn`。回归：`tools/scenario-api-test.js` §1–2 的 `DEV_JARGON` 反向门。`readOr` 再多走一步：它自己拆掉 `r.value`，`!r.ok` 时抛错。
- **Result-shaped `{ok, value|error}`:** `readForm`, `readTransport`, `readSensitive`, `readContact`, `readExport`。**不是因为客户端透传，而是服务端把这些动作的 payload 包进了 `okValue()`**（`domain/contracts.js:17`）——所以 `call()` 解包后拿到的仍是一个 Result，调用方必须自己判 `result.ok` 再读 `result.value`。`previewAssignments` 同形，但额外把 throw 转成 `{ok:false}`，**它是唯一永不 reject 的**。
- **⚠️ 关键：上面每一族在传输失败时都会 reject。** `result.ok === false` 只覆盖服务端 Result 那条路；网络异常、云函数未部署、`wx.cloud` 本身报错，走的是 reject。**所以每个调用点都必须有 `.catch()`** —— 只写 `result => result.ok ? … : …` 会在「云函数没部署」时静默失败，这正是 F8 那类 bug 的成因。

`dispatch` auto-generates `requestId = 'req-' + base36(Date.now()) + random` when the caller omits it, and tags `err.needRefresh = true` on `CONFLICT`. `dispatchAndSync(payload, expectedRevision, page)` is what pages actually call: on `CONFLICT` it toasts 「安排已被他人更新，已刷新，请重试」 and invokes `page.reload()`. **It requires an argument with a duck-typed `reload()` method** — that is the interface contract.

**写失败有两种语义，别把它们混成一句「网络异常」**（2026-10-09 可靠性第二轮）：
- `needRefresh`：服务端回了信封且 `code=CONFLICT` ⇒ 明确没落库，别人的改动在前面 → 重读 + 「已被他人更新」。
- `outcomeUnknown`：传输层失败（超时 `-504003`、断网、云函数没回话，`code=NETWORK`）⇒ **结果未知**：事务可能已经提交，只是响应丢了。做法是重读一次对齐服务端状态，话术是「结果未确认，已重读最新安排」。
  绝不自动重发——`requestId` 每次都是新生成的，服务端按 requestId 判重放，自动重发等于把一次不确定变成两次写。也绝不写成「本次修改没有保存」，那句话会诱导用户再点一次。
  回归：`tools/failure-semantics-test.js`（含"calls.length 恒为 1"这种不自动重发的硬判据）。

## `notices-page.js` — THE FACTORY PATTERN

`module.exports = function makeNoticesPage(getActivityId) { return { data, onLoad, onShow, … } }`

Consumed as `Page(makeNoticesPage(() => null))` by `pages/notices/notices.js` and `Page(makeNoticesPage(function () { return this._options ? this._options.id : null }))` by `pages/anotices/anotices.js`. **Copy this for any new shared page logic** — there is no mixin, no `Behavior()`, no base page, and `app.js` `globalData` is never used.

**`loadTargets` 的三态是这一族的规矩（B4-C19，2026-10-17）**：定向候选（organizer 名单读 + `readTransport`）
在途/失败/真的为空是三件事，各有 `targetsLoading` / `targetsError` / `rows.length===0`，页面据此分印
「名单读取中…」／「报名名单没有读到：<原因>」＋「重新读取名单」按钮／「此活动还没有报名记录。」。
改前那两个 `.catch(() => {})` 把失败吞成空数组，页面于是对组织者说「此活动还没有报名记录」——
**把没读到印成业务事实**（铁律 24 话术分岔 / 铁律 26② 判不出≠否定 / 本文件上面第 5 条"错误永不静默"）。
两条衍生约束：① 失败话术必须点名**是哪一个**读失败（两读各自 settle，`pending` 归零才落 `targetsError`）；
② 失败只锁它自己那一档——`audience=activity`「本活动相关人员」不依赖名单，照发；不许顺手禁掉整页。
**还有一条同族的坑：尝试令牌。** 重开弹层或点重试会让两次读并存，慢的那一发**后**回来时会用上一次结论盖掉
这一次的读数（名单已读到却印「没有读到」＝把同一缺陷换个触发路径重犯）。`loadTargets` 因此取
`this._targetsToken`（写实例，不进 `data`，与 `this.revision` 同族），每次 `setData`/`settle` 前 `fresh()` 比对，
被取代的尝试整条忽略。**任何"异步补读 + 可重试"的面都适用这条**：只要一个 handler 能被再次触发，
它的回调就必须认领自己那一次。
`onRetryTargets` 是这条失败态的去路（读操作才允许重试，见铁律 24），因此**必须在两页 wxml 里绑定**，
否则 `check-handlers.js` 门 B 会把它记成"定义了谁也调不到"的死 handler。
回归：`node tools/scenario-notices-test.js` §7（C1–C24：具名成因 / 不冒充空名单 / 就地重试真的再发一次读 /
失败范围不扩大化 / 在途与空分离 / 迟到尝试不覆盖当前读数 / 两页接线 + 两读都成功时的阳性对照）。
桩侧为此需要三个开关：按 `perspective` 分别失败、`state.targetsFail.*` 可翻回、`state.settleHeld(i,'bad')`
可按到达顺序单独放行——缺最后一个就测不到交错（缺前两个就测不到具名成因）。

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
| `solar-arc.js` | `node tools/solar-arc-test.js` | 64 |
| `sky-ephemeris.js`（含真页面 `buildSkyEphemeris` 装配） | `node tools/sky-ephemeris-test.js` | 99 |
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
