# 13 · Testing Strategy（测试迁移与新增计划）

> 现状基线（01 §8）：scenario-me 81 断言（2 个已知问题闸门）、smoke 106 里 Profile 只有
> save/回读/幂等、membership 错误路径与 companion.remove/position.revoke 域级零覆盖、
> me 页无 CONFLICT 自愈用例。本计划按「先保住、再补洞、后随功能」组织。

---

## 1. 测试风格与基建（沿用，不引入框架）

【CODE FACT】全部测试是手写 `check(name, cond)` + `section(title)` + 退出码语义
（AGENTS.md COMMANDS 节）；scenario-me 用「捕获 Page 配置 + delete require.cache + 覆写
api 模块属性」的页面级 harness（scenario-me-test.js:80-170）。
【DESIGN DECISION】新增用例全部落在现有 harness/套件里；不引入 jest/miniprogram-simulate；
页面断言继续走「真实 tap/input + 后果观测」的 UI 语义（docs/testing/e2e-result-semantics.md），
UI E2E 的一条 PASS 必须由真实交互构成。

---

## 2. 必须保住的现有用例（回归红线）

| 套件 | 用例 | 为什么是红线 |
|---|---|---|
| scenario-me | 草稿回归组 5 条（写草稿无 avatar/切页不丢/avatar 取服务端/成功清/失败留，:391-461） | 草稿模型的核心契约 |
| scenario-me | 自动保存组（防抖/静默 hint/_saving/onUnload，:464-507） | 12 §1 时序 |
| scenario-me | 微信取号五分支（:249-329） | 平台降级文案的护栏 |
| scenario-me | 弹层内错误可见（P0-4 位置断言） | 不得回退的修复 |
| scenario-signup | 档案回写保 avatar（:597-612）、一致不回写（:536-537）、编辑回写 revision（:730-731） | 05 §3 整体替换语义的安全前提 |
| e2e-test | readForm/readExport 用途门槛 + 归档拒绝（:286-321）、无 openid AUTH_REQUIRED（:328-330） | 07 矩阵的 e2e 锚点 |
| e2e-golden-path | GP-05 companion 备料、GP-07 协作授权、GP-08 用途读改、GP-13 归档导出拒 | 主链行为锚 |

【RISK】IA 重构会动 me.wxml 结构——**凡是按 DOM 位置断言的用例必须随迁移同步改**，
但语义（输入→自动保存→草稿）断言目标不变。

---

## 3. 随 P0 改动的迁移清单

1. **紧急联系映射闸门转正**：me 页 D 组 sheet 重写 ename/ephone 字段后，
   scenario-me 的 ISSUE_EMERGENCY 4 条 skipped 断言（:658-687）转为真实校验
   （同批把 scenario-signup 的 ISSUE_ENAME 处理对齐）；取号取消提示闸门（:268-271 现状已是
   hint 分支）核对后一并转正或删除。
2. **命名变更联动**：onCopyIdentity toast「身份码已复制」→「协作码已复制」——
   scenario-me :709-711 断言同批改。
3. **错误作用域拆分**（12 §5）：:510-523 失败断言迁移到 `data.error` 语义；
   新增 sheetError/companionError 隔离断言（开 A 清 B 等）。
4. **统计与最近活动**：新增节「首屏装配 v2」——home 桩注入三场不同 phase 活动，
   断言 ongoing/finished/organized 计数与 recent 排序/截断/空态（03 §3.2 口径表直接翻译成用例）。
5. **草稿横幅**：新节「本机未保存修改」——草稿≠服务端时横幅可见 + 时间戳；立即保存/放弃
   两分支；与服务端一致时无横幅（pruneDraft 既有断言保留）。
6. **setOpenId 回填**：断言 reload 成功后 `wx.setStorageSync('ourtrail.openid', profile.id)`
   被调用（wx 桩记录）。
7. **激活流**：空档案 → 引导卡可见；激活 sheet 保存成功 → 引导卡消失 + profile.save payload
   形状（Person 键集）+「跳过」不发生任何 dispatch。

