# 天气页 V3 · 协同执行索引

- 实施文档（唯一设计输入）：`docs/superpowers/specs/2026-10-27-weather-page-prototype-v3-implementation.md`
- 原型（只读）：`docs/prototypes/ourtrail-explore-v3/`
- 执行日期：2026-10-27（单工作树、单 agent 串行执行；§16.2 的 R1–R8 由一人分时兼任）

## 一页状态

| 里程碑 | 状态 | 证据 |
|---|---|---|
| M0 契约冻结 | done | 本目录 `contracts.md` |
| M1a 逐时图探针 | **E1+E2，真机 UNVERIFIED** | `tools/weather-v3-hourly-svg-test.js` 51；解码耗时未测（无开发者工具会话） |
| M1b 后端 plans | done（**未部署**） | `tools/plans-test.js` 53、`smoke-test` 262、`lab-dryrun` 165 |
| M1c 门禁骨架 | done | 本目录 `state.md` 的读数表 |
| M2a 共享详情单元 | done | `tools/scenario-weather-v3-test.js` 49、`weather-v3-structure` 79 |
| M2b 首页两屏 | done | 同上；底栏留白仍由 `b4-pad-final-value` 33 守 |
| M3 四视图联调 | done（十项清单见 §16.7，逐条对应 scenario 套件） | `scenario-weather-v3` §1b/§2/§3/§4/§5 |
| M4 门禁 | done | 新增 6 套 + 变异 0 漏网 + A/B 43 |
| M5 真机 E3 | **NOT_RUN** | 本轮无开发者工具自动化会话；UNVERIFIED 清单见 `docs/ui-ux-redesign/evidence/weather-v3-2026-10-27/README.md` |
| M6 收口 | done | `SYNC.md` 同日条目 + design-system §17 |

## 依赖图（实际执行顺序）

```
M0 契约
 ├─ M1b 后端 plans（先做，避免与 UI 串行）
 ├─ M1a 逐时图（独立纯函数）
 └─ M2a 详情组件 → M2b 首页两屏 → M3 联调 → M4 门禁 → M6 文档
```

## 文件所有权（实际写集）

| 路径 | 角色 |
|---|---|
| `miniprogram/utils/weather-v3.js` / `weather-v3-view.js` / `weather-v3-hourly-svg.js` / `weather-plans.js` | R1+R2（纯逻辑） |
| `miniprogram/components/weather-detail/*` | R2 |
| `miniprogram/components/weather-plan-sheet/*` | R2（原 R5 并入） |
| `miniprogram/pages/weather-hub/*` | R3 |
| `cloudfunctions/trailApi/domain/plans.js`、`schema/commands/permissions/selectors`、`store.js`、`smoke-test.js` | R4 |
| `tools/{weather-v3-*,plans,scenario-weather-v3,ab-weather-v3,mutate-weather-v3}*` | R6 |
| `SYNC.md`、design-system、本目录 | R8 |

**未写**：`pages/weather/*`（旧长页保留）、`meteogram-svg.js`、`cloud-field-svg.js`、`utils/api.js`、`app.wxss` 的 `page` 块。

## 已知偏差（逐条留档，不当作已完成）

1. **深链页仍是旧长页**。§4.1 的目标是两宿主共用同一详情单元；本轮 `pages/weather` 一行未改（§11 P1 允许"旧长页暂留"，P7 才决定下线），因此活动/分享链接看到的还是旧版布局。风险 R3 的一半仍然存在：**新老两套详情并存**，但二者不共享状态，不会互相串味。
2. **真机全部 NOT_RUN**。本轮结论上限 E1+E2；"渲染对/更好看"一律不成立。
3. **未部署**。`cloudfunctions/` 已改（13 个文件，含新增 `domain/plans.js`），`node tools/sync-lab.js` 已跑、lab 副本逐字节一致；但**没有**上传部署 `trailApi`/`trailApiLab`。旧服务端 schema 是 strict，会以 `INVALID_INPUT` 拒绝 `plan.*` ⇒ 部署前首页"个人计划"只会显示读取失败（代码已把它和"没有计划"分开表达）。
4. **计划分享的删除粒度**：读视图只给 owner `sharedWith`（与 `routeView` 同一条界线），所以可以逐个取消；被授权者连名单都看不到。§8.3 "不回传 sharedWith" 的口径按此落地。
5. **活动带入计划**（原型 §"从活动带入"）未做：hub 不读活动。D3 的"可保存的个人计划"已满足；"从活动带入"记 OPEN。