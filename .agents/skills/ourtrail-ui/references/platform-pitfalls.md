# 微信小程序 WXML/WXSS 平台坑（本项目实际踩过）

每条都有事故背景，遇到"样式不生效/布局错乱/页面点不动"先查这里。

## 样式作用域

### 1. 组件吃不到 app.wxss（最大坑）
**现象**：页面正常、组件内部布局散架（卡片无边框、按钮无底色、弹层样式错乱）。
**原因**：自定义组件默认 `styleIsolation: 'isolated'`，app.wxss 与页面 wxss 的**类选择器**不注入组件内部。
**修复**：组件 JS 里加 `options: { styleIsolation: 'apply-shared' }`。
**注意**：CSS 自定义属性（var(--x)）靠继承传播，**不受**隔离影响；受影响的是选择器匹配。所以"组件里 var() 有值但 .card 类没样式"就是这个问题。
**例外**：custom-tab-bar 样式必须完全自包含在 `custom-tab-bar/index.wxss`（含 `position: fixed`），且颜色写字面量。

### 2. 组件内颜色写字面量
组件若未用 apply-shared（历史原因），var() 继承仍可用，但类样式失效。本项目规范：组件一律 apply-shared + var()，字面量仅用于 tab-bar 等特殊位置。

### 3. `color-mix()` 不可用
WXSS 编译/渲染不支持 `color-mix()`。所有混合色用 app.wxss 里预算好的字面量（如 `--forest-soft: #ECF0EF`）。

## 定位与层叠

### 4. 弹层/遮罩关闭态必须不可命中
**现象**：打开过一次弹层后，整个页面点不动。
**原因**：`.overlay-root` 固定全屏，关闭后只是 `opacity:0`，节点仍在，命中测试照常。
**修复**（overlay.wxss）：
```css
.overlay-root { pointer-events: none; visibility: hidden; transition: visibility 0s linear var(--motion, 180ms); }
.overlay-root.open { pointer-events: auto; visibility: visible; transition: none; }
```

### 5. 固定底栏遮挡内容
`position:fixed` 的 tabBar/sticky-action 高度不计入文档流。Tab 页 `.page` 需要 `padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom))`；sticky-action 页用 `.page.has-sticky`（120px）。

### 6. 安全区
底部固定元素：`padding-bottom: calc(<常规> + env(safe-area-inset-bottom))`。top 用系统导航栏，不要自定义头部。

## 布局

### 7. flex 多列 + 分隔元素要算宽度
座位网格（4 座+1 过道=5 列）：座位 `width: calc((100% - 48px) / 4)`、过道 `flex: 0 0 16px`。曾用 `25%` 导致过道占掉一个座位位、整行错位。

### 8. `dvh`/部分现代单位兼容性
小程序 WXSS 对 `100dvh` 支持不稳，用 `100vh` 或 `min-height:100vh`。

## WXML

### 9. 动态事件名置空
`bindtap="{{cond ? 'onX' : ''}}"` 是合法的禁用手法，但要同时加 `.disabled` 视觉态，且 handler 内保留 busy 守卫。

### 10. checkbox-group / picker 的取值
- `checkbox-group bindchange` 的 `e.detail.value` 是**全部选中值数组**（不是单个变更项）。
- `picker` 的 `e.detail.value` 是**索引**；带对象数组用 `range-key`。

### 11. dataset 类型
`data-gostaff="{{item.goStaff}}"` 传布尔值到 dataset 会变成布尔（保持类型），但 `data-x="true"` 字符串要自行转换。判断一律用真值语义。

### 12. `<block>` 配对
`wx:elif` 必须紧跟 `wx:if`（或上一个 `wx:elif`）的兄弟节点；弹层嵌套时先跑 `tools/check.js` 的配平检查——发布弹层闭合标签曾因此丢失。

## 微信能力

### 13. 获取用户信息的现行合法入口
`wx.getUserProfile` 已废弃（返回匿名数据）。头像=`<button open-type="chooseAvatar">`；昵称=`<input type="nickname">`（键盘上方点选）；手机号=`<button open-type="getPhoneNumber">`——**需平台《用户隐私保护指引》声明「手机号」**，否则报 "api scope is not declared in the privacy agreement"。失败必须显式提示（区分取消/无权限/开发者工具），禁止静默 return。

### 14. 内容安全
用户提交文本（标题/说明/备注/通知）由云函数 `checkText` 过滤，客户端不做、也不要绕过。

## 工具

- `node tools/check.js`：JS 语法 / WXML 配平 / WXSS 花括号 / app.json 页面齐全 / 组件引用存在。改完 UI 必跑。
- `node tools/gpx-test.js`、`node cloudfunctions/trailApi/smoke-test.js`：逻辑回归。
