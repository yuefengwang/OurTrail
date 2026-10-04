# OurTrail UI 用户旅程逆向图谱

- **依据**：仅基于当前 HEAD `1acd55e2b063e7a3cc2624491d9ceeb08eb7c112` 的真实代码逆向，未依据产品文档猜测。
- **方法**：逐页精读 `miniprogram/pages/**`（js/wxml/json）、`miniprogram/components/**`、`miniprogram/utils/**`、`cloudfunctions/trailApi/**`（ROUTES / domain commands / permissions / selectors），交叉核对「WXML 选择器 → handler → api.js 调用 → 云函数 action → domain command → 权限 → 页面 data 变化」。
- **未做**：未运行真机、未修改任何业务代码。文档中所有行为均可在代码中定位；带 ⚠ 的是逆向中发现的现存问题（详见 §8）。
- 配套文档：`docs/testing/ui-action-map.md`（miniprogram-automator 可执行 action 与选择器）。

---

## 1. 页面与入口总表（app.json 16 页）

| 页面 | Tab | 唯一/真实入口 | 面向角色 | 读取云函数 action |
|---|---|---|---|---|
| `pages/home/home` | 0 活动 | TabBar | 全部 | `read`(home×3 视角) + `read`(profile) |
| `pages/weather-hub/weather-hub` | 1 天气 | TabBar | 全部 | 无（纯本地 watch-points） |
| `pages/notices/notices` | 2 通知 | TabBar | 全部 | `read`(notices) |
| `pages/me/me` | 3 我的 | TabBar | 全部 | `read`(profile + home/participant) |
| `pages/discover/discover` | — | home 头部「发现活动」 | 全部 | `read`(discover, search) |
| `pages/activity/activity` | — | home 卡片 / discover 卡片 / 通知「查看活动安排」/ 分享卡 | 全部 | `read`(activity, participant) |
| `pages/signup/signup` | — | activity「填写报名资料」/「修改此人资料」/ roster「按用途修改此人的报名资料」 | 参与者/组织者 | `read`(activity+profile)、`readForm` |
| `pages/editor/editor` | — | home「发起活动」/ activity「返回编辑与发布」（草稿）/ workspace「编辑活动」 | 组织者 | `read`(activity, organizer) + `read`(home, organizer) |
| `pages/workspace/workspace` | — | activity「进入工作台」（非草稿所有者） | 组织者 | `read`(activity, organizer) |
| `pages/staff/staff` | — | home「需要我协作」行（goStaff=true） | 现场协作（staff） | `read`(activity, staff)（经 field-panel） |
| `pages/vehicle/vehicle` | — | home「需要我协作」行（goStaff=false）⚠ 双角色用户到不了，见 §8.6 | 车辆联络 | `read`(activity, vehicle) |
| `pages/anotices/anotices` | — | activity「活动通知」行 / workspace「活动通知」/ weather「生成天气提醒草稿」跳转 | 参与者+所有者 | `read`(notices, activityId) [+ `readNoticeManagement`] |
| `pages/weather/weather` | — | weather-hub（3 入口）/ activity「天气参考」「节点·天气」/ 分享（local 模式） | 全部 | `read`(activity) + `getWeather` / `getWeatherByPoint` |
| `pages/weather-chart/weather-chart` | — | weather「全图展示」 | 全部 | 无（读内存 chart-store） |
| `pages/lab/lab` | — | **无 UI 入口**（开发者工具编译模式直达，白名单鉴权在 trailApiLab） | 开发者 | `callFunction`(trailApiLab, inspect/seed/allowlist.*/cleanup) |
| `pages/privacy/privacy` | — | **无存活入口**（唯一入口在已注销的 privacy-popup 死代码里）⚠ §8.2 | — | 无 |

TabBar 为自定义组件 `custom-tab-bar/`（4 项：活动/天气/通知/我的），每个 Tab 页在 `onShow` 里 `getTabBar().setData({selected})` 自报高亮（notices 工厂由 `tabBarIndex: 2` 处理）。

---

## 2. 全局机制（旅程的公共底座）

- **身份**：无登录页。openid 由云函数 `cloud.getWXContext()` 取得；首次访问 `read(profile)` 返回空档案壳（selectors.js:250）。`me` 页展示的「协作身份码」就是 openid，是给协作授权用的唯一凭证。
- **读写漏斗**：所有云调用经 `utils/api.js`（15 处引用的唯一 `wx.cloud` 封装）。
  - 读：`read / readOr`（解包）；`readForm / readTransport / readSensitive / readContact / readExport`（Result 透传 `{ok, value|error}`，页面自检）；`previewAssignments`（永不 reject，转 `{ok:false}`）；`getWeather / getWeatherByPoint`（`status:'ready'|'out_of_range'|'unavailable'`）。
  - 写：`dispatch / dispatchAndSync(payload, expectedRevision, page)` → 云函数 `dispatch` → `reduceCommand`。CAS：revision 不符抛 `CONFLICT`，`dispatchAndSync` 自动调 `page.reload()` 并 toast「安排已被他人更新，已刷新，请重试」。
