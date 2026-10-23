# 活动创建全流程 · 交互与 UI 设计

- 日期：2026-10-23
- 分支：`agent/ourtrail-style-a-20261023`（工作树，未提交）
- 状态：**已按选项 B 实施（2026-10-23）**，实现记录见 §12；真机读数见 `docs/ui-ux-redesign/evidence/creation-flow-2026-10-23/`
- 范围：从「发起活动」入口到「发布后分享」的整条创建链路，含入口页、编辑器四步、四类弹层、草稿预览与发布后落地页。
- 设计语言：方案 A（`--paper` 纸面底 · 森林绿唯一主操作 · 白卡 1px 描边 · 下划线页签 · 高密度），只复用 `app.wxss` 既有 token 与类。

---

## 0. 不可越界的边界（先定死）

| # | 约束 | 理由 |
|---|---|---|
| 0.1 | 不改 `cloudfunctions/**`、`domain/**`、`schema`、命令与业务状态机 | 本轮是交互与 UI；发布门/授权/幂等全部留在服务端 |
| 0.2 | 不改 `missingForPublish` 的**判据**（标签、步骤、条数） | `tools/scenario-editor-test.js:544-579` 把它钉成 5 条原始项；放宽或合并会动发布门 |
| 0.3 | 不重排四步，不把集合点上移到第 1 步 | `editor.js:953` 的 `applyRouteSnapshot` 会在用户停在第 1 步时自动生成集合点，挪上去会让它出现在视野外；四步标签在 306px 下也放不下「路线与集合」 |
| 0.4 | 不新增色值 / 字号 / 圆角 / 间距 token | 只允许 `app.wxss` 既有 `.callout` `.badge` `.cluster` `.stack-gap3` `.button` `.chip` 等 |
| 0.5 | 一屏一个 primary | 互斥分支（`wx:if`）各算一次预算；发布后横幅与底部操作同屏，必须降级其中一个 |
| 0.6 | 不新增分享入口数量 | 发布后只把「分享」提为 primary，不加第二个分享按钮 |
| 0.7 | 保留「必填 vs 可后补」两分法 | 这是 2026-10-14 快速创建的既有产品决策，不在本轮推翻 |

---

## 1. 今天用户实际走的路

### 1.1 页面与命令时序

| 顺序 | 页面 | 文件 | 进入方式 | 关键命令 |
|---|---|---|---|---|
| 1 | 首页 | `pages/home/home` | tabBar | — |
| 2 | 路线详情（可选） | `pages/route/route` | 路线库 | `read {kind:'route'}` |
| 3 | 工作台（可选） | `pages/workspace/workspace` | 活动详情 | — |
| 4 | 活动草稿预览（可选） | `pages/activity/activity` | 保存并预览 | `read {kind:'activity'}` |
| 5 | **编辑器** | `pages/editor/editor` | 首页「发起活动」/ 路线「用这条路发起活动」/ 工作台「编辑」 | `activity.create` → `activity.edit` → `activity.publish` |
| 6 | 活动详情（发布后） | `pages/activity/activity` | `wx.redirectTo` | — |
| 7 | 分享 | 微信原生分享卡 | `open-type="share"` | — |

入口证据：

- 首页「发起活动」`home.wxml:18-25` → `home.js:178` → `/pages/editor/editor`
- 路线详情主操作 `route.wxml:232` → `route.js:345` → `/pages/editor/editor?routeId=`
- 工作台 `workspace.js:182` → `/pages/editor/editor?id=`
- 发布成功 `editor.js:1545` → `wx.redirectTo('/pages/activity/activity?id=' + this.savedId)`

### 1.2 编辑器的四个步骤

`editor.js:196`：`['01 信息', '02 路线', '03 介绍', '04 发布']`。

| 步 | 标签 | 当前实际职责 | 发布门归属 |
|---|---|---|---|
| 0 | 01 信息 | 路线捷径卡 + 名称 + 三个时间 + 模板复制 | 名称、出发、结束、截止、时间顺序 |
| 1 | 02 路线 | 路线卡 + 节点 + **集合上车点** | 集合点 |
| 2 | 03 介绍 | 正文块（可选） | 不拦 |
| 3 | 04 发布 | 名额/审核/可见性/费用/风险/装备 | 不拦 |

### 1.3 今天必须保住的东西

1. **快速创建主路径**：先定出发 → 自动推算结束/截止（`editor.js:575-613`）→ 选路线自动填名称/里程/节点/风险（`applyRouteSnapshot` `editor.js:919-967`）→ 自动生成集合点（`autoPickupFor` `editor.js:616-636`）→ 补一句地址即可发布。这条路径是对的，不能因为"整理"而加一步。
2. **必填与可后补分离**：`missingForPublish`（`editor.js:1256-1271`）只拦 5 条；`deferredForPublish`（`1275-1287`）只点名不拦路，且发布确认层给「去补上」出口。
3. **发布确认层的知情跳过**：`editor.wxml:752-756` + `onDeferredFix`（`editor.js:1488-1494`）。
4. **草稿的自动保存 + 云保存双轨**：`persistDraft`（`editor.js:399-406`）本机自动保存；`onSave` 走 `activity.create/edit`。
5. **进度可解释**：`stepDone` 与 `publishReady` 都从同一份 `missingForPublish` 派生（`checklistPatch` `editor.js:637-648`），模板不重算。
6. **无路线也能发**：路线名称/节点/风险都属可后补，不能被视觉改动重新变成必填。

---

## 2. 现状问题清单（D1–D14）

> 证据档：全部为 E1（源码文本可直接核实）。严重度按"是否会让用户做错决定 / 卡住 / 产生死链"判，不按是否符合规范判。

