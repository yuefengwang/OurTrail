# OurTrail UI Action Map（miniprogram-automator 可执行清单）

- 依据 HEAD `1acd55e` 的 WXML/JS 逆向生成；与 `docs/testing/ui-user-journeys.md` 配套。
- 每条 action 给出：**真实选择器**（WXML 中存在的 class/tag）、触发方式（tap / callMethod 合成事件 / trigger）、前置数据条件、云端效果（云函数 action + command）、成功后可断言的 `page.data()` 键。
- 本文档只描述「可以用 automator 驱动什么」，不是测试框架；不新增任何测试代码。

---

## 1. 环境与驱动约定（本仓库已验证）

```bash
# 改码后必须重开项目重编译（只调 auto 不重编译，会对着旧 bundle 误判）
# 路径必须加单引号，否则 Git Bash 会把它吃成 D:OurTrail —— 见 AGENTS.md「每轮流程」的 ⚠ 注释
cli close --project 'D:\OurTrail' --port 33278
cli open  --project 'D:\OurTrail' --port 33278 && sleep 25
cli auto  --project 'D:\OurTrail' --auto-port 9421 --trust-project --port 33278
# 驱动库装仓库外： %LOCALAPPDATA%\Temp\opencode\mp-auto && npm.cmd i miniprogram-automator
```

```js
const automator = require('miniprogram-automator')
const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
const page = await mp.reLaunch('/pages/home/home')   // reLaunch/navigateTo/redirectTo/switchTab 都返回 page
await page.waitFor(1500)
const data = await page.data()                        // 断言 page.data
const el  = await page.$('.button.primary')           // 单元素；page.$$(sel) 取数组
await el.tap()
await page.callMethod('onPartTrip', { detail: { value: 1 } })   // 合成事件：驱动原生 picker/checkbox 的标准手段
await mp.pageScrollTo(1200)
const shot = Buffer.from(String(await mp.screenshot()), 'base64')  // ⚠ base64 → Buffer 再落盘
await mp.disconnect()
```

### 选择器策略
1. **class/tag 优先**：本仓 WXML 全部用全局样式类（`.button.primary.block`、`.seg`、`.list-row`、`.input`、`.card`…），自定义组件用标签名直接选（`activity-card`、`roster-panel`、`field-panel`、`meteogram`、`space-time`、`overlay`…）。
2. **同 class 多元素**：用 `page.$$()` + 下标（本文表格给出「第 N 个」的语义锚点，锚点是可见文案或 data-*）。
3. **组件内部节点**：用穿透选择器 `page.$('roster-panel >>> .button.text')`；组件方法用 `element.callMethod()`，组件数据用 `element.data()`。
4. **原生 picker/checkbox/slider 无法弹真层**：一律 `page.callMethod('<handler>', { detail: { value } })`（checkbox-group 的 change 传 `{detail:{value:[key]}}` 数组形状——signup 页 `toggleOn` 两种形状都收）。
5. **Tab 切换**：用 `mp.switchTab('/pages/weather-hub/weather-hub')`，比点 custom-tab-bar 稳（TabBar 选中态由各页 onShow 自报，不需要驱动）。
6. **工作台隐藏面板**：`workspace.wxml` 用 `.hide{display:none}` 挂载四面板——**驱动 roster/transport/field 内元素前必须先点对应 `.seg`**（`page.$$('.seg')` 下标 1/2/3，或 `page.callMethod('onTab',{currentTarget:{dataset:{tab:1}}})`）。
7. 等待约定：每次导航后 `page.waitFor(1200)`；写操作后额外等 `reload()` 完成（再 `page.waitFor(1200)`）再断言。

---

## 2. 全局动作（所有页面通用）

| Action | 驱动 | 说明 |
|---|---|---|
| G-01 下拉刷新 | `page.callMethod('onPullDownRefresh')` 后 `callMethod('stopPullDownRefresh')` 不需要——直接 `callMethod('reload')` 更直接 | home/me/notices/anotices/discover/lab 支持 |
| G-02 denied 重试 | `status-panel >>> .button.secondary` tap（面板内部 `onAction` → trigger('action') → 页面 reload） | 需先构造 denied（如未部署/无权限） |
| G-03 关闭弹层 | `overlay >>> .icon-button` tap，或 `overlay >>> .overlay-mask` tap | 所有 overlay 通用；`overlay.data()` 可断言宿主 `xxxOpen:false` |
| G-04 页面栈返回 | `mp.navigateBack()` | weather-chart 的关闭按钮另有 `onBack` |

---

## 3. 分页 Action 表

### 3.1 pages/home/home（Tab 0）

