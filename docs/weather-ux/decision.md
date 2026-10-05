# Decision —— Meteoblue 集成决策矩阵、最终推荐与问题台账

日期：2026-10-05 · 依据：[meteoblue-integration-v2.md](meteoblue-integration-v2.md)（官方 OpenAPI/条款核实）·
[meteoblue-visual-integration.md](meteoblue-visual-integration.md)（可读性实测）· [provider-architecture.md](provider-architecture.md)

> 本文只做决策，不复述论据。产品总纲：**Meteoblue 告诉用户"天气是什么"，OurTrail 告诉用户"什么时候值得出去"。**

---

## 1. 决策矩阵（§25）

| 方案 | 技术可行性 | 微信小程序适配 | 商业使用 | 自定义能力 | 数据可用性 | 移动端 375px | **裁决** |
|---|---|---|---|---|---|---|---|
| **Widget**（网页嵌件） | web iframe/JS | ❌ 无 web-view 权限/无法配置业务域名 | 免费+署名回链（条款未公开细列） | 无 | 不可提取（禁止） | — | **排除（平台性不可行）** |
| **Image API**（整图嵌入） | ✅ 后端代理+转存可行 | ⚠️ 可行但体验受限 | 16,000 credits/图；修改/裁剪/overlay/缓存**未获公开许可**（保守按禁止）；`no_logo` 需付费 | 零（英文界面，lang 无中文） | 图像像素，无数据 | ❌ **实测不可读**（22% 缩放，图例 ≈3.1px） | **不作主路径**；仅作「专业预览」槽位候选（三前提，见 §3） |
| **Forecast API**（数据自绘） | ✅ 与现网 Open-Meteo 代理同构 | ✅ | credits 按包计，正式量级需付费套餐（€2,400/年起） | 完全（中文/密度/叠加/剖面） | ✅ 全变量 + 多模型 mLM | ✅（自绘） | **未来主数据源（预算就绪后）** |
| **自建 Meteogram**（Open-Meteo → OurTrail 自绘） | ✅ 全链路现成 + 原型已验证 | ✅ | CC BY 4.0 署名即合规（零金额产品安全） | 完全 | ✅ | ✅ 一屏 24h 实测可读 | ★ **现在的答案** |
| **Scraping**（抓 HTML/OCR/解 DOM/绕授权） | — | — | **明确违反授权与任务禁令** | — | — | — | **✗✗ 永不**（对 meteoblue 或任何源） |

## 2. 最终推荐（§26，明确的决策）

**Primary（现在就上线）：Open-Meteo → OurTrail 自绘 Meteogram → OurTrail Analysis。**
即 V2 页面（[weather-page-v2-design.md](weather-page-v2-design.md)）以自绘时间轴为「专业天气」槽位的当前内容——
fallback 原型就是它的可交互形态。

**Enhancement（预算就绪后）：Meteoblue Forecast API 作为 Provider B 接入数据层**（不是 Image API）：
后端代理 + §3 缓存策略 + Fallback 自动回落 Open-Meteo；UI 与 sky.js 分析零改动。
价值：mLM 多模型后处理补"山区低云"这个云海判断最弱一环。

**Meteoblue Image API（若启用「专业预览」槽位，三前提缺一不可）：**
1. 付费 license（credits 预算按 ≥7,300 张/年 ≈ 1.17 亿 credits 计）；
2. 商务**书面**确认：缓存、`<image>` 展示、attribution 替代方案（小程序内无法可点击回链）、外文图的可接受性；
3. 用户可一键回到自绘图（默认视图仍是 OurTrail 自绘）。
不满足任一 → 槽位继续由自绘图顶替（页面结构无需任何改动）。

**Option C（meteoblue 图 + OurTrail overlay）：禁止。** 修改/裁剪/叠加未获许可；且自绘已原生实现
同图分层的等价体验，无授权风险。

## 3. 问题台账（§28：只记录，不修改生产代码）