| # | 问题 | 证据 | 严重度 | 归类 |
|---|---|---|---|---|
| D1 | 第 1 步副标题承诺「集合时间」，但集合点 UI 在第 2 步；缺集合点时跳转落在「02 路线」 | `editor.wxml:39` vs 集合 UI `editor.wxml:335-431`；missing 项 `step:1` 在 `editor.js:1269` | 高 | 自相矛盾 |
| D2 | 派生时间被算成 3 个任务：空表单「还差」列出出发/结束/截止三条，用户以为要填三次 | `editor.js:1260-1262` | 中 | 信息噪声 |
| D3 | 路线入口出现两次：第 1 步整卡（`editor.wxml:45-59`）+ 第 2 步整卡（`196-206`） | 同上 | 中 | 重复结构 |
| D4 | 切步不回到顶部；第 2/4 步很长，切过去停在上一屏的位置 | `setStep/prevStep/nextStep` `editor.js:1141-1155`，全文件无 `pageScrollTo` | 中 | 导航 |
| D5 | 发布后没有分享时刻：`doPublish` 直接跳活动页，而活动页 primary 是「进入工作台」，分享是 text 权重 | `editor.js:1541-1545`；`activity.wxml:63-66`、`77-80` | 高 | 闭环断裂 |
| D6 | 草稿预览页仍显示分享按钮、分享菜单也未关；草稿仅自己可见，转发出去的链接对他人是死链 | `activity.wxml:77-80`；`activity.js:235-242` 无草稿分支 | 中 | 死链 |
| D7 | 发布弹层文案「报名的人在发布前看不到这些信息」主语混乱（说的是草稿可见性，不是缺项） | `editor.wxml:752-756` | 中 | 文案 |
| D8 | 路线弹层空态说「可以先导入 GPX」，但层内没有 GPX 按钮；搜索空态同样只提不做 | `editor.wxml:825-836` | 中 | 可发现性 |
| D9 | 自动生成集合点的提示渲染在整页最底部，用户刚在第 1 步改完时间，看不到 | 文案 `editor.js:610` / `953`；渲染位 `editor.wxml:715` | 中 | 反馈位置 |
| D10 | 所有反馈（failure / profileGate / message）都在页尾；切步被 `contentBusy` 拦下、发布预检跳步时，提示在折叠线以下 | `editor.wxml:709-715`；拦截点 `editor.js:1142-1144`、`1292-1295` | 中 | 反馈位置 |
| D11 | 有本机草稿时，草稿覆盖路线预填，但顶部横幅仍宣称「已从路线库带入」 | 覆盖在 `editor.js:356`；横幅赋值 `373`；渲染 `editor.wxml:23-26` | 低 | 不诚实 |
| D12 | 三种保存并存且语义未解释：自动保存（本机）、保存草稿（云端）、保存并预览 | `editor.wxml:717-721`、`724-736` | 中 | 语义不清 |
| D13 | 已发布活动在第 4 步底栏**没有 primary**（只给 `isDraft` 渲染），必须滚到页尾才能保存 | `editor.wxml:735` | 中 | 操作层级 |
| D14 | 「创建模板副本并编辑」会离开本页，当前填写无二次确认 | `editor.js:1314-1323` | 低 | 误触 |

### 2.1 不是问题、不要顺手改的

- 第 4 步文案「名额已默认 24 人、手动审核；不改也能直接发布」（`editor.wxml:477`）是对的。
- 集合点空态的三条出路（地图选点 / 用路线起点 / 手动添加，`editor.wxml:342-350`）优先级正确。
- 发布确认层的「我本人也参加」折叠出行的逻辑（`editor.wxml:759-790`）是对的。
- 第 3 步 `contentBusy` 时禁止切步（`editor.js:1142`）是对的，只是提示位置错。

---

## 3. 目标信息架构

### 3.1 四步不动，职责写清

| 步 | 标签（不变） | 页内标题 | 唯一主任务 | 主操作（sticky） |
|---|---|---|---|---|
| 0 | 01 信息 | 名称与出发时间 | 给活动一个名字、三个时间 | 下一步 / 发布活动（齐了） |
| 1 | 02 路线 | 路线与集合 | 有路线就带入；给出 ≥1 个可用集合点 | 下一步 |
| 2 | 03 介绍 | 介绍（可选） | 决定分享第一印象 | 下一步 |
| 3 | 04 发布 | 发布 | 名额/审核/可见性确认；发布或保存 | 发布活动 / 去补齐 / 保存修改 |

**为什么不改标签文字**：306px 视口下 4 个 tab 均分，`01 信息` 已是 5 字宽；`02 路线与集合` 会换行或截断。D1 用「页内标题 + 缺口项带步骤名」解决，不动 tab。

### 3.2 主操作预算表（全链路）

| 页面/层 | primary | 其余动作 |
|---|---|---|
| 首页 | 无（浏览为主） | 发起活动（text）、发现活动（text） |
| 路线详情 | 用这条路发起活动 | 编辑（secondary）、删除（text，既有债不在本轮） |
| 编辑器 step 0–2（未齐） | 下一步 | 上一步（text） |
| 编辑器 step 0–2（齐了） | 发布活动 | 上一步（text）、继续完善（text） |
| 编辑器 step 3（草稿且齐） | 发布活动 | 上一步（text） |
| 编辑器 step 3（草稿未齐） | 去补齐 | 上一步（text） |
| 编辑器 step 3（已发布） | 保存修改 | 上一步（text） |
| 发布确认弹层 | 确认发布 | 取消（text）、去补上（text） |
| 活动详情（草稿） | 返回编辑与发布 | 无分享 |
| 活动详情（刚发布） | 分享给同行的人 | 进入工作台（text） |
| 活动详情（常态） | 进入工作台 / 报名类 CTA | 分享（text） |

---

## 4. 逐页设计

### 4.1 入口页

**首页（`home.wxml:11-26`）**：保持现状。「发现活动」「发起活动」都是 text 权重，首页的主任务是看活动，不作为主操作。空态卡（`149-151`）的「发起一场同行」保持不变。

