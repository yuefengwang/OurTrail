# OurTrail 全局 UI/UX 重构 · 第二阶段实施报告（全页面落地）

- **日期**：2026-10-17（承接 2026-10-16/17 第一阶段）
- **工作区**：`d:/OurTrail-ui`（worktree，分支 `win/ui-redesign-editorial`）
- **本轮起点**：第一轮末端 `b3cf18e` → 先合入在途任务 `13cb844`（上轮已试合并验证）得 `8a4564d`，在其上实施
- **设计规范**：`docs/ui-ux-redesign/design-system.md`（第一轮确立，本轮零新增 token——全部复用）
- **证据**：`screens/phase2/`（20 张真机截图）、`evidence/phase2-interaction{,-round2}.json`、
  `evidence/phase2-verify-round{1,2}.txt`、`evidence/gate-phase2-sweep.txt`

---

## 1. 承接核查（本轮开工时实测）

| 项 | 实测值 |
|---|---|
| 主工作区 | `d:/OurTrail` @ `13cb844` [win/ui-fix-round2-wave1]，干净（仅 `.idea/`） |
| 本轮 worktree | `d:/OurTrail-ui` @ `b3cf18e` [win/ui-redesign-editorial]，干净 |
| 第三方 worktree | `d:/OurTrail-skill-uplift` @ `e0d3c9f`（他人任务，零触碰） |
| 处置 | 先把上轮已验证无冲突的 `13cb844` 合进本分支（真合并，非 rebase），再开工 |
| 设计文档 | `design-system.md` / 第一轮报告均在位；页面清单直接继承 |

## 2. 本轮实际实施的页面（11 个重构 + 4 个 tab 页底隙修复）

判定口径：**重构** = 结构性改动（分区头/分组/固定操作栏/hero）；**微修** = 局部修复；**无改动** = 已达标或显式豁免。

| 页面 | 动作 | 关键设计决策 |
|---|---|---|
| `routes` 路线库列表 | **重构** | 按「我的 / 共享给我」分组（投影早有 isOwner，此前只靠行内徽标猜归属）；编辑式头部；行组一张卡 + 发丝线，不做一卡一路 |
| `route` 路线详情 | **重构** | **hero-cover 第二个使用方**（design-system §3 预留的「一条路线」场景，`covers.coverFor(route.id)` 稳定散列 + 失败回退 + 诚实性脚注）；4 指标收敛为 hero 内 3 指标，风险数进分区头；8 张堆叠卡 → 6 个分区头组 |
| `route-edit` 路线编辑器 | **重构** | 编辑式头部 + 4 个分区头；保留 sticky 保存栏 |
| `signup` 报名页 | **重构** | 主操作移入 **sticky 提交栏**（报名是转化关键，滚到底才见提交太贵）；候补场景两颗按钮同屏（primary=整组候补 / secondary=正式报名，落实 A-13 的视觉次序且互斥按钮不再因滚动看不见）；候选/参与人/同车三段分区头 |
| `editor` 活动编辑器 | **重构** | 分步指示印出「第 N 步 / 共 3 步」；三步各加分区头；「下一步 / 发布活动」进 **sticky 操作栏**（长表单主操作恒在位）；保存/预览留内容区与「草稿已自动保存」同处 |
| `me` 我的 | **重构** | 9 张堆叠卡 → 5 组：「我的出行（最近活动+路线库）/ 安全档案（手机·紧急·健康）/ 同行人 / 协作与权限（协作码+位置授权+隐私）」；低频项不再占满首屏 |
| `weather-hub` 天气总入口 | **重构** | 编辑式头部 + 分区头；观察点计数上分区头 |
| `notices` / `anotices` 通知 | **重构** | 分区头（列表条数 + 未读标识说明）；两文件保持逐字节同源（`fc` 确认过原本就相同） |
| `privacy` 隐私指引 | **重构** | **修复真实缺陷**：`.container/.h1/.h2` 三个类全站无定义（grep 全仓 wxss 零命中）⇒ 标题实际按正文默认字号渲染；改用 `section-head + page-title + section-title` |
| `lab` 预演面板 | **重构** | 分区头（开发工具页，白名单可见） |
| `home` / `me` / `notices` / `weather-hub`（tab 页） | **微修** | 见 §3 的 tabBar 底隙修复 |

