# Weather V2 最终视觉审计 —— Meteoblue 对标 / Cloud Field 几何 / 海拔语义 / 天象可信度

**任务书**：`OurTrail Weather V2：Meteoblue 对标审计、气象图质量修复与户外天象可信度治理`（2026-10-09 业主下发，全程自主执行）
**基线**：`master` = `076bf11`，开工时工作区干净（`git status --short` 0 行）。
**本轮状态**：阶段 A/B/C 完成并**经真机验证**（§六，30 张截图）；阶段 D/E 只完成其中与 P0 相关的两条；
对标矩阵与温度/降水/风/窄屏精修未做（§四）。
**本文的四种判定用语**：✅ 已实现并通过验证 ｜ 🟡 已实现但未完成验证 ｜ 🟠 已确认问题但未修复 ｜ ⛔ 受数据/能力限制本阶段不做。

---

## 〇、环境与既有事实（先取证再动手）

| 项 | 实测读数 |
|---|---|
| 天气线相关套件基线 | 13 套全绿：cloud-field-svg 27 · weather-cloud-field 29 · meteogram-svg 25 · meteogram-multiday 44 · meteogram-draw 30 · outdoor-cloud-sea 20 · outdoor-intelligence 24 · outdoor-intelligence-ui 47 · weather-v2 45 · weather-v2-visual-audit 38 · weather-model 82 · space-time 109 · sky 65。**AGENTS.md 里写的「天气线 1 条常驻非确定性红」本轮没有复现**（outdoor-intelligence-ui 47/0，rc=0） |
| 真实数据来源 | `api.open-meteo.com` 从本机 Node **可直连**（云函数同一路径），用生产同一份 `cloudfunctions/trailApi/lib/weather.js` 抓取，避免拿 mock 结论当真机结论 |
| 三地点真实剖面 | 成都 489 m / 峨眉山 3004 m / 理塘 4058 m，各 168 h × 22 层（1000–450 hPa）`cloud_cover` + `geopotential_height`，快照存 `%TEMP%/ot-cf/real-cloud.json`（154 KB） |
| 既有参照材料 | 任务书提到的两张截图**没有随附件送达**（附件目录只有 .txt）。仓库内可用：`docs/weather-ux/meteoblue-web-poc/screens/`（Meteoblue 成都/峨眉山/理塘/稻城）、`docs/weather-ux/meteogram-html-prototype/screens/visual-convergence/baseline/`（12 张 375/390/414 基线） |
| 渲染链路 | 生产页面走 `utils/meteogram-svg.js`（`buildUnified`+`renderUnifiedBase`），它**复用** `utils/cloud-field-svg.js` 导出的冻结场数学；`buildGeometry/renderBaseSvg` 只有 `pages/cloud-field-poc`（DEV_ONLY）在用 |

---

## 一、Cloud Field 尖角/锯齿/碎片/不自然边界（P0，✅）

### 1.1 取证：四条候选根因，三条被真实数据证伪

| 假设 | 判据 | 结论 |
|---|---|---|
| A 数据本身突变 | 同海拔相邻小时云量差 ≥20% 的占比 | 🟡 **存在但必须保留**：成都 13.5%（p50 仅 2.1%）、峨眉山 8.2%、理塘 2.1%。真实突变不许被平滑掉 |
| B 层高抖动 / 高度换算错位 | 22 层逐时位势高度 `|Δ|>40m` 的小时数 | ⛔ **证伪**：三地点全部 `0/168`，最大跳 7–25 m，168 h 内跨度 77–158 m，无缺失层 |
| B2 跨大层间隙内插 | 相邻实测层的最大间隙 | ⛔ **生产不触发**：三地点 24 h 全量实测最大 **489 m**（分布 200/300/400m 三档）。合成 1 km 空洞才暴露 → 见 1.4 的负结果 |
| C1 marching squares 鞍点歧义 | idx 直方图里 5/10 的个数 | ⛔ **证伪**：三地点 × 五档 **全部为 0**（成都 50% 档 8120 cell：0×4430 + 15×2981，其余 12 种）。旧实现固定「高角孤立」的连接方向在这个数据上从未被走到 |
| C2 0.1px 坐标键把同一交点拆成两个键 | 顶点度数直方图 + 1.5 cell 近邻 | ⛔ **证伪**：拆分 = **0**；度 1 交点 72 个全是时间窗边界上的真开链端点 |

