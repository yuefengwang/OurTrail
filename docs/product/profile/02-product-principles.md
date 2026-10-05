# 02 · Product Principles（产品原则）

> 本文定义本轮重设计的判断基准。每条原则都标注它与现状代码的关系：
> 是「已被代码验证、必须保留」，还是「现状缺失、本轮补齐」。

---

## P1 · 「微信授权是实现细节，用户资料才是产品」

【DESIGN DECISION】用户在「我的」看到的词汇是**头像、昵称、手机号**，不是 `chooseAvatar`、
`type="nickname"`、`getPhoneNumber`。

【RATIONALE】三个底层获取方式不同（填写能力 ×2、独立授权 ×1），但它们在产品里是同一件事：
「把我的资料补齐」。现状 me.wxml:38「点头像换微信头像 · 点昵称可用微信键盘快捷填入」与
:44「微信一键获取（可选）」把 API 机制说给了用户听——这些实现细节应当降级为次级说明或收进交互内部，
主路径永远是「头像/昵称/手机号」三个资料字段本身。

【IMPACT】纯前端文案与视觉层级调整；不改任何调用方式（三种机制照旧使用，见 04-onboarding.md）。
【PRIORITY】P0（随 11-ui-spec.md 落地）。

---

## P2 · 「我的」是 Identity Hub，不是 Profile Form

【DESIGN DECISION】Tab 根页「我的」呈现**身份、活动、同行、安全、授权**的摘要与入口；
逐字段的编辑面收进弹层/次级页。页面不再以表单形态铺开全部输入框。

【RATIONALE】现状 me.wxml 一次性铺开 6+ 个输入控件（昵称、手机号、紧急联系两列、medical textarea、
同行人弹层），页头自述「我的同行资料」「下次出发，少填一点。」——这是「资料登记表」的定位。
而 OurTrail 的「我的」要回答的是三件事：**我是谁（身份+协作）、我去过/要去哪（活动）、
我的安全资料管好了没有（同行与安全）**。这与产品愿景里「人的资产」（00-产品愿景 §1）对齐。

【IMPACT】me.wxml/wxss 重构 + me.js 拆分编辑面；统计与最近活动需要数据来源（见 06：先由现有
home 读推导，P1 引入 `kind:'me'` 专用视图）。
【PRIORITY】P0（IA 骨架）/ P1（专用视图）。

---

## P3 · 服务端是真源；草稿只是「救援缓冲」，不是第二真源

【CODE FACT】现状已按此运转：草稿只在「门槛没过」或「保存失败」时有存在意义，成功即清
（me.js:190）；草稿压在服务端值之上只是为了让未落库输入活过 reload（me.js:5-10 的事故注释）。

【DESIGN DECISION】保留这个模型，但补上它缺的两块：
1. **可见性**——本机有未落库修改时，页面明示（「本机有未保存的修改 · MM-DD HH:mm」+ 保存/丢弃），
   不再让用户猜「存没存上」；
2. **归属**——草稿键补账号段（利用 profile 读已返回的 `profile.id` 调 `draft.setOpenId`，
   修复 `setOpenId` 全库无人调用、线上键账号段恒为空串的既有缺陷，01-current-state §6）。

【RATIONALE】两台设备同时改档案时，服务端 last-write-wins 是可接受语义（V1 熟人场景，
单人单账号为主）；但**本机旧草稿无限期遮蔽新服务端值**（草稿无时间戳，01-current-state §4.3）
是真实的困惑源，且修复成本极低。
【PRIORITY】P0（可见性 + setOpenId）/ 数据结构 v2 见 12-state-and-error-spec.md。

---

## P4 · 安全资料（emergency/medical）沿用「长期默认值 → 报名快照」两层模型，安全边界不放松

【CODE FACT】Profile.person.medical/emergency 是**长期个人安全资料**（本人编辑）；
报名时快照进 `Signup.participant`，此后按活动读取（selectSensitive：本人/代报无条件，
owner/staff 需 purpose + 阶段窗口；归档后工作侧整体关闭，e2e-test.js:311-321）。
两层已是分离的，且投影逐字段构造、无透传（selectors.js:12）。

【DESIGN DECISION】**不改这个模型**。UI 只负责把它说清楚：Profile 里的健康备注标注
「作为报名默认值；每次报名后以报名资料为准，仅授权人员在活动期间按用途查看」。
不因「我的页好设计」而新增任何跨活动读取、也不放宽 purpose 门槛。

【RATIONALE】canReadSensitive 的三段设计（本人/代报 → 工作用途 → 拒绝）与 V1 §4.1 隐私要求、
多角色权限模型 §12「敏感信息必须按角色、活动关系和时间范围授权」一一对应，是被 e2e 钉死的行为；
动它属于安全回退。
【PRIORITY】约束（不可违反项），非工作量项。

