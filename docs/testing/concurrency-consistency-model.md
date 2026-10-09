# Concurrency / Consistency Model — Phase 8 只读审计

- 基线：`master 65b66cb`（Phase 5/6/7 已并入）
- worktree：`D:/OurTrail-conc`，分支 `win/concurrency-consistency`
- 日期：2026-10-07
- 方法：源码只读 + 三组定向变异探针（M-A/M-B/M-C）。除 Phase 8.0 的 `activity.edit` handler 门外**未修改任何 production**，探针残留已核对为 0。
- 本文是任务书 §4 要求的产物，只做「模型是什么」，不含 Phase 8 测试实现。

---

## 1. 一条写命令的完整链路（行号为本次实测读到的）

```
index.js:116   const before = await store.loadState(db)          ← 每次请求全量加载 15 集合
index.js:122   expectedRevision = Number.isInteger(payload.expectedRevision)
                 ? payload.expectedRevision : before.revision    ← ★ 缺省即采信服务端当前值
commands.js:107-113  S.Command / specInstant / fingerprint 严格校验 → INVALID_INPUT
commands.js:114-115  canExecute(...) → 拒绝即返回（先于幂等、先于 CAS）
commands.js:116-121  receipts.find(actorId+requestId)
                     同指纹 → {ok:true, replayed:true}；异指纹 → REQUEST_REUSED
commands.js:122      state.revision !== command.expectedRevision → CONFLICT   ← 层① 内存 CAS
commands.js:123-125  candidate = deepClone(state) → handle(candidate) → !ok 直接 return
commands.js:126-130  recordChange → candidate.revision += 1 → receipts.push
index.js:132       persistState(db, before, after, before.revision, now)
store.js:111-125   db.runTransaction：事务内重读 ot_meta/main
                     meta.revision !== expectedRevision → throw ConflictError      ← 层② 事务 CAS
                     通过才写 diff、才把 meta.revision 置为 expectedRevision+1
store.js:127-131   非 ConflictError 的一切异常 → STORAGE_UNAVAILABLE
```

## 2. revision 何时生成、何时校验，两层 CAS 的语义差

- **生成**：`commands.js:127`（候选 +1）与 `store.js:123-125`（事务里把 `meta.revision` 写成 `expectedRevision+1`）。全局单调整数，无分支、无每实体版本。
- **校验①（内存层，`commands.js:122`）**：比较的是**本请求 `loadState` 时刻**的 revision 与客户端声称的 revision。它只能发现「在我加载之前就已落库」的写入。
- **校验②（事务层，`store.js:114`）**：比较的是**事务内重读**的 `meta.revision`。这是唯一能发现「在我加载之后、落库之前」写入的位置。
- 推论（重要）：两个真正同时的请求都读到 R、都过校验①，**胜负完全由校验②决定**。所以「CAS 有效」这件事不能靠跑过校验①的用例来宣称。
- **缺省即绕过**：客户端不传 `expectedRevision` 时，`index.js:122` 用 `before.revision` 顶上 ⇒ 校验①恒真，且校验②的期望值也变成刚读到的值 ⇒ **该次写完全没有乐观并发保护（last write wins）**。这不是理论风险，见 §7 R1。

## 3. mutation 是否 atomic / loser 是否留下副作用

- handler 只操作 `deepClone` 出来的候选（`commands.js:123`），返回 `!ok` 时候选被整体丢弃（`:125`），真 `state` 未被触碰。
- 落库只发生在事务内；事务里任何一步失败即整体不提交（`store.js:111-131`），`ConflictError` 与 `STORAGE_UNAVAILABLE` 是两条独立出口。
- **实测**：M-C（双层权限全拆）下 6 条「被拒后状态不变」断言里，只有 edit 本身的内容变了，其余 rows/审计/收据无一漂移；`recordChange` 只在 `result.ok` 之后执行。
- 判定：**domain 层与 store 层都是全有或全无**，未发现部分副作用路径。唯一能造成「半状态」的是事务外的 `ensureMeta`/`ensureCollections` 冷启动写入（`store.js:62-66`），与本阶段无关。

