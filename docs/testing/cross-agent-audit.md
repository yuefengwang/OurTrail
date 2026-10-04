# Cross-Agent Audit（跨 Agent 交叉审计 · 第一轮基线）

- **审计对象**：`docs/testing/` 下 5 个独立 Agent 的 9 份成果（A×4 / B×1 / C×2 / D×1 / E×1），基线 HEAD `1acd55e`。
- **审计人**：独立交叉审计（第六方），未参与前五轮任何工作。
- **证据优先级**：Level 1 = 真实代码 / 本机实际运行 / git 状态 > Level 2 = Agent 的实测读数 > Level 3 = Agent 的解释与文档。所有冲突一律回到 Level 1 裁决。
- **本机实测基线（2026-10-04，全部复跑）**：`check.js` ALL CHECKS PASSED · `check-handlers` ✓ · smoke **106** · **e2e(A) 58** · astro 60 / gpx 47 / sky 65 / route-schedule 41 / weather-page 134 / watch-points 37 / weather-model 82 / space-time 109 / space-time-draw 55 / roam-scrubber 33 · scenario-editor 137 / activity 136 / workspace 107 / signup 100 / me 98 / notices 67 / vehicle 56 / api 27 / discover 21 / lab 20 / staff 18 · trailapilab 25 / lab-dryrun 165 —— **24 套件全绿**。`e2e-ui-test.js` 依赖 DevTools 自动化通道，本轮未跑（其语义问题见 §4）。
- **审计人自己做的决定性实验**：`tools/e2e-test.js` 连跑 60 次 → **2 次红**，失败断言均为「改派回 1号车 02 座 ok」，错误码 `SEAT_TAKEN`。这是本报告最重要的一个 Level 1 事实（详见 §4-R11）。

---

## 1. Executive Summary

**「第一轮所有 Agent 的总体结论是否可信？」——分两层回答：**

1. **五份报告的「发现」层高度可信。** 我对 A/B/C/D/E 四方合计约 60 条可检验声称逐条回到代码与本机运行验证，**无一条被推翻**。A 的 15 个基础设施缺陷引用的行号与当前代码精确吻合；B 的权限矩阵、状态机守卫表、幂等管道语义逐条成立；C 的页面/入口/死路清单位辆核实；D 的 4 个 P1 系统级问题全部在代码层坐实；E 抽验的 22 条 finding 全部成立。多个 Agent 独立得出相同结论的地方（幂等断裂、field-panel 出发按钮、reason 丢弃、no-op 推 revision），经回代码确认**它们是对的**——不是共享错误假设的共振。

2. **但 A 的「交付」层存在完整性断裂，这是本轮唯一的重大负面发现。** A 声称已落地 `tools/e2e-result.js`、`tools/e2e-fault-probe-test.js`（31 项 fault probe）、`e2e-test.js` 58→59 flaky 修复、`e2e-ui-test.js` 两维账本改造——**这四项在当前工作树中全部不存在**（git status 干净、无 stash、无审计分支、reflog 无痕迹）。`e2e-test.js` 实跑 58 项、`seatLabel:'02'` 硬编码仍在、`e2e-ui-test.js` 仍是 `passed/failed` 二计数旧语义且 A 自己列出的 15 个假 PASS 缺陷一个都没修。A 文档引用的行号与 HEAD 精确吻合这一点说明审计是对着真实代码做的；但「改造后」的所有读数（59/31、BUSINESS 21+UI 38、OVERALL INCONCLUSIVE）**在当前仓库不可复现，不能作为基线采信**。当前仓库实际处于**审计前的假 PASS 状态**。

**一句话基线**：业务事实（B）与问题清单（A 的发现/C/D/E）可以放心作为下一轮测试设计的输入；A 描述的「测试基础设施新能力」暂时不存在，进入下一轮前必须先把 A 声称落地的四个文件补齐（或从 SYNC.md 撤回声称），并先修一个**已被实测证实的活体 flaky**（§4-R11）。

---

## 2. Agent-by-Agent Verdict

