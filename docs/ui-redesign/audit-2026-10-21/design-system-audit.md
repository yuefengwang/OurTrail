# 设计系统审计（源码定义 vs 截图观察）

> 口径：「源码」= `app.wxss`/组件/页面 WXSS 的静态事实（只读审计实测）；「截图」= 本轮真实运行截图中观察到的效果。无法从源码确认的标注「未确认」。

## 1. 颜色

### 源码（token 全表，`app.wxss:4-77`，全部定义在 `page` 选择器）

| 组 | token: 值 |
|---|---|
| 品牌/中性 | `--forest:#163E35`、`--leaf:#D6EA8A`、`--paper:#F6F3EC`（2026-10-16 由 #F5F5F0 暖化，注释警告 muted 对比度 ≈4.6:1 勿再调）、`--white:#FFFFFF`、`--ink:#202A26`、`--muted:#5F6E66`、`--line:#DEE3DB`、`--surface:#FFFFFF` |
| 语义 | `--danger:#B43D3B`、`--warning:#8C5A12`、`--info:#346583`、`--success:#276145` |
| 编辑式表层 | `--forest-deep:#122E28`、`--stone:#EDE9DE`、`--stone-line:#DCD5C4`、`--scrim-hero`/`--scrim-top`（两条渐变） |
| 天相窗口 | `--golden:#D6A33C`、`--blue-hour:#6C7C93` |
| 图表图例 | `--chart-showers:#2E8B8B`、`--chart-wind:#3D8A7F`、`--chart-gust:#9FC4D8`、`--chart-in-cloud:rgba(180,118,26,.65)`、`--chart-ramp`（5 段渐变） |
| 派生 | `--forest-soft:#ECF0EF`、`--success-soft:#EBF0EE`、`--warning-soft:#F4F0E9`、`--danger-soft:#FAF1F1`、`--info-soft:#F0F3F6`、`--on-forest-muted:#D0D8D7`、`--on-forest-line:#4E6C65`、`--control-line:#8C9791`、`--leaf-on-forest:#2D533F` |

导航栏：`#163E35` 底白字（`app.json:26-28`）；TabBar 白底、未选 `#5F6E66`、选中 `#163E35`。

### 截图观察
- 纸面底 + 白卡 + 森林绿导航栏/主按钮的体系在 21 页截图中一致（HOME/NOTICES/ME/WEATHER-HUB/DISCOVER/ROUTES/WORKSPACE…）。
- 深底反白 hero（VEHICLE、weather real-query 顶部）与纸面卡并置，对比强但过渡自然。
- **不一致**：`window.backgroundColor` 仍是 `#F5F5F0`（ISS-010）， Overscroll 区可见旧底。

### 色值债（实测当前数量）
WXSS 未走 `var()` 的原始色值 **17 处**：`app.wxss` 1（`.hero-date`）、`overlay.wxss` 2、`privacy-popup.wxss` 7（组件已注销全局注册，保留未删）、`custom-tab-bar/index.wxss` 5（E-12 刻意自包含，豁免）、`weather.wxss` 1、`cloud-field-poc.wxss` 1。**严格债务 6 处**。另有 WXML 中 `color="#hex"` 属性 **53+ 处**（icon 组件颜色不能 CSS 继承的直接后果，`icon.js:2` 注释自证）。canvas/SVG 侧另有双写字面量色板（meteogram-svg 43、cloud-field-svg 24、oi-presentation 17 等，属平台限制）。`!important` 全仓 **0 处**。

## 2. 字体

| 项 | 源码 | 截图观察 |
|---|---|---|
| family | 全仓仅 4 处：全局 `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`；等宽 `.code-text` | 与系统默认渲染一致，无自定义字体加载 |
| 字号层级 | token 4 档（12/14/16/18）+ 全局类 8 档（kicker 11、small 12、card-label 15、section-title 16、lede 15、page-title 28、display 30、body 14） | 标题/正文/辅助三级清晰 |
| 字面量碎值 | 9.5/10/10.5/11/12/12.5/13/15/17/22/24/26/28/30 px 共 14 种散落（weather 页最碎：10/10.5/11/12.5/13 密集） | 天气页图表区字号明显小于全局体系，截图可辨 |
| rpx 残留 | `privacy.wxss` 27rpx（E-09 已知账）、`privacy-popup.wxss` 34/27/24/32rpx | privacy 页正文字号与全站 px 口径不一致（截图可对照） |
| 字重 | 400/500/600/700 四档；700 仅 `.page-title` | 层级靠字重+颜色而非字号堆叠，总体克制 |

## 3. 间距

- 源码：`.page` padding `24px 20px 32px`；`.stack` gap 16 / `.stack-gap3` 12 / `.stack-sections` 28（编辑式章节呼吸）；`.card` padding 16；`.cluster` gap 8；divider 上下 16。
- 截图观察：卡片内 16、卡间 16/12、章节间 28 的节奏在列表页（ROUTES/DISCOVER/NOTICES）读感统一；weather 页内部自建间距体系较多（`.oi-*`/`.num-sheet` 等），与其他页不完全同构。

## 4. 形状

