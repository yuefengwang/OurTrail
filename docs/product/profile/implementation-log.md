# Implementation Log（第二阶段实施日志）

> 分支 `feature/profile-redesign`，基线 master `8e2426c`（第一阶段设计包落档后的 HEAD）。
> 本日志记录任务书 §12 要求的并行开发边界、§10 的设计-代码冲突处置、§13 的无关问题登记。

---

## Parallel Development

### Profile Agent owns（本分支独占修改）

| 文件 | 说明 |
|---|---|
| miniprogram/pages/me/me.js | Identity Hub 重写（错误三作用域 / 草稿 v2 / onboarding / 单读切换） |
| miniprogram/pages/me/me.wxml | 七卡结构 |
| miniprogram/utils/me-view.js（新增→C4 退役删除） | P0 客户端口径推导，P1 由服务端接管后删除 |
| miniprogram/wxs/me.wxs（新增） | 摘要脱敏 |
| tools/scenario-me-test.js | 全量重写对齐新 IA |
| cloudfunctions/trailApi/domain/selectors.js | **新增 `kind:'me'` 分支** + 抽取 visibleActivitiesFor/positionRowsFor 共享助手（home 分支行为不变） |
| cloudfunctions/trailApi/smoke-test.js | 新增第 16 节（Profile 域补洞 54 条） |
| cloudfunctions/trailApiLab/domain/selectors.js | sync-lab.js 镜像同步（护栏要求逐字节一致） |

### 共享小改（低冲突面）

- miniprogram/pages/signup/signup.js + signup.wxml：profile 读后 `draft.setOpenId` 回填 + 档案闸门直达按钮（+14/+3 行）
- tools/scenario-signup-test.js：拦截文案断言更新 + 3 条新断言

### Potential conflict with Bug Fix Agent

| 文件 | 冲突可能性 | 说明 |
|---|---|---|
| cloudfunctions/trailApi/domain/selectors.js | **中** | Bug Fix Agent 的 Phase 3 批（已合入基线 `e6fcc92`）改过本文件的 rowView（needsOutboundBoarding）。本分支的改动是**纯增量新分支 + 两处抽取助手**，与 rowView 无交集；若其后续继续改 `selectView` 的 home/profile 分支，合并时以人工对读为准。**Integration recommendation**：本分支 selectors.js 的改动自包含（新分支 + 助手抽取），cherry-pick 冲突时保留「助手抽取 + me 分支」，Bug Fix 侧对 rowView/home meta 的改动与本分支不重叠。 |
| cloudfunctions/trailApi/smoke-test.js | **低** | 本分支只在文件尾部**追加**第 16 节 + 改一行 import；Bug Fix 侧改动若在既有节内，无文本冲突。 |
| miniprogram/pages/signup/signup.js | 低 | 本分支只动 profile 读成功分支与拦截文案（±14 行）。 |
| tools/e2e-golden-path-test.js / e2e-ui-test.js | 无 | 本分支未触碰。 |

本任务期间主工作区（D:/OurTrail）始终干净、未提交状态为零；本分支未与任何 bugfix 分支 merge/rebase/cherry-pick。

---

## Design vs Code 冲突记录（任务书 §10：以代码为准，不改设计文档）

1. **SF-4（07-authorization-and-security §4）记录有误**：设计文档记「companion.remove 对不存在的 id
   静默成功」。实测：`canExecute` 在权限层即拒绝（profile.companions 不含该 id → FORBIDDEN，
   permissions.js:128-131），handler 的过滤 no-op 经 dispatch 不可达。**以代码为准**：行为 =
   「重复移除 → FORBIDDEN」。已用 smoke §16c 断言钉死（『重复移除已被 canExecute 拒绝…以代码为准』）。
2. **pruneDraft 恒真比较（实施中新发现的既有缺陷，非设计文档冲突）**：旧 me.js 的 `pruneDraft(person)`
   把 mergeDraft 的**合并值**当比较基准——草稿存在时两者恒等 → 草稿每次 reload 后被清，
   未落库输入只能活一轮往返（第二次切页必丢）。12 §4 的横幅设计恰好要求「草稿 vs 服务端值」比较，
   本分支一并修复（C1），scenario-me 有两次 reload 存活的回归断言。
3. **me-view.js 生命周期**：06 §2 预告「P1 落地 me 视图后此模块随之退役或转为兜底」——本分支取
   「退役」路径：C4 删除，scenario-me 纯函数节替换为 me 视图 fixtures 装配断言，
   口径唯一权威收敛到服务端（smoke §16a）。

---

## Unrelated issue detected（任务书 §13：只记录，不顺手修）

| file:line | 描述 | 是否可能与 Profile 重构冲突 |
|---|---|---|
| SYNC.md（master，Phase 3 条目） | `__P3_NUMBERS__` 占位符在落档时未填，合流时已如实标注「待补」——终跑逐轮读数仍欠 | no |
| components/roster-panel（GP-07 在案） | 协作授权弹层 `roleOptions/scopeOptions` 未挂 data（picker 无数据）——golden-path v1 已记录，属 roster-panel 键盘/确认批范围 | no |
| miniprogram/pages/me/me.js（本分支） | `_saving` 在途时点「完成」会被早退守卫弹回，sheet 不关（再点一次即成）。保留：为守住防重契约不加排队逻辑；真机实测为 papercut 级 | no（本分支内已知项） |
| cloudfunctions/trailApi（部署纪要） | CLI 部署不继承控制台超时配置；本轮部署后真实链路（多次 dispatch/read）全通，未见超时征兆，但**控制台超时值的人工复核仍建议做一次** | no |

---

## 测试基线账（Phase 0 → 最终）

| 套件 | 基线（8e2426c） | 最终（47d5fea） |
|---|---|---|
| check.js / check-handlers | ALL PASSED | ALL PASSED |
| smoke-test | 106 | **160**（+54 补洞） |
| scenario-me | 98（skipped=0） | **142**（skipped=0） |
| scenario-signup | 100 | 103（+3） |
| scenario-activity / workspace / api | 136 / 111 / 27 | 不变 |
| e2e-test（A 层） | 65 | 65 |
| e2e-fault-probe | 34 | 34 |
| trailapilab / lab-dryrun | 25 / 165 | 25 / **165**（同步护栏触发后复跑全绿） |
| 真机（DevTools 自动化） | — | Batch A 29/29；Batch B 回归 29/29 |

## 部署记录

- trailApi 已部署（CLI，21 文件，env `cloud1-d9ghcm034574b9d55`）；部署顺序 = 云函数先、前端后（14 §3）。
- 真机在「已部署 me 视图 + 前端单读」形态下 29/29 全通（含服务端 write→read 回环），
  实证部署生效且真实链路无超时征兆；控制台超时人工复核列为 FOLLOW-UP（见上表）。
- **部署约束**：若本分支被 cherry-pick 到主分支，`read{kind:'me'}` 必须随 trailApi 重新部署先于前端发版，
  否则「我的」页会 denied（旧云函数无 me 分支，read 返回 FORBIDDEN「不支持此读取请求」）。
