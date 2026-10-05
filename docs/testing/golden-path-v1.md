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
4. **工作台面板挂载后不重读** —— **Phase 3 已修（§10）**。修前实测：阶段推到集合后，
   仍挂着的现场面板 `phase` 停在 `published`，弹层 `actions` 为**空数组** —— 组织者看到的是「点开弹层什么按钮都没有」，
   只能退出重进；同一缺陷在 closing 段复发（`panelPhase=active` vs `cloudPhase=closing`，「核实安全到家」按钮查无）。
   同源的第二条后果更隐蔽：面板保持挂载（`workspace.wxml:27-31` 明文写明是故意的）使页面里同时存在
   多个 `.textarea`，第一次「进入正在同行」的确认就是因为原因填进了现场面板的备注框而点了个
   disabled 的空按钮 —— 产品没坏，但任何按页面级 selector 找输入框的实现（包括自动化）都会踩。
5. **现场面板给未上车的拼车乘客提供「核实已随队出发」** —— **Phase 3 已修（§10）**。修前真机点下去服务端拒
   （`departure` 仍 `unknown`），而上车入口只在车长页 —— 与交叉审计 §5-3 一致，端到端复现过两次。

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

## 5. 实测账本（Phase 3 修复后构建，取定版十连跑第 10 轮）

```
节点                 BUSINESS     UI            断言(B/UI)
GP-00 环境             PASS         NONE          2/0
GP-01 Create         PASS         INCONCLUSIVE  2/12
GP-02 Edit           PASS         PASS          1/8
GP-03 Publish        PASS         PASS          3/6
GP-04 Discover       PASS         PASS          3/8
GP-05 Signup         PASS         INCONCLUSIVE  4/16
GP-06 Review         PASS         PASS          1/12
GP-07 Vehicle        FAIL         FAIL          4/23
GP-08 Seat           PASS         INCONCLUSIVE  4/7
GP-09 Check-in       PASS         PASS          3/24
GP-10 Departure      PASS         PASS          5/21
GP-11 Arrival        PASS         INCONCLUSIVE  2/4
GP-12 Home           PASS         PASS          2/21
GP-13 Complete       PASS         PASS          3/10

BUSINESS: FAIL（38 通过 / 1 失败 / 0 未验证）
UI:       FAIL（160 通过 / 4 失败 / 8 未验证）
ENV:      4 项前置（0 项不成立）
passed=198 failed=5 unverified=8 · OVERALL=FAIL · exit=1
```

**剩下的 5 条红全部在 GP-07 Vehicle，且全部属于任务书 §五 划在本阶段范围外的三条产品缺陷**
（`transport-panel.wxml:206` 的 `pickupIds.indexOf(...)` 恒真绑定、`transport-panel.wxml:212` 裸 checkbox、
`roster-panel` 的 `roleOptions/scopeOptions` 未挂 data）。三条修完之后，主链 12 个节点的
BUSINESS 与 UI 两维同时成立；只有车辆这一节点仍被它们挡住。

| # | 维度 | 断言 | 实测读数 | 定性 |
|---|---|---|---|---|
| 1 | UI | 勾选落到 `vform.pickupIds` | `renderedChecked=true, beforeIds=[], afterIds=[]` | 产品缺陷（§3-1，未修·范围外） |
| 2 | UI | 「使用明确座号」勾选生效 | `seatLabelsOn=false, boxes=2` | 产品缺陷（§3-2 裸 checkbox，未修·范围外） |
| 3 | UI | 保存后面板未报错 | `请至少勾选一个集合上车点——车辆在此接人。` | 1 的必然后果 |
| 4 | BUSINESS | readTransport 回读到 1 号车 | `n=0`（UI 造不出车） | 产品缺陷（同 1–3） |
| 5 | UI | 协作授权弹层的角色 picker 有数据 | `roleOptions=null, scopeOptions=null` | 产品缺陷（§3-3，未修·范围外） |

