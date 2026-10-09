# Weather V2 最终视觉审计 —— Meteoblue 对标 / Cloud Field 几何 / 海拔语义 / 天象可信度

**任务书**：`OurTrail Weather V2：Meteoblue 对标审计、气象图质量修复与户外天象可信度治理`（2026-10-09 业主下发，全程自主执行）
**基线**：`master` = `076bf11`，开工时工作区干净（`git status --short` 0 行）。
**本轮状态**：阶段 A/B/C 完成并**经真机验证**（§六，30 张截图）；阶段 D/E 只完成其中与 P0 相关的两条；
对标矩阵与温度/降水/风/窄屏精修未做（§四）。
**本文的四种判定用语**：✅ 已实现并通过验证 ｜ 🟡 已实现但未完成验证 ｜ 🟠 已确认问题但未修复 ｜ ⛔ 受数据/能力限制本阶段不做。

---

## 〇、任务书逐条完成度矩阵（查漏用，每条给证据指针）

| 任务书条目 | 状态 | 证据指针 |
|---|---|---|
| §二 2.1 先检查现状 | ✅ | 本文 §〇表下「基线」段；13 套天气套件基线计数、真实剖面抓取记录 |
| §二 2.2 保护现有成果（独立分支/worktree） | ✅（第二轮补做） | 第一轮误在 `master` 上直接改（22 项脏文件）→ 已建 `win/weather-v2-audit` 提交 `53c2072`，`master` 未动 |
| §二 2.2 不削弱不变量/不为过测试改文案 | ✅ | `weather-cloud-field` 29→31 是**被证伪旧契约的替换**（§二.末），三套 OI 门 20/24/47 未改一条断言 |
| §三 3.1 固定对比条件 | ✅ | 本文 §一表下；`qa/…/manifest-*.json` 记录坐标/时间窗/updatedAt/宽度 |
| §三 3.2 十项对标矩阵 | ✅ | 本文 §四（本轮补全） |
| §四 B Cloud Field 数据链路 10 步 | ✅ | 本文 §一.1（含被证伪的三条假设） |
| §四 4.2 四类问题区分 | ✅ | §一.1 表格（A 数据突变 / B 换算插值 / C 几何 / D 展示） |
| §四 4.3 修复原则（不遮掩、不粘连、不补云） | ✅ | §一.3 + `cloud-field-geometry` 第 4/5/6/10/11 组 |
| §四 4.4 可验证几何测试（11 类） | ✅ | `tools/cloud-field-geometry-test.js` 190 断言 + 变异自证 |
| §四 4.5 视觉验收（放大/多窗/多地点/多宽度） | 🟡 部分 | 真机 390px 全量 + 2× 放大前后 2 组（375/414 走 SVG 光栅化，非微信管线）；见 §六.2 |
| §五 C 海拔语义（六类值区分 + 四种查询模式） | ✅ | 本文 §二 + `elevation-semantics-test.js` 34 |
| §五 5.3 路线模式逐节点海拔 | ✅（第二轮补做） | `weather-page-test.js` §12（7 断言：节点 1/2/3 各自海拔、model 回退、标签带「模型估算」） |
| §六 D 6.1 不成立机会省略 | ✅ | `oi-claim-gate-test.js` §1–§3（星空/银河/彩虹/云海，每条配反向对照） |
| §六 6.2 区分「不成立」与「无法判断」 | ✅（第二轮补做） | `meta.evidenceGaps` 显式记账缺项；条件态在无剖面时给 `null` 而非「晴空」（实测） |
| §六 6.3 彩虹等有界判断 | ✅ | `oi-claim-gate` §2（干燥无卡 / 有水分有卡） |
| §六 6.4 银河星空 + 光污染声明 | ✅（第二轮补做） | `oi-claim-gate` §7：剖面满云时夜间天空卡必须消失（实测修复前会出卡）+ 证据句声明光污染未纳入 |
| §六 6.5 日照金山能力边界 | ✅ | 四处改名「晨昏光染」+ 边界句 + 静态门（`oi-claim-gate` §4） |
| §六 6.6 置信度与解释可追溯 | ✅ | `grade(score)` 数字未进任何展示层（grep 核实）+ 静态门禁「成功率/置信度+数字」 |
| §七 E 温度/降水/风/昼夜/时间轴/图例 | ✅（第二轮补做） | 本文 §四 + `meteogram-readability-test.js` 55 断言（三条真缺陷：柱宽不随窗口、缺测补中点、微量不可见） |
| §八 F 事实/解释/建议三层 | ✅（第二轮补做） | 建议句从 WXML 硬编码收进 `format.PHENO_ADVICE`，`oi-claim-gate` §8 五条判据 |
| §九 G 自动化回归 | ✅ | 本文 §五 + §七终读（60 套 / 4046+ 断言） |
| §九 9.2/9.3 真机与截图矩阵 | 🟡 部分 | 390×753 真机 30 张 + manifest；375/414 真机未做（本机模拟器固定 390），已登记 |
| §十 H 审计报告 | ✅ | 本文件 |
| §十一 完成标准 11 条 | 9 ✅ / 2 🟡 | 未达的两条即上面两个 🟡（375/414 真机、放大对照仅 2 组） |

