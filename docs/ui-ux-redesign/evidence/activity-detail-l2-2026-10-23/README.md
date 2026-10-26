# 活动详情 L2/L3 试点 · 证据索引（S1 + S2 + S3）

> 日期：2026-10-23 · 执行人：Qoder（实现 + 取证）
> 上游工件：[SPEC.md](../../activity-detail-l2-2026-10-23/SPEC.md) · [GAP.md](../../activity-detail-l2-2026-10-23/GAP.md) · [COMPONENTS.md](../../activity-detail-l2-2026-10-23/COMPONENTS.md) · [BASELINE.md](../../activity-detail-l2-2026-10-23/BASELINE.md)
> 本文件只记录**已经拍到的证据**与**没跑到的缺口**；设计目标不在这里复述。

## 前向更正（2026-10-23，跨页重构前复核）

以下更正优先于后文历史表述；保留原文以便追溯，不把旧批次结果当作后续改动的验收。

- **证据档误标**：依据 `audit-verification.md` §1，E2 是实现推断，真实 DOM/几何/渲染归 E3；E4 是不可证的观感建议，**不是用户验收**。后文所有“E2 运行时”“E4 用户验收”标签作废；用户是否验收单独记录为 NOT_RUN。
- **结论上限**：S1–S3 的合成渲染与已采几何读数成立于 390 CSS px；真实 tap、306 CSS px 与地图层叠尚未验证，不能由截图和数据门推出“交互通过”或完整视觉 DoD 达成。
- **源码核对**：弹层内 `form-actions` 实际为两处（当前 `activity.wxml:387/434`），不是三处；报名按钮经 `onSignup` 导航到报名页，不在 sheet；confirmed 命中 `canSelfSheet` 第三支，不是 meeting 第四支；`isOwnerReal` 源码使用 `indexOf('activity.edit') !== -1`，不是 `includes`。
- **旧版样式**：`git show HEAD:miniprogram/pages/activity/activity.wxml` 第 75 行为 `justPublished ? 'text' : 'primary'`，草稿原本是 primary；后文“draft 为 text”错误。
- **运行读数**：`readings/s3-run.json` 六个 `styleWaitMs` 为 44/53/34/52/55/28，即 **28–55 ms**；矩阵里的 13–65 属旧读数，不采用。
- **截图边界**：13 张文件存在及 PNG 签名/尺寸检查，不等于全部逐张目视；庆祝帧工作台入口的证据是 `justPublished-bottom-top.png` 与 `successCardWorkspace` DOM 读数，不能只引用 bottom 帧。overlay 几何及 z-index 只能证明覆盖关系，不能证明不会点击穿透；该交互保持 UNVERIFIED。
- **留白证据**：`b4-pad-final-value-test` 的 32/0 是静态套件结果，不能当活动页双态运行时留白证明；实际依据是 S3 各场景 `pageBox/lastContentBottom/reservedBottom`。
- **自定义导航**：保留原生导航是本轮设计取舍，不是已经证明“无法取证”或“实现不可行”。
- **复现范围**：下文 `tools/capture-*.js` 指本证据包的 tools 目录，命令应使用完整仓库相对路径。S3 的 `HEAD 无底栏` 只在读数记录的 `fixtureManifest.gitHead` 基线上成立，HEAD 移动后不能复用为永久新鲜度证明，也不得覆盖旧读数再沿用本报告。

---

## 0. 一句话结论

**S1（压图标题 / 浮卡 / 2×2 信息卡 / 路线四指标）**、**S2（章节节奏 / 行程合并 / 装备图标网格 / 费用语义）** 与 **S3（底部 sticky / 六状态矩阵 / 自定义导航裁决=不做）** 在 390 CSS px 模拟器视口下 **E3 通过**：同场景同视口，§4 与 §11.3/§12.3 的几何判据全部落区间，bundle 标记与污染自证均成立。**BASELINE §3.1 要求的 306×660 视口仍 NOT_RUN**（共享模拟器固定 390，已按 §8.7 显式声明），E4 用户验收 NOT_RUN ⇒ S1/S2/S3 视觉 DoD 记 **条件通过**，不是无条件交付。

| 档 | S1 结论 | S2 结论 | S3 结论 |
|---|---|---|---|
| E1 源码/静态门 | `check.js` / `check-handlers.js` exit 0；结构测试 31 条 | `check.js` / `check-handlers.js` exit 0；结构测试扩到 **65/0**，新增 `equipment-icons-test` **24/0**（§11.2） | `check.js` / `check-handlers.js` exit 0；结构测试 **83/0**（§12.2） |
| E2 运行时读数 | 5 个场景 VALID，几何读数落盘 | **2 个场景 VALID**（s2-rich + rich 污染对照），读数见 §11.3 | **6 个场景 VALID + 1 张弹层读数**，读数见 §12.3 |
| E3 模拟器像素 | 7 张正式截图 + 5 张基线截图，均 306×660 PNG | **6 张 s2-rich 截图 + 1 张污染对照顶部图**，均 306×660 PNG（magic 已验）；逐张四问见 §11.5 | **13 张 PNG**（6 屏 top+bottom + 1 张弹层），栅格 **500×1082**（同一 390×844 设备屏、模拟器缩放 1.282×）；底部 6 帧 + 弹层帧逐张四问见 §12.6 |
| E4 用户验收 | **NOT_RUN**（负责人未验收） | **NOT_RUN**（同上） | **NOT_RUN**（同上） |

> 仓库内没有任何像素比对工具。"更像设计图"只按**构图对应 + 几何读数 + 人眼**判断；全文不使用"像素级一致"。

---

## 1. 环境与可复现性

### 1.1 环境

见 [readings/environment.json](readings/environment.json)。

| 项 | 值 |
|---|---|
| 开发者工具 | 2.02.2609231 |
| 基础库 | 3.8.12 |
| AppID | wx1227a277a3f2f7ea |
| 模拟设备 | iPhone 12/13 (Pro)，iOS 10.0.1 |
| CSS 视口 | **390 × 753**，dpr 3 |
| 截图栅格 | 306 × 660（390×844 整屏等比缩放）；S3 为 500 × 1082（同屏 1.282×，见 §12.3） |
| 端口 | service 33278 / auto 9421 |
| 分支 / HEAD | `agent/ourtrail-style-a-20261023` / `e05e559` |
| 基线 | A1；A0 = master `46fd7c5` |

**视口声明（BASELINE §8.7）**：§3.1 要求 306×660 必须实测；本机共享模拟器为 390 CSS px，无法在不改动共享设备设置的情况下切换。所有两列/四列判据在 390 CSS px 下用 `element.offset()/size()` 实测，并在 306×660 栅格内目视复核；**306 CSS 视口本身 NOT_RUN**，不冒充通过。

### 1.2 基线与哈希账本

见 [readings/baseline-hashes.json](readings/baseline-hashes.json)（19 个文件，A0/A1/S1 三列 + HEAD blob）。

| 文件 | A0（master 46fd7c5） | A1（改前） | S1（改后，实测 `git hash-object`） |
|---|---|---|---|
| `miniprogram/app.wxss` | `6f9c705e` | `2dd8c868` | `2dd8c868` |
| `pages/activity/activity.js` | `e1a662ad` | `e1a662ad` | `27d154fa` |
| `pages/activity/activity.json` | `23d9f406` | `23d9f406` | `e8f21d75` |
| `pages/activity/activity.wxml` | `8430529a` | `8430529a` | `fd81e851` |
| `pages/activity/activity.wxss` | `d6fe243d` | `d6fe243d` | `5c1038a6` |

- 活动页四文件 **A1 = HEAD blob**，证明 style-A 未提交改动不碰活动页代码；S1 只改这 4 个文件 + 新增组件/派生函数（见 `git status`）。
- `app.wxss` A0≠A1 是既存 style-A 的全局改动，**不属于本轮**；S1 期间未再改（`2dd8c868` 前后一致）。
- 复核命令：`git hash-object <path>`，与 S1 列逐字相同。