**路线详情（`route.wxml:225-240`）**：primary「用这条路发起活动」保持不变。补一条 preflight 事实行（复用已有 `routeView` 字段，不新增请求）：`{{distanceKm}} km · 爬升 {{ascentM}} m · {{pointCount}} 个节点`，让用户在点之前知道会带什么进去。**不在本轮删红色「删除这条路线」**（`route.wxml:239`，属既有规范债，已登记，不与创建流程混改）。

**工作台 / 活动草稿预览**：入口保持不变；草稿预览的分享入口见 §4.9。

### 4.2 编辑器外壳

#### 4.2.1 头部与页签

- 头部（`editor.wxml:13-20`）保持：eyebrow、标题、副标题、`删除草稿`（text）。
- 页签（`29-33`）保持：`.segmented.tabs-line` + `.seg`，`stepDone` 只做视觉记号。
- **反馈区上移**：把 `editor.wxml:709-715` 的三块整体移到页签之后、步骤内容之前。理由：切步、发布预检、内容上传拦截的提示必须和页签同屏，否则等于没有提示（D10）。

```xml
<!-- 位置：editor.wxml:33 之后 -->
<view wx:if="{{failure}}" class="callout danger">{{failure}}</view>
<view wx:if="{{profileGate}}" class="callout warning">
  <text class="callout-title">发布前需要同行资料</text>
  <text style="display:block;margin-top:4px;">用微信头像、昵称和手机号补全后，会自动继续刚才的保存或发布；也可以手动填写。</text>
  <view class="button text" hover-class="button-hover" bindtap="onOpenProfileGate">补全资料后继续</view>
</view>
<view wx:if="{{message}}" class="callout success">
  <text>{{message}}</text>
  <view wx:if="{{messageActionLabel}}" class="button text" hover-class="button-hover" bindtap="onMessageAction">{{messageActionLabel}} ›</view>
</view>
```

- 优先级：`failure` > `profileGate` > `message`；保持各自的 `wx:if`，不合并成单一模型（避免改动所有 setData 点位）。
- **滚动归位**：新增 `scrollTop()` 辅助，用仓库既有守卫写法（`workspace.js:161`）：

```js
scrollTop() {
  if (typeof wx !== 'undefined' && typeof wx.pageScrollTo === 'function') {
    wx.pageScrollTo({ scrollTop: 0, duration: 0, fail: () => {} })
  }
}
```

调用点：`setStep`、`prevStep`、`nextStep`、`onPublishIntent` 预检失败后、`setStep` 被 `contentBusy` 拦下后、`onMessageAction`。

#### 4.2.2 底部动作栏

保持 `editor.wxml:724-736` 的互斥分支结构，只改三处：

1. **已发布 step 3 补 primary**：`保存修改` → `onSave`。
2. **草稿 step 3 未齐**：primary 改为 `去补齐` → `onFixRequired`（不再显示一个点了会被弹回第 1 步的「发布活动」）。
3. **草稿 step 3 已齐**：保持 `发布活动`。

```xml
<view wx:if="{{step === 3 && isDraft && publishReady}}" class="button primary block ..." bindtap="{{busy || contentBusy ? '' : 'onPublishIntent'}}">发布活动</view>
<view wx:elif="{{step === 3 && isDraft}}" class="button primary block ..." bindtap="{{busy || contentBusy ? '' : 'onFixRequired'}}">去补齐</view>
<view wx:elif="{{step === 3}}" class="button primary block ..." bindtap="{{busy || contentBusy ? '' : 'onSave'}}">保存修改</view>
```

> `e2e-golden-path-test.js:478-503` 在 GP-03 里点的是「发布活动」并成功打开弹层，说明该夹具到达 step 3 时 `publishReady` 为真，标签仍是「发布活动」，不受影响。

#### 4.2.3 保存语义（D12）

底部保存行（`717-720`）保持两个按钮，只补一句解释，把"本机自动保存"和"云端草稿"分开：

```xml
<text wx:if="{{draftSavedAt}}" class="small muted" style="text-align:center;">已在本机自动保存 · {{draftSavedAt}}</text>
<text class="small muted" style="text-align:center;">「{{saveLabel}}」会同步到云端，换设备也能继续；「保存并预览」先看一遍再发。</text>
```

文案约束：`saveLabel` 仍由 `editor.js:371` 的 phase 决定（`保存草稿` / `保存修改`），不改。

### 4.3 第 1 步：信息

**页内标题与副标题（`editor.wxml:37-40`）**

- 标题：`名称与出发时间`（原「名称、出发时间与集合」——删掉"集合"，它不在这一步）
- 副标题：`结束时间与报名截止会按出发时间自动推算；名称和三个时间齐了就能往下走。`

**路线捷径（替换 `editor.wxml:44-59` 整卡）**

把整卡降级为一行 text 捷径，保留冷启动价值，但不让第 1 步出现第二个"面"：

```xml
<view class="cluster" style="justify-content:space-between;align-items:flex-start;">
  <text class="small muted" style="min-width:0;flex:1;">
    {{form.routeTitle ? '已带入路线：' + form.routeTitle : '有现成路线？可以自动填好名称、里程与节点。'}}
  </text>
  <view class="cluster">
    <block wx:if="{{!form.routeTitle}}">
      <view class="button text ..." bindtap="onQuickRouteOpen">从路线库选择</view>
      <view class="button text ..." bindtap="onImportGpx">导入 GPX</view>
    </block>
    <view wx:else class="button text ..." bindtap="onGoRouteStep">去 02 路线调整 ›</view>
  </view>
</view>
```

- 保留 `form.routeTitle` 时的「已带入」语义，但不再重复第 2 步的整张卡。
- `onGoRouteStep`：`setData({ step: 1 }, () => this.scrollTop())`。
- 路线被冻结（`canChangeRoute === false`）时，两个 text 按钮不渲染，只显示说明（原来 `:58` 的那句迁移到行尾）。

**名称 / 时间 / 模板卡**：结构不动（`61-179`）。模板复制加确认，见 §4.10.4。

**就绪提示（`editor.wxml:182-185`）**

