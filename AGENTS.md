# PROJECT KNOWLEDGE BASE — OurTrail

**Generated:** 2026-09-29 · **Recalibrated:** 2026-10-04（数量全部重新实测：16 页 / 13 组件目录 / 13 actions / 39 commands / smoke 106）· **Base commit:** `1acd55e`

---

## OVERVIEW

OurTrail is a **zero-money, pure-tool outdoor companion/fulfillment app for friend circles** (「熟人圈子的户外同行履约工具：零金额、纯工具」). The loop: 发起人建活动 → 分享到群 → 群友填一次报名 → 发起人用同一份名单完成审核、分车、签到、收尾、导出.

**Stack — smaller than it looks:**

| Layer | Reality |
|---|---|
| Client | WeChat mini program, **native WXML/WXSS/CommonJS JS**. **16 pages**, **13 个组件目录**（12 在用 + `privacy-popup` 死代码）+ 位于 `miniprogram/custom-tab-bar/`（不在 components/ 下）, **zero npm dependencies** (no `miniprogram/package.json`, no `miniprogram_npm/`). `libVersion 3.8.12`, appid `wx1227a277a3f2f7ea` |
| Backend | **ONE production** cloud function `trailApi` — 13 `action` values multiplexed through one `ROUTES` map (`index.js:244`), fanning out to **39 command types**. Sole dependency `wx-server-sdk ~3.0.1`. 另有 **`trailApiLab`**：私有预演工具云函数（只给 `pages/lab` 造 `[预演]` 沙盒），与生产**共用同一套 `ot_*` 集合**，不是第二条服务链路 |
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
4. **`docs/e2e-mp/README.md`** — 改完 WXML/WXSS/组件结构后，**静态门禁通过不代表页面正常**。
   真机（微信开发者工具）驱动是本仓库唯一能看见像素的手段，见下方「直连微信开发者工具」一节。
   P4 的 5 个真机 bug 里只有 1 个是逻辑问题，其余 4 个逻辑测试全都测不到。
5. **`docs/testing/e2e-result-semantics.md` + `tools/e2e-result.js`** — 动两套 E2E（`tools/e2e-test.js` /
   `tools/e2e-ui-test.js`）之前必读。要点：BUSINESS 与 UI 是两个独立维度；**UI 的一条 PASS 必须由
   「一次真实 tap/input + 它的后果观测」构成**；云侧 fallback 只能证 BUSINESS；门槛不过或通道退化
   记 INCONCLUSIVE（退出码 2），**永远不是 PASS**。判别力由 `tools/e2e-fault-probe-test.js`（31 项变异）
   自证；改测试语义之前先跑它，改完再跑一次。

---

## STRUCTURE