### 1.3 夹具来源

- 生成：`tools/gen-activity-fixtures.js`（证据包内），直接调用真实 `miniprogram/pages/activity/activity.js#renderView`，`sourceSha256=f83a9563…`；清单见 [fixtures/manifest.json](fixtures/manifest.json) 与 [fixtures/baseline/manifest.json](fixtures/baseline/manifest.json)。
- 未手写页面 data；`coverFileId` 用本地实拍图代替 `cloud://` fileID（渲染路径等价，非线上数据形状），已在 manifest 注明。
- 四个场景标题互不相同（污染自证）：`青城后山 · 周末轻徒步` / `城区周边 · 傍晚散步` / 100+ 字长标题 / `青城后山 · 雨天备案`。
- **S2 追加 `s2-rich`**（标题 `青城后山 · 九月同行`）：节点带轨迹时间（`第1天 08:00` / `第1天 10:30` / 无时间信息）、必带 7 项 + 建议 3 项（四列必然换行 4+3）、费用三段齐全。生成到独立目录 [fixtures-s2/](fixtures-s2/manifest.json)，**不覆盖 S1 夹具**：`gen-activity-fixtures.js --out=…/fixtures-s2 --label=s2`。

---

## 2. 采集矩阵与门槛

驱动：[tools/capture-s1.js](tools/capture-s1.js)，`--side=a0|a1|s1`。

| 侧 | 场景 | 状态 | 门槛（loadingFalse / titleIntact / selectorFound / stylesReady） | styleWaitMs |
|---|---|---|---|---|
| A0 | rich | VALID | ✓ / ✓ / ✓ / —（基线无 gate4） | — |
| A1 | rich, sparse, long-title, cover-failed | 4/4 VALID | ✓ / ✓ / ✓ / — | — |
| S1 | rich | VALID | ✓ / ✓ / ✓ / ✓ | 46 |
| S1 | sparse | VALID | ✓ / ✓ / ✓ / ✓ | 25 |
| S1 | long-title | VALID | ✓ / ✓ / ✓ / ✓ | 29 |
| S1 | cover-failed | VALID | ✓ / ✓ / ✓ / ✓ | 24 |
| S1 | route（共享 `.hero-cover` 对照） | VALID | ✓ / ✓ / ✓ / ✓ | 17 |
| S2 | s2-rich（取证主场景） | VALID | ✓ / ✓ / ✓ / ✓ | 33 |
| S2 | rich（污染对照：无节点时间、装备 3+2） | VALID | ✓ / ✓ / ✓ / ✓ | 44 |
| S3 | participant / owner / draft / signup / confirmed / justPublished | **6/6 VALID** | ✓ / ✓ / stateMatch ✓ / ✓ | 13–65 |

- 门槛 1–3 来自 BASELINE §4.4；**gate4 `stylesReady` 是本轮新增**：首启曾有"DOM 就绪但 WXSS 未生效"的裸样式帧（见 [invalid/REASONS.md](invalid/REASONS.md)）。gate4 轮询媒体高 240±1（S1 追加信息卡宽 ≥300；S2 追加图标格 32×32），超时 12s 判 INVALID。
- 驱动：[tools/capture-s1.js](tools/capture-s1.js)（`--side`）、[tools/capture-s2.js](tools/capture-s2.js)、[tools/capture-s3.js](tools/capture-s3.js)。S2/S3 驱动**每个场景独立连接**：复用同一条 automator 连接时第二次 `reLaunch` 曾超时（已复现一次），失败场景会单独落 INVALID，不连坐整批。
- 读数：[readings/s1-run.json](readings/s1-run.json)、[readings/a1-run.json](readings/a1-run.json)、[readings/a0-run.json](readings/a0-run.json)、[readings/s2-run.json](readings/s2-run.json)、[readings/s3-run.json](readings/s3-run.json)；逐场景 [readings/s1-rich.json](readings/s1-rich.json)、[readings/s2-s2-rich.json](readings/s2-s2-rich.json)、[readings/s2-rich.json](readings/s2-rich.json)、[readings/s3-participant-bottom.json](readings/s3-participant-bottom.json) 等（`s2-`/`s3-` 前缀是批次，后半是场景名）。

---

## 3. bundle 新鲜度（BASELINE §7）

| 侧 | 场景 | 标记 | 读数 |
|---|---|---|---|
| A1 | rich/sparse/long-title | `#sec-facts` 存在、`.act-info` 不存在 | `secFactsPresent:true` / `infoCardGone:true` |
| A1 | cover-failed | 同上 + `img-failed` | `coverFailedClass:true` |
| S1 | rich/long-title/cover-failed | `.fact-grid.fact-grid--stats` 出现、`#sec-facts` 消失、`activity-hero` 可选中、浮卡存在 | 四项全 true |
| S1 | sparse | 同上，但 `factGridStats:false` | **按数据设计**：无里程/爬升/高程/结束时间 ⇒ 指标数组为空，不渲染空网格；其余三项 true |
| S1 | route | `activity-hero` 不泄漏到路线页 | `heroSelectable:true` / `actHeroScoped:true` |
| S3 | participant/owner/signup/confirmed（4 屏，加上 draft 共 5 屏有栏） | `.sticky-action` **恰好 1 个**且根类含 `has-sticky`；分享按钮存在 | `stickyBarPages:5` / `sharePages:4` |
| S3 | draft | 底栏在、**分享不在**（草稿不可转发） | `shareWidth:null` / `primaryWidth:350`（分享让位后主按钮铺满） |
| S3 | justPublished | 底栏与 `has-sticky` **同时消失**，成功卡里出现分享 | `celebrateStickyFree:true` / `successCardShare:true` |
| S3 | HEAD 对照 | **运行时** `git show HEAD:…activity.wxml` 实测无 `sticky-action` / `act-sticky` / `has-sticky` | `headHasNoSticky:true` |

结论：改前/改后两侧标记**成对成立**，不是旧包或半包。S3 的四个标记合起来给出 `bundleFresh:true`（[s3-run.json](readings/s3-run.json)），且 HEAD 的判定不是手写常量，是驱动在运行时读 `git show` 得到的。

---

## 4. 几何读数（BASELINE §6）

方法：miniprogram-automator `Element.offset()/size()`，均为**文档坐标**；未混用 `createSelectorQuery`。截图栅格 306×660 与 CSS 视口 390×753 的换算关系已在上文声明。

| 项 | A1 基线（rich） | S1 rich | S1 sparse | 判据 | 结果 |
|---|---|---|---|---|---|
| 页面顶留白 / hero 顶 | 24 | 24 | 24 | 24 | ✓ |
| hero 媒体高 | 240 | 240 | 240 | 240±1 | ✓ |
| 压图标题块 top − 媒体底 | 0 | **−72** | −72 | ≈−72±1 | ✓ |
| 浮卡 top − hero 底 | 无浮卡 | **−23.6**（long-title −24.22） | −23.6 | ≈−24±1 | ✓ |
| 信息卡宽 | 350（hero 内） | **350** | 350 | 390−2×20 | ✓ |
| 信息卡网格 | 3 指标条 | **2 行 × 2 格**，行内宽差 0/0，格宽 152 | 1 行 × 2 格，宽差 0 | 每行 2 格、宽差≤1、四宫格 2 行 | ✓（rich） |
| 路线四指标 | hero 内 3 项 | **2 行 × 2 格**，格宽 169，宽差 0 | 0 项（空网格不渲染） | 2×2；缺值不占格 | ✓ |
| 横向溢出 | 0 | **0**（maxRight 390） | 0 | ≤ +1px | ✓ |
| 主 / 次按钮高 | — | **70 / 70**，宽 126 / 212 | 70 / 70 | ≥48 / ≥44 | ✓ |
| 长标题 | hero 914、delta 0 | hero 725、body 557、delta −72 | — | 不截断、不溢出 | ✓（E3 目视 + 读数） |
| 封面失败 | — | 媒体 240 保留、森林底、标题可读 | — | 无破图 | ✓（E3） |
| route hero | 350×431、delta 0 | 350×431、delta 0 | — | 未被 S1 波及 | ✓ |

