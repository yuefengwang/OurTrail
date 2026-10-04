# OurTrail 主动漏洞式代码审查（Bug Hunt）

**基线**：GitHub HEAD `1acd55e`（2026-10-04 13:36 +0800 · master）
**范围**：`miniprogram/` · `cloudfunctions/trailApi/` · `cloudfunctions/trailApi/domain/` · `cloudfunctions/trailApiLab/` · `tools/` · 相关 `docs/` 与 `AGENTS.md`
**方式**：只读审查。未修改任何代码、未修复任何 bug、未新增任何测试。
**证据规则**：每条 finding 的 `file:line` 均为本次实读所得。**取证状态**标注：**已核实** = 静态取证完整；**待复测** = 机制成立，但某个平台限制/时序/现网触发率需真机或云端读数确认。
**明确排除**：代码风格、命名、注释、可读性、"可以更好"。

**严重度**：P0 = 数据错误 / 核心流程无法完成 · P1 = 重要功能错误 · P2 = 一般问题

**统计**：P0 9 条 · P1 23 条 · P2 39 条（合计 71）。其中 8 条为「测试/文档反而为缺陷背书」类，见文末专节；另有 9 条怀疑经本次逐行否证，记在「已核查为非问题」以免重复追。

---

## P0

### P0-1 · 预演云函数 `trailApiLab` 与生产共用同一套 `ot_*` 集合，且给定 `activityId` 时绕过「[预演]」前缀约束——可写入并可**物理删除**真实活动

| 字段 | 内容 |
|---|---|
| 文件 | `cloudfunctions/trailApiLab/index.js` · `stages.js` · `store.js` |
| 代码位置 | `diff cloudfunctions/trailApi/store.js cloudfunctions/trailApiLab/store.js` → **完全相同**（同一 `COLLECTIONS` 映射、同一 `ot_meta/main` 全局计数器）· `lab/index.js:90` `let activityId = event.activityId ? String(event.activityId) : ''` · `:91` `if (stage !== 0 && !activityId)` → 显式传 id 时**不进** `findLabActivity` · `stages.js:47-53`（唯一的前缀约束 `a.title.indexOf(PREFIX) === 0` 只存在于 `findLabActivity`）· `lab/index.js:237` `if (event.activityId) ids = [String(event.activityId)]`（无前缀、无归属校验）· `:248-263` 对 `activities/groups/signups/vehicles/assignments/memberships/incidents/events/notices` 逐条 `doc(...).remove()` · `index.js:1` 头部注释「私有测试工具，勿用于生产数据」 |
| 触发条件 | 白名单账号（或掌握 `LAB_SECRET` 者）经云开发控制台「云端测试」/脚本 `callFunction` 调 `trailApiLab`，`{action:'seed', stage:3, activityId:'<真实活动 id>'}` 或 `{action:'cleanup', activityId:'<真实活动 id>'}`。**一个手抄错的 id 即可触发**；控制台的报错文案 `:94-96` 还主动建议「或在参数里直接给 activityId」。 |
| 实际执行路径 | 1. `index.js:310` 白名单放行。2. `:90` 取到显式 id → `:91` 条件为假 → 前缀守卫被完全跳过。3. `stages.buildStage` 直接对真实 `activityId` 造 5 个 `u-lab-*` 演员报名/签到/位置。4. `:131-144` `store.diffCollections` + 一个事务写入 `ot_signups`/`ot_attendance`/`ot_positions`，并递增 `ot_meta/main`。5. `cleanup` 分支更直接：`:248` 起对真实 id 的 9 类记录物理 `remove()`。 |
| 为什么会出错 | 前缀作用域只实现在"自动查找"这条路径里，而"显式指定"这条路径把它整条绕开；`store.js` 是生产的逐字节复制，因此不存在任何独立的 lab 数据库边界。**边界只写在注释里**，注释不是访问控制。附带：lab 的 CAS 用 `expectedRevision: working.revision`（自指，`:137`），因此预演永不冲突，但它每写一次就推进**全局** revision，使真实客户端持有的令牌集体过期。 |
| 用户能看到什么 | 真实组织者的名单里凭空多出 5 个假人（含编造的紧急联系方式），真参与者收到关于他们的通知，现场/位置被盖上假事实；`cleanup` 直接把一场真实活动连同其**安全记录**（到家、异常、履约）整体抹除，不可恢复。 |
| backend 最终状态 | `ot_signups`/`ot_attendance`/`ot_positions` 出现非人类记录；或 9 类集合中真实 id 的行被全部删除。`assertInvariants` 全程满足，因此没有任何一层会拒绝。`ot_meta.revision` 被推高。 |
| 推荐验证方法 | 一次性（隔离环境）：非白名单用户建一场真实 published 活动，白名单账号带该 id 调 `seed`，再用 `trailApi {action:'read', kind:'activity'}` 看是否出现 `u-lab-*`。常驻门禁建议（本次不改）：`seed`/`cleanup` 必须拒绝任何 `title.indexOf('[预演]') !== 0` 的 id。 |
| 鉴权边界的实况（本次逐行核实） | `lab/index.js:308-314`：`authedOwner = openid && (isConfigOwner(openid) \|\| dbIds.indexOf(openid) !== -1)`，`secretOk = !!cfg.LAB_SECRET && event.secret === cfg.LAB_SECRET`，`if (!authedOwner && !secretOk) fail(...)`。即 `lab.config.js:17` 的 `LAB_SECRET: ''` **只关闭"控制台无 openid"这条路**，而 **openid 白名单这条完全开着**——`lab.config.js:12` 直接硬编码了一个真实 openid 作引导白名单，且 `resolveOwner`（`:173`）在无参时回落到 `cfg.OWNER_OPENID`，也就是**默认以那个人的身份读写**。因此本条是**现网可达**，不是"工具当前已关闭"。附带文档不实：`lab/index.js:6` 头注释写「动作（全部要求 `event.secret === lab.config.LAB_SECRET`）」，与实际的双路放行不符，会误导下一次改动。 |
| 取证状态 | **已核实** |

---

### P0-2 · 「选择参与人」勾选框在真机上不生效：同行人永远加不进报名表，而 100 例场景测试全绿

| 字段 | 内容 |
|---|---|
| 文件 | `miniprogram/pages/signup/signup.wxml` · `signup.js` · `tools/scenario-signup-test.js` |
| 代码位置 | `signup.wxml:60`（`<checkbox-group bindchange="onToggleCandidate">`，data 属性不在其上）· `:61`（`data-key="{{item.key}}"` 挂在**内层 `<label>`**）· `signup.js:186-187`（`const key = e.currentTarget.dataset.key`）· `signup.js:188`（`checked = e.detail.value.length > 0 && e.detail.value.indexOf(key) !== -1`）· `:199`（else 分支 `participants.filter(p => p.key !== key)`）· 正确写法同仓对照：`roster-panel.wxml:48` `<checkbox-group data-id="{{item.signupId}}" bindchange="onSelect">` · 测试造事件：`scenario-signup-test.js:78` `const pickEv = (key, values) => ({ currentTarget: { dataset: { key } }, detail: { value: values } })` |
| 触发条件 | 打开任意活动报名页，勾选一个同行人。 |
| 实际执行路径 | `bindchange` 绑在 group 上 → 回调里 `e.currentTarget` 即 group 节点，其 `dataset` **不含** `key`（`data-key` 在子 `<label>` 上，`currentTarget` 不取子节点 dataset）→ `key === undefined` → `detail.value` 是真实 key 数组，`indexOf(undefined) === -1` → **`checked` 恒 false** → 恒走 else 分支 `filter(p => p.key !== undefined)` → **既不加入也不移除任何东西** → `:201` 把原样列表再写一次草稿。 |
| 为什么会出错 | 事件契约错配：`checkbox-group` 的 `change` 不携带"变更项的 dataset"，代码却按"独立 checkbox + data-key"模型取值。`signup.js:10-12` 那段为「杜绝真机事件值形状差异」而写的 `toggleOn` 归一化只处理了 `detail.value`，且在本路径根本没被调用。而 `pickEv` **手工把 `currentTarget.dataset.key` 塞进事件对象**，于是 `:742-751` 四条断言（勾选→新增一行、取消→移除）全部通过：测试替产品补了一个真机不会产生的字段。 |
| 用户能看到什么 | 勾选后复选框打上勾，但参与人区不新增卡片、"还可申请 N 人"不变；再点取消也移不掉任何东西。参与人集合被锁死为 `reload()` 产出的那份（默认**仅本人**）。**代报/多人同行报名整体不可用，且全程无报错**。 |
| backend 最终状态 | 无写入（命令从未发出）。连带后果：`ot_groups` 不再产生多人同行组，`keepTogether`、分车的 `group_too_large` 判定链路同时空转。 |
| 推荐验证方法 | 一次性真机判据：在 `onToggleCandidate` 首行打印 `e.currentTarget.dataset.key` 与 `e.detail.value`。前者 `undefined`、后者为 key 数组即确认。 |
| 取证状态 | 代码与测试两侧**已核实**；`currentTarget` 语义结论**待真机确认**（同仓 `roster-panel.wxml:48` 的写法是强佐证——作者知道 data 属性必须挂在 group 上） |

---

### P0-3 · 代报的同行人在活动详情页无法签到：客户端硬编码 `simulation`，服务端只允许本人模拟

| 字段 | 内容 |
|---|---|
| 文件 | `miniprogram/pages/activity/activity.js` · `cloudfunctions/trailApi/domain/field.js` · `selectors.js` |
| 代码位置 | `activity.js:470`（`checkIn: { method: 'simulation', evidence: { at:'', by:'', note:'本人定位签到' }, coordinates }`）· `:472-481`（`manual` 分支只在 `wx.getLocation` **失败**的 `.catch` 里可达）· `field.js:66`（`if (p.checkIn.method === 'simulation' && !isSelfSignup(signup, command.actor)) return failure('FORBIDDEN','模拟定位签到只能由本人主动操作。')`）· `permissions.js:14-16`（`isSelfSignup` 要求 `personRef.kind==='user'`；代报行是 `kind:'companion'`）· `selectors.js:445`（服务端下发的 `permittedActions` 模板里 `checkIn.method` 明明是 **`'manual'`**，页面未使用模板） |
| 触发条件 | 为同行人代报成功 → 活动进入 `gathering` → 打开该同行人的「资料与操作」→ 点「确认已到集合点」→ **允许定位**。 |
| 实际执行路径 | `selectors.js:444-445` 挂出 `attendance.checkin` → `activity.js:410` `canCheckin=true` → `onCheckin` 定位成功 → 以 `simulation` 发命令 → `field.js:66` 判非本人 → `FORBIDDEN`；因定位成功，`manual` 兜底不可达。 |
| 为什么会出错 | 签到方式由"定位是否可用"决定，而不是由"这一行是不是本人"决定。服务端已在 `permittedActions` 里给出正确载荷模板，页面自行拼载荷 → **两套载荷来源**，漂移由此产生。附带：`note` 硬编码「本人定位签到」，即便落库也是虚假陈述。 |
| 用户能看到什么 | 「模拟定位签到只能由本人主动操作。」出现在面板里，**没有任何替代按钮**（要走到 `manual` 必须先关掉定位权限再手写说明——反直觉到不可能被发现）。同行人的到场无法记录。 |
| backend 最终状态 | `ot_attendance[].checkIn` 保持 `null`。连锁：`field.js:85` 出发核实依赖签到 → `activity.js:164-165` 的 `gathering→active` 闸要求"实际出行者需签到" → **整场活动无法发车**，直到组织者改用「本次说明」人工补签。 |
| 推荐验证方法 | `smoke-test.js`（可直达 `handleField`）：`method:'simulation'` + 非本人 actor，断言 `FORBIDDEN`。`scenario-activity-test.js`：断言「`row.signupId !== view.primarySignupId` 时载荷 `method` 必须为 `manual`」。真机：代报一人后到 `gathering` 点签到。 |
| 取证状态 | **已核实** |

---

### P0-4 · 草稿里残留的已删除同行人无法从报名表移除，该活动的报名永久失败且无自愈路径