### 1.2 真因（✅ 已证实并已修复）

`buildGrid` 的外扩圈**复制边缘值**（注释写着「贴边云自然出血，等值环全部闭合」）。复制边缘值时，
被时间窗或高度窗切断的云带在整个网格内**找不到降到阈值以下的位置**，等值环根本闭不上。
旧实现只能在事后用两条启发式硬凑：

1. 开链按**全局 mean-y 排序两两配对**（`openChains.sort(meanY)` → `concat(reverse)`）；
2. 剩下的奇数链交给 SVG 的 `Z` **首尾直连**。

用真实剖面逐环归因（`__diag` 只读探针，产线代码自己记账）：

| 伪影 | 旧实现真实读数（3 地点 × 24/48/72h） | 修复后 |
|---|---|---|
| 断链（走线中断，被 `Z` 直连） | 24 h 一轮就有 **49 条** | **0** |
| 自交环（`fill-rule: evenodd` 把真云区**挖成洞**） | **71 个** | **0** |
| 闭合弦 >30 px（横贯整图的直线斜边，最长 **371 px**） | **55 个** | **0** |
| 把无关两层连成一块（x 重叠仅 **2%** 的两条链被配对，合成 12688 px² 假云块） | 1 例（成都 25% 档） | 该启发式**已删除** |
| 折角 >45° 的顶点占比 | 1090 / 34194 = **3.19%** | 690 / 43332 = **1.59%** |
| 针状碎片（面积 1–20 px²、靠「路径长度 ≥24px」逃生门留下） | 24 h 一轮 7 枚 | 逃生门关闭，见 1.3 |

### 1.3 改动（`miniprogram/utils/cloud-field-svg.js`）

1. **外扩圈填 0（域外=无云）而不是复制边缘值**。环在格外一格内自然闭合，而那一格在 `clipPath` 之外
   （垂直 3.75 px、时间 ~0.84 px），看到的仍是「云带冲出图外」的平切边——**视觉不变，拓扑不再靠启发式**。
2. **交叉点按「网格边身份」链接**（`h{j}_{i}` / `v{j}_{i}`），不再用四舍五入坐标做键。
   一条边至多一个交叉点、且恰被两个 cell 共用 ⇒ 每个交叉点度数恒为 2，走线不存在「任取一条未用线段」的岔口，
   捏合点不可能被并进同一个键而走错弯（旧的自交来源）。
3. **鞍点按 cell 中心值定连接方向**（`idx 5/10`）：这个数据上走不到，但连接歧义的正确解本来就该由中心值决定。
4. **碎片过滤只看面积，且下限随 cell 尺寸缩放**（`max(12, cellW×cellH×0.6)`）。
   旧的 `或 长度≥24px` 是当年开链面积恒≈0 时留的逃生门，它同时放进了面积 1–20 px² 的针状碎片；
   环能自然闭合后这扇门不再需要。
5. 保留 Chaikin 一轮圆化与全部 CR 采样/阈值/配色——**没有用模糊、圆角或滤镜遮掩**。

### 1.4 负结果（如实记录，别再把这条请回来）

为防「跨大层间隙内插造云」加过一条 `MAX_GAP=600` 保守规则（间隙内取两侧较小值）。它**必须在生产里可证明**，
实测结果：真实层间隙最大只有 489 m ⇒ 规则在生产路径**永不触发**；而在测试夹具/未来粗网格数据上，
`min()` 兜底会把两侧取值差异大的**真实厚云带抹成无云**（`tools/weather-page-test.js` 当场 5 红：
`r2 海拔 3,500 m 云量 10%`、`r3 stKey 空`）。为防一个不会发生的错而制造一个会发生的错——**已回退**，
只保留「实测范围外不补云」这条（1.5）。

