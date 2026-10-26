# Style B Slice 1 证据：首页 hero 接入 + 发现页平铺行（2026-10-26）

- **基线**：`6e1faec`（批次一 checkpoint）+ 工作树中的批次二 2a/2b/Slice 0 未提交改动。
- **分支**：`agent/ourtrail-style-a-20261023`。**未提交、未 push、未部署**。
- **需重新部署 trailApi：否** —— 本轮 `cloudfunctions/` 零改动。
- **保真目标**：仓库内 `docs/ui-ux-redesign/reference/screens-2026-10-20/`（用户裁决：逐屏以 10-20 板为准）。
- **本切片只做** G0 §4.2 的 Slice 1：home / discover。**证据上限：结构块 + 门禁 + 像素读数缺失**（真机 NOT_RUN，见 §6）。

---

## 1. 结构块验收（对着 G0 §3.1 逐块点名）

| # | G0 §3.1 结构块 | 落地位置 | 读数 / 判据 |
|---|---|---|---|
| 1 | 照片 hero 顶到屏幕边（负边距抵 `.page` 24/20 内边距） | `pages/home/home.wxss:22`（`margin: -24px -20px 0`） | 只影响 home 根内容；`.page` 基线未动（`b4-pad-final-value 33/0`） |
| 2 | 品牌词标压在照片上（overlay），并自带顶部压深 | `pages/home/home.wxml:14`、`components/brand-header/brand-header.wxss:44-66`、`app.wxss:35` | overlay 自建层叠上下文 `z-index: 3`；`::before` 200px 压深 `z-index: -1` ⇒ 在照片之上、白字之下 |
| 3 | 「下一次同行」是首屏唯一大卡；无下一场时退回邀请卡 | `home.wxml:15-23`、`components/next-up-card/*` | 数据仍由 `nextUp` 派生；`empty="{{!nextUp}}"`；品牌栏同步切 `solid` |
| 4 | 白面 sheet 从照片下沿抬起 | `home.wxml:29`、`app.wxss:149-155`、`home.wxss:37` | 有照片时 `-20px` 上边距吃掉照片最后 20px；无照片时 `.sheet-top--invite` 退回纸面（不留无解释的圆角） |
| 5 | 搜索 + 动作行（唯一 primary） | `home.wxml:35-50` | 搜索只在 `hasAny`；「发起活动」primary 只在有 `nextUp` 时出现 ⇒ 同屏 primary 仍为 1 |
| 6 | 四档范围切换（关系型，不造分类行） | `home.wxml:52-57` | `mine/recent/finished/collab`；collab 段按 `collabCount` 条件出现（C19：不实现分类筛选） |
| 7 | 区块头「更多活动 / 按出发时间排序」 | `home.wxml:61-64`、`home.wxss:32-34` | 20/28 标题 + 14/18 副行；文案不叫「推荐」（无推荐算法） |
| 8 | 单一活动列表（一张卡 / 一行活动） | `home.wxml:76-98` | 仅一个 `activity-card` 节点、`compact="{{!item.featured}}"`；`entry-layout 41/0` 钉住 |
| 9 | 发现页结果读成一列「行」而不是一摞卡 | `pages/discover/discover.wxml:60-76,105-121`、`activity-card.wxss:98-103`、`discover.wxss:34` | 两张卡均 `flat="{{true}}"`；flat 去底色/圆角、保留下发丝线；`discover-list` gap 0 |
| 10 | 发现页地图高度收到 260（给列表让位） | `discover.wxss:71`（`.map-card`） | 340 → 260；圆角仍引用 `--radius-card` |

**明确没做（G0 §6 已裁决）**：分类图标行（C19）、暖纸/webfont（C12）、发现筛选新路由（C13）、`equipment-grid` 改造（C14）。

---

## 2. C16：首屏与列表不重复（本轮唯一的判据变化）

**实现**（`pages/home/home.js:124-129`）：`cards` 先在 `filter === 'mine'` 时剔除 `nextUp.id`，再算 `featuredId`。
**范围**：只在「我的活动」档——协作档的条数必须等于筛选段计数；「最近查看」的名字就是「我点开过的那几场」，剔除会自相矛盾；已结束档不可能命中（`nextUp` 是非终态）。

**空态**（`home.js:193-197`）：唯一一场活动就是首屏那场时，列表空态改说「其余活动会出现在这里」，而不是「留一点时间，走进山野」。

**重钉两个门禁（不是放宽，是夹具适配 + 加牙）**：

| 套件 | 改动 | 新增牙齿 | 读数 |
|---|---|---|---|
| `tools/home-collab-list-test.js` | §1/§2/§3/§4/§5/§7 各补一场更早的同行活动占首屏（`soon`，不带 staff/vehicle） | hero 不在 `cards`；协作档 `collabCount === cards.length`；三视角合并后首屏取最早且列表顺序不变；`past/future` 档里首屏那场只出现一次 | **42 → 46/0（+4）** |
| `tools/a20-owner-hero-test.js` | §1/§1b/§2/§4a 补 `hero()`；§3 直接让被测活动当 hero | 默认档不重复 + 空态文案；`recent` 档里同一场必须还在（剔除只发生在 mine）；夹具自证首屏不是被测卡 | 39/0（新增 3 条） |

