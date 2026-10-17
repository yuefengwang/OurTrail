# PROJECT KNOWLEDGE BASE — OurTrail

**Generated:** 2026-09-29 · **Recalibrated:** 2026-10-04（数量全部重新实测：13 组件目录 / 13 actions / 39 commands）· **Gate recount:** 2026-10-08 Phase 10A（**43 门禁套件 / 2750 断言 / smoke 173 / 17 页**；其中 1 条常驻非确定性红属天气线 `outdoor-intelligence-ui`，见 SYNC.md 2026-10-07/10-08 两条）· **Gate recount 2:** 2026-10-08 出行方式解耦（**44 门禁套件 / 2845 断言**，新增 `tools/trip-mode-test.js` 78；常驻非确定性红仍只有天气线那 1 条）· **Gate recount 3:** 2026-10-08 全生命周期审计（**50 门禁套件 / 3546 断言**，新增 6 套 `tools/lifecycle-*-test.js` 共 699，`e2e-domain-negative` 83→86；常驻红仍是天气线那 1 条。报告 `docs/superpowers/specs/2026-10-08-full-domain-lifecycle-audit.md`）· **Gate recount 4:** 2026-10-08 旅程可解释性重构（**52 门禁套件 / 3698 断言**，新增 `tools/journey-test.js` 138 与 `tools/journey-graph-test.js` 12；客户端多出 `utils/journey.js` 322 行＝状态与下一步的唯一翻译层。报告 `docs/superpowers/specs/2026-10-08-user-journey-ux-audit.md`）· **Gate recount 5:** 2026-10-09 可靠性与生产化加固两轮（**57 门禁套件 / 3805 断言 / 全部 exit 0**：第一轮 +3 套 revision/meta/cold-start 44，第二轮 +2 套 `receipt-window` 19 与 `failure-semantics` 37。生产代码只动 `index.js`/`store.js`/`domain/{commands,contracts,profile}.js` 与客户端 `utils/api.js`。报告 `docs/superpowers/specs/2026-10-09-reliability-production-hardening.md`（§1–§10 第一轮、§11–§18 第二轮）· **Gate recount 6:** 2026-10-09 Weather V2 审计（**61 门禁读数 / 4118 断言 / 全部 exit 0**：新增 4 套——`cloud-field-geometry-test.js` 190、`elevation-semantics-test.js` 34、`meteogram-readability-test.js` 55、`oi-claim-gate-test.js` 25；`weather-cloud-field` 29→31 是一条**旧契约被证伪**后的替换而非削弱，`weather-page` 149→156 加了路线海拔。生产代码动客户端 10 个文件（含 `sky.js`/`agenda.js`/`oi-presentation.js` 的「日照金山→晨昏光染」主张改名），`cloudfunctions/` 零改动 ⇒ **不需要重新部署**。真机前后 30 张 + 2 张 2× 放大对照在 `docs/weather-ux/qa/v2-audit-2026-10-09/`，报告 `docs/weather-ux/weather-v2-final-visual-audit.md`，铁律见 25）· **Gate recount 7:** 2026-10-09 云层位置语义统一（**62 门禁读数 / 4191 断言**：新增 `tools/cloud-position-test.js` 54；`weather-page-test` 156→**173**（真页面 `r3` 三态 + 逐节点各用自己的高程判读 + 无高程/误差带弃权两态）；`cloud-field-svg-test` 27→**29**（`inferState` 一律带 `covered`——缺则**失败关闭**为 `no-data`，不再拿显示窗冒充实测范围）。三段增量都取各脚本自己打印的 `passed=N` 实测值，总数 = recount 6 的 4118 加这三段，不另立新账。`cloudfunctions/` 零改动 ⇒ **不需要重新部署**。铁律见 26，报告续 §九，真机前后 42 张（21 个场景 × full+tap）在 `docs/weather-ux/qa/v2-cloud-position-2026-10-09/`）· **Gate recount 8:** 2026-10-09 剖面显示窗自适应（**62 门禁读数 / 4248 断言 / 全绿**，本轮新增 57 条全部落在既有 6 套里，不另开框架：`cloud-field-geometry 190→206`（§14 planProfile + 变异证明）、`meteogram-readability 55→77`（§8 范围自证/边注/刻度/clipPath/375·390·414 不重叠）、`cloud-position 54→60`（§8 窗与判读隔离）、`weather-page 173→177`（§11b-F/H 图例三分支）、`meteogram-multiday 44→48`、`weather-v2-visual-audit 38→43`。真实数据 432 条 `inferState` 前后逐字节相同。`cloudfunctions/` 零改动 ⇒ **不需要重新部署**。铁律见 27，报告续 §十，证据包 `docs/weather-ux/qa/v2-window-adaptive-2026-10-09/`（含 11 张**判定无效**的受控场景截图，留在 `invalid/`）· **Gate recount 9:** 2026-10-09 OI 扫描窗 R2 边界语义（**62 门禁套件 / 4260 断言 / 全部 exit 0**，本轮 +12 条全部落在既有两套里：`outdoor-cloud-sea-test 20→31`（四种边界形态 + 通用不变量 + 标记自洽 + 候选不增 + 缺数据 + 卡片摘要次序 + 净空主语）、`outdoor-intelligence-test 24→25`；一条**钉住旧 bug** 的断言（`evidence[0]` 必须是 `云层位于 2,0…`，那个 2,000 恰为扫描下界）被重推为替换而非削弱。生产代码只动 `miniprogram/utils/outdoor-intelligence.js`（+42 −8，层提取数值表达式零改动），`cloudfunctions/` 零改动 ⇒ **不需要重新部署**。「只改文案不动判据」由跨版本 A/B 实测：42 组比对**业务判据差异 0 组**、证据文本差异 3 组；9 条变异 0 漏网。真机：3 地 × 24/72h 共 66 条机会条目里 CLOUD_SEA = **0 个**（真实点击），故新文案**没有**自然样本可拍，只有 4 张注入式排版核验（文本出自仓库真实模型）＋ 有效性门；设备 bundle 新鲜度未证（重开项目会动共享开发者工具会话，未擅自执行），这两项在报告里记 UNVERIFIED。R1 阈值口径取证：`300m/P50` 的样本与脚本从未入库 ⇒ **无法从现有仓库确认**，本轮未改阈值。铁律见 28，报告 `docs/weather-ux/qa/v2-oi-scan-r2-2026-10-09/README.md`）· **Gate recount 10:** 2026-10-09/10-10 R1 前置决策审计 + Q5/Q6 判定噪声审计（**门禁计数不变：仍是 62 套 / 4260 断言 / 全部 exit 0**，因为两轮生产文件改动数为 **0**——`git diff --stat` 空，只新增报告与只读探针）。但这两轮改的是**结论的可信度**：第五轮报告里"扫描相位噪声足以决定发不发云海卡"一条被第六轮用生产规则重测**推翻**（候选级翻转实测 0 / 888 小时、50 m 步长对 1 m 参照偏差 0 m），而它当初否掉的"相对带上界夹到点海拔会误判"**其实成立**。铁律见 29，报告 `docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/README.md` 与 `docs/weather-ux/qa/v2-q56-noise-audit-2026-10-10/README.md`）· **Gate recount 11:** 2026-10-10 三层架构首个纵向切片（**63 门禁套件 / 4299 断言 / 全部 exit 0**：新增 `tools/cloud-layer-facts-test.js` 37，`cloud-position-test` 60→**62** —— 后者是把一条**静态源码门**换成三条行为断言，见铁律 30）。生产代码动 2 个文件：新增 `miniprogram/utils/cloud-layer-facts.js`（L1→L2 接缝：三个高度范围分开命名 + 云层事实 + 候选层选择），`outdoor-intelligence.js` 的层提取搬过去并**把业务扫描范围变成显式入参**（此前它直接读剖面显示窗常量 `ALT0/ALT1`），另补 `meta.cloudSea.notEvaluated`/`scanRanges` 与证据句改取实际扫描范围。**业务结果零变化且可证**：跨版本对拍 111 组比对**业务判据差异 0 组**、附加字段结构差异 0 组，唯一变化是 48 条内部负证据的 detail 文案；对拍器自身经 8 条业务级变异自证 0 漏网（其中一条正是上一轮 Q6 犯的那个错）。`cloudfunctions/` 零改动 ⇒ **不需要重新部署**。真机未跑并如实标 UNVERIFIED（纯函数搬家，用户可见输出经 A/B 证为逐字相同）。ADR `docs/weather-ux/architecture/weather-v2-three-layer-evolution.md`，铁律见 30）· **Gate recount 12:** 2026-10-10 切片二（阈值单源 + 证据字段化）（**套件数不变：仍是 63 套 / 4318 断言 / 失败合计 0 / 全部 exit 0**，本轮 +19 条全部落在既有三套里：`cloud-layer-facts-test 37→45`（§7 影子常量）、`outdoor-intelligence-test 25→35`（证据 kind 契约）、`outdoor-cloud-sea-test 31→32`（三本账分区不变量，一条钉旧账本布局的断言被**替换**为两条更强判据）。生产改动 5 个 utils：新增 `miniprogram/utils/evidence-kind.js`（封闭词表，零 require），`cloud-layer-facts.js` 收 `LAYER_LIMITS`（对象引用，不是三个 const——影子改得动才算单源）+ `isCloudBand`，`sky.js`/`conditions.js` 的三处 `band.cover >= 80` 全部改为引用该判据（含**印给用户的那个 80**），`outdoor-intelligence.js` 的 `CLOUD_SEA.LAYER_COVER_MIN/SCAN_STEP_M` 改成 getter，18+13 处证据在产生处带 `kind`，`oi-presentation.summaryOf` 不再用 `indexOf('云区')` 挑摘要、且「摘要」与「看图」锚点统一读 `primaryEvidence`，`meta.cloudSea` 把窗口级拒绝拆成 `noWindow`。铁律 31。**用户可见输出零变化且可证**：新对拍器 `architecture/tools/ab-slice2.js` 把两边各自的呈现层跑到底，**123 组比对业务判据 0 / 用户可见（卡片摘要、锚点、时间轴 SVG、tapZones、silenceNote）0 / 附加字段结构 0**；架构级变异 `mutate-slice2.js` **9 条 0 漏网**（含"恢复重复阈值""摘要退回文案匹配""改优先级""未评估混进拒绝""窗口级拒绝塞回逐时""判不出不留痕"）。副作用如实登记：切片一的 `ab-slice.js` 因账本搬家报了 2 组**假**业务红，已改为比"具名拒绝全集"，复跑 111 组 0 差异、`mutate-ab` 8 条 0 漏网（V1/V4 锚点随搬家搬到 `LAYER_LIMITS`）。ADR `docs/weather-ux/architecture/weather-v2-three-layer-slice-2.md`；真机 UNVERIFIED（`pages/`、`components/` 零改动）；显示层残留 `meteogram.js:472/:503` 两处 80 未收（需真机证据）· **Gate recount 13:** 2026-10-10 彩虹遮光闸（第九轮，用户真机截图触发）（**63 套 / 4324 断言 / 失败合计 0 / 全部 exit 0**（`sky-test 65→70`、`oi-claim-gate-test 25→26`，其余未动）。生产代码只动 `miniprogram/utils/sky.js`：彩虹的"水分"信号里那句 `c.low >= 70` 是**把遮光物当成水分**——全天 100% 云、一滴雨没下也能拿 70 分「条件较好 ★★★★」（真实快照峨眉山 7 天里 6 天给 100 分），而同一天光染判 0 分并明说云量不足 ⇒ **两个现象对同一份云量数据互相矛盾**。修法加"太阳照得出来"闸，两个数都复用本文件已有口径（`low<40` ← 光染、`(mid+high)/2<30` ← 星空/银河的晴空口径），**没有新造阈值**；顺带修 `item.look` 印出「约 284.15999999999997 度」的未取整浮点。这是**故意的业务变化**，验收因此不是零差异而是两条：`ab-rainbow.js` 33 场景 **非彩虹判据越界 0 处 + 彩虹变化 19 处**（为 0 即空改，两者都 exit 1）。变异自证 `mutate-rainbow.js` 5 条 0 漏网，并留下两条方法学教训：R3「闸只看低云」第一版测试全绿（⇒ 补了中高云遮日断言）；R1「把 `low>=70` 加回去」也全绿，但那**不是漏网而是等价变异体**（与 `low<40` 互斥的死分支）。新写的否定文案含「不会有」被 `weather-model-test` 的断言式承诺门当场拦下 ⇒ 改条件语气。**真机 VERIFIED**（开发者工具模拟器，用户授权；驱动 v4 用 `page.callMethod('applyWeather', …)` 喂生产形状载荷，A 满云 ⇒ 彩虹 ★★ + 新文案，B 云开有雨 ⇒ 彩虹 ★★★★ + 方位角整数 276；三轮被作废的尝试留在 `device/invalid/`，见铁律 32⑥）；银河"月黑给到第三颗星"的星级/文案张力只登记未改。铁律见 32，报告 `docs/weather-ux/qa/v2-rainbow-gate-2026-10-10/README.md`）· **Gate recount 14:** 2026-10-10 天相沉默闸（第十轮，用户第二次就同一屏追问）（**63 套 / 4350 断言 / 失败合计 0 / 全部 exit 0**，本轮 +26 条全部落在既有三套：`sky-test 70→82`、`weather-page-test 177→189`、`weather-v2-test 45→47`；套件数与工具数不变，两个新脚本在 `docs/weather-ux/qa/` 下）。生产代码动 5 个客户端文件（`utils/sky.js`、`utils/conditions.js`、`pages/weather/weather.{js,wxml,wxss}`），**阈值改动数 0**：缺陷不是判据错，而是**一个字段被当两件事用**——`score` 只该回答"多有戏"，页面却由它顺带决定"露不露出来"，于是满云日挂着星空 ★★／银河 ★★★，银河卡还写着「朝西南（约 231 度）找银心带」。修法：`sky.js` 加显式三态 `VERDICT={possible,excluded,unknown}` 与 `isSilent()`（6 个结论函数**每条 return 路径**共 14 处都带判定；`excluded` 沉默、**`unknown` 必须仍出卡并说明缺什么**、缺字段失败开放、客观时刻永远 possible），页面 `buildCondCards` 据此减卡并新增 `buildCondSilent` 点名被减项（减卡不能长成"工具坏了"，铁律 27③ 换主体），`overallGrade` 同步剔除 excluded（挖出的真不一致：被排除的云海卡手里还攥着 64 分 ≥45 会进 live 池——**看不见的证据在替看得见的结论投票**）。**故意的用户可见变化不拿零差异当验收**：`ab-silence.js` 两侧各走自己的 `sky.summarize` 与**自己的真页面 `buildCondCards`**（`git archive 5351231`），40 场景（12 合成 + 28 天真实快照）读数＝六卡可见字段逐字节差异 **0** / 被沉默 **107** 张（云海 35、彩虹 28、光染 27、银河 9、星空 8）/ 仍出现 **93** 张（107+93=200=40×5 分区闭合）/ 越界 **0** / `unknown` 存活 1/1 / 总评变化 21 场景全部可归因；三条空改门之一 `untouched===0` 是第一版跑出来才发现缺的——**前 11 组每组都减卡，没有"一张都不减"的阳性对照就分不清是闸在判还是无条件减卡**。变异 `mutate-silence.js` **8 条 0 漏网**（含"把 unknown 当 excluded 吃掉""减卡不点名""总评继续听被沉默卡"），S5 首次是**注入失败**（偏移 +1 落在中文注释上）⇒ 计漏网并 exit 1，不静默改错行充数。真实快照分布：28 天没有一天五项全活，峨眉山 10-13/14/15 五项全灭 ⇒ 页面只剩总评 + 沉默行。**真机 VERIFIED**（三用例 PASS：A 满云 → 结论卡 0 张 + 沉默行 1 行点名五项；B 五项有戏 → 5 卡 0 沉默行、银河「朝东南（约 157 度）找银心带」照旧；C 无高程 → 云海 ★★☆☆☆ 且自带「此点缺少可信海拔」；每用例 reLaunch + 独立 `updatedAt` + 三用例读数互不相同的污染自证，截图前先断言 `dayCards/unified/chartSeries` 门槛链，星级串取自 `el.text()` 而非 data 推断；bundle 新鲜度由新文案自证。中途一次会话僵死（`cli auto` 挂起、端口从不 LISTENING、无可杀孤儿会话）经用户授权 `cli quit` + 重开后恢复；B 第一版只有 4 张卡，**三个原因全在夹具**——快照 `places` 键是拼音 `emeishan` 写成中文 ⇒ 静默回落到 489 m 的成都 ⇒ 云海被**正确地**判 excluded，另两处是 `altitudes[0]` 与 `hourOf` 取错小时，见铁律 33⑧）。**未做并留裁决**：黄金/蓝调时刻本轮不动——仓库里没有可追溯的"斜射暖光被挡住"口径，拿 `sunVisible` 去裁会造出假否定（卷层云被判遮死）。`cloudfunctions/` 零改动 ⇒ **不需要重新部署**。铁律见 33，报告 `docs/weather-ux/qa/v2-silence-gate-2026-10-10/README.md`）· **Gate recount 15:** 2026-10-10 摄影窗口事实后缀（第十一轮，用户选 A："时间不删，把话说准"）（**63 套 / 4364 断言 / 失败合计 0 / 全部 exit 0**，本轮 +14 全落在 `weather-v2-test 47→61` 的 §2b）。生产文件 2 个：`utils/sky.js` 把光染注释里一直在用的「低云少（光能到山体）」命名成 `LIGHT_LIMITS.LOW_CLOUD_MAX`（导出对象、按引用读）+ `lightReachesGround(c)`，光染判据与彩虹 `sunVisible` 前半句同时改调它；`utils/agenda.js` 给蓝调（晨）/黄金（晨）/黄金（昏）/蓝调（昏）四条接上「当时低云 X%，斜射暖光可能到不了山体 / 天空可能只发灰不发蓝」的 sub 后缀，**时刻与标题一字未改、条目一条不裁**。阈值改动数 **0**（40 不是新数）。**先收回上一轮一句错话**：第十轮报告写"仓库里没有可追溯的『斜射暖光被挡住』口径"——口径就在光染注释里，我当时把它和彩虹那道含中高云项的闸混为一谈；原文只加前向指针不删。**单源是真的可测**：影子把 40 改到 95 ⇒ 同一份低云 60% 的数据光染标记变多、彩虹标记变多、窗口后缀归零（三处一起动），还原后逐项相同；另配静态门盯 `agenda.js` 里的字面量副本。判据只看低云顺带**不误伤卷层云**（全天 95% 中高云 + 低云 5% ⇒ 0 处后缀）。`Number(null) === 0` 的坑单独钉：`lowCloudAt` 只认 `typeof === 'number'`，否则"没有读数"会被印成"低云 0%，光好"= 凭空造有利事实。对拍 `ab-photo-note.js`（改前侧 `git archive eded900`，两侧各走自己的 agenda/sky/真页面装配）：36 场景（8 合成 + 28 天真实快照）新增后缀 46 处、零后缀阳性对照 21 个、越界 0，越界定义含"改名必须是纯改名"（六卡九字段 + marks + 页面卡集合 + 总评逐字节相同）。变异 `mutate-photo-note.js` **8 条 0 漏网**，其中 **P7 第一次漏网的原因在夹具不在判据**——"缺读数"用例只铺一行 `00:00` 却去查 `06:40`，`lowCloudAt` 查无此小时直接返回 null，那条断言从未走到 null 分支（假绿），铺满 24 小时 `{low:null}`/`{}` 后才会红。**真机 VERIFIED**（端口重绑 9423；A 满云 4/4 条带后缀 + 像素层 `.ag-sub` 命中 4 行、B/C 后缀 0 行且卡 5 张；日出日落/天文晨光始/暗夜始一条不少）；第一版假红同样是驱动查错容器（`.timeline-card` 是 `wx:if="{{!unified}}"` 的兜底块）。`cloudfunctions/`、`pages/`、`components/` 零改动 ⇒ **不需要重新部署**。**发现未动**：时间轴「天文暗夜始」的 sub 仍写「银河与深空窗口」——满云那晚银河卡已被沉默闸收掉，这半句是同一类"把不可能包装成建议"，等裁决。铁律见 34，报告 `docs/weather-ux/qa/v2-photo-window-note-2026-10-10/README.md`）· **Gate recount 16:** 2026-10-10 「天文暗夜始」机会句改由同源标记决定（第十二轮，用户选 A）（**weather-v2-test 61→67**，其余套件未动；63 个可无头套件逐套独立跑 **62 套 exit 0**，读数合计 4299）。生产文件 **1 个**：`miniprogram/utils/agenda.js`——时间轴那行 `20:03 天文暗夜始 · 银河与深空窗口` 里其实藏着两件事：前半句是客观钟点（任何天气都发生，不许裁），后半句是**机会主张**；而满天云那晚银河卡已被沉默闸收掉，同一屏两处互相打脸。修法零新阈值零第二实现：机会句改为读 `sky.hourMarks` 已经打出来的 `galaxy` 标记（银心季 + 月照 <35% + 暗夜晴空三合一），有则说、无则只剩时刻；`hasMark` 按页面级键 `date + 'T' + HH:mm` 查（写成 `h.t` 会静默恒 false，变异 D4 专抓）。**减话类改动必须双向可证**：只测"被摘掉"会放过"永远不说"这种一刀切，故判据含双向一致 + 对拍"保留数 > 0"门；与卡片的一致性只写**单向**（有机会句 ⇒ 银河卡 possible）——标记比卡片多一个月照门槛，写成双向等价就是编出来的对称。对拍 `ab-dark-window.js`（改前侧 `git archive d2e9d70`）34 场景（6 合成 + 28 天真实快照）：摘掉 9、保留 25（9+25=34 闭合）、越界 0，越界定义含"上一轮摄影后缀条数不得回退"与"非目标条目 sub 一动即红"；变异 `mutate-dark-window.js` **6 条 0 漏网**。**真机 VERIFIED**（端口重绑 9424：A 满云 → 时刻 20:03 在、sub = null、像素不含机会句；B/C → 时刻在、sub 照旧「银河与深空窗口」、摄影后缀 0 条、卡 5 张）。**跑出一条与本轮无关的红并如实归因**：`tools/e2e-test.js:72` 把 `deadlineAt` 写成绝对时刻 `'2026-10-10T20:00+08:00'`，本地钟过 20:00 后 `signup.submit → WRONG_PHASE` 并在 `:145` 抛错中断整条 && 链（71 条不计入总数）；已在 `git archive origin/master`（`abf08f0`，不含我方 5 个提交）的干净副本复现**同样的红、同样的行号** ⇒ 归属清楚；修法＝夹具时间改用 `Date.now()` 偏移，但动的是公共门禁，未擅自改，留用户裁决（教训：门禁夹具里的绝对日期就是时间引信）。`cloudfunctions/`、`pages/`、`components/` 零改动 ⇒ **不需要重新部署**。铁律见 35，报告 `docs/weather-ux/qa/v2-dark-window-note-2026-10-10/README.md`。**Base commit:** `2e504f2` · **Gate recount 17:** 2026-10-13 V2.0 路线库（**64 门禁套件 / 4439 断言**：新增 `tools/routes-test.js` 68；常驻非确定性红仍只有天气线 `outdoor-intelligence-ui` 一条——本轮已在 master 干净 worktree 复现同行号 TypeError，确认先于本功能存在）。生产改动：**云函数 6 个 domain 文件 + index.js（第 14 个 action `readRoutes`、第 40–42 条命令 `route.create/update/delete`）+ trailApiLab domain 六文件同步**（lab 写同一批 `ot_*` 集合，schema 必须一致）；客户端新增 3 页 12 文件（`pages/routes` 列表 / `pages/route` 详情 / `pages/route-edit` 编辑器，**零新 token**，样式全复用 app.wxss）+ 改 `utils/api.js`、`pages/me`（入口）、`pages/editor`（`?routeId=` 预填）。**`cloudfunctions/` 已改 ⇒ 需要重新部署 trailApi**；真机 UNVERIFIED（跑 E2E 需重开共享开发者工具会话，未擅自执行）。spec `docs/superpowers/specs/2026-10-13-route-library-v2.md`。路线此前只是活动副产品（`persistPrivateRoute` 落 `ot_routes`，从未被读出），本功能把路线变成独立资产：`domain/routes.js`（CRUD + 删除前活动引用检查 + owner 双层授权）+ `selectors.selectRoutes`（列表/单条投影，`isOwner` 显式给出，旧路线缺键读缺省 copy/private/null）+ 共享（身份码授权，`visibility` 由 `sharedWith` 派生禁矛盾态）+ 一键发起活动（编辑器路线预填，草稿独立键防旧草稿盖掉新路线）+ 分段天气（复用 `getWeatherByPoint` 零云函数改动，`route-schedule` 按出发时刻推算各节点抵达日）。变异自证 9 条 8 抓 1 漏网（M1/M6 单层授权是故意冗余，组合变异 M9 被抓到 ⇒ 这对检查承重；漏网记入提交信息不强行制造红）· **Gate recount 18:** 2026-10-14 天气韧性与用户话术（用户报「天气页常常超时、报错面向开发者」；**66 门禁套件 / 4498 断言**，为全量复跑实测值而非增量：新增 `tools/weather-resilience-test.js` 45，`scenario-api-test` +2 反开发者术语门。**1 条红且先于本轮存在**：`tools/e2e-golden-path-test.js` GP-01 在 `git stash` 干净基线上同款复现（`passed=12 failed=2`，NO_REVISION），归属清楚未擅动；常驻非确定性红仍只有天气线 `outdoor-intelligence-ui`（本轮复跑 47/0）。生产改动：客户端 `utils/api.js`（失败话术改为面向户外人员，`e.raw` 留技术原文）、新增 `utils/weather-cache.js`（失败软降级本地缓存）、`pages/weather.{js,wxml}`（瞬时故障自动重试 3 次、失败时缓存兜底 + 时效横幅、分场景文案）；云函数 `index.js`（`getCachedForecast` 外呼失败返回 12h 内陈旧缓存并标 `stale`/`staleAt`、`actionGetWeather` 改按 docId 直读活动不再 15 集合全量加载）与 `lib/weather.js`（`pointResponse` 透传 stale）。**`cloudfunctions/` 已改 ⇒ 需要重新部署 trailApi**；真机 UNVERIFIED（未跑开发者工具）。铁律：话术可行动性不回退；旧数据必须带时效；重试只给读操作）· **Gate recount 19:** 2026-10-14 快速创建与可后补路线（用户问「轨迹能解析出来的项能否全部设为可忽略，避免冷启动代价太大」；**68 个 `*-test.js` 套件全量复跑：65 套 exit 0 / 3 套环境性 INCONCLUSIVE**——`e2e-golden-path`/`e2e-ui-state`/`e2e-ui` 因 automator 无会话中止于环境前置（BUSINESS 层全过、结论按惯例记 INCONCLUSIVE 而非通过），其中 golden-path 的 GP-01 红早已登记为先于本轮存在；本机可测断言 4398。新增 `tools/quick-create-test.js` 65 与对拍 `tools/ab-quick-create.js` 7，`scenario-editor` 140→153、`journey-test` 138→144、`e2e-interleave` 67/0/3）。生产改动：**云函数 3 个 domain 文件双份同步**——`activity.js` 发布门只剩标题/三个时间/集合上车点（轨迹可解析项整体可为空、**条目级完整不放水**）、`invariants.js:55-57` 同源放宽、`selectors.js` 抽出 `riskView` 单源 + 增 `completeness` 派生 + 空路线不再广播 `attendance.node`；`activity.edit` 阶段锁三组化（交易性键整体锁 / 路线·风险·上车点**只增不改**按 id 逐字节比对 / 信息性标量可改）。**客户端 6 个文件**：`editor.{js,wxml}`（`missingForPublish` 与 `deferredForPublish` 双清单、发布确认层「去补上/仍然发布」知情跳过、风险 severity/coordinates 无损往返、GPX/路线库后一键派生集合点）、`activity.wxml`（节点待完善空态、里程爬升为 0 不印「0km/0m」）、`journey.js`（draft 文案改口径 + published 非阻塞待办「完善路线与风险」）、`field-panel.wxml`（空节点死控件兜底）、`home/discover`（缺里程不印「· 0 km」）、`workspace.js`（传 completeness）。**`cloudfunctions/` 已改 ⇒ 需要重新部署 trailApi**（已跑 `sync-lab.js` 双份落盘）；真机 UNVERIFIED。三个用户决策：D1 上车点维持必填+一键派生 / D2 阶段锁改只增不改 / D3 不设必填层级、字段只分必填与可忽略两类。验收：`ab-quick-create.js` 对拍完整活动（存量形状）放宽前后**终态逐字节相同、命令序列成败码一致**，阳性对照空路线旧拒新收（证明对拍器没在空跑——第十二轮「没有阳性对照就分不清闸在判还是无条件减卡」的教训）；`quick-create-test.js` 65 条覆盖发布门/只增不改/引用守卫/投影单源/存量零变化。spec `docs/superpowers/specs/2026-10-14-quick-create-deferred-route.md`。铁律：可忽略≠静默缺失——待完善必须显式可见且一键可达；只增不改的逐字节比对依赖投影往返无损（`riskView` 补 severity 顺带修掉一个既有 bug：带 severity 的活动在 gathering 下连改说明都被阶段门误锁）；对拍夹具的时间一律 `Date.now()` 偏移，不写绝对日期）· **Gate recount 20:** 2026-10-17 UI/UX 审计第二轮修复 Wave 2（11 个执行 Agent 协同，32 改 + 24 新门槛文件；**全量复跑 90 套 / 计数断言 5833：GREEN 86 / RED 1 / INCONCLUSIVE 1 / ENV-ABORT 2**）。`cloudfunctions/` 零改动 ⇒ **不需要重新部署**。新增 12 套门：`t4-e08`（41，`check.js` 首次覆盖 platform-pitfalls：底栏↔页尾留白查**终值**、`Component()` 同名 `options` 键、具名 slot↔`multipleSlots`、全局类↔`apply-shared`；落门前实测命中全 0 ⇒ 无白名单）、`swx1-style-gates`（45）、`swx2-style-gates`（117）、`b4-pad-final-value`（32，底部留白按 `app.json tabBar.list` 分档）、`page2-gates`（97）、`a20-owner-hero`（31）、`b4-c11-busy-selfheal`（171；同一套打 `git archive HEAD` 副本 = 65/106 ⇒ 改前真红）、`b4-e05-checklabel`（49）、`rb-vehicle-dependency`（41）+ `rb-toggle-guard`（26）、`rc-transport`（67）、`ra-field-panel`（72）。**翻案一条被挂成"常驻非确定性红"的账**：`outdoor-intelligence-ui-test` 连跑 3 次读数一致、干净 `13cb844` 副本同样 45/2 ⇒ 不偶发；真因是套件一处钉「很值得关注」而 `oi-presentation.tierOf()` 从不发该词（发「重点关注」），词源是 `docs/weather-ux/outdoor-intelligence/README.md` 抄了旧词 ⇒ 已收单源（改后 46/1；牙齿证明＝沙盒把 `tierOf` 改发别的词 ⇒ 44/3 两处全红）。**补上 payload 后暴露的真缺陷（未修，留裁决）**：条目 `hour = Math.floor(fromMin/60)`，而 `applySelection` 用 `hour*60` 比对分钟粒度窗口段 ⇒ **起点不在整点的子小时窗口点不中**，实测峨眉山 CLOUD_SEA「06:45–07:00」anchor hour=6 → `selIndex=-1`，而页面 `weather.wxml:194/257 data-hour="{{item.hour}}"` 正是这条路径。保持 OPEN：E-08（还剩 7 条规则无门）/ C-11（通知面未派 + 求值点位置）/ M-18（活动身份半）/ M-07（editor `.cluster` 5 条）；**真机本轮全部 NOT_RUN**。详见 SYNC.md 2026-10-17 条与 `fix-round2/state/commit-list-wave2.md`（协同产物在仓库外 `%TEMP%`，易丢）。

