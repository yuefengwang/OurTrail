# Meteoblue Meteogram Web POC

**一句话结论：meteogramweb 页面可完全程序化访问（无 Cookie/Referer/登录），但页面上的
Meteogram 不是图片文件——是 Highcharts 用签名 JSON 数据在浏览器画的 SVG。取数据 PASS，
取成品图 FAIL（服务端不存在该文件）。评级：部分可实现。**

详细证据与逐条裁决：**[technical-findings.md](./technical-findings.md)**

## 验证过的机制（4 层 × 4 地点实测）

```
GET /en/weather/forecast/meteogramweb/{slug}_{country}_{id}     → 200 text/html（74KB）
    HTML 内 <div class="image img-scrollable" data-href="...">  → 完整签名图片端点（服务端预渲染进页面）
GET my.meteoblue.com/images/meteogram?lat=&lon=&asl=&apikey=&ts=&sig=&format=highcharts
                                                                 → 200 application/json（541KB，12–13 series）
浏览器 Highcharts 渲染为 SVG（canvas=0）→ 无任何整图 PNG 可下载
```

- 地点自动生成：`GET /en/server/search/query3?query={name 或 "lat,lon"}` → `results[].url` 即 slug；
  slug 文本纯 SEO（乱写也 200），数字 ID 是唯一 key；中文搜索不可用（需罗马名/坐标）。
- 访问控制：页面零要求；图片端点要求 apikey+sig，但签名 URL 由页面每次现成下发（不可自签，去 sig 即 403）。
- 签名 URL 实测 ≥35 分钟可重放；每刷新页面重签；无防盗链。
- 云函数模拟 `fetch-meteogram.js`（零依赖 Node https，与 `lib/weather.js` 同款栈）：4/4 通过，单地点 1.3–2.7 s。

## 文件

| 文件 | 说明 |
|---|---|
| `technical-findings.md` | 四层证据、URL 规律、Q1–Q13、最终裁决（A–J） |
| `fetch-meteogram.js` | 云函数模拟：`node fetch-meteogram.js [meteogramweb-url]` |
| `scripts/browser-network-poc.js` | 浏览器 Network 记录（playwright-core + 系统 Edge；仓库外安装依赖后运行） |
| `evidence/` | HTTP 头存档、403 证据、浏览器全量请求日志、JSON 结构样本、模拟运行输出 |
| `screens/*.png` | 无头 Edge 渲染的 4 地点成品 Meteogram（emeishan/chengdu/litang/daocheng） |

## 复跑

```bash
node fetch-meteogram.js                                   # 数据管线，零依赖
# 浏览器层：见 scripts/browser-network-poc.js 头注释（npm i playwright-core 于仓库外）
```

## 边界

纯技术 POC，零生产代码改动；未伪造签名、未绕过任何访问控制。生产化前需独立评估 meteoblue
Terms/商业授权（不在本 POC 范围，见 technical-findings.md §12）。
