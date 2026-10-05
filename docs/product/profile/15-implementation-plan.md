# 15 · Implementation Plan（给第二阶段 Developer Agent 的执行顺序）

> 目标读者：拿到 implementation-checklist.md 后开工的 Developer Agent。
> 本文给执行顺序、每步的门禁与「做到什么算完」。铁律先行：开工前 `git pull`；
> 分支 `win/<topic>`；提交前 `node tools/check.js`；一次只做一件事（PARALLEL_DEV.md）。

---

## 阶段 0 · 准备（半小时）

1. 读本文档包：README → 01（现状事实）→ 03（IA）→ 11（UI 规格）→ 12（状态/错误）；
2. 读 `.agents/skills/ourtrail-ui/SKILL.md` + 3 个 references（改 miniprogram/ 的强制前置）；
3. 确认基线：`git branch --show-current` = master、工作区在途改动（needsOutboundBoarding 批）
   是否已合入——**若未合入，等它进 master 再开工**（me 页虽无冲突文件，但 selectors/permissions
   同文件改动会挡你的批 B）；
4. 跑一遍基线全量门禁，记录当前各套件 passed=N（数字是快照，以脚本输出为准）。

## 阶段 A · P0 纯前端（预计 2–3 个工作单元）

### A1. me.js 状态与逻辑重构（不动 WXML，先让逻辑可测）
- 错误/hint 作用域拆分（12 §5–§6）：data.error / sheetError / companionError；
- 激活态派生 `activated`；onboardingOpen 状态与 handler（复用 persistPerson）；
- 草稿 v2 键 + savedAt + setOpenId 回填（05 §6 / 12 §3）+ v1 兼容读；
- 统计/recent 客户端推导函数（03 §3.2 口径）——**抽成纯函数放 `miniprogram/utils/` 或页面内
  顶部纯函数段**，可被 scenario-me 直接 require 测试（SYNC.md:162 教训：不要把逻辑镜像进测试）；
- 门禁：`node tools/scenario-me-test.js`（迁移后的断言）+ `node tools/check.js`。

### A2. me.wxml/wxss 按 11 重排
- 顺序 A→G；样式全部复用现有类（11 §2–§8）；overlay 四+二个（表见 11 §9）；
- sheet 补 cursor-spacing（11 §9）；
- 门禁：check.js + check-handlers.js（me 目标）+ scenario-me 全绿。

### A3. signup/editor 拦截卡直达按钮（P0 小项）
- signup.js 拦截分支加 `wx.switchTab` 按钮（editor.wxml:439 为范式）；scenario-signup 加断言。

### A4. 测试迁移（13 §3 清单）
- ISSUE_EMERGENCY 闸门转正、命名 toast 断言、错误作用域断言、统计/横幅/激活流新节；
- 门禁：scenario-me + scenario-signup 全绿且 skipped=0。

### A5. 批 A 收尾
- SYNC.md 变更日志条目（根因/修复/测试数）；真机走查（13 §6 最后一条）；
- **本批无云函数改动，不部署。**

## 阶段 B · P1 前后端（1–2 个工作单元，含一次 trailApi 部署）

### B1. smoke 补洞（可提前，与 A 并行）
- 13 §4 表的 membership/profile.save 拒绝路径、canReadSensitive/readContact/export.record 直测、
  companion.remove/position.revoke 域级——**纯 smoke，不需要部署**，先落先绿。

### B2. `kind:'me'` selector（06 §2 规格）
- selectors.js 新分支（复用 personView 与 positionRows 过滤函数，**不复制实现**）；
- smoke 新增口径矩阵用例（13 §4 最后一行）；
- trailApiLab 不需要同步（lab 不读 me 视图）——但 domain 双份同步纪律核查：
  【CODE FACT】trailApiLab 与 trailApi 共用 domain 文件的部分字段有镜像
  （field.js/permissions.js/selectors.js 在 lab 侧有副本）——**B2 若动 lab 侧镜像文件需同步**，
  以 `tools/trailapilab-test.js` 与 `tools/lab-dryrun-test.js` 全绿为准。

### B3. me 页切单读
- me.js reload 改为单 `read {kind:'me'}`；revision/person/companions/positionRows/stats/recent
  从新视图取；
- scenario-me 数据桩换新视图形状；
- 部署 trailApi（上传并部署：云端安装依赖；**部署后核对控制台超时 20 秒**）；
- 真机回归：me 页 + 报名页 + 编辑器（profile 闸门路径）+ golden-path 相关节点。

### B4. 批 B 收尾
- roster-panel 文案（10 §3）+ 撤销确认（11/07）；
- SYNC.md 条目标注「需重新部署 trailApi」；全量门禁 sweep。

## 阶段 C · P2 备选（不排期，独立小批）

- profile.save avatar 净化对齐（05 §5）；
- 二维码评估（10 §5，与 roster-panel 键盘批同批）；
- home meta.positionRows 退场评估、home 页问候语 W1 优化（06 §3）。

---

## 全量门禁（每批收尾必跑）

```bash
node tools/check.js && node tools/check-handlers.js && \
node cloudfunctions/trailApi/smoke-test.js && node tools/astro-test.js && \
node tools/gpx-test.js && node tools/sky-test.js && node tools/route-schedule-test.js && \
node tools/weather-page-test.js && node tools/watch-points-test.js && \
node tools/weather-model-test.js && node tools/space-time-test.js && \
node tools/space-time-draw-test.js && node tools/roam-scrubber-test.js && \
node tools/scenario-editor-test.js && node tools/scenario-activity-test.js && \
node tools/scenario-signup-test.js && node tools/scenario-me-test.js && \
node tools/scenario-workspace-test.js && node tools/scenario-api-test.js && \
node tools/e2e-test.js && node tools/e2e-fault-probe-test.js
```

（e2e-ui-test / e2e-golden-path 需开发者工具与真实流造数，按 13 §6 在批收尾跑。）

## 完成定义（DoD）

- [ ] 13 §6 验收口径全部勾选；
- [ ] SYNC.md 两批条目在案；批 B 条目含「需重新部署 trailApi」与超时核对记录；
- [ ] 07 §2 矩阵逐格未变（可由 smoke 的敏感读用例组证明）；
- [ ] 真机走查录像/截图归档到本批 PR 描述。
