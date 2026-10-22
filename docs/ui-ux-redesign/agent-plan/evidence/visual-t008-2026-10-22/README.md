# 视觉验收取证 2026-10-22 · T008 路线三页（最终：通过）

授权范围：用户批准使用共享开发者工具会话（`cli close/open` 切换 worktree + `cli auto`）。
结果：**before/after 两侧各 5 态全部 VALID**（注入门 + bundle 新鲜度门 + 共享形态门全过），主控目视通过。

## 两侧与被测对象

| 侧 | worktree | commit | bundle 自证 |
|---|---|---|---|
| before | `D:/OurTrail-truth` | `e818e63`（T008 基线） | 路线列表是 `.list-row` 行组；时间轴是裸 `.timeline`；风险是卡内 `.list-row`；route-edit 无 `.row-tap` |
| after | `D:/OurTrail-night-ui-v1` | `58c4f43`（T008） | `.route-card`×3 + `.route-card__media` 封面空槽×3 + 卡内 `.metrics`×3；时间轴在 `.card` 内；风险 `.callout.warning`×2；route-edit `.row-tap`×2 |

路线三页在 `e818e63..fffe04f` 间 diff 为空（夜分支前几个任务未动 routes/route/route-edit），
truth@e818e63 是合法旧 bundle。

## 方法（与 T004/T006/T007 同口径）

- 驱动：`%LOCALAPPDATA%/Temp/opencode/mp-auto/shot-routes.js`（新写，三页一连），端口 before=9435 / after=9436；
  另用一次性补拍脚本取路线详情的时间轴/风险两屏（滚动定位复用 `mp.evaluate(new Function(...))`）。
- 夹具：routes 列表三条（我的×2 + 共享×1，含有数据/缺数据两种 metrics 形状）；
  route 详情全量投影（hero/map/profile/分段天气/时间轴/风险×2）；route-edit 表单
  （含 time/ele 只读行的节点 + 展开态）。封面图用仓库真实 asset，氛围图加载正常。

## 主控目视结论

- routes：每条一卡＝封面空槽（--stone 底，不假图）＋标题行（难度/已共享徽标）＋指标行
  （12.5 km / 860 m / 3 路线节点）＋摘要行；缺里程爬升的路线只印「1 路线节点」——
  与 routeStats 同一条「缺则不印」的规矩（探针实测三种形状）。
- route：hero 与指标行与活动详情同款 hero-cover+metrics（T002/T004 卡语言，改前已对齐，
  本轮目视确认）；时间轴入卡后与分段天气/风险同一卡语言；风险段两条 warning callout
  与活动详情同形；章节节奏统一（剖面不再是唯一的 gap:8 章节）。
- route-edit：GPX 入口进卡后与「基本信息」同级；收合的节点/风险行带 `.row-tap`
  （min-height var(--touch-target)）；time/ele 只读行「轨迹记录于…，不可修改 / 海拔…，不可修改」
  原样在屏（diff 零变化）；固定底栏「保存修改」与 has-sticky 120px 未动。
- 三页浅色导航（#F6F3EC 纸底黑字）在真机生效（截图顶部导航栏）。
- 宽度仅验 375（模拟器默认）；390/414 与真机触控仍待后续真机轮。

## 产物

`before/before-*.png`（5 态）+ `after/after-*.png`（7 帧，含补拍的时间轴/风险两帧）+
两侧 `*-readings.json`（路线卡数、封面槽数、卡内指标行数、风险 callout 数、row-tap 数、逐屏 scrollTop）。

## 会话恢复

结束时恢复为用户主项目窗口（`cli open --project 'D:\OurTrail'` + `cli auto --auto-port 9425`）。
