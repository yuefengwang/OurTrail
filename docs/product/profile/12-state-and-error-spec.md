# 12 · State & Error Spec（一致性模型、草稿 v2、错误作用域）

> 回答任务书 §7 的全部问题：谁是 source of truth？什么时候写草稿/服务端？
> server 失败、页面离开、小程序被杀、重进、两台设备各怎么办？

---

## 1. 一致性模型（正式定义）

```
Server（ot_profiles 文档）      —— 唯一真源（SoT）
Local Draft（wx storage v2）    —— 救援缓冲：只承接「服务端暂时收不下的输入」
Page State（data.person）       —— 渲染态 = mergeDraft(server)；永远整份构造，不增量补丁
微信临时数据（avatar temp path）—— 秒级生命周期：chooseAvatar 回调内立即 uploadFile，不入任何持久层
```

【CODE FACT】现状已按此模型运转（me.js:41-52 mergeDraft 草稿压服务端值之上、avatar 恒取服务端、
成功清草稿失败留草稿）。本设计**不换模型**，只补三块：可见性、归属、作用域（§3–§5）。

### 写入时序（唯一时序，所有编辑面共用）

```
用户输入 onField
  → setData(person)                       # 页面态即时
  → draft.wxStorage.set(DRAFT_KEY, v2)    # 草稿先行（先于一切网络）
  → 防抖 800ms / blur 兜底
      → persistPerson:
          草稿先写（幂等，重复写无害）
          name+phone 缺 → hint + 终止（草稿已存）
          _saving 防重入
          dispatchAndSync(profile.save, revision, page)   # CAS + CONFLICT 自动重读
          成功 → 清草稿 → hint「已保存」
          失败 → 留草稿 → 作用域内 error
```

【RATIONALE】「草稿先行」是既有实现（me.js:165）且被 scenario-me 草稿回归组钉死
（:391-461 五条），不动。

---

## 2. 各情形的正式答案

| 情形 | 行为 | 现状/变更 |
|---|---|---|
| server 保存失败（网络/校验） | 留草稿 + 作用域 error（含服务端 message）；用户重试或直接离开，输入不丢 | 现状保留 |
| server 返回 CONFLICT | dispatchAndSync 自动 reload + toast「安排已被他人更新，已刷新，请重试」（api.js:111-119）；**重读后 mergeDraft 仍把草稿压上去**——用户输入继续有效 | 现状保留（这是草稿模型的第二价值：CONFLICT 自愈不丢字） |
| 页面离开（Tab 切换） | onUnload 清定时器（me.js:84-89）；草稿留存；下次 onShow reload + mergeDraft | 现状保留 |
| 小程序被杀 | 草稿在 storage，重进后 mergeDraft 恢复输入 | 现状保留 |
| 保存成功 | 清草稿；pruneDraft 兜底清除与服务端一致的残留 | 现状保留 |
| **两台设备同时编辑** | 服务端 last-write-wins（每台都是整份替换 + revision CAS，后写者覆盖先写者）；本机草稿**继续遮蔽显示**直到下次保存成功或用户丢弃 | 现状=静默遮蔽；**本设计加横幅**（§4） |
| 同机多微信账号 | 草稿键无账号段 → 互串 | **P0 修复**（§3） |

【DESIGN DECISION】两设备场景不加锁不加提示符：档案是单人文档、低频编辑、熟人工具，
CAS 已保证不产生脏写（后写覆盖且自带完整快照）。投入产出比最高的动作是让**本机旧草稿可见、可弃**（§4）。

---

## 3. 草稿归属修复（P0，配合 05 §6 的 v2 结构）

【CODE FACT】`draft.setOpenId` 导出但全库无调用（draft.js:91；app.js 不预热），
`key()` 的账号段恒空串（draft.js:21-34）。

【DESIGN DECISION】me 页 `reload()` 成功分支调用 `draftUtil.setOpenId(profile.id)`
（数据就在手上，零额外请求）。此后：
- me 草稿 v2 键格式含账号段：`ourtrail.draft.me.person.<openid>`（v2 起把 openid 编进键名，
  与 draft.js 的 `|` 键风格统一）；