改为分组清单，让"还差"和步骤对得上：

```xml
<view wx:if="{{!publishReady}}" class="callout warning">
  <text class="callout-title">还差 {{requiredGroups.length}} 项</text>
  <view wx:for="{{requiredGroups}}" wx:key="key" class="cluster" style="justify-content:space-between;margin-top:6px;">
    <text>{{item.label}}</text>
    <text class="small muted">{{item.stepText}}</text>
  </view>
</view>
<view wx:else class="callout success">
  <text class="callout-title">必填项已齐，可以直接发布。</text>
</view>
```

### 4.4 第 2 步：路线与集合

结构保持（`188-431`），三处补充：

1. **自动生成的集合点带来源徽标**：折叠卡标题行加 `<text wx:if="{{autoPickupIds[item.id]}}" class="badge neutral">自动生成</text>`，说明它来自路线起点 / 出发时间推算，不是用户手填。
2. **地址缺失的后果说清**：折叠卡已有「还没写集合位置，点「编辑」补一句。」（`:361`），保留；在集合区标题下补一句 `发布只要求每个集合点有名称、位置和时间。`（替换 `:339` 的等义长句，缩短）。
3. **路线卡与第 1 步的分工**：第 2 步的路线卡（`196-236`）是唯一完整路线面；空态、更换、GPX、查看/调整都留在这里。

集合区加锚点 `id="pickup-section"`（放在 `editor.wxml:336` 的 `.section-head`），供 `onFixRequired`/`onMessageAction` 用 `wx.pageScrollTo({ selector })` 定位。

### 4.5 第 3 步：介绍

保持 `editor.wxml:433-470` 与 `content-editor` 契约。仅一处：

- `contentBusy` 时底栏按钮已禁用（`:727-733`），反馈上移后，`onContentBusy` 的拦截文案（`editor.js:1142-1144`）会出现在页签下方，用户能看见"为什么点不动"。

### 4.6 第 4 步：发布

结构保持（`472-707`）。就绪提示与第 1 步同构（替换 `:699-706`），已齐时仍保留「必填项已齐」的 success 卡 + 可后补说明。

### 4.7 发布确认弹层

`editor.wxml:746-798`，改三处：

1. **缺项文案（D7）**：

```xml
<view class="callout info">
  <text class="callout-title">这些还没填</text>
  <text style="display:block;margin-top:4px;">不影响发布。没填的项不会出现在活动详情里，补上后对已报名的人也立即生效。</text>
  <view class="cluster" style="margin-top:8px;">
    <text wx:for="{{deferredItems}}" wx:key="label" class="badge neutral">{{item.label}}</text>
  </view>
  <view class="button text" hover-class="button-hover" bindtap="onDeferredFix">从第一项开始补 ›</view>
</view>
```

- 新增 `deferredItems`（由 `deferredForPublish` 直接得到，在 `onPublishOpen` 里落 data），不再用逗号串。
- 可后补为空时不渲染此卡（现状可能渲染空串，`onPublishOpen` 里加条件）。

2. **摘要（`748-751`）**：保持 `publishSummaryText`，但拆行：时间一行、集合点一行、名额与路线一行（`publishSummaryLines` 数据侧派生），避免长句在 306px 折成 3 行。

3. **主按钮（`794`）**：保持 `确认发布`，禁用条件不变（`busy || (participate && !dataUse)`）。

### 4.8 发布之后：把闭环接上（D5）

**编辑器侧**：`doPublish` 成功后跳转带一次性参数。

```js
wx.redirectTo({ url: '/pages/activity/activity?id=' + this.savedId + '&published=1' })
```

**活动页侧**：

- `onLoad`（`activity.js:225-229`）记 `this.justPublished = options.published === '1'`。
- `reload` 的 `setData`（`activity.js:447` 附近）加 `justPublished: !!this.justPublished`。
- **首帧后消费掉**：`reload` 的 `setData` 回调里 `this.justPublished = false`（页面再次 `onShow` 不再重复庆祝；刷新同一 URL 也只庆祝一次）。
- 页面顶部（`activity.wxml:11` 之后，草稿提示之后）插入：

```xml
<view wx:if="{{justPublished}}" class="callout success">
  <text class="callout-title">活动已发布</text>
  <text style="display:block;margin-top:4px;">把链接发到群里，同行的人就能报名。还没填的图文与风险，之后随时能补。</text>
  <button class="button primary block" hover-class="button-hover" open-type="share">分享给同行的人</button>
</view>
```

- **一屏一个 primary**：同一屏的底部主操作（`activity.wxml:63-66`）在 `justPublished` 时降为 text：`class="button {{justPublished ? 'text' : 'primary'}}"`；底部那个 text 分享（`77-80`）在 `justPublished` 时不渲染（`wx:if="{{!justPublished}}"`），保证分享按钮只有一个。
- 非 owner 不会出现 `justPublished` 横幅（参数只由发布者跳转带来；即便手改 URL，`justPublished` 也不该影响他人视角——渲染条件写成 `justPublished && isOwner`）。

### 4.9 草稿预览（D6）

- `activity.wxml:77-80` 的分享按钮加 `wx:if="{{!isDraft}}"`（保留 `open-type="share"` 字面量，`scenario-activity-test.js:1145` 静态门依赖它存在）。
- `activity.js` 在 `reload` 判定 `isDraft` 后调用（守卫写法同 `weather.js:223-224`）：

```js
if (typeof wx !== 'undefined' && wx.hideShareMenu) {
  wx.hideShareMenu({ fail: () => {} })
}
```

- `onShareAppMessage` 加兜底：`if (this.data.isDraft) return { title: '活动还在准备中', path: '/pages/home/home' }`。即便未来从哪里漏出一个入口，转出去的也不是死链。
- 草稿提示卡（`8-11`）保持，可在标题下补一句 `补完直接发布，别人才能看到。`（可选）。

### 4.10 弹层与对话框

#### 4.10.1 路线选择弹层（D8）

