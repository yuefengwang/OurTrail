# Style B · Slice 5a 证据 —— 我的 / 报名 / 编辑器的 token 与组件收敛（2026-10-26）

## 0. 本片的验收口径（为什么不是"逐屏保真"）

`me` / `signup` / `editor` **没有 10-20 逐屏板**：`reference/screens-2026-10-20/` 只有 20 张，
覆盖 home / discover(3) / activity(5) / workspace / tasks / notices / weather(5)。
`style-b-fidelity-matrix-2026-10-26.md` §2.3 把这 13 页列为"只能继承全局 token 与 L2 组件契约，
**不能按逐屏保真验收**"。任务书 Slice 5 因此写死：

> **只做**：跟随 Slice 0 的 token/组件自动收敛；导航、四态、底部留白不回归；真实内容页做一次首屏结构审查。
> **不做**：发明板上没有的模块；凭 denied 态改结构（`signup`/`staff`/`vehicle` 的真实态 UNVERIFIED）。

所以本片的产物是三类：**收敛（可核的重复出处归一）+ 首屏结构审查（交裁决，不自行改）+ 门与登记**。
**零新增色值、零新增字阶、零业务改动、`cloudfunctions/` 零改动 ⇒ 不需要重新部署。**

## 1. 收敛点（改前的"第 N 份"与改后的唯一出处）

| # | 对象 | 改前 | 改后 | 唯一出处 |
|---|---|---|---|---|
| C1 | 行卡内边距 | `class="card" style="padding:4px 16px;"` —— **同一句内联 style 抄了 5 份**（`me.wxml:77/:119/:156`、`editor.wxml:172/:843`） | `class="card rows"` | `app.wxss` `.card.rows { padding: 4px 16px }`（新增，紧接 `.card` 之后） |
| C2 | 常用同行人行 | 私有拼装：`.list-row` + `.who` + `.avatar-img.sm`（36px）+ `.avatar-fallback.sm-text`（36px / **15px 无源字阶**），姓名用默认 14 | 共享 `<person-row>`：头像恒 44px、姓名 16/600、状态徽标与副行留空、编辑·移除仍在**操作插槽**内 | `components/person-row/`（44px 那条注释本身就写着"两种尺寸并排时行高差 4px"） |
| C3 | `me.wxss` 私有小头像规则 | `.avatar-img.sm` + `.avatar-fallback.sm-text` 两条 | 删除 | 全站"人行头像"只剩组件里的 44 一个数 |

C2 的分量：`<person-row>` 已在 `activity.wxml:128`、`vehicle.wxml:63`、`roster-panel.wxml:50`、
`field-panel.wxml:34` 四处使用，**常用同行人是全仓最后一个不合群的"人行"**。

## 2. 为什么 C2 值得动，以及它的代价（如实写）

`<person-row>` 的操作插槽在**姓名/副行的下方**（`.person-row__actions { margin-top: 8px }`），
而原来的私有行把两个文字按钮放在**行右端**。换过来后：

- 得到：头像 44（触点与全站一致）、姓名 16/600（行主信息档位一致）、少两条页面私有规则与一个无源字阶；
- 付出：每行高度从 ≈72px（18+36+18）增到 **实测 120px**（短名一行；长名 158px），**每位 +48px**。
  ⚠ 本段初稿估的是"≈100px / +28px"，2026-10-26 真机回读把它推翻了一半——估算漏了
  `.person-row__actions` 的 `margin-top:8px` 与按钮自身 `min-height`。**以实测 120 为准**，见
  `../style-b-slice5-device-2026-10-26/README.md` §4。

这个代价**没有板可以裁定**（本片无板），所以我按"组件契约优先于本页密度"执行，并把它登记为
**待真机确认项**（§6）：如果 3 位以上同行人时读起来变松，改法是给组件加一个"行右端动作"的
显式变体（进组件契约、由四处共用），**不是**回退成页面私有拼装。

## 3. 审查后**没有改**的东西（附理由，避免下轮重复提议）

