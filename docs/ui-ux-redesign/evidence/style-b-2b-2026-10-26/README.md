# style-B 批次二 b 证据包（14 页 Gap Matrix + F1–F5 真机复核）

- 日期：2026-10-26
- 设计文档：`docs/ui-ux-redesign/style-b-implementation-design-batch2b-2026-10-26.md`（§3 是 14 页逐页判定，§4 是 F1–F5 精确改法）
- 判定：`cloudfunctions/` 零改动 ⇒ **不需要部署**；本轮**未提交、未推送、未发布**

## 1. 方法

| 项 | 值 |
|---|---|
| 环境 | 微信开发者工具 IDE 模拟器，iPhone 12/13 (Pro)，390×844（`windowHeight 844`、`clientHeight 753`、`statusBarHeight 47`），SDK 3.8.12 |
| 通道 | `miniprogram-automator` → `ws://127.0.0.1:9435`（会话由用户预先绑好，本轮未 close/open/quit） |
| 驱动 | 仓库外 `%LOCALAPPDATA%\Temp\opencode\mp-auto\verify-2b-2026-10-26.js`，**只读**：只 `reLaunch` / `$$` / `offset()` / `size()` / `screenshot()` / `data()`，不点按钮、不写数据 |
| 截图 | `mp.screenshot()` 返回 base64 字符串，`Buffer.from(String(raw),'base64')` 落盘；分辨率 306×660（模拟器缩放），判定颜色**一律放大原图**，不从缩略图推断 |
| before | 本目录顶层 14 页首屏 + 5 张滚动位/角色态（`routes.png` … `workspace-owned-y980.png`） |
| after | `after/*.png`（`routes-after` / `route-after` / `route-edit-after` / `workspace-tools-after` / 4 张导航条） |

**bundle 新鲜度自证：** after 截图里出现 `自己整理的，别人共享的。`——这句在旧包里不存在（旧包是 kicker + 20px「路线库」+ sub 三层）。因此这批 after 图不可能是旧 bundle 的产物。

## 2. F1 导航条：像素读数

采样点 `x=25`（避开刘海黑色药丸），after 截图：

| 页 | y=6 | y=14 | y=24 | y=34 | 判定 |
|---|---|---|---|---|---|
| `nav-signup.png` | #F5F5F0 | #F5F5F0 | #F5F5F0 | #F5F5F0 | 浅底，与内容同色 |
| `nav-editor.png` | #F5F5F0 | #F5F5F0 | #F5F5F0 | #F5F5F0 | 同上 |
| `nav-privacy.png` | #F5F5F0 | #F5F5F0 | #F5F5F0 | #F5F5F0 | 同上 |
| `nav-weather.png` | #F5F5F0 | #F5F5F0 | #F5F5F0 | #F5F5F0 | 同上 |

这 4 页正是改前**继承绿色 `#163E35`** 的那批（before 顶部是深色条），现在与 `routes` 等 14 页一致。中心点 `x=153, y=8/20` 读作 `#000000` 是刘海药丸本身，不是导航底色。

## 3. F2–F5：真机读数（14/14）

`after/readings-after.json` 原文记录；摘要：

| 项 | 读数 |
|---|---|
| 路线库页头 | kicker 0 条；陈述「自己整理的，别人共享的。」；`title 24-52` / `btn 80-128 w=350` ⇒ 按钮在陈述下方、全宽 |
| 路线库行 | 首行 `title@229`、`updated@289/479/668`；风险行 299 条（= 我的 299 + 共享 0 的可见行数）；保存时间在所有行的标题之下 |
| 路线详情 | kicker「活动沉淀」在标题前；`title 42-98`、`updated@110` 同簇 |
| 路线编辑 | 无 `OURTRAIL` 眉题；首屏实底主操作只有底栏「保存修改@659」；导入为 `button secondary block` |
| 工作台 | 4 个工具入口全在、class 均为 `button workspace-tool`（无 `leaf`） |

## 4. 本轮自检与两处更正（重要）

1. **F2 初稿「陈述 + 右侧按钮同一行」被实测推翻。** 390 下 `title 24-80 / btn 88-136`（换行）；估算 19 字×20px + 12 + 122 ≈ 370 > 358 内容宽。改为 `notices` / `weather-hub` 的「陈述独占一行 + 全宽 block primary」口径后 `w=350`，不再依赖设备宽度。没有用 `nowrap` 硬塞（那只是把溢出从纵向挪到横向）。
2. **一条真机断言方向写反。** 第一版要求「保存时间出现在标题**之上**」，而模板本意是 标题 → 元信息 → 指标 → 风险。失败读数 `title@237 updated@297` 暴露的是断言错，不是页面错。已改为钉真实阅读顺序（标题 < 保存时间 < 风险），并保留「元信息簇含保存时间」「行尾只剩风险一行」两条结构门 ⇒ **换了方向，没放宽**。
3. **before 期的一条误判已撤回**（设计文档 §1）：缩小截图里「继续完善」像深色实底，300px 原图放大是白底深字。

## 5. 明确不改（本批已逐条取证，理由见设计文档 §3/§5）

`tasks` / `staff` 的 18px 身份行（门禁钉住）、`vehicle` 深色车辆 hero（有意）、`activity` 图文与吸顶条、`editor`/`signup`/`anotices`/`weather-hub` 的既有层级、`me` 的章节顺序、`lab` 与 `cloud-field-poc`（DEV_ONLY）。`routes` 里 299 条 `….gpx.bin_tmp` 名字属数据卫生，不动版式。

## 6. 门禁读数（本工作树最终态）

`node tools/check.js` → ALL CHECKS PASSED（G10 作用域单元 42 / token 3136 / 类名 134，命中 0）；`check-handlers.js` → 死 handler 未增加（存量 `editor#onNumber` 1 条）。

| 套件 | 读数 |
|---|---|
| `nav-chrome`（新） | 15/0 |
| `personal-route-layout` | 60/0 |
| `operations-layout` | 39/0 |
| `page2-gates` | 117/0 |
| `entry-layout` | 41/0（结构 E1；UI=NOT_RUN） |
| `header-layout` | 38/0 |
| `scenario-editor` | 227/0 |
| `scenario-activity` | 212/0 |
| `journey-graph` | 15/0 |
| `ui-consistency` | 19/0 |
| `t4-e08` | 41/0 |
| `m02-class-scope` | 66/0 |
| `swx1-style-gates` | 45/0 |
| `swx2-style-gates` | 110/0（上一轮登记的 `.highlight-dot` 红在当前工作树未复现，按读数记录，不归因本轮） |
| `b4-pad-final-value` | 33/0 |

## 7. UNVERIFIED（如实登记）

- `signup` 真实报名表单（唯一非本人活动已过时，不可达）
- `staff` 真实任务面板（本账号无协作授权，只有 denied）
- `vehicle` 真实车辆 hero 与分车（无车辆数据，只有极端态）
- `workspace` 名单 / 分车 / 现场三个 tab 的展开态
- 原生 picker / 分享 / 相册 / 键盘弹起态
- 375 宽度断点（本轮全部读数在 390）
- `cloud-field-poc` 全程（DEV_ONLY，驱动曾超时）
- 地图底图瓦片（IDE 环境长期空白；`route-after.png` 里可见腾讯地图 attribution 与路线折线，瓦片不判）
- 4 个 custom 导航 tab 页的 `brand-header` 未受 `app.json window` 影响（结构门钉住，未逐页重拍）
