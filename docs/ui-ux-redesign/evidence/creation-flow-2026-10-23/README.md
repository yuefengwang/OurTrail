# 活动创建全流程 · 真机取证（2026-10-23）

- 设计稿：[DESIGN.md](../creation-flow-2026-10-23/DESIGN.md)（选项 B 已实施，见 §12）
- 环境：微信开发者工具 **IDE 模拟器 306×660**（不是物理手机）
- 会话：`close --project 'D:\OurTrail' --port 33278` → `open` → `auto --auto-port 9426`（未 `quit` IDE）
- 驱动：仓库外 `%TEMP%/opencode/mp-auto/drive-creation-flow-2026-10-23.js`
- 读数：本目录 `report.json`（`ok=true`，A/B/C/C2 四组断言全过）

## bundle 新鲜度

重编译后页面自带本批才有的数据键与文案：`requiredGroups` / `autoPickupIds` / `templateConfirmOpen` /
`messageActionLabel` / `messageActionStep` / `draftRestored` 均在 `page.data()` 中；
屏幕上的「还差：活动名称、出发与报名时间、集合上车点。补齐后再发布。」「自动生成」
「活动已发布 / 分享给同行的人」只存在于本批代码。旧 bundle 不可能出现这些字样。

## 四组读数

### A 空表单发布预检（注入夹具）

- 夹具：**注入空白表单**（`page.setData` 后调页面真实 `updatePublishReadiness`），因为本机存着一份完整草稿，
  直接点发布不会缺项。注入没有替换任何判据，`onPublishIntent` 走的是真实 handler。
- `step = 0`；`failure = requiredMissingText = 「还差：活动名称、出发与报名时间、集合上车点。补齐后再发布。」`
- 像素层 `.callout.danger` 文本与数据逐字相同；`requiredGroups` 三组分别指向 `01 信息 / 01 信息 / 02 路线`。
- 截图：`A-editor-empty-preflight.png`

### B 自动集合点徽标（注入夹具）

- 夹具：同样注入空白表单，再走真实 `onDate` / `onTime` / `applyRouteSnapshot`。
- 自动生成 1 个集合点：`溪谷起点集合`，集合时间 = 出发前 30 分钟（2026-10-26 07:30），
  `autoPickupIds` 恰 1 个 true；文案动作 `messageActionLabel = 「去确认集合点」`、`messageActionStep = 1`。
- 收起编辑态后集合点卡上出现 `.badge`「自动生成」；像素截图可见。
- 真实调用 `onPickupTime(07:40)` 后，徽标消失、`autoPickupIds = {}`、卡片时间变 07:40（不再宣称自动）。
- 截图：`B-editor-auto-pickup.png`、`B2-editor-pickup-badge-cleared.png`

### C 发布成功闭环（真实已发布活动，owner）

- 活动：`activity-mv0q0bt305yaqe`「测试活动」——真实云端数据，**本轮未发布任何活动、云端零写入**。
- `reLaunch('/pages/activity/activity?id=…&published=1')`：
  `justPublished=true`、`isOwner=true`；首屏 `.button.primary` **恰 1 个**且文本为「分享给同行的人」；
  庆祝卡文案逐字为「活动已发布 / 把链接发到群里，同行的人就能报名。还没填的图文与风险，之后随时能补。」
- 截图：`C-activity-published-banner.png`

### C2 常规进入不庆祝（同一真实活动）

- 同一 id 不带 `published=1`：`justPublished=false`，页面内**没有任何**含「活动已发布」的 `.callout`；
  唯一的 `.button.primary` 是「进入工作台」，分享退回 text 权重。
- 注意：该活动状态卡本身也是 `.callout.success`（「行前安排已就绪」），所以判据按**文案**认领庆祝卡，
  没有拿类名当唯一证据。
- 截图：`C2-activity-normal-entry.png`

## 边界与副作用

- **A/B 是注入夹具**：空白表单由驱动注入，用于制造"必填缺项"和"从零生成集合点"两种状态；
  渲染与 handler 全部走仓库真实代码。C/C2 是真实云端活动。
- 本机草稿：驱动开始前快照 `ourtrail.drafts.v1`，结束时按快照还原（`report.json.draftSnapshotHad=true`，
  无还原错误）。B 用例期间的真实 `persistDraft` 写入已随之回滚。
- IDE 模拟器不是物理手机；本轮未验证真机手势、键盘与原生 picker。
- 未发布活动、未部署、未清理云端测试数据。
- 既有红（与本次无关）：`tools/m02-class-scope-test.js` **65/1**，唯一红为
  「PV5 四个章节标题…（5 个节点）」`privacy.wxml` 存量签名；已在 clean `git archive HEAD` 副本复现同款。
