# OI 云层扫描范围审计 —— 固定 2000–6000 m 到底挡住了什么，以及怎么安全地改

轮次：2026-10-09 第四轮（**只读审计，不改生产判据**）
分支 `win/weather-v2-cloud-position`，基线 `3461ecb`（上一轮：剖面显示窗自适应）
证据：`tools/oi-scan-audit.js` → `oi-scan-audit.json`；`tools/trace-flip.js`（一次翻转的逐小时归因）
输入数据：`tools/real-cloud.json` —— 2026-10-09T06:04:28Z 由生产同一条 `lib/weather.js` 直连 Open-Meteo
抓的真实剖面（成都 489 m / 峨眉山 3004 m / 理塘 4058 m，各 168 h × 22 层气压层）

---

## 1. 调用链（实测，带行号）

```
cloudfunctions/trailApi/lib/weather.js:211   geopotential_height_{lv}hPa → altitudes[]（m ASL，逐时变化的数组）
                    :228                     levels[] = {pressure, altitudes[], cloudCover[]}
      ↓ 云函数返回体 result.cloudLevels
miniprogram/utils/weather-cloud-field.js:29  validPairs()  丢掉非有限的 (海拔, 云量)
                    :49  resampleColumn()   站点范围之外写 0（= 无测量，不外插）
                    :137 covered = {lo, hi} 实测包络（所有小时所有层的极值）
      ↓ cloudField = {times, altitudes[250m 网格], values, covered, userAltitude}
miniprogram/utils/cloud-field-svg.js:296 inferState()      ← 判读：扫 covered（第三轮已收口）
                    :430 planProfile()      ← 显示窗：扫 covered 内的 ≥25% 云段（第四轮新增）
      ↓ 同一个 cloudField.sample
miniprogram/utils/outdoor-intelligence.js:94  cloudLayersAt(sample, t)   ← ★ 本轮审计对象
                    :98                     for (alt = CFF.ALT0; alt <= CFF.ALT1; alt += 50)   ← 固定 2000–6000
                    :124                    开放段收尾 run.top = CFF.ALT1
                    :252  detectCloudSeaCandidates()  ← cloudLayersAt 的**唯一**调用方
                    :292  detectCloudSea()            ← 候选 → 窗口（持续性/白天/强度/证据）
                    :606  buildOutdoorIntelligence()  ← 唯一使用 sea.windows 的地方
```

**关键事实：`cloudLayersAt` 全仓库只有一个调用方 —— 云海候选检测。**
星空/银河不看它（它们看地表 `cloud.mid/high` 聚合 + `skyBlocked(conditions)`，而 conditions 走 `inferState`，
已经扫实测包络）；远眺窗口走 `holds`；`IN_CLOUD` 走 `holds`。
所以「扫描范围」这件事的**业务风险面只有 CLOUD_SEA 一个机会类型**——这是本轮最重要的边界结论。

## 2. 三种范围，今天被压成了两个

| 概念 | 现在的载体 | 真实值 |
|---|---|---|
| **数据范围**（气象源真正给了测量的海拔） | `cloudField.covered` | 真实快照：成都 146–6674、峨眉山 131–6684、理塘 126–6675 m |
| **显示范围**（SVG 画哪一段） | `profile.lo/hi`（第四轮起，逐图规划） | 例：成都 24h → 1,000–5,000 m |
| **业务扫描范围**（OI 找云层） | `CFF.ALT0/ALT1` 常量 = 2000–6000 m | **与数据无关的固定值** |

`ALT0/ALT1` 现在只剩两个用途：① 无可用数据时的默认显示窗（`planProfile` 的 fallback）；
② OI 的业务扫描范围。这两个用途毫无关系，却共用一对常量 —— 这就是问题的形状。
2000–6000 这个范围**在仓库里找不到任何气象学或产品判据出处**（SYNC/文档/注释都没有），
它是从 HTML 原型 `meteogram.js` 的剖面绘图窗继承来的（`cloud-field-svg.js` 文件头写明「从 prototype 逐函数提取」）。
**结论：业务扫描范围继承自一个显示参数。**