| # | Potential Issue | Location | Why | Suggested Fix |
|---|---|---|---|---|
| 1 | **WMO 雪码误判阵雨**：14–17°C 的阵雨日触发「0℃ 层低于此点，降水可能为雪」（用户截图 1 可见此 callout 出现在 10-06） | `miniprogram/pages/weather/weather.js:36` `buildCallouts`（`code >= 71 && code <= 86`） | WMO 80–82 是**阵雨**；71–77 雪、85–86 阵雪 | 范围改为 `(71–77) || (85–86)`；两处原型（fallback/meteoblue）已内置修正规则可作对照 |
| 2 | **云海窗口含深夜小时**：mark 在 01:00–05:00 也打标，结论出现「清晨 01:00–08:00」 | `utils/sky.js` cloudSea 判定（无昼夜条件）+ 展示层直接聚类 | 凌晨的云况成立但不可见，观感失真 | 展示聚合处（agenda/conditions）与民用晨昏取交集；**不动 sky.js 阈值** |
| 3 | 风/湿度无时序表达 | `components/meteogram`（无风行） | wind/gust/rh 数据在库未画 | V2 时间轴加风 row（风向箭头+数值） |
| 4 | 结论依据无结构化出口 | `sky.summarize`（依据拼在 text 字符串里） | Evidence 面板需要逐条事实 | 展示层 `factsFor` 映射（weather-ux-design.md §9.4），sky.js 不动 |
| 5 | 云函数未取 windDir/pressure/dewPoint | `cloudfunctions/trailApi/lib/weather.js` HOURLY | V2 风 row 与数字明细需要 | HOURLY 增 `wind_direction_10m,surface_pressure`（additive） |

## 4. 十问十答（§29）

1. **Meteoblue 能提供截图 2 的 Meteogram 吗？** 能。官方 `my.meteoblue.com/images/meteogram`（5 日）/
   `meteogram_extended`（7 日）返回的正是该图：温度曲线/降水柱/云量垂直剖面/风羽/昼夜底，二进制 PNG/WebP。
2. **Image API 适合 OurTrail 吗？** 作为主路径**不适合**：16k credits/图（免费年额度≈625 张）、lang 无中文、
   375px 实测不可读、修改/缓存条款未公开。仅可作付费+书面确认后的「专业预览」槽位候选。
3. **Forecast API 是否更合适？** 是。数据→自绘，中文/密度/叠加/剖面全部可控，与现网代理同构；
   未来接 Meteoblue 走这条。
4. **Widget 适合微信小程序吗？** 不适合，技术性出局（个人主体无 web-view；企业主体也无法把
   meteoblue.com 配为业务域名）；widget 数据提取属禁止行为。
5. **商业使用限制？** 按 credits 计费；免费档 1 年 10M credits；正式使用自 €2,400/年起（含强制支持档）；
   key 必须私有、默认限速 500 次/分钟；修改/裁剪/缓存许可未公开，须商务书面确认。
6. **允许缓存/裁剪/overlay 吗？** 缓存：未公开明示（Maps 类默认禁止），须确认后实施并做短窗；
   裁剪/overlay：**无公开许可，按禁止处理**——Option C 因此出局。
7. **API key 放哪？** 云函数环境变量，绝不入小程序前端（包可反编译）；日志不打完整 URL。
8. **Meteoblue 应出现在页面哪个位置？** 若接入：7-Day 与 24h Timeline 之间的「专业天气」槽位
   （信任锚 + 多天过程），OurTrail 分析永远在其下。当前该槽位由自绘图顶替。
9. **OurTrail 自己负责什么？** 解释与决策：云层带剖面 + 观景点海拔线、天相窗口、Outdoor Agenda、
   评级/证据链、克制的建议——以及全部中文与移动端体验。
10. **最终推荐架构？** **Primary：Open-Meteo + OurTrail 自绘（现在）；Enhancement：Meteoblue Forecast API
    供数据（付费就绪后）；Image API 仅作三前提槽位候选；Widget/Scraping/Overlay 排除。**

---

*配套交付：`prototype/fallback/`（Primary 形态）· `prototype/meteoblue/`（槽位形态 + 可读性实测）· 截图 `prototype/screens/01–09`*
