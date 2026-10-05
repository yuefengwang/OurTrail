# 07 · Authorization & Security（Profile 安全矩阵与 Security Findings）

> 原则先行（02-P4）：**本设计零放松任何现有安全边界**。本文做三件事：
> 把现状权限画成矩阵、逐格核对设计不破坏它、登记审计中发现的 Security Findings（只记录不改）。

---

## 1. 角色清单（以代码为准）

【CODE FACT】代码中存在的主体（permissions.js）：
- **本人**（actor，openid 持有者）；
- **代报人**（submittedByUserId = actor 且 consent.proxyAuthority，permissions.js:20-22）；
- **组织者/所有者**（activity.ownerId === actor，permissions.js:17-19）；
- **staff**（membership，capabilities × scope × expiresAt，permissions.js:32-40）；
- **vehicle_contact**（membership 绑定单车 × expiresAt，permissions.js:43-48）；
- **系统管理员**：**当前 master 未发现**——无任何 admin 角色/旁路（全部判断都从 actor 派生）。

【CODE FACT】与 Profile 相关但**不是授权关系**的概念：
- Companion（资料模板，归属提交者，无权限语义）；
- 常用同行人的「代办」只发生在**报名时逐人勾选 consent**（signup.js:53-55），不随档案存续。

---

## 2. Profile Security Matrix

图例：✅ 可读 · ✍️ 可写 · ❌ 不可 · （窗口）= 受时间/阶段限制 · 空格 = 未发现该路径

| 数据 | 本人 | 代报人 | 组织者 | staff（按能力） | vehicle_contact | 活动归档后 |
|---|---|---|---|---|---|---|
| **name / avatar**（档案） | ✅✍️（me 页） | | | | | — |
| **phone**（档案） | ✅✍️（me 页） | | | | | — |
| **emergency**（档案） | ✅✍️（me 页） | | ❌ | ❌ | ❌ | — |
| **medical**（档案） | ✅✍️（me 页） | | ❌ | ❌ | ❌ | — |
| **companion 列表** | ✅✍️✖️（本人管理，permissions.js:128-131） | | ❌ | ❌ | ❌ | — |
| **协作码**（= profile.id） | ✅ 展示/复制（me.wxml:107-118） | 同左（人人可得自己的） | 经本人线下分享获得 | 同左 | 同左 | — |
| **name / phone**（报名快照） | ✅（selectContact:160-161） | ✅（hasProxyConsent 分支） | ✅（workAllowed） | ✅ roster 能力+范围内（:158-159） | ✅ 本车已确认乘客（:157-159） | 工作许可全关（workDataAvailable）→ 本人/代报仍可 |
| **emergency / medical**（报名快照） | ✅（canReadSensitive:91） | ✅（:91） | ✅ 需非空 purpose（:92-93） | ✅ `sensitive` 能力+范围内+purpose（:93） | ❌ **从未授予**（selectSensitive 无车辆联络分支；V1 §7 矩阵「本车必要范围」仅限联络信息） | 工作侧 ❌（workDataAvailable 关闭）；本人/代报 ✅ |
| **报名表单编辑读**（readForm） | ✅ | ✅（isOwnSignup 含提交者） | ✅ 需 purpose | ❌（selectSignupForm 加验 isOwnSignup‖isOwner，selectors.js:168——staff 即使有 sensitive 能力也读不到表单） | ❌ | 编辑窗口受阶段锁（signup.js:150-153） |
| **敏感导出**（readExport sensitive） | ❌（非 owner） | ❌ | ✅ purpose 必填 + 逐行 canReadSensitive + 用途入事件账 | ❌（export.record 仅 owner，permissions.js:242） | ❌ | ❌（e2e-test.js:311-321 钉死） |
| **位置上报**（position.report） | ✅ 仅本人、active 阶段、consent:true、窗口=endAt | ❌（canExecute:230 仅 isSelfSignup） | ❌（领队也不能替人上报） | ❌ | ❌ | ❌ |
| **位置查看**（activity 视角 positions） | ✅ 本人/代报 | ✅ | ✅ | ✅ `position` 能力+范围内 | ❌（vehicle 视角 positions=[]，selectors.js:358） | ❌（phase≠active 直接清空，:358） |
| **位置撤回**（position.revoke） | ✅ 本人/代报（permissions.js:231-233） | ✅ | ❌（own→CONSENT_REQUIRED，组织者不属 own/代报时 FORBIDDEN） | ❌ | ❌ | ✅ 不受阶段限制（field.js:15-19） |
| **membership 授予/撤销** | ❌（非 owner） | | ✅ owner 专属（permissions.js:270-273） | ❌ | ❌ | ❌（archived/cancelled 拒绝，profile.js:12） |

