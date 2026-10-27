# 活动详情 L2/L3 试点 · 视觉基线与验证计划（BASELINE）

> 状态：工件 4/4，定稿待执行。
> 上游：[SPEC.md](SPEC.md)（设计规格）· [GAP.md](GAP.md)（差分矩阵）· [COMPONENTS.md](COMPONENTS.md)（组件契约）。
> 本文回答一件事：**改之前拍什么、改之后凭什么说"没坏且更像设计图"**。
> 它不描述"应该长什么样"（那是 SPEC），也不描述"改哪些"（那是 GAP）。任何与本文冲突的截图结论，以本文的证据规则为准。

---

## 1. 目的与边界

### 1.1 要证明的三件事

| # | 命题 | 最低证据 |
|---|---|---|
| P1 | 改造后**首屏构图**与设计图一致（压图标题、浮卡、四宫格） | 改前/改后同场景截图 + 几何读数 |
| P2 | 正文**章节节奏**统一，且没有丢信息、没有重复时间轴 | 章节清单 + 时间轴计数 + 文案对照 |
| P3 | 底部**唯一推进动作**在各状态下都正确出现/消失，且不遮挡内容 | 状态矩阵逐态截图 + 底部几何读数 |

### 1.2 不证明的事（避免把"没测"说成"通过"）

- **像素级差异**：仓库内没有任何像素比对工具，截图审查只有人眼 + 几何读数。不得使用"像素级一致"这类措辞。
- **地图瓦片**：开发者工具模拟器底图常为空白（Wave 1 已登记 UNVERIFIED），本轮沿用该结论，不重复诊断。
- **画布内部**：路线剖面是 SVG 字符串（`route-profile.js`），其内容由 `route-profile-test` 负责；截图只证明**位置与可读性**，不证明曲线数值。
- **真实分享卡、原生相册、真实键盘焦点**：与发布流程那轮一致，保持 UNVERIFIED。
- **用户验收**：只有负责人明确说"可以"才记 E4；本轮默认不出现 E4 结论。

### 1.3 证据档定义（沿用 `.agents/skills/ourtrail-ui/references/audit-verification.md`）

| 档 | 含义 | 本轮典型来源 |
|---|---|---|
| E1 | 源码文本可直接核实 | `git diff`、`grep`、WXML 结构 |
| E2 | 运行时读数（非像素） | `page.data()`、`element.offset()/size()`、`getSystemInfoSync` |
| E3 | 模拟器/真机像素 | 开发者工具截图（PNG 已验magic） |
| E4 | 负责人验收 | 仅在被明确告知时记录 |

**INCONCLUSIVE 永远不是 PASS。** 通道不可用、门槛不成立、bundle 未证新鲜，一律记 INCONCLUSIVE 或 INVALID，并在报告里写明缺哪一项才能升级。

---

## 2. 两条基线：A0 与 A1

### 2.1 定义

| 代号 | 内容 | 可复现性 | 用途 |
|---|---|---|---|
| **A0** | 干净 `master` = `46fd7c5`（`git archive` 导出到仓库外） | 完全可复现 | 长期参照；证明"活动页与 master 逐字相同" |
| **A1** | 当前工作树 = `e05e559` + 27 个未提交的 style-A 改动 | 只在本机此刻可复现 | **本轮默认的"改前"视觉基线** |

### 2.2 为什么默认 A1

当前工作树带着 style-A 的全局样式改动（`app.wxss`、tab 页、卡片等），用户每天看到的就是这一版。拿 A0 当"改前"会混入 style-A 的差异，**无法把试点改动归因清楚**。

已核实：`git diff master -- miniprogram/pages/activity` 为空 ⇒ **活动页本身的代码与 master 逐字相同**。因此：

- A0 与 A1 在活动详情页上的差异，只可能来自全局 token / 全局类；
- 本轮 S1–S3 对活动页的改动，与 style-A 的文件集**零重叠**；
- 交付时必须同时给出 A0 与 A1 的顶部截图各一张，用来说明"差异来自 style-A，不是试点"。

