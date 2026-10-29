# 外部技能与工具研究报告（Phase 1）

> 日期：2026-10-28。方法：三个只读研究代理，用 GitHub API（`/repos`、`/git/trees?recursive=1`、`/contents`）、
> `raw.githubusercontent.com` 文件抓取与 npm registry 元数据逐项取证；**未安装、未执行任何第三方代码**做评估。
> 星标与最近提交为抓取时读数。结论冲突处在 §3 显式裁决，不合并成一个"大家都同意"的假共识。

## 1. 一句话结论

**没有一个候选能直接复用成这套套件的主体**：六个技能仓库里没有任何一个具备 WXML/WXSS 或
miniprogram-automator 能力，也没有一个自带像素 diff 引擎（所有"对比"都是让模型看图说话的散文）。
真正可搬的是**词表与骨架**（证据门清单、渲染契约、token 漂移检查），机制必须自己写。

因此：核心手写（纯 Node、零依赖），Playwright / automator 只作为**仓库外的可选驱动**，
像素比对按 pixelmatch **classic v5–v7 语义**重写并与 v8 划清界限。

## 2. 逐项裁决

| # | 候选 | 实际内容 | 许可 | 运行时 | 最近提交 | 裁决 |
|---|---|---|---|---|---|---|
| 1 | `anthropics/skills` | 19–20 个 SKILL.md + spec + template；`webapp-testing` 带 Python Playwright 脚本 | 无根 LICENSE；逐 skill Apache-2.0，**docx/pdf/pptx/xlsx 为 source-available 非开源** | Python 3（部分 Playwright） | 2026-10-09 | **REFERENCE**（冲突，见 §3.1） |
| 2 | `openai/skills` | 39–44 个 skill + `agents/openai.yaml`；**README 自称 deprecated** → `openai/plugins` | 无根 LICENSE；逐 skill Apache-2.0 | 多 skill 依赖 MCP（Figma/Playwright）；交互需 Codex `js_repl` | 2026-06-24 | **REJECT**（冲突，见 §3.2） |
| 3 | `vercel-labs/agent-skills` | 9 个纯文本规则 skill；`web-design-guidelines` 运行时**联网抓** command.md | **无 LICENSE 文件（404）**，仅一处 frontmatter 写 MIT | Node 22（构建包 `yaml`） | 2026-10-27 | **REFERENCE** |
| 4 | `nextlevelbuilder/ui-ux-pro-max-skill` | 7 skill + CSV/JSON 设计库 + 纯 Node token 脚本 + Playwright `design-audit.mjs` | MIT | Python 3 标准库；`stack/` 需 Playwright | 2026-10-26 | **ADAPT** |
| 5 | `max0821/web-design-skill` | 1 skill + 9 references + 2 个标准库 Python 校验脚本 + `design-gates.template.json`（schema v2） | MIT | Python 3 标准库 | 2026-08-24 | **ADAPT** |
| 6 | `ytvee-dev/webdev-agent-kit` | 23 skill + ~130 策略文档 + 40+ 自校验脚本 + evals + CI | Apache-2.0 | Python 3；视觉 QA 需 MCP | 2026-10-23 | **REFERENCE**（冲突，见 §3.3） |
| 7 | `microsoft/playwright` | 浏览器驱动 | Apache-2.0 | Node ≥20 + 数百 MB 浏览器 | 活跃 | **ADAPT**（仓库外、可选） |
| 8 | `ChromeDevTools/chrome-devtools-mcp` | MCP 服务器（Puppeteer 之上） | Apache-2.0 | Node ^20.19/^22.12/≥23，需 MCP 传输 | 活跃 | **REJECT** |
| 9 | `mapbox/pixelmatch` | 像素比对算法 | ISC | — | v8 为重写 | **ADAPT**（只搬语义，锁 v5–v7） |
| 10 | `argos-ci/argos` | 托管 SaaS + 上传 CLI | MIT（仓库） | 需 token；自托管"un-officially supported" | 活跃 | **REJECT** |
| 11 | `gemini-testing/looks-same`（自发现） | 区域聚类输出 `diffClusters` | MIT | 5 个依赖（含 WASM PNG 编解码） | 活跃 | **ADAPT**（只搬聚类思路） |

