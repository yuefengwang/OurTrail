# Style-B 逐屏保真 —— 实现任务书（可直接派工）

日期：2026-10-26 · 输入：`style-b-fidelity-matrix-2026-10-26.md`（逐屏差距与推荐裁决）· 参考屏：`reference/screens-2026-10-20/`

## 0. 一句话

**先冻结共用层，再按页组并行；每屏以「板上的结构块是否出现」验收，不以「门禁是否绿」验收。** 没有这一步，任何「继续收口」都会重复上一轮：门禁全绿、页面仍旧。

### 前置（缺一不开工）

1. 负责人对矩阵 §4 的 C1–C10 推荐裁决给出一句确认；要改的给编号与口径。
2. 分支与工作树确认：`git status` 只含本任务改动；用户未跟踪文件（`OurTrailNightBu.txt`、`OurTrail_UI_交付包/` 等）不碰。
3. 本轮不 commit / 不 push / 不部署，除非再次授权。

---

## 1. 派工原则（硬约束）

| # | 规则 | 原因 |
|---|---|---|
| 1 | **一个文件同一时间只有一个写者** | 并发改同一文件必冲突；共用层尤其 |
| 2 | **Slice 0 未冻结前，任何页面切片不得改 L2 组件或 `app.wxss`** | 否则 21 页同时漂移，后面全部返工 |
| 3 | 不改 `cloudfunctions/`、`domain/`、`schema`、`utils/journey.js`、任何天气阈值、`--chart-ramp` | 这是 UI 轮次，不是业务轮次 |
| 4 | 不新增色值/token；新 token 只能进 `app.wxss` 并登记 `design-system.md` | 铁律 17 |
| 5 | 不加中央 FAB、不加金额/收藏/分类字段、不新增路由或 tab | D5/D10 与零金额定位 |
| 6 | 不用 `page.data()` 读数冒充渲染证据；无截图不得写「视觉验证通过」 | 铁律 21/32⑥ |
| 7 | 需要 schema/云函数/新页面才能实现的结构块，**停下来写裁决请求**，不许自造字段或塞假数据 | 业务变更必须单独裁 |

---

## 2. 切片与文件归属

### Slice 0 —— 共用层与 L2 组件（必须先做，单写者）

**文件白名单：**
- `miniprogram/app.wxss`
- `components/brand-header/*`
- `components/chapter/*`
- `components/fact-grid/*`
- `components/activity-card/*`
- `components/next-up-card/*`
- `components/activity-hero/*`
- `components/route-profile/*`
- `components/equipment-grid/*`

**不做：** `custom-tab-bar/**`（D5 已定 4 tab，现有底栏不改）、任何页面文件。

**先交（Gate G0，只交文档不写代码）：**
1. **Token 与字阶表**：板上量到的字号/行高/圆角/间距/卡片内边距，逐项映射到现有 token；缺的列「需要新增」并给出唯一的 `app.wxss` 落点。
2. **L2 组件契约**：`activity-card` / `next-up-card` / `chapter` / `fact-grid` / `route-profile` / `equipment-grid` 的槽位、状态（有/无数据、封面失败、空清单）、尺寸上限。
3. **首屏线框**：8 个有参考屏页面各一张文字线框（block 顺序 + 每块高度/间距），标出哪些块复用哪个组件。
4. **改动面清单**：只列要改的文件与函数，不写代码。

**通过后再实施**，并保证：
- `node tools/check.js` → `ALL CHECKS PASSED`
- `node tools/check-handlers.js` 无新增死 handler
- 受影响套件：`smoke`、`swx1`、`swx2`、`page2-gates`、`m02-class-scope`、`a20-owner-hero`、`activity-l2-structure`、`nav-chrome`、`ui-consistency` 全绿
- 真机：首页 + 详情页各一张，证明卡片/按钮/分区头的新形态真的渲染

### Slice 1 —— 发现线（依赖 0）

**文件：** `pages/home/*`、`pages/discover/*`
**覆盖：** 01-1、01-2、01-3、01-4
**要点：** 首页状态卡用大图卡；发现列表改紧凑行；地图模式改满屏 + 底部抽屉；筛选 sheet 照四组；删除页头口号（C9）。
**不做：** 分类 chip 行（D10）、金额/收藏（C3）、底图修复（UNVERIFIED）。

