# 天气日级现象：白昼派生码 + 雾码佐证门（实现级设计）

- 日期：2026-10-28
- 上游核验：`docs/weather-ux/qa/v2-meteoblue-consistency-2026-10-28/README.md`
- 决策：用户选 A —— 云端给 `days[]` 增加白昼派生码，四个消费面统一读它；夜间逐时不动
- 状态：**已实现并部署（2026-10-28，未 commit）**；落地结果见 §7

## 1. 为什么 / 在哪一层

**缺陷**：`daily.weather_code` 是全天 24h 最严重的码，夜里 00:00–03:00 的雾会把整日徽标染成「雾」。
折多山 16 天里 7 天日码=雾，其中 5 天白天 ≤3 码且日照 ≥6h；同时 43 个雾小时里 19 个 RH<90%
（最低 51%），即**雾码本身缺少物理佐证**。低海拔对照（成都 501 m）16 天 0 个雾小时 ⇒ 高海拔系统性问题。

**分层**：日级代表性现象是**投影（L2）事实**，不是页面文案，所以派生在云函数 `lib/weather.js`，
与 `days[]` 一起下发；页面只做 WMO 码 → 中文的渲染。理由：
① 四个消费面（天气页 / 活动摘要 / 路线分段 / V3 日条）都在客户端，分散计算会抄三份判据；
② 客户端拿不到「哪一小时属于白昼」的统一口径而不重复实现日出日落；
③ 与既有 `band`、`cloudLevels` 的立场一致——派生事实在云端，文案在 `format.js`。

**不改的**：`days[].code` 原值保留（安全条款 `conditions.js` 的雷暴/雪判据继续读它）；
逐时 `code`、逐时图表、`detail`/`series` 的值一律不动。

## 2. 口径定义（唯一出处，纯函数）

### 2.1 白昼窗口

```
window(day) = hourly.time 的 HH:mm ∈ [day.sunrise, day.sunset]
```

- `sunrise/sunset` 取同一次响应的 `daily.sunrise/sunset`（`lib/weather.js:36` 已在请求里，
  `:182` 已截成 `'HH:mm'`）。两端闭区间。
- 缺失 / 非法（极昼极夜、provider 缺字段）→ 回退固定 `08:00–18:00`，并**不下发**任何标记说明，
  因为窗口只影响徽标，不影响安全条款；测试固定这条回退。

### 2.2 雾的佐证门（三证齐全才算雾）

```
fogConfirmed(hour) = code ∈ {45,48} AND rh ≥ 90 AND visibility < 1 km
```

- 三证缺一即不算雾。阈值 90 与 1 km 是本设计**唯一新增的数字**，理由用样本说话：
  折多山被证伪的雾小时 RH 67–89（10-28 00:00 为 67%、能见度 0.54 km——只凭能见度会误判）；
  被证实的雾小时 RH 91–100（11-01 21:00 RH 91 / 0.36 km）。90 是这两簇之间的保守取整。
- 逐时 `code` **不回改**：provider 说那一小时是雾，逐时表照印；「不回改」避免我们改写 provider 事实。
  只有**日徽标**与**入云提示**两处消费这个布尔。

### 2.3 日级代表码（three-tier）

```
pool = window 内的小时，排除 (code∈{45,48} 且 !fogConfirmed)  —— 未被佐证的雾不参与
若 pool 为空 → 回退 provider 的 daily.weather_code（失败关闭到旧行为）

1) 恶劣天气一票否决：pool 内出现 雷暴 95–99 / 雪 71–77、85–86 / 冻雨 56–57、66–67
   → 取窗口内最严重的那一个码（安全优先，绝不能把雪藏成多云）
2) 否则取众数（raw WMO 码）；并列时取**较大**码（多云优先于晴，不替天气说好话）
3) 仍为空 → provider 日码
```

对目标点的实测结果（同一份线上返回体）：

| 日期 | provider 日码 | 现日卡 | 新 `dayCode` | 新日卡 | 白昼最差码 | 日照 |
|---|---|---|---|---|---|---|
| 10-28 | 45 | 雾 | 0 | 晴 | 2 | 11 h |
| 10-29 | 45 | 雾 | 0 | 晴 | 1 | 11 h |
| 10-30 | 45 | 雾 | 1 | 多云 | 2 | 11 h |
| 10-31 | 2 | 多云 | 0 | 晴 | 1 | 11 h |
| 11-01 | 45 | 雾 | 0 | 晴 | 1 | 11 h |
| 11-02 | 51 | 毛毛雨 | 51 | 毛毛雨 | 51 | 10 h |
| 11-03 | 85 | 阵雪 | 85（一票否决） | 阵雪 | 85 | 9 h |

