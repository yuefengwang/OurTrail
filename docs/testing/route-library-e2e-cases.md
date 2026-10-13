# V2.0 路线库 · 真机 E2E 测试 Case Spec

- **状态**：v1（2026-10-13，功能落地当晚编写；驱动脚本 `tools/e2e-routes-test.js` 尚未实现，本文件是其施工图）
- **被测功能**：V2.0 路线库——`pages/routes`（列表）、`pages/route`（详情/共享/删除/分段天气）、`pages/route-edit`（创建/编辑/GPX 导入）、「我的」页入口、活动编辑器 `?routeId=` 预填、`route.create/update/delete` 与 `readRoutes`（云端）
- **与既有套件的关系**：领域层已由无头 `tools/routes-test.js`（68 断言）覆盖；本 spec 只覆盖**无头套件看不见的部分**——像素、原生 picker、overlay slot、地图渲染、文件选择器、真实云调用时序。实现时复用 `tools/e2e-ui-test.js` 的 harness（账本 `tools/e2e-result.js`、助手 `queryAll/tapEl/inputEl/cloudCall/open`），**不新造第二套驱动**。
- **必读**：`docs/testing/e2e-result-semantics.md`（四态结论/双维度）、`docs/e2e-mp/automation-playbook.md`（会话僵死/quit vs close/旧句柄/空按钮/一次性判读）。

---

## 一、驱动方式（HTTP 服务端口 + 自动化端口）

微信开发者工具提供两个可编程入口，本 spec 的分工与仓库既有实测一致：

| 层 | 通道 | 用途 | 本 spec 的用法 |
|---|---|---|---|
| 项目窗生命周期 | **IDE 服务端口（HTTP，默认 33278）**，经 `cli.bat` 或直接 HTTP 请求 | `open / close / quit / auto` | 每轮开始 `quit → open → auto` 保证模拟器跑的是**当前 bundle**（只调 `auto` 不重编译，会对着旧代码假绿——playbook §2） |
| 页面内交互 | **自动化端口（默认 9420）**，`miniprogram-automator`（WebSocket） | `reLaunch / $$ / tap / input / data / waitFor / evaluate` | 全部 UI 操作与断言 |
| 云端回读 | 小程序内 `wx.cloud.callFunction`（经 `miniProgram.evaluate` 注入） | BUSINESS 维度证据 |  fixture 建档、状态回读、清理 |

**已证实的教训（写进实现，不许绕）**：

1. **HTTP `/v2/auto` 与 `cli auto` 混用会互相重置自动化会话**——一轮运行只选一种，本 spec 选 CLI。
2. `cli.bat` 路径含中文，PowerShell 必须 `& '...'` 调用；`--project 'D:\OurTrail'` 必须加单引号（Git Bash 会吃冒号）。
3. 端口约定：服务端口 33278、自动化端口 9420（可由 `OURTRAIL_AUTO_PORT` 改绑；旧句柄"仍在 LISTEN 但连不上"时唯一救法是重绑新端口）。
4. **会话健康先于产品判读**：控制组探针（`$$('view')` 非空）不过 ⇒ 整轮 INCONCLUSIVE，不是 FAIL。

---

## 二、环境门（任一不过 ⇒ 本轮 INCONCLUSIVE，退出码 2，不计断言失败）

