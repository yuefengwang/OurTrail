# 创建活动收敛：极简优先、自动填充、图文编辑降负担

**日期**：2026-10-21 · **基线**：`8a4c2bf` · **范围**：`miniprogram/`（零 `cloudfunctions/` 改动，**不需要重新部署 trailApi**）

## 1. 目标与边界

普通领队的目标是**快速发起一次活动**，不是写公众号文章。本轮不新增业务字段、不改服务端契约，只做三件事：

1. 把「发布真正必需」与「可后补」拆开，非必填不阻塞；
2. 能由路线/GPX/时间规则得到的值自动带入，并明确标出来源；
3. 把图文编辑从「每段/每图一张常驻卡片」改成连续文字 + 图片组。

保留的底层能力：`content` 块数据结构、图片上传、`checkImage` 安全检查、封面引用、服务端保存、详情页图文展示、报名/工作台/路线库等既有链路。

## 2. 字段清单（审计后）

### 2.1 发布真正必需（服务端发布门，未放宽）

| 字段 | 说明 | 来源 |
|---|---|---|
| `title` | 活动名称 | 用户输入；可从路线名/GPX 文件名自动填，可改 |
| `startAt` | 出发时间 | 用户选择；可点「周六/周日 08:00」建议 |
| `endAt` | 预计结束 | 由出发自动估算（当天 +8h，跨天兜底 23:30），可改 |
| `deadlineAt` | 报名截止 | 由出发自动估算（出发前 1 天），可改 |
| `pickupPoints[]` | 至少 1 个集合点 | 名称/地址/集合时间；集合时间默认出发前 30 分 |

> 服务端 `domain/activity.js` 的发布门仍要求集合点**名称、地址、集合时间**完整；本轮没有放宽这项安全/履约约束。

### 2.2 自动获取（有明确数据来源）

| 值 | 来源 | 用户是否确认 |
|---|---|---|
| 标题 | 路线库路线名 / GPX 文件名 | 自动填入，可改；用户改过后不再覆盖 |
| 结束/截止时间 | 出发时间 + 固定规则 | 自动填入，可展开调整 |
| 集合时间 | 出发时间 - 30 分钟 | 自动填入，可改；改过后不再跟随 |
| 集合点名称/坐标 | 路线起点（真实名称/坐标） | 自动生成，地址留空等待用户补 |
| 路线名称/里程/爬升/节点/风险/轨迹 | 路线库详情或 GPX 解析 | 带入后可展开核对 |
| 建议装备/风险 | `gpx.suggestTrailInfo` 同一套规则（节点关键词 + 里程/爬升/天数） | 只填空字段，明确提示「按路线特征预填…建议」 |
| 人数上限 / 审核方式 | 默认 24 人 / 手动审核 | 默认值，可改 |
| 封面 | 正文第一张图（显式封面优先） | 默认，可换 |
| 详情事实摘要 | 时间 + 路线 + 集合点 | 仅在领队没写介绍时显示，并标注「根据活动信息自动整理」 |

### 2.3 可选 / 可后补（不阻塞发布）

图文正文、封面、一句话简介、组织者说明、推荐理由、领队/成行人数/风景/腐败指数、费用摘要/包含/不含、报名后须知、必带/建议装备、风险提示、路线名称/节点/难度/轨迹、人数上限与审核方式。

发布确认层逐项点名「这些还没填，发布后随时可补」，不静默跳过，也不拦路。

### 2.4 明确的用户确认点

- 自动标题：输入框上方标注来源，可直接改；用户改过后不再被后续路线覆盖。
- 常用时间建议：点一下才写入，不把「下周六」伪装成已定事实。
- 自动集合点：名称/坐标来自路线起点，地址留空并自动展开，必须由人补一句。
- 自动风险/装备：提示是「按路线特征预填的建议」，可核对修改；保存后按普通内容看待。
- 详情事实摘要：单独一行标注来源，不冒充领队手写介绍。

## 3. 步骤与快速路径

保留 4 步，但**重排 + 允许跳过**；四步不再是一条必须走完的表单，而是四块可独立进入的工作面：

