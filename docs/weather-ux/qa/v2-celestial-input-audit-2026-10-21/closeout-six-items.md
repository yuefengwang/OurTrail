# 天相输入审计 · 六项收口（2026-10-21）

> 接 `README.md`（输入充分性审计）与 `precision-report.md` / `legal-review.md`。
> 本文记录用户列出的六个未完成项各自落到哪、怎么验证、还剩什么。
> **不是法律意见；也没有真机像素证据。**

## 0. 一句话

六项里，代码能做的五类已收口：主卡/图表/OI/日程共用同一份标记与增强输入；总评只让“判过且非 unknown”的天相投票；缺测有可见降级；新增源做了量级校准并修掉两处真缺陷；隐私页/署名/位置描述补齐；`getSkyContext` 有按用户的日配额，DarkSkySites 另有全局月预算与 30 天过期重取。**微信后台隐私指引、跨境/PIPL 判断、真正可点击的外链**仍需管理员/法务，不在代码内。

## 1. 一致性收口：同一份输入、同一批标记

| 面 | 输入 | 代码 |
|---|---|---|
| 结论卡 | `sky.summarize(skyCtx)`，含 `detail` + 跨夜 `series` + `cloudLevels` + `spatial/terrain/atmosphere/lightPollution` | `pages/weather/weather.js` 的 `applyWeather` |
| 主图标记 | `buildChartMarks(..., skyLive)` 把同一份 `terrain/lightPollution/atmosphere/spatial` 传给 `sky.hourMarks` | `weather.js:1287` 起 |
| OI 卡 | 直接消费 `this._chartMarks`（不再自己算一套） | `weather.js` 的 `buildOiCard` / `buildOiDays` |
| 日程 L2 | 同一份 `chartMarks`；L2 的星级按 `summarize` 的同 key 结论取 | `agenda.buildDayAgenda({ marks: chartMarks })` |
| OI 的 fallback 路径 | 不传 `marks` 时，`sky.hourMarks` 也必须拿到 `cloudLevels/terrain/lightPollution/atmosphere/spatial` | `utils/outdoor-intelligence.js:634-648` |

- `sky.hourMarks` 的银河已经与主卡共用同一道地形门（银心高度必须高于该方位山脊 +1°），见 `utils/sky.js:487`、`tools/sky-test.js` §19。
- **新增行为测试**：给 OI 的 fallback 喂一份“晴朗低月夜 + 89° 山脊”，银河窗口必须消失；不喂山脊时必须存在。若 fallback 漏传 `terrain`，第二条会红（`tools/outdoor-intelligence-test.js` §Fallback，37/0）。
- **边界**：时空天相图在本轮进行中被并行工作区整体移除（组件、页面注册、测试均删除），因此不再宣称“逐节点与主卡同源”。当前保留的是主卡/主图/OI/日程四者同源；OI 的夜间窗口仍只按云/月照判，`nightLimit` 如实写“光污染/地形已用于主结论卡”。

## 2. 总评语义：unknown 不是 0 分，被排除的不投票

`utils/conditions.js:88` 的 `overallGrade` 现在：

1. 先剔除 `light`（它不是一个天相）。
2. `excluded`（判过、必要条件不成立）不进入分数池；`unknown`（缺数据、判不出）也不进入。
3. 星空与银河同时可判时只算银河一次，避免同一类双计。
4. 没有任何可判读项：
   - 有 `excluded` ⇒ “条件较差”（判过了，只是没戏）；
   - 全 `unknown` / 空清单 ⇒ “数据不足”（不冒充条件差）。
5. 页面据 `insufficient` 显示“可判读的天相不足，未给总评；这不是‘条件差’”。

回归在 `tools/weather-v2-test.js` §6（71/0）：unknown 不拉低、被排除不投票、空/全 light → 数据不足、全 excluded → 条件较差、去重后分数可复算。