## 4. 客户端 revision 生命周期与同步链（证据均来自 miniprogram/）

| 事实 | 证据 |
|---|---|
| requestId 每次新生成，全仓无复用路径 | `utils/api.js:95-99`（`dispatch` 第三参从不被调用方传入；`dispatchAndSync` 只传两参 `:112`） |
| CONFLICT 处理：标 needRefresh → toast → `page.reload()` → **仍 throw** | `utils/api.js:101`、`:119-121`、`:123`；reload 的 reject 被 `.catch(() => {})` 吞掉（`:121`） |
| 无自动重发、无队列、无请求防抖 | 全仓未找到；只有 `busy` 闸门与面板 `_loading` |
| 一次成功写触发**两次**全量读 | 面板自身 `.then` reload（`components/roster-panel/roster-panel.js:213/216`）＋ 宿主 `written` → `pages/workspace/workspace.js:123` → `reload()` → `:70` |
| sync-key = `phase@revision`，面板只在 key 与自己 `_readKey` 不同时重读 | `workspace.js:104`、`roster-panel.js:26/73`、`transport-panel.js:51`、`field-panel.js:48` |
| tab 切换零云端读；`onShow` 每次 reload | `workspace.js:115-119`（只 setData tab）、`:61-63` |
| 阶段推进：按钮可用位与 revision 来自**同一次** onShow 读，确认弹层到 dispatch 之间不重读 | `workspace.js:105`、`:75`、`:133-143`、`:146-161`（成功后 `:155` 赋 revision、`:160` fire-and-forget reload） |
| 写命令按钮的 `busy` 门是 WXML 绑定态而非 handler 同步早退；17 处 `bindtap` 里 8 处表达式不含 `busy` | `roster-panel.wxml:61-66`（批量四钮有门）、`:155`（无门）、`roster-panel.js:210`（handler 内才置 busy）；详见 §7「R2 细目」 |
| `this.revision` 只从读结果或写回执刷新 | `workspace.js:75/155`、`activity.js:446`、面板 `roster:89`、`transport:70`、`field:67` |

**⚠ 编辑器是唯一不回填 revision 的写入路径**：`pages/editor/editor.js` 里 `this.revision` **只出现在 `:583`**（写成功之后），`reload()`（`:134-172`）从不赋值，也没有任何 `api.read` 给它。于是每个编辑器会话的**第一条命令** `expectedRevision === undefined`（`:580`）→ 命中 `index.js:122` 缺省分支 → 该次写无 CAS。之后的命令才有 CAS（因为 `:583` 已回填）。`activity.copy :654`、`activity.delete :773`、`publish :819/:824` 同理受首次写入影响。

## 5. 读路径有两种一致性等级（read-after-write 滞后 的机制假设）

- meta：`store.js:62` `db.collection('ot_meta').doc('main').get()` —— **主键读**。
- 业务记录：`store.js:41-45` `coll.orderBy('_id','asc').limit(PAGE).skip(n).get()` —— **分页查询**（走索引层）。

**HYPOTHESIS（未在真云端证实）**：真云开发 DB 里主键读与分页查询的可见性推进速度可能不同，于是出现 **`revision` 已是新值、业务行仍是旧内容** 的错配。这能同时解释两条既有观测：Phase 5/6 记的「云读对刚写入的行有 20s+ 滞后」，以及「workspace 重开后立即推进阶段静默无效果」——客户端拿着新 revision 发命令撞上 CONFLICT，`api.js:119-121` 只 toast 一次并重读，而重读又拿到旧行，用户看到的就是「点了没反应」。
桩库（`tools/stub-wx-server-sdk.js:48-63`）是同一张内存 Map，**天然不存在这个滞后**，因此本阶段所有 read-after-write 结论在桩里只能记 **INCONCLUSIVE**，不得由「最终一致」推断为 PASS。

## 6. 测试桩的事务模型 = 无隔离（任务书 §8 的判定）

