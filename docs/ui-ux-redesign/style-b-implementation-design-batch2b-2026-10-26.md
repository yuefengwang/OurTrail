# style-B 批次二 b：剩余 14 页 Gap Matrix 与定向修复

**日期：** 2026-10-26
**基线：** `6e1faec`（批次一 checkpoint，未推送）+ 批次二 a 工作树（weather-hub / weather，已收口）
**范围：** `routes` / `route` / `route-edit` / `workspace` / `tasks` / `staff` / `vehicle` / `signup` / `editor` / `anotices` / `weather-chart` / `privacy` / `lab` / `cloud-field-poc`
**不在范围：** `home` / `discover` / `activity` / `notices` / `me`（批次一）、`weather-hub` / `weather`（批次二 a）

本文件先记录**实测现状**，再据此给出改 / 不改的判定。所有「现状」栏的数字与文案都来自真机驱动读数，不是读源码猜的；证据包在 `evidence/style-b-2b-2026-10-26/`。

---

## 0. 结论摘要

| 编号 | 修复 | 一句话 | 严重度 |
|---|---|---|---|
| F1 | 全局导航底色 | `app.json window` 仍是深绿 `#163E35`/白字 ⇒ 7 个继承页的导航与页面主体（米白）断成两段；统一为 `#F5F5F0`/黑字 | 高（跨 7 页） |
| F2 | 路线库页头与行尾 | 页头三层里有两层与原生导航重复、主按钮被挤到第二行左对齐；每行两条灰色尾注可合并为元信息 | 中 |
| F3 | 路线详情概览 | 元信息以 12px 灰字压在 20px 标题之上，保存时间单独占一行 | 中 |
| F4 | 路线编辑器 | 「导入 GPX 轨迹」与底栏「保存修改」同时是实底主操作（双主）；页头眉题与动态导航标题逐字重复 | 中 |
| F5 | 工作台四宫格 | 四个入口用 `button leaf` 淡黄绿实底，成为整页最抢眼的色块，与「白卡 + 细线」的版面语言相反 | 中 |
| G1 | 新增门禁 | `tools/nav-chrome-test.js`：把「全站导航浅底黑字」钉成配置契约（带影子牙齿） | 防复发 |

其余 9 页判定为**不改**，理由与门禁引用见 §5。**不改不等于没问题**：`vehicle` / `staff` / `signup` 的真实内容态在本账号下不可达，按 UNVERIFIED 登记（§7.4），不拿 denied 截图冒充验收。

---

## 1. 取证方法（可复跑）

| 项 | 值 |
|---|---|
| 设备 | 微信开发者工具模拟器，390×844，默认导航，`clientHeight = 753` |
| 通道 | miniprogram-automator，`ws://127.0.0.1:9435` |
| 驱动 | `%TEMP%\opencode\mp-auto\audit-style-b-2b-2026-10-26.js`（13 页，pass 1）、`audit2-style-b-2b-2026-10-26.js`（有权限的活动，pass 2）、`audit3-scroll-2026-10-26.js`（折叠线下） |
| 产物 | `readings.json` / `readings-pass2.json` + 27 张 PNG，均在本目录 `evidence/style-b-2b-2026-10-26/` |
| 采样字段 | `denied` / `loading` / 首个 `.kicker`、`.eyebrow`、`.page-title`、`.list-head__title` 的文案与矩形 / `section-heads` / 可见 `.button.primary` / `chapter` 序列 |

两点方法学修正，写下来防止下次重犯：

1. **缩图会造出假缺陷。** `mp.screenshot()` 在 306px 宽下缩过，编辑器底栏的「继续完善」（`.button.text`，白底深字）在缩图里像一块深底按钮。按 300px 宽重采样后确认是白底——**判定颜色前先放大原图**，本轮据此撤回了一条本已写进草稿的「对比度缺陷」。
2. **pass 1 的 `title=null` 不是缺陷。** `tasks` / `staff` 的身份行用的是页内 `__title` 类（18px），pass 1 只抓 `.page-title` / `.list-head__title` 才读空；pass 2 显式抓 `__title` 后读数正常。

---

## 2. 全局断点：导航底色两套（F1）

**读数：** 21 页里 14 页在自己的 json 里声明了 `navigationBarBackgroundColor: #F5F5F0` + `black`；7 页没有声明，继承 `app.json` 的深绿 + 白字。

- 继承（深绿）：`signup` / `editor` / `weather` / `weather-chart` / `privacy` / `lab` / `cloud-field-poc`
- 声明（米白）：其余 14 页

