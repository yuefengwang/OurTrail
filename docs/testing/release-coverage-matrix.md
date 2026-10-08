# OurTrail Release Coverage Matrix

**生成**：2026-10-07（Phase 9.7，基线 `win/phase9-concurrency-closure` @ `09da6f6`＋Phase 8 三条 commit）
**口径来源**：`tools/e2e-result.js` 的两维四态语义、`docs/testing/e2e-result-semantics.md`、`.agents/skills/ourtrail-ui/platform-pitfalls.md`
**这份表是怎么算出来的**：对 `cloudfunctions/trailApi/domain/commands.js` 的 39 个命令类型与 `domain/contracts.js` 的 20 个错误码，
逐个在 `tools/*-test.js` + `cloudfunctions/trailApi/smoke-test.js` 里做字面命中统计（脚本手法，不靠记忆），
再人工核对"命中"是否等于"被断言"（只在注释里出现的不算）。

---

## 0. 怎么读这张表（三条不许越界的规定）

| 通道 | 是什么 | 能证明什么 | **不能**证明什么 |
|---|---|---|---|
| **smoke / domain 层** | 直调 domain 纯函数（`smoke-test.js` 167 断言） | 业务规则、阈值、错误码 | 信封、CAS、渲染 |
| **A 层（服务链路）** | 真信封打 `exports.main`：`e2e-test` 71 / `e2e-permission` 96 / `e2e-domain-negative` 83 / `e2e-concurrency` 37 / `e2e-interleave` 67 / `e2e-client-cas` 34 / `e2e-panel-sync` 40 | 授权、幂等、CAS、阶段机、响应形状 | **像素、slot、真实时序** |
| **页面级（headless 真页配置）** | `scenario-*`：`global.Page/Component` 捕获真配置 + 桩网络 | 页面装配、发出的命令、渲染态↔数据一致 | 真机渲染、云读滞后 |
| **B 层（真机/真云端）** | `e2e-ui-test` / `e2e-golden-path-test` / `e2e-ui-state-test`（需开发者工具） | 像素、点得动、原生控件限制、线上 trailApi 的真实行为 | 一次性判读会造成假红 ⇒ 必须两轮以上互证 |

**规定 1**：A 层的 PASS 不许写成 UI PASS。命令发出过一次 PASS ≠ 页面上看得见。
**规定 2**：桩（含 `TEST-HARNESS DETERMINISTIC TRANSACTION BARRIER`）的 PASS 不许写成 REAL CLOUD PASS。
**规定 3**：门槛不过、通道退化 ⇒ INCONCLUSIVE（退出码 2），**永远不是 PASS**。

---

## 1. 命令 × 通道（39 个命令类型）

列义：**套件**=命中该命令的测试文件数；**A层**=含服务链路层（e2e-* 六套 + client-cas + panel-sync）；
**页面**=含 `scenario-*`；**真云端**=B 层三套里出现的套数（`**0**` 即线上从未走过这条命令）。

