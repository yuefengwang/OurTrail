# 原型保真套件 · 架构

> 状态：v1 核心闭环已实现（2026-10-28）。本文件描述**已建成**的部分与**边界**；
> 未建成的部分在 §9 单列，不在此处冒充完成。

## 1. 设计约束（决定了全部形状）

| 约束 | 来源 | 对架构的直接后果 |
|---|---|---|
| 宿主仓库零 npm 依赖 | `OurTrail` 铁律 | 核心零依赖（Node ≥18 内建 `zlib`），PNG 编解码/像素 diff/几何比对全部手写 |
| 真实渲染才是验收依据 | 任务书 | 每个结论必须挂 `capture-manifest`（代码版本、运行时、DPR、截图 sha256、时刻）；源码相等不算通过 |
| 缺失证据不得默认为 PASS | 任务书 | 五态 `PASS/FAIL/UNVERIFIED/BLOCKED/NOT_APPLICABLE`；聚合器把"没测到"算作未验证而不是通过 |
| 修复不许盲收敛 | 任务书 | 先量后改：`diff` 的事实报告是 `validate` 的输入，`repair` 只能消费定位过的差异 |
| 核心与平台解耦 | 任务书 | 微信/Web 逻辑只存在于 `adapters/`；核心不知道 WXML 是什么 |
| 第三方代码先审后用 | 任务书 | Playwright / miniprogram-automator 装在仓库外，按版本锁定，不进仓库 |

## 2. 分层与依赖方向

```
                  ┌──────────────────────────────┐
   Agent skills   │ skills/<name>/SKILL.md        │  只写"怎么做"，不写平台细节
                  └──────────────┬───────────────┘
                                 │ 调用 CLI（唯一入口）
                  ┌──────────────▼───────────────┐
   CLI            │ cli/pf.js                     │  参数解析、编排、退出码
                  └──────────────┬───────────────┘
        ┌──────────────┬─────────┴─────────┬────────────────┐
        ▼              ▼                   ▼                ▼
  core/lib/*     adapters/web      adapters/wechat-     schemas/*.json
  （纯函数）       capture.js        miniprogram/          （契约）
        │              │             capture.js
        ▼              ▼                   ▼
   png/diff/       Playwright        miniprogram-automator
   geometry/…      （仓库外安装）      （仓库外安装）
```

依赖只朝下：`skills → cli → core`；`core` 永不 `require(adapters)`，
adapter 由 CLI 按 `pf.config.json` 的 `adapter` 字段动态加载。
因此新增一个目标平台＝新增一个目录，核心一行不改。

`core/lib` 二十个模块，职责单一：

| 模块 | 职责 |
|---|---|
| `util.js` | 路径/时间/哈希/错误类型 `PfError`；`writeFileRetry` 对瞬时文件锁（EPERM/EACCES/EBUSY/UNKNOWN）有限次重试，永久错误不重试 |
| `schema.js` | draft-07 子集校验器；**未知关键字即报错**（拼错不能悄悄关掉约束） |
| `png.js` | PNG 解码（IHDR/PLTE/tRNS/IDAT，filter 0–4，CRC 校验，16 位降位）与 RGBA 编码 |
| `image.js` | 像素读取、缩放、白底合成 |
| `diff.js` | 像素比对（pixelmatch v5–v7 的 YIQ 语义 + AA 启发式）、墨迹签名 |
| `regions.js` | 按共享 CSS 子矩形裁切两侧截图并归一化缩放 |
| `geometry.js` | 盒模型/字号/颜色/行数比对；内容锚点重定基 `realignToAnchor` |
| `contract.js` | design tokens 聚合、组件契约、页面节奏（gap 标注 inferred） |
| `manifests.js` | 四个"声明侧"契约的构建器 |
| `artifacts.js` | capture / diff / validation 三类产物与 schemaVersion、状态汇总；`clearRunArtifacts` 保证复用的 run 目录不携带上一次的裁决 |
| `scorecard` → `score.js` | 五维评分卡与总判定次序 |
| `interaction.js` | 交互检查驱动器（声明式步骤 → 真动作 → 观测后果） |
| `report.js` | 自包含 HTML 报告（离线可开，图片内联 data URI） |
| `env.js` | 探测仓库外的 Playwright / automator、端口；探不到记 `unverified` |
| `html.js` | HTML 转义（报告用） |
| `acceptance.js` | 接受差异的解析：按 `props[]` / `axis` / `maxAbsPx` 收窄；越界与"声明错"（`covers-nothing` / `unevaluable`）分别记账 |
| `cascade.js` | 级联归因：把实测 `dx/dy` 拆成"祖先给的"与"自己的"，只报告不裁决 |
| `bundle.js` | 构建版本证据：对编译源树做内容指纹（sha256），校验"指纹早于截图"与"验证时仍未变" |
| `repair.js` | 有界修复：唯一锚点预检 → 备份 → 应用 → 回滚（回滚以重新哈希证明） |

