# 产品结构与业务流程（以 master `e818e63` 源码为准）

## 1. 信息架构总览

```
OurTrail（零金额 · 熟人圈户外同行履约工具）
│
├─ TabBar（自定义，custom-tab-bar/，4 项，无未读徽标能力）
│  ├─ 活动 HOME ──────► 活动详情 ACT-DETAIL ──► 报名 SIGNUP
│  │                     │  ├─► 工作台 WORKSPACE ─► 任务清单 TASKS / 活动通知 ANOTICES
│  │                     │  ├─► 天气 WEATHER（?id= 活动模式）
│  │                     │  └─► 编辑 ACT-CREATE（草稿「返回编辑与发布」）
│  ├─ 天气 WEATHER-HUB ─► 天气 WEATHER（地图选点/输入经纬度/GPX）
│  │                     └─► 全图 WEATHER-CHART（横屏）
│  ├─ 通知 NOTICES ────► 活动详情 / 发布活动通知 sheet
│  └─ 我的 ME ─────────► 路线库 ROUTES ─► 路线详情 ROUTE ─► 路线编辑 ROUTE-EDIT
│                        └─► 隐私 PRIVACY
│
├─ 现场协作（仅首页协作卡一个入口）
│  ├─ 协作任务 STAFF（field-panel，staff 视角）
│  └─ 本车任务 VEHICLE（车长视角，去程/返程清点）
│
└─ DEV_ONLY（编译模式直达，无站内入口）
   ├─ LAB（预演面板，OWNER_OPENIDS 白名单）
   └─ CLOUD-POC（Cloud Field SVG POC）
```

- 页面注册 21 个（`app.json:2-24`）：home / notices / me / activity / discover / signup / editor / routes / route / route-edit / workspace / tasks / staff / vehicle / weather / weather-chart / weather-hub / anotices / lab / privacy / cloud-field-poc。
- 自定义 TabBar 选中态由各 Tab 页 `onShow` 自报（`data.selected`），无路由自检、无 badge。
- 无全局路由守卫、无 `wx.login`（鉴权全在云函数侧）；隐私经 `__usePrivacyCheck__` + `requiredPrivateInfos`。

## 2. 页面分组与定位

| 组 | 页面 | 一句话定位 |
|---|---|---|
| 主导航 | HOME / WEATHER-HUB / NOTICES / ME | 四个 Tab：与我有关的行动、天气入口、通知、身份中心 |
| 活动流 | DISCOVER / ACT-DETAIL / SIGNUP / ACT-CREATE | 发现 → 读懂 → 报名 → 发起 |
| 组织协作 | WORKSPACE / TASKS / ANOTICES / STAFF / VEHICLE | 阶段推进、名单分车（面板组件）、任务清单、通知、现场/车辆 |
| 天气 | WEATHER / WEATHER-CHART | 查询视图 + 横屏全图 |
| 路线资产 | ROUTES / ROUTE / ROUTE-EDIT | V2.0 独立路线库（活动副产品 → 可复用资产） |
| 其他 | LAB / PRIVACY / CLOUD-POC | 开发者预演 / 静态合规文档 / 渲染 POC |

## 3. 十条核心流程实况

> 判定口径：**完整**＝主要步骤可走通且有截图；**部分实现**＝源码有路径但缺数据/入口/环节；**不存在**＝仓库无此功能。

### F1 打开小程序 → 首页 → 切换主导航 — 完整
冷启动落 HOME（`app.json` pages[0]）；`onShow` 自报 tabBar selected 并 `reload`（并发 3 个 `read({kind:'home'})` participant/staff/vehicle + profile）。Tab 切换经 `custom-tab-bar` `switchTab`。截图：`screenshots/navigation/` 16 张。

### F2 发现/搜索活动 — 完整
HOME「发现活动」→ DISCOVER：列表/地图双态、搜索 300ms 防抖、筛选 sheet（日期从/到/难度）、排序（最新发布/最近出发）、免责 callout（个人发起、平台未做领队资质认证）。截图：`screenshots/discovery/` 4 张（cards=50）。

### F3 打开活动详情 — 完整
入口 11 处（home/me/discover/notices/route/workspace/tasks/signup/editor/roster-panel/分享）。结构：封面 hero + 状态 callout + 主操作行 + 分区锚点横滚 + 10 个分区 + 同行人操作 sheet。截图：`screenshots/activity-detail/` 17 张（含 tab 切换 3 张）。

### F4 创建活动 — 完整（本轮重点，见 interaction-flows.md §3）
HOME「发起活动」→ editor 四步（信息 → 路线与集合 → 介绍 → 发布）。发布门 4+1 类必填，其余可后补；确认层点名待补项 + 「去补上」。**本轮真实发布成功**（`activity-mvhyq03v1zfgrj`）。截图 15 张。

