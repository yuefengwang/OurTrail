# Weather V2 第九~十二轮 + 门禁修引信 → master 集成记录

日期：2026-10-10（本地钟 20:30–21:00）
执行机：Windows（`D:\OurTrail`），分支 `win/weather-v2-rainbow-gate`
候选分支：`win/integrate-weather-v2-r12`，合并提交 **`6e646d1`**
远端基线：`origin/master` = **`abf08f0`**（fetch 后未前进，见 §4）

> 本报告不写"结束时远端 = 某 SHA"这类自指断言（写下这句的提交自己就会把顶端推走）。
> 可复核的断言是：**要推的对象就是 `6e646d1`**；推送后 `git ls-remote origin refs/heads/master`
> 应返回 `6e646d1…`，且 `git diff 6e646d1 origin/master` 为空。

---

## 1. 只读审计（合并前）

并入范围 = `origin/master..HEAD` 的 **7 个提交**：

| 提交 | 内容 |
|---|---|
| `3dcdbe1` | 第九轮 彩虹遮光闸（判据） |
| `5351231` | 第九轮 真机核验 VERIFIED |
| `6dbc452` | 第十轮 天相沉默闸（三态 verdict + 减卡点名 + 总评剔除） |
| `eded900` | 第十轮 真机核验 VERIFIED |
| `d2e9d70` | 第十一轮 摄影窗口事实后缀 + 低云口径单源 |
| `0d5d7b6` | 第十二轮 「天文暗夜始」机会句改由同源标记决定（标题经 amend 修正，树哈希与 `b56a66e` 逐字节相同 `c28744e…`） |
| `fa28986` | 门禁修引信：`tools/e2e-test.js` 夹具时间改按 `Date.now()` 偏移 + 有效性门 |

生产文件（`git diff --stat origin/master..HEAD -- miniprogram cloudfunctions`）：

```
miniprogram/pages/weather/weather.js   | 22 ++++++++-
miniprogram/pages/weather/weather.wxml |  5 ++
miniprogram/pages/weather/weather.wxss |  2 +
miniprogram/utils/agenda.js            | 53 +++++++++++++++++++--
miniprogram/utils/conditions.js        |  6 ++-
miniprogram/utils/sky.js               | 86 +++++++++++++++++++++++++++-------
6 files changed, 149 insertions(+), 25 deletions(-)
```

- **`cloudfunctions/` 改动文件数 = 0**（`git diff --name-only … -- cloudfunctions | wc -l` 实测 0）⇒ **不需要重新部署 trailApi**。
- **阈值核对**：整个生产 diff 里与阈值常量相关的增删行只有一条 ——
  `+const LIGHT_LIMITS = { LOW_CLOUD_MAX: 40 }`，它是把光染注释里一直在用的 `c.low < 40` **命名**出来，
  不是新数；`LAYER_THICKNESS_MIN 300`、成层 `80`、净空 `200`、低云带 `2200`、海拔容差 `±600`、
  扫描窗 `2000–6000` 全部零改动。
- 其余为测试（`tools/sky-test.js` / `weather-page-test.js` / `weather-v2-test.js` / `e2e-test.js`）
  与文档（四份 QA 报告 + AGENTS 铁律 32–35 + SYNC 四条）。
- 无新页面、无新组件、无新依赖、无 `usingComponents` 变更（`check.js` 正反两向门均绿）。

## 2. 门禁复现（**全部从候选提交本身跑**，不引用历史读数）

工作树 = `win/integrate-weather-v2-r12` @ `6e646d1`，逐套独立运行并记录退出码：

| 项 | 结果 |
|---|---|
| `node tools/check.js` | exit 0（ALL CHECKS PASSED） |
| `node tools/check-handlers.js` | exit 0（21 目标全绿） |
| 63 个可无头套件 | **63 套 exit 0**，断言合计 **4371**，失败合计 **0** |

本轮实测**连既有的偶发项 `outdoor-intelligence-ui` 也是绿的**（47/0）；它仍是偶发项，
不因一次绿宣布消失（归因见 AGENTS.md 门禁段）。

与上一轮集成（`7f05d4b`，4318 条）的差额 53 条 = 第九轮 +6、第十轮 +26、第十一轮 +14、
第十二轮 +6、门禁修引信 +1 —— 逐轮数与各脚本自报的 `passed=` 增量对得上。

## 3. 候选建立

```bash
git branch -f win/integrate-weather-v2-r12 origin/master      # 从远端基线起
git checkout win/integrate-weather-v2-r12
git merge --no-ff win/weather-v2-rainbow-gate -m "merge: 天气 V2 第九~十二轮 + 门禁修引信…"
```

- `origin/master` 是 `HEAD` 的祖先（`git merge-base --is-ancestor` 实测成立）⇒ **零冲突面**，
  合并一次完成，未使用 `--ours/--theirs`，未 squash、未 rebase、未改写历史。
- **7 个提交的边界原样保留在历史里**（`git log --oneline origin/master..HEAD` 可数出 8 条 = 7 + 1 合并）。
- 合并提交 `6e646d1` 的树哈希 = `40e41c77ca63b6cb865e785686f60fb479961164`
  = 功能分支 `fa28986` 的树哈希 ⇒ **合并没有夹带第三个内容变化**（这是 §2 那批读数适用于候选的根据）。

## 4. 远端集成：**当时阻塞，未推送、未动 master**

> 前向指针：本节记录 2026-10-10 的现场，结论（阻塞）当时成立、现已过期。
> 通道恢复后的实际执行与三端核验见 **§5b**。原文按铁律 29③ 保留不删。

```
$ git fetch origin
ssh: connect to host 192.168.3.15 port 22: Connection timed out
fatal: Could not read from remote repository.            (exit 128)
```

