# prototype-fidelity-suite

把**可运行的 HTML 原型**变成可校验的设计与交互契约，在**目标技术栈**上量出偏差、定位到声明、
做有界修复并复验的 Agent Skill Suite。首个验证场景是 OurTrail 微信小程序，
但核心与 Web 适配器不含任何 OurTrail 的路径、组件或业务数据。

- 零 npm 依赖（Node ≥ 18 内建即可；PNG 编解码 / 像素比对 / 几何比较全部内置）
- 真实渲染才是验收依据：每个结论挂代码版本、运行时、DPR、截图 sha256、时刻
- 五态 `PASS / FAIL / UNVERIFIED / BLOCKED / NOT_APPLICABLE`，**缺证据永不变成 PASS**
- 没有单一总分：几何 / 排版 / 外观 / 状态 / 交互五维各自判定

## 60 秒上手

```bash
node cli/pf.js doctor                                  # 环境体检（缺什么会明确说）
node tests/run.js                                      # 套件自检：20 套 / 1095 断言
node examples/generic-web/experiments/run.js           # 实验 A/B/C/D/E/F：128 断言（需 Playwright）
node tests/fixtures/run.js                             # 独立验证夹具：9 类场景，判据全部由 fixture.json 声明
node cli/pf.js verify --project examples/generic-web --page b-identical   # 一次完整保真验收
```

接入自己的项目：`node cli/pf.js init --dir <project>`，然后按
[`docs/reuse-guide.md`](docs/reuse-guide.md) §2 的七步写配置。

## 目录

```
cli/pf.js                唯一入口（doctor / init / capture / contract / diff / validate / interactions / verify / repair / schema / dna / kb / design / review）
core/lib/                20 个纯函数模块（png / image / diff / regions / geometry / contract / score / interaction / report / env / acceptance / cascade / bundle / repair…）
adapters/                平台层：web（Playwright）与 wechat-miniprogram（miniprogram-automator）
  ├─ README.md           适配器契约与"接一个新平台"五步
  ├─ web/                capture.js + adapter.json + LIMITATIONS.md
  └─ wechat-miniprogram/ 同上
schemas/                 17 份 JSON Schema（11 份契约 + 6 份支撑：适配器描述符 / DNA / DNA 库 / 设计计划 / 评审报告 / 修复报告）
tests/                   20 套 / 1095 断言，tests/run.js 按进程隔离执行
skills/                  11 个技能（7 保真 + 4 设计知识，索引见 skills/README.md）
design/                  v0.2：dna-extract（抽取）/ knowledge（版本化库）/ generalize（设计生成）/ review（独立评审）
examples/generic-web/    与 OurTrail 无关的示例 + 实验运行器（A/B/C/D/E/F）与读数
examples/ourtrail/       试点配置与证据（原型冻结只读；目标页零改动）
docs/                    交付文档与审计报告，见下
```

## 文档索引

| 文档 | 回答什么 |
|---|---|
| [`docs/research-report.md`](docs/research-report.md) | 11 个候选技能/工具的真实功能、许可、运行时与裁决（REUSE/ADAPT/REFERENCE/REJECT） |
| [`docs/audit-v0.1.md`](docs/audit-v0.1.md) | 对 v0.1 的独立复跑与七项核查：哪些能力被测试证明了、哪些只是被声称 |
| [`docs/architecture.md`](docs/architecture.md) | 分层、11 份契约、判定次序（含"比不了就不判"两条规则）、交互语义、容差 |
| [`docs/experiments.md`](docs/experiments.md) | A 已知偏差检测（8/8 + 4/4 对照）、B 误报控制（6/6 + 2 阴性对照）、C 修复（1 轮收敛）、D 可迁移（20 区逐字段相同）、E 运行目录新鲜度（中止的运行不得留下上一次的裁决）、F 命名视口（375/414 布局级，配固定机身阴性对照）——六组共 128 断言 |
| [`docs/delivery-v0.2.md`](docs/delivery-v0.2.md) | v0.2 交付报告：九项能力按五态分类、本次实测读数、独立夹具的发现、未见页面试验计划（未执行）、已知限制与待裁决 |
| [`docs/pilot-ourtrail.md`](docs/pilot-ourtrail.md) | OurTrail 试点：15 对实态读数、5 条根因、级联分解、交互 4/4、补丁提案（BLOCKED） |
| [`docs/reuse-guide.md`](docs/reuse-guide.md) | 安装、接入新项目七步、接新平台、维护、故障速查、可复用边界 |
| [`docs/limitations-roadmap.md`](docs/limitations-roadmap.md) | 四层限制、未完成清单、路线图，以及**十个问题的逐条回答** |
| [`skills/README.md`](skills/README.md) | 11 个技能的分工（7 保真 + 4 设计知识）、最小端到端流程、安装与环境变量、共同硬规则 |

## 当前状态（一句话一条）

- **能跑的**：原型捕获、契约生成、区域级差异 + 声明级归因、五维评分卡、真实交互验证、有界修复闭环（在通用示例上 1 轮收敛）。
- **v0.2 设计侧**：`pf dna` 抽规则（每条带出处/范围/可信度，确认一律是 `candidate`）、`pf kb` 版本化入库与冲突检查、`pf design` 从知识库生成未见页、`pf review` 八维独立评审（设计者不能自签）。四步都有独立套件，但**没有**在 OurTrail 真实业务页上跑过生成与重构。
- **BLOCKED 的**：OurTrail 实现层修复（目标页在冻结模块，等授权）；小程序侧的成组 A/B 实验（需要可注入的沙盒页）。
- **已知漏报**：20px 以上字重变化的像素级检出（墨量比 1.087），只能靠 `font-weight` 声明比较兜底。
- **不编造**：不给成功率、不给总分；"没测到"记 `UNVERIFIED`，环境不可用记退出码 `2`。

## 退出码

`0` 通过 · `1` 有真实失败 · `2` 环境/配置错误或存在 `UNVERIFIED`。
`2` 不是"差不多通过"——它表示有一块没测到。
