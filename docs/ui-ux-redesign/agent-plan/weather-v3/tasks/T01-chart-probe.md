# T01 — 逐时五段图 SVG 生成器 + 探针

- 目标：把原型 `hourlyChart()` 变成小程序可用的纯函数 SVG 生成器（42px/列、五段、横滑）。
- 设计输入：实施文档 §5.3 / §6.5 / §10.2；原型 `weather.js` `hourlyChart`。
- 代码阅读范围：`miniprogram/utils/weather-v3.js`、原型 `weather.js` 的 `hourlyChart/hourly`。
- 允许修改：`miniprogram/utils/weather-v3-hourly-svg.js`（新）、`tools/weather-v3-hourly-svg-test.js`（新）。
- 禁止修改：`meteogram-svg.js`、`cloud-field-svg.js`、`pages/weather/*`。
- 前置依赖：M0 契约 §4。
- 步骤：1) 常量与色板；2) 五段几何；3) 缺值断线 + 云带分段；4) 内联样式；5) 门禁。
- 业务不变量：列宽 42；缺值不补 0（铁律 25/31）；文本必须内联 font-family；24/48/72 宽度 = n×42。
- 状态：正常=门禁 51/0；异常=宽度或断线断言失败即停。
- 测试：`node tools/weather-v3-hourly-svg-test.js` → 51/0。
- 视觉验收：**NOT_RUN**（真机解码耗时未测；§12 R1 仍开着）。
- 回滚：删除两个新文件。
- 完成定义：`git diff --stat` 只含这两个文件。

> 真机探针（P0）未执行：本轮没有开发者工具自动化会话。若测出 72h 解码 >300ms，按 §6.5 降级 canvas（`components/meteogram` 路径）。