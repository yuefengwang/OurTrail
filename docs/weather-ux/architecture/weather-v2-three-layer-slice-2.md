# Weather V2 三层架构 · 切片二：成层判据单源 + 摘要改由结构化证据决定

日期：2026-10-10 · 分支：`win/weather-v2-three-layer-slice-2` · 基线：`92036e9`（切片一末，**尚未进入 master**）
上游：`weather-v2-three-layer-evolution.md`（切片一 ADR）· 铁律 26/27/28/29/30
性质：架构解耦，**不是**业务规则优化。本轮未实施 R1、未裁决 D1–D6/Q7、未改任何气象阈值。

---

## 1. 修改前的依赖与判据审计（任务书 §3 的五个问题，逐条带出处）

### 1.1 `h.band.cover >= 80` 到底在说什么

它**既不是判定也不是显示过滤，而是对上游事实的同义反复**。

云函数 `cloudfunctions/trailApi/lib/weather.js` 的 `cloudBandAt()`：

```
:114  const solid = levels.filter(l => l.cc >= 80)   // 只有 ≥80% 的层参与成带
:115  if (!solid.length) return null                 // 一个都没有 ⇒ band = null
:117  for (const l of solid) cover = Math.max(cover, l.cc)
:121  cover: Math.round(cover)                       // band.cover = 那些层里最大的云量
```

⇒ **`band !== null` 就已经蕴含 `band.cover >= 80`**。客户端三处 `cover >= 80` 都在重述这一条：

| 出处 | 用途 | 性质 |
|---|---|---|
| `sky.js:170`（`hourMarks` 的 cloudSea 分支） | 逐时标记 | 恒真重述 |
| `sky.js:258`（`cloudSeaConclusion` 的 `solid`） | 结论文案 + 「无 80% 以上云量的层」那句 | 恒真重述，且**数字被印给用户** |
| `conditions.js:130`（`factsFor('cloudSea')` 的 `bandHours`） | 结论卡/机会卡的证据行 | 恒真重述 |

**为什么不干脆删掉**（这是本轮唯一需要"保留重复"的地方）：`detail[].band` 除了新拉的云函数返回，还可能来自 `ot_weather_cache`（30 分钟）与线上历史形态；一旦上游规则变过（或旧缓存里存在 `cover < 80` 的 band），删掉过滤会把不该算成层的带印成「低层云带」。
所以本轮的选择是：**判据保留，但只有一个名字、一个出处**（`cloud-layer-facts.isCloudBand`），并让它**可被影子改写**（见 §5 的变异自证）。
顺带修正：`conditions.js` 的文件头原本写着「这里绝不复制 <30、≥80 这类阈值」——那句话与 `:120` 的代码互相矛盾，现在注释与代码一致了。

### 1.2 L1 已经产生的成层结果有两种，语义与完整性都不同

| | provider `detail[].band`（`cloudBandAt`） | `cloud-layer-facts.layersAt(sample, t, ranges, …)` |
|---|---|---|
| 输入 | 9–22 个**离散**气压层的云量 | 重采样后的**连续**剖面（`covered` 之外填 0） |
| 步长 | 无（层就是采样点） | `FIELD_LAYER_STEP_M = 50 m` |
| 层边界 | 取离散层的最低/最高几何高度 | 相邻点**线性插值**找阈值穿越点 |
| 层数量 | **恒为 1 条**：所有 ≥80 的层合并成一条（跨间隙也不分家） | 多条，按 base 升序 |
| 厚度 | 无 `thickness` 概念 | `thickness`、`meanCover`、`peakCover` |
| 边界诚实性 | 无标记 | `baseBoundary/topBoundary` + `baseSource/topSource` + `scanLo/scanHi` |

⇒ **不能拿后者替前者**：`factsFor` 印的是「低层云带 <min base>–<max top> m」，这条带在两层之间有大间隙时会横跨整个间隙（合并），而 `layersAt` 会给出两条分开的层。替换会**改变印出来的数字**——任务书禁止（「用户可见摘要文案零差异」）。
结论：两处同值 80 **语义不同，不合并**；本轮把它们并置在同一个模块里、各用一个名字，并把"不合并"变成一条可执行断言（§5 的 S3/S4 + `cloud-layer-facts-test §7` 的交叉不变量）。

