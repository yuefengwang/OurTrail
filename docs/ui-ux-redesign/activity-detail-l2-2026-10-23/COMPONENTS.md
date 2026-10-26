# 活动详情 L2/L3 · 组件契约（COMPONENTS）

版本 2026-10-23 · 工件 3/4 · 配套 [SPEC.md](SPEC.md) / [GAP.md](GAP.md)
范围：`pages/activity` 与 4 个新组件、3 个纯函数。**不碰 schema / 云函数 / domain / 业务状态机。**

---

## 0. 契约的读法

- 本文件定义**边界**：文件、props、事件、DOM 骨架、依赖的全局类、空态。
  视觉值（字号/间距/颜色/几何）只出自 SPEC §4–§6，组件内不另立一套。
- 「页面级」= 不建组件。只在活动页出现一次的容器、叠压、sticky、锚点包装，一律留在页面。
- 新组件硬约束（`ourtrail-ui` 规则 1/3/9）：
  1. `Component({ options: { styleIsolation: 'apply-shared' }, ... })`；`options` 键**每个 `Component()` 只出现一次**。
  2. 组件 WXSS 只放布局与微调；颜色 `var(--token)`。唯一字面量例外是 `<icon color>`（SVG data URI 吃不到 `var()`，SPEC §5 已登记）。
  3. 引用了 `<icon>` 的组件必须在**自己的** json 里注册 `icon`（没有全局 `usingComponents`）。
  4. 可点元素 ≥44px、主操作 48px；本文件的组件**都不含可点元素**（装备格、信息格、章节头均只读），点击都在页面侧。
- 组件不持有页面 `id`。`#sec-*` / `#meeting-block` 留在页面包装上，`pageScrollTo` 路径不变。

---

## 1. 组件总表

| 组件 | 类型 | 切片 | 职责 | 明确不负责 |
|---|---|---|---|---|
| `activity-hero` | 新增 | S1 | 全宽封面 + 叠在照片底部的标题/路线/领队 + 顶部状态徽标与日期 | 指标、难度徽标、分享、脚注 |
| `fact-grid` | 新增 | S1/S2 | 纯布局：2 列事实格（信息卡）/ 2×2 指标格（路线统计） | 卡片外壳、业务判断、空态文案 |
| `chapter` | 新增 | S2 | 章节头（编号眉题 + 20px 标题 + 副说明）+ 默认 slot | 锚点 id、slot 内部间距、编号计算 |
| `equipment-grid` | 新增 | S2 | 必带/建议图标网格；文字始终保留 | 去重、排序、空态以外的业务判断 |
| `route-profile` | 复用 | S1/S2 | 海拔剖面 | 最高海拔数值（新增 `elevationRange` 只读派生） |
| `person-row` | 复用 | 不变 | 同行人行 | — |
| `overlay` | 复用 | 不变 | 底部 sheet | — |
| `status-panel` | 复用 | 不变 | denied/loading | — |
| `icon` | 复用 | S2 | 装备图标 | — |
| `form-field` | 复用 | 不变 | sheet 内输入 | — |

页面级（不建组件）：信息卡外壳、路线指标区、评分小块、sticky 操作条、章节锚点包装。

---

## 2. `activity-hero`

**文件**：`miniprogram/components/activity-hero/activity-hero.{json,wxml,wxss,js}`
**注册**：`pages/activity/activity.json` → `"activity-hero": "/components/activity-hero/activity-hero"`
**json**：`{ "component": true }`（不用 icon，因此不需要 usingComponents）

### 2.1 props

| prop | 类型 | 来源 | 说明 |
|---|---|---|---|
| `title` | String | `activity.js` 的 `title` | 空标题由页面兜底为「未命名活动」（现状） |
| `routeTitle` | String | `routeTitle` | 空则整行不渲染 |
| `leader` | String | `leader`（姓名原文） | 组件内加「领队 · 」前缀；空则不渲染 |
| `badgeText` | String | `badgeText` | 顶部状态徽标 |
| `startAtLabel` | String | `startAtLabel` | 顶部日期药丸 |
| `cover` | String | `cover` | 实拍 fileID 或氛围图 URL |
| `coverIsReal` | Boolean | `coverIsReal` | 决定挂哪条 `binderror` |
| `coverFailed` | Boolean | `coverFailed` | 与全局 `.img-failed` 同义 |