8 条「UI 未验证」（不得当作通过，全部由平台限制或单账号通道造成）保持不变：
`editor` 出发时间 picker（GP-01 两条）、报名页导航那一步（GP-05）、车辆弹层关闭把手在自动化通道里不可查
（GP-07）、车辆经 UI 创建（GP-07）、协作授权经 UI 授予（GP-07）、`signup` 出行方式 picker（GP-08）、
`field-panel` 路线节点 picker（GP-11）。

**链路的真实可达性**：Create→Edit→Publish→Discover→Signup→Review→Seat→Check-in→Departure→Arrival→Home→Complete
十二个节点的业务状态全部按状态机推进到位（`draft→published→gathering→active→closing→archived`，
两位参与人 `checkedIn / outboundBoarded / departure=joined / home=true`，归档后 `detailState=finished`、
敏感导出被拒）。唯一由 UI 断掉的仍是 Vehicle 一个节点（范围外三条缺陷）。

### 5.1 Phase 3 三条修复在同轮里的判定行（真机读数）

```
✓ [UI] [GP-09] 已挂载的现场面板把 phase 重读到 gathering
✓ [UI] [GP-09] 重读后的名单是新的（两位已确认参与者都在，且标着未签到）
✓ [UI] [GP-12] 面板 phase 已随 syncKey 重读到 closing
✓ [UI] [GP-10] 面板不再对「未上车的拼车乘客」提供「核实已随队出发」
✓ [UI] [GP-10] 缺的事实被说清楚并把用户指向车长任务页
✓ [UI] [GP-10] 车长任务页对本人可进 → 真实点击「确认上车」×2 → outboundBoarded=true
✓ [UI] [GP-04] 命中的那张卡按 wx:for 下标回读页面数据，其 id 必须等于本轮 AID
✓ [UI] [GP-04] 卡片文案自证 organizer 关系：服务端算出的 owner 标志渲染成「我组织的」
✓ [BUSINESS] [GP-04] 后端权威态对齐：详情记录 id=AID，ownerId 等于本轮登录身份
```

## 6. 稳定性

### 6.1 定版十连跑（2026-10-05 17:35–19:07；每轮之前 `cli quit`+`open`+`auto` 并过 `preflight.js` 体检）

| run | exit | OVERALL | passed/failed/unverified | 失败断言签名 |
|---|---|---|---|---|
| 1 | 1 | FAIL | 191 / 5 / 8 | `c8b7a465` |
| 2 | 1 | FAIL | 191 / 5 / 8 | `c8b7a465` |
| 3 | 1 | FAIL | 191 / 5 / 8 | `c8b7a465` |
| 4 | 1 | FAIL | 191 / 5 / 8 | `c8b7a465` |
| 5 | 1 | FAIL | 191 / 5 / 8 | `c8b7a465` |
| 6 | 1 | FAIL | 191 / 5 / 8 | `c8b7a465` |
| 7 | 1 | FAIL | 191 / 5 / 8 | `c8b7a465` |
| 8 | 1 | FAIL | 191 / 5 / 8 | `c8b7a465` |
| 9 | 1 | FAIL | 119 / 50 / 10 | `0b2aae26`（见 §6.3） |
| 10 | 1 | FAIL | 198 / 5 / 8 | `c8b7a465` |

**9/10 轮的失败集合逐条相同**——就是 §5 那 5 条范围外产品缺陷。run 之间的 `passed` 差异只来自
条件记账（同一条断言是否走到第二跳、是否触发失败分支的额外读数）。

### 6.2 定版之前的普查（同一套代码，修 flake 之前）

先跑过两轮各 10 轮，暴露并修掉 §10-4/§10-5 列出的问题；其中一轮的 run 8 与下一轮的 run 10 出现
`taps is not defined` 级联（32 条红）——那是**我在跑动中途改测试文件**造成的混合构建，
不是产品也不是最终构建的读数，因此不计入 §6.1，但记录在此：换构建必须在一轮跑完之后。

### 6.3 run 9 的定性与遗留

run 9 的 50 条红从**同一轮里两处互相独立的写没落地**起爆：

- GP-06：名单勾选与「确认仅处理这 2 人」的 12 步 UI 全部记 PASS，回读却是 `confirmed=0 / pending=2`；
- GP-11：`完成本程行驶` 同样点了、页面无红字（证据里 `页面红字:""`、`再点一次:false`），`legs.outbound.completed` 始终 null。

