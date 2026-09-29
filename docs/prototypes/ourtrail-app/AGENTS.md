# ourtrail-app/ — 已冻结的 V1 设计规格（2026-09-25），非生产代码

A standalone React 19 + Vite + Vitest + Playwright web app that was the **upstream design baseline** for the WeChat mini program. It is **complete and frozen**. The shipped product is `miniprogram/` + `cloudfunctions/trailApi/`. The dependency arrow points **one way** — prototype → product. Nothing here is imported, built, tested, or deployed by the product, so **editing it has zero effect on what users run.**

**Do not run, build, extend, or "fix" this project.** Do not add features here hoping they reach the mini program.

## WHY IT IS FROZEN — four independent proofs

1. **The porting plan classifies every file by fate.** `docs/superpowers/plans/2026-09-24-ourtrail-v1-prototype.md` §11 (跨端复用清单) splits the tree three ways: **直接复用** — all 13 `src/domain/*.ts` (2169 LOC) + 11 test files (~2400 LOC), ported to `cloudfunctions/trailApi`; **按值翻译** — `styles/tokens.css` (59) + `components.css` (259), rewritten as WXSS/WXML; **一次性投入 / 不迁移** — `components/*.tsx` (260), `screens/*.tsx` (899), `app/runtime.ts` (213), `useView.ts` (92), `navigation.tsx` (157), `data/store.ts`, `tests/e2e/prototype.spec.ts`. Its closing line: 「原型已按方案A完成：Web 页面是『可执行的设计规格』，业务规则与测试才是长期资产。」
2. **The no-import rule is a settled architecture decision.** `SYNC.md:32`: 「客户端不引入 domain 代码」.
3. **Zero inbound references.** Nothing in `miniprogram/`, `cloudfunctions/`, `tools/`, or `PARALLEL_DEV.md` mentions it. Every real mention is a *provenance* statement, never a dependency: `README.md:6` 「按高仿真原型…整体落地」 · `README.md:58` 「v1 高仿真原型（React，设计基准）」 · `SYNC.md:4-5` 「目标：把原型系统落实到 miniprogram/ + cloudfunctions/trailApi/」 · `.agents/skills/ourtrail-ui/SKILL.md:8` 「本项目 UI 从高仿真原型…整体移植」. (Note `docs/product/多角色系统与权限模型.md:407` links to `docs/prototypes/roles/`, which **no longer exists** — a stale link, not a missing feature.)
4. **Git says frozen.** `git log -- docs/prototypes/ourtrail-app` returns exactly **one** commit (`8b172dd`, the initial import) while `master` is far ahead. `node_modules/` is **absent** — nobody has run it here since clone.

## LEGITIMATE REASONS TO READ IT

Exactly two:

1. **`src/domain/*.ts` — why a rule exists.** 37 command types, the permission model, the 12 detail states, the invariants. The TypeScript is more readable than the ported JS. **But `cloudfunctions/trailApi/domain/` is the live copy and has drifted — when they disagree, the cloud function wins and this tree is stale.**
2. **`src/styles/tokens.css` + `components.css` — the original tokens.** Already translated into `miniprogram/app.wxss`. For the live values read `.agents/skills/ourtrail-ui/references/design-system.md` instead.

`tests/permissions.test.ts` (428 lines, 27 tests) is also the clearest statement of the permission matrix — resource authorization, whitelisted projections, personal/sensitive data, notice audiences and detail states — including three assertions worth porting mentally: over-capacity reports `remaining === -1` (never clamped to 0), position staleness is **strictly** over 30 minutes, and CSV export neutralizes formula injection.

## DO NOT MIGRATE

The 不迁移 set is deliberate: WeChat uses a page stack + `wx.navigateTo` + cloud DB rather than an SPA router and localStorage, and Playwright yields to WeChat DevTools automation. Porting any of it back would be a regression, not a feature.

## NOT COVERED HERE — the prototype is NARROWER than the product

Ten of the fourteen mini program pages have a clean conceptual counterpart (`ActivityHome`→`home`, `Notices`→`notices`+`anotices`, `Workspace`+`Roster`/`Transport`/`Field`→`workspace`+the three panels, and so on). These have **no counterpart at all** — they postdate the prototype:

`pages/discover/discover` (ADR-0003) · `pages/weather-chart/weather-chart` · `components/meteogram` · `miniprogram/custom-tab-bar/` · the editor's GPX import flow · `pages/privacy/privacy` (that one came from the separate `docs/prototypes/ourtrail-v1-design-review.html`)

Conversely the prototype has demo tools, account switching, and simulated weather/position that the product deliberately dropped.

**Therefore: never infer 「the product lacks this」 from 「the prototype lacks this」.**

## STATE OF PLAY

- **Never run in this workspace.** `node_modules/` is absent, so `npm test` fails with `vitest: command not found`. Its own scripts (`npm install`, `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`, `npm run test:e2e`) live only in this subproject's `package.json` — there is no root `package.json` and no npm workspace. If you must run them, `npm install` here first and do not commit `node_modules/`.
- **`tests/evidence/` is committed on purpose.** It holds 10 hand-captured delivery screenshots consumed by **no test** (`grep -rn "evidence/" tests/ src/` → zero; Playwright writes to `test-results/` instead) — the prototype plan §11 cites them as 交付证据. A `.gitignore` rule covering this directory and `home-browser.png` used to sit in the root `.gitignore` but was written *after* the files were force-added, so it was a no-op; it was removed on 2026-09-29 rather than deleting the delivery record. Do not treat those PNGs as fixtures, and do not re-add an ignore rule.
- **Acceptance evidence** (plan §11, 2026-09-25): `npm test` 308/308 across 18 files, `npm run test:e2e` 9/9, `npm run build` passed, and SHA256 verified the production product directory was unmodified.
- `tests/` has 22 entries but only **19 are tests** — 18 Vitest + 1 Playwright spec. Vitest's include globs are `tests/**/*.test.ts(x)`, so the e2e spec is **excluded** from `npm test`.
- `tests/helpers.ts` exports a frozen `NOW = '2026-09-24T07:00:00+08:00'`. Time is injected, never read from the system clock — that is exactly why these tests were portable to Node.

**Authority chain:** plan §11 → `SYNC.md` → `README.md`. When all three disagree, the live code under `miniprogram/` and `cloudfunctions/` wins over every one of them.
