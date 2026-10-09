# PROJECT KNOWLEDGE BASE — OurTrail

**Generated:** 2026-09-29 · **Recalibrated:** 2026-10-04（数量全部重新实测：13 组件目录 / 13 actions / 39 commands）· **Gate recount:** 2026-10-08 Phase 10A（**43 门禁套件 / 2750 断言 / smoke 173 / 17 页**；其中 1 条常驻非确定性红属天气线 `outdoor-intelligence-ui`，见 SYNC.md 2026-10-07/10-08 两条）· **Gate recount 2:** 2026-10-08 出行方式解耦（**44 门禁套件 / 2845 断言**，新增 `tools/trip-mode-test.js` 78；常驻非确定性红仍只有天气线那 1 条）· **Gate recount 3:** 2026-10-08 全生命周期审计（**50 门禁套件 / 3546 断言**，新增 6 套 `tools/lifecycle-*-test.js` 共 699，`e2e-domain-negative` 83→86；常驻红仍是天气线那 1 条。报告 `docs/superpowers/specs/2026-10-08-full-domain-lifecycle-audit.md`）· **Gate recount 4:** 2026-10-08 旅程可解释性重构（**52 门禁套件 / 3698 断言**，新增 `tools/journey-test.js` 138 与 `tools/journey-graph-test.js` 12；客户端多出 `utils/journey.js` 322 行＝状态与下一步的唯一翻译层。报告 `docs/superpowers/specs/2026-10-08-user-journey-ux-audit.md`）· **Gate recount 5:** 2026-10-09 可靠性与生产化加固两轮（**57 门禁套件 / 3805 断言 / 全部 exit 0**：第一轮 +3 套 revision/meta/cold-start 44，第二轮 +2 套 `receipt-window` 19 与 `failure-semantics` 37。生产代码只动 `index.js`/`store.js`/`domain/{commands,contracts,profile}.js` 与客户端 `utils/api.js`。报告 `docs/superpowers/specs/2026-10-09-reliability-production-hardening.md`（§1–§10 第一轮、§11–§18 第二轮）· **Gate recount 6:** 2026-10-09 Weather V2 审计第一轮（**60 门禁套件 / 4046 断言 / 全部 exit 0**：新增 `tools/cloud-field-geometry-test.js` 190、`tools/elevation-semantics-test.js` 34、`tools/oi-claim-gate-test.js` 15（前两套实测 59 套 4031，第三套为同日追加），`weather-cloud-field` 29→31 是一条**旧契约被证伪**后的替换而非削弱。生产代码只动客户端 9 个文件（含 `sky.js`/`agenda.js`/`oi-presentation.js` 的「日照金山→晨昏光染」主张改名），`cloudfunctions/` 零改动 ⇒ **不需要重新部署**。真机前后 30 张 `docs/weather-ux/qa/v2-audit-2026-10-09/`，报告 `docs/weather-ux/weather-v2-final-visual-audit.md`，铁律见 25）· **Base commit:** `2e504f2`

---

## OVERVIEW

OurTrail is a **zero-money, pure-tool outdoor companion/fulfillment app for friend circles** (「熟人圈子的户外同行履约工具：零金额、纯工具」). The loop: 发起人建活动 → 分享到群 → 群友填一次报名 → 发起人用同一份名单完成审核、分车、签到、收尾、导出.

**Stack — smaller than it looks:**

| Layer | Reality |
|---|---|
| Client | WeChat mini program, **native WXML/WXSS/CommonJS JS**. **17 pages**（`app.json` 实测，2026-10-07 复点：新增 `pages/weather-hub`、`pages/cloud-field-poc`）, **13 个组件目录**（12 在用 + `privacy-popup` 死代码）+ 位于 `miniprogram/custom-tab-bar/`（不在 components/ 下）, **zero npm dependencies** (no `miniprogram/package.json`, no `miniprogram_npm/`). `libVersion 3.8.12`, appid `wx1227a277a3f2f7ea` |
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
   **动手跑 E2E 前先读 `docs/e2e-mp/automation-playbook.md`**：会话僵死的识别与恢复、`quit` vs `close`、
   旧句柄"点击成功但没作用"、`busy` 期间的空按钮、一次性判读造成的假红、云函数部署与超时继承、退出码语义。
