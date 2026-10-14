# OurTrail UI Skill 升级验证报告

轮次：2026-10-14 技能升级第一轮 · 分支 `win/ui-skill-methodology`（worktree `D:/OurTrail-skill-uplift`）
方法学：按 TDD 走 skill——RED（旧版主文件跑 6 场景基线）→ GREEN（新版跑同 6 + 1 压力场景）→ REFACTOR（处置回抛缺口后复验）。当前状态词：**通过（含 4 项未执行登记）**。

## 1. 检查矩阵（对应任务书 §8）

| 检查项 | 方法 | 结果 | 状态词 |
|---|---|---|---|
| Markdown 链接与相对路径 | 脚本解析 `]()`，按文件目录解析存在性 | skill 目录 6 文件：**8 条相对链接，断链 0**（首跑因我把链接降级成纯文本而空跑出 0 条，见 §3） | 通过 |
| 正文提到的仓库路径 | 同一脚本抽反引号路径（前缀集共十种：miniprogram、cloudfunctions、tools、docs、components、pages、utils、references、app.wxss、app.json） | 仅 skill 目录：**91 处命中 / 34 个不同目标 / 未解析 0**；skill+两份报告合计（前缀集去掉 app.wxss、app.json 的窄口径）：62 处 / 37 目标 / 未解析 0 | 通过 |
| 主文件能否告诉 agent 下一步读什么 | GREEN 复测 7 场景，要求答到"哪份参考的哪一节" | 7/7 能定模式；节级命中见 §5 残余 | 通过（粒度已补） |
| 每条硬性规则有依据/范围/验证方式 | 逐条对照 `skill-audit-report.md` §3 的 31 行 | 14 条核心规则全部带 类别+现状+有无门+判据 | 通过 |
| 重复规则与相互矛盾 | 关键短语跨 6 文件计数 + 人工读回 | 无同层重复定义；4 处刻意交叉引用（见 §4） | 通过 |
| 与现有项目架构冲突 | 邻居文档比对（`miniprogram/AGENTS.md`、根 `AGENTS.md`、`docs/e2e-mp/*`） | 零冲突；重复内容改为指针（新页面 5 步、门清单、退出码语义） | 通过 |
| 重要规则抽样核对源码 | 63 条断言脚本（52 行内容 + 11 路径存在） | 51 通过 / **1 失败（已修）** / 11 存在性全在 | 通过（缺陷已闭） |
| 触发描述覆盖设计·修改·审计·验证 | 读回 frontmatter description | 四类任务 + 口语触发（"看下这页""太乱""顺手改一下""帮我审一下"）均覆盖 | 通过 |
| 未修改业务代码与他人工作 | 双工作区 `git status` + 派前后各查 | 见 §6 | 通过 |
| 静态门未被误伤 | `node tools/check.js`、`node tools/check-handlers.js`（本 worktree） | 均 `ALL CHECKS PASSED` / exit 0 | 通过 |

## 2. 抽样复验（承重引用回源码）

脚本对每条 `file:line` 断言取该行文本比对期望子串，任一条不符即红：

```
DIFF docs/prototypes/ourtrail-app/src/components/StatusPanel.tsx:4
  期望含[kind] 实得[export interface StatusPanelProps {]
--- 抽样断言: 总63 通过51 失败1 ---
```

- **根因**：`ui-methodology.md` 把原型 props 契约写成 `StatusPanel.tsx:4-7`，实际界面块在 `:4`，字段在 **`:5 kind / :6 title / :7 detail（必填）/ :8 action?`**。
- **处置**：改为 `:5-8` 并把四个字段逐行写明；复验 `grep -n StatusPanel.tsx` → `ui-methodology.md:64` 已是修正后文本。**通过**。
- 其余 51 条全部命中，包括我此前只依据子 agent 报告写入的：`app.wxss:68/72/482/2/54/55/56/46/95/406`、`home.wxss:2`、`weather-hub.wxss:6`、`weather.wxss:136/142/180/195/197/222`、`overlay.js:6`（`multipleSlots: false`）、`overlay.wxss:14`、`form-field.js:6`（`multipleSlots: true`）、`roam-scrubber.wxml:34`、`meteogram/layout.js:51/106`、`meteogram.js:34`、`meteogram.wxss:22`、`sky.js:446`、`signup.js:378`、`route.wxml:95/189`、`route-edit.wxml:30/159`、`editor.wxml:171/456`、`activity.wxml:231/232`、`lab.wxml:76`、`me.wxml:9`、`roster-panel.wxml:114`、`weather-ux-design.md:23/58`、`miniprogram/AGENTS.md:103`。
- 另核 `bundleFresh` 探针在 `SYNC.md` 出现两处：**:560**（首次，「每组都带 bundle 新鲜度探针 `bundleFresh`」）与 **:578**（`bundleFresh=true`，探针换新字段 `elevShown`）。我在 SKILL §4 与 checklist T5 引的 `SYNC.md:560` 成立，无需修改。

