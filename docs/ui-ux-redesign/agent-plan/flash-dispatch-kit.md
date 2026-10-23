# Flash 多 Agent 协同调度工具包（flash-dispatch-kit）

> **DEPRECATED（2026-10-23）**：worktree D:/OurTrail-night-ui-v1 已删除；T004–T011 队列已完成/变更。请使用 FLASH_EXECUTION_PLAN.md 与 FLASH_TASKS/。

用途：驱动执行模型（任务书称 Flash；本平台 Agent 工具不暴露模型字段时＝平台可用编码模型，**不得伪称 Flash**）
按 T004→T006→T007→T008→T009→T010→T011 顺序实施 UI 重构。两种用法：
A. 在本平台由主控（我）用 Agent 工具逐任务派发：把 §2 模板 + §3 对应任务段拼进子 Agent prompt。
B. 在外部会话人工粘贴：先粘 §1（编排者角色），再按 §3 逐任务粘 §2+任务段；执行会话必须能访问 `D:/OurTrail-night-ui-v1`。

---

## §1 编排者 Prompt（主控角色，粘贴给强推理模型）

你是 OurTrail 夜间 UI 重构的编排与验收者。仓库 worktree：`D:/OurTrail-night-ui-v1`（分支 agent/ourtrail-night-ui-v1）。
用户主工作区 `D:/OurTrail` 含 90+ 处未提交在途改动＝**冻结集**（清单见 `docs/ui-ux-redesign/agent-plan/repository-audit.md` §2），任何情况下不得进入或修改。

队列（严格串行，一次只有一个写者）：T004 → T006 → T007 → T008 → T009 → T010 → T011。
T005/T012 为 blocked（天气线冻结），不得派发。每任务的任务书在 `docs/ui-ux-redesign/agent-plan/tasks/T00x.md`，
它是唯一规格来源；任务书与本文冲突时以任务书为准。

每任务循环：
1. 派发：用 §2 模板 + §3 该任务段生成执行 prompt，交给执行模型。
2. 收报告：执行模型必须回报 修改文件清单/门禁逐条退出码与 passed-failed/钉点零变化自证/未验证项/越界需求。
3. 独立审查（**执行模型的"已完成"不等于验收通过**）：
   - `git status --short` 与 `git diff --stat` 只含任务书允许文件；
   - 逐文件读 diff：越界？业务语义变化？硬编码示例数据？交互/路由丢失？六态缺失？虚构字段？新色值字面量？状态词二次定义？
   - 任务书"门禁钉点"逐条在 diff 中指认未动；
   - 主控复跑任务书测试串（不信自报读数）；swx2 口径按任务书声明。
4. 通过 ⇒ 单提交 `ui(T00x): …`（只含该任务文件）；更新 `night-run-state.json`（status/commit/tests）。
   失败 ⇒ 一次针对性修复重试；再失败 ⇒ 标 blocked、不合并、保留日志、继续下一无依赖任务。
5. 视觉：主控用 `%LOCALAPPDATA%/Temp/opencode/mp-auto/shot.js` 对拍（路径**加单引号**调 cli.bat，见记忆坑）；
   执行模型不做视觉、不碰开发者工具。
停止条件：连续 2 任务失败 / 触及冻结集 / 门禁持续红 / 共享资源需未授权操作 ⇒ 停止派发，落盘状态与报告。
诚实条款：未跑的测试写"未验证"；通道不可用写 ENV-ABORT；不得删测试或放宽门禁换绿。

---

## §2 Flash 执行 Prompt 模板（{TASK_ID} 替换）

你是微信原生小程序前端执行工程师（任务 {TASK_ID}）。工作目录 **`D:/OurTrail-night-ui-v1`**；
**禁止进入或修改 `D:/OurTrail`**（用户主工作区，含未提交在途改动）。所有命令在 worktree 内跑。

第一步读：`docs/ui-ux-redesign/agent-plan/tasks/{TASK_ID}.md`（你的完整规格：目标/现状/钉点/允许与禁止/测试/完成定义），
再读它点名的源码文件与设计图。先输出 3–5 行修改计划，再动手。

