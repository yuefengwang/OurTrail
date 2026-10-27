# 首页「两种形式的列表」去重与统一 —— 实现级设计（待批 · v2）

日期：2026-10-20 · 触发：用户真机截图（活动 Tab 顶部三条裸行 + 下方大幅卡片）· 状态：**未开工，只读取证完毕**

v2 相对 v1 的两处实质变化（都因工作区在途改动）：§0.5 新增在途盘点，标签单源从 `format.js` 改落 `journey.js`，新字段从 `tasks` 改名 `collab`。

---

## 0. 先收回上一轮写错的一句

上一轮我给方案 A 时写了「任务区从卡片区排除（**交集只出现在任务区**）」。**这句是错的**：

- `/pages/staff/staff` 与 `/pages/vehicle/vehicle` 在全仓库**只有一个入口**：`miniprogram/pages/home/home.js:168-169`（实测 grep 全 `miniprogram/`，除这两行外无任何 `navigateTo` 指向这两页）。
- 「交集只出现在任务区」⇒ 卡片区排除任务区 id ⇒ **组织者自己的草稿/活动在「我的活动」里消失**，而任务行把他送到 `vehicle` 页（草稿阶段车长页基本是空的）。丢主工作列表，换一个没内容的页。
- 反方向「任务区排除 owner∨joined」同样不通：`joined ∧ staff` 的参与者（帮组织者点名的人）会从任务区消失，而 staff 页**没有第二个入口** ⇒ 制造新的不可达。

⇒ 去重不是「谁排除谁」，而是**两个区各列一次这个形状本身承载不了它**。下面两个方案据此重排。

---

## 0.5 工作区在途改动盘点（决定了本设计的两处命名与落点）

`git status --porcelain` 实测 **72 条**未提交改动，是 `docs/ui-ux-redesign/2026-10-20-global-prototype-dev-plan.md` 的 Wave 0~3 在途产物。与本议题直接相关的三条：

1. **`miniprogram/utils/format.js` 已被在途改动写过**（+19 行：`TASK_STATUS_LABELS`/`TASK_CATEGORY_LABELS`/`DIFFICULTY_LABELS`），且 plan `:295` 明文规定「`app.wxss`、`icon.js`、`format.js` 由 Wave 0 owner 统一改」⇒ **本次不碰 `format.js`**，角色标签单源改落 `journey.js`（§3.1）。
2. **「任务」一词已被另一个概念占用**：在途新建了 `cloudfunctions/trailApi/domain/tasks.js` + `miniprogram/pages/tasks/`（活动内 checklist：装备/采购/记录，入口在 `activity.js:497`、`workspace.js:181`）。它与首页那个「需要我协作」区**不是一回事**。⇒ 本次新字段一律不叫 `tasks`，改叫 **`collab`**（业务原话是「需要我协作」）。
3. plan `:200` 给首页定的边界：**保持「我的活动」主任务，不把首页改成公开信息流**；plan `:48` 另写「不能直接互换，**否则领队的待办会消失**」。⇒ 两个候选方案都必须保住领队待办的可见性，B′ 用带计数的第四档正是为此。
4. plan `:296`「每个 Agent 交付前跑 `git status`，不得把别人的未提交改动卷进来」⇒ 本设计的写入集（§5）逐条核过：`pages/home/*`、`components/activity-card/*`、`utils/journey.js`、`tools/a20-owner-hero-test.js` **当前全部干净**。
5. Wave 4「现有页面设计语言收口」的清单（plan `:272-283`）**没有列 home** ⇒ 本次是往该 Wave 新增一项，落地时同步登记进 plan。

---

## 1. 现状结构与病灶（逐条带 file:line）