## 3. 流水线

```
pf doctor     环境体检（端口、驱动、Node 版本）→ 缺什么就明确说缺
pf capture    prototype + target 各自截图 + DOM 快照 + capture-manifest（可 --viewport <id>|all）
pf contract   读快照产出 7 份契约（tokens / components / layout / 4 份声明侧）
pf diff       逐映射对比较几何、样式、文本、像素 → visual-diff-report
pf validate   评分卡 + 交互检查 → fidelity-validation-report
pf interactions  单跑交互（可单独重跑，不改视觉结论）
pf verify     capture → contract → diff → validate 串起来，逐步打印状态
pf repair     有界修复：唯一锚点 → 备份 → 应用 → 复测 → 保留或逐字节回滚
```

多视口是**同名命令的循环**，不是第二套命令：`--viewport <id>|all` 让捕获目录变成
`captures/<page>/<state>/@<vp>/<side>`，run 目录前缀带 `@<vp>`，报告里的证据路径也带它；
一次跑多视口时打印 `viewports: <id>=<VERDICT> …`，退出码取最差的一档（FAIL > 环境/UNVERIFIED > PASS）。
`pf repair` 拒绝 `--viewport all`：修复一次只针对一个视口的读数，否则"改好了"没有唯一指代。
视口宽度是否**真的到达浏览器**不靠目录名证明：`examples/generic-web/f/fluid.html` 的 frame 是流式的
（`width: 100%`），375/414 两个视口拍出的截图与节点盒都跟着变；`b/base.html` 的 390px 固定机身
是阴性对照 —— 它在两个视口下拍出来都是 390 宽，证明"多视口通过"这句话在非流式页面上是空的（实验 F）。

每个阶段都能单独跑：`diff` 只读快照与截图，`validate` 只读 diff 报告。
这让"量"与"改"可以完全分开 —— 修复流程只允许在 `diff` 产出定位过的差异之后开始。

每个 run 目录在开跑前会清掉上一次的裁决产物（`verify-steps.json` / `visual-diff-report.json` /
`fidelity-validation-report.json` / `report.html`）。这不是洁癖：一次在写快照时被文件锁打断的运行
曾以退出码 2 结束，而目录里还留着上一次的 PASS 报告 —— 退出码与产物互相矛盾，读者只会信产物。

打断它的那把锁也是真的：Windows 上对刚创建的产物做扫描会让写入抛
`UNKNOWN: unknown error, open …`，Playwright 自己的落盘与 `fs.writeFileSync` 一样不会重试。
所以产物落盘统一走 `util.writeFileRetry`（可重试 errno 集合、上限 5 次、退避 20→160 ms；
`ENOSPC` 这类非瞬时错误立即失败，不会重试成"看起来成功"）。
两条行为各有一份断言：`tests/write-safety.test.js`（重试语义与清理集合）与实验 E（目录新鲜度）。

退出码统一：`0 PASS`、`1 FAIL`（真实差异）、`2` 环境/配置错误或 `UNVERIFIED`
（"什么都没测到"永不返回 0）。

## 4. 数据契约

十一份，均有 `schemaVersion`（semver）、`pageId`、`generatedAt`、`provenance`：