可达性实测（TCP 22，3.5 s 超时）：

| 目标 | 结果 |
|---|---|
| `192.168.3.15`（当前 `origin`/`relay`） | TIMEOUT |
| `192.168.2.22`（历史地址，见 SYNC.md 2026-10-08） | TIMEOUT |
| `192.168.1.101`（PARALLEL_DEV.md 表里的 Mac） | TIMEOUT |
| `yfwangmacbook-pro.local`（mDNS） | ENOTFOUND |

⇒ 不是"IP 换了、按 `relay-address-change` 流程改 remote 就能连上"，而是**中继主机整体不可达**
（同网段三个历史地址全无响应、mDNS 不解析）。

按 PARALLEL_DEV 与本轮任务书的边界：**不得绕过、不得强推、不得改写已共享历史**。
因此本阶段停在这里：`master` 未动（本地与远端都仍是 `abf08f0`），候选留在
`win/integrate-weather-v2-r12`（`6e646d1`）等通道恢复。

## 5. 通道恢复后要做的（两条命令，顺序不能换）

```bash
# ① 先确认远端没被别人前移（若已前移，必须重新按 §2 从新基线复跑候选门禁，不能直接推）
git fetch origin && git rev-parse origin/master        # 期望仍是 abf08f0
# ② 快进本地 master 到候选并推送（普通 push，禁止 --force）
git branch -f master origin/master && git checkout master && \
  git merge --ff-only 6e646d1 && git push origin master
```

推送后复核：`git ls-remote origin refs/heads/master` 应返回 `6e646d1…`（或其后的 docs 提交），
且 `git diff 6e646d1 origin/master` 为空。**另一台必须立刻 `git pull`**（PARALLEL_DEV 铁律 5），
否则它会基于 `abf08f0` 继续写成分叉。

## 5b. 通道恢复后的实际执行（2026-10-13）

中继恢复后按 §5 的顺序执行，但有**一处与计划不同**，如实记下：本地 `master` 在通道恢复**之前**
就已快进到了 `1108bb6`（= `6e646d1` + 本份集成记录），所以 §5 的 `git branch -f master origin/master`
那一步没有跑——它是为"本地 master 仍停在 `abf08f0`"准备的，当时的实际前置状态已不成立。

```bash
git fetch origin                                  # FETCH_EXIT=0，无新对象
git rev-parse origin/master                       # abf08f0…  ⇒ 远端未被别人前移（§5 ①成立）
git merge-base --is-ancestor origin/master master # 成立 ⇒ 快进，无需 --force
git log --oneline origin/master..master           # 9 条 = 8 个功能提交 + 1 个合并（§3 数的 7+1 再加 docs）
node tools/check.js                               # exit 0，ALL CHECKS PASSED
node tools/check-handlers.js                      # exit 0
git diff --stat 6e646d1 1108bb6                   # 3 files changed, 191 insertions(+)，0 deletions
                                                  # ⇒ 与已全量跑绿的候选相比只多文档，§2 那批读数继续适用
git push origin master                            # exit 0  abf08f0..1108bb6  无 --force
#   remote: 中转成功：已同步到 GitHub (yuefengwang/OurTrail)
```

推送后的三端复核（**断言的是"推 `1108bb6` 那一次"的结果**，本 docs 提交本身会把顶端再往前推，
所以别把下面这行当"当前远端"读——当前远端一律 `git ls-remote origin refs/heads/master` 现查）：

| 端 | `refs/heads/master` |
|---|---|
| 中继 `ssh://yfwang@192.168.3.15/…` | `1108bb60d104cd6275f5e1624807033d743d603e` |
| GitHub 直连 `git@github.com:yuefengwang/OurTrail.git` | `1108bb60d104cd6275f5e1624807033d743d603e` |
| 本地 `master` | `1108bb60d104cd6275f5e1624807033d743d603e` |

`cloudfunctions/` 在这 9 个提交里零改动 ⇒ **不需要重新部署 trailApi**。另一台已具备 `git pull`
快进到该顶端的条件（PARALLEL_DEV 铁律 5）。

### 顺带查出的仓库设置问题（不在本轮范围，只登记）

GitHub 的**默认分支是 `main`（`30a0eca`），而 `main` 与 `master` 无共同祖先**
（`git merge-base refs/gh/main refs/gh/master` 不存在）：它是 2026-09-29 中转链路验证时的 3 个提交，
相对 `master` 为 916 files / `+3` / `−137,994`。后果是网页首屏、PR 默认基线、Actions 默认触发
都指向这份陈旧树。改默认分支属 GitHub 仓库设置，本机 `gh` 未登录（`gh auth status` ⇒
`You are not logged into any GitHub hosts`），**未擅自改动**；删除 `main` 是另一回事，同样未动。

## 6. 未验证 / 风险登记

- **真机**：第九~十二轮各自 VERIFIED（三份 `device/` 证据包 + `readings.json`），
  但**集成候选本身没有再跑一次真机**——候选树与已核验的功能分支树逐字节相同（§3 的树哈希），
  像素层不存在"合并引入第三种内容"的可能面。
- **部署**：`cloudfunctions/` 零改动 ⇒ 不部署；若后续有人改了 domain/store，需按 AGENTS 铁律 7 重部署并复核超时。
- **已知残留（不属于本候选）**：`components/meteogram/meteogram.js:472/:503` 两处显示层 `cover >= 80` 未收
  （切片二登记）；OI `cloudLayersAt` 仍扫固定 2000–6000（属 R1，需口径归属裁决）。
- 本报告作为候选上的**文档提交**追加在 `6e646d1` 之后；代码集成顶端固定为 `6e646d1`，
  其后只有 docs 提交前移。
