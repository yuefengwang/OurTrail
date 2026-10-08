# BUG-C3 诊断性部署 — 最终报告（按业主 8 条逐项作答）

· 基线：`f5b3a8a`（严格固定）｜分支/worktree：`win/phase10a-c3` @ `D:/OurTrail-p10a`
· 诊断 commit：`18ddb16`（临时）→ 还原 commit：`6f7086a`（`git revert`）
· 通道：**REAL CLOUD**（无头桩只用于旁证，不计入本报告的签名分布）
· BUG-C3 状态：**OPEN**（本报告不宣称 FIXED）

---

## 1. 修改前后的 store.js diff

只改 `cloudfunctions/trailApi/store.js` 的 `STORAGE_UNAVAILABLE` 兜底分支（`trailApiLab/store.js` 那份是
`node tools/sync-lab.js` 的生成物，同一 diff 自动带出，非第三处手改）。位置：`persistState()` 的 `catch (e)`，
`git diff` 行号 `@@ -135,7 +135,18 @@`。

改前（1 行）：

```js
    throw Object.assign(new Error('这次修改没有保存，原安排未改变。请保留输入后重试。'), { code: 'STORAGE_UNAVAILABLE' })
```

改后（12 行，新增的都是 message 拼接）：

```js
    // ── [DIAG-P10A 一次性诊断，取到签名后立即 git revert 还原] ──────────────────
    // 只做一件事：把原始错误的身份字段拼进 message 带回来。
    // 控制流 / code / 异常类型 / 事务与 CAS 逻辑 / 返回值 全部不变；不新增任何映射。
    // 只取白名单字段与长度上限，不 dump 对象值（避免把文档内容带进文案）。
    const sig = 'name=' + ((e && e.name) || '?') +
      '|code=' + (e && typeof e === 'object' && e.code !== undefined ? String(e.code)
        : e && typeof e === 'object' && e.errCode !== undefined ? String(e.errCode)
          : e && typeof e === 'object' && e.errorCode !== undefined ? String(e.errorCode) : '?') +
      '|errMsg=' + (e && typeof e.errMsg === 'string' ? e.errMsg.replace(/\s+/g, ' ').slice(0, 80) : '?') +
      '|msg=' + String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 120) +
      '|keys=' + (e && typeof e === 'object' ? Object.keys(e).slice(0, 8).join(',') : typeof e)
    throw Object.assign(new Error('这次修改没有保存，原安排未改变。请保留输入后重试。 [DIAG ' + sig + ']'), { code: 'STORAGE_UNAVAILABLE' })
```

边界自检（对照你的 1–7 条）：

| 约束 | 实测 |
|---|---|
| 基线固定 `f5b3a8a` | 诊断 commit 的父 commit 即 `f5b3a8a` |
| 只动 store.js 兜底分支 | `git show 18ddb16 --stat` = 2 文件（trailApi + 其 lab 生成物），无第三处 |
| 只增加诊断信息 | 白名单：`name` / `code|errCode|errorCode` / `errMsg`(80) / `message`(120) / 自身可枚举键名(8) |
| 严禁改控制流/异常类型判断/返回值/retry/sleep/事务/CAS | `if (e instanceof ConflictError) throw e` 原样在前；`conflicted` 哨兵原样；事务体原样；无新增 catch/await/循环；`code` 仍是 `STORAGE_UNAVAILABLE` |
| 严禁改 index.js:122 / api.js / editor.js / domain | 均未出现在 diff 中 |
| 不允许凭猜测加 SDK code → CONFLICT 映射 | 无任何映射分支（这是第 6 条，也是最容易顺手做的一条，明确没做） |
| 诊断完必须还原并验 residue | 见第 7 项 |

诊断版部署前跑过 9 套相关无头套件（concurrency 44/0、client-cas 42/0 含 C7-⑧、interleave 67/0、panel-sync 40/0、
e2e 71/0、permission 96/0、negative 83/0、smoke 173/0、lab-dryrun 165/0）；并 grep 确认全库没有断言依赖那句原文，
所以这次改文案不会让任何既有断言假绿或假红。

---

## 2. 真云端 K=6 探针结果