---

## 〇·基线

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

## 四、十项对标矩阵与气象图可读性（P1，✅ 本轮补全）

判据全部来自**解析生产渲染器输出的 SVG 图元**，不看源码字符串；新门 `tools/meteogram-readability-test.js`（**55** 断言）。
严重度按「对用户判断的影响」定，不按观感定。

| # | 任务书检查项 | 现象（修复前，实测） | 对决策的影响 | 根因 | 严重度 | 处置 | 验收 |
|---|---|---|---|---|---|---|---|
| 1 | 温度曲线连续、能读出当前/最高/最低及发生时间 | 缺测小时被画成**量程中点**（24h 序列去掉 5/6 两小时后，曲线在这两小时出现顶点 y=64.00=中点） | 用户会把**根本不存在**的温度当成实测谷值来安排出发时间 | `renderUnifiedBase` 用 `r.temp == null ? (lo+hi)/2 : temp` 兜底 | **高**（数据造假级） | 改为按「连续有值段」分别成线；孤立一小时画 r=1.6 圆点；选中层缺测时不画温度点 | readability §3（5 条，含反对照） |
| 2 | 降水柱正确表达时间/量级/持续性 | 柱宽与 pop 底带宽**一律按 24 算**：72h 时 cell 只有 4.54px，而雨+阵雨两柱加间隙要 8.2px | 多日视图里柱子互相压叠、不再对齐所属小时，用户读不出「哪一小时下」 | `bw = plotW/24*0.2635`、`width = plotW/24` 未随 horizon | **高** | 柱宽 = `max(1.1, cellW×0.30)`，底带宽 = cellW；选中高亮框与柱体同源 | readability §1（24/48/72 各 5 条）+ §4 |
| 2b | 微量降水可见但不夸大 | 0.1 mm 在 max=18 mm 时柱高 **0.20px**（看不见） | 「几乎没雨」和「有 0.1 mm」在图上无法区分 | 纯线性量程无下限 | 中 | 1.2px 可见下限，**只吃亚像素量**：18 mm : 2 mm 仍保持线性 9.0 倍 | readability §2 |
| 3 | Cloud Field 表达高度/厚度/覆盖率/随时间变化 | 见 §一：断链 49、自交环 71、直线斜边 55、误连两层 1 | 云体被切出白洞、被拉出横贯整图的直线 ⇒ 用户读到的云层结构是假的 | 外扩圈复制边缘值 + 坐标键量化 + mean-y 配对 | **最高** | §一.3 三条修复 | `cloud-field-geometry` 190 + 真机前后 §六 |
| 4 | 云高与地形高度的关系是否清晰 | 剖面窗固定 2000–6000 m；实测范围外被端点钳制成「有云」；判读也受该窗限制 | 高台站点会把没有测量的下半幅读成有云；云系在窗外时答「无结论」 | `resampleColumn` 端点钳制 + `inferState/denseSpanAt/peakCover` 扫 ALT0–ALT1 | 高 | 实测范围外置 0（=无数据）；判读改扫实测网格 0–7000 m；标签与 covered 同源 | elevation §4 + geometry §9/§10 |
| 4b | 地形高度本身 | ⛔ 无 DEM/地形高程服务，剖面只画气压层的**位势高度** | — | 数据能力限制 | — | 不显示"地形线"，只标实测层高度与 `covered`；海拔出处显式标 GPX/选点/手填/模型 | §二 |
| 5 | 风速/阵风/风向表达 | 方向映射与密度**此前无任何测试**（windDir=0 画成 0° 还是 180° 全靠人眼） | 风向画反 = 用户读错迎风坡与体感温度 | 缺测试，非代码错（实测映射正确：0°→180°、90°→270°） | 中 | 钉住语义 + 箭头步长随窗口（24h 每时、48h 每 2h、72h 每 3h，间距 ≥10px） | readability §7 |
| 6 | 昼/夜/日出日落过渡 | 24h 单渐变、48/72 按日分段 ✓；但某天缺日出数据时该日整段无夜底（静默） | 缺数据日看起来像"全天白昼" | `opts.sunTimes` 空洞时直接跳过 | 低 | 钉住「只画有数据的那天」，并在 `meta.evidenceGaps` 记 `sunTimes` | readability §6 |
| 7 | 日期分隔、时间刻度、当前时刻线 | 日界线 `stroke-width:1` 强于小时网格 ✓；轴刻度 24h 每 2h、多日每 6h ✓；选中 chip 在 Day2+ 带日名 ✓ | — | — | — | 现状合规，补断言防退化 | readability §5/§6 |
| 8 | 多日是否拥挤、窄屏可辨认 | 375/390/414 × 24/48/72 共 9 组：时间标签中心距最小 9.5px（8px 字号两位数字宽约 9px）✓；无图元出界 ✓ | — | — | 低（此前未测） | 9 组全部钉住 | readability §5（18 条） |
| 9 | 图例、单位、色彩、留白、层级 | 行内单位齐（温度 °C / 降水 mm/h / 云量·高度 m / 风 km/h）✓；🟠 图例与读数仍写「你在云中」，与本轮改后的「此点 3,004 m」**主语不一致** | 用户在自己不在现场时读到关于自己的假陈述 | 三态词与图例分散在 12 处生产点 | 中 | 🟠 **本轮未改**（牵动 8 套断言与图例文案，登记在 §六.1，含具体方案） | — |
| 10 | 能否快速回答「什么时候更好/有何风险/依据是什么」 | 依据链 ✓（每条结论可展开为图上可核对的事实 + 「看图 ↗」定位小时）；建议层原为 WXML 硬编码一句、对所有 featured 卡通用 | 建议与现象不匹配 = 误导 | 建议文案没有单源、没有按现象给 | 中 | 建议收进 `format.PHENO_ADVICE` 按现象给，且「有建议必须有证据」；⛔ 跨日"哪天更好"的综合排序仍缺（日卡只有 hi/lo/降水） | `oi-claim-gate` §8（5 条） |

