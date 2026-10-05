# 01 · Current Profile Architecture Map（现状架构图）

> 审计基线：`master` 分支，HEAD `15cafdb`（2026-10-05）。
> 工作区另有在途未提交改动（`needsOutboundBoarding` 拼车上车核实批次，见 `git status`），
> 经逐行 diff 核对**不触及任何 Profile 面**（selectors.js / permissions.js 的改动只在 rowView 与上车规则），
> 本文全部【CODE FACT】在 HEAD 与工作区一致。
> 标记约定：本文只陈述代码事实，不加设计判断；设计判断见 02–12。

---

## 1. 数据模型（真源：`cloudfunctions/trailApi/domain/schema.js`）

【CODE FACT】Person（schema.js:116-120）：

```
Person = {
  name: str(≤2000), phone: str(≤2000),
  emergency: { name: str, phone: str },
  medical: str(≤2000),
  avatar: str(≤500)        // 可选；微信头像上传云存储后的 fileID
}
```

【CODE FACT】Profile 与 Companion（schema.js:125-126）：

```
Companion = { id: str(≤120), person: Person }
Profile   = { id: str(≤120), person: Person, companions: Companion[] }
```

【CODE FACT】`Profile.id` 的取值是**微信 openid**。云函数入口从 `cloud.getWXContext().OPENID` 取得
（index.js:263），作为 `actor.userId` 传入命令（index.js:118）；首次 `profile.save` 落库时
`profile = { id: userId, person, companions: [] }`（profile.js:44）。此后所有权限判断都以它为账号键。

【CODE FACT】存储：`ot_profiles` 集合，一用户一文档，`recordKey` = `record.id`（= openid）（store.js:8, 25-29）。
`loadState` 每次请求全量水合 15 个集合（store.js:70-82）——Profile 的每次读写都付这份成本。

【CODE FACT】PersonRef（schema.js:121-124）——报名里「这个人是谁」的引用：

```
PersonRef = { kind:'user', userId }                       // 本人（= openid）
          | { kind:'companion', ownerId, companionId }    // 某账号的常用同行人
```

【CODE FACT】Signup 持有 participant 的**完整 Person 快照** + 授权三元组（schema.js:171-174, 179-183）：

```
Signup.participant = Person（报名时刻的快照，含 emergency/medical）
Signup.consent = { at, recordedBy, dataUse: true(字面量), proxyAuthority, proxyHome }
```

报名快照与 Profile 是**两份独立数据**：报名后改 Profile 不会回流到已提交的报名（改报名走 `signup.edit`）。

【CODE FACT】Membership（schema.js:207-216）——活动级工作授权，与 Profile 是「账号资产 vs 活动授权」两层：

```
staff:          { role, id, activityId, userId, expiresAt, scope:{kind:'all'|'selected',signupIds}, capabilities: Capability[] }
vehicle_contact:{ role, id, activityId, userId, expiresAt, vehicleId }
Capability = ['roster','checkin','node','incident','position','home','sensitive']（schema.js:206）
```

【CODE FACT】schema 是严格校验：不接受多余键、不做类型强转（schema.js:1-2, 79-85）。
Person 里塞 `person.xxx` 杂散键会被整条命令拒收（me.js:207 注释即为这个坑的记录）。

---

## 2. 命令层（真源：`domain/profile.js` + `domain/permissions.js`）

### 2.1 profile.save

【CODE FACT】权限（permissions.js:127）：`profile.save` 对任何已登录账号 `allowed()`——无额外门槛。
【CODE FACT】处理器（profile.js:30-47）：trim 四个字段 → **硬门槛 `!name || !phone` 返回 INVALID_INPUT
并附 fieldErrors**（profile.js:36-41，`请填写姓名与联系电话。`）→ 首次保存创建 Profile（id=openid），
之后**整体替换 `profile.person`**（profile.js:46，非字段级合并）。

【CODE FACT】门槛的直接后果：**紧急联系人 / medical 与姓名手机号共用一条命令、同一道门槛**。
紧急联系人填了但姓名没填齐 → 服务端整条拒绝（这正是本地草稿存在的根因，见 §5）。

