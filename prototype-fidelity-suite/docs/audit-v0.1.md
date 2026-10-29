# v0.1 独立审计报告

> 审计对象：`prototype-fidelity-suite/` v0.1（提交 `fdc612f` 所在工作树）。
> 审计方式：**不看历史结论，自己重跑**；每一条主张都指到能复核的文件与行号。
> 审计日期：2026-10-29。
> 审计者身份：v0.2 的实施者。本文对"自己下一轮要改的东西"下判断，因此**只记录读数与归属，不预先给修复承诺**。
> 本文不修改任何产品代码、原型与业务页面；结论里凡是"应当"都只是给 v0.2 的输入。

---

## 1. 复跑读数（本次实测，不是引用文档）

| 命令 | 读数 | 退出码 |
|---|---|---|
| `node tests/run.js` | 11 套，`passed=510 failed=0` | 0 |
| `node examples/generic-web/experiments/run.js` | A/B/C/D 共 `109` 条断言全过 | 0 |
| `node cli/pf.js doctor` | playwright / miniprogram-automator / WeChat CLI / 端口 33278·9421 全部 available | 0 |

**这三个读数与 `README.md`、`docs/experiments.md` 记载一致**，v0.1 没有虚报总数。
本报告的争议点全部在"读数说明什么"，不在"读数是否真实"。

---

## 2. 七个审计问题的回答

### Q1 测试是否真的验证了它声称的能力

**部分验证。** 区分三类：

- **真验证**（有阳性 + 阴性对照、结论能追到数值）：实验 A 的 8 处偏差 + 4 处对照、
  实验 C 的"锚点命中恰好一次 / 修后零残留 / 无回退 / 一轮收敛"、实验 D 的仓库外复现。
  这些不是自证式的：实验 C 先把 target 覆盖成与夹具**逐字节相同**（sha256 相等）再跑 before，
  实验 A 要求"恰好 8 项失败"而不是"至少 8 项"。
- **结构验证**（只证明文档形状对，不证明能力存在）：`tests/skills.test.js`。
- **未验证**（声称有、实际没有）：见 Q2/Q3。

### Q2 测试与实现是否共享了错误假设

**有两处。**

**F2（未披露）· 实验 B 的反空转门不是"每例都有"。**
`examples/generic-web/experiments/run.js:199-202` 对 `b-taller` 只有两条断言：
`rc===0 && verdict==='PASS'` 与 `allPass()`。它没有证明**那块多出来的视口高度真的发生了**。
实证：该 case 的配置是 target `viewport{width:390,height:900}` vs prototype 844
（`examples/generic-web/pf.config.json`），而报告里 `report.prototype.viewport=844 / report.target.viewport=900`、
两侧 `screenshotSha256` 不同 —— **差异确实发生了，且记录在案，但没有任何断言读它**。
后果：如果哪天 `viewport` 覆盖被静默忽略（改一行 `doCapture` 就能做到），这个 case 仍然全绿。
这正是 `run.js` 自己注释里说的"一个从未被行使的容差，和一个不存在的容差无法区分"。
`docs/experiments.md:12` 与 `run.js:58` 都写着"每例附带反空转门"——对 `b-taller` 不成立。

**F3（未披露）· "0 条 unmapped warning" 测量的是一个不存在的量。**
`run.js:149` 的断言是 `r.report.warnings.length === 0`。
`cli/pf.js:607` 的 `buildWarnings` 只会产出六类文本：注入数据、截图缩放、动态文本、被掩码容器、
UNVERIFIED 区域、NOT_APPLICABLE 区域。**代码里根本没有"未映射"这个概念**：
`grep -rn unmapped core cli adapters` 无命中，`unmapped` 只出现在文档与这条断言的名字里。
`core/lib/geometry.js:451` 有一个 `derivePairs`（按结构路径自动配对）但**没有任何调用者**。
所以"映射完整性"从未被测量：两侧都存在、却谁都没声明映射的节点，v0.1 不会报。
generic-web 的夹具两侧 HTML 几乎同构，这条断言在那种夹具上恒真。

### Q3 是否可能漏掉视觉差异

**会，且四条机制都在。** 三条已披露，一条半披露：

