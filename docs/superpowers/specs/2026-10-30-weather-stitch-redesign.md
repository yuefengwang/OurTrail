# 天气模块 Stitch 重设计落地 · 准备与实施规格

**日期**：2026-10-30
**分支**：`mac/weather-stitch-redesign`
**设计来源**：`/Users/yfwang/stitch_ourtrail_ui_optimization/`（Google Stitch 导出，11 份 `code.html` + `screen.png`）
**实施对象**：`miniprogram/pages/weather/*`（既有 Weather V2），不改云函数取数契约

---

## 0. 一句话结论

Stitch 导出的是**同一套天气模块的四标签家族**，不是四个互不相干的页面。其中约七成内容现有天气页已经有真实数据与实现，缺的是**信息组织与视觉层级**；剩余三成要么需要新装配（沿途索引、日照轨迹、地点 sheet），要么是**无法用现有数据支撑的演示数字**，必须删掉或改写，不能照搬。

---

## 1. 来源映射（哪张图负责哪一段）

| 导出 | 实际内容 | 在本次落地中的角色 |
|---|---|---|
| `ourtrail_v18_2` | 四标签外壳 + 地点/路线选择 sheet | **外壳与地点选择的基线** |
| `ourtrail_v18_3` | 地点选择空态 | 空态文案参考 |
| `ourtrail_v16_2` | 逐时预报：选中小时概览、四轨协同轴、7 日趋势、微气象矩阵 | **逐时标签的基线** |
| `ourtrail_v14_72` | 云层剖面：目标时段、五格事实、72h 云场、剖面明细、研判 | **云层标签的基线** |
| `ourtrail_v16_3` | 日月天相：24h 天穹带、日照轨迹、月相、活动窗口 | **日月标签的基线** |
| `ourtrail_v16_1` | 沿途天气：路线摘要、日程、海拔剖面、逐节点天气 | **沿途标签的基线**；逐节点预报复用既有 `pages/weather-plan` |
| `ourtrail_72_v14` / `ourtrail_v12_1` | 全屏 72h 云场 / 全屏剖面 | 复用既有 `pages/weather-chart` 的全屏思路 |
| `ourtrail_v12_2` | 早期外壳 + 云层概览 | 被 v18 取代，不采用 |
| `ourtrail_v7` | 绿色版云剖面 | 证明「Stitch 版式 + OurTrail 森林绿」可行，作为配色映射依据 |
| `ourtrail_v18_1` | 与 v18_2 重复且 PNG/HTML 有乱码 | 忽略 |

**基线裁定**：外壳 = v18_2；逐时 = v16_2；云层 = v14_72；日月 = v16_3；沿途 = v16_1（索引层）+ 既有 weather-plan（预报层）；地点选择 = v18_2。**不试图把 11 张图拼成一条时间线**——它们是迭代稿，不是流程步骤。

---

## 2. 设计语言裁定：保留 OurTrail，不引入 Stitch 蓝

Stitch 稿大面积使用蓝色（`#094cb2` 一类）与深绿剖面底；OurTrail 的 `app.wxss` 是森林绿 × 嫩叶绿 × 冷纸面。项目铁律：**新语义色只能进 `app.wxss` 并登记**，页面/组件内不得发明色值。

补充核对（2026-10-30，逐屏 HTML 与 PNG 交叉）：**PNG 里的蓝色不是 HTML 的设计值**。11 份 HTML 的 `tailwind.config` 实际 primary 为 `#00231a`、primary-container `#13392e`，接近 OurTrail 的 `--forest #163E35`；蓝色是 Stitch 截图渲染的偏差。HTML 同时引入了薄荷绿、蓝灰 surface、更小圆角（2/4/8/12）与 10/11px 字级——这些仍不采用：字级低于本仓 caption 12 下限，圆角与 surface 阶也与 `app.wxss` 不成体系。

因此本次落地：