### 1.5 实测成本（Node 计时，同数据同机）

| 地点/窗口 | 旧 网格+环 | 新 | 旧 path 字节 | 新 |
|---|---|---|---|---|
| 成都 24h | 10 ms | 13 ms | 51.5 KB | 64.5 KB |
| 峨眉山 24h | 4 ms | 7 ms | 33.9 KB | 57.6 KB |
| 峨眉山 72h | 7 ms | 9 ms | 62.3 KB | 81.1 KB |
| 理塘 48h | 3 ms | 2 ms | 16.8 KB | 20.2 KB |

结论：**每次成图多 0–5 ms**，SVG 体积 +18%～+70%（环补全的必然代价）。旧实现更快主要因为它把云带切断了。
真机耗时未测（§六），不得声称真机无感。

### 1.6 新回归门 `tools/cloud-field-geometry-test.js`（190 断言，✅）

按业务规格独立写期望拓扑，**不以「SVG 能生成」为通过标准**：
全晴空（不得出现任何区域）· 全云覆盖（恰 1 环铺满）· 单层连续（五档嵌套、面积随阈值单调、85% 的云不得冒出 90% 档）·
多层分离（两层必须保持分离，单环 y 跨度 <90 px）· 生灭与垂直分裂（时间/高度上断开的不许被连成一整块）·
阈值临界 24.9/25.1（断开是诚实画法，横跨全窗才是编造）· 锋面突变 · 缺失列回填 ·
高度边界（云系全在剖面窗之外时**一幅都不画**，而判读仍给「头顶有云层」）· 覆盖范围外不补云 ·
噪声极端输入 · 3 地点真实数据 @375/390/414 · **图与数据的点格一致率**（`agreement()`：逐格比对
「F.g 双线性读出的云」与「环 evenodd 判出的云」，要求 ≥85–90%——这是唯一能抓住「截图顺眼但语义跑偏」的判据）·
**变异自证**：把外扩圈改回复制边缘值 ⇒ 锋面/生灭/垂直分裂三场各报 0/3/3 处违例（合计 ≥1 才合格），
同批场在正确实现下违例恒为 0（反向对照）。

---

## 二、海拔语义与查询模式治理（P0，✅ 含真机读数对照）

**先取证**：全仓库没有任何 `wx.getLocation` 调用（`grep` 命中 0），也没有气压计/高程传感器。
所以本页的海拔数值只有四个出处：GPX 记录的高程点、地图选点的地形高程、用户手填、Open-Meteo 的模型地形高度（±300–600 m）。
**没有一处可以合法地以「你」作主语**——旧代码里 `你 · 3,500 m`（两处渲染器）与
`你在云层上方约 …`、`穿过你的海拔 …`（5 处 OI 证据句）都是无据断言。