---

## OVERVIEW

OurTrail is a **zero-money, pure-tool outdoor companion/fulfillment app for friend circles** (「熟人圈子的户外同行履约工具：零金额、纯工具」). The loop: 发起人建活动 → 分享到群 → 群友填一次报名 → 发起人用同一份名单完成审核、分车、签到、收尾、导出.

**Stack — smaller than it looks:**

| Layer | Reality |
|---|---|
| Client | WeChat mini program, **native WXML/WXSS/CommonJS JS**. **20 pages**（`app.json` 实测，2026-10-13 复点：新增 `pages/routes`、`pages/route`、`pages/route-edit`——V2.0 路线库）, **13 个组件目录**（12 在用 + `privacy-popup` 死代码）+ 位于 `miniprogram/custom-tab-bar/`（不在 components/ 下）, **zero npm dependencies** (no `miniprogram/package.json`, no `miniprogram_npm/`). `libVersion 3.8.12`, appid `wx1227a277a3f2f7ea` |
| Backend | **ONE production** cloud function `trailApi` — 14 `action` values multiplexed through one `ROUTES` map (`index.js:259`), fanning out to **42 command types**. Sole dependency `wx-server-sdk ~3.0.1`. 另有 **`trailApiLab`**：私有预演工具云函数（只给 `pages/lab` 造 `[预演]` 沙盒），与生产**共用同一套 `ot_*` 集合**，不是第二条服务链路 |
| Store | Document-per-record across **16** `ot_*` collections (14 in the `COLLECTIONS` map, plus `ot_meta` and `weather_cache`). `ot_meta/main` = `{revision, savedAt}`. Writes diff records inside one transaction with a **revision CAS** |
| Domain | 14 pure JS modules in `cloudfunctions/trailApi/domain/` — all authorization, business rules, and response shapes live here and **the client cannot bypass any of it**（2026-10-13 新增 `routes.js`：路线资产生命周期） |
| Weather | Keyless `https.get` to `api.open-meteo.com` via a cloud-function proxy, 30-min `weather_cache`. **All astronomy/天相 computation is client-side** |
| Design source of truth | `miniprogram/app.wxss` (33 tokens + all globalized component classes) + `.agents/skills/ourtrail-ui/` |