**10-30 是并列（0×4 / 1×4 / 2×3）取较大码 → 多云**，不是 bug：两个相邻云量码没有谁更「对」，
按「不替天气说好话」取多云。11-02 / 11-03 是正向对照：毛毛雨与阵雪一条都不能被藏掉。

## 3. 改哪里（文件清单与契约）

### 3.1 云端（`cloudfunctions/trailApi/`，改后必须重新部署 + `node tools/sync-lab.js`）

| 文件 | 改动 |
|---|---|
| `lib/weather.js` | 新增纯函数 `fogConfirmed(h)`、`representativeDayCode(hours)`；`hourView` 增加 `fog: boolean`；`fetchForecast` 在 `outDays` 每项增加 `dayCode`。**`code` 原值保留** |
| `smoke-test.js` | 新增一组断言（见 §4.1） |

契约（additive，全部可缺省）：

```js
days[i] = { date, code, dayCode, tMax, tMin, windMax, precipSum, precipProbMax,
            precipHours, sunrise, sunset, uvMax, cloud }   // + dayCode: number
series[i] / detail[i] = { ..., code, fog }                  // + fog: boolean
```

### 3.2 客户端（`miniprogram/`）

| 文件 | 改动 |
|---|---|
| `utils/format.js` | 新增 `dayCodeOf(day)`（`dayCode` 存在则用，否则回退 `code`）与 `dayPhrase(day)`；导出 |
| `pages/weather/weather.js:1400` | `phrase: F.dayPhrase(day)` |
| `utils/weather-brief.js:55` | `const phrase = F.dayPhrase(day)` |
| `pages/route/route.js:235` | `const phrase = F.dayPhrase(day)` |
| `utils/weather-v3.js:198` | `icon: F.weatherIcon(F.dayCodeOf(d))`（`code` 字段也换成派生码，保持自洽） |
| `utils/conditions.js:62` | 入云提示的能见度分支改读 `h.fog === true`；字段缺失（老缓存）时回退旧表达式 `visibility < 1`，并在注释写明这是 ≤30 min 的过渡态 |

**不做**：不改 `daily.weather_code` 请求参数、不改 `detail/series` 的 `code`、不改任何阈值常量、
不改 `sky.js`/`oi-*`（它们读逐时 `code`/`band`，与本次无关）。

### 3.3 文档

`SYNC.md` 新增条目（根因 + 修复 + 断言数 + **需重新部署 trailApi**）；
`AGENTS.md` 的门禁清单仅在断言数变化时更新。

## 4. 怎么验

### 4.1 单元（`smoke-test.js`，纯函数，不联网）

1. 夜间雾 + 白天晴（10-28 的真实逐时形状）⇒ `dayCode=0`，且 `days[].code` 仍为 45；
2. 全天可信雾（每时 45 / RH 100 / 0.3 km）⇒ `dayCode=45`；
3. 未被佐证的雾（45 / RH 67 / 0.54 km）⇒ 不进 pool；
4. 毛毛雨占多数 ⇒ `dayCode=51`；阵雪一小时 ⇒ `dayCode=85`（一票否决）；
5. 窗口用日出日落：日出 07:15，06:00 的雾不参与；缺 sunrise/sunset ⇒ 08–18 回退；
6. 并列取较大码（0×4/1×4 ⇒ 1）；
7. `fog` 真值表：`45/89/0.2 → false`、`45/90/0.9 → true`、`3/100/0.1 → false`、缺字段 → false。

### 4.2 页面级（`tools/weather-page-test.js` 增 3–4 条）

- 带 `dayCode` 的 `days[]` ⇒ 日卡文案按派生码；
- 不带 `dayCode`（旧缓存/旧云端）⇒ 回退 `code`，页面不空、不报错；
- `conditions.buildCallouts`：RH 67 的夜间雾小时不再出「入云（雾）」；RH 95 + 低云贴地仍出。

### 4.3 对拍（一次性，仓库外）

改前侧 `git archive HEAD` 到临时目录，两侧喂**同一份真实返回体**：
- 必判零差异：`days[].code`、全部逐时字段（含 `code`）、`cloudLevels`、`series/detail` 长度；
- 必判有变化：目标 4 天（10-28/29/30、11-01）日卡从「雾」变为白昼现象；
- **阳性对照**：11-03 仍为「阵雪」、11-02 仍为「毛毛雨」（证明不是一刀切抹掉雾）；
- 空改门：若 4 天一个都没变 ⇒ exit 1。

