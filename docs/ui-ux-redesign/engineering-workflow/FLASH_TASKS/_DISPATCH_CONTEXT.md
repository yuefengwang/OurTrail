# 派发追加上下文 — 给 DeepSeek Flash 执行器（2026-10-23）

用途：把本文件整段附在你已有的《OurTrail 后续任务执行器》Prompt 之后。任务规格仍以 `FLASH_TASKS/<ID>.md` 为准；本文件只补充**运行现场、状态、基线、已知事实与派发约束**。两者冲突时取更严格者并停止上报。

## A. 运行现场（必须以此为准，不能凭目录名猜）

| 项 | 值 |
|---|---|
| 用户主工作区（**禁止进入/修改/提交**） | `D:/OurTrail`，当前分支 `agent/ourtrail-night-ui-v2`，HEAD `220a91c`（**不是 master**）；有 4 个未跟踪遗留材料 |
| 规划与执行工作树（**在这里工作**） | `D:/OurTrail-ui-followup-20261023`，分支 `win/ui-followup-plan-20261023`，HEAD `220a91c`，相对本地 master `c1a5aeb` 领先 3 个提交；**0 提交、无 upstream** |
| 规划文档绝对前缀 | `D:/OurTrail-ui-followup-20261023/docs/ui-ux-redesign/engineering-workflow/` |
| 证据绝对前缀 | `D:/OurTrail-ui-followup-20261023/docs/ui-ux-redesign/evidence/morning-review-2026-10-23/` |
| 提交链 | `c1a5aeb`(master) → `a81e3b7` → `5395f02` → `220a91c`(night HEAD)。**未合并、未推送**；远端状态本轮未查询，不得替它下结论 |
| 环境 | Windows 10 · Git Bash · Node **v24.19.0** · 仓库零 npm 依赖；测试一律 `node tools/x.js`，自打印 `passed=N failed=N` |
| DevTools | **不在 Flash 职责内**：禁止启动/关闭/登录/切换账号；视觉验证由编排者在 D-01 授权后执行 |

规划文档当前是**未跟踪文件**。不要为了让 `git status` 干净而提交它们；是否先做一次 planning 基线提交由编排者决定（P0，不属于任何任务卡）。

## B. 派发时的任务状态（以此为准，不得自行改写）

| 任务 | 真实状态 | Flash 可做什么 |
|---|---|---|
| FU-01 | **READY**，无人工前置 | 按卡执行，单提交 |
| FD-01 | **READY**；视觉项依赖 D-01 | 只做代码+门禁；视觉回报 `UNVERIFIED` |
| FH-01 | 卡面 READY，但 **D-08 未批准** ⇒ 实际 **BLOCKED** | 只读检查；**不得改 `app.wxss`**，不得标记执行中 |
| FU-02 / FU-14 | **BLOCKED**（D-01） | 不接单；不是 Flash 任务 |
| 其余 FU/FD/FH/EDI/TOOL | OPEN / BLOCKED / BACKLOG / DEFER | 一律不派发，只记录 |

## C. 写者与串行约束

- **FD-01 与 FH-01 都会改 `miniprogram/pages/discover/discover.wxss`** ⇒ 必须串行，推荐顺序：FU-01（文档）→ FD-01 →（D-08 批准后）FH-01。
- 同一时刻只允许一个执行者在工作树里写文件；不要在并行会话里同时 commit（索引会互相踩）。
- 白名单之外零改动。尤其禁止：`tools/**`、`cloudfunctions/**`、`miniprogram/utils/**`、`components/**`、`app.json`、`pages/weather*`、`pages/privacy`、`custom-tab-bar/**`、`project*.config.json`。
- 不要使用 `D:/OurTrail-night-ui-v1`（已删除）；`docs/ui-ux-redesign/agent-plan/flash-dispatch-kit.md` 已标 DEPRECATED，不得按它执行。

## D. 门禁基线（2026-10-23 09:40 +08 实测，Node v24.19.0；只用于区分“新红”与“存量”）