| 机制 | 位置 | 后果 | 披露状态 |
|---|---|---|---|
| 墨迹签名漏 ≥20px 字重 | `core/lib/diff.js` `compareInk` 的 `amountRatio:0.3` | `b-weight` 20px 标题墨量比 1.087 记 PASS | 已披露（`experiments.md` §3.6） |
| 区域只比**两侧矩形的最小公共子矩形** | `core/lib/regions.js:51-54` | 试点 240px vs 350px 时，多出的 110px 里的一切像素差异**不参与像素判定**；只记 `uncomparedCss` | 半披露：说明了"尺寸差是几何结论"，没说明"那部分像素没看" |
| `pixel:false` 配对完全不做像素 | `cli/pf.js:455` | 试点 15 对里 4 对（`recent`/`list`/`asset-row`/`foot`）只有盒模型 | 已披露 |
| `informational` 模式只在墨迹层判定 | `cli/pf.js` `pixelMode` | 文本叶节点的像素差只作证据 | 已披露 |

**没有"像素覆盖率"这个读数**：报告能说"比了 12 个区域"，不能说"整页有多少比例的像素被比过"。

### Q4 是否把未验证项提升成了 PASS

**两处，一重一轻。**

**F4（未披露语义）· `components` 契约的 PASS 含义是"选择器找到了"。**
`core/lib/contract.js:90`：`buildComponents` 只要在**原型侧**快照里找到选择器，
就写 `status: 'PASS'`；它从不读目标侧快照，因此"组件契约通过"并不表示两侧一致。
配套事实：试点 `examples/ourtrail/contracts/weather-hub-home/component-contracts.json`
是 `{"components":[]}`，`page-layout.json` 是 `{"sections":[],"rhythm":[]}`。
**空契约 + PASS 语义 = 读者很容易以为"组件层面验过了"**。
（`docs/architecture.md` §9 已把"未开始 / UNVERIFIED"写清楚，所以这是语义陷阱，不是虚报。）

**F14（轻）· 契约里 PASS 同时表示"已捕获"与"已校验"。**
`core/lib/manifests.js:45` 与 `:92`：`status: shot ? 'PASS' : 'UNVERIFIED'`。
而 capture manifest 自己写的是 `verification: 'captured'`。同一个词在两层含义不同，
下游一旦用 `contracts/*/prototype-manifest.json` 判断"验过了"，就会把"拍到了"读成"对上了"。

### Q5 Skills 是否可被 Agent 发现与调用

**结构性可发现，但"被调用"没有被验证，而且现在装不上。**

- `skills/<name>/SKILL.md` 的 frontmatter 形状与宿主技能一致
  （对照 `.agents/skills/ourtrail-ui/SKILL.md`：`name` + `description` + Markdown 正文），
  所以**复制过去就能被发现**。
- 但它们不在任何宿主技能目录里：本轮会话的技能清单里没有这 7 个名字。
  `skills/README.md` §3 写的是"整体复制到宿主的技能目录"——**这是一步人工操作，没有安装脚本，也没有被测试过**。
- **F1（部分披露）**：`tests/skills.test.js` 只检查结构——frontmatter、必填小节、
  无绝对路径、`references/x.md` 存在。它**从不执行技能里写的命令**，
  所以"技能里的命令能不能跑"与它无关（`limitations-roadmap.md` §4.1 已承认这一点）。
- **F1b（未披露）**：同一测试 `tests/skills.test.js:67` 硬编码七个目录名
  （`eq('seven skills', dirs, [...])`）。v0.2 只要新增一个技能，这条断言必红——
  它把"当前清单"钉成了"合法清单"。

### Q6 契约能否承载 Design DNA

**不能。** 现有十一份契约回答的是"这一页与那一页差在哪"，没有一处描述"这套设计是什么"：

- `design-tokens.json` 是**单页、单状态**的 token 计数（`collectTokens` 只看一个快照），
  没有跨页汇总、没有出现频次以外的语义、没有适用范围；
- `component-contracts.json` 的 `role/criticality` 是人写的标签，不是从渲染里发现的模式；
- 没有"信息层级 / 组件选择理由 / 交互模式 / 设计原则 / 例外"这些字段；
- `provenance` 词表（measured/inferred/confirmed/unknown）**是对的**，但只用在数值上，
  没有用于"这条规则可信吗"。

结论：DNA 需要独立的数据模型与独立的目录，不是给现有契约加字段（§6.1 的 `components` 补全也不等于 DNA）。

### Q7 小程序截图是否有可靠的构建版本证据

**没有。** 三条独立证据：

1. `adapters/wechat-miniprogram/capture.js` 全文没有 `codeVersion`、没有 bundle hash、
   没有 build id、没有编译时间——它连这个词都不出现。
2. 版本号来自 `cli/pf.js:172`：`gitHead(cfg.__dir)`，即**套件所在仓库的 HEAD**。
   它证明"取图时仓库在这个提交"，不证明"模拟器跑的是这个提交编出来的包"。
3. 适配器用的是 `mp.reLaunch(pagePath)`（`capture.js:141`），**不触发重新编译**。
   所以旧 bundle + 新 HEAD 是可能且已被怀疑发生过的组合。

