# 活动图文发布 · P2/P3 真机渲染证据（2026-10-21）

- 环境：微信开发者工具模拟器 306×660；`cloud1-d9ghcm034574b9d55`；bundle 已 `close` + `open` 重编译（新文案「图文详情」「报名后须知」在屏上自证）。
- 方式：生产 `trailApi` 建一条**真实草稿活动**（真实云存储图片 2 张、正文 3 块、封面=第 2 张），用 automator 打开真实编辑器与真实活动详情页截图；验完 `activity.delete` 删除草稿，服务端引用计数清理两张图。
- 测试标题：`10.24-25 | 测试图文活动：山脊与云海`（草稿，未发布；验收后已删除）。

## 截图

| 文件 | 内容 |
|---|---|
| `editor-content.png` | 编辑器四步标签（01 内容 / 02 图文 / 03 路线 / 04 招募，单行不换行）；图文步骤不再重复标题；段落块与工具栏 |
| `editor-content-images.png` | 图片块 2 张按**两列**排（与详情页一致）；「设为封面/封面」「移除」「添加图片」；第三段 |
| `editor-fields-top.png` | 第 4 步标题「名额、说明与费用」；人数上限/审核方式；「活动说明」卡入口 |
| `editor-fields-mid.png` | 腐败指数 1–3 选中；费用摘要；费用包含/不含；报名后须知 |
| `editor-fields-facts.png` | 费用不含与报名后须知下半段；风险提示区衔接 |
| `activity-hero.png` | 详情页 hero 用**实拍封面**（真实云文件），标题/难度/路线/里程爬升/人数 |
| `activity-intro.png` | 活动介绍：导语、两段正文、双图两列、第三段、推荐理由要点 |
| `activity-facts.png` | 活动说明 fact card：时间/集合/人数（15–30）/领队/强度/风景/腐败星级/费用/报名后 |
| `activity-fee.png` | 费用摘要、费用包含/不含、费用说明、取消约定、「OurTrail 不收款」、封面脚注「封面与正文图片由组织者提供。」 |
| `activity-signup.png` | 「报名后 / 进群与行前准备」与报名后须知 |
| `editor-full-4steps.png` | 4 步全流程拼接长图（360×7372；真实草稿 + 真实云图，截后已删草稿/路线/图片） |

## 读数

- 编辑器：`stepLabels.length=4`；`form.content.length=3`；封面 = 第 2 张实拍；`denied=''`、`loading=false`。
- 图文组件：`blocks=3`；`coverFileId` 命中；图片块共 2 张。
- 详情页：`contentView=3`；`contentImages=2`；`coverIsReal=true`；导语为测试文案；`denied=''`。
- 删除：`activity.delete` 返回新 revision 5622；随后对两张图的 `checkImage` 都返回 `{pass:false,reason:'read_failed'}` ⇒ 服务端引用计数清理在真实请求链路里生效。
- 测试数据无残留：草稿已删除，图片已删；编辑器只在本机模拟器留下一个本地草稿键（不影响服务器/其他用户）。

## 证据边界（必须如实读）

- **editor 与 activity 的 intro/fee/hero 是真实服务端草稿 + 真实云图片**，不是 `page.setData` 拼出来的。
- **`activity-facts.png` 是渲染证据，不是「真实已发布活动」证据**：草稿态 fact card 被 `wx:if="{{!isDraft}}"` 隐藏，截图前用 `page.setData({isDraft:false, fact...})` 注入事实字段。服务端投影在 P1 已用真实 `read` 冒烟验证；这里只证明 WXML/样式排版。
- **原生相册选择器 UNVERIFIED**：图片是程序化写入临时文件后走生产 `wx.cloud.uploadFile` 上传的；组件内的上传/检查/追加逻辑由 `tools/content-editor-test.js` 桩测试覆盖，P0 也用生产 `checkImage` 实跑过。真人点相册选图这一步仍需人工试一次。
- **真实键盘焦点 UNVERIFIED**：automator 的 `input` 不触发 focus/blur；`editor-content.png` 只证明块数据路径与排版。真机需人工在第 2 段中间打字再点第 4 段，看键盘是否跳。
- **跨用户读图 UNVERIFIED**：只有当前账号；仓库头像已走同一 `<image src="cloud://...">` 路径，是强先例，但没有第二账号复测。
- **分享卡 `imageUrl` 未截到分享面板**：`prepareShareImage` 取 https 临时地址的代码已接，但没有真机转发截图。

## 门禁（本轮实测）

`smoke 210/0` · `scenario-editor 169/0` · `scenario-activity 151/0` · `content-editor 16/0` · `content-view 14/0` · `scenario-discover 36/0` · `scenario-signup 106/0` · `scenario-workspace 114/0` · `lab-dryrun 165/0` · `quick-create 65/0` · `e2e-test 72/0` · `e2e-client-cas 54/0 (bugs=1 既有 BUG-C2)` · `lifecycle-projection 132/0` · `a20-owner-hero 32/0` · `journey-graph 15/0` · `ui-consistency 17/0`；`check.js` / `check-handlers.js` 全过。

`tools/e2e-golden-path-test.js` 已把编辑器步骤从 3 步改到 4 步（`.seg[1]→[2]`、`.seg[2]→[3]`、`stepLabels 3→4`），**未跑**（需开发者工具且 GP-01 既有红）。真机未跑全量 gate；以上是逐套实测，不冒充全量汇总。