| ID | 选择器 | 事件/驱动 | handler | 云端效果 | 成功断言（page.data） |
|---|---|---|---|---|---|
| H-01 发现活动 | `.card-header >>> .button.text`（第 1 个，文案「发现活动」） | tap | `onGoDiscover` | — | 跳转 discover |
| H-02 发起活动 | 同上第 2 个（「发起活动」） | tap | `onNew` | — | 跳转 editor（无 id） |
| H-03 筛选段 | `.seg` ×3（data-value=mine/recent/finished） | tap 或 `callMethod('onFilter',{currentTarget:{dataset:{value:'recent'}}})` | `onFilter` | — | `filter==='recent'`，cards 重算 |
| H-04 搜索 | `input.input` | `element.input('雪山')` | `onSearch` | — | `search` 变化 + cards 过滤 |
| H-05 打开活动卡 | `activity-card`（`$$` 下标 i） | tap（卡片内 `bindtap="onTap"` trigger('open')） | `onOpenCard` | — | `draft.rememberActivity`；跳 activity?id |
| H-06 协作任务行 | `.list-row`（需要我协作区，data-id/data-gostaff） | tap | `onOpenTask` | — | goStaff→staff 页，否则 vehicle 页 |
| H-07 空态 action | `status-panel >>> .button.secondary` | tap | `onEmptyAction` | — | 有搜索→清搜索；否则进 editor |

云端读取（onShow 自动，无需驱动）：`read`×4。denied 断言：`data.denied !== ''`。

### 3.2 pages/discover/discover

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| D-01 搜索 | `.input` | `element.input('徒步')` → 300ms 防抖后自动 reload | `onSearch` | `read(discover, search)` | `cards` 过滤结果 |
| D-02 打开卡片 | `activity-card` | tap | `onOpenCard` | — | 跳 activity?id |
| D-03 清除搜索 | `status-panel >>> .button.secondary`（空态时 actionLabel=清除搜索） | tap | `onClearSearch` | — | `search===''` |

### 3.3 pages/me/me（Tab 3）

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| M-01 昵称 | `.nick-input` | `element.input('张三')` | `onField(name)` | 800ms 后 `profile.save` | `person.name`；`hint==='已保存'` |
| M-02 手机号手填 | `.field >>> input.input`（data-key=phone） | `element.input('13800000000')` | `onField(phone)` | 同上 | `person.phone` |
| M-03 微信取号 | `.phone-btn`（open-type=getPhoneNumber） | 真机手动；automator 只能 `callMethod('onPhoneCode',{detail:{code:'x'}})` 走服务端换号分支 | `onPhoneCode` | `getPhoneNumber` | `person.phone` 被覆盖 |
| M-04 微信头像 | `.avatar-btn`（open-type=chooseAvatar） | 真机手动（chooseAvatar 无法合成） | `onChooseAvatar` | `uploadFile` + `profile.save` | `person.avatar` 为 fileID |
| M-05 紧急联系人 | 两列 `input.input`（data-key=ename/ephone） | `element.input()` | `onField` | 同 M-01 | `person.emergency.*` |
| M-06 健康备注折叠 | `bindtap="toggleMedical"` 的行（健康与用药备注行） | tap | `toggleMedical` | — | `medicalOpen` 翻转 |
| M-07 添加同行人 | 常用同行人卡 `.button.text`（第 1 个，「添加」） | tap | `onAddCompanion` | —（本人姓名/电话缺失时 error+toast） | `companionOpen===true` |
| M-08 同行人表单 | overlay 内 `input.input` ×4 + `textarea.textarea`（data-key=name/phone/ename/ephone/medical） | `element.input()` | `onCompanionField` | — | `companionPerson.*` |
| M-09 保存同行人 | overlay 内 `.button.primary.block` | tap | `onCompanionSave` | `companion.save` | `companionOpen===false`；`companions.length+1` |
| M-10 编辑同行人 | 同行人行 `.button.text`（「编辑」） | tap | `onEditCompanion` | `read(profile)` | `companionId` 非空 |
| M-11 移除询问 | 同行人行 `.button.text`（「移除」） | tap | `onRemoveAsk` | — | `removeId` 非空 |
| M-12 确认移除 | 移除 dialog 内 `.button.danger.block` | tap | `onRemoveConfirm` | `companion.remove` | `removeId===''` |
| M-13 复制身份码 | 协作身份码卡 `.button.text` | tap | `onCopyIdentity` | —（剪贴板） | — |
| M-14 撤回位置授权 | 位置授权卡 `.button.text`（data-activity-id/data-signup-id） | tap | `onRevoke` | `position.revoke` | `positionRows` 减少 |

### 3.4 pages/notices/notices（Tab 2）与 pages/anotices/anotices

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| N-01 标记已读 | `.notice-card .form-actions >>> .button.text`（未读卡内第 1 个） | tap | `onMarkRead` | `notice.read` | reload 后该卡 badge=已读 |
| N-02 查看活动 | 未读/已读卡内「查看活动安排」 `.button.text` | tap | `onOpenActivity` | — | 跳 activity?id |
| N-03 复制通知 | `owned` 卡内 `.button.secondary` | tap | `onCopy` | `notice.delivery(copy)` | `message` 含「已复制」 |
| N-04 发布通知（仅 anotices，owner） | `.button.primary.block`（「发布活动通知」） | tap | `onOpenPublish` | `readNoticeManagement` + `read`(activity×2) | `publishOpen===true`，`signupRows/vehicleRows` 填充 |
| N-05 通知内容 | overlay 内 `textarea.textarea` | `element.input('集合提前10分钟')` | `onContent`（写 `notice` 草稿） | — | `content` 非空 |
| N-06 通知范围 | overlay 内 picker | `callMethod('onAudience',{detail:{value:1}})` | `onAudience` | — | `audienceKind==='signups'` |
| N-07 勾选报名人 | audience=signups 时 `.list-row` 行 tap | tap | `onToggleSignupTarget` | — | 对应 `signupRows[i].checked` 翻转 |
| N-08 指定车辆 | audience=vehicle 时 picker | `callMethod('onVehicleTarget',{detail:{value:0}})` | `onVehicleTarget` | — | `vehicleIndex` |
| N-09 提交发布 | overlay 内 `.button.primary.block`（content 非空才可点） | tap | `onPublish` | `notice.publish{audience}` | `publishOpen===false`、`message==='通知已发布。'`、列表刷新 |