- 搜索空态（`825-828`）：补一个 `导入 GPX` 的 text 按钮。
- 路线库空态（`830-836`）：在「先不用路线」上方补 `导入 GPX`（secondary block），把文案里的"可以先导入 GPX"变成可点。
- 新增处理器 `onQuickRouteGpx()`：先关路线层，再开 GPX 层（两个 overlay 是兄弟节点，不能叠开）：

```js
onQuickRouteGpx() {
  this.setData({ quickRouteOpen: false }, () => this.onImportGpx())
}
```

- `canChangeRoute === false` 时不渲染该按钮。

#### 4.10.2 替换路线确认（`840-846`）

保持。这是已有二次确认，不动。

#### 4.10.3 GPX 弹层（`848-875`）

保持。

#### 4.10.4 模板副本确认（D14）

`onCopyTemplate` 在表单非空时先弹确认：

```xml
<overlay open="{{templateConfirmOpen}}" kind="dialog" title="用模板副本替换当前填写？" bind:close="onTemplateConfirmClose">
  <view class="stack">
    <text>会新建一份副本并进入编辑；当前页面还没同步到云端的改动不会带过去。</text>
    <view class="button primary block" bindtap="onTemplateConfirmGo">创建副本</view>
    <view class="button text" bindtap="onTemplateConfirmClose">继续当前填写</view>
  </view>
</overlay>
```

- "非空"判据：`form.title.trim() || form.points.length || form.pickups.length || this.contentFilled`。
- 空表单直接创建副本，不加摩擦（保持快速创建）。

#### 4.10.5 资料门（`877` `<profile-gate>`）

保持组件契约。只把入口从页尾的独立按钮改为反馈区内的 text action（§4.2.1），避免"提示在顶上、按钮在底下"。

#### 4.10.6 删除草稿（`738-744`）

保持。

---

## 5. 状态与失败语义

| 状态 | 触发 | 界面 | 主操作 | 备注 |
|---|---|---|---|---|
| loading | `reload` 中 | `<status-panel kind="loading">` | — | 底栏不渲染（`wx:if` 与 `has-sticky` 同条件） |
| denied | 无权限/已删除 | `<status-panel kind="denied">` | 回我的活动 | 保留 |
| busy | `onSave`/`onPublishIntent` 在途 | 底栏三层同时禁用（样式 + 空 handler + 守卫） | 无 | `busyAt` 8s 自愈 `J.busyStale` |
| contentBusy | 图片上传/检查 | 底栏禁用 + 反馈区提示 | 无 | 切步被拦时**必须**滚动到顶 |
| profileGate | 档案缺姓名/手机号 | 反馈区 warning + text action | 补全资料后继续 | 保存成功后自动重放原动作 |
| 必填未齐（step 3） | `!publishReady` | 反馈区/就绪卡列出分组 | 去补齐 | 跳到第一组所在步 |
| 必填未齐（其它步） | 点了发布 | 反馈区 `还差：…` | 下一步 | 滚到顶 + 跳步 |
| CONFLICT | 别人先改 | `dispatchAndSync` 重读后的既有提示 | 重试 | 不新增机制 |
| outcomeUnknown | 传输失败 | 既有 failure 话术 | 重读对齐 | **绝不自动重发**（既有约束） |
| routeLocked | 集合已产生/行程中 | 路线按钮禁用 + 说明 | — | 保留 |
| 路线库空 | `quickRoutes.length === 0` | 空态 + GPX + 先不用路线 | 导入 GPX | 本轮补按钮 |
| 草稿恢复 | 本机有 draft | 顶部一行 `已恢复本机草稿` | — | 见 §6.4 |
| 刚发布 | `?published=1` | 成功横幅 + 分享 primary | 分享给同行的人 | 只出现一次 |
| 已发布编辑 | `!isDraft` | step 3 primary `保存修改` | 保存修改 | 本轮补 |

---

## 6. 只加"展示层派生数据"（不动 schema / domain）

全部在 `editor.js` / `activity.js` 的 `data` 内派生，不落库、不进 `buildInput()`、不影响命令 payload。

### 6.1 `missingForPublish` 加 `key`（不改标签、不改条数）

```js
missing.push({ step: 0, key: 'title', label: '活动名称' })
// 结束/截止/顺序三条都 key: 'time'
missing.push({ step: 1, key: 'pickup', label: '至少 1 个集合上车点' })
```

- 空表单仍是 5 条（`scenario-editor-test.js:544` 不变）。
- 标签与 `step` 逐字不变（`:545-579` 不变）。

### 6.2 `requiredGroups(form)`：只用于展示与跳转

| key | label | step | 聚合的原始项 |
|---|---|---|---|
| `title` | 活动名称 | 0 | 活动名称 |
| `time` | 出发与报名时间 | 0 | 出发时间 / 预计结束时间 / 报名截止时间 / 时间顺序 |
| `pickup` | 集合上车点 | 1 | 至少 1 个集合上车点 / 集合点的名称、地址与集合时间 |

派生字段：

- `requiredGroups`（数组，含 `key/label/step/stepText`）
- `requiredGroupText`（`活动名称、出发与报名时间、集合上车点`）
- `requiredMissingText` **保留现值语义**，改为 `requiredGroupText`；既有两个断言（`/集合上车点/`、齐了为 `''`）继续成立。
- `requiredGroupCount`（`还差 N 项` 里的 N）

`checklistPatch`（`editor.js:637-648`）改为同时算 groups：

```js
const missing = this.missingForPublish(form)
const groups = this.groupMissing(missing)
return {
  publishReady: missing.length === 0,
  requiredMissingText: groups.map(g => g.label).join('、'),
  requiredGroups: groups,
  stepDone: this.data.stepLabels.map((_, i) =>
    this.requiredSteps().indexOf(i) !== -1 && missing.every(m => m.step !== i)),
}
```

> `requiredSteps()`（`650-655`）继续按空表单派生，不受影响。