两处都是「命令发出去、服务端没效果、页面也没报错」，并且**该轮耗时 13 分钟**（其余九轮稳定在 ~8.5 分钟）。
合起来指向共享云环境在那段时间的写路径异常（同一套 `ot_*` 库还有别的链路在用），而不是产品逻辑或判据问题：
A 层与其余九轮的同一断言都是绿的。定性：ENVIRONMENT FLAKE（1/10 次）。

遗留的证据缺口：GP-06 当时没记面板的 `error/busy/selectedCount`，「命令被吞还是被拒」无法完全定案。
该读数已在十连跑之后补进代码（因此不计入本轮签名），下次真复现可一眼区分三种形态：`busy` 期间的空点击、
CONFLICT 被 `dispatchAndSync` 重读吞掉、以及云端写失败。这一轮没有被重试掩盖，也没有降级成 skip。

### 6.4 STABILITY 判定

- **失败集合稳定性：成立**。定版十连里 9 轮完全一致，且一致的那 5 条都在本阶段范围外。
- **整体 GREEN：未达成，也不应达成**。OVERALL 恒为 FAIL（GP-07 三条产品缺陷）；即便修掉它们，
  原生 `<picker>` 驱不动与单登录身份仍会让 4 个节点停在 INCONCLUSIVE（退出码 2）。
  「10/10 PASS」在当前平台与既定范围下不可达，这是事实陈述，不是放宽判据能消除的东西。
- 每轮都会在真实云端留下一场 `[GP·黄金路径] …·<tag>` 沙盒活动；走到归档的那轮会自动退出发现列表。
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

**环境纪律（Phase 3 用两轮垃圾读数换来的，务必照做）**：

1. **同一时刻只允许一个循环持有开发者工具会话。** 串接的链被 kill 时子循环不会死，它会和新起的循环抢同一个
   9420 端口，之后每轮读数都是垃圾（实测：编辑器 `.seg=0`、`page destroyed`、面板元素查无、大面积红）。
   看到「大面积红」先怀疑会话，不要怀疑产品，更不要拿它当产品结论。
2. 恢复手段只有 `cli quit` + `cli open`（`close` 不够）；`auto` 偶尔要等窗口起来，失败就再跑一次 `auto`。
3. 每轮开工前先跑 **`~/.ourtrail-e2e/preflight.js`**：首页装配 → 真点「发起活动」→ 编辑器三步齐全。
   体检不过就重启再来（最多三次）；三次仍不过该轮记 `ENV-ABORT`，绝不拿垃圾读数充当结果。
   `p3-stability.sh` 已把这三条写进循环。

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
3. ~~`workspace.js:111 onTab` / 面板 `phase` 陈旧~~ —— **Phase 3 已修**（§10）；
4. 7 处裸 `<checkbox bindchange>`（已进 `check.js` 白名单，只允许变少）——`editor.wxml:469/489` 优先，
   它挡住的是「发布时顺便给自己报名」；
5. ~~`field-panel.js:125` 对未上车拼车乘客仍提供「核实已随队出发」~~ —— **Phase 3 已修**（§10）。

修好 1/2 后，本套件的 8 条 `unv()` 里能立刻摘掉 2 条（车辆经 UI 创建、协作授权经 UI 授予）；
座号那条要等 §3-2 的裸 checkbox 修掉才能摘。

**测试侧 v2**：

- 原生 picker 的替代路径：若产品给时间/出行方式/路线节点加一个可点选的非 picker 入口（或允许 `picker-view`），
  GP-01/GP-08/GP-11 的 INCONCLUSIVE 可以摘掉；否则这三处永远只能记未验证；
- 双账号：报名 CTA 与审核分属两个身份，真正的「参与者视角全程」需要第二个可登录身份或真机；
- 覆盖面（§20 明确不在本轮）：`position.* / incident.* / notice.* / membership.revoke` 四条线端到端仍为零，
  `attendance.node` 的 UI 语义、`assignment.remove/swap`、`attendance.returnPlan` 同理。