| Agent | 评级 | 依据 |
|---|---|---|
| **A · E2E Audit**（发现部分） | **HIGH** | 15 项假 PASS 风险（R1–R15）逐条对照当前 `e2e-ui-test.js`/`e2e-test.js`：`queryAll` 用 `$` 期待数组（:94-101）、`checkSoft` 不计数（:30-33）、云侧降级计 UI 通过（:364-373）、`check(name,true)`（:346）、同名断言两处（:216/:219、:346/:357）、`departure:'unknown'` 过滤缺陷（:514）、面板挂载读数一次性——**全部属实**。R11 flaky 被本审计**独立实验复现**（60 跑 2 红，`SEAT_TAKEN`）。 |
| **A · E2E Audit**（交付部分） | **MISSING** | `tools/e2e-result.js`、`tools/e2e-fault-probe-test.js` 不存在；`e2e-test.js` 相对 HEAD 零改动（仍 58 项、:197 仍写死 `'02'`）；`e2e-ui-test.js` 零改动（无维度标签、无四态 verdict、无健康探针、结尾仍是 `exit(failed>0?1:0)`）。SYNC.md 未提交条目与 4 份文档描述的「改造后」状态不可复现。**fault-probe 31/31 无法采信**（文件不存在，§4.5）。 |
| **B · Business Oracle** | **HIGH** | 抽验 30+ 条全部 CONFIRMED：十步管道顺序（权限→回执→CAS）、replayed 返回旧 targetIds、REQUEST_REUSED、回执先过权限再查找（commands.js reduceCommand 实读吻合）、field.js 全守卫表（:66/:74-77/:83-85/:92/:97/:102 逐行）、权限矩阵全表（含最冷门的「returnPlan 用 incident 能力」permissions.js:200 确认）、membership `expiresAt` 严格小于（:35/:47）、position.revoke 绕阶段门（field.js:15-19）、39 命令 summaries 实数。小瑕疵：§16 写「smoke-test（86）」实为 106；把 no-op 成功族归为「按现状断言的设计事实」是 Oracle 立场而非事实错误。 |
| **C · UI Journey** | **HIGH** | app.json 实数 **16 页**（AGENTS.md 的 14 已过时，C 对）；commands summaries 实数 **39**（C 对，A 的「37」偏差）；roster-panel 授权 picker `roleOptions/scopeOptions` 未挂 data（WXML:161/181 绑定、JS 仅有模块常量）→ **车辆联络授权 UI 死路，Level 1 确认**；home.js `goStaff:!!a.meta.staff` 双角色死路确认；`draft.setOpenId` 零调用确认；`canCancelRow/canEditRow` 死数据键确认（WXML 零引用）；`attendance.board` 无组织者现场入口确认（field-panel openSheet 动作表实读）。 |
| **D · Independent QA** | **HIGH** | R-1/R-2(a)(b)/R-3/R-4/R-6/R-7 全部代码坐实：`dispatchAndSync` 不透传第三参（api.js:103）、`overrideEvidence` 在指纹计算**之前**（index.js:121→124）、`run()` 忽略 `res.revision` 而 field-panel 有正确写法（activity.js:446 vs field-panel.js:194）、editor.js:161 草稿无条件胜出、cancel reason 服务端不读、notice.read 零变更仍 `revision+=1` + `transport.js:131` baseRevision 校验。**「P0=0」的结论被 E 推翻**（见冲突 #3），但这属于定级分歧，其场景库与 Top30 依然有效。 |
| **E · Code Bug Hunt** | **HIGH（证据纪律最好的报告）** | 抽验 22/71 条全部成立：P0-1（lab 显式 id 绕过前缀守卫，lab/index.js:90-91/:237 + lab.config.js:12 硬编码 openid）、P0-3（simulation 硬编码 activity.js:470 + field.js:66 self-only）、P0-5（workspace.js:103 白名单含 draft + selectors.js:322 隐私闸只认 draft 字符串）、P0-6（三个敏感读 action 纯读零写入 + **两份 AGENTS.md 确实为「audit on read」背书**）、P0-7（onAccessSave 无 busy + profile.js staff 无去重）、P0-9（editor 全文件仅 :578 一处写 revision）、P1-18（lib/weather.js:193 产 `'HH:mm'` vs weather.js:25 `'HH'`）、P1-19（selectors.js:120 给司机行填 vehicle → 候选过滤自锁 → findIndex −1 必拒）、P1-20/P1-22（onTab 只 setData；denied 早退不复位 `_loading`）。P0-2 的 checkbox dataset 错位在代码层确认（E 自己标注「currentTarget 语义待真机」——该语义是平台既定行为，置信度高）。 |

---

## 3. Cross-Agent Conflict Matrix

> 列 = 五个信息源对该 Topic 的立场；「Code Reality」= 本审计 Level 1 裁决；「Verdict」= 冲突类型与结论。

