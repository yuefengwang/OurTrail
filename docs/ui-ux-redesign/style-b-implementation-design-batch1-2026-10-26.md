# Style-B 实现级设计 · 批次一（首页 / 发现 / 通知 / 我的 / 活动详情）

日期：2026-10-26 · 上游：`docs/ui-ux-redesign/style-b-decision-record-2026-10-26.md`（D1–D11）· 基线提交 `617a61c`
状态：**待评审**（评审通过后才动代码）

---

## 0. 一句话定位

把 OurTrail 从「编辑式长文页」改成「**卡片化的工作清单**」：身份由一条品牌行承担，页面上每一屏都先给事实与下一步，装饰全部让位给密度。参考板只借**结构与工艺**（图在上、chips 分槽、吸顶分段、白卡 + 发丝线 + 冷近白底），不借品牌（无中央 FAB、不做活动市场、无分类维度）。

## 1. 借 / 不借清单

| 借（结构与工艺） | 不借（品牌与业务形态） |
|---|---|
| 图在上、正文收成「标题 + chips + 一行 meta」 | 底部中央 + FAB（D5-A） |
| 吸顶分段导航（详情页） | 发现优先的首页（D4-B） |
| 天相 pill 行 + 「条件 → 图 → 详解」（批次二） | 活动分类图标行（D10-A，无数据源） |
| 白卡 + 1px 发丝边 + 冷近白底 + 森林绿只做动作 | 参考板的词标字形（不引入 webfont） |
| 短状态徽章（「报名中」）压在图左上 | 铃铛图标（OurTrail 无全局消息中心入口，通知在 tabBar） |

## 2. Token 与字体：零新增色值，零新增 token

`page` 块（`app.wxss:4-81`）现有 44 个自定义属性全部够用。本批**不新增任何 token / 色值**，理由：

- 品牌栏底 = `var(--paper)`，分隔线 = `var(--line)`，词标 = `var(--forest)`；
- 徽章 = 既有 `.badge` 五色变体；chips 文字 = `var(--muted)`；
- 吸顶条复用 `app.wxss:452` 已有的 `.segmented.tabs-line`（下划线页签变体，2026-10-23 已登记）。

字体：**继续系统字体**（`app.wxss:79` 那条 font-family 栈），不引入 `wx.loadFontFace`（要网络、拖首屏、且与「零依赖」冲突）。

字阶变化（全批唯一一处全局改动）：

| 角色 | 现值 | 批后 | 说明 |
|---|---|---|---|
| `.display`（详情 hero 活动名） | 30px/700 | 不动 | 已在 `app.wxss:122` |
| `.page-title`（页标题） | 28px/700 | **24px/700** | D8；同批更新 `tools/m02-class-scope-test.js:257` 的 PV4 断言 |
| 列表页头 `.list-head__title` | 20px/600 | 不动 | 已与参考板同档 |
| 卡标题 `.activity-card__title` | 18px/600 | 不动 | |
| chips / meta | — | 12px/400 `var(--muted)` | 复用 `.small`（12/18） |

**不做**全站间距重调（`.page` 24/20/32 与 16px `.stack` 一律不动）：那是需要 21 页真机重验的另一次动作，本批密度收益来自「删页标题 + 卡片分槽」，已经够。

## 3. 共享层四件（批次一必须先定稿，否则批次二会复制出第二套语言）

### 3.1 `components/brand-header/`（新）+ `utils/header-layout.js`（纯函数）

- 适用范围：**只有 4 个 tab 页**（首页 / 通知 / 我的本批；天气中心批次二）。
- 页 JSON：`"navigationStyle": "custom"`；页面根节点加 `style="padding-top: {{headerH}}px"`（高度由组件回传或页面同源计算）。
- `utils/header-layout.js`（wx-free，Node 可测）：
  ```
  layoutFor({ statusBarHeight, menuButton, windowWidth })
    → { height, paddingTop, contentRightInset }
  ```
  公式：`navBar = (menuButton.top - statusBarHeight) * 2 + menuButton.height`（≈44），`height = statusBarHeight + navBar`，`contentRightInset = windowWidth - menuButton.left + 8`。
  测试：`tools/header-layout-test.js`（iPhone 14 / 老机型 / 平板三组实测值 + 胶囊不重叠 + `contentRightInset` 单调性）。