- **本地草稿**（`utils/draft.js`，wx storage）：编辑器表单（key=`activity-editor`）、报名表（`signup`）、通知内容（`notice`）、「我的」资料（专用键 `ourtrail.draft.me.person.v1`）、最近查看活动 LRU（`ourtrail.opened.v1`，50 条）。⚠ `setOpenId` 全仓无人调用，草稿 key 的 openid 段恒为空串（§8.7）。
- **边缘状态**：所有页面用 `status-panel` 组件渲染 `loading / denied / empty / error` 四态，denied 通常配 `actionLabel`+`bind:action` 重试/回首页。**没有发现任何「loading 永久存在」路径**——每个 fetch 的 `.catch` 都会 `setData({loading:false})`。
- **弹层**：`overlay` 组件（sheet/dialog），遮罩 catchtap + 右上角 X 都触发 `close` 事件；所有宿主都绑了关闭 handler，**没有「无法关闭」的弹层**。原生 `wx.showModal` 仅两处（观察点去重、编辑器无）。

---

## 3. 旅程一：普通用户（访客 / 首次使用）

**起点**：冷启动 → `pages/home/home`（Tab 0）。

### 3.1 首页三视角合并
- `onShow` → `reload()`：并发 `read(home/participant + openedIds)`、`read(home/staff)`、`read(home/vehicle)`、`read(profile)`。
- 能看到什么：头部问候（profileName）、「需要我协作」任务行（仅当某活动 `meta.staff || meta.vehicle`）、筛选段（我的活动/最近查看/已结束）、搜索框、活动卡列表（`activity-card`）。
- 新用户：`cards` 空 → `status-panel` 空态「留一点时间，走进山野」，action「发起一场同行」→ `onEmptyAction` → `onNew` → `navigateTo /pages/editor/editor`。
- 失败：任一 read 失败 → `denied` 面板 + 「重试」（`bind:action="reload"`）。
- 重进：Tab 页 `onShow` 必重读；下拉刷新可用（`enablePullDownRefresh: true`）。

### 3.2 建立本人资料（报名的前置闸门）
入口：Tab 3「我的」。全部选择器见 action-map §me。
- 昵称输入（`type="nickname"`）、手机号手填或 `open-type="getPhoneNumber"`（`onPhoneCode` → `call('getPhoneNumber')` 换号；取消/无权限/隐私未声明/开发者工具各有文案）；头像 `open-type="chooseAvatar"`（`onChooseAvatar` → `wx.cloud.uploadFile` → 存 fileID）。
- 紧急联系人两列 + 健康备注折叠（`toggleMedical`）。
- **自动保存**：输入停止 800ms（`scheduleAutoSave` → `persistPerson({silent:true})`）或 blur。command=`profile.save`。
- 姓名+手机号未齐：不发命令，hint「补全姓名与手机号后自动保存…」，输入仍写本机草稿（`ourtrail.draft.me.person.v1`），`onShow` 时草稿覆盖服务端值（防丢失，me.js:120 注释）。存成功才清草稿。
- 失败：`error` callout 红条（页面顶部），草稿保留。
- 重进：`onShow → reload()`，`mergeDraft` 合并。

### 3.3 发现与查看活动
- home「发现活动」→ `pages/discover`：`read(discover, search)`，只列已发布、未出发、非草稿/取消/归档，最多 50 条。搜索 300ms 防抖重查。点卡 `onOpenCard` → `/pages/activity/activity?id=`。
- 活动详情页（participant 视角）：hero（标题/路线/里程/爬升/已确认）、状态 callout（`detailState` 文案 + 待审核/候补/剩余行）、时间三行、路线地图（有坐标才渲染 `map`，`buildRouteMap`）、时间线节点（checkpoint 有「天气」catchtap，start/finish 有「导航」onOpenLocation→`wx.openLocation`）、上车点行、风险 callout、装备徽标、费用说明、「活动通知」行。
- 主按钮三分支（`form-actions`）：`isOwner`→「进入工作台」；`canSubmit`→「填写报名资料」；`canSelfSheet`→签到/收尾自助按钮；常驻「分享」`open-type="share"`（`onShareAppMessage` path 带 id）。

### 3.4 天气 Tab（无档案要求、纯本地入口）
- `weather-hub`：地图选点（`wx.chooseLocation`，隐私/取消分支有文案）→ `goPoint` → `/pages/weather?src=local&lat&lng[&name&ele&eleSrc]`；手动输入经纬度（overlay 校验 ±90/±180、WGS-84 勾选就地转 GCJ 入库）；GPX 导入（`wx.chooseMessageFile` → `parseGpx` → 预览 → 存为轨迹点组）。
- 查询页三模式（weather.js:1 注释）：activity / local 单点 / local 轨迹组。自由查询可「存入我的观察点」（3dp 去重 modal：替换/并存）与「分享」（URL 只带降精度坐标+日期）。活动模式 `onLoad` 主动 `hideShareMenu`。
- 天气数据：`getWeatherByPoint(lat,lng,date)`（或活动内 `getWeather(activityId,pointId,date)`）；7 日概览条点击切日（缓存窗口内零外呼）；meteogram 点小时 → `onChartPickHour` 切日；「全图展示」→ `weather-chart`（横屏，数据走内存 chart-store，无数据时空态「返回」）。
- 失败面：`out_of_range`（>14 天）→ 空态「暂不展示天气数字」；`unavailable` → 「天气暂不可用」+ 重试 action。

