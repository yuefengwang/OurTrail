# 出行方式解耦 — 实施报告（2026-10-08）

分支 `win/trip-mode-decoupling`，基线 `master@72e4520`。方案 A（投影优先解耦）。
取证基线见 `2026-10-08-trip-mode-self-shared-baseline-evidence.md`（同目录）。

## 0. 一句话结论

**没有重建状态机，也没有加任何 skip 开关。** 病根是 `selectors.rowView` 把 `trip.mode` 丢了，
下游只能用中文文案 `'自行前往'` 反推出行方式；本轮把语义补回投影、把散在 4 处的乘车义务收成
`permissions.js` 的 9 个谓词、堵掉服务端向 self 广播必被拒的动作、并从写入源头消灭 self 的
不可满足返程事实。域层 44 套门禁全绿（唯一 1 红是天气线常驻非确定性用例，与本轮无关）。

## 1. 修改文件清单（34 个 + 2 个新增）

| 层 | 文件 |
|---|---|
| 域（生产） | `domain/permissions.js` `domain/schema.js` `domain/signup.js` `domain/field.js` `domain/activity.js` `domain/allocation.js` `domain/invariants.js` `domain/selectors.js` |
| 域（lab 副本） | `cloudfunctions/trailApiLab/domain/*` 同名 8 个（由 `node tools/sync-lab.js` 同步，非手工） |
| 投影消费方（客户端） | `utils/format.js` `pages/signup/signup.js|wxml` `pages/editor/editor.js|wxml` `pages/activity/activity.js` `pages/workspace/workspace.js|wxml` `pages/vehicle/vehicle.js` `components/roster-panel` `components/transport-panel.js|.wxml` `components/field-panel` |
| 测试 | **新增** `tools/trip-mode-test.js`(78)；`scenario-signup`(→104) `scenario-activity`(→136) `scenario-workspace`(→114) `scenario-vehicle`(→56) `scenario-staff`(→18) |
| 文档 | `AGENTS.md` `README.md` `SYNC.md` `cloudfunctions/trailApi/domain/AGENTS.md` `miniprogram/AGENTS.md` **新增** 本文件 + 取证文件 |

`commands.js` / `contracts.js` / `store.js` / `index.js` **未改**。

## 2. 每个文件的核心修改

- **`permissions.js`** — 新增乘车义务谓词组（见 §3），`needsOutboundBoarding` 重写为其组合，真值表逐格保持原样。
- **`schema.js`** — `ReturnPlan` 增加 `own` 分支（无 evidence）。仅此一处 schema 变更。
- **`signup.js`** — `returnPlanFor(trip)` 成唯一映射（D6 写入源头）；`validTrip` 改为返回 Result 并给 mode 相关文案；`signup.edit` 在 `assigned ⇄ own` 间转换、保留已核实的 `independent`；`transport.js` 一行未动。
- **`field.js`** — `attendance.board` 先按出行方式拒（新文案「自行前往的参与者没有上车事实需要记录。」）、再按兼任司机拒、最后才是原有的「先安排乘坐车辆」；`attendance.returnPlan` 对 self 拒；返程清点判定改用 `returnBoardingApplies`/`needsReturnBoarding`；`vehicle.depart` 的返程未清点判定不再自己重述规则；删掉一处声明后从未被使用的 `participantDriver` 死变量。
- **`activity.js`** — `gathering→active` 的内联重述（`mode==='shared' && !participantDriver && !boarding`）换成 `needsOutboundBoarding()`；删除被引用上车点的守卫改读谓词。
- **`allocation.js`** — 本地司机 Set 换成共享构造器；`eligible` 过滤改 `needsVehicleService`；上车点匹配改 `isVehicleTraveller`。
- **`invariants.js`** — 新增两条钉（§7）；既有全部 shared 约束一字未动。
- **`selectors.js`** — `rowView` 新增 5 键（§4）；`assignmentFor` 变成 `passengerAssignment` 别名；`counters` 新增 3 个分桶；`permittedActions` 按义务广播；`getDetailState` 不再读文案；`selectExport` 加「出行方式」列；`vehicleTask.passengers` 带 `returnBoardingApplies`。

