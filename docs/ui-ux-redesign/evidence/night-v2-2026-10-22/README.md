# night-v2 T011 视觉验收证据包（2026-10-22）

## 环境与通道（实测）

| 项 | 值 |
|---|---|
| 机器 | Windows 10 · Git Bash · Node v24.18.0 |
| IDE | 微信开发者工具（会话开始前**未运行**，本夜新起；未 quit/close 任何既有会话） |
| 服务端口 / 自动化端口 | 33278 / **9425**（`cli auto` 回 `{"autoPort":9425}`，AppID 回显 wx1227a277a3f2f7ea） |
| 驱动 | 仓库外 `%LOCALAPPDATA%\Temp\opencode\mp-auto`（miniprogram-automator）；脚本 `shot-night-v2-{baseline,after,states,gaps}.js` |
| 代码版本 | before = `c1a5aeb`（master）；after = `a81e3b7`（首轮）与 `5395f02`（箭头修复后复拍 states/） |
| 重编译 | after 取证前 `cli close`+`open`（仅本会话自起会话）＋ `auto` 重绑 9425 |
| bundle 新鲜度门 | 三页 after 帧先断言 `.stack-gap3` 存在（该类只存在于新 bundle wxml）⇒ `fresh-ok notices/anotices/me` 打印在驱动输出 |
| 数据条件 | before/after 主帧＝**真实云数据**（notices 669 条 / anotices 1 条 / me 真实档案，零注入）；states/ 与 gaps 部分帧＝注入态（逐帧标注） |

## 帧索引

### before/（真实数据，c1a5aeb）
notices-top / notices-scroll / anotices-top / anotices-scroll / me-top / me-scroll

### after/（真实数据，a81e3b7）
同文件名六帧；导航bar 纸底黑字为唯一可见家族变化。

### after/states/（注入标注帧，5395f02 复拍）
| 帧 | 注入内容 | 用途 |
|---|---|---|
| notices-empty / loading / denied | items=[] / loading=true / denied 文案 | 六态之三 |
| notices-longtext | 单条 ~240 字正文 | 长文换行不溢出 |
| notices-readmix | 真数据前 4 条 read 交替置位 | 已读无左边线/无「标记已读」（QA 缺口补拍） |
| me-onboarding | activated=false | 引导卡；**5395f02 复拍**：箭头钉行右端（修复复验） |
| me-longnick | person.name 40 字 | 身份卡不换行溢出检查 |
| me-revoke-injected / me-revoke-y3200 / y4000 | positionRows 注入 | 真实同行人列表过长未滚到（过程帧，留作列表长度证据） |
| me-revoke-short-y1500 / y2100 | companions=[] + positionRows 注入 | **撤回红字像素证据**（y2100 帧：红「撤回」与中性「复制」同屏） |
| routes-family-nav | 无注入 | 浅导航家族对照帧（QA §10.1 缺口补拍） |

## 判读边界

- 330px 宽截图**量不出 px 级字阶/字重**：me 昵称 18px 的像素级判定记 UNVERIFIED（文本级 E1：me.wxss `var(--text-title)`）。
- 注入帧只证**渲染路径与状态面**，不证真实数据形状；真实形状由 before/after 主帧承担。
- 本包无像素比对工具；差异判读＝人眼（主控 M4）＋独立 QA 子 Agent 读图（VISUAL_QA_REPORT §2）。
