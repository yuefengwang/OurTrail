# OurTrail · 工程可靠性、数据一致性与生产化深度加固（2026-10-09）

角色：资深架构师 / 可靠性工程师 / 测试负责人 / 代码审查专家（独立深挖轮）
范围：云函数 `trailApi` 与持久层的一致性、故障恢复、权限纵深、缓存投影、性能、回归体系、运维面
基线：分支 `win/trip-mode-decoupling`，HEAD `3c11cd1`（本轮所有读数都相对这个提交）
边界（先说清楚）：**本轮没有真实云端验证、没有生产环境验证、没有完整 UI E2E**。
执行环境是 `tools/stub-wx-server-sdk.js` 的内存桩（不发网络、不动云端数据），
DevTools 自动化端口 9420 不可用，因此 B 层真机链本轮 **零证据**。凡"只能在真云端定论"的项目一律记为未验。

与前两轮的分工：`2026-10-08-full-domain-lifecycle-audit.md` 做的是领域模型生命周期，
`2026-10-08-user-journey-ux-audit.md` 做的是用户旅程/UX。本轮不重复那两条轴，
只打「请求进来到落库」这条链的可靠性，并在引用前一轮结论时标注出处。

---

## 1. 执行摘要

**总体结论：YELLOW。**

不是 GREEN 的三条理由：① 生产侧的两处 hole 修好了，但**修复还没有部署到真云端**（部署是共享资源变更，
需人工执行；SYNC.md 2026-09-30 实测走 CLI 部署会把云函数超时从 20 秒降回默认 3 秒，
所以部署后必须复核超时这一项）；② B 层真机 E2E 本轮没跑
（环境前置不成立），所以"用户在真手机上不会撞上这些"这句话没有证据；③ 已确认的
`BUG-C2`（陈旧草稿在重试后静默覆盖他人修改，冲突**解决策略**层）与幂等双断点（`requestId` 每次新生成）
都还在，本轮按最小风险原则未动，理由见 §6。

不是 RED 的理由：本轮实测的两条静默数据破坏路径（盲写洞、版本号回卷）都已封住并有红→绿证据；
剩余项的后果都是 fail-closed（拒绝/误冲突/文案不准），不是丢数据。

本轮实际改动（生产代码只有 2 个文件，共 4 个缺陷修复）：

| # | 缺陷 | 严重度 | 状态 | 判据 |
|---|---|---|---|---|
| F-1 | `dispatch` 缺 `expectedRevision` 时服务器把它缺省成当前值 ⇒ 两道 CAS 保护同时失效 ⇒ 后写者静默覆盖前写者 | **P1** | 已修 | `e2e-revision-guard` 16 项 + 常驻红测 `S4/S4b` 转正 |
| F-2 | `ensureMeta` 把"读超时"当成"文档不存在"，无条件 `set({revision:0})` ⇒ 全局版本号回卷 ⇒ 全场误冲突 | **P1** | 已修 | `meta-revision-guard` 18 项 |
| F-3 | 每次云函数调用白付 16 次 `createCollection` 往返 | P2 | 已修 | `cold-start-work` 第 1–4 节 |
| F-4 | `loadState` 的 15 个集合读串行 `await` ⇒ 墙钟 = 15×RTT | P2 | 已修 | `cold-start-work` 第 5 节（RTT 建模读数） |

另有 5 项发现（F-5…F-9）本轮**只登记不修**，每项都给了"为什么不修"和可执行的下一步，见 §6。

**门禁终读（本轮最后一次全量，含新增套件）**：55 个无头 `tools` 套件 + `cloudfunctions/trailApi/smoke-test.js`（共 56 份读数），
`passed=3750 failed=0`；常驻实锤 `bugs=1`（BUG-C2，设计保留）；`inconclusive=7`
（concurrency 4 / interleave 3）；`drift=0`；静态门 `check.js` / `check-handlers.js` 通过；
`e2e-golden-path` = **OVERALL INCONCLUSIVE**（ENV：9420 无会话），未伪报通过。

---

## 2. 真实基线与测试环境

| 项 | 实测值 | 取证方式 |
|---|---|---|
| 分支 / HEAD | `win/trip-mode-decoupling` / `3c11cd1` | `git rev-parse` |
| Node | v24.18.0（win32） | 会话环境 |
| 依赖 | 仓库零 npm 依赖；无 jest/vitest；测试为手搓 `check()` + `process.exit(failed?1:0)` | AGENTS.md §Test style |
| 云端 | **未使用**。`wx-server-sdk` 被 `Module._resolveFilename` 指到内存桩 | `tools/stub-wx-server-sdk.js` |
| 桩的能力边界 | 单 Map 文档库、事务串行化 barrier、SDK 异常类型擦除、平台级事务中止（三种都是显式开关，默认 OFF） | 同上 :108-155 |
| 桩不能建模的 | 真云端锁粒度、MVCC 可见性、read-after-write 滞后、容器回收、外部 HTTP 延迟 | 结论一律标 STUB 或 INCONCLUSIVE |
| B 层（真模拟器） | 不可用：`cli.bat` `spawnSync … EINVAL`，端口 9420 三次梯度重连无会话 | `e2e-golden-path` GP-00 ENV 条 |
| HEAD 的门禁状态 | 无头套件本就全绿才可进门禁；`e2e-concurrency` 当时含 2 条按设计登记的常驻红测（`bugs=2`）| 取证方式分两层：登记出自 AGENTS.md:190；**44 过 / 6 常驻红**这一读数是本轮把 `index.js` 回植成旧写法时实测的（当时套件文件已含转正后的断言，故不等于 HEAD 套件的原读数）|

