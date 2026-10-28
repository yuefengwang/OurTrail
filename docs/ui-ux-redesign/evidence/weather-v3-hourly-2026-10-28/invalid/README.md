# 作废帧（不计入证据）

`2026-10-28` 期间同一个证据目录里的失败与探针截图，留档说明它们**不是**本轮结论的依据。

| 文件 | 为什么作废 |
|---|---|
| `probe-home.png` / `probe-detail.png` | 15:25 的探针帧，只用于确认 `page.$('weather-detail')` 拿得到组件与 `goPoint` 生效；`probe-detail.png` 停在「正在查询天气」，不是功能证据。 |
| `gate-failed.png` / `driver-error.png` | 15:27 首跑门槛未过时留下的兜底帧（两张字节相同，都是同一屏）。当时门槛用的是 `dayCards`（那是 `pages/weather` 的概念，V3 详情屏没有），**门槛写错不是页面坏**。 |

## 已作废但**没有**留下图片的一帧（文字读数在此留存）

首跑 26/1，唯一红项是「小时条每格宽 = cell」。当时读出 `hour0.width = 25.4609px`（`hourlyCell` = 12.54），`probe-hour.js` 打出每格 `style="width:px"`——WXML 绑的是 `{{hourCell}}`，组件 data 键是 `hourlyCell`，未定义插值渲染成空 ⇒ 第 0 列被「10/28」文字撑到 25px、其余 23 列塌成 0，屏上标签挤成 `10/2803060912151821`。

那一屏的 `hourly-24-top.png` 在修复后被同名覆盖，**修复前的像素没有留存**；此处只保留文字读数作为来源。修复后同一断言读出 `hour0.width = 12.5391px`，整轮 27/0。
