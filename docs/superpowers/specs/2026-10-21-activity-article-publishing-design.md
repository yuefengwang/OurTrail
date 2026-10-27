# 活动发布页对齐公众号图文（封面 + 图集 + 图文混排）

- 日期：2026-10-21
- 分支：`win/global-prototype-wave1-3`
- 状态：**P0–P3 已实施；门禁与真机证据见 `docs/ui-ux-redesign/evidence/activity-article-p2p3-2026-10-21/README.md`；未提交**
- 参考：用户提供的公众号活动文截图（726×14082，按 9 段裁读）
- 证据口径：本文的现状判断均来自当前工作树；行号会漂，定位以函数名/文件路径为准。

---

## 0. 结论

### 0.1 参考文不是一个表单，是 8 个板块

| # | 参考文板块 | 当前实现 | 差距 |
|---|---|---|---|
| 1 | 标题「日期｜目的地：卖点」 | `Activity.title`，编辑器限 100 字 | 可承载，不新增字段 |
| 2 | 实拍头图 + 多组图片穿插正文 | 活动模型无图片字段；封面是按活动 id 派生的场景氛围图（`utils/covers.js`），详情页脚注自陈「非本次活动实拍」 | **最大缺口** |
| 3 | 开篇环境、场景、路线长文 | `description` 2000 字，详情页单段 `lede` | 能写，但没有分段/小标题/图文混排 |
| 4 | 推荐理由（4 条要点） | 无 | 缺结构化字段 |
| 5 | 活动说明（时间/集合/人数/领队/费用/指数） | 时间、集合已有；人数只有上限；领队是自由文本；强度用 `difficulty` | 缺成行人数、领队一行、风景/腐败指数、费用分档 |
| 6 | 费用包含 / 不含 / 保险 | 只有一段 `feeNote` | 缺结构；**保险承诺禁止照搬**（见 §2） |
| 7 | 报名方式（加微信/拉群） | 原生报名、名额、审核 | 我们更强；只补「报名后须知」文字，不搬二维码 |
| 8 | 活动人数 15–30 | `capacity` 只有上限 | 缺成行人数（只展示，不引入新状态机） |

### 0.2 本期选择

用户已选 **C 档：封面 + 图集 + 图文混排（最像公众号）**。本设计按 C 档落地，但保留一条硬边界：**正文内容不是发布必填**，快速创建（标题/时间/集合点即可发布）不被破坏。

### 0.3 开工前置（必须先处理）

当前工作树共有 **32 条未提交改动**（`git status --short` 实测，含本设计稿；其余为 `profile-gate`、home 双列表去重、编辑器/报名页改动等）。本设计基于当前工作树；**开工前需要先落一个基线提交，或由用户点名哪些改动不要动**，否则本功能会和这些改动交叉。

另外两条顺序约束：

1. **先部署服务端，再发客户端**：新客户端会把 `content/coverFileId/...` 发给服务端；旧服务端是 strict schema，会以 `INVALID_INPUT` 拒绝。
2. **先验证云存储读权限与图片安全检查权限**（§8.4、§8.5），再决定是否进入 P2；这两项是外部控制台配置，代码证明不了。

---

## 1. 目标与非目标

### 1.1 目标

发起人能在小程序内完成一篇「公众号式」活动文的最小闭环：

- 选封面、传多图、在段落之间插图；
- 写推荐理由、活动说明、费用包含/不含、报名后须知；
- 发布后，群友通过分享卡片进入活动页，看到图文正文、活动说明与费用，并直接报名；
- 旧活动（无新字段）的数据完整、封面脚注正确，不出现空的新版块。

### 1.2 非目标

- 不做支付/收款/退款；费用只作说明（延续 `feeNote` 的既有定位）。
- 不做保险承诺；不复制参考文的「提供一份安全保障」。
- 不做富文本 HTML 编辑器、不做公众号文章导入、不做评论/点赞/收藏。
- 不做视频；不做图片裁剪/滤镜；不做拖拽排序（用上移/下移）。
- 不改路线库资产的图片能力；图片只属于活动。
- 不做定时孤儿文件回收（见 §11）。

---

## 2. 产品边界（不可协商）

1. **零金额、纯工具**：费用字段只展示，不出现「支付/下单/退款」按钮。现有 `feeNote` 旁已写明「线下结算；不收款」，新字段沿用这句话。
2. **禁止救援/保险承诺**（根 `AGENTS.md` 反模式 12）：不新增 `insurance` 字段；组织者可在 `signupNote`/`feeNote` 里写「请自行购买保险」这类事实性提示，但产品不能替任何人承诺保障。
3. **图片是组织者提供的 UGC**：详情页必须有一行来源说明。封面用派生氛围图时，保留今天的「非本次活动实拍」脚注；封面是实拍时，改成「封面与正文图片由组织者提供」。
4. **公开发现是既有事实**：`discover` 对任何已登录用户可见（`selectors.js` 的 `kind:'discover'` 只过滤 draft/cancelled/archived/已出发），活动图片一旦发布就是公开可见内容，因此**图片安全检查是本期的一部分，不是可选项**（§8.5）。

