# 天相数据源 · 工程侧法务/合规核对（2026-10-21）

> **这不是法律意见。** 本文只把“实际数据流、第三方条款原文、页面署名与隐私文本”对齐，指出需要律师/合规确认的缺口。正式上线前请由法务复核，尤其是跨境与微信官方隐私指引。

## 1. 实际数据流（代码事实）

| 数据源 | 发出的数据 | 用途 | 经过哪里 | 缓存/保留 | 当前署名位置 |
|---|---|---|---|---|---|
| Open-Meteo | 查询点 WGS 经纬度、日期 | 天气、方向云/降水、地形点位、气溶胶 | 云函数 `trailApi` 服务端 `https.get` | `w_` 30 min；`s_` 30 min（2 h stale）；`t_` 30 天地形；`a_` 3 h 大气 | 天气页顶部 `Open-Meteo.com`（可点按复制）、页脚 URL、隐私指引 |
| 7Timer! | 查询点经纬度 | 透明度 / seeing / 云量（仅透明度/seeing进入评分） | 云函数 `lib/atmosphere.js` | `a_` 3 h（6 h stale） | 卡片“7Timer 透明度/seeing”、页脚、隐私指引 |
| CAMS / Open-Meteo Air Quality | 查询点经纬度 | AOD / PM2.5 / PM10 | 云函数 `lib/atmosphere.js` | `a_` 3 h | 卡片“CAMS 气溶胶”、页脚、隐私指引 |
| Copernicus DEM GLO-90（经 Open-Meteo Elevation API） | 16 方位 × 9 距离的点位坐标（含中心点） | 地形地平线/山脊 | 云函数 `lib/terrain.js` | `t_` 30 天 | 页脚、隐私指引、复制链接 |
| DarkSkySites | 查询点经纬度 | SQM / Bortle（模型值） | 云函数 `lib/light-pollution.js` | `l_` 30 天 | 卡片文字/证据“DarkSkySites.com，模型估算”、页脚、隐私指引 |

- 不发送：姓名、手机号、openid、活动内容、精确轨迹、用户实时位置（天气查询点是路线节点/地图选点/手填坐标，不是 `wx.getLocation` 的实时位置）。
- 结构化日志 `logRequest` 只写 action/命令类型/requestId/openid 的 sha256 前 8 位/耗时/错误码，不写坐标与 payload；已由 `failure-semantics-test` 覆盖。
- `DARKSKY_API_KEY` 只在云函数环境变量；不在小程序、不在仓库、不在日志。`tools/light-pollution-test.js` 只使用假值 `test-key`。
- 缓存里存的是 2dp 坐标键（约 1 km 网格）与取数结果；属于“查询点坐标”的派生存储，不是用户实时定位。

## 2. 第三方条款核对

### 2.1 DarkSkySites（API Terms，effective 2026-10-14，版本 api_terms_2026_10_v2）

原文要点（https://darkskysites.com/api-terms）：

- 免费额度：30,000 次/UTC 月、10 次/秒；额度按项目共享。
- **允许商业或非商业使用**；合理缓存允许；禁止批量重建数据集、批量坐标采集、转售原始数据、做替代 API。
- **署名**：显示 DarkSkySites 数据时，必须在数据旁/正下方/同一视觉组件内显示 `"DarkSkySites.com"`；支持超链接的地方要链接到 `https://darkskysites.com`；只放在法律条款、源代码、隐私政策、开发者文档或无关 credits 页**不满足**。
- **模型数据**：不得把模型值呈现为 live SQM/实时测量。
- API key 是秘密：不得公开、不得放公开客户端代码/公开仓库；泄露要撤销。

**当前状态**：
- 卡片正文与证据均显示 `DarkSkySites.com，模型估算`（同一条卡片/证据内，满足“数据旁”与“不得冒充实测”）。
- 页脚与隐私指引列出 `DarkSkySites.com` + URL；页脚有“点按复制数据来源与许可链接”。小程序 `<text>` 不支持直接外链；复制链接是当前可做的“链接替代”。
- 30 天缓存用于单点查询；不批量、不重建数据集、不做替代 API；key 在云函数环境变量。
- **残留风险**：严格意义上的“可点击超链接”在小程序内需要 `web-view` + 业务域名白名单；当前没有。若 DarkSkySites 要求严格可点击链接，需要配置 web-view 数据来源页，或向对方申请替代署名。

