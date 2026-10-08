# Phase 10A 报告 — BUG-C3 CAS Conflict Error Semantics Repair

日期：2026-10-08（承接 Phase 9 checkpoint `711b3c1`）
分支/worktree：`win/phase10a-c3-error-semantics` @ `D:/OurTrail-p10a`（专用，从 Phase 9 终态直接开出来）
范围纪律：**只做 C3**。未碰 D1（`index.js:122`）、未碰 BUG-C2（草稿优先）、未改客户端、未扩并发面。

---

## 1. C3 RED reproduction（两条通道，分开记）

### STUB / CLIENT-LIFECYCLE（可稳定复现，进门禁）
`tools/e2e-client-cas-test.js` 新增 **C7**：两个 `api.dispatchAndSync` 在同一个 tick 发出、携带**同一个** R，
基座 = barrier ON + `__setTxnErrorWrapping(true)`（建模 SDK 边界丢类型）。修复前：

```
✗ C7-② 败者的错误码是 CONFLICT …（{"code":"STORAGE_UNAVAILABLE","message":"这次修改没有保存，原安排未改变。请保留输入后重试。"}）
✗ C7-③ 败者页面进入恢复路径：needRefresh ⇒ page.reload() 恰好一次（reloadCalls=0）
✗ C7-⑤ 用户看到的是"已被他人更新、请重试"，不是"云存储不可用/服务异常"（[]）
passed=39 failed=3        （①④⑥⑦⑧ 全绿）
```
⇒ 红的只有"分类 + 恢复 + 提示"三条，数据类断言（恰好一胜 / 胜者存活 / revision 只 +1 / 败者零残留 / 选择性）**全绿**
——与"数据无损、语义坏了"的定性一致。

### REAL CLOUD（量化命中层②，见 `phase10a-evidence/realcloud-c3-RED-baseline.md`）
K=6 × 6 轮 = 36 个请求同时基于同一个 R：`TALLY = {OK:6, CONFLICT:17, STORAGE_UNAVAILABLE:13, OTHER:0}`，
每轮 Δrevision=1。层①与层②在信封上按 code+message 可区分，**同一批里两种文案并存**即证那 13 个走的是事务层。

诚实记录一处矛盾：K=2 这一支本轮 3/3 拿到 `CONFLICT`（请求被错开，压根没进层②），而 Phase 9 同形状 3/3 拿到
`STORAGE_UNAVAILABLE`。差别只在两个 `loadState` 是否重叠 ⇒ **不以 K=2 下任何结论**，只用 K=6 的量化基线。

## 2. 根因

`store.js` 用 `e instanceof ConflictError` 作为"这是我方 CAS 冲突"的**唯一**判据（原 `:128`），
而该判据要求异常对象**原样穿过 `runTransaction` 的 SDK 边界**。真云端不保证这一点（SDK 用自己的错误对象重抛），
于是 `:129` 的基础设施故障分支接走了它 ⇒ `STORAGE_UNAVAILABLE`。
两种机制（我们的错丢类型 / SDK 自身冲突错）都能解释读数；区分需云函数日志，本轮无该通道，**不假装定位到机制**——
修复因此做成对两种机制都成立的形态：不依赖异常类型跨边界存活。

内存层①（`commands.js:122` → `index.js` 的 `fail()`）不经事务边界，一直返回正确的 CONFLICT——
这解释了"顺序陈旧写在真云端也是 CONFLICT"，也解释了为什么这个缺陷只在真并发下出现。

## 3. production 最小修复

`cloudfunctions/trailApi/store.js` 的 `persistState`（**净变化 6 行**，未新增依赖、未改签名）：

- 冲突判定改为事务边界**内侧**的哨兵 `conflicted = true; return`（早退 = 本事务零写入 = 败者零副作用）；
- 出了 `runTransaction` 之后再 `throw new ConflictError(同层①文案)` ⇒ 异常类型不再需要跨边界存活；
- `catch` 里的 `instanceof` 分支**保留**（桩/直调路径仍能带出类型）；`STORAGE_UNAVAILABLE` 从此只兜真正的存储侧故障。