- **不新增任何色值**。深绿主色映射为 `--forest` / `--forest-soft`；信息性读数用 `--info`；云场灰阶继续用 `--chart-ramp`；日照/晨昏用 `--golden` / `--blue-hour`；警告/成功用既有 token。
- 不使用 10/11px 作为正文；最小仍为 `--text-caption`（12px），仅图表内部注记可沿用既有图内小字。
- 圆角继续 5/8/14/20，不引入 Stitch 的 2/4/12。
- Stitch 的「instrument」感用**排版与留白**实现：小号大写标签、tabular 数字、细分隔线、卡片内两列事实网格；不靠换色。
- 组件引用全局类时保留 `options: { styleIsolation: 'apply-shared' }`（如需新组件）。
- 触控目标 ≥ `--touch-target`，主操作高 `--action-height`。

---

## 3. 数据能力矩阵（这是「能照搬 / 要改写 / 必须删」的判据）

### 3.1 现有真实数据（可直接展示）

| 设计元素 | 数据来源 | 现状 |
|---|---|---|
| 温度 / 体感 | `hour.temp` / `hour.feels` | 有 |
| 风 / 阵风 / 风向 | `hour.wind` / `hour.gust` / `hour.windDir` | 有 |
| 降水概率 / 小时降水 / 阵雨 | `hour.pop` / `hour.precip` / `hour.showers` | 有；总降水已含阵雨 |
| 云量（总/低/中/高） | `hour.cloud` | 有 |
| 各气压层云量 + 位势高度 | `result.cloudLevels` | 有；既有 Unified Meteogram / Cloud Field |
| 相对湿度 / 气压 / 露点 | `hour.rh` / `pressure` / `dewPoint` | 有；气压是**该点地面气压**，不是峰顶实测 |
| 能见度 / UV / 冻结高度 / 边界层 | `hour.visibility` / `uv` / `freezing` / `pblh` | 有 |
| 日出日落 / 黄金蓝调 / 天文晨昏 | `astro.sunTimes` / `photoWindows` / `altitudeCrossings` | 有 |
| 太阳高度与方位 | `astro.solarPosition` | 有（可画日照轨迹） |
| 月相 / 月出月落 / 银河 | `astro.moonInfo` / `moonTimes` / `galaxyPosition` | 有 |
| 天相结论（云海/彩虹/光染/星空/银河） | `sky.summarize` / `hourMarks` | 有；三态 verdict + 沉默闸 |
| 地形剖面 | `utils/route-profile.js` | 有，但属于路线组件，天气页目前不叠加云场 |
| 沿途节点与抵达日程 | `schedule` + `route-schedule.nodeLabel` | 有；仅活动/轨迹模式 |
| 逐节点天气 | `pages/weather-plan` + `getWeatherByPoint` | 已有完整实现（3 并发 + 缓存） |

### 3.2 可以由现有数据推导（需标注推导口径）

- 「0°C 冻结高度」→ `hour.freezing`（模型值，不是实测探空）。
- 「体感风寒」→ `hour.feels`（模型已算）。
- 「日照时长」→ `sunTimes.sunset - sunrise`（天文计算，按海拔修正）。
- 「月面照亮比例」→ `moonInfo`（天文计算）。
- 「云量低谷 / 通透」→ 只能写「该小时云量较低」或「概率较大」，不能写「窗口开放」这种断言。

### 3.3 现有数据无法支撑（必须删除或改写）

| Stitch 演示元素 | 问题 | 落地处理 |
|---|---|---|
| 「ECMWF + WRF 4km 协同」 | 仓库只有 Open-Meteo/7Timer/CAMS/DEM/DarkSkySites；无 WRF | **删除**，只写真实来源 |
| 「高空风切变 1.2 m/s/100m」 | 无风廓线数据 | **删除** |
| 「海平面约 53% 氧含量」 | 无氧含量模型；且与海拔非线性 | **删除** |
| 「局地大气压 540 hPa」 | 该点是地面气压，不是 5,025 m 峰顶气压 | 若显示，标「该点地面气压」，不冒充峰顶 |
| 「Bortle 2 纯黑深空」 | 只有 DarkSkySites 有 key 时才有 Bortle；缺 key 必须沉默 | 有则显示，无则说明缺测 |
| 「82% 盈凸月」 | 可算，但 Stitch 的 82% 是固定样例 | 用真实月相比例；缺则说明 |
| 「垂直速度 / 抬升」 | 无 | **删除** |
| 「11h44m 日照」 | 可算；但样例坐标与日期是固定的 | 用当前点/日实算 |
| 「AR 对日 / 实地视界预判照片」 | 无此能力 | **删除** |
| 「示例预报数据」脚注 | 实施后页面显示真实数据 | 保留「行前参考，不是出发许可」的诚实声明 |

