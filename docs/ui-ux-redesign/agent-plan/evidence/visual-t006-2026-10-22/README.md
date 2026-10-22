# 视觉验收取证 2026-10-22 · T006 报名页表单层级（最终：通过）

授权范围：用户批准使用共享开发者工具会话（`cli close/open` 切换 worktree + `cli auto`）。
结果：**before/after 两侧各 6 态全部 VALID**（注入门 + bundle 新鲜度门 + 共享形态门全过），主控目视通过。

## 两侧与被测对象

| 侧 | worktree | commit | bundle 自证 |
|---|---|---|---|
| before | `D:/OurTrail-truth` | `e818e63`（T006 基线） | 收合卡无「授权 n/m」徽标；展开态无 `.part-group` 分组；用途登记不卡片化 |
| after | `D:/OurTrail-night-ui-v1` | `ff55dd6`（T006） | 徽标 `授权 1/1`（本人）/ `授权 0/2`（同行人）逐字在屏；`.part-group`×4 且眉题序列 = 身份/联系/出行/授权；用途登记在 `.card` 内 |

报名页三个文件在 `e818e63..fffe04f` 间 diff 为空（夜分支前三个任务未动 signup），truth@e818e63 是合法旧 bundle。

## 方法（与 T004 同口径）

- 驱动：`%LOCALAPPDATA%/Temp/opencode/mp-auto/shot-signup.js`（新写），端口 before=9435 / after=9436。
- 夹具：合成报名表数据，字段形状取自 `signup.js` reload 的真实产出（candidates/participants/tripModes/pickupOptions/consentBadge…）；
  出行方式文案逐字取自 `utils/format.js` 的 `TRIP_MODE_OPTIONS`。
- 滚动：`mp.pageScrollTo` + `mp.evaluate(new Function(...))` 里跑 `wx.createSelectorQuery` 取元素纵坐标。
  **坑（已记进驱动注释）：`mp.evaluate` 把函数 toString 送进 devtools 求值，闭盒变量不随行**——
  第一版直接引用外层 `selector` 变量报 `selector is not defined`，改走 `new Function` 形参传参。
- 展开态用**真实交互**（`page.callMethod('togglePart')` 点收合卡）而非直接改数据。

## 六态截图与判读

| 态 | after 截图 | 结论 |
|---|---|---|
| 表单顶部 | after-form-top | 页头/第 1 步/候选勾选/两张收合卡（徽标+资料齐）/固定底栏，层次清晰 |
| 展开·身份+联系 | after-expanded-identity-contact | 「1 / 我的资料」卡头 + 身份（姓名）+ 联系（电话/紧急×2/健康备注）四组眉题节奏正确 |
| 展开·出行+授权 | after-expanded-trip-consent | 出行（radio 两选项）+ 授权（dataUse 勾选 / proxyHome 可选未勾）分组正确 |
| 候补询问 | after-capacity-ask | A-13 视觉次序保持：底栏「明确同意整组候补」primary + 「提交报名」secondary 同屏；询问 callout 与说明行逐字保留 |
| 用途登记 | after-purpose-gate | 卡片化后与参与人卡同一圆角表面，按钮禁用态（purpose 空）保持 |
| 微信资料门 | after-profile-gate | profileGate 页块 + sheet 浮层同屏，外观与 T001 语言一致，触发逻辑未动 |

before 侧同六态截图中，除上述三处 bundle 差异外逐像素同构（收合卡、候选行、底栏、callout 文案）。

## 主控目视结论

- 收合态一行摘要 = 序号 + 姓名 + 出行方式标签 + **授权徽标** + 资料齐/待补全，与任务书目标 1 一致。
- 展开态四分组用存量 `.section-head`/`.kicker`，零新色值零新字重；组内 8px/组间 16px 的层级在真机上可辨。
- 底栏三态（busy 双禁 / failure / capacityAsk）沿用存量语义，未改权重与文案（trip2 S0–S8 同轮全绿）。
- 宽度仅验 375（模拟器默认）；390/414 与真机触控仍待后续真机轮。

## 产物

`before/before-*.png`（6 态）+ `after/after-*.png`（6 态）+ 两侧 `*-readings.json`（徽标读数、分组眉题序列、底栏按钮文本、逐屏 scrollTop）。

## 会话恢复

结束时恢复为用户主项目窗口（`cli open --project 'D:\OurTrail'` + `cli auto --auto-port 9425`）。
