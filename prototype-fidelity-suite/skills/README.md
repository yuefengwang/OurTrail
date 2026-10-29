# 技能索引

七个技能覆盖一条完整链路：**把原型变成可校验的声明 → 在目标平台上量出偏差 → 定点修 → 复核**。
每个技能是一份 `SKILL.md` 加至多一层 `references/`，没有脚本、没有隐藏状态；
真正的执行体是同一仓库里的 `cli/pf.js`。

v0.2 另加四个技能（§5、§6）：`design-dna-extractor` 从已确认原型里抽出**带出处、带适用范围**
的设计知识；`ourtrail-design-dna` 把它变成有版本、有署名的项目知识库；`design-dna-generalizer`
反过来用这份知识库，为**还没有原型**的一屏生成页面设计；`design-consistency-reviewer` 审那份设计
过没过门——**设计方不能自己签字**。四者都不在保真链路里。

## 1. 七个技能

| 顺序 | 技能 | 一句话 | 主要命令 | 写到哪里 |
|---|---|---|---|---|
| 1 | `prototype-inspector` | 只读捕获原型：截图 + 快照 + 版本信息 | `pf capture --side prototype` | `captures/…/prototype/` |
| 2 | `target-platform-adapter` | 一对一映射、平台差异分级、捕目标 | `pf capture --side target`、`pf contract` | `platform-mappings.json`、`captures/…/target/` |
| 3 | `design-contract-builder` | 把原型固化成五份声明，逐值标出处 | `pf contract` | `design-tokens` / `component-contracts` / `page-layout` / 两份清单 |
| 4 | `visual-fidelity-analyzer` | 量偏差、出五维评分卡、归因 | `pf diff`、`pf validate` | `reports/<run>/` |
| 5 | `interaction-fidelity-validator` | 真实点一次并读到后果 | `pf interactions` | `interaction-contract.json` |
| 6 | `fidelity-repair-agent` | 最小补丁 + 双条件复测 | （复用 capture/diff/validate） | 目标实现源码（限授权） |
| 7 | `fidelity-orchestrator` | 编排、gate、停止条件、交付 | `pf verify`、`pf doctor` | `pf.config.json`、交付文档 |

## 2. 一次端到端最小流程

```bash
# 0) 环境
node cli/pf.js doctor

# 1) 声明（人在 pf.config.json 里写页面/状态/映射/交互）
node cli/pf.js init --dir <project>

# 2) 捕获两侧
node cli/pf.js capture --project <project> --page <id> --state <id> --side prototype
node cli/pf.js capture --project <project> --page <id> --state <id> --side target

# 3) 契约 + 测量 + 交互，一步到位
node cli/pf.js verify --project <project> --page <id> --state <id>

# 4) 修复后只重捕目标并复测（基线 run 保留）
node cli/pf.js capture --project <project> --page <id> --state <id> --side target
node cli/pf.js diff --project <project> --page <id> --state <id>
node cli/pf.js validate --project <project> --page <id> --state <id>
```

`verify` 会逐步打印 `capture/contract/diff/validate` 的状态；
任一步阻塞就停下并写 `verify-steps.json`，不会跳过继续假装成功。

## 3. 安装与迁移

- 把 `skills/<name>/` 整体复制到宿主的技能目录（例如 `.agents/skills/<name>/`）。
  `SKILL.md` 里的命令都相对于套件根目录，**不写绝对路径**。
- 套件本身零 npm 依赖；外部工具通过环境变量发现，**四个都在 `core/lib/env.js` 里**：

| 变量 | 用途 | 缺省行为 |
|---|---|---|
| `PLAYWRIGHT_MODULE_PATH` | Web 捕获/驱动的模块目录 | 报 `PLAYWRIGHT_MISSING`/`DRIVER_UNAVAILABLE`，不静默降级 |
| `MINIPROGRAM_AUTOMATOR_PATH` | 小程序驱动模块目录 | 同上 |
| `NODE_PATH` | 找不到上面两个时的后备搜索路径 | 不设置即跳过 |
| `WECHAT_DEVTOOLS_CLI` | 指向 `cli.bat` 的路径（供人工核对/文档用） | 不设置即不引用 |

- 迁移到另一个仓库时，只需改 `pf.config.json` 与 `adapters/<platform>/`；
  `core/` 不含任何平台分支（见 `adapters/README.md`）。

## 4. 所有技能共同的硬规则

