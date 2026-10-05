# Final Integration Audit

> 审计日期：2026-10-05 晚 · 审计人：Profile Agent（只审计，§一 允许的两处修正除外，见 Commit Audit）
> 审计对象：`feature/profile-redesign` 相对 master 的全部提交
> 模拟环境：临时 worktree `integration/profile-merge-check`（审计后已删除，未触碰真实 master）

## Git

- **Base（审计起点）**: master `8e2426c`
- **Base（模拟集成实际起点）**: master **`fbdf6f7`** —— 审计期间 master 已前进两个提交
  （`09ac0a3` test(e2e) 判据修正、`fbdf6f7` docs 十连跑读数回填；只动 `SYNC.md` /
  `golden-path-v1.md` / `e2e-golden-path-test.js`，与分支 12 文件**零交集**）
- **Profile HEAD（审计后）**: `4eb0f63`（7 个提交；§三 模板中的 5 个 + 审计期修正 2 个）
- **Working tree**: clean（profile worktree 与主工作区均 clean；模拟 worktree 已移除）
- 并行开发实况：Bug Fix Agent 已在 `D:/OurTrail-vehicle-ui [win/vehicle-ui-recovery]`（基于 fbdf6f7）开工

## Commit Audit

| Commit | 职责 | 裁决 | 核查要点 |
|---|---|---|---|
| `35fad94` profile: implement identity hub P0 | me 页 IA + 错误三作用域 + 草稿 v2 + 统计/最近活动（5 文件，全部 me 域+测试） | **PASS** | 无 unrelated；生产 diff 无 console.log/debugger/TODO；未碰权限层 |
| `20165cf` profile: add onboarding and draft isolation | signup 档案闸门直达 + setOpenId 回填（3 文件 ±25 行） | **PASS** | 职责单一；无 debug 痕迹 |
| `e49a1e9` profile: add me selector | selectors 新增 me 分支 + smoke §16（2 文件） | **PASS** | 见下 selectors/smoke 专项 |
| `47d5fea` profile: switch me page to single me read | me.js 单读 + scenario-me 换桩 + lab 镜像同步（3 文件） | **PASS（有保留）** | ⚠ 提交信息声称「me-view 退役删除」但实际未删——由 `4eb0f63` 补救（见下） |
| `208ffa5` profile: add implementation log | 纯文档（1 文件） | **PASS** | — |
| `3cebada` profile: fix discard resurrection | **审计期修正（§一 允许）**：§十一 核查发现的真缺陷——`onDiscardConfirm` 不取消防抖定时器，放弃发生在最后输入 800ms 内时草稿被写回甚至落库；补取消 + 回归断言 | **PASS** | 非新功能，属集成正确性错误修正；C1 提交信息的失实声明已在该提交信息中修正 |
| `4eb0f63` profile: retire dead me-view.js | **审计期卫生修正（§一 允许）**：删除零引用死文件（47d5fea 信息与实际不符的补救），只删文件零行为改动 | **PASS** | check.js 全绿；selectors.js 中两处「与客户端 me-view.js 同口径」注释按 03 §3.2 口径理解 |

**Cherry-pick 顺序**：按上表从上到下（35fad94 → 20165cf → e49a1e9 → 47d5fea → 208ffa5 → 3cebada → 4eb0f63）。

## selectors.js

**Conflict Risk: LOW**（对当前 master `fbdf6f7`：**零冲突，已实证**）

- Bug Fix 侧（`e6fcc92`，已含于共同基线 8e2426c）：2 个 hunk，位于 1–124 行区——import 行 + `rowView` 的
  `needsOutboundBoarding` 字段。
- Profile 侧：3 个 hunk，位于 246–390 行区——`visibleActivitiesFor`/`positionRowsFor` 助手抽取（246 前置块）、
  `kind:'me'` 新分支插入、home 分支改为调用助手。
- **无同一函数、无共享 hunk、无隐式行为依赖**（rowView 与 selectView 互不引用对方修改面；home 分支重构
  只是把既有逻辑原样搬进助手，行为不变——e2e 65/0 与 smoke 一致性断言双重钉死）。
- master 新增两提交未碰 selectors.js → cherry-pick 上下文与基线一致，模拟零冲突。
- **若发生冲突（如 Bug Fix 后续改 rowView/home meta）**：保留规则——`rowView` 的 needsOutboundBoarding
  属 Bug Fix；`kind:'me'` 分支与两个助手属 Profile；对 home 分支 `positionRows` 块的改动应改在
  `positionRowsFor` 助手内（单一出处），不得回退为内联重复实现。

## smoke-test.js

**Conflict Risk: LOW**

- Bug Fix（e6fcc92 与 fbdf6f7）**从未碰过 smoke-test.js**（git diff 实证）。
- Profile 侧：唯一删除行 = import 行（加 `selectSensitive, selectContact`）；新增 = 尾部追加第 16 节
  （§1–15 未动、未重编号、无重复用例名）；无 fixture 冲突（16 节自建独立 state，与既有节零共享）。
- 集成模拟中 smoke 160/0——既有 106 条全部保留并通过（含 Bug Fix 依赖的 §1–15 全部断言）。

## Simulated Integration