| 契约 | 生产方 | 关键字段 | 状态语义 |
|---|---|---|---|
| `project-config` | 人写（`pf init` 脚手架） | pages / states / mappings / tolerances / alignment | 校验通过即可执行 |
| `prototype-manifest` | `pf contract` | `prototype.readOnly=true`、每 state 的截图与代码版本 | 无截图 ⇒ `UNVERIFIED` |
| `page-state-manifest` | `pf contract` | `injection.declared`、`usableAsInteractionEvidence` | 声明注入 ⇒ 不可作交互证据 |
| `design-tokens` | `pf contract` | 五桶 token（色/字/圆角/阴影/间距）+ 两侧 drift | token 差异是信息，不是判定 |
| `component-contracts` | `pf contract` | 每组件多实例的盒模型与样式 | 选择器找不到 ⇒ `UNVERIFIED` |
| `platform-mappings` | `pf contract` | 每对的选择器/路径解析结果、`missing[]`、accepted differences | 必填缺失 ⇒ `UNVERIFIED`；可选缺失 ⇒ `NOT_APPLICABLE` |
| `capture-manifest` | 两侧 adapter | 平台、URL/路由、代码版本、viewport、DPR、截图 sha256、`dataSource` | 无截图必须写 `missing`，不许用 null 假装 |
| `visual-diff-report` | `pf diff` | 每区域几何/样式/文本/像素 + 证据图片路径 | 见 §5 判定次序 |
| `interaction-contract` | `pf contract` / `pf validate` | 声明步骤 + 已记录的观测与断言 | 未跑 ⇒ `UNVERIFIED/NOT_RUN`；驱动不可达 ⇒ `BLOCKED` |
| `fidelity-validation-report` | `pf validate` | 五维评分卡、失败清单（带 pairId）、覆盖度 | 聚合规则见 §5 |
| `page-layout`（支撑件） | `pf contract` | 区块顺序与节奏 | 明文标注为十份之外的支撑产物 |

`page-layout` 之所以保留而不是塞进 `component-contracts`：两者语义不同（组件实例 vs 页面节奏），
合并会造出第二个真相来源；删除又违反"不删已有产物"的授权边界。

**provenance 词汇**：`measured`（读自渲染）/ `inferred`（由测量推导，如两矩形间距）/
`confirmed`（人确认，覆盖测量）/ `unknown`（声明了但测不到）。
推导值不会被提升为测量值 —— 报告要让评审者一眼分清"工具看到的"与"工具算出来的"。

## 5. 判定次序（缺证据不得变通过）

单个配对：

```
可选且任一侧不存在        → NOT_APPLICABLE
任一侧不存在且必填        → FAIL
两侧存在但某维度无法测量  → UNVERIFIED（该维度记 unknown，不记 pass）
有 FAIL 维度且未被接受    → FAIL
其余                      → PASS
```

页面聚合（`score.js`）：

```
critical 失败 > 0                     → FAIL
非 critical 失败超预算                → FAIL
任一维度 FAIL                         → FAIL
任一维度 UNVERIFIED                   → UNVERIFIED
存在未验证配对                        → UNVERIFIED
以上都不成立                          → PASS
```

交互单独成维度：`FAIL` 会把页面拉到 `FAIL`；`BLOCKED`/未跑把页面从 `PASS` 拉到 `UNVERIFIED`。
**交互永远不能把 `UNVERIFIED` 拉成 `PASS`。**

状态（D）也是独立维度，但它量的是**状态模式与证据资格**，不是状态外观
（外观由 A/B/C 在该状态自己的捕获上判）：`page-state-manifest` 的声明、两侧
`capture-manifest` 的 `dataSource` 与配置里有没有 `injectData` 必须一致；
注入态必须 `usableAsInteractionEvidence: false`。注入本身不是缺陷——
"声明注入但捕获报 `real`"（注入没生效）与"未声明却报 `injected`"才是。
该维度读的是产物，捕获缺失记 UNVERIFIED，不按"应该没事"补绿。

像素判定按配对性质分档：`exact` 用像素比阈值（critical 0.5% / 普通 2%）；
`informational`（文本叶节点）改判墨迹签名（bbox 2px、墨量比 0.3），
因为 1× 浏览器与缩放后的模拟器截图之间字形栅格化本就不可逐像素比；
字阶/字重/行高/字距/颜色与行数仍逐项判 FAIL。