## 3. 「乘车义务」single source 的最终位置

`cloudfunctions/trailApi/domain/permissions.js:55-115`，9 个谓词，全部 `module.exports`：

```
isVehicleTraveller(signup)              出行方式本身是不是「需要乘车」
participantDriverSignupIds(state, aid)  本场兼任司机的报名 id 集合（allocation 的批取）
isParticipantDriver(state, signup)      该报名是否驾驶本场某辆车
passengerAssignment(state, signup)      当前的乘客座位安排（车辆须属同场）
needsVehicleService(state, signup)      = isVehicleTraveller && !isParticipantDriver   ← 承重谓词
needsSeatAssignment(state, signup)      = needsVehicleService && 还没有座位            ← 「待安排车辆」
needsOutboundBoarding(state, signup)    去程上车是否还欠                     （语义与旧实现逐格一致）
returnBoardingApplies(state, signup)    返程清点这件事对他是否存在
needsReturnBoarding(state, signup)      返程清点是否还欠
```

原先 4 处重复判断（`permissions.js:52-61` / `activity.js:166-169` / `selectors.js:432-433` /
`allocation.js:56`）现已全部改为调用，`grep -rn "trip\.mode" domain/` 剩下的都是**值级**用途
（构造 Trip union、比较新旧 mode、投影透传），不再是义务判断的第二个出处。UI 一律不推断。

## 4. `rowView` 最终结构（20 键）

```
signupId groupId name status avatar
tripMode            'self' | 'shared'        ← 新增，出行方式的唯一结构化出口
pickupPointId       shared 才有值，self 为 null  ← 新增
pickup              显示文案（self=自行前往；shared 且点没了=上车点信息缺失）
vehicle seat hasPassengerAssignment          ← hasPassengerAssignment 新增
checkedIn outboundBoarded returnBoarded
needsSeatAssignment needsOutboundBoarding needsReturnBoarding   ← 后两个原有，第一个新增
returnPlan departure home
```

`counters` 新增 `selfTravel` / `vehicleTravel` / `assigned`，`unassigned` 改由
`needsSeatAssignment` 统计（口径与旧实现等格）。`read` 是白名单投影，这次加键是**有意的安全面扩大**：
全部是布尔/枚举，不含任何敏感字段，且不按视角差异放行（`vehicle` 视角仍只看到本车乘客）。

## 5. 12 个耦合点的处理结果

| # | 位置 | 处理 |
|---|---|---|
| D1 | `selectors.js:115-131` 投影丢 `trip.mode` | ✅ `rowView` 下发 `tripMode` 等 5 键 |
| D2 | `activity.js:231` 拿文案反推 | ✅ 改读 `tripMode` |
| D3 | `selectors.js:537` `detailState` 读文案 | ✅ 改读 `needsSeatAssignment`（真值表逐格核对：self→ready、shared 已排→ready、兼任司机→ready、shared 未排→confirmed） |
| D4 | 义务规则 4 处 3 样 | ✅ 收成 §3 的 9 谓词 |
| D5 | 向 self 广播 `attendance.board` | ✅ 只在 `needsVehicleService && 已有座位` 时广播；`returnPlan` 只在 shared 时广播；`field-panel` 另按行级 `tripMode` 二次过滤 |
| D6 | self 的 `assigned` 返程脏事实 | ✅ §6 |
| D7 | 报名页 mode/上车点同下标、未知点→0 | ✅ §7 |
| D8 | `keepTogether` 无条件呈现 | ✅ `wx:if="{{needsVehicle}}"` |
| D9 | `transport-panel` 把 self 当「未分车」+ 指派候选 | ✅ 指派候选过滤为 shared；司机候选改按「未占用乘客座位」并**保留** self（自己开车来的人正是司机来源） |
| D10 | `field-panel` 给 self 打「无乘车安排」+ 硬编码拼车提示 | ✅ 副标题按 mode 分层；提示改由 `needsOutboundBoarding` 驱动 |
| D11 | 发布强制 ≥1 pickupPoint | ⛔ **保留不放宽**（§8） |
| D12 | 名单导出没有出行方式 | ✅ CSV 加「出行方式」列，self 的车辆类列写「不适用」而不是伪造「未上车」。附：**`utils/util.js` 的 `buildRosterTsv/buildRosterCsv` 是零调用点的死代码**（操作的是 `act.cars`/`s.seatNo` 这种早已不存在的形状），按 §23「不重构无关业务」保留原样，只在此登记 |

