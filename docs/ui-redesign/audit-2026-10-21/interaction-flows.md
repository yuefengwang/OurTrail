# 交互流程证据（按时间顺序的真实操作记录）

> 所有步骤均在微信开发者工具模拟器真实执行：文本 = `el.input()`（真实触发 bindinput，已用 `page.data()` 回读验证）；按钮/chip/checkbox = `el.tap()`；弹层按钮从 overlay 面板作用域点击。**未使用任何 `setData` 注入页面数据**。截图路径相对于 `screenshots/`。

## 1. 创建活动全流程（最高优先级，15 张截图）

活动 ID 演变：草稿 `activity-mvhy9mh22pc05m`（create4）→ 草稿 `activity-mvhymvwsnup0ys`（create7）→ **正式发布 `activity-mvhyq03v1zfgrj`（create8，云环境可查）**。

| # | 操作（真实） | 界面结果 | data 回读 | 截图 |
|---|---|---|---|---|
| 1 | `reLaunch /pages/editor/editor` | 空表单第一步 | step=0, isNew=true, missing=5 项 | `activity-create/ACT-CREATE_01_initial.png` |
| 2 | 空表单直接点「下一步」 | **步骤切换不被拦**，进入 step1（发布门只在发布时集中校验） | step=1 | `activity-create/ACT-CREATE_02b_next-no-required.png` |
| 3 | 标题 input「UI审计测试 · 龙泉山轻徒步」 | 标题落位；missing 5→4 | title 已填 | `activity-create/ACT-CREATE_02_title-filled.png` |
| 4 | 点「常用时间建议」第一个 chip「周六 08:00」 | 出发时间填入；**结束/截止自动估算**（16:00 / 10-23 08:00） | dt=2026-10-24 08:00；missing→「至少 1 个集合上车点」 | `activity-create/ACT-CREATE_03_start-suggested.png` |
| 5 | 点「下一步」→ step1「路线与集合」 | 路线卡 + 集合卡 | step=1 | `activity-create/ACT-CREATE_04_step2-route.png` |
| 6 | 点「从路线库选择」 | 路线库 sheet 打开（**共 296 条，只显示最近 40 条**，可搜索） | quickRouteOpen=true | `activity-create/ACT-CREATE_05_route-library-sheet.png` |
| 7 | tap 第一条路线行 → 调 `onQuickRouteClose` 关 sheet | 路线应用（异步）；sheet 需手动/调用关闭——**选中后不自动关**（见 ISS-003） | 关后 step=1 画面干净 | `activity-create/ACT-CREATE_06_step1-route-applied.png` |
| 8 | 点「手动添加」集合点 | 新增上车点卡并展开编辑 | pickups=1 | `activity-create/ACT-CREATE_07_pickup-manual.png` |
| 9 | input「地铁犀浦站A口」+「出站右转 50 米，见蓝色旗帜」 | 集合点名称/地址落位；**publishReady=true** | ready=true | `activity-create/ACT-CREATE_08_pickup-filled.png` |
| 10 | 点步骤条「03 介绍」 | step2 图文页（content-editor：连续 textarea + 添加图片 + 图片组管理 + 封面） | step=2 | `activity-create/ACT-CREATE_21_step3-content.png` |
| 11 | textarea 输入活动介绍 | 「不写正文也能发布」提示消失；字数/段数统计更新 | contentFilled=true | `activity-create/ACT-CREATE_22_content-text.png` |
| 12 | 点步骤条「04 发布」 | step3 名额与可选说明 | step=3 | `activity-create/ACT-CREATE_23_step4-publish.png` |
| 13 | 点「发布活动」 | **发布确认 dialog**：活动名 + 摘要（时间/集合/名额）+「这些还没填，发布后随时可补」（路线名称、≥1 节点、≥1 风险）+「去补上」+「我本人也参加」复选框 +「确认发布」 | publishOpen=true | `activity-create/ACT-CREATE_24_publish-confirm.png` |
| 14 | 从 overlay 作用域点「确认发布」 | 页面销毁跳转（playbook 记载的发布成功标志）→ **落地活动详情** | page destroyed | `activity-create/ACT-CREATE_25_publish-done.png` |
| 15 | （失败对照轮）必填未齐点「发布活动」 | 红色 failure callout「还差：活动名称、出发时间、预计结束时间、报名截止时间、至少 1 个集合上车点。补齐后再发布。」+ 跳回 step0 | failure 文本 | `activity-create/ACT-CREATE_26_publish-validation-failed.png` |