**PASS** —— 临时 worktree 从 `fbdf6f7` 建 `integration/profile-merge-check`，按序 cherry-pick 全部 7 个提交：
**零冲突、零 fallback**，产物 hash `e3f01af…cd7b9a0`，工作区 clean。审计后模拟 worktree 与分支已删除。

## Test Results

| 套件 | 基线（8e2426c, Phase 0） | 分支最终（4eb0f63） | 集成模拟（fbdf6f7 + 7 commits） | 差异 |
|---|---|---|---|---|
| check.js / check-handlers | ALL PASSED | ALL PASSED | **ALL PASSED** | 无 |
| smoke-test | 106 | 160/0 | **160/0** | +54（Profile 补洞） |
| scenario-me | 98 | 143/0 | **143/0**（skipped=0） | +45（含审计期 +1 回归） |
| scenario-signup | 100 | 103/0 | **103/0** | +3 |
| scenario-activity | 136 | 136/0 | **136/0** | 无 |
| scenario-workspace | 111 | 111/0 | **111/0** | 无 |
| scenario-api | 27 | 27/0 | **27/0** | 无 |
| e2e-test（A 层） | 65 | 65/0 | **65/0** | 无 |
| e2e-fault-probe | 34 | 34/0 | **34/0** | 无 |
| trailapilab | 25 | 25/0 | **25/0** | 无 |
| lab-dryrun | 165 | 165/0 | **165/0** | 无（lab 镜像 sync-lab 后护栏通过） |
| 真机（DevTools 自动化） | — | Batch A 29/29；Batch B 回归 29/29 | 不适用（模拟环境无 DevTools 会话） | 真机在部署后形态已验证 |

## Security

**PASS**

- `permissions.js / schema.js / commands.js / index.js / store.js / invariants.js`：`git diff 8e2426c..HEAD` **零改动**（实证）。
- `kind:'me'` 分支内**无任何** `selectSensitive/selectContact/canReadSensitive` 调用（grep 实证）；
  返回形状逐字段核对：本人 `personView`（与既有 `kind:'profile'` 的本人语义完全一致，无放大）+
  计数 + slim recent（id/title/startAt/phase/role，无人员资料）+ positionRows（仅本人/有效代报行，name 字段，
  与 home meta 同源同权限）。**未把任何他人敏感数据（emergency/medical/phone）加入 me 投影**。

## Deployment Ordering

**结论：顺序约束成立且已按此执行，不存在「前端先上线 → kind:'me' 不存在」的窗口。**

1. **trailApi deployment**（含 me selector）——✅ 已部署（env `cloud1-d9ghcm034574b9d55`，21 文件）
2. **cloud function smoke / 真实链路验证**——✅ 本地 smoke 160/0；真机 29/29 在已部署函数上跑通
   （含 write→read 回环，实证新代码已生效、无超时征兆）
3. **frontend deployment**（me.js 单读版本）——⚠ **必须在 1 之后**发版；若顺序颠倒，旧云函数对
   `kind:'me'` 返回 FORBIDDEN「不支持此读取请求。」，「我的」页落 denied 面板（有重试按钮，可恢复、
   无数据损坏——但不可接受，故顺序为硬约束）
4. **real device verification**——集成发版后按 13 §6 再走一遍 me 页主链

反向（新函数 + 旧前端）安全：旧前端不发 me 请求，新分支为无害死代码。

## Known Papercuts

| 项 | 裁决 | 说明 |
|---|---|---|
| `_saving` 在途时点「完成」需再点一次 | **FOLLOW-UP** | 早退守卫不关闭 sheet；再点即成，不阻塞集成 |
| companion.remove 幂等语义与设计文档 SF-4 不一致 | **FOLLOW-UP** | 代码为准（canExecute 层 FORBIDDEN），smoke §16c 钉死；若要改文档属产品侧动作 |
| ~~放弃后防抖写回~~ | **已修复（3cebada）** | 审计 §十一 发现的真缺陷，回归断言在 scenario-me（「★ 放弃后越过防抖窗口」） |
| CLI 部署不继承控制台超时 | **FOLLOW-UP** | 真实链路全通无超时征兆；建议控制台人工复核一次 =20 秒 |

## Recommended Cherry-pick

推荐（在主工作流以最新 master 为起点，按序执行）：

```bash
git cherry-pick \
  35fad94 \
  20165cf \
  e49a1e9 \
  47d5fea \
  208ffa5 \
  3cebada \
  4eb0f63
```

（7 个全部采纳；本审计在模拟环境以 fbdf6f7 为起点实证零冲突。若主工作流集成时 master 又前进，
请确认新提交是否触及 `selectors.js` / `smoke-test.js` / `me.*` / `signup.*`——触及则先读
implementation-log 的冲突保留规则。）

**部署铁律**：cherry-pick 落库后，**先部署 trailApi，再发前端版本**（§八 顺序 1→3 不可颠倒）。

## Conflict Resolution

模拟集成**未发生冲突**，无需解决。若未来 cherry-pick 冲突，按本文件 selectors.js / smoke-test.js 节的
保留规则逐文件处理：Profile 侧保留 `kind:'me'` 分支与两个助手；Bug Fix 侧保留 rowView/
needsOutboundBoarding；对 home 分支 positionRows 块的新改动一律进 `positionRowsFor` 助手。

## Final Verdict

**READY TO INTEGRATE**