## 6. D6 修复方式（唯一真正的域层完整性缺口）

问题：`signup.js:76` 给每个人写 `returnPlan:{kind:'assigned'}`（原车返程），而 `invariants.js:98`
禁止 self 拥有任何 assignment ⇒ 这是一条**永远无法满足**的事实；`field.js:92` 当时还允许给 self
写返程安排（实测可写）。

修在源头，不删不变量：

1. `ReturnPlan` 增 `own`（自行往返）——**由 `trip.mode` 派生**，不带 evidence，
   `attendance.returnPlan` 命令的枚举仍是 `['assigned','independent']`，领队无法注入。
2. `returnPlanFor(trip)` 成为唯一映射，`registerParticipants` 建档时即写对。
3. `signup.edit` 翻转 mode 时在 `assigned ⇄ own` 之间转换；已核实过的 `independent`（带证据）
   两个方向都**不动**，也不抹掉任何返程事实。
4. `field.js` 对 self 直接拒 `attendance.returnPlan`。
5. 新增不变量（§7）兜底脏数据。
6. **不回填**：老 self 行仍存 `assigned`，但 `returnBoardingApplies`/`needsReturnBoarding`
   对它取「不适用」（⇒ 它不再产生任何义务），投影再按 `tripMode` 归一成 `own` 显示。
   这一条在 `trip-mode-test.js` 里有专门断言（「老数据里 self 残留的 assigned 被归一为 own」）。

## 7. D7 修复方式

拆成两个维度：`radio-group` 选出行方式（文案取 `format.js` 的 `TRIP_MODE_OPTIONS`，
带「我会自己到集合点 / 需要活动安排车辆」两行说明），仅 `shared` 时出现上车点 `picker`。
`tripValues/tripOptions/tripIndexOf/onPartTrip` → `pickupValues/pickupOptions/pickupIndexOf/onPartMode+onPartPickup`；
**`pickupIndexOf` 找不到点返回 -1（显示「请选择上车点」），不再返回 0 冒充自行前往**。
`tripLabel` 改为 `搭乘车辆 · <点名>`，点没了给 `上车点信息缺失`。折叠行也显示该摘要。
编辑模式（`mode==='edit'`）原本**根本没有出行方式控件**（`onEditTrip` 是绑不到 WXML 的死处理器），
现已接上 `onEditMode/onEditPickup`，`loadForm` 并发多读一次活动视图取集合点清单。

域侧本就有两道防线（`activity.js:34` 禁止删除被 shared 引用的点、`invariants.js:40` 禁止悬挂引用），
实测 `INVALID_INPUT` 生效 ⇒ 悬挂 shared 进不了库；本轮修的是渲染与投影，不是补洞。

顺带修掉同源的一处：**`editor.js` 发布时「选了搭乘车辆但没选上车点」会静默写成 `{mode:'self'}`**
——领队本人的报名不声不响变成不需要车。现拦下并给原因。

## 8. 关于 Activity 的 pickupPoint 约束（§18 的判定与依据）

