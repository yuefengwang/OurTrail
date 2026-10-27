# 天相输入缺口 · B+C 数据路径评估

> **Status 2026-10-21**：本计划的 Slice 2–5 已实现并**部署 trailApi**（首次 29 files / 129.4 KB；修复 `null` 海拔后二次部署 29 files / 129.5 KB，Active / timeout 20）；`DARKSKY_API_KEY` 已配置并线上验证四源全 ok。页面数据级验证见 `live-verify-2026-10-21.json`；精度核对见 `precision-report.md`；工程侧条款对齐见 `legal-review.md`（**不是法律意见**）。**客户端版本尚未上传**：透明度/署名/隐私页/`app.json` 只在工作树与开发者工具模拟器生效；像素截图/真机 UI 仍 UNVERIFIED。代码与门禁见 `SYNC.md` 同日条目与 `tools/{spatial,terrain,atmosphere,light-pollution,sky-context}-test.js`。

- 日期：2026-10-21
- 关联：`docs/weather-ux/qa/v2-celestial-input-audit-2026-10-21/README.md`
- 目标：不再靠调阈值硬撑结论；为每个缺失输入找**可落地的数据路径**，并标明许可、覆盖、成本和失败降级。
- 实测方式：直接调用候选 API（Open-Meteo / 7Timer! / RainViewer / Open-Meteo Elevation），记录返回字段与请求上限；未使用任何生产密钥。

---

## 0. 结论先行

把缺失输入分成四类，优先级从高到低：

| 类别 | 输入 | 路径 | 是否要新数据源 | 是否要改云函数 |
|---|---|---|---|---|
| **A. 可计算** | 月亮高度/方位/月出月落、银心高度/方位、低云按高度、跨夜窗口 | 纯天文/几何计算 | 否 | 否（客户端 `astro.js/sky.js`） |
| **B. 同源可补** | 气压层温度/湿度（逆温）、总云量、PBLH、850 hPa 风、方向云/降水网格、集合云概率 | Open-Meteo 现有 provider 扩展 | 否（同一 API） | 是（`lib/weather.js` + 重部署） |
| **C. 外部数据** | seeing/transparency、AOD/PM2.5、地形/地平线/谷地、光污染 | 7Timer!、Open-Meteo Air Quality、Open-Meteo Elevation（Copernicus DEM）、DarkSkySites/VIIRS | 是 | 是（新 action 或扩展现有 action） |
| **D. 产品输入** | 目标山峰、观测地类型（城市/郊野/荒野） | 用户在地图上点选目标 / 选择天空质量档 | 否 | 客户端 + 可选服务端 |

**推荐顺序**：A（先把天文量算对）→ B（同源温湿/方向网格）→ C（7Timer + DEM + 光污染）→ D（目标山峰/用户档位）。A 不是可选项，而是 B/C 的数据进入后不至于再次被 `null → 0` 吞掉的必要条件。

---

## 1. 逐项输入 → 候选源

### 1.1 月亮高度/方位/月出月落

- **路径**：纯计算，不需要新数据。
- **输入**：日期 + 时刻 + 经纬度（已有）。
- **做法**：在 `astro.js` 增加月球位置（低精度 Meeus/ELP 简化式即可），输出 `altitude/azimuth/rise/set`；月照评分改为 `illumination × 是否在地平线上 × 高度`，并计算与银心的角距。
- **精度**：低精度月球公式在 0.1–0.3° 量级，足够判断“月亮在不在天上、离银心多远”；不需要星历级。
- **成本**：客户端纯函数；改 `astro.js` + `sky.js` + 测试；无需重部署。
- **风险**：现有测试把月相行为钉住了，需要新增用例而不是改旧断言。

### 1.2 银心高度/方位

