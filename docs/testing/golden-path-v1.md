# Golden Path v1（P0 主生命周期端到端）

> 一句话：证明「一个真实用户能不能从创建活动一路走到归档」，并且每个关键状态转换**同时**被
> 真实 UI 操作与 backend 回读证明。实现：`tools/e2e-golden-path-test.js`，结果语义沿用
> `tools/e2e-result.js`（两维 × PASS/FAIL/INCONCLUSIVE，退出码 0/1/2），逐节点账本由脚本每次运行打印。
>
> 本轮**没有修改任何产品代码**（除上一轮已批准的 `signup.wxml` 勾选框修复外），也没有为了让路径变绿
> 而绕开控件。凡是绕不过去的，都留在失败/未验证清单里。

## 1. 判据（与任务书一致）

| 判据 | 落地方式 |
|---|---|
| 真实用户路径优先 | 一律 `element.tap()` / `element.input()`；全脚本零 `callMethod`，且被 `auditSource` 当门禁强制（F3 + 本脚本 GP-00 自检） |
| UI 与 BUSINESS 分开 | 每个动作记两条：`uiTap(...)`（操作本身发生过）+ `uEffect(...)`（界面状态真的变了）+ `b(...)`（云端回读对得上） |
| 不许 fallback 洗 UI | 环境准备用的业务命令一律 `b(...)` + 紧跟一条 `unv(...)` 说明「被它替代的 UI 能力未验证」 |
| expected 不得来自 actual | 座位期望值来自 fixture（`SEAT_LABELS`）+ 分配规则；报名期望值来自 fixture 姓名与 id；阶段期望值来自 `PHASE_LABELS`。没有任何一处「读回来再当期望」 |
| 截图不是证据 | 只落盘到 `~/.ourtrail-e2e/shots/gp-*.png`，不参与任何判定 |

## 2. 请求的节点 → 真实状态机 / 命令 / UI 入口

任务书里的名称与本项目真实状态机（`schema.js:155`）的映射，全部按真实语义对齐，没有改产品命名：

| 节点 | 真实 phase / 命令 | 真实 UI 入口 |
|---|---|---|
| Create | `draft` ← `activity.create` | home「发起活动」→ `pages/editor` 三步表单 |
| Edit | `activity.edit` | 草稿详情「返回编辑与发布」→ 改 `description` → 「保存草稿」 |
| Publish | `draft → published` ← `activity.publish` | editor 第 03 步「发布活动」→ 弹层「确认发布」 |
| Discover | `read{discover}` | home「发现活动」→ 卡片 `<article bindtap="onTap">` → 详情 |
| Signup | `signup.submit`（整组 2 人） | 详情页「填写报名资料」是 `isOwner` 的 `wx:elif` 分支（**组织者看不到**）⇒ 单账号只能 URL 直达该页，页内控件全真 tap；导航那一步记未验证 |
| Review | `pending → confirmed` ← `signup.review` | workspace 名单 tab → 勾选行 → 「确认报名」→ 弹层「确认仅处理这 N 人」 |
| Vehicle | `vehicle.save` | 分车 tab → 「添加车辆」→ 「添加司机」→ 6 个输入位 → 勾集合点 → 「保存车辆安排」 |
| Seat | `previewAssignments` → `assignment.commit` | 「预览自动分车方案」→「明确确认并提交此方案」→ 座位示意 |
| Check-in | `published→gathering` + `attendance.checkin` | 总览「进入正在集合」→ 原因 → 「现场」tab → 逐人「确认现场签到」 |
| Departure | `attendance.board` + `attendance.departure(joined)` | 上车：**车长任务页** `pages/vehicle`「确认上车」；出发核实：现场弹层 |
| Arrival | `vehicle.depart` / `vehicle.complete`（+ `attendance.node` 未验证，见下） | 车长页「确认本程发车」「完成本程行驶」 |
| Home | `closing` + `attendance.home` | 「进入返程报平安」→ 逐人「核实安全到家」 |
| Complete | `archived` | 「进入已归档」→ 归档后读面关闭（`detailState=finished`、导出被拒） |

## 3. 本轮结论：哪些能力**只存在于界面上、点下去却被服务端拒或根本点不出来**

以下五条都是本轮真机量出来的，不是推断。前四条是产品缺陷，最后一条是角色闸按设计生效。