## 3. 我自己造成并当场抓到的两个缺陷

1. **断链门空跑**：第一次链接检查报"markdown 相对链接 **0** 条 / 断链 0"。不是通过，是**门在空跑**——我把旧版指向三份 reference 的 markdown 链接改成了纯文本路径（丢掉了链接语法），检查对象被我自己抹掉了。处置：§5 路由表与交叉引用全部改回真链接，复跑 8 条 / 断链 0。**教训与本项目铁律一致：0 命中的门必须先证这把尺能产生差异。**
2. **GREEN 首跑 INVALID**：我在提示词里把路径写成主工作区 `D:\OurTrail\...`（旧版 40 行），被测 agent 老实读出旧文并报"没有 M1–M4"。该结论对新版无效 ⇒ 判 **INVALID**，加"前置门"（要求先确认读到 M1/E1/INCONCLUSIVE 三组词，否则停止作答）后重跑。旧版那份回答未被丢弃，它复现了 RED 结论，作为基线证据保留在 `skill-audit-report.md` §5。

## 4. 重复与矛盾扫描

刻意保留的交叉引用（同一条规则在不同层出现，但**只有一处定义**，其余是指针）：

| 主题 | 定义处 | 指针处 |
|---|---|---|
| apply-shared 的适用条件 | SKILL #1 / pitfalls §1 | checklist T1、§5 降级条款 |
| 底部留白归属 | pitfalls §5（含事故原文）| SKILL #4、design-system §间距 |
| 色值债与四道排除 | design-system §现状色值债登记 | SKILL #3、audit §3 第 1 条、checklist T2 |
| 真机三道门槛 | SKILL §4 | checklist T5、audit §5 模板 |

矛盾检查重点：`--touch-target` 在 SKILL 是 R 档、在 checklist T2 是"新可点主目标必须引用 token"——两处同义（后者是前者的执行形式），不冲突；`status-panel` 的"一律"与"豁免 + 等价合规"同条出现，无跨文件分歧。

## 5. GREEN 复测结果与残余缺口处置

前置门：被测 agent 读到 109 行升级稿，三组词齐全 ⇒ 有效。7 场景四栏作答齐（模式 + 参考节 + 交付物 + 证据档 + 状态词）。回抛 4 条真缺口，全部已在定稿处置：

| 缺口 | 处置 | 落点 |
|---|---|---|
| 别人递来的截图无法自证 bundle/来源，无降级规则 | 新增「被动收图」段：可用于排版事实与 token 核对，上限 **E2**，整批标 `UNVERIFIED(截图来源与 bundle 未证)`，并点名缺哪一项才能升 E3 | SKILL §4 + Red flags |
| "负责人禁测"与"环境跑不动"未分叉 | 新增「跑不动 ≠ 不用跑」：`NOT_RUN/INCONCLUSIVE/ENV-ABORT` 只用于环境性不可达；禁测要写成交付缺口 + 结论上限 | SKILL §4 + Red flags |
| 四档证据与 checklist 的档数关系未交代 | 明确「四档是证据强度，T1–T8 是检查工序，不是同一维度」；顺带修正我原先写的"6 个证据层"（实际是 T1–T8，属我自己的数目错） | SKILL §4 / §5 |
| references 不可达时 E1 无一行式定义 | 降级条款内嵌定义：「E1＝源码文本可直接核实的事实」 | SKILL §5 |
| 路由只到文件级（附带） | §5 路由表全部加节号（ui-methodology §0–§10、audit-verification §0–§8、pitfalls §1–§17、checklist T1–T8） | SKILL §5 |