**保留 `invariants.js:47` / `activity.js:20` 的「≥1 集合点」，不放宽。** 依据不是"测试更好过"，而是
产品代码自己已把这个字段定义为**活动的集合点**而非纯车辆上车点：
`editor.wxml:243` 写着「发布必填：至少 1 个集合上车点——用于统一出发与现场清点，
**大家自行前往时也请留一个出发点**」；`PickupPoint` 携带 `meetingAt/address/coordinates`；
self 参与者的生命周期里也有「自行前往**集合点**」这一步。车辆侧的耦合（`vehicle.pickupPointIds`
必须匹配报名点）只在 shared 路径上生效，本来就与 self 无关。
任务书 §19 Case 5 要求的是「0 vehicle / 0 driver / 0 assignment」，本轮实测该路径成立；
「0 集合点」既不是它要求的目标，放宽它又会伤到全员集合语义，因此明确不动，并在
`trip-mode-test.js` 里把「0 集合点仍被拒」钉成一条**正向断言**，防止后来者顺手删掉。

## 9. Leader 页面变化

- 指标「待分车」→「待安排车辆」，下面加一行构成：`全部已确认 N · 自行前往 X · 需要乘车 Y（已安排 Z）`。
- 「检查车辆与人员安排」这条待办在 `vehicleTravel === 0` 时**整条不出现**（不是显示一个 0）。
- 分车面板加「需乘车 M 人 · 自行前往 K 人（不在排车范围，可自行到集合点签到）」，
  并在没有人需要车时给专属空态：「这一场不需要排车……这里不需要任何操作，活动可以直接进入集合与签到」。
- 名单/现场副标题以出行方式打头；self 行不再出现 `未分车` / `无乘车安排` / `车辆待安排`。
- 现场面板不给 self 返程安排动作；车长页返程对不占本车的人显示「另行返程/自行往返」而不是「未上车」。

## 10. Participant 页面与主流程

报名即选「这次怎么去？」两选一（自行前往 / 搭乘车辆）；选自行前往不再要求上车点、
不显示同车约束，也不会进入任何待办。活动主流程文案链路由 `detailState` 承载：
`self → ready`，`shared 未排 → confirmed（已确认，等待车辆安排）`；
`DETAIL_STATE_TITLES.ready` 的正文从「检查集合时间、**上车点**与装备」改为「…**出行方式**…」，
使同一句话对两条路径都成立。车辆分配在语义与界面上都只是 shared 的协作子流程。

## 11. 10 个 E2E 结果（`tools/trip-mode-test.js`，78 断言，全绿）

| Case | 判据 | 结果 |
|---|---|---|
| 1 全部 self 走完生命周期 | 4 人 self → archived，硬指标 `0 vehicle / 0 driver / 0 assignment` | ✅ |
| 2 全部 shared 未退化 | 座位/上车/发车/返程清点/另行返程全链 + 4 条负向（未签到不能出发、座号数≠可用位、车辆越界上车点、同座两人 `SEAT_TAKEN`） | ✅ |
| 3 混合 2self+2shared | 分桶 全部4/自行2/需乘车2/待安排2 → 汇合 active → archived，`assignments=2` | ✅ |
| 4 shared 未分配 | 伪造 board `INVALID_INPUT`；未上车出发 `UNRESOLVED_DEPARTURE`；同场 self 照常推进；活动不得进 active | ✅ |
| 5 无车辆全 self | 同 Case 1；另加「0 集合点仍拒发布」正向钉 | ✅ |
| 6 self 不能分车 | `assignment.set` → `INVALID_INPUT「自行到达者不能分配乘客座位。」`；`planAssignments` 既不排他也不把他列为 unassigned；`assignment.swap` 也拉不进车 | ✅ |
| 7 self 不需要 boarding | 签到→核实出发→active 全程无 board；且 `permittedActions` 在 gathering/active/closing **都不含** `attendance.board`/`returnPlan`（正对照：混合活动排到车后必须含 board ✅） | ✅ |
| 8 shared→self | `assignments 1→0`、`returnPlan→own`、`boardingByLeg` 保持 null、投影 `needsSeatAssignment=false` | ✅ |
| 9 self→shared | 不自动产生 assignment；`returnPlan→assigned`；进入待安排；自动分车只出预览不写库 | ✅ |
| 10 已上车后切换 | 本人和被授权领队**都**被 `WRONG_PHASE` 拒，且拒绝文案同出一处（证明是 `travelLocked` 而非权限差异）；`trip.mode` 与既有上车事实均未改写 | ✅ |
| 附加 | 3 条脏数据反对照（self+上车事实、shared+own、self+座位）均被 `assertInvariants` 拒；D7 投影不因点缺失降级；导出列与 self 的「不适用」 | ✅ |