### 2.3 A1 的可复现性缺口与补法

A1 不可从 git 重建（style-A 未提交）。所以：

1. 执行前把以下文件的 `git hash-object` 写入 `readings/baseline-hashes.json`：
   `miniprogram/app.wxss`、`pages/activity/activity.{js,json,wxml,wxss}`、`pages/route/*`、`pages/routes/*`、`utils/route-profile.js`、`components/icon/icon.*`。
2. 每个切片完成后，比对这份清单：**不在清单里的文件被改动 ⇒ 归因失败**，先解释再继续。
3. 回滚不依赖 git commit：按清单里的 hash 从 A0 副本或 `git show` 恢复（style-A 文件除外，那些不属于本轮）。

> 本轮不 commit / 不 push / 不部署，是否入库由负责人单独决定。

### 2.4 共享资产风险（必须在报告里单列）

`.hero-cover` 是全局类，`route` / `routes` / `signup` 等页也在用。S1 只允许**在 `activity-hero` 组件内**覆盖（`apply-shared` + 组件作用域），不得改 `app.wxss` 的 `.hero-cover*`。验证时额外拍一张路线详情页顶部，作为"未被波及"的对照证据。若确需全局改动，必须先停下来说明理由并另行批准。

---

## 3. 环境与工装

### 3.1 环境记录（每次执行都必须落盘）

`readings/environment.json`：

```json
{
  "date": "<实际执行日期>",
  "devtoolsVersion": "<开发者工具 About 里的版本号>",
  "libVersion": "3.8.12",
  "appid": "wx1227a277a3f2f7ea",
  "windowWidth": 306,
  "windowHeight": 660,
  "pixelRatio": "<getSystemInfoSync 实测>",
  "branch": "agent/ourtrail-style-a-20261023",
  "head": "e05e559",
  "master": "46fd7c5",
  "baseline": "A1"
}
```

- **306×660 为必测视口**（沿用本仓库既有证据包口径）。390×844 只在真的跑了才写；没跑就写"未运行"。
- 视口宽度是硬约束：所有"两列/四列"判据都在 306 下判，宽屏好看不算通过。
- 设备像素比必须实测：`page.setData` 注入前先读 `wx.getSystemInfoSync()`，不要照抄模板。

### 3.2 工具链（每轮固定动作）

```bash
# 1) 重编译（必须；只调 auto 不会重新编译）
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" close --project 'D:\OurTrail' --port 33278
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" open  --project 'D:\OurTrail' --port 33278
sleep 25

# 2) 打开自动化通道（端口被占则换 9422，并记录实际端口）
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto --project 'D:\OurTrail' \
  --auto-port 9421 --trust-project --port 33278

# 3) 驱动库装在仓库外（本仓库零 npm 依赖是铁律）
cd "$LOCALAPPDATA/Temp/opencode/mp-auto"
```

硬规矩：

- **禁止 `cli quit`**（共享会话，用户已明确）。通道僵死时按 ENV-ABORT 记录并请示，不擅自重开 IDE。
- 路径必须加单引号，否则 Git Bash 会把 `D:\OurTrail` 吃成 `D:OurTrail`，开发者工具会注册一个错误项目。
- `mp.screenshot()` 返回 **base64 字符串**，必须 `Buffer.from(String(raw), 'base64')`；写盘后**验 PNG magic**（`89 50 4E 47`），否则视为无效。
- 注入数据后若页面还有异步 `reload` 在飞，会覆盖注入内容 ⇒ 见 §4.4 哨兵。

### 3.3 证据目录