> 信息卡 4 项时两行；`sparse` 只有时间/人数 2 项，按 SPEC §6.2「1–4 项」单行是正确形态，不是网格塌陷。

---

## 5. 截图逐张四问（BASELINE §5.3）

所有截图 306×660 PNG，已验 `89 50 4E 47`。问 3 的"306"指栅格目视；几何以 390 CSS px 读数为准（见 §4 声明）。

### 5.1 S1 正式矩阵

**`s1/s1-rich-top.png`**
1. 主任务 1 秒可识别：状态徽标「行前安排已就绪」+ 日期 + 标题 + 信息卡首行时间，首屏直接回答"什么活动、何时"。
2. 层级 ≤3：标题（白字）/ 信息卡值（ink）/ 标签与脚注（muted）；hero 内徽标不与标题争权重。
3. 无截断、叠字、横向溢出；按钮内中文自然折两行，不是叠字；hero 白字压 scrim，可读。
4. 构图对应成立：压图 −72、浮卡 −23.6、信息卡 2×2；章节编号与图标网格属 S2，本图不含。

**`s1/s1-rich-info.png`**
1. 信息卡一屏回答时间/集合/人数/强度；报名者无需滚动到"说明"章节。
2. 值（16/22/600）> 标签（12 muted）> 副行；强度不再在 hero 重复出现。
3. 卡片完整，脚注两行落在纸面背景上，不与照片叠压；无溢出。
4. 浮卡压住 hero 下沿、脚注在卡后，与 SPEC §2.1 的叠压顺序一致。

**`s1/s1-rich-stats.png`**
1. 「05 路线与集合」标题下先给 12.5 km / 860 m / 900 m / 10 小时，再给地图与剖面。
2. 指标值（26px forest）> 单位（12 muted）> 标签/副行；四格同级，不与章节标题争。
3. 四位数与单位不溢出；2×2 可读；地图与剖面在 306 栅格内完整。
4. 对应设计图的"数据宫格 + 地图"；本轮地图瓦片可见，但底图内容正确性不属本轮判据（§1.2），既有 UNVERIFIED 不升级。

**`s1/s1-sparse-top.png`**
1. 极简活动仍能一眼回答时间与人数；状态 callout 给出"行前安排已就绪"。
2. 两级信息：标题 / 两格事实；无空指标格制造噪声。
3. 无溢出；脚注改为"氛围图"口径，两行仍落在纸面。
4. 浮卡形态保持；四宫格因数据只有 2 项而呈现 1 行——符合 SPEC §6.2，不是缺失。

**`s1/s1-long-title-top.png`**
1. 100+ 字标题完整可读，无省略号；路线名在标题下继续。
2. 标题块单列向下生长，徽标/日期固定在媒体盒顶，不与标题重叠。
3. 306 栅格内无横向溢出、无截断；hero 高度随内容增长（725）。
4. 压图构图在极值下仍成立；不承诺具体行数（模拟器字体与真机有差异）。

**`s1/s1-cover-failed-top.png`**
1. 无破图；标题、徽标、日期、信息卡完整，主任务仍可识别。
2. 与实拍封面同一构图层级，仅底色退回森林绿。
3. 媒体盒 240 高度保留，无布局跳动；文字对比度可读。
4. 构图对应不因封面失败而丢失。

**`s1/s1-route-top.png`（回归对照）**
1. 路线详情的唯一主任务（看路线、看剖面）不受影响。
2. hero 内 3 项指标条仍为次级；标题层级未变。
3. 350 宽卡片、20px 页边距保持，无溢出；`actHeroScoped:true` 证明 S1 的选择器未泄漏。
4. 路线页**没有**压图/浮卡——这是它未被本轮改动的证据，不是缺陷。

### 5.2 基线对照

**`baseline-A1/a1-rich-top.png`**：改前形态——hero 为卡片、标题在照片下沿以下（delta 0）、无浮卡、hero 内 3 指标条（里程/爬升/确认人数）、事实区「说明」仍在。四问中的第 4 问**不成立**，这正是 GAP 记录的构图差距。

**`baseline-A0/a0-rich-top.png`**：干净 master。与 A1 **目视无可辨布局/色彩差异**（仅系统时间戳不同：17:53 vs 17:51），说明活动页本身与 master 逐字相同，A1 的差异不在活动页代码。无像素比对工具，不作更强断言。

**`baseline-A1/a1-sparse-top.png`**
1. 主任务可识别：标题 + 状态说明 + 人数 `1 / 6` 都在首屏；但里程/爬升两格印「待补」占位，把"缺数据"与真实值摊在同一权重上。
2. 层级：标题 > 三指标条 > 操作区；两个占位格与真实读数同字号同色，视觉上分不出哪格有值。
3. 无截断、无叠字、无横向溢出；hero 卡片完整可见。
4. 构图对应**不成立**：标题在照片下沿以下（delta 0）、无浮卡、指标条在 hero 内 —— 即 GAP 记录的构图差距；「待补」占格也是 S1 有意删除的形态（§7）。

**`baseline-A1/a1-long-title-top.png`**
1. 主任务可识别但被推迟：首屏只到标题开头，完整标题、事实区与操作都要滚动。
2. 层级：长标题单列向下生长，不与徽标/日期重叠；hero 高度 914。
3. 无省略号、无横向溢出、无截断；但首屏不为长标题调整构图，内容整体下沉。
4. 构图对应**不成立**（标题未压图、无浮卡）。与 S1 同夹具对照：S1 hero 725、delta −72，长标题也被压进照片下沿。

**`baseline-A1/a1-cover-failed-top.png`**
1. 主任务可识别：无破图，标题、徽标、日期与三指标条完整。
2. 层级与实拍封面时相同，仅媒体退为森林绿底，文字权重未变。
3. 媒体盒高度保留、无布局跳动，无截断与溢出。
4. 构图对应**不成立**：同样缺少压图与浮卡 —— 说明极值场景下改前的构图层级与常态一致地落后于设计图，差距不是由封面失败造成的。

三张基线均与 S1 对应图同视口、同夹具，用于证明差异来自 S1 而非数据。

---

## 6. 设计图构图对应（P1）