### 3.5 pages/activity/activity

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| A-01 进入工作台/返回编辑 | `.form-actions >>> .button.primary`（isOwner 分支） | tap | `onWorkspace` | — | draft→editor；否则 workspace |
| A-02 填写报名资料 | `button.button.primary`（canSubmit 分支） | tap | `onSignup` | — | 跳 signup?id |
| A-03 自助按钮 | `.form-actions >>> .button.primary`（canSelfSheet 分支，文案随 stateKey） | tap | `onSelfSheet` | — | `sheetOpen===true` |
| A-04 分享按钮 | `button.button.secondary`（open-type=share） | 真机手动；`onShareAppMessage` 可直接断言返回值（`page.callMethod` 拿不到，需代码审读） | — | — | — |
| A-05 切换查看某人 | `person-row >>> .button`（isPrimary ? '当前查看' : '切换查看'） | tap | `onToggleRow` | `read(activity, selectedSignupId)` | `primaryId` 变化、rows subtitle 刷新 |
| A-06 打开操作 sheet | `person-row >>> .button.text`（「资料与操作」） | tap | `openSheet` | — | `sheetOpen===true`、`canCheckin/canNode/…` 各就位 |
| A-07 节点定位 | `.timeline-item`（data-index） | tap | `onPointLocate` | — | `map.selectedId===index` |
| A-08 节点天气 | checkpoint 行内 `.button.text`（catchtap，文案「天气」） | tap | `onPointWeather` | — | 跳 weather?id&point&date |
| A-09 导航 | start/finish 行或上车点行 `.button.text`（「导航」） | tap | `onOpenLocation` | `wx.openLocation`（automator 外部地图，难断言） | — |
| A-10 天气参考 | 「路线与集合」卡头 `.button.text`（「天气参考」） | tap | `onWeather` | — | 跳 weather?id |
| A-11 活动通知行 | `.list-row`（「活动通知」，!isDraft） | tap | `onNotices` | — | 跳 anotices?id |
| A-12 地图 marker | `map` 组件 | `page.$('map')` 后 automator 对原生 map 事件支持有限；改 `callMethod('onMapMarkerTap',{detail:{markerId:2}})` | `onMapMarkerTap` | — | `map.selectedId===2` |
| A-13 sheet·说明 | overlay 内 `textarea.textarea` | `element.input('已到达起点')` | `onSelNote` | — | `selNote` |
| A-14 签到 | sheet 内「确认已到集合点」（canCheckin） | tap | `onCheckin` | `attendance.checkin`（真实定位；automator 环境定位失败会走 manual 分支——先 A-13 填说明） | `selMessage`、reload 后 `rows[i].subtitle` 含「已签到」 |
| A-15 到家 | sheet 内「确认已安全到家」（canHome） | tap | `onHome` | `attendance.home` | 同上 |
| A-16 节点到达 | sheet 内节点 picker：`callMethod('onSelPoint',{detail:{value:1}})` → 「确认到达此节点」 | tap | `onNode` | `attendance.node` | `selMessage` |
| A-17 报备 | sheet 内报备类型 picker `callMethod('onSelKind',{detail:{value:2}})` → 「提交报备」（说明必填） | tap | `onIncident` | `incident.report` | `selMessage` |
| A-18 位置上报 | 「展开位置上报」→ checkbox：`callMethod('onSelConsent',{detail:{value:true}})` → 「上报当前位置」 | tap | `onPosReport` | `position.report` | `selMessage`；「我的」页出现撤回行 |
| A-19 位置撤回 | sheet 内「撤回位置共享」 | tap | `onPosRevoke` | `position.revoke` | `selMessage` |
| A-20 敏感资料 | sheet 内用途 `input.input` → `.button.text`（「按用途查看」） | input+tap | `onSelPurpose`/`onSensitive` | `readSensitive` | `selSensitive.emergency.name` 非空 |
| A-21 修改此人资料 | sheet 内「修改此人资料」（canEdit） | tap | `onEditRow` | — | 跳 signup?id&signupId |
| A-22 取消报名 | sheet 内「确认取消此人报名」（canCancel，说明必填） | tap | `onCancelRow` | `signup.cancel` | `selMessage`、reload |