### 6.3 自动集合点来源

- `autoPickupIds`（对象映射 `{ [id]: true }`）在 `autoPickupFor` 创建后写入，用于折叠卡徽标。
- `messageActionLabel = '去确认集合点'` + `messageActionStep = 1`，只在 `autoPickupFor` 返回 `created: true` 或 `applyRouteSnapshot` 自动生成时设置；`persistDraft`/保存成功的 message 不带 action。
- `onMessageAction()`：`setData({ step: this.data.messageActionStep }, () => wx.pageScrollTo({ selector: '#pickup-section', duration: 300, fail: () => {} }))`。

### 6.4 草稿恢复

`reload()` 里 `saved && !savedId` 时置 `draftRestored: true`，渲染一行：

```xml
<text wx:if="{{draftRestored}}" class="small muted">已恢复本机草稿，自动保存中。</text>
```

不新增时间字段（`draft.setDraft` 不存 `savedAt`，不为此改 `utils/draft.js`）。

### 6.5 发布后一次性标记

- 编辑器：只改跳转 URL。
- 活动页：`justPublished`（运行期实例属性 → 首帧 data → 立即消费）。

### 6.6 发布弹层摘要

- `deferredItems`：`deferredForPublish()` 的原数组。
- `publishSummaryLines`：`[时间, 集合点, 名额 · 路线]` 三段；`publishSummaryText` 保留（现有测试/分享可能引用）。

---

## 7. 关键流程伪代码

### 7.1 切步（D4）

```js
setStep(e) {
  const step = Number(e.currentTarget.dataset.step)
  if (this.data.contentBusy) {
    this.setData({ failure: '图片正在上传/检查，请稍候再切换步骤。' })
    this.scrollTop()
    return
  }
  if (step === this.data.step) return
  this.setData({ step }, () => this.scrollTop())
}
prevStep() { /* 同 setStep，目标 step-1 */ }
nextStep() { /* 同 setStep，目标 step+1，上限 3 */ }
```

### 7.2 发布预检（D1/D2/D10）

```js
onPublishIntent() {
  if (this.busyBlocks()) return
  const missing = this.missingForPublish()
  if (missing.length) {
    const groups = this.groupMissing(missing)
    this.setData({
      step: groups[0].step,
      failure: '还差：' + groups.map(g => g.label).join('、') + '。补齐后再发布。',
    }, () => this.scrollTop())
    return
  }
  this._afterProfile = () => this.onPublishIntent()
  this.persistCurrent('内容已保存，确认后正式发布。')
    .then(() => this.onPublishOpen())
    .catch(() => {})
}
```

- 空表单：`groups[0]` 仍是 `title` step 0（测试 `:549-552` 通过）。
- 只有当**唯一**缺口是集合点时，才落到第 2 步；此时 failure 逐字写着「集合上车点」，与落点一致。

### 7.3 去补齐（step 3）

```js
onFixRequired() {
  if (this.busyBlocks()) return
  const g = (this.data.requiredGroups || [])[0]
  if (!g) return
  this.setData({ step: g.step }, () => {
    if (g.key === 'pickup') {
      wx.pageScrollTo({ selector: '#pickup-section', duration: 300, fail: () => {} })
    } else {
      this.scrollTop()
    }
  })
}
```

### 7.4 发布成功

```js
.then(() => {
  draft.clearDraft(this.draftKey(), 'activity-editor')
  this.setData({ busy: false, publishOpen: false })
  api.toast('活动已发布')
  wx.redirectTo({ url: '/pages/activity/activity?id=' + this.savedId + '&published=1' })
})
```

### 7.5 活动页刚发布

```js
onLoad(options) {
  this.activityId = options.id || ''
  this.justPublished = options.published === '1'
  // ...
}
// reload() 的 setData 里
justPublished: !!(this.justPublished && this.data.isOwner)
// setData 回调
this.justPublished = false
```

### 7.6 路线层空态导入 GPX

```js
onQuickRouteGpx() {
  if (!this.data.canChangeRoute) return
  this.setData({ quickRouteOpen: false }, () => this.onImportGpx())
}
```

### 7.7 模板副本确认

```js
onCopyTemplate() {
  if (this.busyBlocks()) return
  const f = this.data.form
  const dirty = !!(f.title.trim() || f.points.length || f.pickups.length || this.data.contentFilled)
  if (dirty) { this.setData({ templateConfirmOpen: true }); return }
  this.doCopyTemplate()
}
```

---

## 8. 分层文件清单

### A 批 · 纠错（只修矛盾与反馈位置）

| 文件 | 改动 | 预估 |
|---|---|---|
| `miniprogram/pages/editor/editor.wxml` | 第 1 步副标题/标题；反馈区上移（709-715 → 33 后）；就绪卡改分组；发布弹层文案与 chips；路线层空态加 GPX | +45 / −30 |
| `miniprogram/pages/editor/editor.js` | `missing` 加 `key`；`groupMissing`/`requiredGroups`；`scrollTop`；切步与预检滚动；`onQuickRouteGpx`；`deferredItems` | +55 / −12 |
| `miniprogram/pages/activity/activity.wxml` / `.js` | 草稿隐藏分享按钮；`hideShareMenu`；`onShareAppMessage` 草稿兜底 | +12 / −4 |
| `miniprogram/pages/editor/editor.wxss` | 就绪清单行距、捷径行（复用既有类优先，必要时 1-2 条局部规则，不新增 token） | +8 |

### B 批 · 结构收敛 + 发布闭环（推荐随 A 一起）

| 文件 | 改动 | 预估 |
|---|---|---|
| `editor.wxml` | 第 1 步路线整卡 → 一行捷径；sticky 三态（发布/去补齐/保存修改）；`autoPickupIds` 徽标；`#pickup-section` 锚点；保存语义说明 | +35 / −35 |
| `editor.js` | `onGoRouteStep`；`onFixRequired`；`autoPickupIds`；`messageAction*`；`onMessageAction`；`fromRouteTitle: saved ? '' : …`；模板确认三件套；`?published=1` | +65 / −18 |
| `activity.wxml` / `.js` | 刚发布横幅；primary 降级；`justPublished` 生命周期；`onShareAppMessage` | +20 / −6 |
| `editor.wxss` / `activity.wxss` | 捷径行与横幅排版（只用既有 token） | +14 |

