# 通知页 · 原型 A「行动流」实施证据（2026-10-29）

原型：`D:\OurTrail_UI_Lab\ourtrail-expansion\notices\option-a.html`（通知 A，`docs/expansion/handoff.md` 记录已定稿）
实现：`miniprogram/pages/notices/{notices.wxml,notices.wxss}` + `miniprogram/utils/notices-page.js`；活动内通知 `pages/anotices` 同步同构。

## 1. 结构

- 标题：「与你有关的安排」+「通知」+ 未读徽标 + 刷新圆钮
- 说明：先处理还没看的安排，再回到活动里确认集合与同行信息
- 分段：全部 N / 未读 N；右侧活动筛选（全部活动 / 按活动）
- 读数：`N 条通知` + `最新在上`
- 日期分组：今天 / 昨天 / M月D日 + `周X · M月D日`
- 行：52px 时间列 + 圆点 + 活动名 + 两行摘要 + 未读/已读 + 查看；未读行浅绿渐变底 + 左侧绿点
- 末尾：「安排有变化，这里会留下记录」
- 空态三分支：无通知 / 未读处理完 / 该活动无通知，各有出口
- 加载：日期条 + 三行骨架；详情：正文 + 关联活动 + 脚注 + 标记已读/查看活动（owner 另有复制与投递）

## 2. 数据契约

`kind:'notices'` 投影新增：

- `activityTitle`：行头「哪场活动」、活动筛选 label、详情标题
- `activityStartAt`：详情关联活动的出发时刻
- `pickupName`：首个上车点（无则空串）

客户端派生（`utils/notices-page.js`）：`groups/unreadCount/totalCount/filteredCount/emptyKind/activityOptions/filterLabel`，保留 `items` 全量与 `visibleItems` 语义。

## 3. 真机读数（VERIFIED，390 宽 IDE 模拟器，端口 9421）

真实账号通知 **0 条**：真实空态已截图；行动流/未读/详情/骨架用生产形状的 3 条注入（渲染走真页面）。

`notices-drive.js` **9/0**：

- 真实空态：`totalCount = 0`
- 注入 3 条：3 行 / 2 个日期组 / 2 行未读
- 未读筛选：只剩 2 条且全未读
- 详情：`noticeOpen=true`，标题「青城后山 · 通知」，关联活动 11月1日 周日 · 10:00 · 泰安古镇
- 空态面板、加载骨架均出现

对齐读数：`.view-switch` 与 `.activity-filter` 垂直中心差 0.0px；行内「未读/查看」中心差 0.0px；标题行与刷新钮 7px（原型同为底对齐）。

## 4. 截图

| 文件 | 内容 |
|---|---|
| `notices-empty-real-390.png` | 真实账号 0 条空态 |
| `notices-normal-390.png` | 行动流（注入 3 条：2 今天未读 + 1 昨天已读） |
| `notices-unread-390.png` | 未读筛选（只剩 2 条） |
| `notices-sheet-390.png` | 详情 sheet（正文 + 关联活动） |
| `notices-empty-390.png` | 空态面板 |
| `notices-loading-390.png` | 日期条 + 三行骨架 |

## 5. 例外（如实登记）

- 项目 WXSS 门不支持 `@keyframes`（G7/G8/G11 会拒绝工作）⇒ 刷新用透明度/底色，不做旋转；骨架静态灰度。
- 原型 9–13px → 12/14/16/24；分段按钮 44、筛选 48 保触控。
- 未做 375/414 分档（同「我的」页：G7 不吃嵌套 at-rule）。
- 活动内通知页头保留 `section-head`，正文与 tab 版同构（M-18）。

## 6. 未覆盖

活动筛选 sheet 与 owner 发布/投递的真机路径、真实未读数据（账号 0 通知）、375/414、物理手机。