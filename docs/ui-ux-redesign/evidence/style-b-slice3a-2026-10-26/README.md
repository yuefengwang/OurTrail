# Style B · Slice 3a（工作台身份 hero + 纸面板 + 紧凑指标条）证据

日期：2026-10-26 · 基线 `6e1faec` · 分支 `agent/ourtrail-style-a-20261023`
规格：`docs/ui-ux-redesign/style-b-shared-layer-spec-2026-10-26.md` §3.4 / §5.2 / C17
结论上限：**结构 + 静态门 + 页面套件**（真机 **NOT_RUN**，见 §6）

---

## 1. 结构块验收（G0 §3.4 逐块）

| 块 | 目标 | 实现 | 读数 |
|---|---|---|---|
| [0] 原生导航 | 不启用自定义导航（C20） | 未动 `workspace.json`；导航标题仍「活动工作台」 | `scenario-workspace` 钉住标题，125/0 |
| [1] 身份 hero | 森林绿块从导航下沿开始；标题 20/28 + 一行说明 | `.workspace-hero`（`margin:-24px -20px 0; padding:20px 20px 56px; background:var(--forest)`），内含 `.workspace-identity`：eyebrow + `badge on-forest` 阶段徽标 + 标题 + 副行 | `operations-layout` §首屏列/hero 两条静态读数 |
| [2] `.sheet-top` | 上圆角 20，盖住 hero 下沿 20 | `.sheet-top ws-sheet`（`gap:20; padding-bottom:24`），内含 tabs ×4 → 指标带 → 三个常驻面板 → tab0 总览 | 结构断言：`tabs → facts → roster-panel → overview` 全部在纸面板内 |
| [2a] 指标条 | C17：保留、去卡片化成紧凑条（不删） | `.workspace-band` 去掉 `--stone` 底/圆角/内边距；竖分隔改 `--line`；删掉 24px 覆盖 ⇒ 数值回全局 26px | 计数恰 3 + 删一格必红夹具 |
| [2b] 检查队列 | tab0 首块、纸面上只留发丝线 | `.queue-card` 去掉 `.card`；主待办仍是 `forest-soft` 一行 | 「不再套 .card」静态读数 + 变异 |
| [2c] 工具 / 阶段 | 4 个白面工具 2×2、阶段时间线、取消为文字入口 | 未动（批次二 b 已定） | 4 条既有断言照旧绿 |

- **一个 20px 的算术坑**：`.sheet-top` 的 `-20px` 若落进 `.stack`（gap 16），净叠压只剩 4px。首屏因此用**无 gap 的 flex 列** `.ws-top` 承载 hero 与纸面板（与活动详情 `.act-top` 同一条教训），并把它钉成断言。

## 2. 改动面（3 个文件）

| 文件 | 改动 |
|---|---|
| `miniprogram/pages/workspace/workspace.wxml` | 根节点 `.stack` → `.ws-top`；新增 `.workspace-hero > .workspace-identity`；tabs/指标带/三面板/tab0 总览收进 `.sheet-top.ws-sheet`；队列去掉 `.card`；门槛解释恢复 `small muted` + `display:block` |
| `miniprogram/pages/workspace/workspace.wxss` | 新增 `.ws-top` / `.workspace-hero` / `.ws-sheet`；指标带与队列去卡片化；其余（工具双列、阶段区）未动 |
| `tools/operations-layout-test.js` | 结构读取改到 hero/sheet 两层；面板父节点改 `sheet`；新增 6 条断言（指标计数 + 牙齿、首屏列无 gap、hero 负边距/森林底、纸面板 gap、指标带去卡片化、队列无 `.card`） |

零新增 token / 零新色值 / 零新全局类；`workspace.js` 与 `workspace.json` 未改，`TABS` 文案、`tab` 逻辑、`journey.leaderQueue` 数据口径一字未动。`cloudfunctions/` 零改动 ⇒ **不需要重新部署**。

## 3. 有意偏离（逐条给理由）

| 规格 | 实现 | 理由 |
|---|---|---|
| §3.4 写「指标条 4 格」 | 保留 **3** 格 | §5.2 与 C17 要求「数量不变」；`journey.fieldMetric` 只产出三项，凑第 4 格要么造假指标、要么改投影 |
| §3.4 导航「活动协作」 | 仍「活动工作台」 | `scenario-workspace-test.js:314` 钉住该标题；改它属于跨页导航口径，超出 3a 写入集 |
| 板 03-1 队列行有圆形图标 | 不加逐行图标 | `journey.leaderQueue` 条目没有图标键；在页面里按 label 再映射一张图标表＝第二层标签，违反「状态与文案只出自 journey」 |
| 板 03-1 hero 右上有一个轻量入口 | 不加 | 四个去向已由 4 个工具卡承担（任务/通知/细节/编辑），再加一个就是同一动作的重复入口 |
| 板 03-1 hero 有日期/人数一行 | 副行用 `phaseScene` | 页面没有「日期·人数」聚合字段；为此加投影字段属于数据面改动 |
| 板 03-1 队列行是「标题 + 计数」 | 仍是「label + detail」两行 | `journey` 的 detail 就是下一步该做什么，替换成计数会丢信息 |

