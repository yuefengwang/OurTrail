# OurTrail Phase 8 — Concurrency / Consistency 完整交付报告

日期：2026-10-07 · 机器：Windows（`D:/OurTrail-conc`，分支 `win/concurrency-consistency`）
基线：`master 65b66cb`（已推中继并同步 GitHub）→ 本轮 checkpoint **`1f278f6`**
任务书：Phase 8 §1–§25（附件两版内容一致）

> 读数一律以各脚本自己打印的 `passed=N` 为准。凡标 **STUB-BARRIER** 的结论都不得当作真云端并发证明。

---

## A. 当前基线

| 项 | 值 |
|---|---|
| 分支 / worktree | `win/concurrency-consistency` @ `D:/OurTrail-conc`（原停在 Phase 7 栈顶 `cc44504`，已 `--ff-only` 到 `65b66cb`，ahead/behind 0/0） |
| 遗留现场（前一个失败的 agent） | `domain/activity.js` +3（handler 层 owner 门）、`tools/e2e-permission-test.js` +8（`fs.readFileSync` 字符串静态门）。无 stash、无未跟踪残留 |
| Phase 7 读数在新基线上复现 | smoke 167/0、A 层 71/0、permission 96/0、domain-negative 83/0、fault-probe 34/0（smoke 160→167 是天气线并入所致，非本轮改动） |

## B. activity.edit 现状（Phase 8.0）

`canExecute` 对 `activity.edit` 走 `allowIf(owner)`（`permissions.js:259`→`:273`）；`activity.js` 新增 handler 层显式 owner 复核。两层**都返回 `FORBIDDEN`，只有文案不同**——这一点决定了后面所有验证形态。

变异（Phase 8.0 三重）：

| 探针 | 结果 |
|---|---|
| M-A 只拆 handler 门 | permission 96/1（唯一红＝静态字符串门）、A 层 71/0 全盲、非 owner edit 仍被 `canExecute` 拒 ⇒ **行为层测不到第二层** |
| M-B 只拆 `canExecute` 门 | 探针非 owner edit → `FORBIDDEN`「只有活动发起者可以修改活动内容。」、title 不变；permission 97/0 ⇒ 第二层**真实生效**，但套件对「哪层拦的」不敏感 |
| M-C 两层同拆 | permission 90/7（6 条行为红＋静态门），越权编辑真实落库 ⇒ 套件不是恒绿 |

D2 拍板后：删掉字符串门（含 `fs` require），第二层改由 `smoke-test.js` §17 的 **6 条行为门**看守（smoke 167→173）。拆 handler 门这 6 条必红。

## C. CAS / revision 架构

```
index.js:116   before = store.loadState(db)              ← 每请求全量加载 15 集合
index.js:122   expectedRevision = Number.isInteger(payload.expectedRevision)
                 ? payload.expectedRevision : before.revision      ← ★缺省即采信服务端当前值
commands.js:107-113  S.Command / specInstant / fingerprint 严校验
commands.js:114-115  canExecute（先于幂等、先于 CAS）
commands.js:116-121  收据查表：同指纹 replayed:true / 异指纹 REQUEST_REUSED
commands.js:122      层① state.revision !== command.expectedRevision → CONFLICT
commands.js:123-125  candidate = deepClone(state) → handle(candidate) → !ok 直接 return
commands.js:126-130  recordChange / revision+1 / receipts.push
index.js:132       persistState(db, before, after, before.revision)
store.js:111-125   层② 事务内重读 ot_meta/main → 不等则 ConflictError → 才写 diff → meta.revision+1
```

- **层① 比的是「本请求 loadState 时刻」**，只防得住客户端**显式带陈旧值**；**层② 是「我加载之后、落库之前」写入的唯一发现点**。两个真并发请求都读到 R、都过层①，胜负完全由层②决定。
- **`index.js:122` 的缺省分支让两层同时失效** ⇒ 不传 `expectedRevision` 的写完全没有乐观并发保护。

## D. 事务边界与 loser 副作用

handler 只改 clone（`commands.js:123-125`），失败即整体丢弃；落库只在事务内（`store.js:111-131`，`ConflictError` 与 `STORAGE_UNAVAILABLE` 两条独立出口）。实测：M-C 下越权那条只改了自己的字段，rows/收据/审计零漂移。⇒ **domain 与 store 都是全有或全无，未发现部分副作用路径**。

## E. 已知风险登记（最终分类）

