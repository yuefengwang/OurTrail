# 测试执行记录

## 1. 本轮实际执行的操作（全部可复现）

| 类别 | 命令/动作 | 结果 |
|---|---|---|
| 基线 | `git clone --branch master d:/OurTrail d:/OurTrailAudit` | clone HEAD = `e818e63`，与 origin/master 一致 |
| 远程 | `git ls-remote origin master` / `refs/heads/audit/ui-redesign-baseline-20261021` | master=`e818e63`；目标分支不存在（无冲突） |
| 环境 | `cli islogin` / `Test-NetConnection 33278` | `{"login":true}` / True |
| 驱动 | `npm i miniprogram-automator`（仓库外 `~/.ourtrail-e2e`） | 0.12.1 安装成功 |
| 打开项目 | `cli open --project 'D:\OurTrailAudit'` + `cli auto --auto-port 9425` | autoPort 9425 就绪 |
| 组件引用扫描 | `node check-component-refs.js`（40 个 json） | `ALL_COMPONENT_REFS_OK` |
| 基线截图 | `node audit-shots.js`（21 页 + weather 真实查询） | 首轮 ME/WEATHER 失败；重启后 21/21 成功 |
| 创建流程 | `audit-flow-create{,2..8}.js`、`audit-flow-create9.js` | 7 轮迭代后真实发布闭环 |
| 组织者 | `audit-flows-organizer{,2}.js` | workspace/tasks/staff 渲染；vehicle 权限态 |
| 报名 | `audit-flow-signup{,2}.js` | 表单 + 校验失败态；成功态受阻 |
| 天气 hub | `audit-hub-input.js` + `audit-hub-shot.js` | dialog → 跳转 weather |
| 路线详情 | `audit-route-detail.js` | 真实路线渲染 |
| manifest | `gen-manifest.js` | 111 条记录 |

## 2. 关键 data 回读（证明界面状态真实）

| 时点 | 回读 |
|---|---|
| HOME | `loading=false denied='' cards=152` |
| DISCOVER | `cards=50`，emptyTitle「还没有发布的活动」 |
| ME | `loading=false denied=''`，data keys=30 |
| editor step0 | `missing=活动名称、出发时间、预计结束时间、报名截止时间、至少 1 个集合上车点` |
| editor chip 后 | `dt={2026-10-24 08:00}`、end 16:00、deadline 10-23 08:00；missing→「至少 1 个集合上车点」 |
| editor 集合点后 | `pickups=1 publishReady=true` |
| editor 发布 | `publishOpen=true` → confirm → **`savedId=activity-mvhyq03v1zfgrj`**，页面销毁跳转 activity 详情 |
| SIGNUP 提交 | `busy=false failure=''`，**`errors` 158 条**（界面零提示，ISS-001） |
| WEATHER real-query | `loading=false denied=''`，真实 7×24 序列渲染 |
| WEATHER-CHART | `ready=true hasData=true` |

## 3. 环境问题与根因（已解决，留证）

**首轮 ME/WEATHER 白屏**：
- 症状：`page.data()` 返回空（仅 `__webviewId__`），DOM view=0/5，截图纯白（8.5KB/13KB）。
- console 捕获：`Component is not found in path "wx://not-found"`。
- 排查：40 个 json 组件引用链脚本扫描全部完整；`space-time/roam-scrubber` 文件均在；wxs 均在。⇒ 非静态缺失。
- 根因：`cli open` 后仅等 40s 即 `auto`，编译未完成，模拟器仍为**旧 bundle**（playbook §2 明确记载此坑：「只调 auto 不会重新编译」）。
- 修复：`cli close` → `open` → 等 55s → `auto` 重连。ME keys=30、WEATHER keys=53，console 错误消失。
- 处置：首轮 manifest 与截图**作废**（`capture-manifest.round1-invalid.json` 留证，截图已删），不采信、不混入正式 manifest。

**组织者页首轮全 denied**：URL 用了 `?activityId=`，实际页面读 `options.id`。属审计脚本参数错误，非产品缺陷；修正后重跑成功。

**overlay 内按钮点不到**：`page.$$('.button') 查不到 overlay slot 内按钮`（playbook §5 记载）。解法：`page.$$('view')` 文本匹配 + overlay 面板作用域双通道，最终以 view 文本匹配点中「确认发布」。

## 4. 未执行项及原因

| 项 | 原因 |
|---|---|
| `node tools/check.js` 等仓库门禁 | 本轮为只读审计 + 截图，**零业务代码改动**；skill §4 规定静态门是改动后必跑项，无改动不适用。门禁历史状态（62 套/4260 断言）以仓库 AGENTS.md 与 SYNC.md 为准，本轮未重新验证 |
| `tools/e2e-*-test.js` 真机套件 | 需重开共享开发者工具会话（可能影响并行开发任务），未擅自执行 |
| 多机型/多视口适配实测 | 时间与范围所限，统一 375px 视口；适配结论以源码分析为准并在 design-system-audit.md 标注「未确认」处 |
| 报名提交成功态 | 见 `blockers.md` B2 |
