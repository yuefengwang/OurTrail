# H-T04 · R4 → R0（后端 plans）

## 产物
- 改动：`cloudfunctions/trailApi/domain/{schema,commands,permissions,selectors}.js`、`store.js`、`smoke-test.js`
- 新增：`cloudfunctions/trailApi/domain/plans.js`
- 生成：`cloudfunctions/trailApiLab/**`（`node tools/sync-lab.js`，18 个文件逐字节一致）

## 验证
- `node tools/plans-test.js` → passed=53 failed=0
- `node cloudfunctions/trailApi/smoke-test.js` → passed=262 failed=0
- `node tools/lab-dryrun-test.js` → passed=165 failed=0
- `node tools/trailapilab-test.js` → passed=25 failed=0
- `node tools/e2e-permission-test.js` → 96/0；`e2e-domain-negative` → 86/0（新命令未破坏既有码表）

## 接口（给下游）
- 命令：`plan.create {input}` / `plan.update {planId,input,expectedRevision}` / `plan.delete {planId,expectedRevision}`
- 读：`read {kind:'plans'}` → `{kind:'plans', plans:[…]}`；行内有 `isOwner/sharedBy/sharedCount`；`sharedWith` 仅 owner
- 授权：owner 双层；被授权者只读；`plan.create` 对任何人开放（复制即新建）

## 未验证（UNVERIFIED）
- **未部署**：`trailApi` / `trailApiLab` 都没上传。旧服务端会以 `INVALID_INPUT` 拒绝 `plan.*`。
- 真实云端多账号并发（两个 openid 同时改同一计划）未跑；CAS 只在领域层验证。

## 回滚
- 客户端不调用 `plan.*` 即可；服务端只新增命令与集合，既有 44 条命令行为未动。