# Permission / Security Matrix（Phase 6 初版，随测试证据更新）

> Role × Command × Phase × Resource relation 的授权矩阵。
> 所有 Expected 从现行代码推导（`domain/permissions.js canExecute/staffCan/vehicleCan/canReadSensitive/canReadNotice`
> + `domain/signup.js|field.js|transport.js|activity.js|profile.js` 的阶段与业务门 + `selectors.js` 读投影），
> 不自行定义业务规则。Actual/Test status/Evidence 由 `tools/e2e-permission-test.js`（A 层真实信封）填充。
> 代码、文档与测试冲突处标 `NEEDS_PRODUCT_DECISION`。

## 错误码语义（DENY 断言的依据）

| code | 含义 | 触发示例 |
|---|---|---|
| AUTH_REQUIRED | 未选择账号（actor.userId=null） | 合成未登录 actor |
| FORBIDDEN | 身份/范围/归属不允许 | 非 owner 写 owner-only 命令；跨活动目标（「报名记录不属于此活动」） |
| NOT_FOUND | 资源不存在（≠ 权限拒绝） | signupId/vehicleId 不存在 |
| WRONG_PHASE | 阶段门 | archived 后继续写入、published→gathering 有 pending |
| CONSENT_REQUIRED | own 但缺代办同意字段 | attendance.home 的 proxy 路径缺 proxyHome |
| INVALID_INPUT | 业务校验（非权限） | — |

**DENY 断言三要素**：command failed + error.code 精确匹配 + 目标状态前后不变（before/after read）。
NOT_FOUND ≠ FORBIDDEN：必须构造存在的资源 + 正确 actor + 错误角色，确保命中权限语义而非资源缺失。

## 角色与身份路径（全部走真实 envelope，无 mock）

| 角色 | 建立路径 |
|---|---|
| Owner（LIN） | activity.create（openid=LIN） |
| Staff（ALICE） | profile.save + **Owner** 发 membership.save（role staff, capabilities[roster,checkin,node,incident,position,home,sensitive], scope all, 未过期） |
| VehicleCoordinator（VCOORD） | **Owner** 发 membership.save（role vehicle_contact + vehicleId） |
| OrdinaryMember（MEMBER） | companion.save + signup.submit（本人关系）→ Owner review confirm |
| NonMember（NOBODY） | 仅 profile.save，与活动无任何关系 |
| AnotherOwner（OWNER2） | activity.create 第二场活动（跨 owner 测试） |

## A. Activity ownership × 命令（活动 LIN，published 阶段除特殊注明）

| Actor | Command | Expected | 依据 |
|---|---|---|---|
| Owner | activity.edit | ALLOW | canExecute owner-only 组 |
| Member | activity.edit | FORBIDDEN | 同上 |
| NonMember | activity.edit | FORBIDDEN | 同上 |
| AnotherOwner | activity.edit（跨 owner） | FORBIDDEN | isOwner 按 ownerId |
| Owner | activity.transition published→gathering | ALLOW（无 pending 时） | 阶段门 + owner-only |
| Member | activity.transition | FORBIDDEN | owner-only |
| Owner | activity.delete（非 draft） | FORBIDDEN「只有未发布的草稿可以删除」 | delete 门 |
| Member/NonMember | activity.copy（源=他人活动） | FORBIDDEN | activity.copy owner-only（源活动所有者） |

## B. Signup / roster

| Actor | Command | Expected | 依据 |
|---|---|---|---|
| Member（自己） | signup.edit（带 purpose） | ALLOW | own + canReadSensitive(self) |
| Staff | signup.edit（他人） | FORBIDDEN「没有编辑此报名的权限」 | own/owner only（staff 不行） |
| Member | signup.review | FORBIDDEN | owner-only |
| Staff（任意能力） | signup.review | FORBIDDEN | owner-only（staff 无审核能力——重要矩阵格） |
| Owner | signup.review | ALLOW | owner-only |
| Staff | signup.cancel（他人） | FORBIDDEN | owner \|\| own（staff 无取消他人权） |
| Member | signup.cancel（自己） | ALLOW | own |
| NonMember | signup.submit（本人，published+manual） | ALLOW（pending） | submitSourceAllowed(self)；人工审核留存 |