### 3.6 pages/signup/signup

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| S-01 用途门槛（编辑模式） | `.input`（修改用途）→ `.button.primary.block` | input+tap | `onPurpose`/`onApprovePurpose` | `readForm`（Result） | `editForm` 非空、`purposeGate===false` |
| S-02 编辑保存 | 编辑表单 `.button.primary.block`（「保存此人的修改」） | tap | `onEditSubmit` | `signup.edit`（+资料回写 `profile.save`/`companion.save`） | redirectTo activity |
| S-03 勾选参与人 | `checkbox-group`（candidates） | `callMethod('onToggleCandidate',{detail:{value:['c:xxx']}})` | `onToggleCandidate` | — | `participants.length` 变化 |
| S-04 参与人卡展开/收起 | 卡头（`bindtap="togglePart"`） | tap | `togglePart` | — | `expandedParts[key]` 翻转 |
| S-05 参与人字段 | 展开卡内 `input.input`/`textarea.textarea`（data-index+data-key） | `element.input()` | `onPartField`（写 `signup` 草稿） | — | `participants[i].person.*` |
| S-06 出行方式 | 参与人卡内 picker | `callMethod('onPartTrip',{detail:{value:1}})` | `onPartTrip` | — | `participants[i].trip` |
| S-07 授权勾选 | 卡内 `checkbox-group`（data-key=dataUse/proxyAuthority/proxyHome） | `callMethod('onPartConsent',{currentTarget:{dataset:{index:i,key:'dataUse'}},detail:{value:['1']}})` | `onPartConsent` | — | `participants[i].consent.dataUse===true`、对应 errors 清除 |
| S-08 同车约束 | 底部 `checkbox-group`（keepTogether） | `callMethod('onKeepTogether',{detail:{value:['1']}})` | `onKeepTogether` | — | `keepTogether` |
| S-09 提交报名 | `.button.primary.block`（「提交报名」） | tap | `onSubmit` | `signup.submit(mode:'apply')` + 资料回写 | redirectTo activity；CAPACITY → `capacityAsk===true` |
| S-10 整组候补 | 候补 callout 内 `.button.secondary.block` | tap | `onWaitlist` | `signup.submit(mode:'waitlist')` | redirectTo activity |

### 3.7 pages/editor/editor

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| E-01 步骤切换 | `.seg` ×3（data-step） | tap | `setStep` | — | `step` |
| E-02 上一步/下一步 | `.form-actions` 内 `.button.text`/`.button.primary` | tap | `prevStep`/`nextStep` | — | `step` |
| E-03 基础字段 | 步骤 1 `input.input`（data-key=title 等）、`textarea.textarea` | `element.input()` | `onField`（persistDraft） | — | `form.*`；`draftSavedAt` 出现 |
| E-04 时间展开 | 出发/结束/截止三行（bindtap=toggleTime） | tap | `toggleTime` | — | `expandedTimes.dt_start===true` |
| E-05 时间选择 | 行展开后 `picker`（mode=date/time） | `callMethod('onDate',{currentTarget:{dataset:{key:'dt_start'}},detail:{value:'2026-10-10'}})`；时间同 `onTime` | `applyTimeEdit` | — | `form.dt_start`；结束/截止自动预填 |
| E-06 快捷估算 | `.chip`（data-kind=data-days） | tap | `onQuickEnd`/`onQuickDeadline` | — | `form.dt_end/dt_deadline` |
| E-07 GPX 导入 | `.button.primary.block`（「导入 GPX 轨迹」） | tap | `onImportGpx` | —（chooseMessageFile 需真机；automator 可直接 `setData` 后 `callMethod('onGpxApply')`） | `gpxOpen`/应用后 `form.points` 替换 |
| E-08 示例路线 | `.button.text`（「用示例路线」，仅无节点时） | tap | `useSampleRoute` | — | `form.points.length===2` |
| E-09 节点增删改 | 「添加路线节点」`.button.secondary.block`；节点卡（收合 tap=togglePoint）；编辑态 `input.input`/picker/移除 | tap / `callMethod('onPointKind',{…})` | `addPoint`/`removePoint`/`onRoutePoint`/`onPointKind`/`choosePointLocation` | — | `form.points` |
| E-10 上车点 | 同上（addPickup/onPickup/onPickupQuickTime chips/choosePickupLocation/removePickup） | tap / callMethod | 对应 handler | — | `form.pickups` |
| E-11 人数/方式 | 步骤 3 `input.input`（capacity）+ picker | `callMethod('onApproval',{detail:{value:1}})` | `onField`/`onApproval` | — | `form.capacity/approvalMode` |
| E-12 开放报名 | `checkbox`（acceptingSignups） | `callMethod('onAccepting',{detail:{value:false}})` | `onAccepting` | — | `form.acceptingSignups` |
| E-13 风险 | 「添加风险提示」/编辑态字段/移除 | tap | `addRisk`/`onRisk`/`removeRisk` | — | `form.risks` |
| E-14 装备费用 | 折叠行 tap=toggleExtras；编辑态 textarea ×3 | tap/input | `toggleExtras`/`onField` | — | `form.equipmentText/feeNote/cancellationNote` |
| E-15 保存草稿 | `.button.secondary`（「保存草稿」，draft 态） | tap | `onSave` | `activity.create`/`activity.edit`（先 `read(profile)` 档案闸门） | `savedId` 非空、`message` callout；缺档案 → `profileGate===true` + 「去我的」按钮 |
| E-16 保存并预览 | `.button.secondary`（「保存并预览」） | tap | `onSavePreview` | 同 E-15 | navigateTo activity?id |
| E-17 发布意图 | `.button.primary.block`（「发布活动」，step2+draft） | tap | `onPublishIntent` | 缺项→`failure` 点名；否则同 E-15 后 `publishOpen===true` | `step` 跳到首个缺项步骤 |
| E-18 发布确认 | 发布 dialog：`checkbox`(participate)、radio、picker、`checkbox`(dataUse)、`.button.primary.block`（确认发布） | tap / `callMethod('onParticipate',{detail:{value:true}})` 等 | `onParticipate`/`onTripChange`/`onTripPickup`/`onDataUse`/`publish` | `activity.publish`（可带 participation） | redirectTo activity；`publishOpen===false` |
| E-19 删除草稿 | 头部 `.button.text`（「删除草稿」）→ dialog `.button.danger.block` | tap | `onDeleteDraftOpen`/`onDeleteDraftConfirm` | `activity.delete`（已存过）或仅清本机 | switchTab home |
| E-20 模板复制 | picker（myActivities）→ `.button.secondary.block` | `callMethod('onTemplatePick',{detail:{value:0}})` + tap | `onTemplatePick`/`onCopyTemplate` | `activity.copy` | redirectTo editor?id=新 id |
| E-21 档案闸门直达 | `.button.secondary.block`（「去『我的』补全资料…」） | tap | `onGoProfile` | — | switchTab me |

