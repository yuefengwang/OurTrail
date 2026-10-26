# Style B · Slice 3b（名单 / 交通面板）证据

日期：2026-10-26 · 基线 `6e1faec` · 分支 `agent/ourtrail-style-a-20261023`
规格：`docs/ui-ux-redesign/style-b-shared-layer-spec-2026-10-26.md` §3.5 / §4.2 / §5.2
参照板：`docs/ui-ux-redesign/reference/screens-2026-10-20/03-2-members.png`、`03-3-transport.png`
结论上限：**结构 + 静态门 + 页面套件**（真机 **NOT_RUN**，见 §6）

---

## 1. 板面读数（先说板到底画了什么）

| 板 | 读到的事实 | 本轮取用 |
|---|---|---|
| 03-2 成员管理 | 顶部一张圆角卡里 **2 格**汇总（已报名 10 人 / 待确认 3 人，每格左上一个线性图标）；下方一颗整宽 pill 搜索；再下面是**无卡片包裹**的人员行：头像 + 姓名 + 灰副行 + 右侧状态 chip | 汇总改成指标带、搜索改 pill、人员行尺寸对齐；**汇总取 3 格**（见 §4 偏离 1） |
| 03-3 交通安排 | 顶部汇总卡 **2 格**（车辆 2 辆 / 剩余座位 5 个）；车辆卡带**缩略图** + `车1·川A12345` + `司机：张三` + 右侧 `5座/7座` + `自费/可见`；**列表下方**一颗整宽实心主按钮「添加车辆」 | 容量带保持 3 格（C15）、车辆卡保留文字事实行、**添加车辆移到列表末尾整宽**；缩略图不实现（见 §4 偏离 2） |

板上的交通页没有「预览自动分车」这一屏 —— 它是本产品的真实流程（`onPreview` → 方案预览 sheet），本轮不删，只把主位顺序理顺（§3 [4]）。

## 2. 结构块验收

| 块 | 目标（spec §3.5） | 实现 | 读数 |
|---|---|---|---|
| [1] 汇总 | 一行说清这一屏要处理几类人 | `roster-panel.wxml:16-20` 三格 `.metrics`（已确认 / 待审核 / 候补），数字取 `counters` 投影 | `scenario-workspace`：`counters.confirmed=4 / pending=1 / waitlisted=1` |
| [2] 搜索 | 44 高 pill | `roster-panel.wxml:25-29` `.searchbar` + `.searchbar__input` + 搜索 icon | `operations-layout`：`.roster-filter .searchbar { flex:1; min-width:0 }`，且已无 `.roster-filter .input` |
| [3] 人员行 | 头像 44 + 姓名 16/600 + 副行 12 + 右 chip + 18 padding + 84 min-height + 发丝线 | 全局 `.person-row` 已给 84/18/发丝线/头像 44；本轮把**真实头像**从 40 补到 44，姓名升到 `--text-input`（16） | `operations-layout`：`.avatar-img` 44×44 + `.person-name` `var(--text-input)` |
| [4] 交通行动 | 添加车辆是列表末尾的整宽按钮 | `transport-panel.wxml:101-107`：从标题行搬到车辆 `wx:for` 之后，`button block` + 条件底色 | `operations-layout`：位置在 `wx:for="{{vehicles}}"` 之后、不在 `card-header` 内 |
| [5] 主按钮预算 | 同屏只能有一个实心主按钮 | 无车 ⇒ 预览是禁用的（`busy || !vehicles.length` 置空 bindtap），添加车辆实心；有车 ⇒ 预览实心，添加车辆软底 | 断言把条件写成 `secondary/primary` 两分支；恒 `primary` 变异必红（§5 M4） |
| [6] 座位图 | 原样（C15） | 未动 `.seat-grid` / 4 座 + 1 过道 | `rc-transport 67/0` |

## 3. 改动面（5 个文件）

