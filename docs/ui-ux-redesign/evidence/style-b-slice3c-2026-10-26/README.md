# style-B Slice 3c —— 任务 / 通知 / 公告（2026-10-26）

范围：`pages/tasks`、`pages/notices`（tab）、`pages/anotices`（子页）。
判据来源：`docs/ui-ux-redesign/reference/screens-2026-10-20/03-4-tasks.png`、`03-5-notices.png`
（用户裁定：**仓库里的 10-20 板**是逐屏保真基准）。

**结论先行**：结构改动全部落地并经静态门 + 结构门取证；真机 **NOT_RUN**（未获授权重编译共享开发者工具会话），
所以本文件**不**包含"渲染正常"的结论，也不含像素级读数。

---

## §1 板面读数

### 03-4-tasks

| 板上有什么 | 读数 |
|---|---|
| 原生导航「任务清单」+ 返回 + 右侧圆形图标 | 本 app 用页面自绘身份头（品牌栏体系），不新增第二条自绘导航 |
| 分段控件：全部 / 个人 / 团队（整宽三段、选中白底） | 我们的分段是**状态**筛选（全部 / 待办 / 进行中 / 已完成…，C6 已定），形态沿用现有 segmented |
| 分区标题「进行中任务」 | 已由 `.tasks-identity` 承担（题名 + 一句定位） |
| 扁平行：状态点 + 标题 + 右侧状态 chip + 「负责人：某某」 | 我们保留逐条 `task-row`（左侧状态边栏 + 文字状态），行内信息一条不少 |
| 底部整宽深绿实心「发布任务」 | **本轮改动**：新建从页头搬进 `.sticky-action` |

### 03-5-notices

| 板上有什么 | 能否落地 |
|---|---|
| 消息流：头像 + 发送者名（领队）+ 浅色时间 + 正文两行 | 正文/时间可做；**头像与发送者名不可做**——`domain/selectors.js:172` 的 `noticeView` 只投 id/activityId/content/publishedAt/sourceEventId/kind/audience/readBy/deliveries，**没有发送者身份**，补它属于 domain/投影改动（本轮禁改） |
| 正文配图 + 居中文字链「查看天气」 | `Notice` schema 无图片字段 ⇒ 不可做；「查看活动安排」文字链我们本来就有 |
| 无卡片边界、逐条留白 | **本轮改动**：`.notice-card` 从白卡堆叠改为发丝分隔的消息流 |
| 无已读/未读标记 | 保留我们的读态（文字徽标 + 左侧深色边线），那是产品事实不是装饰 |

---

## §2 落地结构

### 2.1 tasks（`miniprogram/pages/tasks/`）

```
<any> <view class="page {{canManage && !denied && !loading ? 'has-sticky' : ''}}">
        .tasks-identity      题名 20/28 + 一句定位（本轮由 18/26 提到 20/28）
        segmented 筛选        aria-label="任务筛选"，计数在段内（{{item.count}}）
        task-row × N          左状态边栏 + 标题 / 分类 / 负责人 / 说明 / 截止 / 文字状态 + 行内动作
        <view wx:if="{{canManage && !denied && !loading}}" class="sticky-action">
          .button.primary 新建任务
```

`.page.has-sticky`（120px）与 `.sticky-action` 的 `wx:if` **同条件**：只读参与者既看不到按钮，也不会白多 88px 页尾留白。
底栏几何：12 + 48 + 12 = 72px（+ 底部安全区）< 120px 的留白基线，末条记录不会被拦住。

### 2.2 notices / anotices

```
notices（tab）                               anotices（子页）
brand-header（自绘）                          ——（原生导航「活动通知」）
section-head: kicker 通知                     section-head: kicker 通知
              list-head__title 20/28                        list-head__title 20/28
              section-sub                                  section-sub
「共 N 条 · 最新的在最上面 · 左侧深色边线的是还没读的」   ← 同一条（一行细字）
notice-card × N（扁平行）                     ← 同一套（`page2-gates` 的 bodyAnchors 要求同构）
  card-header: badge 已读/未读 + time
  text.notice-body 16/24
  form-actions: 标记已读 / 查看活动安排 / 复制通知
  投递记录（仅 owner）
加载更多（hiddenCount）
```

两份页面的正文逐块同构，差异只留在页头（tab 版有品牌栏，子页走原生导航）——这正是 M-18 允许的差异面。

### 2.3 行形态（唯一真值源：`app.wxss`）

