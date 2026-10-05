# 05 · Profile Data Model（数据模型与「name+phone 门槛」裁决）

> 本文回答两个核心问题：(1) `profile.save` 强制 name+phone 是否合理；
> (2) medical/emergency 在 Profile 与活动敏感读取之间是什么关系、要不要分家。

---

## 1. 模型现状回顾（事实，详见 01 §1）

```
Profile { id = openid, person: Person, companions: Companion[] }      ot_profiles，一用户一文档
Person  { name, phone, emergency{name,phone}, medical, avatar? }
Signup.participant = Person 快照 + consent{dataUse, proxyAuthority, proxyHome}
```

【CODE FACT】Profile 是**账号唯一档案**：没有 User/UserRole/ResourcePermission 等附加实体
（多角色权限模型 §9.1 的建议对象列表中，V1 只落了 Profile + Membership 两个，activities.ownerId
承担 organizer 关系，其余角色全部由 signup/membership 派生——这是有意的精简，不是缺失）。

---

## 2. 「为什么要求 name+phone」——四条真实依赖链

【CODE FACT】这四条是全部可证实的依赖：

1. **报名预填质量**：报名页 candidate 从 profile.person 预填（signup.js:152-167），
   报名提交时 normalizedPerson 强制 name+phone+**emergency 姓名电话**（signup.js:25-27）。
   档案不齐 → 预填缺项 → 用户每次报名重填。
2. **报名的存在性前提**：`registerParticipants` 要求 `state.profiles` 里有本人档案，
   否则 NOT_FOUND「当前账号资料不存在。」（signup.js:39-40）。
3. **协作授权的存在性前提**：membership.save 要求被授权人 Profile 存在（profile.js:19）——
   空壳档案不落库（selectors.js:254-256），所以「对方存过资料」是授权链路的前提。
4. **名单可读性**：rowView/selectContact 直接展示 participant.name/phone（selectors.js:116, 161），
   组织者与车辆联系人靠姓名核对现场。

【DESIGN DECISION】**结论：门槛保留，但把它从「表单校验」重新定义为「档案激活（activation）」，
并对 emergency/medical 单独豁免 UI 阻断。**

【RATIONALE】
- 四条依赖全部指向同一个不变量：「存在 Profile 记录 ⇒ 存在 name+phone」。打破它（允许
  无 name 的 Profile 落库）会让 2/3/4 三条链各自补丁：signup 前置要加「name 非空」、membership
  目标校验要加「name 非空」、名单显示要处理空名。收益只是「medical 可以先存」——而这一点
  **草稿机制已经解决了**（me.js:164-181：门槛没过 → 草稿留存 + 明确提示「会一起保存」）。
- 反向方案（update 已存在档案时允许整体替换为空 name）有**静默清空风险**：profile.save 是
  整体替换语义（profile.js:46），客户端始终发全量 person；一旦放松，一个只改 medical 的请求
  若带着空 name 会把已存的姓名抹掉。要安全放松必须改成字段级合并语义，动的是全站最核心的
  写命令之一，违背 P10（不过度重构）。
- 服务端 fieldErrors 已按字段点名（profile.js:37-40），客户端 hint 已解释「已记在本机，会一起
  保存」（me.js:172-179）——门槛的**代价**已经被前一轮止血批消化，剩余问题只是 UI 形态
  （表单平铺让它看起来像被卡住），由 03 的 IA 重构解决。

【IMPACT】无服务端改动。前端：激活 sheet（04 §4）把「补全姓名与手机号」变成主动作而非报错。
【RISK】「激活」语义若未来要支持「只有微信昵称、无手机号」的用户（如青少年用户），
需回到本文重新裁决——届时正确路径是新增字段级合并命令，而不是放松现有门槛。
【PRIORITY】裁决项 P0（写进 11/12 的实现约束）。

---

## 3. profile.save 的整体替换语义（记录，不改）

【CODE FACT】`profile.person = person`（profile.js:46）——payload 是全量替换，非合并。
【CODE FACT】这是安全的，前提是客户端永远发「合并后的完整 person」：me 页发 `this.data.person`
（服务端值+草稿合并，avatar 恒在）；报名页回写以**读到的快照为底** Object.assign（保 avatar，
signup.js:310-314）。
【DESIGN DECISION】保持替换语义；把「调用方必须以最近一次读到的 person 为底构造 payload」
写成实现约束（12 §2），并用测试钉死（13：报名页回写不带 avatar 的回归用例已存在
scenario-signup-test.js:597-612，保留）。

