# 复用指南 · 把套件接到另一个原型项目

> 目标读者：拿到 `prototype-fidelity-suite/` 之后，要把它用在**另一个** HTML 原型 +
> 前端实现上的工程师或 Agent。本文件只讲"怎么接、怎么跑、坏了先看哪"，
> 判定规则在 `architecture.md`，技能分工在 `skills/README.md`，实测读数在 `experiments.md`。

## 0. 三种用法，按需要选一种

| 用法 | 什么时候用 | 入口 |
|---|---|---|
| **端到端** | 有原型 + 目标实现，要做一次能交差的保真验收 | `pf verify` + `fidelity-orchestrator` |
| **单技能** | 只想要设计契约 / 只想要差异报告 / 只补交互证据 | 对应子命令（`contract` / `diff` / `interactions`） |
| **当仪器** | 已有自己的流程，只要可复核的读数与产物 | `pf capture` + `pf diff`，契约文件直接消费 |

三条路都用同一份数据契约与同一套五态；没有"轻量模式"绕开证据要求。

**硬性前提：CLI 与技能同版本。** 技能文本里写的是命令契约（参数、产物、过门条件），
行为改在 `cli/pf.js`。版本不一致时技能会给出错误的"下一步"，所以两者必须一起升级。

## 1. 安装（约 15 分钟）

1. **复制整套目录**到宿主仓库（或仓库外任意位置）。套件零 npm 依赖：
   没有 `package.json`、没有 `node_modules/`，PNG 编解码、像素比对、几何比较都是内建的。
2. **外部运行时按需准备**，一律装在仓库外、用环境变量指路（四个变量都在 `core/lib/env.js`）：

| 变量 | 用途 | 缺失时 |
|---|---|---|
| `PLAYWRIGHT_MODULE_PATH` | Web 侧捕获与驱动 | 报 `PLAYWRIGHT_MISSING` / `DRIVER_UNAVAILABLE`，不静默降级 |
| `MINIPROGRAM_AUTOMATOR_PATH` | 微信侧元素读数与截图 | 同上 |
| `NODE_PATH` | 上面两个找不到时的后备搜索路径 | 不设置即跳过 |
| `WECHAT_DEVTOOLS_CLI` | `cli.bat` 路径（仅供 `doctor` 展示与文档引用） | 不设置即不引用 |

3. **体检**：`node cli/pf.js doctor`。它逐个报 `available / missing / unverified`，
   并列出已加载的适配器描述符；描述符不合法直接退出码 2。
   `unverified` 表示"没探测到但也没证实缺失"，**不是通过**。
4. **装技能**：把 `skills/<name>/` 整体复制到宿主的技能目录（如 `.agents/skills/<name>/`）。
   `SKILL.md` 里的命令都相对于套件根目录，不含绝对路径。
5. **自检**：
   ```bash
   node tests/run.js                                  # 20 套 / 1095 断言，按进程隔离
   node examples/generic-web/experiments/run.js       # A/B/C/D/E/F，需要 Playwright
   node tests/fixtures/run.js                         # 独立夹具：9 类场景（规则提取→修复后回归）
   ```
   两端都绿再开始接新项目；`tests/run.js` 失败说明套件本身坏了，不要带着它去量别人。

## 2. 接入一个新项目：七步

| 步 | 动作 | 命令 | 产物 | 过门条件 |
|---|---|---|---|---|
| 1 | **定位原型与目标页**（人做） | — | 一句可复核的对应关系 | 原型能在本地打开；目标页能在目标运行时打开；两个都能到达"同一个状态" |
| 2 | 建项目骨架 | `pf init --dir <project>` | `pf.config.json`、`captures/`、`contracts/`、`reports/` | 文件已写、目录已建 |
| 3 | 写 `pages[]` | 手写 | 页面/状态/映射/交互/接受项 | 见 §2.1 的四条原则 |
| 4 | 捕原型 | `pf capture --project <project> --page <id> --side prototype` | `capture-manifest` + 快照 + 截图 | 打印出节点数、像素尺寸、缩放；无截图即失败 |
| 5 | 捕目标 | `... --side target` | 同上 | 同上；微信侧会出现 `screenshotScale`（通常 ≠ 1） |
| 6 | 出契约 | `pf contract --project <project>` | 7 份契约 | 映射缺失项按 `required/optional` 分别落 `UNVERIFIED` / `NOT_APPLICABLE` |
| 7 | 量 + 判 | `pf diff` 然后 `pf validate`（或一条 `pf verify`） | `reports/<run>/`：`visual-diff-report.json`、`fidelity-validation-report.json`、`report.html`、每对三张图 | 每个配对有状态与证据图；五维齐备、**没有总分**；退出码语义见下 |