基线的诚实说明：AGENTS.md:190 原登记「`e2e-concurrency` 37 断言，bugs=2」，而本轮实跑这套件是
**50 项检查**（44 过 + 6 常驻红）。HEAD 时刻的套件文件读数本轮未单独取（开工时套件已在改），
所以"37 → 50"这一步只按文档漂移处理，不当实测结论；该登记已在本轮连带更正（见 §7 的文档项）。

---

## 3. 关键调用链（本轮所有结论都挂在这条链的具体行上）

```
小程序页面
  → utils/api.js dispatch(payload, expectedRevision, requestId)    ← 客户端漏斗门（BUG-C1 的另一半）
      （非整数 expectedRevision 时在客户端就被拒：err.code = NO_REVISION，不发请求）
  → wx.cloud.callFunction({name: trailApi, data:{action:'dispatch', payload, expectedRevision, requestId}})
index.js exports.main
  → store.ensureCollections(db)                                  ← F-3 落点（现已按 db 实例记忆化）
  → cloud.getWXContext().OPENID                                   ← 唯一可信身份来源
  → ROUTES[action] → actionDispatch(payload, openid)
      → store.loadState(db)                                       ← F-2（ensureMeta）与 F-4（并发读）落点
      → overrideEvidence(clean, now, actorId)                     ← at/by 由服务端覆写，客户端只能给 note
      → sha256(canonicalPayload(clean))                           ← 幂等指纹（在覆写之后算）
      → domain/commands.js reduceCommand(state, …)
          ① schema 校验（含 expectedRevision: specCount）
          ② canExecute(permissions)                               ← 角色×阶段×归属
          ③ receipts 命中 ⇒ 指纹一致=重放 / 不一致=REQUEST_REUSED
          ④ state.revision !== expectedRevision ⇒ CONFLICT        ← F-1 让这道门重新生效
          ⑤ handle*(candidate) 领域规则 → recordChange（事件+自动通知）→ assertInvariants
      → store.persistState(db, before, after, before.revision, now)
          事务内重读 ot_meta/main ⇒ CAS 哨兵（conflicted）
          diff 写/删 → meta.revision+1
          平台 -501001 TransactionConflict 窄映射 ⇒ CONFLICT（store.js:186）
  → { ok:true, data } / { ok:false, error:{code,message} }
  → api.js 解包：CONFLICT ⇒ e.needRefresh ⇒ 页面 toast + reload()
```

链上有两个"漏斗门"：客户端 `api.js:dispatch`（已在上一轮落地）与服务端 `index.js:actionDispatch`（本轮 F-1）。
之前只有前者，而**小程序包会滞后于云函数**——旧包照样能把 `expectedRevision=undefined` 打进来。

---

## 4. 风险矩阵（按严重度 × 可达性排序）

| # | 风险 | 严重度 | 可达性 | 影响性质 | 状态 |
|---|---|---|---|---|---|
| F-1 | 缺 revision 的命令被服务器补成当前值 | P1 | 任何未更新的线上包；每次写都可能 | **静默丢写**（后写覆盖前写，无错误码） | 已修 |
| F-2 | `ensureMeta` 读故障 ⇒ `revision:0` 盲写 | P1 | 每次请求都走这条读；云 DB 抖动即可触发 | 版本号回卷 ⇒ 全场 CONFLICT；读请求造成不可逆写 | 已修 |
| F-3 | 每请求 16 次 `createCollection` | P2 | 100% 请求 | 延迟与计费浪费；放大超时概率 | 已修 |
| F-4 | `loadState` 15 跳串行读 | P2 | 100% 请求 | 墙钟 = 15×RTT（历史 -504003 事故的成分之一） | 已修 |
| F-5 | `requestId` 每次新生成 ⇒ 幂等对"双击/超时重试"失效 | P2 | 命令已落库但响应丢失的窗口 | 重复记录（`vehicle.save`/`notice.publish`/`incident.report`/`activity.create`） | 未修（语义分叉，见 §6） |
| F-6 | `api.js:139,143` 吞掉 `reload()` 失败 | P3 | 宿主重读失败时 | 面板持旧基线 ⇒ 下一次写 CONFLICT（fail-closed，不丢数据） | 未修 |
| F-7 | 全局单计数器 ⇒ 跨活动伪冲突 | P3 | 并发用户变多时 | 误导文案 + 多一次往返 | 未修（结构性） |
| F-8 | `trailApiLab` 内联复刻 CAS 写协议，仍靠 `instanceof ConflictError` 跨事务边界 | P3 | 私有工具 | 冲突被误分类成 `STORAGE_UNAVAILABLE`（文案误导，数据无损） | 未修 |
| F-9 | 天气外部 API 无配额/节流；lab 与生产共用 `ot_*` 且白名单可自助扩张 | P3 | 任何已登录用户 / 白名单成员 | 第三方配额与出口流量可被打穿；预演数据污染生产 | 未修 |

---

## 5. 已修缺陷：复现、根因、证据

### F-1 · 服务端盲写洞（P1）

**复现**（HEAD 行为，本轮以变异回植实测）：客户端不传 `expectedRevision`（旧包 / 任何绕过 `api.js` 的调用者），
两个用户基于各自陈旧视图先后写同一活动 ⇒ **两次都返回 `ok:true`**，后写把前写的记录整片覆盖。
`e2e-concurrency` 的 `S4`（barrier ON 与 OFF 各一遍）实测读数即：A、B 均 ok、`finalRevision +2`、
B 的 `description` 被 A 的旧表单值抹掉；信封里没有任何错误码。

**根因**：`index.js` 旧行
`const expectedRevision = Number.isInteger(payload.expectedRevision) ? payload.expectedRevision : before.revision`
一次废掉两道保护——`commands.js:122` 的 `state.revision !== command.expectedRevision` 变成永真不触发，
schema 的 `expectedRevision: specCount` 也被喂了合法假值。这与 `api.js` 侧已经存在的
`NO_REVISION` 客户端门是同一缺陷的两半。