**No root `package.json`. No `node_modules/` anywhere. No ESLint/Prettier/EditorConfig/tsconfig/biome. No lint, format, typecheck, or build step for the mini program.** The only automated gates are `node tools/check.js` and `node tools/check-handlers.js`.

---

## READ THESE FIRST (non-negotiable)

1. **`.agents/skills/ourtrail-ui/SKILL.md` + its 3 references** — the UI constitution. Load it for *any* change under `miniprogram/`, even if the user never says "设计系统". Its 14 `platform-pitfalls.md` entries each have a real incident behind them.
2. **`PARALLEL_DEV.md`** — the two-machine git protocol this repo is built around. You are on a relay-backed remote; violating it desynchronizes a second machine.
3. **`SYNC.md`** — 40+ entry changelog and the project's institutional memory. Search it before touching weather, editor, discover, or map code.
4. **`docs/e2e-mp/README.md`** — 改完 WXML/WXSS/组件结构后，**静态门禁通过不代表页面正常**。
   真机（微信开发者工具）驱动是本仓库唯一能看见像素的手段，见下方「直连微信开发者工具」一节。
   P4 的 5 个真机 bug 里只有 1 个是逻辑问题，其余 4 个逻辑测试全都测不到。
   **动手跑 E2E 前先读 `docs/e2e-mp/automation-playbook.md`**：会话僵死的识别与恢复、`quit` vs `close`、
   旧句柄"点击成功但没作用"、`busy` 期间的空按钮、一次性判读造成的假红、云函数部署与超时继承、退出码语义。
5. **`docs/testing/e2e-result-semantics.md` + `tools/e2e-result.js`** — 动两套 E2E（`tools/e2e-test.js` /
   `tools/e2e-ui-test.js`）之前必读。要点：BUSINESS 与 UI 是两个独立维度；**UI 的一条 PASS 必须由
   「一次真实 tap/input + 它的后果观测」构成**；云侧 fallback 只能证 BUSINESS；门槛不过或通道退化
   记 INCONCLUSIVE（退出码 2），**永远不是 PASS**。判别力由 `tools/e2e-fault-probe-test.js`（34 项变异）
   自证；改测试语义之前先跑它，改完再跑一次。
6. **`docs/testing/release-coverage-matrix.md`** — 想知道"这条命令/这个错误码到底有没有人测"就先查它，别靠记忆。
   它是脚本算出来的（42 命令 × 20 错误码 × 22 模块 × 20 页），并写明三条界线：
   **A 层 PASS ≠ UI PASS ≠ REAL CLOUD PASS；桩 barrier ≠ 真云端并发；门槛不过一律 INCONCLUSIVE。**
   并发/一致性侧的结论正文在 `docs/testing/concurrency-consistency-model.md`（层①/层② 分工）与
   `docs/testing/phase9-report-2026-10-07.md`（BUG-C1 收口 + 真云端并发与读滞后实测）。

---

## STRUCTURE

```
/                      # 0 config files of note: project.config.json only
├── miniprogram/       # CLIENT — see miniprogram/AGENTS.md
│   ├── app.js/json/wxml/wxss   # entry; app.wxss IS the design system
│   ├── config.js      # CLOUD_ENV / FUNC_NAME / NOTICE_TMPL_IDS — the only env file
│   ├── pages/         # 20 dirs, 1:1 with app.json `pages`
│   ├── components/    # 13 dirs（12 在用 + privacy-popup 死代码）
│   ├── custom-tab-bar/  # 与 components/ 同级，样式必须自包含
│   ├── utils/         # 20 files — see miniprogram/utils/AGENTS.md
│   ├── wxs/           # text.wxs
│   └── assets/markers/  # generated PNGs (map markers reject base64)
├── cloudfunctions/trailApi/   # BACKEND — see cloudfunctions/trailApi/AGENTS.md
│   ├── index.js        # 13-action router (ROUTES@244), overrideEvidence, weather
│   ├── store.js        # 16 ot_* collections, loadState, persistState CAS
│   ├── domain/         # 13 pure modules — see .../domain/AGENTS.md
│   ├── lib/weather.js  # Open-Meteo proxy (duplicates gcjToWgs — keep in sync)
│   └── smoke-test.js   # 173 cases (measured 2026-10-09), needs no wx-server-sdk
├── tools/             # 72 个零依赖 node 脚本（实测 2026-10-10 三层切片后）：65 个 `*-test.js`
│                      #   （62 个可无头进门禁；3 个需开发者工具：`e2e-ui-test` /
│                      #   `e2e-ui-state-test` / `e2e-golden-path-test`）+ 2 个静态检查 +
│                      #   `e2e-result.js`（结果账本，被上述 3 套真机层与变异自证 require）+
│                      #   `lifecycle-harness.js`（6 套 lifecycle-* 套件共用的世界驱动器，本身不是套件）+
│                      #   桩/生成器（gen-map-markers / sync-lab / stub-wx-server-sdk）
│                      #   ⚠ 改过 cloudfunctions/trailApi/domain/* 或 store.js 后必须跑
│                      #   `node tools/sync-lab.js`，否则 trailApiLab 副本与生产不一致，
│                      #   `lab-dryrun` 会红（Phase 8 就留过这条残留，Phase 9 才补跑）。
├── docs/product/      # 9 tracked product specs + 3 ADRs — the "why"
│                      # (天气线三份：P1 徒步天气概览 / P2 天相与meteogram / P3 独立天气模块)
├── docs/testing/      # 审计与测试基线：cross-agent-audit.md（裁决记录）/
│                      #   e2e-result-semantics.md（两维四态语义）/ 覆盖矩阵 / 清单
├── docs/prototypes/ourtrail-app/  # FROZEN React design spec — see its AGENTS.md
├── .agents/skills/ourtrail-ui/    # mandatory UI rules
├── PARALLEL_DEV.md / SYNC.md / README.md
```

---

## WHERE TO LOOK

| Question | Location |
|---|---|
| What fields does entity X have? | `cloudfunctions/trailApi/domain/schema.js` |
| Can this user do Y? | `domain/permissions.js` → `canExecute` / `staffCan` / `vehicleCan` |
| What are the hard business rules? | `domain/invariants.js` → `assertInvariants` |
| What shape does a page get back? | `domain/selectors.js` (whitelisted projections) |
| How does auto-assign (分车) work? | `domain/allocation.js` → `planAssignments` |
| How does the page talk to the cloud? | `miniprogram/utils/api.js` — the **only** `wx.cloud` caller |
| What are the design tokens? | `miniprogram/app.wxss` lines 5–40 (33 CSS custom properties on `page`) |
| Beijing-time formatting + label maps | `miniprogram/utils/format.js` |
| 这一页该说什么状态 / 下一步是什么 | `miniprogram/utils/journey.js`（唯一出口；页面只插值，不再自造状态词） |
| 页面图与死页面归谁管 | `tools/journey-graph-test.js`（可达性、返回路径、denied 出口、模板比枚举、词汇漂移） |
| GPX → route nodes | `miniprogram/utils/gpx.js` → `parseGpx` |
| 天相 / 概率判断 | `miniprogram/utils/sky.js` → `summarize`; astronomy in `utils/astro.js` |
| Why does rule X exist? | `docs/product/` + `docs/prototypes/ourtrail-app/src/domain/` (read-only) |
| It broke yesterday — what happened? | `SYNC.md` 变更日志 |
| 改完 UI 怎么确认真的没坏？ | 真机驱动，见下方「直连微信开发者工具」+ `docs/e2e-mp/README.md` |

---

## CODE MAP

Reference centrality measured by **grep require-count** (no TS/JS LSP and no ast-grep are installed in this environment, so centrality is a proxy, not a compiler-derived number):

| Module | Refs | Role |
|---|---|---|
| `miniprogram/utils/api.js` | 15 | Sole `wx.cloud.callFunction` site; 14 exports |
| `miniprogram/utils/format.js` | 15 | UTC+8 formatting + all label maps |
| `miniprogram/utils/journey.js` | 7 | **状态与下一步的唯一翻译层**：阶段/报名/出行/指标/构成/门槛/错误码→人话；wx-free，`tools/journey-test.js` 直接打它 |
| `domain/contracts.js` | 12 | ERROR_CODES, `canonicalPayload` (sha256 fingerprint), `genId`, `deepClone` |
| `miniprogram/utils/draft.js` | 7 | wx-storage drafts + opened-activity LRU |
| `domain/permissions.js` | 7 | All authorization |
| `miniprogram/utils/astro.js` | 5 | NOAA solar/lunar math |
| `miniprogram/utils/weather-model.js` | 1 | P4 track/node orchestration over `sky.js` (wx-free; **holds no 天相 thresholds**) |
| `domain/schema.js` / `invariants.js` | 4 / 4 | Entity specs / referential integrity |
| `domain/selectors.js` | 2 (but 493 LOC) | Every response shape |
| `utils/{sky,route-schedule,gpx,chart-store}` | 3 each | 天相 / schedule mapping / GPX / cross-page bus |

**Complexity hotspots** (>400 LOC, `wc -l`, 2026-10-04 实测): `miniprogram/pages/editor/editor.js` (828) · `editor.wxml` (528) · `pages/activity/activity.js` (551) · `domain/selectors.js` (493) · `app.wxss` (493) · `components/meteogram/meteogram.js` (520) · `components/transport-panel/transport-panel.js` (457) · `utils/sky.js` (433) · `pages/signup/signup.js` (482).

---

## COMMANDS

There is no `npm test`. Everything is a bare `node <file>` from the repo root. Each suite self-reports `passed=N failed=N` and exits non-zero on failure, so `&&`-chaining works.

