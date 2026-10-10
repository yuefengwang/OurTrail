# Weather V2 三层架构 · 切片一 + 切片二 集成审计报告

日期：2026-10-10 · 执行机：Windows（`win/` 前缀侧）· 仓库：`yuefengwang/OurTrail`
目标分支：`refs/heads/master`（**全程显式操作 master；远端不存在 `main` 分支**，本地那条 `refs/remotes/origin/main` 是 GitHub 默认分支的陈旧跟踪引用，见 PARALLEL_DEV §八，本轮未碰）
性质：**集成任务**。本轮没有新增功能、没有改任何气象阈值、没有实施 R1、没有裁决 D1–D6/Q7。

---

## 1. 远端 SHA：开始时 / 结束时

| 时点 | `git ls-remote origin refs/heads/master` |
|---|---|
| 开工（阶段 1） | `50d657a19ad0fe341e90d96a8c4a662a08955ebf` |
| 推送前最后一次复核（阶段 4） | `50d657a19ad0fe341e90d96a8c4a662a08955ebf`（**无漂移**，另一台未推进） |
| 推送回执 | `50d657a..7f05d4b  master -> master`（快进，**未使用 `--force`**） |
| 结束时（阶段 5 重新读取，代码集成完成那一刻） | **`7f05d4be27f93eb092dd420d822e5951b666a059`** |
| 事后补记（docs 提交继续前移，本行不追自己的 SHA） | 推送序列：`50d657a..7f05d4b`（**代码集成**，两个 `--no-ff` merge）→ 其后只有 docs 提交（本报告与 `SYNC.md` 集成条目，以及对本行的两次措辞修正——第一版写"最终 = 84d9f1c"，而写下这句话的提交本身又往前走了一步，属于自己追自己，故改为不记顶端）。三次以上全部快进，都不是 force。**代码集成的最终顶端就是 `7f05d4b`**：`git diff 7f05d4b origin/master -- miniprogram/ tools/ cloudfunctions/` 为空（已实测），`git log --oneline 7f05d4b..origin/master` 里只有 docs 提交，读者可自行复核。 |

GitHub 侧：中转裸仓库的 `post-receive` 回执原文 `remote: 中转成功：已同步到 GitHub (yuefengwang/OurTrail)`。
**本环境 `gh` CLI 未登录（`gh auth` 无凭据），因此没有独立向 GitHub 直接核对 ref**。按 PARALLEL_DEV §一，中转成功回执即转发成功；如需第三方核验，请在有凭据的机器上比对 GitHub `master` 是否等于 `7f05d4b`。这一条在下面 §5 记作"部分验证"，不当作已验证。

---

## 2. 两个切片的提交关系与实际集成方式

### 2.1 只读审计得到的提交关系（阶段 1）

```
50d657a  docs(weather-v2): R1 前置决策审计 + Q5/Q6 判定噪声审计   ← 远端 master 基线
  └─ 92036e9  refactor(weather-v2): 切片一 三层架构首个纵向切片      父 = 50d657a ✓
      └─ 7d1a6f1  refactor(weather-v2): 切片二 阈值单源 + 证据字段化   父 = 92036e9 ✓
```

- `git log 50d657a..7d1a6f1` 行数 = 2 ⇒ **两切片之间没有遗漏提交**。
- 切片二**确实依赖**切片一：`7d1a6f1` 引用 `miniprogram/utils/cloud-layer-facts.js`，该文件由 `92036e9` 新建（切片二还把它改了 42 行）。若单独把 `7d1a6f1` 摘到 `50d657a` 上会直接 `require` 失败——所以没有做任何 cherry-pick。
- 开工时 `92036e9` 尚未进入 `origin/master`（`git merge-base --is-ancestor 92036e9 origin/master` = NO）。
- 本地分支归属：`win/weather-v2-three-layer-slice` → `92036e9`；`win/weather-v2-three-layer-slice-2` → `7d1a6f1`。
  另有 `win/weather-v2-audit` → `3627079`（**其他工作的分支，本轮未 merge、未 push、未删除**）、`win/weather-v2-cloud-position` → `50d657a`。
- 工作树在开工时为空（clean），全程未出现他人未提交改动。

### 2.2 实际集成方式（阶段 3–4）

按 PARALLEL_DEV §三（**本地合并 + `--no-ff`**，仓库规范同时允许走 PR；本环境无 GitHub 凭据 ⇒ 走"不熟就本地合"这条被明确许可的路径）：

1. 建独立集成工作区（不动 `D:\OurTrail` 的检出、不动其他分支）：
   `git worktree add <temp>/integration-v2 -b win/weather-v2-integration 50d657a`
