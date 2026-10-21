# OurTrail 全局 UI 重设计 · 第一阶段审计基线（2026-10-21）

> 本目录是**只读审计 + 真实运行截图**的产出，供后续多风格探索与重构使用。
> 本轮**未修改任何业务代码**；所有截图来自微信开发者工具模拟器的真实运行（驱动方式见 `environment.md`）。

## 1. 基线信息

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/yuefengwang/OurTrail |
| 基线分支 | `master` |
| 基线 commit | `e818e630dd38d9d22a899a5ecddcd9fad9682259`（2026-10-21 11:50:56 +0800，`feat(ui): 创建活动收敛：快速路径、自动填充与连续图文`） |
| 远程校验 | `git ls-remote origin master` = `e818e63…`（与本地一致）；目标审计分支名在远程不存在（无冲突） |
| 审计工作区 | `D:/OurTrailAudit`（master 的独立 clone，非主工作区——主工作区当时有他人未提交改动，全程未触碰） |
| 采集时间 | 2026-10-21（UTC+8，详见 `environment.md` 时间线） |
| 运行环境 | 微信开发者工具 CLI（x86）+ 模拟器；基础库 3.8.12；`miniprogram-automator@0.12.1`（装在仓库外 `~/.ourtrail-e2e`，遵守仓库零 npm 依赖铁律） |

## 2. 覆盖率

| 指标 | 数 |
|---|---|
| `app.json` 注册页面 | **21**（含 2 个 DEV_ONLY 页：`lab`、`cloud-field-poc`；含 1 个静态页 `privacy`） |
| 底部导航（自定义 TabBar） | 4 项：活动(home) / 天气(weather-hub) / 通知(notices) / 我的(me) |
| 已采集真实截图的页面 | **21 / 21**（每页至少 1 张；多数含首屏 + 滚动中段 + 底部） |
| 截图总数 | **111** 张 PNG（`screenshots/`，约 5 MB；逐张记录见 `capture-manifest.json`） |
| 关键交互状态截图 | 创建活动 15 张（空表单/填写/时间 chip/路线库 sheet/集合点/图文/发布确认/发布成功/校验失败）；报名 6 张；详情 tab 切换 3 张；天气 hub 输入 dialog + 跳转 5 张等 |
| 未采集页面 | **0**（被阻塞的仅是个别交互态，见 `evidence/blockers.md`） |

## 3. 核心流程覆盖（详见 `interaction-flows.md`）

| 流程 | 覆盖 | 证据 |
|---|---|---|
| 冷启动/首页/Tab 切换 | 完整 | HOME/NOTICES/ME/WEATHER-HUB 截图；真实云数据 |
| 发现/搜索/筛选 | 完整（列表 + 地图态源码确认） | DISCOVER 4 张 |
| 活动详情 | 完整（首屏/中段/底部/tab×3） | ACT-DETAIL 17 张 |
| **创建活动** | **完整闭环**（空表单→标题→时间 chip→路线库→集合点→图文→发布确认→**真实发布成功**→落地详情） | ACT-CREATE 15 张，新建活动 `activity-mvhyq03v1zfgrj` 已在云环境上线 |
| 报名 | 表单 + 校验失败态完整；**提交成功态未采到**（见 blockers） | SIGNUP 6 张 |
| 组织者工作台/任务/现场 | 完整渲染 | WORKSPACE/TASKS/STAFF |
| 分车（车长侧） | 权限拒绝态（当前账号无车辆联络授权） | VEHICLE |
| 签到/位置 | 无独立签到页；三处实现见 `product-map.md` §5；当前账号无在场数据，未采到签到交互 | 源码审计 |
| 天气（hub/查询/全图） | 完整（真实云函数取数成都 + hub 输入 dialog + 跳转） | WEATHER 10 张 + WEATHER-CHART 4 张 |
| 个人中心 | 完整（资料/统计/同行人/协作码/路线库入口） | ME 4 张 |

## 4. 创建活动专项结论（最高优先级，详见 `interaction-flows.md` §3）

