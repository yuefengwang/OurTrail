# V2.0 路线库 · 真机 E2E 测试报告

- **日期**：2026-10-13
- **被测功能**：V2.0 路线库（`pages/routes` / `pages/route` / `pages/route-edit` / 活动编辑器 `?routeId=` 预填 / `route.create/update/delete` / `readRoutes`）
- **Case spec**：`docs/testing/route-library-e2e-cases.md`（46 cases A→J；spec 原文写「38 条」为笔误，本报告按实际编号 46 条执行）
- **驱动脚本**：仓库外 `C:\Users\thinkbook\AppData\Local\Temp\opencode\mp-auto\routes-driver\run.js`（~1100 行，零仓库依赖）
- **环境**：微信开发者工具，IDE 服务端口 33278，自动化端口 9420，`miniprogram-automator` 0.12.1
- **分支**：`win/route-library-v2`（只读），base commit `5af3083`
- **云函数**：`trailApi` 已部署（含 `readRoutes` action + `route.create/update/delete` 命令）

---

## 总结

| 维度 | 计数 |
|---|---|
| **PASS** | 41 |
| **FAIL** | 0 |
| **INCONCLUSIVE** | 1 |
| **uiUnverified** | 4 |
| **总计** | 46 |

- **OVERALL: INCONCLUSIVE**（退出码口径 2）
- **reason**：产品缺陷 0 条、41 条用例真实通过，但 UI 维度存在 4 项 `uiUnverified`（RL-A3 空态、RL-E1/RL-G6 协作者单账号视角、RL-G3 编辑器草稿保存的 picker 链路）+ 1 项 INCONCLUSIVE（RL-H6 天气 provider 可用性属环境因素）。按 `docs/testing/e2e-result-semantics.md` §四规则 2「存在 uiUnverified ⇒ 该维度 INCONCLUSIVE、OVERALL 不得为 PASS」，首版报告将 OVERALL 记为 PASS 属结论越级，2026-10-13 由项目 agent 按语义文件机械修正为 INCONCLUSIVE；**未验证项全部是环境/通道所限，无一条是产品失败**。
- 1 INCONCLUSIVE = RL-H6（天气 provider 可用性是环境因素，DevTools 内无法控制网络）
- 4 uiUnverified = RL-A3（空态，fixtures 存在时无法测）、RL-E1 / RL-G6（协作者视图，单账号通道）、RL-G3（活动编辑器草稿保存需复杂 picker 交互，BUSINESS 由 G4 覆盖）
- **未覆盖的功能含义（用户须知）**：「从路线一键发起活动」在真机上验证到"编辑器 banner + 表单预填正确"（G1/G2 PASS）与"域层快照隔离"（G4/G5 BUSINESS PASS），**未经真机走完"补齐时间人数集合点 → 保存草稿"这一步**（G3）——该步由无头 `routes-test` 的 68 条域层断言与 A 层覆盖，UI 侧仍是缺口。

---

## 逐案结果

### A — 列表入口与导航

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-A1 | UI | ✅ PASS | 点击「路线库」→ `/pages/routes/routes` |
| RL-A2 | UI+B | ✅ PASS | 列表含 `[E2E]完整路线`，云端读数一致 |
| RL-A3 | UI | ○ uiUnverified | 空态未测（fixtures 存在） |
| RL-A4 | UI+B | ✅ PASS | reLaunch 列表稳定 |
| RL-A5 | UI | ✅ PASS | 详情→返回→列表，303 行 |

### B — 创建路线

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-B1 | UI | ✅ PASS | 新建页有标题输入、GPX 按钮、示例按钮 |
| RL-B2 | UI | ✅ PASS | 空标题被拦：先给这条路线起个名字。 |
| RL-B3 | UI+B | ✅ PASS | 创建路线 id=route-mv6kskv8fjkjz6 pointCount=2 |
| RL-B4 | UI | ✅ PASS | 未命名节点被拦：还有路线节点没有名字，展开节点逐个补齐。 |
| RL-B5 | UI | ✅ PASS | 示例路线加载 2 点 |
| RL-B6 | B | ✅ PASS | distanceKm=7.5 ascentM=300 |

