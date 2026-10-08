# 出行方式解耦 — 现状取证（Baseline Evidence, 2026-10-08）

> 本文件只做**取证**，不含设计方案。所有结论均由真实域代码实测得出，不是阅读推断。
> 探针脚本在仓库外（`%TEMP%/ot-probe/`），require 的是 `cloudfunctions/trailApi/domain/` 真实模块，
> 未打桩、未复刻页面逻辑。基线 commit `72e4520`。

## 一、总结论

**「活动主流程过度依赖司机/车辆/座位分配」在阶段门（transition）上已经证伪，在投影层（selector）与 UI 层上成立。**

实测：域层不存在 `allParticipantsAssigned` 这类硬条件。`published→gathering→active→closing→archived`
五次推进中，只有 `gathering→active` 逐人核实「签到 + 必要的去程上车」，而该核实已由
`permissions.js:52-61 needsOutboundBoarding()` 在 `trip.mode !== 'shared'` 时直接返回 false。

两条必须支持的正式业务路径**今天已经跑通**：

| 用户要求的 Case | 实测结果 | 关键证据 |
|---|---|---|
| Case 1 全部 self，0 vehicle / 0 driver / 0 assignment，走完整生命周期 | **已 PASS** | 4 人 self → archived，`vehicles=0 assignments=0` |
| Case 3 混合（3 self + 2 shared + 1 车） | **已 PASS** | 全部 checkin，shared 两人 board+depart，5 人 departure=joined → archived |
| Case 4 shared 未分配不得伪造 boarding | **已 PASS** | `attendance.departure joined` → `UNRESOLVED_DEPARTURE「请先核实签到及必要的去程上车。」` |
| Case 6 self 不允许 assignment | **已 PASS** | `assignment.set` → `INVALID_INPUT「自行到达者不能分配乘客座位。」`（`invariants.js:98`） |
| Case 7 self 不需要 boarding | **已 PASS** | self 无 board 也能 `departure=joined`；`counters.unassigned` 不计 self（`selectors.js:432`） |
| Case 8 shared→self 正确解除 assignment | **已 PASS** | 翻转后 `assignments 1→0`，`boardingByLeg` 保持 null |
| Case 9 self→shared 进入待分车而非自动分配 | **已 PASS** | 二次翻转后 `assignments=0`，无伪造 |
| Case 10 已上车后禁止切换出行方式 | **已 PASS** | `signup.edit` → `WRONG_PHASE`（`travelLocked`，`signup.js:82-88`） |
| Case 2 全部 shared 未被破坏 | 未单测（既有 smoke/e2e 已覆盖） | — |
| Case 5 self 活动可以没有任何 pickupPoint | **FAIL** | `activity.publish` → `INVALID_INPUT「发布需要完整的标题、活动时间、集合信息、路线节点与风险说明。」` |

**所以真正要修的不是状态机，而是「投影丢掉了 trip.mode，导致下游只能用中文显示字符串反推出行方式」这一条，
以及由它派生的 10 个耦合点。**

## 二、缺陷清单（按 领域模型 → Invariant → Command → Selector → UI 排序）

### D1 投影层不下发 `trip.mode`（承重缺陷，其余 UI 缺陷的总根因）
`selectors.js:115-131` `rowView()` 返回 15 个键：`signupId groupId name status avatar pickup vehicle seat
checkedIn outboundBoarded returnBoarded needsOutboundBoarding returnPlan departure home`。
**没有 `trip` / `tripMode` / `pickupPointId` 中的任何一个。**
实测 self 与 shared 的行唯一的区别只有 `pickup` 字段是 `'自行前往'` 还是上车点名称——一个**显示文案**。

### D2 客户端用中文字面量反推业务语义
`miniprogram/pages/activity/activity.js:231`
`r.vehicle || (r.pickup !== '自行前往' ? '车辆待安排' : '')`
一旦上车点被命名为「自行前往」，或文案被改写，业务判断即错。这是 D1 的直接后果。

### D3 状态机读显示字符串
`selectors.js:537` `detailState`：
`return signup.pickup === '自行前往' || !!signup.vehicle ? 'ready' : 'confirmed'`
`getDetailState` 用文案做状态判断（同文件 525 行还导出 `DETAIL_STATES` 供客户端枚举）。
文案与状态机耦合，违反「不镜像页面逻辑/单一出处」既有约定。

### D4 「乘车义务」规则重复 4 处、3 种写法（漂移风险）
| 位置 | 写法 |
|---|---|
| `permissions.js:52-61` | `needsOutboundBoarding()`：mode + participantDriver + assignment + boarding |
| `activity.js:166-169` | 内联重述 `signup.trip.mode === 'shared' && !participantDriver && !record.boardingByLeg.outbound` |
| `selectors.js:432-433` | `s.trip.mode === 'shared' && !assignmentFor(...) && !participantDriverVehicle(...)` |
| `allocation.js:56` | `s.trip.mode === 'shared' && !drivers.has(s.id)` |