---

## P5 · 常用同行人 = 报名资料模板 + 代报名对象；不是好友关系，更不是长期授权

【CODE FACT】服务端已实现该语义：报名引用 companion 时逐次要求 `consent.proxyAuthority`
（signup.js:53-55）；companion 归属提交者本人 Profile（signup.js:47, invariants.js:38）；
me 页已有固定文案「保存条目不等于代办授权；每次报名仍需逐人同意。」（me.wxml:104）。

【DESIGN DECISION】保留语义与文案，视觉上把同行人表达为「常一起出行的人（报名时可勾选）」，
禁止出现「好友/关注/家人组」等社交关系词汇，禁止出现「已授权」状态徽标。
【RATIONALE】见 08-companion-design.md 的完整语义分析。
【PRIORITY】约束 + P0 视觉表达。

---

## P6 · 手机号保留一次独立的、用户主动的授权；头像昵称零弹窗

【CODE FACT】getPhoneNumber 是付费组件（0.03 元/次）、需认证主体与隐私指引声明，个人主体未开通时
本仓已按「手填为主、一键为可选捷径」降级（me.wxml:44, me.js:275-276, me.wxss:68 注释）。

【DESIGN DECISION】维持「手机号手填为主，微信一键获取是可选捷径」的既有现实，产品语汇上把
一键获取收进手机号编辑面内部（不再与「手机号」标题并排抢注意力）；取消授权不算错误
（现状已按 hint 处理，me.js:268-271，保留）。头像/昵称继续走填写能力、无授权弹窗。

【RATIONALE】手机号的敏感级与用途（活动联络 + 安全应急）配得上一次明确授权；
头像/昵称的授权弹窗则纯属打断。
【PRIORITY】P0。

---

## P7 · 首次体验是「几十秒完善同行资料」，不是「被授权 4 次」

【DESIGN DECISION】Onboarding 是**一个产品流程**（一张引导卡 + 一个激活表单），
底层仍是多个微信 API；进度可随时中断，每个字段都可手填兜底，永不阻塞浏览与报名以外的场景。
详见 04-onboarding.md。
【PRIORITY】P0（引导卡 + 激活表单）；P1（报名页内嵌激活流）。

---

## P8 · 活动数据进入「我的」，但只用已有视图能给出的数据

【DESIGN DECISION】「我的」展示**进行中 / 已完成 / 发起**三个计数与最近 2–3 场活动。
数据来源分两步走：P0 由现有 `home(participant)` 读在客户端推导（该读本就因 positionRows 存在）；
P1 落地 `kind:'me'` 专用视图后由服务端统一计算。**不为 Profile 页新增 5–10 个 API**
（每次读的边际成本是 loadState 全量水合，01-current-state §1；交互审查 §5 已记录该架构成本）。

【RATIONALE】正确性 > 安全 > 体验 > 可维护性 > 优雅（任务约束 §27）；`kind:'me'` 是现有
`read` action 内新增一个 request.kind 分支，完全复用既有架构（05/06 详述）。
【PRIORITY】P0 客户端推导 / P1 服务端视图。

---

## P9 · 文案纪律

【CODE FACT】全站文案规范：状态文案解释「现在怎样 + 接下来会怎样」（ourtrail-ui review-checklist）；
天气相关用概率语言；**不承诺救援/保险**（AGENTS.md 规则 12）。

【DESIGN DECISION】安全资料文案统一为「必要安全协作」用途框架（现状 me.wxml:73 的
「仅用于本次活动的必要安全协作」是正确范式，推广到所有 emergency/medical 出现点）；
位置授权固定保留「只在活动中主动上报一次位置，不会后台追踪。」这句承诺（me.wxml:130，
它准确描述了 field.js 的真实行为：一次性上报、consentExpiresAt=活动结束、可撤回）。
【PRIORITY】P0。

---

## P10 · 不重写的清单（防止过度设计）

【DESIGN DECISION】以下现状是**对的**，本轮明确不动：
- 领域命令 + 严格 schema + 投影投影的读写漏斗（AGENTS.md：客户端无法绕过 domain 层）；
- `Person/Profile/Companion` 的 schema 形状与严格校验（ADR-0003 兼容性约束：新增字段必须声明
  optional，否则存量数据校验失败）；
- 报名快照模型（participant 不随 profile 漂移）；
- profile.save 的「激活门槛」（结论与依据见 05-profile-data-model.md §3，结论：保留）；
- revision CAS + 幂等回执 + dispatchAndSync 冲突自愈；
- 两次读（profile + home）在 P0 阶段的组合（P1 才合并为 me 视图）。

明确**不做**：UserService/ProfileService 之类新架构层、GraphQL/REST 风格 mutation、
新的状态管理库、独立账号体系、把 openid 换成自建随机码（P2 前不立项，见 10）。