**不含** `difficultyLabel`、`distance`、`ascent`、`confirmed`——强度只进信息卡，人数只进信息卡，路线指标进路线章节（SPEC §2.1 / GAP G2）。

### 2.2 事件

| 事件 | 触发 | 页面绑定 |
|---|---|---|
| `covererror` | 实拍图 `binderror` | `bind:covererror="onCoverError"` |
| `fallbackerror` | 氛围图 `binderror` | `bind:fallbackerror="onFallbackCoverError"` |

两个事件**必须分开**：现有注释（`activity.wxml:29-30`）记录了同一 image 切 src 时旧请求的 error 会迟到，把回退后的氛围图也判死。组件内保留两个 `<image>` 元素，不得合并。

### 2.3 DOM 骨架

```xml
<view class="hero-cover act-hero {{coverFailed ? 'img-failed' : ''}}">
  <view class="hero-cover-media">
    <image wx:if="{{coverIsReal}}" class="hero-cover-img" src="{{cover}}" mode="aspectFill" binderror="onCoverError" />
    <image wx:else class="hero-cover-img" src="{{cover}}" mode="aspectFill" binderror="onFallbackCoverError" />
    <view class="hero-cover-scrim" />
    <view class="hero-cover-top">
      <view class="cluster" style="gap:8px;min-width:0;">
        <text class="badge on-forest">{{badgeText}}</text>
      </view>
      <text class="small tabular hero-date">{{startAtLabel}}</text>
    </view>
  </view>
  <view class="hero-cover-body">
    <text class="display hero-body">{{title}}</text>
    <view wx:if="{{routeTitle || leader}}" class="act-hero__meta">
      <text wx:if="{{routeTitle}}" class="hero-sub">{{routeTitle}}</text>
      <text wx:if="{{leader}}" class="hero-sub">领队 · {{leader}}</text>
    </view>
  </view>
</view>
```

- 复用全局：`.hero-cover`(`app.wxss:358`) / `.hero-cover-media`(`:365`) / `.hero-cover-img` / `.hero-cover-scrim` / `.hero-cover-top` / `.hero-date` / `.display`(`:122`) / `.badge.on-forest`(`:338`) / `.cluster`(`:112`) / `.small` / `.tabular`。
- 图片加载失败：全局 `.hero-cover.img-failed .hero-cover-img { display:none }`（`:372`）保留媒体盒 240px 高，森林底兜底，不出破图。S1 真机要**专门确认**这条全局后代选择器在 `apply-shared` 组件内生效；若不生效，才允许在组件 WXSS 里补同义一条并登记。

### 2.4 组件内 WXSS（仅布局）

```css
.act-hero.hero-cover { border-radius: 0; }
.act-hero .hero-cover-body { margin-top: -72px; padding-bottom: 28px; gap: 8px; }
.act-hero__meta { display: flex; flex-direction: column; gap: 2px; }
.act-hero .hero-sub { font-size: var(--text-body); line-height: 20px; }
```

- `-72px` 是 SPEC §2.1 的叠题量（240px 媒体盒的下沿被标题区压住 72px）；长标题向下生长，**不裁字、不用 `-webkit-line-clamp`**。
- `border-radius: 0` 只作用于本组件根，不改全局 `.hero-cover`（路线页 `pages/route/route.wxml:11-30` 也用该类）。
- 全宽由页面包装 `.activity-hero-bleed { margin: 0 -20px; }` 提供，组件本身不写宽度。

### 2.5 态

| 态 | 表现 |
|---|---|
| 实拍 / 氛围图 | 同一布局，脚注差异由页面在信息卡之后渲染 |
| 图片失败 | `img-failed` → 隐藏图片、保留 240px 媒体盒、森林底 |
| 100 字标题 | 完整入 DOM；hero 向下生长；顶部徽标/日期不被推走（它们在 media 内绝对定位） |
| 缺路线 / 缺领队 | 对应行不渲染；两行都空时 `.act-hero__meta` 整体不渲染，不留空行 |

---

## 3. `fact-grid`

**文件**：`miniprogram/components/fact-grid/fact-grid.{json,wxml,wxss,js}`
**注册**：`"fact-grid": "/components/fact-grid/fact-grid"`
**json**：`{ "component": true }`
**职责**：只做网格与单元格排版。**不包 `.card`**（信息卡外壳在页面），不做业务判断。