**本轮该做而没做到的断言（记为缺口，不算已通过）**：任务书 §八 要求 Discover 节点核对「organizer 信息正确」，
而 GP-04 实际只断言了「列表里确有本场且 `phase=published`」「按标题命中卡片」「点卡片落到
`pages/activity/activity`」「详情标题与 `stateTitle` 正确」四项，**没有断言 `organizerIntro`**
（该字段就在详情页 data 里，`activity.js:279`）。补法是一行 `u(...)`；没有补的原因是没有跑第 11 轮，
不愿用一次未经十连跑验证的改动去替换已定版的构建。
**→ Phase 3 已补齐并按十连跑定版，见 §10-3。**

## 10. Phase 3 修复记录（2026-10-05）

任务书只给三件事：BUG-1 面板陈旧、BUG-2 出发核实死入口、BUG-3 Discover 身份链。三条都改的是**产品可达性**，
没有放宽任何断言，也没有为了让路径变绿而绕开控件。

### 10-1 BUG-1 面板停在旧 phase

- 根因：三个面板（`roster-panel` / `transport-panel` / `field-panel`）是「保持挂载、用类名隐藏」的
  （`workspace.wxml:27-31`，为的是保住搜索词/勾选/表单），它们只在 `attached` 与 `activityId` 变化时自读；
  `workspace.js:111 onTab` 切区只 `setData({tab})`，页面 `onShow/reload` 也不会通知面板 ⇒
  阶段变了，面板仍按旧 `phase` 装配弹层动作表。
- 修法（保留缓存 + 明确失效）：页面每次成功读到权威态后把 `phase@revision` 作为 `sync-key` 下发给三个面板；
  面板的 `syncKey` observer 只在**下发的键与自己上次实际读到的不一致**时才重读（`this._readKey` 记录后者），
  所以既不会停在旧阶段，也不会每次切区都全量重读（`loadState` 每次读 15 个集合，成本是真实的）。
  `revision` 是服务端 CAS 计数，任何一次写入都会推进 ⇒ 它就是权威失效信号，不是前端猜的。
- 文件：`miniprogram/pages/workspace/workspace.js`（data.syncKey + reload 内下发）、`workspace.wxml`（三处 `sync-key`）、
  三个面板各加 `syncKey` property + observer + `_readKey`。
- 验证：B 层「阶段推进后已挂载的现场面板随 syncKey 重读到新 phase」；GP-09 断言 `panelPhase=gathering`
  且重读后名单/弹层动作表是新的；GP-12 断言 closing 段同样自失效（不再靠「退出重进」绕过——绕过去就等于没测到机制）。

### 10-2 BUG-2 「核实已随队出发」的可达性

- 先答疑「这该由谁操作」：**权限上组织者就有资格**（`permissions.js:204` `owner || cap('checkin')`），
  车长（`cap('checkin')` 的车辆联络）也有；缺的不是角色而是**事实**——`field.js` 要求 joined 必须
  「已签到 +（拼车乘客且非参与者司机）去程已上车」，而上车入口在车长任务页（`attendance.board`）。
  所以既没有降低后端权限，也没有改 invariant，而是把按钮的**可见性**收到与服务端同一条规则一致。
- 修法：规则收敛成单一出处 `permissions.needsOutboundBoarding(state, signup)`，`field.js` 的 joined 门与
  `selectors.rowView` 的 `needsOutboundBoarding` 都读它；`field-panel.openSheet` 只在
  `row.checkedIn && !row.needsOutboundBoarding` 时才给「核实已随队出发」，`not_departed/coordinating`
  在已有上车事实时也不再给（那时服务端同样会拒）；被收掉的按钮配一句指路文案
  （缺签到 → 「请先完成现场签到」；缺上车 → 「请先在车长任务页点『确认上车』」）。
- 文件：`domain/permissions.js`、`domain/field.js`、`domain/selectors.js`、`components/field-panel/field-panel.{js,wxml}`、
  `trailApiLab` 的 domain 同步副本（`node tools/sync-lab.js`）。**需重新部署 trailApi —— 已部署，timeout 仍为 20 秒。**
