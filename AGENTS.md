# PROJECT KNOWLEDGE BASE — OurTrail

**Generated:** 2026-09-29 · **Commit:** `7423c82` · **Branch:** `master` (clean)

---

## OVERVIEW

OurTrail is a **zero-money, pure-tool outdoor companion/fulfillment app for friend circles** (「熟人圈子的户外同行履约工具：零金额、纯工具」). The loop: 发起人建活动 → 分享到群 → 群友填一次报名 → 发起人用同一份名单完成审核、分车、签到、收尾、导出.

**Stack — smaller than it looks:**

| Layer | Reality |
|---|---|
| Client | WeChat mini program, **native WXML/WXSS/CommonJS JS**. 14 pages, 11 components, **zero npm dependencies** (no `miniprogram/package.json`, no `miniprogram_npm/`). `libVersion 3.8.12`, appid `wx1227a277a3f2f7ea` |
| Backend | **ONE** cloud function `trailApi` — not 12. 12 `action` values multiplexed through one `ROUTES` map, fanning out to **37 command types**. Sole dependency `wx-server-sdk ~3.0.1` |
| Store | Document-per-record across **16** `ot_*` collections (14 in the `COLLECTIONS` map, plus `ot_meta` and `weather_cache`). `ot_meta/main` = `{revision, savedAt}`. Writes diff records inside one transaction with a **revision CAS** |
| Domain | 13 pure JS modules in `cloudfunctions/trailApi/domain/` — all authorization, business rules, and response shapes live here and **the client cannot bypass any of it** |
| Weather | Keyless `https.get` to `api.open-meteo.com` via a cloud-function proxy, 30-min `weather_cache`. **All astronomy/天相 computation is client-side** |
| Design source of truth | `miniprogram/app.wxss` (33 tokens + all globalized component classes) + `.agents/skills/ourtrail-ui/` |

**No root `package.json`. No `node_modules/` anywhere. No ESLint/Prettier/EditorConfig/tsconfig/biome. No lint, format, typecheck, or build step for the mini program.** The only automated gates are `node tools/check.js` and `node tools/check-handlers.js`.

---

## READ THESE FIRST (non-negotiable)

1. **`.agents/skills/ourtrail-ui/SKILL.md` + its 3 references** — the UI constitution. Load it for *any* change under `miniprogram/`, even if the user never says "设计系统". Its 14 `platform-pitfalls.md` entries each have a real incident behind them.
2. **`PARALLEL_DEV.md`** — the two-machine git protocol this repo is built around. You are on a relay-backed remote; violating it desynchronizes a second machine.
3. **`SYNC.md`** — 40+ entry changelog and the project's institutional memory. Search it before touching weather, editor, discover, or map code.

---

## STRUCTURE

```
/                      # 0 config files of note: project.config.json only
├── miniprogram/       # CLIENT — see miniprogram/AGENTS.md
│   ├── app.js/json/wxml/wxss   # entry; app.wxss IS the design system
│   ├── config.js      # CLOUD_ENV / FUNC_NAME / NOTICE_TMPL_IDS — the only env file
│   ├── pages/         # 14 dirs, 1:1 with app.json `pages`
│   ├── components/    # 11 dirs + custom-tab-bar/
│   ├── utils/         # 10 files — see miniprogram/utils/AGENTS.md
│   ├── wxs/           # text.wxs
│   └── assets/markers/  # generated PNGs (map markers reject base64)
├── cloudfunctions/trailApi/   # BACKEND — see cloudfunctions/trailApi/AGENTS.md
│   ├── index.js        # 12-action router, overrideEvidence, weather
│   ├── store.js        # 16 ot_* collections, loadState, persistState CAS
│   ├── domain/         # 13 pure modules — see .../domain/AGENTS.md
│   ├── lib/weather.js  # Open-Meteo proxy (duplicates gcjToWgs — keep in sync)
│   └── smoke-test.js   # 86 cases, needs no wx-server-sdk
├── tools/             # 9 zero-dep node scripts: 6 tests + 2 checks + 1 generator
├── docs/product/      # 8 tracked product specs + 3 ADRs — the "why"
│                      # (a 9th, 天气模块升级-P3-独立天气模块设计.md, is a 待评审 local
│                      #  draft that git has never tracked — don't assume it exists elsewhere)
├── docs/prototypes/ourtrail-app/  # FROZEN React design spec — see its AGENTS.md
├── .agents/skills/ourtrail-ui/    # mandatory UI rules
├── PARALLEL_DEV.md / SYNC.md / README.md
```

---

## WHERE TO LOOK

