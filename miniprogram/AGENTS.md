# miniprogram/ — 客户端

Native WeChat mini program. **Zero npm dependencies** — no `package.json`, no `miniprogram_npm/`, plain CommonJS. Business rules live server-side; this side is presentation, request-shaping, and the client-only 天相 computation.

## STRUCTURE

```
app.js       12 lines. wx.cloud.init(CLOUD_ENV) only.
app.json     16 pages + custom:true tabBar (活动/通知/我的). NO usingComponents key.
app.wxml     comment only — the global <privacy-popup /> was de-registered in 2026-09-27
             and its leftover tag removed 2026-09-29. Nothing is mounted globally.
app.wxss     484 lines. THE design system: 33 CSS custom properties on `page`
             (not :root) + every globalized component class.
config.js    16 lines. CLOUD_ENV='cloud1-d9ghcm034574b9d55', FUNC_NAME='trailApi',
             NOTICE_TMPL_IDS={activity:''} (empty ⇒ clipboard fallback). Only env file.
pages/       16 dirs, 1:1 with app.json.
components/  13 dirs（12 在用 + privacy-popup 死代码）. custom-tab-bar/ sits outside components/（在 miniprogram/ 根下）.
utils/       10 files → see utils/AGENTS.md
wxs/text.wxs 16 lines. WXS regex must use getRegExp().
assets/markers/  generated PNGs — map marker.iconPath rejects base64
```

**Hard layout convention:** every page/component is a same-named dir holding `<name>.{js,json,wxml,wxss}`. No barrels, no index re-exports, no nesting. The only nested files are the **pure-geometry sidecars** `components/meteogram/layout.js` and `components/space-time/layout.js` — they exist so `tools/*-test.js` can assert geometry/colors without re-implementing the component (复刻页面计算会让测试为过期契约背书). All component paths in JSON are **root-absolute** (`"/components/icon/icon"`).

## PAGES (14)

`home`(157, tab) · `notices`(7, tab) · `me`(221, tab) · `activity`(548) · `discover`(95) · `signup`(352) · `editor`(798) · `workspace`(142) · `staff`(10) · `vehicle`(156) · `weather`(465) · `weather-chart`(120) · `anotices`(7) · `privacy`(1)

- **`notices` / `anotices` are 7 lines each** — both wrap the factory `utils/notices-page.js`: `Page(makeNoticesPage(() => null))` and `Page(makeNoticesPage(function () { return this._options ? this._options.id : null }))`. **Copy this pattern for new shared page logic.**
- **`staff` is a 10-line shim** — header + `<field-panel perspective="staff"/>`. A thin link-target page is an accepted pattern.
- **`weather-chart` is landscape** and reads its data from the `chart-store.js` singleton, never the URL (168 hours would blow the `navigateTo` query limit).
- **`home` fires 4 parallel `api.read` calls** (`home.js:43-46`) and merges the perspectives client-side.

## COMPONENTS (11)

Three of them are **self-fetching business panels** — the only prop is `activityId` and they load in `attached` plus an observer on that prop, guarded by a `this._loading` re-entrancy flag:

| Component | LOC | Role |
|---|---|---|
| `roster-panel` | 381 | 名单: bulk approve/waitlist/cancel, TSV/CSV export + audit, sensitive data, companion groups, collaboration grants |
| `transport-panel` | 445 | 分车: vehicles, auto-assign preview/commit, manual assign/swap, seat map |
| `field-panel` | 224 | 现场: check-in / departure verify / nodes / home-safe / incidents / position. The `perspective` prop serves both `workspace` (organizer) and `staff` |
| `meteogram` | 507+92 | canvas 2d 天相 time-coordinate chart |
| `icon` | 121 | SVG data-URI map; the only leaf component |
| `overlay` / `status-panel` / `form-field` / `person-row` / `activity-card` | 27/19/12/19/16 | presentational |
| `privacy-popup` | 49 | **dead code** — unregistered |

The auto-assign algorithm is **server-side** (`domain/allocation.js`). `transport-panel` only diffs and labels the returned plan; it never re-sorts.

## CANONICAL PAGE SHAPE

```js
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')          // optional
const draft = require('../../utils/draft')      // optional

Page({
  data: { loading: true, denied: '' },
  onLoad(options) { this.activityId = options.id || ''; this.reload() },
  reload() {
    if (!this.activityId) { this.setData({ loading: false, denied: '缺少活动编号。' }); return }
    return api.read({ kind: 'activity', activityId: this.activityId, perspective: 'participant' })
      .then(res => {
        this.revision = res.revision            // instance field, NOT setData
        this.now = res.now
        if (res.view.kind !== 'activity') { this.setData({ loading: false, denied: res.view.message }); return }
        this.view = res.view
        this.renderView()                       // view-model → setData happens HERE, not in reload
      })
      .catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },
  renderView() { /* maps this.view + F.* label maps into a flat setData shape */ },
  run(payload, msg) { api.dispatchAndSync(payload, this.revision, this)
                         .then(() => { api.toast(msg); return this.reload() })
                         .catch(e => this.setData({ error: api.errorText(e) })) },
})
```

