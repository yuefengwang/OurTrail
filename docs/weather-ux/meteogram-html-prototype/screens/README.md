# Screens Manifest —— 截图留档说明

本目录存档 Weather V2 全部视觉验证截图（真实页面渲染，非手绘）。
命名规则：`[阶段前缀]-[地点]-[horizon]-[宽度].png`；`.svg` 为与小程序 `<image>`
逐字节一致的源图（即截图的直接来源）。

## 1. 原型迭代史（screens/v1–v6/）

| 目录 | 内容 |
|---|---|
| `v1/` | HTML 原型 V1（初版三面板） |
| `v2/` | V2（单图化/选中牌/事件道） |
| `v3/` | V3（去标题条/云层包络/事件道去甘特） |
| `v4/` | V4（Cloud Field 等值带） |
| `v5/` | V5（密度渐变收口） |
| `v6/` | V6（2D cloudCover(time,alt) 场，strip 栅格） |

根目录 `375-*.png` `390-full.png` `414-full.png` `desktop-430.png` 为 **V7 isoband**
最终原型（`375-debug-cloudfield.png` = 纯云场 debug 视图）。

## 2. 小程序迁移 POC（mp-poc-*）

| 文件 | 内容 |
|---|---|
| `mp-poc-mock-375.svg` | POC renderer（utils/cloud-field-svg.js）输出的云场（mock）|
| `mp-poc-emeishan-375.png/.svg` | 峨眉山冻结真实数据 · 采样点叠加 |
| `mp-poc-litang-375.png/.svg` | 理塘冻结真实数据 |
| `mp-poc-emeishan-390/414.png` | 390/414 宽度验证 |

## 3. 生产管线真实数据（prod-* / real-*）

| 文件 | 内容 |
|---|---|
| `real-litang-debug/full.png` · `real-litang-samples.png` | Phase 前真实数据取证（含原始采样点叠加）|
| `real-emeishan-debug/full/samples.png` | 峨眉山 3079m 真实预报（等值带/完整页/采样点）|
| `real-chengdu-debug.png` · `real-daocheng-debug.png` | 成都 500m / 稻城 3800m |
| `prod-litang-375.png` 等 | 生产函数（W.buildCloudLevels）管线验证 |

## 4. OI 机会卡（oi-*）

| 文件 | 内容 |
|---|---|
| `oi-emeishan-375.png` | 峨眉山（多机会日：银河/彩虹/远眺/入云 + 看图↗ + 选中态「看图 · 02:00」）|
| `oi-litang-375/390.png` | 理塘（两机会日 + 跨零点银河双段时间轴）|
| `oi-chengdu-375.png` | 成都（沉默日：仅天文窗口，天气类零硬造）|
| `oi-*-390/414.svg` | 390/414 宽度源图 |

## 5. 48/72h Multi-Day Horizon（horizon-*）

Phase 4 真实预报，三地点 × 24/48/72：

| 文件 | 内容 |
|---|---|
| `horizon-litang-24/48/72-375.png/.svg` | 理塘 3500m：24h 分析 / 48h 比较 / 72h 趋势 |
| `horizon-emeishan-24/48/72-375.png` | 峨眉山 3079m（72h 含 Day3 午后对流塔）|
| `horizon-chengdu-24/48/72-375.png` | 成都 500m（三日晴 → 沉默对照）|
| `horizon-litang-72-390/414.png` · `horizon-emeishan-48-390.png` | 宽度组合 |

要点（看图时对照）：day header 每日 hi/lo 彩色标注 · 日界强线 · 云场连续跨日 ·
YOU · 3,500m 单次贯穿 · 风箭头密度 1h→2h/3h · crosshair 日期牌「明天 14:00」。

## 6. 历史验证取证（Phase 1–2 遗留）

`real-*-debug/samples/full.png`（见 §3）与 `oi-*` 之外，根目录另有
`375-default.png`（默认无选中态）可对照选中交互差异。

—— 总计 27 PNG + 49 SVG。所有 SVG 可直接在浏览器打开（与小程序 `<image>` 渲染
同一字符串），PNG 为其栅格化结果。