### 3.1 props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `items` | Array | `[]` | 元素 `{ key, label, value, unit?, sub? }` |
| `variant` | String | `'card'` | `'card'`（信息卡）/ `'stats'`（路线指标） |

### 3.2 归一化（observer）

- 过滤 `value === '' || value == null` 的项（**缺值不占格**，不印 0/待补）。
- 每项重建为 `{ key, label, value, unit, sub, wide }`，不修改入参对象。
- `wide`：当 `items.length % 2 === 1` 时，最后一项 `wide = true`（占满整行，避免半格空卡）。不使用 `:last-child`/伪类。
- 0 项：组件渲染空（`wx:if` 根节点），不占高度。

### 3.3 DOM 骨架

```xml
<view wx:if="{{cells.length}}" class="fact-grid fact-grid--{{variant}}">
  <view wx:for="{{cells}}" wx:key="key" class="fact-grid__cell {{item.wide ? 'fact-grid__cell--wide' : ''}}">
    <text class="fact-grid__label">{{item.label}}</text>
    <text class="fact-grid__value">{{item.value}}<text wx:if="{{item.unit}}" class="fact-grid__unit">{{item.unit}}</text></text>
    <text wx:if="{{item.sub}}" class="fact-grid__sub">{{item.sub}}</text>
  </view>
</view>
```

### 3.4 组件内 WXSS

```css
.fact-grid { display: flex; flex-wrap: wrap; gap: 16px 12px; }
.fact-grid__cell { flex: 0 0 calc(50% - 6px); min-width: 0; }
.fact-grid__cell--wide { flex-basis: 100%; }
.fact-grid__label { display: block; color: var(--muted); font-size: var(--text-caption); line-height: 18px; }
.fact-grid__value { display: block; color: var(--ink); font-size: var(--text-input); line-height: 22px; font-weight: 600; overflow-wrap: anywhere; }
.fact-grid__unit { margin-left: 2px; font-size: var(--text-caption); font-weight: 400; }
.fact-grid__sub { display: block; color: var(--muted); font-size: var(--text-caption); line-height: 18px; margin-top: 2px; overflow-wrap: anywhere; }
/* stats 变体复用全局指标字阶，不另写 26px */
.fact-grid--stats { gap: 14px 12px; }
.fact-grid--stats .fact-grid__label { order: 2; margin-top: 4px; }
.fact-grid--stats .fact-grid__value { order: 1; color: var(--forest); font-size: 26px; line-height: 1.3; letter-spacing: -0.6px; font-weight: 600; }
.fact-grid--stats .fact-grid__sub { order: 3; }
```

> stats 变体在数值 26px 时若用 DOM 顺序「标签在上、值在下」，会与 `.metric` 的既有视觉（值在上、标签在下）不一致。这里用 `order` 只改**视觉顺序**，DOM 顺序仍是 label→value→sub（读屏按标签先读，合理）。`order` 不改变无障碍树。若真机上 `order` 在 WebView 表现异常，退回在 JS 里输出两个不同的模板分支，不改属性语义。

### 3.5 态

- 1–4 项：2 列；奇数时最后一项整行。
- 长值（时间范围 / 多上车点）：`overflow-wrap: anywhere`，标签不换行（12px 两到四字在 127px 格里不会换）。
- 0 项：不渲染（调用方决定要不要补说明）。

---

## 4. `chapter`

**文件**：`miniprogram/components/chapter/chapter.{json,wxml,wxss,js}`
**注册**：`"chapter": "/components/chapter/chapter"`
**json**：`{ "component": true }`

### 4.1 props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `no` | String | `''` | 章节号（`'01'`）；空则只有 kicker |
| `kicker` | String | `''` | 类目（`简介`/`行程安排`…） |
| `title` | String | `''` | 20px 章节标题 |
| `sub` | String | `''` | 副说明；空不渲染 |
| `gap` | Number | `12` | 章节头与 slot 内容的间距（px） |

### 4.2 DOM 骨架