### 3.8 pages/workspace/workspace

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| W-01 指标跳区 | `.metric` ×3 | tap | `goRoster/goTransport/goField` | — | `tab` 1/2/3 |
| W-02 Tab 段 | `.seg` ×4（data-tab） | tap | `onTab` | — | `tab`；对应面板 class 无 hide |
| W-03 阶段推进 | 总览 `.button.primary.block`（「进入{下一阶段}」，canTransition 才可点） | tap | `onTransition` | — | `transitionOpen===true` |
| W-04 变更原因 | dialog 内 `textarea.textarea` | `element.input('全员到齐')` | `onReason` | — | `reason` |
| W-05 确认变更 | dialog 内 `.button.primary/danger.block` | tap | `onTransitionConfirm` | `activity.transition` | `transitionOpen===false`、`message`、reload 后 `phaseLabel` 变 |
| W-06 取消活动 | `.button.danger.block`（data-next=cancelled） | tap | `onTransition`（dataset.next） | — | dialog 标题「确认取消活动」 |
| W-07 编辑活动 | `.button.text`（canEdit） | tap | `goEdit` | — | editor?id |
| W-08 参与者视角 | `.button.secondary.block` | tap | `goDetail` | — | activity?id |
| W-09 活动通知 | 总览第 4 行 `.list-row` | tap | `goNotices` | — | anotices?id |

### 3.9 roster-panel（workspace Tab 1 内，或 `page.$('roster-panel')` 穿透）

| ID | 选择器（`roster-panel >>> …`） | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| R-01 搜索 | `.input` | `element.input('张')` | `onSearch` | — | rows 过滤 |
| R-02 状态筛选 | `.roster-filter >>> picker` | `callMethod('onStatus',{detail:{value:1}})` | `onStatus` | — | rows 仅 pending |
| R-03 全选 | 头部 `checkbox-group` | `callMethod('onSelectAll',{detail:{value:['1']}})` | `onSelectAll` | — | `allChecked===true`、`selectedCount===rows.length` |
| R-04 单选 | 行内 `checkbox-group`（data-id） | `callMethod('onSelect',{currentTarget:{dataset:{id}},detail:{value:['1']}})` | `onSelect` | — | `selected[id]` |
| R-05 联络 | 行内 `.button.text`（「联络与资料」） | tap | `onContact` | `readContact`（Result） | `contactOpen`、`contact.phone` |
| R-06 敏感资料 | 联络 sheet：用途 `.input` → `.button.secondary.block` | input+tap | `onPurpose`/`onSensitive` | `readSensitive` | `sensitive` 非空 |
| R-07 修改报名 | 联络 sheet `.button.text`（「按用途修改此人的报名资料」） | tap | `onEditSignup` | — | signup?id&signupId |
| R-08 批量审核 | 勾选后 `.button.secondary`（data-action=confirm/reject/promote/cancel）→ dialog `.button`（确认） | tap | `onBatch`/`onBatchConfirm` | `signup.review`/`signup.promote`/`signup.cancel`（cancel 需 `onBatchReason`） | `selected` 清空、message、reload |
| R-09 导出 | `.button.text`（「导出选中的 N 人」）→ dialog：模式 picker（`onExportMode`）、用途 textarea（`onExportPurpose`）→ `.button.primary.block` | tap/input | `onExportOpen`/`onExportConfirm` | `export.record` + `readExport` → 剪贴板 | `message` 含「已生成」 |
| R-10 同行组切换 | 组行 `.button.text`（允许分车/保持同车，data-id/data-keep） | tap | `onToggleGroup` | `group.setTogether` | loadTransport 后文案翻转 |
| R-11 打开授权 | 卡头 `.button.text`（「协作授权」） | tap | `onAccessOpen` | `readAccess` | `accessOpen===true`、`memberships` |
| R-12 撤销授权 | 授权 sheet 行内 `.button.text`（「撤销」） | tap | `onRevokeMembership` | `membership.revoke` | `loadAccess` 刷新 |
| R-13 授权表单 | 身份码 `.input`（`onMUserId`）、截止日期/时间 picker（`onExpiresDate/Time`）、能力 `checkbox-group`（`onCap`）、车辆 picker（`onVehiclePick`） | input/`callMethod` | 对应 handler | — | 表单 data |
| R-14 ⚠ 角色与范围 picker | 协作角色/可见人员范围两个 picker | **`range` 为空（`roleOptions`/`scopeOptions` 未挂 data，§9.1）**：`callMethod('onRole',{detail:{value:1}})` 可以改 `roleIndex`，但真实用户点不开任何选项 | `onRole`/`onScope` | —（保存走 `onAccessSave` → `membership.save`） | 自动化可绕过 UI 直接 callMethod 驱动；真机用户无法选择「车辆联络」 |
| R-15 用当前勾选 | `.button.text`（「使用当前名单勾选」） | tap | `onUseCurrentSelection` | — | toast |
| R-16 保存授权 | `.button.primary.block`（「保存明确授权」） | tap | `onAccessSave` | `membership.save` | `editingId`、`message`、`loadAccess` |

