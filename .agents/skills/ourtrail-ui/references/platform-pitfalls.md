# 微信小程序 WXML/WXSS 平台坑（本项目实际踩过）

遇到"样式不生效 / 布局错乱 / 页面点不动 / 图表位置漂移"先查这里。

**状态标记**：`[防回归]` 历史问题已在代码里修好，这条存在的意义是防止改回来（**不代表现状有缺陷**）· `[现行]` 当前写法仍必须遵守，违反会立刻出问题 · `[保守约定]` 平台能力无法从本仓库证真，按"不依赖"处理。
每条给：现象 / 适用条件 / 根因 / 正确处理 / 最小验证。适用条件很重要——多数坑不是"全局禁止"，而是"命中该条件才成立"。

## 样式作用域

### 1. 组件吃不到 app.wxss `[现行]`
- **现象**：页面正常、组件内部布局散架（卡片无边框、按钮无底色、弹层样式错乱）。
- **适用条件**：组件的 WXML/WXSS 引用了 `app.wxss`（或页面 wxss）里的**类选择器**。不引用全局类的组件不受影响——实测 `meteogram` 的 `meteogram*`/`lg*` 全在自身 wxss（8 个本地定义，`app.wxss` 无这些类），对它这条不承重。
- **根因**：自定义组件默认 `styleIsolation: 'isolated'`，全局类选择器不注入组件内部。
- **正确处理**：`Component({ options: { styleIsolation: 'apply-shared' } })`。
- **例外**：`custom-tab-bar` 样式必须完全自包含在 `custom-tab-bar/index.wxss`（含 `position: fixed`），且颜色写字面量——实测 5 处字面量、零 `var()`，这是规则允许的例外位。
- **最小验证**：组件里挑一个只在全局定义的类（如 `.tabular`、`.card`），在开发者工具里看它是否出现在渲染出的节点样式里。**CSS 自定义属性（`var(--x)`）靠继承传播，不受隔离影响；受影响的只有选择器匹配**——所以"var() 有值但 `.card` 没样式"就是本条，而不是变量丢了。

### 2. `options` 同名字段写两次会静默吞掉 apply-shared `[防回归]`
- **现象**：加了 `styleIsolation` 却仍然没全局样式，代码看着"写了"。
- **根因**：一个 `Component()` 里写两个 `options:` 键，后者整体覆盖前者（不是合并），`styleIsolation` 随之丢失。
- **正确处理**：`options` 每 `Component()` 只出现一次，多个标志写在同一对象里：`options: { styleIsolation: 'apply-shared', multipleSlots: true }`。守卫注释在 `components/form-field/form-field.js:1-3` 与 `components/overlay/overlay.js:1-3`；事故修复见提交 `daa0508`。
- **最小验证**：`grep -c "^\s*options:" <组件>.js` 必须 ≤1。
- **连带**：具名 slot 必须 `multipleSlots: true`。实测现状：`form-field` true、`roam-scrubber` true（`wxml:34` 有 `<slot name="readout">`）、`overlay` **显式 false**（它不用具名 slot）。把 overlay 改造成具名 slot 时必须同时把这个 false 改掉，否则内容被静默丢弃、组件 `data` 一切正常、页面上什么都没有（本项目 P4 的真机 bug 之一，逻辑测试测不到）。

### 3. `color-mix()` 不可用 `[保守约定]`
- WXSS 编译/渲染不支持 `color-mix()`，混合色用 `app.wxss` 里预算好的字面量（如 `--forest-soft: #ECF0EF`）。
- **证据层级要如实说**：全库 `color-mix(` 命中 1 处，在 `app.wxss:2` 的**注释**里，代码 0 使用 ⇒ 仓库内既无反例也无正例。本项目 `skylineRenderEnable: false`（WebView 渲染），现代 CSS 能否生效随用户端内核版本变化，**无法从仓库证真**，所以按"不依赖"处理是成本最低的解。`:root`（应用 `page`）、`100dvh`（用 `100vh`）同理：命中各 1 处且都在同一条注释里。
- **已被现状实际使用、可以继续用的**：`gap`（73 处 / 13 文件）、`calc`（14 处）、`env(safe-area-inset*)`（12 处 / 10 文件）。`clamp()/min()/max()/aspect-ratio` 全库 0 命中——要用先按本条证一遍。

## 定位与层叠