| 字段 | 内容 |
|---|---|
| 文件 | `miniprogram/pages/signup/signup.js` · `signup.wxml` · `cloudfunctions/trailApi/domain/signup.js` |
| 代码位置 | `signup.js:103`（`participants = saved.participants \|\| participants`，草稿整份胜出，**未与刚读到的 `candidates` 求交**）· `:119`（`candidates: [own].concat(companions)` 来自当前档案）· `signup.wxml:60-65`（唯一移除入口是候选勾选）· `signup.js:186-200`（`onToggleCandidate` 按 `this.data.candidates` 查 key）· `:218-224`（`togglePart` 只展开/折叠，无删除）· `domain/signup.js:47-48`（`FORBIDDEN '只能为本人或当前账号已有的同行人报名。'`）· `signup.js:370`（草稿只在成功提交后清） |
| 触发条件 | 草稿中勾过同行人 C → 去「我的」删除 C → 回到该活动报名页提交。 |
| 实际执行路径 | `reload()` 得到不含 C 的候选，但 `:103` 用草稿覆盖 `participants`（含 `key:'c:C'`）→ `signup.wxml:69` 起仍渲染 C 的卡片 → 候选区不含 C ⇒ **没有对应复选框**，而这是唯一移除入口 → `validate()` 通过 → 提交含 C → `domain/signup.js:47` `FORBIDDEN` → `:370` 不执行 → 草稿保留 → 下次完全相同。 |
| 为什么会出错 | 草稿被当作"用户输入"整份信任，未与当前可选项做剪枝；而渲染模型是**候选驱动**的（只有候选才带移除 affordance）。于是「能显示 ≠ 能移除」。**与 P0-2 叠加时更硬**：勾选框本身在真机不生效，即便 C 还在候选里也移不掉任何人。 |
| 用户能看到什么 | 表单看起来是正常 3 人报名，每次提交都得到「只能为本人或当前账号已有的同行人报名。」，卡片上没有 ✕，也没有任何指向「去「我的」处理同行人」的提示。该活动对该用户彻底报名无门。 |
| backend 最终状态 | 无写入。被卡住的只是本机 `ourtrail.drafts.v1`。 |
| 推荐验证方法 | `scenario-signup-test.js`：预置含 `companionId:'gone'` 的草稿 + 桩档案 `companions: []`，断言 participants 含该孤儿、且不存在任何可移除它的路径；再用该载荷走 `smoke-test` 断言 `FORBIDDEN`。 |
| 取证状态 | **已核实** |

---

### P0-5 · 私有草稿一旦「取消」即永久残留，且原本仅组织者可见的内容转为任意登录用户可读

| 字段 | 内容 |
|---|---|
| 文件 | `cloudfunctions/trailApi/domain/activity.js` · `selectors.js` · `permissions.js` · `miniprogram/pages/workspace/workspace.js`/`.wxml` |
| 代码位置 | `workspace.js:103-104`（`canCancel` 白名单**显式含 `'draft'`**）· `workspace.wxml:76`（红色「取消活动」按钮 `data-next="cancelled"`）· `activity.js:140-141`（取消分支 `['draft','published','gathering']` → draft 放行）· **`selectors.js:322`（`if (activity.phase === 'draft' && !owner) return deniedView('FORBIDDEN','未发布活动仅所有者可见。')`——隐私闸按 phase 字符串判）** · `permissions.js:242` + `activity.js:196`（删除要求 `phase === 'draft'`）· `activity.js:95`（编辑显式拒绝 `cancelled`）· `selectors.js:425`（`publish`/`delete` 仅在 draft 挂入口）· `invariants.js:46`（`phase !== 'draft' && !== 'cancelled'` 才校验完整性） |
| 触发条件 | 工作台打开一场草稿 → 点「取消活动」→ 填理由确认。**一步**。 |
| 实际执行路径 | `workspace.js:141` 发 `activity.transition{next:'cancelled'}` → `permissions.js:248` owner 判定与 phase 无关 → `activity.js:141` draft 通过 → `:153 phase='cancelled'` → `invariants.js:46` 豁免 cancelled → 落库。此后 `:196` 删除要求 draft（报「只有未发布的草稿可以删除；已发布活动请使用取消。」——对从未发布的草稿是废话）、`:95` 编辑拒 cancelled、`selectors.js:425` 不再挂 publish/delete ⇒ **无任何恢复路径**。同时 `selectors.js:322` 的 draft 隐私闸**不再命中** ⇒ 任何持 id 的登录用户以 `perspective:'participant'` 即可拿到 `view.activity` 的 13 键：标题、说明、路线快照（节点/风险）、集合点地址、费用与取消说明。id 可来自分享链接，也可由客户端自填 `request.openedActivityIds`（`selectors.js:257/264`）带入首页。 |
| 为什么会出错 | 「草稿=私有」这条不变量被编码在 **phase 字符串**上，而取消是一次**离开 draft 的转移**；所有恢复操作又锚在 `phase==='draft'`。一次取消同时做了两件未被审视的事：把记录推出全部可写/可删状态，又把它推出唯一那道隐私保护。取消分支显然只为"已发布活动撤回"而设计（文案「只能在出发前取消活动」亦印证），draft 落入白名单是顺带的。 |
| 用户能看到什么 | 组织者：草稿再也删不掉、改不了，首页永远挂着「活动已取消」，提示还让他"用取消"。他人：能打开这场从未发布的活动，看到标题/路线/集合地址/费用。 |
| backend 最终状态 | `ot_activities` 一行 `phase:'cancelled'`（可含 `title:''`、`startAt:null` 的半空态）**永久不可清理**；`ot_events`+`ot_notices` 各加一条 transition 记录，且通知受众是 `{kind:'activity'}`（`commands.js:70`）——向一场"没人能看见"的草稿的相关方推送。 |
| 推荐验证方法 | smoke：`activity.create` → `activity.transition{cancelled}` 应返回 `WRONG_PHASE`（当前 ok）；若保留该能力，则随后 `activity.delete` 必须 ok，且非 owner 的 `selectView` 必须 `deniedView`（当前返回活动详情）。 |
| 取证状态 | **已核实** |

---

### P0-6 · 敏感名单的读取与导出**结构上不可能留审计**，而两处知识库都声称会留

| 字段 | 内容 |
|---|---|
| 文件 | `cloudfunctions/trailApi/index.js` · `domain/selectors.js` · `domain/permissions.js` · `cloudfunctions/trailApi/AGENTS.md` · `domain/AGENTS.md` · `miniprogram/components/roster-panel/roster-panel.js` |
| 代码位置 | `index.js:88-101`（`actionReadSensitive`/`actionReadContact`/`actionReadExport` 只做 `loadState` + selector + return）· 全文件**唯一**持久化点在 `index.js:132`（`actionDispatch` 内）· `selectors.js` 全文仅 3 处 `.push(`，位于 `:214`/`:226`/`:228`，**全部是拼 CSV 的 headers/values/cells，无一写入 `state.events`/`state.notices`** · `selectExport` 的授权只是纯谓词 `canExecute(state, actor, {type:'export.record',…}, now)` · `permissions.js:71-82`（`purpose.trim()` **只当布尔门槛用**，从不落库）· `permissions.js:228-238` · 文档：`cloudfunctions/trailApi/AGENTS.md` action 表 `readSensitive` — 「**writes an audit record on read**」；`domain/AGENTS.md` — 「导出敏感名单**先**写 `export.record` 审计」· 客户端自律：`roster-panel.js:205-214` |
| 触发条件 | 任何组织者（或具 `sensitive` 能力的 staff）**直接**调云函数 `{action:'readExport', activityId, signupIds:[全部], mode:'sensitive', purpose:'保险'}`，完全不发 `export.record`；或仅走 `readSensitive`/`readContact` 逐人枚举。 |
| 实际执行路径 | `index.js:264` 路由 → `:98-101` → `selectors.js:210` → `permissions.js:228-238` 放行（有 purpose、有 owner、活动可工作）→ `:217-230` 拼出含「紧急联系人/紧急联系电话/健康备注」的完整 CSV → `:269` 返回。**全程未进 `actionDispatch`**，`assertInvariants`/`recordChange`/`ot_meta` 递增/`ot_events` 追加一个都没发生。 |
| 为什么会出错 | 系统只有一条写路径（`dispatch`），而审计被设计成一条**命令**（`export.record`），却挂在**读路径**上被当作"已存在的控制"。`selectExport` 用谓词复述了"这条命令会不会被允许"，而不是校验"这条命令是否刚刚真的落库"。客户端确实遵守了先审计再导出的顺序，但那是**调用方自律**——而整个 domain 层的立身之本是"客户端不能绕过"（`domain/AGENTS.md` 原话）。 |
| 用户能看到什么 | 一次整场敏感名单导出可以**零痕迹**完成；单人身份证/健康备注的批量枚举同样零痕迹。组织者的「变更日志」面板可能是空的，而 PII 已被取走。发生纠纷时无法回答"谁在什么时候看了谁的紧急联系人"。 |
| backend 最终状态 | `ot_events`/`ot_notices`/`ot_receipts` 不变，`ot_meta.revision` 不变（连"有人动过"的迹象都没有）；`ot_signups` 的 PII 已完整披露。 |
| 推荐验证方法 | smoke：种子 owner + 2 confirmed，直接调 `selectExport(state,{userId:OWNER},aid,ids,'sensitive','保险',now)`，断言 `state.events.length` 增加（当前不增加）。scenario：断言 `api.readExport` 在无前置 `export.record` 时应被拒（当前成功）。 |
| 取证状态 | **已核实** |

---

### P0-7 · 协作授权可被重复创建，「撤销」只回收一条 → 权限残留且 UI 说谎

| 字段 | 内容 |
|---|---|
| 文件 | `miniprogram/components/roster-panel/roster-panel.js`/`.wxml` · `cloudfunctions/trailApi/domain/profile.js` · `permissions.js` |
| 代码位置 | `roster-panel.js:66-101`（`onAccessSave` **全程不置 `busy`**，对照同文件 `onBatch` 在 `:186` 有置位）· `roster-panel.wxml:211`（`disabled` 绑定的是 `busy`，因此该保护恒不生效）· `roster-panel.js:84`（客户端每次现造新 `membershipId`）· `profile.js:24-26`（去重只按 `membership.id`；`vehicle_contact` 另按车辆去重，`staff` 没有）· `permissions.js:32-40`（`staffCan` = `capable.length > 0`）· `roster-panel.js:34-43`（`onRevokeMembership` 单条删除） |
| 触发条件 | 在「协作授权」填好对方身份码 + 能力 + 范围后**连点两次「保存明确授权」**（或第一次网络慢、无反馈再补一次）。 |
| 实际执行路径 | 按钮的 `disabled` 依赖一个从未被置位的 `busy` → 两次点击都进入 → `editingId` 只在 `.then`（`:96`）回填，故第二点时仍为空 → 生成 `membership-B` → `api.js:99` 每次新造 requestId（P0-8）→ 服务端 `commands.js:116` 回执查找不可能命中 → 两条都当新命令执行 → `profile.js:24` 按 id 去重失败（A≠B）→ **两条都保留**。撤销时 `profile.js:14` 只删一条。 |
| 为什么会出错 | 授权的唯一业务去重键是 `membership.id`，而这个 id 由客户端在提交瞬间生成，任何重试路径下都不稳定；`staffCan` 又是"存在任一条即放行"的语义，二者叠加使「撤销」不具备幂等收敛性。 |
| 用户能看到什么 | 授权列表出现两条同一身份码的记录；撤销一条后 toast「授权已撤销」、列表少一行，组织者认为权限已回收——**对方仍能读名单/敏感字段/上报现场**（直到另一条 `expiresAt` 到期）。 |
| backend 最终状态 | `ot_memberships` 残留一条 `role:'staff'`（含 `capabilities` 与 `scope`）；`ot_events` 两条；`ot_receipts` 两条。 |
| 推荐验证方法 | 连续两次 `membership.save`（id 不同、其余完全相同）→ 断言 `memberships.filter(m=>m.userId===X).length === 1`；再 revoke 其一 → 断言 `staffCan(...) === false`。真机：授权面板连点两次看是否出现双行。 |
| 取证状态 | **已核实** |

---

### P0-8 · 幂等/去重层结构性失效：`requestId` 从不复用，且指纹在服务端时间覆写**之后**才计算