| 门 | 检查 | 不过时的归因 |
|---|---|---|
| G1 | `cli.bat` 存在且 `islogin` 返回 `{"login":true}` | 一次性人工前置未做（服务端口/扫码登录） |
| G2 | automator 连接 9420 + `systemInfo().SDKVersion` 非空 + 控制组 `$$('view')` > 0 | 会话僵死/端口被占，按 playbook §3 恢复后重试，三次不过 ENV-ABORT |
| G3 | **云端部署门**：`cloudCall('trailApi','readRoutes',{})` 返回 `ok:true`。若返回「未知操作：readRoutes」⇒ trailApi 未部署本功能 | 功能未部署；本 spec 的全部云端用例失去意义，必须整轮 INCONCLUSIVE（**不许**把部署缺失记成产品 FAIL） |
| G4 | 当前账号有落库档案（`read(profile)` 的 `person.name/phone` 非空）——`route.create` 的域层前置 | 先去「我的」补全（属另一旅程），或本轮只跑读取类用例 |
| G5 | 北京时间今天 ≤ 预报窗上限（今天永远在窗内；此门实际检查天气 provider 可达性，见 §六-H 组说明） | 天气组记 INCONCLUSIVE，其余组不受影响 |
| G6 | 测试数据卫生：列表中存在标题以 `[E2E]` 开头的路线 ⇒ 先跑清理（§五）再开工 | 上轮中断的残留；清理失败只出声不判红 |

---

## 三、安全边界（实现里是硬编码，不是口头约定）

1. **只写自己起的页面**：所有 UI 写操作只发生在 `pages/routes`、`pages/route`、`pages/route-edit`、`pages/editor`（且 editor 仅新建草稿，**不点发布**）。
2. **只删自己造的路线**：删除断言的目标路线，其标题必须以 `[E2E]` 开头且是本轮建档（fixture 返回的 id）。非 `[E2E]` 前缀的一律不碰。
3. **真实活动零触碰**：不 tap 任何真实活动的提交/保存/发布/取消；「用路线发起活动」只做到"草稿已保存"（toast/`savedId` 出现）即回退删草稿。
4. **fixture 建档走云端 dispatch**（语义文档 §5 允许的"测试环境恢复/建档"用途），不计入 UI 维度：`route.create` 带全量 points（含 coordinates/time/ele）、track、risks——地图/时间轴/分段天气/时刻推算因此有确定性数据，**不依赖 GPX 文件对话框**（`wx.chooseMessageFile` 会弹原生选择器，自动化驱动不了，见 §七）。
5. 每轮结束清理：删除本轮建档的全部 `[E2E]` 路线（先解除活动引用——本 spec 的草稿活动也在清理清单里）。

---

## 四、用例总表

维度：**B**=BUSINESS（云端回读/信封）、**U**=UI（真实操作+渲染观测）。门不过的组整组记 INCONCLUSIVE。