`docs/pilot-ourtrail.md` §10.5 已经把它记成 `UNVERIFIED`——**披露是诚实的，能力是缺的**。
v0.1 曾经用来缓解的手段是"新文案自证"（新写的字符串出现在屏幕上 ⇒ 包是新的），
这是**人工判据**，不是套件能力，且只在恰好改了文案时成立。

---

## 3. 其余发现（不在七问之内，但对 v0.2 有约束）

**F6（未披露）· 几何维度把 `unverified` 硬编码成 0。**
`core/lib/score.js:171`：`checks: { …, unverified: 0 }`，第 173 行传给 `dimensionVerdict` 的也是 `0`。
于是 `compareNode` 因为"盒模型不同"把宽高降级为 UNVERIFIED（`geometry.js:293-305`）时，
这条降级**不会**把几何维度拉成 UNVERIFIED。
排版与外观维度都传了真实的 `unverified`，只有几何没传。试点 `primary dh +32` 正走这条路径。

**F7（未披露）· `spacing` / `layout` 类别不进入任何维度——会导致"整页 FAIL、三维全 PASS"。**
- `geometry.js` 会产出 `spacing`（padding/margin/gap）与 `layout`（overflow/display/position…）两类记录；
- `score.js:129/144` 的排版与外观只认各自的属性白名单；
- `cli/pf.js:719-733` 的 `doValidate` 传 `pixel: null`，且**从不传 `input.spacing`**
  （`score.js:121` 那个分支在真实 CLI 调用里永远不成立；只有单测手工传）。

实测（本轮合成读数，两个配对，只有 `padding` 差）：

```
overall = FAIL
  geometry    PASS {"total":4,"pass":4,"fail":0,"unverified":0}
  typography  PASS {"total":4,"fail":0,"pass":4,"unverified":0}
  appearance  PASS {"total":2,"fail":0,"pass":2,"unverified":0}
failingRegions = b:["spacing"]
```

即：**验收判 FAIL，报告里找不到是哪一维失败的**。`score.js:145-148` 的注释说这类问题已经为
pixel/ink 修过，`spacing`/`layout` 没跟上。真实页面上这条通常被同时发生的像素差掩盖
（像素差会进 `appearance`），所以只在"配对声明了 `pixel:false`"或"像素差低于阈值"时才暴露——
而这两种恰好都是**本套件推荐的合法用法**。

**F8（已披露）· 接受粒度只到类别，无按轴/按值接受。** `docs/limitations-roadmap.md` §2.2 有记。

**F9（已披露）· 图标 / 阴影 / 渐变无专门判据。** 同上，§2.2 有记。

**F10（已披露）· 多状态 / 多视口未验证。** 配置支持 per-side viewport，但实验只有
390×844（+ `b-dpr2` 的 2×、`b-taller` 的高度），没有 375/414、没有暗色。§2.3 有记。

**F11（已披露）· "结构级级联归因"是人工方法 + 夹具回归，不是算法。**
实验 C 里 `b-btn dy = -4 = +2(卡片增高) - 6(自身 margin)` 的分解是真的，
但它是**夹具里预先写好的期望**；套件没有任何代码从差异图反推级联。

**F12（半披露）· 没有修复器，因此也没有"有界修复 + 回滚"。**
`grep -rln repair core cli adapters` 只命中 `tests/skills.test.js`。
`skills/fidelity-repair-agent/` 是一份协议文档，不是执行体；真正的执行是"人/脚本改文件"。
实验 C 的修复是脚本里硬编码的三条 `from → to`，而所谓"重置"是用夹具覆盖 target，
那是**回到起点**，不是"撤销一次有界补丁"。

**F13（正面，应当保留）· 若干设计是对的，v0.2 不得为了新功能削弱它们：**
五值状态 + `UNVERIFIED` 不进 PASS；`dynamicText` 拆掉 text/ink/pixel 但保留 presence/geometry；
容器按声明子区域掩码；锚点重定基只动 dx/dy 且保留 `rawDx/rawDy`；
区域只比公共子矩形而不比两块不同区域；实验 C 的"锚点命中恰好一次"。

---

## 4. 主张 → 五态分类