### 2.2 companion.save / companion.remove

【CODE FACT】权限（permissions.js:128-131）：`companionId === null`（新增）或该 id 已在自己的
`profile.companions` 里，否则 FORBIDDEN（只能管理自己的同行人）。
【CODE FACT】处理器（profile.js:49-54）：**本人 Profile 必须先存在**，否则
NOT_FOUND `请先保存当前账号资料。`（profile.js:49）；按 id upsert（payload 带 id 改、不带生成）。
同样的 name+phone 硬门槛适用（profile.js:36-41 在 companion 分支之前执行）。
【CODE FACT】`companion.remove`（profile.js:56-59）：从 `profile.companions` 过滤掉目标 id；
Profile 不存在时落到兜底 INVALID_INPUT（profile.js:60）；**id 不存在时是静默 no-op 成功**。
【CODE FACT】移除同行人**不检查是否被历史报名引用**（invariants.js:32-41 只校验
`personRef.ownerId === submittedByUserId`，不校验 companionId 仍存在）——报名里存的是快照 + 引用，
移除后旧报名仍可读，只是编辑时前端回查不到（signup.js:153-155 回查落空则不回填）。

### 2.3 membership.save / membership.revoke（协作授权）

【CODE FACT】权限：owner 专属（permissions.js:270-273）。
【CODE FACT】处理器（profile.js:9-27）：
- 活动必须存在且非 archived/cancelled（profile.js:10-12）；
- `expiresAt` 必须晚于当前（profile.js:18）；
- **被授权账号的 Profile 必须已存在**，否则 NOT_FOUND
  `找不到被授权的账号。请对方在「我的」页复制身份码给你。`（profile.js:19）；
- staff 必须至少一项 capability、scope.selected 必须非空（profile.js:20-23）；
- 同 id 覆盖；vehicle_contact 同车旧授权被顶替（profile.js:24-26）。

【CODE FACT】**空壳档案无法被授权**：`read kind:'profile'` 对从未保存的用户返回的是合成空壳、
**不落库**（selectors.js:254-256 注释「由 profile.save 真正落库」）。因此「把身份码给组织者」这条路
**只有在对方完成过一次 profile.save 之后才走得通**——身份码的分发与 Profile 完整度是耦合的。

### 2.4 position.revoke（位置授权撤回）

【CODE FACT】权限（permissions.js:231-233）：本人报名或有效代报 → allowed；只是提交者（own）→
CONSENT_REQUIRED；其余 FORBIDDEN。
【CODE FACT】处理器（field.js:15-19）：把 `position.revokedAt` 置为 now；**无位置记录时静默成功**；
**不受活动阶段闸门限制**（在 phase 检查之前返回，field.js:15-19 vs :20）。
【CODE FACT】位置上报本身（field.js:105-111）：仅 active 阶段、仅本人、需 `consent:true`、
授权窗口 = `activity.endAt`（consentExpiresAt）、每人只保留最新一条（invariants.js:133-137）。

---

## 3. 读取层（真源：`domain/selectors.js`）

【CODE FACT】投影纪律：**逐字段构造、不透传存储记录**（selectors.js:12 注释）。逐个投影核对结论：

