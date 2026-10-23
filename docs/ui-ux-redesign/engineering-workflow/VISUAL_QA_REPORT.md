# VISUAL_QA_REPORT — T011 真实截图验收与复验（night-v2，2026-10-22）

> **勘误（2026-10-23，FU-01）**：当前结论以 [MORNING_REVIEW_REPORT.md](MORNING_REVIEW_REPORT.md) 为准：
> ① `.stack-gap3` 在 master 已存在，不具唯一性；历史“新鲜度全过”不成立，版本映射见 MORNING §4.1。
> ② 独立 QA 未覆盖 onboarding 帧，箭头修正的复视为**主控单方**。
> ③ 注入帧只证明渲染路径（E2），不证明命令执行或真实交互。
> ④ 截图“330px”应为 306×660（实测 25 张 PNG 均为 306×660）。

审查者：① 主控 M4 目视（before/after/states 全帧）；② **独立 QA 子 Agent**（只读截图+规格+总览图，不看实现 diff）。证据包 `docs/ui-ux-redesign/evidence/night-v2-2026-10-22/`（README 含环境/新鲜度/数据条件）。代码：before `c1a5aeb` → after `a81e3b7` → 修复 `5395f02`。

## 1. 第一轮差异清单（主控 M4，after@a81e3b7 对 PAGE_SPEC §10）

| 问题 | 实际表现 | 目标表现 | 影响 | 修正方式 | 复验结果 |
|---|---|---|---|---|---|
| G1 导航bar 深绿 | before 三页 forest 底白字 | paper 底黑字（家族一致） | 中 | 三页 json 两键（a81e3b7） | **PASS**：after 三页 top 帧 + routes-family-nav 对照帧 |
| G2 me 昵称字阶 | 17px | 18px（--text-title） | 低 | me.wxss（a81e3b7） | 文本级 PASS；像素级 UNVERIFIED（306×660 截图量不出） |
| G3 撤回语义色 | 中性 forest | danger 语义色 | 低 | me.wxss `.revoke-text`（a81e3b7） | **PASS**：me-revoke-short-y2100 注入帧红字可见（真实 positionRows 空 ⇒ 注入标注） |
| G4 行内 gap | `style="gap:12px"` ×6 | `.stack-gap3` 同值类 | 低 | wxml 类替换（a81e3b7） | PASS（无视觉变化，b4-e05 ratchet 通过） |
| **D1 引导卡箭头换行左坠**（首轮新发现缺陷） | me-onboarding@a81e3b7：`.cluster` wrap 把 `›` 挤到独立行左端 | 箭头钉行右端 | 中 | `.onboard-row` nowrap + `.onboard-main` min-width:0（5395f02） | **PASS**：复拍 me-onboarding 帧箭头在行右端 |
| D2 未定义类 `onboard-card` | 首轮误加 | 不存在 | — | 删除；G10/m02/ui-consistency 三门同点抓出（门有牙齿的正面证据） | check=0、m02 回 65/1 基线、ui-cons 17/0 |
| G5 anotices 单条空白 | 大片纸色 | 可接受，不造填充 | 低 | 不修，登记 | — |

## 2. 独立 QA 子 Agent 结论（摘要，原文见会话记录）

- §10 核对：1 PASS（家族一致半条当时 UNVERIFIED→本包补 routes-family-nav 后 PASS）；2 PASS（未读半条；已读半条当时 UNVERIFIED→补 notices-readmix 后 **PASS**：已读卡无左边线、无「标记已读」）；3 UNVERIFIED（px 级）；4 当时 UNVERIFIED→补注入帧后 **PASS**；5 PASS（5/5 有效帧）；6 PASS（tab 留白未位移）。
- before↔after 差异：仅导航bar 换肤（规格要求）；**回归检查：无**（徽标/左边线/正文/三按钮/发布主钮/计数行/tabBar 逐帧保留）。
- 总览图 8.1/8.2 构图级差异：通知无分类分段 tab、me 为左对齐身份卡+分组卡（规格 §3 声明保留现骨架）⇒ 记差异不实现；低分辨率细节「不判」。
- 注入五态：empty 有解释+下一步、loading 不遮挡、denied 有重试出路、longtext 全换行不溢出、longnick 不遮挡统计带；省略号细节 UNVERIFIED（低）。

## 3. 复验与门禁证据

- 复拍链：5395f02 → `cli close/open/auto 9425` 重编译 → states/ 全帧复拍 → 目视 D1 修复生效。
- 门禁（5395f02 时点实测）：check 0 / handlers 0 / scenario-notices 91 / scenario-me 143 / swx1 45 / swx2 110 / t4-e08 41 / b4-pad 32 / b4-e05 49 / ui-cons 17 / m02 65/1（clean 基线同款存量 PRIVACY 计数，night-v1 已登记）。
- **OPEN（留裁决，tools/ 冻结未动）**：`page2-gates` 的 2 条天气滚动断言为时序竞态——探针读数证 setData 回调（setImmediate）未落在 settle(30ms) 窗内（latch=true/queries=[]）；2×2：clean 基线 7 绿 0 红、带改动 7 红 1 绿、**noop 注释 1 红 1 绿** ⇒ 与改动内容无逻辑通路、概率受环境负载影响；notices/me 断言全跑次绿。建议门 owner 把 settle 改为 await 回调.promise 或加长窗口。

## 4. UNVERIFIED 清单（升级条件）

| 项 | 缺什么 |
|---|---|
| me 昵称/统计 px 级字阶与 tabular | 高分辨率截图或 DevTools computed style 读数 |
| longnick 省略号形态 | 放大裁切帧 |
| 家族一致（视觉） | 已有 routes 对照帧；workspace 帧可选补 |
| 撤回红字（真实数据） | 真实 positionRows 非空的账号会话（本轮注入帧已证渲染路径） |

## 5. 验收判定

Gate D：有条件通过（主控复核覆盖；独立 QA 覆盖子集；UNVERIFIED 见 §4）；合并准入见 [MORNING_REVIEW_REPORT.md](MORNING_REVIEW_REPORT.md)。
