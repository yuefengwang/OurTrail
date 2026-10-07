# OurTrail Phase 9 报告 — Concurrency / Consistency Closure + Release Coverage Expansion

日期：2026-10-07（夜间长任务）
执行机：Windows（`D:/OurTrail-p9`，专用 worktree）
任务书：`Phase 9「Concurrency / Consistency Closure + Release Coverage Expansion」`

---

## A. Git / worktree

| 项 | 值 |
|---|---|
| base | `2058e41`（`win/concurrency-consistency` 顶端 = Phase 8 全部工作 + `origin/master 686fa7c` merge） |
| 分支 | `win/phase9-concurrency-closure`（新建专用 worktree `D:/OurTrail-p9`） |
| 期间上游 | 开工前 `git fetch`：`master` 与 `origin/master` left-right = `0 0`，未分叉；本轮未 push、未 merge 到 master |
| commit 序列 | `6f1b9f4` lab 同步 → `54b06fa` BUG-C1 修复 + 回归 → `4ed2fc4` §13/§14 两套件 → `09da6f6` 真云端/M5/UI-State 留档 → `f907d10` coverage matrix + GP 读数 → `0ba1f1d` 缺口补测 + 真云端读数 + BUG-C3 → （本报告的文档 commit） |
| changed files | production：`miniprogram/pages/editor/editor.js`(+12)、`miniprogram/utils/api.js`(+8)、`cloudfunctions/trailApiLab/domain/activity.js`(+3, 生成器复制)；其余全部是 `tools/*-test.js` 与 `docs/testing/` |
| clean status | 每轮 mutation 后 `git checkout --` + `git status --porcelain` 复验为空 |
| residue | **0**（M5 漏斗门变异、M3 幂等收据变异各开一次窗口，均已还原并复跑绿） |

**基线修正**：Phase 8 分支上 `tools/lab-dryrun-test.js` 是红的（164/1）——`trailApi/domain/activity.js` 加了 handler owner 门却没跑 `sync-lab`。本轮补跑生成器 → 165/0。这是上一阶段留下的真实残留，不是本轮引入。

---

## B. BUG-C1

| 阶段 | 证据 |
|---|---|
| 复现（既有） | Phase 8 真云端：B 落库 4621→4622，A 用陈旧表单也 landed、无 CONFLICT，终态 4623 且 title 回退成 A 的陈旧值 |
| 根因 | `editor.js` 的 `this.revision` 只在写成功后回填（:583），`reload()` 丢掉 `res.revision` ⇒ 会话首条命令 `expectedRevision=undefined`；`index.js:122` 把非整数缺省成服务端当前值 ⇒ 内存层①与事务层②同时放弃 |
| 回归（先建，RED） | `tools/e2e-client-cas-test.js`：**passed=12 failed=19 exit=1**。日志 `docs/testing/phase9-evidence/bug-c1-regression-RED.txt`。红因如实：A 的保存 `ok:true`、revision 3→4、B 的 title 被覆盖、14 集合里 `ot_activities/ot_events/ot_notices/ot_receipts` 全被写、用户零提示 |
| 修复 | ① `reload()` 把"装配表单那次读"的 revision 成对抓取；② 新建态以 home 读为 CAS 基线，仅在未成对时写入；③ `persistCurrent()` 编辑态用成对 revision、新建态用紧邻的 profile 读（编辑态绝不用写前现读）；④ `utils/api.js dispatch()` 漏斗门：非整数 `expectedRevision` 本地 reject（`NO_REVISION`），一次网络调用都不发 |
| 回归（GREEN） | 同一套件：**passed=35 failed=0 bugs=2 drift=0 exit=0**（bugs 是 BUG-C2/BUG-C3 常驻红测）。日志 `bug-c1-regression-GREEN.txt` |
| 变异自证 | M5 拆掉漏斗门 ⇒ 恰好 C4-①②③④ 四条行为断言红（`m5-funnel-guard-MUTANT.txt`），C1/C2/C3/C5 全不受影响 ⇒ 红因就是那道门 |
| REAL CLOUD | `activity-muns9s5oyqeo98` 双编辑器实例：**A.this.revision=4624→4624(number)**（此前 undefined）、A 收到 `CONFLICT「安排已更新，本次修改没有保存…」`、B 的 title 存活、revision 4624→4625 **只 +1**、收尾 title 已恢复。全表 `bug-c1-realcloud-GREEN.md` |
| 最终定级 | **P1 CONCURRENCY / DATA CONSISTENCY BUG（Client CAS bypass）→ FIXED**（STUB/CLIENT-LIFECYCLE 与 REAL CLOUD 两栏都成立）。分类未降级、未改成 TEST GAP / HARNESS LIMITATION |