| 改动 | 位置 | 说明 |
|---|---|---|
| 出处判定单源化 | `utils/format.js` `resolveElev(pointEle, source, modelEle)` | 页面原来在 `applyWeather` 与 `refreshViewCards` **各写了一遍**「有 ele 就用、否则退回模型」；现同一判定只有一处，`ok=false` 时来源记 `'model'` |
| 中文来源标签单源化 | `format.js` `ELEV_SOURCE_LABELS` / `elevSourceLabel` | 删掉页面里的 `elevLabel()`（第二份词汇表，违反根 AGENTS 铁律 22 的「受管中文词汇只出现在 format.js/journey.js」） |
| 图上标签 | `utils/meteogram-svg.js`、`utils/cloud-field-svg.js` | `你 · 3,500 m` → **`此点 3,500 m`**；来源为模型时自动追加 **`（模型估算）`**。标签文案由 `format.elevLineLabel()` 一处定义，两个渲染器共用 |
| OI 证据句 | `utils/outdoor-intelligence.js` | `低云带在你脚下` → `低云带在此点下方`；`穿过你的海拔` → `穿过此点海拔`；`你在云层上方约` → `此点高于云层底部约` |
| 判读不再受显示窗钳制 | `outdoor-intelligence.js` `peakCover`、`cloud-field-svg.js` `inferState/denseSpanAt` | 原判云/判晴空只扫剖面窗 2000–6000 m。**显示窗是「这张图画哪一段」，判读是「云在哪儿」**：一层 1400–1900 m 的浓云对 3400 m 的此点就是「云在脚下」，旧实现答「无结论」。现按实测网格（0–7000 m）扫，且 `denseSpanAt` 报出的区间不越出 `covered` |
| 实测范围外不补云 | `utils/weather-cloud-field.js` `resampleColumn` | 旧写法把端点层云量**平推**到 0–7000 m 整轴（成都实测 146–6674 m；层底 4300 m 的高台站点会把剖面下半幅涂成有云）。现改为 0 = 此处无数据，渲染留白、判读按 `covered` 说相对位置 |

**新回归门 `tools/elevation-semantics-test.js`（34 断言，✅）**：
7 条 `resolveElev` 模式矩阵（含 0 m 合法、NaN 视为缺失）· 四来源标签逐条核对（只有 model 追加标注）·
两个渲染器共用同一出处 · OI 走**页面同款入口** `buildOutdoorIntelligence` 生成真证据句后逐句查主语（并先断言证据句确实生成，避免空断言）·
显示窗外有浓云时不报晴空 · 区间不越 `covered` ·
静态门：全客户端不得再出现「你现在海拔/你脚下海拔/你所在海拔」，`ELEV_SOURCE_LABELS` 只允许定义一次，
页面必须把 `elevSource` 传进 `buildUnified` 且不再自己判定。

**受影响并同步更新的既有断言（不是削弱，是契约变更）**：`tools/weather-cloud-field-test.js` 里
`缺失层区间由有效层钳位（2000m 处 = 最低有效层 30%）` 这条**钉的正是被证明错误的旧契约**——
它要求把没有测量的 2000 m 涂成 30% 云。已改成断言「2000 m 无测量 ⇒ 0」，并补了两条实测范围内仍照常插值的反向对照。
其余 6 处只是把 `你 · 3,500 m` 文案换成 `此点 3,500 m`（`cloud-field-svg/meteogram-svg/meteogram-multiday/weather-cloud-field/weather-v2-visual-audit/outdoor-intelligence` 六套）。

---

## 三、Outdoor Intelligence 机会卡证据门（P0，✅ 部分完成）

已完成的是**「不成立就不许出卡」的可执行判据**，新门 `tools/oi-claim-gate-test.js`（**15** 断言）。
每个不成立用例都配一个**反向对照**（同一份数据只改那一个条件，必须能出卡），否则就是空断言：

| 机会 | 必要条件（现有实现实际用的） | 用例：不成立 ⇒ 必须无卡 | 反向对照：成立 ⇒ 必须有卡 |
|---|---|---|---|
| STARGAZING / MILKY_WAY | 天文暗夜（`m<astroDawn ∥ m>astroDusk`）+ 中高层云少 + 无降水；银河另需银心季与月照低 | 夜间满云（low/mid/high 全 95%）→ 两者都消失 | 夜间晴朗 → 至少出一个 |
| RAINBOW | 太阳高度 ∈ (−2°, 40°) 且有水分信号（降水/阵雨/湿度≥88/低云≥70） | 干燥清晨（湿度 25%、无降水）→ 无卡 | 低云 75% + 湿度 92% + 0.2 mm → 有卡 |
| CLOUD_SEA | 有可信海拔 + `band.cover≥80` 的成层低云 + 此点高于带顶 + **民用晨昏内** | ① 无海拔 ② 无成层带 ③ 正午的带（晨昏外）→ 三种都无卡 | 有海拔 + 05–08 时带顶 3600 m（此点 4058 m）→ 有卡 |
| ALPENGLOW（已改名） | 晨昏窗口 + 低云少 + 中高云可染色 + 无降水 | —— 见下 | 18–19 时 mid 60/high 40 → 有卡 |
| 稳定性 | 同一输入两次构建 | 机会清单逐字一致 | — |