| # | 病灶 | 证据 | 层级 |
|---|---|---|---|
| 1 | 同一场活动可同时进两个区 | `home.js:75-84` 任务区＝非终态 ∧(`meta.staff`∨`meta.vehicle`)；`home.js:85-95` 卡片区＝非终态 ∧(`meta.owner`∨`meta.joined`)，两条件**不互斥** | 实现缺陷 |
| 2 | 服务端四个布尔彼此独立，无互斥保证 | `cloudfunctions/trailApi/domain/selectors.js:486-489` | 设计事实（不是 bug） |
| 3 | 本机必然命中：黄金路径 E2E 把 `vehicle_contact` **自授给组织者本人** | `tools/e2e-golden-path-test.js:890-891`（`userId: me.id`）；草稿又只对 owner 可见（`selectors.js:413`）⇒ 截图那三条「车辆联络 · 草稿」同时满足两个区 | 复现路径 |
| 4 | 一屏两种列表语言 | 任务区＝裸 `.list-row`＋发丝分隔（`home.wxml:26-43`，样式 `app.wxss:541-556`）；卡片区＝编辑式 `activity-card`（缩略图／hero，`home.wxml:65-80`） | 设计债（继承自冻结原型 `docs/prototypes/ourtrail-app/src/screens/ActivityHome.tsx:50`） |
| 5 | 任务区不跟筛选与搜索走 | `home.js:75` 用 `all`，`home.js:85` 才用 `filter`/`search` ⇒ 切档或输入关键词时上面三行纹丝不动 | 实现缺陷 |
| 6 | 双角色用户进不去车辆页（**已登记缺陷**） | `home.js:83` `goStaff: !!a.meta.staff` 单值决定跳转，staff 吃掉 vehicle；`docs/testing/ui-user-journeys.md:259` | 挂账缺陷，本次顺带修 |
| 7 | 受管中文角色词写在页面 JS 里 | `home.js:81` 就地写 `'现场协作'`/`'车辆联络'`，全仓仅此一处（`format.js`/`journey.js` 里没有）——违铁律 22② | 单源缺失 |
| 8 | 搜索框标签与占位符口径不一致 | `home.wxml:52-53`：标签恒为「查找我的活动」，切到「最近查看／已结束」后仍这么写 | 文案漂移（次要，本次一并收） |

---

## 2. 两个候选结构

### B′（推荐）：一个列表、一种形式，协作降为卡片上的一枚按钮

- 「需要我协作」独立区**物理删除**（`home.wxml:26-43`），首页只剩一个列表 ⇒「两种形式并存」这个形状**不可能再出现**，而不是靠纪律维持。
- 协作动作下沉到卡片 affordance 行：`查看活动安排` ｜ `现场协作 ›` ｜ `车辆联络 ›`（后两枚只在服务端给了对应 meta 时出）。
- 领队待办的可见性用筛选段第四档承接：`我的活动 / 最近查看 / 已结束 / 需要协作 3`（计数为 0 时第四档整档不出）。满足 plan `:200`「保持我的活动主任务」与 `:48`「待办不许消失」。
- 病灶 5、6、7、8 一并消失：只有一个列表 ⇒ 筛选与搜索天然一致；两枚按钮独立 ⇒ 双角色可达；角色标签进单源；搜索框标签改成随档位说话。
- 代价：改 `activity-card` 组件契约（加一个属性 + 一个事件），并要改一条既有门（`a20-owner-hero-test.js:258`）。

### A′（保守）：两区并存，任务区收窄成「非 owner 的协作活动」，任务行换成小号卡

- 任务区条件加 `&& !a.meta.owner`；任务行改用 `activity-card` 的紧凑形态（新增 `compact` 属性，无封面图）。
- **残留重复**：`joined ∧ (staff∨vehicle) ∧ ¬owner` 仍出现两次。要消掉它就得给卡片加按钮 ⇒ 滑向 B′。
- **残留不可达**：owner 兼车辆联络者失去任务行，`vehicle` 页对他彻底不可达（他可走工作台 `activity.js:485`，但那是另一条产品口径，且 plan 没授权我改这条）。
- 优点：不动组件契约、不动 `a20` 门。

**为什么推荐 B′**：他报的是「同一屏两种形式的列表」。A′ 是「把两种形式做得更像＋把重复变小」，B′ 是「让两种形式无处并存」。按本仓库口径（逻辑绕不如改结构），A′ 留下的两条残留各是将来会再被报出来的账。

---

## 3. 新增数据结构（B′）

### 3.1 `journey.js`：协作角色标签单源（**不放 format.js**）

```js
const COLLAB_ROLE_LABELS = { staff: '现场协作', vehicle: '车辆联络' }   // 封闭词表，键与服务端 meta 同名
```