- 视觉：`position: fixed; top: 0; z-index: 90; background: var(--paper); border-bottom: 1px solid var(--line)`；左 = `icon name="trailMark"` + 词标 `OurTrail`（16px/700 `var(--forest)`）；可选 `title`（14px/600 `var(--ink)`）跟在词标右侧。
- **不做滚动收缩动画**：参考板也没有；收缩头是模板化默认，收益不抵复杂度。
- 胶囊避让由 `contentRightInset` 强制（右侧内容 `margin-right`），不做「猜测胶囊位置」的硬编码。

### 3.2 `activity-card` 排版重排（D9-B）

投影字段 `info` / `status` / `metrics` **一字节不动** ⇒ `a20-owner-hero-test` 那 9 条字符串断言继续绿。新增**页面侧派生**，抽到 `utils/card-view.js`（纯函数，`home.js` 与 `discover.js` 共用，消除两处同口径派生）：

```
chipsOf(activity)  → [{ key:'date', text }, { key:'difficulty', text, badge:true },
                      { key:'distance', text }, { key:'ascent', text }]
peopleOf(meta)     → { text:'已确认 3/10', pending:'待审核 7' }   // pending 只给 owner
```

模板（普通卡，`activity-card.wxml:51-84` 区块）收成三行：

1. 标题（18px/600，断行不截断——`app.wxss:321` 那条 M-16 注释的判据继续成立）
2. chips 行：`日期 · 难度 · 16 km · 980 m`，12px `var(--muted)`，`nowrap` + 截断，优先级 **日期 > 难度 > 距离 > 爬升**，**不折行**
3. meta 行：左 `roleNote`（「我组织的」/「最近查看」，12px `var(--muted)`，缺失即不印）+ 路线名；右 人数

徽章：图左上只放**阶段短词**（`J.phaseLabel` 的结果，`home.js:131` 拆出 `badge`），归属改走 `roleNote`。
`featured`（首屏大卡）沿用现有 hero 形态，只把 `info` 行替换成 chips + 人数两行。

**门禁影响**：`a20-owner-hero`（字段值不变，绿）· `swx2-style-gates`（若钉了 `.activity-card__info` 的样式需同步）· `home-collab-list`（协作入口行不动）。改前先跑一遍取基线读数。

### 3.3 `components/next-up-card/`（新，首页专用，D4-B）

只做**客户端派生**，不新增域字段、不额外发请求。输入是首页已有的 `cards`：
- 眉题「下一次同行」；活动名；`日期 · 距出发 N 天`；`已确认 3/10`；可选 `待审核 7 人`（owner）
- 整卡可点 → 进详情（**卡内不放实心按钮**，把本页唯一 primary 留给「发起活动」，守 `ourtrail-ui §3 #7`）
- 无未来活动时：变成邀请卡「还没有安排 · 从一场短途开始」，**卡内**给 primary「发起活动」（此时它就是页面唯一 primary，动作行只留「发现活动」）

### 3.4 分区标题（D8-B）

tab 页删 `.page-title`。替代：`.section-head` + `.kicker` + `.list-head__title`（20px）三件套（`app.wxss:145-150` 已有）。通知页额外要求：分区标题里必须出现「通知」二字（D8 代价条款）。

## 4. 逐页 Spec 与 Gap Matrix

### 4.1 首页 `pages/home/`（tab）

