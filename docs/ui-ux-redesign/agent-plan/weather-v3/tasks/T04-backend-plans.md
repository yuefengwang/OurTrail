# T04 — 后端个人计划（`ot_plans`）

- 目标：3 条命令 + owner 双层授权 + 只读分享面 + 白名单投影 + 集合注册。
- 设计输入：§8.1–§8.5、§1.1.1。
- 允许修改：`cloudfunctions/trailApi/domain/{plans,schema,commands,permissions,selectors}.js`、`store.js`、`smoke-test.js`；`cloudfunctions/trailApiLab/**`（**只能**由 `sync-lab` 生成）。
- 禁止修改：客户端；`index.js`（`read` 已通用，无需新 action）。
- 步骤：1) schema（PlanStop/Plan/PlanInput/State/Payload）；2) `plans.js`（校验 + 归一化 + 双层授权）；3) canExecute 分支（必须在 `requireActivity` 之前）；4) selectPlans + kind:'plans'；5) 三处集合注册；6) smoke §18。
- 业务不变量：`ownerId = actor.userId`；`visibility` 由 `sharedWith` 派生；同日逆序拒绝；节点必须在路线内；被授权者只读；复制归复制者；同 `nodeIndex` 可跨天重复。
- 测试：`node tools/plans-test.js`（53）、`node cloudfunctions/trailApi/smoke-test.js`（262）、`node tools/lab-dryrun-test.js`（165）。
- 部署：**待授权**。顺序＝`sync-lab`（已跑）→ 部署 trailApi + trailApiLab → 再发客户端。
- 回滚：客户端不调用 `plan.*` 即可；服务端命令只新增，不改既有。