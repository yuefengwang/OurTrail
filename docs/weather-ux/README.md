# Weather UX / V2 —— 天气页重设计与 Meteoblue 集成交付包

2026-10-05 · **零生产代码改动**：本目录全部为新增设计与原型文件（git 状态：仅 `?? docs/weather-ux/`）。
V1（信息架构与组件规格）+ V2（Meteoblue 集成调查与最终决策）两轮交付都在这里。

## 核心原则

> **Meteoblue 告诉用户"天气是什么"，OurTrail 告诉用户"什么时候值得出去"。**
> 专业天气产品负责提供 Evidence，OurTrail 负责解释 Evidence。
> L1 天气事实 → L2 OurTrail 分析 → L3 克制建议，三层不混排；评级最高 ★★★★☆，不给五星。

## 文档索引

| 文档 | 内容 |
|---|---|
| [decision.md](decision.md) | **决策矩阵 + 最终推荐 + 十问十答 + 问题台账**（从这里开始读） |
| [meteoblue-integration-v2.md](meteoblue-integration-v2.md) | Image API/Forecast API/Widget 严肃调查（官方 OpenAPI 规格实证、credits 算账、无中文发现） |
| [meteoblue-visual-integration.md](meteoblue-visual-integration.md) | Meteoblue 截图专业性拆解（§2 七问）+ Option A/B/C 三方案 + 移动端 Meteogram UX |
| [weather-page-v2-design.md](weather-page-v2-design.md) | V2 最终信息架构 + 云层带剖面专章 + 可信度系统 + 三方对比表 |
| [weather-ux-design.md](weather-ux-design.md) | V1 规格：组件设计、数据契约、实现阶段、风险表（仍然有效） |
| [current-weather-architecture.md](current-weather-architecture.md) | 现状分析（数据链路、问题清单、生产 bug 记录） |
| [provider-architecture.md](provider-architecture.md) | Provider 抽象 / NormalizedWeatherData / 缓存 / Fallback / key 管理 |
| [meteoblue-integration.md](meteoblue-integration.md) | V1 概览版调研（被 V2 取代，留档） |

## 原型（可交互，浏览器手机模拟 375×812）

```
prototype/
├── index.html        ← 目录页（从这里进）
├── meteoblue/        ← 原型 1：Option B（Meteoblue 槽位模拟 + OurTrail 分析）
│                        含桌面图 375px 整图缩放 vs 原生宽横滚的可读性实测
├── fallback/         ← 原型 2：Primary（OurTrail 自绘 meteoblue-inspired 时间轴）
│                        24h 一屏 / 48h / 云层带剖面 / 风 / Agenda / Evidence / 数字明细
├── build.js          ← 生成共用引擎包：node build.js（打包生产 astro/sky/format）
├── engine.js         ← 共用：生产天相引擎原样打包（阈值零漂移）
├── mock-data.js      ← 共用：格聂 72h mock 的浏览器导出
└── screens/          ← 9 张关键截图（含 §22 要求的六屏 A–F）
```

两个原型的「OurTrail 分析」都跑**生产的 `utils/{astro,sky,format}.js`**；数据为 mock。

## Mock 数据

```bash
node docs/weather-ux/mock/genie-72h.js     # 自校验 16 项 + 三天概览
```
格聂（29.86N, 99.46E, 3500m）72h：10-06 阵雨转晴夜（云海/光染/彩虹/银河全亮）·
10-07 晴好对照 · 10-08 冷锋降雪。改动后需重新生成 engine.js / mock-data.js（命令见上）。

## 一页结论（decision.md 摘要）

- **Primary（现在）**：Open-Meteo → OurTrail 自绘 meteogram → OurTrail 分析。免费、中文、375px 原生可读。
- **Enhancement（付费就绪后）**：Meteoblue **Forecast API** 做数据源 Provider B（非 Image API），Fallback 自动回落。
- **Image API**：仅「专业预览」槽位候选，三前提（付费 license + 书面条款 + credits 预算）缺一不可；
  整图缩放 375px **实测不可读**（22% 缩放，图例 ≈3.1px）。
- **Widget / Overlay / Scraping**：平台不可行 / 无许可按禁止 / 明确禁止。
- 生产 bug 待修（只记录未改）：`pages/weather buildCallouts` WMO 71–86 判雪把阵雨 80–82 误含。
