# Weather V2 三层架构演进 —— 边界、契约与首个纵向切片

日期：2026-10-10 · 基线：`50d657a` · 分支：`win/weather-v2-three-layer-slice`
性质：**架构里程碑（代码交付）**，不是审计报告。纵向切片已实施、已测、业务结果零变化。

关联：R2 边界语义（`qa/v2-oi-scan-r2-2026-10-09/`）、G1/G2 前置门（`qa/v2-r1-gates-audit-2026-10-09/`）、
Q5/Q6 噪声（`qa/v2-q56-noise-audit-2026-10-10/`）、铁律 25–29。

---

## 1. 实际调用图（读代码得到的，不是设想的）

```
L1 天气事实
  cloudfunctions/trailApi/lib/weather.js
    fetchForecast → { elevation, series[168], detail[24], cloudLevels }
    :211  cloudLevels.levels[] = { pressure, altitudes[逐时], cloudCover[逐时] }
          altitude 直接取 geopotential_height_*hPa（当 m ASL 用；见 §7 Q7）
        ▼
  miniprogram/utils/weather-cloud-field.js   buildCloudFieldRange (:78)
    :102-113  covered = 实测覆盖 {lo,hi}（外插区不属于数据）
    :49       resampleColumn 在实测范围之外【填 0】—— 0 是"没测"，不是"无云"
    :137      covered 缺测时给 null（不退回显示窗）
        ▼
  cloudField = { times, altitudes, values[time][alt], covered, userAltitude }
        ▼
  ★ 本轮新增：miniprogram/utils/cloud-layer-facts.js —— L1→L2 的接缝
    resolveRanges()  三个高度范围分开命名（显示窗 / 实测覆盖 / 业务扫描）
    layersAt()       采样场 → 云层事实 {base, top, thickness, meanCover, peakCover,
                     baseBoundary, topBoundary, baseSource, topSource, scanLo, scanHi}
    topmostBelow()   点下方最高层 + 未取整 clearance

L2 户外环境条件
  cloud-field-svg.inferState (:296)   阈值 60/68/70/40 + ALT_TOL(:279) + EDGE_GUARD
    → { key: 'in'|'ok'|'mid'|null, reason: 五类判不出|'clear', holds: [多侧事实] }
  outdoor-intelligence.buildConditions (:114)
    holds → CONDITION 枚举；【key 为 null 时保留 reason，不降级成 CLEAR】
  并行旧路径（未合并，见 §6）：sky.hourMarks (:145) 的 inCloud/cloudSea 标记

L3 户外机会
  outdoor-intelligence.detectCloudSeaCandidates (:230)  净空/覆盖/层厚 + 三本账
  outdoor-intelligence.detectCloudSea (:286)            缺口容忍 → 持续≥2h → 民用晨昏交集
                                                        → 强度四因子 → 结构化 evidence
  outdoor-intelligence.buildOpportunities (:403)        9 类机会（含 marks 回退路径）
  oi-presentation.buildOiCard                           MODEL≠PRESENTATION：tier/时间轴/看图↗
  并行旧路径：sky.cloudSeaConclusion (:245) 的 score、agenda.clustersOf、conditions.factsFor
```

**页面接线**：`pages/weather/weather.js:495 / :1176` 只写 `this.elevBasis = EV.basis`，
把出处分类交给 `format.resolveElev` 单源；OI 与图上判读共用它。

---

## 2. 本轮切片：把「业务扫描范围」从显示窗常量里拿出来

### 切片前

```js
// outdoor-intelligence.js:98（L3 内部，私有）
for (let alt = CFF.ALT0; alt <= CFF.ALT1; alt += step)   // ← ALT0/ALT1 的本职是剖面显示窗
```
扫描范围、显示范围、实测覆盖三件事之间没有任何显式关系；R1 想换扫描范围只能改那个显示层常量，
一改就同时动了图。**而且这件事在代码里看不见**——要读到 `cloud-field-svg.js:22` 才知道被谁管着。

### 切片后