| 现状 | 目标 |
|---|---|
| `home.wxml:11-24` `.home-entry`：eyebrow「OURTRAIL · 一起走过」+ 28px「我的活动」+ 双按钮 | 品牌头（新）+ `<next-up-card>` + 动作行（发现=secondary / 发起=primary） |
| `:34-38` 搜索条 | 保留，移到动作行之后（第二屏区），样式不动 |
| `:39-44` 4 段筛选 | 保留，样式不动 |
| `:56-75` `<activity-card>` 列表 | 保留；卡片正文按 §3.2 收成三行 |

**首屏算术（375 宽，`page.clientHeight ≈ 603`）**：header 44 + 内容上留白 16 + 状态卡 112 + 12 + 动作行 48 + 12 + 搜索 36 + 8 + 分段 44 + 12 = **344**，剩 259px；普通卡 = 媒体 168 + 正文 ≈ 110 = **278px** ⇒ **一张整卡差 19px 放不下**。
→ 见 §8「待确认 A1」：把验收口径改为「状态卡完整 + 首张卡露出标题与 chips」，或接受首张卡媒体盒降到 148px。

### 4.2 发现 `pages/discover/`（非 tab，原生返回栏）

| 现状 | 目标 |
|---|---|
| `:9-16` `.discover-head`：eyebrow「发现活动」+ 20px「看看别人在约什么。」 | 删 eyebrow（导航标题已经是「发现活动」，重复）；保留 20px 一行 |
| `:18-24` 搜索条 | 不动 |
| `:26-41` 工具栏（列表/地图分段 + 结果数 + 筛选/排序 chips） | 不动（结构与参考板 1.3 一致） |
| `:43-53` 诚实提示三行 | 不动（文案受铁律保护） |
| `:56-118` 卡片列表 / 地图 | 卡片正文按 §3.2 收成三行 |
| 导航配色继承 `app.json` 森林绿（`discover.json:3` 实际是纸面，OK） | 不动 |

**额外一条**：`discover.js:172` 的 `status` 与 `home.js:131` 语义不同（发现页没有 `roleNote`），派生函数必须保持这个差异，不得为了「统一」抹平。

### 4.3 通知 `pages/notices/`（tab）

| 现状 | 目标 |
|---|---|
| `:8-12` kicker「同行消息」+ **28px `.page-title`**「重要安排，不错过。」+ 一句定位 | 全删；改 `section-head`：kicker「通知」+ 20px「重要安排，不错过。」（「通知」二字按 D8 补回）+ `section-sub` 保留 |
| `:14-17`「发布活动通知」primary（`canPublish` 时） | 不动 |
| `:19-23` 分区头 kicker「通知」/「最新的在最上面」/ 计数 | 与上一条合并成一处分区头，避免「通知」连出两次 |
| `:28-48` `.notice-card` 列表（badge + 时间 + 正文 + 3 个 text/secondary 按钮 + 投递记录） | 不动（形态已与参考板 4.x 同族） |

### 4.4 我的 `pages/me/`（tab）

| 现状 | 目标 |
|---|---|
| `:9-52` `.profile-identity`（微信头像行 + 3 个 metric：进行中/已完成/发起） | 保留；上方加品牌头 |
| `:54-72` 未保存草稿 callout + 完善资料入口 | 不动 |
| `:75-99` `<chapter kicker="我的出行" title="最近活动">` + 最近列表 | 不动（已是新语言） |
| `:103-111` `.tool-entry` 路线库 | 不动 |
| `:113-145` 安全档案三行 | 不动 |
| `:147-173` 常用同行人 | 不动 |
| `:175-215` 协作与权限（协作码 / 位置授权 / 隐私） | 不动 |

**结论：本页是 5 页里最接近目标的**，本批只加品牌头 + 复核 5 个 chapter 的标题档位一致，不做结构改动。

### 4.5 活动详情 `pages/activity/`（非 tab，原生返回栏）