**总原则**：宁可不显示，也不拿样例数字冒充该点的真实预报。缺测一律 `—` 或「缺测，不代表晴空/无雨」。

---

## 4. 文案与概率语气（沿用既有门禁）

- 天气派生结论用「可能 / 概率较大 / 该小时云量较低」，禁止「窗口开放」「不会有」这类断言式承诺。
- 分数不是成功率；星级不是安全评级。
- 缺数据不得印成有利事实（`Number(null) === 0` 的坑已有先例）。
- 客观时刻（日出/日落/黄金/蓝调/天文晨昏）永远显示，不因天气被裁；机会主张（银河、云海、光染）读 `sky` 的同源标记。

---

## 5. 分波实施

### Wave 1（本次提交）

1. **四标签外壳**：`hourly / cloud / enroute / sky`。**单点查询仍是三标签**（`hourly / cloud / sky`）——沿途标签对单点没有内容，硬挂一个「暂无」只会多一次无意义点击；`tabOptions` 由「这一屏有几个节点」决定，`weatherTab` 在新页面里不存在时退回 `cloud`。顺序对齐 v18；默认标签与既有切窗不变。
2. **地点选择 sheet**：多节点模式下标题区改为「地点 + 第 i/N 个 + 展开」（整行可点，≥44px）；sheet 列当前点集的**名字与节点性质**（`起点/途经点/终点 · i/N`），标注「只切换浏览地点，不修改个人行程」，出口两个：「打开完整沿途天气」与「去天气首页选别的路线」。**不在 sheet 里放「保存常用地点」**——保存语义只属于单点自由查询（`showSave` 不变，全页仍只有一处 `onSavePoint`）。
3. **逐时选中小时概览**：图上方新增「选中时段」卡（时刻 + 温度 + 天气简字 + 天相同源标签；两列事实：风/阵风/风向、降水/概率、云量/分层、能见度/UV、湿度/露点、地面气压/冻结高度），全部来自当前选中小时对象；缺测 `—`；`inCloud` 单独一行提示「可能处在云中」。原图下 `.hour-chip` 一行压扁的读数被它取代。
4. **沿途天气标签（索引层）**：多节点模式显示路线摘要（标题/里程/累计爬升/关键节点/节点最高点，零值不印）与节点索引，可切换浏览节点；提供「打开完整沿途天气」到 `weather-plan`。**不推算抵达时刻**（`this.sched` 在本页恒为空，抵达时间在 `weather-plan` 按个人计划算）。

### Wave 2（同批，若回归稳定）