---

## 3. 数据模型

### 3.1 新增字段（全部 `specOpt`，旧数据零迁移）

| 字段 | 类型/上限 | 用途 | 备注 |
|---|---|---|---|
| `content` | 块数组，≤30 块；每块 text ≤2000 字或 images 1–9 张 | 图文正文（段落/图片组交替） | 新字段；空数组合法 |
| `coverFileId` | string ≤1000 | 封面（必须是 `content` 里出现过的一张图） | 为空则客户端用正文第一张图，再退回派生氛围图 |
| `highlights` | string[]，≤8 条，每条 ≤200 字 | 推荐理由 | 编辑器按「一行一条」录入 |
| `leader` | string ≤100 | 领队/发起团队一行 | 活动说明 fact card 用 |
| `minParticipants` | int 1–500，可选 | 成行人数 | 只展示，不触发自动取消；必须 ≤ `capacity` |
| `sceneryRating` | int 1–5，可选 | 风景指数 | 详情页星级 |
| `funRating` | int 1–5，可选 | 腐败指数 | 详情页星级 |
| `feeSummary` | string ≤200 | 费用一行摘要（如「住木屋 498/人；露营 398/人」） | 与 `feeNote` 分工：摘要 vs 详细说明 |
| `feeIncludes` | string[]，≤12 条，每条 ≤200 字 | 费用包含 | 一行一条 |
| `feeExcludes` | string[]，≤12 条，每条 ≤200 字 | 费用不含 | 一行一条 |
| `signupNote` | text ≤2000 | 报名后须知/拉群说明 | 放在活动说明与报名动作附近 |

**复用现有字段**：`title`、`description`（一句话简介/导语）、`organizerIntro`、`startAt/endAt/deadlineAt`、`pickupPoints`、`capacity`、`approvalMode`、`acceptingSignups`、`difficulty`（强度，3 档）、`equipment`、`equipmentSuggested`、`feeNote`、`cancellationNote`、`routeSnapshot`。

**投影字段与存储字段同名**：`activityView` / `discoverView` 返回的 `coverFileId` 是**解析后的有效封面**（显式封面 → 正文第一张 → 空串），不是原始显式字段；客户端拿到后不再自己遍历正文块。

### 3.2 正文块契约

```js
ContentBlock =
  | { type: 'text',   text: string }                 // 一个块可含多段，渲染时按空行拆段
  | { type: 'images', fileIds: string[] }            // 1–9 张，按选择顺序
```

规则（服务端 `validateInput` 校验，客户端也做同样的清洗）：

- 空文本块、空图片块一律拒绝；编辑器在提交前丢弃空块。
- `coverFileId` 必须存在于某个 `images` 块的 `fileIds` 里；否则 `INVALID_INPUT`。
- 总图片数 ≤20（跨所有块）；总文本 ≤20,000 字（`content` 文本 + `description` + `organizerIntro` + `signupNote` + `feeNote` + `cancellationNote` + 其他短文本），防止单文档膨胀拖慢 `loadState`。
- `minParticipants` 若存在必须 ≤ `capacity`；评分必须是 1–5 整数。
- 客户端表单块带一个**只存在于编辑器**的 `id`（稳定 key，防 textarea 失焦）；`buildInput()` 提交前剥掉，服务端 strict schema 不接受该键。

### 3.3 兼容性

- `ActivityInput` 由 `Activity` 的键派生（`schema.js`），新增字段自动进入输入契约；旧客户端不传这些键仍然合法。
- `activity.edit` 是 `Object.assign(activity, input)`：旧客户端编辑不会清空新字段；新编辑器提交空数组/空串表示用户主动清空。
- `activity.copy` 深拷贝整条活动，图片 fileID 按引用复制；引用计数（§8.6）保证不会误删另一场活动仍在用的图。
- `activity.publish` 深拷贝整条活动，新字段自动带上。
- 阶段锁（`domain/activity.js` 的 `activity.edit` 三组）不把新字段放进 `lockedKeys`：图文、亮点、费用明细、报名须知属于「信息性文本」，集合中/行程中仍可补；标题/时间/名额/审核方式仍锁死。阶段锁的拒绝文案要补上「图文内容、亮点、费用明细、报名须知」。

---

## 4. 正文内容模型：为什么选内容块

| 方案 | 微信文章还原度 | 移动端编辑成本 | 实现/测试风险 | 结论 |
|---|---|---|---|---|
| A. 固定图集 + 分段长文 | ~65%：图全堆在一处，不能段落间插图 | 最低 | 低 | 备选降级 |
| **B. 内容块（段落 / 图片组）** | **~90%：段落与图片组交替，接近参考文** | 中：块列表 + 上移/下移 | 中：需要处理 textarea 焦点与草稿 | **推荐** |
| C. 富文本 `<editor>` + `rich-text` | ~95% | 高：移动端富文本键盘/选区体验差 | 高：HTML 黑盒、清洗、测试无法覆盖 | 不做 |