```css
.notice-card {
  padding: 18px 0 18px 12px;
  border-left: 2px solid transparent;     /* 两条读态都占位 */
  border-bottom: 1px solid var(--line);
  background: transparent;
  border-radius: 0;
}
.notice-card.unread { border-left-color: var(--forest); }
.notice-card .notice-body { font-size: var(--text-input); line-height: 24px; }
```

两个页面 wxss 里没有一条行样式（`notices.wxss` 只有 tab 页留白，`anotices.wxss` 只有一条说明为什么不留），
所以行形态只有一个出处，改回卡片式必然在门里红。

**为什么左边边线要两条都占位**：只给未读加边会把该行整体右移 2px，同一列表里读/未读两行的文字左缘对不齐
（未读行文字左缘 = 20 页边距 + 2 边线 + 12 内距 = 34px，读行同值）。

---

## §3 改动面

| 文件 | 改动 |
|---|---|
| `miniprogram/pages/tasks/tasks.wxml` | 根节点挂条件 `has-sticky`；页头删除实心「新建任务」；末尾新增 `sticky-action` 底栏 |
| `miniprogram/pages/tasks/tasks.wxss` | `.tasks-identity__title` 18/26 → 20/28（与 `home.wxss:33`、`workspace.wxss:23-24` 同档） |
| `miniprogram/app.wxss` | `.notice-card` 改扁平行 + `.notice-card.unread` 改切颜色 + 新增 `.notice-card .notice-body` |
| `miniprogram/pages/notices/notices.wxml` | 正文 `text` 挂 `class="notice-body"` |
| `miniprogram/pages/anotices/anotices.wxml` | 两个分区头并成一个；列表读数降为一行细字；正文挂 `class="notice-body"` |
| `tools/operations-layout-test.js` | +6 条（57/0）：任务底栏与标题档、通知行形态与牙齿、正文档、公告同构；"不新造颜色"循环扩到两份通知页 |
| `tools/scenario-workspace-test.js` | 3b 遗留的 re-pin 已在前一批完成（125/0） |
| `tools/scenario-tasks-test.js` | re-pin 新建按钮位置（见 §5） |

`cloudfunctions/` 零改动 ⇒ **不需要重新部署 trailApi**。

---

## §4 有意的偏离（板上做不到 / 我们做得更准）

| # | 板 | 我们 | 理由 |
|---|---|---|---|
| D1 | 通知行有头像 + 发送者名（领队） | 只有读态徽标 + 时间 | `noticeView` 无发送者字段；补它要动 domain/投影（本轮禁改）。**不是漏做** |
| D2 | 通知配图 + 「查看天气」链 | 无图；保留「查看活动安排」 | `Notice` 无图片字段；我们没有活动级天气深链的既有入口 |
| D3 | 板上未读无标记 | 徽标 + 左侧深色边线 | 读态是产品事实；`scenario-notices` 与两条线的语义都钉着它 |
| D4 | 任务分段是 全部/个人/团队 | 全部/待办/进行中/已完成 | C6 已定：保留**状态**分段（板上那三段我们没有"团队"这个维度） |
| D5 | 任务页无独立大标题（原生导航顶字） | 保留 `.tasks-identity` 题名 20/28 | 我们不走原生标题栏，页面身份必须仍有字面 |

---

## §5 门禁读数（本批实跑）

| 套件 | 读数 |
|---|---|
| `node tools/check.js` | ALL CHECKS PASSED（G10：42 作用域 / 3159 token / app.wxss 136 类名，命中 0；G11：43 wxss / 718 选择器 / 双写 0） |
| `node tools/check-handlers.js` | 通过；死 handler 仍只有存量 `pages/editor/editor.js#onNumber` |
| `operations-layout-test` | **57 / 0**（本批 51 → 57） |
| `scenario-tasks-test` | 34 / 0 |
| `scenario-notices-test` | 105 / 0 |
| `page2-gates-test` | 117 / 0（`bodyAnchors` 含 `notice-card`，两份页面仍同构；tab 留白分档不变） |
| `scenario-workspace-test` | 125 / 0 |
| `scenario-activity-test` | 212 / 0 |
| `header-layout-test` | 38 / 0 |
| `nav-chrome-test` | 15 / 0 |
| `swx1-style-gates-test` | 45 / 0 |
| `swx2-style-gates-test` | 110 / 0 |
| `t4-e08-test` | 41 / 0 |
| `m02-class-scope-test` | 66 / 0 |
| `b4-pad-final-value-test` | 33 / 0（tab 页 84px 仍只在 notices；anotices 不留） |
| `ui-consistency-test` | 19 / 0 |
| `journey-graph-test` | 15 / 0 |
| `e2e-task-test` | 28 / 0（按文案点，不受类名与按钮位置影响） |