```
docs/ui-ux-redesign/evidence/activity-detail-l2-2026-10-23/
├── README.md                  # 索引 + 结论汇总 + 缺口
├── baseline-A0/               # 干净 master 顶部对照（至少 activity-top.png）
├── baseline-A1/               # 改前全量矩阵
├── s1/  s2/  s3/              # 各切片改后矩阵
├── readings/                  # environment.json / baseline-hashes.json / <run>.json
├── tools/                     # 生成夹具与驱动的脚本（可重建，不放一次性手写数据）
└── invalid/                   # 作废截图 + REASONS.md（写清作废原因）
```

- 截图命名：`<side>-<scenario>-<section>.png`，如 `s1-rich-info.png`、`baseline-A1-sparse-bottom.png`。
- **无效截图必须移入 `invalid/`**，不许留在正式目录里靠文件名暗示。

---

## 4. 夹具：从真实 `renderView` 生成，禁止手抄页面逻辑

### 4.1 为什么不能手写

手写一份"看起来像"的 data，测的是夹具作者对页面的理解，不是页面本身。本仓库已有一条铁律（不再镜像页面逻辑）：把构造逻辑抽成模块或直接调用真实函数。

### 4.2 生成路径（三层，按可用性降级）

1. **首选**：复用 `tools/scenario-activity-test.js` 的 `global.wx` 桩 + `global.Page` 捕获 + `delete require.cache`，喂入该套件已有的视图夹具，调用**真实的 `renderView()`**，把 `this.data` 序列化为 JSON。
2. **覆盖不足时**：用 `cloudfunctions/trailApi/domain` 的命令 + `selectors.activityView` 从真实状态派生视图（`tools/lifecycle-harness.js` 的形态），再走同一条 `renderView()`。
3. **禁止**：直接手写页面 data 字面量；也禁止在驱动脚本里重算 `secNo`、`factGrid` 等派生字段。

> 生成脚本落在 `tools/gen-activity-fixtures.js`（证据包内），每个场景输出 `<scenario>.json` 与一份 `manifest.json`（含 `fixtureNow`、生成时的 git HEAD/hash）。

### 4.3 场景矩阵

| 场景 | 目的 | 关键构造 |
|---|---|---|
| `rich` | 主视觉基准 | 有封面实拍、完整时间/地点、路线四指标齐全、装备与费用齐全、多名同行者 |
| `sparse` | 空态与短内容 | 无封面、无路线里程/爬升、无装备、无费用说明、无同行者 |
| `draft` | 草稿态 | `isDraft` 分支：隐藏通知/任务入口，底部动作不同 |
| `long-title` | 压图标题极值 | 标题 ≥ 100 字符（中文），路线名较长 |
| `cover-failed` | 封面失败 | `coverFailed=true` 走氛围兜底，验证压暗层与文字对比度 |
| `justPublished` | 发布后 | `justPublished=true`，验证 sticky 不出现 |
| `participant` | 参与者视角 | `permittedActions` 不含编辑；确认态；底部为本人动作 |
| `owner` | 组织者视角 | 有编辑/管理动作；验证按钮不超预算（SPEC §6） |
| `busy` | 写入中 | `busy=true`；写操作禁用、分享仍可点（SPEC §6.1） |
| `loading` | 加载中 | `loading=true`（只验状态面板，不验构图） |
| `denied` | 拒绝态 | `denied` 非空（只验状态面板 + 出路） |

场景数据必须**同源可比**：`rich` 之外只改必要字段，避免"改了三处还以为是布局导致"。

### 4.4 注入与三道门槛（缺一即 INVALID）

```js
const page = await mp.reLaunch('/pages/activity/activity?id=' + id)
await page.waitFor(1500)                 // 等真实 reload 落地
const before = await page.data()
// 门槛 1：页面已停止加载（不要求成功，denied 也算落地）
if (before.loading !== false) → INVALID
await page.setData(fixture)              // 真实 renderView 产出的 data
await page.waitFor(600)
// 门槛 2：哨兵未被异步 reload 覆盖
if ((await page.data()).title !== fixture.title) → INVALID（迟到的 reload 覆盖了注入）
// 门槛 3：目标元素真的在 DOM 里
if (!(await page.$(selector))) → INVALID（不是"没渲染好"，是数据/分支不对）
```