### 5.1 两条"比不了就不判"的规则（试点第一批读数之后补的）

| 情形 | 处理 | 为什么 |
|---|---|---|
| 两侧 `box-sizing` 不同（border-box / content-box），却要标量断言 `width/height/min-height/max-height` | 该维度记 **UNVERIFIED**（`same declaration, different box`）；盒模型本身由几何判 | 同一个 `width: 60px` 在两种盒模型下对应两个外观；标量判 PASS 等于宣称盒模型一致 |
| 配置**显式声明**了某个 styleProp，但两侧适配器都读不到 | 该维度记 **UNVERIFIED**（`not reported by either adapter`） | 默认清单里的缺失＝没要求；显式声明了却读不到＝要求了但没测到。两者不能合并成"跳过" |

`acceptedDifferences` 可以只按**类别**接受（`position` / `size` / `text` …），也可以收窄到
`props[]`（哪几条声明）、`axis`（x 还是 y）、`maxAbsPx`（差多远）三者之一。
**不收窄的条目保持原义**：一条只写 `categories` 的接受仍然整类放行，所以旧配置的行为不变。
收窄的条目只豁免它真的覆盖到的部分，"宽差 60px 可接受、高差 8px 是真缺陷"因此可以说清；
而声明写错不会被当成免费通行证：命名了不存在差异属性的条目记 `covers-nothing`，
对 `ink`/`pixel`/`text` 这类没有可测操作数的类别下 `maxAbsPx` 记 `unevaluable`，
两者都会进 `acceptanceInvalid` 并附 `ACCEPTANCE_INVALID` 警告，而不是静默接受。
试点的 `primary-sub` **没有**改配置：它仍然整类不接受（宁可留 FAIL，也不把真差异一起洗白），
收窄只是让这种混合配对**以后**有表达方式。

## 6. 交互契约

声明在 `pf.config.json#pages[].interactions[]`：

```json
{ "id": "tab-points", "title": "切到常用地点",
  "do": [{ "tap": { "selector": ".wh-tab", "index": 1 } }, { "wait": 400 }],
  "expect": { "dataEquals": { "homeTab": "points" },
              "textIncludes": { "selector": ".wh-quiet", "text": "常用地点" } } }
```

支持 `tap / input / wait / waitFor` 四个动作，`exists / notExists / textEquals /
textIncludes / count / dataEquals` 六个期望。只有**动作真的执行且后果被观测到**才可能 PASS；
动作成功但读不到后果 ⇒ `UNVERIFIED`。`pf contract` 重新生成契约时会保留已记录的观测，
但只在声明的检查集合未变时才沿用 —— 证据不会被静默复用或张冠李戴。

## 7. 容差与对齐

`pf.config.json#tolerances`：position 1.5px、size 1.5px、gap 1px、font 1px、
color 单通道最大差 6（先按白底合成 alpha，不换算 ΔE）、pixelRatio 2%、criticalPixelRatio 0.5%。

外壳不同（浏览器模拟状态栏 vs 小程序自定义导航）时，页面可声明内容锚点：

```json
"alignment": { "anchor": "header", "reason": "顶栏载体不同，header 顶边视为内容原点" }
```

重定基只作用于 `dy`，尺寸永不重定基 —— 否则"外壳更高"会被洗成"版式正确"。

## 8. 目录

```
prototype-fidelity-suite/
├── cli/pf.js
├── core/lib/           20 个纯函数模块
├── adapters/           README.md = 适配器契约；每个平台三件套：
│   ├── web/            capture.js + adapter.json + LIMITATIONS.md
│   └── wechat-miniprogram/  同上
├── schemas/            17 份 JSON Schema（11 契约 + 6 支撑）
├── tests/              20 套、1095 断言（2026-10-29 实测）；tests/run.js 按进程隔离执行
├── examples/ourtrail/  pf.config.json + captures/ + contracts/ + reports/
├── examples/generic-web/  与 OurTrail 无关的示例 + experiments/（A/B/C/D/E/F 运行器与读数）
├── skills/             README.md（索引）+ 十一个子目录，各含 SKILL.md（最多一层 references/）
└── docs/               本文件 + research-report / experiments / pilot-ourtrail / reuse-guide / limitations-roadmap
```

