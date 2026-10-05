# 11 · UI Spec（「我的」页面视觉与结构规格）

> 硬约束（ourtrail-ui SKILL.md + design-system.md）：只用现有 token 与组件类、禁止发明新色值、
> root 页模板、Tab 页底部留白、44px 触控、apply-shared、overlay 关闭态不可命中。
> 本文给出可直接翻译成 WXML 的结构规格；组件清单里的每一项都是**已存在**的类/组件。

---

## 1. 页面骨架（root 页模板）

```
<view class="page">                       ← padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom))（me.wxss:2 现状保留）
  status-panel (denied / loading)          ← 现状保留，denied 带「重试」actionLabel
  <view class="stack">                     ← 16px 纵向节奏
    A 身份头卡
    B 反馈区（error/hint callout）
    C 最近活动卡
    D 同行与安全卡
    E 常用同行人卡
    F 身份与协作卡
    G 隐私与授权卡（条件渲染）
  </view>
  overlay ×4（激活 / 同行人编辑 / 移除确认 / D 组编辑 sheet 复用 overlay 组件）
</view>
```

页头文案（A 卡内）：
- eyebrow：沿 .eyebrow 模式（design-system：眉题是小号 muted 引导词）。建议「OURTRAIL · 我的」
  （与 home 的眉题模式一致；现 eyebrow「我的同行资料」描述的是旧表单定位，随 IA 更新）——
  终稿文案待拍板（README §3）；
- page-title：**「同行资料与身份。」**（候选：`资料齐了，报名就快。`——终稿二选一，交给实现时按排版定，
  两句都不含 API 词汇、都解释页面价值）；
- muted 副标题（仅未激活时显示）：「补全姓名与手机号，报名和协作授权就都通了。」

---

## 2. A 身份头卡

- 结构：`.card` 内 flex 行（复用 me.wxss 现有 `.wx-row`/`.avatar-btn`/`.nick-input` 全套样式，
  **样式零新建**）+ 下方 `.metrics` 三列。
- 头像：`button.avatar-btn open-type="chooseAvatar"`，64px，无头像时 `.avatar-fallback` 首字回退
  （me.wxml:20-25 现状原样迁移）。
- 昵称：`input.nick-input type="nickname" maxlength=80`，17px/600 无下划线大字（me.wxss:57-66
  现状原样迁移）。实现细节文案（「点头像换微信头像…」me.wxml:38）**降级删除**——
  chooseAvatar 与 nickname 键盘是平台原生交互，用户会点；若保留一句话，只保留「点击头像可换微信头像」
  且字号 12px muted，不得与标题抢层级。
- 身份行（未激活态）：`.badge warning`「同行资料待完善」+ 点击唤起激活 sheet。
- 指标行：`.metrics`/`.metric` 三列——`进行中 / 已完成 / 发起`，数值 `.tabular`（design-system
  组件清单）。数据来源 03 §3.2；P0 客户端推导，无 home 读时（读取失败）整行隐藏。
- 【约束】一页最多一个实心主按钮（review-checklist）：A 卡内无按钮，激活入口用 badge/整行点击。

## 3. B 反馈区

- `error` → `.callout danger`；`hint` → `.callout warning`；渲染位置在 A 卡之下（不再顶在页首，
  视线动线先身份后反馈）。
- **作用域拆分**（12 §5）：页面级 error/hint 与 D 组 sheet 内错误、E 组 overlay 内错误分离为
  `data.error` / `data.sheetError` / `data.companionError`，各渲染在各自作用域——
  P0-4 的「错误必须在弹层内」规则扩展为「错误只在其作用域渲染」。

## 4. C 最近活动卡

```
最近活动
┌──────────────────────────────────────────┐
│ 格聂牧场线   10月4日 · 已完成        ›    │   ← list-row / list-main / list-sub
│ 武功山反穿   10月12日 · 进行中        ›   │
└──────────────────────────────────────────┘
```
- 空态：status-panel kind=empty 文案「还没有同行记录——从首页的发现活动开始。」
  （review-checklist：空态要解释下一步）；
- 行点击 `wx.navigateTo` `/pages/activity/activity?id=`；
- 日期格式走 format.js（北京时间）；状态词走 `PHASE_LABELS`（utils/format.js:74）；
- 最多 3 条，无「查看全部」入口（活动列表的家在首页 Tab，不做重复导航）。

## 5. D 同行与安全卡

