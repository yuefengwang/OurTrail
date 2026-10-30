# 设计冲突记录 · Stitch 天气原型 vs OurTrail 现状

**本文只做记录，不做裁决。** 它不提出"应该改成什么"，也不选边。
本轮禁止改任何生产代码、色值、设计系统；因此下面所有"差异"都只是待办清单的输入。

证据来源共四类，本文一律标明：

- **DESIGN.md** — `raw/alexandria/DESIGN.md`（1,581 B）
- **HTML** — 11 份 `raw/ourtrail_*/code.html` 内的 Tailwind 主题与 class 用法
- **PNG** — 11 张 `raw/ourtrail_*/screen.png` 的像素实测（Pillow 统计主色 + 分区采样）
- **现状** — `miniprogram/app.wxss`、`.agents/skills/ourtrail-ui/references/design-system.md`

> **前置声明（重要）**：上一轮实施规格
> `docs/superpowers/specs/2026-10-30-weather-stitch-redesign.md` §2 写过
> "保留 OurTrail，不引入 Stitch 蓝"，并把 PNG 里的蓝色判为"渲染偏差"。
> 那是**上一轮的一个未经验证的判断**，本轮**不把它当作前提**，也不据此关闭"蓝"这条分支。
> 反向同样成立：本轮也没有任何证据表明蓝色应当被采纳。
> 现行 token 是**现状**，不是不可改的约束；`app.wxss` 的"新语义色只能进 app.wxss 并登记"
> 是**入口规则**（新色怎么进来），不是"不许有新色"。

---

## A. Stitch 客观表达了什么

### A1. `alexandria/DESIGN.md`

标题 **"Alexandria — The Digital Curator"**。要点（原文摘要，非解读）：

| 维度 | 内容 |
|---|---|
| Primary | `#094cb2` —— 明确限定为"链接 / 主操作 / 焦点态"，不作为大面积填充 |
| Tertiary | 档案金 `#6d5e00` |
| 边线 | "No-Line Rule"：**不用 1px 分隔线**，层级靠色调表面分层 |
| 表面 | 多级 tonal surface tiers |
| 玻璃 | 80% 不透明度 + 20px blur 的 glassmorphism |
| CTA | primary → primary_container 渐变 |
| 字体 | 标题 **Noto Serif**、正文 **Inter**、标签 **Public Sans** |
| 阴影 | extra-diffused（弥散）模态阴影 |
| 圆角 | 最小档 `sm` |

**关键事实**：11 份 HTML 中**没有任何一处**引用 "Alexandria"，也没有任何 class 名或注释提到它。
DESIGN.md 与同目录 HTML 在字体族、边线规则、主色上都不一致。它是否属于这批页面，**未知**。

### A2. 11 份 HTML 的主题（11 份完全相同）

`tailwind.config` 的 `theme.extend`，47 个颜色键，逐份一致：

| 角色 | 值 | 出现处 |
|---|---|---|
| primary | `#00231a` | 深绿近黑，主按钮/选中态文字 |
| primary-container | `#13392e` | 深绿，底栏/CTA 底 |
| secondary | `#006c49` | 森林绿（数据强调） |
| secondary-container | `#6cf8bb` | 薄荷绿（徽标底） |
| secondary-fixed | `#6ffbbe` | 薄荷绿（选中 tab 下划线） |
| tertiary | `#2d1900` | 深棕 |
| tertiary-container | `#4a2c00` | 棕 |
| tertiary-fixed | `#ffddb8` | 浅金（地点标签） |
| surface / background | `#f9f9ff` | 冷白偏蓝 |
| surface-container-lowest | `#ffffff` | 白卡 |
| surface-container-low | `#f0f3ff` | 冷灰蓝 |
| surface-container | `#e7eefe` | 冷灰蓝 |
| surface-container-high | `#e2e8f8` | 冷灰蓝 |
| surface-container-highest / variant | `#dce2f3` | 冷灰蓝 |
| on-surface | `#151c27` | 近黑（正文） |
| on-surface-variant | `#414845` | 灰绿（次文本） |
| outline | `#717975` | 中灰绿 |
| outline-variant | `#c1c8c3` | 浅灰绿（**用于 1px 边线**） |
| error | `#ba1a1a` | 红 |

其余结构：