| # | Topic | A | B | C | D | E | Code Reality（Level 1） | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | **B 层 E2E 的 UI 断言是否真的执行过** | 「改造前元素通道整条是坏的，历史 tap 从未发生（R1）」 | 未提及 | 「automator 可驱动，但 picker 原生层驱不动」 | 未评估 | 未评估 | `queryAll` 用 `scope.$()` 期待 `Array.isArray`（:94-101）属实；miniprogram-automator 的 `page.$` 返回单元素、`$$` 才返回数组 → queryAll 恒 `[]` | **类型 4（测试与产品冲突）**：A 对。旧读数 `passed=31 failed=0` 中的 UI 断言从未执行。当前树未修。 |
| 2 | **幂等机制是否可用** | 覆盖矩阵评「Idempotency MEDIUM（A-013 已覆盖）」 | 「客户端从不复用 requestId → REQUEST_REUSED 对真实客户端近乎不可达；服务端回执是死机制（§1.3）」 | 未提及 | **R-2 双断点 P1**：客户端不传稳定 id + 指纹在 evidence 覆写后计算 | **P0-8** 同 D，且列出 32 处调用点 0 处传参 | api.js:103 每次现造 requestId、dispatchAndSync 不透传；index.js:121-124 overrideEvidence 先于 sha256——**两断点均坐实**；A-013 的 replay 测试本身真实有效 | **类型 1（覆盖冲突）**：A 测的是「服务端机制存在」，D/E 说的是「真实客户端路径永不触发它」。两者都对，但 A 的 MEDIUM 评级**掩盖了产品级覆盖为零**这一事实。 |
| 3 | **产品是否存在 P0** | 未评级产品 | 未评级 | 标了 3 个 ⚠ 高危（picker 死路/双角色死路/无入口 board） | 「**P0：本轮未发现**」 | **9 条 P0**（含 P0-2 报名勾选真机失效） | D 自己的 P0 定义是「核心流程不可用」；E P0-2（代报/多人报名整体不可用）、P0-9（编辑器首存盲写）按该定义即 P0 | **类型 5（QA 与 Hunter 冲突）**：按 D 的自定义口径，E 的 P0-2/P0-9 成立，**D 的「无 P0」被推翻**。E 的 P0-5（草稿可取消致不可删+隐私闸失效）机制确凿，定级 P0/P1 边界可商榷。 |
| 4 | **field-panel 出发按钮** | R16：产品 bug，UI 提供必然被拒的动作（引 field-panel.js:125 + 「field.js:85」） | 状态机 §4.2 记录 joined 前置（field.js:85） | §7 动作表如实列出，未标 ⚠ | ATT-2 顺序依赖场景 | **P1-23** 独立发现并注明「SYNC 已有记载，本次独立复核成立」 | field-panel.js:125 无条件 push「核实已随队出发」（只看 permitted）；`domain/field.js:85` 要求签到+上车；上车入口只在车长页 | **三方互证为真**（A 引用的「field.js:85」实为 `cloudfunctions/trailApi/domain/field.js:85`，非 miniprogram 页面——引用实质正确）。**确认为真实产品 bug**（§5-3）。 |
| 5 | **signup.cancel 的 reason** | 未涉及 | 「schema 收下、handler 不读、事件不含——纯仪式性输入（§3.3）」 | 未提及 | R-6 P2 黑洞 | 未单列（P2 级未展开） | signup.js cancel 分支实读：`p.reason` 从未被消费 | B/D 一致为真。不是冲突，列入「多 Agent 一致且为真」样本。 |
| 6 | **命令类型总数** | 「37 种（commands.js:15-33）」 | 未给总数 | 「**39 个 command 全部有 UI 来源**」 | 未涉及 | 「domain 37 类命令在 canExecute 全部有分支」（§非问题 9） | summaries 映射实数 **39** | **类型 2（业务事实冲突）**：C 对；A/E 的 37 系同一过时口径。不影响各自结论的有效性。 |
| 7 | **A 层测试是否 flaky、是否已修** | R11：写死 `02`，12 连跑 2 红；「已改为云端读回 +1 断言，58→59，20/20 全绿」 | 未涉及 | 未涉及 | 未涉及 | 未涉及 | **本机实测：60 连跑 2 红**，失败断言「改派回 1号车 02 座 ok（SEAT_TAKEN）」；`e2e-test.js:197` 仍写死 `'02'`，文件相对 HEAD 零改动 | **A 的诊断对、修复不存在**。flake 在当前树上**仍然活着**（机制：genId 同毫秒随机后缀 + allocation.js 按 signupId 自然序发座，contracts.js:35 + allocation.js:60-100 确认）。 |
| 8 | **「车辆联络」能否经 UI 创建** | 未涉及 | membership.save 语义如实描述 | **§9.1：roleOptions/scopeOptions 未挂 data，vehicle_contact 在 UI 上无法产生** | PRM-1 假设授权链可用 | 未单列 | roster-panel.wxml:161/181 绑定 `{{roleOptions}}`；JS data 无此二键（仅模块常量 ROLE_OPTIONS/SCOPE_OPTIONS） | **C 对，且推翻一条历史声称**：提交 55b5be5 的「P0-2 真实流验证全通（roster 面板自授车辆联络）」必然经自动化 `callMethod('onRole',…)` 绕过了空 picker——**自动化路径 ≠ 真机用户路径**。C 的 R-14 已把这层区别写明。 |
| 9 | **staff 授权后能否干活** | 未涉及 | 「staff 的 roster 只影响读取投影，不影响命令面（§9）」 | **§7/§9.7 ⚠：授了 checkin 没 roster 的 staff 看到空名单，无法执行被授权任务** | PRM-1 假设全链可用 | 未单列 | selectors.js:345：staff 视角 rows 一律按 `staffCan(...,'roster',…)` 过滤 | 两者陈述均真且互补；按 C 的视角这是产品级陷阱（配置错误 → 授权无效），按 B 的视角是投影规则。**产品 bug 候选**（§5-20，需产品决策：能力与可见性解耦是否有意）。 |
| 10 | **知识库（AGENTS.md）与代码的一致性** | 未评估 | §14 列 6 条文档 vs 代码差异（D1–D6） | 用 16 页/39 命令事实上修正了知识库 | 未评估 | 文档漂移专节：14 页→16、editor.js 行数、smoke 86→106、**AGENTS.md 为「audit on read」背书（P0-6）** | `cloudfunctions/trailApi/AGENTS.md:34`「readSensitive **writes an audit record on read**」与 index.js:88-101 纯读实现直接矛盾；`domain/AGENTS.md:86`「先写 export.record 审计」描述的是客户端自律而非服务端强制 | **E 对**。根 AGENTS.md 的「14 页/37 命令/smoke 86」均过时。**知识库需要一次校准**。 |
| 11 | **重复签到覆写 / no-op 推 revision** | 未涉及 | §15.1 列为「按现状断言的宽松转换」 | 未提及 | R-1/ATT-5/N-OT-1 作为 P1 风险的机制基础 | P2-14/P2-16 升级为问题 | field.js:67-69 无守卫；commands.js `candidate.revision += 1` 无条件；position.revoke 无条件成功 | 事实三方一致，分类立场不同（Oracle vs QA vs Hunter）。测试设计按 B 断言，产品追踪按 D/E 立项——不冲突。 |
| 12 | **trailApiLab 是否第二个云函数** | 未涉及 | §14 D5：「是，AGENTS.md『ONE cloud function』不实」 | journeys §8 把 lab 列为第 16 页 | 未涉及 | P0-1 进一步指出 lab 与生产**共用同一套 ot_\* 集合且显式 id 可绕过前缀守卫** | lab/index.js:90-91/:237 + `diff store.js` 逐字节相同 + lab.config.js:12 硬编码 openid | B/C/E 一致为真，E 追加了安全边界结论。根 AGENTS.md 需改。 |

