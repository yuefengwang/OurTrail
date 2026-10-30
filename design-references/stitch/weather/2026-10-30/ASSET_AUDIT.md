# 资产审计 · Stitch 天气原型的依赖与可移植性

回答三个问题：**这些 HTML 依赖什么？哪些字节在仓库里？哪些只能当视觉参考？**

审计对象：`raw/` 下 11 份 `code.html` + 1 份 `DESIGN.md`。截图与 ZIP 不涉及运行时依赖。

## 结论摘要

| 问题 | 答案 |
|---|---|
| HTML 能离线打开吗？ | **不能。** 样式几乎全部来自 Tailwind CDN，字体与图标来自 Google Fonts。 |
| 运行时有没有网络请求？ | **没有业务请求。** 没有 `fetch`/`XHR`/`WebSocket`；网络只用于加载 CDN 资源。 |
| 有没有图片资源？ | 只有 **1 处**：`ourtrail_v16_3` 的 CSS `background-image`，指向 `lh3.googleusercontent.com`。**该图未随导出物提供，仓库里没有它的字节。** |
| 图表是图片还是代码？ | 全部是 **内联 SVG + CSS**（11 份 HTML 里 `<canvas>` = 0，`<img>` = 0）。 |
| 图标是什么？ | **Material Symbols 字体 ligature**，不是 SVG，也不是图片。 |
| 能直接搬进小程序吗？ | **不能。** 需要按 WXML/WXSS 重写；可复用的是信息架构、形态与色值决策，不是代码。 |

## 一、外部依赖清单

| # | 主机 | 用途 | 出现份数 | 仓库内是否有字节 | 性质 |
|---|---|---|---|---|---|
| 1 | `cdn.tailwindcss.com` | 运行时生成全部 utility 样式 | 11/11（`ourtrail_v7` 另带 `?plugins=forms,container-queries`） | 否 | **运行时网络**；离线后页面基本无样式 |
| 2 | `fonts.googleapis.com` | 字体 CSS（Hanken Grotesk / Manrope 多字重子集）与 Material Symbols Outlined CSS | 11/11（全批共 46 处引用） | 否 | **运行时网络** |
| 3 | `fonts.gstatic.com` | 字体的实际字形文件（preconnect + woff2） | 11/11（共 11 处 preconnect/引用） | 否 | **运行时网络** |
| 4 | `lh3.googleusercontent.com` | `ourtrail_v16_3` 天穹带的 CSS 背景图（`aida-public/...`） | 1/11 | 否 | **缺失 / 不可核验**：URL 形似签名链接，可能已过期；仓库内无字节，无法判断原图内容 |
| 5 | `www.w3.org` | SVG `xmlns` 命名空间 | 3 处 | — | 不是网络请求，只是命名空间字符串 |

补充：

- 所有 HTML 都声明 `body { min-height: max(884px, 100dvh) }`，说明它们是按约 884px 高、780px 宽的画布导出的长页截图，
  不是设备真机尺寸。
- 11 份 HTML **都没有 `<title>`**；`viewport` 统一 `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover`。
- 11 份 HTML 都带 `data-deeptranslate-injected="true"` 与一个隐藏的翻译悬浮框，
  说明这些文件在浏览器里被翻译扩展处理过。**字节原样保留**，但"这是纯 Stitch 导出物"的说法不成立。

## 二、逐文件视觉基元统计（实测）

| 文件 | Material Symbols | 内联 `<svg>` | `backdrop-blur` | 渐变背景 | `rgba()` | 任意阴影 | 内联 `style=` | `<script>` |
|---|---|---|---|---|---|---|---|---|
| `ourtrail_v7` | 21 | 1 | 3 | 1 | 6 | 2 | 2 | 2 |
| `ourtrail_v12_1` | 9 | 1 | 3 | 0 | 5 | 1 | 2 | 3 |
| `ourtrail_v12_2` | 25 | 1 | 3 | 1 | 10 | 2 | 8 | 3 |
| `ourtrail_v14_72` | 21 | 2 | 2 | 0 | 10 | 2 | 14 | 2 |
| `ourtrail_72_v14` | 6 | 2 | 1 | 0 | 5 | 1 | 3 | 2 |
| `ourtrail_v16_1` | 32 | 3 | 2 | 0 | 12 | 2 | 6 | 3 |
| `ourtrail_v16_2` | 27 | 1 | 2 | 0 | 12 | 2 | 6 | 3 |
| `ourtrail_v16_3` | 26 | 1 | 3 | 9 | 10 | 2 | 10 | 3 |
| `ourtrail_v18_1` | 12 | 2 | 4 | 0 | 13 | 1 | 8 | 3 |
| `ourtrail_v18_2` | 19 | 0 | 4 | 0 | 9 | 1 | 6 | 2 |
| `ourtrail_v18_3` | 10 | 1 | 4 | 0 | 9 | 1 | 5 | 2 |

