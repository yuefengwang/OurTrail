# OurTrail 全链路用户旅程与状态可解释性审计（2026-10-08）

基线：`2e504f2`（出行方式解耦）之上的一轮完整重构。任务不是换颜色，而是让**第一次用 OurTrail 的组织者或参与者，不看任何文档，也能说出「我在哪里 / 现在什么状态 / 我能做什么 / 下一步是什么」**。

本文档记录：旅程地图、页面地图、状态展示体系、两类角色的 UX 问题、Action hierarchy、Empty/Error/Permission 三态、修改清单、真机 UI E2E 结果、剩余风险。

---

## 1. 用户旅程地图

### 1.1 Journey A · Leader（组织者）

| 步骤 | 页面 | 这一步系统里的状态 | 改之前用户能不能看懂 | 改之后的下一步 |
|---|---|---|---|---|
| 创建活动 | `editor` step 0 | `phase='draft'` | ✗ 草稿/发布两个词混用，按钮一律叫「保存」 | 「补齐并发起活动（拦路）」 |
| 填写信息 | `editor` step 0-2 | 三-step 表单 | △ 分步标签清楚，但保存按钮文案不随状态变 | 同上 |
| 保存 | `editor` | 落库为 draft | ✗ 「保存草稿 / 保存修改」由模板比枚举决定 | `saveLabel`（JS 一次决定） |
| 发布 | `editor` → `activity` | draft→published | ✓ 有确认弹层 | 「处理报名」 |
| 等待报名 | `activity` / `home` | published | ✗ 详情页给参与者看领队指标（待审核 N 人） | 参与者看自己的时间锚点 |
| 处理报名 | `workspace` 名单区 | pending rows | △ 有计数，但筛选器自带一份状态词，与 `format.js` 漂移 | 「N 人待审核（拦路）」 |
| 确认参与者 | `roster-panel` | pending→confirmed | ✗ 「确认报名」与次要按钮同权重 | 主按钮升为 primary |
| 处理 self/shared | `workspace` 指标 | counters.selfTravel / vehicleTravel | ✗ 待安排车辆把自行前往的人算进缺事项 | 构成行 `tripMixLine`；无人需要乘车时不摆 0 |
| 处理车辆 | `transport-panel` | vehicles / assignments | ✗ 残留 `busy` 把面板永久锁成「看着能点、点了没反应」 | 「正在按最新名单计算…」+ 8 秒自愈 |
| 集合 | `workspace` 现场区 | gathering | △ 副标题是写死的散文，与指标不同源 | `phaseScene(phase)` 单源 |
| 签到 | `field-panel` | checkIn | ✗ 客户端复刻了一遍出发门规则 | 只读 `permittedActions` + 行标志 |
| 出发 | `activity.transition` | gathering→active | ✗ 按钮 disabled 时不给原因 | 「为什么现在不能推进：…」`transitionBlocker` |
| 活动进行中 | `field-panel` | active | ✓ 节点/异常可用 | 异常闭环 |
| 返程 | `field-panel` | closing | ✗ 返程安排对 self 者也出现 | 按 `tripMode==='shared'` 才给 |
| 完成 | `field-panel` | home 逐人 | △ 指标位仍叫「待签到」 | `fieldMetric(phase)` → 「待到家」 |
| 归档 | `activity.transition` | closing→archived | ✗ 归档门槛失败只回一句红字 | `explain()` → 标题+原因+「去安全收尾」 |

### 1.2 Journey B · Participant（参与者）

