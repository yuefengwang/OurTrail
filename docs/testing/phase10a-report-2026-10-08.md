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

## 5. real cloud GREEN —— **未取得：修复必要但不充分（机制②已证实）**

两次部署、两次读数，顺序都是**先取证线上包、再跑行为探针**（细节见
`phase10a-evidence/deploy-provenance-check.md` 与 `phase10a-evidence/realcloud-post-deploy-NES.md`）：

**第一次部署**：线上 `store.js` 无哨兵、`domain/activity.js` 连 Phase 8 的 owner 门都没有，与 `D:/OurTrail`(master)
逐字节一致 ⇒ 部署来源是主 worktree，**修复从未上线**。所以那一轮 `STORAGE_UNAVAILABLE` 5/30 不算判据失败。

**第二次部署（正确来源）**：取证确认线上 `store.js` 与修复版逐字节一致（`conflicted` 4 次、owner 门已在、`timeout=20`）。
随后 K=6 × 4 批 = 24 轮、144 个请求：

| | CONFLICT | STORAGE_UNAVAILABLE | OK | 恰好一胜 | Δrevision |
|---|---|---|---|---|---|
| 合计 | 79 | **31** | 22 | 22/22 | 22/22 全部 =1 |

⇒ **败者仍有 28% 拿到 `STORAGE_UNAVAILABLE`，没有归零。** 时延数据否证了"哨兵早退导致 commit 卡住"这一替代解释
（STORAGE 败者 2.41–2.53 s，比 OK 的 2.45–2.65 s 还快一点，没有数秒长尾）：
这些不是我们从 `meta.revision` 判出的那次冲突（那条走哨兵，已与异常类型无关），
而是 **SDK 自己在 `runTransaction` 内中止/拒绝**，落进 `store.js` 的 `catch` 被兜底成 `STORAGE_UNAVAILABLE`。

**定性**：
- 并发正确性仍然完好（22/22 轮恰好一胜、Δ=1，无 lost update、无双写）；
- BUG-C3 的语义缺陷**只被部分修复**——哨兵让"我方 CAS 判定"这一类正确映射（stub 侧 C7-②③⑤ 全绿），
  但真云端还有第二类冲突来源没被映射 ⇒ **不能判 FIXED**；
- 再往下修就需要原始错误身份，而当前 `catch` 把它丢掉了。凭猜匹配错误码会把真存储故障也判成冲突，
  比现状更糟（C7-⑧ 正是为守住这条而写）。
⇒ 按任务书 §9「如果 production fix 影响范围超出 store/error mapping：立即停止并报告」——**本轮停手**：
不改 `catch` 的兜底逻辑、不加 retry、不动客户端。下一步方案（一次性诊断部署，只给 message 加 `errCode/name`
再跑同一支探针取签名）已写进 `realcloud-post-deploy-NES.md` 末节，等授权。

## 5b. 诊断部署已完成 —— 签名是**单一稳定**的一类（`c3-error-signature-result.md`）

线上包先经 diff 证明是诊断版，再跑 K=6×14 轮（84 请求）：

```
判据：14/14 轮恰好一胜、Δrevision 全 =1、无 lost update          → 全部成立
分布：OK 14 / CONFLICT 47 / STORAGE_UNAVAILABLE 23 / OTHER 0
签名：23 个样本归一化后只有 1 类（23/23）
      name=Error  errCode=-501001  keys=errCode,errMsg
      document.set:fail -501001 resource system error.
      [ResourceUnavailable.TransactionConflict] Transaction is conflict…
```
两条直接推论（只报事实）：
1. **不是机制①**：签名里没有 `code=CONFLICT`、没有我方文案 ⇒ 不是我们的 `ConflictError` 被 SDK 重抛时丢类型；
   哨兵那条路会早退、不做任何 `set`，而失败点正是事务内的 `document.set` ⇒ 我方 CAS 当时是通过的，
   随后**平台按自己的读写冲突规则原子中止**（Δ=1 与败者零副作用佐证"原子"）。
2. 平台把"事务冲突"作为 `-501001` 下的**具名子类** `ResourceUnavailable.TransactionConflict` 报出来
   ⇒ 存在可窄化匹配的特征；但本次样本里只见这一个子类，任何映射都必须绑子类型标记，不能拿裸码赌。

已按约定**立即还原**：`git revert 18ddb16` → `6f7086a`；两份 `store.js` 与基线 `f5b3a8a` 逐字节一致；
全仓 `DIAG-P10A` 0 命中；线上已重新部署非诊断版（`DIAG=0`、`conflicted=4`、`timeout=20`）；沙盒 title 已恢复。
正式映射（约 3 行窄分支 + 桩侧开关 + C7-⑧ 加严 + 部署后复跑 + 变异复核）**只写成方案，未实现**，等批准。

## 5c. 映射已批准并落地 —— 真云端复跑：完整 14 轮 `STORAGE_UNAVAILABLE` = 0

业主批准（选项 A：做完→我自己 CLI 部署→复跑→变异复核→交报告）。落地内容与诊断报告 §6 的方案**逐字一致**，未扩面：

- `store.js` catch 里加 3 行窄分支（`errCode === -501001` **且** 命中 `ResourceUnavailable.TransactionConflict` 才抛 `ConflictError`，文案与层①同）；
  `instanceof` 分支、`conflicted` 哨兵、CAS 算法、事务体、返回值、重试策略、客户端、`index.js:122` 全未动。
