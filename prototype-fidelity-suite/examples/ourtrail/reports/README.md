# reports/ 目录说明

本目录里只有两个 run 被 `docs/pilot-ourtrail.md` 引用，其余是同一天早些时候的中间运行。

| 目录 | 状态 | 说明 |
|---|---|---|
| `pilot-real/` | **权威证据** | 试点主 run（状态 `real`）：15 对 → 1 PASS / 10 FAIL / 4 NOT_APPLICABLE；对齐锚点 `header`、重定基 `dy = 15` |
| `pilot-injected/` | **权威证据（仅视觉）** | 注入 `injected-plan` 的补充 run：补上 4 个 `NOT_APPLICABLE` 区块；`usableAsInteractionEvidence: false` |
| `weather-hub-home-real-2026-10-28T12-49-12` … `12-57-30` | **已被取代，不参与任何结论** | 12:49–12:57（UTC）之间在调映射/状态时的中间运行，读数依次为 13 FAIL / 2 N/A、11 FAIL / 4 N/A、10 FAIL / 1 PASS / 4 N/A 等；其中 `12-49-12`、`12-49-29` 两次在报告写出前就中断了 |

保留这些目录而不是删除，是因为任务书禁止"删除已有文件或工作区"；
它们与 `pilot-real` 的差别是**配置在变**（映射与状态逐步收敛），不是渲染漂移。
任何引用请只引 `pilot-real` / `pilot-injected`，其余目录的数字不得写进报告。