`tools/stub-wx-server-sdk.js:48-63` 的 `runTransaction` 只是 `return fn(transaction)`；事务内的 `get/set/remove` 各自是独立的 async 闭包，直接读写同一张 `Map`，**没有锁、没有串行化、没有快照隔离**。

- 结论：Phase 7 留下的「同 tick 两写均 OK」= **B. 测试桩事务交叠 artifact**，不是生产 CAS bug（生产靠 `store.js:114` 的事务内重读判定）。
- 代价更该说清楚：**现有桩根本不能证伪双写**——两个 `Promise.all` 请求都过校验①，也都能过校验②（各自 await 同一张 Map，谁先完成写谁先赢，另一个仍能把 meta 设成同一个 `R+1`）。所以 §6/§8/§9/§10 的四类结论在当前基座上**天然不可判**，需要一次受控的基座改造（见 §9 D1），且改完仍只能算「更严格的桩」，不能冒充真云端（§17：`REAL_CONCURRENCY = INCONCLUSIVE`）。

## 7. 已知一致性风险登记（分类，暂不修）

| # | 现象 | 根因位置 | 分类 |
|---|---|---|---|
| R1 | 编辑器首条命令无乐观并发保护（lost update 暴露面） | `editor.js:134-172`/`:580`/`:583` + `index.js:122` | **BUG-C1 —— 已于 2026-10-09 在服务器侧拆掉**：`index.js:128` 缺整数 `expectedRevision` 直接 `NO_REVISION`；常驻红测 `S4/S4b` 按 DRIFT 规程转正为正式断言（见文末附录，逐条取证与变异自证见 `docs/superpowers/specs/2026-10-09-reliability-production-hardening.md` §5-F-1）|
| R2 | 面板连点窗口的一致性后果**已判完**（不会 lost update），只剩文案误导 | 见下方「R2 细目」+ `stub:48-63` | 降为 **UI 文案误导（低危）**；真机只需回答「第二次点击是否可能发生」 |

**R2 细目（本次核对过，措辞比初版收窄）**：`roster-panel.wxml` 共 17 处 `bindtap`，其中 8 处的绑定表达式不含 `busy`（含 `:155 onRevokeMembership` 这类写命令）。批量四按钮经 Phase 5 已有 `canXxx && !busy ? 'onBatch' : ''` 门（`roster-panel.wxml:61-66`），但那是 **WXML 绑定态、依赖 `setData` 重渲染才生效**，而 `busy: true` 是在 handler 内部才置位的（`roster-panel.js:210`）——同帧两次点击是否真能发出两条命令，取决于渲染时序，桩里测不出来，需真机。

**但一致性后果已经判完，不再挂在 IDE 上**：同面板连点的两条命令必然携带**同一个 `expectedRevision`**（面板的 revision 只在 `:89` 的读之后更新）。两种时序都有确定归宿：
- 第二条**晚于**第一条落库 ⇒ 它的 `loadState` 拿到 R+1，层①（`commands.js:122`）当场 CONFLICT。
- 两条**真同时**（各自 loadState 都得 R）⇒ 层①双双放行，由层②（`store.js:114`）判一胜一 CONFLICT——S1 已在 barrier ON 下实测该形状。

所以连点窗口**不会造成 lost update**，M2 才证明了两层同拆才会双胜。剩下的危害是 UX：败者收到「安排已被他人更新，已刷新，请重试」，而「他人」其实就是他自己的第二次点击（`api.js:119-121`）。分类从「一致性风险」降为 **UI 文案误导（低危）**；真机那一问只剩「第二次点击是否可能发生」，不改变上面的归宿。

| R3 | 并发下的同 requestId：收据读自各自快照 ⇒ 双方都看不到对方 ⇒ 靠校验②兜底；失败者错误码是 CONFLICT 而非 replayed | `commands.js:116-121`、`store.js:114` | 待验证（§11/§12） |
| R4 | revision 新、记录旧的错配读 | `store.js:41-45` vs `:62` | **NEEDS_PRODUCT_DECISION**（是否允许该一致性模型） |
| R5 | CONFLICT 恢复路径把 reload 的失败吞掉，UI 可能停在旧态且不报错 | `api.js:121` `.catch(() => {})` | **UI STALE STATE BUG** 候选 |
| R6 | 层①/层② 文案不同（`commands.js:122` vs `store.js:114`），客户端只按 `code` 判 | 同上 | 观察，不修 |