1. **车辆「覆盖的上车点」勾选框恒显示已勾 → 车辆无法经 UI 创建**（新发现，真机钉死）：
   `components/transport-panel/transport-panel.wxml:206` 写的是
   `checked="{{vform.pickupIds.indexOf(item.id) !== -1}}"` —— WXML 数据绑定不支持方法调用，
   该表达式恒为真。实测：新建车辆时 `vform.pickupIds=[]` 而渲染 `checked=true`（读元素 property 得到），
   真实用户点一下反而把它取消 → `afterIds=[]` → 保存被前端校验挡下
   「请至少勾选一个集合上车点——车辆在此接人。」（`transport-panel.js:422`）。
   后果：**组织者在界面上加不出任何一辆车**，座号/座位分配/上车全链路因此失去 UI 起点。
   全仓这一类 `indexOf` 绑定仅此 1 处（`grep -rn "indexOf(" miniprogram/**/*.wxml` 实测只命中它）。
2. **裸 `<checkbox bindchange>` 在真机永不触发** —— 微信只定义了 `checkbox-group` 的 change 语义
   （`signup.wxml:84` 自己的注释就这么写）。全仓 **7 处**踩了这个坑，其中 **2 处本轮真机实测确认「点下去 data 不翻转」**：
   - `components/transport-panel/transport-panel.wxml:212`（「使用明确座号」）→ 实测 tap 后 `vform.seatLabelsOn` 仍 `false`；
   - `pages/editor/editor.wxml:353`（招募开关）→ 实测 tap 后 `form.acceptingSignups` 不翻转。
   另外 5 处同一形式、本轮未逐个实测，只登记不背书：`activity.wxml:245`、`editor.wxml:469`、
   `editor.wxml:489`、`lab.wxml:84`、`field-panel.wxml:21`（「只看去向或到家待核实」筛子）。
   后果严重度不一：`editor.wxml:469/489` 是「我本人也参加 / 独立同意」——发布弹层的提交按钮在
   `participate && !dataUse` 时永久 disabled，也就是说**组织者想「发布时顺便给自己报名」可能根本点不动**；
   `transport-panel:212` 使**界面上无法给车辆编座号**（本轮座位节点因此只能由业务命令落库，UI 记未验证）。
   已进静态门禁：`tools/check.js` 新增「勾选框事件载体」检查，这 7 处登记在 `KNOWN_BARE_CHECKBOX` 白名单里，
   **只允许变少不允许变多**，删空后即为硬失败。
3. **协作授权的两个 picker 没有数据 → 车辆联络无法经 UI 创建**：`roster-panel.wxml:161/181` 绑
   `{{roleOptions}}/{{scopeOptions}}`，而组件 data 实测 = `{"roleOptions":null,"scopeOptions":null}`
   （JS 只有模块常量 `ROLE_OPTIONS`/`SCOPE_OPTIONS`）。后果：车长页进不去 ⇒ 上车这一步在真实用户路径上断链
   （本轮用 `membership.save` 自授以让下游节点可测，UI 侧记 FAIL + 未验证）。
4. **工作台面板挂载后不重读**（`workspace.js:111 onTab` 只 `setData({tab})`）：实测阶段推到集合后，
   仍挂着的现场面板 `phase` 停在 `published`，弹层 `actions` 为**空数组** —— 组织者看到的是「点开弹层什么按钮都没有」，
   只能退出重进。本轮 Golden Path 把它作为 UI FAIL 钉住，并在下一步用「退出重进」这个真实用户补救动作继续。
   同源的第二条后果更隐蔽：面板保持挂载（`workspace.wxml:27-31` 明文写明是故意的）使页面里同时存在
   多个 `.textarea`，第一次「进入正在同行」的确认就是因为原因填进了现场面板的备注框而点了个
   disabled 的空按钮 —— 产品没坏，但任何按页面级 selector 找输入框的实现（包括自动化）都会踩。
5. **现场面板给未上车的拼车乘客提供「核实已随队出发」**：真机点下去服务端拒（`departure` 仍 `unknown`），
   而上车入口只在车长页 —— 与交叉审计 §5-3 一致，本轮第一次由端到端复现。

## 4. 平台限制（记 INCONCLUSIVE，不记 FAIL，也不算通过）

原生 `<picker>` 在 DevTools 自动化通道里驱不动：`probe` 实测 tap 后既没有任何可查询面板
（`.picker-panel` / `picker-view` / `.weui-picker` 全 0），值也不变。因此这三处真实用户路径无法由自动化走完：