## 9. 建成与未建成（如实登记）

已跑通的（读数在各自文件里，不在本表）：

| 项 | 状态 | 证据 |
|---|---|---|
| 实验 A 已知偏差检测 | **已跑，达标** | 8 处注入偏差 8/8 检出且归类正确、4 处对照干净、0 unmapped ⇒ `docs/experiments.md` §2 |
| 实验 B 误报控制 | **已跑，达标（含 1 处已登记漏报）** | 6 类允许差异 6/6 PASS 且每例带反空转门、2 个阴性对照 2/2 FAIL；20px 以上字重漏报见 §3.6 |
| 实验 C 修复有效性 | **通用栈已跑，1 轮收敛**；OurTrail 实现层 **BLOCKED** | `c-repair` 8 对 7 FAIL → 8/8 PASS、几何 0 / 像素 0、0 新问题；试点内另有 1 条声明层修复 |
| 实验 D 可迁移性 | **已跑，达标** | 仓库外副本 0 处 OurTrail 引用、`codeVersion: null`、20 个区域逐字段相同 |
| 实验 E 运行目录新鲜度 | **已跑，达标（配变异）** | 同目录 PASS → 中止（退出码 2、旧报告已清、步骤日志点名 BLOCKED）→ 再 PASS；注释掉清理调用后 2 条转红 |
| 实验 F 命名视口 | **已跑，达标（配变异）** | 流式夹具 375/414 两视口截图与节点盒同步改变，两份报告各记 `viewportId`；固定机身页作阴性对照；把夹具钉回 390px 后 2 条转红 |
| OurTrail 试点 | **视觉已量、交互 4/4、修复提案 BLOCKED** | 15 对实态：12 处几何失败归因到 5 条声明级根因；实现层补丁 P1–P5 等授权 ⇒ `docs/pilot-ourtrail.md` |

仍未建成：

| 项 | 状态 | 说明 |
|---|---|---|
| 小程序侧的实验 A/B 成组实验 | 未做 | 注入偏差要改冻结页面（`pages/weather-hub/**`），授权不允许 |
| `components` / `sections` 声明 | 能力已落地，试点未声明 | `specimen` 页声明并在契约里逐值校验（3 组件 + 3 区块）；**试点 OurTrail 配置仍未声明**，`component-contracts` 与 `page-layout` 为空 ⇒ 试点契约覆盖仍记 UNVERIFIED |
| 结构级重排的自动归因 | 归因器已实现，真实样本 1 | `core/lib/cascade.js` + `tests/cascade.test.js`（39：每条几何记录恰好被归因一次、分项可加回原差、高度项是活算不是抄常数、归因不得把真差异洗成通过）；真实项目上仍只有试点 `tabs −89.99` 一次分解，复杂结构变化可能只给位移、指不到声明 |
| 新平台的适配器实验 | 未做 | 适配器契约与 `LIMITATIONS.md` 有，但只有 Web / 微信两个实现，没有第三个平台的实验 |
| 多视口 / 暗色 / RTL | 多视口已覆盖；暗色 / RTL 未覆盖 | 宽度轴由实验 F 验到布局层；视口**高度**只有 `b-taller` 单例，暗色模式与 RTL 仍只是配置里的声明 |

七个技能已落盘（`skills/README.md` 是索引）。它们不重复实现逻辑：
每个技能只规定"什么时候用、读哪份产物、过哪道门、失败怎么记"，
执行体仍是 `cli/pf.js`；因此技能可以独立安装，而 CLI 必须与技能同版本。


适配器层已可交付：描述符在加载时校验（`pf doctor` 会列出，描述符不合法则退出码 2），
`id`/`captureModule` 与真实模块不一致即报错，`limitations[]` 与 `LIMITATIONS.md`
的 `### <ID>` 小节由 `tests/contracts.test.js` 双向比对。
**CSS ↔ WXSS 的兼容性清单不在这里**：那属于 `target-platform-adapter` 技能的参考文档
（哪些有等价写法、哪些只能登记为平台差异），适配器描述符只回答"这件仪器量得出什么"。

这些缺口不会用"看起来跑通"的截图或虚构成功率来填。