`domain/AGENTS.md` 已把 `needsOutboundBoarding` 定为 single source，但 `activity.js` 与 `selectors.js` 各自另写了一遍。
**这正是用户要求的「隐式假设」在本仓库的真实形态。**

### D5 服务端向 self 参与者广播必被拒的动作（permittedActions 说谎）
实测 `phase=gathering/active/closing` 时 `permittedActions` 含 `attendance.board`；
而 `field.js:73` 对 self 直接 `INVALID_INPUT「请先安排本人的乘坐车辆。」`。
`miniprogram/AGENTS.md` 记录过同类 bug（P4「读取数 slot」/「按钮点了只换来红字」）。

### D6 self 参与者的 `returnPlan` 是一个可满足性为零的事实（唯一真正的域层完整性缺口）
- `signup.js:76` 给**每个人**建 `returnPlan: { kind: 'assigned' }`（原车返程）。
- `invariants.js:98` 又禁止 self 拥有任何 assignment ⇒ self 永远不可能出现在某辆车上。
- `field.js:92` `attendance.returnPlan` 不校验 `trip.mode`。实测**成功**为 self 参与者写入
  `independent`，也**成功**写回 `assigned`。
⇒ 结果：3 名 self 参与者的履约记录声称「原车返程」，而系统里没有任何一辆车会载他们回家。
这是脏事实，不是显示问题，且 `vehicle.depart` 的返程清点（`field.js:46`）只看 assigned 乘客，永远不会发现矛盾。

### D7 报名页把「出行方式」与「上车点」压成同一个 picker index
`signup.js:102-103` `tripValues = ['self'].concat(pickupPoints.map(p => p.id))`、
`tripOptions = ['自行前往'].concat(names)`；`tripIndexOf`（`:260-264`）对任何非 `shared` 返回 0。
⇒ 一个 `shared` 报名，若其上车点被删除，界面**渲染为「自行前往」**，用户以为自己是 self。
这是数据正确性问题，不只是观感问题。

### D8 「尽量安排同行人同车」对所有参与者无条件呈现
`signup.wxml:160-168`（`keepTogether`）不区分 mode；全部 self 时该选项无意义却仍出现。

### D9 self 参与者被当作「待分车」的司机候选
`transport-panel.js:119-125`：`confirmed` 与 `driverCandidates` 都以 `!r.vehicle` 过滤 ⇒ self 参与者
被标注「未分车」并列为「参与者司机」候选。司机候选的语义本来是对的（self 的人完全可以自己开车来当司机），
但**「未分车」这个标签对 self 是假的**。

### D10 现场面板对 self 打印「无乘车安排」
`field-panel.js:80` `r.pickup + ' · ' + (r.vehicle || '无乘车安排')`；
`field-panel.js:166` 硬编码提示「此人拼车随队：请先在车长任务页点『确认上车』」。

### D11 发布强制 ≥1 个 pickupPoint（Case 5 唯一真实 FAIL）
`activity.js:20` 与 `invariants.js:47`：非 draft/cancelled 活动要求 `activity.pickupPoints.length`。
错误文案把 `pickupPoints` 称为「集合信息」——即该字段同时承担「集合点」与「上车点」两种语义。
全 self 活动仍然必须先填一个 boarding 意义上的上车点才能发布。

### D12 导出/名单没有「出行方式」列
`selectors.js:216` CSV 表头 `[姓名, 报名状态, 上车点, 车辆, 座位, 签到, 去程上车, 返程上车, 到家]`
没有出行方式列；`utils/util.js:45,59-61,80-82` TSV/CSV 同样硬编码「未指定」「未分车」兜底。
`utils/format.js` 里**不存在「搭乘车辆」**这个词；「自行前往」只以散落的字面量出现
（`signup.js:103,281`、`activity.js:231`、`editor.wxml:480`），没有 label map。

## 三、附带事实（会影响计划，不影响结论）

1. **`cloudfunctions/trailApiLab/domain/` 是生产 domain 的完整副本**（`schema.js`/`selectors.js`/`signup.js`
   同源行号已核对）。改完 `trailApi/domain/*` 必须 `node tools/sync-lab.js`，否则 `lab-dryrun` 红（AGENTS.md 已记）。
2. 现有测试对 self 的使用是**零散**的：`e2e-interleave-test.js:116`、`e2e-release-gap-test.js:111/168/235`、
   `e2e-concurrency-test.js:365`（注释已写明「两位参与者都走 self，所以 board 腿天然不适用」）、
   `scenario-signup-test.js:435/482/793`。没有任何一套是「self/shared 双路径 × 生命周期」的正向矩阵。
3. `git pull` 失败：`192.168.3.15` 与 `192.168.2.22` 两个中继 IP 的 22 端口均超时。
   本轮基线是本机 `master@72e4520`，**未确认另一台机器没有推进过**。
4. 探针暴露的两处非缺陷（澄清，避免误读为 bug）：
   `published` 阶段之前不能 `signup.submit`（`signup.js:102` 设计如此）；
   `closing→archived` 要求逐人 `home`，与 mode 无关（`invariants.js:60-66`）。