| 步骤 | 页面 | 状态 | 改之前 | 改之后 |
|---|---|---|---|---|
| 发现活动 | `discover` | published | ✓ | 「剩 N 天」用服务端时钟 |
| 查看活动 | `activity` | detailState | ✗ 徽标恒为「一起同行」，掩盖真实状态 | 徽标 = `journey.status` |
| 报名 | `signup` | 新报名 | ✗ denied 页一屏红字没有出口（冷启动无上一页） | `goBackToActivity` / `goHome` |
| 选择 self/shared | `signup` | trip.mode | ✗ 曾用 picker 下标反推，shared 会被渲染成「自行前往」 | 独立值域，绝不返回 0 冒充 |
| 等待确认 | `activity` | pending | △ 只显示「已报名」 | 「报名已收到 / 组织者正在确认 / 结果会更新在这里」 |
| 查看报名状态 | `activity` | confirmed/waitlisted/rejected/cancelled | ✗ 候补与拒绝共用一套话术 | 每个状态各自一句「为什么 + 接下来」 |
| 集合 | `activity` 主 CTA | gathering | ✗ 已签到的人还被告知「去签到」 | `checked` → 「更新我的同行状态」 |
| 签到 | `activity` sheet | checkIn | ✓ | — |
| 出发 | `activity` | departure | ✗ self 者看到「车辆待安排」欠事字样 | `how` 按 tripMode 分支，self 不出现车辆字段 |
| 活动 | `activity` / 位置上报 | active | △ 上报入口埋在折叠线以下 | 主 CTA 直达 sheet |
| 返程 | `activity` sheet | returnPlan | ✓ | — |
| 完成 | `activity` | closing → home | ✗ 终态只写「已结束」，不给下一步 | 终态也给 cta（回看安排 / 看别的活动） |

**结论**：两条旅程里，「状态是有的，但页面没说清」的步骤共 17 处；「下一步找不到」的 11 处；「存在无意义操作」（按钮出现但对本角色不成立）的 6 处。全部已改，见 §8。

---

## 2. 页面地图

17 页（`app.json`），入口图由 `tools/journey-graph-test.js` 从真实 `wx.navigateTo/redirectTo/reLaunch/switchTab` 字符串构建：

```
[启动] pages/home/home ──┬─► discover ─► activity ─┬─► editor ─► (home|me|activity)
   [TAB]                │                          ├─► signup
   [TAB] notices        │                          ├─► weather ─► weather-chart
   [TAB] weather-hub    │                          ├─► anotices（活动内通知）
   [TAB] me             │                          └─► sheet（签到/到家/上报/报备）
                        ├─► staff / vehicle（协作任务）
                        └─► privacy（本轮新增入口）
activity ─(组织者)─► workspace ─┬─ roster-panel
                                ├─ transport-panel
                                └─ field-panel
```

- **TAB 四页**：home / weather-hub / notices / me（custom-tab-bar）。
- **本轮发现的死页面**：`pages/privacy/privacy` 只有已停用的 `privacy-popup` 组件能跳到 → 用户实际永远看不到隐私指引。修法：`me` 页底部新增「隐私与资料 → 隐私保护指引」（`me.wxml` H 区 + `me.js:onOpenPrivacy`）。
- **有入口没返回路径**：`vehicle`（denied 态一屏红字）→ 加 `actionLabel="回到首页" bind:action="goHome"`；`signup`（分享链接冷启动无上一页）→ `goBackToActivity`；`workspace`（缺 activityId）→ `onDeniedAction`。
- **内部页（无用户入口，登记在案）**：`pages/lab/lab`（预演工具）、`pages/cloud-field-poc/cloud-field-poc`（渲染 POC，其 fixtures 被两套测试 require）。两页各自声明内部身份，并补了「回到活动页」出口。
- **命名可疑但不是死页**：`pages/anotices/anotices` = 活动内通知，与全局 `notices` 是两个作用域，由 `utils/notices-page.js` 工厂共用。

---

## 2.5 Page × Activity State × Role 矩阵

列 = `Activity.phase`；行 = 页面/面板；单元记号：**●** 主工作面 · **○** 可进且有意义 · **—** 服务端拒绝且 UI 收成只读/不可进 · **?** 该组合无入口（不可能出现）。角色简写：L=组织者，P=参与者，S=现场协作，V=车长。