补充：

- **每场景前 `reLaunch`**，避免上一场景的实例属性（`_unified`、缓存、滚动位置）残留。
- **每场景标题不同**（并在 `manifest.json` 记录），用于污染自证：相邻两场景的 `page.data().title` 必须不同，相同即整批作废。
- 注入的 `data` 是**生产形状**：分支字段（`denied/loading/busy/justPublished`）一个都不能省，否则测的是半套页面。
- `fixtureNow` 固定为生成时的时刻，保证「今天/明天/截止」文案稳定；执行日期与 `fixtureNow` 都写进读数。

---

## 5. 截图矩阵

### 5.1 基线（A1，必拍）

| 场景 | 顶部 | 正文 | 底部 |
|---|---|---|---|
| rich | ✓ | 行程 / 路线 / 装备 / 费用 | ✓ |
| sparse | ✓ | 空态各一节 | ✓ |
| long-title | ✓ | — | — |
| cover-failed | ✓ | — | — |
| draft | ✓ | — | ✓ |
| justPublished | — | — | ✓ |
| participant / owner / busy | — | — | ✓（各一张） |
| loading / denied | ✓ | — | — |

A0 只拍 `rich` 顶部一张，作为 §2.2 的归因对照。

### 5.2 每个切片的改后矩阵

| 切片 | 必须新增的截图 | 必须同时拍的对照 |
|---|---|---|
| S1 | `rich-top`（首屏整屏）、`rich-info`（浮卡与四宫格）、`sparse-top`、`long-title-top`、`cover-failed-top` | `route-top`（共享 `.hero-cover` 未被波及） |
| S2 | `rich-itinerary`、`rich-route`、`rich-equipment`、`rich-fee`、`sparse-*`（对应空态） | 同一滚动锚点的改前图（A1） |
| S3 | `participant-bottom`、`owner-bottom`、`draft-bottom`、`signup-bottom`、`confirmed-bottom`、`justPublished-bottom`（每屏 top + bottom；confirmed 另拍 `-sheet`） | 最后一节内容底边（证明不被 sticky 遮挡）；`justPublished` 与 `participant` 同数据形状成对（有/无底栏） |

> 与初版矩阵的差异（登记理由，不是删项）：`busy-bottom` 并入 `confirmed-bottom-sheet.png`——底栏四支全是导航动作，busy 只存在于写操作弹层内，因此「busy 时底栏的表现」正确定义是「弹层盖住底栏且写按钮禁用」，用同一帧同时取证。`signup-bottom`（未报名）补上状态矩阵里唯一会走 `canSubmit` 的一支。

滚动一律用 `mp.pageScrollTo({ selector: '#sec-xxx', duration: 0 })`，**不用固定像素偏移**；滚动后重新取一次元素句柄（旧句柄可能失效）。

### 5.3 人眼审查要回答的四个问题

对每张正式截图逐张回答（写在 `README.md`）：

1. 主任务是否在 1 秒内可识别（本页＝了解活动 + 报名/管理）？
2. 层级是否 ≤3 级（标题 / 信息 / 辅助）？有没有互相同权重的竞争元素？
3. 306px 下有没有截断、叠字、横向溢出、对比度不足？
4. 与设计图的构图对应关系是否成立（压图、浮卡、四宫格、章节编号、图标网格）？

答不出或没有截图，就写 UNVERIFIED，不写"通过"。

---

## 6. 几何读数（E2，逐张截图同批采集）

`readings/<side>-<scenario>.json`，最少包含：

