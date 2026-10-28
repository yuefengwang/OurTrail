# 发起活动编辑器验收记录

日期：2026-10-28（北京时间）。基线：`1a9e4d3`。这是生产小程序编辑器的渲染及交互验收，不是 HTML 原型验收。未提交、未推送、未上传小程序、未发布活动；`cloudfunctions/` 零改动，不需要重新部署 trailApi。

## 1. 环境与证据范围

- 微信开发者工具 2.02.2609231 RC，基础库 3.8.12，WebView 渲染。
- 用户明确授权关闭并重开 OurTrail 项目；没有退出整个开发者工具。重开后才运行驱动，新标签「基本／路线／介绍／发布」在画面与页面读数中同时出现。
- `width-375/`：iPhone 12/13 mini，375×812，DPR 3。
- `width-390/`：iPhone 12/13 (Pro)，390×844，DPR 3。
- `width-414/`：Mac 21-inch and above，414×896，DPR 2。仅作为第三档视口宽度，**不是 iPhone 或物理手机测试**。
- 页面真实加载当前业务 WXML/WXSS/JS；地图结果、云函数响应、存储均受控。保存只记入隔离内存，最终发布命令被驱动禁止。
- 每轮含填写完整与重新进入空白表单两个独立用例；第二例清空的是测试内存，不删除用户真实草稿。结束时还原被替换的 API 并断开自动化，恢复原 390px 模拟器。

## 2. 结构对照

基于 `git show 1a9e4d3:miniprogram/pages/editor/editor.wxml` 与本轮 WXML 比较，不通过修改线上数据建立对照：

| 项目 | 修改前 | 修改后 |
|---|---|---|
| 集合点 | 路线工作面后段 | 基本工作面，时间之后 |
| 风险与装备 | 发布工作面 | 路线工作面 |
| 费用与取消约定 | 发布工作面 | 介绍工作面 |
| 必填齐后的前几步主按钮 | 从下一步变成发布 | 保持下一步，另有次级核对入口 |
| 发布前回改 | 缺项跳转为主 | 当前内容摘要、逐项回改、集合点锚点 |
| form-field 数量 | 31 | 31（仅「上车点名称」改为「集合点名称」） |
| input/textarea/picker 的绑定数量 | 42 | 42，绑定 handler 名称无增删 |

中断前两次原生驱动在回改集合点后点顶部分页处超时；续跑时旧 `/tmp` 截图和读数已经不可访问，不能提供其原件，也不把它们计为通过。此处保留失败事实，改前效果以基线源码为可复核依据。

## 3. 静态与行为测试

静态门：`node tools/check.js` 与 `node tools/check-handlers.js` 均 exit 0。存量未使用 handler `editor.onNumber` 未新增、未扩大处理范围。

| 套件（tools 下） | 通过 | 失败 |
|---|---:|---:|
| scenario-editor-test.js | 245 | 0 |
| quick-create-test.js | 65 | 0 |
| content-editor-test.js | 33 | 0 |
| content-view-test.js | 14 | 0 |
| scenario-profile-gate-test.js | 19 | 0 |
| entry-layout-test.js | 41 | 0 |
| personal-route-layout-test.js | 72 | 0 |
| swx1-style-gates-test.js | 45 | 0 |
| swx2-style-gates-test.js | 110 | 0 |
| ui-consistency-test.js | 19 | 0 |
| journey-graph-test.js | 15 | 0 |
| page2-gates-test.js | 109 | 0 |
| gpx-test.js | 62 | 0 |
| **合计** | **849** | **0** |

原始输出在 `logs/`。这是相关套件回归，不声称运行了全仓所有测试。

## 4. 原生模拟器观测

三个视口分别 17 条观测断言通过，异常事件数组为空；对应 `readings.json` 和 `logs/ourtrail-editor-native-*.log`。17 条包含初态、操作后果和防写入检查，**不是 17 条全部独立 UI 点击证明**。

真实 tap/input 覆盖：名称输入、快捷时间、地图取消及选点返回、下一步保持路线而非发布、路线库空态、图文正文输入、介绍到报名、核对集合点返回、重新进入发布页、发布意图先保存后弹确认、缺必填返回基本页。路线选择器关闭和发布层关闭由 handler 驱动，不能冒充其关闭按钮已点击验收。

未实际执行 `activity.publish`。确认层能打开不代表真实云端发布成功。实际可见范围／关闭报名／自动审核的组合还由 scenario-editor 行为测试验证；模拟器路径显示默认公开、手动审核、开放报名。

驱动在回改滚动后重新取得当前页面句柄并等待渲染稳定，再查询真实页签执行 tap，最终三档均走通。旧超时与滚动／渲染时序一致，但没有足够旧日志把根因断言为某个框架缺陷。

续跑第一次在加载驱动库阶段失败：先前临时依赖目录不存在。错误保留在 `diagnostics/ourtrail-editor-native-3.log`，没有产生业务或 UI 验收结果。重新安装到仓库外 `/tmp/ourtrail-editor-native-qa` 后运行成功；仓库未新增 npm 依赖。

## 5. 画面检查

每档保存 8 张原生截图：

1. `01-basic-empty.png`：初始基本信息，没有开屏缺项告警，底栏保存和下一步可辨。
2. `02-meeting.png`：时间之后的集合点，名称、地址、时间与定位状态一起展示。
3. `03-route.png`：路线来源两入口，风险与装备同工作面；不残留上一页无操作的成功提示。
4. `04-intro.png`：正文输入与父页面数据一致，费用等低频项后置。
5. `05-review.png`：时间、集合、路线、介绍的当前摘要与逐项修改入口。
6. `06-registration.png`：名额、审核、是否开放报名、可见范围。
7. `07-publish-confirmation.png`：现有确认层显示可见范围和报名政策；较长内容在弹层内滚动，截图不是完整内容。
8. `08-required-return.png`：第二个独立空白用例从缺项入口返回基本工作面。

人工检查 390px 全部截图、375px 基本／路线／报名、414px 基本／核对／报名。所查图中页签与底栏主次按钮没有重叠，路线上两入口和核对摘要能换行；沿用既有安全区留白。长表单需滚动，不能从单张截图推断所有底部内容均已验收。

## 6. 复跑与剩余边界

先在开发者工具编译并开启自动化端口，外部安装依赖，然后从仓库根目录执行：

```sh
MP_AUTOMATOR_PATH=/tmp/ourtrail-editor-native-qa/node_modules/miniprogram-automator \
EDITOR_QA_OUTPUT=/tmp/ourtrail-editor-qa/new-run \
node tools/verify-editor-native.cjs
```

端口默认 `ws://127.0.0.1:9427`，可用 `MP_WS_ENDPOINT` 指定。每次使用新的输出目录，避免覆盖失败证据。

仍未验证：物理手机、系统大字体、横屏、真实地图授权和聊天 GPX 文件选择、图片上传及安全审核、线上并发、真实保存和最终发布。没有更改业务权限、资料门、路线阶段锁、CAS、GPX 原始元数据和本人参与独立授权，也没有增加徒步／休闲活动类型或改轨迹必传规则。
