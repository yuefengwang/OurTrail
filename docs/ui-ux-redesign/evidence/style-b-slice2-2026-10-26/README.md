# Style B · Slice 2（活动详情首屏纸面板）证据

日期：2026-10-26 · 基线 `6e1faec` · 分支 `agent/ourtrail-style-a-20261023`
规格：`docs/ui-ux-redesign/style-b-shared-layer-spec-2026-10-26.md` §3.3 / §5.2
结论上限：**结构 + 静态门 + 页面套件**（真机 **NOT_RUN**，见 §6）

---

## 1. 结构块验收（G0 §3.3 逐块）

| 块 | 目标 | 实现 | 读数 |
|---|---|---|---|
| [0] 原生导航 | 不启用自定义导航（C20） | 未动 `activity.json` | `activity-l2 §13`：`navigationStyle === undefined` |
| [1] 全出血 hero | 媒体 320 + scrim + badge/日期 + 标题 30 + 路线/领队 | Slice 0 已把媒体改 320（`activity-hero.wxss:9-11`）；本轮未动组件 | `activity-l2 §8` 属性键集不变 |
| [2] `.sheet-top` | `margin-top -20`；事实格 + 状态卡同处一块纸面 | `activity.wxml:33-61`：`hero-bleed` → `<view class="sheet-top act-sheet">`（事实格 `:50`、封面说明 `:51`、状态卡 `:52-59`） | 全局负边距/上圆角只有一份（`app.wxss:149-155`），页面只补内部 `gap:12` 与 `padding-bottom:20`（`activity.wxss:24-29`） |
| [3] 吸顶锚点 | `segmented.tabs-line` 外观、非真 tab（D6） | 未动（`activity.wxml:82-92`） | `page2-gates` 吸顶条读数不变 |
| [4] `.stack-sections` | 40；9 个 chapter，顺序固定 | 未动；只把注释里的 28px 更正为 40（`activity.wxml:94`） | `activity-l2 §10`：9 章 + 顺序 + 新增「反了必红」牙齿 |
| [5] `sticky-action` | 报名/审核 + 分享；`has-sticky` 120 底留白 | 未动（`activity.wxml:355-372`） | `activity-l2 §13` 13 条全绿 |

- C21（不做节点实拍图）与 C14（装备四列格）本轮零改动；天气章节的卡序留给 Slice 4。
- 事实格不再包 `.card`：旧写法是「纸面上的浮起卡」，板 02-1 是「纸面里的一行事实」，本轮去掉 `class="card act-info"` 与 `margin-top:-24px`，改为在纸面板内直接排布（不形成卡中卡）。

## 2. 改动面（两个文件）

| 文件 | 改动 |
|---|---|
| `miniprogram/pages/activity/activity.wxml` | 首屏 `act-top` 内新增 `.sheet-top.act-sheet` 容器，把 fact-grid / photo-note / state callout 收进去；`:94` 注释 28px→40px |
| `miniprogram/pages/activity/activity.wxss` | 删除 `.act-info`（浮起卡），新增 `.act-sheet`（`flex column` / `gap 12` / `padding-bottom 20`）；`.act-photo-note` 去掉 `margin-top`（间距交给 gap）；首屏注释同步 |

零新增 token / 零新色值 / 零新全局类（`.sheet-top` 为 Slice 0 已登记）；`activity.js` 未改，`infoFacts` / `stateTone` / `photoNote` 的数据口径一字未动。

## 3. 门禁读数（逐套实跑）

| 套件 | 读数 | 退出码 |
|---|---|---|
| `tools/check.js` | ALL CHECKS PASSED（G10：作用域单元 42 / token 3144 / app.wxss 类名 135 / 命中 0；G11 双写 0） | 0 |
| `tools/check-handlers.js` | 死 handler 仍只有存量 `editor#onNumber` | 0 |
| `tools/activity-l2-structure-test.js` | **89 / 0**（83→89，+6） | 0 |
| `tools/scenario-activity-test.js` | 212 / 0 | 0 |
| `tools/page2-gates-test.js` | 117 / 0 | 0 |
| `tools/t4-e08-test.js` | 41 / 0 | 0 |
| `tools/m02-class-scope-test.js` | 66 / 0 | 0 |
| `tools/swx1-style-gates-test.js` | 45 / 0 | 0 |
| `tools/swx2-style-gates-test.js` | 110 / 0 | 0 |
| `tools/b4-pad-final-value-test.js` | 33 / 0 | 0 |
| `tools/ui-consistency-test.js` | 19 / 0 | 0 |
| `tools/journey-graph-test.js` | 15 / 0 | 0 |
| `tools/entry-layout-test.js` | 41 / 0 | 0 |