**选 B**，理由：

- 参考文的主体是「一段文字 + 一组图」交替；块模型正是这个结构，不需要 HTML。
- 每个块都是可校验的数据（`type` + 文本/文件 id），可以进 smoke/scenario 测试；`rich-text` 的 HTML 无法用现有门禁验证。
- 图片仍然是「组」而不是单张，符合参考文 2–3 张并排的排版。

**降级条件**：P0 用一次性最小原型（或编辑器分支上先搭块列表骨架）试写 10 段 + 10 图；如果块列表在手机上明显难用（焦点丢失、滚动跳动、上传等待过长），退回 A（固定图集 + 分段长文），不硬上 B。这个判断点在 P0 结束时做，不拖到 P2 后期。

---

## 5. 发布页（editor）改造

### 5.1 步骤：3 步 → 4 步

| 步骤 | 内容 | 变化 |
|---|---|---|
| 01 内容与时间 | 标题、出发/结束/截止、`description` 一句话简介、`organizerIntro` | 保留，`description` 的 hint 改成「一两句话，卡片和搜索会用」 |
| **02 图文详情（新）** | 封面、正文块、推荐理由 | 新增 |
| 03 路线与集合 | 路线、节点、上车点、里程/爬升/难度 | 原步骤 2，序号后移 |
| 04 招募与费用 | 人数上限/成行人数、审核方式、开放报名、领队、风景/腐败指数、风险、装备、费用摘要/包含/不含/说明、取消约定、报名后须知 | 原步骤 3 扩展，序号后移 |

`stepLabels` 变化会影响 `tools/e2e-golden-path-test.js` 与 `tools/scenario-editor-test.js` 里按步骤序号点击的用例；这些用例必须同批更新，不能只改页面。

### 5.2 图文详情步骤的编辑形态

- **封面**：从已上传图片里选；没有选时显示「默认用第一张」。不单独上传封面，避免同一张图存两份。
- **正文块列表**：纵向排列的卡片；每块右上角「上移 / 下移 / 删除」。
  - 文本块：一个 `textarea`，支持空行分段；不限制用户输入中的换行。
  - 图片块：缩略图网格（1–9 张），每张右上角「设为封面 / 删除」，底部「添加图片」。
  - 列表底部两个按钮：「添加段落」「添加图片」。
- **推荐理由**：一行一条的 `textarea`（沿用装备清单的 `text.lines()` 读法），提交时拆成 `highlights`。
- **上传状态**：块内显示「正在上传 2/5」；有上传未完成时保存/发布按钮禁用并说明原因。
- **空状态**：没有正文时显示「可以先发布，图文详情后补」，不把空编辑器画成错误。

### 5.3 关键实现约束

1. **textarea 不能整数组 `setData`**：编辑某个文本块时只更新路径 `form.content[i].text`，否则每次输入都重绘整个块列表，光标会跳/键盘会收。块的新增、删除、移动才整数组更新。
2. **每个块有稳定 `id`**：`wx:key="id"`；`toForm` 生成，`buildInput` 剥掉。没有稳定 key 时，上移/下移会让 textarea 内容错位。
3. **草稿**：沿用 `draft.setDraft(this.draftKey(), 'activity-editor', this.buildInput())`；块输入、增删图、设封面后都要触发同一套防抖保存。旧草稿没有新字段时按空数组/空串读，不打断发布链。
4. **发布门不变**：标题、三个时间、至少一个完整上车点；图文、亮点、费用明细、报名须知都可空。发布确认层可以提示「未添加图文详情，发布后仍可补」，但不阻断。
5. **错误定位**：服务端返回 `INVALID_INPUT` 时，按字段跳到对应步骤（封面/正文 → 第 2 步；人数/费用 → 第 4 步），不能只弹一句笼统错误。
6. **上传中禁止离页**：`onUnload` 不取消已发出的上传（微信没有可靠的取消回调）；至少在上传完成后把 fileID 写回草稿，减少孤儿文件。真正的孤儿回收见 §11。
7. **不新增色值/token**：新增样式只进页面/组件的局部 WXSS，复用 `app.wxss` 的现有 44 个自定义属性与全局类；图片网格高度用页面局部规则，不改设计系统。

---

## 6. 详情页（activity）改造

### 6.1 版块顺序

现有顺序是：封面 → 状态 → 操作 → 同行人 → 行程 → 天气 → 路线与集合 → 安全 → 装备 → 费用与约定 → 通知/任务。

改为（保留操作区在首屏）：