## 3. 缺失/部分失败可见

- `loadSkyContext` 有三态：加载中（`skyInputLoading`）、部分缺失（`skyInputNote` 点名缺哪几项）、整块不可用（保留旧口径并说明）。
- 每源 `sources` + `stale` 都会上屏；光污染无 key/401 时不是“天空很暗”，而是 `lightPollution:null` + 星/银河封顶 69 + “未计入光污染”。
- 被沉默的结论卡由 `condSilent` 点名（“不是没数据，是判过不成立”）；`unknown` 的卡仍出，并说明缺什么。
- 配额用尽也走可见路径：`reason:'rate_limited'` + 可行动文案，而不是笼统“没取到”。见 `weather.js:537-545`。

## 4. 真值/校准：能做的量级核对与两处真缺陷

已完成（详见 `precision-report.md` 与两份 JSON）：

- **7Timer 透明度标尺反向**：官方定义“数值越小/越蓝越好”，旧实现反着用。已改为 ≥6 扣分、≤3 加分；高原干燥点 1–2 为“好”，三亚 8 为“差”。`sky-test` §20 钉住方向。
- **`Number(null) === 0` 把“无海拔”当海平面 0 m**：不传海拔时出 71.8°/76.51° 假山脊。已改为只接受真正的 `number`；不传海拔由 DEM 回填 2860 m（峨眉）/4019 m（理塘），假山脊消失。`sky-context-test` §3 覆盖，无效读数留在 `invalid/`。
- **满月 + 通透天空的银河 4 星与“不建议”打架**：月照有效值 ≥35 时封顶 69。
- DarkSkySites 8 点（城市/山顶/高原/海岛/暗空）Bortle/SQM 量级与相对排序合理；7Timer 云量与 Open-Meteo 在阿里/三亚分歧大 ⇒ **7Timer 云量不进入生产判据**，只用透明度/seeing；DEM 90 m 未对照独立 DEM；方向云无雷达实况。

**没有做、也不能从仓库做**：站点实测 SQM/ASOS/雷达/seeing 的绝对校准。所有“合理”都是量级/自洽核对，不是精度标定。

本轮顺带修掉一个缓存缺陷：光污染缓存原来**永不过期**（`age >= TTL` 只标 stale、不重取）。现在 30 天后重新取，失败才退回旧值并标 stale（`index.js:317-348`），与隐私页写的 TTL 一致。

## 5. 上线/法务：工程侧已做，后台/法务未做

已在代码内：

- 页脚与卡片署名：Open-Meteo（含 URL/CC BY 4.0）、7Timer!（非商业）、CAMS 英文原文、Copernicus DEM 完整版权、DarkSkySites.com（模型估算，非现场实测）。
- 顶部数据区 `Open-Meteo.com` 可点按复制来源链接；页脚有“点按复制数据来源与许可链接”。
- 隐私页：位置（含天气查询点）、第三方数据源与可能跨境、模型值声明、缓存 TTL（本轮补），更新日期 2026-10-21。
- `app.json` 的 `scope.userLocation.desc` 为 28 字（微信上限 30，含“天气查询点”）。
- DarkSkySites key 只在云函数环境变量 `DARKSKY_API_KEY`，不入库、不入客户端、不入日志；测试只用假值。

**仍需人做**（`legal-review.md` §4）：微信后台《用户隐私保护指引》同步；跨境/PIPL 是否需单独同意/PIA；真正可点击的外链（需 web-view 业务域名）；7Timer 若商业化需重新取得许可。**不能宣称法务合规通过。**

## 6. 配额/滥用与页面重量

### 6.1 每用户日配额

`index.js:356-366`：按 openid 的 sha256 前 16 位 + 北京日期做 `q_<who>_<day>` 计数，60 次/天；第 61 次返回 `status:'unavailable', reason:'rate_limited'`，四块增强输入均为 `null`，**在任何 https 外呼之前返回**。

