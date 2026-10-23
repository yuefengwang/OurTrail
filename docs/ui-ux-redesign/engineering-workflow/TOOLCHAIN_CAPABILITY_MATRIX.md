# TOOLCHAIN_CAPABILITY_MATRIX — 运行/截图/自动化/测试能力矩阵（night-v2，2026-10-22）

状态词：**已实测** / **有实现依据未验证** / **部分支持需补强** / **不支持** / **证据不足**。
环境：Windows 10 · Git Bash · Node v24.18.0 · 微信开发者工具 CLI `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（服务端口 33278）· automator 驱动装在仓库外 `%LOCALAPPDATA%\Temp\opencode\mp-auto`（仓库零 npm 依赖铁律）。

| # | 能力 | 工具/命令 | 状态 | 证据 | 缺口与失败处理 |
|---|---|---|---|---|---|
| 1 | 静态门禁（语法/WXML 配平/注册双向/平台门 G1–G11/handler 解析） | `node tools/check.js`、`node tools/check-handlers.js` | 已实测 | 历轮 exit 0；本轮实施后复跑（见 IMPLEMENTATION_REPORT） | 无 |
| 2 | 单元/场景/生命周期门禁套件 | `node tools/*-test.js`（106 套，2026-10-21 实测） | 已实测 | 各脚本自打印 `passed=N failed=N`，exit 非零即红 | 常驻红 2 条已归因（trip2 66/10 桩缺 wx.cloud；e2e-ui 系环境门） |
| 3 | 云函数领域层 smoke | `node cloudfunctions/trailApi/smoke-test.js`（214） | 已实测 | 历轮 | 本轮 cloudfunctions 冻结，不需重部署 |
| 4 | A 层服务链路 E2E（真信封打 exports.main） | `tools/e2e-test.js` 等 7 套 | 已实测 | 历轮 exit 0 | 夹具时间一律 `Date.now()` 偏移（铁律 35 教训） |
| 5 | B 层真模拟器 UI E2E | `tools/e2e-ui-test.js` / `e2e-ui-state-test.js` / `e2e-golden-path-test.js`（固定 9420） | 部分支持需补强 | 历史 INCONCLUSIVE（exit 2，环境门）；GP-01 既有红已归因 | 本轮不改这三套；用自研驱动（#7）替代取证 |
| 6 | 开发者工具 IDE 启动/登录/自动化端口绑定 | `cli open/islogin/auto --port 33278` | 已实测（本轮） | 2026-10-22 本会话：IDE 未运行→`open` 新起；`islogin={"login":true}`；`auto` 回 `{"autoPort":9425}` 且 AppID 回显 wx1227a277a3f2f7ea | 启动前确认无他人会话（tasklist 无 wechatdevtools 进程）；**不 quit、不 close 他人会话** |
| 7 | 进入真实页面 + 真实云数据渲染 | automator `reLaunch` + `waitFor` | 已实测（本轮基线） | `shot-night-v2-baseline.js` 读数与截图落盘（before/）；驱动在仓库外临时目录，未入库；复跑需先复制 | 读数门槛链先断言再截图（铁律 32⑥） |
| 8 | 真实截图采集与归档 | `mp.screenshot()` base64→Buffer→PNG | 已实测 | 历轮 + 本轮 before/ 六张 | 直接 writeFileSync 会得"文本伪装 png"（坑 1） |
| 9 | 滚动后取景 | `mp.pageScrollTo(px)` | 已实测 | 历轮 | 滚动后 `page.$` 可能失效，重取句柄 |
| 10 | bundle 新鲜度 | 新起 IDE＝新编译；改码后须 `close`+`open` 重编译 | 部分支持需补强 | AGENTS.md 坑 2；night-v1 曾对旧 bundle 排查良久 | 本轮 after 截图前对**本会话自起会话**执行 close+open 并记录；新鲜度以新文案上屏自证；夜间实际用 `.stack-gap3` 自证，该判据不唯一（master 已存在），后续须用最终代码独有且可观测的差异做版本门 |
| 11 | 注入合成数据取证（渲染路径验证） | `page.setData(生产形状全集)` | 已实测 | 铁律 32⑥ 三门槛；night-v1 六态对拍 | 注入只用于状态矩阵补拍；基线/验收主证据用真实云数据 |
| 12 | 像素级自动比对 | 无 | 不支持 | ourtrail-ui §4：仓库内零像素比对工具 | 人眼 + 独立 QA Agent 读图；差异清单逐条指回截图区域 |
| 13 | Playwright / chrome-devtools / browser-use 控小程序 | MCP | 不支持 | WXML 无浏览器宿主；任务书 6.5 明令不得冒充 | 仅用于 Web 产物（本轮无） |
| 14 | 云函数部署 | 控制台/`cli cloud functions deploy` | 有实现依据未验证（本轮不需要） | 历轮已部署；本轮 cloudfunctions 零改动 | 若动则部署后 diff 线上包 + 复核 timeout 20 |
| 15 | git 安全（分支/worktree/合并窗口） | PARALLEL_DEV.md 协议 | 已实测 | 本轮分支 `agent/ourtrail-night-ui-v2`，不推远端 | 主工作区 4 个未跟踪文件（上轮遗留）不碰不删 |
| 16 | 外部仓库检索 | `api.github.com`（github.com 网页被拦） | 已实测 | A0 子 Agent 取回 4 仓元数据与 README 原文 | 失败记 HTTP 码，不伪造 |
| 17 | 多 Agent 分派 | Agent 工具（Explore/只读） | 已实测 | A0 调研、D 阶段独立 QA | 子 Agent 不继承只读约束 ⇒ 分派前后 git status；未返回不写结论 |

## 与任务书能力九维对照

| 维度 | 结论 | 依据行 |
|---|---|---|
| 设计分析 | 多模态直读总览图 + ourtrail-ui M1 | #16、SKILL_EVALUATION §1 |
| 项目理解 | AGENTS.md 体系 + 只读子 Agent 审计 | #2、#4 |
| 实施能力 | 直接改真实小程序源码（非 Demo） | #1、#15 |
| 运行能力 | IDE CLI 新起会话 | #6 |
| 截图能力 | automator 截图稳定可复现 | #7–#9 |
| 视觉 QA | 人眼 + 独立 QA Agent（无像素工具） | #12 |
| 回归保护 | 106 套件 + 静态门 + 绑定计数钉点 | #1、#2、#4 |
| 工程适配 | 全链路本机可跑（Windows 机） | 全表 |
| 维护与安全 | 零新增依赖；驱动在仓库外 | #7、#15 |