### 3.5 通知 Tab
- `read(notices)`（全局，按 `canReadNotice` 过滤：本人报名相关 / 组织者 / 有效 membership）。
- 未读可「标记已读」（command `notice.read` → reload）；「查看活动安排」→ activity；`owned`（所有者经 `readNoticeManagement` 合并）才有「复制通知」（`wx.setClipboardData` + command `notice.delivery` 记审计）。
- Tab 页永远不显示「发布活动通知」（`canPublish` 只在带 activityId 的 anotices 里经 `loadPublishContext` 置真）。

---

## 4. 旅程二：活动组织者

**起点**：home「发起活动」或已有活动卡 → activity → 「进入工作台」。

### 4.1 创建（editor，三步表单）
- 载入：新建 = `emptyInput`（capacity 24、manual、acceptingSignups true）；编辑 = `read(activity, organizer)`，无 `activity.edit` 权限即 denied「已结束或已取消的活动不能修改…」。本地草稿 `draft.getDraft(id|'new','activity-editor')` **优先于服务端值**。
- 新建且有过往活动：模板复制卡（picker `onTemplatePick` → 「创建模板副本并编辑」command `activity.copy` → `redirectTo editor?id=新id`）。
- 每次改动 `setForm/applyTimeEdit` → `persistDraft`（本机，30s 节流显示「草稿已自动保存 HH:mm」）。出发时间驱动结束/截止预填（quick/custom 标记，editor.js:265）。
- 步骤 2：GPX 导入（隐私声明缺失/超 8MB/解析失败各有 `gpxError` 文案）→ 预览 overlay → `onGpxApply` 替换节点并预填风险/装备；地图选点 `wx.chooseLocation`（失败文案 `pickFailText`）；节点/上车点增删改、快捷集合时间 chips。
- 步骤 3：人数（1–500 校验）、确认方式 picker、开放报名 checkbox、风险增删、装备/费用折叠。
- **保存**（`onSave`/`onSavePreview` → `persistCurrent`）：
  1. capacity 非法 → 跳步骤 3 + failure；
  2. **档案闸门**：`read(profile)` 姓名或手机号为空 → failure + `profileGate` 直达按钮「去『我的』补全资料…」（`onGoProfile` → switchTab，草稿留本机）；
  3. command `activity.create`（savedId 取 `targetIds[0]`）或 `activity.edit`；成功清草稿、`message` callout；`onSavePreview` 再 `navigateTo activity?id=`。
- **删除草稿**（仅 `phase==='draft'` 显示）：dialog → `onDeleteDraftConfirm` → 未存过只清本机草稿；已存过 command `activity.delete`（权限：仅草稿）→ toast → switchTab home。
- **发布**（`onPublishIntent`）：先 `missingForPublish()` 本地预检（缺项跳对应步骤并逐项点名）→ `persistCurrent` → 发布 dialog：可选「我本人也参加」（需独立勾 dataUse；选上车点 radio+picker）→ `publish()` →（参加时先 `read(profile)` 组装 participation）→ command `activity.publish(activityId, participation?)` → 清草稿 → toast → `redirectTo activity?id=`。
- 失败：`failure` callout（发布 overlay 内也有），busy 防重入。

### 4.2 活动详情页（所有者视角）
- participant 视角读取；`isOwner = permittedActions 含 activity.edit`。草稿显示「未发布预览 · 仅你可见」callout + 主按钮「返回编辑与发布」。
- 已发布：主按钮「进入工作台」→ `workspace?id=`。

### 4.3 工作台（workspace，四 Tab 常挂载、类名 `hide` 切换）
- 头部：阶段徽标（草稿/行前准备/正在集合/正在同行/返程报平安/已归档/已取消）+ 副标题随阶段换焦点；三个指标即入口（待审核→名单 / 待分车→分车 / 待签到或待到家→现场）。
- 总览 Tab：当前待办 4 行（跳名单/分车/现场/活动通知）、进程 timeline（5 阶段徽标）、
  - 「进入{下一阶段}」→ `onTransition` dialog → 必填变更原因 → command `activity.transition{next,reason}` → toast + reload。链路：published→gathering→active→closing→archived；「取消活动」（draft/published/gathering，`data-next="cancelled"`）同 dialog（danger 样式）。⚠ 未处理的出发去向/车辆/安全事项会被域层拒绝，错误显示在 dialog 内 `error` callout。
  - 「编辑活动」→ editor；「以参与者视角查看活动」→ activity。