| 对象 | 现状 | 不动的理由 |
|---|---|---|
| `signup.wxss` | 全文 6 行，只有 `.part-group` 的 8/16 两处 gap | 已是 token 数值体系；无重复出处 |
| `editor.wxss` | 51 行，含 4 处**带注释理由**的例外（`.chip` 13/14 凑 44 触点、`.seg.done::before` 11px、`.segmented.tabs-line .seg` 2px、`.route-shortcut` 44） | 例外都写明了为什么，不是漂移；批次二 b 已登记"editor / signup 既有层级不改" |
| `editor.wxml` / `signup.wxml` 的内联 `style="font-weight:600;"`（8 + 1 处） | 仍是内联 | 收它要**新造一个全局类**（app.wxss 现有 `.section-title`/`.person-name` 都带 line-height 或颜色副作用，直接复用会改行高）。它只用了 600 一档 ⇒ 不产生数值漂移，属"不可见 churn"。留待有判据或板再做，不为此造新 API |
| `me.wxss` `.profile-stats .metric .metric-value { font-size: 24px }` | 覆盖全局 26px | 无板、无判据说明 24 与 26 哪个对；改了就是"凭审美改数"（§1 优先级 5 压不过 4）。**登记为待裁决**，见 §5-Q2 |
| `me.wxml:180` `.who style="margin-top:4px"` 等剩余内联 style | 保留 | 棘轮只要求"只许变少"；已从 14 → 11，基线钉在 11 |

## 4. `me` 首屏结构审查（任务书要求的"真实内容页"那一项）

`.stack-sections { gap: 40px }`（`app.wxss:116`）是**逐兄弟**施加的，而 `me` 的
`.stack-sections` 实测有 **11 个直接子节点**：

```
1 profile-identity   2 profile-stats   3 callout danger(error)   4 callout warning(hint)
5 callout warning(draftPending)   6 激活引导卡(!activated)   7 chapter 最近活动
8 .tool-entry 路线库   9 chapter 同行与安全   10 chapter 常用同行人   11 chapter 协作与权限
```

其中 3–6 是条件节点，常态（已激活、无错误/横幅）下也有 7 个块 ⇒ **6 × 40 = 240px**；
未激活且本机有未保存修改时 11 个块 ⇒ **10 × 40 = 400px**。

问题不在"留白多"，在**留白不携带分组信息**：
身份区 ↔ 统计带、统计带 ↔ 待保存横幅、横幅 ↔ 引导卡 都是 40px，
和"最近活动"与"同行与安全"这两个真章节之间是**同一个 40px**；
而一个 `chapter` 自己的题头到正文只有 12–16px。于是页面上"40"这个数已经不能告诉读者
"这里是新的一段"，唯一还剩的分组线索只有章头的文字。

各块自身高度（E1，纯 CSS 值相加，不是像素读数）：身份区 ≈ 64(头像行) + 33(下内边距+发丝线+下外边距)
+ 10(gap) + 18–36(提示一行或两行) ≈ **125–143**；统计带 ≈ 28(上下内边距) + 31(24px 数字)
+ 4 + 18(标签) ≈ **81**。两者之间再花 40px。

**结论：这是结构判断，不是收敛，本片未自行改。** 交裁决的两个选项见 §5-Q1。

## 5. 交负责人裁决的问题（本片没有自己动手的部分）

- **Q1（`me` 首屏分组）** 40px 段距目前逐兄弟施加，把"我是谁 + 还差什么"这四兄弟也拉开了 3 × 40。
  - **A（推荐）**：给身份区 / 统计带 / 横幅 / 引导卡套一层 `.stack`（16px），`.stack-sections` 的 40 只留给 `chapter` 与工具入口之间。改动面只有 `me.wxml` 一处包裹 + 一个既有类复用，`personal-route-layout:101` 的"身份区与统计带同级、不套进同一张卡"仍然成立（`.stack` 无底色无边框，不是卡）。
  - B：把 `.stack-sections` 的 40 收到 24–28，全页一起变紧。代价是章节感靠字号撑，且会连带影响已经在用它的其它页。
  - C：不动，等 `me` 有板再说。
- **Q2（统计带数字档位）** `me.wxss:17` 把 `.metric-value` 从全局 26px 覆盖成 24px，仓库里没有一句说明为什么。
  - **A（推荐）**：删掉这行覆盖，让个人页跟全局 26px 走（三列 335–350 宽下 3 位数也不溢出，`.metric-value` 已有 `overflow-wrap: anywhere`）。
  - B：保留 24，但把理由写进注释并登记进 `design-system.md`，否则下一轮还会被当成漂移。
- **Q3（同行人行的动作位置）** 见 §2 的代价。**已拍完真机**（`device/V1-me-personrow-scrolled.png`）：
  短名行 **120px**、长名行 158px ⇒ 每位比旧私有行高 **+48px**（不是初稿估的 +28）。
  帧上能直接看到"李四 / 编辑 移除"占了两行，动作行是空的一半宽度。
  - **A**：给 `<person-row>` 加一个显式变体（动作放行右端，activity/vehicle/roster-panel/field-panel 四处共用同一判据）。
  - **B（推荐）**：`me` 这一页把两个动作合成一个入口（"编辑"进 sheet，"移除"移进 sheet 内），
    行内只留一个动作 ⇒ 插槽仍在一行内，密度回来且不动组件契约。
  - C：接受 120px/行（85 条同行人时列表很长，但这一屏本来就不是主任务）。