### 2.2 Open-Meteo（CC BY 4.0）

原文要点（https://open-meteo.com/en/licence）：

- 数据 CC BY 4.0；**允许商业使用**。
- 必须在任何展示 Open-Meteo 数据的位置旁包含链接，例如 `Weather data by Open-Meteo.com`。

**当前状态**：
- 天气页顶部 `温度 · 降水 · 云层带 · 风 — Open-Meteo.com` 就在数据旁，且可点按复制来源链接；页脚有 `https://open-meteo.com/`；隐私指引有许可证说明。
- **残留风险**：同样不是真正的超链接；若按字面“link”要求，需要 web-view 数据来源页或微信允许的外链方式。

### 2.3 7Timer!

原文要点（https://www.7timer.info/doc.php?lang=en）：

> "The weather data distributed in this site are entirely free – you can use or redistribute them as long as you are not using them for commercial purpose."

**当前状态**：
- 本项目是零金额、熟人圈子工具，当前**非商业**；页脚/卡片有 `7Timer!` 署名与 URL。
- **条件**：一旦收费、广告、商业合作或对外收费服务，7Timer 的免费许可不再适用，需要先取得商业许可或停用该源。

### 2.4 CAMS / Copernicus Atmosphere Monitoring Service

条款要点（CDS Licence to use Copernicus Products，https://cds.climate.copernicus.eu/licences/licence-to-use-copernicus-products）：

- 允许合法商业使用（Clause 4.2）。
- 署名（Clause 5.1）：`Generated using Copernicus Atmosphere Monitoring Service information [Year]`（或 CAMS information）。

**当前状态**：
- 卡片显示“CAMS 气溶胶”；页脚有“CAMS/Open-Meteo Air Quality（生成使用 Copernicus Atmosphere Monitoring Service 信息）”；隐私指引第五段与复制链接含英文 `Generated using Copernicus Atmosphere Monitoring Service information 2026`。
- **残留风险**：页脚是中文转述；严格按条款应在可见位置出现英文原文。隐私页与复制文本已有英文原文；如需更严格，把英文原文放到卡片证据或数据来源页。

### 2.5 Copernicus DEM GLO-90

版权文本（Copernicus DEM 数据说明）：

> © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

**当前状态**：
- 页脚有 `Copernicus DEM 90 m（© DLR/Airbus DS, COPERNICUS）`；隐私指引第五段与复制链接含完整版权句。
- **残留风险**：页脚是缩写；严格满足版权声明需要完整句在可访问位置（隐私页/复制文本已满足；若要求“数据旁”，当前地形只在卡片文字里以“DEM 90 m 粗判”出现，未直接显示版权句）。

## 3. 隐私 / PIPL 核对（工程侧）

### 3.1 微信侧配置

- `app.json`：`__usePrivacyCheck__: true`；`requiredPrivateInfos` 已声明 `getLocation`、`chooseLocation`；`scope.userLocation.desc` 为“用于选择集合点/路线节点/天气查询点、签到校验与位置上报”（28 字）。**该字段微信上限 30 字**（按字符计）：2026-10-21 的 40 字版本导致上传报 80058，已压缩并由 `tools/check.js` 常驻校验。
- 隐私页 `/pages/privacy` 从「我的」可进入；页面已列：
  - 位置信息（含天气查询点）、手机号、头像昵称、紧急联系人、身份证（选填）、**天气查询坐标发送给哪些服务**；
  - 第五段：第三方数据服务与许可、模型值声明、可能跨境传输与“如不同意请勿使用天气/天相查询”；
  - 更新日期 2026-10-21。
- **未验证**：微信公众平台后台的「用户隐私保护指引」是否已同步加入“天气查询坐标/第三方共享/跨境”条目。代码只能证明小程序侧的声明与页面；后台配置需要管理员在 mp.weixin.qq.com 完成。

### 3.2 PIPL/跨境