```js
// cloud-layer-facts.js（L1）
displayWindowScanRange() → { lo: CFF.ALT0, hi: CFF.ALT1, source: 'display-window' }
resolveRanges({scanRange, dataCoverage, displayRange})
  → { scan, data, display, scanOutsideData:[下超出m, 上超出m], notes:[...] }
layersAt(sample, t, ranges, {coverMin, step})

// outdoor-intelligence.js:99（L3，只剩薄封装，签名不变）
function cloudLayersAt(sample, t, opts) {
  return CLF.layersAt(sample, t, o.scanRanges || CLF.resolveRanges(o), {...})
}
// :253 候选层选择改走契约
const picked = CLF.topmostBelow(allLayers, userAlt)
```

**缺省路径逐字等价**（`scanRange` 不传 ⇒ `source:'display-window'` ⇒ 仍是 2000–6000），
由 §4 的跨版本对拍证明。R1 换带时只需要传 `ctx.cloudSeaScan.scanRange`，
判定、层边界、证据句会一起跟着走 —— 这一点不是设想，§5 的注入用例已经实测过。

### 同时补的两处

1. **三本账分开**（Q5 要求的三类不确定各有各的名字，不许静默合并）：
   `meta.cloudSea = { candidates, rejected, notEvaluated, scanRanges }`。
   原来只有前两本，**某小时从未进入云海判定**这件事无处记录 ⇒ 无法区分
   "理塘那周没云海天气"与"云在脚下但厚度不够"。`notEvaluated` 每条带
   `{t, condition, abstain, detail}`，其中 `abstain` 就是 L2 的判不出原因。
2. **证据句不再硬编码窗边界**（:335）：`fmtM(det.scanRanges.scan.lo/hi)` 取代 `fmtM(CFF.ALT0/ALT1)`。
   今天两者恒等所以输出不变；R1 换带后若继续读常量，证据会说出与实际相反的数。

---

## 3. 复用了什么 / 哪些依赖仍然跨层

**复用，没有另造引擎**：`sky.hourMarks`（阈值单源，铁律 25/26）、`sky.cloudSeaConclusion`、
`conditions.factsFor`、`agenda.clustersOf` / `visibleSeaWindow`、`cloud-field-svg.inferState` +
`holds`/`key`、`format.resolveElev`/`elevBasis`、R2 的 `baseBoundary`/`topBoundary` 语义、
`oi-presentation` 的卡片契约。新模块只搬了 44 行层提取算法，没有新增任何判定。

**仍然跨层（本轮明确不修，理由在括号里）**：

| 越界依赖 | 现状 | 为什么本轮不动 |
|---|---|---|
| L2 判据住在渲染模块 | `inferState`/`planProfile`/`isoLoops`/SVG 生成同在 `cloud-field-svg.js`（819 行） | 拆它要动 6 个测试套件的 require 路径与 meteogram/cloud-field-poc 的调用面，收益是目录整洁、风险是回归，且 R1 不依赖它 |
| L3 证据文案住在模型层 | `detectCloudSea.flush()` 里拼中文句子 | 铁律 26 已把"词表"收进 `format`，这里是**事实句**不是状态词；搬它等于改 `oi-presentation.summaryOf` 的取词依赖（见 §6 待办 T3） |
| 云海两套口径并存 | `sky.js:262` 的 `baseMin<=2200` 只是加分；OI 路径无此条 | **产品口径未裁决**（§7 D2），本轮不选边 |
| `oi-presentation.summaryOf` 靠文案次序取摘要 | 找不到关键词就退回 `evidence[0]` | 已被 `outdoor-cloud-sea-test` 显式钉住（M9 变异自证），改成结构化字段属接口变更 |

---

## 4. 不变量逐条 + 测试证据