## 6. 门禁读数与牙齿自证

新增/改动的门全在 `tools/personal-route-layout-test.js`（**60 → 65**，+5 条）：

| 新断言 | 钉什么 | 类型 |
|---|---|---|
| 常用同行人改用共享 `<person-row>`，编辑与移除仍在它的插槽内 | 组件在用 + `wx:for`/`wx:key`/`name`/`avatar` 四个属性 + 两个 handler 的后代关系 | 结构关系（不是数标签） |
| 个人页不再自定义第二套人行头像尺寸 | `me.wxss` 去注释后无 `.avatar-img.sm` / `.avatar-fallback.sm-text` / `font-size: 15px` | "不该存在的依赖"（铁律 30②，合法重构不会假红） |
| 行卡内边距收进 `.card.rows`，me/editor 都不再抄内联 padding | `app.wxss` 有该规则 **且** 两页 wxml 内该串为 0 | 单源 + 依赖不存在 |
| 个人页内联 style 数 ≤ 11 | 棘轮，与 `b4-e05` 的 `INLINE_STYLE_BASELINE` 同族（只许变少） | 计数，不认写法 |
| `me.json` 登记 `person-row` | 模板用了就必须登记，否则标签静默不渲染（AGENTS.md 铁律 3 的同类） | 契约 |

一条都**不放松**：原有的"身份区与统计带独立""三分组始终存在""七个弹层全部保留""tab 页底部 calc 不变"
"电话仍遮罩/代报与位置权限边界仍可见"全部原样通过。

复跑读数（全绿）：

```
personal-route-layout 65/0 · scenario-me 145/0 · scenario-editor 227/0 · scenario-signup 106/0
page2-gates 124/0 · swx1 45/0 · swx2 110/0 · m02-class-scope 66/0 · t4-e08 41/0
ui-consistency 19/0 · journey-graph 15/0 · b4-pad-final-value 33/0 · smoke 226/0
check.js  ALL CHECKS PASSED（G10 命中 0 ｜ 作用域 42 ｜ class token 3179 ｜ app.wxss 类名 136→137）
check-handlers  门 B 通过，死 handler 仍是存量 1 条（editor#onNumber）
```

变异自证 `tools/mutate-5a.js`：先把收敛逐项退回去，**6 条 0 漏网**，且每条恰好只红 1 项
（归因干净，不是一堆连带红）；每条改前/改后按 sha256 校验逐字节还原；有效性门＝变异前工作树必须全绿，
否则 exit 2 记 INVALID 不作结论。另附 M2b（只塞一个 `font-size: 15px`、不碰类名）证明"无源字阶"那半句
不是空断言。

## 7. 真机状态（2026-10-26 回读后更新）

**本批已回读**：IDE 模拟器 390 宽、**真实数据**（常用同行人 85 条 / 统计 131·119·293 / 路线库 299 条），
bundle 新鲜度由屏上事实自证（`.card.rows` 存在且计算 `padding-top = 4px`）。逐条读数、帧清单，
以及本轮撞到的**三个探针缺陷**（E2 跨行比 / D2 量错对象且没打开 `routeDetailsOpen` /
`pageScrollTo` 传对象静默不滚）统一记在 **`../style-b-slice5-device-2026-10-26/README.md`**。

| 原前置项 | 结果 |
|---|---|
| 新 bundle + 组件真被加载 | **VERIFIED**：`.person-row` 2 个在屏、姓名计算 `font-size` = 16px、头像实测宽 44px |
| 2–4 位同行人判密度 | **有帧**（`device/V1-me-personrow-scrolled.png`）：短名行 **120px**、长名行 158px ⇒ §2 的代价比初稿估的大一倍，交 Q3 裁决 |
| denied / loading / empty 各一帧 | **VERIFIED**（`C1/C2/C3-*.png`：三态各有 `status-panel`，空态文案是解释过的） |
| 80 字无空格拉丁串不撑破 | **VERIFIED**：姓名盒 `93+260=353` ≤ 卡右沿 `370`；长短两例行高不同（158 / 120）＝污染自证 |
| 375 与 414 两档宽度 | **NOT_RUN**（本轮只驱动 390） |

结论上限：本批在**已读数的这些点上**升到 **E3（一次真实操作 + 它的后果观测）**；
未读的（375/414、`route` 详情页、全图页触点）仍按上表与设备报告的缺口记，不随本批一起升。
