# AGENT_WORKFLOW_PROPOSAL — 角色分工、产物约定与质量门禁（night-v2，2026-10-22）

本平台支持多 Agent（Agent 工具），但不保证模型档位可控（night-v1 已实测：角色文件 model 字段只认档位）。故本轮采用**单主控 + 只读子 Agent** 形态落实任务书五角色，不伪造并行协作。

## 1. 角色映射

| 任务书角色 | 本轮承担者 | 输入 | 输出 | 完成条件 |
|---|---|---|---|---|
| A Design Lead | 主控（已加载 `ourtrail-ui` 全文） | 总览图三张 + 交付包拼板 + app.wxss 实测 | DESIGN_SYSTEM.md 草案、PAGE_SPEC.md、设计争议登记 | 规格可执行：每条能指回 token/类名/截图区域 |
| B Product & Code Analyst | 主控 + Explore 只读子 Agent | 源码、night-v1 台账、覆盖矩阵 | UI_AUDIT_REPORT / PAGE_REFERENCE_MAP / VISUAL_GAP_ANALYSIS | 每条事实带 file:line 或命令输出 |
| C Implementation | 主控（**同一文件唯一写者**） | 已批规格 + 冻结清单 | 代码 diff + 自测读数 | 静态门 exit 0 + 指定套件全绿 + 绑定计数钉点不漂 |
| D Visual QA | **独立只读子 Agent**（不看实现 diff，只读截图+规格+总览图） | before/after PNG、PAGE_SPEC、总览图 | VISUAL_QA_REPORT 差异清单（问题/实际/目标/影响/修正/复验） | 每条差异指回截图区域；不许只凭实现者自述 |
| E Integration Owner | 主控 | git/测试/截图/报告 | 门禁判定、归档、放行建议、遗留清单 | Gate A–E 逐条引证据 |

## 2. 质量门禁（任何一门不得仅凭文字声明）

| Gate | 通过条件（证据形态） |
|---|---|
| A 审计 | 仓库状态命令输出 + 页面清单（app.json 实测）+ 能力矩阵行号引用 + 风险登记 |
| B 设计 | DESIGN_SYSTEM.md 每条 token 指回 `app.wxss:行`；PAGE_SPEC 含六态与保留清单；截图方案含门槛链断言 |
| C 实施 | `git diff --stat` 仅允许文件；check.js/check-handlers exit 0；指定套件 passed/failed 实测值 |
| D 视觉 | before/after 截图落盘 + 独立 QA 差异清单 + 修正复验截图；未验证项标 UNVERIFIED |
| E 交付 | 测试命令与退出码、截图目录、遗留问题、下一步；SYNC.md 登记 |

## 3. 本轮冻结清单（C 角色不得越界）

（night-v2 轮次范围；后续批次边界以 [FLASH_EXECUTION_PLAN.md](FLASH_EXECUTION_PLAN.md) §6 为准）

- `cloudfunctions/**`（零改动 ⇒ 不需重部署）
- `tools/**` 既有套件（存量红只归因不擅修；新证据脚本只落 `docs/` 或临时目录）
- `miniprogram/utils/**`（T011 仅允许页面 js 内纯展示派生字段）
- 天气线：`pages/weather*`、`components/meteogram`、`utils/{sky,agenda,conditions,cloud-* ,outdoor-*,meteogram-*}`（T005/T012 永久冻结）
- `pages/privacy/**`（在途未提交，night-v1 冻结延续）
- `custom-tab-bar/**`、`app.wxss`（本轮不需要新 token；若需则登记待裁决，不自行加）
- `utils/format.js`（状态词单源）

## 4. 分支与提交策略

- 基线 `master c1a5aeb`；工作分支 `agent/ourtrail-night-ui-v2`（沿用 night-v1 命名族）。
- 每完成一个可回滚单元提交一次（单提交可 revert）；**不 push**（PARALLEL_DEV：master 合并窗口外不推；分支推送亦待用户点名）。
- 主工作区 4 个未跟踪遗留文件（`OurTrailNightBu.txt`、`OurTrail_UI_*.zip`、`OurTrail_UI_交付包/`、`OurTrail全局UI重设计.txt`）不删不改不提交。
- 结束记录：分支、提交列表、工作区状态、未跟踪清单。

## 5. 失败与阻塞语义

沿用 `docs/testing/e2e-result-semantics.md`：PASS / FAIL / INCONCLUSIVE（exit 2）/ ENV-ABORT / NOT_RUN / UNVERIFIED。
- 通道僵死（auto 挂起、端口不 LISTENING）⇒ ENV-ABORT 并记录恢复尝试；**不 quit 共享 IDE**（本会话自起会话除外，close+open 仅用于自起会话的重编译）。
- 截图缺失 ⇒ 该结论上限 E2/UNVERIFIED，不得写"视觉验证通过"。
- 子 Agent 未返回 ⇒ 对应栏写 PENDING + ls 取证，不编造。

## 6. 与 night-v1 台账的衔接

- 试点 = **T011**（notices/anotices/me）：night-v1 `night-run-state.json` 唯一 `ready` 任务；T005/T012 冻结延续。
- night-v1 openDebts 六条原样继承登记（见 UI_AUDIT_REPORT §5），本轮不擅自清偿。