## 8. Phase 8.0（activity.edit）变异三重实测

现状：`canExecute` 对 `activity.edit` 是 `allowIf(owner)`（`permissions.js:259`→`:273`），handler 层新加显式 owner 门（`activity.js`，Phase 8.0 遗留改动）。

| 探针 | 做法 | 读数 | 结论 |
|---|---|---|---|
| **M-A** | 只拆 handler 门 | permission **96/1**（唯一红＝静态源码门）、A 层 **71/0**；非 owner edit 信封仍 `FORBIDDEN`「没有访问此资源的权限。」、title 不变 | 两层同返回 `FORBIDDEN`（仅文案不同），**行为层测不到第二层** |
| **M-B** | 只拆 `canExecute` 门（handler 门保留） | 探针非 owner edit → `FORBIDDEN`「只有活动发起者可以修改活动内容。」、title 不变；permission **97/0** | handler 第二层**真实生效**；但套件对「哪一层拦的」不敏感 ⇒ 97/0 不是恒绿的证明，需 M-C 对照 |
| **M-C** | 两层同拆 | permission **90/7**（6 条行为红 + 静态门），越权编辑真实落库 | 套件不是恒绿；双层拆除才暴露 |

残留核对：还原后 `git diff` 只剩 Phase 8.0 的 `activity.js` +3 行；复跑 permission **96/0**、A 层 **71/0**、smoke **173/0**。
（这三行读数写作当时 permission 套件还带着静态源码门＝97/1；D2 拍板后该门已删除，第二层改由 smoke 的 6 条行为门看守，见 §10.1。）

## 9. 设计决策（已拍板）

- **D1 = A（已实施）**：桩加可控事务串行化 barrier，见 §10.1。
- **D2 = A（已实施）**：删除 permission 套件的 `fs.readFileSync` 字符串门；第二层改由 smoke 行为门常驻，见 §10.1。
- **D3**：BUG-C1 只定罪不修（任务书 §19），转 Phase 9 或单独批准。**（2026-10-09 状态更新：已在服务器侧拆掉，见文末附录；本节其余历史读数按原样保留，不改写取证记录。）**

## 10. 第一轮落地：barrier、并发套件、变异归因（2026-10-07）

### 10.1 基座与第二层门
- **barrier**（`tools/stub-wx-server-sdk.js`）：`runTransaction` 增加 `TEST-HARNESS DETERMINISTIC TRANSACTION BARRIER`。`state.txnBarrier` 为假走原路径（既有 39 个套件时序行为不变，实测 permission 96/0、A 层 71/0、domain-negative 83/0、trailapilab 25/0）；`__setTxnBarrier(true)` 后每个事务经实例级 Promise 队列串行，`read → CAS → write → commit`（`store.js:111-125`）整体落在锁内。**边界**：只建模「事务互相串行」，未建模真云端的锁粒度、超时与 MVCC 快照读，普通读（`loadState`）仍可能插进一个事务的两条 `set` 之间。
- **第二层行为门**（`cloudfunctions/trailApi/smoke-test.js` §17，6 条）：直调 `handleActivity` 用非 owner actor ⇒ `FORBIDDEN` + 文案出自 handler + 传入 state 深比较逐字节不变；owner 直调 ⇒ ok 且不误伤；`input:null` 的非 owner ⇒ 仍是 `FORBIDDEN` 而非 `INVALID_INPUT`（证明第二层在字段校验之前）。拆掉 handler 门这 6 条必红（M-A 复验见下）。