| # | 不变量 | 测试证据（套件 / 用例名） | 结果 |
|---|---|---|---|
| I1 | `sky.js` 仍是天相阈值单源，没有第二套引擎 | `sky-test`(65) 零改动通过；`cloud-layer-facts-test §3`「本模块不导出任何机会阈值」；`cloud-position-test` 词汇门 | 34/0、62/0 |
| I2 | L1 缺数据 ≠ 无云 | `cloud-layer-facts-test §1`「无实测覆盖时如实说无法判断」；`§2`「云在覆盖内、扫描范围外 ⇒ 零层，不拿填充 0 造出一层无云」；`resolveRanges.scanOutsideData` + notes「那段读到的是填充 0，不等于无云」 | ✓ |
| I3 | L2 未知 ≠ `CLEAR`；不同未知原因不合并 | `cloud-layer-facts-test §5`「无高程 ⇒ 24 小时全落 notEvaluated 且 abstain 恒为 `no-altitude`，无一条被当成晴空或机会」；`cloud-position-test`(62) 五类判不出各有反例 | ✓ |
| I4 | `holds` 多侧事实不被单个 `key` 覆盖 | `cloud-position-test` §2/§3（未改动，全绿）；`cloud-layer-facts-test` 三本账互斥用例 | ✓ |
| I5 | 显示剖面范围不决定业务扫描范围 | `cloud-position-test` §8 三条：显示窗参数改到极端 ⇒ 条件态与机会窗口逐项不变、**业务扫描范围一个数都不动**、机会层源码不出现 `profile/PROFILE`；`cloud-layer-facts-test §1` 调用方可显式给范围 | 62/0 |
| I6 | 被扫描边界截断的云层不冒充完整云层 | `cloud-layer-facts-test §2` 四种边界形态 + 「来源词表与布尔恒等」；`§5`「只把扫描下沿从 2,000 降到 1,100 ⇒ 同一份数据的截断消失」；`outdoor-cloud-sea-test` R2 段 11 条 | ✓ |
| I7 | 同一时刻图 / 条件态 / 机会卡不互相矛盾 | `weather-page-test`(177)、`meteogram-readability`(77)、`oi-claim-gate`(25) 全绿未改 | ✓ |
| I8 | 不新增外部依赖、不改云函数、不碰无关页面 | `git diff --name-only` 只含 3 个 miniprogram/tools 文件 + 新模块；`cloudfunctions/` 0 改动；`cloud-layer-facts-test §6` 静态门（require 只指 `cloud-field-svg`、无 npm 包名） | ✓ |
| I9 | 不引入新阈值/缓冲值/概率表达 | `CLOUD_SEA` 常量表 diff 为零；新模块只收 `coverMin`/`step` 入参且默认值由调用方给；A/B 111 组业务差异 0 | ✓ |
| I10 | 候选层选择的已知缺陷不被静默扩大 | `cloud-layer-facts-test §4` 特征化断言钉住「上界夹到点海拔 ⇒ 1 m 薄皮屏蔽 560 m 厚层」，并配一条"放回上界后厚层被正常选中"的对照 | ✓ |

---

## 5. 新旧业务结果差异（跨版本对拍）

`docs/weather-ux/architecture/tools/ab-slice.js`：`git archive 50d657a miniprogram/utils` 取到仓库外，
两份模块实例喂**同一份输入**跑整条 OI 管线，逐字段比。

```
合计比对 111 组：业务判据差异 0 组、附加字段结构差异 0 组、负证据 detail 文案差异 48 条
```

- **111 组** = 9 合成形态 × 3 种海拔出处 + 真实快照 4 站 × 7 天 × 3 出处（`real-cloud-g2.json`）。
- 被逐字段比较的业务量：`opportunities` 的 type/from/to/confidence/rank/strength/overlapsSunrise、
  云海窗口覆盖的小时集合、`layers[].{t,base,top,cover,clearance}`、层数量与顺序、
  `baseBoundary/topBoundary`、`conditions[].{t,key,reason,holds}`、候选清单、拒绝原因码。
- **真实快照读数**：峨眉山 2026-10-11（basis=measured）`CLOUD_SEA@16:00–19:05`，
  云海覆盖小时数 **3 → 3**，候选 4、拒绝 6，两侧完全相同。