### Slice 2 —— 详情线（依赖 0）

**文件：** `pages/activity/*`
**覆盖：** 02-1、02-2、02-3、02-4、02-5、04-1、04-5
**要点：** 首屏构图；6 段锚点外观；剖面加指标与关键节点；行程按天分组；装备分段+勾选；天气章改「出发窗口卡」；风险章加派生决策建议。
**不做：** 改 6 段语义（D6/C4）、加收藏（C3）、新建风险页、造路线时刻。

### Slice 3a —— 工作台（依赖 0）

**文件：** `pages/workspace/*`、`components/field-panel/*`
**覆盖：** 03-1
**要点：** 总览顶部「出发前检查」清单；深绿色块从原生导航下开始；四段名保持现有（C5）。
**注意：** `field-panel` 也被 `pages/staff` 使用，改契约要同步检查 `staff`。

### Slice 3b —— 名单与交通（依赖 0）

**文件：** `components/roster-panel/*`、`components/transport-panel/*`
**覆盖：** 03-2、03-3
**要点：** 行高/头像/徽章/计数；车辆卡底部 primary「添加车辆」；保留批量审核、导出、座位图。

### Slice 3c —— 任务与通知（依赖 0）

**文件：** `pages/tasks/*`、`pages/anotices/*`、`pages/notices/*`
**覆盖：** 03-4、03-5
**要点：** 任务行单行化；保留状态筛选（C6）；通知用现有模型做板上排版，不做聊天流/图片（C8）。

### Slice 4 —— 天气线（依赖 0 与 2）

**文件：** `pages/weather/*`、`pages/weather-hub/*`
**覆盖：** 04-2、04-4；`weather-hub` 仅视觉语言
**要点：** 图上方逐时摘要带；下方降水概率行；四行默认可见摘要 + 可展开全表；来源常驻；删口号。
**不做：** 重画图表、碰 `--chart-ramp`、改任何阈值（D7）、`04-3` 路段屏（C11）。

### Slice 5 —— 无参考屏 13 页（最后做，可拆 3 个写者）

- **5a：** `pages/me/*`、`pages/signup/*`、`pages/editor/*`
- **5b：** `pages/routes/*`、`pages/route/*`、`pages/route-edit/*`、`pages/weather-chart/*`
- **5c：** `pages/vehicle/*`、`pages/staff/*`、`pages/lab/*`、`pages/privacy/*`、`pages/cloud-field-poc/*`

**只做：** 跟随 Slice 0 的 token/组件自动收敛；导航、四态、底部留白不回归；真实内容页做一次首屏结构审查。
**不做：** 发明板上没有的模块；凭 denied 态改结构（`signup`/`staff`/`vehicle` 的真实态 UNVERIFIED）。

---

## 3. 每个页面切片的输入

写者开工前必须自己读（不许从摘要继承）：

1. 本任务书 + `style-b-fidelity-matrix-2026-10-26.md` 的对应屏条目 + 参考屏 PNG。
2. `.agents/skills/ourtrail-ui/SKILL.md` 与 `references/ui-methodology.md` §0/§2/§5（主任务、结构选型、六态）。
3. 目标页 WXML/WXSS/JS 全文；目标组件全文；`app.wxss` 的 token 段。
4. `miniprogram/AGENTS.md`（页面骨架与注册规则）。
5. 相关门禁套件的判据（不要靠猜）：`tools/activity-l2-structure-test.js`、`operations-layout`、`entry-layout`、`personal-route-layout`、`weather-page-test` 等。

---

## 4. 每屏验收：结构块清单

对每个参考屏，交付报告里必须逐块打勾，写「出现 / 未出现 / 有意偏离」，并给 `file:line`：