1. 封面（实拍/氛围图，带来源脚注）
2. 状态 callout + 主操作（不动）
3. 版块导航（新增「介绍」入口）
4. **活动介绍**：`description` 导语 + `content` 块 + `highlights` 要点
5. **活动说明**：时间 / 集合 / 人数 / 领队 / 强度 / 风景 / 腐败 / 费用摘要 / 报名后
6. 同行人（原样）
7. 行程（时间 + `organizerIntro`；**不再重复渲染 `description`**，它已移到活动介绍）
8. 天气（原样）
9. 路线与集合（原样）
10. 安全（原样）
11. 装备（原样）
12. **费用与约定**：`feeSummary` + `feeIncludes` + `feeExcludes` + `feeNote` + `cancellationNote` + 「OurTrail 不收款」
13. **报名后须知**：`signupNote`（若为空不出现）
14. 通知/任务（原样）

说明：把「活动介绍」放在同行人之前，是为了让分享进来的新朋友先看到「为什么去」；已报名的老成员可以用版块导航直接跳到行程/路线。这是参考文的阅读顺序，但不牺牲首屏状态与操作。`description` 从行程移到活动介绍是**有意的版块顺序变化**；旧活动的数据不丢失，仍会出现一次，不重复。

### 6.2 活动说明 fact card

用现有 `.fact-row` 形态，缺项不硬造「待补」：

| 行 | 来源 | 缺失时 |
|---|---|---|
| 活动时间 | `startAt`–`endAt` | 发布必填，不会缺 |
| 集合 | 第一个上车点名称 + 时间；多个时补「等 N 个上车点」 | 发布必填，不会缺 |
| 人数 | `minParticipants`–`capacity`；无成行人数时只写「上限 N 人」 | 只写上限 |
| 领队 | `leader` | 不出现该行 |
| 强度 | `difficulty` 的现有标签 | 不出现该行 |
| 风景 / 腐败 | `sceneryRating` / `funRating` 星级 | 不出现该行 |
| 费用 | `feeSummary` | 不出现该行（详细费用仍在下方的费用区） |
| 报名后 | `signupNote` 的首行/短句 | 不出现该行 |

### 6.3 正文渲染

- 文本块：`utils/content-view.js` 把 `text` 按空行拆成段落，输出 `paragraphs[]`；WXML 逐段 `<text class="article-p">`。**不在 WXML 里做字符串处理**（根规则：逻辑进纯函数，页面只插值）。
- 图片块：`content-view.js` 输出 `rows`/`columns` 布局提示：
  - 1 张：单列大图，`mode="widthFix"`，自然高度；
  - 2 张：两列；
  - 3–9 张：三列，固定缩略图高度。
  - 全部 `lazy-load`；点击 `wx.previewImage` 预览整组。`previewImage` 对 `cloud://` fileID 的支持需真机确认；不支持就先 `wx.cloud.getTempFileURL` 换 https 再预览（一次性批量换，不逐张请求）。
- 报名动作下方显示 `signupNote` 的首行（若存在），详细说明放在「报名后须知」版块；不让用户点了报名才在页面底部看到拉群说明。
- 图片加载失败：单张显示浅灰占位 + 「图片加载失败」，不静默消失；封面失败按 §6.4 退回氛围图。
- 旧活动 `content` 为空：把 `description` 作为「活动介绍」的导语渲染（不再在行程里重复）；如果 `description` 和 `content` 都空，不出现空的「活动介绍」标题。

### 6.4 封面与诚实性脚注

客户端解析顺序：

1. `activity.coverFileId`（服务端解析后的有效封面）
2. `covers.coverFor(activity.id)`（派生氛围图）

脚注三态（`activity.wxml` 现有的 `photo-note` 扩展）：

- 封面是实拍：**「封面与正文图片由组织者提供。」**
- 封面是氛围图、正文有实拍：**「封面为场景氛围图，非本次活动实拍；正文图片由组织者提供。」**
- 封面是氛围图、正文也无图：沿用今天的原文。

`onCoverError`：如果当前是实拍封面，先退回 `covers.coverFor(id)` 并把 `coverIsReal` 置 false（脚注随之改口）；如果已经是氛围图，才走 `coverFailed` 隐藏。**不能出现「实拍封面加载失败后，脚注仍说图片由组织者提供」**——那是把氛围图冒充实拍。

---

## 7. 列表与分享

### 7.1 发现页 / 首页卡片

- 服务端 `discoverView` 增加 `coverFileId`（只给封面，不给正文块）；`activityView` 增加 `coverFileId`。
- `discover.js`：`cover: a.coverFileId || covers.coverFor(a.id)`。
- `home.js`：卡片对象增加 `cover: a.coverFileId || ''`。这会让 `tools/a20-owner-hero-test.js` 的逐字节投影断言变化；该门是**有意更新**，不是悄悄放宽——更新时在测试里保留「封面字段是服务端事实、氛围图仍由组件派生」的注释。
- `components/activity-card` 的 `onCoverError`：先回退到 `covers.coverFor(activityId)`（只回退一次），再失败才隐藏。今天的行为是直接隐藏，实拍封面网络失败时会丢掉整块照片。
- 封面是 `cloud://` fileID 时，`<image src>` 可直接加载（头像已在跨用户名单里这样用：`person-row.wxml` 的 `<image src="{{avatar}}">`）。若真机证明不行，再走 §8.4 的临时 URL 方案。

