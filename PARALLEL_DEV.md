# OurTrail · 双机并行开发协议

> 本文件**随仓库走**（已提交），两台机器 clone 后自动获得，无需口头传达。
> 目的：让两台电脑同时改这个仓库而不互相踩踏。
> 背景：本机（Mac）通过 `~/gitrelay/OurTrail.git` 中转，`post-receive` hook 每次 push 后**立即**转发 GitHub。

---

## 一、核心约束（必须理解，否则一定出事）

### 中转会「即时抢跑」

```
Windows push ──▶ 中转裸仓库 ──hook──▶ GitHub master   （立刻、无人干预）
Mac     push ──▶ 中转裸仓库 ──hook──▶ GitHub master
```

后果：**两台机器不能都往 `master` 推。**

- Windows 推 `A` → GitHub 变成 `A`
- Mac 推 `B`（基于旧基线）→ hook 转发时被 GitHub 拒（非快进）
- 但 `B` **已经进了中转裸仓库**，中转 `master` 变成 `B`
- 结果：**GitHub 是 `A`、中转是 `B`，两边都显示"推送成功"，实际已分叉**

这不是 bug，是中转架构的固有性质。唯一的解法是：**用分支隔离，别都推 master。**

### 认准「谁是真相」

正常情况下两边一致。**一旦分叉，以 GitHub 为准**（GitHub 是最终仓库，中转只是通道）。止损步骤见第五节。

---

## 二、机器分工

| 机器 | 角色 | 建议分支前缀 |
|---|---|---|
| Mac（本机，`yfwangMBP`，192.168.1.101）| 主开发 + 中转机宿主 | `mac/` |
| Windows（192.168.1.100）| 并行开发 | `win/` |

分支命名：`mac/<主题>`、`win/<主题>`，例如 `mac/weather-layer`、`win/editor-tests`。

---

## 三、日常工作流

### 开始工作前（必做，30 秒）

```bash
cd ~/OurTrail
git checkout master
git pull                      # 先同步中转的最新状态
git checkout -b mac/<主题>    # 开自己的分支
```

`git pull` 不可省——中转可能已被另一台推进。

### 开发中

```bash
# 改代码...
node tools/check.js           # 静态校验：JS/WXML/WXSS/app.json/组件引用
git add -A
git commit -m "feat(weather): ..."
git push -u origin mac/<主题>
```

### 完成后（合并到 master）

**先看另一台在做什么**，避免改同一处：

```bash
git fetch origin
git log --oneline origin/master..origin/win/<主题>   # 对方在做什么
```

合并（推荐走 PR，不熟就本地合）：

```bash
git checkout master && git pull
git merge --no-ff mac/<主题>        # 或 mac/<主题> → win/<主题> 互相合并
git push origin master              # 这次 hook 会转发到 GitHub
```

---

## 四、铁律

1. **除了合并窗口，永远不直接推 `master`。**
2. **开工前必 `git pull`。** 中转会被另一台推进。
3. **提交前必跑 `node tools/check.js`。** 微信小程序无法在本机渲染，静态校验是唯一防线。
4. **一次只做一件事。** 两台同时改同一个文件必然冲突。
5. **`master` 合并后立刻在另一台 `git pull`**，别让对方基于旧基线继续写。
6. **`.DS_Store` 不入库**（已在 `.gitignore`）。macOS 上如果看到它被 add，先 `git rm --cached`。

---

## 五、故障处置

### A. push 被拒：non-fast-forward

**症状**：hook 报 `转发被 GitHub 拒绝：非快进`。

**先判断分叉方向**（在中转机 Mac 上执行）：

```bash
cd ~/gitrelay/OurTrail.git
git fetch origin
echo "中转领先: $(git rev-list --count refs/remotes/origin/master..refs/heads/master)"
echo "中转落后: $(git rev-list --count refs/heads/master..refs/remotes/origin/master)"
```

