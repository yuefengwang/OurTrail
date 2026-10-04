# 【Round 1 · 本文读数当时未进树】

> 本文所有「改造后」读数（A 层 59、fault probe 31、BUSINESS 21 / UI 38、OVERALL INCONCLUSIVE）
> 在 Round 1 结束时从未进入工作树，已由 `cross-agent-audit.md` §4.1 判为 MISSING。
> Round 2（2026-10-04）重建后的**权威实测**：A 层 `e2e-test` 62 · `e2e-fault-probe` 31 ·
> 26 个门禁套件全绿；B 层读数以 `tools/e2e-ui-test.js` 当场 VERDICT 为准（见 SYNC.md Round 2 条目）。
> 保留原文只为记录诊断过程，不代表树上状态。

# E2E Credibility Report（测试可信度审计结论）

> Round 1 审计产物。审计对象是**已存在的两层 E2E**：`tools/e2e-test.js`（A 层，服务链路）
> 与 `tools/e2e-ui-test.js`（B 层，真模拟器）。
> 逐项清单见 `e2e-test-inventory.md`；覆盖面见 `e2e-coverage-matrix.md`；结论语义见
> `e2e-result-semantics.md`；账本实现见 `tools/e2e-result.js`；自证见 `tools/e2e-fault-probe-test.js`。
>
> **一句话结论**：改造前 B 层的 `passed=31 failed=0` 与「用户能在界面上做成」几乎无关——
> 同一个读数在新模型下被拆成 `BUSINESS: PASS / UI: INCONCLUSIVE`，并暴露出
> 一条让全部 UI 点击从未发生的基础缺陷。

## 1. 当前真实覆盖（实测读数）

四台次的真实输出（同机、同库、同云环境）：

| 轮次 | 代码状态 | 旧读数 | 新模型读数 |
|---|---|---|---|
| ① | HEAD，环境未就绪 | `✗ automator 连接` + throw → **退出码 1** | ENV-BLOCKED → **OVERALL INCONCLUSIVE（2）** |
| ② | HEAD 逻辑 + 新账本（选择器缺陷未修） | `passed=31 failed=0`（**看起来全通**） | BUSINESS PASS(17/0) · **UI INCONCLUSIVE**(14 通过 / 0 失败 / 9 SOFT-SKIP) · OVERALL **INCONCLUSIVE** |
| ③ | 修复 `$`/`$$` 后 | `passed=44 failed=5` | BUSINESS FAIL(17/1) · **UI FAIL**(27/4/0 skip) · OVERALL FAIL |
| ④ | 弹层内容改从面板作用域查 | — | 现场弹层链首次真跑；剩 2 项失败暴露出「面板挂载读数过期」与「`departure:'unknown'` 被当已办」 |
| ⑤ | 加按钮文案诊断 | `passed=55 failed=2` | BUSINESS FAIL(20/1) · UI FAIL(35/1) · 0 skip |
| ⑥ | 修 `unknown` 过滤 + 阶段推进后重开页面 + 回读目标取自 `data.sel` | `passed=53 failed=3` | BUSINESS **PASS**(21/0) · UI FAIL(32/3) · 0 skip |
| ⑦ | 车辆卡条件轮询 + CTA 可点状态断言 + 面板 error/busy 进失败信息 | `passed=59 failed=0` | BUSINESS **PASS**(21/0) · **UI INCONCLUSIVE**(38 通过 / 0 失败 / 0 skip) · OVERALL **INCONCLUSIVE**（2 处 UI-UNVERIFIED，见文末） |

**A 层**：59 项断言，全部 `HARD_BACKEND`；连跑 20 次 20/20 绿（修复前 12 次里 2 次红）。
主链 建档→建活动→发布→整组报名→审核→分车→签到→上车→出发→active→节点→closing→到家→归档
全程贯通，含 12 条负路径（`CONFLICT` / `DRIVER_CONFLICT` / `UNRESOLVED_DEPARTURE` /
`UNRESOLVED_SAFETY` / 权限拒绝 / 归档后能力关闭 / 未知动作 / 未登录）。