### 7.2 分享卡片

`pages/activity/activity.js` 已有 `onShareAppMessage`（标题 + 活动 id），但没有 `imageUrl`。本期：

- 活动加载后，若封面是实拍，调用 `wx.cloud.getTempFileURL({ fileList: [coverFileId] })` 取 https 临时地址，存实例属性 `this._shareImageUrl`（不进 `data`）。
- `onShareAppMessage` 返回 `imageUrl: this._shareImageUrl || ''`；取不到就省略，微信用默认截图，不阻塞分享。
- 临时 URL 会过期；页面生命周期内够用。重新 `onShow` 时可以刷新一次（可选，失败静默）。
- 分享路径不变：`/pages/activity/activity?id=...`。已发布活动对任何已登录用户可读（`selectors.js` 的 `kind:'activity'` 只拦 draft 与 organizer/staff 视角），所以群友点进来能看能报名。

---

## 8. 图片链路

### 8.1 上传流程

```
chooseMedia（相册/拍照，compressed）
  → compressImage（quality 70，compressedWidth 1280）
  → wx.cloud.uploadFile（cloudPath: activity-media/YYYYMMDD/<ts>-<rand>.jpg）
  → api.call('checkImage', { fileID, contentType: 'image/jpeg' })
  → 通过：把 fileID 写进当前图片块
  → 不通过/失败：wx.cloud.deleteFile([fileID])，提示换图
```

- 逐张顺序上传，界面显示「正在上传 n/m」；顺序即选择顺序。
- 单块 ≤9 张，全活动 ≤20 张。
- 上传路径不含姓名/手机号/openid；`activity-media/` 前缀是服务端 `checkImage` 的白名单。
- 压缩失败（老基础库/特殊格式）时退回原临时文件再上传，并按实际扩展名传 `contentType`（`image/jpeg` / `image/png`）；如果 `checkImage` 因 >1MB 拒绝，提示「图片过大，请换一张或重试」，不静默跳过检查。

### 8.2 为什么不在选择时直接存本地草稿

草稿只存 fileID（云端），不存临时路径：临时路径跨会话失效，重开编辑器会得到破图。未保存的草稿图片是云端孤儿，见 §11。

### 8.3 封面选择

- 封面就是正文图片中的一张，不额外上传。
- 删除当前封面图时，把 `coverFileId` 清空（客户端回退到第一张/氛围图），避免指向不存在的文件。
- 服务端校验 `coverFileId ∈ content 图片集合`，防止客户端伪造一个不在正文里的封面。

### 8.4 云存储读权限（P0 必验）

`<image src="cloud://...">` 对**其他用户**是否可读，取决于云开发控制台的存储权限。头像已经跨用户展示（活动名单的 `person-row` 用 `<image src="{{avatar}}">`），说明大概率是「所有用户可读」；但这是外部配置，代码证明不了。

P0 验证：账号 A 上传一张图，账号 B 打开活动页能看到。若不可读：

- 首选：把存储权限改成「所有用户可读」（活动图本来就是公开可见内容）；
- 备选：服务端在 `activityView` 里用 `cloud.getTempFileURL` 换 https 地址（会增加一次外部调用与 URL 过期问题，不优先）。

### 8.5 图片安全检查（P0 必验）

`discover` 是公开列表，活动图是 UGC，**不能不做**。方案：

- `cloudfunctions/trailApi/config.json` 的 `permissions.openapi` 增加 `security.imgSecCheck`。
- `index.js` 新增 action `checkImage`：校验 fileID 前缀 → `cloud.downloadFile` → 若 >1MB 返回 `{pass:false, reason:'too_large'}` → `cloud.openapi.security.imgSecCheck({ media: { contentType, value: buffer } })`。
- 返回 `{pass:true}` / `{pass:false, reason:'unsafe'|'too_large'}`；不把图片内容回给客户端。
- 客户端只在 `pass:true` 时把 fileID 放进表单；否则删除刚上传的文件并提示。
- **失败关闭**：检查接口不可用（未授权/未部署/网络失败）时，本期不允许把这张图加入活动，并明确告诉用户「图片安全检查暂不可用，请稍后重试」。不得静默放行。

P0 必须先验证该 API 权限可用。若控制台无法授权，回到用户面前报告，不擅自改成「不检查」上线。

### 8.6 删除与引用计数

新增 `domain/files.js`（纯函数，可被 smoke 直接测）：

```js
activityFiles(activity)        // coverFileId + content 里所有 fileIds
collectActivityFiles(state)    // 全部活动求并集
```

`index.js` 的 `actionDispatch` 在**持久化成功且非重放**之后：