## 4. 门禁读数（逐套实跑）

| 套件 | 读数 | 退出码 |
|---|---|---|
| `tools/check.js` | ALL CHECKS PASSED（G10：作用域单元 42 / token 3148 / app.wxss 类名 135 / 命中 0；G11：43 个 wxss、关键属性双写 0） | 0 |
| `tools/check-handlers.js` | 死 handler 仍只有存量 `editor#onNumber` | 0 |
| `tools/operations-layout-test.js` | **45 / 0**（39→45，+6） | 0 |
| `tools/t1-r01-test.js` | **29 / 0**（改前 28/1） | 0 |
| `tools/scenario-workspace-test.js` | 125 / 0 | 0 |
| `tools/page2-gates-test.js` | 117 / 0 | 0 |
| `tools/swx1-style-gates-test.js` | 45 / 0 | 0 |
| `tools/swx2-style-gates-test.js` | 110 / 0 | 0 |
| `tools/t4-e08-test.js` | 41 / 0 | 0 |
| `tools/m02-class-scope-test.js` | 66 / 0 | 0 |
| `tools/b4-pad-final-value-test.js` | 33 / 0 | 0 |
| `tools/b4-c11-busy-selfheal-test.js` | 171 / 0 | 0 |
| `tools/e2e-panel-sync-test.js` | 40 / 0（bugs=0） | 0 |
| `tools/journey-graph-test.js` | 15 / 0 | 0 |
| `tools/ui-consistency-test.js` | 19 / 0 | 0 |
| `tools/entry-layout-test.js` | 41 / 0（UI=NOT_RUN） | 0 |

**未跑全量 sweep，不编总数。**

### 4.1 收回一条既有红（不是放宽）

`t1-r01` 的 T25 自 Gate recount 28 起就红：它要求门槛解释行求值后是 `small + muted`、且 `style` 含 `display:block`。取证：`66fd8e3`（引入 T25 的那次提交）该行是 `<text wx:if … class="small muted" style="display:block;">`；后续重构把它压成 `<view class="callout info"><text class="small">`，丢了 `muted` 与内联块。本轮该节点本来就在改写范围内，按原始口径恢复 ⇒ 28/1 → **29/0**。没有删除或放松任何断言。

## 5. 变异自证（改生产文件，还原后 sha256 一致）

| 变异 | 期望 | 实测 |
|---|---|---|
| `.ws-top` 加回 `gap: 16px` | 首屏列无 gap 变红 | `passed=44 failed=1`，红的正是该条 |
| `<view class="queue-card">` → `class="card queue-card"` | 队列无 `.card` 变红 | `passed=44 failed=1` |
| hero `background: var(--forest)` → `var(--surface)` | hero 森林底变红 | `passed=44 failed=1` |

三次还原后 `sha256sum`：wxss `24f3450a…183c5`、wxml `02234aa4…52459` 与备份一致；复跑 `45/0`。

## 6. 真机 NOT_RUN

共享开发者工具会话本轮未接管、未重编译，因此**不宣称该屏已保真**。升到 VERIFIED 至少需要：

1. `close --project` + `open` 重编译（不 `cli quit`），bundle 新鲜度由新结构自证（纸面板上圆角压在森林块上）。
2. 生产形状载荷：`queuePrimary.id !== 'idle'` 与 idle 各一帧、`transitionHint` 有值、`canEdit=true`、三个面板各自有数据。
3. 读数：hero 底边与纸面板 top 的关系（应 -20px）、指标带在 375/390 两宽下不换行、四个工具卡等高、tab 切换后面板不丢状态。

## 7. UNVERIFIED

- 森林底白字在真实设备上的对比度（算术用已有 token，未取像素）。
- 纸面板 20px 叠压的实际观感（`-24/-20` 与 56px 下内边距的配合）。
- 指标带三格在 320/375 宽下 `tripSummaryLine` 的换行。
- 门槛解释行改成 `muted` 后在 `callout info` 底上的可读性。
- 原生导航栏高度对 hero 起点的最终影响。
