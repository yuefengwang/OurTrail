# 视觉验收取证 2026-10-22 · T007 编辑器步骤视觉（最终：通过）

授权范围：用户批准使用共享开发者工具会话（`cli close/open` 切换 worktree + `cli auto`）。
结果：**before/after 两侧各 7 态全部 VALID**（注入门 + bundle 新鲜度门 + 共享形态门全过），主控目视通过。

## 两侧与被测对象

| 侧 | worktree | commit | bundle 自证 |
|---|---|---|---|
| before | `D:/OurTrail-truth` | `e818e63`（T007 基线） | 分段条无 `done` 类；无 `.step-group`；缺项 callout 为 `info` |
| after | `D:/OurTrail-night-ui-v1` | `3164cf3`（T007） | `✓ 01信息`/`✓ 02路线` 完成态在屏；`.step-group` 眉题序列 = 基本/时间/路线指标/路线节点/上车点/名额审核/费用文本/风险/装备；缺项 callout 为 `warning` |

编辑器三个文件在 `e818e63..fffe04f` 间 diff 为空（夜分支前几个任务未动 editor），truth@e818e63 是合法旧 bundle。

## 方法（与 T004/T006 同口径）

- 驱动：`%LOCALAPPDATA%/Temp/opencode/mp-auto/shot-editor.js`（新写），端口 before=9435 / after=9436；
  滚动定位复用 `mp.pageScrollTo` + `mp.evaluate(new Function(...))`（闭包不随行的坑见 T006 记录）。
- 夹具：合成编辑器数据，字段形状取自 `editor.js` 的 `toForm` 产出（form 全字段 + stepDone +
  publishReady/requiredMissingText 等 checklist 键）；`stepDone` 在 before 侧注入同值但不被读取。
- 逐态：step1 已填 / step1 空表（缺项语气）/ step2 路线指标+节点+上车点 / step3 图文 / step4 四组 /
  发布 overlay（deferred info）。

## 主控目视结论

- 分段条：完成态只加 ✓ 记号（`.seg.done::before`），`.seg` 既有尺寸/配色/字重未动（swx1 §1 同轮全绿）；
  介绍/发布两步没有必填项故不印 ✓——探针实测 stepDone 全链路（空表 [F,F,F,F] → 标题+时间 [T,F,F,F]
  → 集合点补全 [T,T,F,F] 且 publishReady 同步翻真 → 移除集合点回落）。
- 步内分组：9 组眉题均落在正确内容上；组内 8px/组间 16px 的层级在真机上可辨；`.cluster` 行高未碰
  （swx2 §7b 的 DEFERRED 判据盯着，M-07 的 44px 补救仍在 `.cluster-row-tap` 上）。
- 语气层级：step1/step4 两处「还差」callout 由 info 改 warning（文案零改动）；发布 overlay 的
  deferred 清单保持 info（可后补不拦路）——「缺项拦发布=warning，可后补=info」的层级成立。
- 发布 overlay：摘要卡 + deferred info 清单 + 「去补上」+ 本人参加区块 + 确认发布，A-13/双清单
  呈现结构原样；固定底栏与 has-sticky 120px 公式一字未动（b4-pad 同轮 32/0）。
- 宽度仅验 375（模拟器默认）；390/414 与真机触控仍待后续真机轮。

## 产物

`before/before-*.png`（7 态）+ `after/after-*.png`（8 帧，含补拍的 step4 顶部）+ 两侧 `*-readings.json`
（seg 类名读数、step-group 计数、overlay callout 文本、逐屏 scrollTop）。

## 会话恢复

结束时恢复为用户主项目窗口（`cli open --project 'D:\OurTrail'` + `cli auto --auto-port 9425`）。
