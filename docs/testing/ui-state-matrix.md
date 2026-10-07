# UI State Matrix（Phase 5）

> 状态 × UI 可操作性 × 域规则的对照矩阵。所有"domain 允许/拒绝"均从
> `cloudfunctions/trailApi/domain/` 现行代码推导（signup.js / field.js / transport.js / activity.js），
> "UI 可用性"从组件现行代码推导（roster-panel.js `canReview/canPromote/canCancel`、
> field-panel.js 按行事实收放、transport-panel busy 门控）。
> 自动化证据列指向实际产生证据的测试。规则不明确处标 `NEEDS_PRODUCT_DECISION`。

## 三类历史反例（本矩阵的建立动机）

| 反例 | 类别 | 机制 | 现在 由谁捕获 |
|---|---|---|---|
| BUG-A | **Data Binding Integrity** | WXML 绑定不能调方法：`checked="{{vform.pickupIds.indexOf(item.id) !== -1}}"` 求值 undefined，`undefined !== -1` 恒真 ⇒ 勾选框恒显示已选、勾选落不进 vform | `e2e-ui-state-test.js` TEST-UI-001（点击→渲染态→vform→save→readTransport→重开回显 全链）；变异验证：回植旧绑定 → 3 红 |
| BUG-B | **UI Options Integrity** | 司机 picker range 误绑 `confirmedOptions`（仅在座位指派流程赋值）⇒ 数据存在、下拉恒空 | TEST-UI-002（候选数据源断言 + range 绑定完整性静态门）；变异验证：回植误绑 → 静态门红 |
| BUG-C | **UX State Invariant** | 批量审核入口仅 busy 门控：confirmed/混选在选时可点「确认报名」→ 后端整批拒（WRONG_PHASE） | TEST-UI-003a/003b-3（confirmed/混选在选 ⇒ disabled + 点击不进入流程）；变异验证：回植仅 busy 门控 → 6 红 |

## Signup status × 批量/单人行操作

UI 门控实现：`roster-panel.js render()` 按「当前勾选的全部行」计算 `canReview/canPromote/canCancel`
（整批语义与 domain 同向：一行不符即整批不可）；`roster-panel.wxml` 四按钮绑定
`{{canXxx && !busy ? 'onBatch' : ''}}`。

| 勾选行状态 | 确认/拒绝 | 递补候补 | 取消报名 | domain 依据 |
|---|---|---|---|---|
| 全 pending | **可用**（published） | 不可用 | 可用（published\|gathering） | `signup.js` review：some(!pending) → WRONG_PHASE「只有待确认报名可以审核」 |
| 含 confirmed（混选/单选） | **不可用**（BUG-C 修复） | 不可用 | 可用（未出行，published\|gathering） | 同上整批拒；cancel 限 isCurrentSignup |
| 全 waitlisted | 不可用 | **可用**（published；GROUP_SCOPE/CAPACITY 仍由后端判） | 可用（未出行） | promote：some(!waitlisted) → WRONG_PHASE |
| rejected/cancelled/removed | 不可用 | 不可用 | 不可用 | isCurrentSignup=false（permissions.js） |
| 已出行（home/joined/outboundBoarded/returnBoarded） | — | — | 不可用 | travelLocked：出行事实锁定，走现场异常/返程流程 |
| 阶段=gathering 时勾选 pending 行 | 不可用 | — | — | review 仅限 published 阶段（注：gathering 时 pending 必为空——transition 域门保证，见下） |

残余（UI 不预判、后端兜底）：promote 的 GROUP_SCOPE/CAPACITY；cancel 的参与者司机占用
（DRIVER_CONFLICT）；车辆已发车腿的 travelLocked 分支（行上无车辆腿状态字段）。
自动化证据：TEST-UI-003a（confirmed/混选门控 + pending 走通）、TEST-UI-003b-1（published 取消）、
TEST-UI-003b-3（gathering × confirmed 门控 + 取消）；A 层 4b（membership 域契约无关本表）。

## Activity phase × 阶段推进

| from→to | 域门 | UI |
|---|---|---|
| draft→published | — | 编辑器发布弹层（GP-03 真实点击） |
| published→gathering | **UNRESOLVED_DEPARTURE**：pending 必须清零（activity.js「请先处理所有待确认报名，再开始集合」） | 工作台阶段按钮 + 确认弹层（GP 真实点击；TEST-UI-003b-2） |
| gathering→active | 每位 confirmed 都要有 departure 核实 | 同上（GP-09/TEST-UI-003b-2 后续） |
| active→closing | — | 同上 |
| 任意→cancelled | 出发前；无出行事实；无参与者司机 | 工作台取消流程 |