1. **五值状态**：`PASS / FAIL / UNVERIFIED / BLOCKED / NOT_APPLICABLE`。缺证据 = `UNVERIFIED`，永不当通过。
2. **没有总分**：五维各自判定；critical 失败不能被非 critical 的通过数抵消。
3. **原型只读**；目标实现只做最小修复；容差与 `acceptedDifferences` 不是修复手段。
4. **截图不是断言**，元素存在不等于状态正确；结论必须能追到 run + 配对 + 数值。
5. **平台差异分级**：只有 `css-wxss-compatibility.md` 的 C 类可接受，且必须登记；
   字号/行距/内边距之类的差异不许用"平台差异"解释。
6. **不编造独立复核**：同一执行者兼做修复与复核时，记录写 `self-verified (same actor)`。

## 5. 设计知识抽取与版本化（v0.2）

| 技能 | 一句话 | 主要命令 | 写到哪里 |
|---|---|---|---|
| `design-dna-extractor` | 从已确认原型抽出 token / 组件 / 页面 / 交互 / 原则 / 例外，逐条带出处与适用范围 | `pf dna` | `design/dna-extract/out/`（`dna.json` + `dna-summary.md`） |
| `ourtrail-design-dna` | 项目级知识库：入库、查询、署名确认、冲突检查、改动影响面 | `pf kb …` | `design/knowledge/ourtrail/design-dna.json` |

与上面七个技能的关系：那七个回答"这一页实现得像不像"，这两个回答"这套原型里的设计规律是什么、能推广到哪"。
`design-dna-extractor` 的产物里每条规则的 `confirmation.status` 一律是 `candidate`——
抽取器不给自己发通行证，确不确认由人写 `by`，门（`design/lib/dna-invariants.js`）只认署名的确认。

**为什么是两个技能而不是一个**：抽取是只读原型的无状态过程，可以反复重跑；
知识库是有版本、有人签名、要跨轮次对账的数据。合并会让"重跑抽取"变成"覆盖确认记录"，
所以规则 corpus 住在数据文件里（`design/knowledge/ourtrail/`），技能目录只有说明书——
`tests/skills.test.js` 会拒绝把规则值抄回技能目录。

## 6. 设计生成与独立评审（v0.2）

| 技能 | 一句话 | 主要命令 | 写到哪里 |
|---|---|---|---|
| `design-dna-generalizer` | 业务结构 + 库 → 页面设计规格 / HTML 原型 / 决策与规则引用；选不到就留缺口 | `pf design` | `design/generalize/out/`（`design-plan.json` / `index.html` / `design-spec.md` / `design-decisions.json`） |
| `design-consistency-reviewer` | 八维逐项判定，每条发现带证据与可执行修复；设计者不能给自己签字 | `pf review` | `<plan dir>/review/`（`design-review-report.json` / `review.md`） |

三条禁令是机械的，不是口号：结构只取自 `brief.sections`（改顺序会被 `validatePlan` 拒）、
`page` 范围的规则永远不许用于新页面（那只是一种"机械复制"的另一种写法）、
每个功能必须恰好出现一次（删功能换视觉简洁 = `FUNCTION_DROPPED`）。
渲染出的每个节点只能是 `rule:<id>` 或 `brief`，没有第三种取值。

它只读知识库：缺口写进 `gaps`，**不**回写成规则，也不把"没量过"的数字补上。

评审的独立性是机械的，不是自律：`actor` 与 `designer` 同名（或任一方缺失）时，
无论各维读得多好，总判定都会被压到 `UNVERIFIED`——`SELF_REVIEW` / `NO_REVIEWER` / `NO_DESIGNER`
就是这样发出来的。反过来，缺证据的维度（`NO_RENDERED_ARTIFACT`、`UNCONFIRMED_RULES` 等）也只到
`UNVERIFIED`，不会被"其它六维都好"抵消成通过。评审器不修改设计文件，只产出报告。

## 7. 深入阅读

- 架构与判定次序：`../docs/architecture.md`
- 有效性实验（A/B/C/D 的读数与边界）：`../docs/experiments.md`
- 换一个项目的接入与故障速查：`../docs/reuse-guide.md`
- 已知限制与下一阶段：`../docs/limitations-roadmap.md`
- 契约字段与状态语义：`design-contract-builder/references/contracts.md`
- 评分卡五维：`visual-fidelity-analyzer/references/scorecard.md`
- 平台差异三级表：`target-platform-adapter/references/css-wxss-compatibility.md`
- 角色与文件所有权：`fidelity-orchestrator/references/roles.md`
- 适配器描述符与限制：`../adapters/README.md`、各适配器 `LIMITATIONS.md`