**B 层**（改造后）：UI 硬断言从 14 项涨到 27+ 项——**不是因为加了测试，而是因为原来的
元素通道整条是坏的**。真经 UI 完成的动作：4 个分区 tab 切换、名单面板显隐、名单行计数、
分车预览 CTA→方案弹层→提交→组件反馈、现场弹层签到/出发/到家（各 1 人）、
授权勾选框原生 tap、5 个页面的装配读数。

## 2. 假 PASS 风险清单（按严重度）

| # | 机制 | 位置（HEAD `1acd55e`） | 为什么能造成假 PASS | 本轮处置 |
|---|---|---|---|---|
| R1 | **`queryAll` 用 `$` 再判 `Array.isArray`** | `e2e-ui-test.js:87-94` | 实测本环境 `page.$(sel)` **恒返回单个 Element**（`$$` 才给数组）。于是 `queryAll` 对任何选择器重试 5 次后返回 `[]` → `segs[1]`、`sheetBtns[0]`、`previewBtns[0]`、`.seat`、`person-row` **全部不存在**，每一次「点 tab」「点 CTA」「点弹层按钮」都是静默 no-op | 已改为 `$$`；`probe-overlay.js` 实验复验：`.seg` 4 个、现场记录按钮 1 个、面板作用域 7 个动作按钮全部可见 |
| R2 | `checkSoft` 失败既不计 pass 也不计 fail | `:30-33` | 「一条 UI 断言从未通过」与「一条 UI 断言通过了」在输出里长得一样；退出码只由 `failed` 决定 → 永远 0 | 废弃。`soft` 只在**通道健康探针实测失败**时记 SOFT-SKIP，并强制 `UI=INCONCLUSIVE`；通道健康则为 FAIL |
| R3 | UI 失败 → 云侧 fallback → 计入通过 | `:364-373` | `previewAssignments`+`assignment.commit` 成功即 `check(...)` pass，标题里写着「云侧降级」却被算进 UI E2E 通过数 | 拆成两笔：`L.b(...)` + `L.uiUnverified(...)`；OVERALL 不得为 PASS |
| R4 | `check(name, true)` 硬编码真 | `:346` | 断言恒真；实际只在分支内执行，等价于「没报错就算过」 | 改为对 `planOpen / planChanged` 的真实断言 |
| R5 | 渲染门槛不通过时整段静默 | `:273`、`:637` | 页面 denied 时后续 ~25 项一条都不记，读数仍是「N 通过 0 失败」 | 加 `L.skipBlock(...)` 显式留痕 → INCONCLUSIVE |
| R6 | 命令返回值不看（fire-and-forget） | `:504`、`:582` | 上车/批量到家失败只在更远处以别的错误间接暴露，定位时会被误读成别的问题 | 补 `L.b` 汇总断言 |
| R7 | 轮询 `sheetOpen` 却不断言 | `:482-486` | 第二次开弹层没有任何检查，UI 侧「弹层能重复打开」从未被证明 | 补 `L.u` 断言 |
| R8 | 同一断言名两处（try 与 catch 同名 / 成功与失败同名） | `:216`+`:212`、`:346`+`:357` | 计数会重复或互相遮蔽，报告里分不清是哪条路径 | 改名区分；本轮另加的重名检查：脚本要求每条锚点恰好命中 1 次 |
| R9 | 「元素存在」被当成「用户可见可点」 | `:288`（名单行计数） | 三个面板都常驻 DOM，靠 `.hide{display:none}` 隐藏（`workspace.wxss:3`）；automator 查询走渲染前的节点树，`tap()` 是事件触发、**不经命中测试**。实测：面板 class 含 `hide` 时行计数照样通过 | 显式加 class 可见断言 + tab 状态断言；hit-test 面列为**已知不可证**（§3） |
| R10 | 环境故障与业务失败共用退出码 1 | `:89` throw | 「模拟器没开」看起来像「产品有 bug」，反向也会让 CI 在环境抖动时变红→被人忽略 | ENV-BLOCKED → 退出码 2；四态语义落地 |
| R11 | A 层硬编码座号 `'02'` | `e2e-test.js:197`（HEAD） | `genId` 同毫秒随机后缀（`contracts.js:35`）+ 分配器按 id 自然序发座（`allocation.js:60,99-101`）→ 王五拿 01 还是 02 不确定；写死 02 时随机 `SEAT_TAKEN`。实测 12 连跑 2 红，**HEAD 提交时的「全通」是一次幸运读数** | 改派目标座号从云端实况读回（A-025 新增前置断言）；复验 20/20 |
| R12 | lab 未收敛 → 「降级最小阵容」继续跑 | `:263-265` | 沙盒规模缩水后，行计数/对账类断言的强度静默下降 | 保留（属 fixture 层），但已在清单 B-012 标注；建议下轮把「实际阵容大小」记进 verdict 附注 |
| R13 | **面板只在挂载时读数**，云端直写对面板不可见 | 现场/分车段 | 阶段由 `cloudCall` 推上去后，`field-panel` 的 `data.phase` 还停在旧值 → 弹层动作表整组为空 → 「按钮没找到」。HEAD 把它归因成「元素查询通道退化」并 soft 掉；本轮加了 `labelsOf` 现场诊断，一次就看清按钮清单里确实只有 8 个「现场记录」而没有阶段动作 | 阶段推进后**重开页面**再驱动面板；并把「面板无服务端拒绝文案」也变成断言 |
| R14 | 批量兜底把 `departure === 'unknown'` 当已完成 | `:514`（HEAD） | 行的 `departure` 是标签值，`'unknown'` 表示**尚未核实**；旧过滤 `!(r.checkedIn && r.departure)` 里 `'unknown'` 为真 → 这个人永远不进兜底 → `advance('active')` 撞 `UNRESOLVED_DEPARTURE` 并连带炸后续整条链 | 过滤改为「`departure` 存在且 ≠ `unknown`」；注释写明这是本轮实测复现过的 |
| R15 | UI 目标行靠位置猜（`sheetBtns[0]` ↔ `confirmedRowsAll[0]`） | `:452/453` | 面板行序由视图决定，与云端行序无契约；猜错则回读断言查的是**另一个人**，通过与否都失去含义 | 打开弹层后从组件 `data.sel.signupId` 反查真实目标行再回读 |