### 2.1 ADAPT 具体搬什么

- **ui-ux-pro-max**：`validate-tokens.cjs` / `generate-tokens.cjs` 是**零依赖 Node**，与本仓库约束同形——
  借它"扫源码里游离的硬编码值"这一形态，按 WXSS 重写（不是拿它的栈列表）。CSV 设计库只作参考，不进套件。
- **max0821/web-design-skill**：`design-gates.template.json` 的**证据门清单**最值得搬：
  每项带状态、必填视口/修订/时间身份、一组**不可豁免**的完成门。本套件的十一份契约与
  五态状态词是同一思路的机器化版本；校验器用 Node 重写，不搬 Python，也不搬 web-only 阶段。
- **pixelmatch**：只搬语义常量与 AA 规则（`MAX_YIQ_DELTA=35215`、YIQ 系数、`zeroes>2`），
  自研连通域与分类层。**必须锁代际**：v8 已改用 OKLab/HyAB 且 `threshold` 语义变为绝对距离，
  两者不通用；"pixelmatch-compatible" 不带版本是无意义表述。ISC 许可，已在 `core/lib/diff.js` 头注释署名。
- **looks-same**：只搬"差异聚类成框"的思路（本仓库 `diff.js` 自己算连通域）；不引入依赖——
  它的 tolerance 是 ΔE 口径，与 YIQ 不通用，混用会让阈值失去含义。
- **Playwright**：作为浏览器侧驱动，但只作为**仓库外可选件**。必须显式固定：
  `scale:'css'`（默认是 `device`，DPR=2 时出 2× 像素）、`animations:'disabled'`、`caret:'hide'`、
  `--force-color-profile=srgb`；且**自己等** `document.fonts.ready` 与图片解码——
  Playwright 的截图器不等字体。

## 3. 裁决冲突与理由

### 3.1 `anthropics/skills`：一代理判 REUSE，一代理判 REFERENCE → 取 **REFERENCE**

REUSE 的合理面：它是 Agent Skills 格式的事实来源，`spec/` 与 `skill-creator` 直接定义了
`name ≤64`、`description ≤1024`、正文 <500 行/≤5000 tokens、引用只下钻一层。
但这些是**规范文本**，不是可复用的运行时；而 `webapp-testing` 把运行栈钉在 Python+Playwright，
与本套件"纯 Node 核心 + 仓库外驱动"冲突。另外它的许可分布不适合整体搬：
根目录无 LICENSE，个别 skill 是 source-available 非开源。
所以：**规范照抄（这是公开约定），代码不搬**。

### 3.2 `openai/skills`：一代理判 REFERENCE，一代理判 REJECT → 取 **REJECT**

它的 `screenshot` / `playwright-interactive` 确有相关内容，但整仓已被自己的 README 标记 deprecated，
且交互能力硬绑定 Codex 的 `js_repl` 与 `danger-full-access` 沙箱配置。
对一个要长期可维护的套件，把设计建立在**官方宣布废弃**的仓库上不是取舍问题，是负债。
不借鉴的理由也很直接：它提供的能力（截图、Playwright 交互）我们已在 adapter 里自建，且必须自建（要 WXML）。

### 3.3 `ytvee-dev/webdev-agent-kit`：一代理判 ADAPT，一代理判 REFERENCE → 取 **REFERENCE**

ADAPT 的合理面：`common/rendered-visual-verification-policy.md` 是六份里边界写得最锋利的一份
（什么可以用浏览器、什么不行；"装了 Playwright ≠ 有 MCP"）。但它的价值在**文字**：
采用它意味着接入 130+ 篇策略文档、`[[wiki-link]]` 引用图和一整套"适配项目"流程，
而这些结构与本仓库既有体系（`.agents/skills/ourtrail-ui`、`SYNC.md`）冲突。
所以：观点取用，包不引入。它的 frontmatter 还带非标准字段（`id`/`doc_type`/`layer` 等），
过不了严格规范校验——这也说明它不是一个可原样分发的包。

其余四项两代理一致，无冲突：vercel REFERENCE / ui-ux-pro-max ADAPT / max0821 ADAPT / Playwright ADAPT。