| 文件 | 改动 |
|---|---|
| `miniprogram/components/person-row/person-row.wxss` | `.avatar-img` 40→44（width/height/flex-basis）；新增 `.person-row__body .person-row__heading .person-name { font-size: var(--text-input) }`（0,3,0 压过全局 0,2,0） |
| `miniprogram/components/roster-panel/roster-panel.wxml` | `{{countersLine}}` 一句话 → 三格 `.metrics` + 备注；搜索 `.input` → `.searchbar` pill（含 icon） |
| `miniprogram/components/roster-panel/roster-panel.js` | data 默认 `counters: {confirmed:0,pending:0,waitlisted:0}`；`render()` 由拼 `countersLine` 改为透传 `counters: v.counters` |
| `miniprogram/components/roster-panel/roster-panel.wxss` | `.roster-filter .input` → `.roster-filter .searchbar { flex:1; min-width:0 }` |
| `miniprogram/components/transport-panel/transport-panel.wxml` | 标题行的「添加车辆」移到车辆列表末尾、改 `button block` + 条件 `secondary/primary`；icon 颜色按底色条件（`#163E35`/`#FFFFFF`，均既有 token 同值） |

零新增 token / 零新色值（icon 的两个字面量分别是 `--forest` 与 `--white` 的值，`icon` 拿不到 `var()`，注释已就地写明）；未改 `transport-panel.js`、未改投影、未改座位布局、未动 `person-row__body { min-width:0 }`。

**跨页影响**：`person-row` 还挂在 `field-panel`、`activity`、`vehicle` 三处 ⇒ 头像统一 44、姓名统一 16 在四屏同时生效。这是 spec 想要的统一，不是副作用；但这四屏本轮真机都未跑（§6）。

## 4. 有意偏离（登记，不静默）

1. **汇总 3 格（板 2 格 / spec 写 2 格）**：板上第二格是「待确认」，第三类可批量操作对象「候补」在板上没有位置。本面板的批量动作恰好是三类（审核 / 递补 / 取消），少一格就只能靠逐条筛选去数。取舍理由写在 wxml 注释里。
2. **车辆卡没有缩略图**：`Vehicle` schema 没有图片字段（`domain/schema.js`），加字段属 schema 变更，本轮硬禁。板上缩略图位置暂由「车牌 + 司机 + 容量算式」三行承担。
3. **待安排名单仍是 `list-row`**：它是待办队列（名字 + 上车点 + 整组标记），不是人员档案；换成 `person-row` 会与下方车辆卡里的真实人员行混成同一级对象。数据侧 `pendingList` 也确实只装了这三个字段。
4. **板上的「剩余座位 5 个」没有直接对应**：本面板给的是「可分配乘客位 = 核载 − 司机 − 预留」，比剩余座位更准（把司机与预留扣掉）。C15 要求保留 3 指标，未改成 2 格。

## 5. 门禁读数与重钉

| 套件 | 读数 | 退出码 |
|---|---|---|
| `tools/check.js` | ALL CHECKS PASSED（G10：作用域单元 42 / token 3158 / app.wxss 类名 135 / 命中 0；G11 43 wxss、717 选择器、双写 0） | 0 |
| `tools/check-handlers.js` | 死 handler 仍只有存量 `editor#onNumber` | 0 |
| `tools/operations-layout-test.js` | **50 / 0**（45→50，+5） | 0 |
| `tools/scenario-workspace-test.js` | 125 / 0（换载体，条数不变） | 0 |
| `tools/t1-r01-test.js` | 29 / 0 | 0 |
| `tools/rc-transport-test.js` | 67 / 0 | 0 |
| `tools/b4-c11-busy-selfheal-test.js` | 171 / 0 | 0 |
| `tools/page2-gates-test.js` | 117 / 0 | 0 |
| `tools/t4-e08-test.js` | 41 / 0 | 0 |
| `tools/m02-class-scope-test.js` | 66 / 0 | 0 |
| `tools/swx1-style-gates-test.js` | 45 / 0 | 0 |
| `tools/swx2-style-gates-test.js` | 110 / 0 | 0 |
| `tools/b4-pad-final-value-test.js` | 33 / 0 | 0 |
| `tools/ui-consistency-test.js` | 19 / 0 | 0 |
| `tools/journey-graph-test.js` | 15 / 0 | 0 |
| `tools/e2e-panel-sync-test.js` | 40 / 0 | 0 |
| `tools/scenario-activity-test.js` | 212 / 0 | 0 |

**未跑全量 sweep，不编总数。**

`trip2-gates-test.js` 复跑 **66 / 10**，与 Gate recount 28 在干净基线 `e05e559` 上复现的读数逐条相同（失败均为 `Cannot read properties of undefined (reading 'callFunction')` 这类装配环境缺桩），**属既有红，非本轮引入**，未擅动。

### 5.1 重钉：`scenario-workspace-test.js` 的名单汇总条