未做也不允许做（已核对为未发生）：改 `index.js:122`、改乐观并发语义、改 CAS 算法、改事务重试策略、
自动 retry、sleep、catch 后重提交、客户端 `api.js` 改动、broad refactor。
**修复范围没有超出 `store.js` + error mapping** ⇒ 未触发"停下上报"条件。
（`cloudfunctions/trailApiLab/store.js` 的同步是 `node tools/sync-lab.js` 生成器产物，不是第二处修改。）

## 4. stub GREEN

| 套件 | 修复后 |
|---|---|
| `e2e-client-cas-test.js`（含新 C7） | **passed=42 failed=0 bugs=1 drift=0**，exit 0 |
| `e2e-concurrency-test.js`（含新 S8） | **passed=44 failed=0 bugs=2 inconclusive=4**，exit 0 |
| `e2e-interleave-test.js` | passed=67 failed=0 |

C7 八条全绿，其中 **C7-⑧ 选择性**：让 `runTransaction` 自身失败（不是回调里抛的）仍必须报
`STORAGE_UNAVAILABLE` ⇒ 证明修复没有把一切擦成冲突。

## 5. real cloud GREEN —— **PENDING-DEPLOY（不由我代跑，也不猜）**

修复在云函数持久层，必须部署到线上 `trailApi` 后才能取真读数。业主选择"B：你在 IDE 部署，我只验证"，
故当前状态是**等部署**。部署后我将用同一支探针（K=6×6）复跑，判据预先写死：

- `STORAGE_UNAVAILABLE` 计数必须 **0**；`CONFLICT` 承接那批败者；
- 每轮仍恰好一个 `OK`、Δrevision 仍 = 1（否则不是分类问题而是并发正确性问题，立即升级为独立缺陷上报）；
- 沙盒 title 收尾恢复原值；不 `quit`/`close`。
- 若部署后仍见 `STORAGE_UNAVAILABLE` ⇒ 判"新代码未上线"（AGENTS.md 记过 CLI 部署不继承控制台超时的同类坑），
  不写成 GREEN。

## 6. client recovery GREEN

`api.js` **未改**，其 CONFLICT 分支本来就是对的；修复后真并发败者走的就是它：
C7-③ `page.reload()` 恰好一次、C7-⑤ 提示「已被他人更新，已刷新，请重试」、
C7-④ 胜者页面不被误触发重读、C7-⑥⑦ 用户输入不被覆盖且败者内容零残留。

## 7. mutation RED / restore GREEN

**M6**：把映射改回 `conflicted → STORAGE_UNAVAILABLE`（即还原病灶）。

```
FAIL e2e-concurrency   passed=40 failed=4   （S1 CONFLICT、S5 CONFLICT、S8 败者码、S8 对照）
FAIL e2e-client-cas    passed=39 failed=3   （C7-②③⑤）
FAIL e2e-interleave    passed=66 failed=1   （C1 同基线双签到）
ok   panel-sync / e2e / permission / domain-negative / smoke / release-gap  → 全绿（盲）
== TOTAL failed=8 suites=9 nonzero_exit=3
```
还原：`md5` 与修复版逐字节一致（`fdb5120c…`），三套复跑 44/0、42/0、67/0。
**如实声明红通道范围**：只有三套并发套件能抓 M6；`panel-sync`/A 层/permission/negative/smoke/gap 全盲
（它们只走层①的顺序陈旧写）。不谎称"全门禁可抓"。

## 8. BUG-C1 是否仍 GREEN

是。`e2e-client-cas` 的 C1-①…⑩（陈旧编辑器保存必须 CONFLICT、B 存活、零副作用、有提示）与
`e2e-concurrency` 的 S4c 对照全绿；`index.js`/`editor.js`/`api.js` 本轮零改动。
Phase 9 的真云端 C1 验证读数不因本轮而失效（本轮只改持久层错误映射）。