```js
const beforeFiles = collectActivityFiles(before)
const afterFiles = collectActivityFiles(result.value.state)
const removed = [...beforeFiles].filter(f => !afterFiles.has(f))
if (removed.length) cloud.deleteFile({ fileList: removed }).catch(logOnly)
```

- 按引用计数：另一场活动（含 `activity.copy` 的副本）仍在用的 fileID 不会删。
- 删除活动（仅 draft）、移除图片、替换封面都会触发。
- 删除失败只记日志，不影响业务结果；孤儿留给未来的 GC。
- **不删头像**：`collectActivityFiles` 只看活动字段。
- 事务提交成功但云函数在删除前崩溃时，文件会残留；这是可接受的已知债务，不引入第二套事务。

---

## 9. 服务端 / 投影 / 校验

### 9.1 `schema.js`

- 新增 `ContentBlock`（`specUnion('type', { text, images })`）。
- `Activity` 增加 §3.1 的 11 个 `specOpt` 字段；`ActivityInput` 由键派生，自动包含。
- 新增 `TEXT_TOTAL_MAX = 20000`、`IMAGE_TOTAL_MAX = 20` 常量（只用于 `validateInput`，不是 schema 类型）。
- 图片 fileID 用 `specStr(1000)`；短文本用 `specStr(200)`；`leader` 用 `specStr(100)`。

### 9.2 `domain/activity.js` 的 `validateInput`

新增校验（所有写入都做，保持草稿也干净）：

- 正文块非空、图片块 1–9 张、总块数 ≤30、总图 ≤20、总文本 ≤20000。
- `coverFileId` 若存在必须在正文图片里。
- `minParticipants` 若存在 ≤ `capacity`。
- 评分 1–5 整数。
- `highlights`/`feeIncludes`/`feeExcludes` 的条目去空白后非空。
- 发布门不新增必填项。

`activity.edit` 的阶段锁：新字段不进 `lockedKeys`；拒绝文案补上新增的文本类字段。

### 9.3 `selectors.js`

- `activityView(activity, opts)` 增加可选参数：只有 `read {kind:'activity'}` 传 `{ includeContent: true }`，`home` 不传。这样首页不会因为正文块变胖。
- `activityView` 始终带 `coverFileId`（服务端解析后的有效封面：显式封面 → 正文第一张 → 空串），正文块只在 includeContent 时返回。
- `discoverView` 增加 `coverFileId`；不带正文块。
- `discover` 搜索的 haystack（`a.title + routeSnapshot.title + description`）补上正文文本块与 `highlights`，否则长文写在正文里反而搜不到。
- `home` 的搜索仍只覆盖 title/路线/description（客户端用 `activityView` 的字段做搜索）；不把正文塞进 home 投影，避免首页响应为长文买单。

### 9.4 `index.js` / `config.json`

- `checkImage` action 加入 `ROUTES`（action 数 14→15）；要求 OPENID；fileID 只接受 `cloud://` 且路径含 `/activity-media/`。
- `config.json` 增加 `security.imgSecCheck`。
- 部署后确认 `timeout: 20` 仍是控制台值（CLI 部署不继承超时配置）。

### 9.5 `sync-lab.js`

`sync-lab` 自动复制 `domain/*.js`，新增的 `domain/files.js` 会被带上；`store.js` 不变。`trailApiLab` 的 `index.js` 不需要 `checkImage`（编辑器只调生产 `trailApi`），但如果 lab 页要预演图文，需要单独决定；本期不做。

---

## 10. 测试与验证

### 10.1 自动化

| 套件 | 新增/调整 | 覆盖 |
|---|---|---|
| `tools/content-view-test.js`（新） | ~30 断言 | 文本分段、图片 1/2/3+ 布局、封面解析三态、空块清洗、旧数据回退 |
| `cloudfunctions/trailApi/smoke-test.js` | +15–20 | 新字段可选/旧数据合法、空块拒绝、封面必须在正文、总图/总文本上限、成行人数 ≤ 上限、评分范围、copy 保留图片、`collectActivityFiles` 并集 |
| `tools/scenario-editor-test.js` | +20–30 | 4 步切换、块增删/上移/下移、文本块局部 setData、上传桩（chooseMedia/compress/upload/checkImage）、封面选择、草稿往返、发布门不变、上传中禁用 |
| `tools/scenario-activity-test.js` | +15–20 | 正文块渲染、亮点、fact card 缺项省略、费用包含/不含、报名后须知、封面三态脚注、实拍失败回退氛围图 |
| `tools/scenario-discover-test.js` | +5 | `coverFileId` 透传、缺失时派生 |
| `tools/a20-owner-hero-test.js` | 更新契约 | home 卡片新增 `cover` 字段的逐字节基线 |
| `tools/e2e-test.js` | +5–8 | 真实信封创建/编辑带正文与图片 fileID；旧输入仍通过 |
| `tools/e2e-client-cas-test.js` | 跑一次 | 确认新字段不影响 CAS/重放 |
| `tools/lab-dryrun-test.js` | 跑一次 | domain 变更后 lab 副本一致 |
| `node tools/check.js` / `check-handlers.js` | 必跑 | 新 WXML handler、组件注册、平台门 |
| `node tools/journey-graph-test.js` | 必跑 | 无新页面；确认文案/状态词不漂 |