**像素证据：**
- 深绿导航 + 米白主体：`signup.png`（报名同行）、`editor.png`（发起活动）、`privacy.png`（隐私保护指引）、`weatherChart.png`（全屏图表）
- 米白导航：`routes.png`（路线库）、`tasks.png`（任务清单）、`staff.png`（协作任务）、`workspace-owned.png`（活动工作台）

**为什么算断点：** 原生导航是页面第一块「顶边」。同一产品里两个底色意味着「进入报名/编辑/隐私这三类高风险页时换个产品」——而这 7 页恰好是用户最需要信任感的页。批次二 a 的天气页截图也把这条缝原样拍下来了（app 内最长的内容页，顶上仍是深绿）。

**门禁现状：** 没有任何套件钉住 `app.json window` 的颜色。唯一的导航色断言是 `tools/scenario-activity-test.js:1723`（只钉活动详情自己的浅色）。⇒ 这条缝可以随便复发，G1 就是补这个洞。

**边界：** 4 个一级 tab 页走 `navigationStyle: custom` + `<brand-header />`（D2），`window` 的颜色对它们无效；改 `app.json` 不会动品牌栏。

---

## 3. 逐页 Gap Matrix

| 页 | 实测现状（读数/截图） | 判定 | 理由（依据） |
|---|---|---|---|
| `routes` 路线库 | 页头三层：kicker「OURTRAIL · 路线」+ 20px「路线库」+ sub；原生导航已印「路线库」⇒ **同一身份自报三次**。主按钮落在第二行左对齐（`新建路线` y=98、x=20、116×48；上文列宽仅 228）。每行 5 段文字：元信息 / 标题 2 行 / 指标 3 项 / 「暂无风险提示 · 还没有活动使用」/「早期路线」 | **改（F2）** | 命名重复 + 主按钮破行；两条灰尾注都属于元信息，合并后每行少一行 |
| `route` 路线详情 | 概览：12px 灰字「GPX 导入」+ 徽章 + 权限词 + 已共享 → 20px 标题（2 行）→ 指标 3 项 → 单独一行「保存于 …」。章节 01–04 编号 + 3 个无编号章节（协作/使用/管理） | **改（F3）** | 元信息压在标题之上且比标题弱三档；保存时间应与其它元信息同簇。章节编号只在真有先后时用（01–04 是一条阅读顺序），后半三段是并列，已正确无编号 ⇒ 不动 |
| `route-edit` 编辑路线 | 页头 kicker「OURTRAIL · 编辑路线」+ 24px「改这条路。」+ sub；`route-edit.js:143` 已动态设导航标题（新建/编辑）⇒ kicker 逐字重复。可视区内两个实底主操作：`route-edit.wxml:54`「导入 GPX 轨迹」+ 底栏「保存修改」（`route-edit.wxml:192`） | **改（F4）** | 双主；且仓库自己的规矩是「GPX 导入用 secondary，把主位留给本页唯一主行动」——`tools/page2-gates-mutate.js:61-62` 的 P6 把「升成 primary」当成必须报红的越界变异 |
| `workspace` 活动工作台 | 身份/分段条/状态带/待办卡都已是白卡细线；待办主行（现场清点签到）为白底主卡，推进按钮按 `workspace.wxml:73` 正确降为 secondary（一屏一个主行动）。**唯独四个工具入口**（`workspace.wxml:91-105`）用 `button leaf`：淡黄绿实底 + 深绿字，两列铺满，成为页内最响的元素 | **改（F5）** | 版面语言是「白卡 + 细线 + 一个强调色」；四块淡绿实底既不是主行动也不是状态，只是导航，不该占据最强视觉权重 |
| `tasks` 任务清单 | kicker「协作 · 任务清单」+ 右上活动名 + 18px「把分工说清楚。」+ sub + 4 段分段条 + 空态卡；无 `.page-title`（`tools/operations-layout-test.js:181` 明写要求） | 不改 | 紧凑身份行是有意的（页内注释），门禁钉着「不得出现 page-title」；空态与分段条层级正常 |
| `staff` 协作任务 | kicker「现场协作」+ 活动编号 + 18px「照顾好这一小队。」+ 说明；正文 denied（授权不存在或已过期）。无 `.page-title`（`operations-layout-test.js:171`） | 不改 | 同上；且本账号无 staff 授权，**真实面板态 UNVERIFIED**，不凭 denied 态改正文结构 |
| `vehicle` 车辆安排 | denied（本账号无车辆/无权限）；深底反白 hero 是既有设计（户外强光场景），`scenario-vehicle-test` 钉住根节点 `.stack` | 不改 | 无真实内容态证据，不动；深底 hero 是刻意的方向，不属于本批次统一目标 |
| `signup` 报名同行 | denied（唯一非本人活动「已过时」）：「当前无法报名 / 活动尚未开放、已截止或没有报名权限」+ 回详情 | 不改（仅 F1 导航） | 真实报名表单不可达 ⇒ 结构改动无验收依据 |
| `editor` 发起活动 | 批次一已改：kicker「发起一次同行」+ 24px 标题 + 4 步分段 + 分区表单；底栏一个 primary「发布活动」+ 一个 `.button.text`「继续完善」（2× 放大已确认白底深字，非缺陷） | 不改（仅 F1 导航） | 已是批次一的成果；唯一视觉断点就是导航底色 |
| `anotices` 活动通知 | kicker「同行消息」+ 24px「重要安排，不错过。」+ sub + 空态卡 | 不改 | 已是批次一语言（眉题 + 一句话身份 + 空态邀请） |
| `weather-chart` 全屏图表 | 深绿导航「全屏图表」+ 图内工具条（全览/标准/放大/关闭）+ 长图 | 不改内容（仅 F1 导航） | 这是图表容器页，D7 的重排不涉及它；顶栏对比度由 F1 一并解决 |
| `privacy` 隐私指引 | 深绿导航 + kicker「OURTRAIL · 隐私」+ 法律文本 H1「隐私保护指引」+ 更新日期 + 分节正文 | 不改内容（仅 F1 导航） | 法律文档的 H1 就是标题，不做编辑化改写 |
| `lab` 预演台 | kicker「开发工具 · 仅白名单账号」+ 标题（DEV_ONLY 页） | 不改 | 不进用户路径（`journey-graph` 的 DEV_ONLY 登记） |
| `cloud-field-poc` 三维试验页 | DEV_ONLY；本轮通道在该页前超时，`readings` 记为最后一项并降级为 UNVERIFIED | 不改 | 试验页不是交付面；连续驱动它会拖死 automator 通道 |