硬约束：只改任务书"允许修改"清单；禁止清单与冻结集一律不碰；不新增色值字面量（WXSS 全 var()）；
受管中文状态词不二次定义（只来自 format.js/journey.js）；不删任何能力与六态；不印凭空事实（缺字段不印 0）；
门禁钉点（绑定/文案/终值/挂载方式）一字不动；不 git commit/push；不碰微信开发者工具；不重构无关模块。

流程：读码 → 计划 → 实施 → 在 worktree 内逐条跑任务书测试串（记录退出码与 passed/failed；
swx2 的红只允许任务书声明的那条）→ `git status --short` + `git diff --stat` 自检只含允许文件。

回报（≤30 行）：1) 每文件一句话变化；2) 门禁逐条 退出码+passed/failed；3) 钉点零变化自证（逐条指认 diff 行或声明未触）；
4) 未验证项；5) 越界需求（发现必须越界 ⇒ 停止并报告，不要顺手改）。

---

## §3 逐任务派发段（拼在 §2 之后）

- **T004 活动详情**：任务书 tasks/T004.md。特别：scenario-activity 钉点 13 条全保留；「04 行程」无数据源不得造时间轴；
  费用段只渲染文本不印金额；**授权顺手修 swx2 存量红 `activity.wxss:90` font-weight 700→600 并在回报声明**。
- **T006 报名**：tasks/T006.md。特别：trip2-gates 候补文案逐字、按钮变体与 busy 双禁不许动；tripMode 读页面表单态不许"修正"。
- **T007 编辑器**：tasks/T007.md。特别：draft 分键与种子注入、发布门双清单判据、GPX overlay 绑定、`.cluster` 绑定数全不许动；
  拼板有而现状无的五项（封面槽/Day 时间轴/装备 chips/公开开关/路线缩略图）记差异不实现。
- **T008 路线三页**：tasks/T008.md。特别：time/ele 只读行与 GPX 往返零改动；route-edit 底栏 padding 与 has-sticky 终值不动；
  搜索/筛选/逐点开关不实现。
- **T009 工作台**：tasks/T009.md。特别：三面板组件文件 diff 必须为空；written/sync-key 接线与常驻挂载（class hide）不动；
  门槛说明行必须仍上屏；只改 workspace 页壳。
- **T010 现场三页**：tasks/T010.md。特别：staff 薄壳逻辑与"不绑 written"现状不动；发车预检确认层不动；
  触控区只增不减（自报改前改后命中高）；STATUS_ACTIONS 不搬 format.js（属业务单源重构，需另批）。
- **T011 轻量组**：tasks/T011.md。特别：notices 与 anotices 的 wxml 改后仍须逐字节相同；privacy 在冻结集不碰；
  notice.read 命令形状与 me 的 dispatchAndSync 不动。

---

## §4 独立验收 Prompt（主控自审或第二审查模型，每任务提交前跑）

独立审查 worktree `D:/OurTrail-night-ui-v1` 当前未提交 diff（任务 {TASK_ID}）。逐项输出"阻塞/一般/已通过/未验证"：
1) 是否改动未授权文件（对照任务书允许清单与冻结集 repository-audit §2）；2) 交互与路由是否保留（bind*/catch* 逐一对旧 wxml）；
3) 空/加载/失败/无权限/提交中/长文本态是否缺失；4) 有无虚构字段或凭空事实（缺字段印 0、氛围图称实拍、金额数字）；
5) WXML/WXSS 合法性：styleIsolation、safe-area 公式、canvas 未触、G10/G11 类门；6) 门禁钉点逐条是否仍在；
7) 测试是否真实执行（要求贴命令与退出码，缺者记未验证）；8) 状态词是否二次定义。不要自动掩盖失败。

---

## §5 失败与 blocked 协议
一次修复重试上限 1；第二次失败 ⇒ 任务标 blocked、`git checkout -- <允许文件>` 仅回滚本任务改动（**不得** reset --hard/clean）、
日志写入 `night-run-state.json` 的该任务 note、继续下一任务。共享组件/全局样式回归 ⇒ 暂停所有依赖任务。
连续 2 个 blocked ⇒ 停止派发，出阶段报告等用户指令。