**没有做的事（如实）**：任务书 §3 点名的 `index.js:122` 缺省支路本身没拆。拆它是结构性的（任何客户端漏传都拒绝），但要同步给 A 层 4 套 + B 层 3 套里所有"不传 revision"的调用点补 revision，而 B 层只能在开发者工具里验——属"借机大 refactor"，且触碰 production CAS 语义需单独授权。替代做法是客户端漏斗门（已发布页面走不到那条支路）+ `e2e-concurrency` S4 常驻红测继续钉着它。→ 见 §J 决策项 D1。

---

## C. Concurrency

| 维度 | 通道 | 结果 |
|---|---|---|
| 顺序 + 显式陈旧 revision | STUB-BARRIER | PASS（`e2e-concurrency` S2/S3/S4c；`e2e-interleave` C1~C6 每一步） |
| 同 revision 真同时（双写） | STUB-BARRIER（barrier ON） | PASS：恰好一 ok 一 CONFLICT、rev 只 +1、败者 14 集合逐字节零副作用（S1） |
| 多步骤业务交错 | STUB-BARRIER | **新增 `e2e-interleave-test.js` 67 断言**：C1 签到×出发×推进、C2 审核×取消×分车、C3 预览过期×上车×发车、C4 资料改×阶段推进、C5 取消×出发（两种到达顺序）、C6 陈旧表单×阶段推进。每条 14 列账本 |
| 两层 CAS 分工 | STUB | 外层 `commands.js:122`（内存层①）+ 事务层 `store.js:114`（层②）+ **第三层**：`assignment.commit` 的 `preview.baseRevision`（`transport.js:131`）——C3 证明外层新鲜仍会被内层拒 |
| REAL CLOUD 并发 | 真机 → 线上 trailApi | **恰好一胜 3/3、revision 只 +1、胜者状态保留 ⇒ 真云端无 lost update**。但败者码是 `STORAGE_UNAVAILABLE` 而非 `CONFLICT` ⇒ BUG-C3（见 §I） |
| INCONCLUSIVE（不转 PASS） | — | ① 跨身份真同时（桩 openid 是模块级全局，`stub-wx-server-sdk.js:6`）② 交错下的读滞后（内存 Map 即刻可见）③ 真云端并发只测了"同一 owner 双编辑器"这一形状，未测跨容器锁粒度/超时 |

`e2e-concurrency` 读数不变：37/0，bugs=2（S4 ON/OFF，钉的是未拆的 `index.js` 支路），inconclusive=4。

---

## D. Workspace consistency（§14）

新增 `tools/e2e-panel-sync-test.js`：**40 断言 / 0 失败**（三次连跑一致）。真 workspace.js + 真三面板 + 真 api.js → 真 trailApi（内存桩 DB），面板 observer/reload/读写都是仓库代码。

| 场景 | 结果 |
|---|---|
| P1 初挂 | 宿主 `syncKey=published@R0`，三面板 `this.revision` 与 `_readKey` 全部成对 |
| P2 写完广播 | roster 导出落库 → `written` → 宿主 reload → 新 syncKey → 三面板全部跟到 R1 |
| P3 同面板连点 | 两条命令必然同一个 expectedRevision；第二条 CONFLICT、rev 只 +1、有重试 toast ⇒ Phase 8 的 R2 结论从文档转为常驻断言 |
| P4 宿主 reload 失败被 `api.js:121` 的 `catch(()=>{})` 吞掉 | syncKey 不更新、面板持旧 revision ⇒ 下一次写 **CONFLICT（fail closed）**、车辆没建出来、rev 未推进、提示仍弹；带新基线重试成功 ⇒ **结论：只多一次冲突往返，不造成 lost update**。定级 P3（建议改成可见重试/埋点，本轮未改） |
| P5 重开工作台 | syncKey 与三面板全跟到最新，`_readKey` 与 syncKey 相等 |
| P6 编辑器与工作台并存 | 各自成对抓取、各自 CAS；编辑器陈旧那一枪被拒，工作台写入存活 |

