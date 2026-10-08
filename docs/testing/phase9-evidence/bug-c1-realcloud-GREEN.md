# BUG-C1 真云端验证（Phase 9.3）——修复后

· 运行时间：2026-10-07 14:28（本地）
· 通道：**REAL CLOUD**（微信开发者工具模拟器 + 已部署的线上 trailApi；客户端 = `D:/OurTrail-p9` 工作树，`cli open` + `cli auto --auto-port 9425`，收尾只 `disconnect`，未 quit / 未 close）
· 驱动：`%LOCALAPPDATA%\Temp\opencode\mp-auto\p9-bugc1-verify.js`（Phase 8 的 `p8-bugc1-real3.js` 同源改造，加 `mp.evaluate` 读 `this.revision` 实例属性——`data()` 看不见它）
· 沙盒行：`activity-muns9s5oyqeo98`（`[预演] 工作台E2E`，phase=published/行前准备，title 不在 lockedKeys）——收尾已恢复原 title
· 有效性门：B 必须真的落库，否则整轮记 INVALID（Phase 8 的 v1 教训保留在驱动里）

## 判据（任务书 §4 十步）

| 步 | 要求 | 实测 |
|---|---|---|
| 1 | 建 sandbox activity | 用既有 `[预演]` 行（禁止再造新行）R0=4624 |
| 2 | Editor A 读取 revision R | A `this.revision` = **4624**（类型 number） |
| 3 | Editor B 读取同一 revision R | B `this.revision` = 4624 |
| 4 | B 修改并保存 | landed=true，写耗时 5798 ms |
| 5 | 等待 B read-back 确认 R+1 | 权威读 revision = 4625 |
| 6 | A 使用 stale form 保存 | A 的 form.title 仍是开页值「[预演] 工作台E2E」，`this.revision` 仍是 4624 |
| 7 | 必须收到 CONFLICT | **是**：`failure=「安排已更新，本次修改没有保存。请核对最新状态后重新提交。」`，`landed=false`，耗时 4171 ms |
| 8 | authoritative read：B 的修改仍在 | title = `P9-real-B-muy7btv5`（B 的值），首读即命中 |
| 9 | revision 只因 B 推进一次 | 4624 → 4625，**delta = 1** |
| 10 | 不允许 A 的 stale write 覆盖 B | 未覆盖 |

## 与 Phase 8 定罪读数的对照（同一行、同一脚本形状）

| | Phase 8（修复前） | Phase 9（修复后） |
|---|---|---|
| A 的 `expectedRevision` | `undefined` | 4624（number） |
| A 的结果 | `landed` 成功 | **CONFLICT 拒绝** |
| revision 变化 | 4621 → 4623（+2，双方都算成功） | 4624 → 4625（+1，只有 B） |
| 终态 title | 被 A 的陈旧值覆盖 | 保持 B 的写入 |

## VERDICT

`FIXED：A 的陈旧保存被 CONFLICT 拒绝；B 的写入存活；revision 只因 B 推进一次（R0=4624→Rf=4625）`

## 原始 LEDGER

```json
{
  "initialRevision": 4624,
  "initialTitle": "[预演] 工作台E2E",
  "phaseLabel": "行前准备",
  "A_formTitleAtOpen": "[预演] 工作台E2E",
  "A_revisionAtOpen": 4624,
  "A_revisionTypeAtOpen": "number",
  "B_revisionAtOpen": 4624,
  "B_result": { "landed": true, "failure": "", "latencyMs": 5733 },
  "B_writeLatencyMs": 5798,
  "A_formTitleAtSave": "[预演] 工作台E2E",
  "A_revisionAtSave": 4624,
  "A_result": {
    "landed": false,
    "conflicted": true,
    "message": "",
    "failure": "安排已更新，本次修改没有保存。请核对最新状态后重新提交。"
  },
  "A_writeLatencyMs": 4171,
  "conflictError": "安排已更新，本次修改没有保存。请核对最新状态后重新提交。",
  "firstReadTitle": "P9-real-B-muy7btv5",
  "firstReadRevision": 4625,
  "firstReadHit": true,
  "authoritativeTitle": "P9-real-B-muy7btv5",
  "authoritativeRevision": 4625,
  "convergeSamples": 1,
  "convergeHitMs": 2824,
  "revisionDelta": 1,
  "verdict": "FIXED：A 的陈旧保存被 CONFLICT 拒绝；B 的写入存活；revision 只因 B 推进一次（R0=4624→Rf=4625）",
  "restore": { "landed": true, "title": "[预演] 工作台E2E", "syncKey": "published@4626" }
}
```

## 读到的附带量测（正式测量见 Phase 9.6）

- 单次云读 RTT ≈ 2824 ms（`ws.callMethod('reload')` 一轮）
- 写往返：B 5798 ms / A（被拒）4171 ms
- 本轮 B 落库后 A 的**首读即命中**（`firstReadHit=true`，采样 1 次）——与 Phase 8 记的「首读即命中、n 不足以判 20 s 滞后」同向，不构成"滞后不存在"的结论。

## 沙盒恢复声明

终态 title = `[预演] 工作台E2E`（原值），内容零残留。revision 是不可逆的全局计数器，恢复写把它推进到 4626——这是"恢复动作本身是一次合法写入"的必然结果，不是数据未恢复。