- 本轮实测：check 0；check-handlers 0；scenario-notices 91/0；scenario-me 143/0；swx1 45/0；swx2 110/0；t4-e08 41/0；b4-pad 32/0；b4-e05 49/0；ui-consistency 17/0；page2 98/0（**单次**）。
- **m02 = 65/1**，唯一失败是 `PV5 四个章节标题…`（privacy 存量）。除 PV5 外任何 m02 红都是新红。
- 本轮**未实跑**、只能作历史参考：home-collab-list 25/0、scenario-discover 36/0、discover-filter 21/0、journey-graph 15/0；trip2 66/10 与 e2e-ui 系是已登记存量/环境门。
- page2 是已知时序竞态（`tools/page2-gates-test.js:584,649,798-807`；setImmediate 回调 vs 固定 30ms 等待）。单次 98/0 **不关闭** OPEN；**不得改 tools**；若出现与历史不同的失败签名，停止并上报。
- 跑法：在 `D:/OurTrail-ui-followup-20261023` 下逐条执行；记录命令、退出码、passed/failed 原文。不要用管道末端退出码冒充测试退出码。

## E. 已被复核纠正的事实（不要照抄旧报告，也不要重新推导）

1. `.stack-gap3` **在 master 已存在**（`master:miniprogram/pages/me/me.wxml:189`；`notices/anotices.wxml:42`）⇒ 历史“新鲜度全过”不成立；最终代码版本门必须用**最终代码独有且可观测**的差异。
2. 25 张历史 PNG 实测均为 **306×660**；“330px”是错的。
3. `states/me-onboarding.png` 时钟 22:42，早于提交 `5395f02`（22:50:01）；旧缺陷帧被同名覆盖 ⇒ 该帧只能证明“报告称当时工作树内容”，不能证明“提交后重编译”。
4. 注入态（`setData`）只证明渲染路径，不证明命令执行/真实交互；不得混入 UI PASS。
5. page2 的临时 `p2*.txt`（17 份：12 份 96/2、5 份 98/0）没有命令/commit/分组映射，不能当 clean/noop 原始证据。
6. `--touch-target` 实测在 `app.wxss:67`（旧文档 54-55 已漂移）；`--ink` 在 `:12`；`.section-head` 在 `:139-140`。引用行号前先 `grep -n`。
7. 通知：`Notice` 无 `kind`（`schema.js:308-311`）；普通投影裁掉事件关联；`notices-page.js:64` 只 `reverse()`，未按未读/时间显式排序。
8. 撤回：`field.js:43-46` 只置 `revokedAt`、不删坐标；无“恢复旧授权”命令；满足 active/已随队/未过期/重新同意时可重新上报（`:153-159`）。
9. editor：封面与装备**已有**数据与编辑能力（`content-editor.js`、`editor.wxml:608-637`）；缺的是布局/交互；Day 计划无人工模型；活动无 `visibility`。
10. UI Lab（`D:/OurTrail-UI-Lab`、`D:/OurTrail-UI-Lab-Qwen`）是另一仓库/实验目录，只能作设计背景，**不能**当生产事实或“已迁移”证据。

## F. 每任务交付与提交

- 每卡一个本地提交，提交信息含任务 ID；提交前 `git diff --stat` 只含白名单；**不 push/merge/rebase/reset/clean**。
- 执行者的最终回复就是任务报告（≤40 行），必含：分支+HEAD、文件清单、真实 diff 摘要、命令+退出码+passed/failed 原文、截图/证据路径（无则 `NOT_RUN`）、逐项 `PASS/FAIL/UNVERIFIED/BLOCKED`、新发现（只记录不修）、是否满足完成条件、是否建议进入下一任务。
- **不要自己写报告文件**（会越过任务卡白名单）；归档由编排者写入 `FLASH_TASKS/<ID>-REPORT.md`。
- 规划文档（MORNING/LEDGER/PLAN/DECISION_LOG/任务卡）不得混进代码任务的提交。

## G. 停止规则（与任务卡叠加，取更严格）

出现任一即停并上报，不得自行解除：任务非 READY；缺 D-01/D-08 授权；任务卡与真实代码语义不一致（行号漂移不算）；需要改白名单外文件；门禁新红（m02 PV5 除外）；证据不足；需要产品决策；需要碰冻结目录。

## H. 对原执行器 Prompt 的三处术语校正

1. §3“默认在独立分支或 worktree 中实施” → 已存在 `D:/OurTrail-ui-followup-20261023`；**不要再新建**，除非编排者明确要求并行。
2. §6 “如果只调整了 CSS，但没有验证事件派发，不能标记 PASS” → Flash 无法运行 DevTools；正确口径是：代码+门禁通过、触控/事件项记 `UNVERIFIED` 并交编排者，整体不得称 PASS。
3. §8 的 FU-02 → 当前 **BLOCKED**，不是本轮 Flash 任务；只有拿到 D-01 后由编排者/强模型执行。