### R16：一条**产品侧**发现（不是测试缺陷，本轮只记录不修）

`field-panel.js:125` 在 gathering 阶段无条件提供「核实已随队出发」，
但 `field.js:85` 要求拼车乘客（`trip.mode=shared` 且非参与者司机）必须**已签到且去程已上车**才允许 `joined`。
上车的 UI 入口在车长任务页，组织者现场面板里没有。于是组织者从现场面板直接点该动作，
**必然被服务端拒绝**（拒绝文案只在弹层 `callout danger` 里，行状态不变）。
这是「UI 提供的动作集与域前置不一致」的真实缺口：要么面板按 `row.outboundBoarded` 过滤/置灰该动作，
要么在现场面板给出「等待车长清点上车」的说明。B 层现在会把它测出来（新增的
`出发核实后面板无服务端拒绝文案` 断言）。

## 3. 现在仍然无法证明的事情（诚实清单）

1. **像素**。截图（`~/.ourtrail-e2e/shots/`，9 处）只是 Evidence：新模型不允许它进任何判定，
   本轮也没有做视觉比对。颜色糊、文字折行、canvas 浮层遮挡这类缺陷依旧只能人眼。
2. **命中测试**。`element.tap()` 触发事件但不经 hit-test。`pointer-events` 类缺陷
   （AGENTS.md 坑 15：关掉的 overlay 仍在吃点击）这套 E2E 结构上看不见。