- **路径**：纯计算，不需要新数据。
- **输入**：日期 + 时刻 + 经纬度（已有）。
- **做法**：银心赤经/赤纬近似固定（RA ≈ 17h45m40s，Dec ≈ -29°00′28″），用地方恒星时换算成 `alt/az`；`galaxySeason` 改为“银心在夜间高于地平线”的动态判断，而不是月份硬编码。
- **收益**：直接修掉当前 `galaxyBearing(date, hour)` 忽略经纬度、忽略时区的问题（`astro.js:221-241`）。
- **成本**：客户端纯函数；改 `astro.js` + `test/astro-test.js`；无需重部署。
- **备注**：这会推翻 `astro.js:218-223` 的“经验曲线、不是星历”决定；需要产品裁决和测试更新。若暂不想上星历，至少先做**经度时差修正**（北京时间 → 当地太阳时）并加“银心高度 > 0”闸。

### 1.3 低云按高度参与星空/银河

- **路径**：现有 `cloudLevels`（22 层云量/位势高度）已经返回（`cloudfunctions/trailApi/lib/weather.js:203-235`），只是 `sky.js` 没用。
- **做法**：对每个小时，找出观察点海拔之上的最低云层；如果低云在观察点上方，计入星空遮挡；如果在脚下，不计入天顶遮挡，但可作为地平线/光污染的辅助。
- **成本**：客户端纯函数；改 `sky.js` + `cloud-layer-facts.js`；无需重部署。
- **风险**：`cloudLevels` 的 22 层是模式层，层间有间隙；需要明确“层间无数据”与“无云”的区别，不能把缺测当晴空。

### 1.4 跨夜窗口

- **路径**：现有 `series` 已含 7 天逐时数据，不需要新数据。
- **做法**：把“今晚”定义为所选日 `astroDusk` → 次日 `astroDawn`；从 `series` 取次日 00:00–04:xx；卡片文案区分“前夜尾段”和“当夜后半夜”；图表与结论卡共用同一窗口。
- **成本**：客户端；改 `weather.js` 的 `detail` 切法 + `sky.nightHours` 接口；无需重部署。
- **风险**：现有 `sky.summarize` 的 `detail` 契约是“所选自然日 24h”，要改成“夜窗口 24h”或新增 `nightDetail`；会牵动 `conditions.factsFor` 的 anchor。

### 1.5 气压层温度/湿度（逆温、云海）

- **路径**：Open-Meteo 同一 provider 扩展。
- **实测**：以下变量在 30°N, 103°E 返回正常数据：
  - `temperature_850hPa`, `relative_humidity_850hPa`
  - `temperature_925hPa`, `relative_humidity_925hPa`
  - `temperature_700hPa`, `relative_humidity_700hPa`
- **做法**：在 `HOURLY` 增加 925/850/700 的温度与 RH；在 `hourView` 增加 `profile` 字段（或平铺 `t925/rh925/...`）。用“地面温度 vs 925/850 温度”判断逆温/稳定层；用低层 RH 判断湿层。
- **成本**：改 `cloudfunctions/trailApi/lib/weather.js` + `trailApiLab` 同步 + 重部署；返回体每 24h 增加约 1–2KB。
- **风险**：模式地形与真实地形差异；逆温判据需要与实况校验，不能只凭单点廓线断言“云海”。

### 1.6 方向云 / 方向降水（银河、彩虹）

- **路径**：Open-Meteo 同源多点采样。
- **实测**：一次请求 25 个坐标（5×5，0.2° 间距）正常返回 25 个对象，含逐时 `cloud_cover_low/mid/high` 与 `precipitation`，响应约 30KB。
- **做法**：
  - 以查询点为中心，取 8 个方位 × 2–3 个距离（例如 5/15/30 km），请求 `cloud_cover_low/mid/high`、`precipitation`、`precipitation_probability`。
  - 对银河：把银心方位插值到最近的两个方位，判断该方向的中低云。
  - 对彩虹：沿反日点方位取 2–3 个点，判断那里是否有降水；再叠加观察点的太阳高度与太阳可见性。
- **成本**：云函数一次额外请求（或多坐标一次请求）；缓存 30 min；返回体只回聚合后的方向摘要，不回 25 条完整序列。
- **风险**：Open-Meteo 中国区是 GFS GRAPES Global 约 15 km（实测文档口径），0.2° 网格接近模式分辨率；这是“方向上的粗判”，不是雷达。必须标明“方向云为模式插值，不是实况”。

### 1.7 seeing / transparency（星空、银河）

