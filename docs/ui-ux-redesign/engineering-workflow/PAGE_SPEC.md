# PAGE_SPEC — 试点批次 T011：notices / anotices / me（night-v2，2026-10-22）

继承 night-v1 任务书 `agent-plan/tasks/T011.md`（主控已核实事实不重核：两页 wxml 逐字节同源各 101 行；工厂 `utils/notices-page.js`；me 入口清单与 4 处 dispatchAndSync）。本规格＝设计意图 + 实施边界 + 验收清单。

## 1. 页面目标与主任务

- notices（tab）：一眼看清"有哪些与我有关的通知、哪些还没读"，主操作＝读/标记已读/跳活动。
- anotices（活动内）：同上 + 组织者发布入口（canPublish 时）。
- me（tab）：我的身份与资料完整性 + 我的出行资产 + 安全档案与授权管理。

## 2. 信息优先级（上→下）

- notices/anotices：编辑式页头（眉题+大标题+一句定位）→（anotices）发布主按钮 → 计数与未读说明 → 通知卡流（未读在前由工厂排序，不改）→ 页级 message/error。
- me：身份卡（眉题+标题+头像+昵称+三格统计）→ 反馈横幅（error/hint/draftPending）→ 未激活引导卡 → 我的出行（最近活动+路线库）→ 安全档案 → 常用同行人 → 协作与权限。

## 3. 分区与内容（保持现状骨架，本轮只收敛视觉）

- 通知卡：header（未读/已读徽标 + 时间 tabular 右置）→ 正文（user-select，长文换行不截断）→ `.form-actions`（标记已读/查看活动安排/复制通知[owned]）→ 投递记录（owned 且有 deliveries）。
- me 各卡：`.card` + `.section-head`（kicker+section-title）已具备；行用 `.list-row`；协作码 `.code-text` 保留；位置撤回行着 danger 语义色（**不加确认弹窗**＝交互越界，登记）。

## 4. 操作位置

- 主操作：anotices 发布＝页内 `.button.primary.block`（唯一预算）；notices 无页级主按钮（卡内动作即主操作）。
- 辅助：卡内 text 按钮；me 行尾箭头/文字按钮；危险＝移除同行人/放弃本机修改（dialog 内实心红，现状合规）。
- 固定区：无 sticky；tab 页尾留白规则见 DESIGN_SYSTEM §3。

## 5. 滚动与固定行为

整页滚动；tabBar 固定（notices/me 留白已带）；anotices 非 tab 不带留白（两份 wxss 刻意不同的登记不动）。

## 6. 关键交互与状态（六态验收清单）

| 态 | notices/anotices | me |
|---|---|---|
| loading | status-panel loading | 同 |
| denied | status-panel denied + 重试 | 同 |
| empty | 「还没有需要你查看的通知」+下一步（文案零改） | recent 空态 status-panel；companions 空行小字 |
| error | 页尾 callout danger | callout danger + sheet 内错误 |
| 未登录/未激活 | —（读通知不需激活） | onboarding 卡 + sheet |
| 长文案 | 通知正文 2000 字换行；长昵称 80 字 input 内滚动 | 同左 |

## 7. 继承 token 与类（不新增）

纸底/白卡/forest 左边线/badge 六态/`.stack-gap3`/`.metrics`/`.avatar-*`/`.code-text`/`.form-actions`；导航bar 浅色两键。新增类仅 1 个：me.wxss `.revoke-text{color:var(--danger);}`（语义色引用 token，不发明色值）。

## 8. 窄屏/长文/异常

- 375 宽：卡内 actions `flex:1 1 120px` 自动折行（现状）；正文 `word-break` 由 `.code-text`/默认换行承担。
- 669 条长列表：本轮不动（性能登记）；截图取顶部+滚动两帧。
- 图片失败：recent 封面 `cover-failed` 隐藏回纯文字行（现状）。

## 9. 必须保留的业务能力（回归钉点）

- notices：`notice.read` 命令形状、复制投递、发布 sheet（受众 picker/名单勾选/targetsError 重试链）、`canPublish` 条件。
- me：4 处 dispatchAndSync（profile.save×3 语义 + position.revoke）、chooseAvatar/getPhoneNumber/nickname input、草稿横幅保存/放弃、同行人增改删、协作码复制、隐私跳转。
- 绑定计数钉点：改前后 bindtap/catchtap/bindinput/bindchange 计数逐项相同（除本轮类名/样式改动外零交互变化）。

## 10. 截图重点检查项（after 验收）

1. 三页导航bar paper 底黑字，与 routes/workspace 家族一致。
2. 未读卡左边线+徽标双通道清晰；已读卡无左边线。
3. me 身份卡：头像 64、昵称 18/600、统计三格数字 tabular。
4. 撤回行红色文字、其余行中性；dialog 内实心红不变。
5. 六态注入帧齐全（empty/loading/denied/onboarding/长昵称/长通知）。
6. tab 页尾留白不被导航改动影响（b4-pad 门）。