## 12. 全量测试结果

- `node tools/check.js` → **ALL CHECKS PASSED**；`node tools/check-handlers.js` → 30 个页面/组件全过（含改名后的 signup 17 handlers）。
- 门禁 **44 套**（43 个 `tools/*-test.js` + `smoke-test.js`）= **2845 断言**，`failed` 合计 **1**：
  `outdoor-intelligence-ui` 的 `✗ applySelection 命中 IN_CLOUD 窗口`——AGENTS.md 已登记的**常驻非确定性红**
  （打线上 Open-Meteo + 真实时钟），本轮改动前后一致，非新引入。
- 关键套件：smoke 173 · trip-mode 78 · scenario signup 104 / activity 136 / workspace 114 / vehicle 56 /
  staff 18 / editor 142 / me 143 · lab-dryrun 165 / trailapilab 25 ·
  e2e test 71 / permission 96 / domain-negative 83 / concurrency 44 / client-cas 54 / interleave 67 /
  panel-sync 40 / release-gap 51 / fault-probe 34 · weather-page 149。
- `e2e-concurrency` 2 条 `✗` 与 `e2e-client-cas` 1 条 `✗` 是**故意常红的 BUG-C1/BUG-C2 探针**（`failed=0`、exit 0），
  `e2e-fault-probe` 的 3 条是变异自证应有的红。均与本轮无关。
- `trailApiLab` 已同步（`synced 14 files`），8 个改动域文件与生产逐字节 `diff` 相同。
- 真机（微信开发者工具，auto-port 9423）：报名页实测 `tripModes` 与 `pickupOptions` 正确装配；
  默认 self ⇒ `needsVehicle=false`、摘要「自行前往」；驱动 `onPartMode('shared')` ⇒
  `trip={mode:'shared',pickupPointId:'pk-1'}`、`pickupIndex=0`、`needsVehicle=true`、摘要「搭乘车辆 · 茶店子地铁口」；
  `onPartPickup(1)` ⇒ `pk-2`；`validate()` 对合法组合返回 `{}`。**截图**在 `%TEMP%/ot-pics/`。
- **B 层 UI 端到端不写 UI PASS**：`page.$$('.radio-label')` 与 `radio` 在选择器通道上返回 0 个元素
  （滚动 0→1600px 均不可达），拿不到「一次真实 tap + 它的后果」这条硬判据 ⇒
  按 `docs/testing/e2e-result-semantics.md` 记 **INCONCLUSIVE**，不折算成 PASS。

## 13. 全局扫描：是否仍存在「文案反推 trip.mode」

```
grep -rn "=== '自行前往' | !== '自行前往' | includes('自行 | === '未分车' | === '搭乘车辆'" \
     miniprogram/ cloudfunctions/trailApi/ tools/
```
命中 **5 行，全部是注释或测试断言**：`activity.js:229`（我写的说明性注释）、`selectors.js:568`（同）、
`scenario-activity-test.js:342`、`scenario-signup-test.js:805`、`trip-mode-test.js:319`（断言"文案不再误导"）。
**生产代码判定用途：0 处。** `skipVehicle|skipDriver|noVehicle|isSelfDrive|跳过分车|暂不分车` 全库 **0 命中**。
`trip.mode` 的直读点只剩 schema/signup 的值级构造与 mode 差异比较，义务判断已无第二出处（§3）。

