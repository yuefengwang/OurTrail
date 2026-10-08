# 合并窗口交接 — Phase 8/9/10A 一条分支待并入 master（2026-10-08）

· 待并分支：`win/phase10a-c3-error-semantics`（worktree `D:/OurTrail-p10a`）
· 目标：`master`（合并前基线 `686fa7c`）
· **本合并已按 §2-A 执行**：中继换 IP 后恢复可达（`origin` = `ssh://yfwang@192.168.3.15/...`；
  其 ed25519 指纹与 known_hosts 里 `yfwangmacbook-pro.local`/`192.168.2.22` 的条目**逐字节一致** ⇒ 同一台 Mac，
  不是新主机，中间人风险排除）；`git fetch` 后 `origin/master` 仍是 `686fa7c` ⇒ 0-behind 成立 ⇒ 纯 fast-forward。
  因为是 ff，合并后 `master` 就等于本分支 tip（也就是含本文这一版的那个 commit），GitHub 由 `post-receive` 立刻转发。
  ⚠ 遗留：`relay` 这个 remote 还指着旧 IP `192.168.2.22`（改 remote 属 git 配置动作，业主自己做的 origin，
  relay 那条要一并改才对称）。

## 1. 形状：这是纯 fast-forward，零冲突风险

```
git merge-base master win/phase10a-c3-error-semantics   → 686fa7c（= master tip）
git rev-list --count win/...c3..master                  → 0     master 没有一提交在分支之外
git rev-list --count master..win/...c3                  → 21    待并 21 个 commit
git diff --stat master...win/...c3                      → 54 files, +5585 / -14
```

之所以是 ff：`2058e41 merge: origin/master 686fa7c（weather-v2 Visual Fidelity 11 commits）接入 Phase 8 分支`
已经把当时线上的 master 整段吃进来了。**如果 `git fetch` 后 `origin/master` 已领先 `686fa7c`，就不是 ff 了**，
按下面 B 路径走（冲突一律取并集，尤其是 `SYNC.md` 与 `AGENTS.md`）。

## 2. 推之前必做（一次都不许省）

1. `git fetch origin` 成功；`git log --oneline -1 origin/master` 记下 sha。
2. **以 GitHub/中继为准**：若 `origin/master` == `686fa7c` ⇒ 走 A；若已前进 ⇒ 走 B。
3. 本机 master 工作树干净（`git status --porcelain` 空）才允许动。

**A（ff，预期这条）**

```bash
git checkout master && git pull        # 确认仍是 686fa7c
git merge --ff-only win/phase10a-c3-error-semantics
node tools/check.js && node tools/check-handlers.js
node tools/sync-lab.js                 # 若报告有变更说明两树没同步（store.js / domain/* 改过就要跑）
git push origin master                 # post-receive 会立刻转发 GitHub，推前先确认这是合并窗口
```

**B（origin/master 已前进 ⇒ 真合并）**

```bash
git checkout master && git pull
git merge --no-ff win/phase10a-c3-error-semantics
#   冲突处理：SYNC.md / AGENTS.md 一律取并集（两条日志条目都要留，见 memory: sync-md-entries-lost-in-merge）
#   合并完逐条核对：Phase 8 / Phase 9 / Phase 10A 三条 2026-10-07/08 变更日志条目是否都还在
node tools/check.js && node tools/check-handlers.js
```

## 3. 并完之后（新基线复跑，不能沿用本会话的读数）

```bash
# 全量无头门禁 = AGENTS.md「COMMANDS」小节的完整链式命令（43 套），或按目录枚举：
#   42 个 tools/*-test.js（跳过需要开发者工具的 e2e-ui-test / e2e-ui-state-test / e2e-golden-path-test）
#   + cloudfunctions/trailApi/smoke-test.js
node tools/check.js && node tools/check-handlers.js
node cloudfunctions/trailApi/smoke-test.js && node tools/e2e-client-cas-test.js && node tools/e2e-concurrency-test.js
```

预期：**43 套 / 2750 断言**，唯一 1 红 = 已登记的 `outdoor-intelligence-ui`
（`✗ applySelection 命中 IN_CLOUD 窗口`，打线上 Open-Meteo + 真实时钟；偶发还会 ECONNRESET 崩在抓取前）。
**这条红是常驻登记项，不要重新诊断它、不要降级断言、不要删用例。**

云函数：**线上已经是合并后的代码**（本会话从 `D:/OurTrail-p10a` 部署过，`download`+递归 diff 证过线上=本地、
`DIAG-P10A`=0、`timeout=20`、Active）⇒ 合并本身不需要再部署；但合并后若任何人再动 `cloudfunctions/**`，
就必须重新部署 + 重新做来源取证（本项目已两次把 master 的包误当成 p10a 的包跑验证）。

## 4. Phase 10B 候选登记（按你的边界，本 Phase 一律没做）

| # | 事项 | 现状 / 为什么留着 |
|---|---|---|
| 1 | **D1：`index.js:122`**「非整数 `expectedRevision` ⇒ 缺省成 `before.revision`」支路 | 仍在。客户端漏斗门（`api.js` `NO_REVISION`）让任何已发布页面走不到它，`e2e-concurrency` 的 S4/S4b 常驻红继续钉着。拆它要给 A 层 4 套 + B 层 3 套所有不传 revision 的调用点补值 ⇒ 属另一 Phase |
| 2 | **残余 1/132 未归类**的 `STORAGE_UNAVAILABLE` | 诊断版已还原，普通版取不到原始错误对象 ⇒ 要么真存储故障（分类本就对），要么 `-501001` 的另一个未观测子类型。定性要**另批一次诊断部署** |
| 3 | **页面级真并发**（两个真 editor 实例同时点保存） | 客户端恢复路径目前是 STUB PROOF（C8-③④⑤）；真云端证的是服务端分类。补它才能把 UI 那一格从 STUB 升成 REAL |
| 4 | **BUG-C2**（CONFLICT 后草稿优先覆盖） | P2 / Product Decision Required —— 按指示未修，常驻红测 C5 在钉 |
| 5 | **23 条命令零真云端覆盖** | `docs/testing/release-coverage-matrix.md` 的读数（真云端并集 16/39） |
| 6 | **B 层两套**（UI-State / Golden Path） | 本 Phase 记 DEFERRED，不写 PASS |
| 7 | 天气线非确定性红 | 保持登记，不修（你的 G 条） |

## 5. 本 Phase 的判定与证据位置

- **CONDITIONAL ACCEPT**；**BUG-C3 = 已修·附条件**（不写 FIXED）——`docs/testing/phase10a-report-2026-10-08.md` §5c/§14。
- 诊断（8 问逐项）：`docs/testing/phase10a-evidence/c3-diagnostic-final-report.md`。
- 真云端复验与来源取证：`docs/testing/phase10a-evidence/realcloud-post-mapping-K6.md`
  （完整 14 轮 `{OK:14, CONFLICT:70, STORAGE_UNAVAILABLE:0}`，违例 0/0；跨跑 132 败者请求剩 1 条未归类）。
- RED/GREEN/变异原始日志：同目录 `c8-mechanism2-RED.txt`、`c8-mechanism2-GREEN.txt`、
  `m7-narrow-branch-off-MUTANT.txt`、`m7-widened-to-bare-code-MUTANT.txt`、`gate-full-post-mapping.txt`。
- 共享资源：全程只 `disconnect`，未 `quit`/`close`；自动化端口 9426/9427 留着；未碰另一 agent 的 8443/8123；
  沙盒 `[预演] 工作台E2E` 的 title 已恢复（终态 `rev=4784 title="[预演] 工作台E2E" phase=published`）。
