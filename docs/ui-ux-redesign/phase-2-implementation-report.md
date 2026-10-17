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

**自定义 tabBar 底隙**：曾判为「四个 tab 页完全没有底部留白」，并据此新增了公共类
`.page.with-tabbar { padding-bottom: calc(84px + env(safe-area-inset-bottom)) }` 与四个 tab 页的挂类。
**round 3 复查判定该结论错误并已回退**，证据如下：

- 仓库既有约定（`miniprogram/AGENTS.md:96`）已写明：tab 页用
  `padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom))`，且**四个 tab 页各自的 wxss 里早已存在**
  （`home.wxss:2`、`me.wxss:2`、`notices.wxss:2`、`weather-hub.wxss:6`）——我的公共类是在此之上**再叠 84px**。
- 真机复验（撤掉公共类与四个挂类后逐页滚到底复拍）：四页尾部内容**完整可见、未被 tabBar 遮挡**，
  见 `screens/phase2/tabbar-final-{weather-hub,me,notices,home}.png`。
- 起因是我把一张中途滚动位置的截图读成了「被 tabBar 压住」，属**归因错误**，不是产品缺陷。
- 处置：回退公共类与四个挂类（`ac7a5c1` 的这部分），并把新门禁 `T1.4` 改成
  **反向断言两种落法不得并存**（否则就是 84px 死空白），把这次的教训固化成门禁。

**同批修好的真实缺陷**（仍然成立）：`privacy` 页的 `.container/.h1/.h2` 全站无定义（标题按正文默认字号渲染），
已改为 `section-head` 体系；见 §2 与 §11。

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
  > round 3 收尾时复扫为 **74 绿 / 1 红**，该红（`outdoor-intelligence-ui` 45/2）已在基线提交对拍确认为
  > 先于本轮存在，详见 §11.5。
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
| 17 | lab | ✅ 完成（二：分区头；三：阶段徽标改中文标签） | 真机截图 |
| 18 | staff | ✅ 完成（三：编辑式头部，`stack`→`stack-sections`） | scenario-staff 25/0 |
| 19 | vehicle | ✅ 完成（三：清点分区头；根容器类受门禁钉住保持 `.stack`） | scenario-vehicle 57/0 |
| 20 | cloud-field-poc | ⛔ 不适用（POC 页，非业务页面） | — |

「✅ 完成」= 代码改造完成 + 真实渲染通过（或静态审查豁免有据）；`cloud-field-poc` 按登记边界保持不动。
**19/20 个业务页面已完成**（第 20 个为 POC 页，不计入业务页面）。

## 8. 剩余工作与下一轮优先级（round 3 已更新）

**已在本轮收尾闭合**（详见 §11 遗留项闭合记录）：

1. ~~staff/vehicle 深度对齐~~ → **已做（受钉点约束的安全部分）**：`staff` 头部升级为编辑式头部；
   `vehicle` 的「应到/已上车」两行文字升级为分区头（人数与状态绑成一组）。**未动** `vehicle` 根容器类
   ——`scenario-vehicle-test` 把字面量 `<view wx:else class="stack">` 钉住（用途是保证 wx:else 分支存在），
   已保留并写明原因，不擅改公共门禁。
2. ~~lab 页阶段徽标显示英文枚举~~ → **已修**：`lab.js` 用 `format.PHASE_LABELS` 派生 `phaseText`，
   模板改印中文阶段名（不再给用户看 `published`）。
3. ~~封面失败回退注入验证~~ → **已闭合**（真机注入坏路径，见 §11）。
4. ~~候补双按钮/全局一致性的回归防线~~ → **已落地**为新门禁 `tools/ui-consistency-test.js`（17 项断言）。

**仍然开放**（按对用户体验的影响排序）：

1. **真活动封面图**（高收益、需服务端配合）：需给活动/路线模型加图片字段（schema 变更，须走 ADR）；
   当前「氛围图 + 诚实性脚注」是诚实下限，不是终态。