3. **滚动区可见性**。没有 viewport/滚动位置断言，「元素存在」不等于「用户在屏上能看到」。
4. **真云数据库**。A 层跑在 `stub-wx-server-sdk` 内存桩上：证明的是领域规则 + CAS 契约，
   不是「云端文档真的写进去了」。桩有意比真 SDK 更严（`docId` 类型检查），但仍是有意的简化。
5. **并发**。所有 CAS 断言都是单客户端串行；两个用户同时写的真实竞争没有 E2E。
6. **零 E2E 的业务面**：车长任务页（`vehicle.depart/complete`）、位置上报、现场事件、
   协作授权（`readAccess/readSensitive/readContact/readNoticeManagement`）、通知发布/送达、
   `getWeather`、`getPhoneNumber`。细节见覆盖矩阵 §三、§四。

## 4. 当前可信度

| 对象 | 评级 | 理由 |
|---|---|---|
| A 层服务链路 | **HIGH** | 59 项硬业务断言、12 条负路径、主链闭环；flaky 已根因定位并 20/20 复验。扣分项：内存桩、单客户端 |
| B 层真 UI（本轮改造后） | **MEDIUM** | 证据**质量**已到位：38 项硬 UI 断言、0 项 skip、主链（分车/签到/出发/到家/授权勾选）逐项真跑并回读。仍是 MEDIUM 而非 HIGH 的原因：覆盖面只到工作台+报名+我的页；hit-test 与像素看不见；分车面板空渲染的抖动未定量；2 处 `UI-UNVERIFIED` 是真实未验证 |
| 「B 层能证明用户能做成」这件事 | **改造前：LOW → 现在：局部可用** | 改造前它证明的其实是后端；`passed=31 failed=0` 不具备任何 UI 含义。改造后同一句话只允许在有 tap/元素/组件 data 证据时成立 |
| 测试系统自证能力 | **MEDIUM-HIGH** | 31 项变异断言全绿（含「UI 失败+fallback 成功必须 INCONCLUSIVE」「soft 无退化证据必须 FAIL」「环境不可用不得算 PASS」）；活体鉴别力对照（不存在的选择器必须为空）已进套件；本轮 4 个 harness 缺陷全部是被新模型自己抓出来的 |
| **整体** | **MEDIUM** | 业务面 HIGH 可信；UI 面刚脱离假 PASS 区，覆盖面与证据面都还窄 |

不给百分比分数——上面这些读数是可复算的，百分比只会制造伪精确。

## 5. 本轮改动（最小必要集）

| 文件 | 改了什么 |
|---|---|
| `tools/e2e-result.js` | 新增：两维账本 + 四态 verdict + 退出码 0/1/2（测试专用，无业务代码） |
| `tools/e2e-fault-probe-test.js` | 新增：31 项变异/自证断言 |
| `tools/e2e-ui-test.js` | 每条断言打维度标签；`queryAll` 改 `$$`；弹层内容改从面板作用域查；新增通道健康探针；废弃 `checkSoft` 语义；云侧兜底必须记 `uiUnverified`；门槛静默段改记 `SKIPPED`；输出 VERDICT 块 |
| `tools/e2e-test.js` | 修 flaky：改派目标座号由云端实况推导（+1 项前置断言，58→59） |
| `docs/testing/*` | 本份 + 清单 + 覆盖矩阵 + 语义文档（语义文档本轮前已存在，按其落地） |

**未做**（按本轮禁令）：没有重写 E2E 系统、没有删测试、没有新框架、没有扩到几百项、
没有 AI Explorer / UX Reviewer / 自动修复、没有用截图代替断言、没有为测试改业务代码
（`data-testid` 也未加——见下条建议）。

## 6. 下一轮该做什么（不在本轮执行）

1. **P0 Golden Path 双层严格化**：以覆盖矩阵 §二的 4 个主链域（Activity / Signup /
   Assignment / Attendance）为准，每条链固定「Action → UI Runtime → Page Data → Backend State → Evidence」
   五级证据，UI 维度不允许 SOFT-SKIP（通道不稳就修通道，不修则该项直接判 FAIL）。