附带发现：**全局单 revision** ⇒ 别的活动的写入会造成伪冲突（P3），与 `loadState` 每请求读 15 集合是同一处规模墙。

---

## E. Read-after-write（§8）

N=12（真云端、单写者、同一 `[预演]` 行），窗口 30 s：

| 通道 | n | missed | p50 | p90 | max | min |
|---|---|---|---|---|---|---|
| ① meta 主键读（信封 `data.revision`） | 12 | **0** | 1879 ms | 2070 ms | 2293 ms | 1805 ms |
| ② 业务集合分页读（`view.activity.title`） | 12 | **0** | 1879 ms | 2070 ms | 2293 ms | 1805 ms |

写侧 RTT 2404–3952 ms。两条通道的"首次可见"在 12/12 个样本里落在**同一次读**——`actionRead` 一次 `loadState` 同时取 meta 与 15 个集合，返回同一份快照，从客户端可观测面不可分割。

**结论（consistency model finding，方向是推翻旧假设而不是确认它）**：
本轮**没有复现**「20 s+ 云读滞后」。既有文档（`e2e-ui-state-test.js` 头部、若干 SYNC 条目）以 20 s 为前提，需要重新定性。
不据此宣布"滞后不存在"：n=12、单活动、未覆盖"写 A 集合后扫读 B 集合"的形状；UI-State run 3 那次 `pickupIds` 回显 null 在本量测下**未获解释**，归类仍是 FLAKY。

---

## F. Release coverage matrix

产物：`docs/testing/release-coverage-matrix.md`（READ-ONLY inventory，先盘点后补测）。
生成手法：对 39 个命令类型与 20 个声明错误码逐个在 `tools/*-test.js` + `smoke-test.js` 做字面命中统计，再人工核对"命中≠被断言"。

- **命令 × 通道**：权限矩阵 19/39、负矩阵 16/39、A 层主链 16/39、**真云端并集 16/39** ⇒ 线上从未被自动化走过的命令 23 条。
- **错误码**：`GROUP_SCOPE`、`CONSENT_REQUIRED` 有真实产生点却零断言（本轮已补，见 §本节末）；`OFFLINE`、`CORRUPT_SNAPSHOT` **除 contracts.js 外全库无产生点** ⇒ 声明未接线。
- **单套件独占**：`assignment.remove`、`assignment.swap`、`group.setTogether`、`vehicle.remove`、`notice.read`。
- **页面**：`app.json` 实测 **17 页**（AGENTS.md 的 16 已过时）；`anotices`（组织者通知面）与 `privacy` 零专属套件。
- **补测（Phase 9.8）**：新增 `tools/e2e-release-gap-test.js` **51 断言 / 0 失败**，把 P1 清单里的 G1~G6 全部落成 A 层真实信封断言（每条含码精确匹配 + 14 集合逐字节零副作用 + 反向对照）。
  同时修掉两处自己造的假绿风险：① `attendance.home` 必须在 closing 之后（否则"归档被拒"混进别的原因）；② G2 的容量反证必须先腾位（`GROUP_SCOPE` 检查在 `CAPACITY` 之前）。
- **A 层 ≠ UI 的界线在表里逐列写明**，未把 A 层 PASS 折算成 UI 或真云端 PASS。

---

## G. Test totals（本轮结束时全量复跑）

**无头门禁 43 套件：passed=2724，failed=0，nonzero_exit=0**；`check.js` ALL PASSED；`check-handlers.js` exit 0。

