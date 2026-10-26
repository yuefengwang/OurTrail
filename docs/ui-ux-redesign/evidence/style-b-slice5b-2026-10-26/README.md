# Style B · Slice 5b 证据 —— 路线库 / 路线详情 / 路线编辑器 / 天气全图（2026-10-26）

## 0. 口径

这四页与 5a 一样**没有 10-20 逐屏板**（`style-b-fidelity-matrix-2026-10-26.md` §2.3），
任务书 Slice 5 的口径：**只做 token 与组件收敛；导航、四态、底部留白不得回归**。
本片**不碰结构、不碰业务、`cloudfunctions/` 零改动 ⇒ 不需要重新部署**。
`route` / `routes` / `weather-chart` 的页头与行内元信息已在批次二 b（F2/F3）落过，本片收的是**剩下的重复出处**。

审计先做的事：四页 wxss 全文读一遍（36 / 27→14 / 6 / 49 行），逐条查
原始色值（**0**）、无源 `font-size` 字面量（**0**）、`px` 触点是否走 token（**1 处命中，见 C4**）。

## 1. 收敛点

| # | 对象 | 改前 | 改后 | 唯一出处 |
|---|---|---|---|---|
| C1 | 紧凑指标（四列横排用不了 26px 大字） | `.route-metrics .metric .metric-value` 与 `.route-facts .metric .metric-value` —— 两页**逐字相同**的一份规则（`--text-title` / 24px / `letter-spacing:0`） | `class="metrics compact …"` | `app.wxss` `.metrics.compact .metric .metric-value` |
| C2 | 与缺省同值的死覆盖 | `.route-meta { gap: 8px; }` 在两页各定义一次，而 `app.wxss:117` 的 `.cluster` **缺省 gap 就是 8px** ⇒ 两份都是空转；模板写 `class="cluster route-meta"` | 定义与使用点一起删（routes 2 处 + route 1 处） | 不再有这一层 |
| C3 | 行内主标题 | `style="font-weight:600;"` 在 route / route-edit / editor / signup **抄了 14 份**（节点名、风险标题、上车点名、路线名、模板活动名、分区标题、参与人名） | `class="row-title"` | `app.wxss` `.row-title { font-weight:600; overflow-wrap:anywhere }` |
| C4 | 全图页档位触点 | `.fc-modes .seg { min-height: 44px }` —— 写死数字绕过 token（规则 8：新增/改动可点元素必须引用 token） | `min-height: var(--touch-target)` | `app.wxss` 的 `--touch-target` |

### C3 不只是重复，它露出一个真缺口

`route.wxss` 的 `.route-node-name` 原本是 `{ display:block; font-weight:600; margin-top:2px; overflow-wrap:anywhere }`——
**断词保护（M-16）写在页面那一侧**，而 `route-edit.wxml:85` / `editor.wxml:278` 的**同一行**（同一个
`{{item.name || '起点'/'终点'/'节点 N'}}`）只有裸的内联字重，没有 `anywhere`。
这些名字全是用户自由输入（`maxlength=80`）：一个无空格的拉丁长串在 `flex` + `min-width:0` 里
不会词内断，只有 `anywhere` 算进 min-content、真的收得住（`app.wxss:616` 的 M-16 注释写的就是这件事）。
⇒ 编辑器与报名页的节点名/风险名/参与人名**过去没有这层保护**。

`row-title` 因此把字重与断词一起给：**它们是同一个决定的两半，分开抄必然漏一半。**
`route-node-name` 只留它真正独有的部分（块级 + 与眉题的 2px 间距），模板上写 `class="row-title route-node-name"`。

**这一条的结论上限要说清**：`overflow-wrap: anywhere` 会改变 min-content。
只有在**原本就会溢出**的行里才有可见变化（那正是修的部分）；有剩余空间时 `flex-shrink` 不触发，表现不变。
但"哪些行在 375/390/414 下原本会溢出"需要像素证据 ⇒ 本轮 **UNVERIFIED**，见 §5。

## 2. 一处判据收窄（不是放宽，如实记）

第一版断言写成"四页不得出现 `font-weight:600`"，跑出来**红了**：`editor.wxml:638` 的
`<text style="color:var(--forest);font-weight:600;">{{editingExtras ? '完成' : '编辑'}}</text>`
是一个**文字动作的强调**（带语义色），不是行内主标题。把它塞进 `.row-title` 是错贴标签，
所以判据改为只咬**独立的** `style="font-weight:600;"` 形态，并把这一处例外写进
`design-system.md` 的 `.row-title` 行。

这是"判据认关系、不认字节"的一次具体执行：字面命中 ≠ 同一件事。
牙齿自证里 N9/N12 用的正是独立形态，能咬。

## 3. 审查后没动（避免下轮重复提议）

| 对象 | 理由 |
|---|---|
| `route-edit.wxss`（6 行） | 只有 `.row-tap`，且 `min-height` 已引用 `--touch-target`；页面自述"样式全部复用 app.wxss 存量类"，属实 |
| `route.wxml` 剩余 10 处内联 style / `route-edit` 剩余 17 处 | 全是 `.cluster` 的微调（`justify-content:space-between`、`gap`、`min-width:0`、`flex:1`、`flex-wrap:nowrap`），是布局覆盖不是数值出处；已由棘轮钉住"只许变少" |
| `activity.wxml:342` 同族的 `display:block;font-weight:600;margin-top:2px` | `activity` 属已验收的 Slice 2/3 写集，本轮不重开该文件；已登记为**后续项**（下一轮由同一判据收） |
| `lab.wxml` 2 处内联字重（含一处 `word-break:break-all`） | `lab` 是 DEV_ONLY 预演页，按矩阵排除在视觉批次；留给 5c 一并按同一判据判 |
| `weather-chart.wxss` 的 `100vh` / `216px` / `10px` | `100vh` 是横屏整屏的既有选择（规则 11 只禁 `dvh/svh/lvh`）；`216px` 是三档 segmented 的容器宽，`10px` 未出现 |

