# UI/UX 问题清单（14 条，全部附证据）

> 判定口径：每条区分「规范偏离」与「体验缺陷」；截图路径相对于 `screenshots/`，源码路径相对于 `miniprogram/`。置信度：高=有截图或 data 回读双证；中=单证 + 源码推断；低=仅源码推断。

---

### ISS-001 报名提交校验失败，界面零反馈
- **页面/截图**：SIGNUP；`registration/SIGNUP_06_submit-result.png`、`SIGNUP_08_submit-result2.png`
- **用户目标**：提交报名
- **观察**：点「提交报名」后界面无任何变化（无红字、无 toast、无滚动定位、按钮无 loading 态）；而 `page.data().errors` 同期有 **158 条**（79 个参与人候选 ×「请确认本次活动的数据使用授权」+「代报名需要同行人明确授权」）。
- **证据**：截图 + data 回读；错误产生于 `pages/signup/signup.js:340-355`（validate）与 `:415-455`（submit）。
- **影响**：用户反复点击无果，无法知道缺什么、缺在哪里；对「代报名需授权」这类合规要求完全无感知。
- **类别**：状态反馈 / 表单
- **优先级**：**P1**
- **改进方向**：提交失败时①顶部/底栏汇总条（N 人待确认授权，点它展开）；②自动展开第一张出错参与人卡（代码已有 `expandedParts` 自动展开机制，但显然未覆盖本次路径）；③按钮短 loading + 失败后恢复。
- **源码**：`pages/signup/signup.js:415-455`、`wxml:234-245`
- **置信度**：高

### ISS-002 报名「选择参与人」81 个历史候选平铺
- **页面/截图**：SIGNUP；`registration/SIGNUP_05_form-filled.png`
- **用户目标**：选这次和谁同行
- **观察**：第 1 步把所有历史同行人候选全部平铺（实测 checkbox 查询 238 个节点、候选 81 人量级），无搜索、无分组、无「最近同行」、无默认选中策略说明。
- **证据**：截图 + DOM 查询读数；候选来源 `signup.js` candidates 装配。
- **影响**：常用同行人少的用户尚可，组织过多次活动后列表无限增长；选错人直接把陌生人带进活动。
- **类别**：信息架构 / 表单
- **优先级**：**P1**
- **改进方向**：搜索框 + 「最近同行」分组 + 每行副标显示历史同行情境；勾选状态在收合卡上也要可见。
- **源码**：`pages/signup/signup.wxml:103-118`
- **置信度**：高

### ISS-003 路线库 sheet 选中路线后不自动关闭
- **页面/截图**：ACT-CREATE；`activity-create/ACT-CREATE_05_route-library-sheet.png` → `06_step1-route-applied.png`
- **用户目标**：从路线库选一条路线带入活动
- **观察**：tap 路线行后路线数据异步应用，但 sheet 保持打开；后续所有点击被遮罩吞掉（playbook 记载「弹层开着时遮罩吞点击是正确行为」⇒ 用户视角就是「点了没反应」）。实测必须手动点 × 或调 `onQuickRouteClose` 才能继续。
- **证据**：截图时序（05→12 多张同画面）+ 数据回读（quickRouteOpen 持续 true）。
- **影响**：选完路线后页面「假死」，用户以为应用失败而重复点击。
- **类别**：交互
- **优先级**：P2
- **改进方向**：选中即关 sheet 并toast「已带入」；若刻意保持打开以便连续选择，需要多选 UI 与「完成」按钮明示。
- **源码**：`pages/editor/editor.js:801`（onQuickRoutePick，无关闭调用）
- **置信度**：中（不排除刻意设计，但无多选 UI 佐证）

### ISS-004 步骤切换不校验，发布时错误集中爆发
- **页面/截图**：ACT-CREATE；`activity-create/ACT-CREATE_02b_next-no-required.png`、`ACT-CREATE_26_publish-validation-failed.png`
- **用户目标**：创建活动
- **观察**：空表单可一路点「下一步」到 step4；点「发布活动」才一次性报「还差：活动名称、出发时间、预计结束时间、报名截止时间、至少 1 个集合上车点」并跳回 step0。
- **证据**：两张截图 + failure 回读。设计意图见 spec `docs/superpowers/specs/2026-10-14-quick-create-deferred-route.md`（可后补 = 有意为之）。
- **影响**：「先发布后补」策略下，用户走到最后一步才看到全部欠项；5 项红字一屏爆发，修复路径靠「去补上」补救。
- **类别**：表单 / 状态反馈
- **优先级**：P2
- **改进方向**：保留快速发布，但①步骤条上给欠项小圆点计数；②每步顶部一条「本步还需 X」的行内提示（不拦切换）。
- **源码**：`pages/editor/editor.js:1073`（nextStep 无门）、`:1211-1222`（onPublishIntent）
- **置信度**：高

