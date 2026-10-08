# Phase 10A — 部署后复验：修复必要但**不充分**（机制②已被证实）

· 时间：2026-10-08 01:39–01:46（本地）
· 通道：REAL CLOUD，线上 `trailApi`（已确认含本轮修复）
· 沙盒：仅 `activity-muns9s5oyqeo98` 的 title，每批收尾均恢复（4 次 `恢复写入="OK"`、终态 `[预演] 工作台E2E`）；全程未 `quit`/`close`

## 第 1 步：来源取证（先证明线上是哪个版本，再看行为）

```
cli cloud functions download → p10a-deployed2/store.js
  conflicted 出现次数 = 4
  diff（忽略 CRLF） vs D:/OurTrail-p10a/cloudfunctions/trailApi/store.js → 逐字节一致
  domain/activity.js 已含 Phase 8 handler owner 门
  cli cloud functions info → status Active, timeout 20, Nodejs16.13
```
⇒ **修复确实在线**。因此下面的读数不能归因于"没部署上"。

## 第 2 步：K=6 行为探针（4 批 × 6 轮 = 24 轮、144 个请求）

| 批 | CONFLICT | STORAGE_UNAVAILABLE | OK | 每轮恰好一胜 | Δrevision |
|---|---|---|---|---|---|
| A 01:39 | 21 | 9 | 6 | 6/6 | 全部 =1 |
| B 01:41 | 18 | 12 | 6 | 6/6 | 全部 =1 |
| C 01:44 | 23 | 7 | 6 | 6/6 | 全部 =1 |
| D 01:45（带时延） | 17 | 3 | 4 | 4/4 | 全部 =1 |
| **合计** | **79** | **31** | **22** | 22/22 | 22/22 |

**败者里仍有 31/110 ≈ 28% 拿到 `STORAGE_UNAVAILABLE`。** 修复前同一支路是 13/30=43% 与 5/30=17%，
修复后 28% —— 同一量级，**没有归零**。

## 第 3 步：时延否证了"早退导致 commit 卡住"这一替代解释

```
STORAGE_UNAVAILABLE：min≈2410 max≈2530 ms
OK                 ：min≈2451 max≈2648 ms
CONFLICT           ：min≈2576 max≈5063 ms
```
若是"哨兵早退后事务提交失败/超时"，败者应出现数秒级长尾；实测它比 OK 还快一点 ⇒
这些错误**不是我们从 `meta.revision` 判出来的那次冲突**（那条现在走哨兵，已经与异常类型无关），
而是 **SDK 自己在 `runTransaction` 里中止/拒绝**（读写冲突、`get`/`set` 冲突或事务级错误），
落进 `store.js` 的 `catch` → 兜底成 `STORAGE_UNAVAILABLE`。

## 结论（按任务书 §9 的停止条件）

1. **数据一致性仍完好**：22/22 轮"恰好一个成功 + Δrevision=1" ⇒ 事务层继续拦得住并发，没有 lost update、没有双写。
2. **C3 的语义缺陷只被部分修复**：哨兵把"我们自己的 CAS 判定"这一类正确地映射成 CONFLICT（stub 里 C7-②③⑤ 全绿），
   但真云端还有第二类冲突来源（SDK 主动中止）没被映射 ⇒ **修复必要但不充分**，BUG-C3 不能判 FIXED。
3. **继续修就需要超出 `store.js` 现有 error mapping 的信息**：要知道 SDK 到底抛的是什么（`errCode` / `name` / message 特征），
   而我们现在的 `catch` 把原始错误**丢掉了**（只留下自定义文案）。凭猜去匹配错误码会把真正的存储故障也误判成冲突
   —— 那比现在的 bug 更糟（C7-⑧ 就是为守住这条而写的）。
4. ⇒ 按任务书「如果 production fix 影响范围超出 store/error mapping：**立即停止并报告**」，本轮到此停手，不改 `catch`、不加 retry、不动客户端。

## 建议的下一步（需要一次诊断性部署，等业主点头）

**D-诊断（一次性、可回退）**：把 `store.js` 兜底分支的 message 临时改成携带原始错误身份的形状
（例如 `这次修改没有保存…[<errCode>/<name>]`，只多带诊断字段，**不改任何控制流**），部署后跑同一支 K=6 探针，
把真云端实际出现的 SDK 错误身份取回来；拿到签名后：
- 若签名可安全区分（事务冲突类 vs 存储不可用类）⇒ 正式修复就是在 `catch` 里按签名分流，改动仍只在 error mapping，
  并给 `e2e-client-cas` C7 再加一条"SDK 冲突类错误也必须 CONFLICT"的桩建模断言；
- 若无法区分 ⇒ 结论改为"真云端并发冲突只能在客户端兜底"，届时再议是否让 `api.js` 对 `STORAGE_UNAVAILABLE`
  也做一次重读（这是 Phase 10A 明令禁止的方向，需要新的授权）。
诊断改动跑完必须还原并复跑门禁。