5. ~~**云层标签**：标题区加「全屏查看」（复用 `weather-chart`）~~ **裁掉，理由可核**：`pages/weather-chart` 是全屏 **surface meteogram**（`meteogram-svg` + 时间轴），不是云层剖面；把云层卡指向它会得到一个「打开后内容不一样」的入口。真要做云层全屏需要新页面或给 `weather-chart` 增加剖面模式，属于另一件事（且没有真机证据，本机 NOT_RUN）。选中小时的云层读数**已经存在**：云层标签现有的 `unified.r1–r4` 读数行 + 点按/拖动同步，本轮没有重复造一份。
6. **日月标签（第二批，2026-10-30 已落地）**：新增 24h 日照轨迹卡（真实太阳高度曲线 + 日出日落 + 黄金/蓝调色带 + 选中时刻），纯函数 `utils/solar-arc.js` 生成 SVG；月相与夜间窗口沿用既有 `agenda` / `condCards`。**同日补齐 Stitch 日月标签的三块剩余内容**（新增 `utils/sky-ephemeris.js`）：
   - **24h 天穹带**：按太阳高度角每 5 分钟采样分夜/天文/航海/民用/白昼五段，配日出日落虚线、选中时刻点与 00/06/12/18/24 刻度；只用既有 token 做字面量（SVG 取不到 `var()`）。
   - **晨昏时刻表**：晨光 4 行（天文/航海/民用/日出），暮间 4 行**按时间下行为序**（日落 → 民用 → 航海 → 天文暗夜始），与晨间阶梯同向。
   - **月相与月出月落**：半椭圆明暗界线（`a=|1−2f|·r`），南北半球与盈/亏错开其一即镜像；月出/月落、极区「当日不升/不落」、跨日「（次日）」。
   - 三条诚实边界：极昼/极夜/极区月相/该纬度不出现的阶段各有各的话（`—` ≠ 缺测）；海拔只认数字（`Number(null)===0` 会把「没填」当海平面）；日期做日历合法性校验（`2026-02-30` 不许静默变成 3 月 2 日）。
   - **首屏默认标签 `cloud` → `hourly`**（负责人 2026-10-30 裁定，见 §8 第 5 条）。

### 不在本次范围

- 把 `weather-plan` 的逐节点预报搬进天气页标签（会造成第二套查询/缓存实现；保留单一实现）。
- 地形 + 云场叠加剖面（需要新的几何合成与真机核验；现有图和 terrain profile 各自独立）。
- 任何 Stitch 演示数字、WRF/ECMWF 4km、风切变、氧含量、AR。

---

## 6. 文件与接口（实际改动面）

| 文件 | 改动 |
|---|---|
| `miniprogram/pages/weather/weather.js` | 动态标签（单点 3 / 多节点 4）、`routeView`/`locationRows` 装配、`hourOverview`、地点 sheet 状态与 handler、`switchPoint` 单一入口、`_solarInput` 与 `buildSolarCard` |
| `miniprogram/pages/weather/weather.wxml` | 地点行 / 行进 sheet、逐时选中卡、沿途标签、日照轨迹卡；云层与逐时共用块的守卫由 `!== 'sky'` 收窄为显式两标签 |
| `miniprogram/pages/weather/weather.wxss` | 新增页面级排版；**零新色值、零新字阶**；可点行 ≥ `--touch-target` |
| `miniprogram/pages/weather/weather.json` | 注册 `overlay`、`fact-grid` |
| `miniprogram/utils/solar-arc.js`（新增） | 纯函数：太阳高度/晨昏色带/SVG；wx-free，可在 Node 直测 |
| `miniprogram/utils/sky-ephemeris.js`（新增） | 纯函数：24h 天穹带 / 晨昏时刻表 / 月相盘与月出月落；只 `require('./astro')`，wx-free |
| `tools/solar-arc-test.js`（新增） | 63 条：输入边界、色板单源、曲线与升落一致、极昼/极夜、海拔三态、选中时刻、图元卫生 |
| `tools/sky-ephemeris-test.js`（新增） | 99 条：输入边界（含假日期）、色板↔`app.wxss` 单源、相位界与 `astro` 对齐、极昼/极夜、海拔三态、选中点、图元卫生、晨昏逐字、月相四镜像、真页面装配、文案卫生 |
| `tools/page2-gates-test.js` | 夹具补新字段 + §4 新增 6 条（hero / 日照卡 / 地点 sheet / 沿途标签） |
| `tools/weather-page-test.js`、`tools/weather-production-ux-test.js` | **未改**：单点仍是 3 标签、逐时四行不变，两套原样通过（219 / 55） |

**没有动**：`cloudfunctions/`（零改动 ⇒ 不需要重新部署）、`pages/weather-plan`（逐点预报唯一实现）、`app.wxss`（零新 token）。

---

## 7. 验收

**静态门（必跑）**