**未跑全量 sweep，不编总数。**

## 4. 有意重钉（§5.2 允许项）与牙齿

`activity-l2-structure-test.js` 是 §5.2 表里点名可重钉的那一套；只换了首屏外层容器，章节顺序与 9 个 chapter 一条未动。

| 原断言 | 现断言 | 为什么不是放宽 |
|---|---|---|
| 顺序 `act-top < hero < 信息卡 < 封面说明 < callout` | 顺序 `act-top < hero < 纸面板 < 事实格 < 封面说明 < callout` | 元素更多、位置更具体 |
| `infoFacts` 非空才出现 `.card.act-info` | `infoFacts` 非空才出现 `<fact-grid … variant="card" />` | 同一条空壳判据换到新载体 |
| 页面含 `.act-info { margin-top:-24px }` | 页面含 `.act-sheet { gap:12; padding-bottom:20 }`，且**页面不得再写** `-20/-24` 负边距 | 负边距单源：只许全局 `.sheet-top` 给 |
| （无） | **容器归属**：按 `<view>` 深度找 `.sheet-top` 自己的闭合位置，事实格/说明/状态卡必须都在块内 | 只比前后顺序时，同级兄弟也能满足；这条挡的是「拆出去也能绿」 |
| （无） | **不形成卡中卡**：纸面板块内不得出现 `class="card` | 钉住本轮的设计意图（板 02-1 事实行不是卡） |
| （无） | **页首两块信息不掺评分**：纸面板在同行评分之前收口 | 防止评分重新挤进首屏 |
| 章节顺序（只查 9 个关键词的存在与前后） | 同一判据抽成 `judgeOrder(text)`，并对「对调末两章」的合成串要求**判红** | 常驻牙齿：顺序反了必红，而不是恒真的存在性检查 |

**变异自证（改生产文件，还原后 sha256 一致）**：把 `<fact-grid>` 移出 `.sheet-top`（锚点命中各恰 1 次）⇒ `activity-l2` exit 1，红 2 条（顺序 + 容器归属），`passed=87 failed=2`；`cp` 还原后 `sha256sum -c` OK，复跑 `89/0`。

## 5. 布局风险与算术

- **纸面板叠压 20px 不会切到 hero 正文**：hero body `margin-top:-72px; padding-bottom:28px`（`activity-hero.wxss:15-19`），28 > 20 ⇒ 标题与路线/领队整块在叠压线之上，底部留 8px 呼吸。
- **`.act-top` 必须保持 flex column**：`.sheet-top` 的负上边距若与父容器发生外边距合并，会把封面一起顶进上方「发布成功」卡；已有常驻断言。
- **纸面板下沿**：全局 `.sheet-top` 的 `padding-bottom:0`，状态卡是最后一项 ⇒ 页面补 20px，否则卡底贴边。

## 6. 真机 NOT_RUN

共享开发者工具会话本轮未接管、未重编译，因此**不宣称首屏已保真**。升到 VERIFIED 至少需要：

1. `close --project` + `open` 重编译（不 `cli quit`），bundle 新鲜度由新结构自证（纸面板上圆角压在照片上）。
2. 生产形状载荷：`infoFacts.length > 0`、`photoNote` 非空、`stateTone` 三档各一帧，且 `showSticky=true`。
3. 读数：纸面板 `top` 与 hero 底边的关系（应 -20px 叠压）、状态卡底边与评分块间距、吸顶条在滚动后是否遮住面板下沿、390 与 375 两宽。

## 7. UNVERIFIED

- 纸面板与封面的实际叠压观感（算术成立 ≠ 像素成立）。
- 封面顶部亮天空下的白字对比度（沿用 Slice 1 登记项，本轮未动 hero）。
- 状态卡在纸面底色上的层级是否够（`callout` 自带底；未取像素）。
- 375 宽度下的两列事实格换行与同行评分行。
- 原生导航栏高度对吸顶条落点的影响（未重测）。