| 字段 | 内容 |
|---|---|
| 文件 | `miniprogram/utils/api.js` · `cloudfunctions/trailApi/index.js` · `domain/commands.js` · `domain/contracts.js` |
| 代码位置 | `api.js:111-119`（`dispatchAndSync(payload, expectedRevision, page)` **签名里没有 requestId 槽位**）· `api.js:95-99`（`dispatch` 每次现造 `'req-'+base36(Date.now())+random`）· 全站 **32 处写调用点，0 处传 requestId**（`grep -rn "api\.dispatch\|dispatchAndSync(" miniprogram/`）· `index.js:121`（缺省时服务端**再造**一个 `genId('request')`）· `index.js:120 → :123`（先 `overrideEvidence(clean, now, …)` 注入服务端 `at`，**再** `fingerprint = sha256(canonicalPayload(clean))`）· `index.js:38-53`（`node.at = now`，秒级）· `commands.js:116-121`（命中判据 = 同 actor + 同 requestId + 同 fingerprint）· `contracts.js:22-30`（`canonicalPayload` 忠实哈希被改过的 `at`） |
| 触发条件 | (a) 任何按钮双击/连点；(b) `callFunction` 超时或响应丢失而服务端其实已提交（本项目已实测 `-504003`），用户按提示重试；(c) 即便客户端改为复用 requestId，带 evidence 的命令仍必然失配。 |
| 实际执行路径 | **(a)(b)** 每次新 requestId → `commands.js:116` 永远 miss → 永远按新命令执行 → 回执只写不读，等价死代码；服务端 `index.js:121` 在缺省时再造一个，把"客户端忘了带"也归入同一失效路径。**(c)** `index.js:120` 把 `{at,by,note}` 的 `at` 覆写成本次秒级时间，`:123` 才据此算指纹 → 同一业务输入两次调用指纹必然不同 → `commands.js:118-120` 走 else 返回 `REQUEST_REUSED`「此请求号已用于另一份内容」，而非 `replayed:true`。 |
| 为什么会出错 | 两个独立缺陷叠加：客户端契约上没给幂等键留位置；服务端把**每次调用都变化的字段**纳入了"输入内容指纹"。后者使幂等设计对 `attendance.*`(6 类)/`vehicle.depart·complete`/`assignment.*`/`incident.*`/`position.*`——**恰好是带 evidence、也恰好在山上信号最差时使用**的那些命令——永久不可用。 |
| 用户能看到什么 | 重复点击/重试没有服务端保护：两条相同事件、两次全员通知、两份导出审计、两份异常报备。若按现有报错文案「请重新提交当前输入」重试带 evidence 的命令，会稳定得到一句用户不可能造成的话。 |
| backend 最终状态 | `ot_notices` 重复行且 `audience:{kind:'activity'}` → 全员各收一条（`commands.js:70-84`）；`ot_incidents` 重复开单 → `closing→archived` 被 `UNRESOLVED_SAFETY` 卡住（重复开单会让归档失败）；`ot_activities`/`ot_profiles.companions` 重复；`ot_receipts` 无效膨胀并挤占 600 上限。**域层自带去重的命令不受影响**：`signup.js:51 DUPLICATE_PERSON`、`invariants.js:14/15` 唯一性、transition 由 phase 收敛。 |
| 推荐验证方法 | domain 最小复现：同一 `requestId`、同一业务 payload 连调两次 `reduceCommand`，第二次 `context.now` 前移 1 秒 → 断言当前返回 `REQUEST_REUSED`（期望 `replayed:true`）。scenario：`api.dispatch` 的两次重试必须携带同一 requestId（当前必失败）。 |
| 取证状态 | **已核实**（(a)(b)(c) 三条链均可静态复现） |

---

### P0-9 · 编辑器整场会话不回填 revision：首次保存绕过乐观并发，一旦冲突则永久冲突

| 字段 | 内容 |
|---|---|
| 文件 | `miniprogram/pages/editor/editor.js` · `cloudfunctions/trailApi/index.js` · `miniprogram/utils/api.js` |
| 代码位置 | `editor.js:134-172`（`reload()` 发 `api.read` 但**从不写 `this.revision`**——`grep 'this\.revision\s*='` 全文件仅 `:578` 一处，且在保存成功之后）· `editor.js:575`（`dispatchAndSync(payload, this.revision /* undefined */, this)`）· `index.js:122`（`Number.isInteger(payload.expectedRevision) ? payload.expectedRevision : before.revision`）· `commands.js:122`（`state.revision !== command.expectedRevision → CONFLICT`）· `api.js:111-119`（冲突后调 `page.reload()`，而 reload 仍不刷新 revision） |
| 触发条件 | (a) 打开一场**已存在**的活动进编辑器，未先成功保存过就提交；(b) 成功保存过一次后，期间任何人（含自己另一处）写了该活动，再点保存。 |
| 实际执行路径 | **(a)** `:138` 的 `read` 返回了正确的 `res.revision`，但 `reload()` 只消费 `res.view` → `this.revision === undefined` → `index.js:122` 兜底成服务端当前值 → `commands.js:122` 的比较变成 `before.revision !== before.revision` → **CONFLICT 不可达** → `activity.js:107 Object.assign(activity, input)` 把陈旧整份表单覆盖上去。**(b)** 此时 `this.revision` 被钉在 `:578` 那一次的返回值上 → 任何后续写入都使其过期 → 冲突 → `api.js:113-116` toast + `reload()` → reload 不刷新 revision → **每次保存都冲突，永不自愈**（须退出重进，而重进又回到 (a) 的不安全态）。 |
| 为什么会出错 | 「缺省即当前值」把"客户端忘记带令牌"与"客户端主动接受当前值"压成同一情况——CAS 只在令牌存在时才有意义。`editor` 是全站唯一"读了一次却从不记录 revision"的写页；而它的 `reload()` 又正是 `dispatchAndSync` 用来解冲突的那个 duck-typed 方法，于是恢复路径本身是坏的。 |
| 用户能看到什么 | (a) 无任何报错，编辑"保存成功"；双端/双设备编辑时后写者**静默覆盖**前者。`published` 阶段尤其吃亏：`activity.js:98-104` 的 lockedKeys 保护此时不生效，`title`/`capacity`/`deadlineAt`/`acceptingSignups`/`approvalMode`/`pickupPoints`/`routeSnapshot` 全按陈旧快照覆写——**一个已关闭的报名窗口可被静默重新打开**。(b) 组织者反复点保存，反复看到「安排已被他人更新」，永远存不进去。 |
| backend 最终状态 | (a) `ot_activities` 该行 = 陈旧表单内容；被覆盖的字段无任何痕迹（`ot_events` 只写「活动说明与安排已更新」，看不出丢了什么）；`ot_meta.revision` 正常递增，事后从 revision 也看不出异常。(b) 什么都没写。 |
| 推荐验证方法 | `tools/scenario-editor-test.js` 的桩 `api.dispatchAndSync = (payload, revision) => { cmds.push({payload, revision}) }`（`:100-102`）**记录了 revision 却从未断言它**，fixture 里的 `revision: 7`（`:95`）从不比较——正是 P0-2 的同一形态。建议断言：`check('首次保存带回读到的 revision', cmds[0].revision === 7)`，以及 CONFLICT 后重试必须携带刷新后的 revision。 |
| 取证状态 | **已核实** |

---

## P1

### P1-1 · `expectedRevision` 非整数时被静默替换为服务端最新值 → 任何未带令牌的写入都是盲写
`index.js:122` + `commands.js:122`。与 P0-9 同根因的**面上**问题：`roster-panel.js:82`/`transport-panel.js:67`/`field-panel.js:60` 都只在 `res.view.kind === 'activity'` 的成功分支里赋值 `this.revision`，且无初始值（对照 `activity.js:178 this.revision = 0` 有初始化）。任一路径让 `this.revision` 为 `undefined`（读失败但面板已渲染、或首屏读未 resolve 就点），该页面的写命令就**取消冲突检测**，把陈旧屏幕上的意图落到最新状态。快速双击若绕过 `busy`，产生的是重复的**二阶事实**（`incident.report` 两条、`attendance.*` 覆写用户从未复核的 evidence），而 `assertInvariants` 对通知/异常内容无唯一性规则，检测不到。**验证**：经 `tools/e2e-test.js` 发两次不带 `expectedRevision` 的 `incident.report`，断言第二次返回 `CONFLICT`（当前不会）。**已核实**。

### P1-2 · `activity.run()` 不消费服务端返回的 revision，且提前释放 `busy`：用户与自己撞 CAS
`activity.js:443-454`——`.then(() => …)` **无入参**，`index.js:135` 明确返回的 `revision` 被丢弃；`busy:false` 在 `reload()` 之前。写成功后到 reload resolve（`store.js:78-80` 串行读 15 集合，数百 ms～数秒）之间，`this.revision` 是写前值 → 单人连点两个动作即 `CONFLICT` + 「安排已被**他人**更新」。对照正确写法：`signup.js:365`、`roster-panel.js:189`、`transport-panel.js:201` 都写了 `this.revision = res.revision`。**验证**：两账号，A 签到后 2 秒内点节点确认。**已核实**。

### P1-3 · 详情页读失败翻成「无法查看此活动」，但操作面板浮层在条件链之外且仍可写入
`activity.js:210` 的 catch 置 `denied` 却不清 `sheetOpen`/`this.view`/`this.revision`；`activity.wxml:2`（`wx:if denied`）与 `:6`（`wx:else`）之外，`:208` 的 `<overlay open="{{sheetOpen}}">` 是**兄弟节点** → 面板仍浮在报错页上可点 → 以一个已知不可信的 revision + 陈旧 `selRow` 继续发写。`denied` 同时承担"无权限"与"读失败"两种语义。`anotices.wxml:2/6/45`、`notices.wxml:2/6/45` 同构。**验证**：DevTools 在签到成功后立刻断网。**已核实**。

### P1-4 · 没有任何页面为读请求加序号：慢响应覆盖新响应，CAS 基准与显示数据脱钩
`activity.js:182-184`（`onShow` 无条件 reload）+ `:200-209`（无 `if (seq !== this._seq) return`）+ `:292-300`（`onToggleRow` 再发一条）→ **完成序决定最终状态**。`notices-page.js:56` 与 `:97` 更明确：`items` 来自读 #1，`this.revision` 却在读 #3 的回调里被覆盖为**更新的值**（`:97`，注释 `:96` 自陈"这才是 CAS 基准"）→ 携带比所显示数据更新的 revision 提交 → `commands.js:122` **必然通过** → 用户基于陈旧显示写入服务端已改写过的对象。`signup.js:396-430`（`loadForm` 把 profile 读的 revision 与 `readForm` 的快照拼成一页状态，且 `signup.wxml:16` 的门槛只有 `purpose` 非空，无 busy）同型。**不夸大**：`activity.js` 的 `selRow` 在 `:388` 已冻结、提交走 `:439` 读冻结值，因此**详情页不会把签到写到别人身上**；但 `signup.edit` 后果成立——`domain/signup.js:159-161` 整记录替换，且 `tripChanged` 会**删掉该人座位分配**，陈旧副本保存后乘客被静默取消分车。另 `notices-page.js:70` 调 `loadPublishContext` **未 return**，`reload()` 的 promise 在面板就绪前就 resolve（下拉刷新圈提前停止）。**已核实**。

### P1-5 · `store.js` 把事务冲突与所有存储故障压进同一桶，直接废掉客户端唯一的自愈分支
`store.js:111-130`：`catch (e) { if (e instanceof ConflictError) throw e; throw Object.assign(new Error('这次修改没有保存，原安排未改变。请保留输入后重试。'), {code:'STORAGE_UNAVAILABLE'}) }`。真实平台的事务冲突是以 SDK 错误对象（`errCode`/`errMsg`，无 `.code`）形式抛出的，且 `runTransaction` 有文档化的自动重试；若 SDK 包装/替换了回调内抛出的对象，连**真正的 CAS 冲突**也会失去 `code === 'CONFLICT'`。此时 `api.js:100-103` 的 `needRefresh` 不置位 → `api.js:111-119` 不 reload → `this.revision` 永远陈旧 → 用户反复点保存反复同一报错。SYNC.md:131 记录过这个「CONFLICT 死循环」并正是靠 code 修的；本条是该修复的**回退通道**。桩 `tools/stub-wx-server-sdk.js:48-63` 原样重抛，测试观察不到真实 SDK 的包装/重试。**验证**：真机双客户端同一活动先后保存，看 B 得到的是「安排已被他人更新」还是「这次修改没有保存」。**机制已核实，现网是否已触发待复测**。

### P1-6 · `ensureMeta` 在一次瞬时读失败后把全局 CAS 计数器**归零**，并吞掉覆写失败
`store.js:62-67`：`get().catch(() => null)` → 若非数字则 `data = {revision: 0}` → `doc('main').set({data}).catch(() => null)`。`.get()` 的瞬时失败（冷启、限流、`-502005`）与"文档不存在"被混为一谈，而 `set` 是**覆写**而非"仅创建"。后果：CAS 令牌的单调性被破坏，所有客户端持有的 revision（≫0）集体失配 → 全站同时爆发「安排已更新，本次修改没有保存」；若 `set` 本身也失败，则 `store.js:112` 在事务内抛 → 落入 P1-5 的 `STORAGE_UNAVAILABLE` → **应用静默变为只读**，而每次读都返回健康的空态。**验证**：桩里预置 `{revision:42}` 并让 meta `get()` reject 一次，断言 `loadState` 返回 42（当前返回 0）。**已核实**。

### P1-7 · 批量命令把整份 diff 塞进一个事务，操作数无上限，并在期间持有全局 `ot_meta/main` 锁
`store.js:109`（diff 一次算完，无上限）+ `:117-125`（事务内逐条 `await set()` / `remove()`）+ `commands.js:63/81-85`（每条命令还额外写 1 event + 1 notice）+ `roster-panel.js:147-157`（`onSelectAll` 勾选**全部**行，无上限）+ `:172-185`（一次 `signup.review` 携带 `signupIds[]`）+ `schema.js:160`（`capacity` 上限 500）。云开发对事务有公开的操作数与时长上限（单个事务最多约 100 个操作、事务不超 30 秒、且事务内只支持单记录操作），`N≈96` 的全选审核即越界；`assignment.commit`（`transport.js:146` 逐条 push）同理。**用户可见**：「这次修改没有保存，原安排未改变。请保留输入后重试。」且**每次重试完全相同**（重试不改变操作数）→ 该批量动作永久不可用；期间事务持有全局 meta 文档锁，其他用户写入连带失败。**验证**：在桩 `runTransaction` 里加操作计数并断言 ≤100；真机经 lab 造 120 条 pending 后全选审核。**机制已核实，平台确切上限待复测**。