```bash
# MANDATORY pre-commit gate (PARALLEL_DEV.md 铁律 3)
node tools/check.js            # static: node --check, WXML tag balance, WXSS braces,
                               # app.json page files, usingComponents refs (forward: registered
                               # but missing, AND reverse: tag used but never registered)
                               # → ALL CHECKS PASSED
node tools/check-handlers.js   # every WXML bind* resolves to a JS handler (catches what --check cannot)
node tools/check-handlers.js weather   # optional: single page/component target

# Gated suites — 91（90 个 tools/*-test.js + smoke-test.js；另 3 套 e2e-ui / e2e-ui-state / e2e-golden-path 需开发者工具，不计入。实测 2026-10-17 合并上游二阶段后：`ls tools/*-test.js | wc -l` = 93，其中含上游自带的 `tools/ui-consistency-test.js`）。
# 2026-10-14 全量复跑实测共 4498 断言（各脚本自己打印的 passed= 之和；快照会漂，以实测为准）。
# 本轮红 1 条且**先于本轮存在**：tools/e2e-golden-path-test.js GP-01（NO_REVISION）在 git stash
# 干净基线上同款复现（12 passed / 2 failed）⇒ 归属清楚，未擅动公共门禁。
# 常驻非确定性红 1 条 = tools/outdoor-intelligence-ui-test.js（打线上 Open-Meteo + 真实时钟，已归档归因；
#   2026-10-14 复跑 47/0 ⇒ 偶发性质与归档一致，别重诊）。
# 曾有的"确定性时间引信"已修：tools/e2e-test.js 夹具里的 deadlineAt/startAt/endAt/meetingAt/expiresAt
#   一律改为按 Date.now() 偏移推导（写死日历＝埋引信；2026-10-10 20:00 过点后曾中断整条 && 链）。
#   自证：E2E_SHIFT_MINUTES=+2880 复跑仍 72/0；=-2880（窗口被关掉）时**首条即有效性门**、
#   退出码 2 = 本次运行 INVALID，不再伪装成一串产品红 + 末尾 undefined 抛错。
# ⚠ 断言总数是**快照**，不是恒定值：
#   本仓库常有并行工作在进行（trailApiLab / lab 页 / 各类 bug 修复），
#   那些改动会增删用例（例：smoke 104→106→167、workspace 104→111 均非本轮 P4 改动）。
#   **以每个脚本自己打印的 passed=N 为准**，不要信任何写死的总数。
node cloudfunctions/trailApi/smoke-test.js   # 领域层（167）
node tools/astro-test.js                     # 天文（60）
node tools/gpx-test.js                       # GPX + 坐标转换（57）
node tools/sky-test.js                       # 天相结论（82；§3 彩虹遮光闸成对反例，§12 三态 verdict 沉默闸）
node tools/route-schedule-test.js            # 日程推算（41）
node tools/weather-page-test.js              # 云函数→页面→组件契约（189；§13 天相卡沉默闸走真页面 buildCondCards）
node tools/watch-points-test.js              # 观察点/轨迹点组（37）
node tools/weather-model-test.js             # P4 轨迹层编排（wx-free 纯函数）（82）
node tools/weather-v2-test.js                # Weather V2：WMO 雪码/云海可见性/Evidence/optional 降级/总评剔除被沉默卡/摄影窗口事实后缀/暗夜机会句同源标记（67）
node tools/meteogram-draw-test.js            # meteogram 真实 draw()：V2 云带剖面/风/日照轴（记录式 2D）（30）
node tools/space-time-test.js                # P4 时空天相图几何 + 漫游读数（109）
node tools/space-time-draw-test.js           # P4 真实 draw() 执行（记录式 2D 上下文）（55）
node tools/roam-scrubber-test.js             # P4 漫游控件定时器与事件契约（33）
node tools/cloud-field-svg-test.js           # Cloud Field 等值带 SVG 渲染器：网格/开链配对/碎片过滤 + 三态结论与 reason（29）
node tools/weather-cloud-field-test.js       # 生产返回体 → cloudField 适配器 + inferState（31）
node tools/meteogram-svg-test.js             # Unified Meteogram SVG 构建（25）
node tools/meteogram-multiday-test.js        # Multi-Day Horizon 48/72h（48）
node tools/outdoor-cloud-sea-test.js         # 云海机会窗口判定 + R2 边界语义 + 三本账分区不变量（32）
node tools/outdoor-intelligence-test.js      # Outdoor Intelligence 条件态/机会判定 + 证据 kind 契约与摘要选择（35）
node tools/outdoor-intelligence-ui-test.js   # OI 呈现层 + 天气页集成（47）
node tools/trip-mode-test.js                  # 出行方式 self/shared：Case 1-10 业务态 + 投影/动作/导出/detailState（78）
node tools/weather-v2-visual-audit-test.js   # Weather V2 视觉保真审计：跨宽度几何归一化/YOU 锚点/covered 透传/OI 卡契约（43）

# 旅程可解释性两套（2026-10-08 新增；被测层是 miniprogram/utils/journey.js——状态与下一步的唯一翻译层）
node tools/journey-test.js                   # 阶段/报名/出行/指标/构成/门槛/错误码/时间线/只读锁：四问是否齐备（138）
node tools/journey-graph-test.js             # 页面图静态门：死页面、无返回路径、denied 无出口、WXML 比枚举、状态词漂移、死模块登记（12）

# 全生命周期审计六套（2026-10-08 新增；共用 tools/lifecycle-harness.js，该文件本身不是套件）
node tools/lifecycle-transitions-test.js     # 7×7 阶段穷举/终态封口/级联键/两条死路探测（214）
node tools/lifecycle-cancellation-test.js    # 八个取消时点 + 名额候补联动 + 取消∥分车交错 + 集合点收敛（71）
node tools/lifecycle-allocation-test.js      # 容量/占座/司机/上车点/删车换司机 + 预览不可重排不可覆盖（109）
node tools/lifecycle-projection-test.js      # 逐行标志↔域内结论差分、permittedActions 可用性穷举、视角最小暴露、客户端文案判状态静态门（132）
node tools/lifecycle-concurrency-test.js     # 8 类命令同 requestId 重放、同版本并发败者零副作用、归档后迟到操作、递补整批原子（126）
node tools/lifecycle-fuzz-test.js            # 60×45 随机场景零违背 + 13 条终态性质 + 20 类变异自证 + 固化种子（47）
# 端到端两层（A 层计入门禁；B 层需开发者工具，不计入门禁）
node tools/e2e-test.js                         # A 层服务链路 E2E（72 项，真信封打 exports.main；夹具时间按 now 偏移，E2E_SHIFT_MINUTES 可自证与钟点无关，窗口不成立时 exit 2 记 INVALID 不记产品红）
node tools/e2e-fault-probe-test.js             # 结果模型变异自证（34 项）
node tools/e2e-permission-test.js              # A 层权限矩阵：角色×命令×阶段×归属（96 断言，8 actor 全走真实信封）
node tools/e2e-domain-negative-test.js         # A 层 Domain 负矩阵：17 种错误码的确定性拒绝 + 败者零副作用快照对比（86 断言）
node tools/e2e-concurrency-test.js             # A 层并发基座（Phase 8）：barrier 对照/同 R 双写/陈旧写/幂等（50 断言，4 INCONCLUSIVE，exit 0 可进门禁；S4/S4b 常驻红测已于 2026-10-09 转正）
node tools/e2e-revision-guard-test.js          # P1 盲写洞回归（2026-10-09）：缺/坏 expectedRevision 一律 NO_REVISION 且零落库（16 断言）
node tools/meta-revision-guard-test.js         # P1 版本号回卷回归（2026-10-09）：ot_meta 读故障必须失败关闭，不得 set revision:0（18 断言，含首次部署反向门）
node tools/cold-start-work-test.js             # 每请求工作量上限（2026-10-09）：建集合仅首次调用付一次；loadState 的 14 个集合读必须并发发出（RTT 建模，10 断言）

# 幂等窗口与失败语义两套（2026-10-09 可靠性加固第二轮；判据一律检查落库后的最终数据）
node tools/receipt-window-test.js               # receipts 越过 600 之后必须按 appliedAt 淘汰：文档键是 actorId__requestId，重读会重排 ⇒ 按位置砍会砍掉最新回执 ⇒ 重放多出第二场活动（19 断言 + 2 INCONCLUSIVE）
node tools/failure-semantics-test.js           # 写失败两语义分离（超时=结果未知→重读、绝不自动重发）+ 服务端错误归类（INTERNAL 不泄露英文原文、原文只进单行结构化日志、日志无 PII）+ 发出的码必须 ∈ ERROR_CODES（37 断言 + 2 INCONCLUSIVE）
node tools/weather-resilience-test.js          # 天气韧性（2026-10-14，用户报「常常超时+报错面向开发者」）：本地缓存软降级（CAP/时效/只收 ready）、页面自动重试与令牌作废、云端外呼失败 12h 陈旧兜底（stale/staleAt）、活动模式天气只读 1 个活动文档不再 15 集合全量加载、读故障≠NOT_FOUND（45 断言）

# Weather V2 几何、海拔语义与机会卡主张三套门（2026-10-09 审计第一轮；铁律 25）
node tools/cloud-field-geometry-test.js        # 等值带按业务规格写期望拓扑：晴空/满云/单层/多层分离/生灭分裂/临界/锋面/缺失回填/高度边界/噪声极端 + 图与数据的点格一致率 + 变异自证（206 断言；真实三地点 × 24·48·72h × 375·390·414 + §14 显示窗规划）
node tools/elevation-semantics-test.js         # 海拔出处单源 resolveElev 五态 + 「此点」主语 + 模型来源必须标注 + 判读不受剖面窗钳制 + 静态门（34 断言）
node tools/oi-claim-gate-test.js               # 机会卡证据门：星空/银河/彩虹/云海/光染的「不成立必须无卡 + 成立必须有卡」成对用例（彩虹现为三例：干燥 / 云开有雨 / 有雨但满天云）+ 「日照金山」主张静态门 + 分数不得伪装成成功率（26 断言）
node tools/meteogram-readability-test.js       # 统一 Meteogram 可读性：降水柱宽随时间窗且不压叠、缺测温度断开不补中点、微量降水可见不夸大、风向映射与密度、多日昼夜分段、375/390/414 标签不重叠（77 断言，全部解析 SVG 图元判定；§8 显示窗范围自证与边注）

# 云层位置语义三态（2026-10-09 审计续轮；铁律 26）
node tools/cloud-position-test.js              # 三态互斥（in/ok/mid）+ 五类「判不出」各有反例（no-altitude/no-data/within-uncertainty/both-sides/partial-at-point/clear）+ 海拔出处=误差带基准（measured tol=0 与旧实现逐字一致，model ±600m 带内弃权）+ holds 不被压扁（云海与夜间天空闸）+ 无高程不画参考线 + 图例/r3/OI 同一张词表的静态词汇门（62 断言；§8 原来是正则匹配源码的静态门，已换成三条行为断言，见铁律 30）

node tools/e2e-client-cas-test.js              # BUG-C1/C3 回归（Phase 9/10A）：真 editor.js + 真 api.js → 真 trailApi（54 断言，bugs=1：BUG-C2 草稿优先覆盖；C7=层①冲突不得依赖异常类型跨边界，C8=平台事务中止的窄映射，含 C8-⓪ 有效性门与 C8-⑨⑩⑪ 选择性三对照）
node tools/e2e-interleave-test.js              # §13 多步骤并发交错 C1~C6（67 断言，3 INCONCLUSIVE；两层 CAS + baseRevision 内层 + 阶段门次序）
node tools/e2e-panel-sync-test.js              # §14 工作台/面板 revision 同步 P1~P6（40 断言；含 api.js 吞掉 reload 的后果判定）
node tools/e2e-release-gap-test.js             # Release Gate 缺口 G1~G6（51 断言；CONSENT_REQUIRED / GROUP_SCOPE / incident / swap / vehicle.remove / companion.remove）
node tools/e2e-ui-test.js                      # B 层真模拟器 UI E2E（两维账本，退出码 0/1/2）
node tools/e2e-ui-state-test.js                # B 层 Phase 5 UI 状态矩阵（需开发者工具 9420，不计入门禁）

# 三层架构接缝（2026-10-10 首个纵向切片；ADR docs/weather-ux/architecture/weather-v2-three-layer-evolution.md，铁律 30）
node tools/cloud-layer-facts-test.js           # L1→L2 接缝：三个高度范围分开命名（显示窗/实测覆盖/业务扫描）+ 超出覆盖必须说明读到的是填充值 0 + 云层事实不带判定 + topmostBelow 净空不取整（199.6≠200）+ 薄层遮蔽缺陷的特征化用例（钉住现状不修，改候选集合要产品裁决）+ OI 集成与活接缝注入 + 分层静态门 + §7 阈值单源的影子常量（改 80⇒sky 标记/结论文案数字/factsFor/OI 窗口一起动，且剖面↔成带两侧互不串味）（45 断言）

# Page-level scenarios
node tools/scenario-editor-test.js           # 142
node tools/scenario-activity-test.js         # 136
node tools/scenario-workspace-test.js        # 111
node tools/scenario-signup-test.js           # 103
node tools/scenario-me-test.js               # 143
node tools/scenario-notices-test.js          # 67
node tools/scenario-vehicle-test.js          # 56
node tools/scenario-api-test.js              # 27
node tools/scenario-discover-test.js         # 21
node tools/scenario-lab-test.js              # 20
node tools/scenario-staff-test.js            # 18

# Lab cloud-function integration
node tools/trailapilab-test.js               # 25
node tools/lab-dryrun-test.js                # 165

# Full pre-commit sweep
node tools/check.js && node tools/check-handlers.js && \
node cloudfunctions/trailApi/smoke-test.js && node tools/astro-test.js && \
node tools/gpx-test.js && node tools/sky-test.js && node tools/route-schedule-test.js && \
node tools/weather-page-test.js && node tools/weather-v2-test.js && node tools/meteogram-draw-test.js && \
node tools/cloud-field-svg-test.js && node tools/weather-cloud-field-test.js && \
node tools/meteogram-svg-test.js && node tools/meteogram-multiday-test.js && \
node tools/outdoor-cloud-sea-test.js && node tools/outdoor-intelligence-test.js && \
node tools/outdoor-intelligence-ui-test.js && node tools/trip-mode-test.js && \
node tools/weather-v2-visual-audit-test.js && \
node tools/watch-points-test.js && \
node tools/weather-model-test.js && node tools/space-time-test.js && \
node tools/space-time-draw-test.js && node tools/roam-scrubber-test.js && \
node tools/e2e-test.js && node tools/e2e-fault-probe-test.js && \
node tools/e2e-revision-guard-test.js && node tools/meta-revision-guard-test.js && \
node tools/cold-start-work-test.js && \
node tools/receipt-window-test.js && node tools/failure-semantics-test.js && \
node tools/weather-resilience-test.js && \
node tools/cloud-field-geometry-test.js && node tools/elevation-semantics-test.js && \
node tools/oi-claim-gate-test.js && node tools/meteogram-readability-test.js && \
node tools/cloud-position-test.js && \
node tools/cloud-layer-facts-test.js && \
node tools/e2e-permission-test.js && node tools/e2e-domain-negative-test.js && \
node tools/e2e-concurrency-test.js && node tools/e2e-client-cas-test.js && \
node tools/e2e-interleave-test.js && node tools/e2e-panel-sync-test.js && \
node tools/e2e-release-gap-test.js && \
node tools/lifecycle-transitions-test.js && node tools/lifecycle-cancellation-test.js && \
node tools/lifecycle-allocation-test.js && node tools/lifecycle-projection-test.js && \
node tools/lifecycle-concurrency-test.js && node tools/lifecycle-fuzz-test.js && \
node tools/journey-test.js && node tools/journey-graph-test.js && \
node tools/scenario-editor-test.js && \
node tools/t4-e08-test.js && node tools/swx1-style-gates-test.js && \
node tools/swx2-style-gates-test.js && node tools/b4-pad-final-value-test.js && \
node tools/page2-gates-test.js && node tools/a20-owner-hero-test.js && \
node tools/b4-c11-busy-selfheal-test.js && node tools/b4-e05-checklabel-test.js && \
node tools/rb-vehicle-dependency-test.js && node tools/rb-toggle-guard-test.js && \
node tools/rc-transport-test.js && node tools/ra-field-panel-test.js && \
node tools/oi-hour-hit-test.js && \
node tools/e08-remaining-test.js && node tools/m02-class-scope-test.js && \
node tools/ui-consistency-test.js
```

**Test style is hand-rolled** — no jest/vitest/miniprogram-simulate. Each `tools/*-test.js` redefines `check(name, cond, extra)` + `section(title)` and calls `process.exit(failed ? 1 : 0)`. `scenario-editor-test.js` contains the reusable harness: it stubs `global.wx`, captures the real `Page()` config, `delete require.cache` to force a fresh source read, and monkey-patches `utils/api` to assert emitted commands.

**`tools/lifecycle-harness.js` 的三条硬约定**（改 domain 之前先读它，否则等于把审计白做）：

1. fixture **只能通过真实命令**建立——手拼 State 测的是「我造出来的状态」，不是「系统能到达的状态」。
2. `checkOracles` 是按业务规格**独立重写**的第二套不变量，不复用 `invariants.js` 的实现；
   两边必须对同一批变异同时报红（`lifecycle-fuzz-test.js` §4 就是这条的自证）。把 invariant 改松，oracle 会红。
3. 每步强制检查「被拒命令逐字节零副作用」与「接受则 revision +1」——这是抓「半成功」的机器判据，不是抽查。

另：`w.dispatch` 默认把 `expectedRevision` 取当前值，测并发必须显式传 `{expectedRevision: base}`，
否则「并发」跑成了合法的顺序两次写，全绿而无意义（本轮自己就先错过一次，靠新增的失败读数抓到）。

**Run/preview is WeChat DevTools only.** Deploy: right-click `cloudfunctions/trailApi` → 上传并部署：云端安装依赖；或用 `cli cloud functions deploy --e <env> --n <fn> --r`（CLI 部署不继承控制台超时配置，部署后要把超时改回 20 秒）.
**只有装了开发者工具的那台机器能跑 UI/E2E**：当前 Windows 机可以（`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`，服务端口 33278，自动化端口 9420）；Mac 那台没有装，静态门禁是那里唯一的自动闸门。

---

## 直连微信开发者工具：agent 端到端实现/测试闭环

**这是本仓库唯一能看见「像素长什么样」的手段。** 静态门禁与单元测试都做不到这件事：
它们能证明代码跑得通、图元合法，但证明不了**图真的画对了、slot 真的显示了、颜色真的没糊**。

### 能抓到哪类 bug（本轮实证）

P4 的 5 个真机 bug 里，**只有 1 个是逻辑正确性问题，其余 4 个静态检查与纯逻辑测试全部测不到**：

| bug | 为什么测不到 |
|---|---|
| `marks[node.t]` 永远查不到（整点槽 vs 节点时间） | fixture 恰好全用整点，**取值掩盖了契约错误** |
| 具名 slot 内容被静默丢弃（缺 `multipleSlots: true`） | 数据在组件 `data` 里好好的，纯逻辑测试断言的是 data 不是渲染 |
| `L.textWidth is not a function`（漏导出） | 藏在 `drawRefs`，且被前一个 bug 掩盖成永不执行的分支 |
| 播放头撑大时间轴致关留宿收不回 | 纯行为组合，只有真机能点出来 |
| 读取数 slot 需 `options: { multipleSlots: true }` | 组件 data 正常，页面上就是空的 |

规律：**凡是「数据对、渲染不对」的问题，逻辑测试天然测不到。** 而这正是小程序最常见的一类。

### 一次性前置（人工，每台机器一次）

两件事都**无法用命令行完成**，必须人做一次：

1. **开服务端口**：微信开发者工具 → 设置 → 安全设置 → **服务端口 开启**，记下端口号（我们用 33278）。
   未开启时所有 `cli` 命令报 `IDE service port disabled`，且**管道喂 `y` 无效**（需要真实交互 stdin）。
2. **扫码登录**：`cli islogin` 返回 `{"login":true}` 才算好。账号需有 `appid` 的开发者权限。

> 服务端口页面上的 **CLI 访问令牌**留空即可——留空时 CLI 的 HTTP/WebSocket 不校验令牌。
> 本方案直连 WebSocket（`wsEndpoint`），走的就是这条不校验的路径。MCP 接口另开 Token 鉴权，与此无关。

### 每轮流程

```bash
# 1) 改完代码后**必须**重开项目，否则模拟器仍用旧 bundle（这是最容易误判「改了没生效」的地方）
# ⚠ 路径必须加单引号：Git Bash 会把未加引号的 D:\OurTrail 吃成 D:OurTrail（驱动器相对路径），
#   开发者工具照它注册一个新项目并写进 last_compiled，此后每次编译都报
#   「app.json: 在项目根目录未找到 app.json」——见 SYNC.md 2026-10-09。
cli close --project 'D:\OurTrail' --port 33278
cli open  --project 'D:\OurTrail' --port 33278
sleep 25
cli auto  --project 'D:\OurTrail' --auto-port 9421 --trust-project --port 33278
#    → 期望输出 {"autoPort": 942, ...}；AppID 会回显，确认是本项目的

# 2) 驱动库装在**仓库外**（本仓库零 npm 依赖是铁律，不能污染）
cd %LOCALAPPDATA%\Temp\opencode\mp-auto
npm.cmd init -y && npm.cmd install miniprogram-automator
#    PowerShell 下要用 npm.cmd：执行策略会拦 npm.ps1（PSSecurityException）
```

`cli.bat` 路径含中文，PowerShell 里务必用 `& 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat' ...` 调用。

### 驱动脚本骨架

现成模板：`docs/e2e-mp/drive.js`（复制到临时目录后 `npm i miniprogram-automator` 即可跑）。

```js
const automator = require('miniprogram-automator')
const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
const page = await mp.reLaunch('/pages/weather/weather')   // 返回值就是 page
await page.waitFor(4000)

await page.setData({ /* 合成数据，见下「数据从哪来」 */ })
await page.waitFor(3000)