2. **先合切片一，再合切片二**，两次都是 `--no-ff`，各生成一个 merge commit：
   - `59f245b` = Merge `win/weather-v2-three-layer-slice`（parents: `50d657a`, `92036e9`）
   - `7f05d4b` = Merge `win/weather-v2-three-layer-slice-2`（parents: `59f245b`, `7d1a6f1`）
   两次合并**零冲突**（第二次合并的 base 是 `92036e9`，`59f245b` 相对它没有额外改动，因此直接取 theirs）。
3. **没有 squash、没有 amend、没有 rebase、没有改写任何已共享提交**：`92036e9` 与 `7d1a6f1` 原样保留在 master 历史里，两个切片的边界在 `git log --graph` 上肉眼可分。
4. 候选验证：`7f05d4b^{tree}` == `7d1a6f1^{tree}` == `1fea866116c8ad329410e4bbd29204cf4fcb90f2`
   ⇒ **合并没有引入任何第三个内容变化**（`git diff 7d1a6f1 7f05d4b` 为空）。
5. 主工作区 `git checkout master`（当时 == `origin/master`）后 `git merge --ff-only win/weather-v2-integration` ⇒ 本地 master = `7f05d4b`，再 `git push origin master`（非 force）。

**顺序偏差如实登记**：任务书 §第三阶段写"只有前两阶段全部通过后才允许建立集成候选"。实际做法是先建候选、**再在候选树上跑门禁**——因为 §第二阶段同时要求"所有门禁均从当前集成候选提交运行"。候选只存在于独立 worktree 与临时分支上，未触碰 master、未推送；如果门禁没过，只需删掉那个分支即可（本轮没有走这条路，因为全绿）。

---

## 3. 变更文件范围与排除项

`git diff --name-only 50d657a 7f05d4b`（20 个文件，+24222 / −131，其中 22063 行是两份对拍 JSON 产物）：

| 类别 | 文件 |
|---|---|
| 生产代码（客户端纯逻辑） | `miniprogram/utils/cloud-layer-facts.js`(+206 新) · `evidence-kind.js`(+49 新) · `outdoor-intelligence.js`(±213) · `oi-presentation.js`(±39) · `conditions.js`(±43) · `sky.js`(±10) |
| 门禁套件 | `tools/cloud-layer-facts-test.js`(+323 新) · `outdoor-intelligence-test.js`(+56) · `outdoor-cloud-sea-test.js`(±24) · `cloud-position-test.js`(±27) |
| 架构文档与验证器 | `docs/weather-ux/architecture/weather-v2-three-layer-evolution.md` · `weather-v2-three-layer-slice-2.md` · `tools/ab-slice.js` · `tools/ab-slice2.js` · `tools/mutate-ab.js` · `tools/mutate-slice2.js` · `ab-slice.json` · `ab-slice2.json` |
| 知识库 | `AGENTS.md`（铁律 30/31、Gate recount 11/12、套件登记 2 处、计数 4299→4318） · `SYNC.md`（两条变更日志 +18 行） |

**排除项（逐条验证，不是"应该没改"）**：

- `git diff --name-only 50d657a 7f05d4b | grep -E "cloudfunctions/|miniprogram/pages/|miniprogram/components/|custom-tab-bar"` → **空**
  ⇒ **不需要重新部署 `trailApi`**；页面/组件/WXML/WXSS 一行未动。
- 无新依赖：`git diff` 里没有出现 `package.json` / `node_modules` / `miniprogram_npm`；`check.js` 的"仓库零 npm 依赖"这条断言仍然绿。
- 阈值数值逐条比对（`git show 50d657a… :…` vs `git show 7f05d4b…`）：
  `LAYER_THICKNESS_MIN 300` · `CLEARANCE_MIN 200` · `GAP_TOLERANCE_H 1` · `MIN_RUN_H 2` · `WIND_CALM 15` ·
  强度因子 `90/600/500/3` · `sky` 的 `2200`（命中数 1→1）· `ALT_TOL {measured 0, estimated 600, none ∞}` ·
  `ESTIMATE_TOL_M 600` · 剖面显示窗 `ALT0/ALT1` ⇒ **全部逐字相同**。
  两个 80 与 50 现在住在 `cloud-layer-facts.LAYER_LIMITS`，值仍是 `80 / 50 / 80`，
  且 `ab-slice2.js` 内置一条硬门：这三个数一旦不等于 80/50/80，对拍器自己 exit 1（本轮 exit 0）。