| 投影 | 暴露内容 | 门 | 位置 |
|---|---|---|---|
| `personView` | name/phone/emergency/medical/avatar 全量 | 只用于本人 profile 读与 selectSignupForm（有门） | selectors.js:14-18 |
| `selectView kind:'profile'` | 本人 profile{id, person, companions[]} | 仅 actor 本人；未登录 denied；无档案回合成空壳 | selectors.js:250-258 |
| `rowView` | name/avatar/status/pickup/vehicle/seat/履约旗标，**无 phone/medical/emergency** | 随 activity 视角的 visible 过滤 | selectors.js:110-131 |
| `selectSensitive` | {signupId, emergency{name,phone}, medical}（**不含 participant.phone**） | canReadSensitive（本人/代报无条件；owner 或 staff`sensitive` 需非空 purpose + workDataAvailable） | selectors.js:141-147; permissions.js:84-95 |
| `selectContact` | {name, phone} | 本人/代报/工作许可（owner、staff`roster`、车辆联络且已确认有分配） | selectors.js:149-162 |
| `selectSignupForm` | participant 完整 personView + consent | canReadSensitive **且** isOwnSignup‖isOwner（staff 即使有 sensitive 能力也读不到表单） | selectors.js:164-181 |
| `selectExport` | 普通模式无敏感列；sensitive 模式加紧急联系+medical 列 | export.record（owner）+ 逐行 canReadSensitive | selectors.js:213-234 |
| 车辆任务乘客 | **含 `phone`**（selectors.js:397） | vehicleCan + workDataAvailable | selectors.js:389-400 |
| home `meta.positionRows` | {activityId, activityTitle, signupId, name} | 本人/代报 + confirmed + 位置有效 + canExecute(position.revoke) | selectors.js:284-287 |
| home `meta` 其余 | owner/joined/staff/vehicle 布尔、confirmed/pending/capacity | — | selectors.js:274-282 |

【CODE FACT】**归档后敏感读取被整体关闭**：`canReadSensitive` 的工作许可分支要求
`workDataAvailable`（phase 非 archived/cancelled，permissions.js:26-29, 92-93），
本人/代报分支不受此限。归档后 owner 带 purpose 也读不到敏感资料
（e2e-test.js:311-321 有断言）。这与 V1 规格「活动结束后…再次查看应受权限控制」（V1 §4.1）相比
是**更严**的实现，不是放松。

---

## 4. 「我的」页面现状（真源：`miniprogram/pages/me/me.js` 364 行 / me.wxml 163 行 / me.wxss 89 行）

### 4.1 请求链

【CODE FACT】`reload()` 并行两个读（me.js:101-105）：

```
api.read({ kind: 'profile' })
api.read({ kind: 'home', perspective: 'participant', openedActivityIds: [] })
```

【CODE FACT】home 读的**唯一用途**是抽 `a.meta.positionRows` 拼位置授权撤回行
（me.js:112-118，label = `活动标题 · 人员名`）。而 home(participant) 返回的是**全量 activityView**
——含 routeSnapshot.points、risks、track 轨迹折线（≤200 点，selectors.js:39-44）——
只为取每场活动里一个几字节的数组。

【CODE FACT】这是站内「为小字段拉全量视图」的三处之一（另两处：home 页为一句问候读全量
profile 只用 `person.name`，home.js:46/home.wxml:22；editor 为复制模板读全量 home 只用 id+title，
editor.js:175）。

【CODE FACT】`revision` 取自 profile 读（me.js:119），作为本页所有 dispatch 的 CAS 基准。

### 4.2 页面结构（me.wxml 顺序）

1. denied / loading 两态（status-panel，me.wxml:2-5）；
2. 页头：eyebrow「我的同行资料」+ 大标题「下次出发，少填一点。」+ 说明行（me.wxml:8-11）；
3. error（danger）/ hint（warning）callout 在**页面顶部**（me.wxml:13-14）；
4. 「我的资料」卡：头像 button `open-type="chooseAvatar"`（me.wxml:20-25）+ 昵称
   `input type="nickname"`（me.wxml:27-37）+ 手机号手填 input + 「微信一键获取（可选）」
   `open-type="getPhoneNumber"` 文字按钮（me.wxml:41-48）；
5. 「紧急联系与安全备注」卡：紧急联系两列（data-key 是 `ename`/`ephone`，me.wxml:56-59）+
   medical 折叠 textarea（me.wxml:61-77）+ 自动保存状态行（me.wxml:78）；
6. 「常用同行人」卡：list-row 列表 + 添加/编辑/移除 + 语义句
   「保存条目不等于代办授权；每次报名仍需逐人同意。」（me.wxml:82-105，:104）；
7. 「协作身份码」卡：`{{identity}}` 全文展示 + 复制按钮 + 说明
   「组织者把它填进『协作授权』，你才能看到对应任务。」（me.wxml:107-118）；