- 源码：`--radius-tag:5`、`--radius-button:8`、`--radius-card:14`、`--radius-sheet:20`；chip 999px 药丸；按钮 min-height 48（`--action-height`）、触控目标 44（`--touch-target`）；分割线 1px `--line`/`--stone-line`。
- 截图观察：圆角卡片 + 药丸徽标/chip + 8px 按钮体系全站一致；弹层 sheet 20px 大圆角与卡片 14px 分层正确；输入框为下划线式（非框式），与按钮形态语言不同源（有意选择，截图可辨）。

## 5. 组件（16 个自定义组件）

| 组件 | 复用充分度 | 备注 |
|---|---|---|
| `status-panel` | ★★★ 20 页中 16 页在用 | 五态（empty/loading/error/denied/offline）+ action，是全站四态单源 |
| `icon` | ★★★ 19 个文件 | 唯一图标方案；颜色经属性传入 |
| `overlay` | ★★★ 多页 | sheet/dialog 两形态；遮罩吞点击是正确行为 |
| `form-field` | ★★★ 表单骨架 | label + hint/error + 插槽；**必填无星号**，靠 error 文案 |
| `activity-card` | ★★★ home/discover | 普通/featured 两态 |
| `content-editor` | ★★ editor 专用 | 图文分离编辑（见 flows §1） |
| `roster-panel`/`transport-panel`/`field-panel` | ★★ workspace/staff 常驻 | 组织协作重活全在这三个面板 |
| `person-row`/`profile-gate`/`route-profile`/`meteogram`/`space-time`/`roam-scrubber`/`privacy-popup` | ★ 单场景 | privacy-popup 已注销全局注册（死组件保留） |

**重复实现**：① `.activity-card__info` 样式在 `app.wxss:314` 与 `home.wxss:11-12` 两份（后者注明 discover.wxss 还有第二份拷贝——三处）；② 4 个 Tab 页各自写底部留白 calc；③ `weather.wxml` 自建多套卡片类（timeline-card/cloud-field-card/oi-card/num-sheet）未入全局类体系。

**互相覆盖风险（实证清单）**：`.page`（4 tab 页 + poc 覆盖 padding-bottom/padding）、`.section-head`/`.section-title`（weather 覆盖为横向 + 字号收回 14px，自述「承重覆盖」）、`.chip`（editor 改 padding 13px、poc 完全另一套）、`.callout-title`（activity 15px）、`.textarea.slim`/`.code-text`（me 覆盖）。死声明已有清理记录（B-11 按钮禁用态顺序、overlay 双写等）。

## 6. 图标

- 唯一方案：运行时 SVG path → base64 data-URI → `<image>`（`components/icon/icon.js`）。25 个线性 path（24 具名 + fallback）+ 2 个品牌图形（trailMark/trailArt）。默认 24 viewBox、stroke 1.75、round 线帽。
- 尺寸实际用 16/18/20/21/22/24；`custom-tab-bar` 21、`overlay` 22。
- 语义一致性：线性风格统一；但**颜色散**——53+ 处 `color="#hex"`（forest/muted/白/语义色按 kind），改主题时是主要工作量。
- 截图观察：图标与文字基线对齐良好；tabBar 图标选中/未选双色正确。

## 7. 页面布局与状态设计

- 布局范式：编辑式头部（kicker + page-title + section-sub）→ 章节卡 → 列表；固定操作区 `.sticky-action`（signup/editor/route-edit）；分区锚点横滚（activity 详情）。
- 状态设计：四态 `status-panel` 单源；empty 必须「为什么空 + 下一步」（抽查截图：HOME 空态三套文案、ROUTES「路线库还是空的」、DISCOVER 三套均合格）；`weather-hub.wxml:74` 裸文本空态 + `:80/:107` callout 顶替 error 是**已登记 DEBT**。
- 截图观察到的缺口：报名提交失败零反馈（ISS-001）；ME 保存仅 2 秒闪烁（ISS-006）。

## 8. 适配

- 安全区：`.sticky-action` 含 `env(safe-area-inset-bottom)`；weather-chart 横屏用左右 inset；Tab 页留白含底部 inset。
- 屏幕尺寸：未做多机型实测（本轮统一 375px 模拟器视口）；长文本/长列表在 weather 页（OI 列表按日分组）与报名（81 候选）是已知压力点（ISS-002/008）。
- `100dvh`/`color-mix()`/`:root` 零使用（保守约定，`skylineRenderEnable:false` ⇒ WebView 渲染，现代 CSS 可用性随客户端内核变化，无法从仓库证真）。

## 9. 对重设计的影响（摘要）

1. **token 层已足够作为新设计系统的底座**：色/字/距/形四层齐备，新增语义只需登记（规则 #3）。
2. **图标换色是最大机械工作量**（53+ 硬编码 color），任何新配色方案都要连带处理。
3. **四个 Tab 页留白 + weather 页级覆盖 + chip 三份定义**是重构时最可能踩的层叠坑，建议随布局重构一并收口。
4. **`form-field` 无必填星号**：新设计若要必填标记，需全局一次改动（涉及全部表单页）。
5. 截图与源码的一致性总体高（纸面/卡/徽标/按钮体系），主要偏差在 weather 页自建体系与字号碎值。
