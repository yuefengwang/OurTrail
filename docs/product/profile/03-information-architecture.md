# 03 · Information Architecture（「我的」信息架构重设计）

> 目标：把「我的」从「资料登记表」重构为 Identity Hub。
> 结构必须落在现有数据能给出的事实上（每个区块标注数据来源），视觉只用现有 token 与组件（见 11）。

---

## 1. 现状 IA 的问题（逐条对代码）

| # | 现状（me.wxml 顺序） | 问题 | 依据 |
|---|---|---|---|
| 1 | 页头「我的同行资料 / 下次出发，少填一点。」 | 定位自述为「资料表」；「下次出发」其实指向报名页的价值，与本页功能错位 | me.wxml:8-9 |
| 2 | 「我的资料」卡 6 个输入控件平铺（头像/昵称/手机号/紧急两列/medical 折叠） | 表单形态；编辑动作与身份展示混在一层 | me.wxml:17-79 |
| 3 | 「微信一键获取（可选）」与「手机号」标题并排 | API 机制暴露在标题层（P1 原则违背） | me.wxml:44 |
| 4 | 无任何活动维度 | 「我的」不知道我去过哪、要去做什么；活动统计与最近活动缺失 | me.js 只读 profile+positionRows |
| 5 | 协作身份码平铺在卡里 | openid 全文展示在资料表中间，与「安全资料」并排，语义归属混乱；也无使用引导层次 | me.wxml:107-118 |
| 6 | 位置授权卡只在有数据时出现（正确），但与安全资料相邻 | 它是「授权管理」不是「资料」；归属应独立成组 | me.wxml:121-131 |
| 7 | error/hint 顶部 callout | 与同行人弹层共用同一 `error` 状态（弹层内也渲染，me.wxml:137），语境混淆 | me.js:198/331/344 |

【CODE FACT】现状页面已具备的正确底子（保留）：denied/loading 两态、自动保存反馈行、
同行人语义句、位置授权说明句、弹层内错误（P0-4 修复，勿回退）。

---

## 2. Target IA（自上而下）

```
我的（Tab 根页；模板：eyebrow + page-title + 一句副标题；底部留白 84px 规则）
│
├─ A. 身份头卡（Hero 区）
│     [头像 64px chooseAvatar]  昵称（type=nickname，无下划线大字，现状样式保留）
│     身份行：由数据推导的一句话（见 §3.1）
│     指标行 .metrics：进行中 · 已完成 · 发起（见 §3.2）
│
├─ B. 反馈区：error / hint callout（位置从页顶移到头卡之下，作用域拆分见 12）
│
├─ C. 最近活动卡（0–3 条 list-row；点击 → 活动详情；空态一句引导）
│
├─ D. 同行与安全卡（摘要行 + 编辑收进弹层——行上只读，右侧 ›）
│     ├─ 手机号        138****8000        ›   （编辑面内含「微信一键获取」捷径）
│     ├─ 紧急联系人    张三 138****0000   ›   （sheet：姓名 + 电话两字段）
│     └─ 健康/用药备注 [已填写 badge]      ›   （sheet：textarea + 用途说明）
│
├─ E. 常用同行人卡（person-row 列表 + 添加；编辑沿用现有 overlay；语义句保留）
│
├─ F. 身份与协作卡
│     ├─ 我的协作码   oX****（缩略展示，行点击 → 详情/复制；说明一行）
│     └─ （P2：二维码入口，见 10）
│
└─ G. 位置授权卡（仅当存在有效位置上报时渲染；标题保留「位置授权」，见 §8）
      └─ 每行：{活动标题 · 人员名}  有效中  [撤回]
         固定说明：「只在活动中主动上报一次位置，不会后台追踪。」
```

【DESIGN DECISION】要点：
1. **D 组把「手机号」从「我的资料」卡移入「同行与安全」**——它在本产品里的第一用途是
   活动联络与安全应急（me.wxml:47 现有文案即此），与紧急联系人同属「别人怎么找到我/保障我」。
   昵称与头像升入 A 组成为身份本身。