5. **`docs/testing/e2e-result-semantics.md` + `tools/e2e-result.js`** — 动两套 E2E（`tools/e2e-test.js` /
   `tools/e2e-ui-test.js`）之前必读。要点：BUSINESS 与 UI 是两个独立维度；**UI 的一条 PASS 必须由
   「一次真实 tap/input + 它的后果观测」构成**；云侧 fallback 只能证 BUSINESS；门槛不过或通道退化
   记 INCONCLUSIVE（退出码 2），**永远不是 PASS**。判别力由 `tools/e2e-fault-probe-test.js`（34 项变异）
   自证；改测试语义之前先跑它，改完再跑一次。
6. **`docs/testing/release-coverage-matrix.md`** — 想知道"这条命令/这个错误码到底有没有人测"就先查它，别靠记忆。
   它是脚本算出来的（39 命令 × 20 错误码 × 21 模块 × 17 页），并写明三条界线：
   **A 层 PASS ≠ UI PASS ≠ REAL CLOUD PASS；桩 barrier ≠ 真云端并发；门槛不过一律 INCONCLUSIVE。**
   并发/一致性侧的结论正文在 `docs/testing/concurrency-consistency-model.md`（层①/层② 分工）与
   `docs/testing/phase9-report-2026-10-07.md`（BUG-C1 收口 + 真云端并发与读滞后实测）。

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
│   ├── utils/         # 20 files — see miniprogram/utils/AGENTS.md
│   ├── wxs/           # text.wxs
│   └── assets/markers/  # generated PNGs (map markers reject base64)
├── cloudfunctions/trailApi/   # BACKEND — see cloudfunctions/trailApi/AGENTS.md
│   ├── index.js        # 13-action router (ROUTES@244), overrideEvidence, weather
│   ├── store.js        # 16 ot_* collections, loadState, persistState CAS
│   ├── domain/         # 13 pure modules — see .../domain/AGENTS.md
│   ├── lib/weather.js  # Open-Meteo proxy (duplicates gcjToWgs — keep in sync)
│   └── smoke-test.js   # 173 cases (measured 2026-10-09), needs no wx-server-sdk
├── tools/             # 67 个零依赖 node 脚本（实测 2026-10-09 可靠性加固第二轮后）：59 个 `*-test.js`
│                      #   （56 个可无头进门禁；3 个需开发者工具：`e2e-ui-test` /
│                      #   `e2e-ui-state-test` / `e2e-golden-path-test`）+ 2 个静态检查 +
│                      #   `e2e-result.js`（结果账本，被上述 3 套真机层与变异自证 require）+
│                      #   `lifecycle-harness.js`（6 套 lifecycle-* 套件共用的世界驱动器，本身不是套件）+
│                      #   桩/生成器（gen-map-markers / sync-lab / stub-wx-server-sdk）
│                      #   ⚠ 改过 cloudfunctions/trailApi/domain/* 或 store.js 后必须跑
│                      #   `node tools/sync-lab.js`，否则 trailApiLab 副本与生产不一致，
│                      #   `lab-dryrun` 会红（Phase 8 就留过这条残留，Phase 9 才补跑）。
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
| 这一页该说什么状态 / 下一步是什么 | `miniprogram/utils/journey.js`（唯一出口；页面只插值，不再自造状态词） |
| 页面图与死页面归谁管 | `tools/journey-graph-test.js`（可达性、返回路径、denied 出口、模板比枚举、词汇漂移） |
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
| `miniprogram/utils/format.js` | 15 | UTC+8 formatting + all label maps |
| `miniprogram/utils/journey.js` | 7 | **状态与下一步的唯一翻译层**：阶段/报名/出行/指标/构成/门槛/错误码→人话；wx-free，`tools/journey-test.js` 直接打它 |
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

