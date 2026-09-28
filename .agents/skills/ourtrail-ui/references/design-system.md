# OurTrail 设计系统参考（token 表 + 组件清单）

来源：`app.wxss`（原型 tokens.css/components.css 移植）。改动前先确认这里没有等价物。

## 颜色 token（page 级 CSS 变量，组件内可用 var()）

| token | 值 | 用途 |
|---|---|---|
| `--forest` | #163E35 | 主色：主按钮底、导航栏、hero 卡底、强调文字 |
| `--leaf` | #D6EA8A | 嫩叶：hero 上的徽标/强调（`.badge.on-forest` 底为 --leaf-on-forest #2D533F） |
| `--paper` | #F5F5F0 | 页面底色 |
| `--surface` | #FFFFFF | 卡片/弹层底 |
| `--ink` | #202A26 | 正文 |
| `--muted` | #5F6E66 | 次要文字（对比度 4.6:1，勿再调淡） |
| `--line` | #DEE3DB | 边框/分隔线 |
| `--danger/--warning/--info/--success` | #B43D3B / #8C5A12 / #346583 / #276145 | 语义色，配套 `-soft` 浅底 |
| `--forest-soft` | #ECF0EF | 主色浅底（次按钮、头像底、选中 tab） |
| `--control-line` | #8C9791 | 输入框边框 |
| `--on-forest-muted` / `--on-forest-line` | #D0D8D7 / #4E6C65 | 森林底上的次要文字/线 |

**禁止发明新色值。** 需要新语义色时：在 app.wxss 加 token + 在本表登记。

## 字号与行高

| 类 | 值 | 用途 |
|---|---|---|
| `.page-title` | 28px/1.3 字重700 字距-0.6px | 页面大标题（仅 root 页与重要节点） |
| `.section-title` | 16px/24 700 | 区块标题 |
| `.eyebrow` | 12px/18 600 字距0.72px muted | 眉题（OURTRAIL · 一起走过） |
| 正文 | 14px/22（page 默认） | |
| `.small` | 12px/18 | 说明/副文本 |
| 输入框 | 16px（防 iOS 聚焦缩放） | |
| `.field-label` | 13px/18 400 muted | 表单标签是辅助信息，值才是主角 |

## 间距与圆角

- 纵向节奏：`.stack` 16px、`.stack-gap3` 12px、`.form-actions` 12px；页面内边距 24/20。
- 圆角：tag 5 / button 8 / card 14 / sheet 20。
- 触控目标 ≥44px（`--touch-target`），主操作高 48px（`--action-height`）。

## 组件清单（改 UI 先复用）

| 组件/类 | 用法要点 |
|---|---|
| `.button` + `primary/secondary/danger/text/leaf` | view 或 button 均可；必须 `hover-class="button-hover"`；禁用态加 `.disabled` 并把 bindtap 置空串 |
| `.card` / `.card-header` | 内容卡；header 用于"标题 + 右侧动作" |
| `.badge` + `success/warning/danger/info/neutral/on-forest` | 状态徽标，文字承载语义 |
| `.callout` + 同上变体 | 提示块（左边线 3px 语义色），`callout-title` 加粗 |
| `<status-panel>` | denied/loading(skeleton)/empty/error/offline + 可选 actionLabel |
| `<person-row>` | 头像（无头像回退首字）+ 姓名 + 徽标 + 副标题 + 操作插槽 |
| `<form-field>` | label + slot + hint + error；错误时外层 `.field.invalid` |
| `<overlay kind="sheet|dialog">` | 底部弹层/居中确认；内容放 `.stack`；危险操作用 dialog + danger 按钮 |
| `<activity-card>` | 活动卡；`featured` 森林底 + 等高线装饰；`info` 属性传指标行 |
| `.segmented > .seg(.on)` | 分段切换（工作台四分区、筛选） |
| `.list-row` + `.list-main/.list-sub` | 行列表（图标或箭头收尾） |
| `.timeline/.timeline-item` | 路线节点时间轴（::before 圆点） |
| `.seat-grid/.seat(.occupied/.aisle/.selected)` | 座位示意：**4 座 + 1 过道 = 每行 5 列**，座位宽 `calc((100% - 48px) / 4)`、过道固定 16px，勿改回 25%（过道占位会错行） |
| `.metrics/.metric` | 三列指标（hero 内自动反白） |
| `.hero` | 森林底精选卡，子元素加 `.hero-body` 保证叠在装饰层上 |
| `.tabbar/.tab(.on)` | 仅 custom-tab-bar 内使用（自包含样式） |
| `.code-text` | 身份码等等宽强调 |
| `.tabular` | 数字对齐（时间/里程/人数） |

## 页面模板

- **root 页**（home/notices/me）：`.eyebrow` + `.page-title` + 一句 `.muted` 副标题开头；底部留白 `calc(32px + 84px + env(safe-area-inset-bottom))`。
- **子页**：原生导航栏（深绿底白字），内容区从 `eyebrow + page-title` 或直接正文开始；操作区用 `.sticky-action`（固定底栏）或 `.form-actions`。
- **工作台类**（workspace/staff）：顶部指标 `.metrics` + `.segmented` 分区 + 面板组件。
