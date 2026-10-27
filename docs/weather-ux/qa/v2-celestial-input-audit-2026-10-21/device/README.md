# 六项收口 · 真机（IDE 模拟器）像素复核（2026-10-21）

- 环境：微信开发者工具模拟器（`cli open` 重编译 + `cli auto` 端口 9425），**真实云端 `trailApi`**，不是物理手机。
- 查询点：理塘 30.0, 100.27 / 4000 m（手填）/ 2026-10-21。
- 驱动：`drive-weather-closeout.js`（页面 + 隐私页截图）、`drive-weather-sky.js`（等 `getSkyContext` 落页后读卡片）。
  两者都从仓库外的 `%LOCALAPPDATA%\Temp\opencode\mp-auto` 运行（`miniprogram-automator` 不在仓库内）。
- 读数：`device-readings.json`、`sky-input-readings.json`；截图：`weather-full.png`、`weather-bottom.png`、
  `weather-sky.png`、`privacy-bottom.png`。

## 1. 这轮证明了什么（VERIFIED）

| 主张 | 证据 |
|---|---|
| 新 bundle 真的在跑（不是旧编译） | 页面上出现仅存在于新代码的「天相条件」区块副标题、「点按复制数据来源与许可链接」、隐私页缓存 TTL 段 |
| 四个增强源真的到页并被消费 | `sky-input-readings.json`：`skyInputLoading:false`、`skyInputNote:""`；星空/银河证据含「夜段观察点上方云量峰值」「CAMS 气溶胶 AOD 0.06」「7Timer 透明度 2/8 / seeing 3/8」「Bortle 4 / SQM 20.82（DarkSkySites.com，模型估算）」「方向为模式粗判」「此方位山脊约 2°」 |
| 总评不再被沉默卡投票 | `condOverall` 69 / ★★★☆☆ / 条件一般；沉默 3 项（晨昏光染、云海、彩虹）不在分数池 |
| 银河“月光偏亮”与星级不打架 | 银河卡 ★★★☆☆，正文写“月光偏亮…不建议抱太大期望”，同时保留「朝西南（约 229 度）找银心带（此方位山脊约 2°）」 |
| 168h 序列不再进 setData | 页面 data 无 `chartSeries` 键（`hasChartSeriesInData:false`） |
| 页脚署名完整 | `weather-bottom.png`：Open-Meteo URL/CC BY 4.0、7Timer 非商业、CAMS 英文原文、Copernicus 版权、DarkSkySites 模型说明、复制来源入口 |
| 隐私 TTL 已上屏 | `privacy-bottom.png`：“天气与方向云约 30 分钟、大气约 3 小时、地形与光污染约 30 天；缓存过期后会重新向数据服务查询” |
| 无运行时异常 | 两份读数的 `errors` 为空 |

**当时的天气是陈旧兜底**：`updatedAt 12:35`，页面顶部显示“实时数据没取到，显示的是 2 小时前的预报”。这是天气主体的 stale 路径（真实云端返回），不影响上述天相增强输入四条证据——它们来自当次 `getSkyContext` 的成功返回。

## 2. 这轮没有证明什么（UNVERIFIED）

1. **不是物理手机**：像素、字体、真机触摸与安全区仍以模拟器为准；模拟器不能替代户外强光/小屏可读性。
2. **配额用尽文案没有上真机**：要触发第 61 次会真实消耗 60 次外部额度；该分支只有 A 层（桩 + 真 index）证据。
3. **`skyInputNote` 的“缺项”分支没有自然样本**：本次四源全 ok，页面上没有缺项行；缺项行由 `weather-page` / `sky-context` 的合成用例覆盖。
4. **客户端未上传**：本证据来自本地工作树 + 模拟器；线上小程序仍是旧版本。

## 3. 复跑

```bash
# 1) 重编译并起自动化（端口按当轮可用端口改）
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" open --project 'D:\OurTrail' --port 33278
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto --project 'D:\OurTrail' --auto-port 9425 --trust-project --port 33278
# 2) 在装有 miniprogram-automator 的临时目录运行
node drive-weather-closeout.js ws://127.0.0.1:9425 '<本目录绝对路径>'
node drive-weather-sky.js ws://127.0.0.1:9425 '<本目录绝对路径>'
```