- **字体**：`Manrope`（display-lg / headline-* / metric-val） + `Hanken Grotesk`（body / title / label / metric-label）。
- **字阶**：`label-caps` 10/12 700 +0.06em；`metric-label` 11/14 600 +0.04em；`body-sm` 12/16；
  `body-md` 14/20；`title-md` 15/20 600；`body-lg` 16/24；`headline-sm` 17/24 600；
  `headline-md` 20/28 600；`headline-lg` 24/32 700；`metric-val` 22/26 700；`display-lg` 32/40 800。
- **圆角**：`DEFAULT` 2px、`lg` 4px、`xl` 8px、`full` 12px。
- **间距命名**：`space-xs` .25rem / `space-sm` .5rem / `gutter`·`space-md` .75rem / `margin`·`space-lg` 1rem / `space-xl` 1.5rem。
- **图标**：Material Symbols Outlined 字体 ligature（每份 6–32 处），**不是 SVG**。
- **图表**：无 `<canvas>`、无 `<img>`；全部是内联 SVG + CSS 渐变 + DOM 条形。
- **交互 JS**：只有原型级的内联脚本（航点详情、全屏模态、tab 高亮、披露块开关），
  **没有任何 fetch / XHR / WebSocket**。
- **页面元信息**：全部 `viewport-fit=cover`；**11 份都没有 `<title>`**；
  `lang` 为 `zh-CN`（8 份）或 `zh-Hans`（v18_1/2/3）。
- **后处理痕迹**：11 份 HTML 都带 `data-deeptranslate-injected="true"` 与一个隐藏的
  `data-deeptranslate-ui` 悬浮框。说明这些 HTML **在浏览器里被翻译扩展处理过**，
  不是纯 Stitch 原始导出物。这不改变布局，但改变"文件是否原样"的语义——
  它们是"导出后被打开过的 HTML"，字节仍然原样保留。
- **另有三处零散差异**（不影响主题）：`ourtrail_v7` 的 Tailwind CDN 带 `?plugins=forms,container-queries`；
  `rounded-[1px]` 出现 4 次；`13px`/`9px` 两个不在字阶上的任意值。

### A3. 11 张 PNG 的像素实测

宽 780 px（`ourtrail_v16_3` 为 784 px），高 1768–4460 px。各屏主色与"主控件色"：

| 屏 | 尺寸 | PNG 主色（面积占比最高） | 顶栏 / 主控件实测色 | 与 HTML 主题 |
|---|---|---|---|---|
| `ourtrail_v7` | 780×3808 | `#1554ba` 25.9%、`#1e59bf` 25.0%、`#3366cc` 14.7%，深底 `#071b15` | 底部 tab 采样 `#1b1c1d`，另有少量 `#094cb2` | **不一致**（蓝渐变） |
| `ourtrail_v12_1` | 780×1768 | `#094cb2` 56.4% | 顶栏 `#094cb2` | **不一致** |
| `ourtrail_v12_2` | 780×2928 | `#c1f9e4`、`#006c49`、`#d88a00` | tab `#c1f9e4` + `#00231a` + `#13392e` | 一致（绿系） |
| `ourtrail_v14_72` | 780×3210 | `#006c49`、`#b6f2e3`、`#d3fdea` | tab `#13392e`；CTA `#13392e`+`#6cf8bb` | 一致（绿系） |
| `ourtrail_72_v14` | 780×2702 | `#3366cc` 13.2%、`#006c49` 3.5%、`#094cb2` 3.3% | 档位 chip `#3366cc` | **混用** |
| `ourtrail_v16_1` | 780×4236 | `#006c49` 9.5%、`#653e00`、`#4a2c00`、`#6ffbbe` | tab `#13392e` / `#00231a` | 一致（绿系） |
| `ourtrail_v16_2` | 780×3830 | `#006c49` 41.1%、`#005a73` 9.0% | tab `#00231a` | 一致（绿系） |
| `ourtrail_v16_3` | 784×4460 | `#094cb2` 35.3%、`#f9e37a` | tab 区 `#094cb2` 6,608 px；天穹带同为 `#094cb2` | **不一致** |
| `ourtrail_v18_1` | 780×1768 | `#094cb2` 77.9%、`#006c49` 6.5% | 底栏主按钮 `#094cb2` | **不一致** |
| `ourtrail_v18_2` | 780×1768 | `#094cb2` 63.1%、`#fdf4ca`、`#f9e37a`、`#6d5e00` | 底栏主按钮 `#094cb2` | **不一致** |
| `ourtrail_v18_3` | 780×1768 | `#094cb2` 82.5% | 底栏主按钮 `#094cb2` | **不一致** |

