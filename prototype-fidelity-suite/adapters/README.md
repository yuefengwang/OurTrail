# Adapters

Everything platform-specific lives here; `core/` never requires a file from this
directory. An adapter is three things:

| Piece | Where | What it owns |
|---|---|---|
| capture module | `adapters/<id>/capture.js` | opening the runtime, waiting, reading nodes, taking the screenshot, returning a snapshot in the common shape |
| interaction driver | `core/lib/interaction.js` (`openDriver`) | performing one declared action and reading back the consequence |
| descriptor | `adapters/<id>/adapter.json` | what the adapter can and cannot measure, and what it needs from outside the repo |

The descriptor is validated at load time (`cli/pf.js` → `loadAdapterDescriptor`),
listed by `pf doctor`, and cross-checked against `LIMITATIONS.md` by
`tests/contracts.test.js`. A capture is never taken with a descriptor that fails its
schema, and an `adapter.json` whose `id` / `captureModule` disagree with the loaded
module is an error, not a warning.

## Why the descriptor exists

The suite's conclusions are limited by its instrument. A number the adapter cannot
measure must never be read as a PASS, so the instrument's limits have to be declared
in a machine-readable place rather than remembered:

| Descriptor field | Consumed by | Why it cannot be guessed |
|---|---|---|
| `capabilities.lineCount` | `contract.js`, typography dimension | inferring lines from height is not measuring them; the difference changes what a typography PASS means |
| `capabilities.screenshotScale` | `regions.js`, `capture-manifest` | a scale of 0.78 silently compares different pixel densities |
| `capabilities.elementScreenshot` | region cropping | if false, regions must be cropped from the page screenshot via normalised geometry |
| `capabilities.nodeTree` | mapping resolution | a flat list means hierarchy comes from config, and an unlisted node is "not asked", not "absent" |
| `capabilities.injection` + capture flag | interaction contract, page-state manifest | injected frames prove the render path, never the data path or behaviour |
| `coordinates.basis` | geometry pairing | mixing document and viewport bases makes every offset a false finding |
| `runtime.outsideRepo` | `env.js` resolution | the repository stays dependency-free; the runtime is located, not vendored |

## Adding a platform

1. Create `adapters/<id>/capture.js` exporting `{ id, capture, STYLE_PROPS }`. Return
   `snapshot.nodes[]` with `{id, parentId, children, tag, text, rect, styles, visible}`
   and a page-level `{screenshotPath, viewport, dpr, screenshotSize, dataSource}`.
2. Write `adapters/<id>/adapter.json` against `schemas/adapter.schema.json`. Use only
   the closed vocabulary; if your platform needs a value that does not exist, add it to
   the schema and to the table above in the same change.
3. Write `adapters/<id>/LIMITATIONS.md`, one `### <ID> <title>` heading per entry in
   `limitations[]`, each with consequence / workaround / status.
4. Add an interaction driver branch in `core/lib/interaction.js` if the platform can
   perform actions; otherwise declare checks BLOCKED with a reason code.
5. Add a config fixture with `adapter: "<id>"`; run `pf doctor` (the adapter must
   appear as available) and `node tests/run.js`.

Do not put platform branching in `core/`. If a core rule needs to know the platform,
the rule is wrong: make the adapter report a capability instead.

## Current adapters

| id | runtime (outside repo) | endpoint | Known limits |
|---|---|---|---|
| `web` | Playwright, `env.detectPlaywright` | page URL | host-dependent rendering, DOM text ≠ visible text, pseudo-elements absent |
| `wechat-miniprogram` | miniprogram-automator, `env.detectAutomator` | `ws://127.0.0.1:9421` | no DOM/CSSOM, flat tree, inferred line count, scale ≠ 1, injected states |