| 项 | 取法 | 判据 |
|---|---|---|
| 视口 | `getSystemInfoSync` | 宽 306；记录高与 dpr |
| 文档宽 | `page.$eval` / `wx.createSelectorQuery` | ≤ 视口宽 + 1px（无横向溢出） |
| hero 媒体高 | 元素 `size().height` | 基线 240±1；改后除非 SPEC 变更否则不变 |
| 压图标题块 | 标题块 `offset().top` − 媒体底 | S1 后 ≈ −72px（允许 ±1） |
| 浮卡 | 卡片 `offset().top` − hero 底 | S1 后 ≈ −24px（允许 ±1；注意 `.act-top` 必须无 gap） |
| 四宫格 | 每格 `offset()`/`size()` | 每行 2 格；同列宽差 ≤1px；共 2 行；无换行错位 |
| 章节标题 | 所有 `.chapter` 的 `offset().top` | 单调递增；编号 01..08 唯一且连续（按 SPEC 映射） |
| 时间轴 | 时间轴容器计数 | 全页恰好 1 处（S2 合并后） |
| 装备网格 | 每项宽 | 4 列；宽 = (内容宽 − 3×间隙)/4 ±1；文字不溢出 `overflow-wrap` |
| sticky | 容器 `offset().top` + `size().height` | 底边贴视口底（文档坐标下 `top = page.height − bar.height`）；高 = 12 + 主按钮 + (12 + safe-area) + 1；390×753 实测 **107**（安全区 34） |
| sticky 遮挡 | 页面最后一个可见内容块底边 | ≤ sticky 顶边；`.page.has-sticky` 的 120px 判「内容底 → **页底**」（实测 120），不是「内容底 → 底栏顶」（那只是 120 − 栏高 = 12.5） |
| sticky 宽度分配 | share 与 primary 的 `size().width` | share 收回内容宽（实测 88）且 < primary（实测 250）；主按钮文案不折行（高度 48，不是 70） |
| 触达 | 主按钮高 / 次按钮高 | ≥48 / ≥44 |

读数方法必须写清是 `element.offset()`（文档坐标）还是 `createSelectorQuery`（相对视口）；**两种不能混着比**。

---

## 7. bundle 新鲜度：每切片一条自证标记

> 静态门通过 ≠ 页面正常；截图看不出旧包。**每条标记必须是新代码独有、且屏幕上能读到。**

| 侧 | 标记 | 判据 |
|---|---|---|
| baseline-A1 | `#sec-facts` 存在；浮卡不存在 | 旧结构证据 |
| S1 | `.fact-grid.fact-grid--stats` 出现；`#sec-facts` 消失；`activity-hero` 标签可选中 | 三者同时成立才拍 |
| S2 | 章节编号 `01…08` 连续出现；`.eq-grid` 出现；时间轴只在行程区出现 | 任一缺失即视为旧包/半包 |
| S3 | `rich` 有 `.sticky-action`；`justPublished` 与其同数据下**没有** | 成对出现才算证明 |

标记不成立时：先 `close`+`open` 重编译，再拍；仍不成立就记 INVALID 并停止该切片结论，不允许用"可能是缓存"糊过去。

---

## 8. 无效条件（命中任一条，整批截图作废）

1. 三道门槛任一不成立（§4.4）。
2. 相邻场景读到的标题相同（污染自证失败）。
3. 截图不是 PNG（magic 校验失败）或尺寸与视口不符。
4. bundle 标记与当前切片不符（旧包/半包）。
5. 滚动目标选择器不存在，或截图内容与声明的 section 不符。
6. 读数混用坐标系，或使用了未记录的方法。
7. 视口不是 306×660 且未在报告里声明。

作废的图移入 `invalid/`，`REASONS.md` 写：日期、场景、命中的条件、重拍方式。**不许删除**（保留可复核性）。

---

## 9. 回归面（本轮可能波及的其它页）