| 位置 | 用户要做的事 | 记账 |
|---|---|---|
| `editor` 出发/结束/截止时间 | 选日期时间 | GP-01 UI=INCONCLUSIVE（草稿由业务命令补齐才走得下去） |
| `signup` 出行方式（自行前往 / 按上车点集合） | 选上车点 | GP-08 UI=INCONCLUSIVE（两位乘客的 `shared/pk-1` 由 `signup.edit` 落，只记 BUSINESS） |
| `field-panel` 节点选择 | 选路线节点 | GP-11 UI=INCONCLUSIVE（`attendance.node` 只有域层与 A 层证据） |

另有一处**不是缺陷也不是限制**：详情页报名 CTA 是 `isOwner` 的 `wx:elif` 分支
（`activity.wxml:48`）——组织者看不到「填写报名资料」是角色闸正常生效。单账号自动化因此无法以
「第二身份」点进报名页，本轮改为 URL 直达该页后**页内控件全部真实点击**，并把「导航那一步」记为未验证。

## 5. 本轮实测账本

读数取自 §6 十连跑的**第 10 轮**（即最终构建；第 1~9 轮的节点表与计数与它逐行相同，唯一差异是
GP-05 一条环境准备断言在跑中途改过名称与判据，见 §6.2）。

```
节点                 BUSINESS     UI            断言(B/UI)
GP-00 环境             PASS         NONE          2/0
GP-01 Create         PASS         INCONCLUSIVE  2/12
GP-02 Edit           PASS         PASS          1/8
GP-03 Publish        PASS         PASS          3/6
GP-04 Discover       NONE         PASS          0/7
GP-05 Signup         PASS         INCONCLUSIVE  4/16
GP-06 Review         PASS         PASS          1/12
GP-07 Vehicle        FAIL         FAIL          4/23
GP-08 Seat           PASS         INCONCLUSIVE  4/7
GP-09 Check-in       PASS         FAIL          3/21
GP-10 Departure      PASS         PASS          5/19
GP-11 Arrival        PASS         INCONCLUSIVE  2/4
GP-12 Home           PASS         FAIL          2/12
GP-13 Complete       PASS         PASS          3/10

BUSINESS: FAIL（35 通过 / 1 失败 / 0 未验证）
UI:       FAIL（142 通过 / 7 失败 / 8 未验证）
ENV:      4 项前置（0 项不成立）
passed=177 failed=8 unverified=8 · OVERALL=FAIL · exit=1
```

8 条失败**全部是产品缺陷或平台限制的直接后果**，没有一条是「点击没点着」：

| # | 维度 | 断言 | 实测读数 | 定性 |
|---|---|---|---|---|
| 1 | UI | 勾选落到 `vform.pickupIds` | `renderedChecked=true, beforeIds=[], afterIds=[]` | 产品缺陷（§3-1） |
| 2 | UI | 「使用明确座号」勾选生效 | `seatLabelsOn=false, boxes=2` | 产品缺陷（§3-2 裸 checkbox） |
| 3 | UI | 保存后面板未报错 | `请至少勾选一个集合上车点——车辆在此接人。` | 上一条的必然后果 |
| 4 | BUSINESS | readTransport 回读到 1 号车 | `n=0`（UI 造不出车） | 产品缺陷（同 1–3） |
| 5 | UI | 协作授权弹层的角色 picker 有数据 | `roleOptions=null, scopeOptions=null` | 产品缺陷（§3-3） |
| 6 | UI | 阶段推进后挂载面板自行重读 | `panelPhase=published / cloudPhase=gathering` | 产品缺陷（§3-4） |
| 7 | UI | 弹层动作表非空 | `sheetOpen=true, actions=[]` | 上一条的必然后果 |
| 8 | UI | closing 段面板 phase 未重读 | `panelPhase=active / cloudPhase=closing` | 同一缺陷在 closing 复发 |

8 条「UI 未验证」（不得当作通过，全部由平台限制或单账号通道造成）：
`editor` 出发时间 picker（GP-01 两条）、报名页导航那一步（GP-05）、车辆弹层关闭把手在自动化通道里不可查
（GP-07）、车辆经 UI 创建（GP-07）、协作授权经 UI 授予（GP-07）、`signup` 出行方式 picker（GP-08）、
`field-panel` 路线节点 picker（GP-11）。

