# Profile / Identity / 「我的」页 重设计 · 第一阶段设计包

> **性质**：设计文档（第一阶段交付物）。本包只调查、分析、设计；不改任何生产代码。
> **基线**：`master` 分支 HEAD `15cafdb`（2026-10-05）。工作区在途未提交改动
> （`needsOutboundBoarding` 批次）经 diff 核对不触及 Profile 面，本文事实在 HEAD 与工作区一致。
> **读者**：第二阶段 Developer Agent（直接照 15/implementation-checklist 实施）
> 与产品负责人（拍板 3 个标记为「待拍板」的命名/口径项）。
> **日期**：2026-10-05

---

## 0. 文档地图

| 文件 | 内容 |
|---|---|
| [01-current-state.md](01-current-state.md) | Current Profile Architecture Map：数据模型/命令/投影/页面请求链/自动保存与草稿/身份码/测试/平台能力，全部带 file:line |
| [02-product-principles.md](02-product-principles.md) | 10 条产品原则（含「不重写清单」） |
| [03-information-architecture.md](03-information-architecture.md) | 「我的」Hub 化 IA：七卡结构、统计口径、编辑面迁移表、Current→Target 对照 |
| [04-onboarding.md](04-onboarding.md) | 三段渐进激活、触发点矩阵、激活 sheet 规格、拒绝与降级全表 |
| [05-profile-data-model.md](05-profile-data-model.md) | name+phone 门槛裁决（保留=激活语义）、两层安全模型正式化、草稿 v2 结构 |
| [06-api-and-selector-design.md](06-api-and-selector-design.md) | Current/Target API Matrix、`kind:'me'` 视图裁决与规格 |
| [07-authorization-and-security.md](07-authorization-and-security.md) | Profile Security Matrix（逐格核对）+ 7 条 Security Findings |
| [08-companion-design.md](08-companion-design.md) | Companion 四候选语义裁决、前置条件解释、UI 表达 |
| [09-safety-data-design.md](09-safety-data-design.md) | emergency/medical 三位置关系图、sheet 规格、脱敏约定 |
| [10-identity-code-design.md](10-identity-code-design.md) | 协作身份码 = openid 的完整档案、命名裁决、二维码 P2 边界 |
| [11-ui-spec.md](11-ui-spec.md) | WXML 级结构规格（只用现有 token/组件）、触控与视觉自检表 |
| [12-state-and-error-spec.md](12-state-and-error-spec.md) | 一致性模型（SoT/草稿/页面态）、各情形正式答案、错误作用域拆分 |
| [13-testing-strategy.md](13-testing-strategy.md) | 回归红线、迁移清单、补洞清单（现存零覆盖域）、E2E 与探针、DoD |
| [14-migration-plan.md](14-migration-plan.md) | 存量数据/草稿/接口兼容、发布顺序、回滚预案 |
| [15-implementation-plan.md](15-implementation-plan.md) | 三批执行顺序 + 每步门禁 + 全量门禁命令 |
| [implementation-checklist.md](implementation-checklist.md) | 文件级执行清单（Frontend/Backend/API/Data/Test/UI） |

标记约定（全文统一）：【CODE FACT】= 当前代码事实（带 file:line）·【DESIGN DECISION】= 设计判断 ·
【RATIONALE】= 为什么 ·【IMPACT】= 影响 ·【RISK】= 风险 ·【PRIORITY】= P0/P1/P2。
找不到代码依据处一律写「当前 master 未发现」，不做推测。

---

## 1. 十二个关键问题的最终回答

**Q1 「我的」到底应该是什么？**
Identity Hub：身份（头卡+协作码）· 活动（统计+最近）· 同行（常用同行人）· 安全（紧急联系/健康备注）· 授权（位置撤回）的摘要与入口层（03）。编辑收进 sheet，Tab 页不再是一张登记表。

**Q2 当前页面为什么像表单？**
因为它的页头自述「我的同行资料」（me.wxml:8）、6+ 输入控件平铺一页（me.wxml:17-79）、且没有任何活动维度（me.js 只消费 positionRows）。它是从「报名少填点」这个单一价值长出来的工具页，没跟上产品已成形的身份/协作/安全语义。

**Q3 Profile 的 source of truth 是什么？**
`ot_profiles` 文档（服务端），一用户一文档、主键 = openid（store.js:8,25-29; profile.js:44）。页面态 = mergeDraft(服务端值)，本地草稿只是「服务端暂时收不下的输入」的救援缓冲（12 §1）——成功即清、失败留存、防 reload 覆盖（me.js:5-10 事故注释是它的存在证明）。