| 主张（v0.1 自述） | 分类 | 依据 |
|---|---|---|
| 已知偏差 8/8 检出并归到正确类别 | **已实现且实测通过** | 本轮复跑 109/0；`pos-8 dx=-8`、`gap-4 → spacing` 等读数在 `reports/exp-specimen/` |
| 4 处未改动对照保持干净 | **已实现且实测通过** | 四对 `categories=[] pixel=0` |
| 允差（AA / DPR / 视口高 / 动态文案 / 外壳偏移 / 字重分档）控制误报 | **已实现且实测通过（b-taller 除外）** | 其余五例有反空转门；`b-taller` 无门 ⇒ 该例**已实现但未验证** |
| 声明动态文案可豁免文本/墨迹/像素判定，且未声明时同字节会红 | **已实现且实测通过** | 同字节两侧 `px` 差 <2pp、只有 `b-clock` 失败 |
| 锚点重定基 | **已实现且实测通过** | `shift{y:24}`、`rawDy=24` |
| 修复有效性（定位 → 改文件 → 复测 → 无回退） | **已实现且实测通过（作为方法论）**；自动修复器 **尚未实现** | 实验 C 的 `from→to` 是脚本常量 |
| 可移植（仓库外复现） | **已实现且实测通过** | 实验 D |
| 五维评分卡 | **已实现且实测通过** | 但 `spacing`/`layout` 无维度归属（F7）、几何 `unverified` 恒 0（F6） |
| `components` / `sections` 契约 | **仅有接口或设计** | schema 有、`contract.js` 只量原型侧且 PASS=找到；试点产物为空 |
| 契约承载"设计是什么"（Design DNA） | **尚未实现** | 十一份契约无一字段描述跨页规则 |
| 小程序构建版本可证 | **仅有接口（`codeVersion` 字段）**，证据链 **BLOCKED** | 适配器不产出、`gitHead` 不等于被检包 |
| 7 个 Skill 可被 Agent 发现并调用 | **仅有结构（文档形状）**；安装与调用 **未验证** | 不在宿主技能目录；`skills.test.js` 只查结构 |
| 自动结构级级联归因 | **尚未实现** | 样本 1，且是手工分解 |
| 有界修复 + 回滚 | **尚未实现** | 无 repair 代码，无回滚产物 |
| 多状态 / 多视口 / 暗色 | **仅有配置接口**，实验覆盖 **尚未实现** | 只有 390×844 一组 |

---

## 5. 对 v0.2 的输入（约束，不是承诺）

1. **F2/F3 属于"测试说了它没做的事"**，优先级高于任何新功能：新增能力不得沿用这类断言写法。
   v0.2 新增的每个容差类用例必须自带"差异真的发生了"的断言，且该断言要读一个**独立于容差的量**
   （例如视口高度读 `capture-manifest.json`，不读 diff 结果）。
2. **F7 说明"维度命名"是报告可用性的前提**：`spacing`/`layout` 不进维度，验收就退化成"红但说不出为什么"。
   v0.2 的细粒度接受机制（§6.5）必须先给每个类别一个维度归属，否则"更细的接受"只会更细地不可解释。
3. **F4 的 PASS 语义陷阱**决定了 §6.1 的做法：组件契约必须**两侧都量**，
   且 `PASS` 只能表示"两侧一致"，"找到了"要用另一个字段（`resolved`）表达。
4. **Q7 决定 §6.2 的做法**：不能再拿仓库 HEAD 当版本证据。
   可行的证据是"被检包内容本身的指纹"（文件字节哈希 / 编译产物清单）+ "该指纹出现在截图时刻之前"，
   并且**版本不一致时必须 UNVERIFIED，不能 PASS**。
5. **F12 说明 §6.7 只能做"有界 + 可回滚的修改原语"**，不要假装能做全自动修复：
   原语 = 预检（锚点唯一）→ 备份（内容哈希）→ 写入 → 复测 → 不达标则按备份回滚，全过程留证。
6. **F1b 必须在 v0.2 修掉**：技能清单测试不能硬编码，否则"新增技能"这个动作本身就会让套件变红。

---

## 6. 审计自身的边界（没做的事）

- **没有**在小程序侧重跑实验 A/B——那需要改冻结页面或注入偏差，属任务书禁止的动作。
  因此"微信链路上的误报控制"本轮仍是 `NOT_RUN`，本报告不为它背书。
- **没有**验证 `docs/pilot-ourtrail.md` 的 15 对结论本身（那是被检项目的现状，属只读设计资产）；
  只核对了它引用的产物存在、且与报告数字一致。
- **没有**评估 7 个 Skill 的**内容质量**（是否写清了失败处理），只核对了结构与可调用性。
- `docs/research-report.md` 的仪器读数（`App.CDPEnable unimplemented`、0.7846×0.7820）
  **未在本轮重新取证**：重取需要在共享开发者工具会话上跑一次捕获，本轮未获授权。
  这两条沿用 v0.1 的原始读数，v0.2 若要用它们作判据，必须重新取证。
