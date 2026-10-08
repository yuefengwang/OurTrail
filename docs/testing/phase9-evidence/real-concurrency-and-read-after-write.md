# Phase 9 §6 REAL_CONCURRENCY + §8 READ-AFTER-WRITE（真云端原始读数）

· 时间：2026-10-07 15:24–15:26（本地）
· 通道：**REAL CLOUD**（开发者工具模拟器 → 已部署的线上 `trailApi`；驱动 `%LOCALAPPDATA%\Temp\opencode\mp-auto\p9-real-concurrency-raw.js`，`--auto-port 9420`，收尾只 disconnect）
· 沙盒行：`activity-muns9s5oyqeo98`（`[预演] 工作台E2E`，published）——16 次写全部只改这一行的 title/description，收尾 title 已恢复原值
· 并发造法：`mp.evaluate` 内**同一个 tick 发两个 `wx.cloud.callFunction`**（不是 sleep 伪造，不是桩 barrier）

---

## A. REAL_CONCURRENCY = PASS（恰好一胜，revision 只 +1）

| 次 | 基线 R | 两个结果 | ok 数 | revision | 终态 title | 墙钟 |
|---|---|---|---|---|---|---|
| 0 | 4683 | `["OK", "STORAGE_UNAVAILABLE"]` | 1 | 4683→4684（Δ=1） | `RC0-A 并发标题`（胜者） | 3099 ms |
| 1 | 4684 | `["STORAGE_UNAVAILABLE", "OK"]` | 1 | 4684→4685（Δ=1） | `RC1-B 并发标题`（胜者） | 3101 ms |
| 2 | 4685 | `["STORAGE_UNAVAILABLE", "OK"]` | 1 | 4685→4686（Δ=1） | `RC2-B 并发标题`（胜者） | 2592 ms |

**结论 1（乐观并发在真云端成立）**：3/3 恰好一个成功、另一个被拒、revision 只推进一次、胜者状态保留 ⇒
真云端没有 lost update，事务层确实拦住了同基线并发。**没有**出现双胜。

**结论 2（新缺陷 BUG-C3）**：败者拿到的码是 **`STORAGE_UNAVAILABLE`**，不是 `CONFLICT`。

```
store.js:126-129
  catch (e) {
    if (e instanceof ConflictError) throw e                       // ← 真云端在这条上判 false
    throw Object.assign(new Error('这次修改没有保存，原安排未改变。请保留输入后重试。'), { code: 'STORAGE_UNAVAILABLE' })
  }
```

后果链（可证的部分）：
1. `utils/api.js:30` 把 `err.code` 原样透出，`dispatch()` 只对 `code === 'CONFLICT'` 置 `needRefresh`（api.js:106）；
2. ⇒ `dispatchAndSync` 的 catch（api.js:118-122）**不重读、不刷新**，只把「这次修改没有保存……请保留输入后重试」透给页面；
3. ⇒ 用户按文案"保留输入重试"再点一次，携带的仍是同一个陈旧 revision ⇒ 再次失败。**冲突自恢复链路在真云端这条路失效。**

**归因边界（如实）**：两种机制都能产生这个码——① 我们抛的 `ConflictError` 穿过云 SDK 的事务边界后 `instanceof` 失效；
② SDK 自身的事务冲突/超时错误（不是 ConflictError）落到同一个 catch。区分二者要读云函数日志（本轮无该通道权限），
因此这里只登记**可观测后果**，不宣布已定位到具体那一行。

**桩与真云端的这处分歧**：`tools/e2e-concurrency-test.js` 里 barrier 判出的败者是 `CONFLICT`
（桩的 `runTransaction` 直接调 `fn(transaction)`，`instanceof` 成立）。这正是 Phase 8 记的
「CONFLICT 的来源层无法在信封层区分」的同源问题——现在有了真读数：**信封层能区分，但区分出来的不是 CONFLICT**。

---

## B. READ-AFTER-WRITE（N=12，两条可见性通道）

| 通道 | n | missed | p50 | p90 | max | min |
|---|---|---|---|---|---|---|
| ① meta 主键读（信封 `data.revision`，`store.js:62`） | 12 | **0** | 1879 ms | 2070 ms | 2293 ms | 1805 ms |
| ② 业务集合分页读（`view.activity.title`，`store.js:43`） | 12 | **0** | 1879 ms | 2070 ms | 2293 ms | 1805 ms |

逐样本：meta 与业务行的"首次可见"发生在**同一次读**里（12/12 完全相等）——
`actionRead` 一次 `loadState` 同时取 meta 与 15 个集合，返回的是同一份快照，
所以从客户端可观测面看，两条通道**不可分割**，「revision 新、业务行旧」这一形状在本路径上没有出现。

写侧 RTT：2404–3952 ms（p50≈2.7 s）。读侧可见延迟：1805–2293 ms。

**结论（consistency model finding，推翻旧假设而不是确认它）**：
本轮 **没有复现**「20 s+ 云读滞后」。N=12、0 missed、max 2.29 s，量级与单次读 RTT 相同。
因此既有文档里以 20 s 为前提的两处需要重新定性：
- `tools/e2e-ui-state-test.js` 头部「云读对刚写入的行有 20s+ 滞后（NEEDS_PRODUCT_FOLLOWUP，多轮复现）」；
- 负矩阵/真机层为"等 20 s"而设的有界轮询。

诚实边界（不据此下"滞后不存在"的结论）：
1. 本量测只覆盖「写 → 同一个 `read` 信封读同一条记录」；
2. 未覆盖「写 → 另一个集合/另一条记录被分页扫描到」的形状（Phase 5 观察到的正是那种）；
3. n=12、单活动、单写者、无并发读者；真机 UI-State run 3 那次 `pickupIds` 回显 null 在本量测下**没有得到解释**，
   所以它的归类仍是 FLAKY / 未复现，而不是「已证实的读滞后」。
⇒ 状态：**READ_AFTER_WRITE = 已量测（N=12）**，旧 20 s 数字在受测路径上不成立，须另行复扫跨集合形状。

---

## 沙盒恢复与副作用声明

- 终态 title = `[预演] 工作台E2E`（原值），`已恢复=true`。
- revision 4683 → 4699（+16：并发 3 + 量测 12 + 恢复写 1）。revision 是全局单调计数器，恢复动作本身必然再推一次；**内容**已复原。
- 另：诊断探针 `p9-payload-diff.js` 在 15:21–15:23 之间对同一行提交过一次与线上现存值逐字节相同的 `activity.edit`（4682→4683），用于排除"payload 形状不匹配"这一误判方向；内容无变化。
- 全程未 `cli quit` / `cli close`，只 `disconnect`。