---

## 4. A E2E Infrastructure Audit（重点：声称 vs 树上现实）

### 4.1 逐项核对表

| A 声称的改动 | 树上现实 | 判定 |
|---|---|---|
| 新增 `tools/e2e-result.js`（两维账本+四态+退出码 0/1/2） | 文件不存在 | ❌ |
| 新增 `tools/e2e-fault-probe-test.js`（31 项变异自证） | 文件不存在 | ❌ |
| `e2e-test.js` 修 flaky（座号云端读回，+1 前置断言，58→59） | 文件相对 HEAD 零改动；仍 58 项；:197 仍 `seatLabel:'02'`；实跑 passed=58 | ❌ |
| `e2e-ui-test.js` 改造（维度标签/`$$`/健康探针/废 checkSoft/uiUnverified/SKIPPED 留痕/VERDICT 块） | 文件零改动；R1–R15 全部仍在；结尾仍是 `passed/failed`+`exit(failed>0?1:0)` | ❌ |
| `docs/testing/` 4 份文档 + SYNC.md 条目 | 存在（未跟踪/未提交） | ✅ |
| A 对 HEAD 缺陷的行号引用（R1–R15、B-001…B-057） | 与当前文件逐条吻合 | ✅ |

**结论**：审计是真实做的（行号、机制、实测 flake 全部经得起复验）；但「改造后」的一切（59/31 计数、BUSINESS/UI 两维读数、`OVERALL INCONCLUSIVE`）在当前树**不可复现**。不存在能证明「改动曾被落地后丢失」的 git 证据（无 stash/无分支/reflog 干净）；无论哪种成因，**按 PARALLEL_DEV 协议，未进提交的改动不存在**，基线必须按「改造前」计。

### 4.2 false PASS（对当前树的判定——不是对 A 文档的转述）

当前 `e2e-ui-test.js` 上真实存在的假 PASS 通道（全部由本审计逐行复核，非转述）：
1. **queryAll 恒空**（:94-101 用 `$` 期待数组）→ 所有 `segs[i]`、`sheetBtns[0]`、`previewBtns[0]`、`.seat`、报名页 checkbox-group 的 tap 都是静默 no-op；
2. **checkSoft 失败不计数**（:30-33）→「从未通过」与「通过」在输出里无法区分；
3. **云侧降级计入 UI 通过**（:364-373 `check('云侧降级…', cm.ok===true)`）；
4. **`check('…方案弹层出差异行…', true)`**（:346）断言恒真；
5. **渲染门槛不过整段静默**（:273、:637）；
6. **fire-and-forget**（:504 上车、:582 批量到家不看返回值）；
7. **第二次开弹层的 `sheetOpen` 轮询无断言**（:481-486）；
8. **同名断言两处**（:216/:219、:346/:357）；
9. **`departure==='unknown'` 被 `!(r.checkedIn && r.departure)` 当已办**（:514）→ 批量兜底漏人 → active 撞 `UNRESOLVED_DEPARTURE`；
10. **环境故障与业务失败共用退出码 1**（:89 throw → catch → exit 1）。

### 4.3 fallback / result semantics / flaky