- **为什么不放 `format.js`**：不是技术偏好——`format.js` 正被 Wave 0 owner 独占（plan `:295`），且工作区里它有 19 行未提交改动；我写进去就是「把别人的未提交改动卷进来」（plan `:296`）。铁律 22② 允许的单源位置有两个，选没在途冲突的那个。
- **为什么 `journey.js` 语义上站得住**：这一格要回答的正是「这个人对这场活动的下一步是什么」（`journey.js` 的既有职责），不是纯显示词表。
- 接法：`journey.js` 导出 `collabRoles(meta)` → `['staff','vehicle']` 的子集；页面用它派生 `[{key,label}]`。

### 3.2 `home.js` 的 `cards[i]` 新增一个字段

```js
collab: [{ key: 'staff', label: '现场协作' }, { key: 'vehicle', label: '车辆联络' }]   // 无授权则 []
```

- **为什么不叫 `tasks`**：见 §0.5 第 2 条——在途的 `pages/tasks` 是活动内 checklist，同名会在半年内被两个人读成同一件事。
- **为什么是数组而不是两个布尔（`canStaff`/`canVehicle`）**：两个布尔 ⇒ WXML 里两份 `wx:if` ＋ 两个中文标签字面量＝标签第二次定义（铁律 22②），且双角色要同时出两枚时模板要写三条分支。数组一条 `wx:for` 就够。
- **为什么不让 `activity-card` 自己从 `meta` 判**：授权判断不进组件——domain → projection → label 单向（铁律 19），组件只消费页面递来的展示项。

### 3.3 `activity-card` 新增属性与事件

```js
properties: { collab: { type: Array, value: [] } }
methods: { onCollab(e) { this.triggerEvent('collab', { key: e.currentTarget.dataset.key }) } }
```

- 事件名 `collab`，`detail.key ∈ {staff, vehicle}`。**跳转 URL 字面量不进组件**：`wx.navigateTo({url:'/pages/staff/staff?id='})` 必须留在 `home.js`，否则 `tools/journey-graph-test.js:44` 的静态边扫描（只扫页面 JS、`url:` 前 240 字符）看不见这两页的入口，页面图门会把它读成死页面。

### 3.4 顶层 `data.tasks` 的去向

- B′ 下删除，改为 `collabCount`（第四档计数）＋ `filter === 'collab'` 一档。
- **为什么计数不按当前 filter 算**：待办数回答「有几件事」，与正在看哪一档无关；跟着 filter 走会让第四档一被选中就自己变成 0。

---

## 4. 流程变更（伪码）

```
render():
  all = cache.values()
  isCollab(a) = 非终态(a.phase) && (a.meta.staff || a.meta.vehicle)     // 判据搬家，不重写第二遍
  collabCount = count(all, isCollab)                                    // 与 filter/search 无关

  base = filter === 'collab'   ? all.filter(isCollab)
       : filter === 'recent'   ? all.filter(id ∈ openedIds)
       : filter === 'finished' ? all.filter(终态)
       :                         all.filter((owner || joined) && !终态)  // 现行「我的活动」一字不改
  cards = base.filter(命中 search).sort(startAt).map(投影)
            每条投影多带 collab: [{key,label}]
  featuredId = cards[0] && cards[0].phase !== 'draft' ? cards[0].id : ''   // 现行规则不动
```

- **去重不变量（新门的判据本体）**：任一档下 `new Set(cards.map(id)).size === cards.length`，且首页只剩一个列表容器。B′ 下这条是**结构性恒真**（没有第二个容器可写），A′ 下要靠排除条件维持 ⇒ A′ 需要两条门，B′ 一条。
- `onOpenCard` 不变；新增 `onCardCollab(e)`：`draft.rememberActivity(id)` 后按 `e.detail.key` 走 `staff`／`vehicle` 两条 `navigateTo` 字面量。

### 失败语义表（缺输入怎么办）

| 失败点 | 行为 | 是否告警 |
|---|---|---|
| 服务端 meta 缺 `staff`/`vehicle` 键 | 按 false ⇒ 按钮不出、第四档不计 | 不告警（与 `a20-owner-hero-test.js:225` 现有「投影没给归属位 ⇒ 失败关闭」同口径） |
| `collab` 传空数组 | affordance 行只留「查看活动安排」，不占额外高度 | — |
| `collabCount === 0` | 第四档整档不出（不是灰掉、不是空列表） | — |
| 搜索词把协作档清空 | 走既有空态分支，新增一句「需要协作」档的空态话术 | — |

