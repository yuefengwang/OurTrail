# FOLLOWUP_TASK_LEDGER — 遗留事项台账（2026-10-23）

字段口径按任务书 §4。证据优先级：本轮原始读数 > 本轮代码实测 > 历史报告（仅注明“历史”）。`挡合并` 指是否阻塞 `agent/ourtrail-night-ui-v2` 进入 master。执行模型：**Flash**＝限定文件的可验证实现；**强模型**＝需架构/归因/跨层方案；**人工**＝需授权、产品判断或物理设备。

## 1. 合并准入相关

| ID | 事项 | 证据 | 类型 | 影响 | 状态 | 挡合并 | 前置 | 决策责任 | 推荐行动 | 验收标准 | 执行模型 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FU-01 | 夜间证据与台账勘误 | 附件 `morning-review-2026-10-23/repository-facts.json`；MORNING §4–6 | 文档/测试 | 全站规划依据 | READY | **YES** | NONE | 技术负责人 | 按任务卡 FU-01 定点订正，保留历史并加勘误指针 | 错误判据/计数不再被引用；JSON 合法；diff 仅文档 | Flash |
| FU-02 | 最终代码定点补证（截图+DOM+样式+tap） | MORNING §4.1；`shot-night-v2-after.js:14-18` | 测试/工具链 | T011 三页 | BLOCKED | **YES** | D-01 | 技术负责人 | 授权会话后按 FU-02 清单复拍，隔离账号；产出版本映射与读数 | 版本可区分；18px/600 有样式读数；箭头不掉行；tap 开/关；零生产写入 | 强模型+人工 |
| FU-14 | 昵称字阶与长值输入验证 | `me.wxss:75`；`me.wxml:19-31`（input 可编辑、blur 自动保存） | 视觉/交互 | me 身份卡 | BLOCKED | **YES**（C2 一部分） | FU-02、D-01 | 设计负责人 | 验证 computed 18px/600、80 字可编辑不侵占统计带；**不要求**省略号 | 样式读数与可编辑性双证；邻区无覆盖 | 强模型+人工 |
| FU-03 | page2-gates 两条滚动断言时序竞态 | 源码 `tools/page2-gates-test.js:584,649,798-807`；本轮 98/0；临时日志分组不可证 | 测试 | 天气页门 | **DONE**（2026-10-23，已提交未 push） | NO | D-10 | 技术负责人 | 已改「setData 回调 + 在途请求」双信号；80ms 迟到响应牙齿；100/0 ×3 | 连续 N 跑稳定；变异注入能被抓 | 强模型 |
| FU-04 | m02 PV5 privacy 章节计数 | 本轮 `m02-class-scope-test.stdout.txt:50`；tools/privacy 未改 | 测试 | 静态门 | OPEN | NO | 无 | privacy owner | privacy 解冻后核对章节数或放宽判据（不得删章节换绿） | m02 到 66/0 或判据有出处 | Flash（解冻后） |
| FU-05 | trip2 66/10 存量红 | night-v1 preExistingRed；本轮回执未跑 | 测试 | 报名门 | OPEN | NO | 无 | 技术负责人 | 补 `wx.cloud` 桩，独立提交 | trip2 全绿且变异自证 | 强模型 |
| FU-06 | B 层 E2E 环境门（9420） | night-v1 与 AGENTS 常驻记录 | 测试 | 三套 UI E2E | OPEN | NO | D-01 | 集成负责人 | 与本轮 9425 驱动分层登记 | 三类结果语义不混档 | 人工 |

## 2. 通知与撤回（产品/架构前置）