- **名单 Tab**（roster-panel，organizer 视角）：
  - 搜索（姓名/上车点/车辆）+ 状态 picker（全部/待审核/已确认/候补/已拒绝/已取消/已移除）。
  - 每行：勾选（checkbox-group `onSelect`）+「联络与资料」`onContact`（`readContact` Result；电话展示）。
  - 勾选后出现批量区：「确认报名/拒绝报名」(`signup.review`)、「递补候补」(`signup.promote`)、「取消报名」(`signup.cancel`，必填原因 dialog)、「导出选中的 N 人」→ 导出 dialog（普通/敏感 picker + 必填用途）→ command `export.record`（先审计）→ `readExport` → CSV 复制到剪贴板。
  - 同行组列表（`readTransport.groups` 过滤 >1 人）：「允许分车/保持同车」toggle → command `group.setTogether`。
  - 「协作授权」sheet：现有 membership 列表（调整/撤销 `membership.revoke`）；新建表单 = 对方身份码 + 角色 picker + 截止时间(日期+时间 picker) + staff 时可见范围 picker + 能力 7 项 checkbox（roster/checkin/node/incident/position/home/sensitive）+ vehicle_contact 时负责车辆 picker → command `membership.save`。⚠ **角色与范围两个 picker 的 `range` 数据（`roleOptions`/`scopeOptions`）没有挂到 data，picker 是空的**——角色默认 staff，**车辆联络授权在 UI 上无法创建**（§8.1，司机旅程 currently 只能由预演数据/后端注入）。
- **分车 Tab**（transport-panel）：
  - 指标：车辆数/可分配乘客位/待安排。「添加车辆」→ 编辑 sheet（名称/车牌/核载/预留/司机列表[服务司机姓名电话 | 参与者司机=已确认未分车候选 picker]/覆盖上车点 checkbox[必勾≥1]/座号开关+座号串）→ command `vehicle.save`；「删除车辆」dialog → `vehicle.remove`。
  - 「预览自动分车方案」→ `previewAssignments`（Result 型）→ 方案 sheet（新增/调整、移除、未能安排+原因标签）→ 「明确确认并提交此方案」command `assignment.commit`；「按最新状态重新计算」重跑预览。
  - 座位示意（有座号车辆 4+过道网格）点座位 / 无座号列表行 / 「安排乘客至此车」→ 指派 sheet：选人 picker → 「确认安排至此座位/车辆」`assignment.set`；有原安排时「移除此人原有安排」`assignment.remove`、「与另一位已分车人员交换」`assignment.swap`。
- **现场 Tab**（field-panel，perspective=organizer）：见 §7 现场操作。

### 4.4 活动内通知（anotices，所有者）
- 列表合并 `readNoticeManagement`（owner-only）→ 显示投递记录（复制/模拟订阅 × 已复制/模拟成功/失败/未授权）。
- 「发布活动通知」（活动未归档/未取消才显示）→ sheet：内容（草稿 `notice` 键防丢）+ 范围 picker（本活动相关人员/指定报名人员/指定车辆）+ 定向候选（报名人勾选行=organizer 视角 read 的 rows；车辆=readTransport）→ command `notice.publish{audience}` → 清草稿、message「通知已发布。」→ reload。
- 「生成天气提醒草稿」链路：weather 页（isOwner）→ `onDraftNotice` 写 `draft.setDraft(activityId,'notice',…)` → navigateTo anotices → 打开发布 sheet 时自动回填内容。

### 4.5 组织者重进行为
- workspace/activity 均 `onShow → reload`；roster/transport/field 面板 `observers.activityId + attached` 双触发（有 `_loading` 防抖）。
- 编辑器无 `onShow` reload：从预览返回时表单保持内存态，草稿已在本机。

---

## 5. 旅程三：报名参与者（含代报名）

**起点**：分享卡 / discover / home 卡 → activity → 「填写报名资料」（`canSubmit`：participant 视角 + `signup.submit` + detailState==='new'，即已发布+开放报名+未过截止）。

### 5.1 提交报名（signup，new 模式）
- 载入：`read(activity, participant)` + `read(profile)` 并行。门槛 denied：无 `signup.submit` →「活动尚未开放、已截止或没有报名权限…」；本人档案无姓名 →「请先到『我的』保存姓名与联系电话，再来报名。」
- 参与人选择：本人默认勾选；常用同行人 checkbox（`onToggleCandidate`，勾上即装配 participant 并展开）。
- 参与人卡（收合/展开）：资料字段（姓名/电话/紧急联系人/紧急电话/健康备注）、出行方式 picker（自行前往 + 各上车点）、三个授权 checkbox（dataUse 必勾；同行人另需 proxyAuthority；proxyHome 可选授权代确认到家）。空字段自动从「我的」档案回填（`fillFromProfile`，不覆盖已填）。**草稿键 `signup`**，每次改动落盘。
- 校验（`validate`）：姓名/11 位电话/紧急联系人/紧急电话/上车点/dataUse/proxyAuthority；错误就地显示（`errors['p{i}-*']`），勾上授权/补全字段即消失（`clearResolvedErrors` 只清不加）。
- 提交：command `signup.submit{participants[], keepTogether, mode:'apply'}` → 成功后把表单里新填的资料逐条回写档案（`profile.save`/`companion.save` CAS 链，失败不阻塞并如实 toast「…资料同步失败可在『我的』补存」）→ 清草稿 → toast → `redirectTo activity?id=`。
- **名额不足**：`error.code==='CAPACITY'` → `capacityAsk` warning callout「名额不足，是否整组候补？」→「明确同意整组候补」→ `onWaitlist` → `mode:'waitlist'` 重提。
- 失败：`failure` callout；CONFLICT 由 `dispatchAndSync` 自动刷新重试提示。