| # | 内容 | 分类（最终） |
|---|---|---|
| **BUG-C1** | 编辑器首条命令不传 `expectedRevision` ⇒ CAS 被绕过、他人写入被吞、双方均收到成功 | **CONCURRENCY / DATA CONSISTENCY BUG（Client CAS bypass）**。不是 TEST GAP / HARNESS LIMITATION / NEEDS_PRODUCT_DECISION |
| R2 | 面板连点窗口（17 处 `bindtap` 有 8 处表达式不含 `busy`） | 一致性后果**已判完**：两条命令必带同一 revision，先后走层①、同时走层② ⇒ 不造成 lost update；降为 **UI 文案误导（低危）** |
| R4 | 读路径两种一致性等级：meta 主键读（`store.js:62`）vs 15 集合分页查询（`store.js:43`） | **NEEDS_PRODUCT_DECISION**，HYPOTHESIS 状态（见 §15） |
| R5 | CONFLICT 恢复路径把 reload 的失败 `.catch(()=>{})` 吞掉（`api.js:121`） | UI STALE STATE BUG 候选 |
| R6 | 层①/层② 的 CONFLICT 文案逐字相同 ⇒ 信封层无法区分来源层 | 观察，记 INCONCLUSIVE |

新发现：**幂等也有两层**——`commands.js:116-121` 收据查表（管 replay 语义）＋ `invariants.js:15` 收据唯一性（管重复收据）。

## F. Phase 8 测试设计与落地

### F1 D1 barrier（`tools/stub-wx-server-sdk.js`）
`__setTxnBarrier(true/false)`，**默认 OFF**——既有 39 套件读数逐字节不变（复跑 permission 96/0、A 层 71/0、domain-negative 83/0、trailapilab 25/0）。ON 时 `read→CAS→write→commit` 落在实例级 Promise 锁内。注释钉死 `TEST-HARNESS DETERMINISTIC TRANSACTION BARRIER ≠ REAL CLOUD CONCURRENCY PROOF`，并写明未建模部分（锁粒度/超时/MVCC；普通读仍可插进事务的两条 `set` 之间）。**全程未用 sleep 造并发**。

### F2 并发矩阵（`tools/e2e-concurrency-test.js`，最终 **37/0**，bugs=2 常驻红测，4 INCONCLUSIVE，drift=0）
每条场景记 14 列账本（actor / 初始 revision / ordering / opA / opB / 期望 winner-loser-error / finalRevision / finalState / read-back / 副作用 / 判定 / 基座归属）。

| 场景 | barrier | 实测 | 判定 |
|---|---|---|---|
| S0 同 revision 双写 | OFF | 两写均 ok、revision 只 +1、A 的 title 被吞 | **TEST HARNESS ARTIFACT** |
| S1 同 revision 双写 | ON | 一 ok 一 CONFLICT、rev=R+1、败者标记不存在 | PASS（STUB-BARRIER） |
| S2 显式陈旧 revision | ON | 新写成功、旧写 CONFLICT、只 +1 | PASS（STUB-BARRIER） |
| S3 两字段先后写 | ON | B CONFLICT、A 两字段存活 | PASS（STUB-BARRIER） |
| **S4 编辑器首条命令** | ON/OFF 各一遍 | A、B 均 ok、rev **+2**、B 的 description 被 A 旧表单抹掉 | **BUG-C1** |
| S4c 对照（A 显式带 R） | ON | A CONFLICT、B 存活、只 +1 | PASS ⇒ 唯一变量是 undefined |
| S5 并发同 requestId | ON | 一次 mutation；失败者是 CONFLICT 非 `replayed:true` | PASS |
| S7 状态链 boundary | ON | 越级 ⇒ `UNRESOLVED_DEPARTURE` 且三态零变化；核实完 ⇒ active、rev **+5** | PASS |
| S6 | — | REAL_CONCURRENCY / 云读滞后量级 / UI 连点时序 / CONFLICT 来源层 | 4 条 INCONCLUSIVE |

红测机制：`bugCheck` 的失败计入 `bugs` 不计 `failed`（套件 exit 0 可进门禁）；一旦自己转绿按 **DRIFT** 记 failed 并 exit 1——缺陷被修不许静默变成一条从未存在过的绿灯。

### F3 变异 4/4（全部行为断言，无字符串匹配）
| 变异 | RED | RESTORE |
|---|---|---|
| **M1** 拆层① `commands.js:122` | 并发套件 8 红（S2×3、S3×2、S4c×3），S1 仍绿；domain-negative 3 红、A 层 1 红 | 25/0、83/0、71/0 |
| **M2** 拆层② `store.js:114` | 并发套件 6 红（S1、S5 双胜）；**既有 A 层 71/0、smoke 173/0、domain-neg 83/0、permission 96/0、scenario-editor 142/0 全绿** | 25/0 |
| **M3** 拆幂等收据 `commands.js:116-121` | 并发 24/1、domain-negative 81/2、A 层 70/1、smoke 172/1。红因是 `invariants.js:15`「请求记录重复」⇒ 语义从 replayed 降级为报错，**不是**二次执行 | 25/0、83/0、71/0、173/0 |
| **M4** 拆状态链 boundary（`activity.js:140 const confirmed = []`） | **31/6**：未核实越级**成功落库**，`phase gathering→active`、`revision 18→19`、两名 confirmed 仍 `checkedIn=false` 且无出发核实 ⇒ 非法终态真形成 | **37/0** |