### 10.2 并发套件读数（`tools/e2e-concurrency-test.js`：25 断言 / 0 非预期失败 / 2 常驻红测 / 4 INCONCLUSIVE）
| 场景 | ordering | barrier | 实测 | 判定 |
|---|---|---|---|---|
| S0 同 revision 双写 | Promise.all | OFF | 两写均 ok，finalRevision 只 +1（不是 +2），A 的 title 被 B 覆盖 | **TEST HARNESS ARTIFACT**（Phase 7 遗留现象复现，非产品结论） |
| S1 同 revision 双写 | Promise.all | ON | 恰好一 ok 一 CONFLICT；rev=R+1；败者标记在落库对象中不存在 | PASS（STUB-BARRIER） |
| S2 显式陈旧 revision | sequential | ON | 新写成功、旧写 CONFLICT、胜者内容保留、只 +1 | PASS（STUB-BARRIER） |
| S3 两字段先后写 | sequential（B 沿用旧 R） | ON | B CONFLICT，A 的两个字段都存活 | PASS（STUB-BARRIER） |
| **S4 编辑器首条命令** | sequential（B 先提交） | ON 与 OFF 各跑一遍 | **两次都是：A、B 均 ok，finalRevision +2，B 的 description 被 A 的旧表单值抹掉** | **BUG-C1（CLIENT CAS BYPASS / lost update）** |
| S4c 对照 | 同上，A 显式带 R | ON | A 必须 CONFLICT、B 存活、只 +1 | PASS ⇒ BUG-C1 的唯一变量就是「不传 revision」 |
| S5 并发同 requestId 同内容 | Promise.all | ON | 一 ok 一 CONFLICT、只一次 mutation；失败者是 CONFLICT 而非 `replayed:true` | PASS（并发/顺序语义差异如实登记） |
| S6 | — | — | REAL_CONCURRENCY、云读滞后量级、UI 连点窗口 | 3 条 INCONCLUSIVE（原因逐条写明） |

红测常驻机制：`bugCheck` 的失败计入 `bugs` 不计 `failed`（套件仍 exit 0，可进门禁）；一旦它自己转绿，说明 production 被改过，按 **DRIFT** 记 `failed` 并 exit 1，提醒把它转成正式断言——**缺陷被修不允许静默变成一条从未存在过的绿灯**。

### 10.3 变异归因（谁是谁的唯一防线）
| 变异 | 并发套件 | 既有套件 | 结论 |
|---|---|---|---|
| **M1** 拆 `commands.js:122` 层①内存 CAS | **8 红**（S2×3、S3×2、S4c×3），S1 仍绿 | domain-negative **3 红**、A 层 **1 红** | 层① 专管「客户端显式带陈旧 revision」；真并发下它帮不上（S1 由层②守住） |
| **M2** 拆 `store.js:114` 层②事务 CAS | **6 红**（S1、S5 都变成两胜） | **全绿**：A 层 71/0、smoke 173/0、domain-negative 83/0、permission 96/0、scenario-editor 142/0 | **既有门禁对「持久层 CAS 被拆」完全不设防**——真并发唯一防线的回归此前无人看守。这正是 D1 第 8 条「barrier ON 仍双胜即判 BUG」之所以必须存在的原因 |
| M-A′ 拆 handler 门（D2 之后复验） | — | smoke §17 的 6 条行为门必红 | 第二层的自动信号已从「文本匹配」换成「行为断言」 |

附带发现：`smoke-test.js:33-38` 的 `dispatch()` helper 把 `expectedRevision` 恒置为 `state.revision`，所以 smoke **结构上不可能**命中任何 CAS 分支（M1/M2 都测不到）。不是缺陷，但意味着领域层并发保护只能由并发套件与 A 层看守。

M3（拆幂等收据）与 M4（放宽 phase 边界，需先建 §13 的状态链场景）尚未做，本轮不虚报「4/4」。


## 11. 真云端复现（开发者工具通道，2026-10-07 12:55–12:56）

通道：IDE 服务端口 33278、automator `ws://127.0.0.1:9421`、SDKVersion 3.8.12；**未重新部署 trailApi**，跑的是线上现版；只动 `[预演] 工作台E2E`（`activity-muns9s5oyqeo98`，phase=published）的 title 一个字段，跑完已恢复原值。