Contract points an agent must not break:
1. **`reload()` is a data method, not a lifecycle method.** `onLoad` calls it; `dispatchAndSync`'s CONFLICT recovery calls it again via its `page.reload` argument. That duck-typed `reload` IS the interface `dispatchAndSync` requires.
2. **`this.revision` / `this.now` / `this.view` are instance properties, never `data`.** `this.revision` is the optimistic-concurrency token; every dispatch must pass it, and it is refreshed from `res.revision` on every read and write.
3. **Views arrive pre-shaped and pre-authorized.** `renderView()` is pure presentation over `F.*` label maps. No authorization decision belongs in the client.
4. The standard 5-state surface is `data.loading` / `denied` / `error` / `message` / `busy`; `busy` guards double-submit.
5. Every page needs all four states — denied / loading / empty (explain *why* empty and what to do next) / error. Errors are never silent.

## STYLING

`app.wxss` owns the tokens and all globalized component classes; a page or component `.wxss` only layers on top of them. Any component relying on those classes **must** declare `options: { styleIsolation: 'apply-shared' }` — and that key may appear **only once** per `Component()`. `custom-tab-bar/index.wxss` is the exception: fully self-contained, literals only.

Tab pages need `padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom))`; pages with `.sticky-action` use `.page.has-sticky` (120px). Full token values, class roster, seat-grid spec, and the canvas palette are in `.agents/skills/ourtrail-ui/references/design-system.md` — read it, do not re-derive.

## ANTI-PATTERNS

Beyond the root list, specific to this directory:

- **Nothing is mounted globally.** `app.json` has no `usingComponents` key and `app.wxml` has no tags — `app.json`/`app.wxml` are the floor of the tree, not a place to register things. `components/privacy-popup/` is kept on disk but dead. Register page components in the *page's* `.json`.
- **A new page requires 5 steps:** create `pages/<n>/<n>.{js,json,wxml,wxss}` → register in `app.json` `pages` → declare `usingComponents` with root-absolute paths → add `styleIsolation` if you rely on `app.wxss` classes → `node tools/check.js`.
- **`meteogram.js` re-measures its canvas twice** (`scheduleSync`, 100 ms and 320 ms). A `type="2d"` canvas caches its layer offset at `node.width` assignment and does not follow later reflow; measure after async layout settles or the chart overlays body text.
- **`meteogram/layout.js` exists on purpose** — geometry and mark colors were extracted out of the component purely so `tools/` can assert them. The `MARK_STYLE` keys must stay in sync with `sky.js`'s `hourMarks` keys. Canvas cannot read CSS vars, so its palette is literal; keep it in sync with `app.wxss`. `components/space-time/layout.js` follows the same pattern and **reuses** `meteogram/layout.js`'s `MARK_STYLE` rather than re-mapping the 天相 colors (they are the single source; if a key is added, change `sky.js` + `meteogram/layout.js` + `space-time/layout.js` together or the chart silently drops a mark).
- **静态门禁通过 ≠ 页面正常。** 改完 WXML/WXSS/组件结构后跑一次真机（微信开发者工具）驱动，
  见 `../AGENTS.md` 的「直连微信开发者工具」一节与 `../docs/e2e-mp/README.md`。
  判据很硬：**凡是「数据对、渲染不对」的问题，逻辑测试天然测不到** ——
  具名 slot 缺 `options: { multipleSlots: true }` 就是内容被静默丢弃、组件 `data` 里一切正常、页面上什么都没有。
  另外：用具名 slot 必须声明 `multipleSlots`，改了组件 `options` 要用 `check-handlers.js` 之外的手段复核。
- **`editor.js` must pass GPX `time`/`ele` through verbatim in both directions** (`toForm` / `buildInput`). They are user-invisible metadata, and dropping them silently erases the GPX record on a single draft edit. Named waypoints lack them, so `gpx.js` back-fills from the nearest track point.
- **The editor has no undo stack.** Local drafts autosave to wx storage on every edit (throttled UI timestamp refresh every 30 s), and the server `phase:'draft'` row is the real persisted entity. `onPublishIntent()` saves silently *first*, then opens the publish sheet.
- **Never trust `node --check`.** Run `node tools/check-handlers.js`; it also follows `require('../utils/...')` so factory-built handlers are checked.