### 1.3 删除重复判断会不会改变边界行为

不会，因为本轮**没有删除任何判据**，只做了命名与单源化。四类边界路径逐项对拍（§6）：
输入缺失（无 cloudField / `covered=null` / 无高程）、边界截断（`baseBoundary`/`topBoundary` 四形态）、
部分覆盖（扫描范围超出实测覆盖）、未知（`no-altitude`/`no-data`/`within-uncertainty`/`both-sides`/`partial-at-point`）
—— 全部 123 组比对业务判据与用户可见输出**逐字相同**。
`isCloudBand` 的取值规则与替换前逐字同形（`!!band && band.cover >= 80`，未加 `Number.isFinite`：
`cover` 为 undefined 时旧实现判 false，加了就会把"未知"改判成别的），并由测试钉住
（`cloud-layer-facts-test §7` 第一条：`{cover:80}→true / {cover:79}→false / null→false / {}→false`）。

### 1.4 旧 `summaryOf` 具体依赖什么，优先级在哪里定义

```js
/* 依据摘要：取第一条最具体的事实（云区/云带优先于通用项） */
const pick = w.evidence.find(e => e.fact.indexOf('云区') >= 0 || e.fact.indexOf('云层位于') >= 0)
return (pick || w.evidence[0]).fact
```

依赖两样东西：**中文字面**（`云区` / `云层位于`，出现在 `conditionEvidence` 的三条与 `detectCloudSea` 的 1/4 条里）
+ **数组下标**（退回 `evidence[0]`）。优先序的"定义"只有那行注释，没有任何显式声明。

审计实测（本轮补的判据）：**在所有生产路径上 `pick` 恒等于 `evidence[0]`** ——
被标了关键字的那条本来就在第 0 位；R2 把另外三种边界形态改了词之后它们不再含关键字，于是走 fallback，
而 fallback 取的第 0 条**还是那句位置证据**。也就是说这个 `find()` 从未真正选过东西，
它唯一的作用是：**下一次改中文时，摘要会静默换成别的事实**。
这不是推测——R2 那一轮就撞过一次，当时只能把"全靠位置那句排第一"这个巧合钉成断言
（`tools/outdoor-cloud-sea-test.js` 的呈现层摘要钉）。

同一个数组次序还有一处隐性依赖：`evidenceAnchor()` 读 `evidence[0].at` 决定"看图"高亮哪一小时，
而摘要读文案命中项。两条规则一旦分叉，**卡片文字讲的证据和点下去高亮的时刻就不是同一小时**。

### 1.5 归属表：哪些是事实、条件、机会判据、展示文案

| 层 | 归属 | 本轮落点 |
|---|---|---|
| L1 事实 | `band`（provider 已成带）、剖面云层（base/top/thickness/cover/边界来源）、`covered`、三个高度范围 | `cloud-layer-facts.js`：`LAYER_LIMITS` + `isCloudBand` + `layersAt` + `resolveRanges` |
| L2 条件 | 此点与云层的**位置关系**（in/ok/mid + 五类判不出 + clear 是否定式事实） | `cloud-field-svg.inferState` → `outdoor-intelligence.buildConditions`（未改阈值） |
| L3 机会判据 | 净空 ≥200、层厚 ≥300、持续 ≥2h、覆盖门槛、风削弱、强度、置信、窗口合并与民用可见性 | `outdoor-intelligence`（数值一个没动） |
| 展示 | 中文标题、分级词、**摘要优先序**、时间轴几何、tapZones | `oi-presentation.js`（新增 `SUMMARY_KIND_PRIORITY`，仍是唯一一处） |

---

## 2. 修改后的职责边界