2. **给弹层动作按钮加稳定钩子**：本轮实测「从 overlay 元素查 slot」不可行，现在靠
   面板作用域 + 中文文案定位。文案一改就假失败——这是真正的技术债。建议
   `miniprogram/components/{transport,field}-panel/*.wxml` 的动作 `view` 上补 `data-e2e="sheet-action:checkin"`
   一类属性（**不属于大规模改业务代码**，但要不要加、怎么命名，等下一轮单独拍板）。
3. **修通道退化的根因**：本轮的证据表明过去归因为「长会话元素通道老化」的现象，
   至少一部分其实是 `$`/`$$` 误用。真实的老化程度需要在长会话下重测才能定量。
4. **补零覆盖面**：车长任务页（`vehicle.depart/complete`）与协作授权
   （`membership.*` + `readAccess/readSensitive`）是安全与权限两道硬门，优先。

## 本轮最终读数（第 ⑦ 轮，真实输出）

```
passed=59 failed=0
==== VERDICT ====
BUSINESS: PASS  (21 通过 / 0 失败)
UI:       INCONCLUSIVE  (38 通过 / 0 失败 / 0 项 SOFT-SKIP)
OVERALL:  INCONCLUSIVE
reason:
  - UI 未验证：清点上车（本程） ← 上车入口在车长任务页，组织者现场面板无此动作
  - UI 未验证：其余参与者到家核实 ← 仅 1 人经 UI 弹层完成，其余走命令兜底
EXIT=2
```

同一轮里，主链的 UI 侧第一次**逐项真实执行并留证**：

| 环节 | 断言 | 结果 |
|---|---|---|
| 鉴别力自证 | 负向对照：不存在的选择器必须返回空 | ✓ |
| 分车 | 车辆卡渲染 → 预览 CTA 存在且 `class` 无 `disabled` → 弹层 `planOpen` 且 `planChanged>0` → 提交按钮 → `planOpen=false` + `message='分车方案已保存。'` → `readTransport` 落库 → 座位示意有已占座 | ✓ 全 7 项 |
| 现场签到 | 名单渲染 → 现场记录按钮 → 弹层 `sheetOpen` → 备注 textarea → 「确认现场签到」按钮 → tap → 云端 `checkedIn` | ✓ |
| 出发核实 | 重开页面（补上车后面板需重新挂载）→ 关遮罩后可再开 → 「核实已随队出发」→ tap → 云端 `departure=joined` → 面板无拒绝文案 | ✓ |
| 到家核实 | closing 重开 → 切 tab → 弹层 → 「核实安全到家」→ tap → 云端 `home` | ✓ |
| 归档收尾 | 工作台「待到家」指标归零 | ✓ |
| 报名页 | 装配准入闸 → 档案姓名回填 → 紧急联系人回填 → checkbox-group → 原生 tap → `consent.dataUse` 翻转 | ✓ |

**结论**：`OVERALL=INCONCLUSIVE` 是诚实结果，不是失败——两处 `UI-UNVERIFIED` 是**产品设计使然**
（上车的操作者角色是车长，不在组织者现场面板）。它们必须留在 reason 里，等下一轮用车长页真跑。

## 7. 本轮之后仍然存在的 flaky / 未定量项

| 项 | 现象 | 状态 |
|---|---|---|
| 分车面板空渲染 | 第 ⑥ 轮 `车辆卡` 与 `预览 CTA` 同时取不到、`座位=0`，第 ⑦ 轮同一段全绿。面板读数是挂载时一次性的，`readTransport` 慢/失败即空态 | 已改为**条件轮询 + 把 `vehicles/error/busy` 写进失败信息**（下一轮再出现即可直接分辨「没读到」与「读失败」）；未定性为已解决 |
| `ensurePage` / `reconnected` 组合 | 重连后靠标志位补开页面，路径分散易漏 | 保留原机制，未重构（本轮禁止重写） |
| 云函数冷启与 3 秒超时 | 日志里 lab 段仍提示超时话术 | 属环境；`config.json timeout:20` 需重新部署才生效（AGENTS.md 坑 7） |