| 步 | 读数 |
|---|---|
| 基线 | title=`B2-real-muy3ynk0`，revision=**4621** |
| A 打开编辑器 | 表单装配自 4621 的权威态；`this.revision` 从未赋值（`editor.js:134-172` 不回填） |
| B（叠在同一活动上的第二个编辑器实例）改 title → 保存 | **landed=true**，耗时 6.7s |
| A（陈旧表单）→ 保存 | **landed=true、conflicted=false**、`message=活动修改已保存。`——**没有 CONFLICT** |
| 终态权威读 | title 回到 A 的陈旧值 ⇒ **B 的写入被吞**；revision **4621 → 4623（+2）**，两次写都落库 |
| §15 写后读 | B 后首读与 A 后首读均**立即命中新值**；单次 `reload()` 往返 ≈ **2.9s** |

**结论**：BUG-C1 不只是 stub 推演——真云端现版同样让「不传 `expectedRevision` 的首条命令」绕过 CAS，产生 last-write-wins，且双方都收到成功。§5 的云读滞后假设这两轮**既未证实也未否证**（n=2，写读间隔被 9s 页面装配与 2.9s RTT 支配，分辨率不足；模拟器链路 ≠ 线上小程序链路），继续记 INCONCLUSIVE。

**方法论教训**：v1 曾误报「已复现」——B 在 `gathering` 阶段改 title 被 `WRONG_PHASE` 拒（lockedKeys），根本没有可被吞的前序写入，而我拿「终态 title == A 的陈旧值」当判据，把「B 从未成功」读成了「B 被吞」。v2 起判据加前置门：**B 必须 landed 且 revision +1、终态必须 +2**，否则整轮记 INVALID。

## 12. M4：状态链 boundary 的行为变异（2026-10-07）

**boundary 位置修正**：`gathering→active` 的出发核实**不在 `invariants.js`**，在 `domain/activity.js:160-169`：逐人要求 `record.departure`（:165），`kind==='joined'` 还要求 `record.checkIn`，拼车（`trip.mode==='shared'` 且非参与者司机）还要 `boardingByLeg.outbound`（:168）。取集处是 `:140 const confirmed`。第二趟循环（:171-181）把仍在 `coordinating` 的人转成未解决的 `late` 异常。

**S7（`tools/e2e-concurrency-test.js`，11 条断言，全套 37/0）**：真实信封 `create → publish(本人 self 报名) → profile.save(第二人) → signup.submit → signup.review(confirm) → transition(gathering)`，payload 与次序严格复用 A 层 `tools/e2e-test.js:272-274`（`checkin → board → departure`）。本场两人都取 `trip.mode='self'`，因此 `board` 腿按 `permissions.js:52-53`（`needsOutboundBoarding` 只对 shared 生效）天然不适用；带座位安排的 `board` 腿仍由 A 层 `:277-282` 守，不在此重造夹具。
- baseline：未核实越级 ⇒ `UNRESOLVED_DEPARTURE`（不是 WRONG_PHASE/INVALID_INPUT），phase 仍 gathering、revision 不推进、rows 的 `status/checkedIn/departure/needsOutboundBoarding` 逐字节不变。
- 完成 `checkin+departure` 后 ⇒ `transition` ok、`phase=active`、**revision 恰好 +5**（2 签到 + 2 出发核实 + 1 推进）。

**两条自己抓出来的假绿**（都写进代码注释，防止回归成空断言）：① `revision` 挂在信封 `data` 上、不在 `view` 上，`v.revision` / 由 `view7` 派生的 `rev7` 全是 `undefined`，于是「拒绝不推进 revision」变成 `undefined===undefined` 自证；② 补上「合法链必须 +5」的反空断言后，这个缺陷当场暴露（第一次跑出 `undefined→undefined`）。