### C 批 · 入口与草稿页重做（本轮不做）

首页入口结构、路线详情 preflight 卡改造、草稿预览改"发布前检查单"。收益边际，风险面最大（动三个非编辑器页面），单独评审。

**不受影响**：`cloudfunctions/**`、`domain/**`、`utils/**`、`app.wxss`、`app.json`、任何测试夹具的 schema。

---

## 9. 验证计划

### 9.1 静态门（必跑）

```bash
node tools/check.js
node tools/check-handlers.js
node tools/journey-graph-test.js
```

- `check-handlers` 会核对新增 handler：`onFixRequired`、`onGoRouteStep`、`onMessageAction`、`onQuickRouteGpx`、`onTemplateConfirmGo/Close`。
- `journey-graph` 会核对状态词是否漂移：本轮不新增状态词，只复用 `missing` 标签。

### 9.2 受影响套件

| 套件 | 为什么跑 | 预期 |
|---|---|---|
| `tools/scenario-editor-test.js` | 发布门、清单、快速创建 | 169 全过 + 新增分组/滚动/模板确认用例 |
| `tools/scenario-activity-test.js` | 草稿页、分享 | 151 全过 + `justPublished`/隐藏分享用例 |
| `tools/quick-create-test.js` | 必填/可后补分离 | 65 全过 |
| `tools/page2-gates-test.js` | 页面结构门 | 98 全过 |
| `tools/t4-e08-test.js` | 平台规则（sticky / 留白） | 41 全过 |
| `tools/b4-pad-final-value-test.js` | 底部留白终值 | 32 全过（未改 `.page.has-sticky` 高度则不受影响） |
| `tools/m02-class-scope-test.js` | 组件作用域 | 既有 65/1 红（`pages/activity/activity.wxss:90`），**先于本轮存在**，不修 |
| `tools/swx1/swx2-style-gates-test.js` | 样式门 | 新增样式若命中硬编码色值应为 0；本轮不新增色值 |

### 9.3 新增断言（写进既有套件，不新开框架）

`scenario-editor-test.js`：

1. 空表单 `missingForPublish()` 仍 5 项、标签逐字不变（回归钉）。
2. `requiredGroups` 为 3 组，顺序 title → time → pickup，`stepText` 取 `stepLabels`。
3. 只缺集合点时，`onPublishIntent` 落 `step === 1` 且 failure 含「集合上车点」。
4. `setStep`/`nextStep` 调用 `wx.pageScrollTo`（桩里断言调用次数与 `scrollTop: 0`）。
5. `onQuickRouteGpx` 先关路线层再开 GPX。
6. 模板确认：非空表单弹确认、空表单直接创建副本。
7. `autoPickupIds` 在自动生成后为真，手动添加的集合点不带徽标。

`scenario-activity-test.js`：

8. `options.published === '1'` → `justPublished === true`，且第二次 `reload` 后为 false（只庆祝一次）。
9. `isDraft` 时调用 `wx.hideShareMenu`；`onShareAppMessage` 返回首页兜底路径。

### 9.4 真机（改 WXML/WXSS 后必做）

流程照仓库既有约定：`close --project 'D:\OurTrail' --port 33278` → `open` → `auto --auto-port 94xx`（**不 quit**），驱动脚本放仓库外临时目录。

**三个用例**：

| 用例 | 注入 | 断言 |
|---|---|---|
| A 空表单发布预检 | `reLaunch('/pages/editor/editor')`，点底栏「发布活动」（先置 `publishReady` 为真以便按钮出现），再清空名称 | 反馈区在页签下可见；文案 `还差：活动名称…`；`step === 0`；像素截图 |
| B 自动集合点 | 注入出发时间 → 断言 `form.pickups.length === 1` 且折叠卡出现「自动生成」徽标；点 message action | 落到 `step === 1`；`pickup-section` 在视口内（读 `pageScrollTo` 后的 scrollTop 或元素 rect） |
| C 发布闭环 | 走真实发布（或注入 published 后 `reLaunch('/pages/activity/activity?id=…&published=1')`） | 顶部出现「活动已发布」；primary 唯一（数 `.button.primary` 可见数 = 1）；底部「分享」不重复 |

**证据边界**（照 `ourtrail-ui` §4）：

- bundle 新鲜度由新文案自证（`分享给同行的人` / `还差 N 项` 只存在于新代码）。
- 每用例前 `reLaunch` + 不同 `updatedAt`（活动页）；编辑器无缓存键，仍需 `reLaunch` 清实例属性。
- 元素文本 / class 读数是 E2，只证明"节点在且文案对"；**任何"视觉正常"结论必须有截图**。
- 截图落 `docs/ui-ux-redesign/evidence/creation-flow-2026-10-23/`，无效尝试进 `invalid/` 并注明原因。
- 跑不动记 `INCONCLUSIVE` / `ENV-ABORT`，不算 PASS。

### 9.5 本轮明确不验的

- 真实云端发布（需要共享账号数据；不改云函数，发布链路本身未动）。
- 微信分享卡在接收端的渲染（需要另一账号）。
- 图片上传（`contentBusy`）的真机路径（未改 content-editor）。

---