**同一支探针、同一参数量、同一判据**（`mp-auto/p10a-signature-probe.js 9426 activity-muns9s5oyqeo98 14 6`），
K=6 同时并发 × 14 轮 = 84 个请求，全部在同一 tick 由真机 `mp.evaluate` 发出（无 sleep、无 retry）。

先证部署来源：`cli cloud functions download` 后与本地逐字节 diff 一致，且线上包含
`DIAG-P10A`=1、`conflicted`=4、`timeout=20`、状态 Active —— 证明跑的是诊断版而不是 master（此前踩过两次这个坑）。

```
轮数                        14/14
恰好一胜（每轮 OK 数==1）    违例 0
Δrevision（每轮）           全 = 1，违例 0
OTHER 码                    0
总码分布   { OK:14, CONFLICT:47, STORAGE_UNAVAILABLE:23 }
败者总数   70 = 47 + 23   →  其中 23/70 ≈ 33% 走错分类
收尾恢复   "OK"  终态 title="[预演] 工作台E2E"  已恢复=true
```

结论性：并发**正确性**在诊断版下与修复后一致（无双胜、无 lost update、revision 单增 1）；
本次只改变了败者的**分类**能否带出身份。原始日志：`p10a-signatures.txt`。

---

## 3. STORAGE_UNAVAILABLE 的 name/code/message 分布

23 个样本，按归一化签名（去动态 id / 时间戳）分桶：**一类，23/23 命中，第二桶为空。**

```
name   = Error
errCode= -501001
自身可枚举键 = errCode, errMsg      ← 没有 code，没有任何自定义属性
errMsg = document.set:fail -501001 resource system error.
         [ResourceUnavailable.TransactionConflict] Transaction is conflict, mayb…
```

三个可读出来的事实：

1. `code` 字段是空的（`?`），`errCode` 才有值 ⇒ 这**不是**我们抛的 `ConflictError`（它带 `code='CONFLICT'` 和我方文案）
   在跨 SDK 边界时丢了类型 —— 机制①被否证。
2. 失败点是事务内的 `document.set` ⇒ 我方 `meta.revision` 检查当时**通过**（否则 `conflicted` 早退，压根不会执行 `set`），
   随后平台按自己的读写冲突规则**原子**中止整个事务（Δ=1 + 败者零副作用佐证原子性）。⇒ 机制②证实。
3. 平台把"事务冲突"报成 `-501001` 下的**具名子类** `ResourceUnavailable.TransactionConflict`；
   `-501001` 自身文案是笼统的 "resource system error"。

---

## 4. 是否存在稳定的第二类冲突 signature

**存在。** 单一签名、23/23 覆盖、跨轮次稳定（同一 `errCode` + 同一子类型标记 + 同一失败方法 `document.set`），
且与修复前 43%/17%、修复后首批 28%、本轮 33% 的波动区间相容 —— 波动的是**到达率**，不是**身份**。

到达率波动本身也是事实，不是噪声：K=6 是"平台事务冲突"被触发的必要条件（K<6 时多半落在我方 CAS 层或层①），
所以这一类的占比对并发度敏感，对签名内容不敏感。

---

## 5. 是否能与真实 STORAGE 故障可靠区分

**能，但只能靠子类型标记，不能靠裸错误码。**

- `errCode === -501001` 的官方描述是 "resource system error"，它是一个**族码**而非单一故障；
  本轮样本里只出现过 `TransactionConflict` 这一个子类 ⇒ 未见过的其它 `-501001` 子类，
  如果映射只绑码，就会被伪装成"冲突"（比现状更糟：真存储故障时客户端会去 reload 然后拿着新 revision 重写）。
- 绑上 `ResourceUnavailable.TransactionConflict` 之后，判据变成"平台明确说了这是事务冲突"，
  语义与我方 CAS 冲突同类（你的写被并发写挤掉、什么都没落）。
