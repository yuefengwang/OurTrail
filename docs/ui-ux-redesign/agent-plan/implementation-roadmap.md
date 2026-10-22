# 实施路线图（implementation-roadmap）

依赖链：**T001 → T002 → T003**（共享样式串行）。T004/T005 及后续夜任务本夜只立任务书不实施。

| ID | 名称 | 范围 | 依赖 | 状态 | 准入判定 |
|---|---|---|---|---|---|
| T001 | N1 设计系统共用类 | app.wxss 追加 + 登记 | — | ✅ passed d8400a7 | 已验 |
| T002 | N2 首页 | home + activity-card | T001 | ✅ passed bd24085 | 已验 |
| T003 | N3 发现页 | discover | T001 | ✅ passed 454ee7b | 已验 |
| T004 | N4 活动详情长图文展示层 | activity.wxml/wxss | T001 | ready（任务书全规格，含门禁钉点清单与 swx2 存量红顺手修授权） | 设计齐/钉点可指认/可回滚 |
| T005 | N5 天气入口 | weather-hub | 冻结解锁 | ⛔ blocked-by-freeze | 永久排除 G-02/03/04 |
| T006 | 报名页 | signup | T001 | ready | trip2 钉点已列 |
| T007 | 创建编辑器 | editor | T001 | ready | scenario-editor harness 约束已列 |
| T008 | 路线三页 | routes/route/route-edit | T001 | ready | GPX time/ele 钉点已列 |
| T009 | 工作台 | workspace 壳（三面板不动） | T001 | ready（高风险串行位） | 面板联动钉点已列 |
| T010 | 现场协作三页 | tasks/staff/vehicle | T001 | ready | 发车预检/薄壳钉点已列 |
| T011 | 轻量组 | notices/anotices/me（privacy 排除） | T001 | ready | 两页 wxml 同源性已列 |
| T012 | 天气展示层微调 | weather/weather-chart | 冻结解锁 | ⛔ blocked（冻结集） | 同 T005 |

执行顺序建议：T004 → T006 → T007 → T008 → T009 → T010 → T011（全串行：共享 app.wxss 语义与 activity-card 辐射面）。
每任务执行协议同 T002/T003：执行 Agent 先报盘点→实施→跑任务书门禁→主控审 diff→单提交→主控 shot.js 对拍。

## 天气线专项（只规划不实施）
C 图 5 屏拆为：W1 入口与观察点（=T005，冻结跳过）/ W2 逐时与多日（现有 unified meteogram，视觉微调需真机证据）/
W3 云剖面（不动）/ W4 天相机会与依据（沉默闸形态优先于圆环百分比）/ W5 全屏图（weather-chart 无设计）。
G-02 卫星云图/雷达/风场＝新数据源，requires-approval，不进入任何夜。

## 里程碑
M1 规划落盘（本文件集）→ M2 T001 提交 → M3 T002 提交 → M4 T003 提交 → M5 状态与晨间报告落盘。
任一里程碑门禁红且一次修复无效 ⇒ 该任务 blocked，不合并，继续下一无依赖任务。