**变异第一次打偏（记录，别重犯）**：把 `} else if (activity.phase==='gathering' && p.next==='active') {` 改成 `false &&` ——撤掉的不是边上的核实，而是**这条边本身**，于是撞上下面的 `else return WRONG_PHASE('不允许跳过或回退活动阶段')`，phase 从未进入 active，测到的是阶段机而不是 boundary。该轮已作废并 `git checkout` 还原。
**第二次单点变异**（正确）：`:140 const confirmed = []`——保留边合法，只让逐人核实失去对象（副作用：`:171-181` 的 coordinating→late 转化同时被跳过，如实标注）。
**RED 实测（行为变化，不是字符串匹配）**：未核实的越级 transition **成功落库**，`phase: gathering → active`、`revision 18 → 19`，而两名 confirmed 参与者仍 `checkedIn=false` 且无任何出发核实记录 ⇒ 活动进入「已出发」而全员去向未核实，正是该 boundary 存在的目的；套件 `31/6`。
**RESTORE**：`git checkout -- domain/activity.js` 后 `37/0`，全套回归 smoke 173/0、fault 34/0、A 层 71/0、permission 96/0、domain-negative 83/0、check ALL PASSED、check-handlers exit 0；residue 仅 `tools/e2e-concurrency-test.js`。⇒ **M1/M2/M3/M4 = 4/4 有效，RESIDUE=0。**

---

## 附录 · 2026-10-09 服务器侧收口（本文上方的历史读数一律不改写）

**BUG-C1 的状态从「只定罪不修」变为「服务器侧已拆」**：`cloudfunctions/trailApi/index.js:128` 现在要求
`expectedRevision` 必须是整数，否则 `fail('NO_REVISION', …)`。旧写法 `Number.isInteger(x) ? x : before.revision`
一次废掉两道保护——本文 §3 的 `commands.js:122` 层①门变成永真，schema 的 `specCount` 又吃到合法假值，
于是「不传 revision 的首条命令」在**服务器**这一侧也失去 CAS（客户端 `utils/api.js` 的门管不到旧包）。

- **常驻红测转正**：`S4/S4b` 由 `bugCheck`（计入 `bugs`、套件仍 exit 0）改成正式断言 ——
  「A（不传 revision）被拒」「B 的写入未被吞」「revision 只 +1」，barrier ON/OFF 各一遍。
  按本文 §10.2 自己写的 DRIFT 规程走：缺陷被修不允许静默变成一条从未存在过的绿灯。
- **变异自证**：把 `index.js` 那一行改回旧写法 ⇒ `e2e-concurrency` 50→44 过／6 红（红条内容即
  「竟然成功了 + revision 前进」＝ lost update 复现），新套件 `e2e-revision-guard` 16→9 过／7 红；还原后回到 50/0 与 16/0。
- **§10.2 表头的「25 断言」是旧登记**：本轮实测该套件为 **50 项检查**（44 过 + 6 常驻红 → 转正后 50 全过），
  根 `AGENTS.md:190` 的登记数字已同步更正。
- **夹具收紧**：`e2e-test` / `e2e-permission` / `e2e-domain-negative` / `e2e-concurrency` / `e2e-client-cas` /
  `e2e-panel-sync` 六套原先有「省略 expectedRevision 让服务器补」的写法——那是在依赖这条洞。现全部改为
  先读后写（与真实客户端一致），6 套复跑 0 失败。
- **本轮同批新增 3 套回归**：`tools/e2e-revision-guard-test.js`（16）、`tools/meta-revision-guard-test.js`（18，
  全局版本号被读故障清零的另一条 P1）、`tools/cold-start-work-test.js`（10，每请求工作量上限）。
- **本轮门禁终读**：55 个无头 `tools` 套件 + smoke（共 56 份读数）= 3750 过／0 败，`bugs=1`（BUG-C2 常驻实锤，仍未授权改），
  `inconclusive=7`，`drift=0`。真云端并发（REAL_CONCURRENCY）依旧只能在部署后由真机定论，本文 §11 的三条
  INCONCLUSIVE 一条都没有转成 PASS。
  逐条取证：`docs/superpowers/specs/2026-10-09-reliability-production-hardening.md`。
