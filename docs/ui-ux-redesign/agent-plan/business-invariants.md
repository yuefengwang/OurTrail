# 业务不变量（business-invariants）

本夜所有 UI 任务的硬约束，均有源码/门禁依据（基线 e818e63）。违反任一条＝任务失败。

1. **状态词单源**：受管中文状态词只允许出现在 `utils/format.js` 与 `utils/journey.js`；WXML 不比较服务端枚举原文，只认 JS 派生布尔（铁律 22；门 `tools/journey-graph-test.js`）。
2. **并发契约**：`this.revision` + `dispatchAndSync` + `reload`；UI 不得绕过 `utils/api.js` 直调 `wx.cloud`（唯一调用点）。
3. **面板联动**：`roster-panel`/`transport-panel`/`field-panel` 的 `sync-key` 与 `written` 事件不得改（A2 §3）。
4. **权限呈现**：客户端只展示服务端 `permittedActions` 授权后的动作；不得因视觉调整让未授权按钮可见可点（铁律 21：`bindtap="{{cond?'':…}}"` 型假按钮禁止）。
5. **GPX 契约**：`time`/`ele` 往返不丢；无高程不画连续海拔曲线（A2；`utils/gpx.js`）。
6. **天气语义**：meteogram/cloud-field/OI/天相的算法与判读范围不动（铁律 25–35）；概率表述必须条件语气（铁律 12）。
7. **零金额**：不印支付金额、不做支付；费用仅渲染 `feeSummary/feeIncludes/feeExcludes/feeNote` 文本，空则整段隐藏。
8. **不虚构**：不新增搜索/推荐/评分/收藏/保险/认证等仓库不存在的能力（A2「严格禁止虚构」）。
9. **六态齐备**：每页正常/加载/空/失败/无权限/提交中 + 长文本 + 无坐标/无高程（适用时）不得因重构丢失。
10. **冻结集**：repository-audit §2 的 91 处未提交在途路径一律不修改；`tools/*` 存量只读，只允许新增测试文件。
11. **门禁**：`check.js`、`check-handlers.js` 必过；受影响 scenario 套件必跑；G10/class-scope/style-gates 全绿。
12. **平台坑**：`options` 单键、`usingComponents` 双向登记、overlay `pointer-events` 关闭态、canvas 2d 重测、safe-area（铁律 1–17）。
