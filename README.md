# OurTrail · 一次活动，一套协作（小程序 V1）

熟人圈子的户外同行履约工具：**零金额、纯工具**。围绕一条闭环设计——
发起人建活动 → 分享到群 → 群友填一次报名 → 发起人用同一份名单完成审核、分车、签到、收尾、导出。

本版前端与领域逻辑按高仿真原型 `docs/prototypes/ourtrail-app`（v1 设计）整体落地：
森林绿/嫩叶绿设计系统、自定义 TabBar（活动/通知/我的）、七阶段活动流程、
审批制报名与候补、分车预览、现场履约（签到/上车/出发核实/节点/位置/到家/异常）、
协作授权（现场协作 + 车辆联络）、站内通知与导出审计。

## 功能地图

| 模块 | 页面/组件 | 内容 |
|---|---|---|
| 活动 Tab | `pages/home` | 三视角合并列表（我的/最近/已结束）、协作任务入口、搜索、精选卡 |
| 发现 | `pages/discover` | 已发布且未开始活动的只读发现列表、关键词搜索（ADR-0003，独立窄投影，不泄露 openid 与集合点） |
| 通知 Tab | `pages/notices` | 全部与我有关的通知、已读、组织者发布/复制/投递记录 |
| 我的 Tab | `pages/me` | 常用资料（微信头像/昵称/一键手机号同步，无验证码）、常用同行人、协作身份码、位置授权撤回 |
| 活动详情 | `pages/activity` | 状态视图、我与同行人、路线/集合/风险/装备/费用、自助操作弹层、分享 |
| 报名 | `pages/signup` | 多人整组报名、同行人授权、满员整组候补；编辑模式按用途读取 |
| 编辑器 | `pages/editor` | 三步编辑（内容时间/路线集合/招募风险）、**GPX 轨迹导入**（自动解析节点/里程/爬升）、从我组织的活动复制、发布 |
| 工作台 | `pages/workspace` | 总览待办、名单、分车、现场四分区；阶段推进（带门槛校验） |
| 名单面板 | `components/roster-panel` | 筛选、批量审核/递补/取消、导出（复制+审计）、协作授权管理 |
| 分车面板 | `components/transport-panel` | 车辆档案、自动分车预览/提交、手动指派/交换、座位示意 |
| 现场面板 | `components/field-panel` | 签到/出发核实/节点/到家/返程/异常/位置，组织者与协作共用 |
| 协作任务 | `pages/staff` | 现场协作者的专属视角（field-panel staff 版） |
| 本车任务 | `pages/vehicle` | 车辆联络人：去程/返程逐人清点、发车/完成 |
| 天气 Tab | `pages/weather-hub` | 独立天气模块首页：地图选点 / 输入经纬度（含 WGS-84 开关）/ 导入 GPX 三种入口，本地观察点与轨迹点组管理（免档案、免活动） |
| 天气查询 | `pages/weather` | 三种模式共用：活动流（节点→天气，含天气提醒草稿）与自由查询（单点/轨迹组，抵达日程、保存/分享降精度）；Open-Meteo 云函数代理+缓存、**天相结论卡**（云海/日照金山/星空/银河/彩虹/晨昏光） |
| 天气全图 | `pages/weather-chart` | 横屏整屏看 7×24 小时 meteogram 时间坐标图（数据经 `utils/chart-store.js` 交接，不走 URL） |
| 天相图表 | `components/meteogram` | canvas 自绘 meteogram：温度线/降水双柱/三层云量/天相窗口标记/日时轴（几何抽到 `layout.js` 供测试断言） |
| 时空天相图 | `components/space-time` | **P4**：把「时间×数值」补成「时间×海拔」——云层带 + 逐节点天相渐变轨迹 + 主窗口括号 + 抵达净空。几何抽到 `layout.js`，天相判定复用 `utils/sky.js`（不自建阈值） |
| 漫游滑块 | `components/roam-scrubber` | 拖动/播放走完这一天。**哑控件**：不认识天相也不认识轨迹，读数由 `space-time` 算好后经 slot 传入，避免同一份天相算两遍 |
| 合规 | `pages/privacy` | 隐私指引（公众平台登记路径）。**全局授权弹窗已下线**：`components/privacy-popup` 组件文件按 2026-09-27 决策保留，但已从 `app.json` 注销、不再挂载 |

## 目录结构