**修复**：`cloudfunctions/trailApi/index.js:122-131` —— 缺整数 revision 直接 `fail('NO_REVISION', …)`，
错误码与客户端同词汇（页面因此走"重开页面"，而不是"保留输入重试"）。

**证据（红→绿 + 变异自证）**：
- 新增 `tools/e2e-revision-guard-test.js`（144 行 / 16 项）：缺省、`null`、`''`、`'2'`、`1.5` 五类入参
  全部 ⇒ `NO_REVISION` 且 **零落库**（回读比对前值）；陈旧 revision 仍走 `CONFLICT`（门没修坏别的分支）；
  补齐 revision 后同一命令可成功落库。
- 变异检查：把 `index.js` 改回旧写法 ⇒ `e2e-revision-guard` **16 → 9 过 / 7 红**，
  `e2e-concurrency` **50 → 44 过 / 6 红**（`S4` 三条 × barrier ON/OFF），
  红条内容直接写着"竟然成功了 + revision 前进"。还原后两套件回到 16/0 与 50/0。
- 常驻红测转正（按 bugCheck/DRIFT 规程）：`S4/S4b` 原本以 `bugs=2` 挂在门禁里，
  现改为真断言 ⇒ `e2e-concurrency` `passed=50 failed=0 bugs=0 drift=0`。
- 6 个套件的夹具从"省略 revision"改成"先读后写"（`e2e-test` / permission / domain-negative /
  concurrency / client-cas / panel-sync）。这是**收紧**而非放宽：夹具现在必须像真实客户端一样先读。
  修复后门全绿：71/0、96/0、86/0、50/0、54/0、40/0。

### F-2 · 全局版本号被读故障清零（P1）

**复现**（修复前实测）：向 `ot_meta/main` 的一次 `get()` 注入一个**非"不存在"类**的读故障样例
（套件里用的是字符串样例 `document.get:fail -502004 read timeout`，不是从云端取回的真实签名——
判据只关心"它不是 not-exists"，另有一条完全无关的 `network down…` 样例做同结论对照），
请求 **仍然返回 ok:true**，且：
`ot_meta/main` 被 `set` 一次、值为 **0**；库里版本号从 1 变 0；
随后一次用版本号 1 的合法写收到 `CONFLICT`（"全场误冲突"就是这么产生的）。

**根因**：`ensureMeta` 的 `.catch(() => null)` 把「文档不存在（要建）」与
「这一刻读不出来（不能据此写）」混成同一条路径，然后无条件 `set({revision:0})`。
`loadState` 每个请求都会走这里。

**修复**：`cloudfunctions/trailApi/store.js:76-106` —— 三分支：
① 读不出结果且错误签名是"not exists" ⇒ 按首次部署建档；
② 其它错误 ⇒ 用一次不抛错的集合扫描（`orderBy + limit + skip + get`）复核存在性，
   确认文档确实不在才建档，否则 `fail STORAGE_UNAVAILABLE`（**失败关闭**）；
③ 文档在但 `revision` 不是数字 ⇒ `CORRUPT_SNAPSHOT`，不再盲目改写别人的记录。

**影响定界（不夸大）**：这不是静默丢写——`persistState` 在事务内重读 meta 才判 CAS
（`store.js:150-163`），回卷后并发写仍被拦住。代价是可用性中断 + 版本单调性丢失，
且一条读路径获得了对 durable 状态的破坏能力。

**证据**：新增 `tools/meta-revision-guard-test.js`（133 行 / 18 项）。
修复前 8 过 10 红（红条含"版本号仍是 1"失败、以及"带旧版本号写 ⇒ CONFLICT"）；
修复后 18/0，其中反向门专测"真缺档仍要自愈建档"（防把首次部署打死）与"故障过去后 CAS 链路照旧"。

### F-3 · 每请求 16 次建集合（P2）

**根因**：`exports.main` 每次调用都 `ensureCollections(db)`，无条件对 14 业务集合 + `ot_meta` + `weather_cache`
各发一次 `createCollection`。集合在首次部署后恒存在 ⇒ 全是白付的往返。
**修复**：`store.js:54-74` 按 **db 实例**记忆化（不是布尔量：测试会在同进程换桩库，布尔量会让新库跳过建集合）、
存 promise（容器冷启动的并发首调共享同一次建集合）、失败清空可重试。
**证据**：`tools/cold-start-work-test.js`（132 行 / 10 项）—— 首次调用 16 次、第二次 0 次、写路径 0 次。

### F-4 · 状态装载串行 15 跳（P2）

**根因**：`loadState` 用 `for … await loadCollection()`，把每次网络往返首尾相接。
**修复**：`store.js:114-115` 15 个读（meta + 14 集合）并发发出 ⇒ 墙钟 15×RTT → 1×RTT。
**一致性说清楚**：这个快照本来就不是原子读（改造前后都可能被并发写切开），
防脏写靠写路径 revision CAS，不靠读取顺序 ⇒ 并发化不新增危害。
**证据（RTT 建模，标 STUB-MODEL）**：给桩每个分页 `get()` 注入 8ms 往返后实测——
串行：峰值并发 **1**、墙钟 **≈228ms**（14 次分页读）；并发：峰值 **14**、墙钟 **17ms**。
**这不是真云端延迟**，真机 ms 只能部署后从云函数日志取（§8 待办）。
`cloudfunctions/trailApiLab/store.js` 已由 `node tools/sync-lab.js` 同步（14 文件，与生产逐字节一致，已 diff 验证）。

---

## 6. 本轮不修的项与理由（含我曾动过的念头）