**专项观察（对应任务 §4.2C）**：
- 字段量：step1 仅名称 + 时间；step2 路线/集合点；step3 图文；step4 发布。必填 4+1 类，其余全部「可后补」。
- 可自动生成项已自动：结束/截止/集合时间（ chip 与默认值）；标题（路线名/GPX 文件名，带来源标注）；集合点（路线起点生成，但**地址要手补**，ISS-007）。
- 图片与文字是**清晰分离的两个编辑对象**：文字=一个连续 textarea（空行分段）；图片=按段落锚定的组（单张移除 ×、组级前移/后移/删除收在「管理」、封面单独 sheet 选择）。
- 中断保留：草稿自动持久化（`draftSavedAt` 时间戳显示）；但**发布成功后本地草稿被清**，且重进 editor 不自动恢复云端草稿（需从活动详情「返回编辑与发布」进）——实测两次 `reLaunch` 均得空表单。
- 校验失败可定位性：发布层一次列全缺失项 + 「去补上」直达对应步骤；步骤间不预校验（设计选择，见 ISS-004）。
- **未能捕获**：日期/时间 picker 弹层（tap 后模拟器未弹出可查 DOM 的滚轮，改用 chip 完成）、「添加图片」系统相册、地图选点 `wx.chooseLocation`（见 `evidence/blockers.md`）。

## 2. 报名流程（6 张截图）

| # | 操作 | 结果 | 截图 |
|---|---|---|---|
| 1 | `reLaunch signup`（无参） | denied「找不到此活动。」 | `registration/SIGNUP_01_initial.png` |
| 2 | 草稿活动 id 打开 | denied「活动尚未开放、已截止或没有报名权限。已有安排不会改变。」 | `registration/SIGNUP_02_scroll500.png` |
| 3 | 正式活动 id 打开 | 「这次，和谁同行？」第 1 步：本人（默认勾选）+ 6 个常用同行人候选 | `registration/SIGNUP_05_form-filled.png` |
| 4 | 循环 tap 全部 checkbox（误将本人取消）后点「提交报名」 | 界面**无任何变化/提示**；data.errors 实有 158 条（79 参与人 × 数据授权 + 代报名授权） | `registration/SIGNUP_06_submit-result.png` |
| 5 | 仅确保本人勾选，再点「提交报名」 | 仍无界面提示；errors 同上 | `registration/SIGNUP_07_self-checked.png` / `SIGNUP_08_submit-result2.png` |

> **ISS-001/ISS-011 的直接证据**：第 4/5 步的 `data.errors` 有值而界面零反馈。报名成功态未采到（阻塞 B2）。

## 3. 组织者流程（8 张截图）

| # | 操作 | 结果 | 截图 |
|---|---|---|---|
| 1 | `reLaunch workspace?id=activity-mvb1pkbov4td54` | 工作台完整渲染（指标带/四区/待办/时间轴） | `organizer/WORKSPACE_01_initial.png` + 滚动 ×2 |
| 2 | `tasks?id=` | 任务清单（计数卡/筛选/空态） | `organizer/TASKS_01_initial.png` + 滚动 |
| 3 | `staff?id=` | 现场协作（field-panel） | `organizer/STAFF_01_initial.png` + 滚动 |
| 4 | `vehicle?id=` | denied「没有此车辆的联络权限。」（真实权限态） | `organizer/VEHICLE_01_initial.png` + 滚动 ×2 |

> 首轮用 `?activityId=` 全部 denied「缺少活动编号」——**页面真实参数名是 `id`**（`options.id`），这是审计发现而非产品缺陷。

## 4. 活动详情 tab 交互（3 张）

`reLaunch activity?id=<正式活动>` → 文本匹配 tap 底部 tab：「安全」「路线」「行程」各渲染对应分区。截图 `activity-detail/ACT-DETAIL_14/15/16_tab-*.png`。

## 5. 天气流程（10 + 4 张）

| # | 操作 | 结果 | 截图 |
|---|---|---|---|
| 1 | `reLaunch weather`（无参） | denied「缺少活动编号。」 | `weather/WEATHER_01_initial.png` + 滚动 |
| 2 | `reLaunch weather?lat=30.6737&lng=104.0715&name=成都&ele=500` | **真实云函数取数**：行前参考 + 概率语气免责 + 点卡 + 存入观察点 + 逐时天气 + 全图展示 + 7 日条 | `weather/WEATHER_01~04_*_real-query.png` |
| 3 | hub 点「输入经纬度」→ 4 个 input（名称/纬度/经度/海拔）→「保存并查询」 | dialog 填写 → **跳转 weather 页**（栈：hub→weather） | `weather/WEATHER-HUB_03_manual-dialog.png`、`04_manual-filled.png`、`WEATHER_03~05_from-hub*.png` |
| 4 | weather-chart（chart-store 有数据） | 横屏全图三档模式 | `weather/WEATHER-CHART_01~04` |

## 6. 其他流程

- **路线详情**：`route?id=route-muky6o3kl53fhv` 真实渲染（hero/地图/海拔剖面/分段天气/节点时间轴/风险/管理区）。截图 `other/ROUTE_01~03`。
- **首页空态**：HOME 首屏为「留一点时间，走进山野」空态文案（filter=mine 无数据），滚动后可见 152 张卡（staff/vehicle 视角合并）。
- **ME 自动保存**：未做逐字输入录制（800ms 防抖 + 2 秒「已保存」闪烁，源码确认）；截图 `navigation/ME_01~04`。
