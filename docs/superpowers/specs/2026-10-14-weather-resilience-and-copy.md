# 天气韧性与用户话术（第十三轮）

> 基线 `8c1c57b` · 分支 `win/route-library-v2` · **未推送、未并入 master**
> 触发：用户报告「小程序天气页常常会出现获取天气超时的错误，而且报错信息过于面向开发者——
> 主要使用人员还是户外人员」。用户选 A：**先治超时与话术，不动任何天气判据**。
> **需重新部署 trailApi：是**（`cloudfunctions/trailApi/index.js`、`lib/weather.js` 已改）。
> 真机：**UNVERIFIED**（未重开共享开发者工具会话，按规矩未擅自执行）。

---

## 1. 根因（四层，按用户等待的时序排）

一次「活动 → 天气页」的完整链路在今天（改造前）是这样：

```
onShow → api.read（loadState 15 集合全量）→ getWeather
        → actionGetWeather **又一次 loadState 15 集合全量**（只为找一个活动的坐标）
        → getCachedForecast：weather_cache 30 分钟新鲜窗
        → miss ⇒ fetchForecast：https 外呼 Open-Meteo，**10s 超时即整体失败**
```

| # | 层 | 病症 | 后果 |
|---|---|---|---|
| ① | 活动模式双云调用 + 第二次全量加载 | `actionGetWeather` 用 `store.loadState` 找一个活动 | 冷启动时段墙钟被放大——SYNC.md 记载「当年 3 秒超时的成分之一」正是这种每请求全量动作 |
| ② | 无陈旧兜底 | 30 分钟新鲜窗之外，外呼失败 = 错误墙 | Open-Meteo 一次抖动，用户这一屏就什么都没有 |
| ③ | 客户端零重试 | 瞬时故障也要用户自己点「重新查询」 | 「常常超时」的主观感受来源：每次抖动都是一次完整失败 |
| ④ | 话术面向开发者 | `-504003` → 「请重新上传部署 cloudfunctions/trailApi（config.json 已调至 20 秒），或在云开发控制台 → 云函数 → trailApi → 配置中把超时改为 20 秒」 | 户外人员在现场没有任何可行动作，只会判断「工具坏了」 |

判据零改动是本轮前提：`sky.js`/`conditions.js`/`outdoor-intelligence.js`/云场渲染全部未碰，
`tools/` 里所有天气判据套件（sky / cloud-position / oi-claim-gate / cloud-field-geometry …）读数不变。

## 2. 修法

### 2.1 话术（`miniprogram/utils/api.js`）——面向户外人员

- `transportText(errMsg)` 按成因给「下一步」，**不含任何部署/控制台/错误码字眼**：
  - `not found` → 「服务暂时连不上。请检查网络；若刚更新过小程序，关掉再打开试试。」
  - `-504003` / `FUNCTIONS_TIME_LIMIT` / `timed out` → 「等了太久没连上服务器。山里信号不稳时容易这样，请再试一次。」
  - 其他 → 「网络不太稳，请稍后再试。」
- `humanizeInternal`（内部异常）→ 「服务临时出了点问题，请稍后再试。若反复出现，请反馈给我们。」
- 无 result → 「服务没有响应，请稍后再试。若刚更新过小程序，关掉再打开试试。」
- **技术原文不消失，只不进界面**：`err.raw` + `console.warn('[api] 云函数调用失败：', errMsg)`。
- **错误码语义不变**（NETWORK / INVALID_INPUT / …），`outcomeUnknown`/`needRefresh` 纪律不动，
  `tools/failure-semantics-test.js`（37 断言）照旧全绿——话术换字不换语义。

### 2.2 自动重试（`pages/weather/weather.js`）——读操作才配重试

- 瞬时故障自动重试 **2 次**（间隔 1.2s / 2.6s）：传输层 `code=NETWORK`（超时/断网/未部署）
  与云端 `status:'unavailable'`（Open-Meteo 超时/5xx）。
- **安全性依据**：天气是读操作，云端有 30 分钟缓存兜底，重试多数命中缓存、成本近零；
  与 `dispatch` 的「超时=结果未知、绝不自动重发」不冲突——那条纪律属于**写**。
- `out_of_range` 是确定性业务态（日期超出 14 天），**不重试**（重试改变不了日期窗口）。
- 重试期间加载面板显示「网络不太稳，正在重试（第 N 次）…」——不让用户对静止界面猜。
- **令牌纪律**：`this._wxToken` 每次开查 +1；切点/切日使旧链路作废，迟到的响应与重试都不落页面
  （否则慢响应会覆盖新点的数据，这是并发页面最常见的穿帮方式）。

### 2.3 软降级（新增 `miniprogram/utils/weather-cache.js`）——旧数据好过错误墙

全部尝试失败后，同一个点、同一天、12 小时内取到过的预报照常展示：

- 注入式 storage 工厂（`createWeatherPoints(storage, now)` 同款先例）：页面注入 `draft.wxStorage`，
  测试注入内存 Map + 假钟 ⇒ wx-free 可测。
- scope = `point.id@lat.toFixed(2),lng.toFixed(2)`——与云端 `weather_cache` 的 2dp 网格同口径，
  换点换日期都不误命中（`wp-local` 这类复用 id 靠坐标区分）。