- **F-5 幂等双断点（requestId）**：上一轮已登记为 R1（「重试键不稳定…属于产品/交互决策」）。
  本轮我确实试过在服务端派生稳定操作身份，实测把 4 个套件打红，因为**语义发生分叉**：
  同一 `payload` 的两次合法操作会被判成重放。已核对的具体一例是 `position.report`
  （`domain/field.js:153-159` 是 filter+push 的覆盖语义，"同一坐标再上报一次"本身就是一条新事实）
  ——判成重放后 `reportedAt` 不再推进，位置新鲜度被冻住，这在安全语义上比重复记录更糟。
  这不是实现细节，是"什么算同一个用户意图"的产品定义，需要客户端约定 + 页面改造。
  我完整回退了该实验（`miniprogram/utils/api.js`、`miniprogram/utils/AGENTS.md` 用 `git checkout --` 还原，
  临时套件文件删除），**没有留半成品**。工作区现在不含这部分改动，可用 §7 的 diff 核对。
- **F-6 吞掉的 reload**：`panel-sync` 套件已给出定界——后果被 CAS 兜住（下一次写 CONFLICT），
  代价是多一次往返。改法是把 `.catch(()=>{})` 换成可见提示/埋点，属客户端体验改动，本轮不动。
- **F-7 全局单计数器**：改成"按活动分桶"是数据模型与 CAS 协议的架构级变更，任务书明确
  不许为完成任务大规模重写架构。本轮只提供读数支撑，不改设计。
- **F-8 lab 内联 CAS**（`cloudfunctions/trailApiLab/index.js:131-151`）：与生产侧 `store.persistState`
  是**同一个写协议的两份实现**，lab 那份仍是 `throw new store.ConflictError()` + `instanceof` 跨边界判定，
  也就是上一轮 BUG-C3 在生产侧已经拆掉的依赖；并且缺 `-501001 / ResourceUnavailable.TransactionConflict`
  窄映射。后果限私有工具且预演按 requestId 幂等（重试安全），所以记 P3 未修。
  另注：lab 写的是 `revision: working.revision`（整阶段推进 N），与 `persistState` 的 `+1` 语义**故意不同**，
  所以不能简单改成复用 `persistState`——这条也是我没顺手"重构合并"的原因。
- **F-9 天气出口无节流**：`getWeather`/`getWeatherByPoint` 免 OPENID（`lib/weather.js:277-281`，v1 起的既有设计），
  缓存 key 是 2dp 网格 + 30 分钟（同文件 :285），因此枚举不同网格即可稳定绕过缓存打 Open-Meteo。
  已核到的缓解项：`fetchJson` 有 10 秒外呼超时（:48，不会吊满 20 秒函数超时）。
  本轮**未实现节流**：合理的上限必须按真实页面扇出量定（天气页一次要查多少个点×多少天），
  拍一个数字下去有把有效功能改坏的风险。给出下一步：统计一次页面加载的 `fetchForecast` 次数，
  再按"每 openid 每分钟 N 次缓存 miss"设门，并把 N 写在 config 里可调。
- 另：`config.json` 声明 `security.msgSecCheck` 而代码调 `phonenumber.getPhoneNumber` 这条不一致，
  AGENTS.md:425 与 cloudfunctions/trailApi/AGENTS.md:73 已各自登记，本轮不重复报。

---

## 7. 文件与代码变更（本轮全部改动）

生产代码（2 文件 + 1 镜像；数字为 `git diff --numstat` 的新增／删除行）：
```
M cloudfunctions/trailApi/index.js         10 / 1   （F-1）
M cloudfunctions/trailApi/store.js         54 / 12  （F-2 + F-3 + F-4）
M cloudfunctions/trailApiLab/store.js      54 / 12  （sync-lab 镜像，与生产逐字节一致）
```
测试（新增 3 文件共 409 行；修改 6 套件的夹具）：
```
?? tools/e2e-revision-guard-test.js        144 行 / 16 项
?? tools/meta-revision-guard-test.js       133 行 / 18 项
?? tools/cold-start-work-test.js           132 行 / 10 项
M tools/e2e-test.js                17 / 3   （夹具先读后写 + 容错 dispatch 助手）
M tools/e2e-concurrency-test.js    21 / 13  （S4/S4b 常驻红测转正 + 夹具）
M tools/e2e-client-cas-test.js      6 / 2   （C0 夹具 + S4 文案更正）
M tools/e2e-domain-negative-test.js  7 / 1  （actor 工厂先读 revision）
M tools/e2e-permission-test.js      14 / 1  （同上，保留 ANON 的 AUTH_REQUIRED 路径）
M tools/e2e-panel-sync-test.js       5 / 1  （P0 夹具先读后写）
```
（合计读数与复跑门禁见本节末尾，当场取。）
文档登记（本轮连带更正的失实/漂移项，全部按实测数字改）：
```
M AGENTS.md                                套件清单（64 脚本 / 57 个 *-test.js / 54 无头 / smoke 173）、
                                           新增 3 套进入清单与全量命令、e2e-concurrency 读数更正
M cloudfunctions/trailApi/AGENTS.md        行数实测校正（index 250→288、store 137→200、
                                           weather 217→337、smoke 404/106→756/173）、
                                           dispatch 漏斗加"必须有整数 revision"这一步、
                                           store 两条新不变量、OPENID 豁免面更正为两个天气 action
M SYNC.md                                  §六 追加 2026-10-09 条目（含部署待办）
M docs/testing/concurrency-consistency-model.md  文末附录：BUG-C1 状态改「服务器侧已拆」、
                                           S4/S4b 转正记录、§10.2 表头旧登记更正、夹具收紧清单
?? docs/superpowers/specs/2026-10-09-reliability-production-hardening.md   ← 本文
```
未提交、未 push：工作区改动全部留给人审。`git diff --stat` 的合计读数见下一段（当场取）。