---

## 4. medical / emergency：两层模型的正式化

【CODE FACT】数据事实：
- **长期层**：Profile.person.medical / emergency——本人编辑，无他人可读（selectView kind:'profile'
  仅本人可达，selectors.js:250-258）。
- **活动层**：报名时快照进 Signup.participant；此后读取走 selectSensitive
  （本人/代报无条件；owner 或 staff`sensitive` 需非空 purpose + workDataAvailable；
  归档后工作侧全关，01 §3）；导出走 selectExport sensitive 模式（owner + 逐行 canReadSensitive +
  用途入事件账，commands.js:59-61）。
- **两层不联动**：报名后改 Profile 不影响已提交报名（signup.edit 才改快照）。

【DESIGN DECISION】**维持两层，不新增「本次活动临时 medical」之类的第三层。**
理由：现状两层已经精确对应了「长期个人安全资料 vs 本次活动敏感信息」的产品问句——
Profile 层是「默认值」，Signup 层是「当次事实」。第三层只会制造「填了哪个生效」的困惑。
UI 表达（03 §4）：medical 摘要行与编辑 sheet 注明「作为报名默认值；每次报名以报名资料为准，
仅授权人员在活动期间按用途查看」。

【RATIONALE】V1 §4.1 隐私要求（「病史、过敏、紧急联系人只对活动领队和授权协作人员可见」+
「活动结束后…再次查看应受权限控制」）在两层模型下已经全部被 canReadSensitive/workDataAvailable
满足（且实现比规格更严：归档后工作侧完全不可读）。放松或加层都没有产品收益。

【PRIORITY】约束项。

---

## 5. avatar 的处理事实与约束

【CODE FACT】头像 = 云存储 fileID（`avatars/{openid}/{ts}.jpg`，me.js:238）；Person.avatar 可选
（schema.js:119）、≤500 字符；personView 仅在非空时带出（selectors.js:16）；
normalizedPerson 会 trim 并截 500、空串删除键（signup.js:19-23）——**报名快照路径有净化，
profile.save 路径没有**（profile.js:30-47 只 trim 四个文本字段，不动 avatar）。
【DESIGN DECISION】P0 不改（客户端 avatar 只来自 uploadFile 成功回调，非法值无可达路径）；
列为 P2 加固项：profile.save 处理器补与 normalizedPerson 同款的 avatar 净化（一致性，非漏洞）。
【RISK】记录在案：若未来有别的 client 直发 profile.save（如 lab 工具），超长 avatar 会因
schema ≤500 被拒——schema 兜底存在，无泄露面。

---

## 6. 草稿数据结构 v2（本设计唯一的数据结构变更，纯本地）

【CODE FACT】现状草稿（me.js:23-33）：五字段，无元数据；键 `ourtrail.draft.me.person.v1`。

【DESIGN DECISION】升级为 v2 键 `ourtrail.draft.me.person.v2`：

```
{
  fields: { name, phone, medical, emergency:{name,phone} },  // 与 v1 同构
  savedAt: '<ISO 北京时间>',                                 // 最近一次 onField 写入时刻
  device: 'me'                                               // 预留；P2 多端时再区分
}
```

- 读：v2 不存在则回读 v1（迁移兜底，14-migration-plan.md）；
- 用途：仅为「本机有未保存的修改 · MM-DD HH:mm」横幅（12 §4）；
- **不**引入 baseRevision/乐观锁字段——档案是单人文档，CAS 已由 revision 覆盖，重复加锁是复杂化。

【PRIORITY】P0。

---

## 7. 不新增/不改的 schema 清单

| 项 | 决定 | 依据 |
|---|---|---|
| Person 字段集 | 不变 | ADR-0003：新字段必须 optional 且全量同步三处 spec（trailApi/trailApiLab/原型），成本>收益；V1 无真实需求字段（常用上车点在 V1 规格出现过（§4.1），但报名表单 trip 已逐次选择，档案级默认值列为 P2 观察项，本轮不做） |
| Profile.id | 不变（= openid） | 见 10-identity-code-design.md |
| Person.emergency 结构 | 不变（{name, phone}，无关系/备注字段） | 同上；「紧急联系人关系」是 P2 愿望清单，先记录不实现 |
| Companion | 不变 | 见 08 |
| Membership | 不变 | 见 07/10 |