**⛔→✅ 日照金山的能力边界（任务书 §6.5）已落地**：现有实现只用了云量、降水与日出日落方位，
**没有目标山峰位置、坡向、可见受光面、视线遮挡（DEM）**，所以它不能叫「日照金山」。
处理是**改主张、不改阈值**（任务书同时禁止用改 `sky.js` 业务规则来遮掩展示层问题）：
`sky.js` 结论标题、`agenda.js` 时间轴标签、`outdoor-intelligence.js` 与 `oi-presentation.js` 的机会名
四处 `日照金山` → **`晨昏光染`**；解释文本追加一句边界：
「这里只用了云量与降水：本工具没有目标山峰的位置、坡向、遮挡（DEM）数据，给不出『某座山会不会金山』。」
新增静态门：客户端 js/wxml/wxss 里**不得再出现「日照金山」作为用户可见主张**（剥掉行注释后再查，
且明确说明：仓库文件是 CRLF，`.` 不匹配 `\r`，所以剥注释的正则**不能带 `$` 锚点**——带了会整条不匹配、门静默假绿）。

**分数语义核查（任务书 §6.6）**：`grade(score)` 产出的 `score` 数字**没有**进入任何展示层
（`grep` 确认 `oi-presentation.js` / `meteogram` / `weather.wxml` 都不读 `.score`），用户看到的是
定性词「条件较好／一般／较差」，机会卡的 `confidence` 也是词不是数 ⇒ 合规，静态门把这条钉住
（禁止 `成功率/置信度 + 数字` 与 `"confidence":"NN%"` 形态）。

🟠 **仍未做**：把「明确不成立 / 证据不足 / 有支持」做成数据结构上的三态（现在「证据不足」仍靠
`confidence: '中'` 这类词与省略混在一起）；光污染没有数据源，星空卡的解释句目前未声明这一缺失。


既有三套 OI 门（`outdoor-cloud-sea` 20 / `outdoor-intelligence` 24 / `outdoor-intelligence-ui` 47）改名后仍全绿，
一条断言都没削弱——它们钉的是阈值与判读逻辑，不是标题文案。

---

## 四、Meteoblue 对标矩阵与气象图可读性（P1/P2，🟠 未完成）

- 🟠 逐项对标矩阵（任务书 §3.2 的 10 项）尚未成文；Meteoblue 侧只有仓库既有截图，本轮没有新参考。
- ✅ 复核了任务书点名要防的「重复制造已修问题」一项：WMO 雪码 80–82 早已在 `utils/conditions.js` 修正
  （雪 = 71–77 ∪ 85–86；80–82 是阵雨），并由 `tools/weather-v2-test.js` 钉住。**本轮未改动、未回退。**
- 🟠 未动：温度极值标注与日期标签的冲突、降水柱可见性与微量夸大、风向箭头密度、昼夜底与日期分隔、
  图例/单位一致性、375/390/414 窄屏文字。按任务书顺序，这些应在云层几何修好之后做——本轮确实把几何排在前面。

---

## 五、测试执行记录（本轮真实跑数，非引用旧报告）

