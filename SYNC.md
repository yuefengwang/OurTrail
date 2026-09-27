# OurTrail 原型落地小程序 · 进度同步文档

> 多 agent 协同的工作同步文件。每完成一个里程碑更新一次。
> 原型：`docs/prototypes/ourtrail-app`（React+Vite 高仿真原型，含完整 domain 层）。
> 目标：把原型系统落实到 `miniprogram/` + `cloudfunctions/trailApi/`。

## 一、总体架构决策（已定，勿反复）

1. **domain 层移植到云函数**（CommonJS JS，去 zod，手写校验器）。
   原型的 33 种命令、权限（permissions.ts）、不变量（invariants.ts）、选择器（selectors.ts）、
   分车规划（allocation.ts）全部在服务端执行；客户端只发 `{payload, requestId, expectedRevision}`，
   服务端返回 AuthorizedView。这样保留原型的授权/幂等/并发语义（receipts + revision CAS）。
2. **持久层**：按集合、按记录存文档，集合名加 `ot_` 前缀（`ot_profiles`、`ot_activities`、
   `ot_groups`、`ot_signups`、`ot_vehicles`、`ot_assignments`、`ot_memberships`、`ot_attendance`、
   `ot_positions`、`ot_incidents`、`ot_events`、`ot_notices`、`ot_receipts`、`ot_routes`），
   另有 `ot_meta/main` 存 `{revision, savedAt}`。
   每次命令：事务内读 meta 做 revision CAS → reduce（内存中整个 State）→ diff 出变更记录 →
   事务内写/删对应文档 → revision+1。避免单文档 512KB 上限。
   旧集合（activities/signups/templates）不迁移、不读取，弃用。
3. **身份**：actor.userId = OPENID（服务端注入，客户端不可传）。
   Profile 首次读取时若无则返回空档案（客户端提示去「我的」完善），保存时才真正创建。
   协作授权（staff/vehicle_contact）的目标用户通过「身份码」（openid）传递：
   「我的」页展示身份码+复制，组织者粘贴进授权表单。
4. **云函数 API**（全部走 `trailApi`，响应 `{ok, data:{...}}` 或 `{ok:false, error:{code,message}}`）：
   - `read {request}` → `{view, revision, now}`（view=AuthorizedView，home 项附带 meta 汇总）
   - `readForm {activityId, signupId, purpose}` / `readTransport` / `readAccess` /
     `readNoticeManagement` / `readSensitive` / `readContact` / `readExport`
   - `previewAssignments {activityId}`
   - `dispatch {payload, requestId, expectedRevision}` → `{targetIds, replayed}`（服务端统一覆写
     evidence 的 at/by；requestId 幂等）
   - `getWeather {activityId, pointId, date}` → WeatherResult（复用真实 Open-Meteo 代理，非模拟）
5. **客户端不引入 domain 代码**。utils 提供 read/dispatch 封装、草稿（wx storage）、时间格式化。
   CONFLICT 时自动重读当前页。
6. **页面结构**（app.json + 自定义 TabBar：活动/通知/我的）：
   - pages/home（活动列表：我的/最近查看/已结束 + 需要我协作 + 搜索 + featured 卡）
   - pages/notices（通知 Tab）与 pages/anotices（活动内通知，同构复用 utils）
   - pages/me（我的：资料、常用同行人、位置授权撤回、身份码）
   - pages/activity（详情：hero、状态、操作、我与同行人、安排、路线、风险、装备、费用）
   - pages/signup（新报名/编辑报名；选择参与人、同行人、授权勾选、满员整组候补）
   - pages/editor（三步编辑器：内容时间/路线集合/招募风险 + 发布对话框 + 从我组织的活动复制）
   - pages/workspace（工作台：总览/名单/分车/现场；阶段推进对话框）
   - pages/staff（协作任务 = 头部 + Field 视角）、pages/vehicle（本车任务）
   - pages/weather（天气参考，真实预报）
   - pages/privacy 保留；privacy-popup 组件保留
