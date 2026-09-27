# UI 交付前审查清单

改完任何页面/组件后逐项过一遍。任何一项不过就先修再交付。

## 结构与作用域
- [ ] 新组件有 `options: { styleIsolation: 'apply-shared' }`
- [ ] 没有在组件里新发明颜色字面量（tab-bar 除外）；新语义色已进 app.wxss token 并登记 design-system.md
- [ ] `node tools/check.js` ALL PASSED

## 页面完整性（每个页面四态）
- [ ] denied：status-panel kind=denied + 重试动作
- [ ] loading：status-panel kind=loading（骨架）
- [ ] empty：status-panel kind=empty，文案解释"为什么空、下一步做什么"
- [ ] 错误：dispatch 失败有可见反馈（callout danger 或 toast），不静默

## 交互
- [ ] 所有可点元素 ≥44px 高，带 `hover-class="button-hover"`
- [ ] 禁用态 = `.disabled` + bindtap 置空 + handler 内 busy/条件守卫（三层一致）
- [ ] 提交类按钮在 busy 期间不可重复触发
- [ ] 数据提交用 `api.dispatchAndSync`，CONFLICT 自动重读
- [ ] 危险操作（取消报名/删车/移除/取消活动）：dialog 确认 + 需要原因的必填原因
- [ ] 输入框用了正确键盘（number/digit/nickname），placeholder 说明格式
- [ ] 失焦自动保存的场景：保存成功/失败都有反馈（toast + 状态行）

## 文案
- [ ] 状态文案解释"现在怎样 + 接下来会怎样"，不用甩锅式空话
- [ ] 数字/时间用 `.tabular`；时间统一北京时间（utils/format.js）
- [ ] 演示/合规措辞：不承诺救援/保险；零金额表述保持

## 布局细节
- [ ] Tab 页/sticky 页底部留白正确（84px 规则 / has-sticky）
- [ ] 长文本溢出处理（姓名/地址/备注 word-break 或 ellipsis）
- [ ] 弹层内容超高可滚动（overlay 内 scroll-view），关闭态不拦截点击
- [ ] 座位网格改动后行对齐仍是 4+过道
- [ ] 空态插图为语义图标（status-panel 内置），布局不跳动

## 视觉层次（refactoring-ui 诊断表，损害大头）
- [ ] 一页最多一个实心主按钮；同级批量动作全部次要样式，主样式只出现在确认弹窗里
- [ ] 页面上的危险操作用文字样式（tertiary），红色主按钮只出现在确认弹窗内
- [ ] 卡片不叠用"边框 + 底色差"；两者都有时去掉边框
- [ ] 空态下隐藏无功能的筛选项/分段控件
- [ ] 强调靠字重与颜色，不靠放大字号；字重两档：正文 400/500、强调 600（700 仅 page-title）
- [ ] 数据避免 `label: value` 罗列——标签合并进值或降为次级文本
- [ ] 对比度抽查 ≥4.5:1（正文对），输入框/勾选框描边 ≥3:1；新增颜色必须验一组配对
- [ ] 图标不放大远离原始尺寸；需要大图标时放进色块圆底

## 回归
- [ ] 跑 `node cloudfunctions/trailApi/smoke-test.js`（涉及 domain/投影时）
- [ ] 模拟器走一遍受影响页面的四态
- [ ] 多 agent 场景：改动同步登记到 SYNC.md 变更日志