**没有做的事**：不为了平滑而改动温度/云的原始数据（§一.4 的负结果就是这条原则的产物）；不引入新外部服务或密钥；不改 `sky.js` 阈值。
**点名复核**：任务书 §7.2 要求「若 `buildCallouts()` 仍把 WMO 80–82 归为降雪则修复，不得重复制造已修问题」——
实测该修复**早已存在**于 `utils/conditions.js`（雪 = 71–77 ∪ 85–86，80–82 是阵雨），并由 `tools/weather-v2-test.js` 三条断言 + 14 °C 阵雨日集成用例钉住。本轮未改动、未回退。


---

## 五、测试执行记录（本轮真实跑数，非引用旧报告）

**无头门禁终读：61 份读数（60 个 `tools/*-test.js` + `smoke-test.js`）= 4118 过 / 0 败。**
本轮新增/改动的套件逐条：

```
node tools/cloud-field-geometry-test.js        → passed=190 failed=0   （新增）
node tools/elevation-semantics-test.js         → passed=34  failed=0    （新增）
node tools/meteogram-readability-test.js       → passed=55  failed=0    （新增）
node tools/oi-claim-gate-test.js               → passed=25  failed=0    （新增）
node tools/weather-cloud-field-test.js         → passed=31  failed=0    （29→31：1 条旧契约换成 3 条）
node tools/weather-page-test.js                → passed=156 failed=0    （149→156：路线模式海拔 7 条）
node tools/cloud-field-svg-test.js             → 27 · meteogram-svg 25 · multiday 44 · draw 30
node tools/outdoor-intelligence 24 / -ui 47 / cloud-sea 20 · weather-v2 45 / visual-audit 38
node tools/weather-model 82 · sky 65 · space-time 109 / -draw 55 · roam-scrubber 33 · trip-mode 78
node tools/check.js                            → ALL CHECKS PASSED
node tools/check-handlers.js                   → 全部 ✓
node cloudfunctions/trailApi/smoke-test.js     → passed=173 failed=0
```

