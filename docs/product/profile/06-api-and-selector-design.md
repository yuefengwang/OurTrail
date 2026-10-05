# 06 · API & Selector Design（Current/Target API Matrix 与 me 视图裁决）

> 本文回答任务书 §6/§13：为什么「我的」读 home？要不要专用 me 视图？
> 前提事实：**每次请求的边际成本 = `loadState` 全量水合 15 个集合**（store.js:70-82，
> AGENTS.md 自注「first scaling wall」）；`read` 是单一 action 按 `request.kind` 分支
> （index.js:61-66 → selectors.js:249+），新增 kind 不新增传输通道。

---

## 1. Current API Matrix（Profile 域全部触点）

| API / Command | 调用方 | 数据 | 读/写 | 敏感度 | 是否合并 |
|---|---|---|---|---|---|
| `read {kind:'profile'}` | me(:103,298) signup(:57,398) editor(:561,797) home(:46) | 本人 person 全量 + companions + id | 读 | 本人全量（含 medical/phone/emergency） | home 页只用了 name 一字段 → **浪费点 W1** |
| `read {kind:'home', perspective:'participant'}` | me(:104)（home 页 :43 也读） | 全量 activityView（含 routeSnapshot.track）+ meta（positionRows…） | 读 | positionRows 仅本人可执行撤回者可见 | me 只用 positionRows → **浪费点 W2**（最重：track 折线 ≤200 点 × N 场） |
| `dispatch profile.save` | me(:185) signup 回写(:310) | 全量 person | 写 | — | 保留 |
| `dispatch companion.save` | me(:324) signup 回写(:316) | 单个 companion | 写 | — | 保留 |
| `dispatch companion.remove` | me(:337) | companionId | 写 | — | 保留 |
| `dispatch position.revoke` | me(:356) activity(:520) | activityId+signupId | 写 | 授权撤回 | 保留 |
| `dispatch membership.save / membership.revoke` | roster-panel(:348-375, 316-325) | 工作授权 | 写 | 组织者专属 | 保留（UI 改进见 10/07） |
| `getPhoneNumber`（非 dispatch） | me(:258) | code→phone | 读 | 微信授权换码 | 保留 |
| `readSensitive / readContact / readExport / readForm` | activity/roster-panel/signup 编辑 | 活动内他人资料 | 读 | purpose 门槛 | 与「我的」无关，不动 |

【CODE FACT】me 页两读在 `Promise.all` 中并行（me.js:102-105），revision 取 profile 读的返回
（me.js:119）——两读同 batch 时 revision 一致，CAS 基准无歧义。

---

## 2. 裁决：profile read + home read 的去留

【DESIGN DECISION】**两步走：P0 保留两读；P1 新增 `request.kind:'me'` 专用视图，me 页切单读。**
既不是「一个 GET /me 万岁」，也不是永久两读。

【RATIONALE】
- 反对立刻合并的理由：P0 的重设计是 IA/交互层（前端可独立交付、不碰云函数、不付「需重新部署
  trailApi」的成本与风险——AGENTS.md 铁律 7）；两读虽浪费但已是现状基线，不新增成本。
- 反对永久两读的理由：W2 是最重的一类浪费（track 折线），且 me 视图能把统计口径算准
  （03 §3.2 的 owner‖joined 近似误差只有服务端能消除）；一个新 kind 分支是现有架构内的
  纯增量（selector 是纯函数，smoke 可测）。
- 反对「扩展现有 home view」（方案 C）：home 的消费者是首页卡片，往 meta 里继续塞 profile
  会让最重的视图更重，方向错误。
- 反对「保留两个读 + 前端拼装」（方案 A）作为终态：拼装逻辑（positionRows 拼标签、统计推导）
  会散在页面里，正是 SYNC.md:162 反对过的「页面逻辑镜像进测试」温床。

### Target `kind:'me'` 视图（P1 规格）

