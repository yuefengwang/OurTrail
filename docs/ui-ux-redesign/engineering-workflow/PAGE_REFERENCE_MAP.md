# PAGE_REFERENCE_MAP — 总览图 ↔ 真实页面映射（night-v2，2026-10-22）

视觉源：`OurTrail_UI_交付包/01_全局视觉参考.png`（21 屏 / 8 区，本会话实读）＋附件天气五屏专图、活动详情 12 段专图。低分辨率区域只取**构图与组织规则**，不抄精确文字/尺寸（任务书 1.1）。

## 1. 映射表（app.json 21 页为基准）

| 真实路由 | 总览图区域 | 设计意图摘要（可读出的） | 实现/重设计状态 | 截图证据 |
|---|---|---|---|---|
| pages/home | 1.1 我的首页 | 搜索+分类 chips+分段+活动卡（封面/标签/指标行） | Wave1 + T002 已对齐 | screens/after/home* |
| pages/discover | 1.2/1.3 | 筛选弹层、地图探索+结果卡 | Wave1 + T003 | wave1-2026-10-20 |
| pages/activity | 1.4 + 专图 B（12 段） | hero+信息卡+图文章节+路线+行程+费用+装备+注意+底栏 | recount 26 + T004 | visual-t004、activity-article-p2p3 |
| pages/signup | 2.1/2.2 | 分步表单、提交态、候补 | T006 | visual-t006 |
| pages/workspace（含 roster/transport/field 面板） | 5.1–5.3 | 工作台首页/报名审核/车辆分配 | T009 | visual-t009 |
| pages/staff | 6.2 | 现场协作面板 | T010 | visual-t010 |
| pages/vehicle | 6.1 | 车辆任务（legState/乘车成员/确认发车） | T010 | visual-t010 |
| pages/tasks | **无设计** | —（10-20 先于设计落地） | 记差异 G-01 | — |
| pages/routes / route / route-edit | 3.1–3.3 | 路线库卡列/详情地图+剖面/编辑关键点 | Wave1 + T008 | visual-t008 |
| pages/editor | 4.1–4.3 | 三步创建（基本信息/路线行程/装备发布） | recount 19 + T007（4 步） | visual-t007 |
| pages/weather-hub | 7.1 | 天气入口（地点+日签+概览） | 冻结 | screens/before/weather-hub |
| pages/weather | 7.2 + 专图 C-2..5 | 统一图表+天相卡 | 冻结（G-02..G-05 记差异） | 历轮 evidence |
| pages/weather-chart | **无设计** | 横屏 SVG | 记差异 G-01 | — |
| **pages/notices** | **8.1 通知中心** | 类型色图标+紧凑行+时间；顶部疑似全部/未读分段 | **本轮试点** | 本夜 before/notices-* |
| **pages/anotices** | 8.1（活动内变体） | 同 8.1 + 发布入口 | **本轮试点** | 本夜 before/anotices-* |
| **pages/me** | **8.2 个人中心** | 头像 hero+昵称+副题、三格统计、分组菜单 | **本轮试点** | 本夜 before/me-* |
| pages/privacy | 8.3 | 说明长文列表 | 冻结（在途） | — |
| pages/lab / cloud-field-poc | — | DEV_ONLY，设计明确排除 | 不做 | — |

## 2. 总览图存在、仓库无实现的能力（记差异，不造）

| 总览图元素 | 区域 | 现状 | 处置 |
|---|---|---|---|
| 菜单「我的足迹」「收藏的路线」「装备清单」「通知设置」「账号设置」「帮助与反馈」 | 8.2 | 无对应数据/功能 | 记差异；night-v1 T011 书同判 |
| 统计「足迹」格 | 8.2 | 无字段（现有 stats=ongoing/finished/organized） | 记差异；不造数 |
| 通知类型色图标 + 全部/未读分段 | 8.1 | 通知模型无 kind 维度暴露到页面；分段无工厂支持 | 记差异；本轮不做（T011 书明令"若工厂提供"才对齐） |
| 天气五屏子页（卫星云图/雷达/风场/气压、星空观测条件页） | 专图 C | 仓库无雷达/风场图层与独立观星页 | 冻结+记差异（G-02..G-05） |
| 活动卡「收藏」心形 | 1.x | 无收藏功能 | 记差异 |

## 3. 反向：仓库存在、总览图未表达

- tasks 页、weather-chart 横屏、profile-gate 补资料 sheet、content-editor 图文编辑、协作码/位置授权/健康备注（me 的 D/F 区）——总览图未画但为真实业务能力，**保留不动**，视觉按 house style 收敛。

## 4. 共享组件与全局样式依赖（试点三页）

- `status-panel`（四态）、`overlay`（sheet/dialog）、`form-field`、`icon`；全局类 `.card/.section-head/.kicker/.page-title/.list-row/.badge/.notice-card/.metrics/.form-actions/.code-text/.avatar-*`（`app.wxss` 实测行号见 DESIGN_SYSTEM.md 引用）。
- tab 页底部留白规则：notices/me 在 tabBar.list ⇒ 各自 wxss 带 `calc(32px + 84px + env(safe-area-inset-bottom))`；anotices 非 tab 页**不带**（两份 wxss 刻意不同，登记于 notices.wxss 注释）。