**链路的真实可达性**：Create→Edit→Publish→Discover→Signup→Review→Seat→Check-in→Departure→Arrival→Home→Complete
**十二个节点的业务状态全部按状态机推进到位**（`draft→published→gathering→active→closing→archived`，
两位参与人 `checkedIn / outboundBoarded / departure=joined / home=true`，归档后 `detailState=finished`、
敏感导出被拒）。唯一由 UI 断掉的是 **Vehicle 一个节点**：§3-1/2/3 三处缺陷使组织者在界面上
既造不出车、也发不了车辆联络授权——本轮用 `vehicle.save` / `membership.save` 业务命令补出来让下游可测，
并把这个替代明确记成 `unv`（UI 未验证），不洗成通过。

## 6. 稳定性

### 6.1 十连跑（2026-10-05 01:00–02:11，每轮之前重启开发者工具）

| run | exit | OVERALL | passed/failed/unverified | 失败断言签名 |
|---|---|---|---|---|
| 1 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |
| 2 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |
| 3 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |
| 4 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |
| 5 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |
| 6 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |
| 7 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |
| 8 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |
| 9 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |
| 10 | 1 | FAIL | 177 / 8 / 8 | `73c94907` |

签名 = 该轮全部 `✗ [维] 断言名` 排序后的散列。**十轮完全一致**：同样的 8 条失败、同样的实测读数
（`renderedChecked=true/beforeIds=[]/afterIds=[]`、`seatLabelsOn=false`、`panelPhase=published vs gathering`
逐字节相同），逐节点账本的 B/UI 计数也一致。⇒ 这 8 条红是**确定性产品/平台事实**，不是抖动。

### 6.2 失败定性（runs 10 / passed 0 是 OVERALL 意义上的，不是稳定性意义上的）

| 类别 | 条数 | 明细 |
|---|---|---|
| PRODUCT BUG | 8 | §3-1（1 条 UI + 1 条 BUSINESS 后果）、§3-2（1 条）、§3-3（1 条）、§3-4（3 条：gathering 两条 + closing 一条）、以及 §3-1 导致保存被前端校验挡下（1 条）——合计 8 条，全部落在 GP-07/09/12 三个节点 |
| TEST BUG（跑通过程中已修，不在最终读数里） | 5 | ①重渲染后旧句柄点错行（run 14，改按 `data-id` 点名）②阶段按钮只在 `tab===0`（run 16，加「点回总览」）③原因填进挂载面板的备注框（run 17，改为回读 `data.reason` 才算填对）④closing 段未先重进页面（run 18，补用户级「退出重进」）⑤CONFLICT 后立刻二次确认仍撞旧 revision（run 19，改为等页面读回最新 revision 再点） |
| ENVIRONMENT FLAKE | 0（本轮） | 十轮重启 IDE 后连接全部一次成功。修 harness 之前的 run 15 曾出现过一次 `timeout waiting for automator response` 与一次 `page destroyed`（run 14/15 各一），后者根因是句柄失效（TEST BUG ⑤类），已在 run 17 用 `mp.currentPage()` 重绑句柄根治 |
| REAL FLAKE | 0 | 十轮签名一致，无任何一次结果漂移 |

### 6.3 STABILITY 判定

**Stability = PASS（读数层面）**：连续 10 轮读数、失败集合、逐节点计数完全一致，0 flake。
**Golden Path = FAIL**：10/10 轮都红，红在产品缺陷上——按任务书 §18，这是正确结果，不是需要消掉的噪声。
每轮都会在真实云端留下一个 `[GP·黄金路径] …·<tag>` 沙盒活动（走到归档的那轮会自动退出发现列表；
中途断掉的那些带报名、按域规则取消不掉，需在预演面板清理）。

## 7. 复现

```bash
# 前置（一次性）：开发者工具设置→安全→服务端口开启；项目已登录并能打开 D:\OurTrail
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" close --project D:\OurTrail --port 33278
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" open  --project D:\OurTrail --port 33278
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto  --project D:\OurTrail --auto-port 9420 --trust-project --port 33278
node tools/e2e-golden-path-test.js      # 逐节点账本 + VERDICT；退出码 0/1/2
```