### 5.2 编辑/取消自己的报名
- 入口 A：activity 页同行人行「资料与操作」→ sheet（见下）；入口 B：工作台名单「联络与资料」→「按用途修改此人的报名资料」→ `/pages/signup?activityId&signupId`。
- **编辑模式有用途门槛**（敏感资料授权语义）：`purposeGate` → 填「修改用途」→「按此用途读取资料」→ `readForm(activityId, signupId, purpose)`（Result；后端 `canReadSensitive` + 本人/代办/所有者校验）→ 表单（授权只读锁定）→「保存此人的修改」→ command `signup.edit{participant, trip, purpose}` → 资料回写档案 → `redirectTo activity?id&signupId`。
- 每次重进都重新要用途（`onShow` 分支），读取失败 `denied`（⚠ 无重试按钮，§8.9）。
- 取消报名：activity sheet 内「本次说明」必填 → command `signup.cancel{signupIds:[选中人], reason}`（权限：owner 或本人/代办）。

### 5.3 活动日自助操作（activity 页 sheet，按 `canXxx` 条件渲染）
选中行 = 本人或代报的报名；`canSelfSheet` 时主按钮直接开 sheet：
| 按钮 | 条件（activity.js:404-423） | command | 失败面 |
|---|---|---|---|
| 确认已到集合点 | gathering（或 active+协调中）且未签到 | `attendance.checkin`（先 `wx.getLocation` gcj02；拒权→退回 manual 需填说明） | selError callout |
| 确认已安全到家 | closing + joined + 未到家（本人或有 proxyHome） | `attendance.home` | 同上 |
| 确认到达此节点 | active + joined（picker 必选） | `attendance.node{pointId}` | 未选节点按钮 disabled |
| 提交报备 | gathering/active/closing + confirmed | `incident.report{kind∈4 类, description=说明必填}` | 未填说明 disabled+提示 |
| 上报当前位置 | 本人 + gathering/active + joined + 勾同意 | `position.report{coordinates, consent}` | 定位失败 selError |
| 撤回位置共享 | permittedActions 含 position.revoke | `position.revoke` | — |
| 按用途查看（敏感） | 有用途即渲染 | **读** `readSensitive`（Result） | error message |
| 修改此人资料 | published + pending/confirmed/waitlisted | （跳 signup 编辑模式） | — |
| 确认取消此人报名 | 同上 + 说明必填 | `signup.cancel` | — |

- 成功统一走 `run()`：busy 防重入 → 成功 `selMessage` callout + 震动 + toast + `reload()`（整页数据刷新，sheet 保持打开）。
- 「我与同行人」列表每行「切换查看」→ `onToggleRow` 换 `selectedSignupId` 重读（主视角切到该人，subtitle 显示其车辆/座位/签到/到家）。

### 5.4 参与者的位置授权回收
- 「我的」页底部「位置授权」卡（来自 home 视角 `meta.positionRows`，仅列出仍有有效上报且可撤回的）：「撤回」→ command `position.revoke` → toast + reload。

---

## 6. 旅程四：司机 / 车辆联络人

代码里「司机」有两层：

### 6.1 参与者兼司机（participant driver）
- 由组织者在分车 Tab 车辆编辑里指派（候选=已确认且未分车，transport.js 域规则同源过滤）；司机不占乘客位（`usable = legal − drivers − blocked`）。
- 他本人的旅程与普通参与者完全一致（签到/节点/到家…）；司机身份只在车辆档案与座位计算中生效，**没有独立的司机操作界面**。

### 6.2 车辆联络人（vehicle_contact membership）——真正的「本车任务」旅程
- **授权来源**：组织者在协作授权里创建 vehicle_contact membership。⚠ §8.1：该角色 UI 上当前创建不出来（roleOptions picker 空）。现存车辆任务数据只能来自预演注入（trailApiLab）或历史数据。
- **唯一入口**：home「需要我协作」任务行（`meta.vehicle` 且非 staff）→ `/pages/vehicle/vehicle?id=`（**不带 vehicleId**，服务端自动挑本人可联络的第一辆车——P0-2 修复，vehicle.js:36 注释）。
- 页面（vehicle 视角 read，`vehicleTask` 投影：车辆 + 乘客含手机号）：
  - 头部：车辆名/车牌/核载算式行。
  - 「去程/返程」segmented（`onLeg`，纯前端切 `leg` 后重渲染）。
  - 应到/已上车计数 + leg 状态（逐人清点后再发车 / 已发车 / 已完成）。
  - 乘客列表（person-row）：「复制联系」（`wx.setClipboardData` 姓名+电话）+ 条件渲染「确认上车」→ command `attendance.board{signupId, leg, boarded:true, note:'本车联系人现场逐人清点'}`（权限：owner 或该车联络人）→ 震动 + toast + reload。
  - 底部（`canOperate`：去程需 gathering/active，返程需 active/closing）：「确认本程发车」`vehicle.depart`（departed 后 disabled）→「完成本程行驶」`vehicle.complete`（需先发车）。
  - 常驻提示「行驶完成不等于参与者安全到家…」；`message` 行 + `error` callout。