### 3.10 transport-panel（workspace Tab 2 内）

| ID | 选择器（`transport-panel >>> …`） | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| T-01 添加车辆 | 卡头 `.button.text`（data-id=""，「添加车辆」） | tap | `onEditorOpen` | `readTransport` | `editorOpen===true`、`vform` 空表单 |
| T-02 车辆表单 | sheet 内 `input.input`（data-key=label/plate/legal/blocked/seatLabelsText）、座号 `checkbox`（`onSeatLabelsOn`）、司机类型 picker（`onDriverKind`）、司机字段/人选 picker（`onDriverField/onDriverPick`）、添加/移除司机（`addDriver/removeDriver`）、上车点 `checkbox-group`（`onPickupToggle`） | input/`callMethod` | 对应 handler | — | `vform.*` |
| T-03 保存车辆 | sheet `.button.primary.block`（「保存车辆安排」） | tap | `onVehicleSave` | `vehicle.save` | `editorOpen===false`、`vehicles` 刷新 |
| T-04 预览分车 | `.button.primary.block`（「预览自动分车方案」，有车辆才可点） | tap | `onPreview` | `previewAssignments` | `planOpen===true`、`planCounts` |
| T-05 提交方案 | 方案 sheet `.button.primary.block`（「明确确认并提交此方案」） | tap | `onPlanCommit` | `assignment.commit` | `planOpen===false`、reload |
| T-06 重算 | 方案 sheet `.button.secondary.block` | tap | `onPlanRecompute` | `previewAssignments` | — |
| T-07 指派 | 座位格 `.seat`（data-vehicle/seat/occupant）或乘客行/「安排乘客至此车」 | tap | `openAssign` | — | `assignOpen===true`、`hasCurrent` |
| T-08 确认安排 | 指派 sheet：选人 picker（`onAssignPick`）→ `.button.primary.block` | tap | `onAssignSet` | `assignment.set` | reload |
| T-09 移除安排 | 指派 sheet `.button.text`（hasCurrent 时） | tap | `onAssignRemove` | `assignment.remove` | — |
| T-10 交换 | 交换 picker（`onSwapPick`）→ `.button.secondary.block` | tap | `onSwap` | `assignment.swap` | — |
| T-11 删除车辆 | 车辆卡 `.button.text`（「删除车辆」）→ dialog `.button.danger.block` | tap | `onRemoveAsk`/`onRemoveConfirm` | `vehicle.remove` | `vehicles` 减少 |

### 3.11 field-panel（workspace Tab 3 与 pages/staff 共用）

| ID | 选择器（`field-panel >>> …`） | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| F-01 搜索 | `.input`（查找现场人员） | `element.input('张')` | `onSearch` | `read(activity, perspective)` | rows 过滤 |
| F-02 只看待核实 | `checkbox`（unresolvedOnly） | `callMethod('onUnresolvedOnly',{detail:{value:true}})` | `onUnresolvedOnly` | — | rows 过滤 |
| F-03 打开现场记录 | 行内 `.button.text`（「现场记录」） | tap | `openSheet` | — | `sheetOpen`、`actions[]` 按 phase/权限生成 |
| F-04 核实依据 | sheet 内 `textarea.textarea` | `element.input('电话核实已出发')` | `onNote` | — | `note` |
| F-05 选节点 | sheet 内 picker（pointEnabled 时） | `callMethod('onPoint',{detail:{value:0}})` | `onPoint` | — | `pointIndex` |
| F-06 执行 action | sheet 内 `.button.secondary.block` ×N（data-index，label 见 journeys §7 表） | tap | `onAction` | `attendance.checkin/departure/home/returnPlan/node` 或 `incident.report` | `message`、reload |
| F-07 解决异常 | 异常卡内 `textarea.textarea`（data-id）→ `.button.secondary.block`（「确认本条已解决」） | input+tap | `onResolveNote`/`onResolve` | `incident.resolve` | 卡片变「已核实处理」 |

### 3.12 pages/staff/staff

页面本身只有一个静态头（staff.js 仅存 activityId）；全部交互即 §3.11 field-panel（perspective="staff"）。驱动方式：`mp.reLaunch('/pages/staff/staff?id=<activityId>')` → 同 F-01…F-07。无 staff 授权 → `field-panel >>> status-panel` denied。