2. **A 组统计与 C 组最近活动**是「我的」成为 Hub 的最低限活动维度（P8 原则）。
3. **不设「设置」占位入口**——review-checklist 明令禁止无功能的筛选项/入口；通知已有独立 Tab。
4. **G 组保留在「我的」**：位置授权是活动级授权，但「查看我在哪些活动里还有效授权/撤回」
   天然是账号级诉求，且入口数据（meta.positionRows）就是为这页算的（selectors.js:284 注释
   「『我的』页的位置授权撤回入口」）；详情页的行内撤回入口（activity.js:520-522）保留，两处互补。
5. 编辑面一律 overlay（sheet），不新增子页——P0 阶段新增页面数为 **0**；
   P2 若做协作码详情页/二维码，再评估独立页 `pages/identity`。

---

## 3. 各区块数据来源（关键：全部来自已有读，P0 零新增 API）

### 3.1 身份行文案

【CODE FACT】可选素材（全部已存在于前端可及数据）：
- person.name（profile 读）；
- 统计计数（§3.2）；
- Membership：本人是否被授权过 staff/vehicle_contact（home 视角 staff/vehicle 布尔可获得，
  但「我的」页当前不读这两个视角——**P0 不展示协作身份行**，避免为一句文案多读两个全量视角；
  P1 me 视图可廉价携带）。

【DESIGN DECISION】P0 身份行 = 「{进行中} 场进行中 · {已完成} 场同行 · {发起} 场发起」的
指标行替代（.metrics 承载），头卡内不再编造「户外身份」称号类文案（无数据支撑的文案不做）。

### 3.2 统计口径（P0 客户端推导，P1 服务端复算同口径）

【CODE FACT】`home(participant)` 返回的活动集合 = owner ∪ 本人有效报名 ∪ 协作授权 ∪ 最近打开
（selectors.js:261-267），每场带 `meta.owner/joined` 与 `phase`（activityView.phase）。

【DESIGN DECISION】口径定义（精确到可测试）：

| 指标 | 定义 | 推导 |
|---|---|---|
| 进行中 | phase ∈ {published, gathering, active, closing} 且（meta.owner 或 meta.joined） | home 活动过滤计数 |
| 已完成 | phase = archived 且（meta.owner 或 meta.joined） | 同上 |
| 发起 | meta.owner = true 的活动数（任意 phase） | 同上 |

【RATIONALE】不用「全部历史报名数」：cancelled/rejected 的活动在参与者心智里不是「完成了 N 次同行」；
`meta.joined` 只覆盖当前有效报名（pending/confirmed/waitlisted），归档活动的 joined 可能为 false——
因此「已完成」按 owner‖joined‖（有报名记录）在 P0 用 owner‖joined 近似。该近似的偏差（本人报名
且已归档、但 pending/confirmed 已被取消的场次不计入）在 P1 me 视图用服务端精确复算消除
（me 视图直接数 signups，不受 home 投影限制，见 06 §3）。

【RISK】P0 口径与 P1 口径可能产生 ±N 的跳动；接受（熟人工具，非账务数字），文档明示。

### 3.3 最近活动

【DESIGN DECISION】取 home 活动中「进行中」优先、其次按 `startAt` 绝对值最近，最多 3 条；
行元素 = 标题 + 日期（format.js 北京时间）+ 状态词（PHASE_LABELS/DETAIL_STATE_TITLES 已有，
utils/format.js:74-92）+ 点击跳 `/pages/activity/activity?id=`。
P0 直接复用 home 读的 activityView 字段（title/startAt/phase/id），**不渲染 routeSnapshot**。

---

## 4. 编辑面的迁移表