| 页面 | draft | published | gathering | active | closing | archived | cancelled |
|---|---|---|---|---|---|---|---|
| `home` 首页 | ●L | ●P/L | ●P/L | ●P/L | ●P/L | ○ | ○ |
| `discover` 发现 | —（不进列表） | ●P | —（`acceptingSignups=false`，卡片写「暂不报名」） | — | — | — | — |
| `activity` 详情 | ○（L 预览，顶部黄条「未发布预览 · 仅你可见」） | ●P（new/pending/confirmed/waitlist/ready） | ●P（gathering/checked） | ●P（active） | ●P（closing） | ○（finished，仍给 cta） | ○（cancelled，给「去看别的活动」） |
| `signup` 报名 | — | ●P（`signup.submit` 唯一开放阶段） | — | — | — | — | — |
| `editor` 新建/编辑 | ●L（可全量改） | ●L（可全量改） | ○L（仅说明/装备/费用/取消说明 + 延长结束） | ○L（同上） | —（`WRONG_PHASE`「活动内容为只读」，UI 直接 denied 带原因） | — | — |
| `workspace` 工作台 | ●L（队列＝「补齐并发起活动」） | ●L | ●L | ●L | ●L | ○L（回看） | ○L（回看） |
| ┗ `roster-panel` | —（无人可审） | ●L | ○（只读名单） | ○ | ○ | ○ | ○ |
| ┗ `transport-panel` | ○L（可建车，`transport.js` 放行 draft 的 vehicle.save） | ●L | ●L（发车前最后窗口） | —只读＋「请从现场区逐人核实」 | —只读 | —回看 | —回看 |
| ┗ `field-panel` | ? | ○（未开场，动作表空） | ●L/S/V | ●L/S | ●L（到家＋返程安排） | ○ | ?（无已签到者） |
| `staff` 协作授权 | ○L | ●L | ●L | ●L | ○ | — | — |
| `vehicle` 车长任务 | ? | —（无乘车者未排车） | ●V 去程 | ●V 去程＋返程 | ●V 返程 | ○ | — |
| `anotices` 活动内通知 | ○L | ●L | ●L | ●L | ●L | ○（只读） | ○（只读） |
| `notices` 全局通知 | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| `me` / `privacy` | 与阶段无关 | | | | | | |
| `weather` / `weather-chart` / `weather-hub` | 与阶段无关（按节点/坐标取数） | | | | | | |

覆盖检查结论（本轮实际发现的三处「状态达到后没有 UI」并已全部补上）：

1. **`transport-panel` 在 active/closing/archived 原是「按钮仍在，点了才报 `WRONG_PHASE`」**——服务端早有阶段门（`transport.js:94`），UI 却没跟上。修法：`J.transportLock(phase)` 一次给出「现在能不能改车 + 该去哪处理」，面板据此收成只读并挂一条 warning callout（`transport-panel.wxml:27`，写控件全部 `wx:if="{{!lockHint}}"`）。
2. **`workspace` 在 draft 阶段原是把「检查车辆与人员安排」当默认待办**——草稿期还没人报名，这条待办根本不存在。修法：`leaderQueue` 对 draft 直接返回「补齐并发起活动（拦路）」，排车待办只在 `vehicleTravel > 0` 时出现。
3. **`field-panel` 的上报点卡片只把「进行中」写在模板里**（`wx:if="{{phase === 'active'}}"`）——不是缺 UI，而是缺一条能说明「这一区为什么在此刻消失」的投影位。修法：判定挪到 JS（`showPositions`），closing 阶段的现场焦点由 `fieldMetric`（待到家）与 `leaderQueue` 的「逐人确认到家」承担，不再让人对着一块凭空消失的卡片猜。

不可能出现的组合（`?`）已确认没有入口：车长任务页要求已排定的车辆；`field-panel` 在活动取消后不再被任何路径打开（`permittedActions` 全空 → 面板显示拒绝原因）。