## 10. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 反馈区上移后，长页面滚动中仍可能错过 | 用户不知道为何被拦 | 所有拦截点强制 `scrollTop()`；success 类消息不强制滚动 |
| `wx.pageScrollTo` 在 Node 测试桩里不存在 | 套件崩 | 统一 `typeof` 守卫（仓库既有写法 `workspace.js:161`） |
| 分组把 5 条说成 3 项，与服务端报错逐项对不上 | 排查困惑 | 原始 `missingForPublish` 不变；failure 仍逐组说清；服务端错误码文案不变 |
| sticky 第 3 步三态改动影响 E2E | GP-03 找不到「发布活动」 | GP-03 夹具到达该步时 `publishReady === true`（今天能打开弹层即为证），标签不变 |
| `?published=1` 被反复刷新 | 横幅重复出现 | 首帧后立即消费 `this.justPublished` |
| 草稿隐藏分享后，用户找不到分享 | 草稿本就不该分享 | 草稿提示卡已有「返回编辑与发布」primary |
| 第 1 步删卡后冷启动少一个入口 | 快速创建路径变长 | 保留一行 text 捷径；路线库/GPX 仍一键可达 |

**回滚**：全部改动集中在 5 个产品文件，无数据/协议变更，`git checkout -- <file>` 即可回退；不涉及部署。

---

## 11. 需要你拍板的范围

| 选项 | 内容 | 文件面 | 风险 | 建议 |
|---|---|---|---|---|
| **A 纠错批** | 只修 D1/D2/D4/D7/D8/D10/D12 文案与反馈位置；不动结构、不做发布闭环 | 4 个文件 | 低 | 可作为第一批 |
| **B A + 结构收敛 + 发布闭环（推荐）** | 再加 D3 路线卡降级、D5 发布后分享、D6 草稿隐藏分享、D9 自动集合点反馈、D11 横幅诚实、D13 已发布保存、D14 模板确认 | 5 个文件 | 中低 | **推荐** |
| **C B + 入口/草稿页重做** | 再加首页入口、路线详情 preflight、草稿预览检查单 | 8 个文件 | 中 | 收益边际，单独评审 |

**推荐 B 的理由**：

1. 产品的核心闭环是"建活动 → 发到群里"，但今天发布成功后落在活动页，primary 是「进入工作台」（`activity.wxml:63-66`），分享是 text 权重（`77-80`）——闭环断在最后一步。这是 A 批无法覆盖的产品级缺口。
2. D1 的根因是"承诺"与"落点"不一致，而不是步骤顺序错；只改文案 + 缺口项带步骤名即可闭合，不必把集合点上移（`editor.js:953` 的自动生成会在视野外发生）。
3. 5 个文件、无 schema/云函数改动，回滚成本低，且能被现有套件完整覆盖。

---

## 12. 实施记录（选项 B，2026-10-23）

**范围守住 §0**：零 schema / 零云函数 / 零 domain / 零命令改动；`missingForPublish` 的判据、条数、标签、步骤一个没动，只在展示层把 5 条原始缺项收成 3 组。`cloudfunctions/` 零改动 ⇒ 不需要重新部署 trailApi。

**产品文件**

| 文件 | 落地内容 |
|---|---|
| `pages/editor/editor.js` | `requiredGroups` / `groupMissing`（展示分组，不改判据）；`scrollTop` / `scrollToPickup`（带 `typeof` 守卫）；`onPublishIntent` 预检落到第一组、失败提示按组说话；`onFixRequired` / `onMessageAction` 跳步骤并滚到集合点；模板副本二次确认（`templateConfirmOpen`）；`onQuickRouteGpx` 先关路线弹层再导入；`doPublish` 成功后 `redirectTo …&published=1`；集合时间被手动改过后撤掉 `autoPickupIds` 徽标 |
| `pages/editor/editor.wxml` | 分组缺口清单与「去补上」出口；模板确认弹层；发布步底栏三态（草稿 / 已发布可保存 / 未就绪） |
| `pages/activity/activity.js` | 读取 `?published=1` 一次性庆祝（`this.justPublished` 首帧后消费）；草稿调 `wx.hideShareMenu`；草稿转发兜底回首页 |
| `pages/activity/activity.wxml` | 发布成功卡（唯一 primary＝「分享给同行的人」），owner 工作台降为 text；草稿与庆祝态隐藏底部重复分享 |

**测试**：`tools/scenario-editor-test.js` 169→**227/0**（分组预检、①b 集合点专项、滚顶/滚集合点、模板确认、快捷路线关层、自动徽标生成与撤销、消息动作落点）；`tools/scenario-activity-test.js` 151→**171/0**（`hideShareMenu`、草稿转发兜底、`published=1` 庆祝一次即收、常规进入不庆祝、模板结构门）。

**门禁（本轮末次复跑）**：`check.js` `ALL CHECKS PASSED`；`check-handlers.js` exit 0（存量死 handler 仍只有 `editor.js#onNumber` 1 条）；`scenario-editor 227/0`、`scenario-activity 171/0`、`quick-create 65/0`、`journey-graph 15/0`、`page2 100/0`、`t4-e08 41/0`、`b4-pad 32/0`、`swx1 45/0`、`swx2 110/0`。**唯一红是存量** `m02 65/1`（PV5 `privacy.wxml` 章节标题 5 节点），已在 clean `git archive HEAD` 副本复现同款，未在本轮修。未跑全量 sweep，不编总数。

**真机（IDE 模拟器 306×660，用户授权自由连接开发者工具）**：驱动在仓库外 `%TEMP%/opencode/mp-auto/drive-creation-flow-2026-10-23.js`，`ok=true`；5 张截图 + `report.json` + 说明在 `docs/ui-ux-redesign/evidence/creation-flow-2026-10-23/`。A/B 为**注入空白表单**夹具（本机存完整草稿，直接点发布不会缺项），C/C2 用真实 owner 活动 `activity-mv0q0bt305yaqe`；A 的像素层分组文案、B 的「自动生成」徽标与撤销、C 的唯一主分享、C2 的无庆祝均逐条断言。**云端零写入、未发布活动、未部署**；本机草稿按快照还原。边界：IDE 模拟器不是物理手机，未验证手势/键盘/原生 picker。

**回滚**：产品改动集中在上述 4 个页面文件（模板/样式/页面 JS），无数据与协议变更；测试与文档可一并回退。