---

## 5. 文件清单（B′ · 全部已核实当前工作区干净）

| 文件 | 动作 | 量级 | 说明 |
|---|---|---|---|
| `miniprogram/utils/journey.js` | 改写 | +6 | `COLLAB_ROLE_LABELS` + `collabRoles(meta)` 单源 |
| `miniprogram/pages/home/home.js` | 改写 | +26 −22 | 判据搬家为 `isCollab`、第四档与 `collabCount`、`cards[i].collab`、`onCardCollab`；角色词改引 `journey` |
| `miniprogram/pages/home/home.wxml` | 改写 | +10 −20 | 删 26-43 整段；筛选段加第四档；`activity-card` 传 `collab` + `bind:collab`；搜索框标签随档位；**根节点第 1 行不动**（§6） |
| `miniprogram/components/activity-card/activity-card.wxml` | 改写 | +10 −6 | affordance 行按 `collab` 循环；featured 与普通卡同一套 |
| `miniprogram/components/activity-card/activity-card.js` | 改写 | +8 | `collab` 属性 + `onCollab` |
| `miniprogram/components/activity-card/activity-card.wxss` | 改写 | +5 | 多枚按钮排布只用现成 `.cluster`/`.button text`/token，**不新增色值**（铁律 17） |
| `miniprogram/pages/home/home.wxss` | **不动** | 0 | 第 6、11、12 行被三条既有门钉住（§6） |
| `miniprogram/utils/format.js` | **不动** | 0 | Wave 0 owner 独占（§0.5） |
| `tools/a20-owner-hero-test.js` | 改写 | ±12 | `:258-259` 那条 `tasks.length === 2` 改判「第四档筛出这两场」；其余逐字节比对不动 |
| `tools/home-collab-list-test.js` | **新增** | ≈120 | 判据见 §7 |
| `tools/home-collab-list-mutate.js` | **新增** | ≈70 | 4 条变异自证 |
| `docs/testing/ui-user-journeys.md` | 改写 | ±8 | `:24` 入口列 + `:259`（§8.6 双角色缺陷关闭） |
| `docs/ui-ux-redesign/2026-10-20-global-prototype-dev-plan.md` | 改写 | +3 | Wave 4 清单补 home 这一项（§0.5 第 5 条） |
| `SYNC.md` | 追加 | ≈10 行 | 根因＋修法＋门数 |

**部署面：`cloudfunctions/` 零改动 ⇒ 不需要重新部署 trailApi**（Wave 1/3 欠的那次重部署不属本次，仍挂在原账上）。

---

## 6. 会被这次改动碰到的既有门（逐条写明怎么过）

| 门 | 钉的是什么 | 本次如何不踩 |
|---|---|---|
| `tools/b4-pad-final-value-test.js:390-395`（T2.4/T2.5） | `home.wxml:1` 根节点条件类分支数 ≥2，且空状态那一支也留够底部留白 | 第 1 行一字不动（那个 `with-tabbar` 假开关另有挂账，不属本次） |
| `tools/swx2-style-gates-test.js:456-457, 487-491` | `home.wxss` 里 `.activity-card .activity-card__info` 的色值终值＝`--muted`／featured＝`--on-forest-muted` | `home.wxss` 不改；继续用 `activity-card` ⇒ 选择器仍命中 |
| `tools/page2-gates-test.js:985-995` | `home.wxss` 的 84px tab 留白只出现在 tab 页 | 同上，不动 |
| `tools/journey-graph-test.js:44, 93, 101` | 静态扫页面 JS 的 `navigateTo` 字面量；每页有入口、有返回路径 | 两条 URL 字面量留在 `home.js`（§3.3） |
| `tools/a20-owner-hero-test.js:258` | 协作/车辆视角合并进来的两场都进任务区 | 按 §5 改判到第四档，**不是放宽**：合并路径仍被同一条断言看着（改后必须仍能红，靠 §7 第 8 条的变异证明） |
| `tools/check-handlers.js` | 每个 `bind*` 解析到真 handler | 新增 `bind:collab`→`onCardCollab`/`onCollab` 成对写 |