- `node tools/check.js` → `ALL CHECKS PASSED`
- `node tools/check-handlers.js` → 新增 bind 全部解析
- `node tools/page2-gates-test.js`
- `node tools/weather-page-test.js`
- `node tools/weather-production-ux-test.js`
- `node tools/weather-v2-test.js`、`node tools/sky-test.js`、`node tools/journey-graph-test.js`、`node tools/weather-v2-visual-audit-test.js`
- Wave 2：`node tools/solar-arc-test.js`

**已跑（2026-10-30，本机 macOS）**

| 命令 | 读数 |
|---|---|
| `node tools/check.js` | `ALL CHECKS PASSED`（G10 作用域 43 / class token 3463 / 命中 0） |
| `node tools/check-handlers.js` | 全部解析；死 handler 仍只有存量 `editor#onNumber` |
| `node tools/page2-gates-test.js` | `passed=116 failed=0` |
| `node tools/weather-page-test.js` | `passed=219 failed=0` |
| `node tools/weather-production-ux-test.js` | `passed=56 failed=0` |
| `node tools/sky-ephemeris-test.js`（第二批新增） | `passed=99 failed=0` |
| `node tools/weather-v2-test.js` | `passed=103 failed=0` |
| `node tools/sky-test.js` | `passed=280 failed=0` |
| `node tools/journey-graph-test.js` | `passed=15 failed=0` |
| `node tools/weather-v2-visual-audit-test.js` | `passed=43 failed=0` |
| `node tools/swx2-style-gates-test.js` | `passed=110 failed=0` |
| `node tools/solar-arc-test.js`（新增） | `passed=64 failed=0` |

**真机（微信开发者工具模拟器）**

已在本机 macOS 版工具上按 `docs/e2e-mp/README.md` 三道门槛跑通：iPhone 6/7/8 **375×667 @2x**、SDK 3.8.12、自动化端口 9421；`close --project` → `open` → `auto` 重编译后驱动，bundle 新鲜度由只存在于新代码的文案自证。

| 用例 | 数据 | 结果 |
|---|---|---|
| A 单点峨眉山 `?src=local&lat=29.5183&lng=103.3358&ele=3077` | **真实云函数**（7 天卡 / 24 小时 / unified 云场） | 25 条断言全过 |
| B 路线 `?route=route-mul4l1as23ykhk` | **真实路线资产**（12 节点 / 30.5 km / 2883 m） | 20 条断言全过 |

覆盖到的可见面：单点无 place-row、三标签；选中时段卡六项事实（`fact-grid`）与换时同步；日出日落/白昼两行；路线模式四标签、地点展开行、sheet 12 行与唯一「正在查看」、切点后 sheet 关闭且天气仍 ready；沿途卡与出口、无 meteogram、无逐点预报数字；sheet 内部可滚到底、两个出口可见。

真机抓到并修掉 4 处（详见证据 README §4）：日照卡在「白昼 11 / 小时 21 分」处断行、单点预生成 `locationRows` 死状态、沿途卡标题与「路线」行重复、`.solar-daylight` 类无定义（G10 当场红）。

**未验**：390/414 宽、物理机、大字体、软键盘、真实弱网与本地缓存兜底态。证据：`docs/weather-ux/qa/stitch-redesign-2026-10-30/`（README + `device/` 十张截图与两份读数 JSON）。

---

## 8. 风险与已知取舍