- 失败/过期：`vehicleTask` 为空（活动归档/取消或授权过期）→ denied「本车联络授权已结束。」；非联络人 → denied「没有此车辆的联络权限。」
- 重进：`onShow → reload`；返程 segment 状态 `leg` 不持久化，重进回去程。

---

## 7. 旅程五：领队 / 现场工作人员（staff membership）

- **授权来源**：组织者 → 工作台名单 → 协作授权 sheet：粘贴对方「我的」页身份码 + 截止时间 + 可见范围（默认按名单勾选）+ 能力 checkbox → command `membership.save(role:'staff')`。
- **入口**：home「需要我协作」（`meta.staff`）→ `/pages/staff/staff?id=`。页面 = 静态头 + **field-panel（perspective="staff"）**，与工作台现场 Tab 同一组件。
- **可见范围由服务端裁定**（selectors.js:344-346）：staff 视角 rows = 全部报名中 `staffCan(...,'roster',…)` 命中者。⚠ 因此**只授了签到等能力、没授「查看名单」的工作人员会看到空列表**，无法执行被授权的签到（§8.3）。
- field-panel 能做什么（每项都在 `openSheet` 里按 phase × 行状态 × permittedActions 动态生成 action 按钮，统一「逐人核实依据」note，needNote 的必须填）：
  | action | phase/条件 | command |
  |---|---|---|
  | 确认现场签到 | gathering 或 active+协调中，未签到 | `attendance.checkin(manual)` |
  | 核实已随队出发 / 核实未出发 / 标记迟到协调 | gathering 或迟到协调（需 checkin 能力） | `attendance.departure{outcome}` |
  | 核实安全到家 | closing + joined + 未到家 | `attendance.home` |
  | 记录另行返程 / 改回原车返程 | active/closing + joined | `attendance.returnPlan{plan}` |
  | 记录下撤报备 / 记录其他异常 | gathering/active/closing | `incident.report{kind}` |
  | 确认到达此节点 | active + joined（需节点能力，picker 选节点） | `attendance.node` |
  - 每行「现场记录」开 sheet；成功 toast「已保存」+ reload。
  - **异常与处理区**：待跟进异常卡 → 填「处理结果」→「确认本条已解决」→ command `incident.resolve`（需 incident 能力或 owner）。
  - **最后一次主动上报**（仅 `phase==='active'` 渲染）：参与者 `position.report` 的点位（30 分钟过期标「已过时」）；vehicle 视角永远为空。
- 到期/撤销：授权过期后 home 任务行消失（`meta.staff` 依赖有效 membership），staff 页直接 denied「此活动的协作授权不存在或已过期。」
- 说明：**本 App 没有「领队」这一独立角色**——领队语义由「组织者」或被授权的 staff 承担。

---

## 8. 旅程六：管理员 / Staff（全局）——**不存在**

- 全量代码检索结论：权限模型只有四类 actor——`owner`（活动所有者，permissions.js `isOwner`）、`staff`（活动级现场协作）、`vehicle_contact`（活动级车辆联络）、普通参与者（本人/代报）。
- **没有全局管理员、没有后台管理页、没有用户管理面**。`ot_meta/revision` 等系统态只能由云函数内部修改。
- 最接近「管理员」的是 `pages/lab/lab`（开发者预演面板）：仅 `OWNER_OPENIDS`/动态白名单（`trailApiLab` 侧鉴权）可用，能注入演员档案、跑阶段种子、清理 `[预演]` 数据。它不是产品角色，且无 UI 入口（编译模式直达）。

---

## 9. 专项问题清单（逆向发现）

### 9.1 ⚠ 高：协作授权两个 picker 没有数据源——「车辆联络」角色无法创建
- `components/roster-panel/roster-panel.wxml:161,181` 引用 `{{roleOptions}}` / `{{scopeOptions}}`，但 `roster-panel.js` 的 `data` 里**没有**这两个键（JS 里有模块常量 `ROLE_OPTIONS`/`SCOPE_OPTIONS`（roster-panel.js:18-19），从未挂进 data）。
- 后果：授权 sheet 里「协作角色」「可见人员范围」picker 打开是空列表、当前值显示为空白；`roleIndex` 恒 0 → 只能保存 staff 授权；**vehicle_contact（司机联络）授权在 UI 上无法产生**，§6.2 的整个司机旅程目前只能靠预演数据。staff 的可见范围也锁死为「明确选中的人员」。
- 静态门禁为何没拦住：`check.js`/`check-handlers.js` 只校验 handler 与组件注册，不校验 WXML 数据绑定键。