```
project.config.json          小程序项目配置
miniprogram/
  app.json / app.js / app.wxss   设计系统（tokens + 组件样式全局化）在这里
  custom-tab-bar/                自定义底部导航（活动/天气/通知/我的）
  components/                    icon(SVG data URI)/overlay/status-panel/person-row/
                                 form-field/activity-card/field-panel/roster-panel/
                                 transport-panel/meteogram/space-time/privacy-popup(已注销，保留文件)
  utils/
    api.js           云函数调用封装（read/dispatch + Result 解包）
    draft.js         本地草稿 + 最近查看活动
    format.js        北京时间格式化 + 各类文案映射
    notices-page.js  通知页共享逻辑（Tab 与活动内两处复用）
    gpx.js           GPX 解析 + GCJ↔WGS 坐标转换
    astro.js/sky.js  天文层与天相概率判断（纯计算，客户端侧）
    weather-model.js P4 轨迹层编排：逐时插值/逐节点天相/连续段/评分（纯计算；**天相阈值一律委托 sky.js**）
    route-schedule.js  GPX 时间戳 → 各节点第几天抵达
    chart-store.js   天气页 → 横屏图页的内存交接
    watch-points.js  观察点/轨迹点组（纯 util，storage 注入；P3 独立天气）
    util.js          脱敏/距离/名单导出等纯函数
  pages/               home discover notices anotices me activity signup editor
                       workspace staff vehicle weather weather-chart weather-hub privacy
                       lab（开发者预演面板，仅白名单账号可用，无入口——用编译模式直达）
cloudfunctions/trailApi/
  index.js             13 个 action 路由（read/readForm/.../dispatch/getWeather/getWeatherByPoint/getPhoneNumber）
  store.js             持久层：按集合存文档（ot_*），事务内 revision CAS
  domain/              由原型 domain 层逐段移植：
                       schema(校验器)/permissions/invariants/commands/
                       activity/signup/transport/field/profile/notices/
                       allocation/selectors/contracts
  lib/weather.js       Open-Meteo 代理（沿用）
  smoke-test.js        领域层冒烟测试（node smoke-test.js，167 项）
tools/                 零依赖 node 脚本，无 root package.json、无 npm test：
  check.js             静态门禁：JS 语法/WXML 配平/WXSS 花括号/app.json 页面齐全/
                       组件引用（正向 + 反向注册）
  check-handlers.js    WXML bind* ↔ JS handler 交叉审计；并校验 checkbox-group/radio-group
                       的 change 处理函数所读 dataset 键确实挂在该 group 标签上
                       （真机勾选同行人失效那次的回归闸）
  e2e-result.js          E2E 结果账本：BUSINESS/UI 两维 × PASS/FAIL/INCONCLUSIVE，退出码
                       0/1/2；含源码完整性自检 auditSource（被三套 E2E 脚本复用）
  *-test.js            40 个套件 = 20 个纯逻辑回归（天文/GPX/天相/日程/天气契约/Weather V2
                       云场全链与真实 draw() 执行/视觉保真审计）+ 11 个页面级场景 + 2 个
                       trailApiLab 集成（stub wx-server-sdk，含剧本离线干跑）+ 4 个 A 层
                       端到端（服务链路/结果模型变异自证/权限矩阵/Domain 负矩阵）+
                       3 个需开发者工具；37 个可无头进门禁 + smoke = 38 门禁套件（见下「测试」）
  sync-lab.js          把 trailApi 的 domain/store 同步进 trailApiLab（部署 lab 前跑）
  gen-map-markers.js   地图 marker PNG 生成器（写文件，非常驻脚本）
cloudfunctions/trailApiLab/   预演工具（私有测试用）：以合成演员身份执行预演剧本，
                       让单人即可在真机走完多人业务全流程；部署与用法见其 lab.config.js
                       与 SYNC.md 2026-09-29 条目
SYNC.md                落地过程的进度同步文档（含架构决策）
AGENTS.md              分层知识库：起手先读，子目录另有 AGENTS.md
docs/prototypes/ourtrail-app/   v1 高仿真原型（React，设计基准；已冻结，勿改勿跑）
```

## 数据与安全模型（与原型一致）

- **命令式后端**：客户端只提交 `{payload, requestId, expectedRevision}`；授权、阶段校验、
  名额/座位/同车组等不变量全部在云函数 domain 层执行，客户端不可绕过。
- **幂等与并发**：requestId 回执防重放；revision 乐观并发（冲突返回 CONFLICT，客户端重读）。
- **敏感资料**：紧急联络/健康备注必须「注明用途」按次读取；导出敏感名单先写审计（export.record）。
- **位置**：仅本人主动一次性上报（wx.getLocation），授权随活动结束失效，可随时撤回；超 30 分钟标记已过时。
- **身份**：actor = OPENID（服务端注入）。协作授权通过「身份码」（openid）面对面传递。

## 数据集合