| 现状 | 目标 |
|---|---|
| `:35` `<activity-hero>` 全出血封面 + `:43` `.act-info` 事实卡 + `:46` 照片诚实性脚注 | 不动 |
| `:48-55` 状态 callout | 不动 |
| `:84-93` **`.section-nav` 横向 chips**（8 个，`activity.js:190-197`），**不吸顶、无当前项高亮**；点按已能 `wx.pageScrollTo`（`activity.js:632`） | 改成**吸顶下划线分段条**：外观复用 `.segmented.tabs-line`，`position: sticky; top: 0`，纸面底 + 发丝线；**新增滚动高亮** |
| `:96-327` 9 个 `<chapter>` | 不动（正文一字不改，D6 明令不折叠） |
| `:352` `sticky-action`（底部主按钮） | 不动；与顶部吸顶条分居上下，互不重叠 |

**分组（6 段，2 字标签，13px 下每段 55.8px @375）**：

| 段 | 覆盖章节（锚点 id） |
|---|---|
| 介绍 | `sec-intro`（含「同行人」章，该章无 id） |
| 行程 | `sec-itinerary` + `sec-weather` |
| 路线 | `meeting-block` |
| 安全 | `sec-safety` |
| 装备 | `sec-equipment` |
| 约定 | `sec-fee` + `sec-signup` |

> 为什么不是 5 段（照抄参考板）：`安全`（风险提示）并入 `路线` 会让人以为风险是路线的一部分；7 段则把每段压到 47px 以下、2 字标签开始贴边。

**实现要点**：
- `activity.js:190-197` 的 `sectionNav`（id/label/show）**原样保留**——`scenario-activity-test.js:368/452/454/458/465/513` 六条断言钉它的内容。另派生 `anchorGroups`（6 段 + 每段的第一个既有 id），渲染只用 `anchorGroups`。
- 高亮用 `this.createIntersectionObserver` 逐 `#id` 观察 + `relativeToViewport({ top: -headerOffset })`，取「进入视口的最上一个段」；页面 `onUnload` 断开。不用 `onPageScroll` 逐帧算（会掉帧）。
- 点按仍走 `onSectionNav`（`pageScrollTo` 已有），但目标 id 换成段内第一个 id；滚到位后高亮由 observer 自己收敛。
- 分组对象必须与 `sectionNav` 的 `show` 联动：`sec-weather` 在草稿态不显示 ⇒ 「行程」段仍存在（有 `sec-itinerary`），但 `sec-intro` 无内容时「介绍」段要整段消失（`activity.js:452` 已有一条断言钉这个形态）。

## 5. 批次二接口预留（本批不实现，只留缝）

天气中心页（`pages/weather-hub/`）接品牌头时，`brand-header` 的 `title` 属性直接复用；`pages/weather/` 的 D7 重排需要 `utils/weather-brief.js` 已有的摘要口径，届时另开 Spec。**本批不动任何 `weather*` 文件、不动 `--chart-*`。**

## 6. 文件清单

**新增**
- `miniprogram/components/brand-header/{js,json,wxml,wxss}`
- `miniprogram/components/next-up-card/{js,json,wxml,wxss}`
- `miniprogram/utils/header-layout.js`（wx-free）
- `miniprogram/utils/card-view.js`（wx-free）
- `tools/header-layout-test.js`、`tools/card-view-test.js`

**修改**
- `miniprogram/app.wxss`（`.page-title` 28→24；其余不动）
- `miniprogram/components/activity-card/{wxml,wxss}`（正文分槽；`featured` 同步）
- `miniprogram/pages/home/{wxml,js,wxss,json}`（品牌头、状态卡、删页标题；接 `card-view`）
- `miniprogram/pages/discover/{wxml,js,json}`（删 eyebrow；接 `card-view`）
- `miniprogram/pages/notices/{wxml,json}`（品牌头、删页标题、合并分区头）
- `miniprogram/pages/me/{wxml,json}`（品牌头）
- `miniprogram/pages/activity/{wxml,wxss,js}`（吸顶分段条 + 滚动高亮 + `anchorGroups`）
- `tools/m02-class-scope-test.js`（PV4 期望值按 D8 更新；**只改期望值，不删判据**）
- `README.md`（组件数）· `docs/ui-ux-redesign/design-system.md`（组件清单 + 页标题档位）

