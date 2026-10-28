# T03 — 首页两屏 + 深链归属

- 目标：`weather-hub` 变两屏宿主（屏 1 选源首页、屏 2 详情），底栏常驻；GPX/经纬度/地图三条入口行为不变。
- 允许修改：`miniprogram/pages/weather-hub/*`。
- 禁止修改：详情组件内部；`pages/weather/*`（本轮保留旧页）。
- 前置依赖：T02 可用版本。
- 步骤：1) 屏内 state；2) 资产三 tab（计划/地点/路线）；3) 地点装配（点/路线/轨迹）；4) 地点切换弹层；5) 保留 GPX 预览逐条行为。
- 业务不变量：`switchTab` 不能带参 ⇒ 上下文走内存；GPX 保存用预览保留点（`weather-hub-gpx-test` 23 条一字未改）；tab 页底部留白 84px+安全区。
- 测试：`node tools/page2-gates-test.js`（119）、`tools/weather-hub-gpx-test.js`（23）、`tools/journey-graph-test.js`（15）、`tools/b4-pad-final-value-test.js`（33）。
- 视觉验收：NOT_RUN。
- 已知偏差：深链页仍是旧长页（README 偏差 1）。