- **fallback**：当前树的分车段、上车段、到家段均为「UI 失败→云侧命令兜底→计入通过数」结构，A 的语义文档（fallback 四分法）正确但**未落地**。
- **result semantics**：`e2e-result-semantics.md` 的两维四态模型本身质量很高（本审计认可其作为下一轮的门禁语义），但它描述的账本不存在。
- **flaky（本审计实测）**：`node tools/e2e-test.js` 60 连跑 **2 红**，均为 A-028「改派回 1号车 02 座 ok」报 `SEAT_TAKEN`。根因链完整确认：`genId` 毫秒时间戳+随机后缀（contracts.js:35）→ 分配器按 signupId 自然序发座（allocation.js:60 `sort((a,b)=>compare(a.id,b.id))`）→ 王五原座号在 {01,02} 间随机 → 写死 `'02'` 的改派在王五原本拿 01 时撞上林溪的 02。**这是当前门禁里的活体 flaky**，A 报告的修复（读回原座号）未落地。
- **coverage regression**：无（A 没有删除任何测试；树上测试集与 HEAD 一致）。

### 4.4 fault probe 31 项（任务要求逐类抽查 → 无法执行）

`tools/e2e-fault-probe-test.js` 不存在，「31/31 全绿」**不予采信**。A 文档对该套件的设计意图（降级伪装 PASS 必须 INCONCLUSIVE、soft 无退化证据必须 FAIL、环境不可用不得算 PASS、鉴别力负向对照）在语义上正确，但按 Level 1 纪律：**未落地的自证等于没有自证**。下一轮重建该文件时，本审计特别要求两点：① fault injection 与 assertion 必须分离（断言不得直接感知注入点，防「自证型 mutation」）；② 每个探针注明它模拟的真实产品故障形态（元素通道退化/云函数超时/会话重连）。

### 4.5 A 层 59 项重验（任务要求）

实跑 **58 项，全部独立成立**：断言均为「输入 → 领域规则 → 后端回读」结构，抽查未发现 `expected=backend` 的同义反复（改派断言的期望值来自域规则 seatLabel null/'02' 契约而非回读值本身；回读断言 A-027/029 检查的是与派发输入的一致性 + 不变量约束）。声称的第 59 项（A-025 原座号读回前置）**不存在**。清单文档 B-001…B-057 的行号锚点与当前 `e2e-ui-test.js` 全部吻合，作为「HEAD 原状」的记录可信。

---

## 5. Confirmed Product Bugs（全部经本审计 Level 1 复核，非转述）

> 分级沿用 E 的口径（P0=数据错误/核心流程不可用，P1=重要功能错误，P2=一般）。不修改任何产品代码——仅记录。