**Q4 微信头像/昵称应该怎么进入 Profile？**
走现有正确机制不变：`open-type="chooseAvatar"` 上传云存储存 fileID（me.js:230-251）、`type="nickname"` 键盘快捷填入（me.wxml:27-37）。产品层只做减法：删掉「点头像换微信头像…」这类 API 解说文案，头像昵称升入身份头卡。`wx.getUserProfile` 禁用（UI 规范硬规则）。

**Q5 手机号为什么应该独立授权？**
因为它在平台层面**就是**独立授权：getPhoneNumber 需要认证主体权限 + 隐私指引声明 + 付费（0.03 元/次），且微信会弹半屏同意——这是有法律意义的明确同意动作，不该被产品层稀释；而头像/昵称是零弹窗填写能力，不该被产品层夸大成授权（04 §5）。本仓已按「个人主体未开通权限」的现实做了手填降级（me.wxss:68），保留。

**Q6 首次 onboarding 应该怎么设计？**
三段渐进（04）：段 0 隐式身份（openid 天生存在，0 秒）；段 1 资料激活（头像+昵称+手机号的 30 秒 sheet，可跳过，完成=首次 profile.save）；段 2 安全资料随场景补齐（报名表单是强制点，档案是默认值，回写闭环已存在 signup.js:301-321）。触发点四处（我的首访/报名页/编辑器/协作授权报错），全部非模态、全部有手填兜底。

**Q7 profile.save 强制 name+phone 是否合理？**
合理，保留（05 §2 裁决）。它不是历史遗留，是四条真实依赖链的公共不变量（报名预填质量、报名存在性前提 signup.js:39-40、协作授权目标前提 profile.js:19、名单可读性）。代价已被前轮止血消化（草稿+提示文案）；「先存 medical 后补姓名」的需求由草稿模型满足。放松它需要把整体替换语义改成字段合并，动全站最核心写命令，不值当。

**Q8 medical/emergency 是否应该继续放在 Profile？**
应该，且**已经分离好了**（05 §4 / 09）：Profile 层是长期默认值（仅本人），报名时快照进 Signup.participant（当次事实），读取走 selectSensitive 的 purpose 门槛 + 阶段窗口（归档后工作侧全关，e2e 钉死）。三层职责清楚，产品任务是把它说清楚（09 §3 的三条 hint），不是改模型。

**Q9 Companion 到底是什么？**
「我常一起出行的人」的**报名资料模板 + 代报名对象清单**（08 §1）。不是好友关系（无关系字段），更不是长期授权（代办授权是报名时逐人逐次的 consent.proxyAuthority，signup.js:53-55）。companion.save 必须先有本人档案是数据结构的必然（同行人挂在 Profile.companions 数组下，profile.js:49）。语义句「保存条目不等于代办授权」一字不改。

**Q10 identity code 到底是什么？**
就是微信 openid（profile.id），OurTrail 不另设标识（10 §1）。唯一、永久、不可轮换（全库引用它）、不可枚举、低敏感（单独持有做不了任何事，唯一写入口 membership.save 是 owner 专属）。它是「可公开出示的账号句柄」——协作授权线下流转的载体。处置：功能不动，展示名改「我的协作码」+ 缩略 + 未激活副文案；「同行码」命名否决（与 companion 词汇撞车）；二维码 P2 评估。

**Q11 「我的」页面是否应该展示活动统计？**
应该，且几乎免费：home(participant) 读本来就在为 positionRows 发生，活动的 phase/meta.owner/meta.joined 足以推导「进行中/已完成/发起」三计数与最近 3 条（03 §3.2 口径表）。P0 客户端推导（零新 API），P1 由 `kind:'me'` 视图服务端精确复算（06 §2）。不做的是为统计新增 5-10 个 API（loadState 全量水合是每次请求的边际成本）。

**Q12 最终需要修改哪些前端 / selector / domain / API / test？**
文件级清单见 implementation-checklist.md。概要：前端 me 三件套重构 + signup/editor/roster-panel 小改 + draft.js 零改动；后端仅 selectors.js 新增 `kind:'me'` 分支（批 B，需重部署 trailApi），permissions/schema/commands/index/store 零改动；API 仅新增一个 read 分支、零修改零废弃；测试 scenario-me 迁移+新增、smoke 补 ≥15 断言（现存 membership/companion.remove/position.revoke/敏感读直测零覆盖）、e2e 新增 onboarding 节点。

---

## 2. 设计的四个支柱（与代码事实的对应）