退出码：`0` 通过 · `1` 有真实失败 · `2` 环境/配置错误或存在 UNVERIFIED。
**`2` 不是"差不多通过"**，它表示"有一块没测到"，要补证据或改声明，不能调退出码绕开。

### 2.1 写 `pages[]` 的四条原则

1. **先只映射两页确实都有的节点**。不确定的标 `optional: true`：
   可选缺失 ⇒ `NOT_APPLICABLE`，必填缺失 ⇒ `UNVERIFIED`。
   两者都不会变成 PASS，但含义不同，别把"另一边没有这个元素"写成"必填缺失"。
2. **`mappings` 必须写到文本叶子**。只映射容器会得到"容器像素差"，
   而容器像素判定会把已声明的子元素遮罩掉（否则子元素差异在父级重复记一遍账）。
3. **`acceptedDifferences` 只在"平台差异已被解释"时写，且只按类别**（`position` / `size` /
   `text` …）。它不能按轴切分，所以"宽差可接受、高差是缺陷"只能整类接受或整类失败——
   宁可留 FAIL，也不要把真差异一起洗白。
4. **动态内容必须声明**（`states[].dynamic` 或对应字段）。声明只关掉**内容**通道，
   存在性与几何照判；不声明就会每跑一次红一次，而被"调宽容差"掩盖。

最小映射例子：

```json
{
  "id": "page-1",
  "prototype": { "url": "prototype/index.html" },
  "target": { "pagePath": "/pages/index/index" },
  "mappings": [
    { "id": "title",    "prototype": "#hero-title", "target": ".hero__title", "pixelMode": "informational" },
    { "id": "cta",      "prototype": "#cta",        "target": ".cta",  "styleProps": ["background-color", "border-radius", "padding"] },
    { "id": "badge",    "prototype": "#badge",      "target": ".badge", "optional": true }
  ],
  "states": [{ "id": "default" }],
  "interactions": [{
    "id": "expand",
    "title": "点按钮后说明展开",
    "do": [{ "tap": { "selector": "#cta" } }, { "wait": 200 }],
    "expect": { "textIncludes": { "selector": "#note", "text": "已展开" } }
  }],
  "acceptedDifferences": []
}
```

## 3. 接一个新平台（第三个适配器）

按 `adapters/README.md` 的五步；三条最容易漏的：

1. **先写 `LIMITATIONS.md` 再写代码**。适配器描述符回答"这件仪器量得出什么"——
   量不到 `lineCount` 就必须声明，否则排版维度会被"用高度推行数"的推断悄悄填绿。
2. `capabilities.screenshotScale` 必须如实报。0.78 的缩放不报，就是在比不同密度的像素。
3. **不要在 `core/` 加平台分支**。核心规则一旦需要知道平台名，就说明它要的是
   一条能力声明，而不是一个 if。

描述符（`adapter.json`）与 `LIMITATIONS.md` 的 `### <ID>` 小节由
`tests/contracts.test.js` **双向比对**；改了描述符不写文档会红，反之也红。

## 4. 维护