- 未实施 R1、未动 2000–6000 缺省扫描范围、未改候选选择规则（`topmostBelow` 的"取最高的那层"逐字保留，薄皮遮蔽缺陷仍只是被特征化断言钉住）、未解决 D1–D6/Q7。

---

## 4. 本轮运行的门禁结果（全部在候选树 `7f05d4b` 上跑，非引用历史报告）

工作区：`C:\Users\thinkbook\AppData\Local\Temp\opencode\integration-v2`（检出 `7f05d4b`，跑前状态 `[clean]`）

| # | 命令 | 退出码 | 本次读数 |
|---|---|---|---|
| 1 | `node tools/check.js` | 0 | `ALL CHECKS PASSED` |
| 2 | `node tools/check-handlers.js` | 0 | 全组件 handler/数据集契约相符 |
| 3 | `node …/ab-slice.js <50d657a 的 utils>` | 0 | **合计比对 111 组：业务判据差异 0 组、附加字段结构差异 0 组**、负证据 detail 文案差异 48 条（切片一登记过的、模型内部负证据文案，UI 不展示不参与判定） |
| 4 | `node …/mutate-ab.js <同上>` | 0 | **变异 8 条，漏网 0 条**（基线先证 0 差异才有资格谈变异） |
| 5 | `node …/ab-slice2.js <92036e9 的 utils>` | 0 | **合计比对 123 组：业务判据差异 0 组、用户可见差异 0 组、附加字段结构差异 0 组** |
| 6 | `node …/mutate-slice2.js` | 0 | 有效性门「未变异副本 4 套全绿」先过；**变异 9 条，漏网 0 条** |
| 7 | 完整无头门禁套件（`tools/*-test.js` 除 3 个需开发者工具的 + `cloudfunctions/trailApi/smoke-test.js`） | — | **套件数 63 / 断言合计 4318 / 失败合计 0 / 红套数 0**；无一份套件缺 `passed=` 读数（逐套读数存 ` %TEMP%\integration-sweep-table.txt`） |

补充两点判读，避免把"全绿"读成"绝对安全"：

- `AGENTS.md` 登记的**常驻非确定性红**（`outdoor-intelligence-ui-test` 打线上 Open-Meteo + 真实时钟那一条）**本轮这一跑是绿的**（红套数 0）。它仍是时间/网络相关的偶发项，不能因为一次绿就宣布已消失。
- `ab-slice2.js` 的比对**跑到了呈现层**：两侧各用**自己版本**的 `oi-presentation.buildOiCard` 产出卡片，比 title / timeText / tierText / **summaryText** / 看图锚点 / tapZones / 时间轴 SVG / silenceNote，宽度 375 与 414 各一遍，外加每条证据的中文 `fact` 字符串与顺序。因此"用户可见摘要文案零差异"是这次实测出来的，不是从"纯函数搬家"推出来的。
- 变异自证覆盖的就是本轮宣称的两件事：`mutate-ab` 8 条抓业务判据（步长/净空/层厚/覆盖/退出点插值/截断标记/候选选层/上界夹点），`mutate-slice2` 9 条抓架构退化（恢复重复阈值 ×4、摘要重回文案匹配、改摘要优先序、未评估混进拒绝、窗口级拒绝塞回逐时账本、判不出不留痕）。

产物噪音处理：步骤 3/5 会重写自己的 `ab-slice.json` / `ab-slice2.json`，跑完 `git status` 显示这两个文件被修改；
逐行核对差异**只有 `generatedAt` 一行**，随后 `git checkout --` 复原，复原后工作树 clean 且树哈希与 §2.2 一致。

---

## 5. 冲突、差异、未验证项与最终结论

### 5.1 冲突

无。两次 `--no-ff` 合并与 `--ff-only` 前进都零冲突；不存在需要人工判归属的 hunk，因此本轮**没有做任何语义裁决**。

### 5.2 与预期不一致的地方（都已定位，无遗留）

1. 切片一的 `ab-slice.js` 在切片二之后曾报 2 组"业务差异"——根因是它比的是 `meta.cloudSea.rejected` **这一个数组**，而切片二把窗口级拒绝（`LOW_PERSISTENCE`/`NOT_VISIBLE`）挪进了 `noWindow`。已改为比"具名拒绝全集（rejected ++ noWindow）"，本轮复跑 111 组 0 差异。这是**对拍器的判据写错了对象**，不是业务变了（同 AGENTS 铁律 30/31）。
2. `mutate-ab.js` 的 V1/V4 锚点随阈值搬家失效（`SCAN_STEP_M: 50,` / `LAYER_COVER_MIN: 80,` 这两个字符串不存在了）。该脚本有"锚点找不到即判失效"的门，所以是大声失败；锚点已搬到 `LAYER_LIMITS`，本轮 8 条 0 漏网。