2. **小屏（≤375px）真机复验**（中收益、环境受限）：自动化通道无法改小程序视口（已实测 CDP
   `Emulation.setDeviceMetricsOverride` 对 `windowWidth` 无效，仍为 390），需人工在开发者工具切
   iPhone SE/375 机型复看 hero/卡片/工作台/sticky 栏；静态口径已由新门禁 §5 兜住（无超宽固定宽度、
   指标格 `min-width:0`、大标题断词保护）。
3. **`weather`/`weather-chart` 的表达升级**（中收益、需单独立项）：任务约束冻结天气逻辑，本轮仅确认其
   样式已全部 token 化；若要进一步提升专业信息表达，需先明确「只改布局不改算法」的边界并单独排期。
4. **POC 页 `cloud-field-poc` 清理**（低收益）：非业务页面，建议下轮直接从路由里摘除或标注为开发工具。

## 9. Git 与交付状态

| 项 | 状态 |
|---|---|
| 本轮提交（分支 `win/ui-redesign-editorial`，未推送） | `8a4564d` merge(13cb844) → `0762ed4` feat 二阶段主提交 → `ac7a5c1` fix tabBar 底隙（**其中 tabBar 部分已在 round 3 回退**）→ `1cbc5da` docs 二阶段报告 → `d1d5fa9` feat 遗留项闭合 → `4db8f7f` docs 报告更新 → `<r3-fix>` 见 §11.6 |
| 改动文件（二阶段） | 14 个页面（signup/editor/routes/route/route-edit/me/notices/anotices/privacy/lab/weather-hub/staff/vehicle）+ `routes.js`/`route.js`（分组与封面派生，纯展示层）+ `lab.js`（中文阶段标签派生）+ **新增 `tools/ui-consistency-test.js`** + 文档与证据（`app.wxss`/`home.wxml` 的 tabBar 改动已在 round 3 回退） |
| 业务逻辑 | 零变化：无命令、无 schema、无权限、无天气算法改动；`route.js`/`routes.js` 只新增展示派生字段（cover/mineRoutes/sharedRoutes）与 `onCoverError` |
| cloudfunctions/ | 零改动 ⇒ 不需重新部署 |
| 他人在途 | `d:/OurTrail` 有另一 Agent 的**未提交**在途改动（57 个脏文件 + 20 个新门禁文件），`d:/OurTrail-skill-uplift` 零触碰 |
| 与在途任务的文件级重叠 | 仅 **3 个文件**：`miniprogram/app.wxss`、`pages/route/route.wxml`、`pages/weather-hub/weather-hub.wxml`（其余 57 个改动文件与对方无交集）。round 3 回退 tabBar 改动后，`app.wxss` 的重叠**已自动消失**，剩 2 个 WXML |
| 剩余 2 个 WXML 的重叠性质 | `route.wxml`：对方给「按出发时刻推算」加了 `.check-label` 触点包裹（可叠加在我的重写之上）；`weather-hub.wxml`：对方改文案、保留 `.card-label`，而我改成了 `section-head`——**这是设计方向分歧，需人裁决**（见 §11.7） |
| 合并建议 | 先让对方的在途任务落地，再 `git merge --no-ff win/ui-redesign-editorial`；冲突面只剩 2 个 WXML，其中 weather-hub 需人工决定「分区头 vs 卡片头+说明句」 |
| 云端残留 | 一条已取消的验收夹具活动「[UI二阶段] 赵公山 · 东线穿越（报名验收夹具）」（域规则不允许删已发布活动，取消即业务终态） |

## 10. 方法论备忘（给下一轮）

1. **自动化会话偶发元素通道退化**：`page.$$` 返回 null 且重启 IDE+auto 无效时，先怀疑驱动脚本
   自身（本轮一例是 `page.$$` 未绑 this）——先跑最小探针再动 IDE。
2. **造可报名夹具的正确姿势**：`activity.publish` 的 `participation` 是 specNull（字段必须在、值可
   null）——传 `null` 才能得到「本人可报名」状态；revision 是全局 CAS，每次 dispatch 都要带刚读到的值。
3. **发布态活动无法删除**是域规则：验收夹具清理由 transition→cancelled 收口，不要试图绕过。

## 11. 遗留项闭合记录（round 3，2026-10-17 续做）