- 计数按请求数而不是外呼数：成功源会被 `s_/t_/a_/l_` 缓存吸收，失败结果不缓存（下次仍重试），宁可少给、不放大上游。
- 客户端把 `res.message` 上屏（`weather.js:537`），不会把配额用尽伪装成“没取到”。

测试：`tools/sky-context-test.js` §6，前 60 次全 ready，第 61 次拒绝且 `httpsCalls` 不增（24/0）。

### 6.2 DarkSkySites 全局月预算 + TTL

`index.js:305-348`：

- 月预算 25,000 次（免费额度 30k/月，留余量）；计数键 `lq_<YYYY-MM>`，只在缓存未命中、确实要外呼时 +1。
- 预算用尽：只把 `lightPollution` 置空、`reason:'budget'`；方向云/地形/大气照常，`status` 仍可 `ready`。
- 无 key 不消耗预算，也不发请求。
- 30 天 TTL 到期会重取；失败才退回 stale 并标 `stale:true`。

测试：同文件 §4（31 天后重新外呼、重取后不标 stale）、§5（预算用尽只停 LP、零 darkskysites 外呼）。

### 6.3 页面重量

- 168 小时完整序列改由实例属性 `this._chartSeries` 持有，不再进 `setData`。WXML 从未读过它；24/48/72h 切窗与“全图展示”直接从内存取（`weather.js:149-150`、`:677`、`:1387`、`:1522`）。
- 测试：`tools/page2-gates-test.js` 断言 `page.data.chartSeries === undefined` 且 `page._chartSeries.length === 168`（98/0）。
- 并行工作区整体移除了时空天相图，顺带消掉了原先最大的一块隐藏组件数据；这不是本轮完成的，不在本报告邀功。

## 7. 部署与线上包核验

- `cloudfunctions/trailApi/index.js` 在本轮改了三次并部署三次（配额接线 → 光污染 TTL/月预算 → 密钥读取收成单源）；最后一次 29 files / 130.4 KB，`info` = `Active / timeout 20 / Nodejs16.13`。
- 部署后下载线上包，`index.js`、`lib/{weather,spatial,terrain,atmosphere,light-pollution}.js` 与工作树逐字节一致（CRLF 归一后 diff 空）。
- `trailApiLab` 不含 `getSkyContext` 与这些 lib，未同步、无需为本次部署。
- **配额/预算是 A 层（桩 + 真 index）验证，不是真云端 61 连击**。真云端只在此前做过一次 `getSkyContext` 正常返回；本轮没有重开开发者工具自动化会话（共享资源 + 并行编辑中）。

## 8. 门禁读数（各脚本自报）

| 套件 | 读数 |
|---|---|
| `check.js` / `check-handlers.js` | 全过 |
| `smoke-test` | 214/0 |
| `sky-test` | 136/0（§19 地形门，§20 透明度方向，§21 光污染） |
| `weather-v2-test` | 71/0（§6 总评语义，§2b/§2c 摄影后缀/暗夜机会句） |
| `weather-page-test` | 192/0 |
| `outdoor-intelligence-test` | 37/0（新增 fallback 同源 2 条） |
| `outdoor-cloud-sea-test` | 32/0 |
| `oi-claim-gate-test` | 26/0 |
| `oi-hour-hit-test` | 25/0 |
| `sky-context-test` | 24/0（四源 + 缺测 + 配额 + LP TTL + 月预算） |
| `spatial / terrain / atmosphere / light-pollution` | 22 / 15 / 14 / 9，全 0 |
| `scenario-api-test` | 29/0 |
| `weather-resilience-test` | 45/0（补记：两条红已在本轮收口后修掉，见下） |
| `page2-gates-test` | 98/0（含页面重量 1 条） |
| `journey-graph` / `ui-consistency` / `elevation-semantics` | 15 / 17 / 34，全 0 |