未被回抛但自查补上的：`#5` 缺"用别的方式呈现四态是否算违规"的裁决句 ⇒ 已加"等价合规"。

## 6. 交付边界确认（禁改项）

| 检查 | 结果 |
|---|---|
| 用户工作区 `D:/OurTrail` `git status --porcelain` | **空**（开工前、派 5 路子 agent 后、定稿后各查一次） |
| 用户工作区分支 | 仍 `master`，未切换、未 stash、未 reset/clean |
| 本分支改动清单 | 4 改 2 新，全部在 `.agents/skills/ourtrail-ui/` + 3 份报告在 `docs/skill-uplift/`；`git status` 无其他条目 |
| 业务代码 `miniprogram/**`、`cloudfunctions/**`、`tools/**` | **零改动**（`git status` 不含这些路径） |
| commit / push / 部署 | 未执行（按任务书） |

## 7. 未执行与无法执行（如实）

1. **真机/截图/自动化**：一次都没跑 ⇒ 所有 M4 类结论在本轮为 NOT_RUN。旧 skill 的多数规则不依赖真机即可核（源码层），但 #8 的命中区、T7 全档属运行时。
2. **像素比对工具**：不存在（全 `tools/` 无 `pixelmatch/ssim/pngjs/jimp/sharp`），故"视觉回归"在本仓库只能靠人眼 + 记录。
3. **外部平台文档对 `color-mix()` 在 WebView 渲染下的正面确认**：未取到权威结论（检索只命中 Skyline 差异文档），故 #11 维持 UNVERIFIED / 保守约定。
4. **writing-skills 要求的完整压力测试**（多压型 + 合理化话术表 + 反复 refactor 到防弹）：只跑了 1 轮 7 场景，**未做** rationalization 表与红旗下限的迭代验证。SKILL §7 已有 11 条红旗，但不等于已"防弹"。
5. **未写入 `SYNC.md`**：任务书限定"仅改 skill 文档及参考资料"，而同步登记是根 `AGENTS.md` 的既有要求 ⇒ 二者冲突时我按任务书范围执行，**登记动作留给负责人决定**（一行条目即可，随时可补）。

## 8. 剩余风险

| 风险 | 影响 | 建议 |
|---|---|---|
| 新增 2 份 reference 未被 `miniprogram/AGENTS.md`/根 `AGENTS.md` 索引 | 其他 agent 可能仍按"三份 reference"行动 | **已处置**（2026-10-14 负责人选 A）：根 `AGENTS.md:28` 改为「its 5 references」并写入四模式与门能力摘要，同时订正 `:20`/`:98`/`:128` 三处过期计数；`miniprogram/AGENTS.md` 的 STRUCTURE/PAGES/COMPONENTS 计数按实测更新 |
| 旧 SKILL 的绝对表述被下游引用（例如别处写"所有组件必须 apply-shared"） | 规则收窄后与引用文本不一致，agent 会按旧口径报违规 | **已核完，无冲突**：`miniprogram/AGENTS.md:99` 本就写成"Any component **relying on those classes** must declare"（条件式，与收窄后同义）；`AGENTS.md:411`（options 只写一次）与 `:424`（能力陈述）不涉范围；`docs/product/天气模块升级-P4-时空天相与漫游设计.md:182`、`docs/product/天气模块升级-P3-独立天气模块设计.md:332`、`docs/weather-ux/weather-ux-design.md:186` 是对**新组件**的具体规格，落在收窄后规则的适用条件内。SYNC.md 的历史条目属变更记录，不回改 |
| 31 条裁决中 5 条 DEBT 未修 | 审计 agent 若把既存债当新缺陷报会噪音 | 已在 §3 标注"既存不属本轮修"，并给了四道排除 |
| `#11` 保守约定被误读成"实测过不可用" | agent 可能据此拒绝合理的现代 CSS | pitfalls §3/§8 已写明证据层级与"要先用先验" |
| skill 变长（286→715 行）带来的加载成本 | 主文件 114 行仍是入口，细节按节号取 | 若实测偏重，可把 §3 表格拆成 reference（**当前不做**，无证据说明它已成负担） |
| 本地 master 领先 GitHub 2 个提交 | 分支基点与远端不同，合并窗口需注意 | 见审计报告 §1 |