```
/                      # 0 config files of note: project.config.json only
├── miniprogram/       # CLIENT — see miniprogram/AGENTS.md
│   ├── app.js/json/wxml/wxss   # entry; app.wxss IS the design system
│   ├── config.js      # CLOUD_ENV / FUNC_NAME / NOTICE_TMPL_IDS — the only env file
│   ├── pages/         # 16 dirs, 1:1 with app.json `pages`
│   ├── components/    # 13 dirs（12 在用 + privacy-popup 死代码）
│   ├── custom-tab-bar/  # 与 components/ 同级，样式必须自包含
│   ├── utils/         # 10 files — see miniprogram/utils/AGENTS.md
│   ├── wxs/           # text.wxs
│   └── assets/markers/  # generated PNGs (map markers reject base64)
├── cloudfunctions/trailApi/   # BACKEND — see cloudfunctions/trailApi/AGENTS.md
│   ├── index.js        # 13-action router (ROUTES@244), overrideEvidence, weather
│   ├── store.js        # 16 ot_* collections, loadState, persistState CAS
│   ├── domain/         # 13 pure modules — see .../domain/AGENTS.md
│   ├── lib/weather.js  # Open-Meteo proxy (duplicates gcjToWgs — keep in sync)
│   └── smoke-test.js   # 106 cases, needs no wx-server-sdk
├── tools/             # 32 个零依赖 node 脚本：26 个门禁套件 + 2 个静态检查 +
│                      #   e2e-result.js（结果账本，被两套 E2E require）+ 桩/生成器
├── docs/product/      # 9 tracked product specs + 3 ADRs — the "why"
│                      # (天气线三份：P1 徒步天气概览 / P2 天相与meteogram / P3 独立天气模块)
├── docs/testing/      # 审计与测试基线：cross-agent-audit.md（裁决记录）/
│                      #   e2e-result-semantics.md（两维四态语义）/ 覆盖矩阵 / 清单
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
| 改完 UI 怎么确认真的没坏？ | 真机驱动，见下方「直连微信开发者工具」+ `docs/e2e-mp/README.md` |

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
| `miniprogram/utils/weather-model.js` | 1 | P4 track/node orchestration over `sky.js` (wx-free; **holds no 天相 thresholds**) |
| `domain/schema.js` / `invariants.js` | 4 / 4 | Entity specs / referential integrity |
| `domain/selectors.js` | 2 (but 493 LOC) | Every response shape |
| `utils/{sky,route-schedule,gpx,chart-store}` | 3 each | 天相 / schedule mapping / GPX / cross-page bus |

**Complexity hotspots** (>400 LOC, `wc -l`, 2026-10-04 实测): `miniprogram/pages/editor/editor.js` (828) · `editor.wxml` (528) · `pages/activity/activity.js` (551) · `domain/selectors.js` (493) · `app.wxss` (493) · `components/meteogram/meteogram.js` (520) · `components/transport-panel/transport-panel.js` (457) · `utils/sky.js` (433) · `pages/signup/signup.js` (482).

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

# Logic regression — 26 gated suites, all currently passing（2026-10-04 复跑）.
# ⚠ 断言总数是**快照**，不是恒定值：
#   本仓库常有并行工作在进行（trailApiLab / lab 页 / 各类 bug 修复），
#   那些改动会增删用例（例：smoke 104→106、workspace 104→107 均非本轮 P4 改动）。
#   **以每个脚本自己打印的 passed=N 为准**，不要信任何写死的总数。
node cloudfunctions/trailApi/smoke-test.js   # 领域层（106）
node tools/astro-test.js                     # 天文（60）
node tools/gpx-test.js                       # GPX + 坐标转换（47）
node tools/sky-test.js                       # 天相结论（65）
node tools/route-schedule-test.js            # 日程推算（41）
node tools/weather-page-test.js              # 云函数→页面→组件契约（134）
node tools/watch-points-test.js              # 观察点/轨迹点组（37）
node tools/weather-model-test.js             # P4 轨迹层编排（wx-free 纯函数）（82）
node tools/space-time-test.js                # P4 时空天相图几何 + 漫游读数（109）
node tools/space-time-draw-test.js           # P4 真实 draw() 执行（记录式 2D 上下文）（55）
node tools/roam-scrubber-test.js             # P4 漫游控件定时器与事件契约（33）

# 端到端两层（A 层计入门禁；B 层需开发者工具，不计入门禁）
node tools/e2e-test.js                         # A 层服务链路 E2E（62 项，真信封打 exports.main）
node tools/e2e-fault-probe-test.js             # 结果模型变异自证（31 项）
node tools/e2e-ui-test.js                      # B 层真模拟器 UI E2E（两维账本，退出码 0/1/2）

# Page-level scenarios
node tools/scenario-editor-test.js           # 137
node tools/scenario-activity-test.js         # 136
node tools/scenario-workspace-test.js        # 107
node tools/scenario-signup-test.js           # 100
node tools/scenario-me-test.js               # 81
node tools/scenario-notices-test.js          # 64
node tools/scenario-vehicle-test.js          # 55
node tools/scenario-api-test.js              # 27
node tools/scenario-discover-test.js         # 21
node tools/scenario-lab-test.js              # 20
node tools/scenario-staff-test.js            # 18

# Lab cloud-function integration
node tools/trailapilab-test.js               # 25
node tools/lab-dryrun-test.js                # 165

# Full pre-commit sweep
node tools/check.js && node tools/check-handlers.js && \
node cloudfunctions/trailApi/smoke-test.js && node tools/astro-test.js && \
node tools/gpx-test.js && node tools/sky-test.js && node tools/route-schedule-test.js && \
node tools/weather-page-test.js && node tools/watch-points-test.js && \
node tools/weather-model-test.js && node tools/space-time-test.js && \
node tools/space-time-draw-test.js && node tools/roam-scrubber-test.js && \
node tools/scenario-editor-test.js
```

