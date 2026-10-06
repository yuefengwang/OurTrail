# Meteoblue meteogramweb 技术验证（Technical POC Findings）

**日期：** 2026-10-06 · **环境：** Windows / Git Bash / Node v24 · **网络出口：** 中国大陆家庭宽带（Cloudflare LAX 节点）
**性质：** 纯技术 POC，零生产代码改动。只验证公开页面的加载机制，不做登录破解、签名伪造、验证码绕过或付费 API 绕过。
**商业授权问题不在本 POC 范围内**（任务明确排除），仅在结尾以「边界提示」形式出现一次。

---

## 0. 结论速览

**「meteogramweb 页面」可以完全程序化访问，但页面上的 Meteogram 不是一张图片文件，而是
Highcharts 用 JSON 数据在浏览器里画出来的 SVG。** 所以：

- 拿到「生成这张图所需的完整数据」（带签名的 JSON 端点，lat/lon 参数化）：**可行，四层验证全过**；
- 拿到「一张现成的 PNG/WebP/JPEG 文件」：**不可行，服务端根本不存在这个文件**；
- 图片只能靠「浏览器渲染后截图」或「自行渲染数据」获得——本 POC 已用无头 Edge 实际截出 4 个地点的成品图作为证明。

**最终评级：部分可实现**（数据管线 PASS；图片文件管线在服务端断链）。逐条裁决见 §10。

---

## 1. 第一层：HTTP GET

对 `https://www.meteoblue.com/en/weather/forecast/meteogramweb/emeishan_china_1811732` 的实测：

| 变体 | 结果 |
|---|---|
| curl **默认 UA**（`curl/8.x`，无 Cookie、无 Referer、无 Accept） | **200** `text/html; charset=UTF-8`，74,100 B，0 次重定向，1.31 s |
| curl + Chrome UA + Accept + Accept-Language | **200**，74,159 B，1.20 s |
| **Node `https.get`**（与云函数 `lib/weather.js` 同款栈，零依赖） | **200**，4/4 地点全过 |

完整响应头存档：`evidence/http-page-headers-emeishan.txt`。要点：

- `Server: cloudflare`，`cf-cache-status: DYNAMIC` —— 站点在 Cloudflare 后面，但**对无浏览器指纹的客户端没有质询**（无 403 challenge、无 JS challenge）。
- **不要求 Cookie**：首次裸请求即 200；响应会 `Set-Cookie`（`mb` 会话、`locale`、`lastvisited`、`ab`），但后续请求不带这些 Cookie 依然 200（全程实测）。
- **不要求 Referer / Authorization**。
- 页面本身 `Cache-Control: no-store, no-cache` —— 每次请求都是新生成的页面（这直接导致签名 URL 每次都新签，见 §5）。
- 小程序直连域名的 implication：`www.meteoblue.com` 与 `my.meteoblue.com` 均为 HTTPS、无需 Cookie/Referer，`wx.request`/云函数侧无技术障碍。

## 2. 第二层：解析 HTML

页面 HTML（74 KB）里 `img/picture/source` 标签只有 9 个，**全部是静态 UI 图**（菜单箭头、crosslink 图标、logo、App Store 徽章），**没有一张是 Meteogram**。`background-image` 零命中。Case A（HTML 直接含 `<img>` Meteogram）**FAIL**。

但 HTML 里藏着整个机制的钥匙——唯一的承载元素：

```html
<div class="image img-scrollable"
     data-href="//my.meteoblue.com/images/meteogram?temperature_units=C&windspeed_units=kmh
     &precipitation_units=mm&darkmode=false&iso2=cn&lat=29.5327&lon=103.388&asl=1099
     &tz=Asia%2FShanghai&dpi=72&apikey=n4UGDLso3gE6m2YI&lang=en&location_name=Emeishan
     &format=highcharts&ts=1791242965&sig=039a11a228fe5cf3aa2909f7a8111125">
```

即：**服务端渲染页面时就把「完整签名的图片端点 URL」直接写进 HTML**，不需要任何 JS 逆向。`sourceMethod = "html"`。

另外 HTML 内嵌 21 种语言的 meteogramweb 互链（`/de/wetter/vorhersage/meteogramweb/emeishan-shi_china_1811732` 等）——各语言 slug 文字不同，但**数字 ID `1811732` 恒定**，这是 ID 为权威 key 的第一个信号（§6 有决定性实验）。

## 3. 第三层：JavaScript 检查

