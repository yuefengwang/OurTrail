# 10-20 设计板逐屏裁切（2026-10-26）

来源：`../global-prototype-2026-10-20.jpg`（1024×1536，sha256 前 16 位 `06355e610ef8d2a5`）。

裁切方法：按手机顶部暗边逐行检测 x 区间（`R+G+B < 715` 的连续段），再以行带上沿为锚裁切并放大 3×。每屏都是单机位，无邻屏串入。`01-1-home` 与 `04-5-risk` 右边缘略紧，仍完整包含手机边框。

> 状态：本目录是从设计板派生的工作素材，当前未跟踪。D3 曾定「参考板材不入库」；用户 2026-10-26 已把这张板定为逐屏保真目标，是否入库另行裁决。

## 命名

`<分区>-<屏号>-<主题>.png`。分区与板上的四段一致：`01` 发现、`02` 活动详情、`03` 协作、`04` 天气。

## 索引

| 文件 | 分区 | 屏 | 板上内容 | 对应实现 |
|---|---|---|---|---|
| `01-1-home.png` | 01 发现 | 首页 | 大图品牌头、搜索、分类 chip 行、推荐活动大卡、4 tab（中央 +） | `pages/home` |
| `01-2-discover-list.png` | 01 发现 | 全部活动 | 三个下拉筛选、缩略图行、金额与剩余名额 | `pages/discover`（列表） |
| `01-3-discover-map.png` | 01 发现 | 地图列表 | 全屏地图、悬浮搜索、底部选中卡 + 查看详情 | `pages/discover`（地图） |
| `01-4-discover-filter.png` | 01 发现 | 筛选 | 目的地/日期/难度/交通方式 + 应用 | `pages/discover`（筛选 sheet） |
| `02-1-activity-hero.png` | 02 详情 | 详情首屏 | 全出血封面、信息卡、报名统计、立即报名 + 收藏 | `pages/activity` + `components/activity-hero` |
| `02-2-activity-overview.png` | 02 详情 | 概览 | 概览/行程/装备/费用四段、路线指标、地图、集合点 | `pages/activity`（吸顶锚点） |
| `02-3-route-elevation.png` | 02 详情 | 海拔剖面 | 面积图 + 峰值标注、三项指标、关键节点时间轴 | `components/route-profile` + 路线章 |
| `02-4-itinerary.png` | 02 详情 | 行程安排 | 按天分组（D1…）、地点与照片 | `pages/activity`（行程章） |
| `02-5-equipment.png` | 02 详情 | 装备清单 | 必备/建议分段、勾选行、费用说明、立即报名 | `components/equipment-grid` + 费用章 |
| `03-1-workspace.png` | 03 协作 | 活动协作 | 深绿页头、四段（待办/成员/交通/任务）、出发前检查清单 | `pages/workspace` |
| `03-2-members.png` | 03 协作 | 成员管理 | 已报名/待确认计数、搜索、成员行 + 状态徽章 | `components/roster-panel` |
| `03-3-transport.png` | 03 协作 | 交通安排 | 车辆/剩余座位、车辆卡、添加车辆 | `components/transport-panel` |
| `03-4-tasks.png` | 03 协作 | 任务清单 | 全部/个人/团队、任务行 + 状态胶囊、发布任务 | `pages/tasks` |
| `03-5-notices.png` | 03 协作 | 现场通知 | 人员动态流（头像/时间/正文/图片/查看天气） | `pages/anotices`、`pages/notices` |
| `04-1-weather-hub.png` | 04 天气 | 天气升级 | 活动级页头、出发窗口卡、图、底部 tab | `pages/activity` 天气章（口径见矩阵 C7） |
| `04-2-weather-hourly.png` | 04 天气 | 24 小时预报 | 逐时图标/温度、温度折线、降水柱、降水概率 | `pages/weather` |
| `04-3-route-weather.png` | 04 天气 | 路线天气 | 按路段/时间/海拔、节点时间轴（时间/温度/风） | 无对应屏（矩阵 §3 记「未开始」） |
| `04-4-weather-detail.png` | 04 天气 | 详细数据 | 温度/降水/风速/云量四行、图片来源与更新时间 | `pages/weather`（数字表 + 数据来源） |
| `04-5-risk.png` | 04 天气 | 风险提示 | 预警卡、编号决策建议、查看完整预报 | `pages/activity` 风险章 + 天气页 callout |

`strip-0.png`…`strip-3.png` 是四个分区原比例的整条切片，只用于快速比对版式节奏，不用于逐屏验收。

## 未覆盖页面

设计板只有 19 屏，覆盖 8 个页面（`home` / `discover` / `activity` / `workspace` / `tasks` / `anotices` / `weather` / `weather-hub` 的视觉语言）。其余 13 页（`me`、`notices`、`signup`、`editor`、`routes`、`route`、`route-edit`、`vehicle`、`staff`、`weather-chart`、`lab`、`privacy`、`cloud-field-poc`）没有专属参考屏，只继承全局语言与 L2 组件契约，不能按「逐屏保真」验收。

逐屏差距与冲突裁决见 `../../style-b-fidelity-matrix-2026-10-26.md`；派工方式见 `../../style-b-implementation-taskbook-2026-10-26.md`。
