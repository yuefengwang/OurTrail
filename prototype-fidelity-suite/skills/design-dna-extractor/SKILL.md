---
name: design-dna-extractor
description: 从可运行的 HTML 原型里提取可追溯的设计知识（token / 组件模式 / 页面模式 / 交互模式 / 设计原则 / 例外），每条规则带来源、证据、适用范围、可信度、确认状态与例外；范围只由"出现在几个页面、几族页面"计数得出，全部以 candidate 出库，永远不会自动变成规范。用于"这批原型到底约定什么""新页面该怎么长""这条规则算不算全局"。
---

# design-dna-extractor

把「三张原型截图背后的约定」写成一张可以引用、可以反驳、可以过期的表。

核心区别：**保真套件量的是"这一屏和那一屏差多少"，本技能量的是"哪些做法是多屏共有的"**。
前者有基线，后者没有基线——所以后者每一条都必须自己带证据，并且默认**不是**规范。

## 何时用

- 要从成熟原型的多个页面里提炼设计知识（token、组件形态、页面骨架、交互模型）。
- 新页面要按既有视觉语言设计，但没人能说清"既有"具体是什么。
- 有人主张「我们这个产品就是圆角 18」——需要一条能被复核的出处，而不是印象。
- 升级设计规范前，需要知道现有原型**实际**长什么样（而不是规范文档声称的）。

不适用：单页保真比对（用 `visual-fidelity-analyzer`）、真机像素核验（用
`interaction-fidelity-validator` 与目标平台适配器）、从零做视觉方向（那是设计工作，不是提取）。

## 硬约束

1. **只读原型**。不点击、不修改、不重排原型目录；状态通过 `sources.json` 里的
   `steps`（`click` / `evaluate`）在一次性浏览器会话里摆好，产物只写 `--out`。
2. **没有证据的规则不许存在**。`rule()` 在 `evidence` 为空时直接抛错；这是故意的，
   不是可以 catch 掉的异常。
3. **范围只许由计数得出**。`scope.level` 由"出现在几个页面 + 跨了几族"推导；
   `global` 额外要求覆盖全部页面**且**跨 ≥2 族——一条只在天气族里成立的做法，
   计数上就不可能变成全局规范。
4. **一律 `confirmation.status = "candidate"`**。提取器没有权限确认任何事情；
   确认是人做的事，写进后续知识库时补 `by` / `at`。
5. **不推断设计意图**。只输出「实测 / 观察 / 推断」三类里的前两类，`inferred` 只用于
   由测量直接算出的量（如两区块间距）。"因为要显得高级所以用了 1.8px 描边"这类句子不写。

## 输入

| 输入 | 位置 | 说明 |
|---|---|---|
| 原型根目录 | `sources.json` 的 `root` | 相对 `sources.json` 解析；必须存在 |
| 视口 | `sources.json` 的 `viewport` | 测量口径；改变它等于换一套证据 |
| 页面清单 | `sources.json` 的 `pages[]` | `id` / `family` / `file` / `root` / `sectionRoot` |
| 状态清单 | `pages[].states[]` | `steps: [{click}\|{evaluate}\|{wait}\|{settleMs}]`；`screen: true` 表示独立整屏 |
| Playwright | 仓库外，`node cli/pf.js doctor` 可见 | 缺失即 BLOCKED，不降级到 computed-style-only |

`screen: true` 是必填信息而不是可选优化：只把"整屏"当页面模式，弹层态与子视图态
不参与"这个页面长什么样"的计数，否则一个页面的多种状态会被读成多个页面。

## 步骤

1. `node cli/pf.js doctor` —— `playwright available` 才继续。
2. 读原型 HTML/JS，写 `design/dna-extract/sources.json`：每个页面 + 每个要采集的状态。
   状态必须是**能复现的**（URL 参数或 `evaluate`），不接受"截个差不多的图"。
3. `node design/dna-extract/extract.js --out <dir>`（或 `node cli/pf.js dna --out <dir>`）。
4. 打开 `<dir>/dna-summary.md`：先看覆盖与告警，再看逐条陈述。
5. 用 `schemas/design-dna.schema.json` 与 `design/lib/dna-invariants.js` 过一遍：
   schema 管形状，invariants 管"这条声称站不站得住"。