8. 「位置授权」卡（仅 positionRows 非空）：逐行撤回 + 说明
   「只在活动中主动上报一次位置，不会后台追踪。」（me.wxml:121-131）；
9. 同行人编辑 overlay（sheet）——**错误 callout 在弹层内**（me.wxml:134-155，:136-137 是 P0-4 修复）；
10. 移除确认 overlay（dialog，me.wxml:157-162）。

【CODE FACT】`identity` 就是 `profile.id`（= openid），原文展示（me.js:127）、
`user-select` 可选中、一键复制（me.js:347-352）。

### 4.3 自动保存与本地草稿

【CODE FACT】常量与键（me.js:18-19）：`DRAFT_KEY = 'ourtrail.draft.me.person.v1'`、
`AUTO_SAVE_MS = 800`。草稿**不走** `draft.getDraft(activityId, form)`（那套键含 wxOpenId()，
见 §6），用 `draftUtil.wxStorage` 通用适配器直存该键（draft.js:81-88）。

【CODE FACT】草稿只存手输字段（me.js:23-33 `draftableOf`）：name/phone/medical/emergency{name,phone}，
**不含 avatar**（avatar 由 onChooseAvatar 单独落库，混入草稿会把未上传完的临时值带回来——me.js:21-22 注释）。

【CODE FACT】合并方向（me.js:41-52 `mergeDraft`）：**草稿压在服务端值之上**；avatar 永远取服务端值。
reload 后草稿与服务端逐字段相等则清草稿（me.js:138-143 `pruneDraft`）。

【CODE FACT】写路径（me.js:160-200 `persistPerson`）：
1. **先写草稿**（:165）——即使门槛没过，切走再回来输入还在；
2. name/phone 缺一 → 不发请求，置 hint「补全姓名与手机号后自动保存（紧急联系人与健康备注已记在本机，会一起保存）」（:167-181）；
3. `_saving` 防重入（:182）；
4. `dispatchAndSync({type:'profile.save', person}, this.revision, this)`（:185）——CONFLICT 自动重读+提示；
5. 成功 → 清草稿 + hint「已保存」（:190-191）；失败 → **保留草稿** + 页顶 error（:195-199）。

【CODE FACT】触发：`onField` 每次输入 → setData + 写草稿 + 800ms 防抖自动保存（me.js:202-216, 148-154）；
`onBlurSave` blur 立即保存且出 toast（me.js:217-223）；onUnload 清定时器（me.js:84-89）。

【CODE FACT】**草稿无时间戳、无版本、无账号段**：`draftableOf` 只存五个字段（me.js:23-33），
无法判断「草稿是哪台设备/何时写的」，也无法在服务端更新后提示用户本机有旧草稿。

### 4.4 微信资料同步

【CODE FACT】头像（me.js:230-251）：`chooseAvatar` 拿临时路径 → `wx.cloud.uploadFile` 到
`avatars/{identity}/{ts}.jpg` → person.avatar = fileID → 立即 persistPerson（出 toast）。
上传失败/无云能力/用户中断都有文案。

【CODE FACT】手机号（me.js:255-282）：`getPhoneNumber` 的 code → `api.call('getPhoneNumber', {code})` →
服务端 `cloud.openapi.phonenumber.getPhoneNumber` 换真实号码（index.js:201-217）→ 回填 person.phone →
persistPerson。**这条链不经过 dispatch/CAS**，换码成功后的落库仍走 profile.save。
客户端错误分五类给可操作文案（取消/隐私指引未声明/1400001 未开通权限/开发者工具/其他，me.js:267-281），
其中「隐私指引未声明手机号」的文案直接指路 mp.weixin.qq.com 配置（me.js:273-274）。

【CODE FACT】服务端换码失败映射：1400001 或 invalid template → FORBIDDEN
「尚未开通『手机号快速验证』权限（需完成认证并开通）」（index.js:211-214）。

### 4.5 常用同行人交互

