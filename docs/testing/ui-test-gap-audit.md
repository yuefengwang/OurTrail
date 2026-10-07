# UI Test Gap Audit（Phase 5）

> 回答：为什么 BUG-A（pickupIds 恒真绑定）、BUG-B（司机 picker 恒空）、BUG-C（confirmed 仍可进
> 确认流程）三个真机缺陷能穿过当时的自动化体系？以及同类盲区还有哪些、现在由谁覆盖。
> 证据：`%TEMP%/p5-ui-state-red*.log`（重建套件红跑）+ `red1–red4`（有效 BUG-C 红证据轮次）。

## 一、三个缺陷为什么漏测

### BUG-A pickupIds 恒真绑定 —— 类别：Data Binding

- A 层与 scenario-vehicle **直接调 handler**（`onPickupToggle` 本身正确），而缺陷在
  **WXML 绑定层**（`checked="{{vform.pickupIds.indexOf(item.id) !== -1}}"` 求值 undefined →
  `undefined !== -1` 恒真）——handler 级测试天然看不见绑定。
- B 层旧版用 `vehicle.save` **命令造车**（绕过 UI 表单），勾选框从未被真实驱动。
- GP-07 虽然真实点击了 checkbox，但该断言被当作「已知产品缺陷的取证红」（任务书划出范围），
  **从未被当作回归门**——记录了缺陷却不保护。
- 教训：**handler 测试 + 命令测试的并集，中间恰好漏掉「WXML 绑定 → JS 状态」这一段**。

### BUG-B 司机 picker 恒空 —— 类别：UI Options Integrity

- 历史缺陷：picker `range` 误绑 `confirmedOptions`（只在座位指派流程赋值）⇒ 数据在
  `data.driverCandidates`（若曾计算）之外恒空，下拉永远没有选项。
- 当时**没有任何测试断言 picker 的数据源**；GP-07 明确绕开参与者司机（「服务司机不踩 picker」）。
- 教训：**「业务对象存在（domain 里有 confirmed 参与者）」≠「用户能从 UI 选到它」**——
  options 数据源与绑定需要独立断言。

### BUG-C confirmed 仍可进确认流程 —— 类别：UX State Invariant

- domain 的整批拒绝规则（`signup.js:117-119`「只有待确认报名可以审核」）在
  smoke/A 层/场景套件中**零断言**（全仓 grep 0 命中）。
- scenario-workspace 直接调 `onBatch`（handler 级），且从不构造 confirmed 行在选的前提。
- UI 的批量按钮只受 `busy` 门控（`roster-panel.wxml:59-63`）——confirmed/混选在选时按钮可点、
  弹层可开，用户必然走进后端整批拒绝。
- 教训：**「后端会拒」≠「UI 可以提供这个入口」**——UX invariant 需要独立的状态门控测试。

## 二、覆盖分层现状（UI state 视角）

| 层 | 覆盖 | 看不见什么 |
|---|---|---|
| smoke（domain 纯函数） | 域规则、阈值 | 一切 UI |
| A 层（命令→回读） | 命令契约、CAS、信封 | 一切 UI |
| scenario-*（组件 harness） | 组件状态机、handler 行为 | WXML 绑定、真实渲染、原生组件 |
| B 层 + GP（真机真 UI） | 真实 tap/input + 渲染态 + 落库回读 | 原生 picker 弹层（不可自动化） |
| **UI-State（本阶段新增）** | **状态 × 可操作性 × 门控（affordance）** | 原生 picker 弹层（INCONCLUSIVE） |

## 三、逐控件门控清单（当前状态）

| 控件 | 门控方式 | 状态 | 自动化证据 |
|---|---|---|---|
| roster 批量四按钮 | **状态×阶段**（canReview/canPromote/canCancel，Phase 5 修复） | 已修复+回归 | TEST-UI-003a/a+/b-1/b-3；变异 ×3 |
| transport 集合点 checkbox | JS 预计算 item.checked（Phase 4 修复） | 已修复+回归 | TEST-UI-001（变异后 3 红） |
| transport 座号 checkbox | checkbox-group 载体（Phase 4 修复） | 已修复+回归 | TEST-UI-001 |
| 司机 picker range | driverCandidates（早期修复）+ 静态绑定门（Phase 5） | 已修复+回归 | TEST-UI-002（变异后红） |
| field-panel 动作表 | 按 rowView 行事实收放 + needsOutboundBoarding 单一出处 | 一直正确（Phase 3 加固） | GP-09/10、A 层 4b |
| 车长页确认上车 | showBoard 按行事实 | 一直正确 | GP-10 |
| 车辆编辑「保存车辆安排」 | busy + pickupIds 前端校验 | 正确 | TEST-UI-001 |
| 名单导出按钮 | busy 门控（任意选择合法） | 正确 | TEST-UI-003a 系列附带 |

## 四、仍然无法自动化（INCONCLUSIVE，附真机人工验收点）

1. 原生 `<picker>` 弹层点选（司机类型/司机候选/出发时间/出行方式/路线节点/授权角色与截止时间）——
   探针实测 tap 后弹层不在可查询树。人工验收：真机走查各 picker 可选且选中落库。
2. overlay 关闭把手（组件内部模板，元素通道不可见）——人工验收：点 X/遮罩可关。
3. read-after-write 20s+ 滞后对 UI 的影响（见下）。

## 五、NEEDS_PRODUCT_FOLLOWUP

1. **read-after-write 20s+ 滞后**（signup.submit 成功后组织者视图读不到新行，多轮复现，
   数分钟后可见）——本阶段未修、未加无限轮询；套件以「submit 响应 targetIds 直发审核 +
   面板行有界轮询」规避。建议方向：提交成功后定向重读 + bounded retry。
2. **阶段推进静默无效果**（本套件上下文 5+ 轮复现：重开工作台后立即推进，弹层/原因/确认全部
   正常但阶段不变、页面 error 为空；疑似页面持有旧 revision 命中 CAS 冲突，产品仅 toast+重读；
   用户感知为「点了没反应，再点一次就好」）——与 1 同根，一并 follow-up。
3. membership.save 不校验 vehicleId 存在性（Phase 4 记录）。

## 六、变异验证记录（证明回归保护真实有效）

| Mutation | 回植内容 | 预期 | 实测 |
|---|---|---|---|
| BUG-A | transport-panel.wxml 勾选回植 `indexOf` 恒真绑定 | TEST-UI-001 红 | **3 红**（勾选落库/后端 pickupPointIds=.pk-2/回显）✓ |
| BUG-B | 司机 picker range 回植 `confirmedOptions` | TEST-UI-002 静态门红 | **1 红**（静态门精确命中；数据断言保持绿=数据对绑定断）✓ |
| BUG-C | roster 批量按钮回植仅 busy 门控 | TEST-UI-003 门控 6 红 | **6 红**（与 red-b1/b2/b3 签名一致）✓ |

每次回植后均已还原并经绿跑验证（最终绿跑：74 过 / 0 败 / 2 INCONCLUSIVE）；
worktree 无 mutation 残留（`grep MUTATION-BUG` = 0；transport-panel.wxml 与 HEAD 零差异）。