```xml
<view class="chapter">
  <view class="section-head">
    <text wx:if="{{kicker}}" class="kicker">{{no}}{{no && kicker ? ' ' : ''}}{{kicker}}</text>
    <text wx:if="{{title}}" class="list-head__title">{{title}}</text>
    <text wx:if="{{sub}}" class="section-sub">{{sub}}</text>
  </view>
  <view class="chapter__body" style="margin-top:{{gap}}px;">
    <slot />
  </view>
</view>
```

- 复用全局：`.section-head`(`app.wxss:145`) / `.kicker`(`:114`) / `.list-head__title`(`:150`) / `.section-sub`(`:146` 的后代规则)。
- **不写** `.section-title`（16px）——SPEC §4.2 已裁：章节标题用 20px 的既有值，组件内不复制字面量。
- 章节内 slot 保留自己的 `.stack` / `.stack-gap3` 间距；组件只负责头与内容的 `gap`。
- 天气章节传 `gap="8"`；其余默认 12。

### 4.3 编号规则（页面算，组件只显示）

S1/S2 后编号 = 当前 DOM 可见顺序，**不是设计图的 S4 目标顺序**：

| 序 | 章节 | 可见条件（与模板 `wx:if` 同源） |
|---|---|---|
| 01 | 简介 | `description \|\| contentView.length \|\| highlights.length`（`autoSummary` 不再渲染） |
| 02 | 行程安排 | 恒真 |
| 03 | 天气 | `!isDraft` |
| 04 | 路线与集合 | 恒真 |
| 05 | 安全 | 恒真 |
| 06 | 装备 | 恒真 |
| 07 | 费用 | 恒真 |
| 08 | 报名后 | `signupNote` 非空 |

同行人**不编号**（S2 起去掉眉题编号，位置不动）；评分小块不编号。
`activity.js` 的 `secNo` 数组必须与上表逐条同源；删掉 `facts` 与 `peers` 两项。

---

## 5. `equipment-grid`

**文件**：`miniprogram/components/equipment-grid/equipment-grid.{json,wxml,wxss,js}`
**注册**：`"equipment-grid": "/components/equipment-grid/equipment-grid"`
**json**：

```json
{
  "component": true,
  "usingComponents": { "icon": "/components/icon/icon" }
}
```

### 5.1 props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `required` | Array\<String\> | `[]` | 必带 |
| `suggested` | Array\<String\> | `[]` | 建议 |

### 5.2 归一化（observer）

- `String(v).trim()`，空白串丢弃；**不去重、不排序、不改写文字**（组织者原文）。
- 每项 → `{ text, icon }`，`icon` 来自 `utils/equipment-icons.iconFor(text)`。
- 映射只做「词 → 图标名」，不做「这条装备是否必要」等业务判断。

### 5.3 DOM 骨架

```xml
<view class="eq-grid">
  <block wx:if="{{requiredItems.length}}">
    <text class="field-label">必带</text>
    <view class="eq-grid__list">
      <view wx:for="{{requiredItems}}" wx:key="index" class="eq-grid__item">
        <view class="eq-grid__tile"><icon name="{{item.icon}}" size="20" color="#163E35" /></view>
        <text class="eq-grid__text">{{item.text}}</text>
      </view>
    </view>
  </block>
  <block wx:if="{{suggestedItems.length}}">
    <text class="field-label">建议</text>
    <view class="eq-grid__list">
      <view wx:for="{{suggestedItems}}" wx:key="index" class="eq-grid__item">
        <view class="eq-grid__tile"><icon name="{{item.icon}}" size="20" color="#163E35" /></view>
        <text class="eq-grid__text">{{item.text}}</text>
      </view>
    </view>
  </block>
  <text wx:if="{{!requiredItems.length && !suggestedItems.length}}" class="muted">组织者未填写装备清单。</text>
</view>
```

- `<icon color="#163E35">` = `--forest`（SPEC §5 已登记的平台例外；颜色只能经属性传入）。
- 空态文案**逐字**保留「组织者未填写装备清单。」

### 5.4 组件内 WXSS

```css
.eq-grid { display: flex; flex-direction: column; gap: 10px; }
.eq-grid__list { display: flex; flex-wrap: wrap; gap: 10px 8px; }
.eq-grid__item { flex: 0 0 calc(25% - 6px); min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.eq-grid__tile { width: 32px; height: 32px; border-radius: var(--radius-tag); background: var(--stone); display: flex; align-items: center; justify-content: center; }
.eq-grid__text { font-size: var(--text-caption); line-height: 16px; color: var(--ink); text-align: center; overflow-wrap: anywhere; }
```