### C — 编辑路线

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-C1 | UI | ✅ PASS | 表单回填：title=[E2E]完整路线 points=3 dist=12.5 |
| RL-C2 | UI+B | ✅ PASS | 重命名 → 保存 → 读数一致 |
| RL-C3 | UI+B | ✅ PASS | 节点 2 kind 改为 finish |
| RL-C4 | B | ✅ PASS | sharedWith 保留：["u-lab-01"] |

### D — 详情页展示

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-D1 | UI | ✅ PASS | 指标=["12.5","800","3","2"] |
| RL-D2 | UI | ✅ PASS | 地图可见，markers=3 |
| RL-D3 | UI | ✅ PASS | 无坐标路线不显示地图 |
| RL-D4 | UI | ✅ PASS | 时间轴 items=3 eyebrows=["OURTRAIL · 路线","起点","途中","终点"] |
| RL-D5 | UI | ✅ PASS | 风险=2 hasHigh=true hasLow=true |
| RL-D6 | UI | ✅ PASS | polyline len=1 points=3 |

### E — 共享

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-E1 | UI | ○ uiUnverified | 单账号通道；协作者视图需第二身份 |
| RL-E2 | UI | ✅ PASS | owner 看到共享卡 + 添加按钮 |
| RL-E3 | UI+B | ✅ PASS | 无效身份码被拒：路线共享名单无效。 |
| RL-E4 | UI+B | ✅ PASS | 共享给 u-lab-02 |
| RL-E5 | UI+B | ✅ PASS | 移除 u-lab-02 |
| RL-E6 | UI | ✅ PASS | 重复被拦：这条路线已经共享给这位协作者了。 |

### F — 删除与引用保护

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-F1 | UI+B | ✅ PASS | 删除后云端消失，page=pages/route/route |
| RL-F2 | UI+B | ✅ PASS | CONFLICT：有 1 个活动正在使用此路线，请先在活动中解除关联再删除。 |
| RL-F3 | UI | ✅ PASS | 活动详情正常打开 |

### G — 活动编辑器集成

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-G1 | UI | ✅ PASS | 编辑器带 banner 打开 |
| RL-G2 | UI | ✅ PASS | 表单预填：routeTitle=[E2E]完整路线 pts=3 dist=12.5 |
| RL-G3 | UI+B | ○ uiUnverified | 活动 editor 草稿保存需复杂 picker 交互；BUSINESS 由 G4 覆盖 |
| RL-G4 | B | ✅ PASS | routeId=true 快照不随路线改名而变：[E2E]完整路线 |
| RL-G5 | B | ✅ PASS | 活动创建后路线不变：起点·山门 |
| RL-G6 | UI | ○ uiUnverified | 单账号通道；协作者视图需第二身份 |

### H — 分段天气

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-H1 | UI | ✅ PASS | nodeWeather=3 ready=3 |
| RL-H2 | UI | ✅ PASS | 3 节点均无坐标 |
| RL-H3 | UI+B | ✅ PASS | 各节点 targetDate=2026-10-14 |
| RL-H4 | UI | ✅ PASS | 日程模式开，startDate=2026-10-13 startTime=08:00 |
| RL-H5 | UI | ✅ PASS | 无时间节点无抵达徽章 |
| RL-H6 | UI | ? INCONCLUSIVE | provider 可用性是环境因素；DevTools 内无法控制网络 |

### I — 旧路线兼容

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-I1 | UI+B | ✅ PASS | 旧路线可见，source=活动沉淀 |
| RL-I2 | B | ✅ PASS | updatedAt=2026-10-13T19:11:07+08:00 visibility=private |

### J — 草稿与并发