### P1-8 · `exports.main` 把所有无 code 的抛错归为 `INVALID_INPUT` 并透出引擎原文
`index.js:270-272`：`code: (e.code) || 'INVALID_INPUT', message: e.message`。四类真实故障被压成"你的输入不对"：① `index.js:64` 对 `payload.request` 无形状校验，`selectView` 在 `selectors.js:247` 对 `undefined` 取 `.kind` → TypeError（`api.read()` 参数尚未拼好即可触发，`wx.cloud` 会丢掉 `undefined` 键）；② 任何 DB 读失败（`store.js:43`/`:62` 的 `errCode`/`errMsg` 既无 `.code` 也无 `.message`）；③ **一条落库文档违反当前 schema**（正是 ADR-0003 记录的"新增必填字段使既有文档失效"演进场景）或 `invariants.js:14` 的「记录标识不能重复」→ 因为 `assertInvariants` 校验**整个 state**，此后**每个人、每个活动的所有写入**都失败于「记录字段不完整或格式不正确。」，而**读仍正常**→ 应用看起来健康实则只读，且无绕过/修复路径；④ 历史数据缺嵌套字段（`selectors.js:41/45/49/61/300`、`index.js:157` 的无保护解引用）→ `api.js:8` 的正则把它翻译成「云函数内部错误：**请重新上传部署 trailApi** 后重试」——将开发者动作交给最终用户，而本项目已把"反复误判部署"列为最重复的时间黑洞（根 AGENTS.md 坑 7）。**验证**：桩里去掉一个活动文档的 `routeSnapshot`，断言首页返回**有类型的**失败而非引擎原文；`event.action='read'` 且不带 `request`，断言 code 应为 `INTERNAL`。**①②④ 已核实；③ 的现网可达性待复测**。

### P1-9 · `draft.js` 把「存储读失败」当成「无草稿」，下一次输入即清空全部草稿；且 actor 隔离从未生效
`draft.js:5-11`（`catch → return {}`）+ `:49-53`（`setDraft = loadAll → 改一个 key → saveAll(整体覆盖)`）→ 一次 `getStorageSync` 抛错（配额、值损坏、iOS 后台回收）后，用户敲任意一个字段（`notices-page.js:160`、`signup.js:213`）就把 `ourtrail.drafts.v1` 覆盖成「只剩当前这一条」，**其他所有活动/表单的草稿静默消失**（`saveAll` 这次是成功的，所以无报错）。编辑器没有撤销栈（根 AGENTS.md 坑），本地草稿是唯一持久化保险。补充：`setOpenId` 有导出但**零调用者**，`'ourtrail.openid'` 全仓无写入点 → 生产每个 key 实为 `'|<activityId>|<form>'`，**actor 段恒空**，`:1` 头注释声称的按账号隔离并不存在（共用设备/换微信号即互相串草稿）；而 `scenario-{signup,activity,editor,me,notices}-test.js` 的 wx 桩**全部预置** `'ourtrail.openid': 'u-test'`——测试替产品补了一个产品从不写入的值，整类缺陷在 5 个套件里不可见。**验证**：桩 `getStorageSync` 首次抛错后 `setDraft`，断言 `setStorageSync` 收到的是覆盖值而非合并值。**已核实**。

### P1-10 · 旧草稿的非空字段压制档案更新，并在提交后**反向覆写**「我的」资料
`signup.js:103`（草稿整份胜出）→ `:152-167`（`fillFromProfile` 只补空字段：`if (!String(person[k]||'').trim()) person[k]=src[k]||''`，陈旧的 `13800000000` 非空 ⇒ 不刷新）→ `:355` 把陈旧值提交进 `ot_signups` → `:366 syncTasks(profileSyncTasks())` → `:311-314` `merged = Object.assign({}, base /* 新档案 */, form /* 旧表单 */)`，`JSON.stringify(merged) !== JSON.stringify(base)` ⇒ **判定"有改动"并发出 `profile.save`**，把「我的」改回旧值。两条合并规则方向相反：`fillFromProfile` 对非空值以草稿为准，`profileSyncTask` 对整个 person 以表单为准并反向回写；那个本意是"没改过就不多打云函数"的 diff，恰好只在"草稿比档案旧"这种最该拦的情况下判定为有改动。**用户可见**：报名成功、toast 正常；之后打开「我的」发现手机号退回几个月前的旧号，无从归因。**backend**：`ot_signups.participant.phone` 与 `ot_profiles.person.phone` 同时为陈旧值，`revision +2`，两条事件都像是正常操作。**验证**：预置旧手机草稿 + 桩档案新手机号，断言 `participants[0].person.phone` 与发出的 `profile.save` 载荷。**已核实**。

### P1-11 · 手动输入的半坐标被静默存成 `lng: 0` / `lat: 0`（一个合法但错半球的点）
`editor.js:59-65` `coordsOrNull`：只有**两个都空**才返回 `null`；`Number('')` 是 `0`，有限且 `|0| ≤ 180` ⇒ `coordsOrNull('30.912','')` → `{lat:30.912, lng:0}`，`coordsOrNull('','103.47')` → `{lat:0, lng:103.47}`。schema（`schema.js:113`）与不变量均接受。**用户可见**：该节点显示「已定位」，地图标记落在几内亚湾；天气查询（`index.js:166-170`）对 `(30.912, 0)` 返回**自信而错误**的预报与概率语言天相结论。反向：超范围/非数字输入返回 `null` 且**无任何提示**，用户填的坐标静默消失，节点变成「此路线节点没有坐标」。**验证**：`scenario-editor-test.js` 加 `lat:'30.9', lng:''` 断言 `buildInput().routeSnapshot.points[0].coordinates === null` 且有可见 failure（当前两者都不满足）。**已核实（取值已由本次实读函数确认）**。

### P1-12 · `routeId` 往返丢失：新建会话每次保存都泄漏一条孤儿 `ot_routes`
`editor.js:157` 仅在"从服务端加载"时种 `this.routeId`；`editor.js:205` `routeId: this.routeId || null`；`editor.js:576-578` 保存成功后只更新 `savedId`/`revision`，**不更新 `this.routeId`** ⇒ 新建活动首存后 `activity.routeId` 已由服务端置为 `R1`，但第二次 `buildInput` 仍发 `routeId: null` ⇒ `activity.js:107 Object.assign(activity, input)` 把 `routeId` 写回 `null` ⇒ `:109 persistPrivateRoute` 见 `routeId === null` 又克隆一份 `R2`；第三次 `R3`……**触发**：新建活动填路线 → 保存草稿 → 继续改 → 再保存（编辑器文案「先保存想法，准备好后再发布」主动鼓励此路径）。**用户可见**：今天无（无人读 `routes`），故长期存活；真实后果是 `ot_routes` 每次保存净增一行完整快照（含 points/risks/至多 200 个 track 点），且活动的 `routeId` 每次保存都变，与 `editor.wxml:459` 的承诺「已保存的私有路线会保留在你的账号下」相反。**验证**：smoke：`activity.create` 后两次 `activity.edit`（`input.routeId === null`），断言 `state.routes.length === 1`。**已核实**。

### P1-13 · `me.js` 的草稿清理是恒真式：每次 reload 都把未落库的资料删掉
`me.js:123` `const person = mergeDraft(Object.assign({avatar:''}, profile.person))`（草稿优先）→ `:133 this.pruneDraft(person)` → `:140` `if (d && d.emergency && sameFields(d, draftableOf(person)))` 把草稿与**由草稿-derived 的 person** 归一化结果比较 ⇒ 恒等 ⇒ `:141` 清空草稿。`:2` 的注释「草稿和服务端字段完全一致 → 清掉」说的是本该比较 `serverPerson`，而传进来的是 merged 对象。**触发**：档案不完整（服务端 `profile.js:36` 硬性要求姓名+手机号，故不可能落库）时填了紧急联系人/健康备注，随后切 Tab/下拉刷新/存同行人/撤位置，且在 800 ms 自动落库提交前杀掉应用。**用户可见**：刚输入、尚未落库的紧急联系人与健康备注静默丢失——正是 `me.js:5-10` 声称已修复的那个回归。**验证**：`scenario-me-test.js` 现有用例「★ 切页回来后紧急联系人仍在」只断言 `page.data.person`，从不检查 storage 条目；补一条 gate-blocked 输入 → `onShow()` → 断言草稿仍在。**已核实**。

### P1-14 · `permittedActions` 与命令处理器口径相反的两处：`closing` 的 `activity.edit`、过 `deadlineAt` 的 `signup.edit`
① `selectors.js:411` `work = phase !== 'archived' && phase !== 'cancelled'` ⇒ `closing` 时 `work` 为真 ⇒ `:419 actions.add('activity.edit')`（`organizer && work` 分支）；但 `activity.js:95` 明确拒绝 `closing`/`archived`/`cancelled`。编辑器据此**整个表单全亮**（`editor.js:148-150` 不设 `denied`，`editor.wxml` 无任何字段级 `disabled`）→ 数分钟编辑在保存时才被丢弃。② `selectors.js:434-436` 给 `signup.edit` 的条件不含 deadline，而 `domain/signup.js:150-153` 要求 `now < deadlineAt`，`permissions.js:198-200` 完全不知道 deadline ⇒ 入口可见、表单正常加载（已完成一次敏感读取）、保存才拒。另口径冲突：`selectors.js:431-432` 把 `deadlineAt` 为 null 视为"开放"，`domain/signup.js:102` 视为"关闭"——今天仅靠 `invariants.js:46-47` 强制非空才没暴露（服务端↔服务端自相矛盾）。**验证**：为每个 phase 交叉断言"清单里给出的动作在该 phase 必须可执行"。**已核实**。

---

### P1-15 · 时空天相图的云层带「换带即丢带」：真实数据下这一整层几乎不画
`miniprogram/components/space-time/layout.js:182-201`。`layout.js:187` `if (b && (!prev || prev.base !== b.base || prev.top !== b.top)) runStart = points[i]` —— **换带只重置起点，从不闭合上一段**；唯一的闭合出口是 `:188` 的 `if ((!b || i === points.length - 1) && runStart)`。而真实数据里 band 必然逐时漂移（`cloudfunctions/trailApi/lib/weather.js:103-120` 的 `cloudBandAt` 按气压层位势高度逐时算 base/top，`utils/weather-model.js:71-83` 的 `lerpBand` 又按 10 分钟插值），于是每次变化都丢弃前一段，最终只剩最右端一段零宽矩形（`space-time.js:326` 用 `Math.max(1, c.x2-c.x1)` 画出来就是 1px 竖条）。**后果**：「云在脚下」的视觉证据整层消失，而图例仍按节点天相列出「云海」。**掩盖机制**：`tools/space-time-draw-test.js:125` 的 fixture 用常量 `band:{base:2400,top:3100}`，恰好只在 `i===len-1` 出口命中，55 例全绿。**验证**：把该 fixture 改为 `base: 2400 + h*15` 即红；真机看天气页 P4 图有无彩色横向云带。*已核实（本次只读执行 `layout.js`：漂移带 `spans=[[308,308,0]]`，常量带 `spans=[[44,308,264]]`，绘图区 44..308）*

### P1-16 · 无海拔的节点被兜成 0 m：整条路线画成海平面，纵轴塌成 ±1 m
`miniprogram/utils/weather-model.js:370`：`alt: lerp(numOr(a.alt, 0), numOr(b.alt, 0), t)`。手建路线或只有 `<wpt>` 无 `<trkpt>` 可回填时，`weather.js:279` 如实给 `alt: null`，但采样点拿到的是 **0 而非 null**，于是 `layout.js:162` 的 `if (p.alt != null)` 放行 0 → `aMin=0` → `layout.js:165-168` 因 `aMax-aMin<1` 撑成 ±1 量程；端点又按 `layout.js:177` 的 `p.alt == null ? box.y1` 钉在地板。**同屏自相矛盾**：`readoutAt` 在同一张图上显示「海拔未知」（`layout.js:431`）。**同一语义两套处理**：同文件对 `km` 明确写着「缺失时必须保持 null，不兜成 0」（`:344-351` 注释），海拔这套违反了本仓「宁可沉默，不可编造」的既定立场（`utils/AGENTS.md`）。**后果**：纵轴刻度是 -1/0/1 m，轨迹是一条贴地的 0 m 平线（读作"这条路线在海平面"）；混合缺测时轨迹从真实海拔一路斜插到 0。**验证**：`tools/weather-model-test.js:173-177` 的 fixture 全部带数字 `alt`；补 `{t:'08:00',alt:2860},{t:'14:00',alt:null}` 断言中点 `=== null` 即红。*已核实（本次实跑 `posAt([{alt:2860},{alt:null}],660) → alt:1430`，即一个编造的中点；两端全 null → 中点 0）*