| 步骤 | 内容 | 是否必走 |
|---|---|---|
| 01 信息 | 标题、出发时间、自动结束/截止、快捷路线入口 | 是（标题 + 出发） |
| 02 路线 | 路线摘要/详情、GPX/路线库、集合点 | 是（集合地址） |
| 03 介绍 | 连续正文、图片组、简介/推荐理由 | 否 |
| 04 发布 | 人数/审核、活动说明/费用、风险、装备 | 否 |

**快速路径**：01 填标题/点时间建议 → 02 地图选集合点或补自动集合地址 → 底栏在必填齐时直接变成「发布活动」→ 确认层点名可选缺口 → 发布。03/04 不必经过。

**底栏规则**：必填未齐时主按钮是「下一步」；必填齐后主按钮变「发布活动」，旁边保留「继续完善」。编辑已发布活动不出现发布按钮。

**减少的输入/点击**（相对改前）：

- 不再要求先建段落卡；正文一次连续输入。
- 图片一次可选多张形成一组；每张图不再默认带「设为封面」按钮。
- 路线名/里程/爬升/节点/风险由路线或 GPX 带入；集合点由起点自动生成，只剩集合地址要补。
- 结束/截止自动估算；集合时间自动取出发前 30 分。
- 「从我组织过的活动复制」从首屏大卡收成一行可展开入口。
- 路线库入口在步骤 01 就能用，不必先走到路线步骤。

## 4. 图文编辑器交互（`components/content-editor`）

底层 `content` 仍是 `{type:'text',text}` / `{type:'images',fileIds}` 交替块；服务端校验、上传、`checkImage`、封面引用、20 张上限全部保留。

新交互：

1. **一个连续 `textarea`**：空行分段，不再为每段生成卡片；`bodyText` 最长 20000。
2. **图片组**：一次 `wx.chooseMedia` 可多选（最多 9 张），形成一组；每组记录 `anchor = 第几段之后`。
3. **预览与删除**：缩略图直接显示，右上角 `×` 移除单图；「管理」按需展开「前移一段/后移一段/删除本组」，低频操作不常驻。
4. **封面可选**：默认正文第一张，需要时点「更换」在 sheet 里选；不再让每张图都处理封面。
5. **顺序稳定**：编辑已有内容时，把所有文本块拼回连续正文，图片组按原文段落数计算锚点；保存时按锚点重建交替块。文本块按 2000 字上限切分（服务端 `ContentBlock.text` 上限），同锚点连续图片组合并到 ≤9 张/组。
6. **上传闸门不变**：上传中禁用保存/发布/切步骤；未通过安全检查的图删除且不入组；reset 时补发 `busy:false`，避免宿主永久禁用。

## 5. 详情页

- 领队没写介绍时，用 `utils/activity-summary.js` 从时间/路线/集合点生成一句事实摘要，标注「根据活动信息自动整理」；有手写内容时不叠加。
- 分区锚点按实际存在的区块动态生成，避免跳到不存在的「报名后 / 同行人」。
- 实拍封面与氛围封面拆成两个 `image` 分支分别挂 `binderror`：避免旧 src 的 error 在回退后迟到、把刚换上的氛围图也判死；实拍失败 → 氛围图 → 纯色 hero。

## 6. 修改文件

- `miniprogram/components/content-editor/content-editor.{js,wxml,wxss,json}`
- `miniprogram/pages/editor/editor.{js,wxml,wxss}`
- `miniprogram/pages/activity/activity.{js,wxml}`
- `miniprogram/utils/activity-summary.js`（新）
- `miniprogram/utils/gpx.js`（`suggestForRoute`，复用 GPX 建议规则）
- `tools/content-editor-test.js`
- `tools/scenario-editor-test.js`
- `tools/scenario-activity-test.js`
- `tools/gpx-test.js`
- `tools/e2e-golden-path-test.js`（步骤序号；未跑）
- `tools/swx2-style-gates-test.js`（T7.11 结构选择器覆盖断言随新可点行更新）
- `tools/activity-summary-test.js`（新）
- `SYNC.md` + 本文件 + `docs/ui-ux-redesign/evidence/create-flow-2026-10-21/`

**不包含 / 未触碰**：`cloudfunctions/`、天气/天文/天相相关文件、其它人的未提交改动。