| ID | 事项 | 证据 | 类型 | 影响 | 状态 | 挡合并 | 前置 | 决策责任 | 推荐行动 | 验收标准 | 执行模型 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FU-16 | 669 条通知的展示策略 | 仅历史截图；`store.js:109-175` 全量加载；`notices-page.js:64` | 业务/产品 | notices/anotices | **DONE**（2026-10-23，已提交未 push） | NO | D-02 | 产品 | 已按 B 落地：首屏 20 + 每次 20，只减渲染不减 DB 读 | 策略落地且无漏/重、无额外外呼 | 产品→Flash（分批）/强模型（分页） |
| FU-17 | 通知类型维度（Notice.kind） | `schema.js:308-311` 无 kind；`selectors.js` 普通投影裁掉关联 | 架构/业务 | 通知域 | **DONE**（2026-10-23，已提交未 push；已部署） | NO | D-03 | 产品+技术 | 已按 A 落地：七值封闭词表 + 写端赋值 + 历史 unknown | 跨角色投影一致；旧数据合法 | 强模型 |
| FU-18 | 通知排序与“未读在前”口径 | `notices-page.js:64` 仅 reverse；`PAGE_SPEC.md:13` 声称未读在前 | 业务 | notices | OPEN | NO | 无 | 技术负责人 | 核实 genId 排序假设；必要时改服务端显式排序 | 同秒/淘汰后排序稳定且有判据 | 强模型 |
| FU-15 | 位置撤回是否二次确认 | `me.js:542-553` 直接撤回；`field.js:43-46` 只置 revokedAt | 交互/产品 | me | **DONE**（2026-10-23，已提交未 push） | NO | D-04 | 产品 | 已按 A 落地：一次点击 + 行内后果说明，无确认弹窗 | 取消零命令、确认一次、失败复位 | 产品→Flash |
| FU-20 | 位置授权过期的文案/状态 | `selectors.js:457-461` 未检查 consentExpiresAt；行文案恒称“仍然有效” | 业务/视觉 | me | **DONE**（2026-10-23，已提交未 push；已部署） | NO | D-05、部署 | 技术负责人 | 已按 B 落地：保留行 + `expired` 标记 + 撤回；边界与有效位置同源 | 过期不印“有效”；到期边界有测试 | 强模型 |

## 3. 共享样式与列表

| ID | 事项 | 证据 | 类型 | 影响 | 状态 | 挡合并 | 前置 | 决策责任 | 推荐行动 | 验收标准 | 执行模型 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FD-01 | discover 三枚筛选控件 34px<44 | `discover.wxss:31`；`discover.wxml:36-38`；M-07 | 视觉/交互 | discover | READY | NO | NONE | 设计负责人 | 按任务卡改 `min-height:var(--touch-target)` | 命中高≥44；无布局回归；门禁绿 | Flash |
| FH-01 | home/discover 页头两对同形规则上收 | `home.wxss:16-17`、`discover.wxss:10-11`；各仅 1 个 wxml 使用点 | 视觉/架构 | 2 页 | READY（待批准） | NO | D-08 | 设计负责人 | 按任务卡加 2 个全局类并改名 | 计算值不变；旧类名 0 命中；净减 2 规则 | Flash |
| FH-02 | activity-card 信息行 4 行重复 | `home.wxss:11-12`、`discover.wxss:4-5`；全局 `app.wxss:313-315` | 视觉/架构 | home/discover+组件 | BACKLOG | NO | FH-01 | 设计负责人 | 单源化另立提交；不得与 FH-01 混包 | 影子改写两页同步；无视觉差 | Flash（后续） |
| FU-09 | cardMetrics 双拷贝 | `home.js:16-22`、`discover.js:27-33` | 架构 | 2 页 | OPEN | NO | utils 解冻 | 技术负责人 | 先定适配接口与对拍再合并 | 双份对拍逐字段相同 | 强模型 |
| FU-10 | article-images gap 与列宽 calc 两本账 | `activity.wxss:42-66` | 视觉/维护 | activity | OPEN（低） | NO | 无 | 设计负责人 | 单源化需设计确认；当前已注释登记 | 改 gap 时列宽同步有判据 | 强模型 |
| FU-11 | home/discover 第二行导语删除 | `discover.wxml:7-9`、`home.wxml:8-10` | 文案/产品 | 2 页 | **DONE**（2026-10-23，已提交未 push） | NO | D-06 | 产品 | 已按 B 落地：保持删除，空态与结果计数补 scope 说明 | 产品确认；空态覆盖 scope 语义 | 产品→Flash |