| ID | 用例 | 维度 | 依赖 |
|---|---|---|---|
| **A 入口与列表** | | | |
| RL-A1 | 「我的」页路线库入口可见且可点到 | U | G2 |
| RL-A2 | 列表渲染：标题/徽标/统计行/引用数/来源/保存时间 | U+B | G3 |
| RL-A3 | 空态：无路线时 status-panel empty 文案 | U | — |
| RL-A4 | 下拉刷新后列表与云端一致 | U+B | G3 |
| RL-A5 | 行点击进详情；返回后列表仍在（onShow 重读） | U | G3 |
| **B 创建（UI 写路径）** | | | |
| RL-B1 | 新建页打开：标题/里程/爬升输入框、GPX 卡、示例路线按钮 | U | G2 |
| RL-B2 | 空标题保存被拦（callout danger，未发命令） | U | G2 |
| RL-B3 | 手工建路线：填标题+加 2 节点+命名→保存→列表出现 | U+B | G3,G4 |
| RL-B4 | 节点未命名被拦（逐节点点名） | U | — |
| RL-B5 | 示例路线一键铺底 | U | — |
| RL-B6 | 里程/爬升入仓正确（BUSINESS 回读数值） | B | G3 |
| **C 编辑** | | | |
| RL-C1 | 详情→编辑：表单回填（标题/节点/里程） | U | G3 |
| RL-C2 | 改标题保存→详情与列表同步更新 | U+B | G3 |
| RL-C3 | 改节点类型（picker 起点/途中/终点）→保存→回读 kind | U+B | G3 |
| RL-C4 | 编辑保存后 `updatedAt` 刷新、`sharedWith` 不丢（fixture 路线带名单） | B | G3 |
| **D 详情与地图** | | | |
| RL-D1 | 指标行四值（公里/爬升米/节点/风险）与入参一致 | U | G3 |
| RL-D2 | 有坐标节点 ⇒ `.map-card` 渲染 + marker 数 = 有坐标节点数 | U | G3 |
| RL-D3 | 无坐标路线 ⇒ 地图卡不渲染（`wx:if` 门槛，不是空白卡） | U | G3 |
| RL-D4 | 节点时间轴：起点/终点 eyebrow、ele 展示、无坐标标注 | U | G3 |
| RL-D5 | 风险列表：标题+严重度徽标+应对 | U | G3 |
| RL-D6 | 轨迹存在时地图折线为实线（class/属性不可见，改判 marker 数与 `polyline` data 长度） | U | G3 |
| **E 共享协作（owner-only）** | | | |
| RL-E1 | 协作者身份下（fixture 无 sharedWith 的共享路线）管理区/共享卡/删除按钮**不可见** | U | G3 |
| RL-E2 | owner 视角：共享卡 + 添加按钮可见 | U | G3 |
| RL-E3 | 添加：sheet 打开→输入**不存在**的协作码→确认→红色 callout（服务端拒绝名单不存在） | U | G3 |
| RL-E4 | 添加：输入**真实存在的身份**（lab 种子账号 id）→确认→行出现+toast | U+B | G3, lab 种子 |
| RL-E5 | 取消共享：dialog 确认→行消失→回读名单为空 | U+B | RL-E4 |
| RL-E6 | 重复添加同一人被前端拦截（"已经共享给这位协作者"） | U | RL-E4 |
| **F 删除** | | | |
| RL-F1 | 删除未被引用的 `[E2E]` 路线：dialog→确认→navigateBack→列表消失 | U+B | RL-B3 |
| RL-F2 | 删除被活动引用的路线：CONFLICT callout（含活动数）留在页面上，dialog 不关 | U+B | fixture |
| RL-F3 | 删除后活动详情仍正常（快照不受影响）——活动页路线卡可开 | U | RL-F1 前 |
| **G 一键发起活动** | | | |
| RL-G1 | 详情「用这条路发起活动」→编辑器 banner「已从路线库带入」 | U | G3 |
| RL-G2 | 表单已带入：路线名称/节点/里程/爬升/轨迹（page.data 读 form） | U | G3 |
| RL-G3 | 补齐时间/人数/集合点→保存草稿→活动创建成功 | U+B | G3,G4 |
| RL-G4 | BUSINESS：活动 `routeId` = 路线 id；`routeSnapshot` 是**入参副本**（fixture 路线随后改名，快照不动） | B | G3 |
| RL-G5 | 编辑器改动路线字段→保存→**路线库里的路线不变**（域层快照隔离） | B | RL-G3 |
| RL-G6 | 协作者视角无「用这条路发起活动」按钮（域层会拒，UI 先不给） | U | RL-E1 |
| **H 分段天气** | | | |
| RL-H1 | 进详情自动查当天：每个有坐标节点一行（日期/天气短语/温度/降水/风） | U | G3,G5 |
| RL-H2 | 无坐标节点行显示「这个节点没有坐标，查不了天气」 | U | fixture |
| RL-H3 | 改日期（原生 date picker）→各行目标日期随之变化 | U+B | G3 |
| RL-H4 | 勾选「按出发时刻推算」→出发日期/时间 picker 出现→各节点徽标显示「第N天 HH:MM」 | U | fixture 带 time |
| RL-H5 | 推算模式下无 time 的节点回落统一日期（文案：轨迹没记时间的节点用上面的统一日期） | U | fixture |
| RL-H6 | provider 不可用/超窗：行内明确文案（「超出了 14 天预报窗口」/「天气查询失败」），**不白屏不转圈** | U | — |
| **I 旧路线兼容（存量数据）** | | | |
| RL-I1 | 经"活动创建"沉淀的旧路线（无 source/visibility/updatedAt/sharedWith）：列表显示「活动沉淀」「早期路线」、可读可编辑 | U+B | G3 |
| RL-I2 | 旧路线编辑保存后补齐资产级字段（BUSINESS 回读） | B | RL-I1 |
| **J 会话与恢复** | | | |
| RL-J1 | 编辑页异常退出（navigateBack 不保存）→重进恢复本机草稿 | U | — |
| RL-J2 | CONFLICT 路径：两页面各持旧 revision 时后写者被拒并自动重读（可用 cloudCall 抢占 revision 制造） | U+B | G3 |