- 页面只外链 4 个 JS：`website.808/main.js`（213 KB 通用包）、`lightgallery.js`、GTM/广告、reCAPTCHA。
- **`main.js` 里 `meteogram` 零命中** —— 主包不含 meteogram 逻辑，进一步佐证「图片 URL 由服务端塞进 HTML，页面 JS 只负责取 `data-href` 去请求」。
- `meteograms.css`（样式）存在；渲染逻辑由 Highcharts 承担（§4 证实）。
- 无需再挖 JS endpoint：**HTML 已经给出完整可用的端点 URL**。

## 4. 第四层：浏览器真实 Network 记录（Playwright-core + 本机 Edge 154 无头）

对 4 个地点各完整记录一次页面加载的所有请求（全量存档 `evidence/network-*.json`，摘要 `evidence/summary-*.json`）：

| 地点 | 请求数 | DCL | 渲染完成 | Meteogram 端点请求 | DOM 结论 |
|---|---|---|---|---|---|
| Emeishan | 78 | 1984 ms | 4392 ms | **200 `application/json`**（52,457 B 压缩） | `DIV.highcharts > svg`，canvas=0 |
| Chengdu | 78 | 1910 ms | 4898 ms | 200 `application/json`（49,898 B） | 同上 |
| Litang(Gaocheng) | 80 | 1719 ms | 4266 ms | 200 `application/json`（46,679 B） | 同上 |
| Dao Cheng Xian | 79 | 2347 ms | 4858 ms | 200 `application/json`（52,317 B） | 同上 |

**浏览器没有请求任何「整幅 Meteogram 图片」。** 全部 raster PNG 只有：

1. 天气 pictogram 小图标 `my.meteoblue.com/images/static/meteoblue_weather_pictograms/png_6h_1d/XX_iday_simple.png`（每地点 9–11 张，各几十 px，无签名）；
2. meteoblue logo PNG。

Meteogram 本体 = Highcharts 把 `application/json` 渲染成 **SVG**（`.img-scrollable` 容器内 `svgCount=1`、`canvasCount=0`）。**Case C 成立并已确认为 SVG，不是 Canvas/WebGL。**

## 5. 图片端点剖析（真正的资源在哪）

`https://my.meteoblue.com/images/meteogram?...`（由页面下发，`//` 开头需补 `https:`）：

| 参数 | 4 地点实测 | 说明 |
|---|---|---|
| `temperature_units` / `windspeed_units` / `precipitation_units` | `C` / `kmh` / `mm` | 单位，固定 |
| `darkmode` | `false` | 页面即用值 |
| `iso2` | `cn` | 国家码（小写） |
| **`lat` / `lon` / `asl`** | 29.5327/103.388/1099 · 30.6667/104.067/499 · 29.9881/100.269/3935 · 28.916/100.147/4762 | **端点本身按经纬度+海拔参数化，与 meteogramweb ID 无关** |
| `tz` | `Asia/Shanghai` | 时区 |
| `dpi` | `72` | |
| **`apikey`** | `n4UGDLso3gE6m2YI`（4 地点同一值） | meteoblue 网页端公钥，明文嵌在公开 HTML 里 |
| `lang` / `location_name` | `en` / 地点名 | `location_name` 出现在图题 |
| **`format`** | **`highcharts`** | 决定返回 JSON（配置+数据），而非位图 |
| **`ts` / `sig`** | 每次刷新页面都变（ts = 页面生成时刻的 epoch 秒，实测与 Date 头秒级一致） | **签名** |

访问控制实测：

- **完整签名 URL 裸重放（无 Cookie/无 Referer/无浏览器）：200**，且 +5 分钟、+13 分钟、**+35 分钟**三次重放均 200、字节数一致 —— 签名不是一次性票据，短期窗口内可复用。
- **删掉 `sig`：403**，响应体明说规则（存档 `evidence/endpoint-403-without-sig.txt`）：
  `{"reason":"This api key requires signature validation. Please specify the url parameter &sig=md5(<url>&secrect=<secret>)","error":true}`
  —— secret 在 meteoblue 服务端，**本 POC 不伪造签名**；正确姿势就是「抓页面 → 原样取用现成签名 URL」。
- 无防盗链（Referer 校验）、无临时 token 刷新机制、无浏览器 JS 依赖（curl/Node 均可取）。

**端点返回的不是图片**：`Content-Type: application/json`，解压后约 541 KB，是一份完整 Highcharts 配置 + 预报数据（结构样本存档 `evidence/highcharts-json-sample.json`）：