## 4. Editor 拼板缺口（不得按“无数据源”重做）

| ID | 事项 | 证据 | 类型 | 影响 | 状态 | 挡合并 | 前置 | 决策责任 | 推荐行动 | 验收标准 | 执行模型 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EDI-01 | 首步封面上传槽布局 | `content-editor.wxml` 顶部 `ce-cover-row`；`content-editor.wxss` 的 `ce-cover-thumb/empty`；`tools/content-editor-test.js` 三条结构门；证据 `evidence/edi-d07-2026-10-23/` | 视觉/业务 | editor | **DONE + 真机 VERIFIED**（2026-10-23，按 D-07 ①A；本批本地提交，未 push；IDE 模拟器 31/31 check，见证据包） | NO | D-07 | 设计+产品 | 已落地：封面槽上移到正文之前并补空态文案，仍只从正文图片里选、默认首张、可更换 | 结构门 3 条 + 组件套件 33/0；真机：空/有图两态、文档顺序 454.4<525.4、真实 tap「更换」打开选择层 | Flash |
| EDI-02 | Day 时间轴/人工行程 | `editor.js` 的 `scheduleRowsOf/routeDerivedOf`；`activity.js` 的 `RS.schedule` 映射；复用 `route-schedule.js`；证据 `evidence/edi-d07-2026-10-23/` | 业务/产品 | editor/activity | **DONE + 真机 VERIFIED**（2026-10-23，按 D-07 ②A 推算预览；本批本地提交，未 push；IDE 模拟器 31/31 check） | NO | D-07 | 产品 | 已落地：编辑器「节点日程」只读预览 + 详情页逐节点抵达时刻；无时间戳时不摆日程，不引入第二事实源 | `scenario-editor` 12 条 + `scenario-activity` 4 条覆盖三态；真机：0/+90/+195 分钟 → 第1天 08:00/09:30/11:15，编辑器与活动页 DOM 各 3 条 | 强模型 |
| EDI-03 | 装备 chips 增删交互 | `editor.wxml` 两组 chips+输入行；`editor.js` 的 `onEquipmentDraft/addEquipment/removeEquipment`；证据 `evidence/edi-d07-2026-10-23/` | 交互 | editor | **DONE + 真机 VERIFIED**（2026-10-23，按 D-07 ③A；本批本地提交，未 push；IDE 模拟器 31/31 check） | NO | D-07 | 设计负责人 | 已落地：chips 增删、空值/重复在录入端拦截，存储仍是换行文本（零 schema/零部署），`buildInput` 往返无损 | 组件/页面套件覆盖增删去重与 schema 严检；真机：真实 tap 添加 3→4、移除 4→3、重复提示一次，chip 76×44 | 强模型→Flash |
| EDI-04 | 活动公开/可见性开关 | `schema.js` Activity `visibility`；`selectors.js` 的 `activityView`/discover 过滤；`editor.{js,wxml}` 发布步「可见范围」；`smoke-test.js` §14b、`scenario-editor-test.js` §15 | 业务/权限 | editor/discover | **DONE（本地）**（2026-10-23，按 D-07 ④B；本地提交，**未部署、未 push、真机 NOT_RUN**） | NO | D-07 | 产品+技术 | 已落地：缺省 `discover` 保持现状；`link` 不进发现页（含创建者本人），凭 id/分享链接仍可打开；改回公开必须显式提交该键 | smoke 226/0（§14b 12 条：默认/隔离/详情可达/首页保留/改回/50 名额/非法值）+ scenario-editor 209/0（§15 9 条：默认/切换/草稿落盘/回读/提交键/结构门）；真机未跑 | 强模型 |
| EDI-05 | “发布后开放报名”勾选与实际不一致 | `activity.js:193,215-217`：草稿强制 false、发布强制 true | 业务缺陷 | editor | OPEN | NO | 产品确认语义 | 产品+技术 | 先确认复选框是否应控制发布结果 | 勾选值可预测；有回归 | 强模型 |
| EDI-06 | 路线缩略图/集合建议 | `editor.js:539-560,844-878` 已有轨迹与派生集合点 | 视觉 | editor | BACKLOG | NO | 设计规格 | 设计负责人 | 出缩略图规格后交 Flash；不造地点推荐 | 规格+三态截图 | 强模型→Flash |