## C. Vehicle

| Actor | Command | Expected | 依据 |
|---|---|---|---|
| Owner | vehicle.save | ALLOW | owner-only 组 |
| Member / Staff / VCOORD | vehicle.save | FORBIDDEN | owner-only（staff/vehicle_contact 均无） |
| Owner | assignment.set（Member→1号车） | ALLOW | owner-only |
| VCOORD(1号车) | attendance.board（乘员在 1号车） | ALLOW | owner \|\| vehicleCan(assignment.vehicleId) |
| VCOORD(1号车) | attendance.board（乘员在 2号车） | FORBIDDEN | vehicleCan 绑定 vehicleId（越权车辆） |
| Member | attendance.board（自己） | FORBIDDEN | board 非 self-service |
| VCOORD(1号车) | vehicle.depart 1号车 | ALLOW | owner \|\| vehicleCan |
| VCOORD(1号车) | vehicle.depart 2号车 | FORBIDDEN | vehicleCan 跨车 |
| Owner | membership.save vehicle_contact + 不存在 vehicleId | **NOT_FOUND**（实测验证 Phase 4 记录是否成立） | canExecute→requireVehicles 存在性校验 |

## D. Check-in / Departure / Home

| Actor | Command | Expected | 依据 |
|---|---|---|---|
| Member（自己） | attendance.checkin | ALLOW | own |
| Member | attendance.checkin（他人） | FORBIDDEN | 非 own 且无能力 |
| Staff(checkin,scope all) | attendance.checkin（他人） | ALLOW | cap('checkin') + scope |
| Staff(roster only) | attendance.checkin | FORBIDDEN | 能力不匹配（有 membership 无此能力） |
| Staff(checkin) | attendance.departure（他人） | ALLOW | departure=owner\|\|cap('checkin')（非 self-service） |
| Member（自己） | attendance.departure | FORBIDDEN | 出发核实非本人操作 |
| Member（自己） | attendance.home | ALLOW | 全 self |
| Member | attendance.home（他人） | FORBIDDEN | 非 owner/cap/proxy |
| Owner | attendance.home（他人） | ALLOW | owner |
| Staff(home,scope all) | attendance.home（他人） | ALLOW | cap('home') |
| VCOORD | attendance.checkin/departure/home | FORBIDDEN | vehicle_contact 不授名单/现场能力 |

## E. Membership / Collaboration

| Actor | Command | Expected | 依据 |
|---|---|---|---|
| Owner | membership.save（授 staff） | ALLOW + readAccess 回读 | owner-only |
| Member | membership.save（自提权为 staff） | FORBIDDEN | owner-only（自提权防线） |
| Member | membership.revoke | FORBIDDEN | owner-only |
| Staff | membership.save/revoke | FORBIDDEN | owner-only |
| Member / Staff / VCOORD | readAccess | FORBIDDEN「仅活动所有者可管理此资源」 | selectAccess ownerPermission |
| Owner | membership.save vehicle_contact + 跨活动 vehicleId | FORBIDDEN（车辆不属于此活动） | requireVehicles 归属校验 |

## F. Read / Export（读面与字段级过滤）

| Actor | Read | Expected | 依据 |
|---|---|---|---|
| Owner | readTransport / readAccess / readNoticeManagement | ALLOW | ownerPermission |
| Member / Staff / VCOORD | readTransport / readAccess / readNoticeManagement | FORBIDDEN「仅活动所有者可管理此资源」 | 同上（重要：staff/vcoord 也读不到） |
| Member（自己） | readSensitive（带 purpose） | ALLOW | self 免费 |
| Member | readSensitive（他人，带 purpose） | FORBIDDEN | 非本人/代办/工作用途 |
| Staff(sensitive,scope) | readSensitive（他人，purpose） | ALLOW | staffCan('sensitive') |
| Staff(roster only) | readSensitive | FORBIDDEN | 能力不匹配 |
| Owner | readSensitive（他人，purpose） | ALLOW | owner |
| 任意 | readSensitive（archived 活动他人） | FORBIDDEN | workDataAvailable=false（阶段×读） |
| VCOORD(1号车) | readContact（1号车 confirmed 乘员） | ALLOW | 工作联络路径 |
| VCOORD(1号车) | readContact（未分配该车的报名） | FORBIDDEN | 行+车辆绑定 |
| Staff(roster) | readContact（他人） | ALLOW | staffCan('roster') |
| Member | readForm（他人） | FORBIDDEN | readForm=own/owner（staff 亦拒） |
| Member | export.record | FORBIDDEN | owner-only |
| Owner | export.record sensitive 无 purpose | FORBIDDEN「敏感导出需要当次工作用途」 | 用途门 |
| Owner | export.record sensitive + purpose → readExport | ALLOW | 全链 |
| NonTarget | notice.read（audience=signups 他人） | FORBIDDEN | canReadNotice 受众 |