- 报名/编辑器草稿（`'|activityId|form'`）随 openid 回填自动获得账号段——**一处修复，
  三处草稿受益**；
- 【CODE FACT】openid 回填发生在首次「我的」访问后，此前的草稿仍在无账号段键下——
  可接受（多账号切换前用户必先到「我的」或报名页，报名页同样读 profile，把 `setOpenId` 一并
  加进 signup.js 的 profile 读成功分支，两行改动覆盖两条主路径）。

---

## 4. 「本机有未保存的修改」横幅（P0）

【CODE FACT】草稿无时间戳（01 §4.3）；服务端 Profile 记录无 per-user updatedAt
（State.savedAt 是全局的，schema.js:272-281）——**没有**「草稿比服务端旧」的可判定信号，
只能靠用户自己判断。

【DESIGN DECISION】当 `mergeDraft` 后草稿字段与服务端不一致（即 pruneDraft 条件不成立）时，
B 区渲染横幅：

```
.callout warning
  本机有未保存的修改（MM-DD HH:mm）——已按服务端要求等待补全/保存。
  [立即保存] [放弃本机修改]     ← 两个 .button text，44px
```

- 「立即保存」→ persistPerson()（走常规门槛与错误路径）；
- 「放弃本机修改」→ dialog 确认（危险操作纪律）→ 清草稿 → reload；
- 横幅不阻断任何操作，其余区块照常可编辑；
- 时间戳来自草稿 v2 的 `savedAt`（每次 onField 刷新，05 §6）。

【RATIONALE】现状静默遮蔽（01 §4.3）的唯一替代是「不做」；横幅把模型说给用户，
成本 = 一个条件渲染 + 两个 handler，且全部逻辑可被 scenario-me 断言。

---

## 5. 错误作用域拆分（P0，SF-5 处置）

【CODE FACT】现状单一 `data.error` 同时服务：页面级保存失败（me.wxml:13）、
同行人弹层内（me.wxml:137）、同伴添加预检（me.js:291）。

【DESIGN DECISION】拆三个槽位：

```
data.error          —— 页面级（D 组 sheet 外的保存失败、position.revoke 失败）→ B 区 callout danger
data.sheetError     —— D 组编辑 sheet 内（含手机号换码失败的五分支文案）→ sheet 内 callout danger
data.companionError —— 同行人 overlay 内 → overlay 内 callout danger（P0-4 位置保留）
```

规则：**错误只在其产生的作用域渲染**；打开任一编辑面时清空其余两个槽位；
成功时清本作用域错误（现状 onCompanionSave 成功清 error 的行为保留，me.js:327）。
scenario-me 现有断言（失败报错+可重试 :510-523）迁移到新槽位语义。

---

## 6. hint 的收敛

【CODE FACT】现状 hint 承担四种语义：门槛等待提示（me.js:177）、已保存确认（:191）、
取号取消提示（:270）、保存中状态行（wxml:78 独立渲染）。

【DESIGN DECISION】拆分：门槛等待 → B 区 warning callout（文案保留）；已保存 → sheet 内
状态行「已保存」+ flashSaved 逻辑保留（me.js:93-99）；取号取消 → sheet 内 hint；
「正在保存…/已保存」状态行固定在编辑 sheet 底部（11 §5）。
【RATIONALE】语义不同频率不同：callout 是「需要你知道」，状态行是「持续反馈」，
toast 是「动作确认」——现状三者偶尔混用（hint 常驻导致用户以为出错），拆开后各自归位。

---

## 7. 读写并发的既有保障（记录，不动）

【CODE FACT】本页数据竞争的全部既有防线，实现时不得移除：
- revision CAS + CONFLICT 自愈（commands.js:122; api.js:111-119）；
- `_saving` 防重入（me.js:182）；
- onUnload 清定时器防「页面消失后 setData 并发请求」（me.js:84-89 注释）；
- 幂等回执（requestId 每次生成，api.js:99；重放按指纹比对，commands.js:116-121）；
- avatar 上传成功才并入 person（me.js:240-247），草稿永不携带 avatar（me.js:21-22）。


