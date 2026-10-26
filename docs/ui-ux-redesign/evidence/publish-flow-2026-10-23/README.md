# 活动发布流程视觉收敛（2026-10-23）

**范围**：在已核准的方案 A（冷白纸底 + 森林绿唯一主操作 + 白卡细线 + 下划线页签 + 提高密度）下，优化活动发布流程涉及的页面与组件：编辑器四步（信息 / 路线 / 介绍 / 发布）、正文编辑器 `content-editor`、补资料层 `profile-gate`、发布确认弹层。**不含**业务逻辑、schema、云函数、云端写入或部署。

## 环境

- 微信开发者工具 IDE 模拟器（306×660），项目 `D:\OurTrail`。
- 改前 11 帧：`auto --auto-port 9420` 会话。
- 改后 18 帧：`close --project 'D:\OurTrail'` → `open` → `auto --auto-port 9421`（未 `quit` IDE）。
- 驱动脚本在仓库外：`%TEMP%/opencode/mp-auto/publish-flow-capture.js`（四步 + 弹层）与 `publish-flow-expanded.js`（真实 tap 展开节点/风险）。

**bundle 新鲜度自证**：页头新副文案「必填项齐了就能发；路线与图文可以稍后补。」与封面临时槽「待选」只存在于本批代码；`segMode` 实测为 `segmented tabs-line`（旧包只会是 `segmented`）。

## 数据与写入边界

编辑器注入一份生产形状的活动：`青城后山 · 周末轻徒步`，2026-10-31 08:00 出发，成都东站集合，上限 24 人，3 个路线节点 / 2 条风险。

**零云端写入**：发布弹层由 `onPublishOpen`（纯 `setData`）打开，未点「发布活动」/`onPublishIntent`，未点「确认发布」；勾选复选框只在页面内存内生效。补资料层**未捕获**——它会渲染真实账号资料，取证时已移除。

## 改动面（4 个产品文件，+53/−65；`cloudfunctions/` 零改动）

| 文件 | 改动 |
|---|---|
| `miniprogram/pages/editor/editor.wxml` | ① 步骤页签改 `.segmented tabs-line`，删除重复的「第 X 步 / 共 4 步」（`.seg/.on` 类名保留，E2E 驱动契约不变）；② 模板复制卡从页签上方移入步骤 1 必填项之后，只在步骤 1 出现；③ 删除 8 处与卡内标题重复的 `.kicker` 眉题（基本 / 时间 / 上车点 / 名额审核 / 可见范围 / 费用文本 / 风险 / 装备）；④ 路线节点与风险提示由「卡中卡」改为 `.subrows` 发丝线子行；⑤ 发布弹层在参与但未勾资料授权时补一句后果说明；⑥ 页头副文案收紧。 |
| `miniprogram/pages/editor/editor.wxss` | 四步页签横向 padding 收至 2px（306px 宽、四步带 ✓ 时不换行）；新增 `.subrows / .subrow / .subrow + .subrow`。 |
| `miniprogram/components/content-editor/content-editor.wxml` | 空封面缩略图占位「封面」→「待选」，消除与右侧字段标签「封面」的重复。 |
| `miniprogram/components/profile-gate/profile-gate.wxss` | `.phone-btn` 由 32px 提到 `var(--touch-target)`（44px），padding 12px 0、margin-top 0。 |

零 schema / 零 domain / 零 handler 改动。

## 改前 / 改后读数

来自 `before/readings.json` 与 `after/readings.json`（元素计算样式与节点计数）。

| 步骤 | `.section-head` | `.card` |
|---|---|---|
| 01 信息 | 5 → 3 | 3 → 3（模板卡改在本步内） |
| 02 路线 | 4 → 3 | 3 → 2（模板卡不再出现） |
| 03 介绍 | 2 → 2 | 2 → 1（模板卡不再出现） |
| 04 发布 | 7 → 2 | 6 → 5（模板卡不再出现，5 个眉题删除） |

页签：`segMode` `segmented` → `segmented tabs-line`；active 背景 `rgb(255, 255, 255)` → `rgba(0, 0, 0, 0)`；文字色 `rgb(22, 62, 53)` 与 `font-weight 600` 保持不变。

底部动作条：每一步仍恰有 1 个 `.button.primary`。步骤 1–3 为「上一步（text）／发布活动（primary）／继续完善（text）」，步骤 4 为「上一步（text）／发布活动（primary）」。

## 发布弹层（运行时元素读数，非像素）

