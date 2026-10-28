# T02 — 共享详情单元（四视图外壳）

- 目标：一份实现，两个宿主可用；外壳 + 四视图 tab + 读数/图例/滑块 + 六态。
- 设计输入：§5.2–§5.6、§6.1–§6.4、§16.5 契约。
- 代码阅读范围：`utils/{format,astro,sky,conditions,weather-cloud-field,meteogram-svg,weather-cache,draft}.js`、`components/{overlay,icon}`。
- 允许修改：`miniprogram/components/weather-detail/*`、`miniprogram/utils/weather-v3.js`、`weather-v3-view.js`（均新增）。
- 禁止修改：`pages/weather-hub/*`（R3）、`pages/weather/*`、云端。
- 前置依赖：T01 的生成器签名。
- 步骤：1) 状态机与窗口切片；2) 装配纯函数；3) WXML 四视图；4) 皮肤 wxss；5) 弹层（节点/帮助/计划）。
- 业务不变量：四视图共享地点/节点/日期/小时；缺值印「—」；云层整图复用生产统一图；日月三态；客观时刻不被天气裁掉。
- 测试：`node tools/weather-v3-structure-test.js`（79）、`node tools/scenario-weather-v3-test.js`（49）。
- 视觉验收：NOT_RUN。
- 完成定义：`check.js` + `check-handlers.js weather-detail` 全过；结构门 79/0。