**提交边界**：`SYNC.md` 与天气线共用同一个文件，且其中仍有天气线未提交条目；本次提交只包含本任务文件、证据包与回归记录，`SYNC.md` 留给合并窗口一并提交，避免把别人的变更记到本提交名下。

## 7. 测试与证据

### 7.1 本轮实测（各脚本自报）

| 套件 | 读数 |
|---|---|
| `check.js` / `check-handlers.js` | 全过；死 handler 仍只有存量 `editor#onNumber` |
| `content-editor-test` | 30/0 |
| `content-view-test` | 14/0 |
| `activity-summary-test` | 13/0 |
| `gpx-test` | 62/0（含 `suggestForRoute` 3 条） |
| `scenario-editor-test` | 188/0（含快速创建、取消后迟到读取不覆盖） |
| `scenario-activity-test` | 159/0（含事实摘要、封面回退链） |
| `e2e-test` | 72/0 |
| `quick-create-test` | 65/0 |
| `journey-graph-test` | 15/0 |
| `e2e-client-cas-test` | 54/0，`bugs=1` 为既有 BUG-C2 |
| `e2e-permission` / `e2e-domain-negative` / `lifecycle-projection` | 96/0 · 86/0 · 132/0 |
| `scenario-discover` / `scenario-signup` / `scenario-workspace` | 36/0 · 106/0 · 114/0 |
| `ui-consistency` / `t4-e08` / `swx1` / `m02` | 17/0 · 41/0 · 45/0 · 66/0 |
| `page2-gates` | 一次 97/0；同一份「HEAD + 本轮文件」副本连续复跑出现 95/2 与 97/0 交替（干净 HEAD 一次 97/0）⇒ **既有测试时序抖动**，非本轮文件导致 |
| `swx2-style-gates` | 117/1；唯一红为 HEAD 已存在的 `pages/activity/activity.wxss L90 .highlight-dot font-weight:700`（第三档字重），不是本轮改动 |

**补充 E2E（2026-10-21 收尾，未受创建活动改动影响）**：33 个 headless 套件中 31 个 exit 0：`scenario-me 143`、`scenario-vehicle 57`、`scenario-notices 91`、`scenario-staff 25`、`scenario-lab 20`、`scenario-api 29`、`scenario-profile-gate 19`、`routes 75`、`route-profile 27`、`discover-filter 21`、`weather-brief 21`、`tasks 27`、`scenario-tasks 24`、`e2e-task 28`、`trailapilab 25`、`lab-dryrun 165`、`journey 155`、`e2e-fault-probe 34`、`e2e-revision-guard 16`、`meta-revision-guard 18`、`receipt-window 19(+2 INCONCLUSIVE)`、`failure-semantics 44(+2)`、`e2e-concurrency 50(+4)`、`e2e-interleave 67(+3)`、`e2e-panel-sync 40`、`e2e-release-gap 51`、`lifecycle-transitions 214`、`lifecycle-cancellation 71`、`lifecycle-allocation 109`、`lifecycle-concurrency 126`、`lifecycle-fuzz 47`。两个失败均已归属：`weather-resilience` 工作区 43/2、干净 HEAD 45/0（天气线并发改动）；`cold-start-work` 工作区与干净 HEAD 同为 8/2（createCollections=17 / reads=15，基线期望漂移，非本轮）。逐套记录见证据包 `e2e-regression.txt`。

**未跑**：`e2e-golden-path` / `e2e-ui` / `e2e-ui-state`（需开发者工具会话；本轮一次 golden-path 尝试挂起，按环境性停掉）；天气/天相全套件正被天气线 agent 修改，未重复跑。未跑全量 sweep，不编总数。

### 7.2 真实开发者工具证据

目录：`docs/ui-ux-redesign/evidence/create-flow-2026-10-21/`