**变更合计（当场实测）**：`git status --porcelain` = **13 个 M + 4 个 ??**（共 17 条：3 个新套件 + 本文）；
`git diff --stat` = **13 files changed, 257 insertions(+), 65 deletions(-)**（3 个新套件共 409 行不在
diff-stat 内，因为它们是未跟踪文件；生产代码净增：`index.js` +10、`store.js` +57、lab 镜像 +57）。
文档与夹具改完后在同一天复跑的门禁（同一棵树）：`check.js` ALL CHECKS PASSED、
`check-handlers.js` 全组件契约相符、`smoke-test.js` 173/0、`e2e-concurrency` 50/0、`e2e-test` 71/0、
三套新套件 10/0 + 16/0 + 18/0。

---

## 8. 测试结果（全部为当场实跑，非引用）

无头门禁终读（同一棵树、含 3 个新套件）：

```
55 个无头 tools 套件 + cloudfunctions/trailApi/smoke-test.js = 56 份读数
passed=3750  failed=0
bugs=1（e2e-client-cas：BUG-C2，设计保留的常驻实锤）
inconclusive=7（e2e-concurrency 4 / e2e-interleave 3）
drift=0
静态门：check.js = ALL CHECKS PASSED；check-handlers.js = 全组件 handler/dataset 契约相符
e2e-golden-path（B 层）：OVERALL INCONCLUSIVE —— ENV 前置不成立（9420 无会话），未计入通过
```

本轮改动的逐套件读数（**只列本轮当场实跑过的数字**；未取 HEAD 读数的行如实标注）：

| 套件 | 本轮实测 |
|---|---|
| e2e-concurrency | 变异（`index.js` 回旧写法）时 **44 过 / 6 红** ⇒ 还原后 **50 / 0 / bugs=0 / drift=0**（那 6 条常驻红已转成真断言） |
| e2e-revision-guard | 新增，**16 / 0**；变异回旧写法 ⇒ **9 / 7** |
| meta-revision-guard | 新增，**18 / 0**；变异回旧 `ensureMeta` ⇒ **8 / 10** |
| cold-start-work | 新增，**10 / 0**；同一探针在串行实现下为 **8 / 2**（峰值并发=1、墙钟 228ms） |
| e2e-test | 夹具改「先读后写」后 **71 / 0**（HEAD 读数本轮未单独取） |
| e2e-permission | 同上 **96 / 0**（HEAD 读数未取） |
| e2e-domain-negative | 同上 **86 / 0**（HEAD 读数未取） |
| e2e-client-cas | **54 / 0 / bugs=1**（BUG-C2 原样保留，未动） |
| e2e-panel-sync | **40 / 0 / bugs=0** |
| trailapilab / lab-dryrun | **25 / 165**（store 并发化 + 镜像同步后无回归） |
| smoke | **173 / 0** |

三次全量扫描（同一清单，不同代码状态，均为本轮实跑）：
① 修复后、夹具未完 → **4 套红**（逐条确认都是"依赖盲写洞的夹具"，不是新缺陷）；
② 夹具完 + F-4 之后 → 55 套件 **3728 项 / 0 红**；
③ F-2 之后（终读）→ 56 套件 **3750 项 / 0 红**；
④ 全部文档与行尾归一（3 个新套件转 CRLF）之后**再复跑一次** → 同一清单同样 **3750 / 0**，
   `bugs=1`、`inconclusive=7`、`drift=0`，无套件异常退出（读数与 ③ 逐项一致，故 §8 的表未再重印）。

---

## 9. 未覆盖的风险（这轮证不了的事，别当成已修）

1. **真云端并发 CAS**：全部并发结论都是 STUB-BARRIER 层。桩是同一张内存 Map，写后立即可见，
   天然复现不了 read-after-write 滞后（历史实测 20s+）与真锁粒度。
2. **F-1/F-2 在生产是否真的生效**：需要人工重新上传部署 `trailApi` 与 `trailApiLab`
   （云端安装依赖；CLI 部署会把超时降回 3 秒，必须复核 20 秒），部署后用两个真机账号并发写一次。
3. **UI 层零证据**：9420 不可用 ⇒ B 层（golden path / ui-state）本轮 0 跑。
   "客户端不会发出缺 revision 的命令"这句只在 `api.js` 源码层成立，不在真机行为层。
4. **BUG-C2**：陈旧草稿在重试后覆盖他人修改，属冲突**解决策略**（草稿优先、无字段合并、无二次确认），
   需要产品决策（合并/提醒/二次确认）才能改，本轮按授权边界未动。
5. **F-5 双提交**：幂等只在"同一意图同一 requestId"前提下生效，双击/超时重试仍是第二条命令。
6. **容器被杀/事务中途失败**：只依赖平台事务原子性，未做进程级故障注入。
7. **时钟**：`nowIso()` 用 UTC+8 手工偏移；跨日窗口与平台时间偏差未测。
8. **观测面**：云函数没有结构化埋点/告警，F-2 这类"读故障被吞"在线上不可见——
   这也是它能长期存在的原因之一。建议下一步：把 `STORAGE_UNAVAILABLE`/`CONFLICT`/`NO_REVISION`
   三类计数打进日志或独立集合，形成 24 小时趋势（属运维工具，本轮未建）。

---

## 10. 部署与验收待办（交回人工的三步）

1. 重新上传部署 `cloudfunctions/trailApi` 与 `cloudfunctions/trailApiLab`（云端安装依赖），
   在控制台复核超时 = 20 秒。
2. 部署后跑一次真云端双人并发写（A 提交陈旧 revision）：期望 **CONFLICT + needRefresh + 重读后成功**，
   且日志里不出现 `NO_REVISION`（说明线上包都已带上客户端门）。
