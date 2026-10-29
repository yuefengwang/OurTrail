# 角色、产物与所有权

七个角色 = 七个技能。角色可以落在同一个执行者身上，但**记录里必须写清楚是谁**
——"独立复核"是一个事实，不是一个形容词。

## 1. 角色与产物

| 角色 | 技能 | 主要动作 | 拥有的产物 | 明确不碰 |
|---|---|---|---|---|
| A 原型捕获 | `prototype-inspector` | 截原型屏、取快照、记代码版本 | `captures/<page>/<state>/prototype/**` | 原型目录任何写操作；目标侧 |
| B 契约 | `design-contract-builder` | 令牌/组件/布局/状态清单 | `contracts/<page>/{prototype-manifest,page-state-manifest,design-tokens,component-contracts,page-layout}.json` | 映射、交互、目标源码 |
| C 平台适配 | `target-platform-adapter` | 一对一映射、平台差异分级、捕目标 | `contracts/<page>/platform-mappings.json`；`captures/…/target/**`；`adapters/<platform>/**`（新增平台时） | 原型捕获、实现源码 |
| D 测量 | `visual-fidelity-analyzer` | `diff` + `validate`、归因 | `reports/<page>-<state>-<ts>/**` | 任何源码、容差、acceptedDifferences |
| E 修复 | `fidelity-repair-agent` | 最小补丁 + 自测建议 | 目标实现文件（**限授权范围**） | 原型、冻结模块、容差、报告 |
| F 交互 | `interaction-fidelity-validator` | 交互契约 + 真实运行观测 | `contracts/<page>/interaction-contract.json` | 视觉结论、实现源码 |
| G 编排 | `fidelity-orchestrator` | 分派、gate、停止条件、交付 | `pf.config.json`；编排/交付文档 | 亲自测量或修复 |

## 2. 文件所有权（防并发写坏的唯一依据）

| 路径 | 写者 | 说明 |
|---|---|---|
| `docs/prototypes/**`（原型） | **无人** | 只读；要改原型是产品决定 |
| `captures/<page>/<state>/prototype/**` | A | 同一 run 内不重写历史捕获 |
| `captures/<page>/<state>/target/**` | C | 状态/视口变了就重捕，不叠写 |
| `contracts/<page>/*.json` | 对应所有者（B/C/F） | `pf contract` 会一并写出；**内容责任**按表分 |
| `reports/<run>/**` | D | 修复轮次新建 run，不覆盖旧 run |
| `pf.config.json` | **G** | 其他角色提交 section 级建议，由 G 落笔 |
| 目标实现源码 | E | 单轮单来源；受保护文件只能出建议 |
| 交付文档 / 编排记录 | G | 必须引用 run id |

规则：

1. **一个文件同一时间只有一个写者。** 跨角色的同一文件改动必须排队。
2. `pf.config.json` 是单文件，最容易撞车：mappings 属 C、interactions 属 F、
   components/sections 属 B、tolerances/pages 属 G——但**落笔权在 G**。
3. 修复轮次不覆盖旧 run：新 run 目录就是新证据，旧的留着做回归对比。

## 3. 交接契约

每次交接必须带四样，缺一退回：

```json
{
  "from": "D", "to": "E",
  "run": "reports/weather-hub-home-real-2026-10-28T12-57-30",
  "status": { "page": "FAIL", "geometry": "FAIL", "appearance": "PASS", "interaction": "UNVERIFIED" },
  "items": [{ "pairId": "primary", "category": "size", "read": "h 60 → 92" }],
  "notChecked": ["native chrome", "pseudo-elements", "interaction (driver blocked)"]
}
```

`notChecked` 是必填项：没有它，下游会把"没测"当成"没问题"。

## 4. 谁能复核谁

| 复核对象 | 允许的复核者 | 禁止 |
|---|---|---|
| A 的捕获（版本/尺寸/数据源） | D（provenance gate） | A 自己声明"捕获无误" |
| B 的声明 | D（用渲染读数反证） | B 用自己的声明证明自己 |
| C 的映射 | B/D（选择器命中 + 读数） | C 用"看起来对"结案 |
| E 的修复 | **D（视觉）、F（交互）** | E 自己宣布通过 |
| F 的交互 | G 核对断言是否指向后果 | F 用截图替代断言 |
| 全部 | G 只核完整性，不代替测量 | G 代写"通过" |

同一个执行者兼做修复与复核时，记录写 `self-verified (same actor)`；
把它写成"独立复核"就是把流程变成了装饰。

## 5. 冲突怎么判

| 冲突 | 判据 |
|---|---|
| 契约说 30px，渲染读 34px | 以渲染为证据、契约为声明：先查声明是否取错节点，再查实现 |
| 两个 run 读数不同 | 先比 `provenance`（代码版本/数据源/视口）；不同则不可比 |
| 视觉 PASS，交互 FAIL | 两者独立成立；页面结论取更差者 |
| 需要改容差才能 PASS | 不是修复，是产品决定；G 记 `productDecision` |
| 平台差异 vs 实现错误 | 只有 `css-wxss-compatibility.md` 的 C 类可接受；A 类必须修，B 类要靠实测升级 |