## 14. 是否还存在 Activity 级强制分车逻辑

无。`published→gathering→active→closing→archived` 五个 transition 里唯一涉及车辆的判据是
`gathering→active` 的逐人 joined 核实，而它经由 `needsOutboundBoarding` ⇒ self 天然为 false；
`vehicle.depart/complete` 只遍历本车乘客。归档门（`invariants.js:60-66`）与取消门只看
departure/home/incident，与出行方式无关。`workspace` 的排车待办在无人需要车时整条不出现。

## 15. schema / 数据迁移

- schema 变更 **1 处**：`ReturnPlan` 联合类型增加 `own` 分支。`schemaVersion` 仍为 **1**，
  **无迁移、无回填、无 seed 脚本**（仓库本就没有迁移机制）。
- 向后兼容：`own` 是新值，老数据不含它 ⇒ 校验只可能放过不可能拒；`assigned`/`independent` 的
  形状与必填 evidence 规则一字未改。老 self 行的 `assigned` 保留在库中但已被降级为惰性值
  （谓词不据它产生义务、投影据 `tripMode` 归一显示）。
- 严格模式陷阱已按 ADR-0003 处理：新增的是**枚举分支**而非字段，因此不需要"声明 optional"。

## 16. self/shared 的最终状态流

```
self   报名(trip=self) → 确认 → 签到 → 核实随队出发(joined) → 节点/位置 → 到家 → 归档
       不适用：上车点绑定 · 车辆 · 座位 · boarding · 返程乘车安排（returnPlan=own）
       仍然强制：签到 · joined 需签到事实 · home · 未解决异常不得归档
shared 报名(trip=shared+点) → 确认 → 待安排车辆 → 座位/司机 → 签到 → 去程上车 → 核实出发
       → 返程清点(仅 returnPlan=assigned 者) → 到家 → 归档
       约束一个没松：pickupPoint 有效且与车匹配 · capacity · blockedSeat · 同座不重复
                    · 同车组不拆 · confirmed 才能分车 · 发车后不可改写
```

## 17. 遗留问题 / blocker（都不需要放宽约束，均已定位）

1. **P0 发布顺序（阻塞）**：线上部署的 `trailApi` 仍是旧版，**不返回 `tripMode`**。真机实测工作台
   `counters.selfTravel === undefined`（输出「全部已确认 0 · 自行前往 undefined …」）。
   ⇒ **必须先重新部署 trailApi，再发小程序**，否则各面板的出行方式栏会空白降级。
   本轮没有部署：部署是共享环境的动作，且 CLI 部署不继承控制台 20s 超时（AGENTS.md 坑 7），需人工复核。
2. **P2 真机真实 tap 通道**：`.radio-label` / `radio` 元素在选择器里不可达（同 `e2e-golden-path-test.js:924`
   当年记的「出行方式是原生 picker 驱不动」是另一形态的同一问题——控件已换型，可达性没换）。
   signup 的 UI 判据停在 BUSINESS PASS。后续若要转正，需要先解决 automator 对表单区元素的选取。
3. **P3 `returnPlan` 对"self 来、shared 回"的表达力**：`invariants.js:98` 使 self 永远拿不到座位，
   因此 self 参与者**不可能**搭活动车返程，`own` 是当前模型下唯一诚实的值。
   若产品要允许这种混合返程，那就是任务书 §23 明令禁止的 per-leg 出行状态，需要单独立项，不在本轮。
4. **P3 `utils/util.js` 的 `buildRosterTsv/buildRosterCsv`** 是零调用点死代码且形状早已失效（§5 D12）。
5. **P3 现场面板的 `canEdit`** 仍只在 `published` 阶段开放（`activity.js:411`），而域层允许领队在
   `gathering` 协调未出发者 ⇒ 领队页缺一个入口。本轮未补（属独立缺口，与出行方式解耦无关）。