> 合计 46 条（A5 + B6 + C4 + D6 + E6 + F3 + G6 + H6 + I2 + J2）。其中 BUSINESS-only 5 条（B6/C4/G4/G5/I2）、纯 UI 27 条、UI+B 混合 14 条；依赖 lab 种子或第二身份的 2 条（RL-E4 的协作者侧、RL-E1/G6）允许首轮记 `uiUnverified` 并在 verdict 里写明原因。

---

## 五、fixture 与清理（云端建档，确定性数据）

```
建档（每轮开始，cloudCall trailApi dispatch，expectedRevision 取 globalRev()）：
  F1 [E2E]完整路线   route.create：title='[E2E]完整路线'、distanceKm=12.5、ascentM=800、
                     points=[起点(有坐标+time+ele), 垭口(有坐标+time+ele), 终点(有坐标)],
                     track=[≥2 个 {lat,lng}]、risks=[高危(high)+留意(low)]
  F2 [E2E]无坐标路线 route.create：points 全部 coordinates=null ⇒ 测 RL-D3/RL-H2
  F3 [E2E]被引用路线 route.create 后接 activity.create{routeId:F3} ⇒ 测 RL-F2/F3
  F4 [E2E]已共享路线 route.create 后 route.update{sharedWith:[lab 种子 id]} ⇒ 测 RL-E1
  F5 [E2E]无时间路线 route.create：points 有坐标无 time ⇒ 测 RL-H5
清理（每轮结束，finally）：删除本轮全部 [E2E] 路线与被引活动（先删活动再删路线，
  顺序反了会撞 CONFLICT——这正是 RL-F2 要证的业务规则）
```

- 标题前缀 `[E2E]` 是清理判据；**清理用 dispatch 不用 UI**（快，且不依赖会话存活）。
- lab 种子账号：`cloudCall('trailApiLab','seed',{})` 产生的 `u-lab-*` 有落库档案，可作为"真实存在的身份"通过 `sharedWith` 校验；拿不到时 RL-E4 降级为 RL-E3 的错误路径并记 uiUnverified。

---

## 六、逐组详述（步骤 → 预期 → 归因）

### A 入口与列表
- **RL-A1**：`reLaunch('/pages/me/me')` → `$$('.list-row')` 按 `el.text()` 含「路线库」命中一行 → `uiTap`。预期：跳转 `/pages/routes/routes`（`page.path` 或页面标题「路线库」）。归因：入口绑定/BUG-C1 无关。
- **RL-A2**：fixture 后 `reLaunch('/pages/routes/routes')` → 轮询 `data.loading===false` → `$$('.list-row')`。预期行文本含：标题 `[E2E]完整路线`、统计串 `12.5 km · 爬升 800 m · 3 节点 · 2 风险`、`被 1 个活动使用`/`还没有活动使用`、`GPX 导入`/`手工整理`/`活动沉淀`、`保存于 MM-DD`。BUSINESS：`cloudCall('trailApi','readRoutes',{})` 条数、字段与屏幕逐条对得上。
- **RL-A3**：空库时（清理后）`status-panel` 组件 `kind=empty`、标题「路线库还是空的」。用清理后的瞬时窗口测，或接受"本账号至少 1 条"时跳过并记原因。
- **RL-A4**：`page.callMethod('onPullDownRefresh')` 不可靠（真机下拉）⇒ 用 `miniProgram.reLaunch` 重进代替下拉，比较两次列表文本一致 + 云端 revision 未变时读数不变。
- **RL-A5**：点首行 → 详情页；`navigateBack` → 列表 `onShow` 重读完成（`loading` 落位）且行仍在。

