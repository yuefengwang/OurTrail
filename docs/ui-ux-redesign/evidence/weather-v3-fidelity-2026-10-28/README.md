# 天气页 V3 保真修正 · 真机（IDE 模拟器）核验

日期：2026-10-28 · 授权：用户明确「你来进行真机验证吧」
范围：本轮 D6–D10（`brand-header` plain/back、两屏品牌条、四视图 tabs 吸顶、5 类天气图标）。

## 环境与通道

| 项 | 值 |
|---|---|
| 工具 | 微信开发者工具（`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`，服务端口 33278） |
| 模拟器 | iPhone 12/13 (Pro) · 390×844 · statusBar 47 + navBar 40 ⇒ 实测品牌条 **87px**（`header-layout.layoutFor()`） |
| 基础库 | 3.8.12（与 `project.private.config` 一致） |
| 自动化 | `cli auto --auto-port 9425`；`miniprogram-automator` 装在仓库外 `%LOCALAPPDATA%\Temp\opencode\mp-auto`（仓库零 npm 依赖） |
| 重编译 | `cli close --project 'D:\OurTrail'` → `cli open --project 'D:\OurTrail'`（**未 `quit`**，未动共享会话的其它窗口） |
| 驱动 | `%LOCALAPPDATA%\Temp\opencode\mp-auto\v3-fidelity-drive.js`（41 条断言，exit 0） |

## bundle 新鲜度自证（先证新包，再谈像素）

三处都只存在于本轮代码，屏幕上出现即证明读的是新 bundle：

1. 屏 1 品牌条底色 **`rgb(255,255,255)`**（旧的默认变体是 `--paper` #F5F5F0）且 `word` 颜色 `rgb(32,42,38)`（`--ink`）；
2. 屏 2 出现 `.brand-header__back`，计算尺寸 **44×44**（本轮新增元素）；
3. `.wv3-tabs` 计算 `top: 87px`，与 `brand-header` 的 `ready` 实测高度相等（本轮新增的 `--wv3-chrome` 链）。

## 用例与读数

### A · 屏 1（weather-hub 首页，根屏）

- 品牌条：`background-color: rgb(255,255,255)`、`position: fixed`、词标 `rgb(32,42,38)`；
- **没有** `.brand-header__back`，有 `.brand-header__mark`（返回键只在能返回的屏出现）；
- 三个 home tab（个人计划 / 常用地点 / 共用路线）。
- 截图 `A-home.png`。

### B · 屏 2 · 真实云函数数据（Open-Meteo，无注入）

- 4 个视图 tab：逐时预报 / 云层剖面 / 沿途天气（单点禁用）/ 日月天相；
- 真实 5 日卡的 `code` = 51/53/51/51/53 ⇒ 图标全部 `rain`；读数 13:00 `rain` / 「毛毛雨」；
- 返回键 44×44；返回态不显示品牌 mark；品牌条白底 `rgb(255,255,255)`；
- 日期条 DOM 图标数 5 = 有 `code` 映射的行数 5；读数条 DOM 图标 1 ↔ `readout.icon='rain'`；
- 吸顶：`position: sticky`、计算 `top: 87px` = `chromeHeight`；
  对照证明（`element.offset()` 是**文档坐标**）：日期卡 169.195 滚动前后不变；tabs 280.195 →（滚 200）**287 = 87 + 200** →（滚到底 522）609；
- 截图 `B-detail-hourly.png`、`B-detail-scrolled.png`（滚 600 后品牌条与 tabs 都在顶部，内容在其下滚过）。

### C · 屏 2 · 生产形状注入（5 类图标矩阵）

用与本仓库 `tools/ab-weather-v3.js` 同构的 ready 返回体（7 天 × 24h + cloudLevels + provider），只把 daily `code` 改成 0/3/61/71/95/45/82、把第 0 天 13:00 的逐时码改成 95：

- 日期条 5 张卡 => `sun / cloud / rain / snow / storm` 五类齐全；
- 读数条 13:00 => `storm`「雷暴」；
- 同一套 DOM/几何断言全过（返回 44×44、bar 白底、tabs sticky top=87、图标计数一致）；
- **污染自证**：与用例 B 的 `updatedAt`/`dayStrip.code` 不同（真实 51/53… vs 注入 0/3/61/71/95），且每例前 `reLaunch`；
- 截图 `C-detail-hourly.png`、`C-detail-scrolled.png`。

### D2 · 沿途停靠点图标（渲染分支，视图夹具）

账号里**没有已保存计划**，不为截图向真实账号写数据 ⇒ 端到端数据路径 **NOT_RUN**。
改用真实 `weather-v3-view.buildRouteFlow` 在 Node 产出视图（雪 08:00 / 雷暴 13:30），注入真机组件：

- `route.stops` 2 个，均带 `weather.icon`（snow / storm）；
- DOM `.wv3-stop` 2、`.wv3-stop-weather` 2、`icon` 2；图标计算尺寸 **16×16**；
- 截图 `D2-route-stops-fixture.png`（沿途 tab 选中、D1 按钮、提示行均正常）。

### D · 沿途停靠点 · 真实计划

**NOT_RUN**：`plans.length = 0`（本机账号无个人/共享计划）。没有通过创建计划来补这一刻度的数据——那会写进真实账号。

## 结论档位

| 项 | 档位 | 依据 |
|---|---|---|
| 屏 1 plain 品牌条 / 无返回 / 三个 home tab | **VERIFIED（E3）** | bundle 新鲜 + 计算样式读数 + 截图 |
| 屏 2 返回键 44×44、返回态无 mark | **VERIFIED（E3）** | 计算尺寸 + DOM 存在性 + 截图 |
| tabs 吸顶且偏移=实测高度 | **VERIFIED（E3）** | `sticky`/`top:87px` + 对照元素的文档坐标证明 + 滚动后截图 |
| 日期条 / 读数条图标（真实数据） | **VERIFIED（E3）** | 真实 `code` 链 + DOM 计数 + 截图 |
| 5 类图标映射 | **VERIFIED（E2+ 渲染）** | 映射本身由单测（22 码 + 7 种缺值）钉住；真机侧用生产形状载荷走真实装配链，非 WXML 桩 |
| 沿途停靠点图标 | **渲染 VERIFIED / 数据路径 NOT_RUN** | 16×16 与 DOM 计数在真机成立；真实计划未提供，未写账号 |
| 真物理手机 | **NOT_RUN** | 本轮只驱动 IDE 模拟器 |

## 缺口 / 未证

- 真物理手机、原生 picker/相册/分享卡、胶囊点击未驱动（与本轮改动无直接关系）。
- 真实数据当日全是雨（51/53），sun/cloud/snow/storm 的**生产数据**样本本轮没有；五类靠注入走真实装配链验证。
- 日期条图标 15px 在 390 宽下偏小但可辨（截图可见），属 D6/D7 既定尺寸，未改。
- `cloudfunctions/` 零改动 ⇒ 不需要重新部署；未 commit / 未 push。

## 复现

```bash
# 需已在开发者工具登录，且 33278 服务端口开启
cli close --project 'D:\OurTrail' --port 33278
cli open  --project 'D:\OurTrail' --port 33278
# 等 ~25s 后
cli auto --project 'D:\OurTrail' --auto-port 9425 --trust-project --port 33278
cd %LOCALAPPDATA%\Temp\opencode\mp-auto && node v3-fidelity-drive.js
```

产物：`readings.json`（逐条断言与读数）、本文件、6 张截图。