**分布**：蓝系 6 屏（v7 渐变、v12_1、v16_3、v18_1/2/3）、绿系 4 屏（v12_2、v14_72、v16_1、v16_2）、混用 1 屏（72_v14）。

**两个精确匹配**（不是"看起来像"，是色值完全相同）：

- `#094cb2` = DESIGN.md 的 **Primary**，在 PNG 里大量出现，在 HTML 主题里**一次都没有**。
- `#6d5e00` = DESIGN.md 的 **Tertiary**（档案金），在 `ourtrail_v18_2` 的 PNG 里出现，HTML 主题里也没有。

**同元素反证**：`ourtrail_v18_2/code.html` 的"新建路线"按钮 class 是 `bg-primary`，
其主题 primary = `#00231a`（深绿）；而同一位置的 PNG 像素是 `#094cb2`（蓝）。
这不是配色微差，是**同一个按钮换了色系**。

**三条关于"为什么"的假设（均未证实，不作结论）**：

- **H1 截图与 HTML 来自不同主题的时刻**：截图生成时项目使用的是 Alexandria（蓝 + 档案金），
  HTML 导出时项目已换成森林绿主题。支持：`#094cb2`/`#6d5e00` 精确命中 DESIGN.md 两个 token；
  与 HTML 主题零交集。
- **H2 导出混入了两套设计系统**：同批资产里 DESIGN.md、HTML、PNG 分属不同来源，被拼在一起。
  支持：同上，且 DESIGN.md 的字体/边线规则与 HTML 完全不符。
- **H3 蓝色是渲染器默认值**：**证据最弱**。渲染器默认色无法解释
  `#094cb2` 与 Alexandria primary 逐位相同、`#6d5e00` 与 Alexandria tertiary 逐位相同，
  也无法解释 11 屏按"整屏"而不是"整批"分裂成蓝/绿两组。

**可推翻 H1/H2 的观察**：若能在 Stitch 项目侧证实"截图与 HTML 是同一时刻导出的"，H1 即不成立。
本轮无法访问 Stitch 项目，因此记为 UNVERIFIED。

---

## B. OurTrail 现状（只陈述，不评价）

### B1. `miniprogram/app.wxss` 的 token（`page` 块，行 5–77）

| 类别 | token |
|---|---|
| 品牌 | `--forest #163E35`、`--leaf #D6EA8A`、`--forest-deep #122E28` |
| 纸面/表面 | `--paper #F5F5F0`（冷近白）、`--white #FFFFFF`、`--surface #FFFFFF`、`--stone #EDEFEA` |
| 文本 | `--ink #202A26`、`--muted #5F6E66` |
| 线 | `--line #DEE3DB`、`--stone-line #D9DED7`、`--control-line #8C9791`、`--on-forest-line #4E6C65` |
| 语义 | `--danger #B43D3B`、`--warning #8C5A12`、`--info #346583`、`--success #276145` + 各自 `-soft` 底 |
| 天相 | `--golden #D6A33C`、`--blue-hour #6C7C93` |
| 图表 | `--chart-showers #2E8B8B`、`--chart-wind #3D8A7F`、`--chart-gust #9FC4D8`、`--chart-in-cloud rgba(180,118,26,.65)`、`--chart-ramp` 五档灰阶 |
| 字号 | `--text-caption 12px`、`--text-body 14px`、`--text-input 16px`、`--text-title 18px` |
| 圆角 | `--radius-tag 5px`、`--radius-button 8px`、`--radius-card 14px`、`--radius-sheet 20px` |
| 尺寸/动效 | `--touch-target 44px`、`--action-height 48px`、`--motion 180ms` |

### B2. 字体与排版

- `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;`
  —— 系统字体栈，**没有自托管字体**。
- 行之有效的字号档：`.page-title` 24/700、`.section-title` 16/700、`.card-label` 15/600、
  正文 14/22、`.small` 12/18、`.field-label` 13/400。全部 ≥12px。
- `design-system.md` 记录的字号 scale 为 **12 / 14 / 16 / 18 / 28**（`.card-label` 15px 是已登记的例外）。

### B3. 形态与层次