- 4 列 = 306px 下内容宽 266px，每格约 60px；2–4 个汉字单行，5 字以上换行，不挤图标。
- 不用 `.card` 包每个词条（306px 下卡中卡会把可用宽度压到不可读）。
- 图标不是唯一信号：文字始终渲染（SPEC §8.9）。

---

## 6. 纯函数契约

### 6.1 `utils/equipment-icons.js`（新增，wx-free）

```js
module.exports = { iconFor }
```

- 输入任意值；先 `String(v || '').trim().toLowerCase()`。
- 返回**既有或新增的 icon key**；未知返回 `'backpack'`。
- 匹配用 `indexOf`，不用正则（WXS 之外的普通 JS 虽可用正则，但这里不需要，保持可读）。
- 规则顺序即优先级（先命中先返回）：

| 序 | 图标 key | 命中词（子串） |
|---|---|---|
| 1 | `poles` | 登山杖 / 手杖 / 杖 / trekking / pole |
| 2 | `boot` | 徒步鞋 / 登山鞋 / 鞋 / boot / shoe |
| 3 | `rain` | 雨衣 / 雨披 / 雨伞 / 雨 / rain / poncho |
| 4 | `headlamp` | 头灯 / headlamp / head torch（**必须早于 power**：「头灯电池」应得头灯） |
| 5 | `firstaid` | 急救 / 药品 / 药 / 医疗 / first aid / medkit |
| 6 | `tent` | 帐篷 / 帐 / tent |
| 7 | `sleep` | 睡袋 / 睡垫 / 防潮垫 / 地垫 / sleep / quilt / pad |
| 8 | `power` | 电池 / 充电宝 / 充电 / 电源 / battery / charger / power |
| 9 | `food` | 食物 / 路餐 / 干粮 / 零食 / 餐 / food / snack |
| 10 | `water` | 水壶 / 水袋 / 饮水 / 补水 / `水`（仅整词）/ water / bottle / hydration |
| 11 | `route` | 地图 / 轨迹 / 导航 / 指南针 / gpx / map / compass |
| 12 | `id` | 身份证 / 证件 / 护照 / id card |
| 13 | `sun` | 防晒 / 遮阳 / 帽 / 墨镜 / sun / hat / sunglass |
| 14 | `backpack` | 背包 / 包 / pack / backpack（兜底同 key） |

- 已知边界：「水」不用裸子串，否则「水果」会被印成水壶；`route`/`sun` 复用既有 key。
- 必须新增 12 个 key：`boot poles rain water headlamp firstaid food tent sleep power id backpack`。
- 新增 key 的同时在 `components/icon/icon.js` 的 `PATHS` 里补 24×24 stroke path（`stroke-width 1.75`、圆角端点），并在 `module.exports` 导出 `PATHS` 供注册表交叉核对（数据导出，不改变组件行为）。

### 6.2 `utils/route-profile.js` → `elevationRange(input)`

```js
elevationRange({ track, points }) → {
  minEle: Number|null,
  maxEle: Number|null,
  source: 'track' | 'nodes' | 'none',
  pointCount: Number
}
```

- **与 `buildProfile` 同源同优先级**：`trackSamples(track).runs.length > 0` → `track`；否则 `nodeSamples(points).runs.length > 0` → `nodes`；否则 `none`。
- 取**实测 min/max**（与 `buildProfile` 返回的 `minEle/maxEle` 逐值相同，均为四舍五入整数），**不是**全平线时的 ±5 显示窗。
- 不生成 SVG、不调用 `renderRuns`；`pointCount` = 参与 min/max 的采样点数量。
- 导出：`module.exports = { buildProfile, elevationRange, W, H }`。
- 实现建议：把 `renderRuns` 里「收集 all + min/max」的一段抽成内部 `rangeOf(runs)`，两处共用；**不改** `renderRuns` 的输出。

### 6.3 `utils/route-schedule.js` → `durationBetween(startAt, endAt)`

```js
durationBetween(startAt, endAt) → Number|null
```