## 5. 冻结、文档与工具链

| ID | 事项 | 证据 | 类型 | 影响 | 状态 | 挡合并 | 前置 | 决策责任 | 推荐行动 | 验收标准 | 执行模型 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FU-07 | 天气线冻结 | `AGENT_WORKFLOW_PROPOSAL.md:30`；T005/T012 blocked | 架构/产品 | weather×3 | BLOCKED | NO | 专项授权 | 产品+技术 | 只审计不重构；任何改动另立专项与门禁 | 授权书+范围+回归计划 | 强模型 |
| FU-08 | privacy 冻结 | 历史在途声明；当前无修改 | 业务 | privacy | BLOCKED | NO | 解冻决定 | 负责人 | 解冻后一并清 m02 PV5 | 解冻记录+门禁 | Flash |
| FU-12 | 采证驱动可移植与版本门 | 驱动仅在仓库外临时目录；现行新鲜度判据不唯一 | 工具链 | 全部视觉验收 | OPEN | NO | D-01 | 集成负责人 | 驱动入库（docs/tools 边界需批准）；版本标记用最终代码独有可观测差异 | 任意机器可复跑；版本可区分 | 强模型 |
| FU-13 | 像素级 diff 工具 | 仓库内无；本机图像库可用性未验证 | 工具链 | 视觉回归 | DEFER | NO | FU-12 | 技术负责人 | 版本/状态锁定后再评估；只作探测器 | 误报清单+遮罩策略 | 强模型 |
| TOOL-01 | AGENTS.md 门禁/页面计数同步 | AGENTS 计数历史多版；本轮未跑全量 | 文档 | 全仓 | OPEN | NO | 合并决定 | 集成负责人 | 合并后按实测更新 recount，不预先写 | 计数与实测一致 | Flash |

## 6. 与任务书 11 项必审事项的对应

1 昵称/长昵称 → FU-14；2 page2 → FU-03；3 撤回确认 → FU-15；4 通知分页 → FU-16；5 类型维度/kind → FU-17；6 页头上收 → FH-01（+FH-02）；7 editor → EDI-01…06；8 天气冻结 → FU-07；9 privacy 冻结 → FU-08；10 openDebt → FU-05/FU-09/FU-10/FU-11/FD-01/FH-01；11 Skills/工具缺口 → FU-12/FU-13 与 MORNING §8。

## 7. 状态口径

- **READY**：规格、白名单、验收、停止条件齐全，可交 Flash；仍需遵守任务卡的人工批准栏。
- **BLOCKED**：缺授权（D-01）、缺产品决策或处于冻结集；不得开始实现。
- **OPEN**：已确认存在，但归因/方案/负责人未闭合；允许只读调查，不允许“顺手修”。
- **BACKLOG**：方向成立但排在依赖之后；本轮不派发。
- **DEFER**：暂不投入，保留触发条件。
- **DONE**：实现与门禁已在 `win/ui-followup-batch2-20261023` 完成并登记 SYNC 2026-10-23；「已提交未 push」表示已落入该分支（`f9e24b5`；page2 为 `744d2f8`）但未推送；trailApi/trailApiLab 已于 2026-10-23 部署（线上包与工作树逐文件 diff 空）。
