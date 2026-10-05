# Implementation Checklist（第二阶段 Developer Agent 直接执行清单）

> 基线：master HEAD `15cafdb`。标记：〔A〕批 A 纯前端 /〔B〕批 B 前后端（需部署 trailApi）/
> 〔C〕P2 备选。每项后的括号是设计依据编号（docs/product/profile/ 内文件）。

---

## 1. Frontend

### miniprogram/pages/me/me.js（重构）
- 〔A〕错误/hint 作用域拆分：`data.error`（页面级）/ `sheetError` / `companionError`；打开编辑面互斥清空（12 §5–§6）
- 〔A〕新增 `activated` 派生 + onboarding 状态与 handler；激活 sheet 保存复用 persistPerson（04 §4）
- 〔A〕草稿升级 v2：新键 `ourtrail.draft.me.person.<openid>` + `savedAt`；v1 兼容读；旧键清理（05 §6, 14 §2）
- 〔A〕reload 成功分支调 `draftUtil.setOpenId(profile.id)`（12 §3）
- 〔A〕统计/最近活动客户端推导：抽纯函数（口径 03 §3.2；避免镜像进测试，SYNC.md:162）
- 〔A〕草稿横幅：条件渲染数据 + 「立即保存 / 放弃本机修改」handler（放弃走 dialog 确认）（12 §4）
- 〔B〕reload 切单读 `read {kind:'me'}`；revision/person/companions/positionRows/stats/recent 新取数（06 §2）
- 保留不动：自动保存时序全部（me.js:148-223）、微信取号五分支（:255-282）、头像上传（:230-251）、
  `_saving`/onUnload/CAS 逻辑（:84-89, :182, :185）

### miniprogram/pages/me/me.wxml（重排为 Hub）
- 〔A〕结构 A→G 七卡（03 §2 / 11 §1-§8）；页头文案替换（11 §1）
- 〔A〕D 组三摘要行 + 三个编辑 sheet（手机号/紧急联系人/健康备注），摘要脱敏 `138****0000`（09 §3.3, 11 §5）
- 〔A〕C 组最近活动 list-row + 空态（11 §4）；A 组 `.metrics` 三计数（11 §2）
- 〔A〕F 组协作码缩略 + 复制 + 未激活副文案（10 §4）；toast 文案改「协作码已复制」
- 〔A〕E/G 组迁移：语义句与位置授权说明句一字不改（me.wxml:104, :130）；弹层内错误保留（P0-4）
- 〔A〕B 区反馈 callout 移至 A 卡下（11 §3）
- 保留不动：denied/loading 两态（me.wxml:2-5）

### miniprogram/pages/me/me.wxss
- 〔A〕预计 **零新增类**：`.wx-row/.avatar-btn/.nick-input/.avatar-fallback/.phone-btn/.code-text`
  全部复用；新增仅可能的 `.metric` 组合照排微调（11 §10：新色值=0、组件字面量=0）

### miniprogram/pages/me/me.json
- 〔A〕核对 `enablePullDownRefresh` 存在（me.js:79-81 依赖；缺失则补）

### miniprogram/pages/signup/signup.js + signup.wxml
- 〔A〕无档案拦截卡（:79-82）加「30 秒完善资料」直达按钮 `wx.switchTab` me（范式 editor.wxml:439）（04 §3）
- 〔A〕profile 读成功分支调 `draftUtil.setOpenId(profile.id)`（12 §3）
- 保留不动：fillFromProfile 只补空（:152-167）、回写链与快照底（:301-321, :310-314）、consent 三键 UI

### miniprogram/pages/editor/editor.js / editor.wxml
- 〔A〕无改动（profileGate 直达按钮已在案修复）；仅核对文案与新 IA 词汇一致

### miniprogram/components/roster-panel/roster-panel.js + .wxml
- 〔B〕membership.save 失败文案追加「（对方需先在『我的』完善资料）」（04 §3）
- 〔B〕membership.revoke 前加 dialog 二次确认（交互审查 P1#6 处置；危险操作纪律 review-checklist）

### miniprogram/utils/draft.js
- 〔A〕零改动（setOpenId/wxStorage 已有能力；v2 键由 me 页管理）

### 新页面 / 新组件
- **无**（P0 页面数 0、组件数 0——11 §11；P2 二维码若立项再评估）

---

## 2. Backend（cloudfunctions/trailApi）

### domain/selectors.js
- 〔B〕新增 `request.kind === 'me'` 分支：profile（复用 personView）+ stats（口径 03 §3.2）+
  recent（≤3 条 slim）+ positionRows（**复用** home 分支的过滤实现，抽成局部函数共享）（06 §2）