1. **演进而非重建**（02-P10）：所有读写继续走 `api.read/dispatch → actionRead/actionDispatch →
   loadState → selectView/reduceCommand → persistState` 漏斗；唯一后端增量是一个纯函数 selector 分支。
2. **安全零放松**（07）：Security Matrix 逐格核对，UI 重构只改变「本人在哪个界面编辑自己的数据」，
   不新增任何跨人读取路径；7 条 Security Findings 全部只记录不擅改（其中 SF-3 草稿越界修复
   与 SF-5 错误作用域拆分纳入 P0）。
3. **平台现实即产品约束**（04 §1）：chooseAvatar/nickname 零弹窗、getPhoneNumber 有成本有授权、
   个人主体无快速验证权限——现状代码已对齐这些现实，设计不与之对抗。
4. **测试先行补洞**（13）：现存零覆盖域（membership 错误路径、companion.remove、position.revoke
   域级、canReadSensitive 直测）不依赖本轮功能，P0 窗口即可先落；功能用例随批迁移。

---

## 3. 待拍板项（不阻塞实施）

| # | 项 | 本文建议 | 备选 |
|---|---|---|---|
| 1 | 身份码展示名 | 「我的协作码」（10 §3） | 「同行码」（与 companion 词汇冲突，需产品负责人接受） |
| 2 | P0 统计口径近似 | owner‖joined 推导，P1 服务端精确（03 §3.2） | 直接等 P1 上线再展示统计（P0 头卡留白） |
| 3 | 页头标题终稿 | 「同行资料与身份。」（11 §1 两候选） | 文案二选一或另拟 |

---

## 4. Review 记录（任务书 §28 清单核对）

已阅（全部为直接阅读或带 file:line 的代理审计 + 本人抽核）：
- [x] 基线是 master（HEAD 15cafdb），非 GitHub main；工作区在途改动已 diff 排除影响
- [x] me.js / me.wxml / me.wxss（逐行）
- [x] domain/profile.js / selectors.js / permissions.js / schema.js / commands.js / contracts.js / signup.js / field.js / invariants.js / store.js / index.js（逐行）
- [x] signup / editor / workspace(roster-panel) / activity / home / app.js 的 Profile 消费点（代理审计 + 关键处本人核）
- [x] scenario-me-test.js（逐节）+ 全 tools/ 关键字审计（代理）；e2e-test/e2e-ui/e2e-golden-path/fault-probe 关键断言核
- [x] UI Design System（SKILL.md + design-system.md + review-checklist.md + platform-pitfalls 已知）
- [x] 多角色系统与权限模型 / 全站交互审查 / 产品愿景 / V1 规格（§4.1/§7 权限矩阵）
- [x] 微信官方最新文档核查（头像昵称填写能力 / getPhoneNumber / 隐私协议开发指南）

设计红线核对：
- [x] 没有把微信 API 当产品概念（02-P1/P6；API 词汇仅出现在 04 §1 事实底座与实现层）
- [x] 没有重新发明 User/Profile 架构（02-P10 明确不做清单；06 §4 写命令零新增）
- [x] 没有绕开 selector projection（新增 me 视图就是 selector 分支，06 §5）
- [x] 没有绕开 command architecture（写路径零新命令）
- [x] 没有放松敏感数据权限（07 §2 逐格 + 两条「不得改动」红线）
- [x] 没有破坏 Companion 语义（08 §1/§4；语义句一字不改）
- [x] 没有破坏 Activity Participant 语义（报名快照/consent 三键零改动，08 §5）
- [x] 没有破坏 position authorization（03 §2-G/07 §3；说明句一字不改）
- [x] 没有破坏现有测试（13 §2 回归红线表 + 迁移清单）
- [x] 没有修改生产代码（本包只新增 docs/product/profile/ 下 17 个 Markdown）
- [x] 第二阶段 Developer Agent 可直接实施（15 执行顺序 + implementation-checklist 文件级清单）

## 5. 诚实边界（本设计明确不知道的事）

- 「我的」页真机体感（键盘遮挡、sheet 滚动、截图脱敏的观感）属像素级问题，静态设计无法验证——
  按 AGENTS.md 流程，第二阶段交付必须走开发者工具真机走查（13 §6）；
- openid 的实际格式/长度分布未采样（缩略规则按 openid 通用形态设计，实现时以真机值校准 10 §4）；
- 统计口径的 P0 近似与 P1 精确值之间的实际差异数量（取决于真实数据，已声明接受 ±N，03 §3.2）；
- 用户截图与当前 master 的差异：本轮没有用户提供的最新截图可比对，IA 现状问题全部以 me.wxml
  代码为准（任务书 §24：以实际代码为准）。