`<script>` 全部用于原型交互与 Tailwind 配置，**没有一处发起数据请求**。
脚本内容可概括为：航点详情（v12_1）、全屏模态（v12_2）、tab 高亮（v16_*）、披露块开关（v16_2）、分组按钮（v18_1）。

## 三、依赖分类

### A. 已内联 / 随文件提供（bundled）

- 全部配色定义（`tailwind.config` 内联 JS 对象，47 色）。
- 全部布局与间距（Tailwind class）。
- 内联 `<svg>` 图形（共 15 处，画太阳弧、图表轮廓、插画线条等）。
- CSS 渐变、`box-shadow`、`border` 定义。
- 全部文案与演示数据。
- 原型交互脚本。

这些**字节可用**，但形式是 HTML/CSS/JS，不能直接进小程序。

### B. 运行时网络（network）

- Tailwind CDN：所有样式。**去掉它，页面只剩裸 HTML**。
- Google Fonts：Hanken Grotesk、Manrope、Material Symbols Outlined。
- 影响：这些 HTML 只能"联网观看"，不能作为离线交付物；也不能作为"小程序里长这样"的证据。

### C. 缺失 / 不可核验（missing-or-unverified）

| 项 | 状态 | 说明 |
|---|---|---|
| `lh3.googleusercontent.com` 天穹带底图 | **缺失** | 未随导出物提供；URL 可能过期 |
| Stitch 项目 ID | **未知** | 导出物中没有 |
| 截图渲染环境（浏览器/设备/DPR） | **未知** | 只能从 780px 宽、884px 画布推断 |
| 截图中蓝色控件的来源 | **未裁决** | 见 `DESIGN_CONFLICTS.md` A3 |
| 原型 JSON / 组件树 | **缺失** | 导出物只有 HTML + PNG |

### D. 只能当视觉参考、不可移植（visual-reference-only）

| 项 | 为什么不可移植 | 替代做法 |
|---|---|---|
| Material Symbols 字体图标 | 小程序不支持字体 ligature 图标 | 用 `components/icon/` 的 path 图标或新画 `iconfont`/SVG |
| `backdrop-filter: blur()` | WXSS 支持有限、低端机性能差 | 纯色/渐变遮罩层 |
| Tailwind utility 类（`p-space-md`、`text-headline-md`…） | 小程序无构建步骤、无 Tailwind | 写成语义 class + `app.wxss` token |
| CSS `linear-gradient` 天空带 | 可移植（WXSS 支持渐变），但需重画尺寸 | 直接写 WXSS 渐变或 SVG |
| 外部背景图 | 无字节 | 自绘渐变/程序化天空带 |
| 内联 SVG 图表 | 尺寸与坐标系绑定 780px 画布 | 用 `utils/*-svg.js` 按真实数据生成 |
| `dvh` / `env(safe-area-inset-*)` | 部分支持，历史坑多 | 用现有 `tabbar-safe` / padding 方案 |
| 翻译扩展注入节点 | 与产品无关的 DOM | 忽略，不要照抄 |

## 四、可复用什么 / 必须重写什么

| 可复用（作为设计输入） | 必须重写（作为实现工作） |
|---|---|
| 信息架构与区块顺序（每 tab 有哪些块、按什么顺序） | 全部样式（WXSS） |
| 各组件的形态（卡、chip、指标带、浮层、全屏图） | 图标（自建 path 集） |
| 配色与字阶（作为**候选决策**，不是既定规范） | 字体（系统栈或自托管子集） |
| 文案结构与措辞风格 | 图表（真实数据 + canvas/SVG 运行时生成） |
| 交互原型说明（点击/展开/切换的意图） | 事件绑定（WXML `bindtap` 等） |
| 内联 SVG 的图形语义（画的是什么） | SVG 的坐标与尺寸（需按 375/390 重算） |
| 空态/有数据态的成对设计 | 浮层与全屏的页面路由 |

## 五、明确不做的转换

本轮**没有**也不会：

- 把 HTML 转成 WXML/WXSS；
- 下载或内嵌字体、Tailwind 运行时；
- 把截图切成九宫格素材；
- 声称这些 HTML"可以离线复现屏幕效果"（不能）；
- 声称原型与现有实现"视觉一致"（未做对照）。

## 六、验证状态

| 项 | 状态 |
|---|---|
| 外部 URL 清单 | **已实测**（`grep` 全量提取，见上表） |
| 是否含 `fetch`/`XHR`/`WebSocket` | **已实测为 0** |
| 是否含 `<img>`/`<canvas>` | **已实测为 0 / 0** |
| 外部图片是否存在于仓库 | **不存在**（已确认 `raw/` 内无图片资源，仅 `screen.png`） |
| 在浏览器中打开并逐像素比对 | **未做（UNVERIFIED）** |
| `lh3` 图片当前是否可访问 | **未探测**（避免引入网络依赖；且签名 URL 不可作为长期依据） |