### 4.4 部署与真机

- `cloudfunctions/` 改动 ⇒ 重新部署 `trailApi`（`sync-lab.js` 同步 lab），部署后核对线上包与工作树逐文件 diff 为空；
- 真机：需授权 `close --project` → `open` 重编译，再读日卡文本与逐时行。未授权则本项记 **NOT_RUN**，
  不拿「代码路径正确」冒充像素证据。

## 5. 边界、风险、未决

1. **老缓存 / 老客户端**：`weather_cache` 正常命中 30 min、陈旧兜底最长 12 h；旧返回体没有 `dayCode`
   ⇒ 客户端回退 `code`，仍显示旧徽标，属预期过渡；不 bump 缓存键（避免全量冷启动外呼）。
2. **provider 日码仍保留**：`conditions.js` 的雷暴/雪判断读 `days[].code`，行为零变化。
   这意味着**日码里 45 仍可能触发别的下游**——本轮已逐个 grep，只有徽标与入云提示两处消费现象码，其余不再有。
3. **窗口口径**：日出→日落取 provider 的日升日落（海平面地平线），与我们页面的地形下沉修正（约 8 min）
   不同源；只用于「哪一小时算白天」，不印时间，故不引入第二个日出日落事实。
4. **雾门阈值**（RH 90 / 1 km）是唯一新增数字，已按样本选在两簇之间；若后续拿到探空/站点观测
   可再校准，未校准前只作用于日徽标与提示，不改逐时码。
5. **未验证**：真机像素、meteoblue 日图标算法、Open-Meteo 雾码生成内部机制；三项均已在
   上游核验报告中登记为 UNVERIFIED，不在本轮修复的声明范围内。

## 6. 停止条件

- 单元与页面级断言全绿、对拍三条门通过、`check.js`/`check-handlers` 全过；
- 云端已部署且线上包 diff 为空；
- 真机若未授权，报告中该行保持 NOT_RUN，不改写成通过。

## 7. 落地结果（2026-10-28）

- 云端：`lib/weather.js` 新增 `fogConfirmed` / `representativeDayCode` / `visibilityKm`（逐时与日级共用取整），`hourView.fog`、`days[].dayCode` 均为 additive；`code` 与逐时数值原值不动。
- 客户端：`format.dayCodeOf/dayPhrase`；四处消费面改读；`conditions` 的入云提示带旧缓存回退。
- 读数（脚本自打印）：`smoke-test 283/0`（§15b +19）、`weather-page-test 227/0`（§14 +8）、
  对拍 `ab-daycode.js 14/0`。目标点实测：10-28/29、11-01 雾→晴，10-30 雾→多云，10-31 多云→晴；
  11-02 毛毛雨、11-03 阵雪两侧一致。
- 对拍器修正记录：第一版把在途 300 hPa 补丁打在 `cloudBandAt` 上，报出 band 假差异；
  现已只改 `buildCloudLevels`，并加「cloudBandAt 仍扫 CLOUD_LEVELS」的基线门。
- **部署**（2026-10-28，用户选 A 授权后执行）：`cli cloud functions deploy` → 30 files / 142.6 KB；`info` = `Active / timeout 20 / Nodejs16.13`；下载线上包后与工作树 `diff -r --strip-trailing-cr`（排除 `node_modules`）**为空**；在下载下来的包上跑自带 `smoke-test` = 283/0。整目录上传会连带工作区在途的 V3 个人计划（`plan.*` / `ot_plans`），该批 `plans-test 53`、`e2e-permission 96`、`e2e-domain-negative 86` 等全绿，已单列在 SYNC.md。
- **真机 VERIFIED**（2026-10-28，IDE 模拟器，`close --project` → `open` 重编译，未 `quit`；自动化端口 9428，驱动 8 断言 / 0 失败）：折多山 7 日条 = 多云/晴/晴/晴/多云/毛毛雨/阵雪，同刻 provider 码 45/45/45/1/45/51/85 ⇒ 5 天 provider 仍是雾而卡上一个雾都没有（同时是 bundle 新鲜度自证）；逐时带 00:00、03:00 仍为「雾」（夜间逐时不动）；无「此点可能入云（雾）」。证据 `docs/ui-ux-redesign/evidence/weather-daycode-2026-10-28/`。
- **仍未做**：commit/push；`trailApiLab` 本轮未部署（沙盒暂不认识 `plan.*`，不影响线上）；物理手机与 375 宽未跑。