**B 层真机套件（`tools/e2e-ui-test.js`，需开发者工具，不计入无头门禁）**：
本轮真的跑起来了，并且抓到一个**上一轮遗留的测试侧欠账**：076bf11 把服务端「缺失 `expectedRevision`
就默认取当前值」的盲写洞补上之后，B 层套件的建档/发布 6 处调用一直**没有带 revision**，
于是整条链从第一步就 `NO_REVISION`（实测 5 条 BUSINESS FAIL + 6 条 INCONCLUSIVE + 3 条 UI FAIL）。
⇒ 补 `dispatchRev()`（每次尝试重读全局 revision，只有 CONFLICT/STORAGE 才重试，业务错误码原样返回），
6 处调用改走它。**这不是把测试改绿**：服务端行为是对的（`e2e-revision-guard-test.js` 16 条钉着），
错的是调用方没跟上契约。

**修后同一条 B 层链的真实终读**（`OURTRAIL_AUTO_PORT=9466 node tools/e2e-ui-test.js`，exit=2）：

```
BUSINESS: PASS          26 通过 / 0 失败 / 0 未验证
UI:       INCONCLUSIVE  64 通过 / 0 失败 / 1 未验证
ENV:      3 项前置（0 项不成立）          →  合计 passed=90 failed=0 unverified=1
```

走通的真实操作包括：建 `[预演]` 沙盒 → 发布即报名本人 → 详情页装配 → 名单审核 → 分车弹层两次开合 →
座位示意出已占座 → 现场签到 → 弹层出发核实落库（`departure=joined`）→ 到家确认落库。
唯一那 1 条未验证是**既有已知限制**（原生 `<picker>` 授权弹层不在可查询树，探针实测 `.wx-picker/picker-view` 0 命中），
账本按 INCONCLUSIVE 记而不是 PASS——退出码 2 是正确语义，不是失败。

未跑：`tools/e2e-ui-state-test.js`、`tools/e2e-golden-path-test.js`（同一套 `cli.bat` 自调通道，本轮优先修主链）。



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
另有 18 组**同一份生产渲染器**产出的新旧 SVG 对照（Chromium 光栅化，非微信管线），
其中云场行 2× 放大的前后并排图已入库两张代表样本：
`ot-zoom-emeishan-24h-375px.png`（左=修复前：一条约 3000 m@8 h → 6000 m@16 h 的**直线斜切**横穿云体、云团内部 3 处白色空洞、2000–2500 m 若干针状碎片；右=修复后：连续嵌套、无斜切、无穿洞，4000 m 处的真实晴空 pocket 保留且边缘平滑）
与 `ot-zoom-emeishan-72h-414px.png`（最长时间窗 + 最窄设备宽度的组合）。
可复现脚本在 `qa/v2-audit-2026-10-09/tools/`：`fetch-real.js`（真实剖面）→ `render-ab.js`（18 组整卡）→
`render-zoom.js`（18 组云场行 2× 放大，输出 `zoom.html`）→ `diag5.js`（新旧逐环计数对拍）。


**仍未覆盖的真机维度**：375 与 414 CSS px（本机模拟器固定 390；这两档目前只有
`tools/cloud-field-geometry-test.js` 的几何断言与 SVG 对照覆盖）；跨日联动与 OI 卡片联动的真机点击；
`weather-chart` 横屏页。


---

## 七、现场（恢复所需）

- 分支：`win/weather-v2-audit`（合规 §2.2 的隔离要求）。第一轮提交 `53c2072` 在基线 `076bf11` 之上；
  第二轮（阶段 E/F + B 层修链）在其后继续。**`master` 未被触碰**。
- 生产代码改动（全部客户端，`cloudfunctions/` 零改动 ⇒ 不需要重新部署）：
  `miniprogram/utils/{cloud-field-svg,weather-cloud-field,meteogram-svg,format,outdoor-intelligence,sky,agenda,oi-presentation}.js`
  ＋ `miniprogram/pages/weather/{weather.js,weather.wxml}`。
- 测试：新增 4 套（`cloud-field-geometry` / `elevation-semantics` / `meteogram-readability` / `oi-claim-gate`），
  更新 8 套（`weather-cloud-field`、`weather-page`、`cloud-field-svg`、`meteogram-svg`、`meteogram-multiday`、
  `outdoor-intelligence`、`weather-v2-visual-audit`、`e2e-ui-test`）。