### 10.2 真机（M4，必须）

改动 WXML/WXSS/组件结构，静态门与 Node 测试证明不了渲染。真机矩阵：

1. **空数据**：旧活动（无新字段）打开，数据完整、封面仍是氛围图 + 原脚注、不出现空的新版块。
2. **完整图文**：3 段文字 + 2 组图（1 张/3 张）+ 亮点 + 费用包含/不含 + 报名后须知；封面选第 2 张。检查首屏、长文、图片网格、预览、脚注。
3. **封面失败**：把 `coverFileId` 改成一个不存在的 fileID，确认退回氛围图且脚注改口。
4. **正文图失败**：单张破图显示占位，不塌布局。
5. **分享卡**：有实拍封面时带 `imageUrl`；无封面/取 URL 失败时分享仍可完成。
6. **上传**：真实相册选 3 张 → 压缩 → 上传 → 检查 → 入块 → 保存 → 重开草稿仍在。原生相册选择器 automator 驱动不了，这一步允许**人工点选 + 截图**；其它步骤用 automator/读数。
7. **删除清理**：删一张图保存，确认云存储文件被删、另一场 copy 活动仍能显示同一张（引用计数）。
8. **bundle 新鲜**：`close` + `open` 重编译；用新文案（如「报名后须知」）自证新 bundle。
9. **污染自证**：多用例给不同 `updatedAt`/活动 id，截图前先断言渲染门槛（`content.length`、`coverIsReal`、`feeIncludes.length` 等），不拿 `page.data()` 当像素证据。

找不到开发者工具会话时按 ENV-ABORT/UNVERIFIED 记录，不冒充通过。

### 10.3 部署

1. `node tools/check.js && node tools/check-handlers.js`
2. 受影响套件 + 全量关键门禁（至少 smoke / scenario-editor / scenario-activity / scenario-discover / e2e-test / a20-owner-hero / lab-dryrun）
3. `node tools/sync-lab.js`
4. 部署 `trailApi`（云端安装依赖），确认 timeout 20；`config.json` 的 `security.imgSecCheck` 生效
5. 真机验证
6. 客户端上传/发布（用户操作）
7. `SYNC.md` 条目 + `AGENTS.md` 门禁计数（新增 1 套工具、action 14→15，断言数按实测）

---

## 11. 风险与已知债务

| 风险 | 影响 | 缓解 |
|---|---|---|
| 手机写长文体验差 | 组织者仍回去用公众号 | P0 最小原型试写 10 段 + 10 图；不行就降级 A（固定图集） |
| `imgSecCheck` 权限不可用 | 图片无法上线 | P0 先验；不可用则停下来报告，不静默放行 |
| 云存储读权限是 creator-only | 其他人看不到图 | P0 用双账号验；改控制台或退回临时 URL |
| `loadState` 全量读 + 正文膨胀 | 每次请求变慢 | 正文只在详情视图返回；总文本 20k / 总图 20 上限；P0 实测。若 `read home` 响应比改动前增长 >50%，或 `read activity` 响应 >300KB，则把 home 改成更瘦的 cardView（单独提交） |
| 孤儿上传（选了图没保存） | 存储缓慢增长 | 已知债务；本期只在移除/删除时按引用计数清理，不做定时 GC |
| 4 步编辑器改变 e2e 步骤 | 既有用例红 | 同批更新 `e2e-golden-path` / `scenario-editor`，不静默改门 |
| home 卡片契约变化 | `a20-owner-hero` 红 | 有意的契约更新，测试内写明新增字段的来源 |
| 公开 discover 的 UGC 图 | 内容合规风险 | `imgSecCheck` 失败关闭；来源脚注；不接受视频 |
| 旧客户端/新服务端顺序 | 发布失败 | 先部署服务端，再发客户端 |
| 工作树已有未提交改动 | 交叉冲突 | 开工前落基线或用户点名保留范围 |

---

## 12. 分期计划与文件清单

### P0：权限/容量/编辑体验探针（0.5–1 天，go/no-go）

- 双账号验云存储读权限。
- 验 `imgSecCheck`（安全图通过；确认错误码与 1MB 边界）。
- 用一次性最小原型（或编辑器分支上的块列表骨架）试写 10 段 + 10 图，测上传等待与 textarea 焦点。
- 产出：短报告 + 是否继续 B（内容块）的决定。容量测量放在 P1 收口（schema 能接住新字段之后）。

### P1：服务端与公共模型（1.5–2 天）