- **CAP=6**：单条目约百 KB（168h series + cloudLevels），wx 单键上限 1MB。
- **只收 `status==='ready'`**；unavailable 没有展示价值。
- **`MAX_AGE_MS = 12h`**：更旧的旧预报不冒充现在的天气（云层时过境迁）。
- 页面横幅：「没能连上气象服务（已重试 N 次）。先显示 X 小时前取过的数据，连上后再点「重新查询」刷新。」
- **三条守令（都有断言）**：① 照常展示；② 时效必须署名；③ **不写 `_lastResult`**——
  否则随后的重试会被 `covers()` 直接复用旧数据，用户点「重新查询」也拿不到新数据（最像"对"的错）。

### 2.4 云端陈旧兜底（`cloudfunctions/trailApi/index.js`）

`getCachedForecast` 外呼失败时：12 小时内的旧预报**软降级返回**，带 `stale:true` + `staleAt`；
超过 12 小时或无缓存才把失败交出去。两个天气 action 透传（`actionGetWeather` 直接加字段，
`pointResponse` 加字段），旧客户端不读这两个键。

页面侧（`onWeatherReady`）：`result.stale` 时出同样的时效横幅，且**页脚「更新时间」改取
`staleAt`**——不拿本次响应时间冒充数据取数时间。

### 2.5 活动模式瘦身（`actionGetWeather`）

改按 docId 直读 `ot_activities`（`recordKey` 对 activities 就是 `record.id`，与
`loadCollection` 读到同一份文档）：**15 集合全量加载归零**，天气页第二次云调用从
「全状态 + 坐标查找」变成「一次文档读」。

读故障与「文档不存在」分开（`ensureMeta` 的同款纪律，store.js:88-106）：
后者 `NOT_FOUND`（与改造前同一语义），前者原样抛出归 `INTERNAL`——
不把「这一刻读不出来」冒充成「活动不存在」。

## 3. 门禁与自证

新增 `tools/weather-resilience-test.js`（**45 断言**）：

| 节 | 钉住什么 |
|---|---|
| §1 缓存纯函数 | 往返/深拷贝/换点换日不误命中/只收 ready/坏数据不抛/CAP=6 淘汰最旧/ageText 分档/假钟注入 |
| §2 页面行为 | ① 瞬时失败→自动重试成功且出现过「正在重试」；② 持续失败恰好 3 次尝试 + 友好文案 + `emptyKind='error'` + **无开发者术语**；③ 软降级三守则（展示/时效横幅/不写 `_lastResult`/手动重试真外呼）；④ 13h 缓存不用；⑤ `out_of_range` 只调一次；⑥ `unavailable` 也重试；⑦ 成功即写缓存；⑧ 令牌作废迟到响应 |
| §3 云函数 | 新鲜缓存零外呼；3h 旧缓存兜底（`stale`/`staleAt`/数据就是旧缓存）；13h 不兜底；无缓存明确失败；**活动模式只碰 `ot_activities`+`weather_cache` 两个集合**、全量状态集合零读取；NOT_FOUND 语义不变；读故障归类 INTERNAL 不冒充 NOT_FOUND |

`tools/scenario-api-test.js` §1–2 增加 `DEV_JARGON` **反向门**（+2 断言）：
部署/上传并部署/控制台/cloudfunctions/504003/FUNCTIONS_TIME_LIMIT/trailApi/Require stack
一律不得出现在用户可见 message 里；同时断言原文在 `e.raw` 里取得到（不靠删信息换干净）。

**全量复跑实测：66 套件 / 4498 断言**（各脚本自己打印的 `passed=` 之和，非增量外推）。
65 套 exit 0；`tools/e2e-golden-path-test.js` GP-01 红——**先于本轮存在**：
`git stash` 干净基线上同款复现（`passed=12 failed=2`、同行号 NO_REVISION）⇒ 归属清楚，
按「不动公共门禁」纪律未修，留用户裁决。天气线常驻非确定性红 `outdoor-intelligence-ui`
本轮复跑 47/0。

## 4. 边界与未做（留裁决）

1. **真机 UNVERIFIED**：所有结论停在 node 门禁层。横幅渲染、`.stale-retry` 在警告色 callout 里的
   观感、真机超时分布，都要重开开发者工具会话后按 `docs/e2e-mp/` 驱动复核。
2. **`e2e-golden-path` GP-01 红未修**：公共门禁夹具问题（`passed=12 failed=2`），
   先于本轮存在；修它要动共享夹具，未擅自改。
3. **客户端缓存只在失败路径出场**：未做 stale-while-revalidate 首屏（成功路径零变化是
   本轮验收前提；SWR 会改变首屏时序，值得单独一轮 + 对拍）。
4. **Open-Meteo 配额/节流（F-9）**：可靠性轮登记未做，本轮也未做——合理上限要按真实页面
   扇出量定，拍数字有把有效功能改坏的风险。
5. **`outdoor-intelligence-ui` 的非确定性**：与本轮无关，维持归档归因。
6. **`route.js` 分段天气的失败文案**（'天气查询失败，请稍后重试。'）本轮未动——它已经是
   用户向话术；与天气页共享重试/缓存属下一轮候选。