```
同行与安全
┌──────────────────────────────────────────┐
│ 手机号      138****0000  [待保存]      ›   │   ← 整行 ≥44px 触控，bindtap 开 sheet
│ 紧急联系人  张三 138****0000           ›   │
│ 健康与用药  [已填写]                   ›   │
└──────────────────────────────────────────┘
```
- 摘要值脱敏规则见 09 §3.3；草稿未落库时加 `.badge warning`「待保存」（12 §4）；
- 三个 sheet 共用 `<overlay kind="sheet">` + `<form-field>`（label+hint+error）；
- sheet 内部含微信捷径的地方：手机号 sheet 放「使用微信手机号」文字按钮（`.button text`，
  `open-type="getPhoneNumber"` + 既有五分支错误文案 me.js:267-281 原样迁移）；
- medical sheet 三条 hint 见 09 §3.2；
- sheet 内底部状态行：「修改后自动保存 · 已保存 / 正在保存…」（机制反馈收进编辑面，
  取代现状卡底的常驻说明 me.wxml:78）。

## 6. E 常用同行人卡

- 结构沿用现状卡 + list-row（me.wxml:82-105），列表行迁移为 `<person-row>`（头像回退/姓名/
  副标题插槽：副标题=完整度提示，见 08 §4）；「添加」为 `.button text` + icon plus（现状保留）；
- 编辑/移除 overlay 原样保留（me.wxml:134-162）；错误在弹层内（P0-4 修复不可回退）；
- 空态文案改为「报名时直接勾选，不用再填一遍。」；语义句「保存条目不等于代办授权；每次报名
  仍需逐人同意。」**一字不改**（me.wxml:104）。

## 7. F 身份与协作卡

- 规格 = 10 §4：缩略码 `.code-text` + 复制按钮 + 说明句（现状句保留）+ 未激活副文案。
- 复制成功 toast「身份码已复制」→ 改「协作码已复制」（随命名统一，scenario-me 对应断言同批改）。

## 8. G 隐私与授权卡

- 条件渲染：`positionRows.length > 0`（现状逻辑保留，me.wxml:121）；
- 行结构沿用现状 list-row + 「撤回」`.button text`；撤回走 `dispatchAndSync position.revoke`
  + toast「位置授权已撤回」（me.js:354-363 原样）；
- 说明句「只在活动中主动上报一次位置，不会后台追踪。」**一字不改**；
- 卡标题从「位置授权」改「隐私与授权」（P2 若出现第二类授权项再重排，V1 只有位置一项时
  标题仍叫「位置授权」更诚实——**终稿：保留「位置授权」标题**，避免为单项授权立大组名）。

## 9. Overlay 汇总与键盘处理

| overlay | kind | 内容 | 备注 |
|---|---|---|---|
| 激活 sheet | sheet | 头像/昵称/手机号 + 完成按钮 + 跳过 | 04 §4 |
| 手机号 sheet | sheet | 手填 + 微信捷径 | D 组 |
| 紧急联系人 sheet | sheet | 姓名/电话 | D 组 |
| 健康备注 sheet | sheet | textarea + 三条 hint | D 组 |
| 同行人编辑 | sheet | 五字段（现状） | E 组，含弹层内错误 |
| 移除确认 | dialog | 现状 | E 组 |

【CODE FACT】交互审查 P1#7：全仓 overlay 无键盘处理（无 cursor-spacing/adjust-position）。
【DESIGN DECISION】本轮 sheet 全部补 `cursor-spacing`（sheet 底部输入场景），作为本页交付标准；
全站键盘批仍归交互审查打磨批，不在本设计扩大。
【PRIORITY】P0（随 sheet 实现）。

## 10. 触控与视觉纪律核对表（实现自检用）

- [ ] 所有可点行/按钮 ≥44px；`hover-class="button-hover"` 全覆盖（review-checklist 交互节）；
- [ ] 实心主按钮全页唯一（激活 sheet 的「完成」在 sheet 内；页面上无第二实心钮）；
- [ ] 数字/日期 `.tabular`；状态徽标文字承载语义（不靠色相）；
- [ ] 长文本（昵称 80 字、medical 2000 字、活动标题）word-break/ellipsis；
- [ ] 新增颜色 = 0（全部 `var(--token)`）；WXSS 组件字面量 = 0；
- [ ] overlay 关闭态 pointer-events 规则沿用 overlay 组件（不自制遮罩）；
- [ ] 四态齐全：denied（重试）/ loading（骨架）/ 各卡空态 / 提交失败反馈不静默。

## 11. 明确不引入

- 新组件目录（person-row/form-field/overlay/status-panel 足够）；
- 新 token / 新色值 / 新字号；
- 新页面（P0 页面数 0；P2 二维码若立项再评估 pages/identity）；
- 骨架屏自定义实现（status-panel kind=loading 已含 skeleton）；
- 下拉刷新以外的刷新手势；`onPullDownRefresh` 保留现状（me.js:79-81，页面 json 已启用——
  实现 checklist 里核对 me.json）。