## 3. 三种影响模式（真实数据实测）

对 3 地点 × 3 天 × 24 h = **216 个小时剖面**逐小时把「固定带扫描」与「实测包络扫描」对拍：

| 模式 | 定义 | 实测频次 |
|---|---|---|
| **A 整层被排除** | 云层的 ≥80% 连续段完全落在 2000–6000 之外 | 10/216 小时（4.6%）：峨眉山 10-09 3 小时（全在 2000 以下）、成都 10-11 1 小时（以下）、理塘 10-09/10/11 共 6 小时（全在 6000 以上） |
| **B 跨界层被截断** | 云层横跨扫描边界，固定带只切到一部分 ⇒ **层厚与层均覆盖被少报** ⇒ 撞 `LAYER_THICKNESS_MIN=300` | 峨眉山 10-09/10/11 各有 1/1/2 小时因此翻转云海候选；厚度平均少报 64–121 m，**最大 414 m** |
| **C 扫描边界被当成云界** | 层的 `base` 恰好等于 2000（或 `top` 等于 6000，含 `run.top = ALT1` 的开放段收尾）——那不是测出来的云底/云顶 | 峨眉山 10-09/10/11 分别 **18、12、7 小时**（该站常见低云 1,7xx–2,1xx m，几乎每天下午都在切边界） |

模式 C 还会直接写进用户看得见的证据句：`trace-flip.js` 打出峨眉山 10-11 15:00 固定带扫出
`{base:2000, top:2100, thickness:100, meanCover:92}`，而实测包络扫出 `{base:1785, top:2131, thickness:346}`
—— 生产版会把「云层位于 **2,000**–2,100 m」写进证据，那个 2,000 是扫描边界，不是云底。

## 4. 真正改变业务结论的案例（影子运行，逐小时可复核）

影子运行 = 在内存里把 `CFF.ALT0/ALT1` 临时改成该数据集的实测包络，跑完整 `buildOutdoorIntelligence`，
立刻还原。**36 次运行（3 地点 × 3 天 × 4 组海拔/出处）**：

- 条件态（`IN_CLOUD / CLOUD_BELOW / CLOUD_ABOVE / CLEAR` + `holds` + `reason`）**36/36 完全相同**
  —— 因为条件态走 `inferState`，本来就不吃这个扫描带；
- 机会窗口 **3 次不同，且是同一个物理案例的三种海拔出处变体**：
  峨眉山 2026-10-11，`CLOUD_SEA@16:00–18:00`（confidence 高）在包络扫描下**出现**、固定带下**不存在**；
- 归因（`trace-flip.js`）：模式 B。16/17/18 时真实云带 1,821–2,581 m（峰 97%），
  固定带把云底截到 2000 ⇒ 层厚 550/200/100 m ⇒ 后两个小时不足 300 m 被 `INSUFFICIENT_THICKNESS` 拒掉，
  持续性凑不满 ⇒ 不出卡；包络扫描下层厚 760/374/210 ⇒ 16–18 连成窗口。

**所以：固定扫描带今天在真实数据上造成的是一处云海漏报（false negative），不是误报。**
另外 10 个「整层被排除」的小时里，理塘的 6 个是 6000 m 以上的高层 —— 对 4,058 m 的点来说
`l.top <= userAlt` 本来就不成立，**不影响云海**；成都那 1 个低层在 489 m 的点之上，同样不影响。
**「存在被排除的云层」不等于「业务结论改变」，这个区分是本轮对拍的主要产出。**

## 5. 四个方案的比较（用上面的实测数）