```
node tools/check.js                 → ALL CHECKS PASSED
node tools/check-handlers.js        → 全部组件/页面 handler ✓
node cloudfunctions/trailApi/smoke-test.js        → passed=173 failed=0
node tools/cloud-field-geometry-test.js           → passed=190 failed=0   （本轮新增）
node tools/elevation-semantics-test.js            → passed=34  failed=0    （本轮新增）
node tools/cloud-field-svg-test.js                → passed=27  failed=0
node tools/weather-cloud-field-test.js            → passed=31  failed=0    （29→31：1 条旧契约换成 3 条）
node tools/meteogram-svg / multiday / draw        → 25 / 44 / 30 全绿
node tools/outdoor-intelligence / -ui / cloud-sea → 24 / 47 / 20 全绿
node tools/weather-v2 / visual-audit              → 45 / 38 全绿
node tools/weather-page-test.js                   → passed=149 failed=0
node tools/weather-model / sky / space-time / -draw / roam-scrubber → 82 / 65 / 109 / 55 / 33 全绿
node tools/trip-mode-test.js / journey / journey-graph → 78 / 138 / 12 全绿
```

未跑：全量 57 套头门禁、B 层真机 E2E（原因见 §六）。**不得声称已完成完整回归。**

---

## 六、微信开发者工具真机验证（✅ 已完成，30 张截图 + 两份 manifest）

**环境**：模拟器 390×753 CSS px，dpr 3，brand=devtools。数据是**线上真数据**（`getWeatherByPoint` → 已部署的 `trailApi`，
`updatedAt` 逐张记在 manifest 里），只有驱动是自动化的。
**踩过的坑（已写进根 AGENTS.md）**：Git Bash 会把不加引号的 `D:\OurTrail` 吃成 `D:OurTrail`，
IDE 据此注册了一个新项目，此后每次编译都报「app.json 未找到」，表现就是
**`connect()` 成功但所有命令 20–25 s 超时**——一度被误判成「自动化通道坏了」。
`cli open/auto` 的 `--project` 参数**必须加单引号**。全程未 `quit`/`close`（共享资源）。

**驱动**：`%TEMP%/opencode/mp-auto/ot-v2-shots-c.js`。每例都：`reLaunch` 到 local 模式自由查询页 →
**轮询等到 `unified.src` 真的出现**才拍（首轮 4.5 s 定长等待会拍到无数据的空卡，已作废重跑）→
走页面真实 handler `onSpanToggle` 切 24/48/72h → `ensureMeteogramVisible` → 全屏截图 →
**真实点击 `.cf-img` 并验证后果**（`unified.selSrc` 由 false→true、`hour` 变化、`r2/r3` 读数改写）。
按 `docs/testing/e2e-result-semantics.md` 的口径，这构成 UI 维度的 PASS，不只是 BUSINESS。

| 用例（地点·时间窗） | 修复前 | 修复后 | 点击后果（真机） |
|---|---|---|---|
| 峨眉山 24h / 48h / 72h | 24h、72h | 三窗齐 | 10h/21h/8h 均 `selSrc` 出现，`r2` 改读为「云量 100% · 云区 …」 |
| 理塘 24h / 48h / 72h | 24h | 三窗齐 | 48h 21 时 `r3` 为空 = **无据即沉默**，符合预期 |
| 成都 24h / 48h / 72h | 24h、72h | 三窗齐 | 489 m 用户 → `r3`「头顶有云层」，云区 2,246–3,371 m |

**像素级差异（人眼在截图上直接可比，文件见 §6.2）**：

1. **峨眉山 72h**：修复前深色云团内部有 **3 处白色空洞**（约 5500 m@18 h、4000 m@30 h、2500 m@48 h）——
   正是 71 个自交环被 `fill-rule: evenodd` 挖穿的真云区；修复后云体连续、五档嵌套清楚。
   修复前另有两处**近垂直的直线切边**（约 18 h、42 h 处），是 300+ px 闭合弦落在图上的样子。
2. **理塘 24h**：修复前 5000–5500 m 有一块与上下都不相连的孤立灰斑、3000 m 一块透镜状碎片；
   修复后上层云系成为一条有内部层次的连续带，而 3000 m 与 2000 m 处的**真实薄云团两侧都在**——
   即「该保留的分离没有粘连，该消失的碎片确实消失」。