### B 创建
- **RL-B1**：`/pages/route-edit/route-edit` → `.input[data-key=title]` 存在；`.button.primary.block` 文案「导入 GPX 轨迹」；「用示例路线」按钮（无节点时才出现）。
- **RL-B2**：不填标题点 `sticky-action` 保存 ⇒ `.callout.danger` 文案含「先给这条路线起个名字」；BUSINESS：`readRoutes` 条数不变（**命令未发出**——这条同时证明客户端门不是摆设）。
- **RL-B3**：填 `[E2E]手工路线` → 点「添加路线节点」×2 → 展开首节点输入名称 → 保存。预期：toast「路线已入库」+ 600ms 后 navigateBack + 列表出现该行。BUSINESS：回读 title/pointCount=2/visibility=private。
- **RL-B4**：只加节点不命名 → 保存 ⇒ callout 含「还有路线节点没有名字」。
- **RL-B5**：空表单点「用示例路线」⇒ form.points 长度 2、routeTitle 落默认值（page.data 读 form）。
- **RL-B6**：里程/爬升输入 `7.5`/`300` → 保存 → 回读 `distanceKm=7.5`、`ascentM=300`（Number 边界：空值存 0 不算错，与 schema 一致）。

### C 编辑
- **RL-C1**：详情(F1) →「编辑路线」→ `.input[data-key=title]` 值 = `[E2E]完整路线`；节点行数 = 3；里程框 = `12.5`。
- **RL-C2**：改名 `[E2E]完整路线·改` → 保存 → 详情标题/列表行同步；回读 title 变更、`updatedAt` 晚于建档值。
- **RL-C3**：展开节点 2 → kind picker 选「终点」→ 保存 → 回读 `points[1].kind='finish'`；详情时间轴该行 eyebrow 变「终点」。
- **RL-C4**：F4（带名单）编辑保存 → 回读 `sharedWith` 仍含种子 id、`visibility='shared'`（**全量替换语义的回归点**：表单漏带名单就会清空）。

### D 详情与地图
- **RL-D1**：`.metric-value` 四个文本依次 `12.5 / 800 / 3 / 2`（与 F1 入参一致；缺的项显示 `—`）。
- **RL-D2**：`.map-card` 存在；`page.data().map.markers.length === 3`（F1 三个节点全有坐标）。
- **RL-D3**：F2 ⇒ `page.data().map.visible === false` 且 `.map-card` 查询为 0 个（`wx:if` 门槛把组件挡在 DOM 外，不是渲染了空白卡）。
- **RL-D4**：`.timeline-item` 三行；首行 eyebrow「起点」、含 ele 的节点显示 `xxx m`；F2 的行显示「无坐标」。
- **RL-D5**：风险区两行：高危行有 `.badge.danger`「高危」，留意行 `.badge.neutral`「留意」，副文本是 advice。
- **RL-D6**：`page.data().map.polyline.length === 1` 且 `points.length >= 2`（实线轨迹）；F2（无轨迹多点）为虚线分支（`dottedLine` true）——data 层可判，像素不判。

