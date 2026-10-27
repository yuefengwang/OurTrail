# 输入资料清单（input-manifest）

运行标识：`night-ui-v1-20261022` · 基线 commit：`e818e63` · 工作 worktree：`D:/OurTrail-night-ui-v1`（分支 `agent/ourtrail-night-ui-v1`）
采集时间：2026-10-22 · 环境：Windows / Git Bash / Node v24.19.0 / 磁盘 D: 剩 415G

| # | 路径 | 类型 | 大小 | 可读 | 用途与优先级 |
|---|---|---|---|---|---|
| A1 | `D:/OurTrail/OurTrail_UI_交付包/01_全局视觉参考.png` | PNG 1536×1024 | 2151KB | 是 | 全局 21 屏拼板，8 分组。其他页面视觉基准 |
| A2 | `D:/OurTrail/OurTrail_UI_交付包/02_设计与业务边界.md` | MD 4106B | — | 是 | 视觉基准/页面覆盖清单/禁止虚构/不可破坏项（**约束权威**） |
| A3 | `D:/OurTrail/OurTrail_UI_交付包/03_分批执行Prompt.md` | MD 3560B | — | 是 | 批次 A–E 划分与验收 Prompt |
| B | `D:/OurTrail/OurTrail_UI_交付包/0d02131464051ab374dc7e7cfa06f496.jpg` | JPG 856×1837 | 166KB | 是 | **活动详情长图文专项**（12 段编号规格），优先于拼板 1.4 |
| C | `D:/OurTrail/OurTrail_UI_交付包/c15ae9865302c18255394d11458f73d1.jpg` | JPG 1536×1024 | 206KB | 是 | **天气五屏专项**，优先于拼板 7.x |
| D1 | 仓库源码与文档（本 worktree） | — | — | 是 | 业务行为权威 |
| D2 | `D:/OurTrail/docs/ui-snapshots/ourtrail-all-pages-2026-10-20.png` | PNG 拼板 | — | 是 | **改前基线截图**（20 页首屏，真实渲染） |
| D3 | `D:/OurTrail/OurTrail全局UI重设计.txt` | TXT 16936B | — | 是 | 上一阶段（10-21 审计）任务书，仅历史上下文，非本轮指令 |
| D4 | `D:/OurTrail/OurTrailNightBu.txt` | TXT 18470B | — | 是 | 本轮任务书的落盘副本 |

ZIP 本体 `OurTrail_UI_重构交付包_V1.zip`（2.0MB）与解压目录内容一致，未重复读取。

## 缺失/不可用项
- 无缺失的必需设计资料（A/B/C 齐备）。
- **微信开发者工具本轮 NOT_RUN**：它是共享会话资源，且本 worktree 不含主工作区在途的天气改动，
  对其截图会呈现与用户在途工作不一致的页面。视觉验收一律标 `视觉待验`，需用户授权后再跑。
- 执行模型无法指定为 DeepSeek Flash：本平台 Agent 工具不暴露模型选择字段。
  子 Agent 使用平台可用编码模型执行，**不伪称 Flash**。主控审查与验收仍由本会话完成。