### P1-17 · X 轴是「当日分钟数」但节点跨天：多日线路的时空图直接退化
`miniprogram/utils/weather-model.js:310` `minutes: sky.hourMin(n.t)` **丢弃了 `n.d`**，而节点来源 `weather.js:276-284` 是带 `arriveDate` 的。`route-schedule.js:80` 的 `clockOf(minutesOfDay(...))` 已 `%1440`，故第 2 天 09:00 抵达的 `minutes=540` < 第 1 天 16:00 的 `960`。于是 `weather-model.js:316/317/325` 的 `first=pts[0].minutes`、`end=lastNode`、`for (let m=first; m<=end; m+=step)` 在 `end<first` 时**循环 0 次** → `:328` 只 push 一个端点 → `layout.js:151-152` 拿到单点 → `:171` `spanT=(tMax-tMin)||1` → 所有节点 `toX` 同值。**后果**：多日活动里节点全堆在绘图区左缘成一小坬、无折线无云带，漫游滑块 `min==max` 且一按播放立刻 `finished` 自停；另外若某节点抵达日早于所选日期，`nodeFacts` 的 `detail = series.filter(h => h.d === date)`（`weather-model.js:181`）为空 → 天相全灰（`weather.js:429-432` 只补了"晚于所选日"这一个方向）。**验证**：`weather-model-test.js` 与 `space-time-test.js` 的 fixture 全是单日期，把任一节点改成次日 09:00 即复现空 track。*已核实*

### P1-18 · 天气页「分时段摘要」面板永久为空（客户端 `SLOTS` 用 `'HH'` 而数据是 `'HH:mm'`）
`miniprogram/pages/weather/weather.js:25` `const SLOTS = ['06','08','10','12','14','16','18','20']`，`:583` `.filter(h => SLOTS.indexOf(h.t) !== -1)`；而 `lib/weather.js:193` `t: times[i].slice(11,16)` 产出 `'06:00'`（该文件注释还专门写明「t 保持 'HH:mm'（既有消费者依赖）」）。⇒ `buildSlots` 恒返回 `[]` ⇒ `weather.wxml:130-138` 的卡片内 `wx:for` 零项，`.card` 无 border + `padding:0` + 空 ⇒ 塌成 0 高，只在 `.stack` 的 16px 空隙里留一条缝。这是 P1 设计文档里的那块面板，**每次天气页成功加载都触发，无条件**。**掩盖机制**：`grep -rn "SLOTS|buildSlots|slots" tools/weather-page-test.js` → **0 命中**，129 例无一覆盖。服务端孪生缺陷见 P2-5（`index.js:172` 的 `hours` 同样恒空，只因客户端不消费才不可见）。**验证**：真机天气页滚到结论卡下方；或补一条 `buildSlots([{t:'08:00',…}])` 长度断言即红。*已核实*

### P1-19 · 编辑「已含参与者司机」的车辆必然存不回去（客户端过滤比服务端规则严）
`miniprogram/components/transport-panel/transport-panel.js:119-121` 的司机候选是 `v.rows.filter(r => r.status==='confirmed' && !r.vehicle)`，而 `selectors.js:113` 对"参与者兼司机"的那一行**已经填了** `r.vehicle = 车辆X.label`（取自 `participantDriverVehicle`）⇒ 现司机本人被排除出候选 ⇒ `:318-320` `signupIndex = driverCandidates.findIndex(...)` 得 **-1** ⇒ 打开编辑时 picker 显示「请选择」⇒ `:400-407` `const c = this.data.driverCandidates[-1]` 为 undefined ⇒ 报「请为参与者司机选择人选（需已确认报名且尚未分车）。」并 `return`。但服务端 `domain/transport.js:59-61` 只禁止"占用乘客座位"（`state.assignments.some(...)`），`invariants.js:97` 同理，**从不禁止"已是本车/别车司机"**。**后果**：改车牌/上车点/座号一律保存失败，而提示里点名的人恰恰不在下拉中；改选他人会静默换掉司机，无人可选则该车辆完全不可编辑。无任何命令发出（不是脏数据，是功能不可达）。**验证**：工作台→分车→加一辆"参与者兼司机"的车→保存→再点编辑→保存。*已核实*

### P1-20 · 工作台三个面板挂载后永不重读：切 Tab 看到的是上一次快照
`miniprogram/pages/workspace/workspace.wxml:27-31` 用 `class="{{tab === N ? '' : 'hide'}}"` 让面板**常驻挂载**（`.hide{display:none}`，`workspace.wxss:3`；注释说明不用 `wx:if` 是为保住搜索词/勾选/车辆表单状态）。而三个组件的重读触发点只有 `attached` + `activityId` observer（`transport-panel.js:47-52`、`roster-panel.js:65-70`、`field-panel.js:40-48`）与各自 `dispatchAndSync` 的成功回调；`activityId` 在页内不变，`workspace.js:111 onTab` 只做 `setData({tab})` + `pageScrollTo`，页面自己的 `onShow→reload` 只刷四个计数、不刷面板。**后果**：在「名单」里刚确认报名，切到「分车」时下拉里没有那个人（`transport-panel.js:115-117` 是挂载时快照），`metrics.unassigned`、「现场」的签到/出发状态同样陈旧，必须退出页面重进 —— **产品的核心循环「用同一份名单完成审核→分车→签到→收尾」在单页内被打断**，并诱导用户重复操作或误判已分车。*已核实*

### P1-21 · `space-time` 的「补测尺寸」是空操作：图层永不重对齐（坑 6 在新组件上复现）
`miniprogram/components/space-time/space-time.js:224-230`：`scheduleSync()` 在 100ms/320ms 各调一次 `initCanvas()`，但 `:225` 是 `if (this.canvas.width !== Math.round(cssW*dpr)) info.node.width = …` —— CSS 宽未变时 `node.width`/`node.height` **一次都不重新赋值**。而 `type="2d"` canvas 是在 `node.width` 赋值时刻**锁定图层偏移**、不随后续重排移动（根 AGENTS.md 坑 6；`meteogram.js:158-159` 是无条件赋值，所以那一侧是对的）。该文件头 `:12-13` 自己写着「布局落定后必须补测」，但实现把"宽度变了才重设"当成了条件 —— 坑 6 说的正是**纵向**位移。**后果**：`dayCards`/图例/callout 数/`pointCard` 的异步 setData 把 canvas 往下推后，图浮在正文上或与下方文字重叠（横向对、纵向错），即 `b6c2439` 修过的老症状在 P4 图上重现。**掩盖机制**：`tools/space-time-draw-test.js:233` 只断言第一次 `node.width === cssW×dpr`，第二拍的 no-op 无人测。**验证**：真机加载天气页后对比 canvas 与「当日数字」卡的间距。*已核实*

### P1-22 · `denied` 分支不重置 `_loading`，「重试」按钮成为死控件（三个面板同型）
`miniprogram/components/roster-panel/roster-panel.js:76` 置 `this._loading = true`，但 `:78-80` 的 `res.view.kind !== 'activity'` 早退分支**没有**复位（只有成功尾 `:85` 与 `.catch` `:89` 复位）。`roster-panel.wxml:2` 的 `<status-panel ... actionLabel="重试" bind:action="reload" />` 因此永远命不中——下一次 `reload()` 在 `:75` 的 `if (!activityId || this._loading) return` 直接退出。`transport-panel.js:57-58/63-66`、`field-panel.js:53-54/56-59` 同型。**触发**：一次非所有者进工作台、协作授权到期、或活动 id 失效。**后果**：点「重试」毫无反应、无 loading、无报错，只能退出重进；`api.dispatchAndSync` 的 CONFLICT 恢复也是调 `page.reload()`（`api.js:115`），同样被静默吞掉 —— 即 P1-2 的自愈路径在三个面板里也失效。**验证**：把 `activityId` 设成一个不存在的活动进工作台。建议方向（本次不改）：把复位收敛成 `finally` 风格。*已核实*

### P1-23 · 「现场」面板给出必然被服务端拒绝的动作：核实已随队出发不检查签到与去程上车
`miniprogram/components/field-panel/field-panel.js:121-125`。同一处代码对「确认现场签到」判了 `!row.checkedIn`（`:121`），但 `:125` 推入的 `{label:'核实已随队出发', outcome:'joined'}` **既不检查 `row.checkedIn`，也不检查该人是否已有去程上车记录**，只要求 `permitted.indexOf('attendance.departure') !== -1`。而服务端 `cloudfunctions/trailApi/domain/field.js:85`：`if (kind === 'joined' && (!record.checkIn || (signup.trip.mode === 'shared' && !participantDriver && (!assignment || !record.boardingByLeg.outbound)))) return failure('UNRESOLVED_DEPARTURE', '请先核实签到及必要的去程上车。')`。**触发**：活动进入 `gathering`，组织者在一个**拼车乘客**（`trip.mode==='shared'`、已分车但车长尚未确认上车）的行上点「核实已随队出发」。**后果**：必被拒，且面板里**没有上车的入口**——去程上车的 UI 入口在车长任务页（`pages/vehicle/vehicle.js`），组织者在这一屏看不到"还差谁上车"，也看不到该由谁去做；报错文案「请先核实签到及必要的去程上车」不指路。与 P1-19（车长侧「确认上车」对未签到者必错）互为镜像：两侧面板各自镜像了服务端 *departure* 过滤条件，却都没镜像它的 *checkIn/boarding* 前置。**注意**：本条按 `SYNC.md` 现有条目记载已被另一轮工作发现并标注「未修，已记」，本次实读 `field-panel.js:125` 与 `field.js:85` 独立复核成立。**验证**：`scenario-workspace-test.js`/`scenario-field` 用例：`phase='gathering'`、行 `checkedIn=true` 但 `boarding.outbound=null` 且 `trip.mode='shared'`，断言该动作不出现在 `acts` 里（当前会出现）。*已核实*

---

## P2

> 压缩格式：每条含 触发 / 位置 / 后果 / 验证。P0/P1 已含的完整九栏不再重复。

**P2-1 · `pruneReceipts` 按 openid 字典序而非时间淘汰。** `commands.js:88-94`（注释「只保留最近的回执」+ `slice(-600)`）、`store.js:27`（receipts `_id = actorId+'__'+requestId`）、`store.js:43`（`orderBy('_id','asc')`）。落库往返后数组序 = openid 字典序，故淘汰的是"字典序靠前 openid 的全部回执"，`store.js:97-99` 随即物理删除。`events`/`notices` 侥幸安全（`_id` 为定宽 base36 时间前缀）。当前用户几乎无感（P0-8 已让回执从不命中），真实代价是一句**与行为相反的注释**在为后来者担保。验证：喂 601 条跨两个 openid 的回执，断言保留集与时间无关。*已核实*

**P2-2 · receipts 复合主键用 `__` 拼接两个自由字段。** `store.js:27`/`:90`（Map 静默保留最后一条）/`schema.js:43`+`:52-54`（`specId` 只限类型与长度，不限字符集）。`(oA__B, C)` 与 `(oA, B__C)` 拼串相同 → 前者从不落库 → `commands.js:116` 双字段匹配失败 → 重试被当新命令。注：`invariants.js:15` 的去重用的是 `'\u0000'` 而非存储层的 `'__'`，因此不变量拦不住。实际客户端 requestId 恒以 `req-` 开头，故仅在手工调用时可造。验证：对 `diffCollections` 喂两条撞键回执，断言 `writes.length === 1`。*代码层已核实*

**P2-3 · `weather_cache` 的 `_id` 含 `.`，读写双重 `catch(() => null)` 使缓存若从不生效将永久静默。** `lib/weather.js:229-231` → 形如 `w_30.91_103.48_2026-10-05`（含两个 `.` 与两个 `-`，25 字符）；`index.js:142` 读吞错、`:147-149` 写吞错 → 若平台拒绝该 `_id`，每次查询都全量外呼且返回值与成功完全一致。`smoke-test.js:351-356` 只断言 key 的**归一化粒度**（同网格合并），断不到 key 合法性；`stub-wx-server-sdk.js:20-22` 只校验 `typeof id`。**一次性读数**：云开发控制台看 `weather_cache` 是否有文档，为 0 即确认。**待复测**（取决于平台 `_id` 字符集限制）

**P2-4 · `weather_cache` 只判新鲜度、从不删除。** `index.js:143`（30 分钟 TTL 只比较不淘汰）、`store.js:58`（建集合）、全仓无任何针对该集合的 `remove()`。行按 (网格, 日期) 无限增长，且每行含 `series` 至多 168 小时 ×（15 个 hourly 变量 + 9 个气压层 ×2 数组，`lib/weather.js:8-18`/`:186`）→ 配额耗尽后**业务写入**也开始失败并落进 P1-5 的 `STORAGE_UNAVAILABLE` 桶。验证：控制台看文档数与体积。**已核实（无淘汰逻辑）**

**P2-5 · `SLOTS` 拿 `'HH'` 比 `'HH:mm'`，`hours` 恒为空；范围内空 `detail` 被报成 `out_of_range`。** `index.js:172`（`['06','08',…]`）vs `:175`（`SLOTS.indexOf(h.t)`）而 `lib/weather.js:193` `t: times[i].slice(11,16)` = `'HH:mm'`（`smoke-test.js:388` fixture 亦为 `'08:00'`）→ 24 小时全被滤掉。今天因客户端不消费 `hours`（`lib/weather.js:261-262` 明说）而不可见，一旦分时段摘要重建即静默空。`index.js:182` 用 `out_of_range` 表达"该日期无逐小时数据"，`weather.js:391-394` 因此告诉用户「超出 14 天预报范围，临近出发再核实」——对明明在范围内的日期是错误的、且无法通过等待自愈的建议，`:395` 该分支也不给重试入口。这正是根 AGENTS.md 坑 1 的同一形态。验证：smoke §15 加"24 行 detail 应产出 8 个 `hours`"。**已核实**

