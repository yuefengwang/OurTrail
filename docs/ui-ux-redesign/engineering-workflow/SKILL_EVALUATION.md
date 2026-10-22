# SKILL_EVALUATION — Skills 能力评估与采用决策（night-v2，2026-10-22）

任务书：`OurTrail UI 重设计：S.txt` 阶段 A0。方法：本地 Skills 以本会话实际可调用清单 + 定义文件抽检为准；外部仓库经只读子 Agent 走 `api.github.com`（本机 github.com 网页被拦）取元数据与 README 原文核实。**"存在文档" ≠ "能力已验证"**，每条均标验证状态。

## 1. 本地已有 Skills（本会话实测可调用）

| Skill | 来源 | 在本工程链路中的角色 | 验证状态 |
|---|---|---|---|
| `ourtrail-ui`（项目内） | `.agents/skills/ourtrail-ui/` | 设计宪法：14 条核心规则、四模式 M1–M4、证据档 E1–E4、真机三道门槛、多 Agent 契约。**B/C/D 全阶段承重** | 已通过实际验证（本会话已加载全文；其门禁 `tools/check.js` 平台门历年逐轮实跑） |
| `superpowers:*`（verification-before-completion / systematic-debugging / dispatching-parallel-agents 等） | 插件 | 流程纪律：先证据后结论、并行分派契约 | 已通过实际验证（历轮与本轮按此执行） |
| `design-review:design-qa` / `visual-regression-review` / `ui-alignment-review` | 插件 | **方法论移植**：baseline↔after 差异清单模板、"实现 vs 设计源"九维核查表。其运行时依赖（axe/Playwright/Figma/DESIGN.md 工具链）在微信小程序无宿主 | 部分支持，需要补强（清单可用、运行时不适用；未在本栈验证） |
| `design-review:design-system-capture` / `design-md-review` / `design-debt-review` / `component-library-alignment` | 插件 | 设计系统提取与债审查思路；本项目真身是 `app.wxss` + `ourtrail-ui/references/design-system.md`，不引入第二套 DESIGN.md | 暂不采用（与项目单源冲突） |
| `design-review:accessibility-review` | 插件 | 对比度/触控/状态清单可人工套用；axe 报告不可得 | 部分支持（人工子集） |
| `frontend-design` / `refactoring-ui` / `ui-ux-pro-max:*` | 插件 | 通用审美与排版规则，只作 R 级建议输入，不作门禁 | 有实现依据但尚未验证（本轮不作为判据） |
| `product-design:*`（flow-web/flow-mobile/edge/chart…） | 插件 | 面向 Web/React/Figma 的设计生产套件；与原生 WXML 实施链路不匹配 | 不支持当前技术栈（本轮不采用） |
| `chrome-devtools-mcp` / `playwright` / `browser-use` MCP | MCP | 浏览器自动化。**不能渲染 WXML**，不得以其截图冒充小程序截图（任务书 6.5 明令） | 不支持（对小程序）；仅对未来 Web 产物有用 |
| `context7` | MCP | 库文档查询；本项目零 npm 依赖 | 不适用 |
| 其余（dingtalk-* / yida / Presentations / tokengo / sites / qmind 等） | 插件/MCP | 与本轮无关 | 不评估 |

## 2. 外部候选仓库（只读子 Agent 实测，2026-10-22）

| 仓库 | 元数据 | 形态 | 小程序兼容 | 决策 |
|---|---|---|---|---|
| `Xialiang98/design-visual-frontend`（点名） | 19 stars · MIT · push 2026-07-12 · 未归档 | 纯散文 prompt 规则，零脚本（`SKILL.md`、`references/review-gates.md`、`references/surface-archetypes.md`） | 需改造：决策流程平台无关可套用；验证环节依赖浏览器截图矩阵，须替换为开发者工具 CLI + automator | **局部补强**：摘 review-gates 与反 AI 模板清单进本轮 Visual QA 清单；不整仓引入 |
| `hueyexe/frontend-agent-skills`（点名） | 23 stars · MIT · push 2026-08-02 | 9 个纯 markdown 技能，无脚本；安装方式 `npx skills add` | 需改造：Web 语义（semantic markup/CSS strategy），无 WXML/rpx 概念 | **暂不采用**：与 `ourtrail-ui` + `design-review:*` 高度重叠且更泛化 |
| `VincentJiang06/dsh-mp-automator`（自选） | 2 stars · MIT · push 2026-08-16 · JS | **含可执行工具**（`lib/cli.js`、`lib/gates.js`、`skill/mp-testing/SKILL.md`），主打构建新鲜度门 + 几何断言 + 真截图 | 技术栈对口但为 DeepSeek Harness 插件（peerDeps 全 `@deepseek-ai/*`），非本平台技能格式 | **局部补强（只借思路）**：新鲜度门与几何断言本项目已由铁律 32⑥ 与 `meteogram-readability-test` 覆盖 ⇒ 不安装 |
| `rongmiao926-hub/image-to-figma-design-skill`（自选） | 0 stars · **license: null** · push 2026-06-09 | 4 文件纯 prompt，产 Figma 规格 | 不适用（本项无 Figma 链路；参考图→规格由多模态直读） | **暂不采用**（无许可证，法律上不可复制） |

## 3. 能力缺口与补齐方式

| 缺口 | 补齐 | 状态 |
|---|---|---|
| 像素级自动比对 | 仓库内**没有任何像素比对工具**（ourtrail-ui §4 实测结论）；本轮沿用"人眼 + 独立 QA Agent 读图" | 人工，已登记 |
| 参考图→页面规格 | 多模态直读总览图 + `ourtrail-ui` M1 步骤 + T 系列任务书模板（night-v1 已验证可执行） | 已通过实际验证（night-v1 T001–T010） |
| 真实运行/截图 | 微信开发者工具 CLI（33278）+ automator（9425 本轮新绑）+ `mp-auto` 驱动 | 本轮实测中（基线截图脚本 `shot-night-v2-baseline.js`） |
| a11y 自动化 | 无 axe 宿主；对比度按 `app.wxss` 注释预算值人工核 | 人工 |
| Figma/设计稿链路 | 不存在；总览图即唯一视觉源 | 记录 |

## 4. 采用清单如何进入链路（阶段/输入/输出/调用者/验证/失败处理）

| Skill/能力 | 阶段 | 输入 | 输出 | 调用者 | 验证 | 失败处理 |
|---|---|---|---|---|---|---|
| `ourtrail-ui` | B/C/D | 总览图 + 源码 | 规格、判据、证据档 | 主控 | 静态门 exit 0 + 真机门槛 | 偏离 S/R 类须在改动清单给理由 |
| 自研驱动脚本（mp-auto） | C | 页面路由 + 真实云数据 | before/after PNG + data 读数 | 主控 Bash | 截图落盘 + 读数非空 + 门槛链断言 | 通道僵死记 ENV-ABORT，不伪造 |
| design-review 差异清单方法论 | D | before/after 截图 + PAGE_SPEC | VISUAL_QA_REPORT 差异表 | 独立 QA 子 Agent | 每条差异可指回截图区域 | 读图不可得则标 UNVERIFIED |
| design-visual-frontend review-gates 摘录 | D | 同上 | QA 清单增补项 | 独立 QA 子 Agent | 同上 | 同上 |
| superpowers 流程纪律 | 全程 | — | — | 主控 | 证据先于结论 | — |

**结论**：不安装任何外部 Skill；`ourtrail-ui` + 开发者工具 CLI + automator 已覆盖核心闭环；外部仓库仅两处清单级补强。