3. **海拔判读被显示窗吃掉，真机读数直接对得上**：峨眉山 24h 第 10 时，
   修复前 `r2` = 「云区 **2,000**–5,550 m」（起点恰是剖面窗下界 2000 m，说明真实云底被裁掉），
   修复后 = 「云区 **1,686**–5,561 m」（实测云底）。这条是 §二「判读范围 ≠ 显示窗」的现场证据。

### 6.1 新发现（🟠 已确认，本轮未改）：卡片内主语不一致

修复后真机卡片上同时出现 **「此点 3,004 m」**（海拔线，本轮已改）与图例/读数里的 **「你在云中」**
（`weather.wxml` 图例、`cloud-field-svg.inferState` 的三态词、`r3` 文案）。
用户坐在成都查峨眉山时，「你在云中」是一句关于用户本人的假陈述。
建议下一轮：三态词收进 `format.js` 单源（`此点在云中 / 云带在此点下方 / 云层在此点上方`），
连带 `weather-model.js`、`oi-presentation.js`、`meteogram`/`space-time` 的 layout 与图例共约 12 处生产点、
10 处测试断言一起换——**本轮刻意没有做**：它牵动 8 套断言与图例文案，在真机取证中途大改词汇表风险大于收益。

### 6.2 截图索引

目录 `docs/weather-ux/qa/v2-audit-2026-10-09/`（30 张 PNG + `manifest-before.json` / `manifest-after.json`）。
命名 `v2-{before|after|after-verify}-{place}-{span}h-390px-{full|tap}.png`；
`-tap` 那张就是「一次真实点击之后」的状态。manifest 每行记录：地点、经纬度、`ele` 入参与其来源、
`viewSpan`、云函数 `updatedAt`、`chartElev`、点卡 `eleText`、点击前后 `selSrc/hour/r2/r3`、字节数。
`after-verify-emeishan-24h-*` 是把旧实现换回、拍完 before、再还原重编译后的复核张（读数与 after 集一致：云区 1,686–5,561 m）。
另有 18 组**同一份生产渲染器**产出的新旧 SVG 对照（Chromium 光栅化，非微信管线）：
`%TEMP%/ot-cf/svg/index.html`。

**仍未覆盖的真机维度**：375 与 414 CSS px（本机模拟器固定 390；这两档目前只有
`tools/cloud-field-geometry-test.js` 的几何断言与 SVG 对照覆盖）；跨日联动与 OI 卡片联动的真机点击；
`weather-chart` 横屏页。


---

## 七、现场（恢复所需）

- 基线 commit：`076bf11`；工作区脏文件 14 个：
  生产 6 —`miniprogram/pages/weather/weather.js`、`miniprogram/utils/{cloud-field-svg,format,meteogram-svg,outdoor-intelligence,weather-cloud-field}.js`；
  测试 6 —`tools/{cloud-field-svg,meteogram-svg,meteogram-multiday,outdoor-intelligence,weather-cloud-field,weather-v2-visual-audit}-test.js`；
  新增 2 —`tools/cloud-field-geometry-test.js`、`tools/elevation-semantics-test.js`。
- 未部署云函数：本轮**没改** `cloudfunctions/`，无需重新部署（`lib/weather.js` 只读未改）。
- 取证脚本与产物（全在仓库外，不污染零 npm 依赖铁律）：
  `%TEMP%/ot-cf/fetch-real.js`（真实剖面抓取）、`diag2/diag4/diag5.js`（逐环归因、顶点度数、新旧对拍计数）、
  `render-ab.js`（18 组 SVG 前后）、`real-cloud.json`（快照）、`cloud-field-svg.BEFORE.js`（旧实现快照，供变异自证与对拍）、
  `%TEMP%/opencode/mp-auto/ot-v2-shots-b.js`（真机截图驱动，待通道恢复）。
- 待补进 AGENTS.md 的门禁计数：新增 2 套（+224 断言）尚未登记进清单与全量 sweep 链，提交前一并改。