- 验证：GP-10 断言未上车行「不再提供该按钮 + 文案指路」并回读 `departure` 仍 `unknown`（零副作用）；
  上车经车长页真实点击后，出发核实按钮出现、真实点击落库 `departure=joined`；B 层同理走「先补事实再点按钮」的真实顺序。

### 10-3 BUG-3 Discover 的精确身份链

补齐成链：`activity.create` 返回的 `AID` → 发现流里 `id===AID` 的活动恰好一条且 `phase=published`、
标题与 `organizerIntro` 等于 fixture 输入 → 按**渲染出来的标题文本**命中卡片，再用 `wx:for` 下标回读页面数据
证明那张卡的 `id === AID` → 卡片文案含服务端算出的 `owner` 标志「我组织的」 → 点卡落到
`pages/activity/activity` → 详情标题与 `organizerIntro` 等于 fixture → 云端回读 `activity.id === AID` 且
`activity.ownerId === read{profile}.profile.id`（本轮登录身份，即 `activity.create` 的下发者）。
期望值全部来自 fixture 与创建时的返回值，没有任何一处「读回来再当期望」。

### 10-4 顺带修掉的测试侧时序脆弱（不是放宽，是等权威态落地）

普查跑（修复后构建，10 轮）暴露三类，全部在代码里修掉而不是加重试：

| 现象 | 根因 | 修法 |
|---|---|---|
| 「第 1 次确认没生效：弹层仍开着且无红字」但 `phase` 其实已经推进 | 确认后页面要跑一次云端往返才 `setData(transitionOpen:false)`，固定 3 秒判读读到的是过渡态 | 判读改为轮询到「弹层关闭 或 出现红字」为止；两者都不来才记 FAIL |
| 「详情内容正确」读到 `title=""` | 点卡片后详情页自己异步读装配 | 轮询到 `loading=false && title` 非空再断言 |
| run 8 大面积红（32 条）：两位乘客只有一位 `outboundBoarded=true` | **逐人循环的自竞态**：下一轮的「还缺谁」用云端回读算，而上一次点击刚刚那条还没落库 ⇒ 同一个人被点两次，第二个人永远没点，`active` 之后整段推不动 | 每点一个人都等他本人的事实落库再算下一个缺口（签到/上车/出发核实/到家四段循环同改）；顺带去掉了「按点击次数封顶」的错误循环条件 |

另外把「按钮是条件绑定」这类空点击挡在前面：`phaseAdvance`、车页「确认上车」、编辑器「保存草稿」之前都先等
页面 `busy===false`（这些按钮在 busy 期间 `bindtap` 绑的是空串，点了什么也不会发生）。

还补了 3 条 A 层契约断言（A 层 62 → **65**）：`needsOutboundBoarding` 必须与 `field.js` 的 joined 门同向 ——
已上车的拼车乘客 `false`、参与者司机 `false`、已签到但未上车的乘客 `true`，且上车落库后翻回 `false`。
这条契约是 BUG-2 修复的地基：视图说错，界面上的按钮就会要么该有没有、要么不该有却有。

### 10-5 两处「oracle 本身错了」的修正（不是放宽）

1. **重复发布的零副作用判据**。原来比较的是**全局** `revision`，但 `revision` 是 `ot_meta/main` 上的单一 CAS 计数
   （`store.js:115`），这套 `ot_*` 集合被多条链路共用 —— 别人的一次写入就会把它推进，于是十连跑里出现
   「服务端确实拒了重复发布（`INVALID_INPUT`）、这场活动一点没变，但断言红了」。
   改成**逐字段比对这场活动的快照**（`JSON.stringify(v2.activity) === 发布后的快照`），比原来只比 `phase` 更强；
   全局 revision 的 before/after 仍然记进证据并标明「共享云 CAS 计数，不作判据」。
2. **「完成本程行驶」没落地时先读红字**。车页两个动作同样走 `dispatchAndSync`，CONFLICT 时产品只重读页面不代重发；
   原来的断言只回读 `legs.outbound.completed`，红字没进证据就成了无法定性的一条红。现在：落地失败就读页面红字，
   有红字则按用户的做法再点一次（两次尝试各自记账），最终读数把 `页面红字 / 再点一次` 一并写进证据。