---


新增 `miniprogram/utils/journey.js`（322 行，wx-free，可 Node 直测）。它是**唯一**把服务端枚举翻译成人话的地方，方向严格 domain → projection → label：

| 出口 | 作用 | 取代了什么 |
|---|---|---|
| `phaseLabel/phaseScene/phaseTone` | 阶段词 + 该阶段现在最该做什么 | 各页写死的 `SUBTITLES` |
| `signupLabel` | 报名行状态词 | 页面自拼 |
| `statusFilterOptions()` | 名单筛选器选项 | roster-panel 自带的一份 `STATUS_OPTIONS`（已与 `format.js` 漂移） |
| `incidentOptions()` | 报备类型选项 | activity.js 本地常量 |
| `remaining(now, at)` / `dayPrefix` | 「剩 30 分钟 / 剩 2 天 / 已过时」 | `utils/util.js` 里逐字节重复的第二份倒计时 |
| `participantNext(ctx)` | 参与者的 状态 + 下一步 + 怎么去 + CTA | activity 页散落的三元式 |
| `leaderQueue(ctx)` | 领队待办，按是否拦路排序 | workspace 固定四条待办 |
| `tripMixLine(counters)` / `fieldMetric(phase)` | 出行方式构成行 / 指标位随阶段换焦点 | workspace.js 内联拼接 + 「待签到/待到家」两处字面量 |
| `TRANSITION_LABEL` | 「开始集合 / 确认出发 / 结束行程，进入返程 / 安全收尾并归档」 | 「进入正在集合」这类把枚举名读出来的按钮 |
| `transitionBlocker(ctx)` | 「为什么现在不能推进」 | disabled 按钮无解释 |
| `transportLock(phase)` | 排车区的阶段边界：现在只读，且该去哪儿补 | 出发后仍可点写按钮，撞服务端红字 |
| `timeline(now, phase)` | ✓ / ● / ○ 三态标记 | 只有 badge 颜色 |
| `explain(err, ctx)` | 每个 `ERROR_CODES` → 标题 + 原因 + 出路 | 一屏服务端原文 |
| `busyStale(busyAt, now)` | 8 秒未落地的写状态自愈 | 永久锁死面板的残留 `busy` |

被禁的写法（`tools/journey-graph-test.js` 现在是常驻门，不再靠自觉）：
- WXML 里比较 `phase === 'draft'` / `status === 'confirmed'` / `transitionNext === 'cancelled'` → 模板只读 JS 与投影算好的布尔。
- 页面 JS 里出现受管中文状态词（阶段/报名/出发/出行方式 8+6+4+2 个取值）→ 只允许 `format.js` 与 `journey.js` 两处。

---

## 4. Leader UX 问题（逐条，均已修）