```js
// selectView 新分支（domain/selectors.js），纯函数、逐字段构造
{
  kind: 'me',
  profile: { id, person: personView(person), companions: [{ id, person: personView(c.person) }] },
  stats: { ongoing: N, finished: N, organized: N },      // 口径见 03 §3.2，服务端精确口径：
                                                         //   ongoing: phase∈[published,gathering,active,closing] 且（owner 或 本人 current signup）
                                                         //   finished: phase=archived 且（owner 或 存在本人报名记录，任意 status）
                                                         //   organized: ownerId===actor 的活动数
  recent: [ { id, title, startAt, phase, role: 'owner'|'participant', confirmedCount? } ],  // ≤3 条，无 routeSnapshot
  positionRows: [ { activityId, activityTitle, signupId, name } ],  // 与 home meta.positionRows 同构造同权限（selectors.js:284-287 复用同一过滤）
}
```

【IMPACT】
- 后端：selectors.js 新增一个分支（复用 personView/positionRows 过滤逻辑，不复制实现）；
  index.js 无改动（read 已透传 request）；**需重新部署 trailApi**；
- 前端：me.js reload 切为单读；`meta.positionRows` 的 home 版本保留不删（home 页暂无消费者但
  删除牵动 selectors 测试，列为 P2 清理项）；
- 测试：smoke 新增 me 视图用例（口径矩阵），scenario-me 换数据源桩。
【RISK】两套口径（P0 前端近似 vs P1 服务端精确）切换时计数跳动 ±N——已在 03 §3.2 声明接受。
【PRIORITY】P1。

---

## 3. home 页的 profile 读（W1）与 editor 的 home 读

【DESIGN DECISION】
- W1（home 页为问候语读全量 profile）：P1 随 me 视图一并解决——home 读可改由
  `kind:'me'` 的轻量形态或直接在 home 视图 meta 捎带 `profileName`。**P0 不动**（改动不值当，
  一句话问候不是本轮目标）。
- editor 的 home(organizer) 读（复制模板用 id+title）：超出 Profile 域，记录在案，由交互审查
  结构批统一处理，本轮不碰。

【RATIONALE】任务书 §27：不为设计完整性顺手重构无关页面。W1/W2 全部记录在案、分期处理。
【PRIORITY】W1: P2；W2: P1（me 视图）。

---

## 4. 写路径的 Target（全部保留现有命令，无新增 mutation）

【DESIGN DECISION】写操作维持 5 个命令不变：profile.save / companion.save / companion.remove /
position.revoke（me 域）+ membership.save / membership.revoke（协作域，UI 改进见 10）。
理由：命令已覆盖全部语义；激活流、编辑 sheet、报名回写都只是**新调用方**，不是新语义；
新增 REST 风格 mutation 会绕开 canExecute/CAS/幂等回执的既有漏斗（AGENTS.md：客户端无法绕过
domain 层——这是要保住的性质）。

唯一的域层微调（P2，可选加固）：profile.save 处理器给 avatar 补与 normalizedPerson 同款的
trim/截断/空删净化（05 §5）。

---

## 5. Target API Matrix（终态）

| API / Command | 变化 | 说明 |
|---|---|---|
| `read {kind:'me'}` | **新增（P1）** | me 页单读；smoke 覆盖口径矩阵 |
| `read {kind:'profile'}` | 保留 | signup/editor/home 的消费不变；me 迁走 |
| `read {kind:'home'}` | 保留 | meta.positionRows P1 起对 me 页冗余，P2 评估移除 |
| `dispatch profile.save` | 保留 | P2 可选：avatar 净化对齐 normalizedPerson |
| `dispatch companion.*` / `position.revoke` | 保留 | 无变化 |
| `getPhoneNumber` | 保留 | 含错误分类映射（index.js:211-216） |
| `membership.*` | 保留 | roster-panel 错误文案微调（P1）；撤销加确认（交互审查 P1#6，随本轮顺手修） |

【CODE FACT】「新增 API 必须说明为什么不能复用现有架构」——`kind:'me'` **就是**复用现有架构：
同 action（read）、同漏斗（loadState→selectView）、同测试基建（smoke 直调 reduceCommand/selectView），
唯一新增是一个纯函数分支。这是本设计对任务书 §13 的正面回答。