### 3.13 pages/vehicle/vehicle

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| V-01 切换去程/返程 | `.seg` ×2（data-leg=outbound/return） | tap | `onLeg` | —（纯前端） | `leg==='return'`、passengers 重渲染 |
| V-02 复制联系 | `person-row >>> .button.text`（「复制联系」） | tap | `onCopyContact` | —（剪贴板） | `message==='联系信息已复制。'` |
| V-03 确认上车 | `person-row >>> .button.secondary`（showBoard 才渲染） | tap | `onBoard` | `attendance.board` | toast、reload 后该人 status=已上车 |
| V-04 发车 | `.form-actions >>> .button.primary`（canOperate 且未 departed） | tap | `onDepart` | `vehicle.depart` | `departed===true` |
| V-05 完成本程 | `.button.secondary`（需已发车） | tap | `onComplete` | `vehicle.complete` | `completed===true` |

### 3.14 pages/weather-hub/weather-hub（Tab 1）

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| WH-01 地图选点 | `.button.primary.block` | tap | `onPickMap` | `wx.chooseLocation`（automator 无法合成；后续可用 `callMethod('goPoint',…)` 不可行——goPoint 非事件式，直接 `mp.navigateTo` weather 页带参替代） | — |
| WH-02 手动经纬度 | `.button.secondary.block`（「输入经纬度」） | tap | `onManualOpen` | — | `manualOpen===true` |
| WH-03 手动字段 | overlay 内 `input.input` ×4（name/lat/lng/ele） | `element.input()` | `onManualName/Lat/Lng/Ele` | — | `manual.*` |
| WH-04 WGS-84 勾选 | `.list-row`（这是 GPS 原始坐标行） | tap | `onManualWgs` | — | `manual.wgs` 翻转 |
| WH-05 保存并查询 | overlay `.button.primary.block` | tap | `onManualSubmit` | —（本地存储；附近去重走 `wx.showModal` 原生，automator 处理不了——测试数据避免 3dp 重复） | 跳 weather?src=local |
| WH-06 GPX 导入 | 卡内 `.button.secondary.block` | tap | `onImportGpx` | — | `gpxOpen` |
| WH-07 存为轨迹点组 | GPX overlay `.button.primary.block` | 先 `page.setData({gpxMeta:…,gpxPoints:…})` 再 tap | `onGpxApply` | —（本地） | `tracks.length+1` |
| WH-08 打开观察点 | 观察点 `.list-row` | tap | `onPointTap` | — | 跳 weather?src=local&lat&lng |
| WH-09 展开/收起轨迹 | 轨迹卡头 `.list-row` | tap | `onTrackToggle` | — | `trackOpen[id]` |
| WH-10 打开轨迹节点 | 展开后节点 `.list-row`（data-set/data-index） | tap | `onTrackNodeTap` | — | 跳 weather?src=local&set&point |
| WH-11 删除 | `.button.text`（catchtap=onDeleteTap，data-type=point/track）→ dialog `.button.danger.block` | tap | `onDeleteTap`/`onDeleteConfirm` | —（本地） | `points/tracks` 减少 |

### 3.15 pages/weather/weather

| ID | 选择器 | 驱动 | handler | 云端效果 | 断言 |
|---|---|---|---|---|---|
| WE-01 切节点 | 「路线关键点」picker（!pointCard 时） | `callMethod('onPoint',{detail:{value:2}})` | `onPoint` | `getWeather`/`getWeatherByPoint`（缓存窗口内不外呼） | `pointIndex===2`、`date` 随抵达日 |
| WE-02 切日期 | 「查看日期」picker | `callMethod('onDate',{detail:{value:'2026-10-11'}})` | `onDate` | 同上 | `date` |
| WE-03 点日卡 | `scroll-view.day-strip >>> .day-card`（data-date） | tap | `onDayTap` | 同上 | 选中卡 `selected` |
| WE-04 图上切日 | `meteogram` 组件事件 | `meteogram` 的 tap 由组件内部 `onTap` → trigger('pickhour')；automator 可 `callMethod('onChartPickHour',{detail:{date:'2026-10-11',t:'14'}})` | `onChartPickHour` | 同上 | `chartSelected` |
| WE-05 全图展示 | `.section-head >>> button.button.text`（「全图展示」） | tap | `onFullscreen` | — | 跳 weather-chart（无数据时 toast） |
| WE-06 展开逐小时 | `.button.text`（展开/收起逐小时数据） | tap | `toggleDetail` | — | `showDetail` 翻转 |
| WE-07 存观察点 | 单点模式点卡 `.button.text`（「存入我的观察点」） | tap | `onSavePoint` | —（本地；去重 modal 原生） | hub 页 `points.length+1` |
| WE-08 生成天气提醒 | owner 时 `.button.secondary.block` | tap | `onDraftNotice` | —（写 notice 草稿） | 跳 anotices?id |
| WE-09 时空图留宿开关 | `space-time >>> .space-time-stay` | tap | 组件内 `onToggleOvernight` | — | 组件 `data.overnight` |
| WE-10 漫游滑块 | `space-time >>> roam-scrubber` | `sc.callMethod('onChanging',{detail:{value:570}})` / `('onToggle')`（drive.js 验证过的模式） | 组件 `onRoamChange/onRoamToggle` | — | 组件 `readout` 更新 |

### 3.16 pages/weather-chart/weather-chart