- **发布门已收敛为 4+1 类必填**：活动名称、出发/结束/报名截止三个时间、至少 1 个集合点（名称/地址/集合时间齐全）。其余（路线名/节点/风险/图文/装备/费用）全部是「可后补」并在发布确认层逐项点名 + 「去补上」（`editor.js:1177-1208`）。
- **自动生成已大量落地**：时间 chip 一点即填出发时间并自动估算结束（+8h）与截止（出发前 1 天）；标题可由路线名/GPX 文件名自动填并标注来源；集合点可由路线起点生成。
- **仍要求手填的半自动项**：「用路线起点生成」的集合点 `address` 刻意留空，而发布门要求地址 ⇒ 用户必须人手补一句「从哪儿进、认什么标志物」（`editor.js:546-567`、`useStartAsPickup`）。
- **图文编辑是清晰分离的对象**：单一连续 textarea（空行分段）+ 图片组（按段落锚定；移除/前移/后移/删组/封面选择分层收在「管理」），不是图文混排。
- **主要问题**：①步骤切换不校验、发布时错误集中爆发；②路线库 sheet 选中路线后不自动关闭、遮挡后续操作；③picker（日期/时间）的模拟器弹层无法被自动化捕获（记录为阻塞，非产品缺陷）；④「添加图片」走系统相册，同样无法捕获（阻塞）。

## 5. 设计系统摘要（详见 `design-system-audit.md`）

森林绿 × 嫩叶绿 × 纸面底，圆角卡片，`app.wxss` 是唯一样式单源（40 个 CSS 自定义属性 + 约 60 个全局类）；图标唯一方案是运行时 SVG data-URI（`components/icon`，颜色必须经 `color` 属性显式传入——这是 53+ 处 `color="#hex"` 硬编码的直接原因）；`!important` 0 处；活体色值债 17 处（其中 12 处有明确豁免/注销理由，严格债务 6 处）。**源码定义 vs 截图观察**已分列，未从源码确认的细节均已标注。

## 6. 最值得优先解决的 10 个 UI/UX 问题（完整 14 条见 `interaction-issues.md`）

| # | 问题 | 类别 | 优先级 | 置信度 |
|---|---|---|---|---|
| 1 | 报名提交校验失败（158 条错误）但界面**零反馈**：无红字、无 toast、无定位 | 状态反馈/表单 | P1 | 高 |
| 2 | 报名「选择参与人」把 81 个历史同行人候选平铺，无搜索/分组/默认选中 | 信息架构/表单 | P1 | 高 |
| 3 | 天气页单页承载 10+ 模块（逐时/7 日/OI/时空天相/时间轴/总评/全字段表），首屏外密度失控 | 视觉层级/信息架构 | P2 | 高 |
| 4 | 首页并发 3 个全量 read（participant/staff/vehicle）+ profile，152 张卡全量渲染 | 性能 | P2 | 中 |
| 5 | 路线库 sheet 选中路线后不自动关闭，遮罩吞掉后续所有点击 | 交互 | P2 | 中 |
| 6 | editor 步骤切换不校验，发布时「还差 5 项」集中爆发 | 表单/状态反馈 | P2 | 高 |
| 7 | 集合点半自动：起点可生成但地址必须手补，半自动感 | 表单 | P2 | 高 |
| 8 | 无参深链打开 weather 得「缺少活动编号。」——面向开发者的错误文案 | 状态反馈 | P2 | 高 |
| 9 | ME 页自动保存（停 800ms 落库）只有 2 秒「已保存」闪烁，无持久确认 | 状态反馈 | P2 | 中 |
| 10 | TabBar 无未读徽标；`window.backgroundColor` 与 `--paper` 不同源（下拉露出旧底色） | 一致性/可访问性 | P3 | 高 |

## 7. 三种视觉方向初步适配（结论与风险，不含设计稿）

