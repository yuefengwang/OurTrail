# 技能索引

七个技能覆盖一条完整链路：**把原型变成可校验的声明 → 在目标平台上量出偏差 → 定点修 → 复核**。
每个技能是一份 `SKILL.md` 加至多一层 `references/`，没有脚本、没有隐藏状态；
真正的执行体是同一仓库里的 `cli/pf.js`。

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

## 5. 深入阅读

- 架构与判定次序：`../docs/architecture.md`
- 有效性实验（A/B/C/D 的读数与边界）：`../docs/experiments.md`
- 换一个项目的接入与故障速查：`../docs/reuse-guide.md`
- 已知限制与下一阶段：`../docs/limitations-roadmap.md`
- 契约字段与状态语义：`design-contract-builder/references/contracts.md`
- 评分卡五维：`visual-fidelity-analyzer/references/scorecard.md`
- 平台差异三级表：`target-platform-adapter/references/css-wxss-compatibility.md`
- 角色与文件所有权：`fidelity-orchestrator/references/roles.md`
- 适配器描述符与限制：`../adapters/README.md`、各适配器 `LIMITATIONS.md`
