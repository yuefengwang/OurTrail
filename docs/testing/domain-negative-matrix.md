# Domain Boundary / Negative Matrix（Phase 7）

> 「用户在错误的时间/状态/对象/参数下操作、重复执行、多操作冲突时，系统是否稳定、明确、可预测地拒绝？」
> 所有 Expected 从现行 domain 代码推导（错误码全集见 `domain/contracts.js ERROR_CODES` +
> 各 handler + `invariants.js` 不变量层）。证据由 `tools/e2e-domain-negative-test.js`
> （A 层真实信封）填充。规则不明确处标 NEEDS_PRODUCT_DECISION。

## 域的拒绝路径分层（审计结论）

1. **入口层**（index.js main）：未知 action → INVALID_INPUT；未登录 → AUTH_REQUIRED。
2. **schema 层**（commands.js:100-113 + schema.js）：载荷缺字段/类型错 → INVALID_INPUT（在 canExecute **之前**）。
3. **权限层**（permissions.js canExecute）：错误身份/跨活动目标 → FORBIDDEN / NOT_FOUND / AUTH_REQUIRED / CONSENT_REQUIRED。
4. **幂等/CAS 层**（commands.js:116-122）：同 requestId+同 fingerprint → replayed:true（真幂等）；
   同 requestId+异 fingerprint → REQUEST_REUSED；expectedRevision≠当前 → CONFLICT。
5. **handler 业务层**（activity/signup/transport/field/profile/notices）：WRONG_PHASE / CAPACITY / GROUP_SCOPE 等。
6. **不变量层**（invariants.js，落库前对整个 state 校验）：SEAT_TAKEN / PICKUP_MISMATCH /
   DRIVER_CONFLICT / VEHICLE_FULL / DUPLICATE_PERSON / GROUP_SCOPE（写后校验——命令的临时
   状态被全量复检，失败则整体不落库 ⇒ 天然零副作用）。

**错误码全集（17，实测频次）**：INVALID_INPUT×50 · WRONG_PHASE×37 · NOT_FOUND×20 ·
DRIVER_CONFLICT×9 · UNRESOLVED_DEPARTURE×7 · FORBIDDEN×5 · CONFLICT×4 · CAPACITY×4 ·
VEHICLE_FULL×3 · UNRESOLVED_SAFETY×3 · GROUP_SCOPE×3 · CONSENT_REQUIRED×3 ·
DUPLICATE_PERSON×2 · AUTH_REQUIRED×2 · SEAT_TAKEN×1 · REQUEST_REUSED×1 · PICKUP_MISMATCH×1。

## 既有覆盖 vs 本阶段缺口（基线 a98fedb 实测 grep）

| 错误码 | smoke | A 层 | 权限 | UI-State | 本阶段 |
|---|---|---|---|---|---|
| PICKUP_MISMATCH | 0 | 0 | 0 | 0 | **补** |
| VEHICLE_FULL | 0 | 0 | 0 | 0 | **补** |
| GROUP_SCOPE | 0 | 0 | 0 | 0 | **补** |
| REQUEST_REUSED | 0 | 0 | 0 | 0 | **补** |
| DUPLICATE_PERSON | 0 | 0 | 0 | 0 | **补** |
| CAPACITY（边界 N/N+1） | 0 | 0 | 0 | 0 | **补** |
| SEAT_TAKEN | 0 | 5 | 0 | 0 | 已有，回归确认 |
| DRIVER_CONFLICT | 0 | 3 | 0 | 0 | 已有，回归确认 |
| CONFLICT（CAS） | 0 | 6 | 0 | 1 | 已有，补确定性双 actor 语义 |
| UNRESOLVED_DEPARTURE | 0 | 2 | 1 | 2 | 已有 |

## A. NOT_FOUND（资源不存在 × 无副作用）