- 两端都 `Date.parse`；任一非有限 → `null`。
- 差值四舍五入到分钟；`<= 0` → `null`（相等/倒序都算无效）。
- 纯时刻差，跨日自动成立（不按北京日期截断）。
- 导出加入 `durationBetween`。

### 6.4 页面本地 `numberText`（不新增 util）

`activity.js` 顶部局部函数，只服务本页指标：

```js
function numberText(value) { /* 整数千分位；非整数保留 1 位小数 */ }
```

- `4660 → '4,660'`；`12.4 → '12.4'`；`1234.56 → '1,234.6'`；非数 → `''`。
- 不复活 `activity-summary.js`：S1 删除 `autoSummary` 渲染后，该 util 及其测试的清理另立任务，不在本切片偷删。

---

## 7. 页面装配契约

### 7.1 S1 首屏

```
<view class="page {{showSticky ? 'has-sticky' : ''}}">          ← S3 才接 showSticky
  denied / loading 分支不变
  <view wx:else class="stack">
    [justPublished 成功卡]                                       ← 保留，位置不动
    <view class="act-top">                                       ← 无 gap 的包装（关键）
      <view class="activity-hero-bleed"><activity-hero … /></view>
      <view class="card act-info"><fact-grid items="{{infoFacts}}" variant="card" /></view>
      <text class="photo-note">{{photoNote}}</text>              ← 全页唯一，纸面背景
    </view>
    [状态 callout]
    [评分小块：sceneryRating || funRating]
    [section-nav]
    简介 / 同行人 / 行程 / 天气 / 路线(指标+地图+剖面+上车点) / 安全 / 装备 / 费用 / 报名后 / 通知任务
  </view>
  [overlay]
</view>
```

- **`.act-top` 必须是 gap-free 的普通块容器**。根 `.stack` 有 16px 的 flex gap；若 hero 与信息卡是 `.stack` 的直接子元素，`margin-top:-24px` 只能得到净 -8px，叠压失效。包一层后 gap 不再作用于两者之间。
- 信息卡：`.act-info { margin-top: -24px; position: relative; z-index: 1; }`（页面 WXSS）。
- Hero 出血：`.activity-hero-bleed { margin: 0 -20px; }`（页面 WXSS）。禁止 `100vw`。
- 照片诚实性脚注由 `coverIsReal/hasContentImages` 三态文案决定（逐字搬现有 `activity.wxml:375-377`），从费用区删除。

### 7.2 数据字段（`activity.js`）

新增/替换：

| 字段 | 构造 |
|---|---|
| `infoFacts` | 4 项，见下表 |
| `routeStats` | 4 项，见下表 |
| `routeStatsNote` | `source==='none' && (track.length || points.length)` → `'路线没有可用高程，暂不显示最高海拔。'`；否则 `''` |
| `showSticky` | `!(this.justPublished && isOwnerReal)`——庆祝帧只对组织者成立；非 owner 手动带 `published=1` 不享受「无底栏」 |
| `photoNote` | 三态文案之一（原 `activity.wxml:375-377`） |

删除：`factTime`、`factPickup`、`factPeople`、`signupBrief`、`autoSummary`、`AS` require。
保留：`leader`、`sceneryRating`、`funRating`、`ratingOptions`、`feeSummary`、`signupNote`。

`infoFacts`：

| key | label | value | unit | sub |
|---|---|---|---|---|
| `time` | 活动时间 | `F.dtLabel(startAt)` | — | `至 <end> · 截止 <deadline>`（缺项各自省略） |
| `pickup` | 集合 | `pickups[0].name` | — | `pickups[0].time` +（`pickups.length > 1` 时）`等 N 个上车点`，用 ` · ` 连接 |
| `people` | 人数 | `confirmed + ' / ' + capacity` | `人` | `minParticipants ? '成行 ' + minParticipants + ' 人' : ''` |
| `intensity` | 强度 | `difficultyLabel` | — | — |

`routeStats`（值缺失即不加入数组）：

| key | label | value | unit | sub |
|---|---|---|---|---|
| `distance` | 路线里程 | `numberText(distanceKm)`（仅 `> 0`） | `km` | — |
| `ascent` | 累计爬升 | `numberText(ascentM)`（仅 `> 0`） | `m` | — |
| `maxEle` | 最高海拔 | `numberText(maxEle)`（`maxEle != null`） | `m` | `source === 'track' ? '轨迹高程' : '节点高程'` |
| `duration` | 预计用时 | 见下 | 见下 | 跨日时 `至 <end dtLabel>` |