| # | 缺陷 | 证据（本审计复核位置） | 级别 | 来源 |
|---|---|---|---|---|
| 1 | **协作授权两个 picker 无数据 → vehicle_contact 无法经 UI 创建**，车辆联络旅程只能靠预演注入 | roster-panel.wxml:161/181 绑 `{{roleOptions}}/{{scopeOptions}}`；JS 仅模块常量（:18-19），data 无此键 | **P0**（核心协作流程不可用） | C §9.1 |
| 2 | **报名页「选择参与人」勾选在真机不生效**（`data-key` 挂内层 label，handler 读 `currentTarget.dataset.key` → undefined → 恒走不移除分支） | signup.wxml:60-61 + signup.js:186-200；同仓 roster-panel.wxml:48 的正确写法为对照 | **P0**（代报/多人报名不可用；E 自留「待真机」，本审计认为平台语义明确） | E P0-2 |
| 3 | **现场面板在 gathering 无条件提供「核实已随队出发」，对未上车拼车乘客必被服务端拒**，且组织者无上车入口 | field-panel.js:125 + domain/field.js:85 + 车长页才有 board 入口（三方互证） | **P1**（必然失败的死按钮+错误归因） | A R16 / D ATT-2 / E P1-23 |
| 4 | **代报同行人定位签到必 FORBIDDEN**（页面硬编码 `method:'simulation'`，服务端 simulation 仅限本人；manual 只在定位失败分支可达） | activity.js:470-482 + field.js:66 | **P0**（同行人到场无法记录，连锁卡发车） | E P0-3 |
| 5 | **草稿残留已删除同行人 → 该活动报名永久 FORBIDDEN 无自愈**（草稿整份胜出、候选驱动渲染无移除入口） | signup.js:103 + 候选渲染模型 | **P0**（个体永久卡死） | E P0-4 |
| 6 | **草稿可从工作台「取消」→ 永久不可删/改 + 草稿隐私闸失效**（取消白名单含 draft；隐私闸按 phase==='draft' 字符串；删除要求 draft） | workspace.js:103-104 + selectors.js:322 + activity.js:141/:196 | **P0**（按 E；本审计认可机制，定级 P0/P1 边界） | E P0-5 |
| 7 | **幂等双断点**：客户端从不传稳定 requestId（每次现造 + dispatchAndSync 不透传）；服务端先覆写 evidence 再算指纹 → 即使补上前者，重试也必 REQUEST_REUSED | api.js:95-119 + index.js:121-124 + commands.js:116-121（D/E 互证） | **P0**（弱网重试产生重复事件/异常/授权/通知） | D R-2 / E P0-8 |
| 8 | **编辑器全程不回填 revision**：首次保存 `expectedRevision=undefined` → 服务端兜底为当前值 → CAS 不可达（盲写）；成功一次后 revision 钉死 → 之后每次保存永久冲突 | editor.js 仅 :578 一处写 this.revision + index.js:122 兜底 | **P0**（双机编辑静默覆盖 + 冲突死循环） | E P0-9 |
| 9 | **敏感名单读取/导出零审计**（readSensitive/readContact/readExport 纯读；审计只存在于自律的 export.record 命令），且两份 AGENTS.md 声称「audit on read」 | index.js:88-101 + selectors 无 events.push + AGENTS.md:34/domain AGENTS.md:86 | **P0**（可追责性缺失；E 定级，本审计确认机制与文档错误） | E P0-6 |
| 10 | **授权保存无 busy 且 staff 授权无服务端去重** → 双击/弱网重试产生重复 membership，「撤销」只删一条 | roster-panel onAccessSave 无 busy（grep busy 仅 :62/:186-194/:213-233）+ profile.js:24-27 + 客户端现造 membershipId | **P0**（权限残留+UI 说谎；E 定级，机制确凿） | E P0-7 |
| 11 | **预演云函数可对任意真实 activityId 执行 seed/cleanup**（显式 id 绕过 [预演] 前缀守卫；与生产共用全部集合；白名单 openid 硬编码在配置里） | lab/index.js:90-91/:237 + store.js 逐字节相同 + lab.config.js:12 | **P0**（工具安全边界；需白名单账号，非外部攻击面） | E P0-1 |
| 12 | **editor 本地草稿无条件覆盖服务器**（无 updatedAt、整对象替换、CONFLICT reload 仍草稿优先） | editor.js:161 + domain/activity.js Object.assign | **P1** | D R-4 |
| 13 | **activity 页 `run()` 与 notices 页 `onMarkRead` 不回写 revision** → 同屏连续第二发必撞 CONFLICT 且错误归因「被他人更新」 | activity.js:446-453（对照 field-panel.js:194 正确写法） | **P1** | D R-3 / E P1-2 |
| 14 | **工作台四面板挂载后永不重读**（切 Tab 只 setData；核心循环「审核→分车→现场」单页内数据陈旧） | workspace.js onTab 实读 + 组件 observers 仅 attached/activityId | **P1** | E P1-20 |
| 15 | **面板 denied 早退不复位 `_loading` → 「重试」成为死控件**（三面板同型；CONFLICT 自愈走的 page.reload() 同样被吞） | roster-panel.js:75-80 早退分支无 `_loading=false` | **P1** | E P1-22 |
| 16 | **天气页「分时段摘要」永久为空**（SLOTS 用 'HH' 比对 'HH:mm' 数据） | weather.js:25/:583 + lib/weather.js:193 | **P1**（无条件触发的设计面板整块缺席） | E P1-18 |
| 17 | **参与者司机车辆不可编辑**（候选过滤 `!r.vehicle` 把现司机自己排除 → findIndex −1 → 保存必拒且点名的人不在下拉中） | transport-panel.js:119-121/:316-322/:398-408 + selectors.js:113/:120 | **P1** | E P1-19 |
| 18 | **signup.cancel 的 reason 服务端完整丢弃**（三处 UI 必填，落库无痕） | signup.js cancel 分支实读 | **P2** | B §3.3 / D R-6 |
| 19 | **home 双角色用户进不去车辆页**（`goStaff:!!a.meta.staff`，vehicle 页无第二入口） | home.js:80 | **P1** | C §9.6 |
| 20 | **staff 授了操作能力却没授 roster → 看到空名单无法执行被授权任务**（可见性统一用 roster 能力过滤） | selectors.js:345 | **产品决策项**（陷阱成立，是否有意待拍板） | C §9.7 |

E 报告中其余 40+ 条（P2 系列、天气渲染类、astro 符号等）本审计未逐条复验，但 E 的证据纪律（file:line + 取证状态 + 掩盖机制标注）在抽查样本中零失误，按 Level 2 采信，待下一轮按其「复测优先级」批次定案。

---

## 6. False / Weak Findings（错误结论、过度推断、弱断言）

1. **A 的全部「改造后」读数（59/31、BUSINESS 21+UI 38、`OVERALL INCONCLUSIVE`、20/20 复验）——本审计不予采信**。不是发现错误，而是交付物不在树上，Level 1 无法复现。SYNC.md 未提交条目按现状 constitutes 失实记录，应在补齐文件或撤回声称之间二选一。
2. **D 的「P0：本轮未发现」** ——按 D 自己的 P0 定义被 E P0-2/P0-9（及本报告 §5-1/2/5/6/7/8/9/10/11）推翻。D 的场景库不受影响（其场景恰是这些 P0 的验证脚本），但「无 P0」结论必须撤回。
3. **A 覆盖矩阵的「Idempotency MEDIUM」** ——机制已测 ≠ 产品可用；应改记「服务端机制已测 / 客户端接线断裂（D R-2）→ 产品级覆盖为零」。
4. **A/E 的「37 种命令」** ——summaries 实数 39（C 对）。
5. **B §16 的「smoke-test（86）」** ——实数 106。
6. **弱断言（当前树上仍在）**：scenario-signup-test.js:78 的 `pickEv` 手工把 `currentTarget.dataset.key` 塞进事件——**测试替产品补了一个真机不会产生的字段**（E 专节#1），这正是 P0-2 全绿漏网的原因；`check(name,true)`（e2e-ui-test.js:346）；同名断言两处（:216/:219、:346/:357）；lab 未收敛时「降级最小阵容」继续跑（e2e-ui-test.js:263-265，A 已自标 B-012）。
7. **E P0-5 定级**：机制确凿，但「草稿内容可读」的隐私暴露面有限（需持有 id），P0/P1 边界可商榷——不影响修复必要性。
8. **「多 Agent 一致 ≠ 真」的正面样本**：幂等断裂（B+D+E 三方一致）经代码+调用链实读确认为真；但同时提醒——三方引用的同一基础事实（requestId 语义）中任何一方若错会三方同错，本次是回代码后确认的，不是投票通过的。