| Command | Invalid condition | Expected | Expected state | Status |
|---|---|---|---|---|
| dispatch 任意带 signupId | signup-404 | NOT_FOUND | 全态不变 | |
| dispatch 任意带 vehicleId | vehicle-404 | NOT_FOUND | 全态不变 | |
| membership.revoke | membership-404 | NOT_FOUND | 全态不变 | |
| assignment.set | 跨活动 vehicleId | FORBIDDEN（车辆不属于此活动——requireVehicles 归属） | 全态不变 | |
| attendance.* | 跨活动 signupId | FORBIDDEN（报名记录不属于此活动） | 全态不变 | |
| dispatch 任意 | activityId-404 | NOT_FOUND | 全态不变 | |

## B. INVALID_INPUT（schema 层，canExecute 之前）

| Command | Invalid condition | Expected | Status |
|---|---|---|---|
| activity.create | input 缺 title / pickupPoints 空数组 | INVALID_INPUT | |
| vehicle.save | legalCapacity='abc'（类型错） | INVALID_INPUT | |
| signup.review | signupIds=[]（空数组违反 specArr(_,1)） | INVALID_INPUT | |
| signup.review | signupIds 重复 | INVALID_INPUT「请选择不重复的报名记录」 | |
| attendance.checkin | manual 无 note | INVALID_INPUT「人工签到需要现场核实依据」 | |
| profile.save | person.name 空 | INVALID_INPUT + 字段级 errors | |

## C. WRONG_PHASE（阶段×命令矩阵）

| 阶段 | Command | Expected |
|---|---|---|
| draft | signup.submit | WRONG_PHASE |
| draft | attendance.checkin | WRONG_PHASE |
| published | attendance.* | WRONG_PHASE |
| published | vehicle.save | ALLOW（organizer 备车）——确认实际契约 |
| gathering | signup.submit | WRONG_PHASE（截止/阶段） |
| gathering | signup.review | WRONG_PHASE「当前活动阶段不能变更报名资格」 |
| active | attendance.checkin（非迟到） | WRONG_PHASE「签到仅用于集合或已记录的迟到补到」 |
| archived | vehicle.save / signup.review / attendance.* | WRONG_PHASE |
| 跳段 | published→active（跳过 gathering） | WRONG_PHASE「不允许跳过或回退活动阶段」 |

## D. Capacity 边界（capacity=2 沙盒）

| 步骤 | Expected |
|---|---|
| 第 1 人 submit | ALLOW（pending）→ confirm |
| 第 2 人 submit | ALLOW → confirm（满员 N） |
| 第 3 人 submit（N+1） | ALLOW→waitlisted（「剩余名额不足以接收整组参与者，请明确选择候补」——submit 是显式候补模式）或 CAPACITY；confirm waitlisted 亦 CAPACITY |
| promote 超额 | CAPACITY「名额不足，整批候补均未变更」 |
| 取消 1 人后 | 名额释放（取消后重提交可进） |

## E. PICKUP_MISMATCH（历史审计缺口，确定性测试）

| 场景 | Expected |
|---|---|
| 车辆只覆盖 pk-1，参与者上车点 pk-2，assignment.set 强排 | PICKUP_MISMATCH「车辆不经过这位参与者的上车点」+ 全态不变 |
| vehicle.save 引用不存在 pickupPointId | INVALID_INPUT（transport.js 校验「集合点不属于本场活动」）——两码区分 |

## F. Cancel 边界

| 状态 | Expected |
|---|---|
| published+pending | ALLOW |
| gathering+confirmed 未出行 | ALLOW |
| 已出行（departure=joined） | WRONG_PHASE「出发或上车后不能取消报名」 |
| cancelled 后再 cancel | WRONG_PHASE（isCurrentSignup=false） |
| 参与者司机未换 | DRIVER_CONFLICT「请先更换参与者司机」 |

## G. Incident 边界

| 场景 | Expected |
|---|---|
| 不存在 activity | NOT_FOUND |
| subjects 不在活动 | FORBIDDEN/NOT_FOUND |
| 重复 report 同一 subject | 实际契约（incident 允许多条还是去重）——记录实际行为 |

## H. Duplicate / Idempotency