### E 共享协作
- **RL-E1**：以当前账号打开 F4 的**协作者视角**不可直接造（单身份）⇒ 实现方式：`cloudCall` 直读 `readRoutes(F4)` 不是 UI。**首轮记 uiUnverified**（原因：单账号通道只有一个登录身份，协作者视角需要第二台设备/第二个 openid）；UI 侧只验证 owner 视图（RL-E2）。若后续有第二身份：共享路线打开后 `.button.danger.block`（删除）与共享卡查询为 0。
- **RL-E2**：owner 开 F4 ⇒ 共享卡可见、卡头「添加」按钮在；非 owner 时才隐藏的「用这条路发起活动/编辑/删除」在 owner 下可见（isOwner 投影正确）。
- **RL-E3**：点「添加」→ overlay sheet（`overlay` 组件的 slot 内容**从宿主页面作用域查**，playbook §5）→ input 输入 `not-a-real-openid` → 「确认共享」⇒ `.callout.danger` 出现（文案含服务端拒绝语义「路线共享名单无效」）；BUSINESS 回读名单不变。
- **RL-E4**：输入 lab 种子 id → 确认 ⇒ toast「已共享给 …」+ 行出现（`.code-text` 缩略码）+ 回读 `sharedWith` 含该 id。
- **RL-E5**：点该行「取消」→ dialog「取消共享」→「确认取消共享」⇒ 行消失 + 回读名单为空。
- **RL-E6**：对已在名单的 id 再添加 ⇒ callout「这条路线已经共享给这位协作者了」（**前端短路，不打云端**——回读 revision 不变可证）。

### F 删除
- **RL-F1**：F1 引用解除后（或 RL-B3 建的路线）详情 →「删除这条路线」→ dialog → 确认 ⇒ navigateBack；列表行消失；回读 NOT_FOUND。
- **RL-F2**：F3（被活动引用）删除 ⇒ `.callout.danger` 文案含「1 个活动」；路线仍在（回读 ok）；dialog 保持打开（**错误不赶客**）。
- **RL-F3**：RL-F2 后打开该活动 ⇒ 路线卡/地图/时间轴照常（快照隔离的 UI 侧证据）。

### G 一键发起活动
- **RL-G1**：详情「用这条路发起活动」⇒ 编辑器打开，`.callout.info` 含「已从路线库带入『[E2E]完整路线』」。
- **RL-G2**：`page.data().form`：`routeTitle` = 路线标题、`points.length` = 3、`distanceKm` = `'12.5'`、`track.length` ≥ 2。
- **RL-G3**：补出发/结束/截止（picker 各选一次）、人数、1 个上车点 → 「保存草稿」⇒ toast/`savedId` 非空；**不点发布**。
- **RL-G4**：BUSINESS：`read({kind:'activity'})` 该活动 `routeId` = F1.id；随后 `route.update` 把 F1 改名 ⇒ 活动 `routeSnapshot.title` **不变**（冻结快照）。
- **RL-G5**：BUSINESS：编辑器里改节点名保存后，`readRoutes(F1)` 的对应节点名**不变**（活动编辑不反写路线库）。
- **RL-G6**：协作者视角无该按钮——同 RL-E1，首轮 uiUnverified。

### H 分段天气
- **RL-H1**：进 F1 详情（不操作，等 `weatherBusy` 落 false）⇒ `.list-row`（天气卡内）每行文本匹配 `日期 · 短语 · tMin~tMax°C · 降水 xmm（y%）· 风 z km/h`；行数 = 有坐标节点数。
- **RL-H2**：F2 ⇒ 行文本「这个节点没有坐标，查不了天气」。
- **RL-H3**：点日期 picker 选明天 ⇒ 各行 `targetDate` 变为明天（page.data 读 `nodeWeather`）；BUSINESS 不复核（provider 缓存 30 分钟，回读无增量信息）。
- **RL-H4**：勾选「按出发时刻推算」⇒ 出发日期/时间 picker 出现（默认今天 08:00）⇒ 有 time 的节点徽标「第1天 HH:MM」（与 `route-schedule` 单测期望一致的时刻）。
- **RL-H5**：F5 ⇒ 无 time 节点无徽标、回落统一日期；说明文案可见。
- **RL-H6**：网络故障时（可拔网或等 provider 抖动）行内「天气查询失败」且 `weatherBusy` 落 false——**不允许永久转圈**。provider 抖动属环境：该条记 INCONCLUSIVE 并写明，不算产品 FAIL；但「查询中…」水恒在就是产品缺陷（FAIL）。