- **路径**：7Timer! ASTRO 产品。
- **实测**：`https://www.7timer.info/bin/astro.php?lon=103&lat=30&ac=0&unit=metric&output=json&tzshift=0` 返回：
  - `cloudcover`（1–9 okta）
  - `seeing`（1–8，1=<0.5″，8=>2.5″；越低越好）
  - `transparency`（1–8，1=<0.3，8=>1 mag/air mass；越高越好）
  - `rh2m`、`wind10m`、`temp2m`、`prec_type`
- **覆盖/时限**：全球，3 天，3 小时间隔；免费非商业使用。
- **接入注意**：`api.pl` 会 302 到 `astro.php`，现有 `lib/weather.js` 的 `https.get` 不跟随重定向；必须直接用 `astro.php` 或加 redirect 处理。
- **成本**：云函数新外呼；与 Open-Meteo 并行；缓存 3 h；只对前 3 天有值，4–7 天标 `unknown`，用 AOD/能见度兜底。
- **风险**：7Timer 基于 NOAA GFS，模型派生，不是实测；中国区精度需用 3 个站点对照；免费非商业许可需要署名。

### 1.8 AOD / PM2.5（透明度的另一条腿）

- **路径**：Open-Meteo Air Quality API。
- **实测**：`aerosol_optical_depth`、`pm2_5`、`pm10` 在 30°N, 103°E 正常返回；AOD 值 0.33–0.50。
- **覆盖**：CAMS，全球 45 km，欧洲 11 km；每日更新。
- **做法**：把 AOD 作为“大气浑浊度”输入，与 7Timer transparency 交叉；AOD 高时降低星空/银河评分，并解释“霾/气溶胶”。
- **成本**：云函数新外呼；缓存 3–6 h；无需密钥。
- **风险**：45 km 分辨率粗；AOD 是柱总量，不等于地面消光；只能做趋势/档位，不做精确星等。

### 1.9 地形 / 地平线 / 谷地（星空、银河、云海、彩虹、光染）

- **路径**：Open-Meteo Elevation API（Copernicus DEM GLO-90，90 m，全球，免费）。
- **实测**：一次最多 100 个坐标；144 个极坐标点分 2 次请求返回，单次响应 <1KB。
- **做法**：
  - 以查询点为中心，16 个方位 × 9–12 个距离（1–80 km）采样，计算每个方位的**地平线角**（含地球曲率与折射修正）。
  - 星空/银河：银心方位的地平线角 > 银心高度 ⇒ 被山脊挡住，降级或沉默。
  - 彩虹：反日点方位的地平线角 > 0° ⇒ 看不到完整虹，降级。
  - 光染：日出/日落方位的地平线最高点作为“候选山脊”，返回距离/海拔/视角；不再用轨迹走向冒充目标。
  - 云海：计算点位相对周边 5–20 km 的“地形开放度/谷深”，与低云带、逆温、风一起判断；仍不能保证“云海”，但能排除“点在山谷里/四周被高墙围住”的情况。
- **成本**：每点 2 次 elevation 请求；结果按经纬度 2dp + 海拔缓存（地形静态，可缓存 30 天）；云函数计算量很小。
- **风险**：90 m DEM 不含植被/建筑；采样距离是离散的；折射修正为经验值；只能做“粗地平线”。必须标注“地形为 90 m 模型，未计树木/建筑”。

### 1.10 光污染 / 天空亮度（星空、银河）

- **候选 A：DarkSkySites 免费 API**
  - 实测：无 key 返回 401；文档要求 `x-api-key` 头。
  - 文档口径：全球（含中国），免费 30k 次/月、10 次/秒；返回 `sqm`（mag/arcsec²）、`bortleClass`、`dataset`；要求把 “DarkSkySites.com” 放在数据旁边。
  - 优点：接入最快，逐点查询；缺点：需要密钥；第三方服务 longevity/精度需验证；密钥不能进小程序，只能放云函数环境变量。