```
L1 cloud-layer-facts.js
   LAYER_LIMITS { FIELD_LAYER_COVER_MIN 80 / FIELD_LAYER_STEP_M 50 / CLOUD_BAND_COVER_MIN 80 }
   isCloudBand(band)  ← sky ×2 / conditions ×1 都调它（"这条 provider 记录算不算实心带"）
   resolveRanges(layersAt 的扫描范围与实测覆盖)
   layersAt(sample,t,ranges,{coverMin,step}) → 云层事实 + 来源标记（缺省读 LAYER_LIMITS，不再藏字面量）
   topmostBelow(layers, pointAlt) → 候选层与未取整的净空
        ↑ 只被 L2/L3 读；L1 不 require 任何上层

L2 outdoor-intelligence.buildConditions → conditions[{t,key,reason,holds,source,evidence:[{fact,at,kind}]}]

L3 outdoor-intelligence.detectCloudSea* → windows/candidates + 三本账（逐时）+ noWindow（窗口级）
   每条证据带 kind（词表 utils/evidence-kind.js）

呈现 oi-presentation
   SUMMARY_KIND_PRIORITY = [layer-position]        ← 唯一的"哪一类值得当摘要"声明处
   primaryEvidence(w) → 摘要与「看图」锚点**同一条**证据
   summaryOf(w) = primaryEvidence(w)?.fact ?? ''
```

`CLOUD_SEA.LAYER_COVER_MIN / SCAN_STEP_M` 改成 **getter**，运行时读 `CLF.LAYER_LIMITS`：
不是风格问题——只有走引用，"改一处全体起"才是可测的（切片一的教训：`module.exports` 里的快照值改了不生效，会比出假差异）。

---

## 3. 阈值权威来源（本轮之后还有哪些 80，为什么）

| 名字 / 出处 | 值 | 语义 | 消费点 |
|---|---|---|---|
| `LAYER_LIMITS.FIELD_LAYER_COVER_MIN` | 80 | 连续剖面「什么算一层云」 | `layersAt` 缺省；`CLOUD_SEA.LAYER_COVER_MIN`（getter）→ `LOW_COVERAGE` 门槛与那句负证据 detail |
| `LAYER_LIMITS.FIELD_LAYER_STEP_M` | 50 | 剖面采样步长 | `layersAt` 缺省；`CLOUD_SEA.SCAN_STEP_M`（getter） |
| `LAYER_LIMITS.CLOUD_BAND_COVER_MIN` | 80 | provider `cloudBandAt` 的成带判据（重述，非新判定） | `isCloudBand` ← `sky.hourMarks` / `sky.cloudSeaConclusion`（含**印出来的数字**）/ `conditions.factsFor` / OI hour-view 那句「覆盖 ≥80%」 |
| `confidenceOf(run.peak, 80)` @`outdoor-intelligence.js:458` | 80 | **云量峰值的置信分档**（≥80 ⇒ 「高」），与成层/成带都无关 | 仅 IN_CLOUD 卡的 confidence。**故意不合并**，源码已就地注明 |
| 云函数 `cloudBandAt` 的 `cc >= 80` | 80 | 上游成带规则本身 | 服务端；与客户端**刻意双份**（铁律 8：云函数不能 require `miniprogram/`），与 `gcjToWgs` 同例 |
| `meteogram.js:472 / :503` 的 `band.cover >= 80` | 80 | **显示层副本**（画不画云带行、alpha 强度） | 组件 canvas。本轮**未动**（见 §8 已知残留） |

`300 / 200 / 2200 / ±600 / 2000–6000` 本轮一个都没碰；候选选择规则（`topmostBelow`）逐字未改，薄层遮蔽缺陷仍只登记不修。

---

## 4. 结构化证据字段契约与摘要优先序

**词表**：`miniprogram/utils/evidence-kind.js` → `KIND`（15 个值，封闭集，不 require 任何东西 ⇒ 无环）。
`layer-position / clearance / layer-extent / duration / wind / precip / cloud-amount / sky-clarity /
visibility / humidity / moonlight / sunrise-overlap / data-coverage / abstain / night-limit`

**契约**（三条都可执行，不靠自觉）：

1. **谁产生谁命名**：每条 `evidence` 在 push 的那一刻带 `kind`。生产链路上（`oi1` 的 opportunities + conditions）
   实测 41 条证据**无一裸奔**，且值全部 ∈ 词表（`outdoor-intelligence-test §新`）。
2. **呈现层只读字段**：`SUMMARY_KIND_PRIORITY = [EK.LAYER_POSITION]`；选中规则 =
   按优先序取第一个匹配类别的证据，**没有匹配才**退回第一条（缺省行为与旧实现同形，向后兼容）。
   `oi-presentation.js` 里不再出现任何 `indexOf('云区')` / 正则 / 前缀判断。