| 套件 | 断言 | 备注 |
|---|---|---|
| check / check-handlers | — | 静态门，全绿 |
| smoke | **173** | Phase 8 的 173 保持 |
| e2e-fault-probe | 34 | 结果模型变异自证 |
| A 层 e2e | 71 | |
| permission | 96 | |
| domain-negative | 83 | |
| concurrency（Phase 8） | 37 | bugs=2 常驻红测、inconclusive=4 |
| **client-cas（新）** | 35 | bugs=2（BUG-C2/BUG-C3）、RED 时 12/19 |
| **interleave（新，§13）** | 67 | inconclusive=3 |
| **panel-sync（新，§14）** | 40 | |
| **release-gap（新，§10）** | 51 | |
| weather 线 13 套 | 780 | 未触碰（任务书 §13 禁改 Weather Module） |
| scenario-* 11 套 | 1020 | |
| trailapilab / lab-dryrun | 25 / **165** | lab-dryrun 由 164/1 修到 165/0 |

真机层（需开发者工具，不计入门禁）：
- Phase 5 UI-State：run3 `73/1/2`（一条 UI 红）、run4 **`74/0/2`**、OVERALL **INCONCLUSIVE**（exit 2）。run3 的那条红未复现 ⇒ 归类 FLAKY，两轮原始账都留档。
- Golden Path sanity：**`187/0/7`**，BUSINESS=PASS / UI=INCONCLUSIVE / OVERALL=INCONCLUSIVE（exit 2）。7 条未验证全部写明是通道限制（原生 picker、单登录身份、overlay 内部模板不可查询），没有一条转成 PASS。

---

## H. Mutation

| 变异 | 对象 | 结果 |
|---|---|---|
| M5（新） | 拆 `utils/api.js` 漏斗门 | `e2e-client-cas` C4-①②③④ 四条行为断言红（30/4），其余全绿 ⇒ 归因干净。已还原 |
| M3（Phase 8 复核） | 拆 `commands.js` 幂等收据查表 | 红通道与 Phase 8 一致：concurrency S5、negative 2、A 层 1、smoke 1；**红因仍是 `invariants.js` 的收据唯一性**（`INVALID_INPUT「请求记录重复。」`）⇒ 幂等仍是两层，未退化为静默双写。新增事实：interleave / client-cas / release-gap 对 M3 **全盲**（它们不测重放），不谎称"全套都能抓" |
| M1 / M2 / M4 | 未重跑 | 目标代码（`commands.js:122` 层①、`store.js:114` 层②、`activity.js:140/160-169` boundary）本轮**零改动**（`git diff` 可验），Phase 8 的 4/4 结论仍成立 |
| residue | **0** | 两次变异窗口均 `git checkout --` 还原 + 复跑绿 + `git status` 为空 |

---

## I. New findings

### P0
无。

### P1
1. **BUG-C1** — Client CAS bypass / lost update。**已修复 + 双通道验证**（§B）。
2. **BUG-C3（新）** — 真云端并发败者被分类成 `STORAGE_UNAVAILABLE` 而不是 `CONFLICT`。
   可观测后果：`api.js` 只对 `CONFLICT` 置 `needRefresh` ⇒ 不重读、不刷新，而文案写的是"请保留输入后重试"——
   用户照做就必然再撞同一个陈旧 revision，**冲突自恢复链路在真云端这条路上失效**。数据完整性没坏（层②拦住了）。
   归因边界：`ConflictError` 穿过云 SDK 后 `instanceof` 失效，或 SDK 自身的事务冲突落进同一个 catch——
   区分要读云函数日志，本轮无该通道，只登记后果。已建常驻红测（`e2e-client-cas` C7），不修（需改 `store.js` 并重新部署）。

### P2
3. **BUG-C2** — CONFLICT 后 `reload()` 保留本机草稿并把 revision 刷成最新 ⇒ 用户"重试"即以新 R 提交陈旧草稿。
   CAS 层无错，缺的是冲突合并策略。常驻红测在 `e2e-client-cas` C5。属产品决策。
