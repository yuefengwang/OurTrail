# 创建活动收敛 · 真机证据（2026-10-21）

**环境**：微信开发者工具 / iPhone 12/13 Pro 模拟（390×844，window 390×753），SDK 3.8.12，AppID `wx1227a277a3f2f7ea`。共享 IDE 会话，按本轮约束只 `open` 重编译，未 `quit`/`close`；自动化端口按轮次重绑 9430–9436，断掉的那跑不计入判据。

**设计/字段清单**：`docs/superpowers/specs/2026-10-21-create-activity-simplification.md`。**部署**：`cloudfunctions/` 零改动，不需要重新部署 trailApi。

## 截图

| 文件 | 内容 |
|---|---|
| `01-editor-basic.png` | 步骤 01：四个短标签不换行；模板复制收成一行；路线库/GPX 入口与名称字段在首屏 |
| `02-content-typing.png` | 步骤 03：单 textarea 输入「周末轻徒步…」31 字 / 2 段；添加图片与字数计数 |
| `03-content-roundtrip.png` | 切到 01 再回 03：正文仍在，`textareaStillInDom=true` |
| `04-quick-route-sheet.png` | 路线库：真实账号 296 条；搜索「飞泉沟」→ 133 条匹配、渲染最近 40 条，提示在列表上方 |
| `05-publish-sheet.png` | 必填齐后的发布确认层：标题/时间/集合/人数摘要 + 可后补「路线名称/节点/风险」+ 参与勾选 |
| `06-editor-restored-content.png` | 种子本地草稿回填：三段文字恢复，步骤 03，底栏出现「发布活动」 |
| `07-editor-image-group.png` | 同一草稿的图片组：锚点「第 2 段后」、2 图、封面标记、`×` 删除、管理、封面更换 |
| `08-detail-top.png` | 真实云端 `[预演]` 草稿详情：实拍封面、标题、日期、人数 |
| `09-detail-intro.png` | 详情「介绍」：文字 2 段 → 双图 → 文字 1 段；推荐理由 |
| `10-detail-images.png` | 同一详情的图片与第三段（顺序与保存时一致） |

## 读数 JSON

- `readings.json`：步骤标签、建议时间、正文输入/跨步骤回填、路线库总数/搜索/限制；`focusedAfterTap=false`（automator 不触发 focus）。
- `editor-localdraft-readings.json`：本地草稿回填的 `bodyText`、`paragraphCount=3`、图片组 `anchor=2`、2 图、`effectiveCover`；发布确认层 `deferred` 三项。
- `detail-readings.json`：真实云端详情 `contentView` 3 块、`coverIsReal=true`、`autoSummary=''`、分区锚点不含不存在的「报名后/同行人」。
- `image-picker-readings.json`：IDE 模拟器 `wx.chooseMedia` 返回失败，组件显示「打开相册失败，请重试。」；未出现可选择文件的原生面板。

## 边界 / UNVERIFIED

1. **真实键盘焦点、中文输入法、键盘遮挡**：UNVERIFIED。automator 对组件内 `textarea.tap()` 不触发 `focus`（`bodyFocused=false`），只能证明 input 事件与内容回填。需真机/真实软键盘再验。
2. **原生相册选择器**：UNVERIFIED / ENV-ABORT。模拟器 `wx.chooseMedia` 失败，未出现原生面板；组件失败话术已显式上屏。上传、压缩、`checkImage` 的代码路径未改，回调由 `content-editor-test` 覆盖。
3. **多账号读图、分享卡 `imageUrl`**：未验。
4. **云端写入边界**：只创建/删除 `[预演]` 活动，上传图片在 `finally` 中删除；未改其它活动数据。删除活动时云存储文件已随引用清理（`STORAGE_FILE_NONEXIST`）。
5. **截图 06/07 的数据来源**：种子本地草稿（真实本地存储 + 真组件），不是云端行；云端 `content` 回填由 `detail-readings.json` 与真实 `[预演]` 活动读数证明。