| 命令 | 套件 | A层 | 页面 | 真云端 |
|---|---|---|---|---|
| `activity.copy` | 2 | 1 | 1 | **0** |
| `activity.create` | 14 | 8 | 2 | 3 |
| `activity.delete` | 5 | 2 | 2 | **0** |
| `activity.edit` | 9 | 5 | 3 | **0** |
| `activity.publish` | 14 | 8 | 2 | 3 |
| `activity.transition` | 11 | 5 | 2 | 2 |
| `assignment.commit` | 4 | 2 | 1 | 1 |
| `assignment.remove` | 1 | — | 1 | **0** |
| `assignment.set` | 7 | 4 | 1 | **0** |
| `assignment.swap` | 1 | — | 1 | **0** |
| `attendance.board` | 9 | 4 | 2 | 1 |
| `attendance.checkin` | 10 | 5 | 3 | 1 |
| `attendance.departure` | 10 | 5 | 2 | 1 |
| `attendance.home` | 7 | 3 | 2 | 1 |
| `attendance.node` | 6 | 2 | 2 | 1 |
| `attendance.returnPlan` | 2 | — | 2 | **0** |
| `companion.remove` | 2 | — | 1 | **0** |
| `companion.save` | 9 | 3 | 2 | 3 |
| `export.record` | 5 | 2 | 2 | **0** |
| `group.setTogether` | 1 | — | 1 | **0** |
| `incident.report` | 4 | — | 3 | **0** |
| `incident.resolve` | 3 | — | 2 | **0** |
| `membership.revoke` | 5 | 2 | 2 | **0** |
| `membership.save` | 7 | 2 | 2 | 2 |
| `notice.delivery` | 3 | — | 3 | **0** |
| `notice.publish` | 3 | — | 3 | **0** |
| `notice.read` | 1 | — | 1 | **0** |
| `position.report` | 3 | — | 2 | **0** |
| `position.revoke` | 3 | — | 2 | **0** |
| `profile.save` | 11 | 7 | 2 | **0** |
| `signup.cancel` | 7 | 3 | 2 | 1 |
| `signup.edit` | 4 | 1 | 2 | 1 |
| `signup.promote` | 2 | 1 | 1 | **0** |
| `signup.review` | 10 | 6 | 1 | 2 |
| `signup.submit` | 10 | 6 | 2 | 1 |
| `vehicle.complete` | 2 | — | 2 | **0** |
| `vehicle.depart` | 4 | 2 | 2 | **0** |
| `vehicle.remove` | 1 | — | 1 | **0** |
| `vehicle.save` | 9 | 5 | 1 | 1 |

汇总：**权限矩阵 19/39、负矩阵 16/39、A 层主链 16/39、真云端并集 16/39**。
即"线上从没被任何自动化走过"的命令有 **23 条**（真云端列为 0 的并集）。

---

## 2. 错误码 × 矩阵（20 个声明码）

| 码 | 负矩阵 | 权限矩阵 | A 层主链 | 真云端 | 总提及 | 备注 |
|---|---|---|---|---|---|---|
| `AUTH_REQUIRED` | — | ✓ | ✓ | 0 | 4 | 只在信封层测过（未登录） |
| `FORBIDDEN` | ✓ | ✓ | — | 0 | 9 | 权限矩阵主战场 |
| `NOT_FOUND` | ✓ | ✓ | — | 0 | 7 | |
| `INVALID_INPUT` | ✓ | ✓ | ✓ | 1 | 9 | |
| `WRONG_PHASE` | ✓ | ✓ | — | 1 | 8 | 交错链在 §13 补齐 |
| `CONFLICT` | ✓ | — | ✓ | 2 | 12 | Phase 8/9 并发链的核心 |
| `REQUEST_REUSED` | ✓ | — | — | 1 | 2 | 同 requestId 换内容 |
| `CAPACITY` | ✓ | — | — | 0 | 4 | |
| `DUPLICATE_PERSON` | ✓ | — | — | 0 | 1 | `invariants.js:58` + `signup.js:51` 两处产生 |
| `GROUP_SCOPE` | **缺** | **缺** | **缺** | 0 | **0** | 三处产生（`invariants.js:110`、`signup.js:127`、`signup.js:171`）却零断言 |
| `VEHICLE_FULL` | ✓ | — | — | 0 | 1 | |
| `SEAT_TAKEN` | ✓ | — | ✓ | 0 | 3 | |
| `PICKUP_MISMATCH` | ✓ | — | — | 0 | 1 | |
| `DRIVER_CONFLICT` | **缺** | **缺** | ✓ | 0 | 1 | 仅 A 层 `e2e-test.js` 覆盖 |
| `UNRESOLVED_DEPARTURE` | **缺** | **缺** | ✓ | 0 | 3 | §13 C1/C3 与 Phase 8 S7 已补交错形态 |
| `UNRESOLVED_SAFETY` | ✓ | — | ✓ | 0 | 3 | |
| `CONSENT_REQUIRED` | **缺** | **缺** | **缺** | 0 | **0** | 三处产生（`field.js:107/108`、`permissions.js:6`）零断言 |
| `STORAGE_UNAVAILABLE` | — | — | — | 1 | 1 | 只有真云端一次；桩里由 `store.js:129` 包装抛出 |
| `OFFLINE` | — | — | — | 0 | **0** | **除 `contracts.js` 外无任何产生点 ⇒ 声明但未接线** |
| `CORRUPT_SNAPSHOT` | — | — | — | 0 | **0** | 同上 |