**明确不动**（及理由）：
- `activity`（视觉标杆，已达标）；`discover`（卡片组件已在第一轮改造，页内无残留问题）；
- `workspace`（第一轮已做指标带+分区头，结构被 114 条场景测试钉死）；`weather` / `weather-chart`
  （任务约束：天气算法/图表/数据流冻结；`weather-chart.wxss` 审查后确认已全部 token 化，无需改动）；
- `staff` / `vehicle`（薄壳页 + trip2/golden-path 门禁钉死结构，第一轮已列入建议单独一轮）；
- `cloud-field-poc`（POC 页，非业务页面）。

## 3. 巡检发现并修复的全局缺陷

**自定义 tabBar 底隙缺失（真机实测发现）**：`custom-tab-bar/index` 是 `position:fixed` 覆盖层，
但四个 tab 页都没有预留底部空隙——`home` 上的 `.with-tabbar` 是**全站无定义的死类**，
`me`/`notices`/`weather-hub` 连这个类都没有。真机截图实测 `weather-hub` 尾部提示
「还没有观察点…」被 tabBar 压住。修复：`app.wxss` 补上
`.page.with-tabbar { padding-bottom: calc(84px + env(safe-area-inset-bottom)) }`（与 `.tabbar-safe` 同口径），
四个 tab 页统一挂类（`home` 的条件挂载改为恒挂——tab 页恒有 tabBar）。
修复后复拍四页 + 滚动位截图确认（`screens/phase2/*-tabbar*.png`）。

## 4. 设计系统与公共组件复用情况

- **零新增 token、零新增自定义组件**——本轮全部复用第一轮的 token 与全局类
  （`.section-head/.kicker/.page-title/.fact-row/.hero-cover*/.sticky-action/.list-row/.hairline`）。
- `.hero-cover` 迎来第二个成熟使用方（`route` 详情），按 design-system §3 的既定边界
  （「一个活动/一条路线」的详情首屏）落地；仍保持类级实现，未提组件（等第三个使用方再议）。
- `.sticky-action` 从 1 个页面（route-edit）扩展到 3 个（signup/editor/route-edit），
  三页的 `has-sticky` 与底栏显隐条件同源写法保持一致。
- 上轮记录的平台坑（绝对定位+百分比高 `<image>` 不绘制）在本轮全部绕开：
  route hero 用「定高媒体盒 + 文档流 image」，真机实测绘制成功（350×240）。

## 5. 门禁钉点保护清单（改前逐一核对，改后全部复跑）

| 钉点 | 出处 | 结果 |
|---|---|---|
| editor：`.input[0]`=标题、`.seg` 序号切步、`[data-key=dt_start]`、`.cluster` 含「详细介绍」、「保存草稿」`.button.secondary`、「发布活动」 | e2e-golden-path GP-01/02/03 | 全部保留 |
| editor：`button text + disabled`（删除草稿） | style-semantics §4 T4.2 | 保留（并加注释防止误删） |
| signup：候选 `checkbox-group` 的 `data-key` 挂 group 上（前缀 `c:`） | e2e-ui §5 + SYNC.md 2026-10-04 | 保留（加注释） |
| signup/editor/route-edit：`has-sticky` 与底栏 `wx:if` 同条件 | g2-platform-gate | 三页一致 |
| WXML 不出现阶段/状态枚举比较；受管状态词只在 format/journey | journey-graph C/D | 未引入新违例 |

## 6. 验收结果

### 6.1 真机渲染与交互（微信开发者工具，390×844，云端真实数据）

第一轮 `evidence/phase2-interaction.json`（13 项）+ 补轮 `-round2.json`（6 项）。两轮合并后的**产品判定**：