| | A 扫全部有效高度（= 实测包络） | B 按机会类型各定高度范围 | C 数据/业务分离：通用云层剖面 + 各规则取相关层 | D 分层扫描 + 不确定性输出 |
|---|---|---|---|---|
| 漏报 | 消除 A/B/C 三模式（实测：峨眉山那处漏报被修复） | 取决于给云海定的下界；**该给多少没有气象依据**（见 §7） | 与 A 相同（剖面按包络建，规则只选层） | 与 A 相同，另把「包络不覆盖所需高度」显式输出为证据不足 |
| 误报 | **不新增**：候选仍要过 `top ≤ 点`、净空 ≥200、层均 ≥80、厚度 ≥300、持续 ≥2h、白天。实测 36 次影子运行里只有 +1 窗口、0 个 −窗口 | 低 | 低 | 低（还能显式拒绝边界伪云界） |
| 缺测风险 | 若把「全部高度」误解为 0–7000 而非 `covered` ⇒ 站点范围外适配器写 0，会把**无测量读成无云**（`weather-cloud-field.js:51`），并且会在包络边缘造出假云界 —— 这是 A 唯一的坑，必须写成「扫 `covered`，不扫 0–7000」 | 同 A | 同 A | 显式建模：包络外不判、边界不裁进证据 |
| 复杂度 | 1 个函数签名 + 1 个来源（`covered` 已在 `cloudField` 上） | 每类机会一张范围表 + 每行判据（**目前没有判据可写**） | 要改 `cloudLayersAt` 的输出契约并让所有消费方迁移 | 中等：新增 `boundary`/`insufficient` 标记 |
| 可测试性 | 好：expected/unexpected change 可用本快照逐小时钉 | 差：范围本身要业主先定 | 好，但改动面最大 | 最好（把「不知道」变成显式输出） |
| 兼容性 | 条件态零变化（实测 36/36 相同）；只有云海窗口可能增加 | 未知（会同时动多类机会） | 需要一次全量回归 | 需要新增文案与门 |

## 6. 推荐：A 的收窄版 + D 的一条输出（最小安全方案）

**R1** `cloudLayersAt(sample, t, opts)` 的扫描范围改为**调用方传入的实测包络**（`field.covered`），
不再读 `CFF.ALT0/ALT1`；`covered` 缺失 ⇒ 返回 `null`（= 判不了），**不得**退回 2000–6000 造层。
—— 语义与第三轮 `inferState` 的 `no-data` 失败关闭一致。

**R2** 开放段的收尾不再写 `run.top = CFF.ALT1`；改为 `top = 包络上界` 且带
`baseIsBoundary / topIsBoundary` 标记。证据句遇到边界时改用「≥X m 处仍为浓云，云顶未在实测范围内」这类
不冒充测量值的说法。（模式 C 的 37 个受影响小时全部由这一条消除。）

**R3** 所有业务阈值与必要条件**一个都不动**：`LAYER_COVER_MIN 80 / LAYER_THICKNESS_MIN 300 /
CLEARANCE_MIN 200 / MIN_RUN_H 2 / 白天窗口 / 强度因子`。本轮对拍证明改变只来自"看到更多真实数据"，
不来自"放宽判据"。

**R4** 门分两类变化（见 §8），并要求 `ALT0/ALT1` 只剩「默认显示窗」一个用途 —— 加一条静态门：
OI 源码里不得再出现 `CFF.ALT0/CFF.ALT1`。

不推荐 B（没有气象依据可写，等于把拍脑袋的数从 2000–6000 换成另一对拍脑袋的数）；
不推荐一次性做 C（接口重构，风险面覆盖全部机会类型，而实测风险只在云海一类）。

## 7. 需要产品／气象确认的假设（**本轮未验证，不当作结论**）

1. `LAYER_THICKNESS_MIN = 300 m` 的口径是「**实测**云带厚度」还是「扫描窗内可见厚度」？
   注释写的是「真实分布 P50=300m」，但那是在 2000–6000 带内统计出来的 —— 修完扫描范围后
   分布会变（实测平均 +64～121 m，最大 +414 m），**阈值可能需要重估**。这是唯一可能牵出
   「修了漏报却放大了误报」的地方，必须先定口径再动代码。
2. 2000 m 以下算不算「云海」的云带？（山谷辐射雾/低平流云在 1,000–1,900 m 很常见，
   峨眉山 3,004 m 的点往下看正是这种）—— 产品口径，不是技术口径。