- 白卡 + **1px 细线**（`--line`）+ 冷近白底（`--paper`）；森林绿"只做品牌动作与 hero 压底"，
  `--leaf` 只留徽标 / hero / 协作入口（`app.wxss` 注释原文）。
- 全仓**零 `backdrop-filter`**（WXSS 支持有限，且历史上以纯色层代替）；
  阴影用量克制，没有弥散大阴影体系。
- 圆角 5/8/14/20，比 HTML 的 2/4/8/12 整体大 3–8px。

### B4. 图标与图表

- `components/icon/`：**30+ 条内联 path 数据**，运行时生成 SVG data URI 渲染为 `<image>`；
  颜色必须显式传参（不能继承 CSS）。**不是字体图标**。
- 图表：`components/meteogram/` 用 `type="2d"` canvas；`utils/meteogram-svg.js`、
  `utils/cloud-field-svg.js` 生成 SVG 字符串。全部由真实数据计算，**没有静态示意图**。

### B5. 现行规则（与本文相关者）

- 「禁止发明新色值」：新语义色**只能**在 `app.wxss` 定义并登记进 `design-system.md`。
  —— 这是**入口规则**。
- 天气类文案必须用概率/条件语气，禁止断言式承诺（铁律 12）。
- 不得把演示数据当真实数据；不得从显示标签反推业务状态。

---

## C. 差异清单（A vs B）

每条只写"差在哪 + 证据"，不写"该改成什么"。

| # | 维度 | Stitch（HTML / 证据） | Stitch（PNG / 证据） | OurTrail 现状 | 冲突性质 |
|---|---|---|---|---|---|
| C1 | 品牌主色 | `#00231a` / `#13392e`（深森林绿） | 6 屏 `#094cb2`（蓝）+ 1 屏 `#3366cc` | `--forest #163E35` | **三方不一致**：HTML 绿、PNG 蓝、现状绿但不同值 |
| C2 | 强调/次要色 | `#006c49`（绿）、`#6cf8bb`/`#6ffbbe`（薄荷） | 绿系屏用 `#006c49`；蓝系屏用 `#094cb2` | `--leaf #D6EA8A`（黄绿） | 色相差最大的一项：薄荷 vs 黄绿 |
| C3 | 页面底色 | `#f9f9ff`（冷白偏蓝） | 对应区域接近 `#f9f9ff` | `--paper #F5F5F0`（冷近白偏暖灰） | 色温不同，明度接近 |
| C4 | 卡片表面 | `#ffffff` + 冷灰蓝分层（低/中/高 4 档） | 同 | `#FFFFFF` + `--stone`/`--stone-line` 两档 | 档位数量不同（4 vs 2） |
| C5 | 字体族 | Manrope + Hanken Grotesk | 视觉为几何无衬线，中文回退系统字体 | 系统字体栈 | 若采纳需自托管字体包（小程序体积/加载成本）；中文两种做法都回退系统 |
| C6 | 字号档 | 10 / 11 / 12 / 14 / 15 / 16 / 17 / 20 / 22 / 24 / 32 | 同 | 12 / 13 / 14 / 15 / 16 / 18 / 24（+28 已降档） | HTML 有 **10px 与 11px** 两档低于现状最小 12px；`17/20/22/32` 是现状没有的档 |
| C7 | 圆角 | 2 / 4 / 8 / 12 | 同 | 5 / 8 / 14 / 20 | 整体小 3–8px；`12px` 在 HTML 是最大档，在现状是 card 之下 |
| C8 | 层次手法 | 1px 边线（`outline-variant`）+ 冷表面分层 + `backdrop-blur` 1–4 处/页 | 同 | 1px `--line` + 两档石色；**零 blur** | 边线：一致；表面档位：少；玻璃：无 |
| C9 | 图标 | Material Symbols 字体 ligature（6–32/页） | 同 | 自建 30+ path 图标组件 | **不可直接复用**（字体 ligature 在小程序不可用） |
| C10 | 图表实现 | 内联 SVG + CSS 渐变 + DOM 条形，静态演示 | 同 | canvas + 运行时生成 SVG，真实数据 | 渲染路径不同；原型不可移植 |
| C11 | 信息密度 | 单 tab 长页 2700–4460 px（@780 宽） | 同 | 单 tab 一屏内可滚完，块数明显更少 | 若照搬，页面长度约翻倍 |
| C12 | 交互形态 | 全屏云场、底部浮层、披露块、时间 chip、航点详情 | 静态截图只能看到结果态 | 已有 tab / 浮层 / 时间轴 / 全屏 chart 页 | 需逐项对照，不能合并成"照搬" |
| C13 | 数据与文案 | 精确数值断言（含氧 53%、−0.65 °C/100 m、Bortle 2、11h44m、"晨昏照金山"） | 同 | 概率/条件语气 + 真实计算 | **直接冲突**：原型写法不能进生产 |
| C14 | 设计系统文档 | 无（HTML 不引用 DESIGN.md） | — | `design-system.md` + `app.wxss` | 原型没有对应的规范文档 |
| C15 | 规范文件 | `alexandria/DESIGN.md`：蓝 + 档案金 + 无 1px 线 + 80% 玻璃 + Noto Serif/Inter/Public Sans | 蓝系屏与其主色精确匹配 | 绿 + 1px 线 + 无玻璃 + 系统字体 | **最根本的一条**：DESIGN.md 与 HTML 互相否定 |

