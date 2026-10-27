# OurTrail 全页面截图归档

`app.json` 中登记的全部 **20 个页面**的模拟器截图，以及一张拼好的总览图。

- **总览图**：[ourtrail-all-pages-2026-10-20.png](ourtrail-all-pages-2026-10-20.png)（1385 × 4892）
- **单页原图**：[2026-10-20/](2026-10-20/)（20 张 PNG + `manifest.json`）
- **实拍日期**：2026-10-20
- **实拍环境**：微信开发者工具模拟器；竖屏 **306 × 660**，横屏 **558 × 258**
- **驱动方式**：`miniprogram-automator`，逐页 `reLaunch` 后截图；天气图表由天气页「全图展示」按钮真实点入

## 页面清单

| # | 页面 | 路由 | 本次状态 |
|---|---|---|---|
| 01 | 活动首页 | `/pages/home/home` | Tab；151 张活动卡 |
| 02 | 天气入口 | `/pages/weather-hub/weather-hub` | Tab；1 个观察点 / 1 条轨迹 |
| 03 | 通知 | `/pages/notices/notices` | Tab；668 条通知 |
| 04 | 我的 | `/pages/me/me` | Tab；资料与统计 |
| 05 | 发现活动 | `/pages/discover/discover` | 50 个公开活动 |
| 06 | 活动详情 | `/pages/activity/activity?id=activity-mvb1pkbov4td54` | 组织者视角；集合阶段 |
| 07 | 报名 | `/pages/signup/signup?id=activity-muzgu3qdnx7wkq` | 新报名表单（未来活动） |
| 08 | 编辑活动 | `/pages/editor/editor?id=activity-mvb1pkbov4td54` | 已有活动编辑，第 1 / 3 步 |
| 09 | 活动通知 | `/pages/anotices/anotices?id=activity-mvb1pkbov4td54` | 5 条通知 |
| 10 | 路线库 | `/pages/routes/routes` | 293 条路线 |
| 11 | 路线详情 | `/pages/route/route?id=route-muky9hnjzbhg1t` | 真实 GPX 沉淀路线 |
| 12 | 路线编辑器 | `/pages/route-edit/route-edit?id=route-muky9hnjzbhg1t` | 已有路线编辑 |
| 13 | 组织者工作台 | `/pages/workspace/workspace?id=activity-mvb1pkbov4td54` | 正在集合；三面板数据 |
| 14 | 领队现场 | `/pages/staff/staff?id=activity-mvb1pkbov4td54` | **当前账号无协作授权**，不可用态 |
| 15 | 车辆联络 | `/pages/vehicle/vehicle?id=activity-mutw5e6lnsllvt` | 服务端解析出 1号车 / 川A·GP001 |
| 16 | 天气详情 | 单点：赵公山 30.9124, 103.4562, 1600 m | 本地模式；7 天 / 168 小时 |
| 17 | 全图展示（横屏） | `/pages/weather-chart/weather-chart` | 7 天连续剖面；横屏视口 |
| 18 | 预演实验室（开发者） | `/pages/lab/lab` | 只读打开，**未执行任何阶段** |
| 19 | 云场渲染验证页（开发者） | `/pages/cloud-field-poc/cloud-field-poc` | 内置 mock 数据集 |
| 20 | 隐私保护指引 | `/pages/privacy/privacy` | 静态文档 |

## 数据口径

- 除开发者页外，均为当前登录账号看到的**真实云端数据**；活动、报名、工作台、车辆、路线、通知各自带上了对应 id（见上表与 `manifest.json`）。
- 天气详情采用**单点模式**：现有活动日期超出 Open-Meteo 的 14 天预报窗，活动模式会如实显示「超出预报范围」，无法呈现图表内容。
- 「全图展示」是从天气页点击真实按钮进入的横屏页；截图左侧黑条是横屏模拟器的刘海区域，不是页面控件。
- `staff` 页的不可用态来自账号确实没有该活动的协作授权，不是加载失败或网络错误。
- 开发者页只作界面影棚使用：`lab` 仅打开观察，未点「执行本阶段」；`cloud-field-poc` 使用页面内置 mock，未触发实时请求。

## 证据边界

- 每页只截**首屏**，不是整页长图；首屏之外的内容不在本归档内。
- 截图用于界面盘点与排版核对，**不构成 UI PASS、交互验证或回归结论**。本轮没有逐页执行点击/输入断言。
- 本轮未改源码；模拟器 bundle 未与 HEAD 做逐字新鲜度核验，因此不能拿这组图证明「当前 HEAD 的渲染结果」。
- 这是 M4 视觉证据的一部分；任何「修复后正常」或「功能可用」的结论仍需对应的真机交互与读数。

## 文件约定

```
docs/ui-snapshots/
├── README.md
├── ourtrail-all-pages-2026-10-20.png   # 拼图总览
└── 2026-10-20/
    ├── 01-home.png
    ├── ...
    ├── 20-cloud-field-poc.png
    └── manifest.json                   # 页面名、路由、状态说明、图片尺寸
```