- **唯一允许的变化，逐条列出**：
  ① 层记录新增 `baseSource/topSource/scanLo/scanHi`（只增不减，键集合超集已断言）；
  ② `meta.cloudSea` 新增 `notEvaluated` / `scanRanges`；
  ③ `INSUFFICIENT_THICKNESS` 的 `detail` 补一句边界说明（48 条，全部同一形态）：
  `层厚 283 m < 300 m` → `层厚 283 m < 300 m（该层有一端是扫描窗边界，厚度是窗内可见部分）`。
  这是模型内部负证据，UI 不展示、不参与任何判定。

**对拍器本身有牙齿**（`tools/mutate-ab.js`，8 条业务级变异注入临时副本后重跑）：

```
V1 步长 50→40 ✓抓到(7 组)   V5 去掉退出点插值 ✓抓到(8 组)
V2 净空 200→300 ✓(1 组)     V6 抹掉截断标记   ✓(4 组)
V3 层厚 300→200 ✓(3 组)     V7 候选层改选最厚 ✓(1 组)
V4 覆盖 80→70 ✓(10 组)      V8 上界夹到点海拔 ✓(7 组)
变异 8 条，漏网 0 条
```
V5 值得单独指出：**上一轮 Q6 那个错（漏退出点插值）如果发生在今天这套对拍下会被当场抓住** ——
这正是铁律 29 要求"纠正用的探针必须先与生产实现等价"的具体形态。

---

## 6. R1 迁移方案（接口已就位，本轮不改候选集合）

R1 = 把业务云层扫描范围从显示窗里彻底解耦。本轮留下的接缝：

| 待办 | 内容 | 依赖 |
|---|---|---|
| **T1** | 页面按查询点算相对带并传 `ctx.cloudSeaScan.scanRange = {lo, hi, source:'relative-to-point'}`；**上界必须高于查询点海拔**（§4 I10 实测：夹到点会造出 1 m 薄皮屏蔽真层） | 需 **D1**（下界取多少 / 相对上限 D） |
| **T2** | 下沿量化到全局 50 m 格，避免逐点漂移引入网格相位噪声；验收 = 新带形下 50 相位**候选级**翻转率 = 0（探针：`qa/v2-q56-noise-audit-2026-10-10/tools/q6-grid-phase-stability.js`） | 无（可先做实验） |
| **T3** | 若证据文案要继续扩展，先把 `oi-presentation.summaryOf` 的"靠关键词与次序取摘要"改成显式字段（否则改文案＝改接口，见铁律 28③） | 无 |
| **T4** | `notEvaluated` 若要给用户看（"为什么这儿没有云海卡"），话术必须走 `format.CLOUD_POSITION_REASONS` 单源，不在页面自造状态词（铁律 22） | 产品决定要不要展示 |

**本轮明确没做**：没换扫描范围、没改 `2000–6000`、没碰 300/80/200/2200/±600 任何一个数、
没改候选层选择规则（`topmostBelow` 行为与原 `below[len-1]` 逐字相同）。

---

## 7. 尚需人工决策的问题（工程侧不代答）

| # | 待决 | 已有证据 |
|---|---|---|
| **D1** | 云海的扫描下界取多少 / 要不要相对上限 D | 真实快照上净空 max 仅 654 m ⇒ cap=2500 **一条都没删掉**（无观测到的失效模式支持设这个值）；不得凭空选数 |
| **D2** | P2 spec 的「低层有云带（底 ≤2200 m）」在 OI 新路径上恢复为门槛 / 保留为加分 / 显式作废 | `sky.js:262` 只加分；OI 路径无此条 ⇒ 两套口径并存 |
| **D3** | `LAYER_THICKNESS_MIN=300` 走 G1 方案 B（降级为产品保守值）还是 A（重新取样并入库凭据） | 样本与脚本从未入库、不可达对象里也没有；现存两份快照 P50 = 867 / 519 m，300 落在 P25 / P32 ⇒ **不可核对，也不可证伪** |
| **D4** | `basis=measured` 的 `tol=0` 是断言还是测量？GPX/选点/手填要不要给误差带 | `cloud-field-svg.js:276–277` 自陈"没有可量化误差资料"；候选净空余量实测 9–424 m |
| **D5** | `basis=estimated` 在名义海拔上 672 小时 0 次 `CLOUD_BELOW` ⇒ 普通查询不出云海卡：保留，还是给"海拔不够准所以不说"的话术 | Q5 实测；机制（±600 带 ⇒ 隐含净空 ≥~800 m）已验证 |
| **D6** | 候选层选择规则（薄皮屏蔽厚层）是否改 | 机制已用三层读数定位；改它必然改变候选集合 ⇒ 属 R1 决策，不是重构副产品 |
| **Q7** | `geopotential_height` 直接当几何高度（m ASL）是否成立 | 未核到权威出处，登记不假设 |