### ISS-005 无参深链打开天气页得开发者式错误
- **页面/截图**：WEATHER；`weather/WEATHER_01_initial.png`
- **用户目标**：（深链/分享失效后）看天气
- **观察**：无参打开显示 denied「缺少活动编号。」
- **证据**：截图 + data 回读（`weather.js:249`）。
- **影响**：面向终端用户暴露内部参数名；正确出路（去 hub 重新选点）没有给出（denied 无 action）。
- **类别**：状态反馈
- **优先级**：P2
- **改进方向**：改为「这个天气链接已失效，去天气页重新选点」+ action 跳 hub。
- **源码**：`pages/weather/weather.js:249`
- **置信度**：高

### ISS-006 ME 自动保存无持久确认
- **页面/截图**：ME；`navigation/ME_01_initial.png`
- **用户目标**：维护同行资料
- **观察**：输入停止 800ms 自动落库，成功只闪 2 秒「已保存」(`flashSaved`)；截图时点未见任何持久保存状态指示。
- **证据**：截图 + `pages/me/me.js:156-162`、`:270-276`。
- **影响**：用户不确定资料是否存上；紧急联系人这类安全字段缺持久确认尤甚。
- **类别**：状态反馈
- **优先级**：P2
- **改进方向**：字段行级「已保存 HH:mm」持久小字 + 失败时该行红字可重试（现在失败只进页面级 error）。
- **源码**：`pages/me/me.js:156-162`
- **置信度**：中

### ISS-007 集合点半自动：起点能生成、地址必须手补
- **页面/截图**：ACT-CREATE；`activity-create/ACT-CREATE_07_pickup-manual.png`
- **用户目标**：设置集合点
- **观察**：「用路线起点生成集合点」自动带坐标与名称，但 `address` 刻意留空（`autoPickupFor` 注释明说），而发布门要求地址齐全 ⇒ 半自动。
- **证据**：源码 `pages/editor/editor.js:546-567`、`:894-921`；截图 07。
- **影响**：「自动生成」预期被一句必须手写的地址打断；用户不知道该写到多细。
- **类别**：表单
- **优先级**：P2
- **改进方向**：生成时用路线起点名 + 「从 X 进入」模板预填地址草稿，用户可改；或把地址降级为可后补（与风险同级）。
- **源码**：`pages/editor/editor.js:546-567`
- **置信度**：高

### ISS-008 天气页单页 10+ 模块，密度失控
- **页面/截图**：WEATHER；`weather/WEATHER_01~04_*_real-query.png`、`WEATHER_03~05_from-hub*.png`
- **用户目标**：出发前判断天气与天相
- **观察**：单页依次承载：免责 callout、点卡、日期 picker、生成草稿入口、逐时天气 section、全图按钮、7 日条、24/48/72 切窗、meteogram/云剖面卡、OI 机会卡（24h 列表/按日分组）、时空天相图、今日户外时间轴、安全 callouts、户外总评 + cond-pheno 卡 + 沉默项、全字段逐时表、出处。截图显示首屏以下信息层级密集、卡片样式多套并存（`.timeline-card`/`.cloud-field-card`/`.oi-card`/`.num-sheet`）。
- **证据**：截图 + `pages/weather/weather.wxml` 结构（审计记录在案）。
- **影响**：用户难以形成「先看什么」的稳定心智；概率语气免责与结论卡的权重关系不清。
- **类别**：视觉层级 / 信息架构
- **优先级**：P2
- **改进方向**：重排为「结论 → 关键窗口 → 细节」三层，首屏只放总评 + 今日时间轴；逐时全字段表移入二级页或按需展开。
- **源码**：`pages/weather/weather.wxml:53-466`
- **置信度**：高

### ISS-009 首页三视角全量并发读 + 152 卡全量渲染
- **页面/截图**：HOME；`navigation/HOME_02_scroll.png`
- **用户目标**：看与我有关的活动
- **观察**：`reload` 并发 3 个 `read({kind:'home'})`（participant/staff/vehicle，各带 openedActivityIds）+ profile；实测账号 cards=152 全量进 data 再本地过滤。
- **证据**：截图 + data 回读 + `pages/home/home.js:47-50`。
- **影响**：组织/参加活动多的账号首屏等待与渲染成本高；搜索为本地过滤尚可，但初始 payload 全量。
- **类别**：性能
- **优先级**：P2
- **改进方向**：按当前 filter 只读一个视角（切档再读）；卡片分页/虚拟化；统计计数走轻量接口。
- **源码**：`pages/home/home.js:43-71`
- **置信度**：中