推论：**「gathering + pending」按设计不可达** ⇒ review 入口在 gathering 恒不可用由状态维度自然成立。

## Attendance / 车辆状态 × 入口

| 状态事实 | UI 行为 | 证据 |
|---|---|---|
| 未签到 | field-panel 给「确认现场签到」 | GP-09/A 层 |
| 已签到、拼车、未上车 | **不给**「核实已随队出发」，弹层给指路文案（入口在车长页） | needsOutboundBoarding 单一出处；GP-10 |
| 已上车（confirmed 未核实出发） | 给「核实已随队出发」 | GP-10 真实点击 ×2 落库 |
| boarded | 车长页**不给**「确认上车」（showBoard=false） | GP-10 |
| departed | 车长页发车按钮 disabled；不能抹上车事实 | vehicle.wxml 条件绑定；GP-11 |
| confirmed 未出行（名单区） | 取消可用；已出行 ⇒ 取消不可用 | TEST-UI-003b-1/b-3 |

## Vehicle 表单（BUG-A/BUG-B 修复面）

| 环节 | 断言 | 证据 |
|---|---|---|
| 勾选集合点 | rendered checked=true 且 vform.pickupIds 恰含 target（渲染态与数据一致） | TEST-UI-001（变异后 3 红） |
| 保存 | 无「请至少勾选一个集合上车点」拦截 | TEST-UI-001 |
| 后端 | readTransport：pickupPointIds 含 target、1 名服务司机 | TEST-UI-001 |
| 重开回显 | checked=true 且 pickupIds 含 target | TEST-UI-001 |
| 司机候选 | driverCandidates 非空、含 confirmed 未分车者、不含 pending | TEST-UI-002 |
| range 绑定 | `range="{{driverCandidates}}" range-key="label"` 在场（静态门） | TEST-UI-002 |
| 真实点选司机 | **INCONCLUSIVE**（原生 picker 弹层不可自动化） | TEST-UI-002 uiUnverified |

## Picker / Checkbox / Button 完整性模式

- **Checkbox**：事件载体必须是 checkbox-group（裸 `<checkbox bindchange>` 真机永不触发，
  `tools/check.js` 硬门禁「不再有裸 checkbox 绑 change」，存量 7 处已于 Phase 4 清零）；
  checked 绑定不得调用方法（WXML 绑定无函数调用），选中态由 JS 预计算字段承载。
- **Picker**：range 必须绑组件 data 中真实存在的数组（数据源断言 + 绑定静态门）；
  options 与业务状态的一致性由数据断言覆盖；原生弹层点选 ⇒ INCONCLUSIVE。
- **Button**：「常驻 + 仅 busy 门控」是盲区模式——必须按行/选状态门控
  （参照 field-panel 按行事实收放、roster-panel canXxx、车长页 showBoard）。

## NEEDS_PRODUCT_FOLLOWUP

1. **read-after-write 20s+ 滞后**：signup.submit 成功后组织者视图 20s 轮询窗口内读不到新行，
   数分钟后可见（red7/8/9 + green-c2/c3 多轮复现；本套件以「submit 响应 targetIds 直发审核 +
   面板行有界轮询」规避）。对真实用户：组织者可能暂时看不到刚提交的报名。
   建议方向（未实施）：提交成功后定向重读 + bounded retry。
2. **阶段推进静默无效果**：本套件上下文中 5+ 轮复现——重开工作台后立即推进阶段，弹层/原因/确认
   全部正常但阶段不变、页面 error 为空（疑似页面持有旧 revision 命中 CAS 冲突，产品仅 toast+重读；
   toast 转瞬即逝且不落 error 字段）。套件以有界第 2 次尝试（重开=新读）恢复，并以页面视图
   （syncKey phase 前缀）证实最终状态。真实用户感知：点确认后"没反应"，需再点一次。
   归属：与 1 同根（读滞后），一并 follow-up。
3. **membership.save 不校验 vehicleId 存在性**（Phase 4 记录，未修）。
4. **promote 的 GROUP_SCOPE/CAPACITY、cancel 的车辆腿状态**：UI 不预判，后端兜底（当前设计取舍）。
