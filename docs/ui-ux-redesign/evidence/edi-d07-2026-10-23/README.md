# EDI-01/02/03 真机核验（2026-10-23）

**范围**：D-07 选项 A 的三项纯客户端改动——封面槽上移（EDI-01）、节点日程只读推算（EDI-02）、装备 chips（EDI-03）。**不含** EDI-04（可见性）与任何云端写入。

**环境**：微信开发者工具 IDE 模拟器（306×660），项目 `D:\OurTrail-ui-followup-20261023`，重编译流程 `close --project` → `open` → `auto --auto-port 9427`（未 `quit` IDE）。驱动脚本在仓库外 `%TEMP%/opencode/mp-auto/drive-edi-verify.js`。

**bundle 新鲜度自证**：屏幕上出现的「添加正文图片后自动使用第一张」「还没有建议携带清单。」与装备 chips 均为本批新增文案/结构，旧包不可能渲染；读数取自重编译后的同一会话。

## 读数（31/31 通过）

- **EDI-02 编辑器**：真实 `setForm({dt_start, points})` 派生出 3 行——`第1天 08:00 / 09:30 / 11:15`（轨迹时间差 0 / +90 / +195 分钟）；口径文案逐字命中「按轨迹记录的时间差与出发时刻推算抵达时间，日期已自动对齐。」；`scheduleSpanDays=1`；DOM 3 条 timeline 与数据一致（`edi02-editor-schedule.png`）。
- **EDI-02 活动页**：注入生产形状的 `points/scheduleBasis` 后，3 条逐点时刻与口径句同屏渲染（`edi02-activity-schedule.png`）；无时间戳时隐藏日程的分支由 `scenario-activity §1c` 覆盖。
- **EDI-03 装备**：编辑态 3 个 chip，**真实 tap**「添加」把 `防潮垫` 写入 `equipmentText`（3→4），**真实 tap** chip 把它移除（4→3）；重复项 `登山杖` 不入清单并提示「「登山杖」已在清单里。」；`chip` 实测 `76×44`，触控高度达标（`edi03-equipment-chips.png`）。
- **EDI-01 封面槽**：空态显示虚线占位「封面」+「添加正文图片后自动使用第一张」且无「更换」；有图态显示缩略图 +「默认用正文第一张图片」+「更换」；**真实 tap**「更换」把 `coverOpen` 置真并弹出「选择封面」层（`edi01a-cover-empty.png`、`edi01b-cover-sheet.png`）。封面行 `top=454.4` 早于正文 `top=525.4`，文档顺序与视觉顺序一致。

原始逐条读数见 `readings.json`（含每次 check 的 `ok/extra` 与截图字节数）。

## 证据口径

- **真实执行**：页面真实载入、`setForm` 真实派生、装备增/删/去重与封面弹层均为真实 tap 及其后果观测；chip 尺寸来自 `Element.size()`。
- **注入数据**：活动页因无对应云端活动，`points/scheduleBasis/标题` 为注入的生产形状数据；封面缩略图两态为组件 `setData` 注入（图片路径用仓库内 marker 资产）；编辑器日程的出发时间与节点时间戳为注入输入。注入只替换数据来源，渲染路径仍是仓库代码。
- **零写入**：全程未提交活动、未上传图片、未改动云端数据；驱动会先快照并在结束时还原模拟器的 `ourtrail.drafts.v1`（真实 tap 触发了 `persistDraft`）。
- **边界**：这是 IDE 模拟器不是物理手机；封面选择层只验证「打开」，未选择新封面（选择会改草稿）；活动页日程是注入渲染，不是真实云端活动的自然样本。

## 帧

| 文件 | 内容 |
|---|---|
| `edi02-editor-schedule.png` | 编辑器路线步骤：节点日程 timeline + 口径 + 不可手改提示 |
| `edi03-equipment-chips.png` | 编辑器发布步骤：必带 2 chip、建议 1 chip、两组录入行 |
| `edi01a-cover-empty.png` | 内容步骤：封面槽在正文之前，空态文案 |
| `edi01b-cover-sheet.png` | 有图态点「更换」打开的封面选择层 |
| `edi02-activity-schedule.png` | 活动详情：逐节点「第1天 08:00/09:30/11:15」与口径句 |