7. **视觉**：tokens.css/app.wxss 移植（森林绿 #163E35 / 嫩叶 #D6EA8A / 纸面 #F5F5F0…），
   组件样式类全局化；图标用脚本生成 PNG（icon 组件引用）；sheet/dialog 用自绘遮罩组件。
8. **原生导航栏**代替 AppShell header；root 页在内容里放 page-title。
9. 分享用 onShareAppMessage（活动页）；导出名单改为复制到剪贴板（CSV 文本）+ 审计记录。

## 二、里程碑与状态

| # | 任务 | 状态 |
|---|---|---|
| M0 | 通读原型与现有实现 | ✅ 完成 |
| M1 | SYNC.md 建立本同步文档 | ✅ 完成 |
| M2 | 云函数 domain 移植 | ✅ 完成（smoke-test.js 40/40 通过） |
| M3 | 云函数持久层 + index.js 路由 + 天气对接 | ✅ 完成 |
| M4 | 设计系统：app.wxss + icon(SVG data URI) + custom-tab-bar | ✅ 完成 |
| M5 | 基础组件（icon/overlay/status-panel/person-row/form-field/activity-card） | ✅ 完成 |
| M6 | utils（api/draft/format/notices-page） | ✅ 完成（与并行 agent 汇合，api.js 采用其版本） |
| M7 | 页面 home / notices / anotices / me | ✅ 完成 |
| M8 | 页面 activity / signup | ✅ 完成 |
| M9 | 页面 editor | ✅ 完成 |
| M10 | 页面 workspace + roster/transport/field 面板组件 | ✅ 完成 |
| M11 | 页面 staff / vehicle / weather | ✅ 完成 |
| M12 | 静态校验（tools/check.js ALL PASSED）+ README 重写 + 旧页删除（index/create/manage） | ✅ 完成 |

## 三、关键文件清单（落点）

```
cloudfunctions/trailApi/
  index.js                  # 重写：路由 + 持久层 + read/dispatch/getWeather
  domain/schema.js          # 手写校验器（替代 zod）：str/num/bool/arr/obj/enum/union
  domain/model.js           # State 各集合 schema
  domain/permissions.js     # 由 permissions.ts 移植
  domain/invariants.js      # 由 invariants.ts 移植
  domain/commands.js        # dispatch + recordChange（事件/通知自动发布）
  domain/activity.js signup.js transport.js field.js profile.js notices.js
  domain/allocation.js selectors.js contracts.js（错误码/canonical）
  lib/weather.js            # 保留，另加 WeatherResult 适配
miniprogram/
  app.json app.js app.wxss  # app.wxss = tokens + 组件样式全局化
  custom-tab-bar/           # 自定义 TabBar
  components/{icon,sheet,dialog,status-panel,person-row,form-field,activity-card}/
  utils/{api.js,draft.js,format.js}
  pages/{home,notices,anotices,me,activity,signup,editor,workspace,staff,vehicle,weather,privacy}/
  images/icons/*.png        # 脚本生成
tools/gen-icons.js          # PNG 光栅化脚本（无第三方依赖，node 内置 zlib）
```

## 四、移植时要注意的语义细节（踩坑记录）

- `reduceCommand` 的 receipt 幂等：同 actor+requestId 重放返回 replayed；不同内容报 REQUEST_REUSED。
- 通知自动发布规则（recordChange）：publish/edit/transition→全体；signup.*、assignment.*→
  受影响人 + 因分车变化受影响的人；notice.read 不产生事件。
- 阶段推进门槛：published→gathering 需无 pending；gathering→active 需每人核实出发
  （实际出行者需签到+去程上车）；closing→archived 需全部到家且无未结异常；取消仅限出发前。
