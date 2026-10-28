# 状态板（R0 维护）

更新：2026-10-27（本轮只有一个执行者，`review→done` 由本人按门禁读数判定）

| 任务 | owner | 状态 | 最后读数 | 阻塞 | 更新 |
|---|---|---|---|---|---|
| T01 逐时五段图 | R1 | done | `weather-v3-hourly-svg-test` 51/0 | 真机解码耗时 UNVERIFIED | 10-27 |
| T02 详情外壳/四视图 | R2 | done | `weather-v3-structure` 79/0、`scenario-weather-v3` 49/0 | 无 | 10-27 |
| T03 首页两屏/深链 | R3 | done | `page2-gates` 119/0、`weather-hub-gpx` 23/0 | 深链仍是旧页（见 README §偏差 1） | 10-27 |
| T04 后端 plans | R4 | **done / 待部署** | `plans-test` 53/0、`smoke` 262/0、`lab-dryrun` 165/0 | 部署需授权 | 10-27 |
| T05 计划 UI | R2（并入） | done | `scenario-weather-v3` §3/§4 全过 | 无 | 10-27 |
| T06 门禁/变异/对拍 | R6 | done | 新增 7 个脚本；`mutate-weather-v3` 5 条 0 漏网；`ab-weather-v3` 43/0 | 无 | 10-27 |
| T07 真机 | R7 | **blocked（ENV）** | 无自动化会话 | 需授权重开共享开发者工具 | 10-27 |
| T08 收口 | R8 | done | `SYNC.md` 同日条目、design-system §17、证据包 README | 无 | 10-27 |

## 本轮读数表（各脚本自打印，不另立总账）

| 套件 | 读数 |
|---|---|
| `tools/weather-v3-hourly-svg-test.js` | 51 / 0 |
| `tools/weather-v3-structure-test.js` | 79 / 0 |
| `tools/weather-v3-visual-test.js` | 35 / 0 |
| `tools/plans-test.js` | 53 / 0 |
| `tools/scenario-weather-v3-test.js` | 49 / 0 |
| `tools/ab-weather-v3.js` | 43 / 0 |
| `tools/mutate-weather-v3.js` | 11 / 0（5 条变异 0 漏网） |
| `cloudfunctions/trailApi/smoke-test.js` | 262 / 0（新增 §18 计划 39 条） |
| `tools/lab-dryrun-test.js` | 165 / 0 |
| `tools/weather-page-test.js` | 219 / 0（未改动，旧页仍绿） |
| `tools/page2-gates-test.js` | 119 / 0（§0/§3/§4 hub 判据替换为无卡片结构） |
| `tools/m02-class-scope-test.js` | 65 / 0（card-label 单源改「凡使用即查」） |
| `tools/swx2-style-gates-test.js` | 111 / 0（T2.1 接受本文件内定义的局部变量） |

## 全量 sweep（收尾补跑）

命令：`node tools/*-test.js` 逐个跑（排除 3 个需开发者工具的 `e2e-ui*` / `e2e-golden-path`），共 **117 套**。

- **114 套 exit 0**
- **3 套 exit 1，均先于本轮存在**，并在 `git archive HEAD` 的干净副本上复现同一读数／同一失败项：
  - `cold-start-work 8/2`（首次建集合 17 次、一次 read 15 次集合读）
  - `g2-platform-gate 14/1`（具名 slot 样本 `{"defs":0,"uses":0}` = 判据没有输入）
  - `trip2-gates 66/10`（`callFunction` 桩缺失 ⇒ 装配抛错被 reload 吃成 denied）
- 断言总数不另立总账，一律以各脚本自打印 `passed=` 为准（本仓惯例）。

## OPEN（留给下轮，不在本轮改）

1. **O-1** 深链页与共享单元的统一（README 偏差 1）。
2. **O-2** 部署 `trailApi` + `trailApiLab`（需授权；先服务端后客户端）。
3. **O-3** 真机 E3（六个区域 + 缺资料/无海拔/超范围/stale 四态）。
4. **O-4** 活动带入计划（原型有、本轮未做）。
5. **O-5** 逐时 SVG 在 72h 的解码耗时（>300ms 需降级 canvas，本轮没测）。
6. **O-6** `pages/weather` 里 `cfDayLabels/cfSunTimes/cfDateLabel` 与 `weather-v3-view.js` 的同名逻辑是**两份实现**；旧页下线时应合并，现阶段由 `ab-weather-v3` 守住新实现的口径。