用户要求「继续完成遗留任务」后，本轮把二阶段报告 §8 里能安全落地的遗留项逐条做完，
并把其中「靠人眼发现」的部分固化成新门禁。

### 11.1 代码改造（3 个页面）

| 页面 | 改动 | 钉点处理 |
|---|---|---|
| `staff` | 头部由 `eyebrow + page-title + muted` 升级为 `section-head`（kicker + page-title + section-sub），容器 `stack` → `stack-sections` | `scenario-staff-test 25/0` |
| `vehicle` | 「应到 N 人 · 已上车 M 人 + legState」由两行裸文字升级为分区头（kicker 清点 + section-title + section-sub），与下面的名单归为一组 | **根容器类保持 `.stack`**：`scenario-vehicle-test` 场景 6 把字面量 `<view wx:else class="stack">` 钉住（保证 denied/loading 的 wx:else 分支存在）。第一版改成 `stack-sections` 立刻把该门打红（56/1），已回退并把原因写进模板注释；`.seg` 与「确认本程发车 / 完成本程行驶」按钮文案原样保留 |
| `lab` | 阶段徽标不再直印服务端枚举：`lab.js` 用 `format.PHASE_LABELS` 派生 `phaseText`，模板改印中文阶段名 | `scenario-lab-test` 绿；未引入新枚举比较（journey 门 C/D 仍绿） |

### 11.2 新增门禁 `tools/ui-consistency-test.js`（17 项断言，全绿）

把两轮里「人眼才发现」的问题变成会红的门：

- **§1 tabBar 底隙**：`app.json` 仍是自定义 tabBar ⇒ 规则 `.page.with-tabbar{84px+安全区}` 必须存在；
  **app.json 里每个 tab 页都必须挂 `with-tabbar`**；反之非 tab 页不得挂（否则白留空白）。
- **§2 固定底栏**：用 `sticky-action` 的页面必须配 `has-sticky`；`has-sticky` 的条件表达式与底栏
  `wx:if` 必须同源（页面层再钉一次 g2-platform-gate 的口径）。
- **§3 封面绘制路径**：`hero-cover` ≥2 个使用方；媒体盒必须**定高 px**（不是百分比高）；
  封面 `<image>` 不得绝对定位；每个 hero 必须绑 `binderror`（破图零容忍）。
- **§4 死类普查**：WXML 里出现、但**任何 WXSS 都没定义**的类必须为 0。
  （这正是 `privacy` 的 `.h1/.h2` 与四个 tab 页的 `.with-tabbar` 当年被发现的机制；
  判据内置了修饰符前缀 `status-panel--{{kind}}` 的容错，并有「普查器自身有效」自查项防假绿。）
- **§5 小屏静态口径**：375 内容区（335px）不得有超宽固定宽度声明，**横滚容器内的宽表按设计豁免**
  （天气页 `.num-table min-width:760px` 是「全字段横滚表」，并用 `T5.1b` 反向断言该豁免不是空跑）；
  顶层 `.metrics` 是多格 flex 且 `.metric` 有 `min-width:0`；大标题与事实值有断词保护。

### 11.3 封面加载失败回退：真机注入验证（闭合）

- 注入方式：`page.setData` 只把展示层 `cover` 指向不存在的路径（`/assets/photos/__not_exist__.jpg`），
  不碰业务数据与云端契约。
- 读数：`coverFailed` 由 `false → true`；**媒体盒高度 240 → 240px 不变**（页面不塌）；
  被隐藏的 `<image>` 为 0px；恢复真实封面后 `coverFailed` 复位、封面重绘 350×240。
- 截图：`screens/phase2/cover-fallback.png`（纯森林绿 hero，标题/指标/徽标保留，无破图）、
  `cover-restored.png`。证据：`evidence/phase2-cover-fallback.json`。
- **口径修正（自我纠错）**：第一条驱动把「被隐藏的 `<image>` 240→0」写成了「媒体盒未塌」，
  属措辞不实；补测了媒体盒本体尺寸后才给出通过判定。

### 11.4 小屏真机验证：确认当前环境做不到（UNVERIFIED，不假绿）