---

## 3. 业务模块矩阵（任务书 §9 要求的 21 个模块）

图例：`✓`=有断言；`△`=只有 happy path 或只在单一层；`✗`=没有。
"UI"列只认真机/`scenario-*` 真页配置里**看得见的后果**，A 层绿不折算。

| 模块 | 正常路径 | 异常路径 | 权限 | phase boundary | UI（页面级/真机） | A 层 | 真云端 | 现状 | 缺口 | 优先级 |
|---|---|---|---|---|---|---|---|---|---|---|
| Activity 建/编 | ✓ | ✓ | ✓ | ✓（closing/archived/cancelled 只读） | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 覆盖充分 | 无 | — |
| Activity 复制 | ✓ | ✗ | ✗ | ✗（模板源 phase 不限？） | 页面 △ / 真机 ✗ | ✓(仅 client-cas) | ✗ | 薄 | 复制他人活动越权、源已归档时的行为 | **P2** |
| Activity 删除 | ✓ | ✓(仅权限矩阵) | ✓ | ✓ 仅草稿可删 | 页面 ✓ / 真机 ✗ | ✓ | ✗ | 中 | 删后再读的形状、级联（报名/授权/收据） | **P2** |
| Activity 发布 | ✓ | ✓ | ✓ | ✓ 仅 draft 可发布 | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 充分 | 无 | — |
| Activity 阶段推进 | ✓ | ✓ | ✓ | ✓ 全链（§13 C4/C5/C6） | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 充分 | 无 | — |
| Activity 取消 | ✓ | ✓ | ✓ | ✓ `UNRESOLVED_SAFETY` 交错已钉 | 页面 △ / 真机 ✗ | ✓ | ✗ | 中 | 取消后所有写入闸门在真机未走 | **P2** |
| Profile（本人档案） | ✓ | ✓ | ✓ | — | 页面 ✓ / 真机 ✗ | ✓ | ✗ | 中 | `profile.save` 真云端 0（`STORAGE`/首建档） | **P2** |
| 同行人 companion | ✓ | ✗ | ✗ | ✗ | 页面 ✓ / 真机 ✓(仅 save) | ✓(save) | △ | 薄 | `companion.remove` 无 A 层/无权限矩阵；代报授权链 `proxyAuthority` 的负例 | **P1** |
| Signup 提交 | ✓ | ✓ | ✓ | ✓ 截止后 | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 充分 | 无 | — |
| Signup 审核 | ✓ | ✓ | ✓ | ✓ 仅 published | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 充分 | 无 | — |
| Signup 递补 promote | ✓ | △(仅负矩阵) | ✗ | ✓ waitlisted/容量/同行组 | 页面 ✓ / 真机 ✗ | ✓ | ✗ | 薄 | `GROUP_SCOPE` 全零；容量临界并发递补 | **P1** |
| Signup 取消 | ✓ | ✓ | ✓ | ✓ travelLocked | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 充分 | 无 | — |
| Signup 资料修改 | ✓ | △ | ✗ | ✓ 截止前 / gathering 仅发起者 | 页面 ✓ / 真机 ✓ | △ | ✓ | 中 | 权限矩阵缺 `signup.edit`（代改他人资料越权） | **P1** |
| Membership 授权 | ✓ | ✓ | ✓ | ✓ 过期时间 | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 充分 | `membership.revoke` 真云端 ✗ | P3 |
| Vehicle 车辆 | ✓ | ✓ | ✓ | ✓ | 页面 ✓ / 真机 △ | ✓ | △ | 中 | `vehicle.remove`/`vehicle.complete` 无 A 层；司机变更遗留安排 | **P2** |
| Roster 名单 | ✓ | ✓ | ✓ | ✓ | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 充分 | 无 | — |
| Attendance 签到/上车/出发 | ✓ | ✓ | ✓ | ✓ `UNRESOLVED_DEPARTURE` 链 | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 充分 | 无 | — |
| Attendance 节点/到家/返程 | ✓ | △ | ✗(`node`/`returnPlan` 缺) | ✓ 阶段限定 | 页面 ✓ / 真机 ✓(node/home) | ✓ | △ | 中 | `attendance.returnPlan` 无 A 层无权限；`position.*` 的 consent 门 | **P1** |
| Transport 分车 | ✓ | ✓ | △ | ✓ 预览 baseRevision 内层 CAS（§13 C3） | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 中 | `assignment.swap`/`remove` 只在 scenario；swap 的权限与座位冲突 | **P1** |
| Field 现场面板 | ✓ | △ | ✗(`incident.*` 缺) | ✓ 阶段限定 | 页面 ✓ / 真机 △ | ✗ | ✗ | **薄** | `incident.report/resolve` 完全没有 A 层与权限矩阵；异常未解决挡归档链只有场景级 | **P1** |
| Position 位置上报 | ✓ | ✗ | ✗ | ✓ 活动结束后拒报 | 页面 ✓ / 真机 ✗ | ✗ | ✗ | **薄** | `CONSENT_REQUIRED`（`field.js:107/108`）全零断言——这是**授权**语义 | **P1** |
| Notice 通知 | ✓ | ✗ | ✗ | ✗ | 页面 ✓（67 断言） / 真机 ✗ | ✗ | ✗ | **薄** | 三条 `notice.*` 全无 A 层/权限/负矩阵；受众与送达状态语义只在场景级 | **P1** |
| Export 导出 | ✓ | △ | ✓ | — | 页面 ✓ / 真机 ✗ | ✓ | ✗ | 中 | `export.record` 真云端 ✗；敏感导出用途必填的负例在 A 层缺 | P2 |
| Sensitive read 敏感查看 | ✓ | △ | ✓ | — | 页面 ✓ / 真机 ✗ | ✓ | ✗ | 中 | `readContact`/`readSensitive` 的 purpose 审计链真云端未走 | P2 |
| Access 准入 | ✓ | ✓ | ✓ | — | 页面 ✓ / 真机 ✓ | ✓ | ✓ | 充分 | 无 | — |
| Archive 归档 | ✓ | ✓ | ✓ | ✓ `UNRESOLVED_SAFETY` | 页面 △ / 真机 ✗ | ✓ | ✗ | 中 | 归档后全量只读在真机未验 | P2 |
| Weather 天气线 | ✓ | ✓ | — | — | 真机 ✓（截图留档） | ✓（13 套） | △ | 充分（另属模块） | 本矩阵不展开（任务书 §13 划归"不碰 Weather"） | — |