| 现状（me.wxml） | Target | 承载 |
|---|---|---|
| 昵称 input（:27-37） | A 组头卡内联保留（现状无下划线大字样式已对） | 原样式 |
| 头像 button（:20-25） | A 组头卡内联保留 | 原样式 |
| 手机号 input + 一键按钮（:41-48） | D 组摘要行 → 点开 sheet：手填 input + 「使用微信手机号」文字捷径 + 用途说明 | `<overlay kind="sheet">` + form-field |
| 紧急联系两列（:56-59） | D 组摘要行 → sheet：姓名 + 电话 | 同上 |
| medical 折叠 textarea（:61-77） | D 组摘要行（已填 badge）→ sheet：textarea + 「报名默认值/活动期间按用途查看」说明 | 同上 |
| 常用同行人列表+弹层（:82-105, :134-155） | E 组原样保留（结构不动，只调卡片标题与列表组件为 person-row 可选） | 现有 overlay |
| 协作身份码卡（:107-118） | F 组：缩略 `oX****` + 复制；说明句保留 | .code-text |
| 位置授权卡（:121-131） | G 组原样迁移（文案不动） | list-row |

【RATIONALE】编辑收进 sheet 的同时**必须保住自动保存**（P3/12：sheet 内仍走 onField→草稿→800ms
防抖→persistPerson，只是触发面变小）。紧急联系+medical 合并为「同行与安全」的两个摘要行后，
「自动保存」反馈行从卡底部移到编辑 sheet 内部（「修改后自动保存 · 已保存」），
摘要行本身显示当前已存值（服务端值），草稿未落库时显示草稿值 + 「待保存」徽标（12 §4）。

---

## 5. 与 Tab 结构的关系

【CODE FACT】「我的」是 custom-tab-bar 的第 4 个 Tab（me.js:72-75 `selected: 3`），
Tab 栏现状：首页/通知/天气/我的（app.json custom tab）。

【DESIGN DECISION】不动 Tab 结构。通知已独立成 Tab，「我的」不重复通知入口；
天气同理。「设置」在本产品 V1 没有可设置的项（通知订阅是模拟通道、隐私指引在平台后台），
不设空壳入口。

---

## 6. Current → Target 对照总表

| 维度 | 当前 | Target |
|---|---|---|
| 页面定位 | 资料登记表（「我的同行资料」） | Identity Hub（身份+活动+同行+安全+授权摘要与入口） |
| 页头 | 「下次出发，少填一点。」 | eyebrow「我的」+ 副标题一句话（如「资料齐了，报名就快。」） |
| 头像/昵称 | 「我的资料」卡内 | 身份头卡（A），展示与编辑同位 |
| 手机号 | 资料卡平铺 + API 机制外露 | D 组摘要行 + sheet 编辑（一键获取收进编辑面） |
| 紧急联系人 | 资料卡两列平铺 | D 组摘要行 + sheet |
| Medical | 折叠 textarea 平铺 | D 组摘要行 + sheet（补「报名默认值」语义说明） |
| 活动统计 | 无 | A 组 .metrics 三计数（P0 客户端推导 / P1 me 视图） |
| 最近活动 | 无 | C 组 0–3 条（P0 复用 home 读） |
| Companion | 卡片列表+弹层 | E 组原样（文案保留） |
| 身份码 | openid 全文平铺 | F 组缩略 + 复制（语义重定义见 10） |
| 位置授权 | 独立卡（有数据才出现） | G 组「隐私与授权」（文案保留） |
| 读 API | profile + home 两读 | P0 不变 → P1 单读 kind:'me' |
| 写 API | profile.save/companion.save/companion.remove/position.revoke | 不变 |
| 本地草稿 | 五字段、无时间戳、无账号段、静默遮蔽 | + savedAt/账号段 + 「本机有未保存修改」横幅（12） |
| 权限模型 | 不变 | 不变（安全边界零放松，07 逐格核对） |
| 测试 | scenario-me 81 断言（2 闸门 skipped） | 迁移 + 新增（13 给出清单） |