3. **摘要与锚点同源**：`primaryEvidence(w)` 同时供 `summaryOf` 与 `evidenceAnchor` 使用 ⇒
   卡片文字与"看图"高亮不可能再指向不同小时。

**三态分开（任务书要求的"没有评估 / 评估后拒绝 / 评估通过但没成窗"）**：

```js
meta.cloudSea = {
  candidates,                    // 评估通过（逐时）
  rejected,                      // stage:'hour'   L2 说云在脚下，L3 逐时门槛没过（NO_LAYER_BELOW / USER_* / LOW_COVERAGE / INSUFFICIENT_THICKNESS）
  notEvaluated,                  // stage:'hour'   L2 没给出 CLOUD_BELOW ⇒ L3 从未运行；condition=不成立 或 abstain=判不出
  noWindow,                      // stage:'window' 逐时全过，但合并后没成窗（LOW_PERSISTENCE / NOT_VISIBLE）
}
```

改动前 `rejected` 混着逐时与窗口两级条目，于是
`candidates + rejected + notEvaluated === 小时数` 这条分区不变量**在有窗口级拒绝的那天对不上**
（对拍里 峨眉山 10-11/10-12 measured 等 4 组实测为 `前=false / 后=true`）。
现在不变量恒成立，并被 `outdoor-cloud-sea-test` 钉住。

`notEvaluated` 与 `noWindow` 都只在模型内部（`meta`），生产 UI 不读（`weather.js` 不碰 `meta.cloudSea`，已 grep 证实）。

---

## 5. 改动文件与每项改动的必要性

| 文件 | 改动 | 为什么必须这样 |
|---|---|---|
| `utils/cloud-layer-facts.js` | +`LAYER_LIMITS`（对象，非三个 const）+`isCloudBand`；`layersAt` 缺省改读这张表 | 对象引用才能让影子测试改到**生产实际读到的那一份**（切片一踩过快照值的坑） |
| `utils/evidence-kind.js`（**新**，37 行，零 require） | 证据类别词表 | 产生处有两个模块（`outdoor-intelligence`、`conditions`）、消费处一个（`oi-presentation`）；放任一处都会让别的方向上依赖，或者形成环 |
| `utils/sky.js` | 3 处 `cover >= 80` → `isCloudBand` / `LAYER_LIMITS`；+require | 成带判据单源；**结论文案里印出来的 80 也走同一处**，数字与判据不可能再漂移 |
| `utils/conditions.js` | `factsFor` 的云带筛选 → `isCloudBand`；13 条证据 +`kind`；文件头与 `factsFor` 注释改为与代码一致 | 那条注释原本在说谎；证据要在产生处命名 |
| `utils/outdoor-intelligence.js` | `CLOUD_SEA` 两键改 getter；hour-view 那句「≥80%」插值同源；18 处证据 +`kind`；`noWindow` 拆账 + `stage` 字段；账本文档 | 单源 + 结构化 + 三态分离；**判定表达式与数值零改动** |
| `utils/oi-presentation.js` | `summaryOf` 改按 `kind`；新增 `primaryEvidence` + `SUMMARY_KIND_PRIORITY`；`evidenceAnchor` 与摘要同源；导出这两个函数 | 摘要是呈现选择，优先序该显式留在呈现层；导出是为了测试能直接打真实现，不重写一遍（铁律 11） |
| `tools/cloud-layer-facts-test.js` | 37→**45**（新增 §7 影子常量 8 条）；`ctxOf` fixture 提到模块级复用 | §7 是"单源"的**唯一非文本证明** |
| `tools/outdoor-intelligence-test.js` | 25→**35**（新增证据 kind 契约 10 条） | 摘要机制的判据必须能测出"退回文案匹配"与"改优先级" |
| `tools/outdoor-cloud-sea-test.js` | 31→**32**（LOW_PERSISTENCE 断言**替换**为两条：账本不串味 + 分区不变量）；呈现层摘要钉的注释改为"与选择机制无关" | 原断言钉的是"窗口级拒绝在逐时账本里"这个旧布局，不是行为 |
| `architecture/tools/ab-slice2.js`（**新**）+ `ab-slice2.json` | 123 组跨版本对拍，**多比一层用户可见输出** | 本轮改的正是摘要，只比模型层等于没比 |
| `architecture/tools/mutate-slice2.js`（**新**） | 9 条架构级变异的自证 | 新门若不会红，就是假绿 |
| `architecture/tools/ab-slice.js` / `mutate-ab.js` | `rejectedReasons`/`rejectedDetails` 改为两本账并集；V1/V4 锚点搬到 `cloud-layer-facts.js` | 见 §8：账本一搬，切片一的对拍报了 2 组假业务红；**判据搬家不是判据变化** |
| `AGENTS.md` / `SYNC.md` | 铁律 31 + Gate recount 12 + 变更日志 | 只写本轮实测到的事实 |

