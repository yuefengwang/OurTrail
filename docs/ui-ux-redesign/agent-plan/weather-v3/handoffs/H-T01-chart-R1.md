# H-T01 · R1 → R2（逐时图生成器）

## 产物
- 新增 `miniprogram/utils/weather-v3-hourly-svg.js`
- 新增 `tools/weather-v3-hourly-svg-test.js`

## 验证
- `node tools/weather-v3-hourly-svg-test.js` → 51/0
- `node tools/mutate-weather-v3.js` → 5 条变异里 2 条打在这个文件（列宽、缺值当 0），均被抓到

## 接口
```
buildHourlySvg({ series, cursor, period, node, width }) → { svg, width, height, cell, columns, cursor }
axisLayout() → [{ key,label,unit,top,size,sub? }]
```
- `svg` 是完整 `<svg>` 字符串（调用方自己 encode 成 data URI）。
- 缺值：曲线用同一 path 的多个子路径断开；读数位印 `—`；云带按连续段切块。

## 未验证（UNVERIFIED）
- 72h（3024px）单图解码耗时未测（无开发者工具会话）。阈值 300ms，超了按 §6.5 降级 canvas。
- 真机字形（`font-family` 显式声明仍需肉眼比对；这是 §1.2 第 3 类不参与 1:1 的差异）。

## 回滚
- 删除两个文件；详情组件回退到「无逐时图」即不可用，所以回滚应连同 T02 一起。