`ot_meta`（revision）、`ot_profiles`、`ot_routes`、`ot_activities`、`ot_groups`、`ot_signups`、
`ot_vehicles`、`ot_assignments`、`ot_memberships`、`ot_attendance`、`ot_positions`、
`ot_incidents`、`ot_events`、`ot_notices`、`ot_receipts`、`weather_cache`（天气缓存）。
首次部署自动创建。旧版集合（`activities`/`signups`/`templates`）不再读写，可在云控制台归档。

## 部署（约 10 分钟）

1. **微信开发者工具**导入本目录（`project.config.json` 已配好 `miniprogram/` 与 `cloudfunctions/`，AppID 已填）。
2. **开通云开发**（若未开通）：工具栏「云开发」→ 记下环境 ID → 确认 `miniprogram/config.js` 的 `CLOUD_ENV` 一致。
3. **部署云函数**：右键 `cloudfunctions/trailApi` →「上传并部署：云端安装依赖」。
   本地可先跑 `node cloudfunctions/trailApi/smoke-test.js` 与 `node tools/check.js` 自检。
4. 编译运行。首页「发起活动」→ 保存草稿 → 发布 → 分享到微信群 → 另一台手机报名验证闭环。

## 测试

无 root `package.json`、无 `node_modules/`、无 lint/format/typecheck。全部是零依赖 node 脚本，
从仓库根目录裸跑，每个自报 `passed=N failed=N` 并以退出码表态：

```bash
node tools/check.js && node tools/check-handlers.js && \
node cloudfunctions/trailApi/smoke-test.js && node tools/astro-test.js && \
node tools/gpx-test.js && node tools/sky-test.js && node tools/route-schedule-test.js && \
node tools/weather-page-test.js && node tools/watch-points-test.js && \
node tools/weather-model-test.js && node tools/space-time-test.js && \
node tools/space-time-draw-test.js && node tools/roam-scrubber-test.js && \
node tools/weather-v2-test.js && node tools/meteogram-draw-test.js && \
node tools/cloud-field-svg-test.js && node tools/weather-cloud-field-test.js && \
node tools/meteogram-svg-test.js && node tools/meteogram-multiday-test.js && \
node tools/outdoor-cloud-sea-test.js && node tools/outdoor-intelligence-test.js && \
node tools/outdoor-intelligence-ui-test.js && node tools/weather-v2-visual-audit-test.js && \
node tools/e2e-test.js && node tools/e2e-fault-probe-test.js && \
node tools/e2e-permission-test.js && node tools/e2e-domain-negative-test.js && \
node tools/scenario-api-test.js && node tools/scenario-editor-test.js && \
node tools/scenario-signup-test.js && node tools/scenario-workspace-test.js && \
node tools/scenario-me-test.js && node tools/scenario-notices-test.js && \
node tools/scenario-activity-test.js && node tools/scenario-staff-test.js && \
node tools/scenario-vehicle-test.js && node tools/scenario-discover-test.js && \
node tools/scenario-lab-test.js && node tools/trailapilab-test.js && \
node tools/lab-dryrun-test.js
```

共 **38 个套件**（断言总数是快照，2026-10-07 全量复跑测得 2488 —— 本仓库常有并行工作增删用例，**以各脚本自己打印的 `passed=N` 为准**）：
`smoke` 167（领域层，不需 wx-server-sdk）· `astro` 60 · `gpx` 57 · `sky` 65 · `route-schedule` 41 ·
`weather-page` 136（云函数→页面→组件契约）· `watch-points` 37 ·
`weather-model` 82（P4 轨迹层编排）· `space-time` 109（P4 几何 + 漫游读数）·
`space-time-draw` 55（执行真实 `draw()`，记录式 2D 上下文）· `roam-scrubber` 33（漫游控件定时器与事件）·
Weather V2 渲染链（`weather-v2` 45 / `meteogram-draw` 30 / `cloud-field-svg` 27 /
`weather-cloud-field` 29 / `meteogram-svg` 25 / `meteogram-multiday` 44 / `outdoor-cloud-sea` 20 /
`outdoor-intelligence` 24 / `outdoor-intelligence-ui` 46 / `weather-v2-visual-audit` 38——
跨宽度几何归一化 / YOU 锚点 / covered 透传 / OI 卡契约）·
页面级场景（editor 142 / activity 136 / workspace 111 / signup 103 / me 143 / notices 67 /
vehicle 56 / api 27 / discover 21 / lab 20 / staff 18）· lab 集成（lab-dryrun 165 / trailapilab 25）·
**`e2e` 71（A 层服务链路端到端：页面真实信封 → trailApi `exports.main` 真实路由/CAS/幂等/overrideEvidence →
内存库落库 → 读动作回读验证；全业务链建档→发布→报名→审核→分车预览提交→改派（含 SEAT_TAKEN 负向）→
现场→归档 + 权限边界；座位期望值由 fixture 输入 + 分配规则推出，不回读实际座号自证）**·
**`e2e-fault-probe` 34（结果模型变异自证：降级伪装 PASS / 恒真断言 / callMethod 绕过 / 空 catch /
门槛静默 / fire-and-forget 各自都必须让结论变非绿）**·
`e2e-permission` 96（A 层权限矩阵：角色×命令×阶段×归属）·
`e2e-domain-negative` 83（Domain 负矩阵：17 种错误码确定性拒绝 + 败者零副作用快照对比）.
`check.js` 是提交前铁律，`check-handlers.js`
补它抓不到的一类（`node --check` 无法发现未定义标识符）。

