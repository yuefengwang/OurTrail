# Phase 10A §2 — BUG-C3 只读定位（未改任何代码）

基线：Phase 9 final commit `711b3c1`，专用 worktree `D:/OurTrail-p10a`，分支 `win/phase10a-c3-error-semantics`。

## 完整传播链

```
store.persistState(db, before, after, expectedRevision, now)      cloudfunctions/trailApi/store.js:108
  └ db.runTransaction(async transaction => {                      store.js:111
       meta = transaction.collection('ot_meta').doc('main').get() store.js:112
       if (meta.revision !== expectedRevision)
             throw new ConflictError('安排已更新…')                 store.js:114-115   ← 冲突判定
       …写 diff / 删 / meta.revision+1                             store.js:117-125
     })
  catch (e) {
     if (e instanceof ConflictError) throw e                       store.js:128        ← 唯一保住 CONFLICT 的出口
     throw {code:'STORAGE_UNAVAILABLE'}                            store.js:129        ← 真云端走的就是这条
  }
     ↓ 异常继续上抛
actionDispatch 不 catch                                            index.js:132
     ↓
exports.main 的 catch：{ok:false, error:{code: e.code, message}}    index.js:273-274
     ↓ 信封
客户端 call()：err.code = r.error.code                               miniprogram/utils/api.js:30
     ↓
dispatch()：if (e.code === 'CONFLICT') e.needRefresh = true          api.js:110
     ↓
dispatchAndSync()：if (e.needRefresh) toast + page.reload()          api.js:118-122
```

## 五个必答问题

**1. `ConflictError` 在哪里产生？**
类定义 `store.js:31-36`（`this.code = 'CONFLICT'`）。**唯一的产生点只有一个**：`store.js:115`，事务内 `meta.revision !== expectedRevision`。
另有**另一个** CONFLICT 来源，与它无关：内存层①`domain/commands.js:122` 返回 `failure('CONFLICT', …)`，经 `index.js:124` 的 `fail()`（`index.js:33-35`：`throw Object.assign(new Error(message), {code})`）抛出——**这条不穿过 SDK 边界，所以它一直是正确的 CONFLICT**（Phase 9 的 BUG-C3 真云端复现里 A 顺序陈旧写拿到的就是它）。
⇒ 两层里只有**事务层②**有分类问题。

**2. 为什么真实云端被映射成 `STORAGE_UNAVAILABLE`？**
`store.js:128` 用 `e instanceof ConflictError` 作为"这是我方的 CAS 冲突"的唯一判据，而这个判据要求**异常对象原样穿过 `runTransaction` 的边界**。真云端不保证这一点：SDK 在事务回调抛出后会用自己的错误对象/包装重新抛出，`instanceof` 判 false，于是落进 `:129` 的基础设施故障分支。
两种机制都能解释实测（`STORAGE_UNAVAILABLE`）：① 我们的 `ConflictError` 跨边界丢类型；② SDK 自身的事务冲突/超时错误（那本来就"不是我们的 ConflictError"）。**区分二者要读云函数日志，本轮无该通道，不假装已定位到机制。**
⇒ 修复必须对两种机制都成立：**不依赖异常类型跨边界存活**（冲突决定在边界内侧记成哨兵值，出了边界再由我们自己抛）。这也是这版设计比"改成按 message/code 匹配"更稳的原因——按文案匹配会把 SDK 的真实故障也误判成冲突。

**3. 桩为什么没有暴露这个问题？**
`tools/stub-wx-server-sdk.js` 的 `runTransaction: fn => … fn(transaction)`（barrier ON 时也只是 `serialize(() => fn(transaction))`，`stub:70`），**异常是原样透传的**，`instanceof` 必然成立 ⇒ 桩永远判出 CONFLICT。
⇒ 桩建的是一个"类型保真的理想边界"。这不是 Phase 8 的 barrier 判错，而是**桩缺一个建模维度**：SDK 边界的类型丢失。本轮以**可选开关**补这个维度（默认 OFF，既有 43 套读数逐字节不变），并如实标注它是 **STUB MODEL**，不是 REAL CLOUD 证明。

**4. 当前客户端对 CONFLICT 做什么？**（恢复路径正确）
`api.js:110` 置 `needRefresh` → `dispatchAndSync` 的 catch：toast「安排已被他人更新，已刷新，请重试」+ `Promise.resolve(page.reload()).catch(()=>{})` → 页面/面板重读 authoritative state 并回填 revision。页面自己的 `.catch` 把 `errorText(e)` 落进 `data.failure`：**不覆盖用户输入、不静默、不自动重试**。Phase 9 的 `e2e-panel-sync` P3/P4、`e2e-client-cas` C1-⑨ 都钉住了这条。

**5. 当前客户端对 STORAGE_UNAVAILABLE 做什么？**（恢复路径失效）
`err.code='STORAGE_UNAVAILABLE'` ≠ `'CONFLICT'` ⇒ **不置 needRefresh ⇒ 不 toast「已刷新」、不 reload**，只把服务端文案「这次修改没有保存，原安排未改变。请保留输入后重试。」透给页面显示。
而这句话在 CAS 冲突场景下是**错的**：用户"保留输入后重试"，携带的仍是同一个陈旧 `expectedRevision` ⇒ 真云端再冲突一次 ⇒ 循环。客户端此时**不知道自己的基线已经过期**。
⇒ BUG-C3 的真实危害不是数据（数据无损），而是**并发错误的语义分类 + 恢复路径**。

## 修复边界（自订，供后续核对）

- 只允许改：`cloudfunctions/trailApi/store.js`（冲突判定不再依赖跨边界异常类型）＋ 必要的 error mapping。
- 不允许改：`index.js:122`（D1 留 Phase 10B）、乐观并发语义、CAS 算法、事务重试策略、自动 retry、sleep、catch 后重提交。
- 客户端**不改**（`api.js` 的 CONFLICT 分支本来就是对的；给 STORAGE_UNAVAILABLE 也加重读会把真实的基础设施故障伪装成"他人已更新"，语义更糟）。
  ⇒ 若修复后仍需客户端配合，视为**超出范围**，停下上报。