每轮会在真实云端建一个 `[GP·黄金路径] …·<RUN_TAG>` 活动并走完到归档（归档后自动退出发现列表）。
中途中断会留下 published/gathering 状态的同名前缀沙盒 —— 带报名的活动按域规则取消不掉，需人工在预演面板清理。

## 8. 测试侧纪律（本轮踩实后已写进代码注释）

1. `page.$()` 恒返回单元素，数组一律 `$$`；
2. 弹层/列表**重渲染后旧句柄仍会「点击成功」**——必须按 `data-id` 点名并每轮重查（上车第二条就是这么丢的）；
3. 弹层开着时遮罩吞点击是正确行为，下一步操作前要么关层要么重进页面；
4. 面板 `data` 的 flag 读数会滞后（`publishOpen` / `editorOpen`），要落到「按文案查得到那个控件」这种 DOM 观测；
5. 提交成功后页面会销毁（`page destroyed`），判定必须走云端回读而不是页面状态；查「当前真实所在页」要用
   `mp.currentPage()` 并**把 `page` 句柄重新绑定**，否则 `byText` 内部仍会拿旧句柄去 `waitFor`；
6. 给 `String.replace` 传替换串要用函数形式，否则 `$$` 会被吃掉一个 `$`；
7. **阶段按钮只在 `tab===0` 渲染**（`workspace.wxml:33` 的 `wx:if`）：在「现场」区做完核实后必须先真实点回
   「总览」才看得到「进入正在同行」，否则查无此按钮——这是 harness 的错，不是产品的；
8. **面板保持挂载 ⇒ 页面级 `.textarea` 会命中别的分区**。任何「填一个输入框」的断言都必须回读
   目标 data（`data.reason === 所填文案`）才算填对；只看 `input()` 没抛错会静默填进现场备注框，
   于是「确认变更」是 disabled 空按钮，点了没反应（`workspace.js:139`）；
9. **乐观并发闸的第二跳**：面板刚下发过命令时，页级 revision 变旧，第一次「确认变更」必被 CONFLICT
   弹回「安排已被他人更新，已刷新，请重试」（`api.js:111-119` 只重读页面、不代重发）。
   脚本按用户的做法再点一次，但**两次都单独记账**——这不是 retry-to-green：第一次被拒是事实，
   被记成一条 UI 断言，第二次才谈成功。

## 9. Golden Path v2 该补的

**修产品的顺序（按用户被挡住的程度排）**：

1. `transport-panel.wxml:206` 的 `pickupIds.indexOf(item.id)` 恒真绑定 —— 组织者在界面上造不出任何一辆车，
   这是唯一把主链路彻底断掉的缺陷（改法：预先算好 `pickupOptions[i].checked` 或引 WXS，一行级改动）；
2. `roster-panel` 把 `ROLE_OPTIONS`/`SCOPE_OPTIONS` 挂进 `data` —— 否则车辆联络无法经 UI 授予，车长页永远进不去；
3. `workspace.js:111 onTab` / 面板 `phase` 陈旧 —— 阶段推进后已挂载面板应重读（或改为 `wx:if` 挂载），
   否则用户看到的是空动作表，只能在红字「请重试」里反复点；
4. 7 处裸 `<checkbox bindchange>`（已进 `check.js` 白名单，只允许变少）——`editor.wxml:469/489` 优先，
   它挡住的是「发布时顺便给自己报名」；
5. `field-panel.js:125` 对未上车拼车乘客仍提供「核实已随队出发」：要么按钮按上车事实收敛，要么把上车入口搬进面板。

修好 1/2/3 后，本套件的 8 条 `unv()` 里能立刻摘掉 3 条（座号、协作授权、车辆经 UI 创建），
座位与上车节点才第一次真正「全程 UI 可走」。

**测试侧 v2**：

- 原生 picker 的替代路径：若产品给时间/出行方式/路线节点加一个可点选的非 picker 入口（或允许 `picker-view`），
  GP-01/GP-08/GP-11 的 INCONCLUSIVE 可以摘掉；否则这三处永远只能记未验证；
- 双账号：报名 CTA 与审核分属两个身份，真正的「参与者视角全程」需要第二个可登录身份或真机；
- 覆盖面（§20 明确不在本轮）：`position.* / incident.* / notice.* / membership.revoke` 四条线端到端仍为零，
  `attendance.node` 的 UI 语义、`assignment.remove/swap`、`attendance.returnPlan` 同理。