# Gated suites — 57（56 个 tools/*-test.js + smoke-test.js）. 2026-10-09 可靠性加固两轮后共 3805 断言；
# 全量复跑唯一红 = tools/outdoor-intelligence-ui-test.js 的常驻非确定性用例，打线上 Open-Meteo + 真实时钟，已归档归因、非本轮改动引入.
# ⚠ 断言总数是**快照**，不是恒定值：
#   本仓库常有并行工作在进行（trailApiLab / lab 页 / 各类 bug 修复），
#   那些改动会增删用例（例：smoke 104→106→167、workspace 104→111 均非本轮 P4 改动）。
#   **以每个脚本自己打印的 passed=N 为准**，不要信任何写死的总数。
node cloudfunctions/trailApi/smoke-test.js   # 领域层（167）
node tools/astro-test.js                     # 天文（60）
node tools/gpx-test.js                       # GPX + 坐标转换（57）
node tools/sky-test.js                       # 天相结论（65）
node tools/route-schedule-test.js            # 日程推算（41）
node tools/weather-page-test.js              # 云函数→页面→组件契约（136）
node tools/watch-points-test.js              # 观察点/轨迹点组（37）
node tools/weather-model-test.js             # P4 轨迹层编排（wx-free 纯函数）（82）
node tools/weather-v2-test.js                # Weather V2：WMO 雪码/云海可见性/Evidence/optional 降级（45）
node tools/meteogram-draw-test.js            # meteogram 真实 draw()：V2 云带剖面/风/日照轴（记录式 2D）（30）
node tools/space-time-test.js                # P4 时空天相图几何 + 漫游读数（109）
node tools/space-time-draw-test.js           # P4 真实 draw() 执行（记录式 2D 上下文）（55）
node tools/roam-scrubber-test.js             # P4 漫游控件定时器与事件契约（33）
node tools/cloud-field-svg-test.js           # Cloud Field 等值带 SVG 渲染器：网格/开链配对/碎片过滤（27）
node tools/weather-cloud-field-test.js       # 生产返回体 → cloudField 适配器 + inferState（29）
node tools/meteogram-svg-test.js             # Unified Meteogram SVG 构建（25）
node tools/meteogram-multiday-test.js        # Multi-Day Horizon 48/72h（44）
node tools/outdoor-cloud-sea-test.js         # 云海机会窗口判定（20）
node tools/outdoor-intelligence-test.js      # Outdoor Intelligence 条件态/机会判定（24）
node tools/outdoor-intelligence-ui-test.js   # OI 呈现层 + 天气页集成（46）
node tools/trip-mode-test.js                  # 出行方式 self/shared：Case 1-10 业务态 + 投影/动作/导出/detailState（78）
node tools/weather-v2-visual-audit-test.js   # Weather V2 视觉保真审计：跨宽度几何归一化/YOU 锚点/covered 透传/OI 卡契约（38）

# 旅程可解释性两套（2026-10-08 新增；被测层是 miniprogram/utils/journey.js——状态与下一步的唯一翻译层）
node tools/journey-test.js                   # 阶段/报名/出行/指标/构成/门槛/错误码/时间线/只读锁：四问是否齐备（138）
node tools/journey-graph-test.js             # 页面图静态门：死页面、无返回路径、denied 无出口、WXML 比枚举、状态词漂移、死模块登记（12）

# 全生命周期审计六套（2026-10-08 新增；共用 tools/lifecycle-harness.js，该文件本身不是套件）
node tools/lifecycle-transitions-test.js     # 7×7 阶段穷举/终态封口/级联键/两条死路探测（214）
node tools/lifecycle-cancellation-test.js    # 八个取消时点 + 名额候补联动 + 取消∥分车交错 + 集合点收敛（71）
node tools/lifecycle-allocation-test.js      # 容量/占座/司机/上车点/删车换司机 + 预览不可重排不可覆盖（109）
node tools/lifecycle-projection-test.js      # 逐行标志↔域内结论差分、permittedActions 可用性穷举、视角最小暴露、客户端文案判状态静态门（132）
node tools/lifecycle-concurrency-test.js     # 8 类命令同 requestId 重放、同版本并发败者零副作用、归档后迟到操作、递补整批原子（126）
node tools/lifecycle-fuzz-test.js            # 60×45 随机场景零违背 + 13 条终态性质 + 20 类变异自证 + 固化种子（47）
# 端到端两层（A 层计入门禁；B 层需开发者工具，不计入门禁）
node tools/e2e-test.js                         # A 层服务链路 E2E（71 项，真信封打 exports.main）
node tools/e2e-fault-probe-test.js             # 结果模型变异自证（34 项）
node tools/e2e-permission-test.js              # A 层权限矩阵：角色×命令×阶段×归属（96 断言，8 actor 全走真实信封）
node tools/e2e-domain-negative-test.js         # A 层 Domain 负矩阵：17 种错误码的确定性拒绝 + 败者零副作用快照对比（86 断言）
node tools/e2e-concurrency-test.js             # A 层并发基座（Phase 8）：barrier 对照/同 R 双写/陈旧写/幂等（50 断言，4 INCONCLUSIVE，exit 0 可进门禁；S4/S4b 常驻红测已于 2026-10-09 转正）
node tools/e2e-revision-guard-test.js          # P1 盲写洞回归（2026-10-09）：缺/坏 expectedRevision 一律 NO_REVISION 且零落库（16 断言）
node tools/meta-revision-guard-test.js         # P1 版本号回卷回归（2026-10-09）：ot_meta 读故障必须失败关闭，不得 set revision:0（18 断言，含首次部署反向门）
node tools/cold-start-work-test.js             # 每请求工作量上限（2026-10-09）：建集合仅首次调用付一次；loadState 的 14 个集合读必须并发发出（RTT 建模，10 断言）