---

## 4. 定向修复

### F1 全局导航统一为浅底黑字

- **文件：** `miniprogram/app.json`（`window` 块，当前 `navigationBarBackgroundColor: "#163E35"` / `navigationBarTextStyle: "white"`）
- **改成：** `#F5F5F0` + `"black"`（与 14 个页面 json 现值逐字节一致）
- **不改成：** `tabBar.selectedColor: "#163E35"` 保留——那是品牌强调色，不是导航底色
- **影响面：** 7 个继承页的顶栏视觉；4 个 custom 导航页不受影响
- **门禁：** 无既有断言；新增 G1

### F2 路线库：页头收敛 + 行内元信息合并

- **`routes.wxml:7-17`**：删掉 kicker「OURTRAIL · 路线」与 `.section-sub`，20px 的「路线库」换成一句陈述（`discover.wxml` 同型先例）；原生导航已印「路线库」，身份不再自报三次。主按钮改成页头下一条**全宽 `block` primary**（`notices.wxml:19` / `weather-hub.wxml:16` 的既有口径）。
- **实施时被实测推翻的初稿：** 初版写成「陈述 + 右侧按钮同一行」。390 下实测 `title 24-80 / btn 88-136` ⇒ 换行。按字符估：19 字 × 20px ≈ 380，加 12px 间距与 122px 按钮 ≈ 370 > 358（内容宽）；375 更紧。**不用 `flex-wrap: nowrap` 硬塞**——那只是把溢出从纵向挪到横向。改为 block 后实测 `title 24-52 / btn 80-128 w=350`，宽度不再依赖设备。
- **`routes.wxml:29-33` / `:57-60`**：把 `{{item.updatedText}}` 挪进 `.route-meta` 簇（source → 难度 → 已共享 → 保存时间），删掉行尾的独立灰行。
- **一条写反的断言（同日更正）：** 第一版真机断言要求「保存时间出现在**标题之上**」——实际模板把元信息簇放在标题**之下**（这是对的：标题 → 元信息 → 指标 → 风险）。失败读数是 `title@229 updated@289`。已改为钉真实阅读顺序：标题 < 保存时间 < 风险/引用行，并保留「元信息簇里确有保存时间」与「行尾只有风险一行」两条结构门；**不是把断言放宽，而是把方向改对**。
- **不改：** 循环、`data-id`、`onOpen` / `onNewRoute`（`tools/personal-route-layout-test.js:55` 钉着）；`.route-index` 序号（这一列是列表计数，有位序含义）。
- **已知数据问题（不修）：** 账号里 299 条路线多为 `月亮湖穿越伍须海-1790560849819.gpx.bin_tmp` 这类导入残留名；属于数据卫生，不是版式问题。