另有 **UI 端到端** `node tools/e2e-ui-test.js`（不计入上列门禁，且只有装了开发者工具的那台机器能跑）：
通过自动化端口驱动真实模拟器——真实渲染、真实原生组件事件、真实云端读写。前置：工具已登录并打开本项目、
设置→安全→打开「服务端口」；依赖自动装到 `~/.ourtrail-e2e`（仓库保持零依赖）。
**结论语义**：权威结论是 `==== VERDICT ====` 两维账本，不是单一 `passed=N`——
BUSINESS（后端状态对不对）与 UI（用户在界面上做没做成）各自定档 PASS/FAIL/INCONCLUSIVE，
退出码 0=全绿 / 1=确有失败 / 2=无法验证。UI 的一条 PASS 必须由「一次真实 tap/input + 它的后果观测」
构成；云侧 fallback 只能证 BUSINESS，替 UI 做完动作即记 `UI 未验证`。
语义定义见 `docs/testing/e2e-result-semantics.md`，判别力自证见 `tools/e2e-fault-probe-test.js`。
工作台段沿用 trailApiLab 预演能力（建 `[预演]` 沙盒活动 → lab 阶段 0/1 演员报名 → 工作台对账/审核/分车）。
**注意**：需要 trailApiLab 部署版含批量重构与 timeout 20，否则 lab 阶段可能超时（脚本会幂等重试并给出指引）；
沙盒活动收尾为 cancelled，可在预演面板 cleanup 清理。

> `space-time-draw` / `roam-scrubber` 是 canvas 组件的**执行级**回归：
> 它们真的把 `draw()` 跑起来并断言图元与色值，但**不等于视觉验证**——
> 像素级效果与滑块手感仍需微信开发者工具真机确认。

## 上线检查清单（沿用 V1 要求）

- [x] 隐私合规：`pages/privacy/privacy` 隐私指引已内置；公众平台「用户隐私保护指引」
      勾选 位置信息/手机号码/身份信息/联系人信息，隐私政策路径 `pages/privacy/privacy`。
      （全局授权弹窗已于 2026-09-27 下线，见功能地图「合规」行。）
- [ ] 订阅消息（可选）：公众平台申请模板后把 ID 填入 `miniprogram/config.js`；
      未配置时站内通知照常可用，「复制通知」走剪贴板兜底并留投递记录。
- [ ] 类目建议：旅游 > 旅游工具（或生活服务），不做救援/保险承诺。
- 公众平台提交信息（名称/简介/截图/版本备注）沿用 V1 文案，把「山野同路」替换为「OurTrail」即可。

## 与原型的差异（有意为之）

- 「演示工具」（账号切换/时钟/离线）不随产品落地；身份即 OPENID。
- 原型的「模拟位置上报（选路线点）」改为真实定位一次性上报；签到优先定位签到，
  定位不可用时退回人工签到（需填写现场说明）。
- 模拟天气改为真实 Open-Meteo 预报；导出名单改为复制到剪贴板（CSV 文本）。
- 车辆联络人页的分车入口由组织者在名单面板的「协作授权」里绑定（车辆联络角色）。
- 个人资料以微信获取为准：头像走 `chooseAvatar`（存云存储 fileID）、昵称走 `type=nickname`
  键盘点选、手机号走 `getPhoneNumber` 一键授权（服务端换码，无验证码）。
  「手机号快速验证」需小程序完成认证并开通对应权限，未开通时提示手填兜底。

## 已知边界与后续

- 云函数事务每次写 diff（按记录），V1 规模（几十场活动）性能足够；事件/通知/回执自动限量。
- 订阅消息推送、座位拖拽排序、模板删除入口等仍列 V1.1 候选。