| 情况 | 含义 | 处置 |
|---|---|---|
| 领先 0 / 落后 >0 | 你的提交已在 GitHub，本地旧了 | `git reset --hard origin/master`，重新开分支 |
| 领先 >0 / 落后 0 | **分叉了**（危险） | 见下方 B |
| 领先 >0 / 落后 >0 | 双向分叉 | 见下方 B |

### B. 已分叉的止损（以 GitHub 为准）

⚠️ **先备份**，再做不可撤销操作：

```bash
cd ~/gitrelay/OurTrail.git
git branch backup-分叉前-$(date +%m%d-%H%M)     # 备份当前状态
```

**情况 1：中转领先（本地有新提交，GitHub 还没有）** —— 通常是你刚推完 hook 就失败了，重推即可：

```bash
cd ~/gitrelay/OurTrail.git
git push origin --force 'refs/heads/*:refs/heads/*'
```

**情况 2：GitHub 领先（GitHub 有新提交，本地没有）** —— 另一台绕过了中转直推了 GitHub，**本地的提交 GitHub 上没有**。先抢救：

```bash
cd ~/gitrelay/OurTrail.git
git push origin 'refs/heads/<你的分支>/*:refs/heads/<你的分支>/*'   # 推到别的分支名，别覆盖 master
```

然后把 GitHub 上的 `master` 拉下来，人工合并，再推回去。

### C. 补推（网络中断导致 hook 转发失败）

数据不会丢，只是没同步到 GitHub：

```bash
~/gitrelay/flush.sh --dry-run    # 先看差异
~/gitrelay/flush.sh              # 实际补推
```

### D. hook 没触发 / 看不到回执

macOS 的 `ssh -T`（不分配终端）**不返回 shell 横幅，连接保持打开**，前台执行看起来像卡住——**这是正常的，认证其实已成功**。判断成功看 `git push` 的回执（`* [new branch]` / `abc..def`），别被"无输出"误导。

---

## 六、环境差异（两台机器不一样）

| 项 | Mac | Windows |
|---|---|---|
| 中转机 | ✅ 就是本机（192.168.1.101）| ❌ 需连 `192.168.1.101` |
| origin | `ssh://yfwang@192.168.1.101/Users/yfwang/gitrelay/OurTrail.git` | 同左 |
| 微信开发者工具 | ❌ 无 | ✅ 有（唯一能真机预览的环境）|
| 渲染验证 | ❌ 只能静态校验 | ✅ 可真机跑 |

**推论**：Mac 侧改完只能跑 `node tools/check.js`；**真机视觉/联调验证必须靠 Windows**。涉及 UI 或云函数部署的改动，Mac 提交后需在 Windows 上验证，再合并回 `master`。

---

## 七、给 agent 的提醒

- **不要直接推 `master`**，除非正在执行合并窗口。
- **不要用字符串 grep 删 `authorized_keys`**——按指纹定位。
- **文件传输用字节通道**（`nc` / scp / 附件），不要把密钥或长 base64 字符串经聊天转述——已证实会被改动（见事故记录）。
- **改完 hook / 脚本必须实测**，包括失败路径。本项目已踩过：`post-receive` 给出的非快进补救命令自身缺 `--force`，等于给了死路。
- 中转机是**笔记本**，`pmset`/`caffeinate` 挡不住**合盖休眠**。长时间不用时请合上盖子前先确认，或改用常开设备。

---

## 八、当前状态（2026-09-29 建立时）

- 中转与 GitHub **一致**，`master` @ `eda0553`，无分叉
- `main` 分支（GitHub 默认分支）装着 3 个早期测试 commit，**与开发无关**，可忽略
- 两台 origin 均指向中转；Windows 侧 `relay` remote 可用 `git push relay <branch>`

---

## 附：本文件随仓库走

本文件**已提交进仓库**，两台机器 `clone` / `pull` 后自动获得，无需任何手动配置或口头传达。

修改约定时：直接改这个文件，提交，两台各 `git pull`。

> 曾经考虑过用 `.gitignore` 排除、本地各存一份，但那样**规则能同步、文件内容不能同步**——Windows clone 后根本没有这个文件，等于没解决问题。协作约定本就该让所有参与者看到，所以入库是正确选择。