M4 第一次打偏已作废并记录：改成 `false &&` 撤的是**这条边本身**，撞上 `WRONG_PHASE('不允许跳过或回退活动阶段')`，phase 从未进 active，测到的是阶段机不是 boundary。
附带发现：`smoke-test.js:33-38` 的 helper 把 `expectedRevision` 恒置为 `state.revision` ⇒ smoke **结构上不可能**命中任何 CAS 分支（M1/M2 都测不到）。

### F4 我自己抓出的两条假绿（都已写进代码注释防回归）
1. `revision` 挂在信封 `data` 上不在 `view` 上 ⇒ `v.revision` 与由 `view7` 派生的 `rev7` 恒 `undefined`，「拒绝不推进 revision」曾是 `undefined===undefined` 自证；补上「合法链必须 +5」反空断言后当场暴露。
2. 真云端 v1 误报「已复现」：B 在 `gathering` 改 title 被 `WRONG_PHASE` 拒（lockedKeys），根本没有可被吞的前序写入。v2 起判据加前置门（B 必须 landed 且 +1、终态必须 +2，否则整轮记 INVALID）。

## G. REAL CLOUD 证据（BUG-C1，2026-10-07 12:55–12:56）

通道：IDE 服务端口 33278、automator `ws://127.0.0.1:9421`、SDKVersion 3.8.12。**未重新部署 trailApi**，跑的是线上现版。只动 `[预演] 工作台E2E`（`activity-muns9s5oyqeo98`，published）的 `title` 一个字段，跑完已复原。

| 步 | 读数 |
|---|---|
| 基线 | revision **4621** |
| B（同活动的第二个编辑器实例）改 title 保存 | landed=true（6.7s） |
| A（陈旧表单，首条命令不传 revision）保存 | landed=true、**conflicted=false**、`message=活动修改已保存。` |
| 终态权威读 | title 回到 A 的陈旧值 ⇒ **B 的有效写入被 A 的 stale write 覆盖**；revision **4621 → 4623（+2）** |
| §15 写后读 | B 后首读、A 后首读均**立即命中新值**；单次 `reload()` 往返 ≈ **2.9s** |

⇒ **CONCURRENCY / DATA CONSISTENCY BUG，线上现版成立**。§5 的 20s 云读滞后假设这两轮既未证实也未否证（n=2，写读间隔被 9s 页面装配与 2.9s RTT 支配，分辨率不足；模拟器链路 ≠ 线上小程序链路）→ 继续 INCONCLUSIVE。

## H. 最终回归（恢复变异之后）

`check.js` ALL PASSED · `check-handlers` exit 0 · smoke **173/0** · fault-probe **34/0** · A 层 **71/0** · permission **96/0** · domain-negative **83/0** · concurrency **37/0（bugs=2, inconclusive=4, drift=0）**。
**SKIPPED（不当 PASS）**：Phase 5 `e2e-ui-state-test.js`（需 9420）、Golden Path sanity。
**不需要重新部署 trailApi**：本轮 production 无永久改动（`activity.js` 的改动只存在于已还原的变异窗口内）。

## I. 共享资源与卫生

`git status` 仅剩本轮三处：`M SYNC.md`、`M docs/testing/concurrency-consistency-model.md`、`M tools/e2e-concurrency-test.js`（+83/-1）。HEAD 仍 `1f278f6`。六个 worktree 扫描：除 conc 外全部 0 变更。9421 自动化端口维持现状（未 `close`/`quit`）；`Weather Module Redesign`、vite 8443、http 8123 未碰（`docs/weather-ux/meteogram-html-prototype/` 有 4 个文件 mtime 变化但 git 内容未变，属 8123 那个 agent）。automator 脚本全在仓库外 `%LOCALAPPDATA%\Temp\opencode\mp-auto`（`p8-cloud-probe.js` / `p8-ws-inspect.js` / `p8-editor-discover.js` / `p8-bugc1-real{,2,3}.js`），仓库零 npm 依赖未被破坏。

## J. Phase 8 剩余项与停止条件

已达：activity.edit 遗留解决、CAS 核心模型明确、deterministic race / stale write / lost update / duplicate concurrent submit、状态链 boundary（S7）、变异 4/4、Phase 5/6/7 无回归、真实 BUG 已形成最小红测、所有 INCONCLUSIVE 有明确原因。
**未达（明确未完成）**：§13 并发交错版状态链、§14 workspace stale revision（真机）、`REAL_CONCURRENCY` 真云端并发证明、read-after-write 滞后量级、BUG-C1 修复（留 Phase 9：`editor.js` 首屏回填 revision 或 `index.js:122` 缺省即拒，二选一，均未在本轮获批）。
⇒ **Phase 8 未达完整停止条件，按任务书 §25 不进 Phase 9。**