### C16. 三处内部矛盾（同一批资产内部，与现状无关）

1. **HTML ↔ PNG 的字段级矛盾**：`ourtrail_v18_2` 的"新建路线"按钮 `class="bg-primary"`，
   primary=`#00231a`；PNG 同一按钮为 `#094cb2`。两侧都能量化，不是观感差异。
2. **`alexandria/DESIGN.md` ↔ 全部 HTML**：字体族、边线规则、主色三项全不同，且 HTML 零引用。
3. **`ourtrail_v18_1` 的 PNG 文本乱码**：截图内中文为 mojibake；同目录 `code.html` 文本正常。
   该 PNG 只能作为布局参考，**不能用来判断任何文案**。

### C17. 版本关系的证据强度

- `v16_1`/`v16_2`/`v16_3` 共用同一外壳与四 tab —— **可直接观察**（`observed`）。
- `v14_72` 的"全屏查看" ↔ `72_v14` 全屏页 —— 由文案推断（`candidate`）。
- `v12_2` 的"全屏查看" ↔ `v12_1` —— 由文案推断（`candidate`）。
- `v18_1`/`v18_2`/`v18_3` 同结构不同数据 —— 结构可直接观察，**哪一版代表最终形态未裁决**。
- 目录名的版本号（v7 < v12 < v14 < v16 < v18）**只作线索**，不作结论；
  `v14_72` 与 `72_v14` 的命名互为倒置，说明命名本身不可靠。

---

## D. 需要后续裁决的问题

每条写明「问题 / 证据 / 可选方向 / 影响面 / 需要什么才能定」。本轮**全部 OPEN**。

### D1. 天气模块的目标色系是蓝、绿，还是分模块

- **问题**：`#094cb2` 与 `#00231a` 谁是目标？
- **证据**：HTML 全绿；PNG 6 蓝 / 4 绿 / 1 混；DESIGN.md 蓝；现状绿（`#163E35`）。
- **可选方向**：(a) 全绿，蓝视为过期；(b) 全蓝，绿视为过期；(c) 天气模块蓝、其余绿；
  (d) 绿为主 + 蓝只做天相/夜间场景的局部强调。
- **影响面**：若改 `--forest`，影响全站 21 页；若只加局部 accent，影响天气页与相关组件。
- **需要**：Stitch 项目侧的导出时间/主题切换记录，或负责人直接指定。

### D2. `alexandria/DESIGN.md` 是否适用于本模块

- **问题**：这份 1.5 KB 的规范是不是这批页面的设计依据？
- **证据**：字体、边线、主色三项与 HTML 全不符；HTML 零引用。
- **可选方向**：(a) 判定为导出时误挂的无关文件，登记为"已排除"；
  (b) 判定为早期规范，仅蓝/金两个色值有效；(c) 判定为目标规范，HTML 才是过期的。
- **影响面**：决定 D1 与 D5/D8 的答案。
- **需要**：负责人对"Alexandria"这个名字是否有印象；或 Stitch 项目的历史版本。

### D3. 字号下限：是否接受 10px / 11px

- **问题**：HTML 的 `label-caps` 10px、`metric-label` 11px 低于现状最小 12px。
- **证据**：C6。原型里这两档用于分组标签与指标名。
- **可选方向**：(a) 保留 12px 下限，标签改名/合并；(b) 仅在图表内标注允许 11px；
  (c) 全面采纳原型的紧凑标签。
