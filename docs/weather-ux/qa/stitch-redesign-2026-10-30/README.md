# 天气模块 Stitch 重设计 · 真机（开发者工具模拟器）核验

**日期**：2026-10-30 · **分支**：`mac/weather-stitch-redesign` · **实施规格**：`docs/superpowers/specs/2026-10-30-weather-stitch-redesign.md`

## 1. 环境与通道

| 项 | 值 |
|---|---|
| 工具 | 微信开发者工具（macOS），`/Applications/wechatwebdevtools.app` |
| CLI 服务端口 | 61253（`cli islogin` → `{"login":true}`） |
| 自动化端口 | 9421（`cli auto --auto-port 9421 --trust-project`） |
| 模拟器 | iPhone 6/7/8 · **375×667** · DPR 2 · iOS 10.0.1 基线 |
| 基础库 | 3.8.12（与 `project.config.json` 一致） |
| 驱动 | `miniprogram-automator`，装在仓库外 `/tmp/mp-auto`（本仓零 npm 依赖） |
| 数据 | **真实云函数 `trailApi`**，非注入夹具 |

重编译：改完代码后 `cli close --project` → `cli open --project` → 重新 `cli auto`，再连接。bundle 新鲜度由**只存在于新代码的文案**自证（日照卡两行：`10-30 · 日出 07:10 · 日落 18:31` / `白昼 11 小时 21 分`）。

## 2. 用例

| 用例 | 入口 | 读到的真实数据 |
|---|---|---|
| A 单点 | `/pages/weather/weather?src=local&lat=29.5183&lng=103.3358&ele=3077&name=峨眉山` | 7 天卡 + 24 小时 + unified 云场，`updatedAt` 为当次外呼时间 |
| B 路线（多节点） | `/pages/weather/weather?route=route-mul4l1as23ykhk` | 12 节点 · 30.5 km · 累计爬升 2883 m（路线库资产） |

## 3. 断言与结果

**A 单点（25 条）**

- 门槛链：`denied=''`、`loading=false`、`loadingWeather=false`、`dayCards=7`、`chartView=24`、`unified≠null`、`updatedAt` 真实。
- 单点外壳：`tabOptions` 恰为 `hourly/cloud/sky`；`showLocation=false`；DOM 里无 `.place-row`；`locationRows=[]`（无死状态）。
- 选中时段卡：`.hour-hero` 在 DOM，含「体感」「地面气压」「能见度」，六项事实由 `<fact-grid>` 渲染。
- 换时：`selectHour(2026-10-30, 14:00)` 后卡内容与像素都换成 14:00，且与 00:00 读数不同（污染自证：`0°/体感 -3°` vs `8°/体感 6°`）。
- 日照卡：`.solar-card` 在 DOM；文本含日出/日落/白昼；`offset.top>0`（图有位置）；说明句「山体与云层会改变实际可见的日照时段」在。

**B 路线（20 条）**

- 四标签 `hourly/cloud/enroute/sky`；`.place-row` 存在且可点；`locationRows` 12/12。
- sheet：打开后 12 行 `.loc-row`、唯一「正在查看」；点第 2 行后 `locationOpen=false`、`pointIndex=1`、地点名从「沿月亮湖右边开始徒步」变「第一天营地」，天气仍 ready，标签集合不变。
- 沿途标签：`.route-card` 在 DOM、`.route-row-item` 12 行、**无 `meteogram`**、有「打开完整沿途天气」出口、卡内不出现 `mm/h`/`hPa`（不冒充逐点预报）。
- sheet 内部可滚动到底，两个出口在 375×667 里都能看到（`.loc-actions` top=482 < 667）。

## 4. 真机抓到并修掉的问题（静态门测不到）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 日照卡在「白昼 11 / 小时 21 分」处断行（先试 `word-break: keep-all` 仍断在空格） | 中文可任意两字折行，时长与时刻挤在同一句 | `solar-arc.build` 拆出 `daylight` 字段，页面两行 + `keep-all`；测试改为断言「白昼不在 summary 里」 |
| 2 | 单点在首屏就预生成 `locationRows`（1 行） | sheet 对单点不可达，生成的行无人读 | `multi ? buildLocationRows(points) : []` |
| 3 | 沿途卡抬头与「路线」行印同一串标题 | `buildRouteView` 既给 `title` 又压一行 `{k:'路线', v:title}` | 删除该行，标题由抬头承担 |
| 4 | `.solar-daylight` 类无样式定义 | 新加的类没进 WXSS | `check.js` G10 当场红 ⇒ 不新增无定义类，两行共用 `.solar-summary` |

## 5. 结论边界

- 375 宽、上述两个真实数据用例：**VERIFIED**。
- 390 / 414 宽、物理机、大字体、软键盘、真实弱网与本地缓存兜底态：**UNVERIFIED**（本机只有工具内置机型的 375 预设）。
- 截图仅证明这两个用例与这条数据；不构成「所有天气页状态都渲染正确」。

## 6. 产物