---

## 7. 真实测试覆盖矩阵（按业务能力，本审计综合 A 矩阵 + B §16 + 本机复跑校正）

> 图例：**A 层**=e2e-test.js（58 项，真信封打 exports.main+内存桩）｜**B-UI**=e2e-ui-test.js 经真实元素完成｜**B-BIZ**=B 层经 cloudCall 只证后端｜单测=smoke/scenario/lab｜置信=Correctness（规则对不对）×Coverage（测没测到）综合。

| 业务能力 | Oracle（B 文档） | UI Journey（C 文档） | A 层 | B-UI | 后端断言 | UI 断言 | 错误路径 | 置信 |
|---|---|---|---|---|---|---|---|---|
| Activity 生命周期 | ✅ 完整（7 态+8 边） | ✅ editor 三步/发布/删除 | ✅ 9 项 | 指标对账/归零（data 级） | ✅ | ⚠ 弱（无 tap 级推进） | CONFLICT/UNRESOLVED×2 | **MEDIUM**（edit/copy/delete 零 E2E；cancelled 零覆盖） |
| Signup | ✅ 完整（6 态 8 边） | ✅ 准入闸/回填/CAPACITY 询问 | ✅ 5 项 | 装配+授权 tap（从未真跑过） | ✅ | ⚠ | DUPLICATE/WRONG_PHASE | **MEDIUM**（promote/edit/setTogether/rejected 终态零 E2E；**P0-2 使多人链路的 UI 覆盖无意义**） |
| Review | ✅ | ✅ roster 批量 | ✅ 2 项 | ❌（云侧命令） | ✅ | ❌ | REV-1 整批拒 | **MEDIUM** |
| Vehicle | ✅（legs 子状态机） | ✅ 车长页全列 | ✅ 3 项 | ❌ | ✅ | ❌ | DRIVER_CONFLICT | **MEDIUM-LOW**（depart/complete/remove 零 E2E；P1-19 未被任何层捕获） |
| Assignment | ✅（不变量+冻结） | ✅ 预览→提交全链 | ✅ 8 项 | ✅（唯一真跑过的 UI 写链，但当前树 tap 从未发生） | ✅ | ❌（树上无有效 UI 断言） | 4 座位码仅域层 | **MEDIUM**（remove/swap 零 E2E；R11 flaky 活着） |
| Attendance | ✅（守卫表全） | ✅ 弹层动作表 | ✅ 10 项 | ❌（同上，tap 未发生） | ✅ | ❌ | 3 个 UNRESOLVED | **MEDIUM**（returnPlan/迟到特例/boarded=false 零 E2E） |
| Position | ✅ | ✅ sheet 入口 | ❌ | ❌ | ❌ | ❌ | 仅域层 | **LOW**（全线零 E2E） |
| Incident | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | 仅域层 | **LOW**（安全相关） |
| Notice | ✅（三受众） | ✅ 发布/已读/投递 | ❌ | ❌ | ❌ | ❌ | 仅域层 | **LOW**（P0-3 修复后无回归网） |
| Export | ✅（审计语义） | ✅ roster 导出 | ✅ 2 项 | ❌ | ✅ | ❌ | 归档关闸 | **MEDIUM**（但 P0-6 使审计语义本身存疑） |
| Permission/Membership | ✅（矩阵全） | ✅（但创建死路 C §9.1） | ❌ | ❌ | ❌ | ❌ | 仅域层 | **LOW**（协作授权线两层皆零 + P0-7/P1-22 无人捕获） |
| Revision/CAS | ✅（双层） | — | ✅ 2 项 | ❌ | ✅ | — | 单客户端 | **MEDIUM**（P0-9/R-3 说明「页面层 CAS 接线」才是真实短板，E2E 测不到） |
| Idempotency | ✅（含窗口边界） | — | ✅ 1 项（A-013） | ❌ | ✅ | — | REQUEST_REUSED 未测 | **MEDIUM**（同上：机制已测、接线断裂未测） |