- 尝试 CDP `Emulation.setDeviceMetricsOverride(width=375,height=667,deviceScaleFactor=2,mobile=true)`：
  调用成功且会**断掉 automator 连接**（需重连），但重连后 `wx.getSystemInfoSync().windowWidth` **仍为 390**
  ⇒ 该通道对小程序视口无效（模拟器视口与页面 CSS 视口分离）。
- 因此不把「行宽 318px」当成小屏证据（该值在 390 下同样是 318，属无效对照，已作废）。
- 结论：**小屏（≤375px）真机渲染仍为 UNVERIFIED**，需人工切机型复看；
  已用 §5 静态门禁兜住可静态判定的部分，并在 §8 保留为公开遗留项。

### 11.5 round 3 回归

- 新增 `tools/ui-consistency-test.js` 已纳入 `tools/*-test.js` 扫尾。
- **round 3 全量扫尾：74 套 exit 0 / 1 套非绿**（`evidence/gate-phase2-round3-sweep.txt`）。
  唯一非绿是 `outdoor-intelligence-ui`（`passed=45 failed=2`）——**该套读生产实时气象**，
  已在基线提交 `8a4564d`（本轮全部 UI 改动之前）单独复跑对拍，读数**逐项一致**（同 45/2，
  含 `tier ∈ {确定, 很值得关注, …}` 与「确定性」段两处）⇒ 与本轮无关，属先于本轮存在的问题，
  未擅动该套件（改动天气线需单独立项）。
- 改动页面对应套件：`scenario-vehicle 57/0`、`scenario-staff 25/0`、`scenario-lab` 全绿、
  `journey-graph 15/0`、`style-semantics`、`g2-platform-gate`、`check.js`、`check-handlers.js` 全绿。
- 相较二阶段报告 §6.2（当时 74 套 exit 0 / 0 失败）：本轮多出一套新门禁（17 项断言），
  并把天气线那条常驻红**从「恰好绿」纠正为「基线即红」并留证**——比上一版更准确。

### 11.6 round 3 自我纠错：tabBar「缺陷」是误判，已回退

- 复查触发点：交接地实时清点了对方在途改动，发现他们的 `app.wxss` 注释里**明确否决**了
  「收成 `.page.with-tabbar` 类」这条路径，并引用 `tools/b4-pad-final-value-test.js §7 方向 B-2`
  专门把这种写法判红。
- 回查约定：`miniprogram/AGENTS.md:96` 早已写明 tab 页的 padding 口径，且四个 tab 页各自 wxss 里
  本来就有 `calc(32px + 84px + env(safe-area-inset-bottom))` ⇒ 我的公共类是**叠加**而非补缺。
- 真机复验（撤掉后逐页滚到底复拍）证实四页尾部均不被遮挡 ⇒ 原结论错误（见 §3）。
- 处置：回退 `ac7a5c1` 里的 `app.wxss` 规则与四个 wxml 挂类；删除失真的 `*-tabbar*.png` 证据，
  换成 `tabbar-final-*.png`；新门禁加 `T1.4` 反向断言「两种落法不得并存」。
- 净效果：本分支不再有 tabBar 空白问题，也不再与对方的 B4-PAD 门禁冲突；`app.wxss` 重叠随之消失。

### 11.7 留给下一轮的一处设计分歧（需人裁决）

`pages/weather-hub/weather-hub.wxml` 我与在途任务方向不同：

| 方案 | 分区头（我，二阶段） | 卡片头 + 说明句分工（对方在途） |
|---|---|---|
| 结构 | `.section-head`（kicker「轨迹」+ section-title「导入 GPX 轨迹」） | `.card` + `.card-header` + `.card-label`「有 GPX 轨迹？逐点看天气」 |
| 分工 | 分区头承担标题，说明句另起一行 | 标题承担「为什么」，按钮承担「做什么」 |

两边都自洽；合并时二选一即可（建议二选一重组：保留对方文案 + 我的 `section-head` 结构，
并保留我这边已验证的行组 `padding:4px 16px`）。本轮不擅自改动对方文件。