---

## 8. 测试、真机、Git 与回滚

**门禁（本轮实跑，非引用）**

```
node tools/check.js            exit 0   ALL CHECKS PASSED
node tools/check-handlers.js   exit 0
全量无头                        63 套 / 4299 断言 / 失败合计 0 / 全部 exit 0
                                （基线 62 套 / 4260；+1 套件、+39 断言）
```

| 套件 | 基线 | 本轮 | 变化 |
|---|---|---|---|
| `cloud-layer-facts-test`（新） | — | **37 / 0** | 新增：三范围契约 / 四种边界形态 / 层几何不越权 / 候选选择与遮挡缺陷特征化 / OI 集成与注入接缝 / 分层依赖静态门 |
| `cloud-position-test` | 60 / 0 | **62 / 0** | +2：把一条**静态源码门**（正则找 `for (let alt = CFF.ALT0…)`）换成三条行为断言；搬家不再被误判成改判据 |
| `outdoor-cloud-sea-test` | 31 / 0 | 31 / 0 | 未动（R2 段 11 条继续绿，含业务数值钉值） |
| `outdoor-intelligence-test` / `-ui-test` / `oi-claim-gate` | 25 / 47 / 25 | 25 / 47 / 25 | 未动 |
| `weather-page` 177 / `weather-v2` 45 / `weather-cloud-field` 31 / `cloud-field-svg` 29 / `cloud-field-geometry` 206 / `elevation-semantics` 34 / `meteogram-*` 25+48+77+30 / `sky` 65 / `astro` 60 / `smoke` 173 | 全部 0 失败 | 同 | 未动 |

**真机**：本轮**未跑设备**。理由：切片是纯函数搬家 + 附加字段，页面渲染路径与卡片文本零变化，
A/B 已证明用户可见输出逐字相同。开发者工具 9420 会话属于哪份工作副本无法从命令行证明，
重开项目会动共享实例 ⇒ 按规矩不擅自执行，标 **UNVERIFIED**。
（R2 那轮已就同一风险留过 4 张注入式排版核验，卡片标记自那以后未改动。）

**Git 与回滚**：全部改动落在分支 `win/weather-v2-three-layer-slice` 的**一个提交**里，未推送、未合并，
`master` 仍在 `50d657a`。回滚 = `git revert <本分支唯一提交>`：`git log --oneline 50d657a..HEAD`
只有一行 ⇒ 该提交的父就是本轮基线，revert 不存在冲突面，结果树逐字节回到基线
（新模块与新测试随提交消失，`outdoor-intelligence.js` 与 `cloud-position-test.js` 复原）。
基线自身本轮开工前实测全绿（62 套 / 4260 / 0 失败），所以"退回已知绿态"这一步不需要重新证明。
因为业务结果经对拍证明零变化，回滚不需要数据迁移，也不需要重新部署 `trailApi`。

**未验证 / 已知限制**：样本只有 2026-10-09 同一周，不可外推季节；`notEvaluated` 目前每日常驻 24 条记录，
只在模型内部（未进 `setData`，`weather.js` 不读 `meta`），若将来展示需配 T4；
注入接缝 `ctx.cloudSeaScan` 今天生产路径不使用（只有测试在用），它的真实价值要到 R1 才被兑现。