**Test style is hand-rolled** — no jest/vitest/miniprogram-simulate. Each `tools/*-test.js` redefines `check(name, cond, extra)` + `section(title)` and calls `process.exit(failed ? 1 : 0)`. `scenario-editor-test.js` contains the reusable harness: it stubs `global.wx`, captures the real `Page()` config, `delete require.cache` to force a fresh source read, and monkey-patches `utils/api` to assert emitted commands.

**Run/preview is WeChat DevTools only.** Deploy: right-click `cloudfunctions/trailApi` → 上传并部署：云端安装依赖；或用 `cli cloud functions deploy --e <env> --n <fn> --r`（CLI 部署不继承控制台超时配置，部署后要把超时改回 20 秒）.
**只有装了开发者工具的那台机器能跑 UI/E2E**：当前 Windows 机可以（`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`，服务端口 33278，自动化端口 9420）；Mac 那台没有装，静态门禁是那里唯一的自动闸门。

---

## 直连微信开发者工具：agent 端到端实现/测试闭环

**这是本仓库唯一能看见「像素长什么样」的手段。** 静态门禁与单元测试都做不到这件事：
它们能证明代码跑得通、图元合法，但证明不了**图真的画对了、slot 真的显示了、颜色真的没糊**。

### 能抓到哪类 bug（本轮实证）

P4 的 5 个真机 bug 里，**只有 1 个是逻辑正确性问题，其余 4 个静态检查与纯逻辑测试全部测不到**：

| bug | 为什么测不到 |
|---|---|
| `marks[node.t]` 永远查不到（整点槽 vs 节点时间） | fixture 恰好全用整点，**取值掩盖了契约错误** |
| 具名 slot 内容被静默丢弃（缺 `multipleSlots: true`） | 数据在组件 `data` 里好好的，纯逻辑测试断言的是 data 不是渲染 |
| `L.textWidth is not a function`（漏导出） | 藏在 `drawRefs`，且被前一个 bug 掩盖成永不执行的分支 |
| 播放头撑大时间轴致关留宿收不回 | 纯行为组合，只有真机能点出来 |
| 读取数 slot 需 `options: { multipleSlots: true }` | 组件 data 正常，页面上就是空的 |

规律：**凡是「数据对、渲染不对」的问题，逻辑测试天然测不到。** 而这正是小程序最常见的一类。

### 一次性前置（人工，每台机器一次）

两件事都**无法用命令行完成**，必须人做一次：

1. **开服务端口**：微信开发者工具 → 设置 → 安全设置 → **服务端口 开启**，记下端口号（我们用 33278）。
   未开启时所有 `cli` 命令报 `IDE service port disabled`，且**管道喂 `y` 无效**（需要真实交互 stdin）。
2. **扫码登录**：`cli islogin` 返回 `{"login":true}` 才算好。账号需有 `appid` 的开发者权限。

> 服务端口页面上的 **CLI 访问令牌**留空即可——留空时 CLI 的 HTTP/WebSocket 不校验令牌。
> 本方案直连 WebSocket（`wsEndpoint`），走的就是这条不校验的路径。MCP 接口另开 Token 鉴权，与此无关。

### 每轮流程

```bash
# 1) 改完代码后**必须**重开项目，否则模拟器仍用旧 bundle（这是最容易误判「改了没生效」的地方）
cli close --project D:\OurTrail --port 33278
cli open  --project D:\OurTrail --port 33278
sleep 25
cli auto  --project D:\OurTrail --auto-port 9421 --trust-project --port 33278
#    → 期望输出 {"autoPort": 942, ...}；AppID 会回显，确认是本项目的

# 2) 驱动库装在**仓库外**（本仓库零 npm 依赖是铁律，不能污染）
cd %LOCALAPPDATA%\Temp\opencode\mp-auto
npm.cmd init -y && npm.cmd install miniprogram-automator
#    PowerShell 下要用 npm.cmd：执行策略会拦 npm.ps1（PSSecurityException）
```

`cli.bat` 路径含中文，PowerShell 里务必用 `& 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat' ...` 调用。