### 9.2 死页面：`pages/privacy/privacy`
- 在 `app.json` 注册，但全站唯一跳转点在 `components/privacy-popup/privacy-popup.js:42,45`——该组件已从 app.json 注销（死代码，文件按决策保留）。**没有任何存活 UI 入口能到达隐私指引页**。若平台要求「隐私指引可查看」，这是缺口。

### 9.3 无入口功能（by design，但需知道）
- `pages/lab/lab`：仅编译模式进入（页面头注释声明）。
- `attendance.board`（上车清点）在组织者的 field-panel 里**没有** action 按钮（field-panel.js openSheet 未生成 board 项）——组织者想代司机点「确认上车」只能去 vehicle 页，而组织者不是 vehicle_contact，`vehicleTask` 为空 → **组织者无法从 UI 完成上车清点**（只能靠权限直通 `attendance.board` 的 owner 语义……但入口没有暴露）。 ⚠ 属于「有权限、无入口」。
- `editor` 里 `activity.copy` 只能以「从我组织过的活动复制」picker 进入；activity 详情页 permittedActions 有 `activity.copy` 但 UI 未暴露第二个入口。

### 9.4 有按钮无 handler / handler 无 API
- `check-handlers.js` 已覆盖「WXML bind* → JS handler」正向；本次逆向**未发现**缺 handler 的绑定。
- 反向（handler 有但 UI 无入口）：`activity.js` `renderView` 写入的 `canCancelRow`/`canEditRow`（activity.js:286-287）**从未被 activity.wxml 使用**（sheet 内实际用的是 `openSheet` 里重算的 `canCancel`/`canEdit`）——死数据键，无行为影响。
- `editor.js` `onQuickEnd/onQuickDeadline` 等全部有 chip 入口；`weather.js` `onClearSearch`？——discover 的 `onClearSearch` 有空态 action 入口；无悬空。

### 9.5 API 成功但 UI 不刷新
- 未发现完全未刷新的写路径：所有 command 成功分支都伴随 `reload()`/`render()`/局部 setData。
- 一处弱刷新：roster-panel「同行组约束」`onToggleGroup` 只调 `loadTransport()`（组列表来自 readTransport），不重读 rows——现状无影响（组约束不影响行渲染），但若未来行内显示组信息会漏。
- `me.js` `persistPerson` 成功后不 `reload()`（本地即真相）——属有意设计；但若另一个设备改了资料，重进靠 `onShow reload` 兜底。

### 9.6 页面返回后状态
- Tab 页全部 `onShow` 重读（home/me/notices/weather-hub）。
- `activity`/`workspace`/`vehicle`/`anotices`/`weather` 均 `onShow → reload`。
- signup 编辑模式的「用途」是一次性会话态（每次进入重填）——隐私设计，非状态丢失。
- editor 返回（从预览）不重读，表单保留内存态且草稿在本机——「保存并预览」后改「我的」资料再回来，编辑器显示的还是旧表单值，重新进入才会读草稿/服务端。轻微。
- ⚠ **双角色用户进不去车辆页**：home 任务行 `goStaff = !!a.meta.staff`（home.js:79-80），同一活动既是 staff 又是车辆联络的用户，任务行只进 staff 页，而 vehicle 页**没有第二个入口** → 其车辆任务（上车清点/发车）在该活动上不可达。

### 9.7 权限与 UI 不一致
- §9.1（想授车联络授不了）与 §7（授了 checkin 没 roster 的 staff 看到空现场面板，无法执行被授权任务——服务端 rows 过滤统一用 `roster` 能力，selectors.js:345）。
- 正向检查（用户看到不该看的入口）：permittedActions 由服务端下发、UI 只做条件渲染，敏感操作（敏感资料、导出、通知管理）都有 purpose/owner 门槛——**未发现**越权可见的入口。

### 9.8 空态 / 错误态 / 加载态盘点
- 每个远端页面均有 `status-panel` 三态 + 失败 `.catch → denied`；**无「永久 loading」路径**（所有 catch 都落 loading:false）。
- 空态文案随上下文变化（home 筛选/搜索、roster 筛选、field 筛选、weather 无坐标节点、weather-hub 无观察点）。
- 弹层关闭：全部 overlay 有遮罩+X 双通道；`wx.showModal` 原生自带。
- 长任务防重入：`busy`/`_saving`/`_loading` 标志普遍存在，重复 tap 安全。

### 9.9 其他小项
- `draft.setOpenId` 无调用方 → 草稿按设备而非账号隔离（key openid 段为空）。微信小程序单设备单账号，影响极小。
- `weather` 页从 `weather-chart` 返回会再跑一次 `reload()`（`_lastResult` 缓存窗口内不外呼），无感但多一次 setData。
- `activity` 分享：草稿态也开放 `open-type="share"`，接收者打开会得到 denied「未发布活动仅所有者可见」（文案正确，无泄漏）。

---

## 10. 云函数 command ↔ UI 交叉表（39 个 command 全部有 UI 来源）

