# 14 · Migration Plan（迁移与兼容）

> 原则：**不破坏现有业务**。本设计对存量数据与在用链路的全部影响逐项列出，
> 每项标注是否需要「重新部署 trailApi」（AGENTS.md 铁律 7：云函数改动必须重部署）。

---

## 1. 存量数据

| 数据 | 影响 | 动作 |
|---|---|---|
| ot_profiles 文档 | **零影响**——schema 不变（05 §7），profile.save 语义不变 | 无 |
| ot_signups 快照 | **零影响**——participant 快照与 consent 结构不动 | 无 |
| ot_memberships | **零影响**——命令与校验不变（roster-panel 仅文案/确认交互变化） | 无 |
| 本地草稿 v1（`ourtrail.draft.me.person.v1`） | v2 键上线后 v1 成为孤儿数据 | 读时兼容迁移（§2） |
| `ourtrail.openid` 存储键 | 从「永远为空」变为「me/signup 读 profile 后回填」 | 值语义不变（openid 原文），无迁移 |

【CODE FACT】本项目无迁移脚本先例：`store.ensureCollections` 冷启动自动建集合
（AGENTS.md NOTES），schema 用「新字段必须 optional」保持旧数据可读（ADR-0003）——
本设计遵守同一纪律，**不需要任何后端迁移步骤**。

---

## 2. 本地草稿 v1 → v2 迁移（纯前端，一次读时转换）

```
reload() 读草稿：
  v2 = storage.get('ourtrail.draft.me.person.<openid>')      // 新键（openid 回填后）
  if (!v2) legacy = storage.get('ourtrail.draft.me.person.v1')
    && legacy 存在 → 构造 v2 {fields: legacy, savedAt: ''}（无时间戳则横幅不显示时间）
  写路径只写 v2；v1 在下一次成功保存后顺手 storage.set(v1键, null) 清除
```

【RATIONALE】时间戳缺失的旧草稿仍要显示横幅（内容差异才是横幅条件），只是不显示时间——
横幅条件是「草稿字段 ≠ 服务端字段」（12 §4），不依赖 savedAt。

---

## 3. 接口兼容性

| 变更 | 兼容性 | 部署要求 |
|---|---|---|
| P0（IA 重构 + 草稿 v2 + setOpenId + 错误作用域） | 纯前端；服务端零改动 | **无需重部署 trailApi** |
| P1 `kind:'me'` 视图 | **纯增量**：read 的新分支，旧客户端不请求它；profile/home 视图形状不变 | **需重新部署 trailApi**（随批次发） |
| me 页读切换（两读→单读） | 前端先行开关：me.js 按「me 视图请求成功与否」回退两读？——**不做回退开关**：P1 前端与服务端同批发布（小程序端发版慢于云函数时，先部署云函数再发前端是安全顺序：旧前端不认识新 kind 也不会受影响，因为它不发这个请求） | 顺序：先云函数后前端 |
| home `meta.positionRows` | P1 起对 me 页冗余但**保留**（home 页与既有测试依赖其形状）；P2 评估移除 | 无 |
| 协作码文案/缩略 | 纯前端展示 | 无 |
| roster-panel 错误文案 + 撤销确认 | 纯前端 | 无 |

【DESIGN DECISION】**不做** me 视图的特性开关/双写过渡：selector 是纯函数、smoke 全覆盖、
且新 kind 对旧客户端不可见——这里不存在需要灰度的风险面，开关只增加死代码。

---

## 4. 行为迁移说明（对用户的可见变化，写进 SYNC.md 用的清单）

1. 「我的」页从表单变为 Hub：统计/最近活动出现（新信息，无破坏）；
2. 编辑面进 sheet：自动保存语义不变，反馈位置变化（hint/callout 分工见 12 §6）；
3. 草稿横幅：新增可见性，无行为破坏；
4. 「身份码已复制」→「协作码已复制」、页面标题/分组文案变化；
5. 报名页拦截卡获得直达按钮（与编辑器 profileGate 同型）；
6. 撤销协作授权新增确认弹窗（对组织者的新摩擦——有意为之，交互审查 P1#6 裁决）。

---

## 5. 回滚预案

- P0 全部前端：回滚 = revert 提交即可，无数据残留（草稿 v2 键留存量数据无害，读取逻辑消失后
  不再被触碰）；
- P1 me 视图：回滚 = 前端回退两读 + 云函数保留新分支（无害死代码）或一并 revert；
  selector 分支独立、无共享可变状态，回滚不牵连其他视图。

---

## 6. 分批落地顺序（与 15-implementation-plan.md 的阶段对应）

```
批 A（P0·纯前端）  IA 重构 + 激活流 + 草稿 v2/横幅 + setOpenId + 错误作用域 + 测试迁移
批 B（P1·前后端）  kind:'me' 视图 + me 切单读 + smoke 口径矩阵 + membership/readContact 等 smoke 补洞
批 C（P2·可选）    avatar 净化对齐 / 二维码评估 / home.positionRows 退场评估 / W1 home 问候语优化
```

每批一个提交序列，批间跑全量门禁（15 §4）；批 B 云函数部署后按铁律在控制台核对超时 20 秒。