---

## 7. 新门 `tools/home-collab-list-test.js` 的判据（行为级，不钉源码文本）

1. **去重不变量**：任意 fixture、任意一档，`cards` 的 id 无重复；且页面上不存在第二个活动列表容器。阳性对照＝`git archive HEAD` 的旧形状必须报红（否则这条门是空转）。
2. **双角色两枚按钮独立**：`staff ∧ vehicle` ⇒ `cards[i].collab` 长度 2、key 集合 `{staff, vehicle}`（抓 §1 病灶 6 那个「staff 吃掉 vehicle」）。
3. **协作档与其余档同构**：同一场活动在「需要协作」与「我的活动」两档下的卡片字段（除 `featured`）**逐字节相同** ⇒ 证明列表真的只有一个。
4. **计数不跟 filter 走**：切档、搜索后 `collabCount` 不变（搜索过滤视图，不清除待办）。
5. **搜索穿透四档**：关键词命中时协作档同样被过滤（治病灶 5）。
6. **失败关闭 + 双向**：`meta` 缺 `staff`/`vehicle` 键 ⇒ 按钮不出、计数不计；`collabCount===0` ⇒ 第四档不出现；**有授权时第四档必须出**（防「永远不说」的一刀切，本仓库第十/十一轮教训）。
7. **标签单源静态门**：`'现场协作'`/`'车辆联络'` 在 `pages/` 与 `components/` 下命中 0 次（只许在 `utils/journey.js`）。
8. 变异自证 `tools/home-collab-list-mutate.js`：注入「两区各自渲染」「staff 吃掉 vehicle」「计数跟 filter 走」「缺 meta 当有权限」四条 ⇒ 每条都必须红，且先跑未变异副本全绿的有效性门。

---

## 8. 验证计划

- Node 层：`check.js` + `check-handlers.js` + `a20-owner-hero-test` + 新门 + 变异自证 + `journey-graph-test` + `b4-pad-final-value` + `swx2-style-gates` + `page2-gates` + 受影响的 `scenario-*`（按面复跑，不宣称全量 sweep）。
- **真机（M4）必须跑**：这次动 WXML 与组件结构，静态门通过不代表渲染对（`docs/e2e-mp/README.md`）。覆盖：
  ① 375px 下筛选段四档是否挤／换行（`.segmented .seg` 是 `flex:1` + `padding:8px 6px`，四档 × 4 字是新增压力）；
  ② 双角色卡上两枚按钮的触控高度与排布；
  ③ featured hero 卡在森林底时 affordance 行的可读性；
  ④ 第四档计数为 0 时整档消失；
  ⑤ 截图前先证 bundle 是新的（新文案自证）。
  开发者工具与云沙盒是共享资源 ⇒ 需要重开会话时先取得授权。
- 本机那三条 `[GP·黄金路径]` 草稿是 E2E 留下的脏数据，正好是 owner＋vehicle 双角色的自然样本，验证时不删。

---

## 9. 需要他点头的（唯一一条真两难）

- **B′**：一个列表、一种形式，协作变卡片按钮＋筛选段第四档（带计数）。**彻底**，代价是「需要我协作」从顶部常驻变成点第四档才看见（计数缓解），且要改 `activity-card` 组件契约与一条既有门。
- **A′**：两区并存、任务区收窄成非 owner、任务行换小号卡。**改动小**，留两条已知残留（`joined∧staff` 仍重复；owner 兼车长彻底进不了 vehicle 页）。

以下四条不是选项，是从已定口径与在途纪律推出来的，没有第二条路：
① 角色标签单源落 `journey.js`（`format.js` 属 Wave 0 owner）；② 新字段叫 `collab` 不叫 `tasks`（`tasks` 已被活动内清单占用）；③ 缺 meta 失败关闭；④ 两条 `navigateTo` 字面量留在页面 JS。

---

## 10. 落地实况（同日执行后回写，与上面的预估逐条对照）