4. **`index.js:122` 缺省支路未拆**（§B 末）。
5. **真云端 0 覆盖的命令 23 条**；权限矩阵缺 20 条命令（含 `signup.edit`/`signup.promote`/`incident.*`/`assignment.swap`）。
6. **`OFFLINE` / `CORRUPT_SNAPSHOT` 声明但无产生点**——契约面与实现面漂移。
7. **测试基建**：`e2e-ui-state-test.js` / `e2e-golden-path-test.js` 的 `cli` 自举在 Git-Bash 驱动的 `execFileSync` 下报
   `spawnSync ... EINVAL`（.bat 无 shell），且套件硬编码 9420 ⇒ 外部未预绑定时整轮空跑。
   语义上它正确地给了 INCONCLUSIVE/exit 2（没有假 PASS），但白烧一轮，值得修自举方式。
8. `app.json` 17 页 vs AGENTS.md 写 16 页；`anotices` / `privacy` 零专属套件。

### P3
9. `api.js:121` 的 `.catch(()=>{})` 吞掉 reload 失败（后果已判明：fail closed，多一次往返）。
10. 全局单 revision ⇒ 伪冲突；与 `loadState` 全表读同属一处规模墙。
11. `activity.transition` 置 `acceptingSignups=false` 且该键在 gathering 的 lockedKeys 内 ⇒ 陈旧整份表单只改说明也被拒，文案指向"仅可修改说明"，误导（`e2e-interleave` C6 已钉行为）。
12. Phase 8 分支曾带 `lab-dryrun` 一条红残留（已修）。

---

## J. Final recommendation：**CONDITIONAL**

主链（建活动→发布→报名→审核→分车→签到→发车→节点→到家→收尾→归档）与并发/一致性
**已具备正式 Release Gate 的形状**：43 套无头门禁 2724 断言全绿、CAS 三层分工有正反例与逐字节零副作用、
BUG-C1 修复经 stub + 真云端双栏验证、真云端并发无双胜。

进入 RELEASE 需要下列四个条件先落一个决定，其中 **D1/D2 必须业主拍板**（本轮按任务书未擅自扩大范围）：

| 编号 | 决策项 | 本轮做法 | 需要谁定 |
|---|---|---|---|
| **D1** | 拆不拆 `index.js:122` 的"缺 revision 即采信当前值"支路 | 客户端漏斗门让已发布页面走不到它；支路本身未拆，S4 常驻红测继续钉 | 业主（触碰 production CAS 语义 + 要改 7 套测试的调用点） |
| **D2** | BUG-C3：真云端并发冲突的分类（`store.js` 重映射 or `api.js` 把 STORAGE_UNAVAILABLE 也当可刷新） | 只登记 + 常驻红测，未改（改 `store.js` 需重新部署 trailApi，属共享环境动作） | 业主 + 部署授权 |
| **D3** | BUG-C2：CONFLICT 后草稿优先的冲突合并策略（字段合并 / 二次确认 / 保留 draft 但拒绝静默覆盖） | 只登记 + 常驻红测 | 产品决策 |
| **D4** | 真云端 0 覆盖的 23 条命令补进 B 层的节奏（每加一节点 ≈ 多付 1 个 4–6 s 写 RTT） | matrix 已按 P1/P2 排好优先级 | 排期决定 |

不阻塞 RELEASE 但应排入 Phase 10：`OFFLINE`/`CORRUPT_SNAPSHOT` 接线或删除、`anotices`/`privacy` 页面级套件、
B 层 `cli` 自举方式、AGENTS.md 页数与门禁清单同步（本轮已同步一次）。

---

## 附：本轮产物清单

```
tools/e2e-client-cas-test.js        新（BUG-C1 回归 + 漏斗门 + BUG-C2/BUG-C3 常驻红测）
tools/e2e-interleave-test.js        新（§13 多步骤并发交错 C1~C6）
tools/e2e-panel-sync-test.js        新（§14 工作台/面板 revision 同步 P1~P6）
tools/e2e-release-gap-test.js       新（§10 高价值缺口 G1~G6）
docs/testing/release-coverage-matrix.md                新（39 命令 × 20 码 × 21 模块 × 17 页）
docs/testing/phase9-evidence/                           新（RED/GREEN/M5/M3/UI×2/GP/真云端两栏）
miniprogram/pages/editor/editor.js                      修复（+12 行）
miniprogram/utils/api.js                                修复（+8 行，漏斗门）
cloudfunctions/trailApiLab/domain/activity.js           生成器同步（+3 行）
```