| Question | Location |
|---|---|
| What fields does entity X have? | `cloudfunctions/trailApi/domain/schema.js` |
| Can this user do Y? | `domain/permissions.js` → `canExecute` / `staffCan` / `vehicleCan` |
| What are the hard business rules? | `domain/invariants.js` → `assertInvariants` |
| What shape does a page get back? | `domain/selectors.js` (whitelisted projections) |
| How does auto-assign (分车) work? | `domain/allocation.js` → `planAssignments` |
| How does the page talk to the cloud? | `miniprogram/utils/api.js` — the **only** `wx.cloud` caller |
| What are the design tokens? | `miniprogram/app.wxss` lines 5–40 (33 CSS custom properties on `page`) |
| Beijing-time formatting + label maps | `miniprogram/utils/format.js` |
| GPX → route nodes | `miniprogram/utils/gpx.js` → `parseGpx` |
| 天相 / 概率判断 | `miniprogram/utils/sky.js` → `summarize`; astronomy in `utils/astro.js` |
| Why does rule X exist? | `docs/product/` + `docs/prototypes/ourtrail-app/src/domain/` (read-only) |
| It broke yesterday — what happened? | `SYNC.md` 变更日志 |

---

## CODE MAP

Reference centrality measured by **grep require-count** (no TS/JS LSP and no ast-grep are installed in this environment, so centrality is a proxy, not a compiler-derived number):

| Module | Refs | Role |
|---|---|---|
| `miniprogram/utils/api.js` | 15 | Sole `wx.cloud.callFunction` site; 14 exports |
| `miniprogram/utils/format.js` | 12 | UTC+8 formatting + all label maps |
| `domain/contracts.js` | 12 | ERROR_CODES, `canonicalPayload` (sha256 fingerprint), `genId`, `deepClone` |
| `miniprogram/utils/draft.js` | 7 | wx-storage drafts + opened-activity LRU |
| `domain/permissions.js` | 7 | All authorization |
| `miniprogram/utils/astro.js` | 5 | NOAA solar/lunar math |
| `domain/schema.js` / `invariants.js` | 4 / 4 | Entity specs / referential integrity |
| `domain/selectors.js` | 2 (but 493 LOC) | Every response shape |
| `utils/{sky,route-schedule,gpx,chart-store}.js` | 3 each | 天相 / schedule mapping / GPX / cross-page bus |

**Complexity hotspots** (>400 LOC, all hand-written, no framework to lean on): `miniprogram/pages/editor/editor.js` (798) · `editor.wxml` (526) · `pages/activity/activity.js` (548) · `components/meteogram/meteogram.js` (507) · `components/transport-panel/transport-panel.js` (445) · `utils/sky.js` (433) · `app.wxss` (484) · `domain/selectors.js` (493).

---

## COMMANDS

There is no `npm test`. Everything is a bare `node <file>` from the repo root. Each suite self-reports `passed=N failed=N` and exits non-zero on failure, so `&&`-chaining works.

```bash
# MANDATORY pre-commit gate (PARALLEL_DEV.md 铁律 3)
node tools/check.js            # static: node --check, WXML tag balance, WXSS braces,
                               # app.json page files, usingComponents refs (forward: registered
                               # but missing, AND reverse: tag used but never registered)
                               # → ALL CHECKS PASSED
node tools/check-handlers.js   # every WXML bind* resolves to a JS handler (catches what --check cannot)
node tools/check-handlers.js weather   # optional: single page/component target

# Logic regression — 540 assertions, all currently passing
node cloudfunctions/trailApi/smoke-test.js   # passed=86   domain layer
node tools/astro-test.js                     # passed=60   astronomy
node tools/gpx-test.js                       # passed=47   GPX + coordinate transforms
node tools/sky-test.js                       # passed=65   天相 conclusions
node tools/route-schedule-test.js            # passed=41   schedule inference
node tools/weather-page-test.js              # passed=104  cloud→page→component contract
node tools/scenario-editor-test.js           # passed=137  editor page scenarios

# Full pre-commit sweep
node tools/check.js && node tools/check-handlers.js && \
node cloudfunctions/trailApi/smoke-test.js && node tools/astro-test.js && \
node tools/gpx-test.js && node tools/sky-test.js && node tools/route-schedule-test.js && \
node tools/weather-page-test.js && node tools/scenario-editor-test.js
```

**Test style is hand-rolled** — no jest/vitest/miniprogram-simulate. Each `tools/*-test.js` redefines `check(name, cond, extra)` + `section(title)` and calls `process.exit(failed ? 1 : 0)`. `scenario-editor-test.js` contains the reusable harness: it stubs `global.wx`, captures the real `Page()` config, `delete require.cache` to force a fresh source read, and monkey-patches `utils/api` to assert emitted commands.

