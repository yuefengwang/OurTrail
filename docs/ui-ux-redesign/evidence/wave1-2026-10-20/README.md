# Wave 1 真机证据（2026-10-20）

## 环境

- 微信开发者工具服务端口 33278，已登录；automator 绑定 9423。
- 模拟器视口实测 **306×660**（不是 390×844；小屏反而更适合看标签是否挤）。
- 数据为 `page.setData` 注入的生产形状载荷；页面渲染路径、组件与 SVG 都是仓库真实代码。
- **已获用户授权**执行 `close --project 'D:\OurTrail'` → `open` → `auto`（只关项目，不 `quit` IDE），
  用于刷新 bundle。重新编译后先断言 `<route-profile>` 的 SVG `viewBox`，再截图。

## 文件

| 文件 | 内容 | 结论 |
|---|---|---|
| `discover-list.png` | 发现页列表、筛选 chip、结果计数、featured 卡 | VERIFIED（布局事实） |
| `discover-filter-sheet.png` | 日期/难度筛选 sheet | VERIFIED |
| `discover-map.png` | 列表/地图切换；map 组件 + marker 数据 2 个 | 组件/标记 VERIFIED；底图瓦片 UNVERIFIED |
| `discover-map-scrolled.png` | 滚到地图下半部：腾讯地图 attribution、2 个 marker、底图失败兜底文案 | 同上 |
| `discover-map-wait-1s/3s/6s.png` | 等待地图瓦片 1/3/6 秒 | 6s 仍只有零散矢量面，无底图 |
| `activity-top.png` | 活动详情 hero、难度徽标、分区锚点 | VERIFIED |
| `activity-weather-card.png` | 分区锚点跳到天气 + 出发日天气摘要（出发日/小时/全天/起点/风险/双入口） | **VERIFIED（新鲜 bundle）** |
| `activity-route-profile.png` | 分区锚点跳到路线 + 海拔剖面 | **VERIFIED（新鲜 bundle）** |
| `tasks-owner.png` | 任务清单 owner：计数、筛选、任务卡、开始/编辑/删除 | 渲染 VERIFIED；云端读写已部署验证 |
| `tasks-filter-todo.png` | 筛选「待办」后只剩 1 条 | VERIFIED（页面逻辑，注入数据） |
| `tasks-new-sheet.png` | 新建任务 sheet（标题/说明/分类/负责人/截止） | 渲染 VERIFIED；底部保存键在 scroll-view 内 |
| `tasks-participant.png` | 参与者只读：无新建、无行内操作 | VERIFIED（页面逻辑，注入数据） |

## Bundle 新鲜度（已证）

重新编译后，在模拟器里读 `<route-profile>` 的 `src` 并解码 SVG：

```
viewBox="0 0 280 160"
```

与工作树当前代码一致。`activity-route-profile.png` 的 y 轴标签为
**4,660 / 3,930 / 3,200**，x 轴为 **0 km / 43.9 km**，在 306px 视口下可读；
之前 660×220 版本被缩到约 5px 的问题已消失。剖面最终像素结论由 **UNVERIFIED 升为 VERIFIED**。

## Wave 2 天气摘要

`activity-weather-card.png` 使用注入的生产形状 `weatherBrief`（页面真实 WXML/WXSS 渲染）：
「阴 / 10/26 周日 / 08:00 阴 12°C · 降水 20% · 风 6 km/h / 全天 10–18°C · 降水概率 30% /
起点 · 长坪沟口 / 风险提示 / 查看路线天气 / 看下方风险」在 306×660 下可读。
数据获取链路由 `tools/scenario-activity-test.js` 的集成断言覆盖（起点、出发日、重试、无出发时间不外呼）。

## Wave 3 任务清单

`tasks-*.png` 使用注入的生产形状任务视图（页面真实 WXML/WXSS 渲染）：

- owner：3 条任务、计数 1/1/1、筛选段、行内「开始/编辑/删除」；
- `tasks-filter-todo.png`：筛选「待办」后只剩采购任务；
- `tasks-new-sheet.png`：新建 sheet 的字段与分类；内容在 `scroll-view` 内，保存键需向下滚动；
- `tasks-participant.png`：`canManage=false`，无新建按钮与行内操作。

**已部署并真实云端验证**：`trailApi` 与 `trailApiLab` 均 Active / timeout 20，线上包 `tasks.js/schema.js/store.js` 与工作树逐字节一致。
用真实账号的「测试活动」（`activity-mv0q0bt305yaqe`）跑通
**创建任务 → 进行中 → 删除**，页面回读数量回到 0，活动本身未改动；输出见 `real-task-crud.txt`。
参与者只读与 owner-only 由 `tools/tasks-test.js`（27）与 `tools/scenario-tasks-test.js`（24）覆盖；
A 层信封（403 / CONFLICT / 幂等 / REQUEST_REUSED / 草稿级联）由 `tools/e2e-task-test.js`（28）覆盖。
工具文件数 `ls tools/*-test.js | wc -l` = 100。

## 地图

`discover-map-scrolled.png` 中可见：

- 腾讯地图 attribution（`©2026 Tencent - GS(2026)1190号`）；
- 2 个 marker 与地图控件；
- 「点地图上的标记查看活动；底图未加载时可切回列表。」兜底文案。

**底图瓦片仍为空白**，只有零散矢量面；判断为 IDE 地图瓦片/网络环境问题。
`map` 组件、marker 数据与兜底文案已验证；**真实底图未证**，不把“marker 存在”写成“地图渲染正常”。

## 复现命令

```powershell
# 绑定 automator（路径含中文；从 PowerShell 调用）
& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto `
  --project "D:\OurTrail" --auto-port 9423 --trust-project --port 33278
```

```bash
# 驱动脚本在仓库外
node C:\Users\thinkbook\AppData\Local\Temp\opencode\mp-auto\drive-wave1.js
node C:\Users\thinkbook\AppData\Local\Temp\opencode\mp-auto\drive-map-view.js
```

## 下一次

地图底图需要换真实设备/可用网络复核；其余 Wave 1 验证已完成。