| 屏 | 必须出现的结构块 |
|---|---|
| 01-1 | 品牌区；下一次同行大图卡（封面+标题+日期+名额）；动作行；第二屏搜索+功能分段；活动卡列表 |
| 01-2 | 搜索；视图分段；筛选触发；紧凑行（缩略图+标题+日期+指标+名额）；发丝线 |
| 01-3 | 满屏地图；顶部悬浮搜索；标记；底部选中卡；实心「查看详情」 |
| 01-4 | 四组筛选块（有字段才出现）；日期区间；底部单 primary；清除 |
| 02-1 | 全出血封面；浮起信息卡；状态说明；6 段锚点；sticky 主操作 |
| 02-2 | 6 段锚点；路线四指标；地图；剖面；上车点 |
| 02-3 | 剖面图；指标行；关键节点（时刻缺则只印名/海拔） |
| 02-4 | 天分组（有日期才分）；节点名/时刻；真实内容图（有才放） |
| 02-5 | 必带/建议分段；可勾选清单；费用章；底部主操作 |
| 03-1 | 身份头；四段；出发前检查清单（计数+行）；三指标；工具区 |
| 03-2 | 报名/待确认计数；搜索；成员行+状态徽章；批量条（勾选后） |
| 03-3 | 车辆/座位指标；车辆卡；座位图；添加车辆 primary |
| 03-4 | 状态筛选；单行任务（状态点+标题+负责人+胶囊）；新建入口 |
| 03-5 | 发布者/时间/正文；关联活动；查看天气；空态 |
| 04-1 | 活动身份；出发窗口卡（时段+依据）；风险提示；查看路线天气 |
| 04-2 | 逐时摘要带；图；降水概率行；日卡；天相条 |
| 04-3 | **本轮不做**，报告里明确写 `NOT_IMPLEMENTED(scope)` |
| 04-4 | 四行摘要；可展开全表；来源+更新时间 |
| 04-5 | 风险卡；派生决策建议；回跳完整预报 |

**判定规则：** 结构块缺失且不是矩阵 §4 的裁决偏离 → 该屏未完成；结构块出现但数据是注入的假值 → 只算 E2，不算交付。

---

## 5. 真机验收流程（每片）

1. **通道：** `cli islogin` → `cli close --project 'D:\OurTrail' --port 33278` → `cli open` → sleep → `cli auto --project 'D:\OurTrail' --auto-port 9421 --trust-project --port 33278`。`cli quit` 需单独授权。
2. **bundle 新鲜度自证：** 选一句只存在于本次改动的新文案或新类名，必须先出现在屏上；否则整批截图无效。
3. **数据门槛链：** 每页注入/读取后先断言渲染门槛（如天气页 `denied=''`、`loading=false`、`dayCards.length>0`、`unified!=null`），否则元素不在 DOM 里，读数是假的。
4. **污染自证：** 每用例前 `reLaunch`；两用例给不同 `updatedAt`；两次读数必须不同，相同判整批无效。
5. **截图：** 每屏 390 宽 full 一张 + 375 宽首屏一张；与参考屏并排看。
6. **落盘：** `docs/ui-ux-redesign/evidence/style-b-fidelity-<slice>-2026-10-2x/`，README 写：环境、bundle 自证方式、真实/注入数据、逐块勾选、UNVERIFIED 清单。
7. **跑不动：** 记 `ENV-ABORT`，不是 PASS，也不是产品红。

---

## 6. 停止条件（出现即停，不要自行绕过）

- 需要改 schema / `cloudfunctions/` / `domain/` / 新路由 / 新 tab / 新 token 才能实现 → 写裁决请求。
- 参考屏的结构块依赖本产品没有的数据（金额、收藏、图片消息、个人/团队归属、路段时刻）→ 按矩阵 §4 的推荐跳过，在报告里点名，不自造。
- 静态门红且无法归因 → `git archive HEAD` 干净副本复现；同红登记，不同红先修。
- 真机通道不可用 → `ENV-ABORT`，交付缺口与结论上限。
- 发现共用层改动导致 3 页以上不可解释回归 → 回退该批，重新冻结契约（允许回退到 clean，不许留半成品）。

---

## 7. 交付报告格式（每片一份）

```markdown
# Slice <n> 交付 —— <名称>
## 1. 改动文件（逐个，+/- 行数）
## 2. 逐屏结构块勾选（出现/未出现/有意偏离 + file:line）
## 3. 静态门读数（check.js / check-handlers / 受影响套件 passed-failed）
## 4. 真机证据（路径；bundle 新鲜度自证；污染自证；逐张说明）
## 5. UNVERIFIED（明确列出没验到的）
## 6. 偏离与裁决请求（编号 + 证据 + 选项）
## 7. 未做（scope 外，写清为什么）
```

---

## 8. 可直接复制的 Agent 提示词

### 8.1 Slice 0（先交设计，不写代码）