## 4. 必须对齐的事实（已落到实现里）

| 事实 | 落点 |
|---|---|
| 截图默认 `scale:'device'`，DPR 放大像素 | web adapter 固定 `scale:'css'`，并与目标侧 0.7846×0.7820 归一到共享 CSS 子矩形后再比 |
| 渲染随宿主 OS/字体/无头模式漂移 | `capture-manifest` 记录代码版本、viewport、DPR、时刻、截图 sha256；跨机结论只认同一份捕获 |
| 字体与图片不会被自动等待 | 抓取前等 `document.fonts.ready` 与图片解码 |
| pixelmatch 两代不通用 | `diff.js` 钉 classic v5–v7 并写明 v8 差异 |
| 半透明像素合成规则影响结果 | 统一白底合成后比较，并在容差注释里写明 |
| 没有任何候选支持 WXML / 开发者工具 | 微信侧必须自写 adapter；B 层交互证据只能来自 automator |
| 区域定位只能自建 | `regions.js` 按共享子矩形裁切 + `diff.js` 连通域 + `geometry.js` 节点归属 |

## 5. 本机实测环境（报告里的"运行过"只指这些）

2026-10-28 `pf doctor` 读数：

| 能力 | 状态 | 证据 |
|---|---|---|
| Node | available 24.19.0（要求 ≥18） | `doctor --json` |
| Playwright | available 1.63.0-alpha-2026-08-31，路径为**全局** npm 的 `@playwright/cli/node_modules/playwright` | 同上；**本轮未安装**，仓库内无任何 npm 产物 |
| miniprogram-automator | available 0.13.0，位于 `%TEMP%\opencode\mp-auto\node_modules` | 同上；这是宿主仓库既有流程的安装位置（其 AGENTS.md 记载） |
| 微信开发者工具 CLI | available `C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat` | 同上 |
| IDE 服务端口 33278 | open | 同上 |
| 自动化端口 9421 | **closed** | 同上 ⇒ 交互检查 BLOCKED（见试点报告） |

> **前向更正（2026-10-28 晚，原文保留）**：上表是 11:00 前后的读数。当天稍后该端口重新监听，
> 试点因此完成了 4 条真实交互（`docs/pilot-ourtrail.md` §7，4/4 PASS），
> 最终 `pf doctor` 读数为 `9421:open`。端口是否在听取决于共享的开发者工具会话，
> **不要用任何一次读数推断"这个平台永远做不了交互"**。

**一次真正跑过的反向探测（2026-10-28 11:05，当时 9421 尚在监听）**：用
`miniprogram-automator@0.13.0` 连 `ws://127.0.0.1:9421`、`reLaunch('/pages/weather-hub/weather-hub')`，
再取 `mp.CDP()`，依次试 `sendCommand('Runtime.evaluate', …)`、`sendCommand({method, params})`
与一段 `document.querySelectorAll('*')` + `getComputedStyle` 的求值脚本。
三种形态**全部**返回同一条错误：

```
attempt0.error  appservice App.CDPEnable unimplemented
attempt1.error  appservice App.CDPEnable unimplemented
dom.error       appservice App.CDPEnable unimplemented
```

结论：在当前 IDE 构建上**拿不到 DOM 级的 `getComputedStyle` / `getBoundingClientRect`**，
微信侧只能走元素 API（`el.offset()/size()/text()/style(p)`）+ `mp.screenshot()`。
探测脚本是一次性的，落在仓库外 `%TEMP%\pf-probe\cdp-probe2.js`，未入库；本行是它的唯一记录。
注意这是**某一天某个 IDE 构建**的读数，不是平台永久能力上限。

未执行过的：chrome-devtools-mcp（已 REJECT，未装未跑）、argos（已 REJECT，未联网）、looks-same（未装）。

## 6. 遗留不确定

- 星标/提交时间会漂，本报告只保证**抓取时点**的读数。
- `openai/skills` 的逐 skill 许可只抽样两处；既然已 REJECT，未穷举。
- 无根 LICENSE 的两个仓库（anthropics、vercel）在"整体再分发"层面法律状态不明，
  这也是不 vendoring 的一个重要理由，而不是纯技术判断。