| command | UI 入口（页面 · handler） | 权限（permissions.js） | 失败常见码 |
|---|---|---|---|
| `activity.create` | editor · onSave/onSavePreview/onPublishIntent | 任意登录用户 | VALIDATION（profile 闸门在前端预拦） |
| `activity.edit` | editor · 同上（savedId 存在时） | owner + work | FORBIDDEN |
| `activity.copy` | editor · onCopyTemplate | owner(源) | NOT_FOUND |
| `activity.publish` | editor 发布 dialog · publish | owner（+participation 本人） | VALIDATION/CONFLICT |
| `activity.transition` | workspace · onTransitionConfirm | owner | 业务校验拒绝（VALIDATION） |
| `activity.delete` | editor · onDeleteDraftConfirm | owner + draft | FORBIDDEN |
| `signup.submit` | signup · onSubmit/onWaitlist | personRef 属本人或本人同行人 | CAPACITY |
| `signup.review` | roster · onBatchConfirm(confirm/reject) | owner | — |
| `signup.promote` | roster · onBatchConfirm(promote) | owner | — |
| `signup.cancel` | signup? 否——activity sheet · onCancelRow；roster · onBatch(cancel) | owner 或本人/代办 | — |
| `signup.edit` | signup 编辑模式 · onEditSubmit | owner/own + canReadSensitive | FORBIDDEN/CONSENT_REQUIRED |
| `group.setTogether` | roster · onToggleGroup | owner 或组提交者 | — |
| `vehicle.save` | transport · onVehicleSave | owner | VALIDATION |
| `vehicle.remove` | transport · onRemoveConfirm | owner | 业务约束 |
| `assignment.commit` | transport · onPlanCommit | owner | 容量/约束 |
| `assignment.set/remove/swap` | transport · onAssignSet/onAssignRemove/onSwap | owner | 同上 |
| `membership.save` | roster · onAccessSave | owner | VALIDATION（⚠ UI 缺口 §9.1） |
| `membership.revoke` | roster · onRevokeMembership | owner | — |
| `attendance.checkin` | activity sheet · onCheckin；field-panel · onAction | owner/own/staff(checkin) | — |
| `attendance.board` | vehicle · onBoard | owner 或该车联络人 | FORBIDDEN |
| `attendance.departure` | field-panel · onAction | owner/staff(checkin) | — |
| `attendance.returnPlan` | field-panel · onAction | owner/staff(incident) | — |
| `attendance.node` | activity sheet · onNode；field-panel · onAction | owner/own/staff(node) | — |
| `attendance.home` | activity sheet · onHome；field-panel · onAction | owner/staff(home)/本人/含 proxyHome 代办 | CONSENT_REQUIRED |
| `vehicle.depart/complete` | vehicle · onDepart/onComplete | owner 或该车联络人 | — |
| `position.report` | activity sheet · onPosReport | 本人 | FORBIDDEN |
| `position.revoke` | activity sheet · onPosRevoke；me · onRevoke | 本人/代办/owner | CONSENT_REQUIRED |
| `incident.report` | activity sheet · onIncident；field-panel · onAction | owner/own/staff(incident) | — |
| `incident.resolve` | field-panel · onResolve | owner/staff(incident) | — |
| `notice.publish` | anotices · onPublish | owner | — |
| `notice.read` | notices/anotices · onMarkRead | canReadNotice | FORBIDDEN |
| `notice.delivery` | anotices/notices · onCopy | owner | — |
| `export.record` | roster · onExportConfirm | owner（sensitive 另过 canReadSensitive） | FORBIDDEN |
| `profile.save` | me · persistPerson；signup 资料回写 | 本人 | VALIDATION（姓名+电话硬门槛） |
| `companion.save/remove` | me · onCompanionSave/onRemoveConfirm；signup 回写 | 本人名下 | FORBIDDEN |

独立读 action 与 UI 来源：`read`（全部页面）、`readForm`（signup 编辑）、`readTransport`（roster/transport/anotices 候选）、`readAccess`（roster 授权 sheet）、`readNoticeManagement`（anotices，owner-only）、`readSensitive`（activity/roster sheet）、`readContact`（roster 联络）、`readExport`（roster 导出）、`previewAssignments`（transport 预览）、`getWeather`（weather 活动模式）、`getWeatherByPoint`（weather local 模式）、`getPhoneNumber`（me 一键取号）。`trailApiLab` 的 inspect/seed/allowlist.add/remove/cleanup 仅 lab 页调用。

---

## 11. 自动化视角提示（详见 ui-action-map.md）

- 工作台四个 Tab 用 `display:none` 类切换（workspace.wxss `.hide`）——驱动隐藏面板前必须先点对应 `.seg`，否则 tap 无效。
- picker / checkbox-group / slider 的原生弹层 automator 驱动不了，统一用 `page.callMethod(handler, {detail:{value}})` 合成事件（仓库 `docs/e2e-mp/drive.js` 已验证该模式）。
- 多角色旅程的「演员」由 `trailApiLab` 注入（lab 页或脚本），因为 §9.1 导致 vehicle_contact 无法经 UI 创建。