```text
你是 OurTrail 小程序的 UI 共用层负责人。任务是把 style-B 的 L2 视觉语言冻结到与 10-20 设计板同构，
本阶段只交实现级设计，不改任何代码。

必读（自己读原文，不要从摘要继承）：
- docs/ui-ux-redesign/style-b-fidelity-matrix-2026-10-26.md
- docs/ui-ux-redesign/style-b-implementation-taskbook-2026-10-26.md
- docs/ui-ux-redesign/reference/screens-2026-10-20/README.md 与 19 张 PNG
- .agents/skills/ourtrail-ui/SKILL.md 及 references/ui-methodology.md §0/§2/§5
- miniprogram/app.wxss、miniprogram/AGENTS.md
- 以下组件全文：brand-header、chapter、fact-grid、activity-card、next-up-card、
  activity-hero、route-profile、equipment-grid

交付一份文档 docs/ui-ux-redesign/style-b-shared-layer-spec-2026-10-26.md，包含：
1. 板上量到的字阶/间距/圆角/卡片内边距，逐项映射到现有 token；缺的列「需要新增」+ 唯一 app.wxss 落点。
2. 8 个 L2 组件的契约：槽位、状态（无数据/封面失败/空清单）、尺寸上限、与页面数据的边界。
3. 8 个有参考屏页面的首屏文字线框（block 顺序 + 高度/间距 + 复用组件）。
4. 改动面清单：只列文件与函数，不写代码。
5. 风险：哪些现有门禁会被共用层改动触发，逐条给套件名与判据。

禁止：改任何页面文件、custom-tab-bar、schema/cloudfunctions/domain、天气阈值、--chart-ramp；
不新增色值（token 只进 app.wxss 并登记 design-system.md）；不 commit/push。
```

### 8.2 Slice 1–5（实施模板）

```text
你是 Slice <n>（<名称>）的唯一写者。只改下面白名单里的文件，其他文件一律不动。

范围（文件白名单）：
<按任务书 §2 填入>

覆盖参考屏：<屏号列表>

必读：
- docs/ui-ux-redesign/style-b-fidelity-matrix-2026-10-26.md 的对应屏条目
- docs/ui-ux-redesign/style-b-implementation-taskbook-2026-10-26.md §1/§4/§5/§6
- docs/ui-ux-redesign/style-b-shared-layer-spec-2026-10-26.md（已冻结的 token 与组件契约）
- 目标页 WXML/WXSS/JS、目标组件全文、app.wxss token 段
- .agents/skills/ourtrail-ui/SKILL.md 与 references/ui-methodology.md §0/§2/§5

要求：
1. 先复述「这页现在解决什么、哪些必须保留」，再列出与参考屏的结构块差异（file:line）。
2. 按矩阵 §4 的裁决实现；遇到需要新 schema/新页面/新 token 的块，停止并写裁决请求。
3. 四态（denied/loading/empty/error）与危险操作必须完整；缺数据不得印成有利事实。
4. 完成后跑：node tools/check.js、node tools/check-handlers.js、<该片受影响套件列表>。
5. 真机：按任务书 §5 走；无截图不得写视觉验证通过；跑不动记 ENV-ABORT。
6. 交付报告按 §7 格式写到 docs/ui-ux-redesign/evidence/style-b-fidelity-slice<n>-2026-10-2x/README.md。

禁止：改白名单外文件；改 schema/cloudfunctions/domain/journey.js/天气阈值/--chart-ramp；
新色值；中央 FAB/金额/收藏/分类；commit/push/deploy。
```

---

## 9. 为什么这次能落地

| 上一轮 | 这一轮 |
|---|---|
| 任务书写「21 页已落地，重做越界」 | 任务书以逐屏结构块为验收，允许改共用层 |
| 9 页判「不改」，其中 3 页因 denied 态不可达 | denied 态不冒充验收；不可达就登记 UNVERIFIED，不拿它当「已对齐」 |
| 验收看门禁与 DOM 读数 | 门禁只作底线；每屏必须有 full + 首屏截图与逐块勾选 |
| 共用层没冻结就批量改页面 | Slice 0 先冻结 token/组件，此后并行不会互相踩 |
| 参考板被判为「旧风格、不是参考」 | 已按用户裁定改为唯一逐屏目标 |