| 截图 | 读数 |
|---|---|
| `01-editor-basic.png` | 四步短标签不换行；模板复制收成一行；第一步直接看到路线入口与标题 |
| `02-content-typing.png` | 单 textarea 输入 31 字/2 段；`parentContentFilled=true` |
| `03-content-roundtrip.png` | 切到 01 再回 03，正文仍是同一串，`textareaStillInDom=true` |
| `04-quick-route-sheet.png` | 真实账号 296 条路线；搜索「飞泉沟」→ 133 条匹配、只渲染 40 条，提示可见 |
| `05-publish-sheet.png` | 必填齐时的确认层：摘要 + 可后补「路线名/节点/风险」+ 参与勾选 |
| `06-editor-restored-content.png` / `07-editor-image-group.png` | 本地草稿三块内容回填：三段文字、图片组锚点=2、2 图、封面=第二张；`×` 删除、管理入口、封面更换可见 |
| `08-detail-top.png` | 真实云端草稿：实拍封面显示、标题/日期/人数 |
| `09-detail-intro.png` / `10-detail-images.png` | 云端 `contentView` 3 块：文字 2 段 → 双图 → 文字 1 段；推荐理由；封面为实拍 |
| `detail-readings.json` | `contentView` 3 块、`coverIsReal=true`、`autoSummary=''`、分区锚点不含不存在的「报名后/同行人」 |
| `editor-localdraft-readings.json` | `bodyText` 3 段、`groups[0].anchor=2`、2 图、`effectiveCover` 正确 |
| `image-picker-readings.json` | **原生相册在 IDE 模拟器不可达**：`wx.chooseMedia` 返回失败，组件显示「打开相册失败，请重试。」 |
| `readings.json` | `focusedAfterTap=false`、`bodyFocused=false`；输入值与跨步骤回填仍成立 |

## 8. UNVERIFIED / 剩余风险

1. **真实键盘焦点、中文输入法、键盘遮挡**：UNVERIFIED。automator 对组件内 `textarea.tap()` 不触发 `focus`（读数 `bodyFocused=false`），只能证明 input 事件和内容回填；必须在真机/真实软键盘上再验。
2. **原生相册选择器**：UNVERIFIED / ENV-ABORT。IDE 模拟器 `wx.chooseMedia` 直接失败，未出现可选择文件的原生面板；组件已把失败显式呈现。真实设备需验证多选、取消、相机、压缩与安全检查。
3. **多账号读图、分享卡图片**：UNVERIFIED（单账号，未截分享面板）。
4. **自动填充的持久来源**：标题/集合点/风险建议在保存后就是普通字段；仓库没有 `source` 字段。若以后要求「这条是系统建议」可追溯，需要新增可选 schema 字段（本轮不做）。
5. **自动集合点跨会话**：同一会话内改出发时间会跟随更新；重新打开页面后，自动生成的集合点若仍缺集合时间，不会再次自动跟随（`_autoPickupIds` 只在内存）。它仍会被发布门拦住，不会误发。
6. **路线库真实数据**：296 条、重复标题多；已加搜索 + 只渲染最近 40 条，但未做去重/分组。
7. **超长正文**：连续输入允许 20000 字，服务端总文本上限 20000 还包含简介/费用/推荐理由等；极端情况下保存会收到「活动图文内容过长」，客户端未预检。
8. **page2 门抖动**：同代码复跑 pass/fail 交替，干净 HEAD 也有同款；不作为本轮回归判据。`swx2` 的 1 条红是 HEAD 既有第三档字重。
9. **B 层 E2E 未跑**：`e2e-golden-path` 的步骤序号已更新，但需开发者工具；本轮一次尝试挂起，记 NOT_RUN。
10. **详情事实摘要未单独拍真机**：`scenario-activity` 已覆盖「无手写介绍 → 生成摘要 + 分区锚点」和「有手写介绍 → 不叠加」，但本轮详情截图用的是有正文的 `[预演]` 草稿，摘要没有单独像素证据。
11. **一次诊断性上传可能留下一个未引用的 45 KB 图片**：03:30 左右的一次 `upload timeout` 在取得 fileID 前结束，无法据此调用 `deleteFile`；成功创建的活动其图片均随 `activity.delete` 清理（回读 `STORAGE_FILE_NONEXIST`）。这是测试夹具留下的存储风险，不是业务数据。

## 9. 部署

`cloudfunctions/` 零改动；本轮**不需要重新部署 trailApi**。真实云端测试只创建/删除 `[预演]` 活动并清理上传文件，未动其它活动数据。