- **L1 工作台是「后台」不是「现场」**。指标把「待审核 / 待安排车辆 / 待签到」并列，但不说哪个拦路。→ `leaderQueue` 按 blocking 排序，拦路的标「（拦路）」，无事可做时给 idle 条目而不是 0。
- **L2 出行方式被混进同一个缺事项计数**。自行前往的人被算进「待安排车辆」，领队永远看到假欠事。→ `tripMixLine` + `vehicleTravel > 0` 才出现排车待办。
- **L3 主 CTA 与危险操作同权重**。「取消活动」是 `danger block`，和「进入下一阶段」抢焦点。→ 降级为 `button text`，并改文案「取消这场活动（仅出发前可作废）」说明边界。
- **L4 disabled 不解释**。阶段推进按钮灰掉时没有任何一句话说明原因。→ `transitionBlocker` + 「为什么现在不能推进：…」。
- **L5 `busy` 残留锁死整条分车链**（真机实测，本轮 golden-path 阻塞点）。按钮 `bindtap` 是动态表达式，`busy===true` 时它变成空串：界面看起来能点、点了什么都不发生，且分车→上车→出发→推进全线红。→ ① 按钮文案改为进行时（「正在按最新名单计算…」「正在提交…」）；② 每次 `reload()` 头部用 `busyStale` 清掉超过 8 秒没落地的写状态；③ `busyAt` 与 `busy` 成对写入。
- **L6 现场面板在客户端复刻服务端规则**。`lateArrival` 本地表达式与 `field.js` 的出发门重复，两者迟早分叉。→ 只读 `permittedActions` + 投影布尔。
- **L7 弹层缺动作时让人猜**。缺「核实已随队出发」时不说缺哪一步、去哪补。→ `sheetHint`（「请先完成现场签到…」/「请先在车长任务页点『确认上车』…」）。
- **L8 名单筛选器自带一份状态词**，与 `format.STATUS_LABELS` 已漂移（「候补」vs「候补中」）。→ `statusFilterOptions()` 由标签表派生。
- **L9 面板缺 activityId 时永驻骨架**。→ 给说明性 denied 态而不是无限 loading。
- **L10 时间线只有颜色 badge**。户外强光下色相不可靠。→ `timeline()` 给 ✓/●/○ 形状 + 文字「· 当前」。
- **L11 阶段副标题是写死的散文**（`SUBTITLES`）。→ 删除，统一 `phaseScene`。
- **L12 出发之后排车按钮还活着**。服务端 `transport.js:94` 只放行 published/gathering（draft 例外仅允许建车），UI 却不认这件事：在 active/closing 点「预览自动分车」只会换来一句红色 `WRONG_PHASE`。→ `J.transportLock(phase)` 一处判定，面板据此收成只读 + warning callout「请从现场区逐人核实」，写控件（添加车辆 / 预览 / 座位点选 / 安排乘客 / 编辑 / 删除）全部退出可点状态。

## 5. Participant UX 问题（逐条，均已修）

- **P1 详情页徽标恒为「一起同行」**，把 draft/cancelled/archived 全遮住。→ `badgeText = a.phase==='draft' ? F.PHASE_LABELS.draft : journey.status`。
- **P2 参与者看到的是领队指标**。`countersLine` 对所有人显示「待审核 N 人 · 候补 N 人」。→ 参与者改看自己的时间锚点，领队视角才给队列。
- **P3 已签到的人被再次提示「去签到」**。→ `checked` → 「更新我的同行状态」。
- **P4 自行前往的人看到车辆欠事字样**（「车辆待安排」「未分车」）。→ `how` 按 `tripMode` 分支，self 只说「自行前往集合点，不占活动车辆」。
- **P5 分享按钮与主 CTA 同权重**。→ 降级 `button text`。
- **P6 终态不给下一步**（取消/归档只剩一句结论）。→ `finished`→回看安排；`cancelled/closed`→去看别的活动。
- **P7 报名页 denied 是一屏死字**（分享链接冷启动没有上一页可回）。→ `goBackToActivity` / `goHome`。
- **P8 首页卡片没有「还有多久」**，只有日期与阶段。→ 卡片加 `when`（服务端时钟倒计时），`archived/cancelled` 不显示。
- **P9 「最近查看」空状态只有一句标题**没有说明。→ 补 `emptyDetail`。
- **P10 出行方式曾按 picker 下标反推**（任何非 0 都显示「自行前往」）。→ 值域独立，上车点被改名/删除时返回 -1 而不是冒充 self。

---

## 6. Action hierarchy（一页一个主行动）