- 弹层打开、未勾「我本人也参加」时：「确认发布」class = `button primary block`（可用）。
- 勾选「我本人也参加」后，弹层展开本人出行方式与资料授权区。
- 资料授权**未勾选**时：新说明在场（「勾选上面的资料授权后，「确认发布」才可用；这份授权只用于本次活动。」），确认按钮 class = `button primary block disabled`。
- 勾选资料授权后：该说明消失，确认按钮 class = `button primary block`。
- **全程未点击确认，未触发发布。**

注意：`publish-dialog-participate.png` 与 `publish-dialog-datause.png` 字节相同（md5 一致）。资料授权与确认按钮在弹层可视区下方，`scroll-view` 没有 automator 滚动通路，因此这两个状态**只有元素文本 / class 证据，没有像素证据**。

## 展开态子行

真实 tap「3 个节点 · 2 条风险 ›」与「风险提示（可选）2 条 ›」后读数（`expanded-readings.json`）：

| 行 | 尺寸（宽 × 高） |
|---|---|
| 1 泰安古镇 · 起点 | 316 × 46 px |
| 2 白云寺 · 途中 | 316 × 47 px |
| 3 五龙沟 · 终点 | 316 × 47 px |
| 1 石阶湿滑（编辑 / 雨后改走公路） | 316 × 102 px |
| 2 午后降温（编辑 / 全员带防风层） | 316 × 103 px |

可点区域高度均 ≥44px；子行之间由 1px `var(--line)` 分隔，父卡内不再套第二层 `.card`。

## 帧

| 文件 | 内容 |
|---|---|
| `after/step0-top.png` | 信息步首屏：页头、下划线页签、活动名称卡 |
| `after/step0-s520.png` | 信息步：出发时间卡、模板复制卡（新位置）、底部动作条 |
| `after/step1-top.png` | 路线步首屏：路线卡 |
| `after/step1-s520.png` / `step1-s1100.png` | 路线节点列表与底部（两帧字节相同：滚动已到底） |
| `after/step1-route-open.png` | 真实 tap「查看 / 调整」后：节点子行展开、发丝线分隔 |
| `after/step2-top.png` | 介绍步：封面临时槽「待选」、正文编辑器 |
| `after/step2-s520.png` | 介绍步下半 |
| `after/step3-top.png` | 发布步首屏：名额与报名、可见范围 |
| `after/step3-s520.png` | 发布步中部 |
| `after/step3-s1100.png` / `step3-s1700.png` | 发布步下部（两帧字节相同：滚动已到底） |
| `after/step3-risk-open.png` | 真实 tap「风险提示」后：风险子行展开 |
| `after/publish-dialog.png` | 发布确认弹层打开：活动摘要、可后补提示、未勾参与、确认可用 |
| `after/publish-dialog-participate.png` | 勾选「我本人也参加」后（弹层展开，下半部在折叠线下） |
| `after/publish-dialog-datause.png` | 再勾选资料授权后（与上帧字节相同，变化在折叠线下） |
| `after/readings.json` / `expanded-readings.json` | 四步元素读数 / 展开态尺寸 |
| `before/*.png` + `before/readings.json` | 改前同条件 11 帧与读数（无弹层帧） |

## 静态门（本轮复跑）

| 套件 | 读数 |
|---|---|
| `tools/check.js` | exit 0 `ALL CHECKS PASSED` |
| `tools/check-handlers.js` | exit 0（存量死 handler 1 条未增加） |
| `t4-e08-test` | 41 / 0 |
| `swx1-style-gates-test` | 45 / 0 |
| `swx2-style-gates-test` | 110 / 0 |
| `page2-gates-test` | 100 / 0 |
| `b4-pad-final-value-test` | 32 / 0 |
| `style-semantics-test` | 92 / 0 |
| `e08-remaining-test` | 79 / 0 |
| `ui-consistency-test` | 17 / 0 |
| `m02-class-scope-test` | **65 / 1** —— PV5 privacy `.section-title` 恰 5 个；`privacy` 页相对 HEAD 零改动，与 clean 基线同款存量红，非本轮引入 |

## 边界

- 这是 **IDE 模拟器不是物理手机**；未验证真机色彩管理、系统字体与滚动惯性。
- 发布弹层的资料授权说明位于折叠线以下；两帧状态截图字节相同，不能当像素对照。
- `profile-gate` 只有样式改动（`.phone-btn` 引用 `--touch-target`），**没有真机帧**——驱动会渲染真实账号资料，已移除该项取证。
- `m02-class-scope` 的 PV5 是 clean 基线存量红，与本轮无关。
- `cloudfunctions/` 零改动 ⇒ 不需要重新部署 trailApi；未发布、未清理任何云端数据。
