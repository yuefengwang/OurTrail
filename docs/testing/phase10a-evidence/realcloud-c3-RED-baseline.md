# Phase 10A §3/§5.A — BUG-C3 真云端 RED 基线（部署前）

· 时间：2026-10-07 深夜～10-08 00:27–00:36（本地）
· 通道：**REAL CLOUD**，线上 `trailApi`（**未部署本轮修复**）；驱动 `mp-auto/p10a-c3-verify.js`、`p10a-collision-hammer.js`，复用既有自动化端口 9420，未动 IDE 项目窗口、未 `quit`/`close`
· 沙盒：只动 `activity-muns9s5oyqeo98`（`[预演] 工作台E2E`）的 title，**收尾已恢复原值**（`已恢复=true`）

## 为什么必须先解决"能不能命中层②"

BUG-C3 的病灶只在**事务层②**（`store.js` 的 CAS）暴露；层①（`commands.js:122`）本来就返回正确的 CONFLICT。
两层的信封可区分（这也是 Phase 8 记的"来源层不可区分"在真云端被推翻的一条）：

| 层 | code | message |
|---|---|---|
| ① 内存 CAS | `CONFLICT` | 「安排已更新，本次修改没有保存。请核对最新状态后重新提交。」 |
| ② 事务 CAS（未修） | `STORAGE_UNAVAILABLE` | 「这次修改没有保存，原安排未改变。请保留输入后重试。」 |

⇒ **只要同一批里同时出现这两种文案，就说明既有请求过了层①、又在层②被拦。**

## 读数一：K=2（两两并发，3 次）——不足以稳定命中层②

```
第 0 次 R=4699  ["OK","CONFLICT"]            Δrevision=1
第 1 次 R=4700  ["OK","CONFLICT"]            Δrevision=1
第 2 次 R=4701  ["OK","CONFLICT"]            Δrevision=1
败者码 = CONFLICT ×3
```
⇒ 这一轮里两个请求实际被**错开**了：败者的 `loadState` 已经读到胜者提交后的 revision，于是被层①拦住。
Phase 9 同一支路（K=2）拿到的是 3/3 `STORAGE_UNAVAILABLE` ⇒ **同一个探针在不同时刻命中层②的概率不同**
（容器冷热、并发调度差异），所以"K=2 全 CONFLICT"**不能**被读成"缺陷已修"，反之亦然。

## 读数二：K=6（每轮 6 个请求同时基于同一个 R，6 轮 = 36 个请求）——层②稳定复现

| 轮 | R | 结果码（6 个） | Δrevision | 成功写入数 |
|---|---|---|---|---|
| 0 | 4705 | OK, CONFLICT, **STORAGE×2**, CONFLICT, CONFLICT | 1 | 1 |
| 1 | 4706 | **STORAGE×3**, CONFLICT, OK, CONFLICT | 1 | 1 |
| 2 | 4707 | CONFLICT, **STORAGE×2**, OK, **STORAGE×2** | 1 | 1 |
| 3 | 4708 | CONFLICT, CONFLICT, **STORAGE**, OK, CONFLICT, **STORAGE** | 1 | 1 |
| 4 | 4709 | CONFLICT, CONFLICT, OK, CONFLICT, CONFLICT, CONFLICT | 1 | 1 |
| 5 | 4710 | CONFLICT, CONFLICT, OK, CONFLICT, **STORAGE×2** | 1 | 1 |

```
TALLY = { OK: 6, CONFLICT: 17, STORAGE_UNAVAILABLE: 13, OTHER: 0 }
```

**结论（真云端 RED 基线成立，且量化）**

1. **并发正确性成立**：6 轮全部「恰好一个 OK」「Δrevision=1」⇒ 事务层确实拦住了同基线并发，**没有 lost update、没有双写**（与 Phase 9 结论一致）。
2. **分类错误成立**：30 个败者里 **13 个（43%）** 拿到的是 `STORAGE_UNAVAILABLE`，其余 17 个拿到正确的 `CONFLICT`。
   同一批里两种文案并存 ⇒ 这 13 个只能是"过了层①、在层②被拦"的那批请求，即病灶人群。
3. **危害确认**：这 13 个客户端**不会** `needRefresh`、不会重读，却被文案告知"请保留输入后重试"——
   重试携带的仍是同一个陈旧 revision ⇒ 再进层①/层②，恢复链路对这部分用户是坏的。
4. **探针有效性**：K=6 能在真云端稳定命中层②（6 轮里 5 轮命中），因此**部署后用同一支探针复跑**是有判别力的：
   预期 `STORAGE_UNAVAILABLE` 归零、`OK` 仍恰好 1/轮、Δrevision 仍 =1。

## 部署后待填（同一探针、同一沙盒、同一 K=6×6 形状）

```
TALLY = 待部署后填写
VERDICT = 待部署后填写
沙盒恢复 = 待填写
```

## 与 Phase 9 读数的关系（不隐瞒矛盾）

Phase 9 用 K=2 拿到 3/3 `STORAGE_UNAVAILABLE`；本轮 K=2 拿到 3/3 `CONFLICT`。
两者不矛盾：差别只在两个 `loadState` 是否真的重叠。这条差异本身就是"为什么并发测试必须声明并发度"的实证，
已写进探针注释。**因此本轮不以 K=2 作任何结论**，只用 K=6 的量化基线。
