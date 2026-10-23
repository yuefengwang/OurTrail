# UI_AUDIT_REPORT — 项目/页面/资产/工具链审计（night-v2，2026-10-22）

阶段 A1。所有事实取自本会话实跑命令或仓库文件；历史结论引用 night-v1 台账（`docs/ui-ux-redesign/agent-plan/night-run-state.json`）与根 AGENTS.md Gate recount 1–27。

## 1. 仓库与环境状态（实测 2026-10-22 22:0x）

- 分支 `master`，HEAD `c1a5aeb`（night-v1 T001–T010 已于 `c0da80a` 合并入 master）。
- 工作区：**4 个未跟踪遗留**（`OurTrailNightBu.txt`、`OurTrail_UI_重构交付包_V1.zip`、`OurTrail_UI_交付包/`、`OurTrail全局UI重设计.txt`）＝上轮输入材料，**不删不改不提交**；无他人已跟踪修改；`git worktree list` 仅主工作区。
- 远端仅 `origin`（GitHub 直连；relay 已不存在，见项目记忆 2026-10-17 实测）。
- 微信开发者工具：会话开始前**未运行**（tasklist 无 wechatdevtools 进程）⇒ 本会话新起 IDE（`cli open`），`islogin={"login":true}`，`cli auto` 绑定 **9425**（AppID 回显 wx1227a277a3f2f7ea）。未 quit/close 任何既有会话。
- 技术栈：原生 WXML/WXSS/CommonJS，零 npm 依赖；21 页（app.json 实测）、14 组件目录（13 在用 + privacy-popup 死代码）、`app.wxss` 44 个自定义属性（29 色 + 3 渐变 + 1 rgba + 11 数值/时长）；门禁 `tools/*-test.js` 106 套 + 2 静态门。

## 2. 页面清单（21 页；设计映射见 PAGE_REFERENCE_MAP.md）

| 页面 | 用途 | 重设计历史 | 真实截图证据 | 风险/备注 |
|---|---|---|---|---|
| home / discover | 发现与列表 | Wave1（10-20）+ night-v1 T002/T003 | screens/before+after、evidence/wave1 | discover `.filter-chip` 34px<44 登记未改 |
| activity | 活动详情长图文 | recount 26（10-21）+ T004 | evidence/activity-article-p2p3、visual-t004 | 拼板行程时间轴无数据源未造 |
| signup | 报名 | T006 | visual-t006 | — |
| editor | 创建/编辑 4 步 | recount 19 + T007 | visual-t007 | 高复杂度 798 行 |
| workspace / staff / tasks | 领队工作台 | T009 / T010 / recount 24 | visual-t009/t010 | sync-key 契约 |
| vehicle | 现场车辆 | T010 | visual-t010 | — |
| routes / route / route-edit | 路线资产 | Wave1 + T008 | visual-t008 | GPX 契约只读透传 |
| **notices / anotices / me** | 通知/活动通知/我的 | **本轮试点 T011** | **本夜 before/ 6 张（真实云数据）** | 两页 wxml 逐字节同源 |
| weather-hub / weather / weather-chart | 天气线 | 冻结集（T005/T012 永久排除） | evidence 历轮 | 只保护不重构 |
| privacy | 隐私长文 | 冻结（在途未提交） | — | 不碰 |
| lab / cloud-field-poc | DEV_ONLY | 不做 | — | journey-graph DEV_ONLY 登记 |

## 3. 设计资产盘点

- **真身**：`miniprogram/app.wxss`（token + 全局类）与 `.agents/skills/ourtrail-ui/`（14 规则 + 5 references）。
- 总览图：`OurTrail_UI_交付包/01_全局视觉参考.png`（21 屏 8 区，本会话已读）+ 附件天气五屏/活动详情专项图。
- 历史：`docs/ui-ux-redesign/{design-system.md,2026-10-16-redesign-report.md,2026-10-20-global-prototype-dev-plan.md,phase-2-implementation-report.md}`、`agent-plan/`（night-v1 全台账）、`screens/{before,after,phase2}`、`evidence/*` 11 个取证目录、`docs/ui-snapshots/ourtrail-all-pages-2026-10-20.png`。
- 冻结参考：`docs/prototypes/ourtrail-app/`（只读设计语言来源，禁运行/扩展）。

## 4. 工具链能力

见 `TOOLCHAIN_CAPABILITY_MATRIX.md`（17 行，逐条状态与证据）。要点：静态门/106 套件/A 层 E2E 已实测；B 层三套固定 9420 历史 INCONCLUSIVE；真机通道本夜新起 9425 已实测出图；**仓库内无像素比对工具**（视觉 QA 靠人眼 + 独立 QA Agent）。

## 5. 风险与存量债（继承登记，不擅自清偿）

1. `trip2-gates-test.js` 66/10 存量红（stubWx 缺 wx.cloud 桩；tools/ 冻结）——主工作区同款复现归因清楚。
2. `e2e-ui` / `e2e-ui-state` / `e2e-golden-path` 环境门 INCONCLUSIVE；GP-01 既有红先于本轮。
3. night-v1 openDebts 6 条：article-images gap 与列宽 calc 两本账 / home+discover cardMetrics 双拷贝 / 页头同形类待 app.wxss 解冻 / discover filter-chip 34px / home 导语删除语义改 callout。
4. 天气线冻结：任何"统一视觉"不得触碰 meteogram/云场/沉默闸（铁律 25–35）。
5. 669 条为历史截图读数；当前数量未复测（长列表性能未评估，本轮不动，登记）。

## 6. 活动创建流程专项分析（任务书 5.3）

本轮试点非 editor，但按要求梳理并记录（结论继承 2026-10-14 quick-create 规格 `docs/superpowers/specs/2026-10-14-quick-create-deferred-route.md`，本夜零改动）：
- 发布门只剩**标题/三个时间/集合上车点**；轨迹可解析项（里程/爬升/节点/风险）整体可后补，但**条目级完整不放水**（带出的每条风险 severity/coordinates 往返无损）。
- 编辑器 4 步：`missingForPublish`（必填缺项）与 `deferredForPublish`（可后补）双清单；发布确认层给「去补上/仍然发布」知情跳过。
- 阶段锁三组化：交易性键整体锁 / 路线·风险·上车点**只增不改**（按 id 逐字节比对）/ 信息性标量可改。
- 用户决策 D1 上车点必填+一键派生 / D2 只增不改 / D3 字段只分必填与可忽略两类。
- 与任务书产品要求对照：简单✅ 不强制✅ 自动生成（GPX 派生集合点）✅ 必填有理由✅ 可选配置分层✅ 图文独立编辑（content-editor，10-21）✅ 预览/校验/错误/保存✅。
- 遗留：封面/装备已有数据与编辑能力，缺的是指定布局/交互；Day 时间轴缺人工计划模型；公开开关缺 visibility 字段（证据见 MORNING §7）。

## 7. 工作区安全策略

- 工作分支 `agent/ourtrail-night-ui-v2`（自 master c1a5aeb）；每单元单提交可 revert；**不 push**。
- 冻结清单见 `AGENT_WORKFLOW_PROPOSAL.md` §3；同文件唯一写者＝主控。
- 破坏性命令（reset/clean/quit/close 他人会话）一律不执行；本会话自起 IDE 会话的 close+open 仅用于改码后重编译并记录。