## 4. 门与牙齿

`tools/personal-route-layout-test.js`：**65 → 71**（本片 +6 条）。

| 新断言 | 钉什么 |
|---|---|
| 紧凑指标只有 app.wxss 一个出处 | `app.wxss` 有该规则 **且** 两页模板都带 `compact` **且** 两页 wxss 去注释后再无 `.metric-value` |
| 空覆盖 `.route-meta` 从定义与模板一起消失 | 两页 wxss 无定义 + 两页模板无使用 + `app.wxss` 的 `.cluster` 缺省 gap 仍是 8px（**这一句是承重前提**：如果哪天 `.cluster` 缺省变了，`.route-meta` 就不是空转，门必须重新判） |
| 全图页触点引用 `--touch-target` | `.fc-modes .seg` 的 `min-height` 必须是 var |
| 行内主标题走 `.row-title` | 规则含 `font-weight:600` **且** `overflow-wrap:anywhere`（两半同处）+ 四页无独立内联字重 + 四页至少一处用了该类 |
| `route-node-name` 只留排布差 | 该类不得再声明 `font-weight` / `overflow-wrap`，且模板两个类同写 |
| 六页内联 style 棘轮 | routes `=` 0、weather-chart `=` 0、route ≤ 10、route-edit ≤ 17、editor ≤ 99、signup ≤ 17（全部实测） |

5b 内联 style 前后：route 11→10、route-edit 19→17、editor 109→99、signup 18→17，routes / weather-chart 恒为 0（**合计 −14**）。

变异自证 `tools/mutate-5b.js`：**14 条 0 漏网**，每条命中目标断言、恰好红 1 项（N9/N12 各红 2 项，
因为同一处编辑同时碰了字重门与棘轮，属预期），sha256 逐字节还原并独立复验；
有效性门＝变异前必须全绿否则 `exit 2` 记 INVALID。
其中 **N12 专门用来证明 signup 那一页不是搭便车通过**（它原本没有测试锚点，只有把它的行名退回内联才会红），
**N8 专门证明"两半同处"不是空话**（只删 `overflow-wrap` 保留字重，门必须红）。

复跑读数（全绿）：

```
personal-route-layout 71/0 · routes 75/0 · scenario-editor 227/0 · scenario-signup 106/0
scenario-activity 212/0 · scenario-me 145/0 · page2-gates 124/0 · swx1 45/0 · swx2 110/0
m02-class-scope 66/0 · ui-consistency 19/0 · t4-e08 41/0 · b4-c11 171/0 · ra-field-panel 72/0
check.js ALL CHECKS PASSED（G10 命中 0 ｜ 作用域 42 ｜ class token 3193 ｜ app.wxss 类名 137→139 ｜ G11 双写 0）
check-handlers 门 B 通过，死 handler 仍是存量 1 条（editor#onNumber）
```

## 5. 真机状态（2026-10-26 回读后更新）

**本批已回读**（IDE 模拟器 390、真实数据 299 条路线；bundle 新鲜度见 5a §7 与设备报告 §1）。
逐条读数与帧清单在 **`../style-b-slice5-device-2026-10-26/README.md`**。

| 前置项 | 结果 |
|---|---|
| C1 紧凑指标不压邻列 | **VERIFIED**：每行 3 格、格间实测 11.66px（= `.metrics` 的 12px gap）、同行无压叠、全部在容器（314 宽）内；`.metric-value` 计算 `font-size` = **18px**（= `--text-title`，不是全局 26px）⇒ 单源类在真机解析对了。帧 `device/E2r-*.png` `V2-routes-row-scrolled.png` |
| C3 断词在真机咬住 | **VERIFIED**：节点行按**文本反查**命中，计算 `overflow-wrap` = **anywhere**；80 字无空格拉丁串盒 316×**44**（两行）不越卡沿（37+316=353 ≤ 370）；短名同位 70×**22**（单行）⇒ 长短差异来自断词，不是选择器抖动。帧 `style-b-slice5a-.../device/D2r2-*.png` |
| C2 死覆盖删除后 `.cluster` 缺省生效 | **VERIFIED（间接）**：路线行的 `cluster` 元信息间距在帧里正常，且模板已无 `.route-meta`；未单独量该 gap |
| C4 全图页档位触点 ≥44 | **NOT_RUN**：`weather-chart` 数据来自跨页总线、无独立入口，本轮没能真实进入该页（含横屏姿态）。这条仍是缺口 |

**回读过程中修掉的两个探针缺陷（错在尺不在页面，详见设备报告 §3）**：
① E2 第一版把"本行最后一格"与"下一行第一格"拿来判压叠 ⇒ 假红 1 条，改成只比 `top` 相同的兄弟后 3 条全 PASS；
② D2 前两版量错对象——真节点行套在 `<block wx:if="{{routeDetailsOpen}}">` 里，夹具没打开那一支 ⇒
第三版显式打开 + 按文本反查 + 短名阴性对照才成立（铁律 34⑥ 第三次现形）。作废帧隔离在 `style-b-slice5a-.../device/invalid/`。

结论上限：本批在已读数的 C1/C2/C3 上升到 **E3**；**C4 仍是 NOT_RUN**，不随本批一起升。