- 报名：整组占用名额；manual 模式 pending；automatic confirmed；满员需明确整组候补（waitlist）。
- 位置：每人一条最新上报，consentExpiresAt=活动 endAt，撤回后不可再看；>30 分钟算 stale。
- 敏感资料（紧急联络/健康备注）读取必须带用途；导出敏感名单先记审计（export.record）。
- structuredClone → JSON 深拷贝；crypto.randomUUID → genId；不要用 replaceAll（云函数 Node 兼容）。
- 时间一律北京时间（+08:00 ISO 字符串）；服务端 now 为准，客户端 evidence 只带 note。

## 五、验证方式（无微信开发者工具的环境）

- `node --check` 所有 JS；自写脚本校验 WXML 标签配平、WXSS 花括号配平、app.json 页面文件齐全。
- domain 层移植后跑冒烟脚本（node 直接调用 reduce/assertInvariants 的空状态/最小场景）。
- 视觉验收：本环境无法渲染小程序，依据 app.wxss/组件样式与原型 CSS 逐类比对自查。

## 六、变更日志

- 2026-09-25：建立文档；确定架构决策（domain 上云、ot_ 集合、TabBar 结构、页面清单）。
- 2026-09-26：云函数 domain 全量移植完成（13 个文件），持久层 store.js（按集合 diff + 事务 CAS）+ 新 index.js（11 个 action）完成；冒烟测试 40/40（profile→活动→发布→报名→审核→车辆→分车→签到/上车/出发/节点/位置/到家/归档全链路 + 幂等重放 + 越权拒绝）。
- 2026-09-26：技术决策补充——图标不生成 PNG，改用 **SVG data URI（base64）** 由 icon 组件运行时生成（保真原型 stroke 图标，支持任意颜色/尺寸）；`color-mix()` 在 WXSS 中不稳定，全部预算成字面量色值；datetime-local 用「日期 picker + 时间 picker」组合实现；evidence 的 at/by 由服务端 dispatch 统一覆写。
- 2026-09-27：全部页面落地完成（home/notices/anotices/me/activity/signup/editor/workspace/staff/vehicle/weather + 三个面板组件），与并行 agent 的 utils 版本汇合；服务端 home 视图补充 meta（owner/joined/staff/vehicle/confirmed/pending/positionRows）。旧页 index/create/manage 已删除；`tools/check.js` 静态校验 ALL PASSED（JS/WXML/WXSS/app.json/组件引用）；README 已按新架构重写。**遗留待真机验证**：微信开发者工具内编译运行 + 云函数部署后全流程联调（本环境无法渲染小程序）。
- 2026-09-27（联调排障）：首次真机联调出现「服务异常，请稍后再试」——定位为云端仍是**旧版 trailApi**（旧协议 error 为字符串，未知 action 返回 '未知操作：read'）。已加固 utils/api.js：兼容 error 字符串/errMsg、未部署时直接提示部署话术（NETWORK 分类）；app.json 移除全局 privacy-popup 注册（新页面未使用，消除按需注入警告；组件文件保留）。**下一步必须**：右键 cloudfunctions/trailApi →「上传并部署：云端安装依赖」。
- 2026-09-27（微信资料同步）：我的页新增微信资料同步——头像（open-type=chooseAvatar → 上传云存储 → profile.person.avatar，云存储 fileID）、昵称（input type=nickname 键盘点选）、手机号（open-type=getPhoneNumber → 新增云函数 action `getPhoneNumber`，服务端 openapi.phonenumber.getPhoneNumber 换码，无验证码，全盘信任）。Person schema 加可选 avatar(≤500)；normalizedPerson/personView/rowView/vehicleTask.passengers 透传 avatar；person-row 组件与 activity/field/roster/vehicle 各列表渲染头像。同步后姓名+电话齐全即自动 profile.save（免确认，轻量化）。注意：手机号快捷验证需小程序主体已认证并开通 phonenumber 权限，未开通时服务端返回可读提示，手填兜底。