【CODE FACT】新增前**客户端预检**本人 name+phone（me.js:285-294），原因是服务端 companion.save 要求
Profile 先存在 + P0-4 教训（错误曾被遮罩盖住，用户看到「点保存没反应」；me.js:286-288 注释、
交互审查 P0-4，已修复：错误 callout 移入弹层内 + 预检拦截）。
【CODE FACT】编辑时**重读一次 profile** 按 id 回查（me.js:296-304）；保存/移除成功后整页 reload。

---

## 5. 本地草稿机制的存在原因（历史事故）

【CODE FACT】me.js:5-10 注释原文记录：服务端 `profile.save` 硬性要求姓名+手机号齐全
（profile.js:36），但紧急联系人与健康备注和这道门槛无关；旧实现 `onShow → reload()` 用服务端空
person **整个覆盖 data.person**，「用户实测过切到别的页面再回来，这些信息又丢了」。
草稿让未落库的输入活过一次会话。f8f0b33 落地「800ms 自动落库 + 草稿防覆盖」。

【CODE FACT】草稿的全部生命周期：`onField` 写 → `persistPerson` 先写 → 成功清、失败留、
与服务端一致时清（pruneDraft）→ 没有任何过期/冲突提示机制。

---

## 6. draft.js 全景与一个既有缺陷

【CODE FACT】键结构（draft.js:21-23）：`[wxOpenId(), activityId, form].join('|')`，openid 缓存键
`'ourtrail.openid'`（draft.js:29），`setOpenId` 已导出（draft.js:36-41, 91）。

【CODE FACT】**`draft.setOpenId` 在 miniprogram/ 内没有任何调用方**（app.js onLaunch 只做
wx.cloud.init，app.js:3-12；全仓 grep 仅测试桩预置该键）。线上草稿键的账号段**恒为空串**，
退化为 `'|activityId|form'`——同机多微信账号（转发/切换登录）会共享同一份报名与编辑器草稿。
me 页草稿用独立键不受此影响，但同键机制同样无账号段。

---

## 7. Profile 的全部消费点（前端）

【CODE FACT】`api.read({kind:'profile'})` 共 4 页 7 处：

| 调用方 | 用什么 | 位置 |
|---|---|---|
| pages/me | 主编辑器：person/companions/identity/revision；编辑同行人时二次回查 | me.js:103, 298 |
| pages/signup | 前置闸门（无 name 拒绝进表单）+ 快照（profilePerson/profileCompanions）+ 预填 + 提交后回写基准 | signup.js:57, 63-82, 152-167, 301-321 |
| pages/editor | 保存/发布前 name+phone 闸门（profileGate 直达按钮）+ 发布时本人 participation（personRef+participant 全量） | editor.js:559-570, 789-816 |
| pages/home | **只为问候语取 person.name**（全量 profile 读，一次只用一个字段） | home.js:46, home.wxml:22 |

【CODE FACT】报名页与档案是**双向同步**：预填「只补空字段」（fillFromProfile 不覆盖已填内容，
signup.js:152-167）；提交成功后按快照为底回写 `profile.save`/`companion.save`（保 avatar，
CAS 链逐条发，失败只 toast「可在『我的』补存」，signup.js:301-321, 331-340）。

【CODE FACT】协作授权（membership）UI 不在 workspace 页，在 `components/roster-panel`：
组织者**手工粘贴对方身份码**（roster-panel.wxml:157-159「请对方在『我的』页复制」）+ 日期/时间双
picker 拼 `+08:00` 截止时间 + capabilities 勾选 + scope all/selected（roster-panel.js:348-375）。
撤销 `membership.revoke` **无二次确认**（roster-panel.js:316-325，交互审查 P1 第 6 条在案）。

【CODE FACT】activity 页（参与者）不读 profile；position.report/revoke 入口在详情页
（activity.js:419-421, 513-522），敏感资料按用途读 `readSensitive`（activity.js:524-532）。

【CODE FACT】app.js 无 Profile 预热、无 openid 获取、`globalData` 为空且从未使用（app.js:3-12）。

---

## 8. 测试现状（真源：`tools/scenario-me-test.js` 757 行 + 全仓 grep）

