# Style B · Slice 0 证据包（2026-10-26）

**执行人**：主 Agent（单写者）
**依据**：[`style-b-shared-layer-spec-2026-10-26.md`](../../style-b-shared-layer-spec-2026-10-26.md) §4.1
**范围**：共用层（`app.wxss` 5 处改值 + 1 个新类）与 5 个 L2 组件。**不改页面、不改门禁、不改 `cloudfunctions/`。**
**证据上限**：静态门 + 组件行为 + 样式终值（E1 + 行为读数）。**真机 NOT_RUN**，原因见 §6。

---

## 1. 改动面（实测 diff）

`git diff --stat` 限定到本切片文件：

```
 docs/ui-ux-redesign/design-system.md               | 27 ++++++++++++++
 miniprogram/app.wxss                               | 41 ++++++++++++++--------
 miniprogram/components/activity-card/activity-card.js   |  3 ++
 miniprogram/components/activity-card/activity-card.wxml |  2 +-
 miniprogram/components/activity-card/activity-card.wxss | 16 +++++++--
 miniprogram/components/activity-hero/activity-hero.wxss |  6 ++++
 miniprogram/components/brand-header/brand-header.js     |  3 ++
 miniprogram/components/brand-header/brand-header.wxml   |  9 ++---
 miniprogram/components/brand-header/brand-header.wxss   | 13 +++++++
 miniprogram/components/fact-grid/fact-grid.wxss         |  3 +-
 miniprogram/components/next-up-card/next-up-card.js     | 31 ++++++++++++++++
 miniprogram/components/next-up-card/next-up-card.wxml   | 23 ++++++-----
 miniprogram/components/next-up-card/next-up-card.wxss   | 38 +++++++++++++++++++-
 13 files changed, 182 insertions(+), 33 deletions(-)
```

符号计数：**新增 token 0 · 新增色值 0 · 新增全局类 1（`.sheet-top`）**。
工作树里既有的其它修改（weather / workspace / routes / tools 测试）不属于本切片，未被触碰。

## 2. 样式终值（`grep -n` 实测，不是意图）

| 位置 | 终值 |
|---|---|
| `app.wxss:112` `.stack-sections` | `gap: 40px` |
| `app.wxss:145-151` `.sheet-top` | `position:relative; margin:-20px -20px 0; padding:20px 20px 0; border-radius:var(--radius-sheet) 上两角; background:var(--surface)` |
| `app.wxss:572-573` `.person-row` | `min-height:84px; padding-top/bottom:18px` |
| `app.wxss:582` `.avatar` | `flex:0 0 44px`（宽高同为 44） |
| `app.wxss:605` `.list-row` | `padding-top/bottom:18px` |
| `app.wxss:743-745` `.searchbar` | `height:var(--touch-target); padding:0 16px; border-radius:999px; gap:8px` |
| `activity-card.wxss:17` | featured 媒体 `height:240px` |
| `activity-card.wxss:52` | plain 媒体 `height:200px` |
| `activity-card.wxss:97` | `.activity-card--flat` 去边框/圆角/底色 |
| `activity-hero.wxss:9-11` | 作用域 `.hero-cover-media { height:320px }`（全局 240 未动） |
| `fact-grid.wxss:55` | `.fact-grid--card { gap:20px 12px }` |

## 3. 静态门

| 命令 | 读数 |
|---|---|
| `node tools/check.js` | **ALL CHECKS PASSED**；G10 作用域单元 42 / class token 3140 / **app.wxss 类名 135**（+1 = `.sheet-top`）；R2/R3/R4/G3/G6/G7/G8/G11 命中全 0 |
| `node tools/check-handlers.js` | 装载成功 42 个模板宿主；`next-up-card` **3 handlers**（onOpen/onCreate/onCoverError）；死 handler 仍只有存量 `pages/editor/editor.js#onNumber`，**未增加** |

## 4. 受影响套件（26 套，全部 exit 0）

