# 运行环境与采集方法

## 1. 基线确定

- 主工作区 `D:/OurTrail` 处于 `master`，HEAD = `e818e630dd38d9d22a899a5ecddcd9fad9682259`，但存在**大量他人未提交改动与进行中的开发任务**（天相推理修复：新增 `lib/atmosphere.js`/`spatial.js`/`terrain.js`/`light-pollution.js`，删除 `components/roam-scrubber`、`components/space-time`、`utils/weather-model.js` 等，`git status` 约 90 项）。
- 按任务约束，**未触碰主工作区任何文件**；用 `git clone --branch master d:/OurTrail d:/OurTrailAudit` 建立独立 clone 作为审计基准（`git status` 干净，0 项）。
- 远程一致性：`git ls-remote origin master` 返回 `e818e63…`，与本地一致。目标分支 `audit/ui-redesign-baseline-20261021` 在远程不存在（`git ls-remote origin` 无该 ref），分支名无冲突。

## 2. 软件环境（实测）

| 组件 | 版本/位置 | 验证方式 |
|---|---|---|
| Node | v24.19.0 | `node --version` |
| npm | 11.17.0 | `npm --version` |
| 微信开发者工具 | CLI at `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat` | `cli --help` |
| 登录态 | `{"login":true}` | `cli islogin` |
| IDE 服务端口 | `http://127.0.0.1:33278`（LISTENING） | `Test-NetConnection` |
| 自动化端口 | 9425（本项目专用，避开历史 9420–9424） | `cli auto --auto-port 9425` |
| miniprogram-automator | 0.12.1，装在 `%USERPROFILE%\.ourtrail-e2e`（**仓库外**，遵守仓库零 npm 依赖铁律） | `node -e require(...)` |
| 小程序基础库 | 3.8.12（project.config.json `libVersion`） | 项目配置 |
| 模拟器 | iPhone 逻辑分辨率 375px（默认视口，全部截图统一） | 截图实测 |
| 云函数 | `trailApi` / `trailApiLab`（云端已部署，环境 `cloud1-d9ghcm034574b9d55`） | 真实 read 成功（152 张活动卡等） |

## 3. 采集方法（全部为真实运行）

1. `cli open --project 'D:\OurTrailAudit'` → 等待编译 → `cli auto --project 'D:\OurTrailAudit' --auto-port 9425 --trust-project`。
2. `miniprogram-automator.connect({ wsEndpoint: 'ws://127.0.0.1:9425' })` 连接模拟器。
3. 每个页面 `mp.reLaunch(route)` → `waitFor` → 读 `page.data()` 记录 loading/denied/关键数组长度 → `mp.screenshot()`（返回 base64，`Buffer.from(..., 'base64')` 解码落盘 PNG）。
4. 长页面用 `mp.pageScrollTo(700/1400/2100)` 分段截图。
5. 文本输入用 `el.input(text)`（真实触发 `bindinput`，已用 `page.data()` 回读验证生效，如 editor 标题）；按钮/链接/chip/checkbox 用 `el.tap()`；弹层内按钮从 overlay 面板作用域查（`page.$('overlay').$$('.button')`，page 级查不到——playbook 已记载的坑）。
6. 每条命令的结果都记录在 `evidence/test-results.md`；失败的轮次不删除证据（见 §5）。

## 4. 数据来源分级（截图可信度）

| 级别 | 说明 | 本例 |
|---|---|---|
| 真实云数据 | 页面自己调云函数，账号内既有数据 | HOME 152 卡、DISCOVER 50 卡、ME 统计、ROUTES 296 条、WEATHER 成都真实预报、ROUTE 详情 |
| 真实写入 | 本次审计真实创建的测试数据 | 活动 `activity-mvhyq03v1zfgrj`（已发布）、草稿活动 ×2、观察点「审计测试点」 |
| 真实交互 | tap/input 触发页面既有 handler | 创建活动全流程、报名表单勾选与提交、详情 tab 切换、hub 输入 dialog |
| 无注入合成数据 | —— | 本轮**未使用** `page.setData()` 注入任何页面数据（所有画面均由真实链路产出） |

## 5. 时间线（2026-10-21，UTC+8）

| 步骤 | 结果 |
|---|---|
| 仓库状态检查 + clone 基线 | 完成（HEAD `e818e63`） |
| 源码审计（21 页 + 组件 + 设计系统，3 个只读子代理并行） | 完成 |
| automator 安装 + `cli open/auto` | 完成 |
| **首轮基线截图（21 页）** | **ME/WEATHER 白屏失败**——根因：`cli open` 后 40s 编译未完成即连 automation，模拟器仍是旧 bundle；console 报 `Component is not found in path "wx://not-found"`（实际是 bundle 过期，非组件缺失；40 个 json 的组件引用链经脚本扫描全部完整） |
| `cli close` + `open` + 等 55s + `auto`（playbook 规定动作） | ME/WEATHER 恢复正常（data keys 30/53，console 错误消失） |
| 重跑全量基线（21 页） | 全部成功（旧轮 manifest 留证为 `capture-manifest.round1-invalid.json`，截图已作废删除） |
| 创建活动流程 v1–v7（7 轮迭代） | 逐步攻克：草稿清理/input 生效性/picker 弹层不可捕获/路线 sheet 遮罩/overlay 按钮作用域；最终 v7+v8+落地补采完成**真实发布闭环** |
| 组织者流程（workspace/vehicle/tasks/staff） | 完成（首轮 URL 参数用错 `activityId`，实际为 `id`，已修正重跑） |
| 报名流程（2 轮）+ 详情 tab | 表单与校验失败态完成；提交成功态受阻（见 blockers） |
| 天气 hub 输入 dialog → weather 跳转 | 完成 |
| ROUTE 详情补采（真实路线 id） | 完成 |
| manifest 生成 + 无效截图清理 | 111 张 |

## 6. 复用方式

后续需要重跑或扩展截图时，脚本在 `%USERPROFILE%\.ourtrail-e2e\`（`audit-shots.js` 全量基线、`audit-flow-create*.js` 创建流程、`audit-flows-organizer*.js` 组织者、`audit-hub-input.js` 天气 hub、`gen-manifest.js` manifest 生成、`check-component-refs.js` 组件引用扫描）。这些脚本**不属于本审计交付物**（装在仓库外），需要入库可在下阶段评审。