**真机（IDE 模拟器）**：`cli open` 重编译 + `cli auto` 9425，真实云端、真实数据；4 张截图 + 2 份读数在 `device/`，`errors` 为空。详见 `device/README.md`。仍是模拟器、不是物理手机；客户端未上传。

**未跑全量 sweep，不编总数。** 并行工作停止后复跑，先前的几何红已全部转绿（`meteogram-svg 25/0`、`meteogram-multiday 48/0`、`weather-v2-visual-audit 43/0`、`meteogram-readability 86/0`）。

**补记：`weather-resilience` 的两条红已修掉（45/0）。** 根因都不是判据：

- 「失败后重试成功却显示缓存降级」——`loadSkyContext` 里的 `api.getSkyContext(...)` 若在返回 Promise 之前同步抛错（`wx.cloud` 不可用时就是这样），异常会穿过天气取数链的 `.catch`，被当成“天气没取到”，于是走缓存软降级。修法：把增强外呼包进 `Promise.resolve().then(...)`，增强项失败只走它自己的 `.catch`。
- 「软降级写了 `_lastResult`」——缓存路径调 `applyWeather(hit.result, ...)`，而 `applyWeather` 为支持增强输入到达后重算，会把结果记进 `_lastResult`；这会让随后的“重新查询”被 `covers()` 直接复用旧数据。修法：`applyWeather` 增加 `remember` 参数，只有网络成功/窗口内复用才记，缓存软降级传 `false`。

这两条是真实用户路径上的缺陷（不是测试假红），回归已由 `weather-resilience` 45/0 钉住。

其余删除项：`space-time-test` / `space-time-draw-test` / `roam-scrubber-test` / `weather-model-test` 已被并行工作区删除，不再在门禁清单内；`miniprogram/utils/weather-model.js` 也被同一轮删除。

## 9. 边界/未验证

1. **真机像素已补（IDE 模拟器，非物理手机）**：`device/README.md` 记录了 4 张截图 + 2 份读数——天相条件区、银河卡、页脚署名、隐私 TTL 均按新文案渲染；`skyInputLoading:false` / `skyInputNote:""`，星空与银河证据里同时出现方向云、地形山脊、CAMS、7Timer、Bortle/SQM，证明四源真的到页并被消费；`errors` 为空。未证明的是物理手机上的强光/小屏可读性、配额用尽文案、以及缺项提示行的自然样本。
2. **配额/预算只在桩上验证**：未做 61 次真云端连击（会真实消耗外部额度），也未验证两个并发请求同时越过配额的竞态；get/set 非原子是已知的、可接受的粗略上限。
3. **绝对精度未校准**：见 §4。
4. **法务**：见 §5。
5. **并行工作区**：`space-time` 移除、`meteogram-svg` 在途修改、`page2-gates` 的既有断言均不是本轮产出；本轮只在 `page2-gates` 里更新了因“天相条件”改名而失效的免责词目标与脚注计数口径，并新增页面重量断言。
6. **派生观察（已被并行工作收尾）**：时空图删除后，`miniprogram/utils/weather-model.js` 一度在 `miniprogram/` 内失去全部消费者；并行工作随后删除了该文件与 `tools/weather-model-test.js`。本轮未参与删除，也不在门禁清单里再计数。

## 10. 复跑入口

```bash
node cloudfunctions/trailApi/smoke-test.js
node tools/sky-test.js && node tools/weather-v2-test.js && node tools/weather-page-test.js
node tools/outdoor-intelligence-test.js && node tools/outdoor-cloud-sea-test.js
node tools/oi-claim-gate-test.js && node tools/oi-hour-hit-test.js
node tools/sky-context-test.js
node tools/spatial-test.js && node tools/terrain-test.js
node tools/atmosphere-test.js && node tools/light-pollution-test.js
node tools/page2-gates-test.js
node tools/check.js && node tools/check-handlers.js
```