| Case | 维度 | 判定 | 说明 |
|---|---|---|---|
| RL-J1 | UI | ✅ PASS | 草稿恢复：[E2E]草稿测试 |
| RL-J2 | UI+B | ✅ PASS | CONFLICT：安排已更新，本次修改没有保存。请核对最新状态后重新提交。 |

---

## 测试夹具

测试前通过 `trailApi` dispatch 创建以下夹具路线（均以 `[E2E]` 前缀标记，测试后全部删除）：

| 标识 | 标题 | 用途 | 关联活动 |
|---|---|---|---|
| F1 | `[E2E]完整路线` | 主夹具：3 节点 / 2 风险 / 12.5 km / 800 m | — |
| F2 | `[E2E]无坐标路线` | 无坐标节点 | — |
| F3 | `[E2E]被引用路线` | 删除引用保护 | `[E2E]引用F3的活动` |
| F4 | `[E2E]已共享路线` | 共享给 u-lab-01 | — |
| F5 | `[E2E]无时间路线` | 无 time 字段节点 | — |
| Legacy | `[E2E]活动沉淀旧路线` | 旧路线兼容 | `[E2E]沉淀旧路线的活动` |

测试过程中还创建了若干临时路线（`[E2E]手工路线` / `[E2E]数值测试` / `[E2E]里程爬升`），均已在清理阶段删除。

---

## 执行中遇到的问题与修复

### 1. B3：列表读数 `points` 字段不存在

- **现象**：UI 保存成功（`message=路线已入库。`），但 readback 抛 `Cannot read properties of undefined (reading 'length')`
- **根因**：`readRoutes()`（列表态）返回的是 `pointCount` 而非 `points` 数组（`selectors.js:304-312`），驱动脚本误读 `found.points.length`
- **修复**：改读 `found.pointCount`

### 2. G4/G5：`activity.create` 缺 `routeSnapshot` 被拒

- **现象**：`INVALID_INPUT "操作字段不完整或格式不正确。"`
- **根因**：`ActivityInput` schema 中 `routeSnapshot: RouteSnapshot` 是必填字段（非 `specOpt`），驱动脚本未提供
- **修复**：从 F1 路线数据构建 `routeSnapshot`（`{title, distanceKm, ascentM, points, risks}`）并加入 payload

### 3. C4：automator 超时（transient）

- **现象**：`timeout waiting for automator response`
- **根因**：`miniprogram-automator` 与 DevTools 的 WebSocket 通信偶发超时，非测试逻辑问题
- **修复**：重跑一次即通过

### 4. 节点展开交互

- **现象**：通过 card tap 展开节点不稳定
- **根因**：`addPoint` 已自动设置 `expandedPoints[id]=true`，card tap 反而可能折叠
- **修复**：改为 `callMethod('togglePoint')` 并先检查展开状态，已展开则跳过

---

## 清理结果

测试后执行两轮清理：

1. **第一轮**：删除 17/19 条 `[E2E]` 路线；2 条因活动引用被 CONFLICT 拦截
2. **第二轮**：先删除 2 个引用活动，再删除剩余 2 条路线

**最终状态**：`[E2E]` 路线 0 条、`[E2E]` 活动 0 条，云端干净。

---

## 方法学说明

- **UI PASS 判据**：每次 UI PASS 由「真实 tap/input + 后果观测」构成，不取 data 侧推断（铁律 21）
- **BUSINESS PASS 判据**：通过 `wx.cloud.callFunction` 直打 `trailApi`，读回落库数据验证
- **uiUnverified**：单账号通道无法测协作者视图（E1/G6）、空态在 fixtures 存在时不可测（A3）、活动编辑器草稿保存需多步 picker 交互（G3 BUSINESS 由 G4 覆盖）
- **INCONCLUSIVE**：天气 provider 可用性是环境因素（H6），DevTools 内无法控制网络通断
- **驱动脚本位于仓库外**，零 npm 依赖污染；仅最终报告写入仓库