| 用例 | 判定 | 证据 |
|---|---|---|
| P2-01 路线库分组渲染（kicker 2 · 行 289） | **通过** | `routes.png` |
| P2-02 路线详情 hero 绘制 350×240 · hero 指标 3 · 分区头 6（点行真实导航进入） | **通过** | `route.png` `route-nodes.png` `route-bottom.png` |
| P2-03 路线编辑器（显式 id 打开：分区头 5 · 输入 3 · 固定保存栏 1 · 节点 12） | **通过**（首轮失败=等侍不足+未带 id，补轮通过） | `route-edit*.png` |
| P2-04 报名页可报名态（造真实夹具：分区头 2 · sticky 1 · 候选组 78） | **通过**（首轮失败=旧夹具已不可报名，非产品问题） | `signup*.png` |
| P2-04b 真实 tap 候选勾选框：参与人 1 → 0 | **通过** | `signup-checked.png` |
| P2-05 编辑器装配 + 真实 tap 第 02/03 步（step=1→2） | **通过** | `editor-step{1,2,3}.png` |
| P2-06 通知页分区头（667 条通知卡） | **通过** | `notices*.png` |
| P2-07 我的页分组（分区头 4 · 封面 3） | **通过** | `me*.png` |
| P2-08 隐私页层级（page-title 1 · 小节标题 4） | **通过** | `privacy.png` |
| P2-09 天气总入口分区头 | **通过** | `weather-hub*.png` |
| P2-10 lab 渲染（分区头 4） | **通过** | `lab.png` |
| tabBar 底隙修复复拍（4 页 × 平视/滚动） | **通过** | `*-tabbar*.png` |
| 夹具清理 | **部分**：已 transition→cancelled；发布态活动按域规则不可删 | `phase2-interaction-round2.json` |

两轮的首轮 FAIL（P2-03a/P2-04a）均为**驱动侧问题**（等待不足/未带 id、夹具不可报名），
已在补轮以真实通过收口；判据与读数全部入库，未静默改判。

### 6.2 回归（全量 `tools/*-test.js`）

- **74 套 exit 0 / 0 失败**（`evidence/gate-phase2-sweep.txt`；3 套设备套件按基线惯例单独处理）。
  较第一轮的 72 套增加 2 套 = 合并 `13cb844` 带入的他人新门禁，同样全绿。
- `check.js`（WXML 配平/node --check/209 处 require）与 `check-handlers.js`（34 模板宿主
  dataset 契约 + 门 B 死 handler 未增加）均 exit 0。
- 直接相关套件：`scenario-signup 104/0`、`scenario-editor 153/0`、`scenario-me 143/0`、
  `routes-test 68/0`、`journey-graph 15/0`、`style-semantics 92/0`、`scenario-notices 67/0`、
  `g2-platform-gate 15/0`、`trip2-gates 76/0`。

### 6.3 未验证 / 不适用

- **小屏（≤375px）**：自动化通道仍无法切换模拟器机型（与第一轮同一限制）——UNVERIFIED；
  本轮用 39 字超长路线名（真实数据 `月亮湖穿越伍须海-1790560849819.gpx.bin_tmp`）验证了 hero
  长标题 3 行折行不溢出（`route.png` 顶部）。
- **封面加载失败回退**：代码路径与第一轮相同（`binderror`→`img-failed`），本轮未注入坏图——UNVERIFIED（继承第一轮状态）。
- **route-edit 的保存动作**：为不污染共享开发云的存量路线（289 条），本轮只验渲染与 sticky 在位，
  未真实点「保存修改」——保存链路由 `routes-test 68/0`（云端契约）+ 既有场景测试覆盖。
- **weather-chart 深度改造**：不适用（任务冻结天气逻辑；且审查确认其样式已全部 token 化）。

## 7. 全页面完成矩阵（20 页，两轮累计）

| # | 页面 | 状态 | 验证 |
|---|---|---|---|
| 1 | home | ✅ 完成（一：编辑式卡片；二：tab 底隙） | 真机截图+交互 |
| 2 | discover | ✅ 完成（一：编辑式卡片） | 真机截图+交互 |
| 3 | activity | ✅ 完成（一：视觉标杆） | 真机截图+交互 |
| 4 | signup | ✅ 完成（二：分区头+sticky 提交栏） | 真机截图+勾选交互 |
| 5 | editor | ✅ 完成（二：分步+分区头+sticky 操作栏） | 真机截图+切步交互 |
| 6 | routes | ✅ 完成（二：分组+编辑式头部） | 真机截图 |
| 7 | route | ✅ 完成（二：hero-cover+分区头） | 真机截图+导航交互 |
| 8 | route-edit | ✅ 完成（二：分区头，sticky 保持） | 真机截图 |
| 9 | workspace | ✅ 完成（一：指标带+分区头） | 真机截图+交互 |
| 10 | me | ✅ 完成（一：封面缩略；二：三组重整+tab 底隙） | 真机截图 |
| 11 | notices | ✅ 完成（二：分区头+tab 底隙） | 真机截图 |
| 12 | anotices | ✅ 完成（二：与 notices 同步） | check-handlers（dataset 契约） |
| 13 | weather-hub | ✅ 完成（二：分区头+tab 底隙） | 真机截图 |
| 14 | weather | ✅ 完成（一：token 对齐；天气逻辑冻结） | 真机截图+日卡/切窗交互 |
| 15 | weather-chart | ✅ 无需改动（审查确认已 token 原生） | 静态审查 |
| 16 | privacy | ✅ 完成（二：死类修复，真实层级） | 真机截图 |
| 17 | lab | ✅ 完成（二：分区头；阶段徽标仍显英文枚举→遗留） | 真机截图 |
| 18 | staff | ⛔ 不适用本轮（薄壳页被门禁钉死，建议单独一轮） | — |
| 19 | vehicle | ⛔ 不适用本轮（同上） | — |
| 20 | cloud-field-poc | ⛔ 不适用（POC 页） | — |