await mp.pageScrollTo(1400)                                  // canvas 常在折叠线以下
const buf = Buffer.from(String(await mp.screenshot()), 'base64')   // ⚠ 见下
fs.writeFileSync(out, buf)

const st = await page.$('space-time')                        // 自定义组件用标签名直接选
console.log(await st.data())                                  // 读组件内部 data
const sc = await page.$('roam-scrubber')
await sc.callMethod('onChanging', { detail: { value: 570 } })  // 直接调组件方法驱动交互
await mp.disconnect()
```

### 踩过的坑（逐条都是实际浪费过时间的）

1. **`mp.screenshot()` 返回 base64 字符串，不是 Buffer。** 直接 `writeFileSync` 会得到「文本伪装的 png」，
   后续 `System.Drawing` 报 `OutOfMemoryException`、读图工具报「图片过大」。必须
   `Buffer.from(String(raw), 'base64')`。
2. **改完代码必须 `close` + `open`。** 只调 `auto` 不会重新编译，会让你以为修复没生效——
   本轮曾因此对着旧 bundle 排查了很久。
3. **`pages/weather` 的渲染门槛链**（`weather.wxml`）：`denied` → `elif loading` → `else` 内
   `wx:if loadingWeather`（**只出「正在查询天气」面板**）→ `wx:elif dayCards.length`（**图表在这里**）。
   注入数据必须 `denied=''`、`loading=false`、`loadingWeather=false` 且 `dayCards` 非空，
   否则元素根本不在 DOM 里，`page.$('space-time')` 返回 null。
4. **`page.$()` 在滚动后可能拿不到元素**，重新取一次 `page` 句柄再试。
5. **PowerShell 5.1 改 UTF-8 源文件会毁文件**：`Get-Content`/`Set-Content` 默认按 ANSI 读写，
   中文与全角引号全变乱码。本轮因此重建过一个测试文件。**改仓库文件一律用编辑工具。**
6. **中文路径在 `cd` + 相对路径下会失败**，`cd D:\OurTrail` 在工具 shell 里不生效，要用 `workdir` 参数。
7. **抓测试输出用 `cmd /c "node x.js > %TEMP%\o.txt 2>&1"`**，再用 Node 按 utf-8 读文件筛 `✗`；
   PowerShell 的 `2>&1 |` 会把中文与 `✗` 搅乱。
8. `npm` 脚本在 `Start-Job` 里跑没有交互 stdin，`cli` 的交互式确认喂不进去。

### 数据从哪来

云函数未部署时页面取不到真实天气，**用 `page.setData` 注入合成数据**。
这不影响验证目的：**渲染路径（canvas draw / 图层顺序 / 配色 / 文字 / slot / 布局）跑的是仓库里的真实代码，
只有数据来源是合成的** —— 而那正是纯逻辑测试覆盖不到的部分。

注入时注意 `spaceNodes` 形态：`[{ t:'HH:mm', d:'YYYY-MM-DD', alt, name }]`
（`km` 不要传，GPX 路线点没这个字段，见 P4 设计文档 §10.3）。

### 与执行级测试的分工

| 手段 | 覆盖 | 何时用 |
|---|---|---|
| 纯逻辑测试 | 函数契约、阈值、边界 | 每次改动都跑 |
| `space-time-draw-test`（记录式 2D 上下文） | **真的执行 `draw()`**，断言图层顺序 / dpr / 色值 / 无 NaN 坐标 | 改 canvas 绘制时 |
| **真机（本节）** | 像素、slot 是否显示、实际布局、文字是否折行 | 改 WXML/WXSS/组件结构时 |

`space-time-draw-test.js` 是前两者之间的中间档：它不需要 DevTools，能进 CI，但**看不见 slot 与像素**。
本轮 `multipleSlots` 那个 bug 就是它放过的。

---


1. **`options` may appear exactly ONCE per `Component()`.** A second same-named key silently overwrites the first, dropping `styleIsolation: 'apply-shared'` and scattering every global class. Guard comments live at the top of `components/form-field/form-field.js` and `components/overlay/overlay.js`; the bug itself was fixed in `daa0508`.
2. **Every `utils/*.js` function must be added to `module.exports`.** A missing export made all 27 `dispatchAndSync` call sites `undefined` — invisible because the user had never completed a server submit (`598db98`). Audit cross-file API surfaces **with a script, not by eye**.
3. **Every component used in a page must be registered in that page's `usingComponents`.** `editor.json` omitted `overlay`; every GPX result `setData` landed in a component that never loaded, so the symptom was literally 「点击无反应」 (`924d2b4`). **Both directions are now enforced** — `check.js` step 5 fails on a registration pointing at a missing component, and step 5b fails on a tag used without registration.
4. **`node --check` passing means nothing about runtime.** It cannot catch undefined identifiers — a detail page once shipped where `primary is not defined` and had never rendered once in the field. That is why `check-handlers.js` exists.
5. **Never read `this.data` for a value you are setting in the same `setData`.** Move dependent work into the `setData` callback. Caused a first-screen date race (`aafe4a9`).
6. **A `type="2d"` canvas captures its layer offset at `node.width` assignment time and does not follow later reflow.** Re-measure after async layout settles, or the chart floats over body text (`b6c2439`; `meteogram.js` `scheduleSync` measures at 100 ms and 320 ms).
7. **Cloud-function edits require redeploying `trailApi`.** `config.json`'s `timeout: 20` (vs the 3 s default) also only takes effect on redeploy — the console value is the sole authority. This is a recurring time sink.
8. **The cloud function cannot `require` from `miniprogram/`.** `gcjToWgs` is deliberately duplicated in `cloudfunctions/trailApi/lib/weather.js` and `miniprogram/utils/gpx.js` — change both. `tools/weather-page-test.js` cross-checks them.
9. **Schema is strict: no extra keys, no coercion.** A new field must be added to *every* duplicate spec or the whole dataset fails validation, and must be declared optional to keep already-stored data valid (ADR-0003).
10. **Coordinates: Open-Meteo wants WGS-84, the DB and `map` want GCJ-02.** Convert at the cloud-function boundary, never in the page.
11. **Do not mirror page logic inside a test.** `SYNC.md:162` records a test that was backing a stale contract because it re-implemented the page's builder. Extract to a module instead — that is exactly why `components/meteogram/layout.js` exists.
12. **Copy must use probabilistic language** for anything weather-derived (「有…的可能」/「概率较大」); assertion-style promises (「会有云海」) are forbidden. No rescue/insurance promises anywhere.
13. **WXSS has no `color-mix()`, no `:root` (use `page`), and no reliable `dvh`.** All mixed colors are pre-budgeted literals. **WXS regex must use `getRegExp()`** — literals are unsupported.
14. **Components cannot see `app.wxss` unless they opt in** with `options: { styleIsolation: 'apply-shared' }`. Symptom: `var(--forest)` resolves inside the component but `.card` has no styles. `custom-tab-bar/index.wxss` must be fully self-contained.
15. **A closed overlay must not hit-test** — `opacity: 0` still eats every page click. Use the exact `pointer-events: none; visibility: hidden` + delayed-transition block in `platform-pitfalls.md` §4.
16. **Seat grid is 4 seats + 1 aisle per row.** Seat width `calc((100% - 48px) / 4)`, aisle a fixed `flex: 0 0 16px`. A `25%` width once made the aisle consume a seat slot and misalign the row.
17. **Never put `WXSS` literals in a component** — use `app.wxss` tokens via `var()`. `app.wxss` is the only place a new semantic color may be introduced, and it must be registered in `design-system.md` too. **「禁止发明新色值」**
18. **Do not trust English marker comments.** This repo writes its rules in Chinese. Grep `禁止|不要|务必|坑|注意|严禁` — `DO NOT`/`NEVER`/`DEPRECATED` return almost nothing. The highest-signal rules are inline comments at the top of the file that owns the bug.
19. **Never infer a domain state from a display label.** 出行方式只有一个来源：`Signup.trip.mode` → `permissions.js` 的义务谓词（`isVehicleTraveller` / `needsVehicleService` / `needsSeatAssignment` / `needsOutboundBoarding` / `needsReturnBoarding`）→ `selectors.rowView` 的 `tripMode` + 派生布尔 → UI 读这些布尔。UI/WXML 里出现 `pickup === '自行前往'`、或域内再写一遍 `trip.mode === 'shared' && !driver`，就是复发点（`SYNC.md` 2026-10-08 记的 D2/D3/D4）。文案在 `utils/format.js` 定义一次（`TRIP_MODE_LABELS` / `TRIP_MODE_OPTIONS` / `RETURN_PLAN_LABELS`），并且**只允许向下**：domain → projection → label，反向一律禁止。`self` 永远不需要车辆/座位/上车点/boarding；`shared` 的全部既有约束一个都不许放松（不要为了 self 去放宽 invariant，也不要加 `noVehicle`/`skipVehicle`/`skipDriver` 这类 Activity 级开关）。
20. **整库 invariant 有一条锁库风险**：`assertInvariants` 校验的是整个 State，任何「线上历史数据可能已经长成那样」的规则写进这里，都会让**此后全库每一次写入**一起被拒（本项目无迁移/回填脚本，`ensureCollections` 也不是迁移）。判据：只有「任何历史数据都不可能违反」的约束才放进 `invariants.js`；可能已有脏形态的，改在**写入端各拦一次** + 放进 `tools/lifecycle-harness.js` 的 `checkOracles` 看守新数据。`activity.delete` 的 positions 级联（F3）就是这个形态的活教材。另：`vehicle.depart` 与「本车参与者司机记为未出发」这类矛盾属 F1，本轮按此原则处理，没有写进 invariants。
21. **元素数量不是 UI 证据。** `tools/e2e-ui-test.js` 曾拿「面板里有没有 `.list-row`」证明「分车弹层渲染出来了」，而 `.list-row` 同时存在于面板正文的车辆卡与同行组列表——弹层根本没开时也记 PASS（2026-10-08 实测 `planOpen=false` 仍 ✓）。UI 判据必须来自**那个对象的那个状态读数**（`planOpen` / `planChanged.length` / 点击前的 `busy`），不是同名的泛指元素。同理：`bindtap="{{cond ? '' : 'onX'}}"` 的按钮在 `cond` 为真时是「样式正常、文案正确、点了没反应」，tap 返回成功也不代表任何事情。
22. **状态与「下一步」只有一个翻译层：`miniprogram/utils/journey.js`。** 三条可机器校验的界线，由 `tools/journey-graph-test.js` 常驻守着（不是靠自觉）：① **WXML 不比较服务端枚举原文**——`wx:if="{{phase === 'draft'}}"` / `{{transitionNext === 'cancelled' ? 'danger' : …}}` 一律改成 JS 或投影算好的布尔（`isDraft` / `transitionDanger` / `showPositions`），模板只认布尔与插值；② **受管中文状态词只出现在 `format.js` 与 `journey.js`**——页面 JS 里再打一份 `'待签到'` / `'草稿'` / `'自行前往'` 就是第二次定义，`roster-panel` 的旧 `STATUS_OPTIONS`（「候补」vs 标签表「候补中」）与 workspace 的 `SUBTITLES` 都是这么烂掉的；③ **页面图必须闭合**——每一页要么 tabBar/有跳进来的路由，要么登记进 `DEV_ONLY` 并写明为什么（`lab` / `cloud-field-poc`），登记页还得自声明内部身份、且不许出现在用户页里。同一门还查「有入口没返回路径」与「denied 态一屏红字没有出路」（`vehicle` / `signup` / `workspace` / `lab` / `privacy` 本轮各中一次）。方向仍然只允许 domain → projection → label（见铁律 19）。
23. **落库会重排数组：任何「保留最近 N 条」都必须按时间字段判，不许按数组位置判。** `store.loadCollection` 以 `orderBy('_id','asc')` 回读，所以进程内那条"push 序＝时间序"的数组**只活在当前这次请求里**，下一次请求拿到的是文档键的字典序。`receipts` 的键是 `actorId + '__' + requestId`（`store.js:27`），openid 是随机串，键序与写入时间毫无关系。`pruneReceipts` 原来写 `slice(len-600)`：纯 domain 套件（smoke / lifecycle-*，同进程连写）永远全绿，而真实 store 往返下会砍掉「openid 字典序最靠前那个人」的最新回执——回执是唯一的幂等记忆，被砍掉的人重发同一条命令＝第二次执行（实测复现：多出一场活动）。现在三处上限（receipts 600 / events 800 / notices 800）统一走 `commands.js` 的 `pruneRecent(list, limit, keyOf, atOf)`，按 `appliedAt`/`occurredAt`/`publishedAt` 留最近、并列按文档键定序。判据 `tools/receipt-window-test.js`。**通用推论**：凡"截断 / 取最后一条 / 依赖数组顺序"的逻辑，必须在真实 store 往返之后测；纯内存断言证明不了顺序语义。
24. **未捕获异常不许冒充业务错误。** `exports.main` 只把 `ERROR_CODES` 内的已知码原样回给客户端，其余归类 `INTERNAL`：英文原文与堆栈只进单行结构化日志（`ev/a/c/rid/u/ok/code/ms/rp/rev/det`；`u` 是 openid 的 sha256 前 8 位——**不落 openid 原文、不落 payload 内容**）。话术按读/写分岔：对读请求说「本次修改没有生效」是凭空承诺一件没发生的事。新增错误码必须**同时**进 `contracts.js` 的 `ERROR_CODES` 与 `journey.js` 的 `CODE_TITLES`，否则「每个错误码都有人话」那条门会静默跳过它（`NO_REVISION` 就这么漏过一次）。客户端写失败分两语义：`needRefresh`（CONFLICT＝别人改了→重读）与 `outcomeUnknown`（传输层失败＝**结果未知**，事务可能已提交→重读对齐，**绝不自动重发**）。判据 `tools/failure-semantics-test.js`。
25. **显示窗不是判读范围；外扩圈怎么填决定等值线能不能闭合。** Weather V2 审计（2026-10-09）三条教训：① `cloud-field-svg.buildGrid` 的外扩圈原本**复制边缘值**，于是被时间/高度窗切断的云带在网格内永远找不到降到阈值以下的位置 ⇒ 等值环闭不上；旧代码事后用「开链按全局 mean-y 两两配对 + SVG 的 `Z` 首尾直连」硬凑，真实三地点剖面上量出 **49 条断链 / 71 个自交环（`fill-rule: evenodd` 把真云区挖成洞）/ 55 条 >30 px 直线斜边（最长 371 px，横贯整图）/ 1 次把 x 重叠仅 2% 的两层云连成 12688 px² 假云块**。现在外扩圈填 0（域外=无云，闭合发生在 `clipPath` 外一格，视觉仍是贴边出血），交叉点按**网格边身份**（`h{j}_{i}`/`v{j}_{i}`）链接 ⇒ 度数恒 2、没有「任取一条未用线段」的岔口；鞍点按 cell 中心值定方向；碎片过滤只看面积且下限随 cell 缩放。② 判读（`inferState`/`denseSpanAt`/`peakCover`）扫的是**实测数据范围**，不是剖面显示窗 2000–6000 m；真机读数对照：峨眉山 24h 第 10 时云底修复前报 2,000 m（恰为窗下界＝被裁掉），修复后报 1,686 m（实测）。③ 海拔的主语只能是**此点**——全仓库没有 `wx.getLocation`，所以 `你 · 3,500 m`、`穿过你的海拔` 都是无据断言；出处判定收进 `format.resolveElev` 单源，模型来源必须追加「（模型估算）」，`ELEV_SOURCE_LABELS` 只允许定义一次。**负结果记录**：为防跨大层间隙内插造云，加过一条「间隙 >600 m 取两侧较小值」的保守规则，但三地点 24 h 全量实测最大层间隙只有 489 m（生产永不触发），而 `min()` 兜底会把两侧差异大的真实厚云带抹成无云（`weather-page-test` 当场 5 红）——已回退，别再请回来。判据 `tools/cloud-field-geometry-test.js`（190：按业务规格写期望拓扑 + 「图与数据的点格一致率」+ 变异自证）、`tools/elevation-semantics-test.js`（34）。真机前后 30 张在 `docs/weather-ux/qa/v2-audit-2026-10-09/`，报告 `docs/weather-ux/weather-v2-final-visual-audit.md`。
26. **单一位置词不是全部事实；缺失输入必须失败关闭。** 云层位置三态（2026-10-09 审计续轮，报告 §九）五条界线：
   ① 判定住在模型层 `cloud-field-svg.inferState`，中文住在 `format.CLOUD_POSITION_LABELS` / `CLOUD_POSITION_REASONS`（单源），页面只搬运 `basis`，不得再分类、不得再自造状态词；
   ② 三个确定态（`in`/`ok`/`mid`）之外必须有名有姓地「判不出」——`no-altitude` / `no-data` / `within-uncertainty` / `both-sides` / `partial-at-point`，
      并与 `clear`（**判过了**才是晴空）严格分开。「无法判断」写成「晴空」就是凭空造否定事实；
   ③ `key` 只是给读数行的**单一**位置结论，`holds` 才是「哪几侧真的有浓云带」的多侧事实——下游必读 `holds`：
      `detectCloudSea` 的必要条件与 `skyBlocked` 的夜间天空闸都栽过，把 both-sides 压成一个词会当场抹掉云海窗口（`outdoor-cloud-sea` 2 红），
      只读 key 的夜闸会让「头顶 100% 云」的那一夜照样出银河卡（正是铁律 24/§三 要防的乐观取值）；
   ④ 海拔出处 → 判定基准只有一个分类点（`format.resolveElev` 的 `basis`）：可信高程 tol=0（判据与旧实现**逐字一致**），
      Open-Meteo 地形高度按 ±600 m 误差带，带内一律不判方向，两者都没有 ⇒ 不判。
      **不要替 GPX/地图选点/手填编一个误差带**——项目对这些来源没有可量化误差资料，宁可如实记录边界；
   ⑤ 缺 `covered` 现在失败关闭为 `no-data`（旧实现退回显示窗 2000–6000 m 冒充实测范围）。主语永远是**此点**而不是「你」（全仓库没有 `wx.getLocation`，见铁律 25③）。
   判据 `tools/cloud-position-test.js`（54）＋ `tools/weather-page-test.js` §11b/§12（真页面 `r3`、逐节点各用自己的高程判读、无高程不画参考线）；
   真机前后 42 张（21 个场景 × full+tap）在 `docs/weather-ux/qa/v2-cloud-position-2026-10-09/`。
27. **显示窗属于显示层，绝不能变成判读的输入；裁切必须自己说出来。** Weather V2 第三轮（2026-10-09，报告 §十）四条：
   ① `ALT0/ALT1` 曾同时当三件事用——等值带网格与裁切范围、「这张图画哪一段」、OI `cloudLayersAt` 的扫描范围。
      固定窗 2000–6000 让「云整扇在窗外」与「确认晴空」画出**同一个 0 环 / 0 px² 的空行**（`ab-window.json` 拿 HEAD 版对拍实测），
      这就是「剖面空白被读成没有云层」的根因；② 现在窗由 `cloud-field-svg.planProfile()` 决定
      （锚点 = 实测包络内 ≥25% 的云段逐小时并集 ∪ 查询点：可信高程按真实值、模型估算按 ±600m **区间**、无高程不参与；
      候选窗先比云带墨量、同分才看是否框住点；跨度 1,500–4,000m、边界向内量化 250m），
      **判读只吃 `covered` 与 SCAN_MIN..SCAN_MAX**；这条界线由常驻门钉住：
      把 `PROFILE.MAX_SPAN/PAD_M/DECK_MIN` 改到极端 ⇒ 窗必须变（门不空转），而判读与 OI 条件态/机会窗口逐项不变；
   ③ 空白必须有名有姓，且**旗标不许复用**：`clippedAbove/clippedBelow`（云带被窗裁掉）与 `pointOutside(+Delta)`（点在窗外）
      是两件事，第一版把两者并成一个旗标，边注就会说「窗外下方还有云带」而窗外其实没有云；晴空再单独一句。
      图例必须三分支（窗内 / 点在窗外 / **根本没有高程**）——把「无高程」走成「点在窗外」就重新造出
      「此点在剖面下方 null m」，本轮真机就是这么抓到的（静态与 Node 判据都只覆盖了有高程的主干）；
   ④ 引用不存在的 `clip-path` 是静默地雷：生产云行写着 `url(#cfclipu)` 而**全文件从未定义**，Skia 当不裁切画了出来，
      严格 SVG 实现则「引用不存在 ⇒ 整组不渲染」。裁切现在真的有定义，且有门要求「定义先于引用」。
   判据：`tools/cloud-field-geometry-test.js` §14、`tools/meteogram-readability-test.js` §8、
   `tools/cloud-position-test.js` §8、`tools/weather-page-test.js` §11b-F/H。
   **OI `cloudLayersAt` 仍扫固定 2000–6000**（真实 24h 里 2–3 小时存在被挡掉的 ≥80% 云层）——
   改它会动天象成立条件，本轮按边界未动，是下一轮的第一件事。（2026-10-09 R2 只补了边界标记与诚实文案，
   扫描范围本身仍未动，那属 R1；见 28。）

28. **扫描窗边界不是云界；阈值口径必须能追溯到样本。** Weather V2 第四轮（2026-10-09 R2，
   报告 `docs/weather-ux/qa/v2-oi-scan-r2-2026-10-09/README.md`）五条界线：
   ① 层被扫描窗切到时，**窗边界不得写成云底/云顶**。做法是只加来源布尔
   （`cloudLayersAt` 的 `baseBoundary` = 第一个采样点就已 ≥80%、`topBoundary` = 开放段以 `ALT1` 收尾），
   `run.top = CFF.ALT1` 这类旧表达式**原值保留**，由证据端分四支说话（两端实测 / 只切下界 / 只切上界 / 贯穿整窗），
   被切时层厚那句必须写明「按窗内可见部分计算，是下限值」，净空那句在 `topBoundary` 时追加「此为上限」。
   ② 「只改文案、不动判据」这句话本身必须是**可证的**：跨版本 A/B（`git archive` 取旧 utils 到仓库外，
   两份模块实例喂同一输入逐字段比）＋ 测试内把窗口时刻/置信度/强度/层数值**钉成实测值** ＋ 单案例直证。
   只在同一进程里跑新代码然后宣布"通过"，证明的是它能跑，不是它没变。
   ③ 呈现层若靠**文案的字面次序**取摘要（`oi-presentation.summaryOf` 只找 `云区`/`云层位于`，找不到退回
   `evidence[0]`），那么改证据文案就等于改接口：要么加显式字段，要么把这条次序依赖钉成判据
   （本轮选了后者，并配变异 M9 证明这条判据真的会红）。同理，净空 = `userAltitude − layer.top`，
   旧文案写「高于云层底部」是反的——**证据句的主语与宾语也是正确性**。
   ④ 阈值注释里的统计口径是**主张，不是事实**。`LAYER_THICKNESS_MIN: 300 // 真实分布 P50=300m（4 地点 × 48h）`
   的样本与脚本从未入库（`git log -S` 全库只命中引入它的那一个提交），现有真实快照上 300 m 落在 **P25**
   （实测 P50 = 867/769 m），且**换扫描口径分布就会动**（固定窗 158 层 ↔ 包络 169 层）。
   复现不出来的口径一律写「无法从现有仓库确认」，**不得**据此自行改数，也不得把推测写成既定事实；
   R1 的实施前置门＝口径归属先定 + 云海高度下界先给数。
   ⑤ 影子运行（内存里临时改常量做对照）必须改**被测模块自己 require 到的那一份实例**。
   `CFF.ALT0/ALT1` 是 `module.exports` 里的快照值，旧版本树有独立的 `cloud-field-svg`：
   只改本脚本顶层的 `CFF` 会让旧版本的"包络扫描"静默退化成固定窗扫描，比出一个**假差异**。
   所以影子对照必须自带有效性门（证明宽扫描真的扫到了窗外的云层），否则"两侧都一样"会被读成比过了。
   判据：`tools/outdoor-cloud-sea-test.js` R2 段 11 条（20→31）、`tools/outdoor-intelligence-test.js`（24→25）、
   变异自证 `docs/weather-ux/qa/v2-oi-scan-r2-2026-10-09/tools/mutate-r2.js`（9 条 0 漏网）。

29. **审计探针必须先与生产实现做等价性对照，才有资格用来纠正结论。** Weather V2 第五/六轮
   （2026-10-09/10-10，报告 `qa/v2-r1-gates-audit-2026-10-09/`、`qa/v2-q56-noise-audit-2026-10-10/`，
   两轮生产文件改动数 **0**）用一条完整的翻案链换来这条：
   ① 审计里"独立重写一遍规则"（不复用被测实现）是必要的，但**重写必须逐条对齐**——
   第五轮的 `g2-grid-phase.js` / `g2-height-basis.js` 漏了 `cloudLayersAt` 的**退出点插值**
   （`outdoor-intelligence.js:120–123`），云顶被系统性低估 20–50 m，于是量出"0.6–0.9% 小时因扫描相位翻转"
   和"峨眉山 10-09 02:00 云顶 2,800 vs 2,811、净空 204→193"——**这两条都不存在**：生产规则下该小时云顶恒为 2,828、
   净空恒为 176、本来就不是候选，**候选级相位翻转实测 0 / 888 小时**。
   ② 更糟的是，这个不等价的探针**否掉了一条本来正确的推测**：相对带上界夹在点海拔会
   制造 `[3003,3004]` 厚 1 m 的假层，`below[below.length-1]` 按 base 排序取到它、净空 0 ⇒ 拒，
   **把真正厚 560 m 的候选层屏蔽掉**（峨眉山 10-10 09:00 实测）。
   ③ 所以规矩是：**任何用来推翻既有结论的探针，必须先跑一次"同输入下探针 vs 生产实现"的逐字段对照**
   （`qa/v2-q56-noise-audit-2026-10-10/tools/fidelity-probe.js` 就是这个用途），差异为 0 才有资格纠正；
   被推翻的原文**只加前向指针、不删**，让读者看得见翻案链。
   ④ 顺带两条被实测否证的方法学断言，别再重犯：「50 m 步长有离散化误差」——对 1 m 参照偏差**恰为 0**
   （分段线性云场上两端线性插值找阈值交点是精确的）；「某口径让某地没结论」这种句式
   **必须先测逐时条件态分布**，不能从扫描带的位置反推（理塘/稻城那周是**没天气**，不是被挡住）。
   ⑤ 敏感性分析 ≠ 概率 ≠ 置信度：Q5 的 ±600 m 摆动只回答"输入挪一下会怎样"；
   且 `ALT_TOL.measured = 0` 是**断言不是测量**（`cloud-field-svg.js:276–277` 自陈 GPX/选点/手填无误差资料），
   所以"候选净空余量 9–424 m"是**该问什么**的证据，不是"缓冲取多少"的答案。

30. **分层边界要钉行为，不许钉源码文本。** Weather V2 第七轮（三层架构首个纵向切片，
   ADR `docs/weather-ux/architecture/weather-v2-three-layer-evolution.md`）：
   `cloud-position-test` 原来用正则匹配 `outdoor-intelligence.js` 的**源码**来钉
   "业务扫描范围仍等于显示窗常量"（找 `for (let alt = CFF\.ALT0; alt <= CFF\.ALT1; alt \+= step)`）。
   把层提取搬到 `cloud-layer-facts.js` 后这条门立刻报红 —— **它把"搬家"误判成"改判据"**，
   而它声称保护的行为其实一点没变。规矩：
   ① 静态源码门只能证明"代码长什么样"，一旦合法重构就会假红，久了就会被当成噪音忽略 —— 那比没有门更糟；
   ② 边界要写成**可执行的行为断言**：缺省扫描范围仍等于固定基准且**自报来源**
      （`resolveRanges().scan.source === 'display-window'`）、把 `PROFILE.MAX_SPAN/PAD_M/DECK_MIN`
      改到极端 ⇒ 业务扫描范围一个数都不动、机会层源码不出现 `profile|planProfile|PROFILE`
      （最后这条是**允许**的，因为它查的是"不该存在的依赖"，重构不会让它假红）；
   ③ 留接缝就要**把接缝测活**：`ctx.cloudSeaScan.scanRange` 若只测缺省值，等于没留接口 ——
      注入用例的做法是"只把扫描下沿从 2,000 降到 1,100 ⇒ 同一份数据的截断消失、证据改口为实测云底"，
      顺带证明"边界"是范围给的而不是云给的；
   ④ 对拍器自身必须有牙齿：`architecture/tools/mutate-ab.js` 注入 8 条业务级变异要求每次都报出差异，
      其中 V5（去掉退出点插值）正是上一轮 Q6 犯错的那一处 —— 同样的错在今天会被当场抓住。
   判据：`tools/cloud-layer-facts-test.js`（37）、`tools/cloud-position-test.js` §8（60→62）。

31. **同值判据先问语义再谈合并；"只有一个出处"必须是可测的行为，不是常量名。**
   Weather V2 第八轮（切片二，2026-10-10，ADR `docs/weather-ux/architecture/weather-v2-three-layer-slice-2.md`）：
   ① `h.band.cover >= 80` 在客户端出现过三次（`sky.hourMarks` 的 cloudSea、`sky.cloudSeaConclusion` 的成层筛选、
      `conditions.factsFor('cloudSea')` 的证据行），它们**都不是判定**——云函数 `cloudBandAt` 早就保证
      「有 band ⇒ cover ≥80」，所以下游那句是对上游事实的**同义反复**。这种重复**不能删**（旧缓存/历史形态里
      可能有 cover<80 的 band，删掉就把不该算成层的带印了出来），只能**命名 + 单源**：`cloud-layer-facts.isCloudBand`，
      表达式逐字同形（不加 `Number.isFinite`，那会改变 undefined 分支的判法）。
   ② 数字相同 ≠ 语义相同，**不许强行合并**：剖面成层的 `FIELD_LAYER_COVER_MIN`（连续剖面、50 m 步长、进出点插值、多层、带边界来源）
      与 provider 成带的 `CLOUD_BAND_COVER_MIN`（离散气压层**合并成单条**、无厚度概念）是两件事；
      `confidenceOf(run.peak, 80)` 又是第三件事（云量峰值的置信分档）。三者各留一名，源码就地写明为什么不合并；
      拿前者替后者会**改变印出来的米数**——那是业务变化，不属本轮。
   ③ "单源"要能被影子改写：阈值放进**导出的对象**、消费方按引用读（`CLF.LAYER_LIMITS.X`），
      把 80 改成 85 ⇒ sky 标记 / 云海结论文案里那个数字 / factsFor 证据行 / OI 云海窗口必须一起动
      （`cloud-layer-facts-test §7`，配"还原后逐项相同"的对照，防止两个零恰好对上）。
      写成 `const` + 快照赋值 ⇒ 影子改了不跟着动 ⇒ 门是假的（切片一 `module.exports` 快照那个坑的延续）。
      `CLOUD_SEA.LAYER_COVER_MIN` 因此改成 **getter**，不是字面量。
   ④ **按文案字面挑摘要 = 文案即接口。** 旧 `oi-presentation.summaryOf` 用
      `fact.indexOf('云区')/indexOf('云层位于')` 挑"这张卡的一句话依据"，找不到退回 `evidence[0]`；
      R2 改措辞时选中的是哪一行纯粹是副作用。审计事实：`pick` 在**所有生产路径**上恒等于 `evidence[0]`
      ——那个 find() 从未真正选过东西，它只是随时会因为改中文而改变选择结果。
      现在每条证据在**产生处**带 `kind`（`utils/evidence-kind.js`，封闭词表），
      优先序 `SUMMARY_KIND_PRIORITY` 只声明在呈现层一处，且「摘要」与「看图」锚点统一读
      `primaryEvidence(w)`（旧实现两处读法不同，一旦分叉，卡片文字与高亮小时就不是同一件事）。
   ⑤ **账本搬迁会把旧对拍器骗出假红**：`ab-slice.js` 直接比 `meta.cloudSea.rejected`，
      切片二把**窗口级**拒绝（`LOW_PERSISTENCE` / `NOT_VISIBLE`）挪进 `noWindow` 后它报了 2 组"业务差异"。
      判据要比**具名拒绝的全集**（rejected ++ noWindow），不是比它放在哪个数组里——同 30 的教训换个形态。
      三态必须各有各的账：`notEvaluated`（没评估：判不成立或判不出）/ `rejected stage='hour'`（评估后拒绝）/
      `noWindow stage='window'`（评估通过但没成窗）。混账时 `candidates+rejected+notEvaluated===小时数`
      在有窗口级拒绝的那天就不成立（实测 4 组 前=false/后=true）。
   ⑥ 自证脚本自己也会假绿：跨行锚点在 CRLF 文件里命中 0 次（等于没注入）。变异注入必须要求
      **锚点命中恰为 1 次**，且先跑"未变异副本全绿"的有效性门（`architecture/tools/mutate-slice2.js`，9 条 0 漏网）。
   已知残留（如实登记，不当已完成）：`components/meteogram/meteogram.js:472/:503` 还有两处显示层的 `cover >= 80`，
   本轮未收——它属于 canvas 绘制路径，改动需要真机证据，而本轮真机是 UNVERIFIED。
   判据：`tools/cloud-layer-facts-test.js` §7（37→45）、`tools/outdoor-intelligence-test.js`（25→35）、
   `tools/outdoor-cloud-sea-test.js`（31→32）；对拍 `architecture/tools/ab-slice2.js`
   （123 组：业务 0 / **用户可见 0** / 附加字段 0）。

32. **有利信号不能由"遮光物"本身充当；判"漏网"之前先确认变异体真的不等价。**
   Weather V2 第九轮（彩虹遮光闸，2026-10-10，报告 `docs/weather-ux/qa/v2-rainbow-gate-2026-10-10/README.md`）：
   ① 缺陷本体：`sky.hourMarks` 的彩虹"水分"信号里写着 `c.low >= 70` —— 把**满天低云**当成有水分，
      而低云恰恰是遮住太阳的东西；彩虹打分只有 `40 + 湿小时≥2 → 30`，于是全天 100% 云、一滴雨没下
      照样 70 分「条件较好 ★★★★」（真实快照上峨眉山 7 天里 6 天给 100 分）。
      **同一份云量数据，光染（alpenglow）判 0 分并明说"云量不足"** —— 两个现象互相矛盾就是最省事的自查信号。
   ② 修法不许新造阈值：加"太阳照得出来"闸，两个数都从本文件已有口径里取
      （`c.low < 40` ← 光染那句「低云少（光能到山体）」；`(mid+high)/2 < 30` ← 星空/银河的「暗夜晴空」口径）；
      水分只看真降水与高湿。方向性局限要写进文档：模型没有方向分辨能力，
      这道闸会用"漏报"换掉"误报"——这是取舍，不是免费修复。
   ③ **故意的业务变化不能拿"零差异"当验收**：`ab-rainbow.js` 同时要求
      非彩虹判据越界 = 0（其余五类结论的分数/档位、除 RAINBOW 外的机会窗口逐字相同）
      **且** 彩虹变化 > 0（为 0 说明这道闸在生产数据上从没生效 = 空改）；两种情况都 exit 1。
   ④ 变异自证双向都在用：R3「把闸改成只看低云」让第一版测试**全绿**（中高云遮日那一半没被测到）⇒ 补断言；
      而 R1「把 `low >= 70` 加回水分信号」也全绿 —— 那**不是漏网，是等价变异体**
      （`low >= 70` 与闸的 `low < 40` 互斥，加回去是死分支）。规矩：报"漏网"前先判断变异体在行为上
      是否真的不等价；把死分支抄回来不构成回归，反之把等价变异当牙齿也不构成证明。
   ⑤ 文案门是活的、会拦新写的句子：本轮新写的否定句里有「不会有」，被
      `weather-model-test` 的"不含断言式承诺"门当场拦下（铁律 12）⇒ 改成条件语言「这个条件不成立」。
      **否定式陈述同样要用概率/条件语气，绝对断言（哪怕断言的是"不会"）一律不许出现。**
   ⑥ **真机核验的三道门槛，缺一张就不算页面级证据**（本轮连犯三次，全留在
      `docs/weather-ux/qa/v2-rainbow-gate-2026-10-10/device/invalid/`）：
      (a) 注入载荷必须是**生产形状的全集**——只给 `series` 不给 `days` ⇒ `dayCards` 空 ⇒
          `weather.wxml:37` 的 `wx:elif="{{dayCards.length}}"` 不成立，整块内容不渲染，
          而 `page.data('condCards')` 读数完全正常（**data 读数不是像素证据**，铁律 21 换了主体）；
      (b) 少给 `cloudLevels` ⇒ `buildCloudFieldRange` 返回 null ⇒ `unified=null` ⇒ 页面回退经典
          canvas meteogram、OI 卡不出，截图看着就是"旧版本页面"。所以驱动要先断言
          `dayCards>0 / unified!=null / oiCard!=null / chartSeries 长度` 再截图；
      (c) 多用例必须**打穿缓存**：`weather.js:824` 的键是
          `updatedAt|date|elevation|lat2dp|width`，两个用例共用一个 `updatedAt` 就会让 B 复用 A 的
          云场图与 OI 卡（而结论卡每次重算 ⇒ 一半新一半旧，最难发现）。做法：每用例前 `reLaunch`
          （清 `_unified`/`_oiCache` 这类实例属性）+ 给不同 `updatedAt` + **污染自证**
          （两用例的 `unified`/OI 读数必须不同，相同就 `exit 1` 判整批截图无效）。
   判据：`tools/sky-test.js` 65→70（成对反例 + 中高云遮日 + 方位角整数度 + 六卡"N 度"读数不得带小数）、
   `tools/oi-claim-gate-test.js` 25→26（干燥 / 云开有雨 / 有雨但满天云 三例成对）、
   变异 `qa/v2-rainbow-gate-2026-10-10/tools/mutate-rainbow.js`（5 条 0 漏网，先过未变异全绿的有效性门）。

33. **「要不要出现」必须是显式字段，不得由分数顺带决定；弃权不算否定，减卡必须点名。**
    Weather V2 第十轮（天相沉默闸，2026-10-10，报告 `docs/weather-ux/qa/v2-silence-gate-2026-10-10/README.md`）：
    ① 缺陷本体不是判据错，而是**一个字段被当两件事用**：`score` 只回答"多有戏"，页面却由它顺带决定
       "露不露出来"，于是满云日挂着星空 ★★、银河 ★★★，银河卡还写着**「朝西南（约 231 度）找银心带」**——
       **把"不可能"包装成"可执行建议"**。低分卡照样有"往哪看"、照样有"为什么？▾"证据行，用户无从分辨。
    ② 三态而非两态：`VERDICT = {possible, excluded, unknown}`。**只有 `excluded` 沉默**。
       `unknown`（无可信海拔 / 没有暗夜小时）**必须仍出卡并说明缺什么** —— 这是铁律 26② 的反向：
       把弃权读成"不可能"而减卡，等于把"没数据"冒充"没有"。`isSilent()` 对缺字段**失败开放**（不沉默）。
       客观时刻（黄金/蓝调/日出日落）永远 `possible`：它是钟点，不是概率判断。
    ③ 每条沉默条件都必须能指回**本文件已有的一句判据**（光染"晨昏窗口内没有一小时低云少且无降水"、
       云海"此点不在带顶之上"与"整天没有 ≥80% 成层云带"、星空/银河"暗夜晴空 0%"、银河"不在银心季"、
       彩虹"没有任何一小时同时满足太阳照得出来 + 有水分"）。本轮**阈值改动数 0**：
       给已有分支起名字 ≠ 新增判据；反之"看着合理的新闸门"（如拿 `sunVisible` 去裁黄金时刻）会造出
       **假否定**——卷层云被判"遮死"，而它恰恰是日落好光的一部分。
    ④ **减卡不能长成"工具坏了"**：铁律 27③ 的主体从"图"换到"卡"——被沉默的项要在页面上点名
       （`buildCondSilent` + `weather.wxml:403` 一行说明），否则用户分不清"今天没戏"与"数据没取到"。
    ⑤ **看不见的证据不能决定看得见的结论**：被排除的云海卡手里还攥着分数（实测 64 ≥ 45 会进
       `overallGrade` 的 live 池），旧规则下页面上已经不出现的卡仍在替看得见的"徒步条件"投票。
       `conditions.js` 的候选集必须与可见卡集**同构**（晴空 90 + 被排除 64：旧 77，新 90）。
    ⑥ **故意的用户可见变化：对拍必须同时含"阳性对照"**。本轮第一版 40 场景减了 107 张卡、越界 0，
       看起来已经很硬，但前 11 组**每组都减卡**，没有"一张都不减"的场景 ⇒ 分不清是闸在判还是无条件减卡。
       现在 `ab-silence.js` 有三条 exit 1 的空改门：`silencedTotal===0` / `unknownKept===0` / `untouched===0`。
       分区闭合也要报：107 被沉默 + 93 仍出现 = 200 = 40×5，缺一条就是漏算。
    ⑦ 真机通道卡住时按 **ENV-ABORT** 记，不猜也不硬来：本轮 `islogin` 正常、33278 在听，但
       `cli open` 挂起 15 分钟、`cli auto`（9421/9422）从未让端口进入 LISTENING，进程表里没有第二个
       automator/node 会话可杀 ⇒ playbook §3 的下一步是 `cli quit` + 重开，**那会动共享的开发者工具会话，
       未经批准不执行**；批准后再 `quit` → `sleep 15` → `open --project 'D:\OurTrail'`（路径必须是注册表里
       的反斜杠形式）→ `sleep 30` → `auto`，拿到 `{"autoPort":9421}` 且端口 LISTENING 才算通道可用。
       驱动里的 bundle 新鲜度门可以**由文案自证**：本轮那行沉默文案只存在于新代码，屏幕上出现它即证明新 bundle。
    ⑧ **阳性对照在真机上最容易翻车，因为夹具是数据不是断言**：本轮 B 用例第一版只有 4 张卡，三个原因
       全在驱动自己：快照 `places` 的键是拼音 `emeishan`，写成中文 `'峨眉山'` 拿到 `undefined` ⇒
       **静默回落到第一个站点（成都 489 m）** ⇒ "此点不在 1,000 m 云带之上"被**正确地**判成 excluded；
       另两处是覆盖函数取了 `lvl.altitudes[0]`（应逐时取 `altitudes[i]`）与 `hourOf` 用 `slice(0,2)`
       读 `'2026-10-09T07:00'` 得到 `"20"`。规矩：注入夹具后必须先断言"这份夹具确实让各必要条件成立"
       （海拔 / 层高度 / 小时三者对齐）——**页面少显示一张卡，既可能是判据对，也可能是夹具错。**
    真机结果：**三用例 VERIFIED**（A 满云 → 0 卡 + 1 沉默行点名五项；B 五项有戏 → 5 卡 0 沉默行、
    银河「朝东南（约 157 度）找银心带」照旧；C 无高程 → 云海 ★★☆☆☆ 且自带"此点缺少可信海拔"），
    像素与 DOM 双读数（星级串取自 `el.text()`，不是 data 侧推断），证据在 `device/` 与 `device/readings.json`。
    判据：`tools/sky-test.js` 70→82（闭集门 + 满云五项全 excluded + **分数未动只改出现** + 晴空反向对照 +
    缺海拔 unknown vs 带内 excluded + 极昼 unknown + `isSilent` 失败开放）、
    `tools/weather-page-test.js` 177→189（§13 走**真页面** `buildCondCards`/`buildCondSilent`，不在测试里镜像页面逻辑）、
    `tools/weather-v2-test.js` 45→47；对拍 `qa/…/tools/ab-silence.js`（40 场景 / 可见字段逐字节差异 0 / 越界 0）、
    变异 `qa/…/tools/mutate-silence.js`（8 条 0 漏网；S5 首次是**注入失败**——偏移 +1 落在中文注释上，
    脚本计一条漏网并 exit 1，没有静默改错行充数）。

34. **"不删事实，只补一句"也要有牙齿；缺输入类断言必须让被查时刻真的落在夹具里。**
    Weather V2 第十一轮（摄影窗口事实后缀，2026-10-10，报告 `docs/weather-ux/qa/v2-photo-window-note-2026-10-10/README.md`）：
    ① 用户点名"蓝调、黄金也别放不可能"，但**客观时刻不是概率判断**：日出日落/黄金/蓝调是太阳高度角穿越点，
       删掉它们等于把行程规划要用的钟点藏了。正确形态是**时间一条不裁，只在 sub 上补一句当时的云**。
       "补一句"同样要有判据：非摄影窗口的任何条目任何字段变、`t/title/key/l2/window` 变、条目数变，全算越界。
    ② **上一轮的否定句要收回**：我写过"仓库里没有可追溯的『斜射暖光被挡住』口径"——不成立，
       口径一直在光染判据的注释里（「低云少（光能到山体）」= `low < 40`），是我把它和彩虹那道含中高云项的
       `sunVisible` 混成了一句。**"没有口径"这种话必须先 grep 自己的注释再讲**；被推翻的原文只加前向指针不删（铁律 29③）。
    ③ 新判据一律**命名 + 单源 + 影子可改**：`sky.LIGHT_LIMITS.LOW_CLOUD_MAX` 放进导出对象、三处按引用读
       （光染、彩虹前半句、日程后缀）；影子把 40 改到 95 ⇒ 光染标记变多、彩虹标记变多、后缀归零，
       三处一起动才算同一个数。同值不同义**不合并**：`(mid+high)/2 < 30`（天上有没有云）与 `low < 40`
       （光到不到地面）是两把尺（铁律 31②）。判据只看低云还有一个副作用是**不误伤卷层云**——
       全天 95% 中高云 + 低云 5% 那天 0 处后缀，而卷层云恰恰是日落最好光的一部分。
    ④ **后缀是"加"上去的**：原话一个字都不许被改写（断言盯前缀 `天空最蓝的十几分钟（`），
       措辞按窗口物理分岔（黄金说"暖光到不了山体"、蓝调说"只发灰不发蓝"），语气一律条件式（铁律 12）。
    ⑤ **缺读数不能混成有利事实**：`lowCloudAt` 只认 `typeof === 'number'`，因为 `Number(null) === 0`
       会把"这一小时没有云量"印成"低云 0%，光好"——那是凭空造有利证据，与把晴空冒充成云同等严重。
    ⑥ **缺输入类断言的夹具必须真的覆盖被查时刻**：P7（`Number(low)` 版）第一次**漏网**，不是判据弱，
       而是我的"缺读数"用例只铺了一行 `00:00`、却去查 `06:40` 的低云 ⇒ `lowCloudAt` 查无此小时直接返回 null，
       那条断言从未真正走到 null 分支（**假绿**）。铺满 24 小时的 `{low:null}` / `{}` 两份夹具后 P7 才会红。
       同理真机第一版的假红来自查 `.timeline-card`——那是 `wx:if="{{!unified}}"` 的兜底块，统一图在时整块不渲染。
    判据：`tools/weather-v2-test.js` 47→61（§2b 十四条：不裁时间 / 时刻逐项相同 / 措辞分岔 / 前缀不被改写 /
    39 不加 40 加 / 缺读数不加话 / 影子三处一起动 + 还原对照 / agenda.js 无字面量副本）、
    对拍 `qa/…/tools/ab-photo-note.js`（36 场景 / 46 处后缀 / 21 个零后缀阳性对照 / 越界 0）、
    变异 `qa/…/tools/mutate-photo-note.js`（8 条 0 漏网）。

35. **一句话是"钟点"还是"机会主张"，决定它能不能被天气裁掉；机会主张读已打出的标记，不再判第二遍。**
    Weather V2 第十二轮（「天文暗夜始」机会句，2026-10-10，报告 `docs/weather-ux/qa/v2-dark-window-note-2026-10-10/README.md`）：
    ① 同一行文案里可以藏着两件事：`20:03 天文暗夜始 · 银河与深空窗口`——前半句是客观钟点（任何天气都发生，
       不许裁），后半句是**机会主张**（满天云或不在银心季时它就是那句"把不可能包装成建议"，
       而且此时银河卡已被沉默闸收掉，同一屏两处互相打脸）。修法是把两件事分开：时刻照旧出，
       机会句只在**判得出来**时出。
    ② 机会句的依据直接读 `sky.hourMarks` 已经打出来的 `galaxy` 标记（银心季 + 月照 <35% + 暗夜晴空三合一），
       不在日程层重算晴空率、也不读卡片 verdict ⇒ 零新阈值、零第二实现（铁律 30①/31②）。
       标记键格式必须用页面级的 `date + 'T' + HH:mm`——写成 `h.t` 会静默查不到、恒为 false，
       看起来"更安全"其实是把功能关掉（变异 D4 专抓这一条）。
    ③ **减话类改动必须双向可证**：只测"被摘掉"会放过"永远不说"这种一刀切（它把用户报的现象治好了，
       同时把真有机会的夜晚一起抹掉，肉眼看不出）。所以判据含双向一致
       （没 galaxy 却仍说 = 红；有 galaxy 却被摘 = 红）+ 变异 D2 + 对拍的"保留数 > 0"门。
       与卡片的一致性只写**单向**（有机会句 ⇒ 银河卡 possible）：标记比卡片多一个月照门槛，
       晴夜满月时卡片 possible 而标记不打——把它写成双向等价就是编出来的对称。
    ④ 跨轮回归门：本轮对拍同时要求上一轮（摄影窗口后缀）的条数不回退，且非目标条目的 `sub` 一动就算越界。
    判据：`tools/weather-v2-test.js` 61→67（§2c：时刻永远在 / 满云夜 sub 空且卡 excluded /
    晴夜银心季残月照旧说 / 1 月不说且卡沉默 / 单向一致 / agenda.js 里该文案只许出现一次）、
    对拍 `qa/…/tools/ab-dark-window.js`（34 场景 / 摘掉 9、保留 25 / 越界 0）、
    变异 `qa/…/tools/mutate-dark-window.js`（6 条 0 漏网）。真机 VERIFIED（端口重绑 9424，
    A 满云 20:03 无 sub 且像素不含机会句、B/C 时刻在且 sub 照旧；截图 `device/A-overcast-2.png`）。
    **顺带跑出一条与本轮无关的红**：`tools/e2e-test.js` 的夹具把 `deadlineAt` 写成绝对时刻
    `'2026-10-10T20:00+08:00'`，过点后 `signup.submit → WRONG_PHASE` 并在 `:145` 抛错中断整条 && 链；
    已在 `git archive origin/master`（`abf08f0`）干净副本复现同样红与同样行号 ⇒ **归属清楚，不是天气线改动**。
    教训：**门禁夹具里的绝对日期就是时间引信**，写夹具时用 `Date.now()` 偏移，别写日历。

---

## WORKFLOW — 铁律 (PARALLEL_DEV.md)

The Mac relays pushes through a bare repo whose `post-receive` hook forwards to GitHub **immediately**. Consequence: **two machines must never both push `master`** — a stale-baseline push is rejected *after* the relay already advanced, so both sides report success while diverged. **Once diverged, GitHub is authoritative.**

1. **除了合并窗口，永远不直接推 `master`。**
2. **开工前必 `git pull`** — the relay may already have been advanced by the other machine.
3. **提交前必跑 `node tools/check.js`** — a mini program cannot render locally; static checking is the only defense.
4. **一次只做一件事** — concurrent edits to one file will conflict.
5. **`master` 合并后立刻在另一台 `git pull`。**
6. **`.DS_Store` 不入库.**

Branches: `mac/<topic>` on this machine, `win/<topic>` on the Windows box. Also: don't grep-delete `authorized_keys` by string (match by fingerprint); don't relay secrets or long base64 through chat (it has been proven to get mangled); **test any hook/script you change, including its failure path**.

---

## NOTES / KNOWN GOTCHAS

- **`components/privacy-popup/` is dead code, and now verifiably so.** It was deliberately de-registered from `app.json` (SYNC.md:116) and the leftover `<privacy-popup />` tag in `app.wxml` was removed on 2026-09-29. The component files are kept per that decision. `check.js` step 5b now fails on any custom-component tag used in a wxml without registration in the sibling json, so this class can no longer ship.
- **`README.md` was stale and is now corrected** (2026-09-29): it had documented 12 pages / 10 components / smoke 40 while reality is 14 / 11 / 86, and omitted `pages/discover`, `pages/weather-chart`, and `components/meteogram`. It carries a 「测试」 section and the `tools/` inventory now. **If you add a page or component, update it — and let `app.json` + `components/` stay the source of truth.**
- **`app.js` `globalData: {}` is declared and never read or written.** It is not the state container. There is no mobx/redux/`Behavior()` mixin/EventChannel anywhere.
- **Live state per page:** `this.revision` / `this.now` / `this.view` are *instance properties, never `data`*. `this.revision` is the optimistic-concurrency token and must be passed to every dispatch.
- **Two api.js result shapes coexist, and both can still reject.** `read`/`dispatch`/`getWeather`/`readOr` resolve to the **unwrapped payload**. `readForm`/`readTransport`/`readSensitive`/`readContact`/`readExport` resolve to a **Result-shaped `{ok, value|error}`** — not because the client passes it through, but because the *server* wraps those payloads in `okValue()`; callers must check `result.ok` and read `result.value`. `previewAssignments` does the same and additionally converts a throw into `{ok:false}`, so it alone never rejects. **`call()` throws on every one of them** (network error, undeployed cloud function), so `result.ok === false` covers only the Result path — every call site still needs a `.catch()`.
- **Silent history truncation:** receipts ≤ 600, events ≤ 800, notices ≤ 800 (`domain/commands.js` 89–136).
- **`loadState` reads 15 collections on every request** (all 14 in `COLLECTIONS` + `ot_meta`) — full state hydration per call. `weather_cache` is separate and only `getWeather` touches it. Fine at V1 scale, but it is the first scaling wall.
- **`config.json` declares `security.msgSecCheck` but the code calls `cloud.openapi.phonenumber.getPhoneNumber`** (undeclared; works via the verified-entity path).
- **`SYNC.md:159` references `tools/repro-visibility.js`, which does not exist** — it was a one-off debugging script that was never committed. Annotated in place on 2026-09-29. Don't go looking.
- **The archived `activities` / `signups` / `templates` collections are never read or written.** There are no migration or seed scripts; `store.ensureCollections` auto-creates on every cold start.
- **Any substantive change gets a `SYNC.md` 变更日志 entry** recording root cause + fix + test counts, flagged 「需重新部署 trailApi」 when it touches the cloud function.

---

## CHILD KNOWLEDGE BASE

Read the child file before working in that directory — each contains its own maps and rules and does not repeat this file.

| File | Covers |
|---|---|
| `miniprogram/AGENTS.md` | Page + component inventory, the canonical page shape, the revision contract, styling opt-in |
| `miniprogram/utils/AGENTS.md` | The wx-free purity rule that makes Node testing possible |
| `cloudfunctions/trailApi/AGENTS.md` | The 12 actions, the single `dispatch` funnel, store + CAS, the redeploy gate |
| `cloudfunctions/trailApi/domain/AGENTS.md` | Schema/permission/invariant rules, the add-a-command recipe |
| `docs/prototypes/ourtrail-app/AGENTS.md` | Why that React tree is frozen reference material, not a second implementation |