| 页面 | 改之前的按钮权重 | 改之后的 Primary |
|---|---|---|
| `activity` | 进入工作台 / 填写报名资料 / 更新状态 / 分享 全 `primary` 或 `secondary block` | 由 `participantNext().cta` 唯一决定；分享降为 text |
| `workspace` | 「进入下一阶段」primary block + 「取消活动」danger block | primary 只剩推进；取消降 text；待办条目各自跳对应分区 |
| `roster-panel` | 「确认报名」与次要按钮同权重 | 确认报名 / 递补候补 升 primary |
| `field-panel` | 动作表平铺 | 首个动作标 `primary`（`a.primary = i===0`） |
| `transport-panel` | 预览按钮在 busy 时看起来仍可点 | 进行时文案 + disabled 一致；busy 由 stale 门自愈 |
| `vehicle` | denied 无出口 | 唯一出口「回到首页」 |

---

## 7. Empty / Error / Permission 三态

**Empty**（每处都回答「为什么为空 + 接下来做什么」）：
- 无车辆 / 无司机 / 无座位 / 无签到 / 无历史 / 无异常 / 无上报点 / 无同行人 / 无最近查看，共 9 类，均由 `<status-panel kind="empty">` 或带因由的 `muted` 行承载；不再有裸「暂无数据」。
- 反例修正：全场没人需要乘车时，排车待办**不出现**，而不是摆一个 0 让人以为还欠一步。

**Error**（`J.explain`，`tools/journey-test.js` 逐条钉住「每个 `ERROR_CODES` 取值都要给出中文标题 + 原因」）：
- 结构：标题（发生了什么）/ 原因（为什么）/ 出路（怎么办，带 target）。
- 样例：`UNRESOLVED_DEPARTURE` → 「暂时不能出发 / 还有 N 位需要乘车的人还没有『上车』事实 / [去现场分区逐人核实]」。
- 服务端原文不被覆盖，只补一句「去哪儿解决」；`CONFLICT` 明确说「页面已经重新读取，请把修改再做一次」。

**Permission / Disabled**：
- 能力集合是活动级的，「这一行能不能做」还要看该行 `tripMode`——UI 直接读投影布尔（`needsSeatAssignment` / `needsOutboundBoarding` / `needsReturnBoarding`），不再重述规则。
- 按钮不可用时给 `disabledReason()`（「现在不能点：…」），不出现「按钮突然消失且不知道为什么」。
- 只读视角（车长 / 非组织者）显式说明「以只读方式查看」并透出服务端拒绝原文。

---

## 8. 修改页面清单

新增：

| 文件 | 行 | 作用 |
|---|---|---|
| `miniprogram/utils/journey.js` | 322 | 统一可解释性层（§3 全部出口） |
| `tools/journey-test.js` | 189 / 138 断言 | 旅程层单测：状态词单源、四问齐备、每个错误码有中文解释、指标位与只读锁的反对照 |
| `tools/journey-graph-test.js` | 162 / 12 断言 | 页面图静态门：死页面、困页、denied 无出口、模板比枚举、词汇漂移、死模块登记 |

改动（33 个跟踪文件，+403 / −176）：

- `pages/activity/activity.{js,wxml}`：徽标说实话、`participantNext`、`onNextAction`、`id="meeting-block"` 定位、分享降级、busy 自愈、`incidentOptions`。
- `pages/workspace/workspace.{js,wxml}`：`phaseScene`、`leaderQueue`、`tripMixLine`、`fieldMetric`、`transitionBlocker`、`TRANSITION_LABEL`、`timeline` 标记、取消降权、`goQueueItem`、`onDeniedAction`、`transitionDanger`。
- `pages/home/home.{js,wxml}`、`components/activity-card/*`：服务端时钟、`J.phaseLabel`、卡片倒计时 `when`、补 `emptyDetail`。
- `pages/editor/editor.{js,wxml}`：`isDraft` / `saveLabel`（模板不再比枚举）。
- `pages/signup/signup.{js,wxml}`：denied 出口、出行方式值域独立。
- `pages/vehicle/vehicle.{js,wxml}`：denied 出口、badge 文本与色调由事实而非标签推导。
- `pages/me/me.{js,wxml}`：隐私指引入口。
- `pages/lab/lab.{js,wxml}`、`pages/cloud-field-poc/*`：内部页自声明 + 出口。
- `components/roster-panel/*`：`statusFilterOptions`、确认报名升 primary。
- `components/transport-panel/*`：进行时文案、busy 自愈、toast 说清移除对象、`lockHint` 把出发后的写控件全部收成只读并挂上说明 callout（wxml 第 9、27、29、47、56、71、79、82 行）。
- `components/field-panel/*`：删除客户端出发门复刻、`showPositions`、`sheetHint`、首个动作 primary。
- `utils/util.js`：删除与 `format.js` 逐字节重复的 `relativeDeadline`。
- `tools/e2e-ui-test.js`、`tools/scenario-{workspace,activity,vehicle}-test.js`：跟随新文案与新契约（见 §9、§10）。