- 证据包：`docs/weather-ux/qa/v2-audit-2026-10-09/`（30 张真机 PNG + 2 张 2× 放大对照 + 2 份 manifest +
  `README.md` 索引 + `tools/` 四个复现脚本）。
- 取证中间产物在仓库外（`%TEMP%/ot-cf/`）：`real-cloud.json` 真实剖面快照、`cloud-field-svg.BEFORE.js`
  修复前快照（用 `git show 076bf11:miniprogram/utils/cloud-field-svg.js` 可随时取回）、
  `diag2/4/5.js` 逐环归因脚本、`svg/` 18 组新旧 SVG 与 `zoom.html`。
- 开发者工具：全程只 `cli open` / `cli auto`，**未 `quit` / `close`**（共享资源）。
  `--project` 参数**必须加单引号**，否则 Git Bash 吃掉反斜杠 ⇒ 见 SYNC.md 2026-10-09 与根 AGENTS.md 每轮流程一节。

---

## 八、已知问题、未完成项与后续建议

| # | 项 | 状态 | 为什么现在不做 / 建议怎么做 |
|---|---|---|---|
| 1 | 图例与 `r3` 三态词仍是「你在云中 / 云在脚下」，与本轮改后的「此点 3,004 m」**同一张卡两种主语** | 🟠 已确认未修 | 牵动 12 处生产点（含 `weather-model.js`、`space-time/layout.js`、`meteogram/layout.js`、`weather.wxml` 图例）与 8 套断言里 10 余条；在真机取证中途大改词汇表，回归面大于收益。建议：三态词收进 `format.js`（`此点在云中 / 云带在此点下方 / 云层在此点上方`），连同图例与 `journey-graph-test` 的词汇漂移门一次改完 |
| 2 | 375 与 414 两档**真机**未拍 | 🟡 受环境限制 | 本机模拟器固定 390×753。这两档由 `meteogram-readability` §5 与 `cloud-field-geometry` §12 在 SVG/几何层覆盖，另有 Chromium 光栅化 2× 放大对照。建议：换设备档位后跑 `qa/…/tools/render-zoom.js` 的 18 组 |
| 3 | OI「不成立 / 证据不足 / 有支持」三态在**卡片层**仍未分离 | 🟠 部分完成 | 本轮落了 `meta.evidenceGaps`（缺项显式记账）+ 各省略闸；卡片仍只有 `confidence` 一个词维度。建议给窗口加 `basis: 'measured' \| 'inference' \| 'gap'`，展示层据此决定"给窗口"还是"给一句缺什么" |
| 4 | 跨日「哪天更好」的综合排序缺失 | ⛔ 未实现 | 日卡只有 hi/lo/降水/风，没有把三层证据合成可解释的日际比较。这是产品口径问题，需业主先定"要不要给推荐日" |
| 5 | 天气线 `outdoor-intelligence-ui` 的"常驻非确定性红" | ✅ 本轮未复现 | 多次连跑 47/0；AGENTS 的 recount 已改写此说。若再出现按 DRIFT 流程处理，不要当噪声 |
| 6 | B 层套件与 revision 契约的耦合 | ✅ 本轮修（附建议） | 见 §五：076bf11 收紧服务端 revision 后 `e2e-ui-test.js` 6 处 dispatch 没跟上。建议给 `e2e-*` 加一条静态门：凡 `dispatch` 必须带 `expectedRevision`，否则红——防的正是"测试自己不合契约" |
| 7 | 剖面显示窗固定 2000–6000 m | 🟠 已知限制 | 云系整体在窗外时图上为空（判读仍给正确结论，见 geometry §9）。建议按 `covered` 与用户海拔自适应窗高，或至少在空剖面上印一句"本次剖面未覆盖实测云系" |

**一句话结论**：Cloud Field 的尖角/空洞/斜边不是渲染参数问题，是**外扩圈填法导致等值环闭不上**之后两套启发式在硬凑；
海拔类文案的问题不是措辞，是**系统根本不知道用户在哪**；机会卡的问题不是卡片太少，是**证据冲突时挑了乐观的那一张**。
三处都按「先取证 → 改数据/拓扑/语义 → 用会红的门钉住」处理，视觉只是随之变干净。