### F5 报名活动 — 部分实现（表单完整；提交成功态未采到）
ACT-DETAIL「填写报名资料」→ SIGNUP：profileGate（缺资料弹微信授权 sheet）→ 第 1 步选参与人（本人 + 常用同行人）→ 参与人卡（5 资料字段 + 出行方式 radio + 上车点 picker + ≤3 consent）→ 第 2 步同车安排 → 固定底栏提交。**提交需逐人勾选数据使用授权 + 代报名授权**；本轮勾选层级未走通，校验失败态已采（`SIGNUP_08`），成功态受阻（见 blockers）。截图 6 张。

### F6 组织者查看名单/审核/分车 — 部分实现（面板在，数据态未采到）
ACT-DETAIL「进入工作台」→ WORKSPACE：总览/名单/分车/现场四区，三个常驻面板组件（roster-panel 审核+导出+协作授权、transport-panel 自动分车+指派+交换+删车、field-panel 现场）。危险操作均有二次确认 + 必填原因。截图 3 张（WORKSPACE）+ 源码确认面板结构。**账号当前活动无报名/车辆数据，名单与分车的有数据态未采到**（VEHICLE 采到权限拒绝态）。

### F7 签到与协作 — 部分实现（无独立签到页）
签到无独立页面，三处实现同发 `attendance.checkin`：①参与者本人（ACT-DETAIL `onCheckin`，`wx.getLocation` 定位签到，失败降级人工+说明）；②组织者/现场协作者代签（field-panel「确认现场签到」，需填依据）；③相关但不同：车长「确认上车」是 `attendance.board`（VEHICLE）。位置共享=**一次性上报 + 授权列表 + 撤回**，无实时追踪（`activity.js:2` 自述）。STAFF 页截图 2 张；签到交互因账号无在场数据未采到。

### F8 查看天气/路线天气/图表 — 完整
WEATHER-HUB（地图选点/输入经纬度/GPX 三种入口 + 观察点/轨迹点组管理）→ WEATHER（activity/local 单点/local 轨迹组三模式；7×24 逐时 + 7 日 + 云层剖面 + OI 机会 + 时空天相 + 时间轴 + 户外总评 + 全字段表）→ WEATHER-CHART（横屏全图，三档列宽）。组织者可「生成天气提醒草稿」跳 ANOTICES。截图 16 张（含成都真实预报）。

### F9 个人中心/资料/授权 — 完整
ME：身份头卡（头像/昵称/统计）→ 最近活动 + 路线库入口 → 同行与安全 → 常用同行人 → 协作码（缩略展示、复制完整值）→ 位置授权撤回。自动保存（停 800ms + blur 兜底）。截图 4 张。

### F10 其他重要流程 — 完整/部分实现
- **通知体系**：NOTICES（全局收件箱 + 发布 sheet：本活动相关人员/指定报名人/指定车辆三种受众）与 ANOTICES（活动内）共用 `utils/notices-page.js` 工厂；站内发布/已读/外部发送是三种记录。截图 NOTICES 4 + ANOTICES 4。
- **路线共享**：ROUTE 详情按对方协作码（身份码）共享；取消共享/删除均有确认 dialog，CONFLICT 就地红字不关层。截图 3 张。
- **天气提醒草稿**：WEATHER → ANOTICES 带草稿（`onDraftNotice`）。
- **复制模板发起**：editor「从过往活动复制」（名称/名额/费用/装备沿用，时间与集合需重确认）。
- **分享落地**：ACT-DETAIL `onShareAppMessage`；WEATHER 分享 URL 只带 3dp 坐标。

## 4. 状态机与文案单源

- 活动阶段/状态词与「下一步」只出自 `utils/journey.js` + `utils/format.js`（架构约束，`tools/journey-graph-test.js` 有门）。
- 四态（denied/loading/empty/error）统一 `<status-panel>`，empty 必须解释「为什么空 + 下一步」；20 页中 16 页在用（`weather-hub` 有登记 DEBT：裸文本空态 + callout 顶替 error）。
- 写命令统一 `api.dispatchAndSync(payload, revision, this)`（CAS）；唯一裸 `dispatch` 是 signup 的 CAS 链（合规例外）。

## 5. 权限与授权模型（实况）

- 服务端投影 `permittedActions` 驱动一切能力位（页面只认布尔，不比较枚举原文）。
- 协作授权：组织者把对方**身份码**（profile.id，即「我的协作码」）填进 roster-panel「协作授权」，发 `membership.save`（role/expiresAt/scope/capabilities）。
- 敏感资料查看必须先填「本次用途」（`readSensitive`）；导出名单需选模式 + 用途。
- 危险操作（取消活动/删车/移除同行/取消报名/删路线/删草稿）统一：文字或次要按钮入口 + overlay dialog 二次确认 + 需后果的地方自陈影响 + 原因必填。