### F3 路线详情：元信息归位

- **`route.wxml:8-14` → **：source 改成 `.kicker`（值只有「GPX 导入 / 手工整理 / 活动沉淀」三种短标签，`routes.js:11`），单独一行放在标题上方；徽章 + 权限词 + 「保存于 …」收进标题下方的 `.route-meta` 簇。
- **删 `route.wxml:32`** 的独立「保存于 …」行，其文案改为该簇最后一项（`{{route.updatedText}}`）。
- **不改：** 章节顺序与编号（`personal-route-layout-test` 钉住 海拔→节点→天气→风险→共享→使用→管理）、地图卡在章节之前、sticky 仅 owner。

### F4 路线编辑器：降 GPX 导入、删重复眉题

- **`route-edit.wxml:54`**：`button primary block` → `button secondary block`（本页唯一 primary 是底栏保存；先例 `page2-gates-mutate.js:61-62` P6）。
- **`route-edit.wxml:12`**：删 kicker 行（`OURTRAIL · 新建路线/编辑路线`）——`route-edit.js:143` 已经动态设置原生导航标题，逐字重复。
- **不改：** 底栏、`has-sticky` 条件、`fixround2` 的页尾留白判据、GPX 预览浮层内的「应用到路线」（那是浮层自己的主行动，浮层打开时覆盖底栏语境）。

### F5 工作台：四个工具入口改白卡

- **`workspace.wxml:91/95/99/103`**：`class="button leaf workspace-tool"` → `class="button workspace-tool"`。`.button` 基类已是 `background: var(--surface)` + `1px var(--line)` 细边，去掉 `leaf` 即得到与页面其余卡片同族的白面。
- **`workspace.wxss:48`**：`.workspace-tool__sub` 的 `color: var(--forest)` → `var(--muted)`（标题级用 forest、说明级用 muted，和其它卡片的二三级关系一致）。
- **不改：** 网格 `repeat(2, minmax(0,1fr))`（`operations-layout-test.js:139`）、四个 handler 在 `.workspace-tools` 内（`:97`）、`canEdit` 条件项、待办主行与 secondary 推进按钮。

### G1 新增 `tools/nav-chrome-test.js`

- 断言 `app.json window` = `#F5F5F0` + `black`；
- 遍历 21 个页面 json：**凡是声明了导航底色的，必须是同一对浅底黑字**；未声明的视为继承（继承值已由第一条保证）；
- 反向：任何页面把导航底色写成 `#163E35`/白字 ⇒ 红；
- 保留 `tabBar.selectedColor === '#163E35'`（防止「统一浅色」被做过头）；
- **牙齿：** 把判定抽成纯函数，喂一份 `#163E35/white` 的合成 json 必须被判红、喂 `#F5F5F0/black` 必须通过——门禁自身不靠「今天恰好全对」。

---

## 5. 明确不改（附门禁/证据）

| 项 | 依据 |
|---|---|
| `tasks` / `staff` 18px 身份行、无 `.page-title` | `tools/operations-layout-test.js:171`（staff）、`:181`（tasks）明写要求；页内注释写明「没有活动名投影就不虚构标题」 |
| `.eyebrow`（12px/0.72px）与 `.kicker`（11px/1.2px）两套眉题并存 | 前者属于 2026-10-23 L3「作业面」页，后者属于批次一「编辑体」页；两套都各自成套，强行合并会同时改 8 个页面的排版 |
| `vehicle` 深底反白 hero | 户外强光下的可读性取舍；`scenario-vehicle-test` 钉根节点 `.stack` |
| `route` 分段天气的单行结构 | 属天气线的展示层，批次二 a 已定「条件→图→详解」，不在这里二次改 |
| `privacy` 的法律 H1 | 文档标题即内容结构，不做编辑化 |
| `lab` / `cloud-field-poc` | DEV_ONLY（`journey-graph-test` 登记），不进用户路径 |
| `routes` / `route` 的序号与指标 | 序号有位序含义；指标是投影产物（D9：只改排版，不动投影字段） |
| 编辑器底栏「继续完善」的白底样式 | 2× 放大核对为白底深字，不是缺陷（§1 教训 1） |

---

## 6. 文件清单（预期）

**生产代码（5 个文件）**