1. **标签集合随节点数变化（3 / 4）**：单点查询的既有三标签契约**没有破**（`weather-production-ux` 的 `tabOptions.length === 3` 原样通过），多节点新增第四标签是本轮的有意变化；`weatherTab` 在新页面里不存在时退回 `cloud`，避免落到空块。
2. **沿途标签不做逐点预报**：避免与 `weather-plan` 形成第二套实现；标签负责「看清路线与时刻并切换节点」，预报在既有页面。这是取舍，不是遗漏。
3. **地点选择 sheet 不复制天气首页的全部能力**：只列当前点集 + 两个出口；路线库/GPX 仍在 `weather-hub`；保存地点只在单点模式。
4. **日照轨迹是新可视化**：只画真实天文量；不叠加「山体遮挡」与「视界预判」，因为仓库没有可量化的山脊遮挡模型。
5. **默认标签**：~~本次保持既有默认（`cloud`）不变~~ **2026-10-30 负责人裁定改为 `hourly`，已落地**——理由：板 01-2 的主任务是「看今天几点走」，云层剖面是下钻项；改动只有一处默认值 + 一处载入兜底（新页面不存在该标签时也退回 `hourly`，否则单点回退会落回旧默认），并由 `weather-production-ux` 新增一条断言（`weatherTab === 'hourly'` 且该标签排第一）与真机像素层（第一个 `.seg` 带 `on`）同时钉住。
6. **云层全屏被裁掉**：见 §5 第 5 条的可核理由——`weather-chart` 是全屏 surface meteogram，不是剖面；入口打开后内容不一致比没有入口更糟。

---

## 9. 实施中被自家判据抓到的两个缺陷（如实记录）

1. **`HHMM` 少一个捕获组 ⇒ 所有横坐标 NaN。** `parseHM` 读 `m[2]`，而正则 `/^([01]\d|2[0-3]):[0-5]\d$/` 只有一组 ⇒ `Number(undefined)` ⇒ `x(NaN)`：日出日落竖线与选中点全部 `cx="NaN"`，SVG 仍能渲染，肉眼看只是「标记不见了」。`tools/solar-arc-test.js` §3 的「升落竖线画在交点横坐标上」当场抓红；修法是给分钟补捕获组 `([0-5]\d)`。
2. **极夜的夜间底色被天文暮光误导。** 原逻辑「有天文晨昏就画两端底色」，而极夜（78°N 冬至）太阳最高只到 −11.6°，仍满足 −18° 天文暮光 ⇒ `astroDawn/Dusk` 有值，正午会被画成「白天」。改为按**太阳是否升起**分岔：有升落才用天文晨昏，整天不升则铺满整幅。测试 §4 用「整幅底色恰一条、x=30、宽=278」钉住。

两个缺陷都属于「数据对、渲染不对」的同一族——纯逻辑读数（`minAlt/maxAlt/summary`）完全正常，只有把 SVG 当真图反解才会露馅。

**真机（375×667 模拟器，真实数据）又抓到四处**，静态门与纯函数都测不到或测不准：

3. **日照卡断行**：`10-30 · 日出 07:10 · 日落 18:31 · 白昼 11 小时 21 分` 在 375 宽断在「白昼 11 / 小时 21 分」；先试 `word-break: keep-all` 仍断在空格处。改为 `solar-arc` 返回 `summary`（日出日落）与 `daylight`（白昼时长）两个字段、页面两行渲染，并加 `keep-all` 兜长句。
4. **单点的死状态**：`locationRows` 对单点也生成 1 行，而 sheet 对单点不可达 ⇒ 无人读。改为 `multi ? … : []`（与先前的 `hourChip`/`showEnroute` 同一处理原则）。
5. **沿途卡重复标题**：抬头印 `routeView.title`，「路线」行又印同一串字。删除该行，标题只出现一次。
6. **无定义类**：新写的 `.solar-daylight` 没有对应样式规则，`check.js` G10 当场命中 ⇒ 两行共用 `.solar-summary`。

代码里 3–6 的修法都只动了呈现层，没有新增阈值、没有改判据。

---

## 10. 证据留存

- 本文：`docs/superpowers/specs/2026-10-30-weather-stitch-redesign.md`
- 分支：`mac/weather-stitch-redesign`
- 真机：`docs/weather-ux/qa/stitch-redesign-2026-10-30/README.md` + `device/`（十张截图 + 两份读数 JSON；第二批在 `device/sky-ephemeris/`：A–E 五张 + `readings.json` + `run.log`）
- 真机边界：375 宽两个真实数据用例已核（第二批另有同宽同日月的 36 条断言）；390/414、物理机、大字体、软键盘、弱网与缓存兜底态未验
- 设计来源截图：`/Users/yfwang/stitch_ourtrail_ui_optimization/*/screen.png`（仓库外，未入库）
