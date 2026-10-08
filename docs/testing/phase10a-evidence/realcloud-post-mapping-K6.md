# 真云端复验 — BUG-C3 机制② 窄映射上线后（REAL CLOUD，2026-10-08）

## 1. 部署与来源取证（我自己用 CLI 做的）

```
cli cloud functions deploy --e cloud1-d9ghcm034574b9d55 --n trailApi --r --project "D:\OurTrail-p10a"
  → success=true  filesCount=21  packSize=83.7 KB
cli cloud functions info → status='Active'  timeout=20  runtime='Nodejs16.13'
cli cloud functions download → /tmp/p10a-live
```

| 取证项 | 结果 |
|---|---|
| 线上包 vs 本地 `cloudfunctions/trailApi` 递归 diff（排除 node_modules、忽略 CRLF） | **零差异** ⇒ 线上确实是 p10a 工作树（此前踩过两次"部署的是 master"，所以这一步先做） |
| 线上 `store.js` 含窄映射 `errCode === -501001` | **1** |
| 线上 `store.js` 含 `DIAG-P10A` | **0** ⇒ 诊断版没有被顺手带上线 |

## 2. 同一支 K=6 探针（判据不变）

`mp-auto/p10a-signature-probe.js <port> activity-muns9s5oyqeo98 14 6`：同一 tick 发 K=6 个携带同一个
`expectedRevision` 的真 `wx.cloud.callFunction`，结果 parked 在 `globalThis` 后轮询；
判据仍是「每轮恰好 1 个 OK」「Δrevision=1」「沙盒 title 收尾恢复」。无 sleep 造并发、无 retry。

| run | 通道 | 完成轮数 | 码分布 | 恰好一胜违例 | Δ≠1 违例 | 备注 |
|---|---|---|---|---|---|---|
| run1 | 自动化端口 9426 | **8 / 14 后 automator 响应超时** | `{OK:8, CONFLICT:39, STORAGE_UNAVAILABLE:1}` | 0 | 0 | 第 9 轮写已落库但结果没读到（title 残留 `SIG8-4`），该轮**不计入判据** |
| run2 | 9426 重连 | 0 | — | — | — | 开局那次读就超时 ⇒ **作废**，一个请求都没发 |
| run3 | 重绑自动化端口 9427（`cli auto`，客户端代码未变所以不 close/open） | **14 / 14 完整** | `{OK:14, CONFLICT:70, STORAGE_UNAVAILABLE:0, OTHER:0}` | **0** | **0** | 收尾恢复 `OK`，终态 title=`[预演] 工作台E2E`，已恢复=true |

原始日志：`p10a-postmapping-K6-run1-partial.txt`、`p10a-postmapping-K6-run3-full.txt`（同目录）。

**合并读数（只算完成的轮）：22 轮 / 132 个败者请求，其中 `STORAGE_UNAVAILABLE` = 1（0.8%）；映射前同类是 23/70（33%）。**

## 3. 那 1 条残余 STORAGE_UNAVAILABLE 没有归类 —— 如实写

诊断版已还原，普通版拿不到原始错误对象，所以这一条**无法定性**。两种可能都成立：

1. 它是一次**真的存储侧故障**（超时/连接/资源）⇒ 分类本来就正确，映射无需覆盖；
2. 它是 `-501001` 下**另一个子类型**（诊断样本里 23/23 只见 `TransactionConflict`，其它子类型从未观测到）⇒ 窄映射没覆盖到它。

要把这一条定性，只能再来一次诊断部署（带签名版），**本轮未做、需单独批准**。
因此本报告不写"STORAGE_UNAVAILABLE 已归零"，只写"完整 14 轮那一跑为 0，跨跑合计 1/132 未归类"。

## 4. 通道边界（不许互相顶替）

- **REAL CLOUD PROOF**：真机进程发出的真 `wx.cloud.callFunction` + 真云端事务 + 真错误码 ⇒ 证明的是**服务端分类**（C8-②这一类）。
- **STUB PROOF**：客户端恢复路径（`needRefresh` → `page.reload()` 恰好一次、文案、胜者不误触发）由 C8-③④⑤ 在桩里证明；
  页面级真并发（两个真 editor 实例同时点保存）本轮**没做** ⇒ 不写 UI PASS。
  Phase 9 的真机双编辑器验证覆盖的是 CONFLICT 分支的客户端行为（`api.js` 本轮未改），可作先例引用，不作本轮证据。
- B 层两套（UI-State / Golden Path）仍 **DEFERRED**：跑它们不会改变本判据，且要占共享 IDE。

## 5. 共享资源纪律

只 `disconnect`，未 `quit`/`close`；9426/9427 自动化端口留着（关掉要 `cli close`，动 IDE 会话）；
未碰另一 agent 的 8443/8123；驱动脚本全在仓库外（`%LOCALAPPDATA%\Temp\opencode\mp-auto`）；
沙盒行 `[预演] 工作台E2E` 的 title 已恢复原值，phase 仍是 published，未动其它字段。