**Run/preview is WeChat DevTools only.** Deploy: right-click `cloudfunctions/trailApi` → 上传并部署：云端安装依赖. **This Mac has no DevTools installed** (PARALLEL_DEV.md §6) — static checks are the only automated gate here, and UI/cloud-function work must be verified on the Windows box before merging.

---

## ANTI-PATTERNS (each one shipped a real bug)

1. **`options` may appear exactly ONCE per `Component()`.** A second same-named key silently overwrites the first, dropping `styleIsolation: 'apply-shared'` and scattering every global class. Guard comments live at the top of `components/form-field/form-field.js` and `components/overlay/overlay.js`; the bug itself was fixed in `daa0508`.
2. **Every `utils/*.js` function must be added to `module.exports`.** A missing export made all 27 `dispatchAndSync` call sites `undefined` — invisible because the user had never completed a server submit (`598db98`). Audit cross-file API surfaces **with a script, not by eye**.
3. **Every component used in a page must be registered in that page's `usingComponents`.** `editor.json` omitted `overlay`; every GPX result `setData` landed in a component that never loaded, so the symptom was literally 「点击无反应」 (`924d2b4`). **Both directions are now enforced** — `check.js` step 5 fails on a registration pointing at a missing component, and step 5b fails on a tag used without registration.
4. **`node --check` passing means nothing about runtime.** It cannot catch undefined identifiers — a detail page once shipped where `primary is not defined` and had never rendered once in the field. That is why `check-handlers.js` exists.
5. **Never read `this.data` for a value you are setting in the same `setData`.** Move dependent work into the `setData` callback. Caused a first-screen date race (`aafe4a9`).
6. **A `type="2d"` canvas captures its layer offset at `node.width` assignment time and does not follow later reflow.** Re-measure after async layout settles, or the chart floats over body text (`b6c2439`; `meteogram.js` `scheduleSync` measures at 100 ms and 320 ms).
7. **Cloud-function edits require redeploying `trailApi`.** `config.json`'s `timeout: 20` (vs the 3 s default) also only takes effect on redeploy — the console value is the sole authority. This is a recurring time sink.
8. **The cloud function cannot `require` from `miniprogram/`.** `gcjToWgs` is deliberately duplicated in `cloudfunctions/trailApi/lib/weather.js` and `miniprogram/utils/gpx.js` — change both. `tools/weather-page-test.js` cross-checks them.
9. **Schema is strict: no extra keys, no coercion.** A new field must be added to *every* duplicate spec or the whole dataset fails validation, and must be declared optional to keep already-stored data valid (ADR-0003).
10. **Coordinates: Open-Meteo wants WGS-84, the DB and `map` want GCJ-02.** Convert at the cloud-function boundary, never in the page.
11. **Do not mirror page logic inside a test.** `SYNC.md:162` records a test that was backing a stale contract because it re-implemented the page's builder. Extract to a module instead — that is exactly why `components/meteogram/layout.js` exists.
12. **Copy must use probabilistic language** for anything weather-derived (「有…的可能」/「概率较大」); assertion-style promises (「会有云海」) are forbidden. No rescue/insurance promises anywhere.
13. **WXSS has no `color-mix()`, no `:root` (use `page`), and no reliable `dvh`.** All mixed colors are pre-budgeted literals. **WXS regex must use `getRegExp()`** — literals are unsupported.
14. **Components cannot see `app.wxss` unless they opt in** with `options: { styleIsolation: 'apply-shared' }`. Symptom: `var(--forest)` resolves inside the component but `.card` has no styles. `custom-tab-bar/index.wxss` must be fully self-contained.
15. **A closed overlay must not hit-test** — `opacity: 0` still eats every page click. Use the exact `pointer-events: none; visibility: hidden` + delayed-transition block in `platform-pitfalls.md` §4.
16. **Seat grid is 4 seats + 1 aisle per row.** Seat width `calc((100% - 48px) / 4)`, aisle a fixed `flex: 0 0 16px`. A `25%` width once made the aisle consume a seat slot and misalign the row.
17. **Never put `WXSS` literals in a component** — use `app.wxss` tokens via `var()`. `app.wxss` is the only place a new semantic color may be introduced, and it must be registered in `design-system.md` too. **「禁止发明新色值」**
18. **Do not trust English marker comments.** This repo writes its rules in Chinese. Grep `禁止|不要|务必|坑|注意|严禁` — `DO NOT`/`NEVER`/`DEPRECATED` return almost nothing. The highest-signal rules are inline comments at the top of the file that owns the bug.

---

## WORKFLOW — 铁律 (PARALLEL_DEV.md)