### 两条 re-pin（位置变了，判据不松）

| 套件 | 旧断言 | 新断言 | 为什么更强 |
|---|---|---|---|
| `scenario-tasks-test` | 页头存在 `wx:if="{{canManage}}"` 的实心新建按钮 | `sticky-action` 与 `task-row__actions` **各自**都要 `canManage` 守卫 | 旧断言只证明"页头那颗受管"；新断言同时钉住底栏受管 + 行内受管，且与 `.page.has-sticky` 同条件 |
| `operations-layout-test`（任务） | 新建与筛选同在页头之前 | 底栏必须在 `.sticky-action` 内、页头不再出现 `onNew`、根节点 `has-sticky` 与 `canManage` 同表达式 | 位置换了但多钉了"页头不许再长实心按钮"与"只读参与者不许多留白"两条 |

`scenario-workspace 125/0` 里那条 3b re-pin（名单三格指标带）本批复跑仍绿。

---

## §6 变异自证（真文件改坏 → 跑门 → 还原比对 sha256）

| # | 变异 | 预期 | 实测 |
|---|---|---|---|
| M1 | `tasks.wxml` 根节点 `has-sticky` 去掉 `canManage` 条件 | 红 1 | **红 1**：任务：新建在固定底栏且受 canManage 保护… |
| M2 | `app.wxss` 未读边改回「只给未读加边 3px」（去掉透明占位） | 红 2 | **红 2**：行形态断言 + 该断言的牙齿自检（读同一份 app.wxss，必然一起红，不是重复计数） |
| M3 | `anotices.wxml` 恢复第二个分区头 | 红 1 | **红 1**：公告：单分区头 + 一行读数… |
| M4 | `app.wxss` 通知正文退回 14/22 | 红 1 | **红 1**：通知：行是发丝分隔的消息流… |

四次变异后 `sha256` 与改前逐字节一致，套件复跑 57/0。
另：M2 第一次跑只报 `红 2（预期 1）`——是我的脚本预期写错，不是门多报；按实测改预期并在此如实登记。

---

## §7 布局算术

| 量 | 值 | 出处 |
|---|---|---|
| 通知正文左缘 | 20（`.page` 页边距）+ 2（左边线占位）+ 12（行内距）= **34px**（读/未读同值） | `app.wxss` `.page` / `.notice-card` |
| 通知两条正文之间 | 18 + 12（`stack-gap3`）+ 18 = **48px** | 同上 + `.stack-gap3` |
| 任务底栏高度 | 12 + 48 + 12 = **72px** + `env(safe-area-inset-bottom)` | `.sticky-action` + `--action-height` |
| 页尾留白 | `.page.has-sticky` = **120px** > 72 + 32 = 104 | `app.wxss` |
| 任务题名 | 20 / 28 / 600 | `tasks.wxss`，与 `home.wxss:33`、`workspace.wxss:23` 同档 |

---

## §8 真机

**NOT_RUN。** 驱动需要 `close --project` + `open` 重编译（共享开发者工具会话），本轮未获授权。

要升到 VERIFIED 至少需要（缺一条都不算页面级证据）：

1. bundle 新鲜度自证：新文案出现在屏上（例：任务页底栏「新建任务」+ 通知页「左侧深色边线的是还没读的」）。
2. 载荷断言在截图之前：`tasks` 需 `loading=false`、`denied=''`、`canManage` 真/假两态；
   `notices` 需 `items.length>0` 且至少一条 `read:false`。
3. 多用例污染自证：每例 `reLaunch` + 不同读数，两例读数相同即判整批截图无效。
4. 两态对照：任务页 `canManage=false` 时必须**没有**底栏，且页尾不多出 88px 空白。

---

## §9 UNVERIFIED

- 像素层：行间距手感、发丝线在 375/390/414 下的视觉密度、`notice-body` 16/24 的折行。
- 原生能力：下拉刷新（两页 `enablePullDownRefresh`）、`wx.setClipboardData` 的真实反馈、键盘与弹层。
- `anotices` 的真实打开路径（从活动详情 `navigateTo`）与返回。
- 任务页只读参与者视角的真实数据（本批只有结构门与注入夹具）。
