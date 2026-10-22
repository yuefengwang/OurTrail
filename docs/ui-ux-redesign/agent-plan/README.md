# OurTrail Night Build V1 — 规划与执行索引

运行 `night-ui-v1-20261022` · 基线 `e818e63` · worktree `D:/OurTrail-night-ui-v1` · 分支 `agent/ourtrail-night-ui-v1`

| 文件 | 内容 |
|---|---|
| input-manifest.md | 设计资料/截图/环境实况，含缺失与 NOT_RUN 声明 |
| repository-audit.md | 21 页清单、门禁基线、**冻结集（91 处在途）**、本夜可写集、现状视觉基线 |
| page-coverage-matrix.md | 19 用户页 × 设计覆盖 × 本夜任务 |
| design-gap-analysis.md | G-01..G-08 设计有/仓库无（禁实现）与 B-01..B-05 兼容实现形态 |
| design-system.md | 目标语言→现有 token 映射 + N1 新增共用类契约（零新色值） |
| business-invariants.md | 12 条硬约束 |
| implementation-roadmap.md | T001→T002→T003 串行；T004 任务书；T005 跳过；天气线 W1–W5 |
| acceptance-plan.md | 门禁命令清单、diff 审查清单、视觉 NOT_RUN 理由、提交规则 |
| night-execution-plan.md | 调度/并发/预算/停止条件 + **执行模型诚实条款（无法指定 Flash）** |
| tasks/T001.md … T004-T005.md | 逐任务自包含 Prompt |
| night-run-state.json | 断点续跑状态 |
| night-report.md | 晨间报告（收尾时写） |

## 一句话结论
规划完成；首夜实施 T001–T003（N1/N2/N3），T005 因冻结集跳过，天气五屏与长图文中的虚构能力只记差异不实现。