- **候选 B：预计算 VIIRS/Falchi 网格**
  - 数据源：VIIRS 年合成夜光（NOAA/EOG，500 m）或 Falchi 2016 世界夜空亮度图（30 arcsec，2.9 GB GeoTIFF）。
  - 做法：离线裁中国、降采样到 0.05–0.1°，量化成 1 byte/格，放云函数包或对象存储；查询时双线性插值。
  - 优点：无 key、离线、稳定；缺点：需要一次性数据工程；VIIRS 年是年合成，城市变化有滞后；Falchi 2016 较旧。
- **候选 C：用户选择天空质量档**
  - 让用户选“城市 / 城郊 / 乡村 / 荒野 / 高山”，映射到 Bortle 区间；作为默认值或兜底。
  - 优点：零数据、零 key；缺点：主观，需在 UI 明说“这是你选的，不是实测”。
- **推荐**：先用 **C（用户档）** 把 UI 与评分链路打通；同时用 **A（DarkSkySites）** 做默认值（如果接受密钥）；长期用 **B（预计算网格）** 去掉第三方依赖。三者的评分接口保持一致，后续可替换。

### 1.11 目标山峰（晨昏光染 / 日照金山）

- **路径 1：DEM 候选山脊**（推荐先做）
  - 用 1.9 的地平线采样，在日出/日落方位找“最高视角”的点，返回距离、海拔、视角；卡片说“此方位地平线最高点约 X°（距离 Y km，海拔 Z m）”，不再说“某座山”。
- **路径 2：用户在地图上点选目标**
  - 复用 `wx.chooseLocation`，让用户选一座山；把它作为 `target` 传入，计算太阳方位与山体视线。
- **路径 3：OSM/峰点库**
  - Overpass API 查询 `natural=peak` 名称/海拔；免费但有限流，且中国峰点覆盖不全。
- **推荐**：先做路径 1 + 2；路径 3 作为增强，不阻塞。

### 1.12 雷达 / 临近降水（彩虹）

- **候选：RainViewer**
  - 实测：`https://api.rainviewer.com/public/weather-maps.json` 返回 past/nowcast 雷达帧；中国瓦片可下载（非空）。
  - 优点：免费（个人/教育；商用需计划）、全球；缺点：瓦片是图像，算法要用需解码；中国雷达覆盖需逐点验证；许可与商用限制。
- **更轻的路径**：1.6 的 Open-Meteo 多点降水 + `minutely_15`（中国区实测可用）足够回答“反日方向未来 2 小时有没有雨”；雷达主要作为**视觉证据层**（地图上叠加），不作为唯一算法输入。
- **推荐**：先做多点 + minutely_15；雷达作为后续可视化，不阻塞彩虹算法。

### 1.13 集合云概率（可选）

- **路径**：Open-Meteo Ensemble API；实测 `models=gfs_seamless` 返回 31 个成员，含 `cloud_cover_member01..31`。
- **用途**：把“条件较好/一般”从单模型确定性分数改成“有多少成员认为晴”的概率；改善话术诚实度。
- **成本**：响应体大；云函数只回聚合后的概率；可选，优先级低于前 12 项。

---

## 2. 建议的接入架构

### 2.1 数据形状（建议）

新增一个可选的 `skyContext`，与现有 `detail/series/cloudLevels` 并列；客户端 `sky.js` 只读它，不直接发外呼：

```js
{
  astronomy: {
    moon: { altitude, azimuth, rise, set, illumination },
    galaxy: { altitude, azimuth }
  },
  terrain: {
    horizon: [{ azimuth, angle, distance, elevation }],   // 16–24 个方位
    openness: 0.0–1.0,                                    // 周边谷地/山脊开放度
    ridgeAtSunAzimuth: { angle, distance, elevation } | null
  },
  atmosphere: {
    aod, pm25, visibility, seeing, transparency,          // 7Timer 3 天，之后 null
    source: '7timer' | 'open-meteo-aq' | null
  },
  lightPollution: { sqm, bortle, source: 'darkskysites' | 'viirs-grid' | 'user' },
  spatial: {
    byAzimuth: [{ azimuth, low, mid, high, precip, pop }] // 8 个方向 × 2–3 距离聚合
  },
  sources: { openMeteo: 'ok', sevenTimer: 'ok'|'missing', dem: 'ok', lightPollution: 'missing' }
}
```