---

## 4. 页面 × 通道（17 页）

`app.json` 实测 **17** 页（AGENTS.md 的"16 页"需更新：新增 `pages/weather-hub` 与 `pages/cloud-field-poc`）。

| 页面 | 专属页面级套件 | 真机 B 层引用 | 备注 |
|---|---|---|---|
| home | —（经 scenario-api/discover 间接触） | ✓ | 无专属套件：卡片装配/筛选只靠 B 层 |
| notices | ✓（522 行） | ✗ | 受众/已读/送达 |
| anotices | — | ✗ | **组织者通知面，零专属套件** |
| me | ✓（988 行） | ✗ | |
| activity | ✓（1135 行） | ✓ | |
| discover | ✓（214 行） | ✗ | |
| signup | ✓（848 行） | ✓ | |
| editor | ✓（774 行） | ✓ | BUG-C1 的宿主；新增 `e2e-client-cas-test` 直连真页 × 真云代码 |
| workspace | ✓（910 行） | ✓ | §14 另有 `e2e-panel-sync-test` |
| staff | ✓（235 行） | ✗ | 车长/协作任务面 |
| vehicle | ✓（567 行） | ✓ | |
| weather / weather-chart / weather-hub / cloud-field-poc | —（天气线 13 套覆盖） | ✓（截图） | 本矩阵不展开 |
| lab | ✓（237 行 + trailapilab 25 + lab-dryrun 165） | ✗ | |
| privacy | — | ✗ | **零覆盖**；页面在 app.json 里但无专属/引用 |

