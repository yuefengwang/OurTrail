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
| 通知 Tab | `pages/notices` | 全部与我有关的通知、已读、组织者发布/复制/投递记录 |
| 我的 Tab | `pages/me` | 常用资料、常用同行人、协作身份码、位置授权撤回 |
| 活动详情 | `pages/activity` | 状态视图、我与同行人、路线/集合/风险/装备/费用、自助操作弹层、分享 |
| 报名 | `pages/signup` | 多人整组报名、同行人授权、满员整组候补；编辑模式按用途读取 |
| 编辑器 | `pages/editor` | 三步编辑（内容时间/路线集合/招募风险）、从我组织的活动复制、发布 |
| 工作台 | `pages/workspace` | 总览待办、名单、分车、现场四分区；阶段推进（带门槛校验） |
| 名单面板 | `components/roster-panel` | 筛选、批量审核/递补/取消、导出（复制+审计）、协作授权管理 |
| 分车面板 | `components/transport-panel` | 车辆档案、自动分车预览/提交、手动指派/交换、座位示意 |
| 现场面板 | `components/field-panel` | 签到/出发核实/节点/到家/返程/异常/位置，组织者与协作共用 |
| 协作任务 | `pages/staff` | 现场协作者的专属视角（field-panel staff 版） |
| 本车任务 | `pages/vehicle` | 车辆联络人：去程/返程逐人清点、发车/完成 |
| 天气 | `pages/weather` | 路线关键点真实预报（Open-Meteo，云函数代理+缓存）、天气提醒草稿 |
| 合规 | `pages/privacy`、`components/privacy-popup` | 隐私指引与授权弹窗（沿用 V1 已过审配置） |

## 目录结构

```
project.config.json          小程序项目配置
miniprogram/
  app.json / app.js / app.wxss   设计系统（tokens + 组件样式全局化）在这里
  custom-tab-bar/                自定义底部导航（活动/通知/我的）
  components/                    icon(SVG data URI)/overlay/status-panel/person-row/
                                 form-field/activity-card/field-panel/roster-panel/
                                 transport-panel/privacy-popup
  utils/
    api.js           云函数调用封装（read/dispatch + Result 解包）
    draft.js         本地草稿 + 最近查看活动
    format.js        北京时间格式化 + 各类文案映射
    notices-page.js  通知页共享逻辑（Tab 与活动内两处复用）
  pages/               home notices anotices me activity signup editor
                       workspace staff vehicle weather privacy
cloudfunctions/trailApi/
  index.js             11 个 action 路由（read/readForm/.../dispatch/getWeather）
  store.js             持久层：按集合存文档（ot_*），事务内 revision CAS
  domain/              由原型 domain 层逐段移植：
                       schema(校验器)/permissions/invariants/commands/
                       activity/signup/transport/field/profile/notices/
                       allocation/selectors/contracts
  lib/weather.js       Open-Meteo 代理（沿用）
  smoke-test.js        领域层冒烟测试（node smoke-test.js，40 项）
tools/check.js         静态校验（JS/WXML/WXSS/app.json/组件引用）
SYNC.md                落地过程的进度同步文档（含架构决策）
docs/prototypes/ourtrail-app/   v1 高仿真原型（React，设计基准）
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

## 上线检查清单（沿用 V1 要求）

- [x] 隐私合规：`pages/privacy/privacy` + 全局授权弹窗已内置；公众平台「用户隐私保护指引」
      勾选 位置信息/手机号码/身份信息/联系人信息，隐私政策路径 `pages/privacy/privacy`。
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

## 已知边界与后续

- 云函数事务每次写 diff（按记录），V1 规模（几十场活动）性能足够；事件/通知/回执自动限量。
- 订阅消息推送、座位拖拽排序、模板删除入口等仍列 V1.1 候选。
