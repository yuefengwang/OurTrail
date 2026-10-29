# 冻结契约（M0 产出 · 2026-10-27）

与实施文档 §16.5 同一条款，这里是**执行时的最终形态**（实现后回填，不是重写设计）。

## 1 详情上下文

```js
{ date, cursor, period, tab, nodeIndex }
```

- `date`：时间窗起点（`YYYY-MM-DD`）。
- `cursor`：窗口内绝对小时 `0..period-1`；跨天时 `cursor >= 24`。
- 选中时刻 = `date + floor(cursor/24)` 天，`hour = cursor % 24`（`weather-v3.selectedDate/selectedHour`）。
- `tab ∈ hourly | cloud | route | sky`。

## 2 详情组件 props / events

| 名称 | 形状 | 说明 |
|---|---|---|
| `mode` | `'tab' \| 'deep'` | 只影响返回按钮与底栏归属 |
| `place` | `{ id, kind:'route'\|'point', name, lat, lng, area, routeId, activityDate, nodes:[{name,lat,lng,altitude,eleSource}] }` | `kind` 决定沿途 tab 是否可用 |
| `initial` | `{ node, date, hour, period, tab }` | 只消费一次；签名变化才重置 |
| `planId` | `string` | 指定计划；缺省取该路线最近更新的一条 |
| `canBack` | `boolean` | tab 页里也要一个回首页入口（`switchTab` 不能带参、也不会复发状态） |

事件：`bind:screenback`（返回）、`bind:openplace`（换地点，宿主开弹层）、`bind:planchange`（计划写入后通知宿主重读）。

## 3 纯逻辑导出

`utils/weather-v3.js`：

```
initialState / cursorOf / selectedDate / selectedHour / selectedTime
setTab / selectHour / changePeriod / setDate / setNode / jumpToAbsolute
windowSeries / hourAt / columnLabel
pointDayStrip / planDayStrip
readoutOf / numText / conditionOf
VERDICTS / VERDICT_LABELS / SKY_GROUPS / verdictOf / mergeGroup / starText / skyCards
parseHM / hhmm / buildSunArcSvg
planTimeViolation / stopDate / planDayOf / typedTime / abbreviateCode
```

`utils/weather-v3-view.js`：

```
buildDetailView({ result, place, node, ctx, width, plan, nodeWeather, stale }) → { data, geo, skyOut, window }
buildRouteFlow / buildSkyView / buildCloud / cloudReadout / buildSilent
elevationOf / horizonDayLabels / sunTimesForWindow / dayLabel
emptyView / loadingView
```

`utils/weather-plans.js`：`listPlans / inputOf / draftOf / validateDraft / savePlan / deletePlan / planForRoute / ownPlans / sharedPlans`。

## 4 图表生成器

`utils/weather-v3-hourly-svg.js`：

```
buildHourlySvg({ series, cursor, period, node, width }) → { svg, width, height, cell, columns, cursor }
axisLayout() → [{ key,label,unit,top,size,sub? }]
```

几何常量：`CELL = 42`、`HEIGHT = 310`、五段基线见 `Y`。缺值断线、不补 0、云带按连续段分块。

## 5 后端契约

| 面 | 形状 |
|---|---|
| 命令 | `plan.create {input}` / `plan.update {planId, input, expectedRevision}` / `plan.delete {planId, expectedRevision}` |
| 输入 | `PlanInput = { routeId, name, startDate, stops:[{nodeIndex,day,time}], sharedWith?, visibility? }`（`visibility` 被服务端忽略） |
| 读视图 | `read { kind:'plans' }` → `{ kind:'plans', plans:[{ id, routeId, name, startDate, stops, visibility, isOwner, sharedBy, sharedCount, updatedAt, sharedWith? }] }` |
| 投影边界 | 永不给 `ownerId`；`sharedWith` 只给 owner（逐条取消分享）；被授权者只有 `sharedBy` |
| 集合 | `store.COLLECTIONS.plans = 'ot_plans'`（另需 `smoke-test.emptyState` 与 `schema.stateSpec`，三处缺一不可） |

## 6 皮肤变量

根节点 `.weather-v3` 上的 `--w-*` 十个；`weather-plan-sheet` 在自己的 `.wp` 上重复 4 个（组件自包含）。
登记表见 `.agents/skills/ourtrail-ui/references/design-system.md` §17，判据见 `tools/weather-v3-visual-test.js`。

## 7 冻结后的变更流程

提出方写进交接单 → R0 判定 → 更新本文件 + 通知消费方 → 各自改自己的文件。
本轮实际发生的两处回填：

1. 读视图加了 `sharedCount`，并只对 owner 回 `sharedWith`（原 §8.3 的"不回传 sharedWith"在**非 owner** 语境落实）。
2. `weather-plan-sheet` 自带同名变量（`swx2 T2.1` 要求 var() 在本文件有定义）。