- `isMeteogram: true`，`title`（地点名）、`subtitle`（`29.53°N, 103.39°E (1099 m asl)`）；
- **12–13 个 series**（高海拔地点多出 Snow）：Temperature colors(areaspline 121 点) / Temperature(scatter) / daily min/max / Pictograms(scatter 20 点，WMO 天相码) / **Cloud cover(contour 4477 点——整条云带剖面数据都在)** / Ground / Precipitation(column 121) / Showers(column 121) / Wind speed / Wind gust / Wind direction(vector 41)；
- `credits`（`Last update: 2026-10-06 07:23`）与 `caption`（HTML 方式内嵌 meteoblue logo 图）—— 页面上的署名/更新时间就来自这两块。

## 6. URL 规律与「能否动态生成」

**meteogramweb 页面 URL 解剖：**

```
https://www.meteoblue.com/en/weather/forecast/meteogramweb/{slug}_{country}_{id}
                                                              └── 纯 SEO ──┘  └ 权威 key
```

决定性实验（§5 补充）：

| 探测 URL | 结果 |
|---|---|
| `.../meteogramweb/fake-name_china_1811732`（名字乱写、ID 对） | **200，正确渲染 Emeishan 页**（title `Meteogram Emeishan`）→ **slug 文本被服务器完全忽略，纯 SEO** |
| `.../meteogramweb/emeishan_china_9999999`（名字对、ID 错） | 200 但内容是**另一个地点**（Yushuying，41.41°N 115.81°E，id 9999999 真实存在于库中）→ **ID 是唯一权威 key** |

**地点发现（搜索）接口 —— 已打通且支持坐标：**

```
GET https://www.meteoblue.com/en/server/search/query3?query={关键词或"lat,lon"}
→ 200 application/json: { count, results: [{ name, admin1, iso2, id, lat, lon, featureCode, url, ... }] }
```

- `results[].url` **就是** meteogramweb slug（emeishan 搜索结果 `url: "emeishan_china_1811732"` 与任务给定 URL 逐字一致）。
- **`query=30.0,100.27`（坐标字符串）→ 返回就近地点**，第一即理塘 Gaocheng —— 「任意 lat/lon → 就近地点 → slug」全自动可行。
- 中文关键词**不可用**（`query=理塘` → count=0），搜索按 GeoNames 罗马名匹配：理塘县城是 **Gaocheng**（高城镇，id 1810604），理塘县是 **Litang Xian**（id 1803228，带 `&lat=&lon=` 上下文时出现），稻城县是 **Dao Cheng Xian**（id 1813787）。OurTrail 若接入需自备中英地名映射。
- `featureCode` 可区分山峰/城市/机场（Emeishan 峨眉山是 `PPLA3` id 1811732；另有同名县 Emeishan City id 13100535 等重名点，选点需按 admin1/lat/lon 消歧）。

**四地点总表：**

| OurTrail 叫法 | meteogramweb slug | id | lat/lon | asl | 成品图 |
|---|---|---|---|---|---|
| 峨眉山 | `emeishan_china_1811732` | 1811732 | 29.5327, 103.388 | 1099 m | `screens/emeishan.png` |
| 成都 | `chengdu_china_1815286` | 1815286 | 30.6667, 104.067 | 499 m | `screens/chengdu.png` |
| 理塘 | `gaocheng_china_1810604` | 1810604 | 29.9881, 100.269 | 3935 m | `screens/litang.png` |
| 稻城 | `dao-cheng-xian_china_1813787` | 1813787 | 28.916, 100.147 | 4762 m | `screens/daocheng.png` |

## 7. 成品图目检（`screens/*.png`，1600×1302，无头 Edge 元素截图）

四张图逐一目检，内容与真机页面所见完全一致，且每张都包含：

- ✅ 地点名（图题）+ 坐标 + 海拔副题（`Gaocheng 29.99°N, 100.27°E (3935 m asl)`）
- ✅ meteoblue logo（右上角）
- ✅ **完整三行图**：温度带（含 WMO pictograms、日最高/最低标注）→ 降水(mm/h)+**云底高度剖面(Altitude km, 5 级灰阶)** → 风速/阵风曲线+风向矢量
- ✅ 日期时间轴（Tuesday 06.10 … Saturday 10.10，未来 5 天小时级，白天底纹）
- ✅ 图例（云量 10–25%…90–100%、Precipitation、Showers；高海拔地点追加 Snow、Frozen mix）
- ✅ `Last update: 2026-10-06 07:34`（数据时效戳）

高海拔差异真实反映：理塘/稻城出现 0°C 以下温度带、Snow/冻雨符号、75 km/h 风轴；成都 26°C 平原特征。

## 8. Cloud Function 模拟（`fetch-meteogram.js`，零依赖 Node https）