### ISS-010 `window.backgroundColor` 与 `--paper` 不同源
- **页面/截图**：全局；`navigation/*`（下拉回弹时可见）
- **观察**：`app.json` window.backgroundColor = `#F5F5F0`，而 token `--paper` 已改为 `#F6F3EC`（2026-10-16 暖化）。
- **证据**：`app.json:29` vs `app.wxss:10`（审计记录）。
- **影响**：下拉刷新/ Overscroll 时露出旧底色，与页面纸面底不一致。
- **类别**：一致性
- **优先级**：P3
- **改进方向**：window 值改引 token 同值或接受为已知登记项。
- **源码**：`miniprogram/app.json:29`
- **置信度**：高

### ISS-011 报名提交的错误对象 158 条重复文案
- **页面/截图**：SIGNUP；同 ISS-001
- **观察**：errors 以 `p{n}-dataUse` / `p{n}-proxyAuthority` 平铺 79 组，每组两条**完全相同**的文案。
- **证据**：data 回读（本次运行输出）。
- **影响**：即便未来把 errors 渲染出来，按现状平铺将是 158 行重复红字——必须先聚合再展示。
- **类别**：表单 / 状态反馈
- **优先级**：P2（与 ISS-001 同批修复）
- **改进方向**：按错误类型聚合为「N 人待确认数据使用授权 / M 人待代报名授权」两行 + 展开定位。
- **源码**：`pages/signup/signup.js:340-355`
- **置信度**：高

### ISS-012 TabBar 无未读徽标/红点
- **页面/截图**：全局；`navigation/NOTICES_01_initial.png`
- **观察**：自定义 TabBar `data` 只有 `selected` 与 `list`，无 badge 能力；通知未读只在 notices 页内以边线 + badge 表达。
- **证据**：`custom-tab-bar/index.js:5-13`（审计记录）+ 截图。
- **影响**：用户切换到「通知」前不知道有新消息。
- **类别**：可访问性 / 信息架构
- **优先级**：P3
- **改进方向**：自定义 TabBar 支持数字/红点（数据源 notices read 已有未读概念）。
- **源码**：`miniprogram/custom-tab-bar/index.js`
- **置信度**：高

### ISS-013 编辑活动步骤条可达性：ready 后底部主按钮变「发布活动」，「下一步」消失
- **页面/截图**：ACT-CREATE；`activity-create/ACT-CREATE_08_pickup-filled.png` → `23_step4-publish.png`
- **观察**：集合点补齐（ready=true）后，step1 底部主按钮直接是「发布活动」（设计如此：快速发布路径），想继续完善 step2/3 只能点步骤条。实测第一版流程脚本因此卡住（找不到「下一步」）。
- **证据**：截图 + `pages/editor/editor.wxml:626-637`（审计记录）。
- **影响**：新用户不知道步骤条可点；「完善资料」的路径比「直接发布」隐藏得更深。
- **类别**：交互
- **优先级**：P3
- **改进方向**：ready 后底栏保留「继续完善」次级按钮（wxml 已有该按钮，需评估其显眼度）。
- **源码**：`pages/editor/editor.wxml:626-637`
- **置信度**：中

### ISS-014 长页滚动后 TabBar 遮挡风险由各页自行留白兜底
- **页面/截图**：HOME/NOTICES/ME/WEATHER-HUB 底部
- **观察**：Tab 页底部留白 `calc(32px + 84px + env(safe-area-inset-bottom))` 写在**四个 tab 页各自的 wxss**（非全局 `.page`）；非 Tab 子页不留。新增页面极易漏配。
- **证据**：源码审计记录（`home.wxss:6`、`me.wxss:4`、`notices.wxss:6`、`weather-hub.wxss:7`；`app.wxss:86-97` 有 12 行注释解释为何不收进全局）。
- **影响**：漏配页面「列表最后几行被 tabBar 拦腰截断、按钮点不到」。
- **类别**：可访问性 / 一致性
- **优先级**：P3（重构期一并收口）
- **改进方向**：重设计时把「是否为 Tab 页」变为 app.json 可判定的属性，留白由统一布局组件承载。
- **源码**：`miniprogram/app.wxss:86-97`
- **置信度**：高

---

## 汇总

| 优先级 | 数量 | 编号 |
|---|---|---|
| P1 | 2 | ISS-001, ISS-002 |
| P2 | 8 | ISS-003, ISS-004, ISS-005, ISS-006, ISS-007, ISS-008, ISS-009, ISS-011 |
| P3 | 4 | ISS-010, ISS-012, ISS-013, ISS-014 |