### 2.2 失败语义

- **每个源独立 settle**：`Promise.allSettled`；一个源失败不影响天气主体。
- **缺失 = `unknown`，不是 0**：`sources` 里标 `missing`；对应天相返回 `unknown` 并说明缺什么（保留卡片），或降级到“只看云量”的弱结论。
- **静态/动态分开缓存**：
  - 地形 horizon、光污染：按点缓存 30 天；
  - 7Timer：3 h；
  - AOD/PM2.5：3–6 h；
  - 方向云/降水：30 min（与天气缓存同 TTL）。
- **不要在小程序端直连第三方**：全部走云函数；小程序只调 `trailApi` 的新 action（或扩展现有 action），避免域名白名单与密钥泄露。
- **新 action vs 扩展**：建议新增 `getSkyContext`（第 15 个 action），与 `getWeatherByPoint` 并行；不改变现有天气响应契约，失败时可单独隐藏。若嫌请求多，也可在 `getWeatherByPoint` 里加可选 `skyContext` 字段，但响应体会变大。

### 2.3 云函数限制

- 现有 `https.get` 不跟随 302；7Timer 必须用最终 `astro.php` URL，或加 redirect 支持。
- 现有 `fetchJson` 超时 10 s；多个外呼要并行，单源超时 3–5 s，避免拖垮 20 s 总超时。
- 云函数没有额外依赖；DEM 用 Open-Meteo Elevation API，不需要 PNG 解码；7Timer/Air Quality 都是 JSON。
- 若接 DarkSkySites，需要环境变量存 key；这是仓库第一个外部密钥，必须走控制台配置，不能写进代码/仓库。

---

## 3. 按天相重排：接入后能说什么

| 天相 | 接入后仍不能保证 | 能给出的诚实结论 |
|---|---|---|
| 星空 | 肉眼星等、局部光害、树木/建筑遮挡 | 暗夜 + 云（含低云）+ 月亮高度 + 透明度/seeing + 光污染档位 + 地形地平线 → “条件较好/一般/较差”，并列出缺哪项 |
| 银河 | 银河带亮度、气辉、局部光害 | 银心高度/方位 + 月亮角距 + 方向云 + 光污染 + 地形 → “银心在地平线上且暗夜云少”，仍不承诺“肉眼清晰” |
| 彩虹 | 雨幕的精细位置、虹的强度 | 太阳高度 + 太阳可见 + 反日方向降水（多点/临近）+ 反日地平线 → “具备彩虹形成的条件”，不说“会有” |
| 云海 | 具体谷地的成云、云的厚度/类型 | 云带低于点 + 逆温/湿层 + 谷地开放度 + 风 + 高层晴 → “云带之上 + 逆温/地形支持”，仍不承诺“云海” |
| 晨昏光染 | 目标山峰的坡向、山体材质、云隙光 | 晨昏窗口 + 低云少 + 目标山脊（DEM/用户点选）+ 太阳方位 → “此山脊可能被照亮”，不再用轨迹走向代替目标 |
| 黄金/蓝调 | 无 | 客观时刻，不受影响 |

---

## 4. 实施切片（建议）

### Slice 1：天文量（无需新数据，先修最大偏差）

- 月球高度/方位/月出月落；
- 银心高度/方位（或至少经度时差 + 高度闸）；
- 跨夜窗口；
- 低云按高度参与；
- `astro.starSight` 与 `sky.starConclusion` 合并；
- 缺测 `unknown` 门。
- 交付：`astro.js` / `sky.js` / `sky-test` / `astro-test`；无需部署。

### Slice 2：Open-Meteo 同源扩展（需重部署）

- 气压层温度/RH（925/850/700）；
- 总云量、PBLH、850 hPa 风；
- 8 方向 × 2–3 距离的多点云/降水；
- `minutely_15`（当日临近降水）；
- 可选：集合云概率。
- 交付：`lib/weather.js` + `trailApiLab` 同步 + smoke/scenario 测试；重部署。

### Slice 3：外部大气数据（需重部署）