**变异自证（C16 是承重的）**：把 `home.js` 的 `dedupeId` 临时改为 `''`（锚点命中恰 1 次，脚本断言 `hits === 1`），
两个套件**都 exit 1**（`home-collab` 有效性门 `cards=soon,dual`；`a20` 有效性门 `["soon","own","other"]` 与「默认档里 hero 不在列表里重复」红），
还原后 `sha256` 与改前**逐字节相同**、两套恢复 46/0 与 39/0。

---

## 3. 门禁读数（本轮实跑，全部 exit 0）

| 门 | 读数 |
|---|---|
| `node tools/check.js` | **ALL CHECKS PASSED**（G10 作用域 42 / token 3144 / 类名 135；G11 命中 0） |
| `node tools/check-handlers.js` | exit 0（死 handler 仍只有存量 `editor#onNumber`） |
| `entry-layout` | 41/0（structure=E1，UI=NOT_RUN） |
| `m02-class-scope` | 66/0 |
| `page2-gates` | 117/0 |
| `swx1-style-gates` | 45/0 |
| `swx2-style-gates` | 110/0 |
| `scenario-discover` | 60/0 |
| `scenario-activity` | 212/0 |
| `nav-chrome` | 15/0 |
| `ui-consistency` | 19/0 |
| `journey-graph` | 15/0 |
| `scenario-editor` | 227/0 |
| `header-layout` | 38/0 |
| `b4-pad-final-value` | 33/0 |
| `t4-e08` | 41/0 |
| `home-collab-list` | **46/0** |
| `a20-owner-hero` | **39/0** |
| `activity-l2-structure` | 83/0 |
| `operations-layout` | 39/0 |
| `personal-route-layout` | 60/0 |

**未跑全量 sweep**，不编总数；本轮未改 domain / 命令 / 投影 / 天气阈值，`cloudfunctions/` 零改动。

---

## 4. token 与设计系统登记

- `--scrim-top`（`app.wxss:35`）：原来 **零代码消费者**（grep 证实）；本轮改档为
  `rgba(18,46,40,0.6) 0% → 0.4 45% → 0 100%`，唯一消费者是 `.brand-header--overlay::before`。
  没有新增 token、没有新增色值；条数仍 44。
- 登记同步：`docs/ui-ux-redesign/design-system.md`（§12）与
  `.agents/skills/ourtrail-ui/references/design-system.md:36`。
- 图标字面量例外：`home.wxml:37` 的 `#5F6E66` 与 `--muted` 逐字节同值（`icon` 不支持 `var()`），既有写法，不是新色。

---

## 5. 实测布局风险（静态可判的部分）

1. **白字压在亮封面上**：`assets/photos/cover-snow.jpg` 顶部有大片亮天空。压深已从「只够状态栏一条边」拉到 200px 波段（0.6→0.4→0），但**对比度没有像素读数**（真机 NOT_RUN）。
2. **sheet 叠照片 20px**：`.sheet-top` 的 `-20px` 上边距会让白面盖住照片最后 20px。若真机上 next-up-card 的正文贴近底部 20px，会被白面切到——组件内目前正文有 16px padding，理论上安全，但**未经真机**。
3. **邀请卡分支**：品牌栏切 `solid`、hero 去掉 `-24px` 上边距、sheet 退回纸面，是三条联动；缺一条就会让卡片顶到导航栏里。当前三条都在（`home.wxml:13-14,29`、`home.wxss:27,37`）。
4. **390 宽**：`home-section` 用 `space-between`，标题「更多活动」+ 副行「按出发时间排序」在 350 内容宽内不换行（估 ≈ 200 + 110），未做 375 实测。

---

## 6. 真机：NOT_RUN

- **结论上限**：本切片只有 **结构 + 静态门 + 组件/页面行为套件**证据；**没有截图，不宣称「页面已保真」或「视觉验证通过」**。
- **原因**：本机运行中的微信开发者工具自动化会话属于共享资源；本轮未获准重编译/接管，未执行 `close`/`open`/`auto`。
- **要升到 VERIFIED 缺什么**：① `close --project 'D:\OurTrail'` + `open` + `auto` 拿新端口（证明 bundle 新鲜，
  可用 `--scrim-top` 新开档或「更多活动」文案自证）；② home 注入生产形状 home 投影（≥ 2 场未来活动，
  一场占首屏、一场进列表），断言 `nextUp.id` 不在列表 `data-id` 里，再截图；
  ③ 邀请卡分支（全部终态）单独一例；④ 发现页列表 + 地图两态；⑤ 每个用例前 `reLaunch` + 不同 `updatedAt` + 污染自证。

## 7. UNVERIFIED 清单（本切片）

- 首页 hero 的实际像素高度 / 照片裁切（`next-up-card` cover 方向）、白字与亮天空的对比度。
- sheet 叠压照片 20px 的实际观感与是否有内容被切。
- 发现页 flat 行的发丝线与缩略图对齐（`compact` + `flat` 组合首次用于生产页面）。
- 375 宽度、真实实拍封面（跨用户读图）、原生键盘顶起搜索栏的行为。
- 从 hero 点进活动详情后的返回路径（沿用既有 `onOpenCard`，未改）。