**P2-6 · 免鉴权天气面 + 文档相反。** `lib/weather.js:222` `FREE_ACTIONS = { getWeather: true, getWeatherByPoint: true }` 而 `cloudfunctions/trailApi/AGENTS.md` 写「`getWeather` is the only action that does not require an OPENID」。`index.js:267` 据此放行无 OPENID 的任意 `lat/lng/date` 外部查询，无归属校验、无频次限制；Open-Meteo 无 key 额度被刷完后全站天气变「暂不可用」。`actionGetWeather` 虽免鉴权仍做了 `store.js:71` 的全量水合（14 集合），构成廉价 DoS 与活动 id 存在性探针。**已核实**

**P2-7 · 每次调用都全量水合 + 建集合，只读动作也付同一笔钱。** `index.js:261`（每次 `ensureCollections`，`store.js:54-59` 16 次 `createCollection` 且全吞错）→ `store.js:62`（meta）→ `store.js:78-80`（14 个集合**串行 for-await**）。`getWeather` 只需一个活动的坐标与节点，却付全表读。两处都是不动 CAS 设计即可收敛的常数项；`config.json` 把 timeout 提到 20 秒只是推后症状阈值，最终表现为 `-504003` → `api.js:38` 那句"请重新上传部署"。验证：控制台看单次调用耗时与 DB 读次数随 `ot_routes` 增长的趋势。**结构性已核实，毫秒数待复测**

**P2-8 · 取消活动不回收 `memberships`/`vehicles`，阶段防护又只在各 handler 一处。** `activity.js:149-152`（取消只清 `assignments` 并撤 `positions`）对比 `:181-194`（`delete` 才清 `memberships`）；`permissions.js:32-40`/`:44-48`（`staffCan`/`vehicleCan` 无 phase 项）。当前**不可越权**——写侧由 `profile.js:12`/`field.js:20`/`signup.js:102/112/168`/`transport.js:86`/`notices.js:11` 分别挡住，读侧由 `selectors.js:154/184/341/386` 的 `workDataAvailable` 挡住。可见后果：已取消活动的授权行留在 `ot_memberships` 并出现在 `selectAccess` 列表（只按 `activityId` 过滤）；`meta.staff`/`meta.vehicle` 徽标永久挂在首页（`selectors.js:262-264/274-275`）；`transport.js:86` 使 `vehicle.remove` 在取消后永远 `WRONG_PHASE` → 垃圾车辆清不掉。收敛点缺失才是本条真正风险：新增命令若只接 `staffCan` 而忘记补 phase，会静默放开对已结束活动的写入。**已核实（含"当前不可越权"结论）**

**P2-9 · 指向车辆的站内通知在车辆删除后对**所有人**（含组织者）永久不可读。** `permissions.js:95-97`：`if (!requireVehicles(...).ok) return false` 出现在**下一行的 `isOwner` 兜底之前**；`invariants.js:153-156` 又刻意容忍该悬空引用 → 通知留在 state 里、继续占用 800 上限，却从 `selectors.js:308-316` 的列表里消失，而组织者的 `selectNoticeManagement`（`:199-203`）仍列出它像已投递。触发：发布 audience=指定车辆的通知 → 解除乘车安排 → 删除车辆。验证：smoke 断言此时 owner 的 `canReadNotice`。**已核实**

**P2-10 · `activity.delete` 的 positions 级联是空操作（过滤了一个不存在的字段）。** `activity.js:208` `state.positions.filter(p => p.activityId !== activityId)`，而 `schema.js:238-241` 的 `PositionReport` 没有 `activityId`（正确先例：`field.js:109`、`signup.js:140-142` 都按 `signupId`）。当前不可达（`position.report` 需 `phase==='active'`，`delete` 需 `phase==='draft'`），一旦任一闸门改变，就会留下孤儿 → `invariants.js:133-138`「位置记录的参与者不存在。」→ 因 `assertInvariants` 校验整个 state（`commands.js:137`），**此后每个用户对每个活动的每次写入**都失败。**已核实（latent）**

**P2-11 · 全局 800 条事件/通知上限对各活动不公平。** `commands.js:135-136` 的 `slice(-800)` 是**全应用**一条数组，`store.js:97-99` 随即物理删除。一场频繁改动的活动会把另一场**尚未阅读**的通知挤出，用户无从得知它曾存在（`canReadNotice`，`permissions.js:84-105` 查不到即 false，无"更早通知不可用"提示）；若页面仍持该 id，`notice.read`/`notice.delivery`（`notices.js:26-27`/`:36-37`）返回「找不到请求的资源。」。验证：桩里造 801 条跨两活动，只操作忙碌那场，断言清静那场的未读仍在。**已核实**

**P2-12 · 分车面板把已取消/已移除/已拒绝的报名算进「同行组」。** `selectors.js:190-191` 组内 `signupIds` 无 status 过滤 → `transport-panel.js:132-134` 渲染「同行组：张三、李四、王五」并据 `signupIds.length > 1` 判定整组约束，`nameOf`（`:75-78`）对不可见者回落「不可见参与人」。触发：3 人组取消 2 人后打开分车。验证：scenario 断言名单长度。**已核实**

**P2-13 · 名单批量操作按钮不看 `permittedActions`，四个必错按钮。** `roster-panel.wxml:56-66` 只按 `selectedCount` 渲染确认/拒绝/递补/取消，而 `domain/signup.js:112`/`:121`/`:133` 要求 `published`（取消允许 `published|gathering`）；`selectors.js:426-428` 又确实在 `gathering` 就挂出了 review/promote。触发：`gathering` 及以后进名单勾选任一动作 → 「当前活动阶段不能变更报名资格。」且不说明哪个阶段允许什么；`active` 里取消未到场者失败而正确路径（现场异常）无提示。**已核实**

**P2-14 · `attendance.board` 可以抹掉已记录的上车事实，与自身注释相反。** `field.js:76` 的闸门是 `vehicle.legs[p.leg].departed && !(lateArrival && …)`——**只在发车之后**才保护；`:77` `record.boardingByLeg[p.leg] = p.boarded ? (…) : null`。`:74` 不阻止"已 `joined` 出发但未签到"的组合。触发：`{boarded:false}`（当前 UI 不可达：`vehicle.js:107-111` 硬编码 `boarded:true`，`field-panel` 从不发此命令）。后果：去程上车被清空 → `activity.js:164` 的 `gathering→active` 报「拼车乘客还需要去程上车确认」，而名单仍显示已签到/已核实出发，只能重新点上车恢复。**已核实**

**P2-15 · `gathering` 期间开的异常，一旦取消活动就永远关不掉。** `field.js:20` 把 `incident.resolve` 也挡在 `cancelled` 之外（而 resolve 本不需要现场阶段前提）；`activity.js:141` 允许从 `gathering` 取消；`selectors.js:460-461` 的 `work` 同时把按钮摘掉。后果：`ot_incidents` 永久 `resolution:null`，异常列表显示「未处理」且无操作，`selectors.js:383 openIncidents` 对一场死活动恒非零。验证：smoke 里 gathering 报备 → 取消 → 断言 resolve 应成功或取消应被拦。**已核实**

**P2-16 · `position.revoke` 是无条件成功的空操作，且位于阶段闸之前，仍推全局 revision。** `field.js:15-19` 无"无事可做即失败"分支，块位置在 `:20` 阶段闸**之前**（故 `draft/published/archived/cancelled` 也成功）；`selectors.js:439` 只要**任一**可见报名有未撤回位置就挂动作，`activity.js:422` 只看 `permittedActions` 非按行，`activity.js:521` 固定 toast「位置共享已撤回。」。后果：提示说撤回了实际什么都没撤，同时 `commands.js:127-131` 照旧 `revision+1` + 写事件 + 写回执 → **所有其他仍开着的页面下一次动作自撞 CONFLICT**（`ot_meta` 是整库单计数器）。附带权限不对称：`permissions.js:217` 的 `position.report` 只允许 `isSelfSignup`，`:219` 的 `position.revoke` 却允许代报授权——代报人能撤回自己永远无法上报的位置。验证：对不存在 position 的 signupId 调用，断言 `state.positions` 未变但 `replayed:false`。**已核实**

**P2-17 · 通知页三条写路径零 in-flight 闩锁，「请重试」使重复发布变成第二次成功发布。** `notices-page.js:15-30`（`data` 里没有 `busy` 位）、`:167-195 onPublish`、`:197-202 onMarkRead`、`:210-223 onCopy`；`anotices.wxml:76`/`notices.wxml:76` 门槛只有 `{{content ? 'onPublish' : ''}}`。`notices.js:18-23` 无内容/时间窗去重，`notices.js:38` 的 `notice.delivery` 纯追加 → 投递记录声称某人复制了 N 次（N 实为手抖次数），而该记录正是审计口径来源。`api.js:114` 的冲突文案又主动邀请重试。**已核实**

**P2-18 · 「发布后开放报名」复选框是死的：每次草稿保存强制 false，发布时强制 true。** `editor.wxml:352-355` + `editor.js:202/247` 送出该值 → `activity.js:108` `if (activity.phase === 'draft') activity.acceptingSignups = false` 丢弃 → 发布时 `activity.js:130-132` 无条件 `= true`，且 `activity.publish`（`schema.js:319`）根本不携带该字段。后果：组织者刻意不勾，发布后报名仍开放，陌生人可把紧急联系人与健康备注投进一场本想保持关闭的活动。验证：smoke 以 `acceptingSignups:false` 的草稿发布后断言该行值。**已核实**

**P2-19 · 手机号只校验非空、不校验格式，三处口径不一。** `schema.js:114/116-120`（`phone: specText`，无 pattern）、`signup.js:25` 与 `profile.js:36`（仅非空）、`me.wxml:46`（`maxlength="11"` 但无下限）vs `format.js:99` `validPhone = /^\d{11}$/` 只在 `signup.js:287/456`、`transport-panel.js:409` 生效。紧急联系电话 `"1"`/`"暂无"` 可入库、可进 CSV 与保险导出（`selectors.js:226`）、可显示在联络面板。**已核实**

**P2-20 · `routeId: ''` 的 truthiness 漏洞：既不校验归属也不落私有路线。** `schema.js:150`（`specNull(specId)` 接受空串）+ `activity.js:14` `if (input.routeId && …)` + `invariants.js:45` 同 truthiness + `activity.js:50` `if (activity.routeId === null …)` ⇒ 空串既不被当作"无路线"也不被当作"有路线"，路线静默不进 `ot_routes`，活动却保留 `routeId:''`。**已核实**

**P2-21 · 无上限数组 + 512 KB 单文档上限，被伪装成"原安排未改变"。** `schema.js:161-163`/`:141-145` 对 `pickupPoints`/`routeSnapshot.points`/`risks`/`equipment` 用 `specArr(item)`，`schema.js:22` 缺省 `maxLen = Infinity`；超限在事务内触发 `store.js:127-129` 的 `STORAGE_UNAVAILABLE`，文案「请保留输入后重试」是一个永远不可成功的指引。另 `editor.wxml:385/425/428/431`（及 `:204/267/270`）等文本框无 `maxlength`，而 `schema.js:5` 的 `TEXT_MAX=2000` 超限后 `activity.js:13/96` 只回一句无字段名的「活动字段不完整或格式不正确。」**已核实（前端无长度约束）**

**P2-22 · `companion.remove` 不检查该同行人是否仍持有有效报名。** `profile.js:56-59` 直接过滤掉 companion，而 `invariants.js:38` 只校验 `personRef.ownerId`、从不校验 companion 存在性 ⇒ 一个仍在占名额的代报同行人可以从「我的同行人」里消失（其报名数据仍在，后续 `signup.edit` 等按 companionId 的操作会撞 `domain/signup.js:47`）。另 `assertInvariants`（`commands.js:137`）+ `allocation.js:47` 均校验**整个** state：任意一处坏记录会让**所有**写入与**所有**分车预览以一句无定位的「记录字段不完整或格式不正确。」失败——blast radius 是全局的。**已核实**

---

**P2-23 · meteogram 全览模式一行天气简字都不画。** `components/meteogram/meteogram.js:439` `if (noonOnly ? h.t !== '12' : i % 3 !== 0) return` —— `h.t` 是 `'12:00'`，`'12:00' !== '12'` 恒真 ⇒ 168 列全部 return。触发：横屏全览（`weather-chart.js:59 applyMode('fit')`，`hourWidth≈4 < 10` ⇒ `noonOnly=true`）。后果：全览图里 `ROW.code` 那一行（"这天什么天气"，恰是全览模式被造出来的理由）整行空白；标准/放大走 `i % 3` 分支正常，故真机抽查极易漏过。同组件别处均按 `'HH:mm'` 用（`:48 hourKey`、`:477 h.t.slice(0,2)`、`:482`）。验证：`tools/weather-page-test.js:645-668` 只测 `hourWidth` 收敛，无一条执行 `drawCode`；用记录上下文跑一次断言有 `fillText` 即红。**已核实**