| Command ×2 | 第二次 Expected |
|---|---|
| signup.submit 同 requestId 同内容 | replayed:true，状态零变化（真幂等） |
| signup.submit 同 requestId 异内容 | REQUEST_REUSED |
| checkin ×2 | 第二次的行为按实际契约记录（record.checkIn 已设——是幂等还是 WRONG/INVALID） |
| review confirm ×2（第二人称对已 confirmed） | WRONG_PHASE「只有待确认报名可以审核」 |
| vehicle.save 同 id ×2（重复保存） | ALLOW（更新语义）——确认无重复车辆产生 |
| home ×2 | 实际契约记录 |

## I. Seat / Driver 冲突（回归确认 + 补充）

| 场景 | Expected |
|---|---|
| 同座两人 | SEAT_TAKEN + 原安排不变（已有 A 层） |
| 座号不在车辆 seatLabels | INVALID_INPUT「所选座号不属于这辆车」 |
| 司机重复占座 | DRIVER_CONFLICT（已有） |
| 核载<司机+禁用 | VEHICLE_FULL「核载减去司机及不可用位后不能为负数」 |
| 乘客数>可用位 | VEHICLE_FULL「乘客人数超过可用乘客位」 |

## J. 确定性 CAS（过期 revision 重放；并发窗口留 Phase 8）

| 场景 | Expected | 实测 |
|---|---|---|
| 持过期 revision（当前-1）写 | CONFLICT「安排已更新，本次修改没有保存」 | ✓ 实测 |
| 败者零副作用 | transport 状态不变 | ✓ 实测 |
| revision 跳跃 | 无（CONFLICT 后仍=当前） | ✓ 实测 |
| 同 tick 双写（真并发） | 留 Phase 8（套件内实测两写均 ok——桩的事务交叠窗口；真云事务语义待 Phase 8 验证） | — |

## K. 实测发现（83 断言运行后回填）

1. **draft 阶段 create 允许空 pickupPoints**（specArr 不设下限）——完整性门在**发布**时
   （「发布需要完整的标题、活动时间、集合信息…」）。契约自洽，非缺陷；已按实际语义钉住。
2. **拒绝检查的顺序语义**：阶段门先于字段校验（published checkin 空 note → WRONG_PHASE 优先）；
   不变量先查 PICKUP 再查 SEAT（移除 PICKUP 门后同座错误码变为「座号不属于这辆车」——
   M3 变异顺带证明）。已按实际顺序钉住。
3. **容量门是双层串联**：promote 层（signup.js「名额不足，整批候补均未变更」）+
   不变量层（invariants「待确认与已确认人数超过活动名额」）。M2 变异实测：移除单层
   另一层仍拦（纵深防御生效）；两层同移 → 超容 mutation 实际发生（2 红）。
4. **过期授权写入时即拒**（INVALID_INPUT，Phase 6 已记）——负矩阵确认 staffCan 过期分支不可达。
5. **重复取消已 cancelled 行**：命中 travelLocked 文案分支（「出发或上车后不能取消报名」）而非
   isCurrentSignup 专属文案——错误**码**正确（WRONG_PHASE），文案不精确（低危 UX 观察，不修）。
6. **未出行者 home（closing）**：域按实际语义处理（非出行者也能记 home/或拒——如实记录，见套件
   J 段「实际契约」行），未强行判定。
7. **本阶段未发现 DATA INTEGRITY / SECURITY BUG**：全部 17 种错误码语义精确、
   每个拒绝都验证了零副作用（快照对比含 revision）。

## 需产品决策 / 跟进

- activity.edit 两层门不一致（Phase 6.1 遗留）——**不在本阶段处理**，仅确认不污染矩阵。
- read-after-write 20s+ 滞后、workspace 推进静默无效果——NEEDS_PRODUCT_FOLLOWUP（不修）。
- 同 tick 双写的行为（桩内两写均 ok）——Phase 8 concurrency 专项。
- 重复取消的文案不精确（WRONG_PHASE 码下 travelLocked 文案盖过 isCurrentSignup 语义）——低危 UX 观察。
