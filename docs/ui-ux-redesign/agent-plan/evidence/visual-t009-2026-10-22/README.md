# 视觉验收取证 2026-10-22 · T009 工作台页壳（最终：通过）

授权范围：用户批准使用共享开发者工具会话（`cli close/open` 切换 worktree + `cli auto`）。
结果：**before/after 两侧各 4 态全部 VALID**（注入门 + bundle 新鲜度门 + 共享形态门全过），主控目视通过。

## 两侧与被测对象

| 侧 | worktree | commit | bundle 自证 |
|---|---|---|---|
| before | `D:/OurTrail-truth` | `e818e63`（T009 基线） | 指标带无 `.metric-unit`；待办是裸 `.list-row` 行组；无 `callout info` 说明行 |
| after | `D:/OurTrail-night-ui-v1` | `43673f0`（T009） | `.workspace-band .metric-unit`×3（人）；待办行在 `.card` 内；门槛说明 = `callout info` |

工作台页在 `e818e63..fffe04f` 间 diff 为空（夜分支前几个任务未动 workspace），truth@e818e63 是合法旧 bundle。

## 方法（与前几轮同口径）

- 驱动：`%LOCALAPPDATA%/Temp/opencode/mp-auto/shot-workspace.js`（新写），端口 before=9435 / after=9436。
- 夹具：总览全量 data（页头/指标石带/queue/phaseTimeline/门槛位/面板挂载键），
  三面板以 `class hide` 常驻挂载、tab=0 时不可见；另测 tab=1 切换后面板仍挂载可见。
- 逐态：总览顶部 / 阶段可推进态 / 阶段拦路态（transitionHint 非空）/ 名单 tab。

## 主控目视结论

- 指标石带：三级结构（值/单位/标签）落地——「1人 待审核› / 2人 待安排车辆› / 3人 待签到›」；
  单位「人」有事实依据（三格均人数，`journey.fieldMetric` 两种 key 都是人）；
  石色带分组与发丝线分隔保留，指标即入口的三个 bindtap 原样（gates 同轮全绿）。
- 待办卡列：queue 与任务清单/活动通知入口行进 `.card`，section-head 与文案零改动；
  「（拦路）」标记与跳转绑定保留。
- 阶段区块：时间轴入卡（✓草稿/●行前准备·当前/○集合/○进行中/○返程，形状标记不靠颜色）；
  推进按钮三态（可推进/权限位/拦路）视觉区分保持。
- 门槛说明：升格 `callout.info` 后层级从「按钮脚注」提到「拦路原因」——
  「为什么现在不能推进：2 人已确认但没有出发结论，先在『现场』逐人核查。」逐字上屏，
  渲染条件（transitionHint / !canTransition 分离）未动。
- tab 条与三面板：存量 `.segmented/.seg` + 面板常驻挂载，切到「名单」面板正常渲染
  （合成环境无云数据，面板显示自己的空态——组件范围内容，符合预期）。
- 宽度仅验 375（模拟器默认）；390/414 与真机触控仍待后续真机轮。

## 产物

`before/before-*.png`（4 态）+ `after/after-*.png`（4 态）+ 两侧 `*-readings.json`
（metric-unit 计数、callout 类名读数、逐屏 scrollTop）。

## 会话恢复

结束时恢复为用户主项目窗口（`cli open --project 'D:\OurTrail'` + `cli auto --auto-port 9425`）。
