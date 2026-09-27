---
name: ourtrail-ui
description: OurTrail 小程序 UI 设计系统与审查规范。凡是在 miniprogram/ 下新建或修改页面、组件、WXML、WXSS，调整布局/样式/交互，或用户提到 UI、界面、样式、布局、美化、优化观感时使用——即使用户没有明说"设计系统"四个字。多 agent 协作时，任何 UI 改动前后都应对照本规范。
---

# OurTrail UI 设计系统与审查规范

本项目 UI 从高仿真原型（`docs/prototypes/ourtrail-app`）整体移植，设计语言：**森林绿 × 嫩叶绿 × 纸面底，圆角卡片，文字承载语义（色相只是辅助）**。本 skill 保证任何 agent 改 UI 时与既有体系一致，并避开微信平台已踩过的坑。

## 改 UI 前必读

1. 改样式优先用 `miniprogram/app.wxss` 里已有的 token 与组件类，**先复用再新建**；全局搜索类名确认没有等价样式。
2. 新建/修改**自定义组件**时，检查 `Component({ options: { styleIsolation: 'apply-shared' } })` 是否存在——没有它 app.wxss 完全不生效（本项目曾因此全局布局散架）。详见 [references/platform-pitfalls.md](references/platform-pitfalls.md)。
3. 涉及颜色、字号、间距，从 [references/design-system.md](references/design-system.md) 的 token 表取值，不要发明新色值。
4. 交付前跑一遍 [references/review-checklist.md](references/review-checklist.md)。

## 硬性规则（踩坑换来的，逐条有事故背景）

- **组件必须声明 `options: { styleIsolation: 'apply-shared' }`**，否则 app.wxss 的类选择器不注入组件内部（CSS 变量继承不受影响，选择器匹配受影响）。
- **WXSS 不支持 `color-mix()`**：所有混合色必须写成字面量（token 表里已预算好，直接抄）。
- **弹层关闭态必须不可命中**：overlay 组件用 `pointer-events:none + visibility 延迟隐藏`。自绘遮罩层都要照此处理，否则透明层拦截整页点击。
- **自定义 tabBar 样式必须自包含**在 `custom-tab-bar/index.wxss`（组件吃不到全局样式，且它不在页面作用域内）。
- **Tab 页底部留白**：`.page { padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom)); }`，否则内容被固定 tabBar 遮住。
- **视图不能溢出**：卡片内长文本 `word-break`，行内数值用 `.tabular`（等宽数字）。
- **不要用 `wx.getUserProfile`**（返回匿名数据）。头像=`open-type="chooseAvatar"`，昵称=`type="nickname"` 输入框，手机号=`open-type="getPhoneNumber"`（需平台隐私声明）。

## 布局与交互模式（照抄现有实现）

- 页面骨架：`<view class="page">` + `.stack`（16px 纵向节奏）/`.card`（14px 圆角卡）/`.card-header`。
- 状态四件套：denied / loading / empty / error 一律用 `<status-panel>`，不要自己写"暂无数据"裸文本。
- 人员列表：`<person-row>`（头像自动回退首字）；表单：`<form-field>`（label+hint+error）；弹层：`<overlay kind="sheet|dialog">`；按钮：`.button` + `primary/secondary/danger/text/leaf` 变体 + `hover-class="button-hover"`。
- 数据提交一律 `api.dispatchAndSync(payload, this.revision, this)`（CONFLICT 自动重读页面）；危险操作（取消/删除）用 `.danger` 按钮 + dialog 二次确认 + 原因必填。
- 文案语气沿袭原型：短句、面向动作（"先看容量，再安排同行"）、状态文案带解释不甩锅。中文文案库集中在 `utils/format.js`。

## 何时读哪个参考

- 取色/字号/间距/新组件样式 → [references/design-system.md](references/design-system.md)
- WXML/WXSS 报错不生效、布局莫名错乱 → [references/platform-pitfalls.md](references/platform-pitfalls.md)
- 改完准备交付 → [references/review-checklist.md](references/review-checklist.md)