| 套件 | 读数 | 为什么在受影响面 |
|---|---|---|
| `entry-layout` | 41/0 | 读 activity-card / home / discover 结构；80 缩略图、props、事件均未变 |
| `activity-l2-structure` | 83/0 | hero·chapter 属性键集、`.stack-sections` 唯一性 |
| `page2-gates` | 117/0 | brand-header 挂载与页头规则 |
| `m02-class-scope` | 66/0 | 新增全局类的作用域 |
| `t4-e08` | 41/0 | 平台规则 / 全局类 opt-in |
| `ui-consistency` | 19/0 | 跨页类一致性 |
| `nav-chrome` | 15/0 | 21 页 json 导航分类 |
| `journey-graph` | 15/0 | 页面图闭合、状态词单源（本层无新页/无新状态词） |
| `swx1-style-gates` | 45/0 | 列表密度 / person-row__body min-width |
| `swx2-style-gates` | 110/0 | 样式终值 |
| `b4-pad-final-value` | 33/0 | `.page` 基线未动 |
| `operations-layout` | 39/0 | 工作台顺序 + person-row 存在 |
| `a20-owner-hero` | 36/0 | activity hero 契约 |
| `equipment-icons` | 24/0 | fact-grid 邻居（未动契约） |
| `scenario-activity` | 212/0 | 详情页装配 fact-grid / chapters |
| `scenario-editor` | 227/0 | 依赖 app.wxss 页面骨架 |
| `scenario-me` | 145/0 | person-row / avatar |
| `scenario-vehicle` | 66/0 | person-row 插槽与属性 |
| `scenario-notices` | 105/0 | list-row |
| `scenario-discover` | 60/0 | 搜索条 / 列表 |
| `scenario-workspace` | 125/0 | 面板 / person-row |
| `scenario-tasks` | 34/0 | 页内主按钮仍存在 |
| `home-collab-list` | 42/0 | 首页卡片列表 |
| `scenario-profile-gate` | 19/0 | 共用层样式消费 |
| `scenario-signup` | 106/0 | person-row / list-row |
| `e2e-fault-probe` | 34/0 | 结果模型自证（未受本层影响，作为回归读数） |

> 未跑全量 sweep：本层只改 `app.wxss` 的 5 个值 + 1 个新类 + 5 个组件内部样式，凡 `grep -l "person-row|list-row|\.avatar|searchbar|activity-card|brand-header|next-up|fact-grid|hero-cover"` 命中的套件均已纳入上表。领域/天气/生命周期类套件不读这些文件，未跑，**不记通过**。

## 5. 组件行为探针（证据脚本，非门禁）

`node docs/ui-ux-redesign/evidence/style-b-slice0-2026-10-26/probe-components.js` → **passed=20 failed=0**

覆盖的**行为**（不是样式文本）：

| 组件 | 断言 |
|---|---|
| `brand-header` | `variant` String 默认 `solid`；`options` 只有一个键；`measure()` 实写 `statusBarHeight=44`、条高 84、胶囊避让 102 |
| `next-up-card` | props 仍为 4 个；按 id 稳定取图（`cover-valley`）；备选图不同；第一次 `binderror` 换成备选、第二次才 `coverFailed`；有 id 抛 `open{id}`；空态点卡不抛；空态 primary 抛 `create` |
| `activity-card` | `flat` Boolean 默认 false；无外部封面按 id 派生；派生图失败直接纯色；外部实拍失败先换氛围图（`cover-fjord`）再判失败；每次回退都有 `warn`；`restChips` 过滤 date |

**探针自身的一条修正（如实登记）**：首次运行 `有 id 时抛 open 事件` 为 ✗，原因是探针没有模拟平台把 `properties` 合进 `data` 的那一步，`onOpen` 守卫读到 `activityId=undefined`。补上后 20/0 —— 这与天气预报轮"夹具不覆盖被查时刻＝假绿"是同一类教训：**假红同样是夹具问题，不能靠放宽断言解决。**

## 6. 真机：NOT_RUN（不是通过）

- **原因**：Slice 0 的可见效果要等消费页接入（`.sheet-top` 目前无使用者；`brand-header` 的 `overlay` 只有 home 在 Slice 1 才会传；`flat` 只有 discover 在 Slice 1 才会传）。
- 本轮**未重开**共享的微信开发者工具会话（`close --project` + `open` 会打断另一台机器/另一个会话，需单独授权）。
- 因此本包**不含截图**，也**不得**据此宣称"页面已保真"。静态门绿 ≠ 页面正常（`docs/e2e-mp/README.md`）。
- 已经会立刻改变外观的两处：首页 `next-up-card` 变 320px 照片 hero（仍被 `.page` 20px 内边距框住，未出血）；活动详情 hero 媒体 240→320。这两处要等 Slice 1/2 接线后与参考板一起做真机对照。

## 7. 偏离与挂账

| 项 | 状态 |
|---|---|
| `next-up-card` 的"两步回退" | 实现为 **主图 → 备选氛围图 → 纯色森林底**（无外部 `cover` prop，props 契约未改） |
| `.sheet-top` | 已定义、暂无消费者；Slice 1 在 home 接管首屏时启用 |
| `fact-grid` 图标列 | 按 C18 挂账，不在本层 |
| 暖纸面 / webfont | 按 C12 明确不做 |
| 其它板面元素（价格、分类、中央 FAB、节点配图） | 按 C1–C11 / C19 / C21 已裁决不做 |