### 4. 弹层/遮罩关闭态必须不可命中 `[防回归]`
- **现象**：打开过一次弹层后，整个页面点不动。
- **适用条件**：任何常驻 DOM、靠透明度切换显隐的全屏层（自绘遮罩同此）。
- **根因**：`.overlay-root` 固定全屏，关闭后只是 `opacity:0`，节点仍在，命中测试照常。
- **修复**（现于 `components/overlay/overlay.wxss:14/29`，`--motion` 走 `var(--motion, 180ms)`）：
```css
.overlay-root { pointer-events: none; visibility: hidden; transition: visibility 0s linear var(--motion, 180ms); }
.overlay-root.open { pointer-events: auto; visibility: visible; transition: none; }
```
- **最小验证**：`open=false` 时点击弹层覆盖区域的正文按钮，必须能触发；`opacity:0` 单独用不算修好。

### 5. 固定底栏遮挡内容 `[现行]`
- `position:fixed` 的 tabBar / `.sticky-action` 高度不计入文档流。
- **实测归属（容易记错的一点）**：`app.wxss` 的 `.page` 只有 `padding: 24px 20px 32px`（`:68`），`.page.has-sticky` 是 `120px`（`:72`）；**`calc(32px + 84px + env(safe-area-inset-bottom))` 写在每个 tab/root 页自己的 wxss**（`home.wxss:2`、`notices.wxss:2`、`anotices.wxss:2`、`me.wxss:2`、`weather-hub.wxss:6`），新 tab 页不会自动继承。`app.wxss:482` 另有 `.tabbar-safe { height: calc(84px + env(safe-area-inset-bottom)) }` 可作占位块。
- **事故**：`weather-hub.wxss:4-5` 的注释原话——缺失时"观察点列表最后几行被固定 tabBar 拦腰截断、删除按钮点不到（2026-09-30 实测复现）"。
- **最小验证**：真机把列表滚到底，最后一行的可点控件必须完整可见且能点。

### 6. 安全区 `[现行]`
底部固定元素：`padding-bottom: calc(<常规> + env(safe-area-inset-bottom))`。顶部用系统导航栏，不要自定义头部（本项目 `app.json:65` `style: "v2"`，导航栏配色在 `app.json` window 段硬编码 `#163E35` / `#F5F5F0`）。

## 布局

### 7. flex 多列 + 分隔元素要算宽度 `[防回归]`
座位网格（4 座 + 1 过道 = 每行 5 列）：座位 `width: calc((100% - 48px) / 4)`、过道 `flex: 0 0 16px`（定义 `app.wxss:406/:425`）。曾用 `25%` 导致过道占掉一个座位位、整行错位。**验证**：改过座位后必须看行尾是否齐平，且 `.aisle` 不承载座位内容。

### 8. `dvh` / 部分现代单位兼容性 `[保守约定]`
WXSS 对 `100dvh` 支持不稳，用 `100vh` 或 `min-height:100vh`（现状：`app.wxss:70`、`weather-chart.wxss:5` 都用 `100vh`）。证据层级同 §3——仓库内 0 处使用 `dvh`，属约定而非实测证伪。

### 9. 溢出与等宽数字 `[现行]`
卡片内长文本 `word-break`；行内数值用 `.tabular`（`app.wxss:95`）。窄屏三档基准 375 / 390 / 414（天气线的实测判据宽度），只在某一档断裂也算缺陷。

## WXML

### 10. 动态事件名置空 `[现行]`
`bindtap="{{cond ? 'onX' : ''}}"` 是合法的禁用手法，但要同时加 `.disabled` 视觉态，且 handler 内保留 busy 守卫——三层一致（样式 / 事件 / handler）。只置灰不置空的表现是"样式正常、文案正确、点了没反应"；`tools/e2e-ui-test.js` 曾把这种按钮的 tap 返回成功当成 PASS 证据（铁律 21）。

### 11. checkbox-group / picker 的取值 `[现行]`
- `checkbox-group bindchange` 的 `e.detail.value` 是**全部选中值数组**（不是单个变更项）。
- `picker` 的 `e.detail.value` 是**索引**；带对象数组用 `range-key`。
- 这一类有门：`tools/check.js` 的「勾选框事件载体」步骤与 `tools/check-handlers.js` 的 dataset 契约检查（两边各查一半，口径互补）。**别抄这两处的行号**，跑一次 `node tools/check.js` 会打印步骤标题。

### 12. dataset 类型 `[现行]`
`data-gostaff="{{item.goStaff}}"` 传布尔值到 dataset 会保持类型，但 `data-x="true"` 这种字符串要自行转换。判断一律用真值语义，不要比较字符串 `'true'`。

### 13. `<block>` / `wx:elif` 配对 `[防回归]`
`wx:elif` 必须紧跟 `wx:if`（或上一个 `wx:elif`）的兄弟节点；弹层嵌套时先跑 `tools/check.js` 的配平检查（`:39-70`）——发布弹层的闭合标签曾因此丢失。