【CODE FACT】scenario-me-test（81 断言）实跑页面方法，六节：首屏装配 / 微信资料同步五分支 /
自动保存+草稿回归 / 头像昵称 / 同行人增删改 / 身份码·位置撤回·下拉刷新。
已知问题闸门两个：紧急联系 data-key 映射 4 条断言、取号取消提示 1 条，均计 skipped
（scenario-me-test.js:31-41）。

【CODE FACT】域层（smoke-test 106 用例）里 Profile 只有：profile.save 创建+回读（:63-70）、
作为 fixture 的若干次保存（:94, 111-112）、幂等重放（:173-181）。
**companion.save/remove、membership.save/revoke、position.revoke 在 smoke-test 零覆盖**。

【CODE FACT】全测试体系对协作授权的唯一一次命令调度是 golden-path GP-07 的组织者**自授**
vehicle_contact 成功路径（e2e-golden-path-test.js:876-880）；
「身份码不存在时 membership.save 报错」「membership.revoke」「export.record 命令本身」全仓零覆盖。
`canReadSensitive` / `selectSensitive` / `readContact` / `consentRequired` 无直接断言
（只经 readForm/readExport 间接走过部分分支，e2e-test.js:286-321）。

【CODE FACT】me 页无 CONFLICT 自愈用例、无两设备草稿冲突用例、avatar 边界零覆盖
（详见 13-testing-strategy.md）。

---

## 9. 平台能力现状（微信官方，2026-10 核查）

【CODE FACT】本项目基础库 3.8.12（project.config.json），远高于「头像昵称填写能力」的 2.21.2 门槛。
- 头像：`button open-type="chooseAvatar"` + `bindchooseavatar`（填写能力，**不弹授权窗**）；
- 昵称：`input type="nickname"`（键盘带微信昵称快捷填入，**不弹授权窗**）；
- `wx.getUserProfile` 返回匿名数据，本仓 UI 规范明令禁用（ourtrail-ui SKILL.md 硬性规则）；
- 手机号：`open-type="getPhoneNumber"` 是**独立授权**：微信弹出授权半屏 → code → 服务端换号；
  需认证主体开通「手机号快速验证」权限 + 后台《用户隐私保护指引》声明「手机号」，且自 2023-08-28 起
  按成功调用计费（0.03 元/次，实时验证组件 0.04 元/次）。个人主体小程序未开通时降级为手填
  （me.wxss:68 注释与 me.js:275-276 文案都按此现实设计）。
- 隐私协议框架：只有《用户隐私保护指引》中声明处理的信息才允许调用对应隐私接口
  （官方《小程序隐私协议开发指南》）；本仓 privacy-popup 组件已确证死代码并按决策保留文件
  （AGENTS.md NOTES）。

---

## 10. 现状一页图

```
微信平台（openid 由云函数上下文注入，客户端从不知晓 wx.login）
   │ OPENID = actor.userId = Profile.id = 「协作身份码」
   ▼
ot_profiles（一用户一文档） ─── Profile { person: Person, companions[] }
   │                              │ 本人读写（me 页，800ms 自动保存 + 本机草稿救援）
   │                              ├─ 报名页：预填（只补空）⇄ 提交后回写
   │                              ├─ 编辑器：name+phone 闸门；发布时整份 person 作 participation
   │                              └─ 首页：只用 person.name 一句问候
   ▼
ot_signups（报名） ─ participant = Person 快照 + consent{dataUse, proxyAuthority, proxyHome}
   │                  读取门：selectSensitive / selectContact / selectSignupForm / readExport
   ▼
ot_memberships（活动工作授权） ─ userId 靠「对方我的页复制身份码、组织者手贴」
   ▼
ot_positions（一次性位置上报 + 主动撤回；授权窗口 = 活动 endAt）

读链路：client → api.read → actionRead → loadState(15 集合全量) → selectView/select* → 投影
写链路：client → api.dispatch → overrideEvidence → reduceCommand(canExecute→handler→invariants) → persistState(CAS)
```
