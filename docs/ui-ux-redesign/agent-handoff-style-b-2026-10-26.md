# style-B 改造交接书（给执行 Agent 用）

**日期：** 2026-10-26 · **基线：** `6e1faec`（批次一 checkpoint，未推送）· **工作树：** 批次二 a/b 未提交

> 用途：替代「把截图丢给 Agent，说照着这个改」。方案已由 D1–D11 锁定，不再产出 3–4 套视觉备选（情绪板的探索阶段跳过），只做「规格 → 差分 → 切片 → 证据」的迁移。

---

## 0. 先确认参考件（最容易错的一步）

| 图 | 位置 | 是否本任务参考 |
|---|---|---|
| 用户 2026-10-26 附的新板：5 段约 20 屏、全浅色、品牌行、无页内大标题、详情吸顶分段、天气「条件 → 图 → 详解」 | **不入库**（D3 刻意不入库），只在会话中附图或放仓库外临时路径 | **是** |
| `docs/ui-ux-redesign/reference/global-prototype-2026-10-20.jpg` | 仓库内，旧 style-A 板 | **不是** |

旧板含 `¥680/人`、收藏、中央 `+`、大号页标题；这些正是 D5/D6/D9/D10 明确否掉的东西。**Agent 拿错这张图会做出与决策记录相反的结果。**

---

## 1. 当前阶段：不是从零重设计

- 批次一（`home` / `discover` / `notices` / `me` / `activity`）已提交于 `6e1faec`。
- 批次二 a（`weather-hub` / `weather`）与批次二 b（其余 14 页）已落到工作树，**未提交**。
- 21 页均已按 D1–D11 落地；剩余工作是**收口、补验、按需修剩余差分**。任何「重做 21 页」的方案都视为越界。

---

## 2. 必读顺序（读完再动手）

1. `AGENTS.md`：铁律 13/14/17/19/21/22/24，真机门槛 32–35。
2. `.agents/skills/ourtrail-ui/SKILL.md` 及 `references/{design-system,audit-verification,platform-pitfalls,ui-methodology}.md`。
3. `docs/ui-ux-redesign/style-b-decision-record-2026-10-26.md`：D1–D11 已锁定，**不许重问**。
4. 三份实现级设计（可执行规格）：
   - `style-b-implementation-design-batch1-2026-10-26.md`
   - `style-b-implementation-design-batch2a-2026-10-26.md`
   - `style-b-implementation-design-batch2b-2026-10-26.md`
5. `docs/ui-ux-redesign/refactor-methodology-2026-10-23.md` §1–§6：L0–L5、Gap Matrix、DoD。
6. 对应 evidence README：现状读数、before/after、UNVERIFIED 清单。

---

## 3. 硬边界

**只动 L2 组件与 L3 页面构图。**

- 不改 schema / `cloudfunctions/` / `domain` / `utils/journey.js` / 业务状态机。
- 不新增 token、不新增色值；新语义色只进 `app.wxss` 并登记 `design-system.md`。
- 不碰天气阈值、`--chart-ramp`、SVG 几何、天相判据。
- 保留 4 项 tabBar、21 条路由、全部业务流程与权限。
- 不改 4 个 tab 页的 `brand-header` 结构、不动 `custom-tab-bar/**`。
- 不 commit / push / deploy；不覆盖工作树里的未提交改动；不动用户未跟踪文件（`OurTrailNightBu.txt`、交付包 zip、`OurTrail全局UI重设计.txt`）。
- **一个文件只允许一个 Agent 改**；全局样式、`app.json`、文档、门禁由主会话独占，其余 Agent 只提发现。
- 先结构后像素；行为保持与行为变更分开提交，不混在一起。

---

## 4. 每个切片必须交的四样证据

1. **结构差分**：改前/改后的 section 顺序、组件树、关键几何读数（top/height/width/首屏下沿）。
2. **门禁读数**：`check.js` / `check-handlers.js` + 受影响套件，逐个记录脚本自己打印的 `passed=N failed=N`；**不编总数**。
3. **真机证据**：
   - 先证 bundle 新鲜（新文案/新结构出现在屏上，或 `bundleFresh` 探针）；
   - 注入/读取的是**生产形状全集**，先断言渲染门槛链（如 `denied=''`、`loading=false`、关键列表非空）；
   - 每例 `reLaunch` + 不同 `updatedAt` + 污染自证；375 与 390 都要读数；
   - 截图落 `docs/ui-ux-redesign/evidence/.../`，写清哪些是注入数据、哪些是真实数据。
4. **UNVERIFIED 清单**：用 denied 态冒充真实态、用 `page.data()` 冒充像素证据、用静态门全绿冒充视觉通过，均视为失败交付。

---

## 5. 当前工作树事实（2026-10-26 复核）

**生产代码 7 个文件（未提交）：**

| 文件 | 内容 |
|---|---|
| `miniprogram/app.json` | 导航统一 `#F5F5F0` + 黑字（F1） |
| `miniprogram/pages/weather-hub/*` | 批次二 a 天气入口重排 |
| `miniprogram/pages/weather/weather.{wxml,wxss}` | 批次二 a「条件 → 图 → 详解」 |
| `miniprogram/pages/routes/routes.wxml` | F2 路线库页头收敛 + 元信息合并 |
| `miniprogram/pages/route/route.wxml` | F3 元信息归位 |
| `miniprogram/pages/route-edit/route-edit.wxml` | F4 降 GPX 导入、删重复眉题 |
| `miniprogram/pages/workspace/workspace.{wxml,wxss}` | F5 四工具入口改白卡 |

另有 3 个门禁文件、3 份设计文档、2 个证据包与 `SYNC.md` / `AGENTS.md` 更新，均未提交。