---

## 6. 对拍结果（`ab-slice2.js`，PRE=`92036e9` vs POST=工作树）

比两层：`biz()`（机会窗口/条件态/候选/具名拒绝全集/层数值/边界标记）与
`visible()`（**各版本自己的呈现层**产出的 items/title/timeText/tierText/**summaryText**/anchor/tapZones/timelineSvg/silenceNote，375 与 414 两种宽度 + 每条证据 fact 字符串与顺序）。

```
合计比对 123 组：业务判据差异 0 组、用户可见差异 0 组、附加字段结构差异 0 组   （exit 0）
11 组合成场景 × 3 种海拔出处（含 ⑩ 无云场回退、⑪ 无高程、⑫ 单小时候选、⑬ 凌晨候选）+ 真实快照 4 站 × 7 天
真实快照里唯一出云海卡的那组：峨眉山 2026-10-11 measured
  摘要（后）＝「云底低于剖面扫描窗下界 2,000 m（未测得）；窗内云层顶约 2,788 m」  两侧逐字相同
  逐时分区不变量：前=false / 后=true（PRE 的 rejected 里混着窗口级条目）
```

前置校验（对拍器不给自己留后门）：PRE 目录若已引用 `evidence-kind`、或 PRE 的 `oi-presentation.js` 里
找不到按文案挑摘要的旧实现 ⇒ `exit 2` 拒跑。**比的确实是被替换掉的那一版**。

切片一的 `ab-slice.js`（PRE=`50d657a`）修完对账本的误读后复跑：**111 组 业务判据 0 / 附加字段 0**，
`mutate-ab.js` 8 条业务级变异 **0 漏网**（V1/V4 锚点搬到 LAYER_LIMITS 后仍然有牙齿）。

---

## 7. 测试清单与变异自证

- 门禁套件：**63**（62 个无头 `tools/*-test.js` + `smoke-test.js`），本轮未新增套件文件，只在既有三套里加断言。
- 全量无头复跑（临时副本，逐套取自己打印的 `passed=`）：**63 套 / 4318 断言 / 失败合计 0 / 全部 exit 0**（基线 4299，+19）。
- 增量：`cloud-layer-facts-test 37→45`、`outdoor-intelligence-test 25→35`、`outdoor-cloud-sea-test 31→32`；其余套件未动。
- `node tools/check.js` / `check-handlers.js` 均 exit 0。
- 变异自证 `mutate-slice2.js`：**9 条，漏网 0 条**（临时副本未变异时 4 套全绿 —— 有效性门先过）
  S1 sky 恢复自己的 80 / S2 factsFor 恢复自己的 80 / S3 阈值藏回 L1 缺省 / S4 L3 改回快照 /
  S5 摘要退回 `indexOf('云区')` / S6 摘要优先序改成 duration / S7 未评估并入拒绝 /
  S8 窗口级拒绝塞回逐时账本 / S9 判不出不留 abstain 痕。
  每条都要求"至少一套红"，且注入锚点命中数必须恰为 1（命中 0 直接算失效，不允许静默跳过）。
- **真机 UNVERIFIED**：本轮生产 UI 一行没改（`pages/` 与 `components/` 零改动），用户可见输出由
  `ab-slice2` 的呈现层比对证明逐字相同；9420 会话归属哪份工作副本无法从命令行证实，
  重开项目会动共享开发者工具实例 ⇒ 按规矩不擅自执行。