## G. Archived / Closed phase × 写入（阶段×命令抽样）

| 阶段 | Command | Expected |
|---|---|---|
| archived | attendance.* / vehicle.save / signup.review | WRONG_PHASE（各 handler 阶段门） |
| archived | readSensitive（他人） | FORBIDDEN（workDataAvailable=false——注意：非 WRONG_PHASE，读面语义） |
| cancelled | attendance.* | WRONG_PHASE |
| draft | activity.delete | ALLOW（owner）——对照 non-draft 的 FORBIDDEN |

## 实测结果（tools/e2e-permission-test.js，96 断言 0 失败）

上表 Expected 全部经真实信封实测：**ALLOW 格确认放行且落库正确；DENY 格确认
error.code 精确匹配 + 权威态前后不变（snapshot 对比）**。要点与更正：

1. **Phase 4 记录更正**：「membership.save 不校验 vehicleId 存在性」**不成立**——
   `canExecute` 的 membership.save 分支把 vehicleId 推给 `requireVehicles`，
   不存在的 vehicleId → **NOT_FOUND**（实测 ✓）。Phase 4 的记录只看到了 profile.js 层，
   漏了 canExecute 的入口校验。相关残余：profile.js 层仍无校验（纵深冗余），
   但真实信封路径已被入口覆盖 ⇒ 不构成可达安全问题。
2. **过期授权在写入时即被拒**：membership.save + 过期 expiresAt → **INVALID_INPUT**
   「授权结束时间必须晚于当前时间」（实测 ✓）——过期授权不可经真实路径产生，
   `staffCan` 的过期分支是纵深防御，A 层无法触达（记录为域行为行）。
3. **读面拒绝的信封形态与 dispatch 不同**：dispatch 拒绝 = 顶层 `{ok:false, error}`；
   读面拒绝（选择器返回而非 throw）= **`{ok:true, data:{ok:false, error}}` 嵌套**——
   （`selectTransport/selectSensitive/selectContact/selectForm/selectAccess` 实测均为嵌套）。
   客户端必须检查 `data.ok` 而非 `ok`——测试断言按此写。
4. **activity.edit 的 handler 级门是 owner || own**（MEM 编辑自己相关的活动信息在
   canExecute 开放后会被 handler 的 own 路径放行——M1 变异的 12 红中发现）。
   语义：participant 编辑活动级字段是否应该被允许 = **NEEDS_PRODUCT_DECISION**
   （canExecute 说 owner-only，handler 说 owner||own——两层不一致）。

## 待实测裁决（套件运行后回填 Actual）

1. ~~Phase 4 记录「membership.save 不校验 vehicleId 存在性」~~ **已实测更正**：
   canExecute 的 requireVehicles 覆盖（不存在 → NOT_FOUND 实测 ✓）；
   profile.js 层的缺失为纵深冗余，非可达缺口。
2. ~~staffCan 的过期边界~~ **已实测更正**：过期授权在写入时即被拒（INVALID_INPUT），
   staffCan 过期分支不可达（纵深防御）。
3. notice.read 的 vehicle 受众三方可读性（owner/vcoord/被分配 confirmed 乘员）——
   canReadNotice 代码路径已审计（owner ∨ vehicleCan ∨ own+confirmed+assigned），
   A 层 cell 未单列（受众模型留 Phase 7）。
4. **activity.edit 两层门不一致（owner-only vs owner||own）**——
   **NEEDS_PRODUCT_DECISION**（先确定语义，再决定是否收紧 handler 或放宽 canExecute）。