**覆盖 × 可信度分开评价（任务 §十四）**：
- **Correctness（规则理解）**：HIGH——B 的 Oracle 经全表复核无一猜测态；cancelled/coordinating/late/revision/idempotency/权限条件均无遗漏（B §15 甚至主动列出宽松转换）。
- **Coverage（覆盖）**：MEDIUM——39 命令中 22 个两层 E2E 零覆盖（22/22 有单测兜底）；Position/Incident/Notice/Membership 四条业务线 E2E 为零；4 个 Result 形读面（readAccess/readSensitive/readContact/readNoticeManagement）零 E2E。
- **Evidence Quality（证据质量）**：A 层 HIGH（独立断言+回读）；B 层 **LOW**（当前树上的 UI 断言从未真正执行过）；截图定位正确（仅 Evidence）。
- **Stability（稳定性）**：A 层 MEDIUM（R11 flaky 实测 2/60）；B 层未定量（通道退化 vs `$/$$` 误用未分离，A §7 已自认）。

---

## 8. Final First-Round Baseline

| 维度 | 评级 | 一句话依据 |
|---|---|---|
| **Business Correctness Confidence**（领域规则被正确理解并实现到域层） | **HIGH** | smoke 106 + 24 套件全绿（本机复跑）；B Oracle 全表复核零猜测；发现的问题全部在域层**之外**的接线/客户端/工具层。 |
| **UI Correctness Confidence**（用户在真实界面上能做成该做的事） | **LOW** | 已确认 4 个「UI 提供做不成/做不了」级缺陷（picker 空数据、勾选框错位、simulation 死路、死按钮），B 层 UI 断言在当前树从未执行，`passed=31 failed=0` 不具备 UI 含义（A 的判断成立）。 |
| **Test Integrity Confidence**（测试的 PASS 可信） | **MEDIUM** | 静态门禁+A 层+24 逻辑套件真实全绿且断言独立（抽查无 expected=backend）；但 B 层存在 10 个假 PASS 通道（§4.2）、已知弱断言替产品补字段、A 轮交付链断裂是流程红旗。 |
| **Coverage Confidence** | **MEDIUM** | 覆盖地图（A 矩阵）经抽查与实况相符且诚实标注了零覆盖面；但地图上 LOW 的四条业务线恰好是安全/权限/通知。 |
| **Overall Testing Foundation** | **MEDIUM** | 底座（域层测试+静态门禁）扎实可信；顶端两层（真 E2E、UI 断言）名不副实；进入下一轮前有 4 件必须完成的事（见 §9）。 |

---

## 9. 给下一轮的裁决与前置条件

**裁决：B —— 基础设施基本可信，但需先修复少量测试问题，才能进入 P0 Golden Path。**
（不是 C：域层与 A 层的 PASS 经独立复验真实可信，测试架构不需要推倒重来；也不是 A：B 层的假 PASS 通道与一个实测 flaky 必须先处理，「进入 Golden Path」的门禁语义现在不存在——四态账本只是文档。）

**进入下一轮前必须完成（按序）：**

1. **补齐或撤回 A 的四个交付物**：`e2e-result.js`、`e2e-fault-probe-test.js`（重建时按 §4.4 的两条防自证要求）、`e2e-test.js` 的 A-025 座号读回修复（58→59）、`e2e-ui-test.js` 的最小改造（至少 R1 `$$`、R2 checkSoft 四态、R3 降级记 uiUnverified 三项）。若选择撤回，必须同步修订 SYNC.md 未提交条目，使记录与树一致。
2. **扑灭 R11 flaky**（本审计实测 60 跑 2 红、`SEAT_TAKEN`）——这是当前门禁里唯一的已知不稳定源。
3. **P0-2（报名勾选框）真机定案**（automator 或真机打印 `e.currentTarget.dataset.key`）——它的结论决定 P0 Golden Path 的报名段按「真 UI 驱动」还是「A 层信封 + UI 只测渲染」设计。同理建议一并定案 P0-3（simulation）与 P0-7（双击授权）。
4. **校准知识库**：根 AGENTS.md（16 页、39 命令、smoke 106、editor.js 行数）、`trailApi/AGENTS.md:34` 与 `domain/AGENTS.md:86` 的审计声称、lab 的「私有工具勿用于生产」边界（E P0-1 的两条守卫建议）。

**Golden Path 之后的 P1 覆盖优先级**（综合 B §17 / D Top30 / E 复测批次，按「伤害×测不到」排序）：
① 协作授权线端到端（membership.save 正/负/过期/双击去重 + readAccess——当前两层皆零且 P0-7 在此）→ ② vehicle.depart/complete 与车长页 journey（含 P1-19 编辑回归、双角色死路）→ ③ 归档安全门三连 + 取消活动护栏（B §17-1/2，A 层即可）→ ④ 幂等接线修复后的重试链路（先修 D R-2 才有得测：REQUEST_REUSED、600 窗口）→ ⑤ editor CAS 修复回归（P0-9）→ ⑥ Position/Incident 生命周期（B §17-13）。UI 断言一律按 `e2e-result-semantics.md` 的两维四态记账，UI 维度不允许 SOFT-SKIP 洗白。

---

*本审计未修改任何产品代码与任何既有测试；唯一产出为本文件与 SYNC.md 追加条目。*