- **必须知情的两个残余风险**（我不会把它们说成已解决）：
  1. 该字符串归平台所有。若微信日后改文案，窄匹配**停止命中并退回今天的行为**
     （不会误判成冲突，失效方向是安全的；但恢复链路会重新偶发失效）。
     这个漂移**测试抓不到** —— 桩里那条字符串是我自己写的，平台侧只能靠再次诊断或云函数日志发现。
  2. "真实存储故障"这一类本轮**没有样本**（`OTHER`=0）。所以"能区分"的证据是
     "子类型标记语义窄"，而不是"我实测过故障与冲突各一批"。这一点决定了配套第 ② 项必须做
     （C7-⑧ 加严：其它 SDK 错误必须仍是 `STORAGE_UNAVAILABLE`）。

---

## 6. 是否建议下一步正式映射

**建议做，且只在批准之后做。** 方案（`store.js` catch 里、兜底**之前**插入 3 行窄分支）：

```js
if (e && e.errCode === -501001 && /ResourceUnavailable\.TransactionConflict/.test(String(e.errMsg || e.message || ''))) {
  throw new ConflictError('安排已更新，本次修改没有保存。请核对最新状态后重新提交。')   // 与层①同文案
}
```

不动：`conflicted` 哨兵、`instanceof` 分支、CAS 算法、事务体、返回值、重试策略、客户端 `api.js`、`index.js:122`。

配套四件（都属 error mapping 的验证面，不扩业务面）：
1. 桩基座加可选开关 `__setTxnConflictAbort()`：在 `set` 上抛这个 `-501001` 形状的错误对象，
   新断言"窄匹配下败者变 CONFLICT + 客户端 `page.reload()` 恰好一次"（RED→GREEN）。
2. `C7-⑧` 加严：**其它** SDK 错误（无该子类型）仍必须 `STORAGE_UNAVAILABLE` ⇒ 自证映射窄而不宽。
3. 部署后复跑同一支 K=6×14：期望 `STORAGE_UNAVAILABLE` 归 0、`OK` 仍 14/14、Δ 仍全 =1。
4. 变异复核：删掉这条窄分支 ⇒ 新断言必红且红因可归因；还原 ⇒ 绿。

不做的（按你的 D/E/F/G）：BUG-C2 未动、D1（`index.js:122`）未动、无关 UI 修复未跑、
天气线非确定性红保持登记不修。

---

## 7. 恢复后的 git diff / status / residue

| 检查 | 命令 | 结果 |
|---|---|---|
| 还原 commit | `git log --oneline` | `6f7086a` = `git revert 18ddb16`（不是改文案留着） |
| store.js 与基线逐字节 | `git diff f5b3a8a HEAD -- .../store.js \| wc -l` | **0**（trailApi 与 trailApiLab 两份都是 0） |
| 诊断标记残留 | `grep -rn "DIAG-P10A" cloudfunctions tools miniprogram` | **0 命中** |
| 工作树 | `git status --porcelain` | 空（干净） |
| 与基线的总差异 | `git diff --stat f5b3a8a HEAD` | 只有 `docs/testing/` 下的 report/evidence 文件；**production（cloudfunctions）与 tools 零差异** |
| 线上包 | 重新部署非诊断版后 download+diff | `DIAG=0`、`conflicted=4`、owner 门在、与本地逐字节一致、`timeout=20`、Active |
| 全量门禁 | 43 套 2738 断言 | `ALL CHECKS PASSED`；handlers 0 问题；唯一 1 红 = 已登记的天气线非确定性套件（`outdoor-intelligence-ui`，打线上 Open-Meteo + 真实时钟），不修 |
| 共享资源 | — | 只 `disconnect`，未 `quit`/`close`；未碰 8443/8123；驱动脚本全在仓库外；沙盒 title 收尾恢复 `[预演] 工作台E2E` |
| 未 push | — | git 中继不可达（`git fetch origin` 失败），无 push 授权，本分支只在本地 |

---

## 8. C3 状态声明

**BUG-C3 = OPEN。** 诊断阶段不宣称 FIXED，本报告不改变它的状态。

线上当前的准确描述：*改善但未收口* —— 我方 CAS 判定这一类冲突已正确映射成 `CONFLICT`；
平台事务冲突这一类**已定位到单一稳定签名、映射方案待批，未实现**。
所有读数的并发正确性完好（无双胜、无 lost update、Δ=1），所以这是一个无数据风险、可以安全停住的 checkpoint；
代价仅在于败者约 1/3 概率看到"请保留输入后重试"而不触发 reload，会再撞一次。