### 5.3 未验证项（如实标 UNVERIFIED，不写成通过）

| 项 | 状态 | 依据 |
|---|---|---|
| 微信开发者工具真机 | **UNVERIFIED** | 本轮 master 树里 `pages/` 与 `components/` 零改动；用户可见输出由 §4-5 的呈现层对拍证为逐字相同。9420 自动化会话属于哪份工作副本无法从命令行证明，重开项目会动**共享**开发者工具实例 ⇒ 按规矩不擅自执行 |
| GitHub 端 ref 直读 | **未独立验证** | `gh` CLI 在本机未登录；只有中转 hook 的成功回执（`已同步到 GitHub`）作为证据 |
| 显示层残留的同值 80 | **未收（已知不一致）** | `components/meteogram/meteogram.js:472 / :503` 仍自己写 `cover >= 80`；改动属 canvas 绘制路径、需要真机证据。后果：改 `LAYER_LIMITS.CLOUD_BAND_COVER_MIN` 时图上那两行不会跟着动 |
| 摘要机制改动的净用户效果 | **零** | 不是"修好了显示 bug"：审计事实是旧 `find()` 在所有生产路径上恒等于 `evidence[0]`。本轮拆掉的是"下次改中文就静默换证据"的耦合 |
| R1 / D1–D6 / Q7 | **未动** | 仍是产品裁决；接缝 `ctx.cloudSeaScan` 已在切片一被注入用例测活，仍只有测试在用 |

### 5.4 集成是否真正完成

**远端 `master` 集成已完成**（不是"本地合了但没推"，也不是"推了中转但 GitHub 存疑"当成功）：

- 阶段 5 重新读取 `git ls-remote origin refs/heads/master` = **`7f05d4b`**，与当时本地 master 一致（**代码集成的顶端**）；紧随其后的只有本报告的 docs 提交，`git diff 7f05d4b origin/master -- miniprogram/ tools/ cloudfunctions/` 为空；
- `92036e9`、`7d1a6f1` 均是 `origin/master` 的祖先，快进推送、无历史改写；
- `origin/master^{tree}` == `7d1a6f1^{tree}` == `1fea866…`；
- 主工作区 `git status --short` 为空，当前分支 `master`；
- 门禁：63 套 / 4318 断言 / 失败 0；两套 A/B（111 + 123 组）0 差异；两套变异（8 + 9 条）0 漏网。

唯一需要下一台机器注意的：另一台（Mac）**必须立刻 `git pull`**（PARALLEL_DEV 铁律 5），否则它会继续基于 `50d657a` 写，形成分叉风险。

---

## 6. 复现命令（逐条可直接跑）

```bash
# 独立集成工作区（不污染主检出）
git worktree add <temp>/integration-v2 -b win/weather-v2-integration 50d657a
cd <temp>/integration-v2
git merge --no-ff win/weather-v2-three-layer-slice
git merge --no-ff win/weather-v2-three-layer-slice-2
git rev-parse HEAD^{tree} 7d1a6f1^{tree}        # 必须相同

# 取两个历史版本的 utils 到仓库外
mkdir -p <temp>/p1 <temp>/p2
git archive 50d657a miniprogram/utils | tar -x -C <temp>/p1
git archive 92036e9 miniprogram/utils | tar -x -C <temp>/p2

node tools/check.js && node tools/check-handlers.js
node docs/weather-ux/architecture/tools/ab-slice.js    <temp>/p1/miniprogram/utils
node docs/weather-ux/architecture/tools/mutate-ab.js   <temp>/p1/miniprogram/utils
node docs/weather-ux/architecture/tools/ab-slice2.js   <temp>/p2/miniprogram/utils
node docs/weather-ux/architecture/tools/mutate-slice2.js
# 完整无头门禁：tools/*-test.js（除 e2e-ui-test / e2e-ui-state-test / e2e-golden-path-test）+ cloudfunctions/trailApi/smoke-test.js

# 主工作区前进并推送（合并窗口内，非 force）
git checkout master && git merge --ff-only win/weather-v2-integration
git fetch origin                                   # 推前再确认远端没漂移
git push origin master
```

---

*相关文档：切片一 ADR `docs/weather-ux/architecture/weather-v2-three-layer-evolution.md`；切片二 ADR `docs/weather-ux/architecture/weather-v2-three-layer-slice-2.md`（含 §8"与预期不一致的差异"逐条）；铁律 30/31 见 `AGENTS.md`；变更日志见 `SYNC.md` 2026-10-10 两条。*