3. 6000 m 以上的高层（理塘 6 小时实测存在 ≥80%）与云海无关，但与「高层云遮住天空」的
   观星判据有关 —— 目前观星走地表 `cloud.mid/high` 聚合，**没有**用垂直剖面。
   是否要把剖面高层证据接进 `skyBlocked`，属于另一轮的范围问题。
4. 位势高度换算的海拔基准（`geopotential_height` 直接当 m ASL 用）在 >6,000 m 处的系统偏差
   未做量化 —— 标记为**待验证**，不影响本轮结论（差异只在几十米量级，远小于 300 m 厚度门槛）。

## 8. 实施时的测试清单（预期变化 vs 非预期变化）

**必须变（expected）**
- E1 峨眉山 2026-10-11 16:00–18:00 出现 `CLOUD_SEA` 窗口（本轮实测的唯一业务翻转）。
- E2 云层完全在 2000 以下且点在云上 ⇒ 合成样本②⑮必须从 `NO_LAYER_BELOW/INSUFFICIENT_THICKNESS`
  变成「成立」。
- E3 证据句里不再出现 `base == 2000` / `top == 6000` 这种边界值（模式 C 的 37 个小时）。

**不许变（unexpected ⇒ 红）**
- U1 条件态与 `holds`/`key`/`reason` 逐字节不变（本轮实测 36/36 相同 ⇒ 有基线可比）。
- U2 星空/银河/远眺/彩虹/光染的窗口集合与 confidence 不变（`cloudLayersAt` 只有一个调用方，
  任何这类变化都是意外）。
- U3 显示窗（`planProfile`）与 `inferState` 的输出不变（扫描带解耦不得回头污染判读）。
- U4 现有 6 套天气线门（geometry 206 / readability 77 / cloud-position 60 / weather-page 177 /
  multiday 48 / visual-audit 43）与 `outdoor-cloud-sea 20`、`outdoor-intelligence 24`、
  `oi-claim-gate 25` 全绿，且**不许为了通过而改断言**；若 `outdoor-cloud-sea` 因层厚口径而红，
  说明 §7.1 的口径问题真实存在 —— 停下来问，不要改门。
- U5 缺测 ⇒ 不判：`covered` 缺失时 `cloudLayersAt` 返回 null，云海走「证据不足」而不是「无云」。

**回滚**：R1/R2 各自独立可回滚（一个改扫描来源，一个改边界语义）；
`cloudLayersAt` 保留 `opts.lo/hi` 形参即可一行退回 `CFF.ALT0/ALT1`。分阶段：先 R2（纯语义，
不改任何候选集合，只改证据与边界标记），再 R1（改集合，配 E1/E2 的期望变化门）。

## 9. 本轮执行的命令与结果

```
node tools/check.js                      → ALL CHECKS PASSED
node tools/oi-scan-audit.js              → oi-scan-audit.json（216 小时对拍 + 36 次影子运行 + 15 例合成矩阵）
node tools/trace-flip.js                 → 一次翻转的逐小时归因（模式 B）
```
审计脚本只 require 生产模块，**不写任何生产文件**；影子运行只在进程内改常量并立刻还原。
限制：① 数据是 2026-10-09T06:04Z 的一份快照（3 站 × 168 h），不是长期气候统计 —— 频次数字只能说明
「机制在真实数据上确实发生」，不能当作线上发生率；② 影子运行覆盖 4 组海拔/出处，未覆盖路线逐节点
（节点海拔会走同一条 `cloudLayersAt`，机制相同，但没实测样本）；③ 未做真机验证 —— 本轮不改生产行为，
真机截图与本轮无关；④ 阈值口径问题（§7.1）没有答案，因此**本轮不构成实施依据，只构成"可以安全实施
R2 + 需要先定口径才能实施 R1"的结论**。

## 10. Git 状态

分支 `win/weather-v2-cloud-position`；本轮基线 `3461ecb`；`master` 仍在 `3627079` 未动；未推送、未合并。
本轮新增文件仅 `docs/weather-ux/qa/v2-oi-cloud-scan-audit-2026-10-09/**`；
`miniprogram/`、`cloudfunctions/`、`tools/` 一个字节未改（`git status --short` 与
`git diff --name-only HEAD` 为证）。
