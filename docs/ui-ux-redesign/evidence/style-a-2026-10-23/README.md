# 全局视觉收敛 A 真机核验（2026-10-23）

**范围**：冷白纸底 + 森林绿唯一主操作 + 白卡细线 + 下划线页签 + 提高密度（方案 A）。含 `app.wxss` token/类、底部 tab、activity-card、home/discover/tasks/workspace 列表与页签、12 页导航底色。**不含**任何业务逻辑、云端写入或部署。

**环境**：微信开发者工具 IDE 模拟器（306×660），项目 `D:\OurTrail`，重编译流程 `close --project` → `open` → `auto --auto-port 9428`（未 `quit` IDE）。驱动脚本在仓库外 `%TEMP%/opencode/mp-auto/verify-style-a.js` 与 `tap-style-a.js`。

**bundle 新鲜度自证**：`.tabs-line` 只存在于本批代码，home / tasks / workspace 三页实测均命中（`tabsLine=1`、`segCount=4`）；旧包不可能渲染出下划线页签。读数来自重编译后的同一会话。

**数据**：全部为真实云端数据，**零注入、零写入**。home 156 张卡、discover 50 张、workspace 使用组织者本人活动「测试活动」（`activity-mv0q0bt305yaqe`，待审核 0 / 待安排车辆 0 / 待签到 1）、tasks 列表为空。

## 读数

- **home**：当前页签 `background rgba(0,0,0,0)` / `color rgb(22,62,53)` / `font-weight 600`；底部 4 个 tab 的 active 同为透明底 + 森林绿 + 600；普通卡 `border 1px solid rgb(222,227,219)`（= `--line`）、底白、圆角 14px；featured 卡仍 forest-deep（`rgb(18,46,40)`）；列表卡片间距实测 `11.695px`（≈ `.stack-gap3` 12px）；页面 WXML 内「查看活动安排」重复入口 **0 次**。
- **discover**：50 张卡、间距同为 `11.695px`、`.stack-gap3` 存在、`loading=false`、`denied=''`。
- **tasks**：`tabsLine=1`、`segCount=4`、active 透明底、`loading=false`、`tasks=0`（真实空态）。
- **workspace**：`tabsLine=1`、`segCount=4`、active 透明底、`loading=false`、`denied=''`。
- **真实 tap** `home .seg[1]`（最近查看）：`filter` `mine → recent`、卡片 `156 → 41`、`.seg.on` 恰 1 个且文本为「最近查看」，下划线随选中项移动（`home-tab-recent.png`）；`tap-reading.json` `pass=true`，exit 0。

**有效性门**：`bundleFreshAll=true`、`realCardsHome=true`（156>0）、`realCardsDiscover=true`（50>0）。点击用例前 `reLaunch` 且读数与首帧不同（156 vs 41）⇒ 两轮未复用缓存。

**注意**：下划线是 `.seg.on::after` 伪元素，元素自身 `border-bottom` 读数为 `0px none` **不代表缺失**，像素证据只有截图；后续不要据此误判。

## 帧

| 文件 | 内容 |
|---|---|
| `home-top.png` | 首页首屏：冷白纸底、单行页头、搜索条、下划线页签、featured 深绿卡 |
| `home-list.png` | 首页白卡列表：1px 发丝边、卡片间距、底部 4 tab |
| `home-tab-recent.png` | 真实 tap「最近查看」后：下划线移动、列表切换 |
| `discover-top.png` | 发现页：页头、搜索、筛选 chip、featured 卡 |
| `discover-list.png` | 发现页白卡列表 + leaf 协作 chip |
| `tasks-top.png` | 任务清单：指标行、下划线页签、空态 |
| `workspace-top.png` | 工作台：指标行、下划线页签、待办卡 |
| `readings.json` / `tap-reading.json` | 逐页计算样式与偏移、点击前后读数 |

## 业务交互回归（2026-10-23 追加）

**环境**：同一开发者工具会话（项目 `D:\OurTrail`，automator 9420，未 `quit`）。样式 A 重编译后未再改产品代码；同会话只读复核 `.segmented` 的 `class="segmented tabs-line"`、卡片 `border 1px solid rgb(222, 227, 219)` ⇒ 本批业务测试跑在样式 A 的 bundle 上（`bundle-marker.json`）。

**A 层（真实信封 / 服务链路，node 直跑）**

| 套件 | 判读行 |
|---|---|
| `e2e-test` | `passed=72 failed=0` |
| `e2e-permission-test` | `passed=96 failed=0` |
| `e2e-domain-negative-test` | `passed=86 failed=0` |
| `e2e-client-cas-test` | `passed=54 failed=0 bugs=1 drift=0`（`bugs=1` 为既有 BUG-C2，非本轮） |
| `e2e-interleave-test` | `passed=67 failed=0 inconclusive=3`（真云端并发 / 跨身份桩 / 读滞后） |
| `e2e-panel-sync-test` | `passed=40 failed=0 bugs=0` |
| `e2e-release-gap-test` | `passed=51 failed=0` |