- **影响面**：可读性（尤其 375 宽与户外强光）；`design-system.md` 需同步。
- **需要**：真机 375/390 下的可读性证据（现状 12px 是既有约定，改动需证据）。

### D4. 字体：是否引入 Manrope / Hanken Grotesk

- **问题**：原型字体是自托管可行，还是继续用系统栈？
- **证据**：C5。小程包体积与首屏加载是硬约束；中文两者都回退系统字体。
- **可选方向**：(a) 继续系统栈（数字与中文一致回退）；(b) 只给数字/英文引入一款子集；
  (c) 双字体（标题 Manrope + 正文系统）。
- **影响面**：包体积、首屏、数字对齐观感。
- **需要**：字体子集体积实测 + 真机加载时间。

### D5. 圆角与间距刻度

- **问题**：2/4/8/12（原型） vs 5/8/14/20（现状）。
- **证据**：C7。
- **可选方向**：(a) 保持现状刻度，只借用原型的"小圆角用于标签"倾向；(b) 全量换刻度。
- **影响面**：全站共用类（`.card`/`.button`/`.badge`）。
- **需要**：负责人对"更锐利 vs 更柔和"的取向；真机观感对照。

### D6. 层次手法：边线 vs 表面档位 vs 玻璃

- **问题**：现状是"白卡 + 1px 线 + 2 档石色"；原型是"4 档冷表面 + 1–4 处 blur"；DESIGN.md 是"无 1px 线 + 玻璃"。
- **证据**：C8、C15。
- **可选方向**：(a) 保持现状；(b) 增加表面档位、保留细线；(c) 引入 blur（需先验证 WXSS 支持与性能）。
- **影响面**：全站卡片观感；blur 在低端机可能掉帧。
- **需要**：真机 blur 性能实测（现状历史选择是纯色层，理由未在本文核实）。

### D7. 信息密度：一次上多少块

- **问题**：原型单 tab 长度是现状的约 2 倍（C11），是否全上？
- **证据**：PNG 高度 2700–4460 px；现状每 tab 块数明显更少。
- **可选方向**：(a) 逐块挑选；(b) 用披露块折叠；(c) 全上。
- **影响面**：首屏到达时间、滚动疲劳、埋点与性能。
- **需要**：每块"是否影响决策"的逐项裁决（属下一阶段）。

### D8. 交互形态是否照搬

- **问题**：全屏云场、底部地点浮层、时间 chip、航点详情、披露块——哪些要？
- **证据**：C12。现状已有部分对应（如 `weather-chart` 全屏、地点浮层），但形态不同。
- **可选方向**：逐项列为"沿用 / 调整 / 不做"。
- **影响面**：页面路由与组件契约。
- **需要**：交互原型的可用性证据（静态截图无法证明）。

### D9. 演示数值的处置

- **问题**：原型写了大量精确断言（含氧 53%、Bortle 2、11h44m、"晨昏照金山"），
  现行规则要求概率语气且必须来自真实计算。
- **证据**：C13；铁律 12 与天相沉默闸的既有判据。
- **可选方向**：(a) 全部替换为真实计算值；(b) 能算的算、不能算的不显示（推荐方向候选，但不裁决）；
  (c) 保留文案但标注"示意"。
- **影响面**：文案门禁、天相结论卡、用户信任。
- **需要**：逐条核对"这个数在现有实现里有没有可信来源"。

### D10. 逐 tab 的基线选择

- **问题**：四个 tab + 浮层，各自以哪一屏为基线？
- **证据**：每 tab 至少 2 个候选（云层剖面有 v7/v12_1/v12_2/v14_72/72_v14 五屏）。
- **可选方向**：逐 tab 指定；或先做一轮"屏族归并"。
- **影响面**：下一阶段视觉重建的全部工作量。
- **需要**：负责人裁决；本轮只提供索引与证据。

---

## E. 本轮明确不做的事

- 不改任何色值、字号、圆角、间距、组件或页面。
- 不宣布任何一屏为最终版或实施基线。
- 不把任一来源（DESIGN.md / HTML / PNG）宣称为唯一权威。
- 不把上一轮 spec 的 §2 判断当作既定前提。
- 不做"原型 vs 实机"的视觉对照（那属于下一阶段的独立视觉验收）。