- `device/A-point-top.png` 单点首屏（真实数据，默认云层标签）
- `device/B-hour-hero.png` 逐时标签 · 选中时段卡（00:00）
- `device/C-hour-hero-1400.png` 换时到 14:00（卡与像素同步）
- `device/D-solar-card.png` 日月标签 · 今日日照轨迹（两行时刻/白昼）
- `device/E-route-top.png` 路线模式首屏（地点展开行 + 四标签）
- `device/F-route-sheet.png` 地点 sheet（12 行，唯一「正在查看」）
- `device/G-route-point2.png` 切到第 2 个节点后的首屏
- `device/H-route-enroute.png` 沿途标签顶部
- `device/I-sheet-bottom.png` sheet 滚到底（两个出口可见）
- `device/J-enroute-card.png` 沿途卡（标题 + 里程/爬升/节点，无重复行）
- `device/readings.json` / `device/readings-route.json` 两个用例的断言读数
- `device/width-375/` 375 宽排版复核包（逐时 / 日月 / 路线 sheet 共 20 条断言，`readings.json` 全 `ok:true`）
- `device/sky-ephemeris/` 第二批（天穹带 / 晨昏表 / 月相卡 / 首屏默认标签）截图与读数，见 §7

---

## 7. 第二批：日月标签剩余块 + 首屏默认标签改为逐时预报

**背景**：第一批交付后按覆盖报告清点，Stitch 日月标签里还有三块没落地（24h 天穹带、晨昏时刻表、月相与月出月落），且首屏默认标签仍是 `cloud`。负责人裁定「补日月标签剩余块」+「默认改为逐时预报」（板 01-2 的主任务是看今天几点走，云层剖面是下钻项）。

### 7.1 用例与读数

- 同一真实载荷：`/pages/weather/weather?src=local&lat=29.5183&lng=103.3358&ele=3077&name=峨眉山`（7 天卡 / 24 小时 / unified 云场）。
- 首屏 `weatherTab = hourly`，`tabOptions = [hourly, cloud, sky]`，像素层第一个 `.seg` 带 `on`；切到日月标签后 `tabAfterSwitch = sky`（两个字段分开记，见 §7.2 第 ③ 条）。
- 天穹带 `太阳最高 12:50（47°）`；图渲染 **301×83**（卡内容宽 335）；图例五项齐全；口径句「每 5 分钟采样…不含山体与云层遮挡」在。
- 晨昏表 4+4 **八格全有时刻**：`05:58 / 06:26 / 06:54 / 07:10` 与 `18:31 / 18:47 / 19:15 / 19:43`；两列等宽并排 **147 + 147**、不重叠。
- 月相 `亏凸月 · 亮面 80% · 月龄 19.1 天`；`月出 21:41` / `月落 12:01（次日）`；月盘正好 **64×64**、与文字不重叠；说明句点明「照亮比例只描述夜空照明条件」。
- 联动：`selectHour(2026-10-30, 14:00)` 后天穹带重画（选中点移动，SVG 数据 URI 与重画前不同），日照轨迹与天穹带**同一日期**，且重画后卡片仍在。
- **36 条断言全过**，原始日志 `device/sky-ephemeris/run.log`，结构化读数 `device/sky-ephemeris/readings.json`。

### 7.2 本批抓到并修掉的缺陷

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| ① | 月盘在白卡上只剩一圈淡灰轮廓，亮面与暗面几乎同色 | `PALETTE.moonDark` 取 `--stone-line`（#D9DED7），而卡是白底 ⇒ 对比接近 1:1，「照亮 80%」看图读不出来 | 暗面改 `--forest`（#163E35，与天穹带夜色同源）；测试补两条：暗面必须是夜色值、色板与 `app.wxss` 同值单源 |
| ② | 天穹带上的日出/日落虚线在浅色底上几乎看不见（白线压白昼段） | 升落点**必然**落在「民用晨昏↔白昼」界上，两侧都是浅色（金 / 浅灰）⇒ 白线对比约 1.1:1 | 改夜色（#163E35）虚线；测试补「虚线用夜色、不许用白色」，同时钉住极区不画假线 |
| ③ | 驱动 5 条几何断言假红（宽度读成 `undefined`） | `element.offset()` 只回 `{left, top}`，宽度高度要另取 `element.size()` | 驱动加 `rectOf(el) = offset() + size()`；改后同一条页面读数全过 |
| ④ | `readings.json.defaultTab` 记成 `sky`，与断言「默认 hourly」互相矛盾 | 该字段在**切到日月标签之后**才取值，把切换后的状态当成了默认值（读数错标，不是页面错） | 先捕获首屏 `initialTab` 再切换；另记 `tabAfterSwitch` 区分「默认」与「切换后」两件事 |

①② 两条都是**读图反解**抓到的：纯逻辑断言（相位名/照亮比例/月龄、虚线存在且成对）全部正常，只有把截图当真图看才发现「数据对、画出来读不出」。①修后用同一张卡反解月盘：亮面 **81.4%**（声明 80%，差值为 2px 圆环像素与抗锯齿）。

### 7.3 边界

- 仍只覆盖 **375×667 @2x**（工具内置 iPhone 6/7/8 预设），390/414、物理机、大字体未验。
- 天穹带相位由 **5 分钟采样**得到（图上 1 px ≈ 4.8 分钟），与 `astro.sunTimes` 的穿越点对齐在 ±6 分钟内，属采样精度而非独立判据；山体与云层遮挡不在模型内，卡内已明说。
- 极昼 / 极夜 / 极区月不升不落 / 该纬度不出现某阶段，各有各的文案（`—` 表示「不出现」，不是缺测），由 `tools/sky-ephemeris-test.js` §4/§9 的合成用例守着，本机真机用例只覆盖了中纬度正常日。
- 月盘 `81.4%` 是**读图量测**，不是业务判据；判据仍是 `astro.moonInfo` 的照亮比例。