**本文件撰写时重跑（2026-10-26）：**

- `node tools/check.js` → `ALL CHECKS PASSED`（G10：42 作用域 / 3136 token / 134 类名，命中 0）。
- `node tools/check-handlers.js` → 全部通过；死 handler 存量仍只有 `pages/editor/editor.js#onNumber`。

**套件与真机读数来自批次二 b 证据包，本文件未重跑：**

- `nav-chrome 15/0`、`personal-route-layout 60/0`、`operations-layout 39/0`、`page2-gates 117/0`、`entry-layout 41/0`、`header-layout 38/0`、`scenario-editor 227/0`、`scenario-activity 212/0`、`journey-graph 15/0`、`ui-consistency 19/0`、`t4-e08 41/0`、`m02-class-scope 66/0`、`swx1 45/0`、`swx2 110/0`、`b4-pad-final-value 33/0`。
- 真机 14/14 断言通过，390×844，驱动只读；证据 `docs/ui-ux-redesign/evidence/style-b-2b-2026-10-26/`。

**仍未闭合：**

- 提交边界未定：批次二 a/b 全在工作树，**先经用户审批再 checkpoint**，Agent 不得自行 commit。
- 375 宽度断点（现有读数全在 390）。
- 真实报名表单、`staff` 真实任务面板、`vehicle` 真实车辆/分车、`workspace` 三个 tab 展开态（当前账号不可达）。
- 原生 picker / 分享 / 相册 / 键盘弹起态。
- 4 个 custom 导航 tab 页的 `brand-header` 未逐页重拍。
- 地图底图瓦片（IDE 长期空白）、`cloud-field-poc`（DEV_ONLY）。
- `cloudfunctions/` 零改动 ⇒ 当前批次**不需要重新部署**；未来若动 L4 数据/云函数，单独裁决并计入部署。

---

## 6. 可直接粘贴的 Agent 任务书

```text
你是 OurTrail 的 UI 迁移执行 Agent。目标：在现有代码上完成 style-B 收口，不是重新设计。

先读（顺序不可跳）：
1. AGENTS.md（铁律 13/14/17/19/21/22/24 + 真机 32–35）
2. .agents/skills/ourtrail-ui/SKILL.md 与 references/{design-system,audit-verification,platform-pitfalls,ui-methodology}.md
3. docs/ui-ux-redesign/style-b-decision-record-2026-10-26.md（D1–D11 已锁定，不许重问）
4. 三份 implementation design（batch1 / 2a / 2b）
5. docs/ui-ux-redesign/refactor-methodology-2026-10-23.md §1–§6
6. 对应 evidence README（现状读数与 UNVERIFIED）

参考件：用户会话附的新板（5 段约 20 屏）。仓库里的
docs/ui-ux-redesign/reference/global-prototype-2026-10-20.jpg 是旧 style-A 板
（含 ¥680、收藏、中央 +），禁止作为本任务依据。

范围：只做 L2 组件与 L3 页面构图；不改 schema / cloudfunctions / domain /
utils/journey.js；不新增 token / 色值；不碰天气阈值与 --chart-ramp；
不动 4 项 tabBar、21 条路由、业务流程；不 commit / push / deploy；
不覆盖工作树里的未提交改动与用户未跟踪文件。

本轮切片：<在这里写唯一的切片，例如「收口批次二 b：只读复核 F1–F5 并补 375 宽度读数」>。

做法：
1. 先复述本切片要解决的问题、哪些既有设计是对的必须保留；
2. 产出 Gap Matrix：现状 file:line / 变更类 A token B 构图 C 新组件 D 数据 E 平台 /
   目标 / 风险 / 验收；若 B/C/D 全为 0，停手并说明这是 reskin；
3. 一个文件只允许一个 owner；先结构后像素；行为保持与行为变更分开；
4. 改完跑 check.js、check-handlers.js 与受影响套件，逐个记录脚本自打印的 passed/failed；
5. 真机：先证 bundle 新鲜，再用生产形状数据；每例 reLaunch + 不同 updatedAt +
   污染自证；375 与 390 都读数；
6. 交四样：结构差分、门禁读数、真机证据（路径 + 像素/DOM 读数）、UNVERIFIED 清单。

禁止：用 page.data() 读数冒充像素证据；用 denied 态冒充真实态；
把静态门全绿说成视觉通过；编造套件读数或总数；顺手改业务逻辑；
整页重写；新增第二套视觉语言。

停止条件：切片的结构差分、门禁、真机证据与缺口清单齐备；
或遇到需要产品裁决的点（新数据 / 新权限 / 新流程）→ 停，登记并交回，不自行决定。

输出：改动文件清单 + 每项证据路径 + 未闭合项 + 下一步建议。
```

---

## 7. 常见三种失败交付（提前拦住）

1. **只改配色/文案就叫重构**：Gap Matrix 里 B/C/D 为 0。对照 `refactor-methodology` §6 的 8 条检查。
2. **改结构但引入回归**：没有先复述「哪些设计是对的必须保留」，没有逐页状态矩阵，没有行为保持的 characterization tests。
3. **声称完成但没有像素证据**：静态门全绿、`data()` 读数正常，但真机没重编译或用了旧 bundle。按 `ourtrail-ui` §4 的三道门槛判失败。

---

## 8. 下一步建议

**A（推荐）：** 只读复核当前工作树 + 出「批次二 b 提交清单」，同批补 375 宽度读数；不动代码，先让用户审批提交边界。
**B：** 先补真实态证据（报名表单 / 车辆 / 协作任务），需要用户提供可达的活动、车辆与协作账号。
**C：** 先提交批次二 b，再谈补验；提交前必须完成 A 的清单。