### I 旧路线兼容
- **RL-I1**：fixture 前先 `activity.create`（不带 routeId，完整路线快照）⇒ `persistPrivateRoute` 沉淀旧路线 ⇒ 列表该行徽标「活动沉淀」+「早期路线」+ 统计正常；详情可开、可编辑。
- **RL-I2**：编辑保存 ⇒ 回读补齐 `source='copy'`、`visibility='private'`、`updatedAt` 非 null（旧路线迁移的 UI 侧证据）。

### J 会话与恢复
- **RL-J1**：编辑页填一半 → navigateBack → 重进 ⇒ 草稿恢复（`form.title` 保留）；保存成功后草稿清除（再重进为干净表单）。
- **RL-J2**：打开编辑页后，用 `cloudCall` 抢先发一条 `route.create`（推进 revision）→ 页面点保存 ⇒ callout 含 CONFLICT 语义且页面自动重读（`reload` 后表单为服务端值）。**注意**：这条会真实推进 revision，放在每轮末尾跑。

---

## 七、明确不覆盖（首轮记 uiUnverified / INCONCLUSIVE，不假装通过）

| 项 | 原因 | 记法 |
|---|---|---|
| GPX 文件选择全链路（`wx.chooseMessageFile` → 解析 → 应用） | 弹原生文件选择器，automator 驱动不了；隐私接口在开发者工具还可能因未声明scope直接失败 | `uiUnverified`，理由写"原生文件对话框不可自动化"；解析逻辑由无头 `gpx-test` 覆盖 |
| 协作者视角（第二身份看共享路线、无 owner 按钮） | 单账号通道只有一个登录身份 | `uiUnverified`；RL-E1/G6 的 owner 侧照常验 |
| 手机号授权等微信能力按钮 | 开发者工具不支持/需真机 | 沿用既有套件口径 |
| 地图像素（marker 图标/折线颜色） | 只判 data 层结构与渲染存在性；像素归截图 Evidence | `L.u` 不强求像素 |
| 天气数值正确性 | 属天气模块既有套件与 provider 契约 | 本 spec 只验"展示结构 + 失败面" |

---

## 八、判读与输出

- 权威结论是 `==== VERDICT ====` 块（BUSINESS / UI / OVERALL + reason），不是 `passed=N`。
- UI 的每条 PASS 必须先有一次成功的 `uiTap`/`uiInput`，其后的 `uEffect` 才算用户路径证据；纯渲染读数用 `L.u`。
- G1–G6 任一不过 ⇒ `L.env` 中断，OVERALL=INCONCLUSIVE，退出码 2。
- 云侧代做被测动作（如用 dispatch 代替 UI 保存）只能计 BUSINESS，UI 侧必须显式 `uiUnverified`，OVERALL 不得为 PASS。
- 建议输出落盘：`~/.ourtrail-e2e/shots-routes/*.png`（仅 Evidence）+ 一行 `routes-e2e: passed=N failed=M` 供门禁链兼容。

## 九、实现索引（驱动脚本 `tools/e2e-routes-test.js` 施工顺序）

1. harness 复用：`require('./e2e-result')` + 从 `e2e-ui-test.js` 抄结构（**抄结构不抄断言**：源码完整性自检 `auditSource` 必须过）。
2. 环境门 G1–G3 → fixture §五 → A→B→C→D→E→F→G→H→I→J 顺序（J 放最后，它会推进 revision）。
3. 清理放 `finally`：先删活动再删路线。
4. 选择器一律 `$$`；每轮操作前按 `data-id`/文本重新查询，不缓存元素数组（playbook §6 坑 1）。
5.  overlay 内容从宿主页面作用域查（坑：从 overlay 元素往下查是 0 个）。