- 桩基座新增 `__setTxnConflictAbort()`（默认 OFF）：读不排队、写排队 ⇒ 两笔并发都先过我方 CAS，
  后落者在事务内 `document.set` 被平台原子中止（错误对象按取证形状造，`__platformAbort` 用不可枚举属性以免被类型擦除改写）。
- 新回归 **C8（12 条）**，先 RED 后 GREEN：改动前 `3 红 = C8-②③⑤`（`c8-mechanism2-RED.txt`），改动后 `54/0`（`c8-mechanism2-GREEN.txt`）。
  **C8-⓪ 是有效性门**：断言 `aborts` 增量恰=1，证明测的确实是机制②（不是 C7 换了个名字走哨兵，也不是空断言）。
- **C8-⑨⑩⑪ 选择性三对照**（别的 `-501001` 子类型 / 只有裸码 / 只有文案没有码）都必须仍是 `STORAGE_UNAVAILABLE`。
- 变异双向复核（`m7-*.txt`）：删掉窄分支 ⇒ 恰 `C8-②③⑤` 红、红因是 `STORAGE_UNAVAILABLE`；
  把判据放宽成只看裸码 ⇒ 恰 `C8-⑨⑩` 红而 `⑪` 仍绿 ⇒ 证明"码 AND 子类型"两个条件都受断言约束，断言不是摆设。

真云端复验（同一支 K=6×14 探针；来源先经 download+diff 证明线上就是 p10a 树、`timeout=20`、无 DIAG 残留）：

```
run3（完整 14 轮 / 84 请求）  {OK:14, CONFLICT:70, STORAGE_UNAVAILABLE:0, OTHER:0}
                              恰好一胜违例=0   Δ≠1 违例=0   收尾恢复 OK
跨跑合计（run1 完成的 8 轮 + run3 的 14 轮 = 22 轮 / 132 败者请求）
                              STORAGE_UNAVAILABLE = 1（0.8%）   ← 映射前同类为 23/70（33%）
```

run1 在 8 轮后撞 automator 响应超时（run2 开局即超时、0 请求，作废）；重绑自动化端口 9427 后 run3 跑完整。
**那 1 条残余没有归类**：诊断版已还原，普通版取不到原始错误对象 ⇒ 要么是一次真存储故障（分类本就对），
要么是 `-501001` 的另一个子类型（诊断样本里从未出现过）⇒ 窄映射未覆盖。定性要再来一次诊断部署，需单独批准。
详见 `phase10a-evidence/realcloud-post-mapping-K6.md`。

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

**CONDITIONAL ACCEPT。** 诊断→批准→落地→复验这条链已闭合（§5c），服务端分类这一类真云端实测归 0；
"CONDITIONAL" 只挂三条如实登记的尾巴，没有一条是数据风险：

| 项 | 状态 |
|---|---|
| §1 RED | STUB 与 REAL CLOUD 两栏都成立（真云端 K=6 命中 13/30） |
| §2 根因 | 两类都定到一个**唯一且可测**的原因：① 哨兵已修（C7）② 平台事务中止已映射（C8） |
| §3 最小修复 | 达成，两次都未越界（哨兵 3 行 / 映射 3 行） |
| §4 stub GREEN | 达成（C7 + C8 + 选择性反证 C7-⑧、C8-⑨⑩⑪） |
| §5 real cloud GREEN | **达成（完整 14 轮 STORAGE=0）**；跨跑合计仍有 1/132 未归类（§5c），不写"归零" |
| §6 client recovery GREEN | 达成（客户端未改，走原生 CONFLICT 分支）——但页面级真并发未做，见下"通道边界" |
| §7 变异 | M6/M7 双向有效、还原逐字节一致 |
| §8 C1 / §9 C2 | C1 仍 GREEN；C2 未修（P2 / Product Decision Required，按指示） |
| §10 全量 | 无头 43 套：`gate-full-post-mapping.txt` → 2750 断言，唯一 1 红是已登记的天气线非确定性（`outdoor-intelligence-ui`，本轮复现同一句 `✗ applySelection 命中 IN_CLOUD 窗口`，与 store 改动无关）。真机两套仍记 DEFERRED |

**未收口的三条（不许读成 FIXED 的一部分）：**

1. **残余 1/132 未归类** ⇒ 要定性必须再做一次诊断部署（待批）。
2. **平台文案漂移**：窄匹配绑在 `ResourceUnavailable.TransactionConflict` 这个平台字符串上；
   若平台改名，映射**停止命中并退回今天的行为**（不会误判成冲突，失效方向安全），
   而这一漂移**桩测不到**（桩里那条字符串是我写的），只能靠再诊断或云函数日志发现 ⇒ 属知情风险。
3. **通道边界**：客户端恢复路径（reload 恰好一次 / 文案）是 STUB PROOF；页面级真并发（两个真 editor 实例同时点保存）
   本轮没做 ⇒ **不写 UI PASS**。

**仍在本 Phase 之外的既有登记**：D1（`index.js:122` 缺省成 `before.revision` 的支路）留 10B；
BUG-C2 产品决策；天气线 1 条常驻红；23 个命令零真云端覆盖。
⇒ **BUG-C3 建议从 OPEN 改判为「已修，附条件」**：两类冲突的服务端分类都有真云端读数支撑，
判 FIXED 的最后一格留给"那 1/132 的定性"或"页面级真并发"，二者都要另批资源。