**明确不碰**：`cloudfunctions/**`（本批零后端改动 ⇒ 不需要重新部署）、`custom-tab-bar/**`、`utils/journey.js`、`tools/a20-owner-hero-test.js`、`tools/scenario-*` 的既有断言。

## 7. 实施切片（每片可独立复跑）

1. **S1 共享层**：`header-layout.js` + `brand-header` + `card-view.js` + 两个新套件 → 只跑新套件。
2. **S2 卡片**：`activity-card` 分槽 + 两页接 `card-view` → `a20-owner-hero` / `smoke` / `home-collab-list` / `swx2` / `page2-gates`。
3. **S3 首页**：品牌头 + `next-up-card` + 删页标题 + `app.wxss` 页标题 24px + PV4 更新 → `m02-class-scope` / `scenario-me`（它读页标题）。
4. **S4 通知 + 我的**：品牌头 + 通知页分区头。
5. **S5 详情吸顶条**：`anchorGroups` + 高亮 → `scenario-activity`。
6. **S6 门禁**：`check.js` + `check-handlers.js` + 上述全部套件；改动文件清单与决策记录逐条对照。
7. **S7 真机**：`docs/ui-ux-redesign/evidence/style-b-2026-10-26/`（390×844 已跑，驱动 31/0；**375 宽 UNVERIFIED**——automator 0.13.0 没有 `setWindowSize`）。

每片结束跑 `node tools/check.js`；S6 前不提交。**全程不 push、不部署**。

## 8. 待确认（两处，都是我在设计时撞到的硬事实）

**A1｜首屏验收口径**：`page.clientHeight` 603 下，按 §4.1 的算术「状态卡 + 一张整卡」差 19px。三个选项：① 验收改为「状态卡完整 + 首卡露出标题与 chips」；② 首张卡的媒体盒 168→148（只影响列表首卡，不动组件默认）；③ 接受首屏不见整卡，等真机读数再定。
**建议 ①**：状态卡本身就是「下一次同行」的活动内容，首屏已经给了事实与下一步；为 19px 把媒体盒改小会让首卡与后续卡不齐。
**已定（2026-10-26 真机，取 ①）**：390×844 实测可用下沿 **749**（自定义 tab 栏上沿，不是 windowHeight 844）——状态卡 111–217 整卡在内、首卡标题 627–657、chips 690.7–708.7 均在 749 之上，三项同时成立，媒体盒不动。

**A2｜详情页导航配色**：`activity.json` 未覆盖导航 ⇒ 继承 `app.json:26` 的森林绿 + 白字，而其余页面是纸面 + 黑字。本批按 D2「下钻页保留原生栏」，**只把配色改成纸面/黑字**（照片仍在导航栏下方，不做沉浸）。若要做参考板那种「照片顶到状态栏、浮动返回」，需要另开一条决策（涉及 `navigationStyle: custom` + 返回手势 + 分享按钮三件）。

**A3｜通知/我的下拉刷新**：两页都有 `enablePullDownRefresh: true`。改 `navigationStyle: custom` 后，下拉指示器可能被固定头遮住——真机若确认异常，回退办法是把这两页的 `backgroundTextStyle` 调到 `dark` 并加 `refresher-triggered` 的顶部偏移，或在 S4 里对这两页改用 `<scroll-view refresher-enabled>`。先按原配置实施，真机读数定去留。
**真机结论（2026-10-26）：UNVERIFIED。** `wx.startPullDownRefresh` 在模拟器里**不渲染**原生指示器（120/500/1000 ms 三帧一致、页面不位移），只能证「API 不抛错、内容不被固定头永久顶下去」；指示器属原生 chrome 不是页面 DOM，模拟器给不出读数。回退方案保留，等真人下拉或真客户端再定。