```
node fetch-meteogram.js
→ 4/4 locations ok
emeishan: page 200/1205ms → endpoint 200/1482ms，total 2692ms，JSON 541KB，12 series
chengdu:  page 200/ 615ms → endpoint 200/ 717ms，total 1336ms，JSON 538KB，12 series
gaocheng: page 200/ 606ms → endpoint 200/ 798ms，total 1408ms，JSON 534KB，13 series
daocheng: page 200 (见 evidence/fetch-meteogram-results.json)
```

结论：**云函数侧「页面 → 签名 URL → 数据 JSON」两跳全通**，与 `lib/weather.js` 现有 Open-Meteo 代理同构（`https.get`、无额外依赖），单地点冷启动总耗时 **1.3–2.7 s**（对比：现 weather 模块 Open-Meteo 一跳 ~1 s 量级）。原始输出：`evidence/fetch-meteogram-results.json`。

## 9. 小程序可用性

链路「Meteoblue → Cloud Function → Image URL → 小程序 `<image>`」**在最后一环断链**：

- `<image>` 需要的是位图 URL；这里能拿到的「资源」是 `application/json`（Highcharts 配置）。`<image>` 无法显示它。**不存在可直挂的 Meteogram 位图 URL**（浏览器 network 里也没有）。
- 域名层面无障碍（均 HTTPS、无 Cookie/Referer/防盗链；`<image>` 组件本身也不受 request 域名白名单约束）——但这救不了「资源不是位图」这个事实。
- 若真要「一张图」，只剩两条路：
  1. **无头浏览器渲染后截图**（本 POC 的做法）：云函数生态里跑 Playwright/Chromium 不现实（体积、冷启动、微信云函数环境限制），需要一个独立渲染服务——架构复杂度陡增；
  2. **拿 JSON 自己画**：JSON 里数据完备（温度/云量 contour/降水/阵风/风向/pictogram 码），OurTrail 已有 `components/meteogram` canvas 渲染体系与 `utils/sky.js` 天相体系，理论上可消化这份数据——但这就是「用自己的渲染器画 meteoblue 的数据」，不再是「引用一张图」。
- pictogram 小 PNG（无签名、可直挂）与 logo 可以直接热链，但那不是 Meteogram 本体。

## 10. 逐问回答（Q1–Q13）

| # | 问题 | 答案 |
|---|---|---|
| Q1 | URL 可程序化访问？ | **是**。curl 裸请求与 Node `https.get` 均 200，无质询、无 Cookie/Referer/UA 要求 |
| Q2 | HTML 直接包含 Meteogram？ | **否**（只有静态 UI 图；Meteogram 以签名 URL 形式藏在 `data-href` 属性里） |
| Q3 | 浏览器到底请求了什么？ | 1 个 `my.meteoblue.com/images/meteogram?...&format=highcharts` → `application/json`（约 50 KB 压缩/541 KB 解压）；外加 pictogram 小 PNG、logo、字体、CSS/JS、广告 |
| Q4 | Meteogram 最终形态？ | **浏览器内 Highcharts 渲染的 SVG**（canvas=0）；不是 PNG/WebP/JPEG 文件 |
| Q5 | 能得到真实图片文件？ | **服务端不存在该文件，无法直接下载**；只能浏览器截图（已产出 4 张验证）或自渲染 |
| Q6 | 图片 URL 稳定？ | **不稳定**：ts/sig 每次页面加载重签；旧签名实测 ≥35 min 仍有效但无任何承诺；数据随预报更新 |
| Q7 | 不同地点自动生成？ | **是**。`query3` 搜索支持名称与 `lat,lon` 坐标就近，`results[].url` 即 slug；slug 乱写也 200（ID 才是 key） |
| Q8 | 需要 location ID？ | meteogramweb 页面 URL 需要（但可经 query3 自动获得）；图片端点本身只要 lat/lon/asl/tz + 页面下发的签名 |
| Q9 | 需要 Cookie/Token/Session？ | 页面：都不需要。图片端点：需要 **apikey+sig**，但页面 HTML 每次直接下发完整签名 URL，无需自取/伪造 |
| Q10 | Cloud Function 能自动取得？ | **数据：能**（4/4，1.3–2.7 s）。**成品位图：不能**（需浏览器渲染这一步，云函数栈做不到） |
| Q11 | 小程序 `<image>` 直接显示？ | **不能**（资源是 JSON 不是位图；无位图 URL 可挂） |
| Q12 | 性能？ | 页面 GET 0.6–2.0 s；端点 GET 0.7–1.8 s；`fetchMeteogram` 全程 **1.3–2.7 s**；浏览器渲染完成 4.3–4.9 s（含广告请求） |
| Q13 | 成都/理塘/格聂实时生成？ | 数据层面：实时可行（每地点 2 跳共 ~2 s；格聂未收录，需以就近坐标搜得稻城/理塘一带替代）。成品图层面：同 Q10/Q11 限制 |

