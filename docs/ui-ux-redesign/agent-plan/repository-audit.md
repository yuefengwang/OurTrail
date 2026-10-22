# 仓库审计（repository-audit）

基线 `e818e63`（worktree `D:/OurTrail-night-ui-v1`）。门禁基线实测：`node tools/check.js` → ALL CHECKS PASSED（exit 0）；
`node tools/check-handlers.js` → exit 0（存量死 handler 1 条：`pages/editor/editor.js#onNumber`，已登记只许变少）。

## 1. 页面清单（app.json 实测 21 页）

| 路由 | 模块 | 角色 | 核心任务 | 数据来源 | tab |
|---|---|---|---|---|---|
| pages/home | 我的活动 | 全部 | 我的/近期/已结束活动、搜索、待办 | read activities+signups | ✓ |
| pages/notices | 通知 | 全部 | 消息列表、未读、空态 | read notices | ✓ |
| pages/me | 个人 | 全部 | 资料、协作码、授权、入口 | read profile | ✓ |
| pages/activity | 活动详情 | 全部 | 看详情、报名入口、进工作台 | read activity | |
| pages/discover | 发现 | 全部 | 公开活动搜索/筛选/地图 | read activities | |
| pages/signup | 报名 | 参与者 | 同行人/代报/出行方式/提交 | read+dispatch signup | |
| pages/editor | 创建编辑 | 发起人 | 草稿→路线→发布检查 | draft+dispatch activity | |
| pages/routes / route / route-edit | 路线 | 发起人 | 路线库/详情/GPX 编辑 | read routes | |
| pages/workspace | 工作台 | 发起人/协作者 | 名单/审核/分车/行程/任务 | read activity + panels | |
| pages/tasks | 协作任务 | 全员 | 任务清单与状态流转 | read tasks | |
| pages/staff | 现场 | 工作人员 | 签到/上车/返程/确认 | field-panel | |
| pages/vehicle | 车辆 | 司机/乘客 | 清点/发车/返程 | transport 投影 | |
| pages/weather | 天气详情 | 全部 | 逐时/云剖面/天相/OI | getWeather | |
| pages/weather-chart | 横屏图 | 全部 | 全屏图表 | chart-store | |
| pages/weather-hub | 天气入口 | 全部 | 观察点/轨迹/入口 | read+getWeather | ✓ |
| pages/anotices | 活动通知 | 参与者 | 活动范围通知 | notices factory | |
| pages/privacy | 隐私 | 全部 | 权限与隐私说明 | 静态 | |
| pages/lab / pages/cloud-field-poc | 开发 | — | 预演沙盒 / SVG POC | — | **排除出视觉范围**（A2 规定） |

组件 16 目录（含 `privacy-popup` 死代码、`space-time`/`roam-scrubber` 在主工作区已被删除但 HEAD 仍在）。
共享面板：`roster-panel` / `transport-panel` / `field-panel`（sync-key + written 联动，禁动）。

## 2. 冻结集（本夜任何任务禁止修改）

主工作区（`D:/OurTrail`，master）有 **91 处未提交改动**＝用户在途天气线工作（含删除 space-time/roam-scrubber、
新增 cloudfunctions lib 4 个、utils 11 个、tools 20+ 个）。本 worktree 从 `e818e63` 切出，**不含**这些改动；
为避免与在途工作对撞，下列路径在本夜全部冻结（即便它们在本 worktree 里是"干净"的）：

`miniprogram/app.json`、`custom-tab-bar/*`、`components/overlay/*`、`components/space-time/*`、`components/roam-scrubber/*`、
`pages/weather/*`、`pages/weather-hub/*`、`pages/privacy/*`、
`utils/{agenda,api,astro,conditions,evidence-kind,format,meteogram-svg,oi-presentation,outdoor-intelligence,sky,weather-model}.js`、
`cloudfunctions/**`、`tools/**`（只允许**新增**测试文件，不允许改存量）。

⇒ 直接后果：**N5（天气入口）本夜跳过**（weather-hub 在冻结集内）；天气五屏专项只产出差异记录与后续任务书。

## 3. 本夜可写集（候选任务的文件边界）

- N1：`miniprogram/app.wxss`（只增 token/共用类，不改存量语义）、新增 `components/*` 纯展示组件。
- N2：`pages/home/home.{wxml,wxss}`、`components/activity-card/*`。
- N3：`pages/discover/discover.{wxml,wxss}`。
- 三者均**不改**对应 `.js` 的业务取值；仅当展示需要派生布尔时在页面 JS 内加纯展示派生字段（不碰 dispatch/read）。

## 4. 现状视觉基线（D2 截图实测）

全站当前语言＝「深森林绿整幅页头 + 白底 + 文字列表」。home 首屏为占位文字行列表、无摄影卡、无分段控件；
discover 为单张大卡 + 文字列表；activity 已有绿底 hero + 指标行（18.6km/1180m/2h）。
与目标拼板的差距集中在：**列表卡化（摄影图+状态 pill+指标行+人数）**、**分段筛选可见性**、**页头从整幅绿改为白底轻导航**。
