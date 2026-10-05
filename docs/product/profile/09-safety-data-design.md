# 09 · Safety Data Design（紧急联系人与健康备注）

> 回答任务书 §5 Medical/Emergency 两问：它们在 Profile 里是长期个人安全资料还是活动敏感信息？
> 与 selectSensitive / 报名 participant / 安全数据的关系。

---

## 1. 关系图（事实）

【CODE FACT】同一份 safety 数据在系统里有三个存在位置，职责不同：

```
① Profile.person.emergency / .medical          —— 长期默认值（本人编辑，me 页）
        │ 报名提交时快照（registerParticipants → normalizedPerson）
        ▼
② Signup.participant.emergency / .medical      —— 当次报名事实（随报名冻结）
        │ 活动期读取（用途门槛）
        ▼
③ selectSensitive / readExport(sensitive)      —— 工作侧出口（owner/staff×sensitive + purpose）
   selectContact                               —— 只有 name/phone，不含 safety（对照项）
```

- ② 的强制校验：报名必须填 emergency.name+phone（signup.js:25-27）——**报名对紧急联系人的要求
  严于档案**（档案只强制 name+phone，profile.js:36）；
- ③ 的时间窗：workDataAvailable（归档/取消后工作侧全关，permissions.js:26-29, 92-93）；
- ① → ② 无自动回流：报名后改档案不影响已提交报名（signup.edit 才改）。

【CODE FACT】safety 数据在**档案层零外泄**：selectView kind:'profile' 仅本人可达
（selectors.js:250-258）；组织者/staff/车辆联络在档案层没有任何读取路径（07 矩阵）。

---

## 2. 裁决：不分离、不加层

【DESIGN DECISION】（详见 05 §4，此处给产品理由）
Profile 层的 emergency/medical 就是**长期个人安全资料**（用户自述的、默认随报名带入的）；
活动敏感信息是**报名快照 + 用途门槛读取**这一整套机制（② + ③），不是另一种字段。
「两者是否应该在产品模型中分离」的答案是：**已经分离了**（① 长期可变 / ② 冻结快照 / ③ 受控出口），
产品要做的不是改模型，而是**把这三层的关系对用户说清楚**。

【RATIONALE】安全边界由 canReadSensitive 三段式（本人/代报 → 工作用途 → 拒绝）+ 阶段窗口 +
导出用途审计（commands.js:59-61 把 purpose 写进事件账）构成，全部有 e2e 钉死；
任何「为了 UI 好看」的重构（比如把 medical 从 Person 拆成独立实体）都会牵动 schema 三处同步
（ADR-0003）与全部投影，零产品收益。

---

## 3. UI 规格（D 组的两个 sheet）

### 3.1 紧急联系人 sheet

```
<overlay kind="sheet" title="紧急联系人">
  form-field 姓名   input（maxlength 80，现状一致）
  form-field 电话   input type=number（maxlength 11）
  hint: 紧急情况下用于由活动授权人员联络；报名时必须填写，这里保存的是默认值。
  [自动保存状态行：修改后自动保存 · 已保存/正在保存…]
</overlay>
```

【CODE FACT】字段约束与现状一致（maxlength 80/11，me.wxml:57-58）；data-key 映射
ename/ephone→emergency.name/phone 的既有机制保留（me.js:206-211；scenario-me-test 的
ISSUE_EMERGENCY 闸门 4 条断言在映射修复后应转真实校验，见 13 §3）。

### 3.2 健康/用药备注 sheet

```
<overlay kind="sheet" title="健康与用药备注">
  badge: 已填写 / 未填写
  form-field textarea（maxlength 2000，placeholder 沿用「过敏、慢性病、常用药等…」）
  hint（三条，缺一不可）:
    · 作为报名默认值；每次报名以报名资料为准。
    · 仅授权人员在活动期间按用途查看；活动结束后不可再查看。
    · 选填。不填写不影响报名。
  [自动保存状态行]
</overlay>
```

【DESIGN DECISION】三条 hint 分别对应 05 §4 的三层模型 + 选填事实——这是「把安全模型说清楚」
的落点，也是概率/不承诺语言纪律（02-P9）在安全域的应用。

### 3.3 摘要行（D 区，无 sheet 时的可见性）

- 紧急联系人：显示「张三 · 138****0000」或空态「未填写（报名时会要求填写）」；
- 健康/用药备注：`已填写` badge 或「未填写」——**摘要在 Tab 页上永不展开正文**
  （safety 正文只存在于 sheet 与报名表单，减少肩窥面）。

【RATIONALE】摘要行显示手机号需脱敏（`138****0000`）是新增的前端表达约定：
Tab 根页是截屏/演示高发区（README/交互审查多处以截图为证），脱敏降低被动暴露；
sheet 内编辑时显示全号（用户在主动操作自己的数据）。person.phone 原文在报名/联络场景
不受此约定影响（那是工作数据，另有权限门）。

---

## 4. 「下次出发，少填一点」承诺的兑现路径

【CODE FACT】safety 数据真正被消费的场景是报名预填：fillFromProfile 只补空字段
（signup.js:158-164），提交后回写（signup.js:301-321）。即「填一次，之后报名自动带出」
在代码上已完全成立。

【DESIGN DECISION】me 页与激活流中所有 safety 文案统一强调这个闭环：
「填一次，报名时自动带出。」——替代现状「以上内容修改后自动保存」这类机制描述。
机制反馈（已保存/正在保存）保留在 sheet 内部状态行（11-ui-spec.md）。