| 场景 | 做法 |
|---|---|
| 升级契约字段 | 只增不删、`schemaVersion` 升次版本；旧报告仍要能读（`tests/schema.test.js` 守住） |
| 改容差 | 先跑实验 A/B：**改容差不得改变实验读数**。改变了就说明容差不是"容忍渲染差异"，而是"容忍真差异" |
| 重新生成契约 | `pf contract` 会保留已记录的交互观测，但只在声明的检查集合未变时沿用；集合变了就重新跑交互 |
| 升级技能 | 与 CLI 同版本一起升；升完跑 `tests/run.js` + 实验四件套 |
| 分发 | 不从无根 LICENSE 的第三方仓库 vendoring 代码（理由见 `research-report.md` §6）；本套件自包含 |

## 5. 故障速查

| 症状 | 先查 | 处理 |
|---|---|---|
| `PLAYWRIGHT_MISSING` / `DRIVER_UNAVAILABLE` | 环境变量有没有指到模块目录 | 指到**仓库外**的安装目录；不要为了省事装进仓库 |
| 微信侧连不上 | 开发者工具「服务端口」是否开启；自动化端口是否真的是 9421 | 端口不是 9421 就改 `pf.config.json` 的 `target.wsEndpoint` |
| 每一对都 FAIL 且 `dy` 恒定 | 外壳高度差（状态栏/导航栏） | 用 `alignment.anchor` 重定基；它只作用 `dy`，尺寸永不重定基 |
| 宽度差很大、高度只差一点 | 两侧 `box-sizing` | 先看盒模型：标量宽高断言会变 `UNVERIFIED`，几何仍会报 |
| 同一页每跑都红在同一个位置 | 是否动态内容 | 声明它；不要用"调高容差"或"重拍一张"处理 |
| 交互全 `BLOCKED` | 驱动会话 | 修会话；**不得**用注入截图当交互证据 |
| 报告 PASS 但肉眼不一样 | 该区域是不是只映射了容器 | 补映射到文本叶子；容器像素被声明子元素遮罩 |
| 修复后退出码是 2 | 交互维度 | 页面没有声明交互 ⇒ 该维度 `0/0` = UNVERIFIED。补一条真实交互，不要绕过 |
| 报告里某个样式 `UNVERIFIED` | 是否显式声明了这个 prop | 显式声明了却两侧都读不到＝"要求了但没测到"，只有默认清单里的缺失才算跳过 |

## 6. 什么能复用、什么要改、什么不要带

| 分类 | 内容 | 说明 |
|---|---|---|
| **可直接复用** | `core/`、`adapters/web/`、`schemas/`、`tests/`、`skills/`、实验运行器 | 不含任何 OurTrail 路径/组件/业务数据（实验 D 实测 0 处引用） |
| **必须改** | `pf.config.json`（页面/映射/状态/交互/容差）、目标侧适配器配置、`acceptedDifferences` | 这些是"这个项目的事实"，不能照抄 |
| **不要带** | `examples/ourtrail/` 的配置与报告、`docs/pilot-ourtrail.md`、天气相关结论、一次性探针脚本 | 它们是这个项目的证据，换项目后无效；留着会被误读成"已验证" |

成本提醒：Web 侧要一个 Playwright 安装（含浏览器，数百 MB 量级）；微信侧要微信开发者工具
且服务端口必须人工开启。两者都在仓库外，套件本身仍然零依赖。

## 7. 一条端到端命令流

```bash
# 0) 体检（缺什么会明确说）
node cli/pf.js doctor

# 1) 建骨架，然后手写 pages[] / mappings / states / interactions
node cli/pf.js init --dir ../my-project

# 2) 两侧捕获
node cli/pf.js capture --project ../my-project --page page-1 --side prototype
node cli/pf.js capture --project ../my-project --page page-1 --side target

# 3) 契约 + 测量 + 交互（逐步打印状态，阻塞即停）
node cli/pf.js verify --project ../my-project --page page-1

# 4) 修一处 → 只重捕目标 → 只重测
node cli/pf.js capture --project ../my-project --page page-1 --side target
node cli/pf.js diff     --project ../my-project --page page-1
node cli/pf.js validate --project ../my-project --page page-1
```

第 3 步之后先读 `reports/<run>/fidelity-validation-report.json` 的失败清单（带 pairId），
再决定改哪条声明——`fidelity-repair-agent` 的规则是"报告没定位到的差异不许改"。