**做了**：B′ 全量落地。读数：`tools/home-collab-list-test.js` **25/0**、`tools/home-collab-list-mutate.js` **9 条 0 漏网 0 崩红 0 误伤**、`a20-owner-hero-test` **31→32**，`check.js`/`check-handlers.js`/`journey-test 155`/`journey-graph 15`/`b4-pad 32`/`swx1 45`/`swx2 117`/`page2-gates 97`/`m02 66`/`e08 79`/`ui-consistency 17`/`scenario-discover 36`/`scenario-editor 158` 全绿。**未跑全量 sweep。**

**与预估不同的四处，逐条如实写**：

1. **多加了一条判据**（§7 没列）：卡片归属前缀 `status` 补第三支。协作档会把没点开过的活动带进列表，旧写法 `owner ? '我组织的 · ' : joined ? '' : '最近查看 · '` 会把「他被授了现场协作」印成「他不久前打开过这场」——同一个病灶（把没有的来由印成事实）在新结构下才暴露出来。
2. **§7 第 1 条的"阳性对照＝跑旧版本"换成了两条更强的结构判据**：断言 `page.data.tasks === undefined`（旧数组被物理删除，不是留空不用）+ 同一场活动在两档下的卡片字段逐字节同构。变异 C1（第四档不筛授权）与 C7（永不出入口）负责咬住两侧。
3. **变异 C5 第一次是漏网的**，且原因不在判据弱：页面路径上 `isCollab` 先拦了一道，`collabRoles` 自己的缺位分支根本没被走到 ⇒ 补了一条直接打词表函数的单元判据（缺位/非真值/null 三种都要空）。这是"分支没走到＝假绿"的又一形态。
4. **`docs/ui-ux-redesign/2026-10-20-global-prototype-dev-plan.md` 没改**（§5 原计划 +3 行登记进 Wave 4）：该文件是未提交的在途产物，往里写就是把别人的未提交改动卷进来。这条登记改由 `SYNC.md` 承载。

**顺带撞出来的两条与本次无关的账**（详见 SYNC.md 同日条）：
- `tools/a20-owner-hero-mutate.js` 的 discover 四条变异**在本次之前就已经是空证**（在途 Wave 1 改了 `discover.js:152` 的 `featured:` 行，锚点命中 0）。已更新锚点并复跑 10 条 0 漏网。
- 探了一下「筛选中不升 hero」这半句有没有人测：`tools/discover-filter-test.js` 里 `featured`/`hero` 零命中 ⇒ **目前无测试看着**。属 Wave 1 缺口，未擅自补（不属本次写入集）。

**存量未收（判据只管本次负责的两个所有者，其余以 `note` 明写在门里，不隐藏）**：角色词还有第二、三份定义在 `roster-panel.js:21`、`:409` 与 `staff.wxml:4`。

**真机 VERIFIED（用户选 A 授权重开项目会话；未 `quit` IDE）**：设备 390×753，端口重绑 9425→9428，bundle 新鲜度由数据形状自证（`collabCount` 在、`tasks` 不在）。14 条判定全过——真实账号 `collabCount=18`/`cards=151`，点第四档列表从 151 收缩到 18 且每张卡都带入口；双角色两枚入口同行各 48px；`collabCount=0` 时整档不出现。证据包 `docs/ui-ux-redesign/evidence/home-collab-2026-10-20/`。

**真机首轮抓到 §7 那 25 条 Node 判据全部放过的两个缺陷**（都是"数据对、渲染不对"）：① 协作入口用 `.button.text` ⇒ 深绿字压在 featured 的深绿底上几乎不可读；② `.affordance-open { flex: 1 1 auto }` ⇒ 主入口吃掉整行、两枚协作按钮各占一行。修法：协作入口改与主入口同一套 `button leaf`；主入口 `flex: 1 1 100%` 独占一行，协作入口包进 `.collab-row`。两条都转成了驱动里的机器读数（`top` 必须同行、`class` 必须含 `leaf`）。

**5. 里那条"375px 是否挤"没做成像素证据**：该 automator 版本无 `setViewport`，换设备档位要动图形界面。按 390 实测反推：一档文字需 71px，375 下等分只剩 67px ⇒ **推算**第四档标签会在按钮内换行（整段不溢出）。最短消除路径是标签改「协作 18」，等裁决。详见证据包 README 的「仍未证」段。