3. 真机 B 层（开发者工具 + 9420）跑 `tools/e2e-golden-path-test.js` 一次，
   补上本轮缺失的 UI 层证据；在此之前，任何"UI 已验证"的说法都不成立。

---
---

# 第二轮（同日续跑）：幂等窗口的淘汰依据、失败归类与可观测性

> 上面 §1–§10 是同一任务书的第一轮交付（未提交状态下被我接手）。第二轮从 §3 的调用链重新独立取证，
> 只做上面**没有**覆盖的事；§11–§17 为本轮新增。两轮合并后才是本轮任务的完整结论。

## 11. 接手时的基线核对（先证上一轮说到做到）

不做假设，逐条实测：

| 上一轮的声称 | 我的验证方式 | 结果 |
|---|---|---|
| `index.js` NO_REVISION 漏斗门 | 读 `git diff` + 跑 `e2e-revision-guard-test` | ✅ 真实存在，16 断言过 |
| `store.js` ensureMeta 失败关闭 | 跑 `meta-revision-guard-test` | ✅ 18 断言过 |
| loadState 并发读 / ensureCollections 记忆化 | 跑 `cold-start-work-test` | ✅ 10 断言过 |
| 「56 份读数 / 3750 断言」 | 我自己全量复跑 | ⚠️ 实测 **55 套件 / 3749 断言**（差 1 套件、1 断言，口径是把 smoke 与 54 个无头套件相加）——不影响结论，但报告里的数字以当场复跑为准 |
| 全量门禁 0 失败 | 复跑 | ✅ 仅 `outdoor-intelligence-ui` 那条既有的天气线非确定性用例偶发红，其余全绿 |

工作区还留着上一轮的**未提交**变更；我全部保留，没有覆盖，只在其之上继续改。

## 12. 本轮新发现的缺陷（含复现与根因）

### R-1【P1，已修】幂等窗口的淘汰依据是数组位置，而重读之后的位置是文档键字典序

**现象**：回执（receipts）是全系统唯一的幂等记忆。`pruneReceipts` 用 `slice(length-600)` 保留"末尾 600 条"，
在单个进程内完全正确——`state.receipts` 是 push 序，也就是时间序。**但它忽略了落库再读回之后顺序会变**：
`store.loadCollection` 按 `orderBy('_id','asc')` 读回，而 receipt 的文档键是
`actorId + '__' + requestId`（`store.js:27`）。openid 是随机串，与写入时间毫无关系。

**复现**（`tools/receipt-window-test.js`，夹具全部走真实命令 + 真实 store 往返）：
600 条由 openid 字典序靠后的人写（时间最旧），再由字典序靠前的人写一条 `activity.create`（时间最新）→
落库重读 → 数组顺序实测变成 `L…H…`，那条最新探针回执被排到**数组头部** → 再写一条越过上限 →
实测淘汰的是 `req-A-probe-activity-create`，而真正最旧的是 `req-3`。紧接着把那条建活动命令原样重发
（响应丢包 / 超时重试就是这条路）：实测 `replayed:false`、**活动数 1 → 2**，第二场活动真的落库。

**为什么前三轮审计都没发现**：domain 层纯测试（smoke / lifecycle-*）全程在同一进程里连写，
数组永远是时间序，`slice(-600)` 看起来完全正确；只有**穿过 store 往返**才会暴露顺序漂移。
A 层并发套件测的是同一秒的争抢，也不跨重读。这条判据必须落库再读，别的层天然测不到。

**修复**：`commands.js` 新增 `pruneRecent(list, limit, keyOf, atOf)`——按 `appliedAt` 留最近 N 条，
时间并列按文档键定序（同一批数据反复截断必须得到同一个集合，否则每次写入换掉一批记忆）。
`receipts / events / notices` 三处上限统一走它。生产代码只动了一个函数，没有引入新集合、新字段或新基础设施。

**为什么不改 `invariants.js`**：这是"新数据别再长成那样"的判据，不是"历史数据不可能违反"的约束
（根 AGENTS.md 铁律 20）。所以修在写入端 + 用 `tools/receipt-window-test.js` 看守，不进整库不变量。

### R-2【P1，已修】写超时被当成普通失败：话术诱导重试，而重试就是第二条命令

**现象**：`api.js` 把 `-504003` 超时与断网统统归到 `code:'NETWORK'`，`dispatchAndSync` 只在
`CONFLICT` 时重读页面。超时与"服务端明确拒绝"是两种语义：前者**结果未知**（事务可能已经提交，
只是响应没回到这台手机）。旧行为下用户看到的是一句"网络异常/请重新部署"，于是再点一次——
而同一条意图的 requestId 每次都是新生成的（`api.js:107`），服务端按 requestId 判重放，救不了它。
这与 §6 的 F-5 是同一根因的**另一半**：F-5 说"稳定操作身份需要产品定义"，那条我没动；
但"结果未知不许伪装成没保存、且必须重读对齐"是纯可靠性问题，可以先修。

**修复**（`miniprogram/utils/api.js`）：
- `dispatch`：传输层失败标 `e.outcomeUnknown = true`（业务拒绝不标，两者话术不同）。
- `dispatchAndSync`：`needRefresh`（CONFLICT）与 `outcomeUnknown` 都触发**一次** `page.reload()`，
  话术分别是「已被他人更新，已刷新」与「结果未确认，已重读最新安排」。
- **绝不自动重发**：那等于把一次不确定变成两次写。恢复动作只有重读——服务端状态是权威。

### R-3【P2，已修】未捕获异常伪装成 INVALID_INPUT、原文直发用户，且全后端零日志