- 不动：personView/rowView/selectSensitive/selectContact/selectSignupForm/selectExport/home 分支

### domain/profile.js
- 〔C〕可选：avatar 净化对齐 normalizedPerson（trim/截 500/空删）（05 §5）
- 不动：name+phone 激活门槛（05 §2 裁决）、整体替换语义（05 §3）、membership 前置（08 §2）

### domain/permissions.js / schema.js / commands.js / index.js / store.js
- 〔A/B〕**零改动**（07 §2：权限矩阵一格不变；06 §4：写命令零新增）

### cloudfunctions/trailApiLab/
- 〔B〕核查 lab 侧 domain 镜像（field.js/permissions.js/selectors.js 副本）是否需同步 me 分支——
  以 `tools/trailapilab-test.js` + `tools/lab-dryrun-test.js` 全绿为准（15 §B2）

---

## 3. API

| 处置 | 项 |
|---|---|
| 保留 | read(profile/home)、dispatch(profile.save/companion.save/companion.remove/position.revoke/membership.*)、getPhoneNumber、readSensitive/readContact/readForm/readExport |
| 新增 | 〔B〕read 新增 `request.kind:'me'`（同一 action 内分支，无新 transport）（06 §5） |
| 修改 | 无（无任何现有视图/命令签名变化） |
| deprecated | 无（home meta.positionRows P2 才评估退场） |

---

## 4. Data

- 迁移：**后端无迁移**（schema 不动，14 §1）；本地草稿 v1→v2 读时转换（14 §2）
- 兼容性：新 kind 对旧客户端不可见；发布顺序 = 先云函数后前端（14 §3）
- 存量数据影响：零（ot_profiles/ot_signups/ot_memberships 均不动）

---

## 5. Test

| 类型 | 文件 | 动作 |
|---|---|---|
| 修改 | tools/scenario-me-test.js | 13 §3 全部：闸门转正（ISSUE_EMERGENCY/取消提示）、toast 断言、错误作用域、统计/recent 节、横幅节、激活流节、setOpenId 断言；〔B〕数据桩换 me 视图形状 |
| 修改 | tools/scenario-signup-test.js | 拦截卡直达按钮断言；setOpenId 断言 |
| 修改 | tools/scenario-workspace-test.js | 〔B〕撤销授权确认断言 |
| 新增 | cloudfunctions/trailApi/smoke-test.js | 13 §4 表：membership save/revoke、companion.remove、position.revoke、profile.save 拒绝、canReadSensitive/readContact 直测、export.record、〔B〕me 口径矩阵 |
| 新增 | tools/e2e-test.js | onboarding 主链节点（激活→贴码授权→错码 NOT_FOUND）（13 §5） |
| 新增 | tools/e2e-golden-path-test.js | 〔真机〕GP-14 新用户激活→协作授权 |
| 新增 | tools/e2e-ui-test.js | me 页 IA 四态 + 激活 sheet 真实 tap 流 |
| 新增 | tools/e2e-fault-probe-test.js | me 视图 3 项变异（〔B〕）；前后双跑（13 §5） |
| 回归红线 | 见 13 §2 表（草稿回归组/自动保存组/回写保 avatar/用途门槛 e2e 等） | 不得回退 |

---

## 6. UI（自检清单）

| 用什么 | 项 |
|---|---|
| 现有组件 | status-panel / person-row / form-field / overlay / icon；类：.card/.card-header/.list-row/.metrics/.badge/.callout/.button*/.code-text/.tabular/.eyebrow/.page-title/.small/.muted |
| token | 全部 var(--*)，新增色值=0；对比度 ≥4.5:1 抽查（11 §10） |
| 页面状态 | denied(重试)/loading(骨架)/各卡空态/保存失败反馈/草稿横幅/未激活引导（11 §10 四态表） |
| 平台坑 | apply-shared（本页无新组件，核对 overlay/form-field 未动）；overlay 关闭态 pointer-events；Tab 页 84px 留白（me.wxss:2 保留）；cursor-spacing 补齐（11 §9）；44px 触控 |
| 真机验证 | 激活流/三 sheet/横幅/位置撤回各一条路径（13 §6） |

---

## 7. 顺序与门禁

执行顺序、每批门禁、DoD：见 15-implementation-plan.md 阶段 A/B/C 与全量门禁命令块。
开工前再读一遍 PARALLEL_DEV.md 铁律与 `docs/e2e-mp/README.md`（改 WXML 后静态绿 ≠ 页面正常）。