# 幂等窗口与失败语义两套（2026-10-09 可靠性加固第二轮；判据一律检查落库后的最终数据）
node tools/receipt-window-test.js               # receipts 越过 600 之后必须按 appliedAt 淘汰：文档键是 actorId__requestId，重读会重排 ⇒ 按位置砍会砍掉最新回执 ⇒ 重放多出第二场活动（19 断言 + 2 INCONCLUSIVE）
node tools/failure-semantics-test.js           # 写失败两语义分离（超时=结果未知→重读、绝不自动重发）+ 服务端错误归类（INTERNAL 不泄露英文原文、原文只进单行结构化日志、日志无 PII）+ 发出的码必须 ∈ ERROR_CODES（37 断言 + 2 INCONCLUSIVE）

# Weather V2 几何、海拔语义与机会卡主张三套门（2026-10-09 审计第一轮；铁律 25）
node tools/cloud-field-geometry-test.js        # 等值带按业务规格写期望拓扑：晴空/满云/单层/多层分离/生灭分裂/临界/锋面/缺失回填/高度边界/噪声极端 + 图与数据的点格一致率 + 变异自证（190 断言；真实三地点 × 24·48·72h × 375·390·414）
node tools/elevation-semantics-test.js         # 海拔出处单源 resolveElev 五态 + 「此点」主语 + 模型来源必须标注 + 判读不受剖面窗钳制 + 静态门（34 断言）
node tools/oi-claim-gate-test.js               # 机会卡证据门：星空/银河/彩虹/云海/光染的「不成立必须无卡 + 成立必须有卡」成对用例 + 「日照金山」主张静态门 + 分数不得伪装成成功率（15 断言）
node tools/e2e-client-cas-test.js              # BUG-C1/C3 回归（Phase 9/10A）：真 editor.js + 真 api.js → 真 trailApi（54 断言，bugs=1：BUG-C2 草稿优先覆盖；C7=层①冲突不得依赖异常类型跨边界，C8=平台事务中止的窄映射，含 C8-⓪ 有效性门与 C8-⑨⑩⑪ 选择性三对照）
node tools/e2e-interleave-test.js              # §13 多步骤并发交错 C1~C6（67 断言，3 INCONCLUSIVE；两层 CAS + baseRevision 内层 + 阶段门次序）
node tools/e2e-panel-sync-test.js              # §14 工作台/面板 revision 同步 P1~P6（40 断言；含 api.js 吞掉 reload 的后果判定）
node tools/e2e-release-gap-test.js             # Release Gate 缺口 G1~G6（51 断言；CONSENT_REQUIRED / GROUP_SCOPE / incident / swap / vehicle.remove / companion.remove）
node tools/e2e-ui-test.js                      # B 层真模拟器 UI E2E（两维账本，退出码 0/1/2）
node tools/e2e-ui-state-test.js                # B 层 Phase 5 UI 状态矩阵（需开发者工具 9420，不计入门禁）