- **方向 A 自然编辑式**：最贴现有设计语言（森林绿/纸面/留白已就位）。适合 weather、route、me、privacy 等「阅读型」页。风险：首页/工作台信息密度会被留白进一步压低。需重构：天气页模块分组、报名长表单分段。
- **方向 B 专业户外工具式**：适合 weather、weather-chart、route、workspace、vehicle 等「数据/操作型」页；现有 token 已有 `--chart-*` 图例色板可扩展。风险：与 A 的纸面基调冲突，需双主题治理。需重构：图表卡、指标带、地图卡。
- **方向 C 现代户外社群式**：适合 home、discover、activity、signup 等「人的状态」页。风险：当前身份/协作码/同行人体系较重，社群化不能削弱安全语义（紧急联系人、授权确认）。需重构：activity-card、person-row、报名参与人选择。
- **共同底线**（三方向都必须守）：天气派生结论的概率语气与诚实性（已有门禁）；四态用 `status-panel`；危险操作二次确认；触控 ≥44px。详见 `.agents/skills/ourtrail-ui`（本轮已读，判据背景）。

## 8. 测试执行与阻塞（详见 `evidence/test-results.md`、`evidence/blockers.md`）

- 运行：`docs/e2e-mp` 体系的 CLI + automator 驱动；`node tools/check.js` 未跑（本轮为只读审计 + 截图，不涉及代码改动，按 skill §4 静态门属改动后必跑项，本轮无改动故不适用）。
- **已解决的环境问题**：首轮截图 ME/WEATHER 白屏，根因是 `cli open` 后 40s 编译未完成即 `auto`（旧 bundle），按 playbook `close`+`open`+等 55s 后恢复——失败轮截图已作废（`capture-manifest.round1-invalid.json` 留证）。
- **阻塞项**（未伪造、未绕过）：系统 picker 弹层、系统相册/文件选择、`wx.chooseLocation` 地图选点三支付宝原生弹窗无法被 automator 捕获；报名提交成功态因上述授权勾选层级未走通而未采到；`e2e` 套件需重开共享开发者工具会话，未擅自执行。

## 9. 敏感数据脱敏说明

- 云环境为**用户自有测试环境**（含大量 `[预演] …E2E`、`[UI] …`、`测试活动` 等历史自动化数据）。截图中出现的昵称（「林溪」）、常用同行人姓名、活动标题、统计数字均来自该测试环境，**未出现手机号、证件号、令牌、精确住址**。
- 本轮创建了一条明确标注「UI审计测试」的活动（`activity-mvhyq03v1zfgrj`）与一条路线观察点（「审计测试点」），均为测试数据。
- 未提交任何 API 响应原文、openid、cloud fileID 以外的敏感字段；`config.js` 中的云环境 ID 属项目既有配置（已在仓库中），非新增泄露。
- 下游使用者请注意：截图含测试环境中的自然人名（同行人列表），二次分发前应按贵方合规要求处理。

## 10. 提交

| 项 | 值 |
|---|---|
| 审计分支 | `audit/ui-redesign-baseline-20261021`（远程无同名分支，无冲突） |
| commit SHA | 见本目录 `git log -1`（提交信息 `docs: add OurTrail UI redesign audit baseline`） |
| 分支地址 | https://github.com/yuefengwang/OurTrail/tree/audit/ui-redesign-baseline-20261021 |

## 材料入口

```
docs/ui-redesign/audit-2026-10-21/
├── README.md                  ← 本文件（交付索引）
├── environment.md             ← 环境、基线、采集方法与时间线
├── product-map.md             ← 信息架构 + 10 条核心流程（标注部分实现）
├── page-inventory.csv         ← 21 页全字段清单（入口/结构/操作/状态/组件/数据依赖/截图）
├── interaction-flows.md       ← 交互流程逐步证据（创建活动最详）
├── interaction-issues.md      ← 14 条问题（含证据/影响/优先级/置信度）
├── design-system-audit.md     ← token/组件/图标/色债/覆盖风险（源码 vs 截图分列）
├── capture-manifest.json      ← 111 张截图逐条记录（路由/状态/方式）
├── capture-manifest.round1-invalid.json  ← 首轮旧 bundle 失败轮留证（不采信）
├── screenshots/               ← 111 张真实截图（12 个分组目录）
└── evidence/
    ├── test-results.md        ← 运行记录与根因
    └── blockers.md            ← 未完成项与原因
```