【DESIGN DECISION】对本矩阵的核对结论：**03/11/12 的全部 UI 改动不触碰上表任何一格**。
变化只在「谁在哪个界面看到/编辑**自己的**数据」——所有编辑面（激活 sheet、D 组 sheet、同行人
overlay）的执行主体都是本人，走的都是既有命令与权限。

【RISK】两条容易被 UI 重构误伤的既有行为，写明「不得改动」：
1. staff 永远读不到报名表单编辑（selectSignupForm 的 isOwnSignup‖isOwner 加验，selectors.js:168）
   ——即使他有 `sensitive` 能力；
2. vehicle_contact 永远拿不到 emergency/medical（selectSensitive 不接受车辆联络身份）——
   车辆联络看到的 phone 来自 selectContact/vehicleTask.passengers（selectors.js:397），
   这是有意设计，不得「顺手统一」。

---

## 3. 时间窗口规则汇总

【CODE FACT】
- 工作数据窗口：`workDataAvailable` = phase ∉ {archived, cancelled}（permissions.js:26-29）——
  管组织者/staff/车辆联络对**工作数据**的全部访问；
- 位置授权窗口：`consentExpiresAt = activity.endAt`（field.js:108）+ 30 分钟陈旧标记
  （selectors.js:371）+ 主动撤回/取消报名自动撤（signup.js:140-142）；
- 授权截止：membership.expiresAt 必须晚于当前（profile.js:18），到期自然失效（全部 staffCan/
  vehicleCan 比较 expiresAt）。
- 档案数据（Profile.person/companions）**无窗口**：本人随时可读写——正确，它是用户自己的资料。

---

## 4. Security Findings（审计发现，只记录、本轮不改）

| # | 级别 | 发现 | 依据 | 处置 |
|---|---|---|---|---|
| SF-1 | 信息 | membership.save 对不存在的 userId 返回 NOT_FOUND（而非法権限错），组织者可借此探测「某 openid 是否注册过」——存在性预言机 | profile.js:19 | **接受**：调用者已是活动 owner（permissions.js 闸门），openid 不可枚举，探测收益≈0。记录备查 |
| SF-2 | 一致性 | profile.save 不净化 avatar（trim/截断/空删），与 normalizedPerson 行为不一致 | profile.js:30-47 vs signup.js:19-23 | P2 可选加固（05 §5）；schema ≤500 已兜底 |
| SF-3 | 隐患 | `draft.setOpenId` 全库无调用，草稿键账号段恒空 → 同机多账号共享报名/编辑器草稿 | draft.js:21-34; app.js:3-12 | **P0 修复**（12 §3）：me 页 reload 时以 profile.id 回填；不涉安全泄露（同机场景），但属数据越界 |
| SF-4 | 观感 | companion.remove 对不存在的 id 静默成功 | profile.js:56-59 | 接受（幂等语义合理）；测试补断言（13） |
| SF-5 | 观感 | 页面 error 与弹层 error 共用同一 `data.error`，语境可混淆 | me.js:198/331/344; me.wxml:13/137 | P0 拆分（12 §5） |
| SF-6 | 备查 | 头像云路径含 openid（`avatars/{openid}/…`），云存储默认「所有用户可读」 | me.js:238 | 接受：头像本就是对外展示物；openid 在存储路径中的暴露不构成新的能力（无任何 API 按 openid 反查他人） |
| SF-7 | 备查 | 「我的」页 error 文案含服务端原文（api.errorText 直透） | me.js:198 | humanizeInternal 已拦截内部堆栈类消息（api.js:7-11），现有分类文案合格，不动 |

---

## 5. 隐私表达规范（文案级，随 11 落地）

【DESIGN DECISION】三类数据的用途文案固定：
- 手机号：「用于活动联络与安全应急联系。」（me.wxml:47 现句，保留为标准句）；
- 紧急联系人/medical：「仅用于活动的必要安全协作；报名后以报名资料为准，授权人员在活动期间按用途查看。」；
- 位置：「只在活动中主动上报一次位置，不会后台追踪。」（me.wxml:130 现句，一字不改）。
禁止出现「已授权」「授权管理」等暗示持续授权的词汇（位置授权是单次上报事实的撤回，不是开关）。