# Page-level scenarios
node tools/scenario-editor-test.js           # 142
node tools/scenario-activity-test.js         # 136
node tools/scenario-workspace-test.js        # 111
node tools/scenario-signup-test.js           # 103
node tools/scenario-me-test.js               # 143
node tools/scenario-notices-test.js          # 67
node tools/scenario-vehicle-test.js          # 56
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
node tools/weather-page-test.js && node tools/weather-v2-test.js && node tools/meteogram-draw-test.js && \
node tools/cloud-field-svg-test.js && node tools/weather-cloud-field-test.js && \
node tools/meteogram-svg-test.js && node tools/meteogram-multiday-test.js && \
node tools/outdoor-cloud-sea-test.js && node tools/outdoor-intelligence-test.js && \
node tools/outdoor-intelligence-ui-test.js && node tools/trip-mode-test.js && \
node tools/weather-v2-visual-audit-test.js && \
node tools/watch-points-test.js && \
node tools/weather-model-test.js && node tools/space-time-test.js && \
node tools/space-time-draw-test.js && node tools/roam-scrubber-test.js && \
node tools/e2e-test.js && node tools/e2e-fault-probe-test.js && \
node tools/e2e-revision-guard-test.js && node tools/meta-revision-guard-test.js && \
node tools/cold-start-work-test.js && \
node tools/receipt-window-test.js && node tools/failure-semantics-test.js && \
node tools/cloud-field-geometry-test.js && node tools/elevation-semantics-test.js && node tools/oi-claim-gate-test.js && \
node tools/e2e-permission-test.js && node tools/e2e-domain-negative-test.js && \
node tools/e2e-concurrency-test.js && node tools/e2e-client-cas-test.js && \
node tools/e2e-interleave-test.js && node tools/e2e-panel-sync-test.js && \
node tools/e2e-release-gap-test.js && \
node tools/lifecycle-transitions-test.js && node tools/lifecycle-cancellation-test.js && \
node tools/lifecycle-allocation-test.js && node tools/lifecycle-projection-test.js && \
node tools/lifecycle-concurrency-test.js && node tools/lifecycle-fuzz-test.js && \
node tools/journey-test.js && node tools/journey-graph-test.js && \
node tools/scenario-editor-test.js
```

**Test style is hand-rolled** — no jest/vitest/miniprogram-simulate. Each `tools/*-test.js` redefines `check(name, cond, extra)` + `section(title)` and calls `process.exit(failed ? 1 : 0)`. `scenario-editor-test.js` contains the reusable harness: it stubs `global.wx`, captures the real `Page()` config, `delete require.cache` to force a fresh source read, and monkey-patches `utils/api` to assert emitted commands.

**`tools/lifecycle-harness.js` 的三条硬约定**（改 domain 之前先读它，否则等于把审计白做）：

1. fixture **只能通过真实命令**建立——手拼 State 测的是「我造出来的状态」，不是「系统能到达的状态」。
2. `checkOracles` 是按业务规格**独立重写**的第二套不变量，不复用 `invariants.js` 的实现；
   两边必须对同一批变异同时报红（`lifecycle-fuzz-test.js` §4 就是这条的自证）。把 invariant 改松，oracle 会红。
3. 每步强制检查「被拒命令逐字节零副作用」与「接受则 revision +1」——这是抓「半成功」的机器判据，不是抽查。

另：`w.dispatch` 默认把 `expectedRevision` 取当前值，测并发必须显式传 `{expectedRevision: base}`，
否则「并发」跑成了合法的顺序两次写，全绿而无意义（本轮自己就先错过一次，靠新增的失败读数抓到）。

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
# ⚠ 路径必须加单引号：Git Bash 会把未加引号的 D:\OurTrail 吃成 D:OurTrail（驱动器相对路径），
#   开发者工具照它注册一个新项目并写进 last_compiled，此后每次编译都报
#   「app.json: 在项目根目录未找到 app.json」——见 SYNC.md 2026-10-09。
cli close --project 'D:\OurTrail' --port 33278
cli open  --project 'D:\OurTrail' --port 33278
sleep 25
cli auto  --project 'D:\OurTrail' --auto-port 9421 --trust-project --port 33278
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
19. **Never infer a domain state from a display label.** 出行方式只有一个来源：`Signup.trip.mode` → `permissions.js` 的义务谓词（`isVehicleTraveller` / `needsVehicleService` / `needsSeatAssignment` / `needsOutboundBoarding` / `needsReturnBoarding`）→ `selectors.rowView` 的 `tripMode` + 派生布尔 → UI 读这些布尔。UI/WXML 里出现 `pickup === '自行前往'`、或域内再写一遍 `trip.mode === 'shared' && !driver`，就是复发点（`SYNC.md` 2026-10-08 记的 D2/D3/D4）。文案在 `utils/format.js` 定义一次（`TRIP_MODE_LABELS` / `TRIP_MODE_OPTIONS` / `RETURN_PLAN_LABELS`），并且**只允许向下**：domain → projection → label，反向一律禁止。`self` 永远不需要车辆/座位/上车点/boarding；`shared` 的全部既有约束一个都不许放松（不要为了 self 去放宽 invariant，也不要加 `noVehicle`/`skipVehicle`/`skipDriver` 这类 Activity 级开关）。
20. **整库 invariant 有一条锁库风险**：`assertInvariants` 校验的是整个 State，任何「线上历史数据可能已经长成那样」的规则写进这里，都会让**此后全库每一次写入**一起被拒（本项目无迁移/回填脚本，`ensureCollections` 也不是迁移）。判据：只有「任何历史数据都不可能违反」的约束才放进 `invariants.js`；可能已有脏形态的，改在**写入端各拦一次** + 放进 `tools/lifecycle-harness.js` 的 `checkOracles` 看守新数据。`activity.delete` 的 positions 级联（F3）就是这个形态的活教材。另：`vehicle.depart` 与「本车参与者司机记为未出发」这类矛盾属 F1，本轮按此原则处理，没有写进 invariants。
21. **元素数量不是 UI 证据。** `tools/e2e-ui-test.js` 曾拿「面板里有没有 `.list-row`」证明「分车弹层渲染出来了」，而 `.list-row` 同时存在于面板正文的车辆卡与同行组列表——弹层根本没开时也记 PASS（2026-10-08 实测 `planOpen=false` 仍 ✓）。UI 判据必须来自**那个对象的那个状态读数**（`planOpen` / `planChanged.length` / 点击前的 `busy`），不是同名的泛指元素。同理：`bindtap="{{cond ? '' : 'onX'}}"` 的按钮在 `cond` 为真时是「样式正常、文案正确、点了没反应」，tap 返回成功也不代表任何事情。
22. **状态与「下一步」只有一个翻译层：`miniprogram/utils/journey.js`。** 三条可机器校验的界线，由 `tools/journey-graph-test.js` 常驻守着（不是靠自觉）：① **WXML 不比较服务端枚举原文**——`wx:if="{{phase === 'draft'}}"` / `{{transitionNext === 'cancelled' ? 'danger' : …}}` 一律改成 JS 或投影算好的布尔（`isDraft` / `transitionDanger` / `showPositions`），模板只认布尔与插值；② **受管中文状态词只出现在 `format.js` 与 `journey.js`**——页面 JS 里再打一份 `'待签到'` / `'草稿'` / `'自行前往'` 就是第二次定义，`roster-panel` 的旧 `STATUS_OPTIONS`（「候补」vs 标签表「候补中」）与 workspace 的 `SUBTITLES` 都是这么烂掉的；③ **页面图必须闭合**——每一页要么 tabBar/有跳进来的路由，要么登记进 `DEV_ONLY` 并写明为什么（`lab` / `cloud-field-poc`），登记页还得自声明内部身份、且不许出现在用户页里。同一门还查「有入口没返回路径」与「denied 态一屏红字没有出路」（`vehicle` / `signup` / `workspace` / `lab` / `privacy` 本轮各中一次）。方向仍然只允许 domain → projection → label（见铁律 19）。
23. **落库会重排数组：任何「保留最近 N 条」都必须按时间字段判，不许按数组位置判。** `store.loadCollection` 以 `orderBy('_id','asc')` 回读，所以进程内那条"push 序＝时间序"的数组**只活在当前这次请求里**，下一次请求拿到的是文档键的字典序。`receipts` 的键是 `actorId + '__' + requestId`（`store.js:27`），openid 是随机串，键序与写入时间毫无关系。`pruneReceipts` 原来写 `slice(len-600)`：纯 domain 套件（smoke / lifecycle-*，同进程连写）永远全绿，而真实 store 往返下会砍掉「openid 字典序最靠前那个人」的最新回执——回执是唯一的幂等记忆，被砍掉的人重发同一条命令＝第二次执行（实测复现：多出一场活动）。现在三处上限（receipts 600 / events 800 / notices 800）统一走 `commands.js` 的 `pruneRecent(list, limit, keyOf, atOf)`，按 `appliedAt`/`occurredAt`/`publishedAt` 留最近、并列按文档键定序。判据 `tools/receipt-window-test.js`。**通用推论**：凡"截断 / 取最后一条 / 依赖数组顺序"的逻辑，必须在真实 store 往返之后测；纯内存断言证明不了顺序语义。
24. **未捕获异常不许冒充业务错误。** `exports.main` 只把 `ERROR_CODES` 内的已知码原样回给客户端，其余归类 `INTERNAL`：英文原文与堆栈只进单行结构化日志（`ev/a/c/rid/u/ok/code/ms/rp/rev/det`；`u` 是 openid 的 sha256 前 8 位——**不落 openid 原文、不落 payload 内容**）。话术按读/写分岔：对读请求说「本次修改没有生效」是凭空承诺一件没发生的事。新增错误码必须**同时**进 `contracts.js` 的 `ERROR_CODES` 与 `journey.js` 的 `CODE_TITLES`，否则「每个错误码都有人话」那条门会静默跳过它（`NO_REVISION` 就这么漏过一次）。客户端写失败分两语义：`needRefresh`（CONFLICT＝别人改了→重读）与 `outcomeUnknown`（传输层失败＝**结果未知**，事务可能已提交→重读对齐，**绝不自动重发**）。判据 `tools/failure-semantics-test.js`。
25. **显示窗不是判读范围；外扩圈怎么填决定等值线能不能闭合。** Weather V2 审计（2026-10-09）三条教训：① `cloud-field-svg.buildGrid` 的外扩圈原本**复制边缘值**，于是被时间/高度窗切断的云带在网格内永远找不到降到阈值以下的位置 ⇒ 等值环闭不上；旧代码事后用「开链按全局 mean-y 两两配对 + SVG 的 `Z` 首尾直连」硬凑，真实三地点剖面上量出 **49 条断链 / 71 个自交环（`fill-rule: evenodd` 把真云区挖成洞）/ 55 条 >30 px 直线斜边（最长 371 px，横贯整图）/ 1 次把 x 重叠仅 2% 的两层云连成 12688 px² 假云块**。现在外扩圈填 0（域外=无云，闭合发生在 `clipPath` 外一格，视觉仍是贴边出血），交叉点按**网格边身份**（`h{j}_{i}`/`v{j}_{i}`）链接 ⇒ 度数恒 2、没有「任取一条未用线段」的岔口；鞍点按 cell 中心值定方向；碎片过滤只看面积且下限随 cell 缩放。② 判读（`inferState`/`denseSpanAt`/`peakCover`）扫的是**实测数据范围**，不是剖面显示窗 2000–6000 m；真机读数对照：峨眉山 24h 第 10 时云底修复前报 2,000 m（恰为窗下界＝被裁掉），修复后报 1,686 m（实测）。③ 海拔的主语只能是**此点**——全仓库没有 `wx.getLocation`，所以 `你 · 3,500 m`、`穿过你的海拔` 都是无据断言；出处判定收进 `format.resolveElev` 单源，模型来源必须追加「（模型估算）」，`ELEV_SOURCE_LABELS` 只允许定义一次。**负结果记录**：为防跨大层间隙内插造云，加过一条「间隙 >600 m 取两侧较小值」的保守规则，但三地点 24 h 全量实测最大层间隙只有 489 m（生产永不触发），而 `min()` 兜底会把两侧差异大的真实厚云带抹成无云（`weather-page-test` 当场 5 红）——已回退，别再请回来。判据 `tools/cloud-field-geometry-test.js`（190：按业务规格写期望拓扑 + 「图与数据的点格一致率」+ 变异自证）、`tools/elevation-semantics-test.js`（34）。真机前后 30 张在 `docs/weather-ux/qa/v2-audit-2026-10-09/`，报告 `docs/weather-ux/weather-v2-final-visual-audit.md`。

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
