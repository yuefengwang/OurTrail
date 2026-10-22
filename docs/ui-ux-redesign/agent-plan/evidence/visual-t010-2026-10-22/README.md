# 视觉验收取证 2026-10-22 · T010 现场三页（最终：通过）

授权范围：用户批准使用共享开发者工具会话（`cli close/open` 切换 worktree + `cli auto`）。
结果：**before/after 两侧各 6 态全部 VALID**（注入门 + bundle 新鲜度门 + 共享形态门全过），主控目视通过。

## 两侧与被测对象

| 侧 | worktree | commit | bundle 自证 |
|---|---|---|---|
| before | `D:/OurTrail-truth` | `e818e63`（T010 基线） | legState 是 `.section-sub` 小字（章节头无徽标）；无 `.pending-names` |
| after | `D:/OurTrail-night-ui-v1` | `bad5ccb`（T010） | legState 语义色徽标「逐人清点后再发车」在章节头；`.pending-names`×1 在屏 |

三页在 `e818e63..fffe04f` 间 diff 为空（夜分支前几个任务未动 tasks/staff/vehicle），truth@e818e63 是合法旧 bundle。

## 方法（与前几轮同口径）

- 驱动：`%LOCALAPPDATA%/Temp/opencode/mp-auto/shot-field.js`（新写，三页一连），端口 before=9435 / after=9436；
  另用一次性补测脚本量触控命中高（`wx.createSelectorQuery().boundingClientRect` 读高度）。
- 夹具：vehicle 清点态全量 data（5 名乘客、4 人未上车、6 个长人名串成的 pendingNames）；
  tasks 三条任务（待办/进行中/已完成各一，含长标题长备注）；staff 薄壳 + sync-key。
- 逐态：vehicle 清点态 / 发车确认弹层（长名单）/ 已发车态（legState=info）/ staff 薄壳 / tasks 列表。

## 触控命中高实测（自报改前改后）

| 选择器 | before | after | 判据 |
|---|---|---|---|
| 清点行（`.person-list` 均分，5 行） | 132px | 132px | ≥44 ✓ 未变小 |
| 行内按钮（`.button`，插槽确认上车） | 48px | 48px | ≥44 ✓ 未变小 |
| 分段（`.seg`，去程/返程） | 60px | 60px | ≥44 ✓ 未变小 |
| 底栏操作（`.form-actions .button`，确认发车） | 48px | 48px | ≥44 ✓ 未变小 |

清点行由全局 `.person-row`（app.wxss，16+16 padding + 40px 头像）承载，按钮 min-height 走
`--action-height`；本页未写任何 min-height 字面量（M-07 口径），命中高只增不减。

## 主控目视结论

- legState 三态语义色落地：待清点=warning（琥珀）、已发车=info（蓝）、已完成=success（绿，同一表达式）；
  文案零改动（「逐人清点后再发车 / 本程已发车 / 本程已完成」逐字在屏），色调取自页面已有
  departed/completed 布尔。
- 发车确认弹层：长名单（6 个人名）折行完整、无截断；弹层结构（不可改写提示 + 差谁 + 仍然确认发车 +
  先回去清点）与 A-13/M-13 行为链原样（trip2 同轮 66/10 存量红与基线逐条同款，无新增）。
- 清点行与按钮：行内「已上车/未上车」徽标 + 复制联系/确认上车双按钮命中区充足，现场单手可点。
- staff：薄壳 + field-panel 挂载正常（合成环境无云数据，面板显示自己的空态——组件范围内容）；
  浅色导航生效；wxml 仍零 bind/catch（契约 25/0）。
- tasks：任务卡（分类徽标 + 状态徽标 + 操作行）与 `.segmented` 筛选条经逐项核验符合目标，
  操作行保持 `.button` 语义与 canManage 收口；本轮仅补浅色导航。
- 宽度仅验 375（模拟器默认）；390/414 与真机触控仍待后续真机轮。

## 产物

`before/before-*.png`（6 态）+ `after/after-*.png`（6 态）+ 两侧 `*-readings.json`
（legState 徽标读数、pending-names 计数、任务卡/按钮数、命中高实测、逐屏 scrollTop）。

## 会话恢复

结束时恢复为用户主项目窗口（`cli open --project 'D:\OurTrail'` + `cli auto --auto-port 9425`）。