「✅ 完成」= 代码改造完成 + 真实渲染通过（或静态审查豁免有据）；`staff`/`vehicle`/`cloud-field-poc`
按第一轮即登记的边界保持不动，不是本轮遗漏。

## 8. 剩余工作与下一轮优先级

1. **staff/vehicle 深度对齐**（中收益、中风险）：需先补测试钉点再动结构（两页被 trip2/golden-path
   钉死）；建议单独一轮，照本轮 signup 的「先核钉点→改→跑门禁→真机」流程。
2. **lab 页阶段徽标显示英文枚举**（低收益、低风险）：`{{activity.phase}}` 直接印 `published`，
   应走 `format.PHASE_LABELS`；dev-only 页面，随手可修。
3. **小屏（≤375px）复验**：需人工在开发者工具切 iPhone SE 复看 hero/卡片/工作台/新 sticky 栏。
4. **真活动封面图**：需服务端给活动/路线模型加图片字段（schema 变更，须走 ADR）；
   当前「氛围图 + 诚实性脚注」是诚实下限。
5. **封面失败回退注入验证**：补一条往 `covers.coverFor` 塞坏路径的用例即可闭合（低成本）。
6. **候补双按钮的 e2e 固化**：signup sticky 栏在 `capacityAsk` 下的双按钮次序目前只有真机证据，
   建议补一条 e2e-ui 断言钉住（防未来回归）。

## 9. Git 与交付状态

| 项 | 状态 |
|---|---|
| 本轮提交（分支 `win/ui-redesign-editorial`，未推送） | `8a4564d` merge(13cb844) → `0762ed4` feat 二阶段主提交 → `ac7a5c1` fix tabBar 底隙 |
| 改动文件（二阶段） | 11 个页面 wxml（signup/editor/routes/route/route-edit/me/notices/anotices/privacy/lab/weather-hub）+ `routes.js`/`route.js`（分组与封面派生，纯展示层）+ `home.wxml`（tab 类）+ `app.wxss`（`.with-tabbar` 规则）+ 文档与证据 |
| 业务逻辑 | 零变化：无命令、无 schema、无权限、无天气算法改动；`route.js`/`routes.js` 只新增展示派生字段（cover/mineRoutes/sharedRoutes）与 `onCoverError` |
| cloudfunctions/ | 零改动 ⇒ 不需重新部署 |
| 他人在途 | `d:/OurTrail`（`13cb844` 已合入）与 `d:/OurTrail-skill-uplift` 零触碰 |
| 合并建议 | `git merge --no-ff win/ui-redesign-editorial`（本分支已含 `13cb844`，合并即快进到共同后代之后；上轮试合并已证与 fix-round-2 无冲突） |
| 云端残留 | 一条已取消的验收夹具活动「[UI二阶段] 赵公山 · 东线穿越（报名验收夹具）」（域规则不允许删已发布活动，取消即业务终态） |

## 10. 方法论备忘（给下一轮）

1. **自动化会话偶发元素通道退化**：`page.$$` 返回 null 且重启 IDE+auto 无效时，先怀疑驱动脚本
   自身（本轮一例是 `page.$$` 未绑 this）——先跑最小探针再动 IDE。
2. **造可报名夹具的正确姿势**：`activity.publish` 的 `participation` 是 specNull（字段必须在、值可
   null）——传 `null` 才能得到「本人可报名」状态；revision 是全局 CAS，每次 dispatch 都要带刚读到的值。
3. **发布态活动无法删除**是域规则：验收夹具清理由 transition→cancelled 收口，不要试图绕过。