## 9. BUG-C2 当前状态

**未修，行为未变**，仍是常驻红测：`e2e-client-cas` C5 `[CONFIRMED BUG BUG-C2]`（套件 `bugs=1`，不计 failed）。
本轮唯一相关变化是它的**触发概率**上升了：修复后真并发败者会正常进入 `reload()`，
而 reload 遇本机草稿时仍以草稿盖表单 + 拿到最新 revision ⇒ 用户"重试"即以合法 R 覆盖他人写入。
即 **C3 修好后，C2 从"偶发静默覆盖"变成"恢复流程里的常规覆盖"** ⇒ 定级建议维持 P2、但优先级应在 Phase 10B 之前评估。
（本轮按禁区清单未动它，只记录。）

## 10. 全量回归

- 无头门禁 **43 套 2738 断言 0 失败**（`e2e-concurrency` 37→44、`e2e-client-cas` 35→42 为本轮新增断言）；
- `node tools/check.js` ALL PASSED；`node tools/check-handlers.js` exit 0；`lab-dryrun` 165/0（跑过 `sync-lab`）；
- 真机层 Phase 5 UI-State / Golden Path：**PENDING-DEPLOY**（它们打的也是线上函数，部署后一并复跑更有一致性；
  部署前跑只能反映旧版，不填进 GREEN）。当前一律记 **SKIPPED**，不写 PASS。

## 11. changed files

```
cloudfunctions/trailApi/store.js            修复（+6 行净变化，含注释）
cloudfunctions/trailApiLab/store.js         sync-lab 生成器同步
tools/stub-wx-server-sdk.js                 +可选 __setTxnErrorWrapping（默认 OFF）
tools/e2e-concurrency-test.js               +S8（+snapshot helper）
tools/e2e-client-cas-test.js                C7 由注入合成信封改为走真实并发链（删除 injectFail 通道）
docs/testing/phase10a-c3-trace.md           只读定位（五个必答问题）
docs/testing/phase10a-evidence/             RED/GREEN/M6/真云端 K2+K6 原始读数 + RED 基线正文
```

## 12. git status

`clean`。commit：`3427ce7`（修复 + 回归 + M6）→ `c294d36`（真云端 RED 基线与留档）→ 本报告。
未 push、未并入 master（中继 `git fetch` 当前不可达，也不在未授权范围内）。

## 13. residue

**0**。M6 变异窗口已还原（逐字节校验）；真云端沙盒 title 已恢复（`已恢复=true`，恢复写 `ok:true`）；
无临时探针代码留在仓库（两个驱动脚本都在仓库外 `mp-auto/`，本仓库零 npm 依赖未被污染）；
IDE 只 `disconnect`，未 `quit`/`close`。

## 14. Phase 10A 是否可以 ACCEPT

**CONDITIONAL ACCEPT**，缺的只有第 5 项：

| 项 | 状态 |
|---|---|
| §1 RED | STUB 与 REAL CLOUD 两栏都成立（真云端 K=6 命中 13/30） |
| §2 根因 | 已定性到判据本身，机制二义性如实保留 |
| §3 最小修复 | 达成，未越界 |
| §4 stub GREEN | 达成（含选择性反证 C7-⑧） |
| §5 real cloud GREEN | **待部署** |
| §6 client recovery GREEN | 达成（客户端未改，走原生 CONFLICT 分支） |
| §7 变异 | M6 有效、还原逐字节一致 |
| §8 C1 / §9 C2 | C1 仍 GREEN；C2 未修、行为未变（但触发概率上升，已登记） |
| §10 全量 | 无头全绿；真机两套 SKIPPED 待部署后复跑 |

⇒ **他部署 `trailApi` 之后**，我复跑 K=6 探针 + UI-State + Golden Path；三项都到位才把
`CONDITIONAL ACCEPT` 改写成 `ACCEPT`。若他不部署而直接进 Phase 10B，则线上仍是"C3 未修 + 修复已在仓库未生效"
的不一致状态——这一点必须显式避免。