| 资产 | 风险 | 检查 |
|---|---|---|
| `.hero-cover*` 全局类 | 若误改全局，路线详情/路线库/报名页全变 | 只允许组件内覆盖；拍 `route` 顶部对照 |
| `route-profile.js` | 新增 `elevationRange` 若动了 `buildProfile` 的取样 | `route-profile-test` 全绿 + 剖面截图对照 |
| `route-schedule.js` | 新增 `durationBetween` | `route-schedule-test` 全绿；活动详情时长显示与改前一致 |
| `icon` 组件 | 新增 12 个 path key | `equipment-icons-test` + 路线/导航图标目视未变 |
| `format.js` | 本轮不新增标签，防止 `journey-graph` 词汇漂移 | `journey-graph-test` 全绿 |
| 共享数据 | 活动页只读投影，不写数据 | 全程不触发写命令；分享不写 |

---

## 10. 每切片的通过判据（DoD）

一个切片只有在下列**全部**成立时才算完成：

1. `node tools/check.js` 与 `node tools/check-handlers.js` exit 0。
2. 相关套件全绿：`scenario-activity`、`journey-graph`、`route-profile`、`route-schedule`、`equipment-icons`（新）、`activity-l2-structure`（新）。
3. 截图矩阵齐备，且每张都过 §5.3 四问。
4. 几何读数落在 §6 判据内。
5. bundle 标记成立，**改前/改后同场景同视口**。
6. 信息零丢失：改前的每一条用户可见信息在改后仍可找到（文案可移位，不可消失）；此项用 WXML 文本清单对照，不靠记忆。
7. 缺口如实登记：未跑项写 NOT_RUN，通道问题写 INCONCLUSIVE，不写成"通过"。

**任一条不成立 ⇒ 该切片不交付**，只交现状 + 阻塞原因。

---

## 11. 执行顺序

```
0. 采集环境 + baseline-hashes → baseline-A0 / baseline-A1 截图与读数
1. S1（首屏：压图标题 / 浮卡 / 四宫格）→ 静态门 → 真机矩阵 → DoD
2. S2（章节节奏 / 行程合并 / 装备图标 / 费用语义）→ 同上
3. S3（底部 sticky / 状态矩阵 / 自定义导航结论=不做）→ 同上
4. 汇总 README：结论 + 缺口 + 未验证项 + 建议的下一步（S4 需产品决策）
```

每个切片单独落盘、单独验收；**不允许三个切片攒完再一起看**——那样出问题时无法定位是哪一层。

---

## 12. 已知风险与取舍

| 风险 | 影响 | 处理 |
|---|---|---|
| A1 工作树不可从 git 复现 | 改前证据无法在别的机器重建 | 记录 `git hash-object`；A0 作为可复现参照 |
| 无像素比对工具 | "更接近设计图"只能人眼判 | 加几何读数做客观锚点；结论标 E2/E3 |
| 模拟器字体与真机有差异 | 长标题换行位置可能不同 | 长标题场景取极值（≥100 字）证明不截断；不承诺具体行数 |
| 地图/分享能力受限 | 相关区块只能证位置 | 沿用既有 UNVERIFIED 登记 |
| `order` 属性在 stats 变体里换视觉序 | 极端 WebView 可能不支持 | 真机读数确认数值在标签之上；不成立则改双模板分支（不改语义） |
| 全局类覆盖依赖 `apply-shared` 同名选择器行为 | 组件内覆盖可能不生效 | 真机确认（如 `.hero-cover.img-failed` 失效则加本地局部规则并登记为平台例外） |
| 共享开发者工具会话 | 误操作影响他人 | 禁 `quit`；`close --project` + `open` 前确认无他人任务 |

---

## 13. 本轮不做

- 不 commit / 不 push / 不部署 `trailApi`。
- 不清理共享云端测试数据。
- 不覆盖用户未跟踪文件（`OurTrailNightBu.txt`、`OurTrail_UI_重构交付包_V1.zip`、`OurTrail_UI_交付包/`、`OurTrail全局UI重设计.txt`）。
- 不引入 schema/云函数/domain/状态机改动。
- 不做 S4（章节重排需单独产品决策）。
