# 视觉验收取证 2026-10-22（ENV-ABORT）

授权范围：用户批准重开共享开发者工具会话补拍 before/after。
结论：**通道 ENV-ABORT，未产出任何截图**；不作数运行 6 次，全部留痕如下。

## 症状与排除链
| # | 动作 | 端口 | 结果 |
|---|---|---|---|
| 1 | islogin | 33278 | `{"login":true}`（通道与登录态正常） |
| 2 | open(truth)+auto | 9425 LISTENING | 驱动全命令 timeout |
| 3 | 重绑 auto | 9426 LISTENING | 同上 |
| 4 | 等编译 45s 重探 | 9426 | 同上 |
| 5 | auto 全量输出 | 9427 | CLI 报 success，但 ws **拒连** |
| 6 | close+open(truth)+auto | 9428 LISTENING | 同上 timeout |
| 7 | auto 指向用户主项目窗 | 9429 LISTENING | 同上 timeout（⇒ 非新窗口问题） |
| 8 | 授权内 `cli quit` → 重开 → auto | 9430 LISTENING | 同上 timeout（⇒ 非僵尸会话） |
| 9 | close 后由 auto 自开窗口 | 9431 LISTENING | 同上 timeout |

特征：ws 握手成功（CLI 侧桥在听）但**页内 agent 永不响应** —— 与项目记忆
「B 层真机 E2E 要人工先绑 9420」同族：IDE 内自动化开关需人在 IDE 界面开启，
CLI 的 auto 只建桥；quit 重启后该开关疑似复位。驱动与夹具（合成数据注入 + bundle 新鲜度门）
已备好于 `%LOCALAPPDATA%\Temp\opencode\mp-auto\shot.js`，通道一通即可跑。

## 顺带修复（可复用资产）
- `mp-auto/cli.js`：Git Bash/cmd 引号与中文路径三层编码坑的最终形态＝**运行时 readdir 发现 CLI 路径 + PowerShell 调用层**；源码零中文。
- before/after 方案：before=`D:/OurTrail-truth`@e818e63，after=`D:/OurTrail-night-ui-v1`@6dc466d，两干净 worktree 对拍，不碰主工作区。

## 恢复动作
结束时会话已恢复为用户主项目窗口（`cli open --project D:\OurTrail`）；未留 truth/night 窗口。