---

## 8. 与预期不一致的差异（逐条，不藏）

1. **切片一的对拍报了 2 组假业务红**。`ab-slice.js` 的 `biz().rejectedReasons` 直接读 `meta.cloudSea.rejected`，
   账本一拆，它把"窗口级拒绝换了个数组"读成"少了两条业务拒绝"。修法不是放宽判据，而是它本来就该比
   **两本账的并集**（少一条原因码仍然会红，V2/V3/V4 变异照样抓到）。修后 111 组回到 0 差异。
   这是铁律 30 的新实例：**把布局钉成判据的门，会在合法重构时报假红**。
2. **`mutate-ab.js` 的两条变异注入静默失效过**。V1/V4 的锚点是 `outdoor-intelligence.js` 里的
   `SCAN_STEP_M: 50,` / `LAYER_COVER_MIN: 80,`，搬家后这两个字符串不存在了；
   该脚本有"找不到原文就判漏网"的门，所以是**大声失败**而不是假装通过——已把锚点搬到 `LAYER_LIMITS`。
3. **`mutate-slice2.js` 的 S7 第一次没注入成功**：锚点写成跨行字符串，而这些文件是 **CRLF**，
   命中 0 次 ⇒ 报"注入失败"。改成单行锚点后 9/9 有牙齿。教训与切片一 §对拍器同一类：**自证脚本自己也会有假绿**。
4. **摘要机制换了，摘要文本一条都没变**：§1.4 的审计结论是 `pick` 在生产路径上恒等于 `evidence[0]`，
   所以本轮改动对用户的净效果是**零**——这正是它的价值（把一次"改文案就改接口"的地雷拆掉），
   也意味着我不能声称"修好了一个显示 bug"，只能说"移除了一个尚未爆的耦合"。
5. **显示层仍留着两处同值 80**：`components/meteogram/meteogram.js:472 / :503`（画不画云带行、alpha 强度）。
   本轮没动，因为它属于 canvas 绘制路径，改动需要真机核验，而真机这一项本轮是 UNVERIFIED。
   后果如实说：`LAYER_LIMITS.CLOUD_BAND_COVER_MIN` 被改时，图上云带行**不会**跟着动 ——
   这条不一致已知、已登记，留给下一轮在有真机证据时一起收。
6. **`confidenceOf(run.peak, 80)` 与成带/成层的两个 80 无关**：一开始我把它也当作重复项准备合并，
   读下去才发现它是"云量峰值 ≥80 ⇒ 置信高"的分档。合并就是一颗会让 IN_CLOUD 卡置信度漂移的子弹，
   所以不合，并在源码处写了为什么不合的理由。
7. `cloud-layer-facts` 的"本模块不导出机会阈值"静态门（`/CLEAR|THICKNESS|MIN_RUN|GAP|TOLERANCE/`）
   仍然成立 —— 新加的是**层定义**，不是机会阈值；我没有为了让门过去而改它，是它本来就不该管这个。

---

## 9. 未解决 / 进入 R1 仍然需要产品裁决的东西

- D1–D6、Q7 **一个都没裁决**（清单与证据见切片一 ADR §7）：扫描下界与相对上限、`sky.js` 的 2200 m 加分与 OI 路径并存、
  `LAYER_THICKNESS_MIN=300` 的口径（不可核对也不可证伪）、`measured tol=0` 是断言不是测量、
  `estimated` 672 小时 0 次 CLOUD_BELOW 的话术、薄皮屏蔽厚层是否改、`geopotential_height` 当几何高度的依据。
- **本轮新增的待办**：显示层那两处 80（§8.5）；`evidence` 的 `kind` 目前只用于摘要选择，
  ReasonPanel 若按类别分组展示需要一次呈现层设计（不是判据问题）。
- R1 的前置门没有变化：`ctx.cloudSeaScan` 接缝仍是活的（切片一注入用例 + 本轮 S4 变异都从两侧证明）；
  换带时**必须同步**的清单见切片一 ADR §T1–T4。
- 样本仍然只有 2026-10-09 那一周 ⇒ **不可外推季节**；本轮所有结论都是代码行为与输入敏感性，
  不涉及任何阈值在气象上是否正确。