**取证**：把 23 组畸形入参真实打进 `exports.main`，3 组把英文内部错误原文当业务错误返回：
- `read` 缺 `request` → `INVALID_INPUT` + `Cannot read properties of null (reading 'kind')`
- `dispatch` `membership.save` 带 `membership:null` → `INVALID_INPUT` + `…reading 'id'…`
  根因精确到行：`profile.js:65` `ensureMembershipId` 在校验之前就读 `payload.membership.id`
- `getPhoneNumber` → 把 SDK 的 TypeError 拼进用户话术

同时全后端（`index.js`/`store.js`/`lib/weather.js`/`domain/*`）**零个 `console` 调用**——
上一轮 BUG-C3 之所以要靠"临时部署一个诊断包"才定案，缺的就是这一层。

**修复**：
- `main` 出口归类：只有带 `ERROR_CODES` 内已知码的失败才原样回给客户端；其余归 `INTERNAL`，
  话术按读/写分岔（写："本次修改没有生效"；读："没能把这一页取回来"——对读请求谎报"修改没生效"
  是凭空承诺了一件没发生的事），原文只进日志。**注意这是"改归类"，不是"catch 掉忽略"**：错误照旧回给客户端。
- `ensureMembershipId` 改成对任意入参都成立的归一化（缺字段交回 schema 校验说话）。
- `actionRead` 入口判 `request` 形状：形状错就该是 `INVALID_INPUT`，不该让 selector 抛 TypeError 再被归成 INTERNAL。
- 一次请求一行结构化日志：`ev/a/c/rid/u/ok/code/ms/rp/rev/det`。`u` 是 openid 的 sha256 前 8 位，
  **不落 openid 原文、不落 payload 内容**（姓名/电话/健康备注/坐标一律不进日志，套件里用植入标记串逐条验证）。
- `ERROR_CODES` 补录 `NO_REVISION`（上一轮的漏斗门已在发这个码，但契约表里没有，
  于是 `journey-test` 那条"每个错误码都有人话"的门**恰好跳过了它**）与 `INTERNAL`/`NETWORK`。

## 13. 故障注入与恢复表（本轮实测）

| 注入点 | 期望 | 实测（修复后） | 证据 |
|---|---|---|---|
| 校验前、第一写之前（`membership:null`） | 拒绝且零落库 | `INVALID_INPUT` 中文话术，无英文原文 | failure-semantics B3 |
| 读集合时抛 TypeError（模拟 SDK/网络半故障） | 不谎报、不返空成功 | `INTERNAL` + 读话术；原文进日志 | B2 |
| 写命令执行后传输失败（响应丢包） | 不自动重发，重读对齐 | 一次调用 + 一次 `page.reload()`，错误照旧抛 | A3 |
| 幂等记忆越过上限后被错删 | 淘汰按时间，不按键序 | 淘汰的即最旧一条；重放得 `replayed:true`、活动数仍为 1（人为删掉记忆则 1→2，即旧写法的后果） | receipt-window §1/§2 |
| 重读本身又失败 | 不把失败换成另一句成功话术 | 原错误照旧抛出 | A3 末例 |
| 调用方没有 `reload()` | 不崩 | 照旧 reject | A3 末例 |

仍未注入的故障（诚实边界）：事务中途失败（`runTransaction` 原子性由平台保证，桩里注入不了真半写）、
真云端的 `-501001` 平台中止比例、以及"超时后到底落库没有"的真实分布——桩里造不出那个分布。

## 14. 安全与权限（本轮实际攻击面）

| 攻击路径 | 结果 |
|---|---|
| 不带 openid 打 `dispatch` | `AUTH_REQUIRED`；只有两个天气 action 免鉴权（既有设计） |
| 省略/伪造 `expectedRevision` | 服务端 `NO_REVISION` 失败关闭（§5 上一轮已修，本轮复跑确认） |
| `read request:null`、`signupIds` 传字符串、`participants:null` 等畸形入参 | 全部拒绝，**无一崩、无一返回成功**；修复前其中 3 例返回英文原文（R-3） |
| 幂等记忆被绕过（同 requestId 换内容） | `REQUEST_REUSED` 拒绝且零副作用（receipt-window §2 反向对照） |
| `trailApiLab` 越权 | 三选一放行：配置白名单 / 动态白名单 / `LAB_SECRET`。实测 `LAB_SECRET` 为空 ⇒ `secretOk` 恒 false，**fail-closed 成立**；客户端 `config.js` 不含任何密钥，密钥只在云函数包里 ✅ 不是漏洞 |
| 日志泄密 | 新日志字段白名单化，姓名/电话/健康备注用植入标记逐条断言不出现；openid 只以 sha256 前 8 位出现 |

## 15. 性能（只报实测数）

- 新淘汰规则的成本（601 条回执、20000 次，进程内基准）：**0.0003 ms/次**；
  同规模一次完整 `reduceCommand`（含全量 deepClone）实测 **0.69 ms/次** ⇒ 相对成本 0.04%，不是可感知的开销。
- 上一轮的 `loadState` 并发化实测读数（RTT=8ms 的 **STUB-MODEL**，非真云端延迟）：串行 228ms → 并发 17ms。
- 未测：真云函数冷启动端到端 p50/p95、真云端 `_id` 排序延迟。桩里测不到，别引用任何百分比。

## 16. 本轮新增/修改的测试与门禁

新增两套（都进无头门禁）：
- `tools/receipt-window-test.js` — 19 断言 + 2 INCONCLUSIVE：真实 store 往返下的幂等窗口淘汰依据。
  夹具全部走真实命令（600 条铺满窗口 + 一条累加型探针命令），判据检查**落库后的最终数据**：
  「被淘汰的必须就是全局最旧那条」「探针记忆必须活下来」「重发同一条命令只得 1 场活动」，
  并含两条反向对照——把探针记忆人为删掉（= 旧写法的淘汰结果）必须真的多出第二场活动；
  同 requestId 换内容必须 `REQUEST_REUSED` 且逐字节零副作用。