**没有为视觉效果新增任何 domain state**；`schema.js` / `invariants.js` 零改动，timeline 与 next-action 全是投影。

---

## 9. 真机 UI E2E 结果（微信开发者工具 · miniprogram-automator）

判据沿用 `docs/testing/e2e-result-semantics.md`：BUSINESS 与 UI 两个独立维度，一条 UI PASS 必须由「一次真实 tap/input + 它的后果观测」构成，门槛不过记 INCONCLUSIVE，**绝不记 PASS**。

**本轮三跑收敛过程**（同一沙盒活动 `[预演] 工作台E2E`，跑完已归档并留 cleanup 提示）：

| 跑次 | BUSINESS | UI | 结论 |
|---|---|---|---|
| 第 1 跑 | FAIL 16✓/12✗ | FAIL 49✓/11✗/3 未验证 | 23 条红的，全部溯到两处根因 |
| 第 2 跑 | FAIL 19✓/7✗ | FAIL 61✓/2✗/1 未验证 | 修好 CTA 文案与 tap 抢跑 |
| 第 3 跑 | **PASS 26✓/0✗** | **64✓/0✗/1 未验证** | OVERALL INCONCLUSIVE（退出码 2） |
| 第 4 跑（重开 IDE 会话取新 bundle） | **PASS 26✓/0✗** | **64✓/0✗/1 未验证** | 与第 3 跑逐项一致 ⇒ 结论可复现，不是运气 |
| 第 5 跑（最终代码，含移除一个未被模板读取的冗余标志位） | **PASS 26✓/0✗** | **64✓/0✗/1 未验证** | 三跑连续同读数，本表结论对得上交付代码 |

第 3 跑经真实 UI 点击走通的链路：`添加车辆 → 勾选上车点（多选）→ 明确座号 → 保存 → 重开回显 → 预览自动分车（planOpen/planChanged 对象内读数）→ 明确确认并提交 → 座位示意出现已占座 → 点「开始集合」→ 填阶段变更原因 → 确认变更 → 现场记录弹层签到 → 车长任务页「确认上车」→ 核实已随队出发 → 批量签到/上车/出发 → 推进 active → 路线节点 → closing → 核实安全到家 → 全员到家 → 归档 → 工作台「待到家」归零`。

前两根因（都是我自己造成的假红，已如实记在此处）：
1. **测试与文案脱钩**：套件写死「进入正在集合」，而 §3 把按钮改成了动词优先的「开始集合」。改成读 `J.TRANSITION_LABEL`，文案与测试同源。
2. **tap 抢在写之前**：第二次保存的 `busy` 还没落地就去点「预览自动分车」，而模板此时把 `bindtap` 收成空串——于是「点了没反应」。改成先轮询 `busy===false && editorOpen===false` 再往下走；同时把「重开车辆编辑」也改成轮询 `vform` 落地后才判读渲染态。