`durationBetween` 分钟 → 指标拆分（页面本地）：

| 分钟 | value | unit | sub |
|---|---|---|---|
| < 60 | `m` | `分钟` | — |
| < 1440 | `floor(m/60)` | `小时` | 余数非 0：`另 r 分`；跨日再追加 `至 <end dtLabel>` |
| ≥ 1440 | `floor(m/1440)` | `天` | 余小时非 0：`另 h 小时`；并追加 `至 <end dtLabel>` |

### 7.3 S2 正文节奏

- 每个正文块 = `<view id="sec-*"><chapter …><view class="stack">…</view></chapter></view>`；`id` 在外层。
- 正文块之间用 `.stack-sections`（28px，`app.wxss:111`）；章节内部用 `.stack`（16px）或 `.stack-gap3`（12px）。
- 行程章节：`timeline`（原 `activity.wxml:264-299`）→ `scheduleBasis`（`:263`）→ `organizerIntro`。路线章节删除时间轴与 `scheduleBasis`，保留指标条 → 地图 → 剖面 → 上车点。
- `onPointLocate` 在 `setData` 后调用 `wx.pageScrollTo({ selector: '#meeting-block', duration: 240 })`；**不用** `rect.top + this._scrolled`（`_scrolled` 从未赋值，`boundingClientRect` 与页面滚动坐标不同系）。
- 时间轴行内「天气 / 导航」保持 `catchtap`，不触发滚动。
- 装备章节：`<equipment-grid required="{{equipment}}" suggested="{{equipmentSuggested}}" />`。
- 费用章节：只删照片脚注（移到 S1 的信息卡之后），其余文案与「OurTrail 不收款…」逐字不动。
- 同行人：保留原位，去掉 `kicker` 里的编号（`{{secNo.peers}}` → 无编号），标题仍为「同行的人」。
- 通知/任务两行：用 `.stack`（16px）包住，仍在正文之后、sticky 之前。

### 7.4 S3 底部操作

```xml
<view wx:if="{{showSticky}}" class="sticky-action act-sticky">
  <button wx:if="{{!isDraft && !justPublished}}" class="button secondary act-sticky__share" hover-class="button-hover" open-type="share">
    <icon name="copy" size="18" color="#163E35" /><text>分享</text>
  </button>
  <!-- 下面四支与现有 activity.wxml:73-94 的条件链逐条同源，只换容器 -->
</view>
```

- 条件链不变：`isOwner` → `canSubmit` → `canSelfSheet` → `nextActionTarget === 'meeting'`；仍是互斥分支，一屏一个 primary。
- 分享在 sticky 里用 `.button.secondary`（顶部原为 `.button.text`；白底 sticky 上纯文字按钮会看起来像禁用）。次级权重不变。
- 页面 WXSS：`.sticky-action .button.act-sticky__share { flex: 0 0 auto; width: auto; }`——必须 3 类选择器，压过全局 `.sticky-action .button { flex:1 }`（`app.wxss:262`，0,2,0）。**`width: auto` 不是可选项**：原生 `<button>` 自带 `width:184px`，只收 flex 时 390px 屏上它仍占 184、主按钮只剩 154，「查看集合与出行安排」折成两行（按钮 70px、底栏 129px）。真机实测修前/修后：share 184→88、primary 154→250、按钮高 70→48（`readings/s3-participant-bottom.json`）。
- 底栏几何契约（390×753，dpr 3，安全区 34）：高 107 = 12 + 48 + (12 + 34) + 1；底边贴视口底；`.page.has-sticky` 的 120px = 「最后一行内容 → 页底」，不是「内容 → 底栏顶」（后者只剩 12.5px）。判据见 `tools/capture-s3.js`。
- `justPublished` 不出 sticky（成功卡内的分享是唯一 primary）；草稿出 sticky 但只有「返回编辑与发布」，无分享。
  **零丢失**：庆祝帧没有底栏，但改前顶部那枚「进入工作台」仍在成功卡内以 `.button.text.block` 保留（分享之下、次级权重）；真机读数 `successCardWorkspace=true` 与 `stickyCount=0` 同时成立。