- `tools/failure-semantics-test.js` — 37 断言 + 2 INCONCLUSIVE：客户端写失败两种语义的分离（不自动重发、
  必重读、缺 revision 零调用）+ 服务端错误归类（INTERNAL / INVALID_INPUT / 已知码不被吞，读写话术分开）+
  日志的字段、单行性、关联请求号与无 PII（姓名/电话/健康备注用植入标记逐条断言不出现）。

变异自证（每次都回植后还原复验，`grep` 复核过无残留）：把 `pruneReceipts` 改回按位置砍尾 ⇒ receipt-window
**5** 项转红，红条直写 `evicted:["req-A-probe-activity-create"] / oldest:"req-3"`，且重放读数 `acts:2`
（第二场活动，不是理论风险）；把 `main` 归类器改成 `known=true` ⇒ failure-semantics **5** 项转红，
红条里就是当年那句英文原文；把客户端 `outcomeUnknown` 标记删掉 ⇒ 同样 5 项转红（重读没发生、话术退回「网络异常」）。

终读：`check.js` ALL PASSED；`check-handlers.js` exit 0；**57 套件 / 3805 断言 / 全部 exit 0**
（`client-cas` 的 `bugs=1` 是常驻实锤 BUG-C2，`inconclusive=7` 为平台通道限制，均不计失败；
`outdoor-intelligence-ui` 那条既有的天气线非确定性用例本轮复跑为绿，但它仍可能偶发红，见根 AGENTS.md 归档）。
`cloudfunctions/trailApi/domain/*` 与 `index.js` 改动后已重跑 `node tools/sync-lab.js`，`lab-dryrun` 165✓。

## 17. 本轮的边界与后续建议

1. **F-5 仍在**（requestId 每次新生成）。R-2 只关掉"结果未知还被鼓励重试"这半边；要彻底闭环，
   需要先定义"什么算同一个用户意图"，那是产品决策，不在授权范围内。
2. **桩层结论 ≠ 真云端**：R-1 的机制依赖 `_id` 排序，桩库 `sort by _id` 与生产 `orderBy('_id','asc')`
   同一条语句，但真实云端的分页/排序语义仍应在部署后用一次"造 601 条回执"的实测收口。
3. **`diffCollections` 的 JSON 顺序敏感**本轮只分析未修（`vehicle.save` 会重排键）：
   后果是同一份内容被当"有变化"多写一次，不丢数据。真要治，应在 contracts 里加一个 canonical 写入形态。
4. **日志还没有去处**：现在是一次请求一行 stdout，云开发控制台可查，但没有配额/保留期/告警。
   下一步是把 `code=INTERNAL` 计数接进云函数的告警（属运维配置，不属代码）。
5. 部署待办不变：`trailApi` 与 `trailApiLab` 都要重新上传部署并复核 20 秒超时；
   部署后先 `cli cloud functions download` + diff 证线上=本地，再跑双人并发与真机 B 层。

## 18. 任务书 §2.2 的十个竞争场景 → 实际落在哪套件里

逐条对照，并注明**是否检查了最终数据**（任务书明确不许"只调两次然后断言返回值"）：

| # | 场景 | 覆盖处 | 检查最终数据？ |
|---|---|---|---|
| 1 | 两人抢最后一个座位 | `lifecycle-concurrency`（1 号位只有一人）+ `e2e-interleave` C1 | ✅ 落库名单 + 独立 oracle 未报占座冲突 |
| 2 | 同一参与者重复报名 | `e2e-permission` / `release-gap` 的 DUPLICATE_PERSON；并发形态由全局 CAS 串化成"一成一败"，与 S1 同机制 | ✅ 终态行数 |
| 3 | 两个请求同时取消同一报名 | `e2e-interleave` C2（review vs cancel vs seat） | ✅ 败者零副作用 + 重读后收敛 |
| 4 | 两个领队同时改活动状态 | `e2e-interleave` C1 末段（陈旧基线 transition ⇒ CONFLICT，重读后 ok） | ✅ 终态 phase |
| 5 | 同一座位同时分配给不同人 | `lifecycle-concurrency`（SEAT_TAKEN；重读后仍被唯一性挡住） | ✅ `assignments` 文档态 |
| 6 | 同一车辆/司机被并发分到冲突活动 | **无并发测试，也不需要**：`canExecute` 是活动级 + 全局单计数器使两次写必然互斥（第二轮 §11 的"跨活动伪冲突"正是这个机制的代价，代价是可用性不是正确性） | 机制论证，见左列 |
| 7 | 签到/上车/出发被重复提交 | `lifecycle-concurrency`（重复签到不产生第二份履约；重复"已上车"幂等；已有上车事实不被改写时刻） | ✅ 履约记录条数与时刻 |
| 8 | **超时后客户端重试，而第一次其实已成功** | **本轮新增** `receipt-window` §2 + `failure-semantics` A3 | ✅ 重放后档案内容逐字段比对、receipts 不增长、调用次数恒为 1 |
| 9 | 参与者取消与领队确认同时发生 | `e2e-interleave` C2 | ✅ 同 #3 |
| 10 | 归档与最后一次业务状态更新同时发生 | `lifecycle-concurrency`（归档后迟到操作整批被拒）| ✅ 终态不变 |

第 6 条我**没有**补一个并发用例：它要证明的是"两个活动同时登记同一司机"，而两次写在全球单计数器下
不可能同时提交，加那个用例只会重复 S1 已经钉过的互斥性。真要让它有意义，前提是先把 CAS 按活动分桶
（第一轮 §6 的 F-7，架构级，本轮授权范围外）。