- 向 Open-Meteo、7Timer!、CAMS、Copernicus、DarkSkySites 发送查询点坐标；这些服务可能位于境外，**可能构成个人信息/位置相关信息的跨境提供**。
- 当前隐私页做了“告知 + 不同意请勿使用”的说明，**没有独立的跨境同意流程/个人信息保护影响评估（PIA）**。是否必须做，取决于法务对“查询点坐标是否属于个人信息、是否达到跨境提供门槛、是否适用例外”的判断。
- **需要法务确认**：
  1. 查询点坐标（可能是路线节点/地图选点，不一定是用户实时位置）是否按个人信息处理；
  2. 跨境提供是否需要单独同意、PIA、标准合同/认证；
  3. 微信官方隐私指引是否需要在“第三方共享/跨境”中逐项列出数据源；
  4. 7Timer 的“非商业”限制与 DarkSkySites/Open-Meteo 的商业条款在未来的商业化路径下如何处理。
- **工程侧已做的最小化**：只发坐标+日期；不发姓名/手机号/openid；日志不含坐标；缓存只存 2dp 网格键与结果；key 只在云函数。

## 4. 缺口与建议（按优先级）

| 优先级 | 事项 | 现状 | 建议 |
|---|---|---|---|
| P0 | 微信后台「用户隐私保护指引」同步 | 代码侧已声明，后台未验证 | 管理员在 mp.weixin.qq.com 增加：位置（选点/签到/上报）、手机号、头像昵称、天气查询坐标、第三方共享（Open-Meteo/7Timer/CAMS/Copernicus/DarkSkySites）、跨境说明 |
| P0 | 跨境/PIPL 法律判断 | 只有告知+使用即同意式说明 | 法务确认是否需要单独同意/PIA/标准合同；如需，增加独立同意流程（不要只放在隐私页） |
| P1 | 可点击的数据源链接 | 小程序 `<text>` 只能显示 URL/复制，不能直接外链 | 配置 web-view 业务域名 + “数据来源与许可”页；或向 provider 申请替代署名 |
| P1 | CAMS 英文原文可见性 | 隐私页/复制文本有英文；卡片只显示“CAMS” | 在数据来源页/卡片证据中放 `Generated using Copernicus Atmosphere Monitoring Service information 2026` |
| P1 | Copernicus 完整版权可见性 | 隐私页/复制文本有完整句；页脚缩写 | 在数据来源页/地形证据旁放完整版权句 |
| P1 | 7Timer 非商业限制 | 当前零金额；页脚有署名 | 商业化前重评/取得许可；在数据来源页写“免费非商业” |
| P2 | 缓存/保留期告知 | 隐私页已补：天气/方向云约 30 分钟、大气约 3 小时、地形/光污染约 30 天，并写明过期后重新查询（`pages/privacy/privacy.wxml` §三） | 已收口；如 TTL 调整需同步改这句 |
| P2 | 数据源条款版本记录 | 已记录有效期（DarkSkySites 2026-10-14；CDS rev.12） | 定期复核条款变更；保存快照 |

## 5. 代码侧已完成的合规改动

- 卡片正文/证据：`DarkSkySites.com，模型估算`（同卡片，不伪装 live SQM）；`CAMS 气溶胶`；`7Timer 透明度/seeing（越小越好）`。
- 页脚：`Open-Meteo.com` + URL、`7Timer!` + URL、CAMS 说明、Copernicus 缩写版权、`DarkSkySites.com` + URL + 模型说明；新增“点按复制数据来源与许可链接”。
- 顶部数据区：`Open-Meteo.com` 可点按复制来源链接。
- 隐私页第五段：第三方数据服务与许可、模型值声明、跨境提示、更新日期。
- `app.json` 的 `scope.userLocation.desc` 补上“天气查询点”。
- 没有把 key 写入代码/仓库/日志；已检查。

## 6. 不能从仓库验证的事

- 微信公众平台后台的隐私指引是否与页面一致；
- 各 provider 的账号条款是否接受本项目的具体用途（尤其 7Timer 非商业、DarkSkySites 署名链接）；
- 跨境传输的法律定性、是否需要单独同意/备案；
- provider 数据精度与 SLA（见 `precision-report.md`）。

**结论**：工程侧已经把“数据流、署名、模型值声明、隐私页、位置权限说明”对齐；**仍不能宣称法务合规通过**，P0 的后台隐私指引与跨境判断必须由管理员/法务完成。