The Mac relays pushes through a bare repo whose `post-receive` hook forwards to GitHub **immediately**. Consequence: **two machines must never both push `master`** — a stale-baseline push is rejected *after* the relay already advanced, so both sides report success while diverged. **Once diverged, GitHub is authoritative.**

1. **除了合并窗口，永远不直接推 `master`。**
2. **开工前必 `git pull`** — the relay may already have been advanced by the other machine.
3. **提交前必跑 `node tools/check.js`** — a mini program cannot render locally; static checking is the only defense.
4. **一次只做一件事** — concurrent edits to one file will conflict.
5. **`master` 合并后立刻在另一台 `git pull`。**
6. **`.DS_Store` 不入库.**

Branches: `mac/<topic>` on this machine, `win/<topic>` on the Windows box. Also: don't grep-delete `authorized_keys` by string (match by fingerprint); don't relay secrets or long base64 through chat (it has been proven to get mangled); **test any hook/script you change, including its failure path**.

---

## NOTES / KNOWN GOTCHAS

- **`components/privacy-popup/` is dead code, and now verifiably so.** It was deliberately de-registered from `app.json` (SYNC.md:116) and the leftover `<privacy-popup />` tag in `app.wxml` was removed on 2026-09-29. The component files are kept per that decision. `check.js` step 5b now fails on any custom-component tag used in a wxml without registration in the sibling json, so this class can no longer ship.
- **`README.md` was stale and is now corrected** (2026-09-29): it had documented 12 pages / 10 components / smoke 40 while reality is 14 / 11 / 86, and omitted `pages/discover`, `pages/weather-chart`, and `components/meteogram`. It carries a 「测试」 section and the `tools/` inventory now. **If you add a page or component, update it — and let `app.json` + `components/` stay the source of truth.**
- **`app.js` `globalData: {}` is declared and never read or written.** It is not the state container. There is no mobx/redux/`Behavior()` mixin/EventChannel anywhere.
- **Live state per page:** `this.revision` / `this.now` / `this.view` are *instance properties, never `data`*. `this.revision` is the optimistic-concurrency token and must be passed to every dispatch.
- **Two api.js result shapes coexist, and both can still reject.** `read`/`dispatch`/`getWeather`/`readOr` resolve to the **unwrapped payload**. `readForm`/`readTransport`/`readSensitive`/`readContact`/`readExport` resolve to a **Result-shaped `{ok, value|error}`** — not because the client passes it through, but because the *server* wraps those payloads in `okValue()`; callers must check `result.ok` and read `result.value`. `previewAssignments` does the same and additionally converts a throw into `{ok:false}`, so it alone never rejects. **`call()` throws on every one of them** (network error, undeployed cloud function), so `result.ok === false` covers only the Result path — every call site still needs a `.catch()`.
- **Silent history truncation:** receipts ≤ 600, events ≤ 800, notices ≤ 800 (`domain/commands.js` 89–136).
- **`loadState` reads 15 collections on every request** (all 14 in `COLLECTIONS` + `ot_meta`) — full state hydration per call. `weather_cache` is separate and only `getWeather` touches it. Fine at V1 scale, but it is the first scaling wall.
- **`config.json` declares `security.msgSecCheck` but the code calls `cloud.openapi.phonenumber.getPhoneNumber`** (undeclared; works via the verified-entity path).
- **`SYNC.md:159` references `tools/repro-visibility.js`, which does not exist** — it was a one-off debugging script that was never committed. Annotated in place on 2026-09-29. Don't go looking.
- **The archived `activities` / `signups` / `templates` collections are never read or written.** There are no migration or seed scripts; `store.ensureCollections` auto-creates on every cold start.
- **Any substantive change gets a `SYNC.md` 变更日志 entry** recording root cause + fix + test counts, flagged 「需重新部署 trailApi」 when it touches the cloud function.

---

## CHILD KNOWLEDGE BASE

Read the child file before working in that directory — each contains its own maps and rules and does not repeat this file.

| File | Covers |
|---|---|
| `miniprogram/AGENTS.md` | Page + component inventory, the canonical page shape, the revision contract, styling opt-in |
| `miniprogram/utils/AGENTS.md` | The wx-free purity rule that makes Node testing possible |
| `cloudfunctions/trailApi/AGENTS.md` | The 12 actions, the single `dispatch` funnel, store + CAS, the redeploy gate |
| `cloudfunctions/trailApi/domain/AGENTS.md` | Schema/permission/invariant rules, the add-a-command recipe |
| `docs/prototypes/ourtrail-app/AGENTS.md` | Why that React tree is frozen reference material, not a second implementation |