- 7Timer ASTRO（seeing/transparency，3 天）；
- Open-Meteo Air Quality（AOD/PM2.5）；
- 失败降级 + 3 天限制标注。
- 交付：新 `lib/sky-context.js` 或 `lib/astro-weather.js`；`getSkyContext` action；缓存。

### Slice 4：地形（需重部署）

- Open-Meteo Elevation API 极坐标采样（100 点/请求，2 次/点）；
- 16 方位地平线角 + 谷地开放度 + 日出/日落方位候选山脊；
- 静态缓存。
- 交付：`lib/terrain.js`（纯函数，可用 fixture 测）+ 云函数 action 字段。

### Slice 5：光污染（需产品/密钥决策）

- 先接用户天空质量档（C）或 DarkSkySites（A）；
- 或离线 VIIRS/Falchi 网格（B）；
- 与 Slice 3/4 的评分接口保持一致。

### Slice 6：雷达/目标山峰增强（可选）

- RainViewer 雷达作为视觉层；
- OSM/峰点库或用户点选目标山峰。

---

## 5. 需要先验证的风险

| 风险 | 验证方式 |
|---|---|
| DarkSkySites 中国区精度/覆盖 | 申请 key 后测峨眉山、成都、理塘，与已知 SQM/Bortle 对照；不达标则改预计算网格 |
| 7Timer 中国区精度 | 3 个站点 × 3 天，和 Open-Meteo 云量/湿度/AOD 对照；只把它当“档位”而非绝对值 |
| DEM 地平线误差 | 3 个站点（峨眉山/成都/理塘）× 16 方位，与地图目视/已知山脊对照；确认 90 m DEM 对目标山脊够用 |
| 多点云/降水的方向代表性 | 用一次真实降水过程，比较 8 方向采样与雷达/实况；确认 15 km 模式能分辨反日方向雨幕 |
| 7Timer 许可 | 确认“非商业”覆盖本项目（零金额、熟人圈子）；页面加署名 |
| 新增外部密钥 | 若接 DarkSkySites，需要云函数环境变量；确认运维可接受 |
| 云函数调用量 | Open-Meteo 多点 + 7Timer + AQ + DEM 会使单次查询外呼数增加；用缓存和按需加载控制 |

---

## 6. 证据记录（本轮实测）

| 检查 | 结果 |
|---|---|
| Open-Meteo `temperature_850hPa` / `relative_humidity_850hPa` / 925 / 700 | 30°N,103°E 返回正常逐时数据 |
| Open-Meteo 多坐标 | 25 个坐标 5×5 正常，响应约 30 KB |
| Open-Meteo `cloud_cover` / `boundary_layer_height` / 850 hPa 风 | 返回正常 |
| Open-Meteo `minutely_15` 中国区 | 返回正常（15 分钟降水/概率） |
| Open-Meteo Air Quality `aerosol_optical_depth` / `pm2_5` / `pm10` | 返回正常（AOD 0.33–0.50） |
| Open-Meteo Elevation API | 100 点/请求；144 点分 2 次；单次 <1 KB |
| Open-Meteo Ensemble | 31 个 `cloud_cover_memberNN` 正常返回 |
| 7Timer ASTRO | 3 天、3 小时；seeing/transparency/cloudcover/rh2m/wind10m/temp2m/prec_type 正常 |
| RainViewer | 雷达帧列表正常；中国瓦片 200 且非空；覆盖需逐点验证 |
| DarkSkySites | 无 key 401；文档：`x-api-key`、30k/月、10/秒、全球、SQM/Bortle、署名 |

**未验证**：上述第三方服务在中国区的数值精度、长期可用性、许可是否覆盖本项目的使用方式；本报告只证明“接口能取到数据”，不证明“数据足够准”。

---

## 7. 建议的下一步

先做 **Slice 1 + Slice 2 + Slice 4**，因为它们分别解决：

- 天文量算错（银心/月亮/跨夜/低云）；
- 云海最缺的逆温与低层湿度；
- 所有方向性现象最缺的地形/地平线。

Slice 3（7Timer/AOD）与 Slice 5（光污染）可以并行，但需要先决定光污染走哪条路（API key / 预计算网格 / 用户档位）。Slice 6 是增强，不阻塞主链路。
