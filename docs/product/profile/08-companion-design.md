# 08 · Companion Design（「常用同行人」到底是什么、怎么表达）

> 任务书要求：明确 companion 的真实语义；保留「常用同行不等于代办授权」；
> 解释为什么 companion.save 必须先有本人档案；重新设计 UI 表达。

---

## 1. 语义裁决

【DESIGN DECISION】`profile.companions` 是**「我常一起出行的人」的报名资料模板 + 代报名对象清单**。
四个候选语义的裁决：

| 候选语义 | 裁决 | 代码依据 |
|---|---|---|
| 常用联系人/同行模板 | ✅ **是**——报名时勾选即按其 person 快照预填（signup.js:94-96, 152-167） | — |
| 代报名对象 | ✅ **是**——personRef.companion 只能引用**提交者自己**的 companions（signup.js:47；invariants.js:38 强制 `ownerId === submittedByUserId`） | — |
| 家庭成员/好友关系 | ❌ 不是——无关系字段、无双向确认、无社交图谱；schema 只有 `{id, person}` | schema.js:125 |
| 长期代办授权 | ❌ **绝对不是**——代办授权是**报名时逐人逐次**的 consent.proxyAuthority（signup.js:53-55），档案里存一百个同行人也不构成任何授权 | — |

【RATIONALE】产品句已有定论（me.wxml:104「保存条目不等于代办授权；每次报名仍需逐人同意。」），
服务端用三道闸背书：引用归属校验（signup.js:47）、逐次 consent 校验（signup.js:53-55）、
不变量关系校验（invariants.js:38）。本轮 UI 只许强化、不许弱化这个语义。

---

## 2. 为什么 companion.save 必须先有本人 Profile

【CODE FACT】处理器在 companion 分支前置检查 `if (!profile) return failure('NOT_FOUND', '请先保存当前账号资料。')`
（profile.js:49）。原因是结构性的：
1. **存储形状**：Companion 不是独立集合/文档，是 `Profile.companions` 数组的元素
   （schema.js:126, store.js recordKey=record.id）——没有 Profile 记录就没有挂载点；
2. **引用完整性**：报名的 `personRef: {kind:'companion', ownerId, companionId}` 需要 ownerId 可解析；
   invariants.js:38 校验「同行人与提交者的关系一致」的前提是提交者 Profile 存在；
3. **canExecute 的归属判定**：`profile.companions.some(c => c.id === payload.companionId)`
   （permissions.js:128-131）需要读本人 Profile。

【DESIGN DECISION】**保留该前置**，客户端预检（me.js:285-294）保留。它不是历史遗留，
是「同行人挂在档案下」这一数据结构选择的必然结果。UI 侧的处理是把服务端报错翻译成动作
（「先补全本人姓名与手机号（填齐自动保存），再添加同行人」——现状文案已达标准，保留）。

---

## 3. 生命周期与既有行为盘点

【CODE FACT】
- 创建/编辑：upsert by id（profile.js:50-54）；同 name+phone 硬门槛（profile.js:36-41）；
- 编辑时前端重读 profile 回查（me.js:296-304）——保证编辑的是服务端最新值；
- 移除：过滤式删除 + dialog 二次确认（me.js:333-345, me.wxml:157-162）；
  文案「只移除常用条目，已提交的报名与安全记录会保留。」准确描述了快照语义；
- **移除不级联**：历史报名的 personRef 仍指向该 companionId（快照+引用），invariants 不要求
  companion 存活（01 §2.2）——旧报名可读，编辑时前端回查落空则不回填（signup.js:153-155）。
- 上限：**未发现** companions 数量限制（schema specArr 无 maxLen 约束，schema.js:126）。

【DESIGN DECISION】
1. 编辑回查保留（它是「编辑期间不被并发修改干扰」的廉价保障）；
2. 移除流程保留；数量上限**不新增**（熟人圈规模，加上限是伪需求；若未来滥用，P2 再议）；
3. 「编辑旧报名时同行人已被移除」的场景：报名编辑页回查落空时，表单字段仍在
   （readForm 返回 participant 快照，selectors.js:175），仅「重新从档案回填」不可用——
   可接受，无需开发。

---

## 4. UI 表达重设计（E 区）

【DESIGN DECISION】（配合 03 §2 E 区）

```
常用同行人                                    [＋ 添加]
┌──────────────────────────────────────────┐
│ [张] 张三   报名时可勾选 · 资料已完整        [编辑] [移除] │
│ [李] 李四   报名时可勾选 · 缺紧急联系人 ⚠    [编辑] [移除] │
└──────────────────────────────────────────┘
保存条目不等于代办授权；每次报名仍需逐人同意。
```

要点：
1. 副词从「给家人朋友存一份资料」（me.wxml:103，暗示家庭关系）改为
   **「报名时直接勾选，不用再填一遍。」**（模板语义）；
2. 列表行用 `<person-row>`（头像首字回退 + 副标题），副标题给**完整度提示**
   （缺紧急联系人/缺 medical → 「报名时还需补 X」）——把「模板质量」可视化，
   与报名页 fillFromProfile 的「只补空字段」行为呼应；
3. 添加入口在无本人档案时维持现状预检拦截（me.js:285-294）；
4. 编辑 overlay 内字段不变（姓名/电话/紧急两列/medical，me.wxml:138-152），错误 callout
   在弹层内的 P0-4 修复**不得回退**。

【IMPACT】me.wxml E 区重排 + 完整度计算（纯前端，从 companion.person 判空）；
scenario-me 新增完整度副标题断言。
【PRIORITY】P0。

---

## 5. 与报名页的双向同步（记录边界，不改）

【CODE FACT】报名页对档案是「读时预填（只补空）→ 写时回写（提交成功后 CAS 链）」（01 §7）。
回写以**页面表单的最终值**覆盖档案对应字段——即「报名时顺手完善了资料」。
【DESIGN DECISION】该行为保留：它是「档案作为默认值」模型（05 §4）的自洽闭环——
报名表单就是档案的编辑器之一。唯一约束：回写必须以快照为底保 avatar（signup.js:310-314
已有实现 + scenario-signup-test.js:597-612 已有回归，标注为**不得破坏项**）。

【RISK】回写失败只 toast「可在『我的』补存」（signup.js:340）——草稿不介入报名回写，
存在「报名成功但档案没更新」的静默窗口。接受（档案在下一次报名或 me 页编辑时会自然收敛），
不在本轮加补偿逻辑。