6. 交给 `ourtrail-design-dna`（版本化知识库）入库；入库时才允许出现 `confirmed`。

## 输出

| 文件 | 内容 |
|---|---|
| `dna.json` | 规则集 + 覆盖 + 指纹 + 告警 + 边界 |
| `dna-summary.md` | 同样内容的人读版；按类别分表，附覆盖与告警 |

每条规则的字段就是"来源 / 证据 / 适用范围 / 可信度 / 是否经用户确认 / 例外情况"：

```jsonc
{
  "id": "page.phone-frame",
  "category": "page",                 // token | component | page | interaction | principle | exception
  "kind": "measured",                 // measured | observed | inferred
  "statement": "三页共用手机外壳（statusbar 29px，wechatbar 43px…）",
  "value": { "parts": { "…": "…" } },
  "evidence": [{ "type": "frame-part", "page": "weather", "state": "hourly",
                 "source": "rendered node", "selector": ".statusbar", "prop": "rect",
                 "value": "390.0×29.0" }],
  "support": { "pages": ["activity-detail", "activity-list", "weather"], "instances": 12 },
  "scope": { "level": "global", "pages": ["…"], "families": ["activity", "weather"],
             "rationale": "在全部 3 个…跨 activity/weather 两族——范围来自出现次数，不是设计判断" },
  "confidence": "high",
  "confirmation": { "status": "candidate", "by": null, "at": null },
  "exceptions": []
}
```

## 质量门

一次提取只有在下列全部成立时才可交给下游：

- `dna.json` 通过 `schemas/design-dna.schema.json`；
- `checkDna()`（`design/lib/dna-invariants.js`）返回 `violations: []`；
- 每条规则 `confirmation.status === "candidate"`，`summary.confirmed === 0`；
- 每条的 `scope.pages` 都能在 `evidence` 里找到至少一个该页实例（截断不许把页面截掉）；
- `fingerprints` 覆盖所有 `sources[].file`，且每个 `sha256` 为 64 位十六进制；
- `coverage[].share` 的分母是**可见节点数**，不是全文档节点数；
- 页面模式只用 `screen: true` 的状态；相邻同角色区块必须带上选择器区分，不许出现
  「内容区 → 内容区」这种无法执行的陈述。

任一不成立 ⇒ 本次提取 UNVERIFIED，不得入库。

## 失败处理

| 现象 | 处置 |
|---|---|
| `drawing is empty` / 0 可见区块 | 该状态的 `sectionRoot` 写错或元素被 `hidden`；记一条 `walker-miss` 规则（带例外说明），不要静默跳过 |
| 规则抛 `has no evidence` | 提取缺陷，不是配置缺陷：先确认页面真的渲染了，再修提取器；**不要**给规则塞占位证据 |
| `--line` / `--pale` 等变量报"无消费者" | 先怀疑 CSSOM：含 `var()` 的简写属性在 Chromium 里长手属性读出空串；按 `rule.style.cssText` 重解析 |
| 字面量色值数量等于页数整数倍 | 同一张样式表被多页共享，去重键要按"声明"而不是"使用" |
| `font-weight 400` 变成一条规则 | 那是 CSS 初始值不是决策：只统计**样式表里声明过**的字重 |
| 弹层/轻提示"不存在" | 它们常驻 DOM 但不可见；按 `role` 找，`visible=false` 写进证据，别当成没有 |
| 原型目录不存在 | 报错退出 2；不要回退到"看起来差不多"的目录 |

## 示例

```bash
node cli/pf.js doctor
node design/dna-extract/extract.js --out design/dna-extract/out
# design-dna: 128 rules → design/dna-extract/out/dna.json
#   by category: token=56 component=56 page=5 interaction=5 principle=5 exception=1
#   by scope:    global=34 page-family=20 page=74
#   ! 177 个色值未 token 化（8 个重复 ≥3 次）
```

## 与其他技能的关系

- 上游：无（只读原型）。可与 `prototype-inspector` 并行——后者为保真服务，本技能为设计知识服务。
- 下游：`ourtrail-design-dna`（版本化知识库，入库/查询/冲突检查）、
  `design-dna-generalizer`（依据 DNA 设计新页面）、`design-consistency-reviewer`（用 DNA 判定实现是否偏离）。
- 它**不判定**哪条规则好、不排序重要性、不改原型、不写产品代码。