| 原断言 | 现断言 | 为什么不是放宽 |
|---|---|---|
| `comp.data.countersLine === '已确认 4 · 待审核 1 · 候补 1。仅显示你有权查看的人员。'` | `counters.confirmed===4 && pending===1 && waitlisted===1` + wxml 三处 `{{counters.*}}` + `.metric` 恰 3 格 + **删一格必须变 2** | 原来只比一句话的字符串；现在同时钉数据出处（投影对象）、三个插值点、格数与「缺一格必红」 |

`counters` 是投影的完整对象（另有 `occupied/remaining/unassigned/...`），所以断言逐字段比而不是整对象深比 —— 整对象深比会把投影新增字段变成假红。

## 6. 变异自证（改生产文件，还原后 sha256 逐一核对）

| # | 变异 | 预期 | 实测 |
|---|---|---|---|
| M1 | `roster-panel.wxml` 把一个 `.metric` 改名 `.metric-slot` | 格数掉到 2 | `operations-layout` 49/1（`名单：汇总从一句话改成三格指标带…`）+ `scenario-workspace` 124/1 |
| M2 | `transport-panel.wxml` 把条件底色写死 `text`（旧形态） | 定位不到新的两分支按钮 | 49/1（`交通：添加车辆在车辆列表末尾整宽…`）※ 该变异在改版为 `secondary/primary` 之前跑出 |
| M3 | `person-row.wxss` 头像 44→40 | 头像与占位符不同尺寸 | 49/1（`人员行：头像 44 与姓名 16/600…`） |
| M4 | `transport-panel.wxml` 条件底色写死 `primary` | 有车时与预览抢主位 | 49/1（同名断言） |

四次变异锚点均要求**命中恰 1 次**（否则脚本 exit 9），还原后 `sha256sum` 与改前一致，复跑 `50/0`。

## 7. 布局风险与算术

- **搜索行在 375 宽下不挤**：`.searchbar` 是 `flex:1; min-width:0`，`picker` 是 `flex:0 0 auto`（内容宽 ≈「全部状态 ▾」+ 12 padding），右侧不会被压缩到换行；`.searchbar` 高度取全局 `--touch-target`（44），与板上 pill 同高。
- **头像 44 与行高 84**：`min-height:84` + `padding:18px 0` 下，44 的头像在 84 里居中留 20 上下；改成 44 后与首字占位 `.avatar`（全局 44）一致，**同一列表不会再出现 4px 行高差**（40 与 44 并存就是这个差值的来源）。
- **添加车辆不会与预览抢主位**：无车 ⇒ 预览的 `bindtap` 被 `!vehicles.length` 置空且叠 `.disabled`（灰底 `--line`），添加车辆实心；有车 ⇒ 预览实心，添加车辆 `secondary`（`--forest-soft` 底 + 森林字），两个实底不会同时出现。
- **`.button.block` 在 `wx:if="{{!lockHint}}"` 内**：出发后整块不渲染，与既有「出发后只读」一致，没有新增死按钮。

## 8. 真机 NOT_RUN

共享开发者工具会话本轮未接管、未重编译，因此**不宣称这两屏已保真**。升到 VERIFIED 至少需要：

1. `close --project` + `open` 重编译（不 `cli quit`），bundle 新鲜度由新结构自证（搜索是圆角 pill、添加车辆在列表末尾）。
2. 生产形状载荷：名单 `counters` 三档非零 + 至少 4 行带真实头像与首字占位混排；交通 `vehicles.length = 0` 与 `= 2` 两帧，各带 `metrics.vehicleTravel > 0`。
3. 读数：375 与 390 两宽下搜索 pill + 状态筛选是否同行、人员行头像与姓名基线、添加车辆按钮与最后一辆车卡的间距、无车时有只一个实心按钮。

## 9. UNVERIFIED

- 头像 44 在真实头像（非正方形裁切）下与首字占位是否真的等高（算术一致 ≠ 像素一致）。
- 搜索 pill 内 icon 与输入文字的光学居中。
- 添加车辆 `secondary` 底（`--forest-soft`）与车辆卡之间是否被读成按钮还是卡（未取像素）。
- 四屏（名单 / 分车 / 现场 / 活动详情）里 `person-row` 姓名 16 之后的换行与两行行高。
- 出发后（`lockHint`）整块消失时页尾留白是否仍然够。