第 3 跑唯一的**未验证**项（不是失败，是通道限制）：
> 「组织者在授权弹层经角色 picker 授予车辆联络」的 tap-through——`role/scope/授权截止时间`都是原生 `<picker>`，tap 后弹层不在可查询树（`.wx-picker`/`picker-view` 0 命中，截图无弹层）⇒ 无法自动化。授权本体改由 `membership.save` 云命令准备，明确记 **BUSINESS 证据，不作 UI 证据**；picker 数据源与保存链契约由 A 层 `e2e-permission-test` 钉住。

**参与者旅程**（同一次跑内）：报名页装配、档案回填、紧急联系人回填、同行人候选区勾选→进入参与人列表→再点取消，全部为「真实 tap + 后果」的 UI PASS。

---

## 10. 回归结果与剩余 UX 风险

**回归（无头门禁全量复跑，最终代码）**：`node tools/check.js` ALL PASSED；`node tools/check-handlers.js` exit 0（30 个页面/组件）；**52 套门禁 / 3698 断言 / 1 条红**。唯一红是既有的天气线非确定性用例 `outdoor-intelligence-ui-test.js`「applySelection 命中 IN_CLOUD 窗口」——它打线上 Open-Meteo 加真实时钟，其 require 链（`outdoor-intelligence`/`oi-presentation`/`meteogram-svg`/`weather-cloud-field`/`lib/weather`）本轮一行未动，多次复跑同点复现，按 SYNC.md 2026-10-07/10-08 的归档结论处理，不重诊、不改判。
`e2e-client-cas`（1 条）、`e2e-concurrency`（2 条）、`e2e-fault-probe`（3 条）里的 `✗` 是**故意常驻的 bug 探针**，退出码 0，不是本轮回归。**没有删除或放宽任何测试**；三处测试改动都是把期望重写到新的、更强的契约上（见 §8 末）。`node tools/sync-lab.js` 已重跑（14 文件同步），`lab-dryrun` 165✓。

剩余风险，按「会不会让人用错」排序：

1. **原生 `<picker>` 不可驱动**——所有 picker 类操作（授权角色、到达节点、报备类型、返程方案）在真机 E2E 里只能拿到 BUSINESS 证据。产品上没问题（人眼看得见弹层），但**这一类 UI 回归永远靠人**，自动化不能替我们兜住。
2. **「一眼看懂」没有真人验证**。本轮的判据全部来自代码事实与状态读数；没有做过一次有真实参与者到场的可用性测试。§1 表里「用户能不能看懂」是我按页面实际输出做的判断，不是观察结果。
3. **词汇单源门只覆盖 JS 字面量**。WXML 里的散文文案（如「不自动拆分同车组」）仍可在页面各写一份，静态门抓不到；`utils/util.js` 的名单导出仍按已不存在的 `status === 'active'` 说话——它零引用，已在门里登记为死模块，一旦被 require 就会先红。
4. **工作台四面板常驻挂载换来「切区不丢勾选」，代价是每次进页最多 4 次全量读**（`loadState` 本身每次读 15 集合）。V1 规模无碍，但这是第一次真正的性能债，尚未实测过分。
5. **`chart-store` 从不 `clear()`**（只增不减）。核查后降级为卫生问题而非 UX 缺口：唯一入口 `weather-chart` 一定由 `weather.js:569` 先 `set()` 再 `navigateTo`，而拿到空 payload 的冷启动分支已经有说明性空态（`weather-chart.wxml:35`「还没有全图数据 · 返回」）。真正的代价是常驻一份 168 小时序列，看不见、也不致命。
6. **拦路判据与文案仍可能不同步**：`transitionBlocker` 是服务端门槛的**描述**，不是同一份代码。门槛若再次调整，`tools/journey-test.js` 能证明它会给出文字，但不能证明那句话仍然正确。
7. **详情页仍是长页滚动**，Level 4/5（装备、费用、风险细则）没有折叠；对「戴手套、在风里、只有两秒注意力」的场景仍然偏长。
8. **状态词只做了中文**。同一句「开始集合 / 确认出发」若有英文用户，需要第二套词表——journey 层的存在让这件事只需要改一个文件。
