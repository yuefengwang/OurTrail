# Phase 10A 诊断结果 — `STORAGE_UNAVAILABLE` 的真云端签名（单一、稳定）

· 通道：REAL CLOUD。线上包先经 `download`+diff 证明为诊断版（`DIAG-P10A`=1、`conflicted`=4、与本地逐字节一致、`timeout=20`）
· 探针：`p10a-signature-probe.js`，K=6 × 14 轮 = 84 个请求；判据不变
· 原始日志：`p10a-signatures.txt`（本目录）

## 1. 判据复述（全部成立）

```
轮数=14/14   恰好一胜的违例=0   Δ≠1 的违例=0
总码分布 = { OK:14, CONFLICT:47, STORAGE_UNAVAILABLE:23, OTHER:0 }
收尾恢复="OK"  终态 title="[预演] 工作台E2E"  已恢复=true
```
⇒ 并发正确性依旧完好（每轮恰好一个写入生效、revision 只 +1、无 lost update），
败者里 23/70 ≈ 33% 走 `STORAGE_UNAVAILABLE` —— 与修复前(43%/17%)、修复后首批(28%) 同量级。

## 2. 签名分布（23 个样本，归一化后**一类，占 23/23**）

```
name = "Error"
errCode = -501001
自身可枚举键 = errCode, errMsg          ← 没有 code、没有自定义属性
errMsg = document.set:fail -501001 resource system error.
         [ResourceUnavailable.TransactionConflict] Transaction is conflict, mayb…
```
（`msg` 与 `errMsg` 同源；诊断拼接按 120 字符截断，故尾部省略号是我的截断，不是内容缺失。
决定性字段 `errCode` 与子类型 `ResourceUnavailable.TransactionConflict` 完整可见。）

## 3. 这批事实说明了什么（也说明不了什么）

**说明得了的：**
1. **不是机制①**。若是我们自己抛的 `ConflictError` 被 SDK 重抛时丢了类型，签名里应当带 `code=CONFLICT`
   与我们那句 `'安排已更新…'`；实测是 `errCode=-501001` + 平台自有文案 + 键集只有 `errCode,errMsg`
   ⇒ 这是**云平台自己在事务内中止**产生的错误对象，我们的哨兵管不到它（哨兵那条路会早退、不做任何 `set`）。
2. **失败点在事务内的 `document.set`**（`document.set:fail`），不是 meta 读、不是连接层。
   ⇒ 我方 `meta.revision` 检查当时是**通过**的（否则会早退，压根没有 `set`），随后平台按自己的读写冲突规则中止了整个事务。
   结合 Δ=1 与败者零副作用，可确认中止是**原子的**（没有部分写入）。
3. 子类型是显式的：`ResourceUnavailable.TransactionConflict`，而 `-501001` 本身写的是"resource system error"。
   ⇒ 平台把"事务冲突"作为 `-501001` 下的一个**具名子类**报出来，所以存在可窄化匹配的特征，
   不需要拿 `-501001` 整个码去赌。

**说明不了的（按你的 A/B 条守住）：**
- 不能把它直接解释成"这个错误就是 CAS 冲突"。它是**平台级事务冲突**，语义上与我方 CAS 冲突同类
  （"你的写被并发写挤掉了，什么都没落"），但两者判定来源不同；本轮只报事实。
- 本次样本里只出现过这一个子类型 ⇒ **其他 `-501001` 子类型我们没有观测到**，
   所以任何映射都必须绑在"子类型标记"上而不是光绑错误码，否则会把未见的真故障一并伪装成冲突。
- 真机侧字符串归平台所有：若微信日后改文案，窄匹配会**停止命中**并退回今天的 `STORAGE_UNAVAILABLE`
  （方向是安全的：不会误判冲突，但恢复链路又会失效）。**这一点测试抓不到**（桩里的那条字符串是我写的，
  平台漂移只能靠再次诊断或云函数日志发现）—— 必须在批准时知情。

## 4. 待批的正式映射（**未实现**，等你点头再动）

`store.js` 的 catch 里、`STORAGE_UNAVAILABLE` 兜底**之前**加一条窄分支（约 3 行）：

```js
if (e && e.errCode === -501001 && /ResourceUnavailable\.TransactionConflict/.test(String(e.errMsg || e.message || ''))) {
  throw new ConflictError('安排已更新，本次修改没有保存。请核对最新状态后重新提交。')   // 与层①同文案
}
```
不改：`conflicted` 哨兵、`instanceof` 分支、CAS 算法、事务体、返回值、重试策略、客户端、`index.js:122`。

配套要一起做（都属 error mapping 的验证面，不扩业务面）：
1. 桩基座再加一个可选开关 `__setTxnConflictAbort(-501001 形状)`，**在 `set` 上**抛这个错误对象；
   新断言：窄匹配下败者变 CONFLICT、客户端 `page.reload()` 恰好一次；
2. `C7-⑧` 保持并加强：**其它** SDK 错误（无该子类型）仍必须 `STORAGE_UNAVAILABLE` ⇒ 证明映射是窄的不是宽的；
3. 部署后复跑同一支 K=6×14 探针：期望 `STORAGE_UNAVAILABLE` 归 0、`OK` 仍 14/14、Δ 仍全 =1；
4. 变异复核：删掉这条窄分支 ⇒ 上述新断言必红（红因可归因），还原 ⇒ 绿。

## 5. 还原与残留（已做完）

| 项 | 结果 |
|---|---|
| `git revert 18ddb16` | `6f7086a`；`store.js` 与基线 `f5b3a8a` **逐字节一致**（trailApi 与 trailApiLab 两份都验） |
| 全仓 `DIAG-P10A` | **0 命中** |
| 线上包 | 已重新部署非诊断版：`DIAG=0`、`conflicted=4`、owner 门在、与本地逐字节一致、`timeout=20`、Active |
| 无头门禁 | 43 套 2738 断言；我触碰的 8 套 + 11 个 scenario 全 0 失败；唯一 1 红是已登记的天气线非确定性套件（`outdoor-intelligence-ui`，打线上 Open-Meteo + 真实时钟），不修 |
| 沙盒 | title 收尾恢复 `[预演] 工作台E2E`；未 `quit`/`close`；驱动脚本都在仓库外 |
| BUG-C3 状态 | **仍然 OPEN**（诊断阶段不宣称 FIXED；改善在线上是"我方 CAS 一类已正确"，平台事务冲突一类未映射） |