**P2-24 · `.card-label` 只定义在 `pages/me/me.wxss`，其他三个页面用了但取不到。** 定义 `pages/me/me.wxss:4-9`；使用 `weather.wxml:17,91`、`weather-hub.wxml:14,24`、`editor.wxml:43,200,263,378`。page.wxss 不跨页共享（只有 `app.wxss` 全局）⇒ 这些节点命不中任何选择器，退回默认 `<text>` 14px/400/inline ⇒ 天气页「{date} 的数字」、天气首页「导入 GPX 轨迹 / 我的观察点」、编辑器「活动时间/节点 N/上车点 N/风险 N」标题不加粗不放大，编辑器里还会与后续内容挤在同一行。违反 ourtrail-ui「全局化组件类只在 app.wxss」。验证：`grep -c card-label app.wxss` → 0。**已核实**

**P2-25 · `var(--surface-alt)` 不存在且无 fallback：留宿开关 ON 态失去底色。** `components/space-time/space-time.wxss:34` `background: var(--surface-alt);`，而 token 表 `app.wxss:5-45` 无该变量 ⇒ invalid at computed-value time ⇒ 整条声明作废（背景保持透明）。同文件 `:112` 写的是 `var(--text-2, var(--ink))`（有 fallback），说明作者知道该规则、`:34` 属漏写/发明 token。后果：ON 态只剩 `color`+`border-color` 变化，OFF 态是 `--info` 蓝底 ⇒ "按了没反应"错觉。验证：扫全库 `var()` 引用与 `app.wxss` 定义比对，仅此一处无 fallback。**已核实**

**P2-26 · `overlay` 的卸载钩子绑不成事件：`animation-end="noop"` 不是事件绑定。** `components/overlay/overlay.wxml:3`；WXML 事件绑定须为 `bindanimationend`/`bind:animationend` ⇒ `overlay.js:23-25` 的 `onAnimationEnd` **永不调用** ⇒ `rendered` 恒 true（`observers.open` `:14-16` 只在打开时置 true）。后果：关闭后弹层节点常驻（`overlay.wxss:11-20` 的 `visibility:hidden + pointer-events:none` 挡住了点击，所以不吞点击），但每页最多 4 个 sheet 的 slot 内容持续参与 setData 回流与 diff，`transport-panel` 车辆表单这类大子树尤甚，低端机可感变慢。`check-handlers.js` 不把 `onAnimationEnd` 计为未解析 handler。验证：真机 `page.$('overlay').data()` 关闭后看 `rendered`。**已核实**

**P2-27 · meteogram 的 property 与 method 同名 `hourWidth`。** `components/meteogram/meteogram.js:66`（`properties.hourWidth`）与 `:99`（`methods.hourWidth()`），`:105` 每次 `scheduleDraw()` 都调 `this.hourWidth()`。基础库把 property 访问器与 methods 都挂到实例，同名时**谁赢没有文档保证**；此处实为方法赢（真机能画出来，`:92` 注释记的 2026-09-30 `onTap` 真机复现即旁证）。一旦基础库改成访问器优先，首帧即 `TypeError: this.hourWidth is not a function`，全站唯一使用该组件的两页天气图整块空白。**掩盖机制**：`tools/weather-page-test.js:663` 用 `Object.assign({}, mcfg.methods, mcfg)` 手工拼对象，绕开真实实例 ⇒ 没有任何测试能证明哪侧赢。建议（本次不改）：方法更名 `resolveHourWidth()`。**已核实**

**P2-28 · 导出按钮的 disabled 判定写反：常态下一直显示为禁用样式。** `components/roster-panel/roster-panel.wxml:136` `{{busy && exportPurpose ? '' : 'disabled'}}` —— `busy=false` 时表达式恒为 `'disabled'`，`.button.disabled`（`app.wxss:114`）把底色/字色压成 `--line`/`--muted`；而同一行 `bindtap="{{busy || !exportPurpose ? '' : 'onExportConfirm'}}"` 是**正确的** ⇒ 能点但一直长得像禁用，填了用途也不变亮，用户以为不能点。与同一弹层 `:109` 的正确写法 `{{purpose ? '' : 'disabled'}}` 自相冲突。`check-handlers.js` 不看表达式。**已核实**

**P2-29 · canvas 缺 `weather_code` 时伪造「晴」，与 `format.js` 的 `'—'` 分叉。** `components/meteogram/meteogram.js:440` `PHRASE(numOr(h.code, 0))` ⇒ `numOr(undefined,0)=0` ⇒ `PHRASES` 首档 `max:0` ⇒ '晴'；卡片侧 `F.weatherPhrase(undefined)`（`utils/format.js:104-122`）走 `Number.isFinite(NaN)` 分支给 `{label:'—'}`。触发：`lib/weather.js:202 (h.weather_code||[])[i]` 为 undefined。后果：图上是"晴"、同一小时在逐小时明细/概览条上是"—"；`:511-520` 的并列色标/文案表已双份维护，阈值改一处就分叉。注释「canvas 里无法 require」的理由**不成立**：`utils/format.js` 是 wx-free，同目录 `roam-scrubber.js:10` 与 `space-time/layout.js:16` 都在 require 它。**已核实**

**P2-30 · `astro.js` 黄金时刻的 +6° 俯角修正符号与相邻行相反：高处两头各宽约 2×dip。** `utils/astro.js:143` `hz = at(SUN_HORIZON - dip)`（正确：视高度 = 几何高度 − dip ⇒ 日出更早、日落更晚），而 `:142` `p6 = at(6 + dip)` 把外沿推向反方向 ⇒ `morningGolden={from:hz.rise,to:p6.rise}` 与 `eveningGolden={from:p6.set,to:hz.set}` 两端同时被撑大。`elevM` 越大越明显（3900 m 处 dip≈2.0° ⇒ 约 15–20 分钟）。后果：高山线路「晨昏光窗口」结论偏宽，`sky.hourMarks:174-175` 经 `hourTouches` 打出的 golden 标记多约一小时，`space-time` 主窗口括号随之偏长。**掩盖机制**：`tools/astro-test.js:92` 只在 `elev=500`（dip≈0.04°）断言 `<50 分钟`，符号反了也过。加 `elev=3500` 解析式比对即红。**已核实**

**P2-31 · `space-time.compute()` 的缓存签名不含 width：改宽后仍按旧几何绘制。** `components/space-time/space-time.js:96-127`，sig（`:100-105`）含 series/days/nodes/lat/lng/obsAlt/arriveT/stayEndH/scrub 但**无 `this.cssW`**，而 `:121` 用 `this.cssW` 建 `box/toX`；`:231` 更新 `cssW` 后 `:234 compute()` 命中 `_sig===sig` 直接返回旧 chart，`:238 draw(chart)` 却用新宽铺底 ⇒ 图只占左侧一段、右侧空白、xTicks 与画布右缘错位。触发：分屏/平板/DevTools 拖动/字体缩放。（`meteogram` 侧 `:108` 的 `w` 由 series.length 推导并自算 chartW，不受此影响。）**已核实**

**P2-32 · `grade()` 先分档后四舍五入：显示「条件一般 70」的自相矛盾。** `utils/sky.js:71-83`：`if (s >= g.min)` 用**未取整**值分档，而 `score: Math.round(s)` 取整后展示（消费方 `weather-model.js:412-413` → `weather.wxml:116`）。`grade(69.6)` → `s>=70` 假 → 落 `min:45` 档 → 返回 `{score:70, label:'条件一般'}`，而阈值表明确 70 = 条件较好 ⇒ 同一页里两个 70 分给不同结论。验证：`sky-test.js` 加 `grade(69.6)` 断言 `score<70` 即红。**已核实**

**P2-33 · 全览模式读数会显示「NaN°」。** `pages/weather-chart/weather-chart.js:104-110` 的 `onPickHour` 只 `if (!h) return`，不校验数值；`Math.round(undefined)=NaN` ⇒ `parts.push('NaN°')` ⇒ 头部读数「9/28 06:00 · NaN° · 晴」。触发：`lib/weather.js:196 (h.temperature_2m||[])[i]` 为空的时刻。同页 `F.weatherPhrase(h.code)` 已给 '—'，温度却直出。`tools/weather-page-test.js:655` 的 fixture temp 恒有值故测不到。**已核实**

**P2-34 · 非标准 WXML 标签 `<section>`/`<span>`/`<article>` 站在全站承重组件里。** `components/status-panel/status-panel.wxml:1,2` 与 `components/activity-card/activity-card.wxml:1,14`。`tools/check.js:42-69` 只做标签**配平**（`section` 不在 VOID_TAGS，配 `</section>` 即过），不校验标签合法性 ⇒ 编译无告警，WebView 层当通用 DOM 节点透传、`.empty-state`/`.card` 仍生效，所以"现在看着对"。风险：`hover-class="card-hover"`（`activity-card.wxml:1`）是 `view` 的能力，挂在未知标签上是否给按压反馈未经证实；切换 Skyline 渲染（`app.json` 未设 `renderer`，但这是平台方向）后这两个组件存在整体不渲染的风险——status-panel 是**所有页面**的 denied/loading/empty/error 载体，activity-card 是 home/discover 列表项。验证：真机点卡片看按压态；`page.$('status-panel')` 看节点类型。改成 `<view>` 零风险。**已核实**

**P2-35 · `icon` 未知 name 静默画成日历，图标张冠李戴且无任何线索。** `components/icon/icon.js:85` `const d = PATHS[name] || PATHS.activity`。`PATHS` 23 键 + `ART` 2 键，调用点几乎全为字面量（唯一动态来源 `custom-tab-bar/index.wxml:11` 的 `item.icon`，4 个值已逐个核对命中）。拼错（如 `alert`→`allert`）即显示日历，排查成本高。建议：兜底改 `PATHS[name]` + 一次 `console.warn`，或加静态检查扫 wxml 里 `name="…"` 是否都在 PATHS/ART。**已核实**

**P2-36 · `var()` 被写进内置组件的颜色属性（全库唯一一处）。** `components/roam-scrubber/roam-scrubber.wxml:22-24` `activeColor="var(--forest)"` / `backgroundColor="var(--forest-soft)"` / `block-color="var(--forest)"`。这些属性值由 `slider` 内部模板拼成 inline style，而 `block` 在部分基础库/平台是原生绘制层，`var()` 不被解析 ⇒ 最坏退回平台默认蓝/灰，与全站森林绿不一致（颜色在本项目是语义载体，图例色块就是同一 token）。同仓其它内置组件一律写字面量（`transport-panel.wxml:206 color="#163E35"`、`overlay.wxml:8`）。验证：真机截图对比滑块色与 `.st-lg-dot`。**机制已核实，是否退回默认色待真机确认**

**P2-37 · `space-time` 触发的三个事件没有任何父级监听（死契约）。** `components/space-time/space-time.js:152 ('overnight')`、`:164 ('scrub')`、`:170 ('playstate')`；唯一宿主 `pages/weather/weather.wxml:78-86` 只有 series/days/nodes/lat/lng/obs-alt/arrive-t 六个属性、零 `bind:`。组件内部状态自洽（`overnight`/`roamValue` 在自己 data 里，留宿卡也自算 `computeAstro`），故功能不受影响；后果是留宿开关不进页面 data，页级埋点/分享文案以后要用只能再加一次。验证：`grep -rn "bind:overnight|bind:scrub|bind:playstate" miniprogram/` → 0 命中。**已核实**

**P2-38 · 「查找现场人员」每敲一个字符就全量重读服务端（field-panel 特有）。** `components/field-panel/field-panel.js:109-110` `onSearch(e) { this.setData({ search: ... }, () => this.reload()) }`，而 `reload` 走 `api.read({kind:'activity', perspective})` ⇒ `index.js:64` ⇒ `store.loadState` 读 **15 个集合**。对照 `roster-panel.js:137` 同位置是 `() => this.render()`（纯本地过滤）——只有 field-panel 把过滤写回服务端读。`this._loading` 只防并发不防重复。后果：现场 40 人时输入卡顿、结果闪空、云函数配额白烧（叠加 P2-7 每次调用全量水合）。**已核实**

**P2-39 · 阶段推进的理由只有 `active→closing` 一格必填，其余留空也能过，事件摘要变成冒号吊车尾。** `cloudfunctions/trailApi/domain/schema.js` 的 `activity.transition` 声明 `reason: specText`（必填但**允许空串**），而 `domain/activity.js:179-180` 只对 `active→closing` 判 `if (!p.reason.trim()) return failure(...)`，`published→gathering`、`gathering→active`、`closing→archived` 三条**不校验理由**。事件摘要侧 `domain/commands.js:61`：`p.type === 'activity.transition' ? summaries[p.type] + '：' + p.reason.trim()` ⇒ 理由为空时写出「活动阶段已更新：」这种尾随冒号的残缺句，进 `ot_events` 与全员通知。后果：阶段推进（含"归档"这类安全收尾动作）可以在不留任何说明的情况下完成，而这条摘要正是组织者事后复盘与纠纷追责的唯一文字记录。**验证**：smoke 用 `reason:''` 跑 `closing→archived`，断言 `events[last].summary` 不以 `'：'` 结尾。**已核实**