### 14. 一个类名可能同时存在于兜底块与主块 `[现行]`
`weather.wxml` 的 `.timeline-card` 属于 `wx:if="{{!unified}}"` 的兜底块：统一图存在时整块不渲染。驱动/审计时用类名判"元素在不在"之前，**先读它外层的 `wx:if` 条件**，否则会得出"页面缺内容"的假红（本项目真机第一版就是这么假红过一次）。

## 微信能力

### 15. 获取用户信息的现行合法入口 `[现行]`
`wx.getUserProfile` 已废弃（返回匿名数据）。头像=`<button open-type="chooseAvatar">`；昵称=`<input type="nickname">`；手机号=`<button open-type="getPhoneNumber">`——**需平台《用户隐私保护指引》声明「手机号」**，否则报 "api scope is not declared in the privacy agreement"。失败必须显式提示（区分取消 / 无权限 / 开发者工具），禁止静默 return。本项目 `app.json` 已声明 `permission.scope.userLocation`(:55-59) 与 `requiredPrivateInfos`(getLocation/chooseLocation :60-63)、`__usePrivacyCheck__`(:67)。

### 16. 内容安全 `[现行]`
用户提交文本（标题/说明/备注/通知）由云函数 `checkText` 过滤，客户端不做、也不要绕过。

### 17. 全仓库没有 `wx.getLocation` 的运行时前提 `[现行]`
海拔与位置的主语只能是**此点**（路线节点 / 查询点），不能写"你 · 3,500 m"或"穿过你的海拔"——无据断言（铁律 25③）。做定位相关 UI 前先确认数据来源，别在文案里许诺设备能力。

## 工具与能力边界

- `node tools/check.js`：既有静态步骤（JS 语法 / WXML 标签配平 / WXSS 花括号与 `//` 行注释 / app.json 页面四件套 / `usingComponents` 正反两向 / 旧目录已删 / 相对 require 可解析 / 裸 checkbox 事件载体），**加**一段平台门——判据分别在 `tools/t4-e08-platform-rules.js`、`tools/e08-remaining-rules.js`、`tools/m02-class-scope-rules.js`，每段进门规则都自带合成夹具自证（正例必红、反例必绿）。要清单就直接跑 `node tools/check.js`：它自己逐条打印 `Gn + 标题 + 命中读数`。**不要把它的行号或步数抄进任何文档/断言**——这段是追加式的，一次改动行号就漂（本仓已多次因此把门自己搞哑）。改完 UI 必跑。
- `node tools/check-handlers.js`：WXML 的 `bind*` 是否解析到 JS handler，外加 checkbox/radio-group 的 dataset 契约；`check-handlers.js <页/组件名>` 可单测一个宿主。**它补的是 `node --check` 看不见的那一类**——`node --check` 过了仍可运行时 `xxx is not defined`（铁律 4）。
- **这些门的天花板（2026-10-17 复量）**：平台与作用域这一整类**已经有闸**——`options` 同名键 / apply-shared 缺失 / 具名 slot 缺 `multipleSlots` / 裸事件属性名 / 页尾留白↔`app.json tabBar.list` 身份 / WXSS 不支持特性 / sticky 无偏移 / 同一条选择器文本的关键布局属性双写 / 类定义作用域（含 custom-tab-bar），逐条读数看 `node tools/check.js` 自己的输出。
  **仍然只有人工清单和本 skill 兜着的**是语义层那几条：硬编码色值与新 token 未登记、四态（空/加载/错误/边界）是否覆盖、触控目标尺寸与信息密度、文案语气（概率语气只在个别套件按写入集查）。已存在的色值/尺寸类套件（`tools/swx1-style-gates-test.js`、`tools/swx2-style-gates-test.js`、`tools/style-semantics-test.js` 等）都是**批次写入集内**的门——新建一个页面不在它们的覆盖里。所以别把"过了 check.js"当成"过了 UI 规范"，也别把"某个页面过了 swx2"当成"全仓合规"。
- `node cloudfunctions/trailApi/smoke-test.js`、`tools/*-test.js`：领域与逻辑回归（改过 domain 后还要 `node tools/sync-lab.js`，见根 `AGENTS.md`）。
- 真机驱动与恢复：`docs/e2e-mp/README.md` + `docs/e2e-mp/automation-playbook.md`（会话僵死、`quit` vs `close`、旧句柄"点击成功但没作用"、`busy` 期间空按钮、云函数部署与超时继承、退出码语义）。