---

## 4. 补洞清单（现存零覆盖域，P1 随 me 视图/文案批次落）

| 缺口（01 §8 证实） | 落点 | 用例 |
|---|---|---|
| membership.save 错误路径（身份码不存在/过期时间非法/空 capabilities/scope.selected 空名单） | smoke-test（域级，不需 DevTools） | 4 条失败断言 + 2 条成功（staff/vehicle_contact 覆盖语义） |
| membership.revoke 全链 | smoke + scenario-workspace | 域级撤销 + 面板撤销**二次确认**（交互审查 P1#6 修复同批） |
| companion.remove 域级 | smoke | 移除成功/幂等（重复移除 no-op ok）/无 profile 拒绝 |
| position.revoke 域级 | smoke | 撤回后 positionRows 消失/重复撤回 no-op/他人代报撤回 CONSENT_REQUIRED |
| profile.save 服务端拒绝路径 | smoke | 缺 name/缺 phone 的 fieldErrors 形状；emergency 杂散键 schema 拒收（把注释里的坑变成断言） |
| canReadSensitive 直测 | smoke | 本人无条件 ok / owner 无 purpose 拒 / owner 带 purpose ok / 归档后拒 / companion（非提交者）拒 |
| readContact 直测 | smoke | 本人 ok / 车辆联络对未分配乘客拒 / 归档后工作侧拒 |
| export.record 命令（非 readExport） | smoke | 普通导出 + 敏感导出 + 用途入事件账（events 里出现「敏感名单导出：…」摘要，commands.js:59-61） |
| me 视图口径矩阵（P1 落地时） | smoke | 03 §3.2 三指标的边界（owner-only 活动计发起、cancelled 不计进行中、waitlisted 计进行中） |
| 两设备草稿冲突（语义级） | scenario-me | 桩 A 保存成功→改桩为「他人已写的新服务端值」→ 本机草稿仍显示 + 横幅时间戳不回退 |

【PRIORITY】上表全部 P1；其中 membership/profile.save 拒绝路径与 canReadSensitive 直测
**不依赖任何本轮功能**，允许提前单独落（P0 窗口内顺手做，smoke 无需部署）。

---

## 5. E2E（两层）与安全探针

【DESIGN DECISION】
- **A 层（e2e-test.js）**：新增节点「onboarding 主链」——空 profile → profile.save 激活 →
  read profile 回读 → membership.save（贴码）成功 →（负）贴错码 NOT_FOUND。
  Golden Path v1 的 14 节点不动，新增 GP-14「新用户激活→协作授权」节点
  （e2e-golden-path-test.js，真机层）。
- **B 层（e2e-ui-test.js）**：me 页 IA 重构后走一遍四态 + 激活 sheet 真实 tap/input 流
  （数据合成注入：denied=''/loading=false + profile 桩）。
- **安全探针**：参照 e2e-fault-probe-test.js 的账本变异思路，对 me 视图（P1）做 3 项变异
  （stats 篡改/recent 越权多给 1 场/positionRows 多给 1 行）验证测试能红——
  **先跑 fault-probe 建立基线，改完再跑**（docs/testing/e2e-result-semantics.md 的既定流程）。
- 【CODE FACT】fault-probe 31 项变异自证当前账本判别力；改测试语义前后的双跑是本仓纪律。

---

## 6. 验收口径（本设计的 Definition of Done，测试侧）

- [ ] scenario-me 全绿且 skipped=0（两个历史闸门转正或删除）；
- [ ] smoke Profile 域新增 ≥15 断言全绿（§4 表）；
- [ ] e2e-test A 层新增 onboarding 节点全绿；
- [ ] fault-probe 前后双跑一致（31+N 项全过）；
- [ ] `node tools/check.js && node tools/check-handlers.js` 全绿（check-handlers 对 me 页目标）；
- [ ] 真机走查（开发者工具自动化通道）：激活流、D 组三 sheet、横幅、位置撤回各一条录像级路径。