---

## 专节 · 「测试/文档为缺陷背书」清单

本轮 8 条属于同一类：门禁与测试**全绿**，但绿的方式恰好掩盖了缺陷。这类问题本项目已自己记录过两次（根 AGENTS.md 坑 11、`utils/AGENTS.md`「不要在测试里复刻页面逻辑」），仍以新形态复现。

| # | 掩盖机制 | 被掩盖的缺陷 | 位置 |
|---|---|---|---|
| 1 | 测试手工构造 `currentTarget.dataset.key` | 勾选参与人在真机不生效 | `scenario-signup-test.js:78` ← P0-2 |
| 2 | 桩预置 `'ourtrail.openid': 'u-test'` | actor 隔离从未生效（5 个套件同法） | `draft.js:36-41` + 5 个 scenario 桩 ← P1-9 |
| 3 | 桩记录 `revision` 但从不比较（fixture `revision: 7`） | 编辑器首次保存不带 CAS 令牌 | `scenario-editor-test.js:95/100-102` ← P0-9 |
| 4 | `stub-wx-server-sdk` 原样重抛、无事务操作数上限/包装 | 冲突 code 丢失后自愈失效；批量命令事务超限测不到 | `stub-wx-server-sdk.js:48-63` ← P1-5 / P1-7 |
| 5 | 云层带 fixture 用**常量** band | 换带即丢带，真实数据整层不画 | `space-time-draw-test.js:125` ← P1-15 |
| 6 | 海拔 fixture 全为数字、日期 fixture 全为**单日期** | 海拔兜 0 m；跨天轴退化 | `weather-model-test.js:173-177`、`space-time-test.js` ← P1-16 / P1-17 |
| 7 | `astro-test` 只取 `elev=500`（dip≈0.04°） | 黄金时刻 dip 符号反了也过 | `astro-test.js:92` ← P2-30 |
| 8 | 知识库把"应然而非实然"写成事实 | 敏感读取审计根本不存在；免鉴权动作集合写错 | `trailApi/AGENTS.md` action 表 + `domain/AGENTS.md` ← P0-6 / P2-6 |

**另有 5 条属于「数据对、渲染不对」的天然盲区**（`check.js`/`check-handlers.js` 与逻辑套件结构上测不到，正是根 AGENTS.md「直连微信开发者工具」一节列出的 bug 形态）：P1-18（`SLOTS` 空面板）、P1-21（canvas 图层不重对齐）、P2-23（全览简字）、P2-24/P2-25（跨文件样式作用域与未定义 token）。其中 P1-18 可直接证明覆盖缺口：`grep -rn "SLOTS|buildSlots|slots" tools/weather-page-test.js` → **0 命中**，129 例无一触及。

**门禁现状（本次只读跑过）**：`node tools/check.js` → ALL CHECKS PASSED；`node tools/check-handlers.js` 16 页 + 13 组件全绿。上面 71 条 finding 没有任何一条被这两道门或 24 个逻辑套件覆盖。

**文档漂移（非缺陷但会误导下一次改动）**：根 `AGENTS.md` 仍写 14 页 / `editor.js` 798 行（实际 828）/ smoke 86（各脚本自报口径已变）。`config.json:5` 声明 `security.msgSecCheck` 而全仓零调用（`grep -rn msgSecCheck cloudfunctions miniprogram` 只命中 config 行），真实使用的 `phonenumber.getPhoneNumber`（`index.js:205`）反而未声明——声明与实际权限反接；同时意味着 **UGC 全程无内容安全检测**却"看起来是刻意选择"（微信审核/封禁暴露面）。`tools/sync-lab.js:22-26` 以 `copyFileSync` 复制 domain，**没有任何门禁比较两份拷贝**，`trailapilab-test.js:18/29` 加载的也是 lab 自己的拷贝 ⇒ 一次 `domain/` 修改后忘记 sync，lab 会用**旧规则**写**同一批真实行**（今日 `diff` 显示 13 个 domain 文件 + `store.js` 仍完全相同）。`lab/index.js:248-263` 的 cleanup 把每个 `remove().catch(() => null)` 的失败也计入 `removed[name] = docs.length`——正是其自身注释 `:264-266` 描述的半应用状态（曾导致「每份报名恰有一份履约」破一次）。

---

## 已核查为「非问题」的假设（供后人不必再追）

1. **`overrideEvidence` 的"恰好三键"判定不构成伪造面。** `{at,by}` 缺 `note` 或加第 4 键都能逃过覆写，但 `Evidence = specObj({at,by,note})`（`schema.js:189`）由 `schema.js:69-86` 的严格匹配把住：缺键在 `:76` 失败、多键在 `:81-84` 失败，且整个命令树在 `commands.js:107` **先于** `canExecute` 校验。真实客户端（`field-panel.js:172/176`）三键全发。**闭。**
2. **`persistState` 的 CAS 本体是正确的。** `store.js:112-116` 在事务内重读 `ot_meta/main` 并与写入所用 revision 比较；所有 `set`/`remove`/meta bump 都在事务内，冲突时整体回滚，不存在部分落盘；SDK 重试时复用 diff 是**安全**的（回调会重读 meta 并重判 CAS）；`index.js:130` 在 replay 时正确跳过持久化；两个并发 dispatch 不可能都成功。缺陷是其**后果与分类**（P1-5/P1-6/P1-7），不是 CAS 本身。
3. **`diffCollections` 不会漏改动。** 非有限数被 `schema.js:55` + `invariants.js:11` 挡在外面（故 `NaN→null` 塌缩不可达）；`ot_*` 记录里没有任何 `Date`（`weather_cache.fetchedAt` 在 diff 之外）；`deepClone` 是 JSON 往返故已消灭 `undefined` 键；键序差异最多多写一次；删除检测完整（`store.js:97-99`）。`assignments`/`attendance`/`positions` 按 `signupId` 的 `_id` 唯一性由 `invariants.js:22/90/133` 保证。
4. **敏感投影没有把整记录透传。** `selectors.js` 逐字段构造 view，`activityView` 只暴露 `ownerId` 一个跨实体标识；`kind` 未在列表中一律 `deniedView`（`:318`）；staff/vehicle 失去授权后各读口按 `expiresAt` 严格 `<` 与 `requireSignups` 重新求值（`:324/332-334/341-343/386`）。`readSensitive` **完全不写**，因此谈不上绕过 CAS——缺口是 P0-6 的"可追责性"，不是完整性。
5. **前后端字段名无漂移（审查范围内）。** `activity.js`/`signup.js`/`notices-page.js`/`roster-panel` 读取的每个字段都能在 `selectors.js` 找到发射点；`format.js` 的 6 张标签表对 `schema.js` 的 5 个枚举**全覆盖**（Phase 7/7、SignupStatus 6/6、Departure 4/4、IncidentKind 4/4、UnassignedReason 4/4、DETAIL_STATES 12/12）。
6. **容量边界不 off-by-one。** `signup.js:61`（`occupied + prepared.length <= capacity`）与 `:65`、`:130`、`activity.js:32`、`invariants.js:53` 一致且严格；以组为单位计费，无部分越界；CAPACITY 失败**不**推进 revision（递增在 `commands.js:127`，位于 `handle` 之后）。
7. **时间算术正确。** `nowIso()`（`index.js:26`）与 `cnToday()`（`lib/weather.js:27`）同为 +8h 并标 `+08:00`，无 DST；日差两侧都以 UTC 午夜解析（`index.js:163-164` / `lib/weather.js:254`/`:124`），0–14 窗口两侧一致（`smoke-test.js:379-382` 已钉）。两份 `gcjToWgs` 确有数值差异（`gpx.js:91/105` 舍入到 1e-6，`lib/weather.js:84/96` 不舍），但差值 ≤0.11 m、被 `weather-page-test.js:89-92` 以容差显式钉住，且两条天气路径都只用服务端那份 ⇒ 用户不可见。
8. **草稿不会跨活动串用**（key 含 activityId，`draft.js:21-23`）；各面板的 `reload()` 均存在（`dispatchAndSync` 的 duck-typed 契约可满足）；`this.view` 在所有被审页面/面板里只读不本地改写；身份码路径无客户端角色可信位。
9. **名单「全选」不会勾到不可见行。** 有一种怀疑是 `onSelectAll` 遍历 `this.data.rows` 而渲染列表另有一层过滤，因此批量命令会带上被过滤掉的已拒绝/已取消行、令整批 `signup.review` 报「只有待确认报名可以审核。」。**本次逐行否证**：`roster-panel.js:97-99` 的 `render()` 把 `rows = v.rows.filter(status).filter(search)` **写回 `data.rows`**（`:113`），`onSelectAll`（`:151`）遍历的正是这同一份已过滤集合；`render()` 还在 `:110` 把 `selected` 反向剪枝到当前可见行。故 `selectedIds()` 恒为可见子集，`onBatchConfirm` 的 `signupIds` 不含隐藏行。**闭。**（另注：`CAS 双重保护`——`assignment.commit` 的 `preview.baseRevision`（`transport.js:131`）与全局 revision CAS 叠加，`allocation.js` 预览与提交之间无 TOCTOU 面，因为提交同时受两道约束；`domain` 37 类命令在 `permissions.js` 的 `canExecute` 中**全部有分支**且 `default` 拒绝，未发现漏闸。）

---

## 建议复测优先级

**第一批：一条真机判据可定案 P0（成本最低、决定性最强）**

1. `onToggleCandidate` 首行打印 `e.currentTarget.dataset.key` 与 `e.detail.value` ⇒ 决定 **P0-2** 是否已在现网（前者 `undefined` 即确认，代报/多人报名整体不可用）。
2. 代报一人 → 活动置 `gathering` → 点「确认已到集合点」并**允许定位** ⇒ 复现 **P0-3** 的 `FORBIDDEN` 死路（观察是否连发车也被卡住）。
3. 分车页给一辆"参与者兼司机"的车改车牌并保存 ⇒ 复现 **P1-19**。
4. 工作台「名单」确认报名后直接切「分车」⇒ 确认 **P1-20**（下拉里是否缺刚确认的人）。

**第二批：一次真机截图批（`docs/e2e-mp/drive.js` 现成模板，覆盖渲染类）**

天气页 P4 图（有无横向云带 **P1-15**、canvas 与「当日数字」卡间距 **P1-21**）、结论卡下方的分时段摘要是否整块缺席 **P1-18**、横屏全览图的天气简字行 **P2-23**、留宿开关 ON 态底色 **P2-25**、滑块颜色 **P2-36**、`overlay` 关闭后 `data().rendered` **P2-26**、无 GPX 高程活动的纵轴刻度 **P1-16** 与多日活动节点分布 **P1-17**。

**第三批：云端一次性读数（决定 P2-3 / P2-4 / P2-7 / P1-7）**

`weather_cache` 文档数与体积（0 ⇒ 缓存从不生效）、`ot_routes` 与 `ot_activities` 行数比（>1 ⇒ P1-12 的孤儿堆积）、单次调用耗时与 DB 读次数、以及 120 人全选审核的实际返回 code（区分 `STORAGE_UNAVAILABLE` 与事务超限）。

**第四批：破坏性验证必须在隔离环境（P0-1）**

白名单账号带真实 id 调 `seed`/`cleanup` —— 注意这会**真的**删数据，先确认环境非生产。若只有生产环境，改为静态确认：核对 `lab/index.js:90` 与 `:237` 两处对 `event.activityId` 的直取，并核对 `findLabActivity` 是否为唯一前缀守卫。

**第五批：弱网/并发脚本（P0-8 / P1-1 / P1-5 / P1-7）**

`config.json` 20 秒超时下：连点两次发布通知、连点两次保存授权、`callFunction` 超时后按提示重试，读 `ot_notices`/`ot_incidents`/`ot_memberships` 是否翻倍；双客户端同一活动先后保存，看 B 得到的是「安排已被他人更新」还是「这次修改没有保存」（后者 ⇒ P1-5 的 CONFLICT code 已丢）。

**门禁补强方向（本次不改，仅记录）**

`check.js` 增一条比较 `trailApi/domain` 与 `trailApiLab/domain` 的字节相等；stub 的事务内操作数计数与上限断言；`smoke-test` 增「permittedActions × 该 phase 可执行性」交叉表；`weather-page-test` 增 `buildSlots` 与 `drawCode` 执行；`space-time-draw-test` 的 band fixture 改为随小时漂移；`astro-test` 增 `elev=3500` 例；`scenario-signup-test` 的 `pickEv` 改为忠实模拟 `checkbox-group` 事件（不带 `currentTarget.dataset.key`）。