| ID | 选择器 | 驱动 | handler | 断言 |
|---|---|---|---|---|
| WC-01 模式切换 | `.fc-modes >>> .seg` ×3（data-k=fit/std/big） | tap | `onMode` | `mode`、`hourWidth` 变化 |
| WC-02 关闭 | `button.button.text.fc-close` | tap | `onBack` | navigateBack |
| WC-03 无数据空态 | `status-panel >>> .button.secondary`（「返回」） | tap | `onBack` | — |
| WC-04 点小时读数 | meteogram 事件 | `callMethod('onPickHour',{detail:{date,t}})` | `onPickHour` | `picked` 文案 |

### 3.17 pages/lab/lab（编译模式进入；白名单外 denied）

| ID | 选择器 | 驱动 | handler | 云端效果（trailApiLab） |
|---|---|---|---|---|
| L-01 执行阶段 | 阶段卡 `.button.primary.block`（data-stage，仅 status=ready 渲染） | tap | `onRunStage` | `seed{stage}` |
| L-02 白名单添加 | `.input`（粘贴身份码）→ `.button.secondary`（添加） | input+tap | `onAllowInput`/`onAllowAdd` | `allowlist.add` |
| L-03 白名单移除 | 动态成员行 `.button.text`（「移除」） | tap | `onAllowRemove` | `allowlist.remove` |
| L-04 清理数据 | `.button.danger.block` → 勾选 `checkbox`（`callMethod('onCleanupArm',{detail:{value:true}})`）→ `.button.danger.block` | tap | `onCleanupAsk`/`onCleanupConfirm` | `cleanup` |

### 3.18 pages/privacy/privacy
静态页，无 action。⚠ 无 UI 入口（journeys §9.2），automator 仍可 `mp.reLaunch('/pages/privacy/privacy')` 直达做渲染冒烟。

---

## 4. 可执行旅程骨架（E2E 建议顺序）

> 「演员」（其他openid 的报名/授权/车辆）用 lab 页或 `trailApiLab` 脚本注入；组织者动作走真实页面。每步之间的等待与截图按 §1 约定。

1. **J1 新用户建档**：`reLaunch home` → 断言空态 → `switchTab me` → M-01/M-02 → 断言 `hint==='已保存'`。
2. **J2 组织者建活动**：H-02 → E-03(标题) → E-05(出发) 断言预填 → E-08/E-09(节点) → E-10(上车点) → E-13(风险) → E-15 断言 `savedId` → E-18(发布) 断言落 activity。
3. **J3 参与者报名**（注入演员报名后）：home 卡 A-05/A-06 →（或作为参与者账号）A-02 → S-03/S-05/S-06/S-07 → S-09 断言跳 activity；CAPACITY 分支断言 `capacityAsk` → S-10。
4. **J4 审核→分车→推进**：A-01 → W-02(1) → R-03/R-08(confirm) → W-02(2) → T-01/T-03 → T-04/T-05 → W-02(0) → W-03/W-05(gathering) → W-05(active)。
5. **J5 现场与收尾**：W-02(3) → F-03/F-04/F-06(签到/出发/节点) → 参与者侧 A-14/A-16/A-18 → W-05(closing) → A-15/ F-06(到家) → F-07(解决异常) → W-05(archived) 断言 `canTransition===false`。
6. **J6 车辆联络人**（注入 vehicle_contact membership）：H-06(车辆任务行) → V-01/V-03 → V-04 → V-05。
7. **J7 staff 现场协作**（注入 staff membership）：H-06(协作任务行) → F-01…F-07（staff 视角）。
8. **J8 通知链**：A-11 → N-04…N-09 → 切参与者账号 → notices Tab N-01；weather 页 WE-08 草稿联动断言 anotices `content`。
9. **J9 天气线（不依赖云数据）**：WH-02→WH-03→WH-05 → WE-02/WE-05 → WC-01；`page.setData` 注入 `dayCards` 等可跳过外呼直测渲染（见 AGENTS「数据从哪来」）。

---

## 5. 已知驱动陷阱速查（均在本仓实测过）

1. `mp.screenshot()` 返回 base64 字符串——必须 `Buffer.from(String(raw),'base64')`。
2. 改码后必须 `cli close` + `cli open` 重编译，否则驱动的是旧 bundle。
3. `weather` 页渲染门槛链：`denied==='' && loading===false && loadingWeather===false && dayCards.length>0` 后图表才在 DOM 里，否则 `page.$('space-time')` 为 null。
4. 滚动后元素句柄可能失效：重新 `mp.reLaunch` 或重新 `page.$` 再取。
5. 工作台隐藏面板（`.hide`）先切 Tab 再驱动（§1 策略 6）。
6. picker/checkbox/slider/radio 一律 `callMethod` 合成事件；`wx.showModal`（观察点去重）与 `wx.chooseLocation/chooseMessageFile/getLocation` 系统弹层无法自动化——测试数据要绕开（去重用不相邻坐标；定位用 sheet 内 manual 分支）。
7. `open-type=share/chooseAvatar/getPhoneNumber` 三个 button 的原生行为无法合成，只能真机手测或直接驱动后续 handler。
8. roster-panel 授权表单两个 picker 无数据（§9.1/journeys）——R-14 只能用 `callMethod('onRole',…)` 绕过，且**这只验证自动化路径，不代表真机用户可用**。
