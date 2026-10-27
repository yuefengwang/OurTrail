---
name: ourtrail-ui
description: OurTrail 原生微信小程序的 UI 约束、交互设计与页面重构工作流。用于修改小程序 UI、评估设计规范，或进行多页面/导航/信息架构重构；重构时先审计真实页面和用户任务，再设计并分阶段验证，不把旧原型或旧规范当作最终答案。
---

# OurTrail UI 设计与实现规范

本技能覆盖两类工作：普通页面/组件改动，以及多页面、导航或信息架构重构。它同时记录项目约束和设计方法，但两者的证据等级不同：微信平台限制与仍有效的业务/数据契约需要遵守；现有 token、组件、原型和视觉惯例是待评估的设计资产，可以在充分说明理由并更新规范后调整。

当前客户端是原生微信小程序（WXML/WXSS/CommonJS）。不要仅为套用网页设计技能而引入 React、Tailwind 或其他构建链路。每次盘点以 `miniprogram/app.json` 和实际页面/组件代码为准；README、AGENTS、原型和本技能可能滞后或互相矛盾，发现差异时记录并核实。

当前设计语言曾从 `docs/prototypes/ourtrail-app` 移植，包含森林绿、嫩叶绿、纸面底、卡片和文字优先的语义表达。这是历史基线，不是此次全站重构的预设终点。

## 多页面重构工作流

当任务涉及多个页面、导航、关键流程或整体视觉方向时，先读 [references/redesign-workflow.md](references/redesign-workflow.md)。先产出可审阅的全站设计方案，确认后再进入实现；用户明确授权按阶段执行后，可沿已确认方案持续推进。

设计决策应来自真实页面、用户角色和任务、已有产品规则及可验证的平台能力。把视觉观感与实际行为分开记录；不得为了视觉一致性破坏授权、状态、错误恢复、并发版本或服务端响应契约。若发现产品流程本身需要改变，明确列出影响和备选方案，不能把它伪装成纯前端重构。

## 仓库与实现验证约定

- 改仓库文件前遵守根目录 `PARALLEL_DEV.md` 的分支、同步与静态门禁协议；天气、编辑器、发现、地图相关工作先查 `SYNC.md`。
- 开始改 WXML/WXSS/组件结构前读 `docs/e2e-mp/README.md`；驱动微信开发者工具前读 `docs/e2e-mp/automation-playbook.md`。若改动 E2E 语义，先读 `docs/testing/e2e-result-semantics.md` 并遵守 `tools/e2e-result.js`。
- 页面实现阶段运行 `node tools/check.js` 和 `node tools/check-handlers.js`。真实渲染验证按重构工作流执行；工具会话不可用或覆盖不足时如实记为未验证。

## 日常 UI 改动

### 改动前核对

1. 改样式优先用 `miniprogram/app.wxss` 里已有的 token 与组件类，**先复用再新建**；全局搜索类名确认没有等价样式。
2. 新建/修改自定义组件时，核实它依赖的全局类是否受组件样式隔离影响，并确认当前 `styleIsolation` 设置能满足预期；历史案例见 [references/platform-pitfalls.md](references/platform-pitfalls.md)。
3. 涉及颜色、字号、间距时，把 [references/design-system.md](references/design-system.md) 当作当前基线；普通局部改动优先复用 token，多页面重构可经审查后调整 token，并同步其所有消费者。
4. 交付前使用 [references/review-checklist.md](references/review-checklist.md)；清单是发现问题的辅助工具，不能替代运行页面与任务验收。

## 已记录的项目约束与历史经验

以下规则来自项目实现和已记录事故。重构前要确认触发条件仍存在；若页面结构或平台行为已变化，应验证后再保留、修订或退役规则。详见 [references/platform-pitfalls.md](references/platform-pitfalls.md)。

- **组件依赖 app.wxss 类选择器时，须核实样式隔离设置能让它们生效**；当前实现常用 `options: { styleIsolation: 'apply-shared' }`。只使用继承变量或完全自包含样式的组件不应为满足口号而机械加配置。
- **WXSS 不支持 `color-mix()`**：需要混色时使用兼容表达；新增或调整语义色须先审查设计意图并登记 token 与消费者。
- **弹层关闭态必须不可命中**：overlay 组件用 `pointer-events:none + visibility 延迟隐藏`。自绘遮罩层都要照此处理，否则透明层拦截整页点击。
- **自定义 tabBar 样式必须自包含**在 `custom-tab-bar/index.wxss`（组件吃不到全局样式，且它不在页面作用域内）。
- **Tab 页底部留白**：`.page { padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom)); }`，否则内容被固定 tabBar 遮住。
- **视图不能溢出**：卡片内长文本 `word-break`，行内数值用 `.tabular`（等宽数字）。
- **不要用 `wx.getUserProfile`**（返回匿名数据）。头像=`open-type="chooseAvatar"`，昵称=`type="nickname"` 输入框，手机号=`open-type="getPhoneNumber"`（需平台隐私声明）。

## 现有组件与交互模式（候选资产）

- 当前可复用的页面骨架、组件、状态表达、提交方式与文案约定见 [references/design-system.md](references/design-system.md) 及业务模块说明。它们是有价值的候选资产；做全站重构时先比较它们与用户任务的适配度，再决定复用或替换。
- 页面必须完整表达加载、无权限、空数据、失败等真实状态；具体组件形态可以调整，但不能省略状态或把错误伪装成空内容。
- 数据提交、身份权限、活动阶段、并发冲突等应继续服从服务端契约和现有业务模块；视觉/交互重构不得在客户端另造业务判定。

## 参考资料

- 多页面重构、信息架构或交互设计 → [references/redesign-workflow.md](references/redesign-workflow.md)
- 取色/字号/间距/新组件样式 → [references/design-system.md](references/design-system.md)
- WXML/WXSS 报错不生效、布局错乱或复核平台假设 → [references/platform-pitfalls.md](references/platform-pitfalls.md)
- 改完准备交付 → [references/review-checklist.md](references/review-checklist.md)