## 11. 最终裁决

```text
TECHNICAL FEASIBILITY

A. Direct HTML image:      FAIL   (HTML 无 Meteogram <img>；只有 data-href 签名 URL)
B. Browser network image:  FAIL   (Network 里无整图请求；Meteogram 端点返回 application/json，
                                   仅 pictogram/logo 为 PNG)
C. Dynamic location:       PASS   (query3 名称/坐标搜索 → slug 自动生成；slug 纯 SEO，ID 权威)
D. Cloud Function:         PASS*  (*数据管线 4/4 全通、~2s；但拿不到成品位图文件)
E. WeChat Image:           FAIL   (<image> 无法显示 JSON；不存在可直挂位图 URL)
F. Need location ID:       YES    (页面 URL 需要；但 query3 可自动获得——非人工障碍)
G. Need cookie:            NO
H. Need token:             YES    (端点要求 apikey+sig；但由页面 HTML 免费下发，无需伪造)
I. Stable image URL:       NO     (ts/sig 每页重签；旧签名 ≥35min 实测有效但无保证)
J. Recommended:            PARTIAL — 作为「取图」管线不成立；作为「取数据」管线成立
```

**可实现 / 部分可实现 / 不可实现：部分可实现。**

- 想要「OurTrail 直接挂一张 meteoblue Meteogram 图」——**不可实现**：这个图在世界上只以浏览器内 SVG 的形态存在，服务端没有文件，`<image>` 无图可挂。
- 想要「OurTrail 拿到 meteogramweb 页面的 Meteogram 数据」——**可实现**：`fetch-meteogram.js` 已 4/4 验证（页面 → 现成签名 URL → 完整 Highcharts JSON，含温度/云量剖面/降水/风/天相码）。

### Recommended Architecture（若走数据路线）

```
OurTrail 地点（名称或 lat/lon）
        ↓  GET query3?query={name 或 "lat,lon"}          （自动取得 slug/ID）
meteogramweb 页面 URL
        ↓  GET 页面 HTML                                  （无 Cookie/Referer）
提取 data-href 现成签名 URL
        ↓  GET my.meteoblue.com/images/meteogram?...&format=highcharts
Highcharts JSON（12–13 series 全量预报数据）
        ↓
自渲染（OurTrail 既有 canvas/meteogram 体系）——或——无头浏览器截图服务（重、不推荐）
        ↓
OurTrail Weather Page
```

若坚持「直接引用一张图」的原始设想，则本 POC 的正确输出是 **REJECT（对位图方案）**：
Reason: 服务端不存在 Meteogram 位图资源；页面内是 Highcharts JSON → 客户端 SVG；`<image>` 无图可挂。

---

## 12. 边界提示（一句话，非本 POC 范围）

端点上的 `apikey` 是 meteoblue 网页客户端的公钥，`sig` 密钥在 meteoblue 手里且无法伪造——这本身就说明该数据通道是 meteoblue 面向其页面流量提供的。**任何生产化使用（无论取数据还是截图）在动手前应单独过 meteoblue 的 Terms & 商业授权评估**，本 POC 只回答「技术上是否可行」。

## 13. 证据索引

| 文件 | 内容 |
|---|---|
| `fetch-meteogram.js` | 云函数模拟（零依赖 Node https），`node fetch-meteogram.js` 可复跑 |
| `scripts/browser-network-poc.js` | 第 4 层浏览器 Network 记录脚本（playwright-core + 系统 Edge） |
| `evidence/http-page-headers-emeishan.txt` | 页面 200 响应头（Set-Cookie/CSP/Cloudflare 等） |
| `evidence/http-endpoint-headers-emeishan.txt` | 图片端点 200 响应头（application/json, no-store） |
| `evidence/endpoint-403-without-sig.txt` | 去掉 sig 后的 403（含服务端自述签名规则） |
| `evidence/fetch-meteogram-results.json` | 模拟运行原始输出（4 地点，含逐跳计时） |
| `evidence/summary-*.json` × 4 | 浏览器每地点摘要（请求数/计时/endpoint/DOM 结论） |
| `evidence/network-*.json` × 4 | 浏览器全部真实请求日志（78–80 条/地点） |
| `evidence/highcharts-json-sample.json` | 端点 JSON 结构样本（series 清单与首点） |
| `screens/{emeishan,chengdu,litang,daocheng}.png` | 无头 Edge 渲染的 Meteogram 成品图（1600×1302） |
| `screens/*-fullpage.png` | 对应整页截图（对照用） |