| 设计图构图 | 实现 | 证据 |
|---|---|---|
| 全出血封面 | `.activity-hero-bleed { margin: 0 -20px }`（[activity.wxss:18-20](../../../../miniprogram/pages/activity/activity.wxss#L18)），不写 `100vw` | hero 390 宽 = 视口宽；无横向溢出 |
| 标题压进照片下沿 | `.act-hero.hero-cover .hero-cover-body { margin-top:-72px }`（[activity-hero.wxss:9-13](../../../../miniprogram/components/activity-hero/activity-hero.wxss#L9)） | 实测 delta −72 |
| 信息卡上浮 | `.act-info { margin-top:-24px }` + `.act-top` flex 列防外边距合并（[activity.wxss:11-25](../../../../miniprogram/pages/activity/activity.wxss#L11)） | 实测 −23.6 / −24.22 |
| 2×2 信息卡 | `fact-grid` flex + `calc(50% - 6px)`（[fact-grid.wxss:1-16](../../../../miniprogram/components/fact-grid/fact-grid.wxss#L1)） | 2 行 × 2 格，宽差 0 |
| 路线四指标 | 同上 stats 变体 + `order` 让读数在上（[fact-grid.wxss:57-79](../../../../miniprogram/components/fact-grid/fact-grid.wxss#L57)），数据由 [activity.js:447-491](../../../../miniprogram/pages/activity/activity.js#L447) 派生 | 2×2，169 宽，四值完整 |
| 封面诚实脚注（纸面） | 信息卡之后一次（[activity.wxml:45](../../../../miniprogram/pages/activity/activity.wxml#L45)），文案逐字保留 | 三态文案在 [activity.js:492-497](../../../../miniprogram/pages/activity/activity.js#L492) |
| 章节编号 / 装备图标网格 | 已实现：`chapter` 九章（八章编号、同行人不编号）、`equipment-grid` 四列图标格 | §11.3 / §11.5 |
| 底部固定报名栏 | 已实现：`.sticky-action.act-sticky` 单条底栏；分享为次操作，主操作按 `isOwner → canSubmit → canSelfSheet → meeting` 互斥出 **1 个** primary；draft 无分享、justPublished 无底栏 | §12.3 / §12.6 |
| 自定义导航 | **裁决 = 不做**（S3）：原生导航保留，`navigationStyle: custom` 需要状态栏安全区与胶囊避让的真机证据，本轮拿不到；结构门钉住两个 json 均无该键 | §12.1 · COMPONENTS §7.4 |
| 价格 / 收藏 / 「立即报名」固定文案 | **拒绝**（红线） | SPEC §9 |

---

## 7. 信息零丢失（DoD 6）

对照方法：`git show HEAD:activity.wxml` 与工作树 WXML 的可见文本清单逐条比对，再对每条"消失的字面量"定位到组件/JS；不靠记忆。

| 改前用户可见信息 | 改后位置 | 证据 |
|---|---|---|
| 状态徽标、日期 | hero 顶部 | activity-hero.wxml:8-13 |
| 标题、路线名、领队 | hero 标题块 | activity-hero.wxml:15-20；领队无值时不占行 |
| hero 内「里程 / 累计爬升 / 已确认人数」 | 里程/爬升 → 路线四指标；人数 → 信息卡 `2 / 20` | activity.js:441-455；readings/s1-rich.json |
| 事实区「活动时间 / 集合 / 人数 / 强度」 | 2×2 信息卡；事实区（`#sec-facts`）整体溶解 | activity.wxml:42-44；activity.js:428-446；markers `secFactsGone:true` |
| 事实区「领队」 | hero 的 `领队 · X` | activity-hero.wxml:17-20 |
| 事实区「费用」摘要 | 费用章节原样保留 | activity.wxml:340-351 |
| 照片诚实性脚注（3 种口径） | 信息卡之后、全页一次 | activity.wxml:45；activity.js:493-497 |
| 同行评分 | 从事实区搬出，原位保留、不编号 | activity.wxml:80-90 |
| 「待补」占位 | **有意删除**：缺值不再印占位，由信息卡/指标缺项各自省略 | activity.js:428-429 注释 |
| 「领队还没写介绍 · 自动整理」 | **有意删除**：自动摘要行（非用户数据），字段已被信息卡取代 | SPEC §2 第 5 行 |
| 分区锚点「说明」 | 随事实区溶解移除；其余锚点保留 | readings/s1-rich.json `data.secNo` |

结论：所有**用户数据**与三类诚实性文案仍可找到；删除的两处均为占位/自动摘要，不是用户填写的内容。改前 hero 的 3 个指标全部有去处，且新增最高海拔/预计用时为派生值（不写回 domain）。

---

## 8. 回归面

| 资产 | 检查 | 结果 |
|---|---|---|
| `.hero-cover*` 全局类 | 只允许在 `activity-hero` 组件内覆盖；拍 route 顶部 | route hero 350×431、delta 0、`actHeroScoped:true` |
| `route-profile.js` | `route-profile-test` | passed=37 failed=0 |
| `route-schedule.js` | `route-schedule-test` | passed=50 failed=0 |
| `journey.js` 词汇漂移 | `journey-graph-test` | passed=15 failed=0 |
| 活动页结构 | `scenario-activity-test` + `activity-l2-structure-test` | 189/0、**83/0**（S3 后复跑） |
| 组件平台规则 | `t4-e08-test` | 41/0 |
| 样式门 | `swx1-style-gates-test` | 45/0 |
| 静态门 | `check.js` / `check-handlers.js` | exit 0 / exit 0 |
| 已知常驻红 | `m02-class-scope-test` privacy `.section-title` | **65/1**，先于本轮存在（A0 干净基线 63/3，同一类）；不计入 S1 失败，也未修改该页 |

- 本轮**未改**云函数、schema、domain、状态机；**未部署**；**未写任何业务数据**（活动页只读投影）。
- **未 commit / 未 push**（用户未要求）。

---

## 9. 缺口登记（不许写成"通过"）

| 缺口 | 状态 | 升级条件 |
|---|---|---|
| 306×660 CSS 视口 | **NOT_RUN**（S1/S2/S3 均为 §8.7 声明；全部取证在 390 CSS px） | 在 306 CSS px 设备/模拟器上重跑 `capture-s1` / `capture-s2` / `capture-s3` |
| E4 用户验收 | **NOT_RUN**（S1–S3 均未验收） | 负责人看图并明确认可 |
| BASELINE §5.1 基线全矩阵（正文/底部 + draft/justPublished/participant/owner/busy/loading/denied） | **PARTIAL**：S2 拍正文五段；S3 拍**改后**六状态底部（含 busy 的弹层帧）；**改前** A1 的底部状态矩阵仍未拍 | 需要在 A1 基线上补拍 draft/justPublished/participant/owner 底部 |
| S1/S2/S3 真实 tap（主 CTA 后果、锚点滚动、弹层开关、分享拉起） | **NOT_RUN**（S3 的弹层打开用 `setData` 复现 busy 态，不是真实点击；分享面板未拉起） | 下一轮用真实 tap 走「主 CTA → 目标页」「自助签到 → 弹层 → 关闭」 |
| 地图底图内容正确性 | **UNVERIFIED 沿用**（本轮瓦片可见，但不在 §1.2 判据） | 真机/线上环境单独验证 |
| 地图与 sticky 的中途层叠（GAP G6） | **未单独取景**：固定栏按设计覆盖视口底部 107px，内容可继续上滚；S3 只拍了页尾帧，没拍"地图正落在栏后"的 mid-scroll 帧 | 补一张滚动到地图区的带栏截图，确认关键点不被栏永久遮挡 |
| 真实分享卡、原生相册、键盘焦点 | **UNVERIFIED 沿用** | 与发布流程那轮同一登记 |
| `m02` 的 1 条 privacy 红 | **先于本轮存在** | 另立任务，不混入 S1 |

---

## 10. S1 DoD 对照（BASELINE §10）

| # | 判据 | 状态 |
|---|---|---|
| 1 | `check.js` / `check-handlers.js` exit 0 | **PASS** |
| 2 | 相关套件全绿：scenario-activity / journey-graph / route-profile / route-schedule / activity-l2-structure | **PASS**（177/15/37/50/31，均 0 failed）；`equipment-icons` 属 S2，见 §11.2（24/0） |
| 3 | 截图矩阵齐备且逐张过四问 | **PASS**（S1 7 张 + 基线 5 张；见 §5） |
| 4 | 几何读数落 §4 判据 | **PASS @390 CSS px**；**306 视口 NOT_RUN** ⇒ 条件通过 |
| 5 | bundle 标记成立、改前/改后同场景同视口 | **PASS**（两侧均 390 CSS px） |
| 6 | 信息零丢失 | **PASS**（见 §7） |
| 7 | 缺口如实登记 | **PASS**（见 §9） |

**裁决建议**：S1 可进入下一轮（S2），但 306 视口的强约束尚未满足；若要求"无条件交付"，需先解决 306 视口取证的设备/会话问题（改动共享模拟器设置需负责人批准）。

---

## 11. S2 正文节奏（章节 / 行程 / 装备 / 费用）

### 11.1 本轮改了什么（结构，不是换色）

| 项 | 改前（A1） | 改后（S2） | 落点 |
|---|---|---|---|
| 章节节奏 | 各段自带间距，标题到正文没有统一节奏 | `<chapter>`：编号+栏目 / 标题 / 说明三行；章节间距 28px，标题→正文默认 12px（天气 8px） | [chapter.wxml](../../../../miniprogram/components/chapter/chapter.wxml) · [activity.wxml:110](../../../../miniprogram/pages/activity/activity.wxml#L110) |
| 行程 | 节点时间轴在「路线与集合」区，与"几天、几点"分开读 | 时间轴迁入「02 行程安排」，后接日程依据与组织者说明；路线区只留指标、地图、剖面、上车点 | [activity.wxml:165](../../../../miniprogram/pages/activity/activity.wxml#L165) · [activity.wxml:244](../../../../miniprogram/pages/activity/activity.wxml#L244) |
| 装备 | 文字清单 / 徽标列表 | 四列图标格：图标只是分类线索，**文字始终可见**；必带与建议分段 | [equipment-grid](../../../../miniprogram/components/equipment-grid/equipment-grid.wxml) · [equipment-icons.js](../../../../miniprogram/utils/equipment-icons.js) |
| 费用 | 摘要 + 说明 + 退出约定混排 | 摘要 / 费用包含 / 费用不含 / 说明 / 退出约定五段；"OurTrail 不收款，不处理支付或退款。"全页一次 | [activity.wxml:321](../../../../miniprogram/pages/activity/activity.wxml#L321) |
| 同行人 | 与章节同编号 | **不编号**（人与状态不是章节） | [activity.wxml:139](../../../../miniprogram/pages/activity/activity.wxml#L139) |

S2 未改 schema / 云函数 / domain / 状态机；未新增设计 token。页面 data 删除 `times`：时间锚点只由首屏信息卡的 time 格承载一次（§11.6）。

### 11.2 门禁与结构断言

| 套件 | 读数 | 说明 |
|---|---|---|
| `tools/check.js` | **ALL CHECKS PASSED** | 含平台门 G10/G11 |
| `tools/check-handlers.js` | **exit 0** | 死 handler 未增加（存量 1 条已登记） |
| `tools/scenario-activity-test.js` | **177/0** | 两条 `times` 断言改写为"信息卡 time 格 + `times === undefined`"，不是删断言 |
| `tools/activity-l2-structure-test.js` | **65/0** | 新增 §9–§12：chapter 契约、九章顺序、时间轴迁移、装备四列、费用文案逐字 |
| `tools/equipment-icons-test.js` | **24/0** | 12 类关键词、规则优先级、不误分类（水果/备用袜→背包）、规范化、图标 key 存在 |
| `t4-e08` / `swx1` / `swx2` / `page2` / `journey-graph` / `route-profile` / `route-schedule` / `ui-consistency` | 41/45/110/100/15/37/50/17，均 0 failed | 组件平台规则、样式门、页面图、路线与日程回归 |
| `m02-class-scope-test.js` | **65/1** | **先于本轮存在**：`privacy.wxml` 在 HEAD 已有 5 个 `section-title`（`git show HEAD:… \| grep -c` = 5），门仍写 4；该页本轮未改 |

### 11.3 几何与内容读数（s2-rich，390 CSS px）

驱动 [tools/capture-s2.js](tools/capture-s2.js)；读数 [readings/s2-s2-rich.json](readings/s2-s2-rich.json)。`Element.offset()/size()` 为文档坐标；尺寸读数按整数像素取整。

| 判据 | 实测 | 结果 |
|---|---|---|
| 章节数 / 编号 | 9 章；`01 活动简介 … 08 报名后` 共 8 个编号；同行人 kicker = `同行人` | ✓ |
| 章节间距 | `[28, 28, 28, 28, 28.16, 27.5, 28, 28]`（亚像素高度导致 ±0.5） | ✓ 28±1 |
| 标题→正文 | `[12,12,12,8,12,12,12,12,12]`；天气 8px 是设计值 | ✓ |
| 行程位置 | `.timeline` 在 `#sec-itinerary` 内 = true；在 `#meeting-block` 内 = false | ✓ |
| 节点日程 | 3 节点：`01 · 起点 / 第1天 08:00`、`02 · 途中节点 / 第1天 10:30`、`03 · 终点 / 空` | ✓ |
| 日程依据 | 逐字为「按轨迹记录的时间差与出发时刻推算抵达时间，日期已自动对齐。」 | ✓ |
| 装备分组 | 必带 7 项 → 行分布 `4+3`；建议 3 项 → `3`；两组列表宽 350 | ✓ |
| 装备列宽 | 每格 82（CSS 期望 `(350−3×8)/4 = 81.5`），行内宽差 0；图标格 32×32 | ✓ |
| 装备文字 | 10 项逐字与夹具一致（含「饮用水 2L」「急救包」「充电宝」），未被图标替换 | ✓ |
| 费用语义 | 护栏句出现 **1** 次；「费用包含」「费用不含」都在；feeNote 在 cancellationNote 之前 | ✓ |
| 横向溢出 | `maxRight = 390`，`overflowRight = 0` | ✓ |
| 污染自证 | 两场景 title 不同；日程 `["第1天 08:00","第1天 10:30",""]` vs `["","",""]`；装备行 `["4+3","3"]` vs `["3","2"]` | ✓ `distinct:true` |

> `rich` 场景只拍顶部图，作用是**污染对照**：证明第二次注入真的换了数据，而不是复用上一场景的缓存/组件实例。

### 11.4 bundle 新鲜度

| 标记 | 读数 |
|---|---|
| 九章与编号仅在 S2 新 WXML 中存在（A1 无 `<chapter>`） | `chapterCount = 9`，8 个数字 kicker |
| 时间轴在行程章节 | `timelineInItinerary = true` / `timelineInRoute = false` |
| 装备四列 32px 图标格仅在 S2 新组件中存在 | `equipmentLists = 2`，`rows = 4+3 / 3`，`tile = 32×32` |
| 页面仍由同一轮 renderView 装配 | 夹具 `sourceSha256` 记录在 [fixtures-s2/manifest.json](fixtures-s2/manifest.json) |

四个标记同时成立 ⇒ 截图来自新 bundle，不是旧包或半包。

### 11.5 截图逐张四问（BASELINE §5.3）

所有截图 306×660 PNG（magic 已验），滚动位置 = 目标锚点 − 80。

**`s2/s2-rich-top.png`**
1. 主任务 1 秒可识别：标题「青城后山 · 九月同行」+ 日期 + 浮卡首行时间；与 S1 同一构图。
2. 层级仍是标题 / 信息卡值 / 标签与脚注三级；S2 未在首屏新增竞争元素。
3. 无截断、叠字、横向溢出；浮卡与封面脚注顺序正确。
4. S1 构图保持，说明 S2 的正文改造没有回退首屏。

**`s2/s2-rich-itinerary.png`**
1. 「02 行程安排」一句话回答"这次怎么走"：三个节点、两个已知抵达时刻、一段日程依据。
2. 章节标题（20/600）> 节点名（600）> 时间与依据（small muted）；时间轴圆点只做顺序线索。
3. 三个节点不截断；`第1天 08:00` / `第1天 10:30` 与依据句完整；右侧「导航 / 天气」不挤压节点名。
4. 对应设计图的"行程时间轴"；路线区不再重复同一条时间轴（§11.3）。

**`s2/s2-rich-peers.png`**
1. 「同行人 / 我与同行人」在介绍之后、行程之前，编号缺位是**刻意**的：人与状态不是章节。
2. 章节标题高于人名，人名高于「搭乘车辆 · 集合点 · 座位」副行与状态徽标。
3. 三行资料与操作按钮不溢出；头像列与正文列对齐。
4. 对应设计图"同行人列表"，且不与 02/03 的编号体系混排。

**`s2/s2-rich-route.png`**
1. 「04 路线与集合」先给 12.5 km / 860 m / 900 m / 10 小时，再给地图与剖面。
2. 四指标同级、读数在上；地图与剖面降为证据层。
3. 2×2 指标不溢出；地图瓦片与腾讯地图 attribution 可见；剖面标题与图完整进入视口。
4. 对应设计图"数据宫格 + 地图 + 剖面"；**无时间轴**，证明迁移完成而非复制。

**`s2/s2-rich-equipment.png`**
1. 「06 装备 / 出发前，检查装备」一屏给出 7 项必带 + 3 项建议。
2. 图标（32px 浅底格）是分类线索，文字（13px ink）是主信息；两组标签「必带 / 建议」建立分段。
3. 四列 4+3 与三列 3 排布稳定；长词「饮用水 2L」不溢出、不被图标替换；无横向滚动。
4. 对应设计图"装备图标网格"；图标不承担语义唯一性（文字始终可见）。

**`s2/s2-rich-fee.png`**
1. 「07 费用与约定」按"摘要 → 包含 → 不含 → 说明 → 退出约定"读完即可判断费用边界。
2. 摘要是 lede，段标签是 field-label，条目是正文；护栏句以 small muted 收尾，不抢主信息。
3. 五段全部完整；「OurTrail 不收款，不处理支付或退款。」只出现一次；无溢出。
4. 对应 SPEC 的零金额红线：不出现价格、支付或退款入口，只陈述约定。

### 11.6 信息零丢失（S2 部分）

| 改前用户可见信息 | 改后位置 | 证据 |
|---|---|---|
| 页面 data `times`（出发/结束/截止三行） | 首屏信息卡 time 格：`10/3 08:00` + `至 10/3 18:00 · 截止 10/2 08:00` | `scenario-activity` 断言 `times === undefined` 且 infoFacts 值逐字匹配；`activity.js` 无 `times` |
| 起点/途中/终点与抵达时间 | 行程章节时间轴（原在路线区） | 读数三节点日程；`timelineInRoute=false` |
| 组织者说明 | 行程章节末尾 | `s2-rich-itinerary` 截图第二段 muted 文字 |
| 装备必带 / 建议原文 | 图标格文字，逐字保留 | `equipmentLists[].cells[].text` 10 项 |
| 费用摘要 / 包含 / 不含 / 说明 / 退出 | 费用章节五段 | `fee.text` 与夹具逐字比对 |
| 「OurTrail 不收款…」 | 费用章节末尾，全页一次 | `guardCount = 1` |

删除的只有 `times` 这个**重复呈现**（同一事实在信息卡已有一份）；没有删除用户填写的数据。

### 11.7 S2 DoD

| # | 判据 | 状态 |
|---|---|---|
| 1 | 结构门与相关套件全绿 | **PASS**（§11.2；`m02` 1 条先于本轮存在） |
| 2 | 真实 renderView 夹具 + 两场景污染自证 | **PASS**（`distinct:true`） |
| 3 | 章节节奏 / 行程迁移 / 装备四列 / 费用语义几何与内容读数落判据 | **PASS @390 CSS px** |
| 4 | 截图矩阵齐备且逐张过四问 | **PASS**（6 张，§11.5） |
| 5 | 信息零丢失 | **PASS**（§11.6） |
| 6 | 306 CSS 视口 | **NOT_RUN**（§9） |
| 7 | 真实 tap / E4 用户验收 | **NOT_RUN**（§9） |

**裁决建议**：S2 在 390 CSS px 下可进入 S3；306 视口与 E4 仍是挂账，不得写成"无条件通过"。

---

## 12. S3 底部操作（sticky CTA / 状态矩阵 / 自定义导航裁决）

### 12.1 本轮改了什么（结构，不是换色）

| 项 | 改前（A1） | 改后（S3） | 落点 |
|---|---|---|---|
| 主操作位置 | 正文顶部 `.form-actions`（HEAD `activity.wxml:73-90`），与正文一起滚走 | 页面末尾 `<view wx:if="{{showSticky}}" class="sticky-action act-sticky">`，fixed 贴底；顶部操作区整块退场（结构门断言 overlay 之前的正文里没有 `form-actions`） | [activity.wxml:352](../../../../miniprogram/pages/activity/activity.wxml#L352) |
| 底栏形态 | 全局 `.sticky-action` 允许 wrap，按钮各自 `flex:1` | `.act-sticky { flex-wrap: nowrap }` + `.sticky-action.act-sticky .button { min-width: 0 }` 压成一行；分享 `flex: 0 0 auto; width: auto` | [activity.wxss:162-168](../../../../miniprogram/pages/activity/activity.wxss#L162) |
| 状态矩阵 | 顶部同一套 `isOwner / canSubmit / canSelfSheet / meeting` 分支 | 原样下移：只有第一支是 `wx:if`，后三支 `wx:elif`；`showSticky = !(justPublished && isOwnerReal)`；`isOwnerReal` 由 `permittedActions.includes('activity.edit')` 判定 | [activity.js:342](../../../../miniprogram/pages/activity/activity.js#L342) · [activity.js:545](../../../../miniprogram/pages/activity/activity.js#L545) |
| 分享 | 顶部 `.button.text`，`open-type="share"` | 底栏 `.button.secondary.act-sticky__share`；`wx:if="{{!isDraft && !justPublished}}"`，草稿另由 `wx.hideShareMenu` 兜底 | activity.wxml:353 |
| 页尾留白 | 无底栏，`.page` 只留 32px | 根节点按 `showSticky` 条件挂 `.has-sticky`（120px），无底栏时不预留 | activity.wxml:1 |
| busy 禁用 | 顶部操作区随正文滚走，不涉及 | **底栏不做**：四支全是导航/打开弹层，写操作都在 sheet 内（sheet 自己有三层禁用）；写挂住时禁底栏只会制造「点了没反应」的死按钮。弹层打开时的安全由层叠负责（overlay z 200 > sticky z 50） | activity.wxml:347-351 |
| 弹层内操作 | 三处 `form-actions` 保留 | **原样保留**（签到/回程、编辑/取消），S3 不搬写命令 | activity.wxml:387 · :434 |
| 自定义导航 | 原生导航 | **裁决 = 不做**：`navigationStyle: custom` 需状态栏安全区与胶囊避让的真机证据，设计图的返回/分享叠封面不在本轮收益里。结构门钉住 `activity.json` 与 `app.json` 均无该键 | COMPONENTS §7.4 |
| 零丢失补丁 | justPublished 帧顶部仍有「进入工作台」（`.button.text`） | 顶部操作区移除后该入口会丢 ⇒ 成功卡内补 `.button.text.block`「进入工作台」，分享仍是唯一 primary | activity.wxml:22-27 · §12.4 |

S3 未改 schema / 云函数 / domain / 业务状态机；未新增设计 token。

### 12.2 门禁与结构断言

| 套件 | 读数 | 说明 |
|---|---|---|
| `tools/check.js` | **ALL CHECKS PASSED** | 含平台门 G10/G11 |
| `tools/check-handlers.js` | **exit 0** | 死 handler 未增加（存量 1 条已登记） |
| `tools/activity-l2-structure-test.js` | **83/0** | 新增 §13：根类开关、唯一底栏、顶部操作区退场、分享三条件、互斥链顺序、无写操作、`showSticky` 数据口径、单行样式、庆祝帧零丢失 |
| `tools/scenario-activity-test.js` | **189/0** | 页面数据与 journey 分支未回退 |
| `b4-pad-final-value-test.js` | **32/0** | 有底栏 120 / 无底栏 32 的**终值**分档 |
| `swx2-style-gates-test.js` | **110/0** | 样式门 |
| `t4-e08-test.js` / `e08-remaining-test.js` | **41/0** / **79/0** | 平台规则与剩余 E-08 规则 |
| `m02-class-scope-test.js` | **65/1** | **先于本轮存在**：`privacy.wxml` 的 `.section-title` 计数旧账（§11.2），非本页 |

### 12.3 几何与状态读数（390 CSS px，6/6 VALID）

驱动 [tools/capture-s3.js](tools/capture-s3.js)；读数 [readings/s3-run.json](readings/s3-run.json)。`Element.offset()/size()` 为文档坐标，读数为 CSS px；截图栅格声明见本节末条。

| 场景 | 注入状态 | 根类 / 栏数 | 主按钮（文案 / 宽） | 分享宽 | 底栏高 / docked | 预留 / 间隙 | 遮挡 |
|---|---|---|---|---|---|---|---|
| participant | 非 owner、非草稿 | `page has-sticky` / 1 | 查看集合与出行安排 / 250 | 88 | 107 / ✓ | 120 / 12.5 | notOccluded |
| owner | owner、非草稿 | `page has-sticky` / 1 | 进入工作台 / 250 | 88 | 107 / ✓ | 120 / 12.5 | notOccluded |
| draft | owner、草稿 | `page has-sticky` / 1 | 返回编辑与发布 / 350 | —（无） | 107 / ✓ | 120 / 12.5 | notOccluded |
| signup | 非 owner、可报名 | `page has-sticky` / 1 | 填写报名资料 / 250 | 88 | 107 / ✓ | 120 / 12.5 | notOccluded |
| confirmed | 非 owner、集合日 | `page has-sticky` / 1 | 我已到达 · 去签到 / 250 | 88 | 107 / ✓ | 120 / 12.5 | notOccluded |
| justPublished | owner、发布成功 | `page` / **0** | —（成功卡：分享给同行的人） | — | 无底栏 | 不预留 | — |

- 底栏高 107 = 12（上 padding）+ 48（按钮）+ 12 + 34（`env(safe-area-inset-bottom)`）+ 1（上边框）。
- **预留口径**：`reservedBottom = page.bottom − lastContentBottom = 120`，即 `.has-sticky` 的 120px；`gapAboveBar = sticky.top − lastContentBottom = 12.5` 是正文最后一行与栏顶之间剩余的可见间隙。两者不是同一个数，驱动分别断言。
- **弹层帧**（confirmed 注入 `sheetOpen` 复现 busy 态）：overlay `390×753` 铺满视口，`busyDisabledWriteButtons = 1`（写按钮已禁用），`stickyStillInDom = 1`（底栏仍在 DOM 但被完全覆盖）。
- **污染自证**：6 个场景标题互不相同；主操作文案 `["查看集合与出行安排","进入工作台","返回编辑与发布","填写报名资料","我已到达 · 去签到",""]` 互不相同；`stickyShown = 5`。
- **栅格声明**：本次 PNG 为 **500×1082**，是同一 390×844 设备屏被模拟器放大 1.282× 的结果（S1/S2 是 306×660 = 0.784×）。几何结论只取上表 CSS px 读数；栅格换算不参与判据。

### 12.4 抓到的缺陷与修法

1. **原生 `<button>` 默认 `width: 184px`**（真机/模拟器实测）。第一版只收 `flex` 不收 `width`，分享按钮仍占 184px ⇒ 390 屏主按钮只剩约 154px，「查看集合与出行安排」折成两行、底栏被撑高；分享按钮本身也只有 70px 高。修法是给分享显式 `width: auto`（[activity.wxss:168](../../../../miniprogram/pages/activity/activity.wxss#L168)），实测分享 **88**、主按钮 **250**、两者同高 **48**。驱动的 `stylesReady` 原来抄了过时阈值（底栏 60–90px、预留 ≥100px），已改为底栏 60–140、预留 120±2，与真实终值一致——**门槛写错会把正确终值判成红，也会把错误终值判成绿**。
2. **零丢失回归（本轮自己引入、本轮查出）**：`justPublished && isOwner` 帧既不显示底栏（`showSticky=false`），顶部 `.form-actions` 又已整块移除 ⇒ 改前那枚「进入工作台」凭空消失。已按 BASELINE §10.6 要求补回成功卡内（`.button.text.block`，次级权重），并由结构测试 §13 与驱动 `successCardWorkspace` 双钉住。这类"两个各自正确的改动合起来吃掉一个入口"的缺陷，单项断言看不出来，必须拿改前可见文本清单逐条对。
3. **`bundleFresh` 曾经是个空判据**：第一版写成 `valid.every(x => x.geometry.mode != null && x.dom != null)`，任何跑通的批次都为 true。现改为 4 个 S3 专属标记（§12.5），其中"HEAD 无底栏"由驱动运行时 `git show` 实测而非手写常量。

### 12.5 bundle 新鲜度

| 标记 | 读数 | 为什么能证明是新包 |
|---|---|---|
| `stickyBarPages` | **5** | 底栏是 S3 新增；旧包一屏都不会有 |
| `sharePages` | **4** | 分享进底栏是 S3 形态；draft 无分享是**按数据设计**的第 5 屏 |
| `celebrateStickyFree` | **true** | 庆祝帧底栏与 `has-sticky` 同时消失，只有新数据口径能做到 |
| `headHasNoSticky` | **true** | 运行 `git show HEAD:miniprogram/pages/activity/activity.wxml`，不含 `sticky-action / act-sticky / has-sticky` |

四项同时成立 ⇒ `bundleFresh:true`。若换回旧 bundle，`stickyBarPages` 会归零，批次直接判 INVALID。

### 12.6 截图逐张四问（BASELINE §5.3）

13 张 PNG：6 屏各 top+bottom，加 1 张弹层帧。全部为 500×1082、magic 已验。判据集中在底部，本节对 **6 张 bottom 帧 + 1 张弹层帧**逐张过四问；6 张 top 帧只用于确认首屏未被 S3 回退——其中 `justPublished-top`（成功卡新增一条次操作）已单独目视，其余 5 帧沿用 S1/S2 同构图结论并以几何/门槛读数（`titleIntact`、`stylesReady`）为准，不冒充逐张目视。问 3 的"单行"指 CSS px 读数与 500 栅格目视双重确认。

**`s3/participant-bottom-bottom.png`**
1. 非 owner 在页尾立刻看到唯一可做的事：「查看集合与出行安排」。
2. 层级 ≤3：整条 primary（白字/森林绿）/ 分享次按钮（描边）/ 正文；底栏内不出现第二个实心块。
3. 主按钮 250、分享 88，同一行、同高 48；文案一行读完不折行；正文最后一行停在栏顶上方 12.5px，未被盖住。
4. 对应设计图"底部固定操作条"；分享在左、主操作在右，与"次操作让位主操作"的构图一致。

**`s3/owner-bottom-bottom.png`**
1. owner 看到「进入工作台」——与会话角色一致，没有「填写报名资料」。
2. 分享次操作 + 工作台 primary；底栏之外没有竞争按钮。
3. 单行、无折行；底部安全区（home indicator）由 12 + 34px 内边距吃掉，按钮不被压住。
4. 同一条底栏因角色只换主按钮文案，形态不换——状态矩阵的视觉证据。

**`s3/draft-bottom-bottom.png`**
1. 草稿帧的唯一动作是「返回编辑与发布」，符合"草稿不能转发"的语义。
2. 分享缺席后主按钮铺满 **350**（= 390 − 2×20），仍是单 primary。
3. 单行、48 高；没有因少一个按钮造成左右不对称或空隙。
4. 同一底栏在"少一支分支"时的形态变化成立，不是隐藏按钮留坑。

**`s3/signup-bottom-bottom.png`**
1. 可报名状态给「填写报名资料」，这是参与者此时唯一的推进动作。
2. 分享次之；报名表单在 sheet 内，底栏不重复表单字段。
3. 单行、无折行、无溢出；正文可见部分完整。
4. 对应设计图的"主 CTA 固定在底"；未出现价格/支付（零金额红线）。

**`s3/confirmed-bottom-bottom.png`**
1. 集合日给「我已到达 · 去签到」，与 journey 的下一步一致。
2. 主按钮 > 分享 > 正文；签到是页面级唯一 primary。
3. 单行；「去签到」不会因按钮高 48 而被裁切。
4. 状态矩阵第四支成立：底栏只换文案与 handler，不换布局。

**`s3/justPublished-bottom-bottom.png`**
1. 页尾**没有**底栏；首屏成功卡是唯一主操作区，页面以「协作任务」收尾，没有悬空占位。
2. 成功卡内分享是唯一 primary；「进入工作台」是文字次操作，权重低于分享。
3. 无底栏 ⇒ 无 120px 留白；最后一行不被任何浮层遮挡。
4. 对应"发布成功后先发群"的判断；这条也是零丢失补丁的像素证据（§12.4-2）。

**`s3/confirmed-bottom-sheet.png`**
1. sheet 标题「<姓名> · 同行状态」+ 状态徽标，回答"我在改谁的状态"。
2. 弹层标题 > 表单字段 > 按钮；页面内容降到遮罩之下。
3. overlay 铺满 390×753；写按钮呈禁用态（`busyDisabledWriteButtons = 1`）；底栏被完全覆盖（`stickyStillInDom = 1`），不会穿透点击。
4. 底栏与弹层的层叠关系成立（z 200 > 50），无需在底栏上加 busy。

### 12.7 信息零丢失（S3 部分）

| 改前用户可见信息（HEAD） | 改后位置 | 证据 |
|---|---|---|
| 分享（`.button.text`，`open-type="share"`） | 底栏 `.button.secondary.act-sticky__share` | participant/owner/signup/confirmed 四屏 `shareWidth:88` |
| 「返回编辑与发布」/「进入工作台」（owner，draft 为 text） | 底栏 primary（draft：「返回编辑与发布」；常态：「进入工作台」） | `primaryText` 逐屏读数 |
| 「填写报名资料」 | 底栏 primary | signup 帧 |
| `{{selfButton}}` | 底栏 primary | 结构门断言 `{{selfButton}}` + `onSelfSheet` 仍在 |
| `{{nextActionLabel}}` | 底栏 primary | 结构门断言 `{{nextActionLabel}}` + `onNextAction` 仍在 |
| justPublished 帧的「进入工作台」 | 成功卡 `.button.text.block` | `successCardWorkspace:true` / 文案「进入工作台」 |
| 顶部 `.form-actions` 容器 | 底栏；**三处弹层内 `form-actions` 原样保留**（写命令不搬） | activity.wxml:387 · :434 |
| 底部 32px 默认留白 | 有底栏时 `.has-sticky` = 120px；无底栏时仍 32px | `b4-pad-final-value` 32/0、`reservedBottom:120` |

没有删除任何用户数据或入口；唯一"消失"的是顶部操作区这个**容器**，其五条分支逐条在底栏重建（外加庆祝帧的一条补回）。

### 12.8 S3 DoD

| # | 判据 | 状态 |
|---|---|---|
| 1 | `check.js` / `check-handlers.js` exit 0 | **PASS** |
| 2 | 相关套件全绿（structure / scenario / b4-pad / swx2 / t4-e08 / e08） | **PASS**（83/189/32/110/41/79；`m02` 1 条先于本轮） |
| 3 | 状态矩阵 6/6 VALID，几何落判据 | **PASS @390 CSS px** |
| 4 | 截图 13 张齐备，底部 7 帧逐张过四问；top 帧按几何/门槛读数确认未回退（仅 justPublished-top 单独目视） | **PASS**（§12.6） |
| 5 | 信息零丢失（含庆祝帧回归修复） | **PASS**（§12.7） |
| 6 | bundle 标记成立、HEAD 对照成立于运行时 | **PASS**（§12.5） |
| 7 | 306 CSS 视口 | **NOT_RUN**（§9） |
| 8 | 真实 tap（主 CTA 后果、分享面板、sheet 开关）与 E4 用户验收 | **NOT_RUN**（§9） |

**裁决建议**：S3 在 390 CSS px 下条件通过，S1→S2→S3 三段纵向切片形成完整证据链；306 视口、真实 tap、E4 仍是三项挂账，不得写成"无条件交付"。自定义导航的"不做"是**有记录的裁决**，不是遗漏。

---

## 13. 文件清单

```
activity-detail-l2-2026-10-23/
├── README.md                    ← 本文件
├── fixtures/                    ← S1 夹具（真实 renderView 产出）+ manifest
├── fixtures/baseline/           ← A1 夹具（活动页 HEAD 版 renderView）
├── fixtures-s2/                 ← S2 夹具（s2-rich + 污染对照 rich）+ manifest
├── fixtures-s3/                 ← S3 夹具（六状态：participant/owner/draft/signup/confirmed/justPublished）+ manifest
├── baseline-A0/a0-rich-top.png
├── baseline-A1/a1-{rich,sparse,long-title,cover-failed}-top.png
├── s1/s1-rich-top.png · s1-rich-info.png · s1-rich-stats.png
│   s1-sparse-top.png · s1-long-title-top.png · s1-cover-failed-top.png · s1-route-top.png
├── s2/s2-rich-top.png · s2-rich-{itinerary,peers,route,equipment,fee}.png · rich-top.png
├── s3/participant-bottom-{top,bottom}.png · owner-bottom-{top,bottom}.png
│   draft-bottom-{top,bottom}.png · signup-bottom-{top,bottom}.png
│   confirmed-bottom-{top,bottom,sheet}.png · justPublished-bottom-{top,bottom}.png
├── readings/environment.json · baseline-hashes.json · s2-environment.json
│   a0-run.json · a1-run.json · s1-run.json · a1-*.json · s1-*.json
│   s2-run.json · s2-s2-rich.json · s2-rich.json
│   s3-run.json · s3-participant-bottom.json · s3-owner-bottom.json
│   s3-draft-bottom.json · s3-signup-bottom.json · s3-confirmed-bottom.json
│   s3-justPublished-bottom.json
├── tools/gen-activity-fixtures.js · capture-s1.js · capture-s2.js · capture-s3.js
└── invalid/REASONS.md + 3 个首启裸样式帧
```

重建步骤（S1）：`node tools/gen-activity-fixtures.js`（默认输出 `fixtures/`，不要覆盖）
→ `close`/`open` 重编译 → `auto --auto-port 9421` → `node tools/capture-s1.js --side=s1 --ws=ws://127.0.0.1:9421`。

重建步骤（S2）：`node tools/gen-activity-fixtures.js --out=docs/ui-ux-redesign/evidence/activity-detail-l2-2026-10-23/fixtures-s2 --label=s2`
→ `close`/`open` 重编译 → `auto --auto-port 9421` → `node tools/capture-s2.js --ws=ws://127.0.0.1:9421`。
S2 驱动对每个场景独立 `connect`/`disconnect`（复用连接在第二次 `reLaunch` 上实测会 timeout）；
两场景的标题、日程标签、装备分组行数必须互不相同（污染自证），否则 `s2-run.json` 记 INVALID。

重建步骤（S3）：`node tools/gen-activity-fixtures.js --out=docs/ui-ux-redesign/evidence/activity-detail-l2-2026-10-23/fixtures-s3 --label=s3`
→ `close`/`open` 重编译 → `auto --auto-port 9421` → `node tools/capture-s3.js --ws=ws://127.0.0.1:9421`。
S3 驱动同样每场景独立连接；六场景的标题与主操作文案互不相同（污染自证），
`bundleMarkers` 四项（5 栏 / 4 分享 / 庆祝帧无栏 / HEAD 无底栏）必须同时成立，否则整批 INVALID。
自动化库不在仓库内：`NODE_PATH="$LOCALAPPDATA/Temp/opencode/mp-auto/node_modules" node tools/capture-s3.js …`。
