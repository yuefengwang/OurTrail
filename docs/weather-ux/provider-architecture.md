# Provider Architecture —— 数据源抽象、缓存与 Fallback（§19 / §20 / §6）

日期：2026-10-05 · 原则：**Meteoblue 是增强，不是依赖。** UI 与分析层永远不感知具体数据源。

---

## 1. 分层总图

```
WeChat Mini Program（pages/weather + 新组件族）
        │  wx.cloud.callFunction（唯一入口 utils/api.js）
        ▼
OurTrail Cloud Function（trailApi / 未来 trailApiLab 同构）
        │  WeatherProvider 接口（云函数内实现，key 只活在这里）
        ├── OpenMeteoProvider   ← 现状：lib/weather.js（免费、CC BY、零成本）
        └── MeteoblueProvider   ← 未来：Forecast API 数据包（付费就绪后启用）
        ▼
NormalizedWeatherData（唯一中间形状）
        │
        ├→ 缓存层（ot_weather_cache，见 §3）
        ▼
OurTrail Sky Analysis（客户端纯函数：astro.js / sky.js / weather-model.js + 新 agenda.js/conditions.js）
        ▼
Weather UI（V2 页面：自绘 Timeline / Agenda / 评级卡 / Evidence —— 与 provider 无关）
```

**为什么判断层放客户端不变：** sky.js 的 65 例测试钉住了阈值；provider 只影响"事实"的来源，
不影响"解释"的规则。Meteoblue 数据进来后，云海/光染/银河的判定逻辑一行不改。

## 2. NormalizedWeatherData（契约 v1.1，增补 provider 元信息）

```js
{
  provider: { id: 'open-meteo' | 'meteoblue', label, attribution, modelNote? },
  point:    { name, lat, lng, elevation, elevationSource },   // elevationSource: gpx|picked|manual|model
  updatedAt: iso,
  days:  [ /* 不变：date/code/tMax/tMin/windMax/precipSum/precipProbMax/precipHours/sunrise/sunset/uvMax/cloud{} */ ],
  hours: [ /* 不变字段 + 新增可选：windDir, pressure, dewPoint */
           /* band{base,top,cover}|null —— 气压层云带，MeteoblueProvider 由其云层数据映射 */ ],
  status: 'ready' | 'out_of_range' | 'unavailable',
}
```

**适配规则：**
- 新字段一律 optional，UI 缺失降级（风行退化、明细列显示 —）；
- `band` 是 OurTrail 的**派生事实**：Open-Meteo 用气压层剖面（现网 `cloudBandAt`）；
  Meteoblue 用其 cloud 层数据映射到同形状——下游 sky.js 不需要知道哪来的；
- provider 转换失败/超时 → `unavailable`，UI 走 Fallback（§4）。

## 3. 缓存与 Credits 经济学

**缓存 key（三级）：**
```
client:   内存窗口复用（现网 covers() 机制，切日/切点零外呼）           ← 已有
proxy:    wx:{provider}:{lat2dp}:{lng2dp}:{asl}:{anchor_date}          ← ot_weather_cache 30min，已用
          升级：TTL 按提前量分级 D0 30–60min / D+1 3–6h / D+2+ 12–24h
image:    mbimg:{lat2dp}:{lng2dp}:{asl}:{anchor_date}（若启用 Meteoblue 图）← 云存储转存，同一分级 TTL
```
`asl` 必须入 key：山区 80m DEM 自动海拔与真实海拔差一个图。2dp 网格 ≈1.1km，与现网一致。

**外呼预算（100 日活、人均 3 点/日）：**

| Provider | 真实外呼/年 | 成本 |
|---|---|---|
| Open-Meteo | ≈110k 次 | 0（免费额度 1 万次/日） |
| Meteoblue Forecast API | 同上 | ≈4.4–8.8 亿 credits → 付费套餐（€2,400/年起） |
| Meteoblue Image API（若启用槽位） | 极限缓存后 ≥7,300 张 | ≥1.17 亿 credits（16k/张）→ 数千 €/年 |

**结论：Meteoblue 任何形态都是付费项目；免费 10M credits（≈625 张图或 1–2 千次数据）只够试点。**
启动时机建议：留存数据证明"天气/天象是核心价值"之后（见 decision.md）。

## 4. Fallback 链（§20，让系统永不依赖单一来源）

```
正常：    OpenMeteoProvider（V2 现状）
            ↓ 未来
增强：    MeteoblueProvider（主） ──失败/超时/欠费──▶ OpenMeteoProvider（备，自动接管）
槽位图：  Meteoblue Image（预览） ──任何前提不满足──▶ 自绘 meteogram（同一画布换窗）
极端：    全部外呼失败 ──▶ status=unavailable ──▶ 现有 status-panel 空态（保功能不保数据）
```

设计规则：
1. **切换对 UI 零感知**：页面只读 `provider{}` 元信息（页头署名、页脚 attribution 自动变化）；
2. **Fallback 不静默降质**：若 Meteoblue 主源失败回落 Open-Meteo，页头数据源标注如实切换
   （用户应知道他看的是谁家的图——这也是可信度的一部分）；
3. **云海判断的跨源一致性**：sky.js 阈值不因 provider 改变。未来若做"双源互验"
   （两源低云均 ≥80% 才升云海一档），是 conditions.js 的新增规则，不是 sky.js 的改动；
4. **永不使用**：Widget（平台不可用）、爬取/OCR/DOM 解析（明确禁止）、前端直连（key 泄漏）。

## 5. API Key 管理清单

| 项 | 规则 |
|---|---|
| 存储 | 云函数环境变量（微信云开发控制台配置），不入库、不入前端包、不入 git |
| 使用 | 仅在 Provider 实现内拼装请求；日志**不得**打印完整 URL（key 在 query 里） |
| 轮换 | key 泄漏预案 = 控制台吊销重发（meteoblue 支持多 key） |
| 客户端加固 | 不适用——我们根本没有客户端调用；若未来引入直连场景，用 meteoblue 官方 HMAC 签名 + 短时效 |

## 6. 落地顺序（与 weather-ux-design.md §9 阶段对齐）

1. **阶段 1（现状）**：OpenMeteoProvider 事实化——`lib/weather.js` 改名/包一层 Provider 接口 +
   返回体加 `provider{}`；补取 `wind_direction_10m/surface_pressure`；
2. **阶段 2**：V2 页面与组件（与 provider 无关，立即可做）；
3. **阶段 3（可选/付费就绪后）**：MeteoblueProvider（Forecast API）+ Fallback 编排 + 署名切换；
4. **阶段 4（更远，可选）**：「专业天气」槽位接 Meteoblue Image API（三前提见 decision.md），
   或放弃该槽位（自绘已覆盖同一信息）。

---

*相关：[meteoblue-integration-v2.md](meteoblue-integration-v2.md) · [weather-ux-design.md](weather-ux-design.md) · [decision.md](decision.md)*