- `domain/schema.js`：ContentBlock + 新字段 + 上限。
- `domain/activity.js`：validateInput、阶段锁文案、copy/publish 兼容。
- `domain/selectors.js`：activityView(includeContent)、discoverView.coverFileId、搜索 haystack。
- `domain/files.js`（新）：引用计数。
- `index.js`：`checkImage` + 删除清理；`config.json` 权限。
- `smoke-test.js` 新断言；`sync-lab`。
- P1 收口时用合成数据造一条 20 图/10 块的活动，测 `read home` / `read activity` 响应体积与耗时；若超过 §11 的阈值，先修投影再进 P2。
- 预计 +250–350 行。

### P2：发布页（2–3 天）

- `pages/editor/editor.wxml/js/wxss`：4 步、图文块、上传、封面、亮点/费用/领队/评分/报名后须知。
- 稳定块 id、路径 setData、草稿、上传中状态、错误定位。
- `scenario-editor-test.js` + e2e 步骤更新。
- 预计 +400–600 行 JS、+150–220 行 WXML、+80–150 行 WXSS。

### P3：详情页 / 列表 / 分享（1.5–2 天）

- `utils/content-view.js`（新，纯函数）+ 测试。
- `pages/activity/activity.wxml/js/wxss`：正文、fact card、费用、报名后须知、封面三态、预览、分享图。
- `pages/discover/discover.js`、`pages/home/home.js`、`components/activity-card/*`：封面透传与回退。
- 预计 +250–400 行。

### P4：验证与收口（1–2 天）

- 全量关键门禁、真机矩阵、部署、`SYNC.md`、`AGENTS.md` 计数。
- 预计 100–150 条新断言（按各脚本 `passed=` 实测，不写死总数）。

**合计**：约 7–10 个连续工作日，不含等待云权限/客户端发布审核。以上是工程量级，不是承诺；P0 结果可能改变 P2/P3 的形态。

### 文件清单（预计）

**后端 7**：`domain/schema.js`、`domain/activity.js`、`domain/selectors.js`、`domain/files.js`（新）、`index.js`、`config.json`、`smoke-test.js`。
**客户端 12–13**：`pages/editor/{js,wxml,wxss}`、`pages/activity/{js,wxml,wxss}`、`utils/content-view.js`（新）、`utils/api.js`、`pages/discover/discover.js`、`pages/home/home.js`、`components/activity-card/{js,wxml}`（视需要 `wxss`）。
**工具 5–6**：`tools/content-view-test.js`（新）、`scenario-editor-test.js`、`scenario-activity-test.js`、`scenario-discover-test.js`、`a20-owner-hero-test.js`（+ `e2e-test.js`）。
**文档 3**：本设计、`SYNC.md`、`AGENTS.md`。

---

## 13. 验收标准

1. 发起人可在小程序内完成：标题 + 时间 + 集合 + 封面 + 10 段文字 + 10 张图 + 4 条推荐理由 + 费用包含/不含 + 成行人数 + 领队 + 两项指数 + 报名后须知，并成功发布。
2. 群友从分享卡片进入，能看到图文正文、活动说明 fact card、费用明细，并完成报名；有实拍封面时分享卡带图，临时 URL 取不到时不影响分享。
3. 旧活动（无新字段）打开：字段不丢失、封面仍是氛围图且脚注仍说「非本次活动实拍」、不出现空的新版块；`description` 按新布局移到「活动介绍」，这是有意的版块顺序变化。
4. 实拍封面加载失败会退回氛围图且脚注改口；正文单图失败显示占位，不塌布局。
5. 删除图片/删除草稿后，云存储中不再被任何活动引用的文件被删除；`activity.copy` 的副本仍能显示同一张图。
6. 图片未经 `imgSecCheck` 通过不能进入活动；检查不可用时图片功能失败关闭，不静默放行。
7. `content` 为空时仍可发布（快速创建原则不变）。
8. 静态门 + 受影响套件 + 真机矩阵通过；服务端已部署；云存储读权限与图片检查权限已验证。
9. 没有支付/保险承诺文案；没有新增色值/token；没有把氛围图冒充实拍。

---

## 14. 需要用户确认的事

1. **批准 C 档的范围与分期**（本文 §12），以及 P0 的 go/no-go 机制。
2. **开工前处理当前工作树的未提交改动**：落基线，或点名哪些文件本轮不要碰。
3. 若 P0 发现手机写长文体验不可接受，是否接受降级到 A（固定图集 + 分段长文）——这条会在 P0 结束时带着实测再问一次，不预先替用户决定。

---

## 15. 不做（本期）

- 支付、收款、退款、保险购买/承诺。
- 富文本 HTML、公众号文章导入、视频、评论、点赞、收藏。
- 图片裁剪/滤镜/拖拽排序/定时孤儿回收。
- 路线库资产图片、活动模板市场、多俱乐部品牌装修。
- 任何绕过 `imgSecCheck` 的「先上线后补审核」方案。
