# 天气页 V3 图形入口 · 真机（IDE 模拟器）回读 · 2026-10-28

对应 `SYNC.md` 2026-10-28 两条（第一轮品牌条/吸顶/5 类图标；第二轮图形入口补全）。本目录是**第二轮**的设备证据：首页、地点弹层、节点弹层、计划弹层、缓存时效条、沿途提示条、时段步进。

## 环境与新鲜度

| 项 | 值 |
|---|---|
| 工具 | 微信开发者工具（IDE 模拟器，非真物理手机） |
| 服务端口 / 自动化端口 | 33278 / 9427（`cli close --project` → `open --project` 重编译后 `auto`） |
| 视口 | 截图 306×660（IDE 渲染尺寸） |
| 数据 | 真实账号：0 个人计划 / 1 常用地点 / 0 路线（首页读数）；详情经 `goPoint` 进入，服务 Open-Meteo |
| bundle 新鲜度 | 三条自证同时成立：① `.wh-asset-icon` 内出现 `icon` 组件（旧 bundle 只有文字）；② 页头节点行 `pin` 12；③ 时段步进 `["back","next"]`（旧 bundle 是 `back`+`arrow`） |

## 读数（24 项全过；原始记录见 `readings.json`）

| 面 | 断言 | 实测 |
|---|---|---|
| 首页 | 地图选点主键 `pin` | 19×19 |
| 首页 | 两个次入口（经纬度 / GPX）各 1 图 `crosshair` / `upload` | 2 个，16×16 |
| 首页 | 资产行图标砖 | 1 行，砖 38×38、图 18×18（常用地点真实数据） |
| 首页 | 资产行/最近计划右侧 `next`（无文本 `›`） | 1 个 |
| 首页 | 「继续上次」标签 `calendar` | 11×11（`lastPlan` 为夹具） |
| 详情页头 | 节点行 `pin` | 1 个，12×12 |
| 详情页头 | 时段步进 `back` / `next` 一对 | `["back","next"]`，17×17（本轮回读同时是 bundle 新鲜度证据） |
| 地点弹层 | 每行都有图形、无文本箭头 | 真实 1 行 / 1 图，17×17 |
| 地点弹层 | 当前项 `check`、其余 `next` | 夹具两行，图形名逐行回读 `["check","next"]` |
| 节点弹层 | 每行出图（选中 `check` / 其余 `next`） | 2 行 / 2 图，19×19（`nodeOptions` 夹具） |
| 计划弹层 | 已展开（`planOpen` / `sheet.open` 双读数） | `true` / `true` |
| 计划弹层 | 「不改原始记录」带 `lock`，且是 flex 行 | 13×13，`display:flex` |
| 计划弹层 | 出发日期 picker 用 `down`（无文本 `▾`） | 12×12 |
| 缓存时效条 | `cloudoff` + flex 行 | 14×14，`display:flex`（`stale` 夹具） |
| 沿途提示条 | `clock` + flex 行 | 14×14，`display:flex`（`route` 夹具，tabs 沿用真页面四项只翻 selected） |

## 截图

- `A-home-real.png` 首页默认（个人计划 tab，0 计划空态）
- `A3-home-points-real.png` 常用地点 tab（真实 1 条资产行）
- `A2-home-recent-fixture.png` 「继续上次」卡（`lastPlan` 夹具）
- `B-detail-header.png` 详情首屏（页头 pin / 日期条 / 读数条）
- `B2-hourly-scrubber.png` 滚到时段步进（`back` / `next` 成对）
- `C-place-sheet-real.png` 地点弹层（真实列表）
- `C2-place-sheet-check-fixture.png` 地点弹层当前项 `check`（两行夹具，沿用真实行的 key）
- `D-node-sheet-fixture.png` 节点弹层（两节点夹具）
- `E-plan-sheet.png` 计划弹层（`lock` / `down` / 文字箭头已消失）
- `F-stale-banner-fixture.png` 缓存时效条（`cloudoff`）
- `G-route-notice-fixture.png` 沿途提示条（`clock`，四 tab 标签完整）

## 本轮回读抓到并修掉的一处 gap

时段步进原来左键 `back`、右键 `arrow`：一个 chevron 一个带尾箭头，既不对称，也与原型 `icon('back')` + `icon('next')` 不一致。已改为 `back`/`next` 一对 17px，并由 `tools/weather-v3-structure-test.js §2d` 钉住「详情内零 `name="arrow"`」。本目录 `B2` 是改后像素，`readings.json` 里 `stepNames` 是改后回读。

## 边界（如实登记，不当作已完成）

- **真物理手机 NOT_RUN**：全部读数来自 IDE 模拟器。
- **夹具面**：`lastPlan`、地点弹层 `current` 行、`nodeOptions`、`stale`、`route` 为注入夹具；模板与图标组件走真实代码。夹具落地有独立断言（`placeList` 两行且首行 `current` 未被异步刷新覆盖），避免"早注入被覆盖"造成的假绿。
- **计划弹层经 `callMethod('openEdit')` 打开**，不是点按"调整每天的节点与时间"按钮；按钮到弹层的点击链路未在本轮驱动。
- **沿途视图无真实停靠点**（账号无计划）：`G` 截图里是 0 节点夹具，停靠点行内的 14px `next` 只有静态门证据，无真实像素样本。
- **真实账号地点列表延迟加载**：进入详情后 `loadRoutes` 会把列表补到 300 行，本轮在夹具前先等长度稳定，否则会读到 300 个图标（首跑即如此，已修正探针而非页面）。
- 未提交 / 未推送 / 未部署；**本轮**未改 `cloudfunctions/`（工作树里那 12 个改动文件 + 两个未跟踪 `domain/plans.js` 属更早的云层天花板/计划功能工作，部署账在那些轮次）。