---

## 5. 缺口清单（按任务书 §10 的优先级口径，只列真正有价值的）

### P1（状态破坏 / 权限绕过 / 数据覆盖 / stale write / concurrency / 错误阶段转换）

1. **`CONSENT_REQUIRED` 零断言**——位置上报的同意门（`field.js:107`）与授权过期门（`field.js:108`）是隐私语义，
   现在改坏不会有任何测试变红。**建议**：负矩阵补两条（无 consent / 活动已过 endAt），A 层补一条真实上报链。
2. **`GROUP_SCOPE` 零断言**——同行组"必须同车/必须一起递补"的三处产生点（`invariants.js:110`、`signup.js:127`、`signup.js:171`）
   全部无测。**建议**：负矩阵补 keepTogether 组的 swap/assignment/promote 三种越界。
3. **`incident.*`（现场异常）无 A 层、无权限矩阵**——而"未解决异常挡归档"是安全链的门
   （`activity.js:185` closing→archived 要求 `state.incidents` 无 open）。现在只有 `scenario-*` 的装配级保护。
4. **`assignment.swap` / `assignment.remove` / `vehicle.remove` 只有 1 个套件**——座位是履约的核心数据，
   swap 的双向约束（两人同车、司机位）没有负矩阵。
5. **`signup.edit` / `signup.promote` 不在权限矩阵**——代改他人报名资料、候补递补都是可越权的动作。
6. **`companion.remove` 无 A 层**——删除同行人会级联影响代报授权（`proxyAuthority`）后的记录归属。

### P2（关键 UI 支线 / cancel-delete-recovery / 车辆与分车边界 / 多角色工作流）

7. **真云端 0 覆盖的命令 23 条**（表 1 最后一列）——B 层三套只走完了 16 条。
   `activity.edit`/`activity.copy`/`activity.delete`/`notice.*`/`position.*`/`incident.*`/`export.record` 全在线上没有自动化。
   这一条不是"补测试"就能收口的：B 层每加一节点，真机跑时 +1 RTT（本轮实测读 RTT≈2.9 s、写≈4–6 s）。
8. **`anotices`（组织者通知页）与 `privacy` 页零专属套件**。
9. **`attendance.returnPlan`（返程安排核实）无 A 层无权限**——返程是安全收尾链的一环。
10. **`OFFLINE` / `CORRUPT_SNAPSHOT` 声明但无任何产生点**（除 `contracts.js`）——要么接线要么从契约里删；
    留着会让"我们处理了离线/坏快照"这句话没有依据。

### P3（已知、记录、不阻塞）

11. `api.js:121` 的 `Promise.resolve(page.reload()).catch(()=>{})` 吞掉重读失败（后果已被 `e2e-panel-sync` P4 判明：fail closed，只多一次冲突往返）。
12. 全局单 revision ⇒ 别的活动的写入会造成伪冲突（与 `loadState` 每请求读 15 集合是同一处规模墙）。
13. `activity.transition` 会把 `acceptingSignups` 置 false，而它在 gathering 的 lockedKeys 里 ⇒ 陈旧整份表单只改说明也被拒，
    文案指向"仅可修改说明"，误导用户（§13 C6 已钉住行为）。
14. BUG-C2（CONFLICT 后草稿优先的二次覆盖）——常驻红测在 `e2e-client-cas-test` C5，属冲突合并产品决策，未授权修改。

---

## 6. Release Gate 现状（一句话）

无头门禁 **41 套**（含本轮新增 `e2e-client-cas` / `e2e-interleave` / `e2e-panel-sync`）全绿可进 CI；
B 层三套需开发者工具、不计入门禁，且本轮两轮的归宿分别是 **INCONCLUSIVE**（原生 picker 不可自动化）与
**FLAKY**（真云端读滞后导致的一次假红）。
⇒ **主链与并发/一致性已具备正式 gate 的形状；缺口集中在"授权/通知/异常/座位调整"这四族 A 层空白与 23 条真云端零覆盖命令。**