原始日志：`%TEMP%/opencode/e2e-style-a/e2e-*.log`（B 层两份已复制为本目录 `e2e-ui-test.log` / `e2e-ui-state-test-rerun.log`）。

**B 层（真实 tap / 输入 + 后果观测）**

- `e2e-ui-test`：`BUSINESS PASS 26/0/0`；`UI INCONCLUSIVE 64/0/1`；`passed=90 failed=0 unverified=1`。唯一未验证＝组织者经原生 `<picker>` 授予车辆联络（弹层不在可查询树，平台通道限制）。依 `docs/testing/e2e-result-semantics.md`，整体记 **INCONCLUSIVE，不是 PASS**。
- `e2e-ui-state-test`（先补 `expectedRevision` 才能开跑，见下「套件修复」）：`BUSINESS FAIL 14/1/2`；`UI FAIL 41/13/3`；`passed=55 failed=14 unverified=5`。**失败全部归因到套件与产品演进脱节，不是样式 A 回归**：
  1. **8 UI + 1 BUSINESS**：套件按 `.button.secondary` 找「确认报名」，而 `roster-panel.wxml:61` 自 2026-10-09（`3c11cd19`，状态收敛到 `journey.js`）起是 `.button.primary`。按钮找不到 ⇒ 下游「审核落库」那条 BUSINESS 断言没有成因，属连带假红，不是域层拒绝。
  2. **2 BUSINESS INCONCLUSIVE + 2 UI INCONCLUSIVE**：套件仍找「进入正在集合」，当前单一来源文案是 `journey.js:266` 的「开始集合」。只读复核该沙盒得到 `nextPhaseLabel="开始集合"`、`canTransition=true`、按钮实际渲染 `class="button primary block"`（`workspace-phase-entry.log`）。首版定点探针的同类断言失败是**读数时机**问题（页面装载未完成就查 `.button`），补等待后文案在场。
  3. **3 UI**：保存后 2 秒内重开「编辑车辆与司机」时 `busy` 仍为真，`transport-panel.wxml:99` 在 busy 期间把 `bindtap` 置空串 ⇒ 真实点击被产品设计成空操作；套件未等 busy 落地，属夹具时序，不是重开功能坏。
  4. **1 UI INCONCLUSIVE**：原生 `<picker>`（同前）。
- **定点复核**（本目录 `probe-state-invariant.js`）：已确认在选时「确认报名」class 含 `disabled`，真实点击后 `batch=""`、`selectedCount=1` ⇒ 产品侧的 BUG-C 不变量成立；截图 `state-invariant-probe.png`（43,018 B）。阶段文案与 bundle 标记复核见同目录 `probe-workspace-phase-entry.js`、`probe-bundle-marker.js` 与 `workspace-phase-entry.log`。

**套件修复（未提交）**：`tools/e2e-ui-state-test.js` 建档/发布补 `globalRev` + `dispatchGlobal`。该套件 2026-10-07 定稿，早于服务端 `076bf11`（2026-10-09）对缺失 `expectedRevision` 的 `NO_REVISION` 失败关闭；不补则第一步就中断。只改测试夹具，产品代码零改动。

**未跑**：`tools/e2e-golden-path-test.js`。原因：① 其 `dispatch` 仍缺 `expectedRevision`，GP-01 为既有红（2026-10-14 已登记）；② 阶段文案同样停留在「进入正在集合」；③ 开跑前会取消共享云上最多 8 个历史 `[GP·黄金路径]` 活动，并新建一个**非 `[预演]`** 活动——超出本轮测试授权，未擅动。

**副作用（未清理，待裁决）**：状态矩阵套件在共享云写入 `[预演] 状态矩阵E2E-7cm7`（`activity-mvkm7ge4esw8a1`）及同行人 `赵辰-7cm7`/`李晃-7cm7`/`王闰-7cm7`；首轮失败另写 `-r7sk` 三名。`e2e-ui-test` 写入 `[预演] 工作台E2E`、`[预演] 报名E2E`。**没有创建任何非 `[预演]` 活动**；未删除云端测试数据。

## 边界

- 这是 **IDE 模拟器不是物理手机**；未验证真机色彩管理与系统字体差异。
- tasks 当前无真实任务数据，只验证了空态与页签；任务行形态未取像素。
- 样式 A 本身只改样式类，handler 未动；业务交互回归见上节：A 层七套零失败，B 层 `e2e-ui-test` 整体 INCONCLUSIVE（仅原生 picker），状态矩阵的 14 条失败均为套件过期/时序，非产品回归。
- `cloudfunctions/` 零改动 ⇒ 不需要重新部署 trailApi；本轮测试产生的云端 `[预演]` 沙盒未清理。