| 文件 | 改动 |
|---|---|
| `miniprogram/app.json` | `window` 导航底色/字色（F1） |
| `miniprogram/pages/routes/routes.wxml` | 页头 3 行 → 1 句 + 按钮同行；两处尾注合并进元信息簇（F2） |
| `miniprogram/pages/route/route.wxml` | 概览元信息重排 + 删独立保存时间行（F3） |
| `miniprogram/pages/route-edit/route-edit.wxml` | 导入按钮降为 secondary；删重复眉题（F4） |
| `miniprogram/pages/workspace/workspace.wxml` + `.wxss` | 四个入口去掉 `leaf`；说明文字改 muted（F5） |

**门禁（1 新 + 2 扩展）**

| 文件 | 改动 |
|---|---|
| `tools/nav-chrome-test.js` | 新增（G1） |
| `tools/personal-route-layout-test.js` | +2：路线库页头不再出现与导航重复的标题层且主按钮与身份同行；详情页 kicker 在标题之前、保存时间不再独立成行 |
| `tools/operations-layout-test.js` | +1：四个工具入口不得使用 `leaf` 实底、说明文字为 muted |

**文档**

| 文件 | 改动 |
|---|---|
| `docs/ui-ux-redesign/style-b-implementation-design-batch2b-2026-10-26.md` | 本文件 |
| `SYNC.md` | 批次二 b 条目（根因 + 改动 + 套件读数） |
| `docs/ui-ux-redesign/evidence/style-b-2b-2026-10-26/README.md` | 证据包说明 + 前后对照 + UNVERIFIED 清单 |

`cloudfunctions/` **零改动** ⇒ 本批次**不需要重新部署 trailApi**。

---

## 7. 验收标准

### 7.1 静态

- `node tools/check.js` → ALL CHECKS PASSED
- `node tools/check-handlers.js` → 无新增未解析 handler
- `node tools/nav-chrome-test.js` → 全绿；影子用例（合成深绿 json）必须红

### 7.2 门禁套件（逐套实测，不编总数）

`nav-chrome` / `personal-route-layout` / `operations-layout` / `page2-gates` / `entry-layout` / `header-layout` / `scenario-editor` / `scenario-activity` / `journey-graph` / `ui-consistency` / `t4-e08` / `m02-class-scope` / `swx1-style-gates` / `swx2-style-gates` / `b4-pad-final-value`

其中 `swx2` 的既有红（`activity.wxss` `.highlight-dot` 字重，2026-10-17 已登记）与本批次无关，按归属处理、不当成我引入的红。

### 7.3 真机（同一模拟器、重编译后）

| 断言 | 判据 |
|---|---|
| 导航统一 | `signup` / `editor` / `privacy` / `weather` 四页导航条采样像素 ≈ `#F5F5F0`（±3），标题文字深色；且这 4 页的导航色与 `routes` 一致 |
| 路线库页头 | 页头只有一句 20px 陈述，**随后是全宽 block primary**（`w > 300`，纵向在陈述之下）；`.kicker` 计数 0。初版「同一行」判据被实测推翻，见 §4 F2 |
| 路线库行 | 最后一行是「风险/引用」；保存时间在元信息簇内、位于标题之下（`title.top < updated.top < risk.top`） |
| 路线详情 | 首个 `.kicker` ∈ {GPX 导入, 手工整理, 活动沉淀}；保存时间不再是独立行 |
| 路线编辑 | 首屏可见的 `.button.primary` 只有底栏「保存修改」；`.kicker` 计数 0 |
| 工作台 | 四个工具入口的 class 不含 `leaf`；2× 放大截图显示白底细线 |
| 回归 | `home` / `discover` / `activity` / `notices` / `me` / `weather-hub` / `weather` 首屏无位移（导航改色除外），`brand-header` 仍在 |

### 7.4 UNVERIFIED（如实登记，不用 denied 冒充）

- `signup` 真实报名表单（唯一非本人活动已过时，不可达）
- `staff` 真实任务面板（本账号无协作授权）
- `vehicle` 真实车辆 hero 与分车（无车辆数据）
- `workspace` 名单 / 分车 / 现场三个 tab 的展开态
- 原生 picker / 分享 / 相册 / 键盘弹起态
- 375 宽度断点
- `cloud-field-poc` 全程（通道超时，DEV_ONLY）
- 地图底图（IDE 环境瓦片空白，长期 UNVERIFIED）

### 7.5 停止条件

F1–F5 + G1 全绿且真机 7.3 全过 ⇒ 批次二 b 收口，追加 `SYNC.md` 条目与证据包 README；**不自动提交**，等用户统一审批后再 commit。