- **busy 禁用：sticky 上不做。** 底栏四支全是导航/展示动作（工作台、报名页、自助 sheet、锚点滚动），写操作全部在 overlay sheet 内，sheet 自己有三层禁用（`disabled` / 空 `bindtap` / handler 守卫）。若把 sticky 也按 `busy` 禁用，跨页读写未返回时它只会变成一颗「样式正常、文案正确、点了没反应」的死按钮（铁律 21）——底栏并不提交任何东西，禁用它反而不诚实。弹层打开时的安全由层叠负责：`overlay` z 200 > sticky z 50，真机 `confirmed-bottom-sheet.png` 验证弹层铺满 753px 视口、底栏仍在 DOM 但被完全覆盖。
- 根节点 class 接 `{{showSticky ? 'has-sticky' : ''}}`（`.page.has-sticky` 120px，`app.wxss:89`）。庆祝帧两者一起消失，不会多留 120px。
- **自定义导航裁决：不做。** 原生导航保留；`navigationStyle: custom` 需要状态栏安全区与胶囊避让的真机证据，且设计图的返回/分享叠封面不在本轮收益里。S3 只记录该决定，不改导航（`activity.json` 与 `app.json` 均无 `navigationStyle: custom`，结构门 §13 钉住）。

---

## 8. 共享资产回归面

| 资产 | 使用者 | 本轮动作 | 必须核验 |
|---|---|---|---|
| `.hero-cover` 系列 | 活动详情 + `pages/route/route.wxml:11-30` | 只加 `.act-hero` 局部覆盖，不改全局 | 路线页截图无回归 |
| `.section-head` | 19 个文件 | 不改全局，只被 `chapter` 引用 | `check.js` / `t4-e08` |
| `.fact-row` | 多页 | 活动页事实区删除后不再引用；全局类不动 | 其他页无变化 |
| `.stack-sections` | 工作台等 | 活动页新用；类本身不动 | 其他页无变化 |
| `.sticky-action` | `signup` 等 | 活动页新用；类本身不动 | 非 tab 页留白 120px |
| `route-profile` 组件 | 活动详情 + 路线详情 | props 不变 | 剖面三态不变 |
| `icon` 组件 | 全站 | 只加 `PATHS` key + 导出 | 既有 24 个 key 不变 |

---

## 9. 不做什么

- 不新增/修改 schema 字段、命令、云函数、domain 逻辑；不部署。
- 不新增设计 token、色值、字号、圆角；不引入 `display:grid` / `@media` / `100dvh` / `color-mix()`。
- 不做自定义导航、不重排章节顺序（S4）、不动同行人位置。
- 不引入收藏/价格/支付/退款；不让图标成为唯一信息载体。
- 不把 `routeSnapshot.points` 从页面数据里删掉（剖面与时间轴都还要用）。

---

## 10. 门禁与测试映射

| 变更 | 自动门 | 断言重点 |
|---|---|---|
| 新组件注册/作用域 | `node tools/check.js`、`node tools/check-handlers.js`、`node tools/t4-e08-test.js` | 双向注册、`options` 单次、具名 slot、全局类作用域 |
| 页面结构 | 新增 `tools/activity-l2-structure-test.js`（静态 E1） | hero 无 metrics / `sec-facts` 消失 / 时间轴只在行程 / sticky 分支 / 照片脚注 1 次 |
| 装备映射 | 新增 `tools/equipment-icons-test.js` | 14 类规则、水 vs 水袋 vs 水果、头灯电池、未知兜底、key ∈ icon 注册表 |
| 最高海拔 | `tools/route-profile-test.js` 扩展 | `elevationRange` 与 `buildProfile` 的 min/max 逐值一致；无高程 `source='none'`；不返回 svg |
| 用时 | `tools/route-schedule-test.js` 扩展 | 无效/相等/倒序 → null；跨日分钟数正确 |
| 页面行为 | `tools/scenario-activity-test.js` 改写（不删） | 信息卡 4 格、路线指标有/无、评分块空态、sticky 状态矩阵、脚注单次 |
| 旅程图 | `tools/journey-graph-test.js` | 状态词与页面图不漂移 |
| 真实渲染 | 真机（M4） | 306×660 首屏、叠压、长标题、图标、sticky、路线页回归 |
