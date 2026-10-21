# 实施路线图（implementation-roadmap）

依赖链：**T001 → T002 → T003**（共享样式串行）。T004/T005 及后续夜任务本夜只立任务书不实施。

| ID | 名称 | 范围 | 依赖 | 本夜 | 准入判定 |
|---|---|---|---|---|---|
| T001 | N1 设计系统共用类 | app.wxss 追加 + design-system.md 登记 | — | ✅ 实施 | 设计资料齐/不改存量/可回滚（单文件追加） |
| T002 | N2 首页 | home.wxml/wxss + activity-card | T001 | ✅ 实施 | home 不在冻结集；搜索/分段数据已有 |
| T003 | N3 发现页 | discover.wxml/wxss | T001 | ✅ 实施 | discover 不在冻结集；筛选能力已有 |
| T004 | N4 活动详情展示层 | activity.wxml/wxss + 长图文 12 段排版 | T001 | ⏸ 任务书 | 需 B 图逐段核对 ContentBlock 字段；中风险 |
| T005 | N5 天气入口 | weather-hub | T001 | ⛔ 跳过 | **weather-hub 在冻结集**（用户在途改动） |
| T006+ | 后续夜 | signup/workspace/routes/editor/staff/vehicle/notices/me/privacy/tasks/weather-chart/anotices | T001 | ⏸ 任务书占位 | 见 page-coverage-matrix |

## 天气线专项（只规划不实施）
C 图 5 屏拆为：W1 入口与观察点（=T005，冻结跳过）/ W2 逐时与多日（现有 unified meteogram，视觉微调需真机证据）/
W3 云剖面（不动）/ W4 天相机会与依据（沉默闸形态优先于圆环百分比）/ W5 全屏图（weather-chart 无设计）。
G-02 卫星云图/雷达/风场＝新数据源，requires-approval，不进入任何夜。

## 里程碑
M1 规划落盘（本文件集）→ M2 T001 提交 → M3 T002 提交 → M4 T003 提交 → M5 状态与晨间报告落盘。
任一里程碑门禁红且一次修复无效 ⇒ 该任务 blocked，不合并，继续下一无依赖任务。