### 驱动脚本骨架

现成模板：`docs/e2e-mp/drive.js`（复制到临时目录后 `npm i miniprogram-automator` 即可跑）。

```js
const automator = require('miniprogram-automator')
const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
const page = await mp.reLaunch('/pages/weather/weather')   // 返回值就是 page
await page.waitFor(4000)

await page.setData({ /* 合成数据，见下「数据从哪来」 */ })
await page.waitFor(3000)

await mp.pageScrollTo(1400)                                  // canvas 常在折叠线以下
const buf = Buffer.from(String(await mp.screenshot()), 'base64')   // ⚠ 见下
fs.writeFileSync(out, buf)

const st = await page.$('space-time')                        // 自定义组件用标签名直接选
console.log(await st.data())                                  // 读组件内部 data
const sc = await page.$('roam-scrubber')
await sc.callMethod('onChanging', { detail: { value: 570 } })  // 直接调组件方法驱动交互
await mp.disconnect()
```

### 踩过的坑（逐条都是实际浪费过时间的）

1. **`mp.screenshot()` 返回 base64 字符串，不是 Buffer。** 直接 `writeFileSync` 会得到「文本伪装的 png」，
   后续 `System.Drawing` 报 `OutOfMemoryException`、读图工具报「图片过大」。必须
   `Buffer.from(String(raw), 'base64')`。
2. **改完代码必须 `close` + `open`。** 只调 `auto` 不会重新编译，会让你以为修复没生效——
   本轮曾因此对着旧 bundle 排查了很久。
3. **`pages/weather` 的渲染门槛链**（`weather.wxml`）：`denied` → `elif loading` → `else` 内
   `wx:if loadingWeather`（**只出「正在查询天气」面板**）→ `wx:elif dayCards.length`（**图表在这里**）。
   注入数据必须 `denied=''`、`loading=false`、`loadingWeather=false` 且 `dayCards` 非空，
   否则元素根本不在 DOM 里，`page.$('space-time')` 返回 null。
4. **`page.$()` 在滚动后可能拿不到元素**，重新取一次 `page` 句柄再试。
5. **PowerShell 5.1 改 UTF-8 源文件会毁文件**：`Get-Content`/`Set-Content` 默认按 ANSI 读写，
   中文与全角引号全变乱码。本轮因此重建过一个测试文件。**改仓库文件一律用编辑工具。**
6. **中文路径在 `cd` + 相对路径下会失败**，`cd D:\OurTrail` 在工具 shell 里不生效，要用 `workdir` 参数。
7. **抓测试输出用 `cmd /c "node x.js > %TEMP%\o.txt 2>&1"`**，再用 Node 按 utf-8 读文件筛 `✗`；
   PowerShell 的 `2>&1 |` 会把中文与 `✗` 搅乱。
8. `npm` 脚本在 `Start-Job` 里跑没有交互 stdin，`cli` 的交互式确认喂不进去。

### 数据从哪来

云函数未部署时页面取不到真实天气，**用 `page.setData` 注入合成数据**。
这不影响验证目的：**渲染路径（canvas draw / 图层顺序 / 配色 / 文字 / slot / 布局）跑的是仓库里的真实代码，
只有数据来源是合成的** —— 而那正是纯逻辑测试覆盖不到的部分。

注入时注意 `spaceNodes` 形态：`[{ t:'HH:mm', d:'YYYY-MM-DD', alt, name }]`
（`km` 不要传，GPX 路线点没这个字段，见 P4 设计文档 §10.3）。

### 与执行级测试的分工

| 手段 | 覆盖 | 何时用 |
|---|---|---|
| 纯逻辑测试 | 函数契约、阈值、边界 | 每次改动都跑 |
| `space-time-draw-test`（记录式 2D 上下文） | **真的执行 `draw()`**，断言图层顺序 / dpr / 色值 / 无 NaN 坐标 | 改 canvas 绘制时 |
| **真机（本节）** | 像素、slot 是否显示、实际布局、文字是否折行 | 改 WXML/WXSS/组件结构时 |

`space-time-draw-test.js` 是前两者之间的中间档：它不需要 DevTools，能进 CI，但**看不见 slot 与像素**。
本轮 `multipleSlots` 那个 bug 就是它放过的。

---


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
