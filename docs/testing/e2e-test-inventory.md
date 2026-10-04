> **Round 2 校准（2026-10-04）**：本文逐条清单的行号对应 **HEAD `1acd55e` 原状**；Round 1 声称的改造
> 当时未进树（见 `cross-agent-audit.md` §4.1）。本轮重建后实测：A 层 62 项（新增座位确定性 +
> SEAT_TAKEN 负向对照）、`e2e-fault-probe` 31 项，B 层按两维账本输出 VERDICT（语义见
> `docs/testing/e2e-result-semantics.md`，读数见 SYNC.md Round 2 条目）。

# E2E Test Inventory（现有端到端测试逐项清单）

> Round 1 审计产物。逐条列出 `tools/e2e-test.js`（A 层：服务链路）与 `tools/e2e-ui-test.js`
> （B 层：真模拟器 UI）中**实际存在的每一条断言**，并标注它属于哪个验证维度。
> 结论语义见 `e2e-result-semantics.md`；覆盖缺口见 `e2e-coverage-matrix.md`；可信度结论见
> `e2e-credibility-report.md`。
>
> **本清单的意义**：`58 + 31` 这种总数说明不了任何问题。同一行输出里，
> 「真机 tap 生效」与「云侧命令返回 ok」在旧模型中是等价的 `✓`——这正是假 PASS 的来源。

## 字段说明

| 列 | 含义 |
|---|---|
| Dim | `BIZ` = HARD_BACKEND_ASSERTION；`UI` = HARD_UI_ASSERTION；`ENV` = 环境前置（不计入任何业务结论） |
| Evidence | 证据来源等级：`envelope`（dispatch 信封）/ `readback`（read·readTransport·readExport·readForm 回读）/ `el`（元素存在·class·text·数量）/ `data`（page.data 或组件 data）/ `tap`（真实 element.tap() 生效） |
| Fix | `fixture` = 为后续步骤搭环境（允许走云侧命令，不构成用户可完成性的证据）；`soft` = 旧 `checkSoft` 站点（本轮改为需退化证据才允许降级）；`gap` = 动作经非 UI 路径完成，UI 维度记未验证 |

Dim 列的判定标准只有一条：**这条断言要成立，必须看见什么。**
只看见服务端返回信封的算 BIZ；必须看见渲染树或页面 runtime 的算 UI。

---

## A 层：`tools/e2e-test.js` — 服务链路 E2E

真实客户端信封 → `trailApi/index.js` 的 `exports.main` → 真实命令路由 / `overrideEvidence` /
requestId 幂等 / revision CAS → `store.persistState` 的 CAS 事务 → 读动作回读验证。
持久层是内存桩 `tools/stub-wx-server-sdk.js`（不发网络、不动云端数据），
因此 **A 层的 `BIZ` 是「领域 + 存储契约」级证据，不是「云数据库真的落盘」级证据**。
全部 59 项均为 `BIZ`；A 层不含任何 UI 维度证据，不得声称 UI 通过。

| ID | Flow | Action | Assertion | Evidence | Dim | Fix |
|---|---|---|---|---|---|---|
| A-001 | Profile | `profile.save` | 信封 ok 且 revision 推进到 1 | envelope | BIZ | |
| A-002 | Profile | `read{kind:profile}` | 写入的姓名可回读（write→read 回环） | readback | BIZ | |
| A-003 | Activity | `activity.create` | 返回草稿 ok | envelope | BIZ | |
| A-004 | Activity | `activity.publish` | 发布即报名：published + 本人 confirmed | envelope | BIZ | |
| A-005 | Signup | `read` organizer | `counters.confirmed === 1` | readback | BIZ | |
| A-006 | Signup | `read` participant | `permittedActions` 含 `signup.submit`（报名页准入闸） | readback | BIZ | |
| A-007 | Profile | `profile.save`(陈屿) | 建档 ok | envelope | BIZ | fixture |
| A-008 | Companion | `companion.save` | 常用同行人落库 ok | envelope | BIZ | fixture |
| A-009 | Signup | `signup.submit` | 本人+同行人整组提交 → pending | envelope | BIZ | |
| A-010 | Signup | `read` organizer | 名单可见 2 条待审核（含同行人王五） | readback | BIZ | |
| A-011 | Signup | `signup.review` | 批量确认 ok | envelope | BIZ | |
| A-012 | Signup | `read` organizer | 审核后 `confirmed === 3` | readback | BIZ | |
| A-013 | Idempotency | `signup.review`(同 requestId) | `replayed === true` 且零副作用 | envelope+readback | BIZ | |
| A-014 | Vehicle | `vehicle.save` | 参与者司机（陈屿）车辆建档 ok | envelope | BIZ | |
| A-015 | Activity | `activity.transition` | 推进 gathering ok | envelope | BIZ | |
| A-016 | Assignment | `previewAssignments` | 动作级 ok（`allocation.js` 惰性 require 修复的真机回归点） | envelope | BIZ | |
| A-017 | Assignment | `previewAssignments` | 林溪+王五入列、司机不占乘客位、`unassigned` 为空 | envelope | BIZ | |
| A-018 | Assignment | `previewAssignments` | plan 形状符合 preview 契约（activityId/baseRevision/assignments/seatLabel） | envelope | BIZ | |
| A-019 | Revision/CAS | `activity.transition`(过期 rev) | `CONFLICT` 信封 | envelope | BIZ | |
| A-020 | Revision/CAS | `read` | CONFLICT 无副作用（phase 仍 gathering） | readback | BIZ | |
| A-021 | Assignment | `assignment.commit` | 提交预览方案 ok | envelope | BIZ | |
| A-022 | Assignment | `readTransport` | 2 条安排同车、司机无乘客安排 | readback | BIZ | |
| A-023 | Vehicle | `vehicle.save` | 服务司机车辆建档 ok | envelope | BIZ | |
| A-024 | Permissions | `assignment.set` | 给参与者司机编乘客座 → `DRIVER_CONFLICT`（UI 过滤的域规则依据） | envelope | BIZ | |
| A-025 | Assignment | `readTransport` | 王五在 1 号车的原座号可从云端读回（改派目标由此推导，不硬编码） | readback | BIZ | 本轮新增 |
| A-026 | Assignment | `assignment.set` | 改派王五至 2 号车（不编座号 → `seatLabel null`）ok | envelope | BIZ | |
| A-027 | Assignment | `readTransport` | 王五已在 2 号车且 `seatLabel === null` | readback | BIZ | |
| A-028 | Assignment | `assignment.set` | 改派回 1 号车原座 ok | envelope | BIZ | |
| A-029 | Assignment | `readTransport` | 仍共 2 条安排（改派不产生重复行） | readback | BIZ | |
| A-030 | Attendance | `attendance.checkin` | evidence 只带 note 也通过（服务端 `overrideEvidence` 补 at/by） | envelope | BIZ | |
| A-031 | Attendance | `attendance.board` | 林溪上车 ok（前置=已有座位安排） | envelope | BIZ | |
| A-032 | Attendance | `attendance.departure` | 林溪出发核实 `joined` ok | envelope | BIZ | |
| A-033 | Attendance | `attendance.board` | 参与者司机无乘客安排 → 上车被拒 | envelope | BIZ | |
| A-034 | Attendance | `attendance.checkin` | 司机签到 ok | envelope | BIZ | |
| A-035 | Attendance | `attendance.departure` | 司机出发核实 ok | envelope | BIZ | |
| A-036 | Activity/Invariants | `activity.transition`(active) | 还差王五 → `UNRESOLVED_DEPARTURE` 硬门 | envelope | BIZ | |
| A-037 | Attendance | `attendance.checkin` | 王五签到 ok | envelope | BIZ | |
| A-038 | Attendance | `attendance.board` | 王五上车 ok | envelope | BIZ | |
| A-039 | Attendance | `attendance.departure` | 王五出发核实 ok | envelope | BIZ | |
| A-040 | Activity | `activity.transition` | 全员核实后推进 active ok | envelope | BIZ | |
| A-041 | Attendance | `attendance.node` | 路线节点确认 ok | envelope | BIZ | |
| A-042 | Activity | `activity.transition` | 推进 closing ok | envelope | BIZ | |
| A-043 | Attendance | `attendance.home` | 到家确认 ok | envelope | BIZ | |
| A-044 | Activity/Invariants | `activity.transition`(archived) | 还有未到家者 → `UNRESOLVED_SAFETY`（人人闭环才能归档） | envelope | BIZ | |
| A-045 | Export | `readExport` | 敏感名单导出 Result ok 且含三人 | readback | BIZ | |
| A-046 | Permissions | `readForm` | 本人带用途读取 ok 且回填 person | readback | BIZ | |
| A-047 | Permissions | `readForm` | 本人空用途读自己 → 放行（用途门槛只保护读他人） | readback | BIZ | |
| A-048 | Permissions | `readForm` | 读他人且无工作身份 → 拒绝 | readback | BIZ | |
| A-049 | Permissions | `readForm` | 组织者读他人不写用途 → 拒绝 | readback | BIZ | |
| A-050 | Permissions | `readForm` | 组织者写明用途读他人 → ok | readback | BIZ | |
| A-051 | Attendance | `attendance.home` | 王五到家 ok | envelope | BIZ | |
| A-052 | Attendance | `attendance.home` | 司机到家 ok | envelope | BIZ | |
| A-053 | Activity | `activity.transition` | 全员闭环后推进 archived ok | envelope | BIZ | |
| A-054 | Activity | `read` participant | 归档后 `detailState === 'finished'` | readback | BIZ | |
| A-055 | Export/Permissions | `readExport` | 归档后导出 → 拒绝（工作数据能力随归档关闭） | readback | BIZ | |
| A-056 | Permissions | `readForm` | 归档后按用途读他人 → 拒绝 | readback | BIZ | |
| A-057 | Router | `main{action:'nope'}` | 未知动作 → `INVALID_INPUT` 且 message 以「未知操作」开头 | envelope | BIZ | |
| A-058 | Permissions | `main` 无 openid | `AUTH_REQUIRED` | envelope | BIZ | |
| A-059 | Permissions | `previewAssignments` | 非组织者预览分车 → 拒绝 | envelope | BIZ | |

**A 层小结**：59 项，全部 `BIZ`。主链 建档→建活动→发布→整组报名→审核→分车→签到→上车→出发→
active→节点→closing→到家→归档 全程贯通，且含 6 条**负路径**（A-019/024/033/036/044/057–059）。
本轮修复 1 处 flaky（见 A-025/028 与可信度报告 §2）。

---

## B 层：`tools/e2e-ui-test.js` — 真模拟器 UI E2E

行号锚点为 **HEAD `1acd55e`**（改造前）；「HEAD 判定」列是审计读出的原状，「本轮」列是本轮改成的样子。
`soft` 一列的语义变化最关键：旧 `checkSoft` **失败即打印「跳过」且既不计 pass 也不计 fail**，
所以「一条 UI 断言从未通过」和「一条 UI 断言通过了」在旧输出里长得一样。

| ID | HEAD 行 | 断言 | HEAD 判定 | 本轮 | Evidence | 说明 / 问题 |
|---|---|---|---|---|---|---|
| B-001 | 88 | automator 连接开发者工具 | 计入 passed | ENV | — | 连不上时 `throw` → 退出码 1，看起来像被测对象失败；现记 ENV-BLOCKED→退出码 2 |
| B-002 | 91 | 模拟器运行中（基础库） | 计入 passed | ENV | — | 同上 |
| B-003 | 123 | 首页装配完成（loading=false，无 denied） | UI 硬 | UI 硬 | data | 真 UI 证据（页面 runtime） |
| B-004 | 127 | 首页可见至少一个活动 | UI 硬 | UI 硬 | data | — |
| B-005 | 134 | 活动详情页装配 | UI 硬 | UI 硬 | data | 只验装配，未验详情内容 |
| B-006 | 216 | 建 [预演] 活动草稿 | BIZ（计 UI 同名项） | BIZ | envelope | fixture，合法走云侧；重名站点见 §注 |
| B-007 | 212 | 建 [预演] 活动草稿（catch） | 与 B-006 **同名** | 改名区分 | envelope | 同名两条在不同路径各记一次，旧计数会把一次失败算两遍 |
| B-008 | 226 | 发布（发布即报名本人） | BIZ | BIZ | envelope | fixture |
| B-009 | 229 | lab 阶段 0：建档 5 演员 + 2 同行人 | BIZ | BIZ | envelope | fixture（trailApiLab） |
| B-010 | 253 | lab 阶段 1：演员报名 5 组 | BIZ | BIZ | envelope | fixture |
| B-011 | 261 | 演员报名落库：organizer 视角可见报名行 | BIZ | BIZ | readback | — |
| B-012 | 264 | （非断言）lab 未收敛 → 降级最小阵容 | 打印一行提示 | 保留 | — | **门槛降级**：沙盒阵容缩水后，后续对账断言的强度随之下降 |
| B-013 | 271 | 工作台装配（organizer 视角非 denied） | UI 硬 | UI 硬 | data | — |
| B-014 | 274 | 页头指标对账：待审核数与云端一致 | UI 硬 | UI 硬 | data×readback | 真对账（UI 读数 vs 云端读数），质量高 |
| B-015 | 278 | 四个分区 tab 渲染 | **soft** | soft | el | HEAD 实测恒为 0 个（`$`/`$$` 缺陷），从未通过 |
| B-016 | 285 | 名单面板可见（无 hide） | **soft** | soft | attr | HEAD 实测恒为 `hide`——面板其实是隐藏的，被洗成「跳过」 |
| B-017 | 288 | 名单行数与云端一致 | UI 硬 | soft | el count | 唯一真正跑通的元素断言（用 `$$`）；但它数的是 **display:none 面板里的行** |
| B-018 | 296 | 审核确认全部待审核（组织者动作） | BIZ | BIZ | envelope | 云侧命令，非 UI |
| B-019 | 300 | 审核后工作台指标归零 | UI 硬 | UI 硬 | data | 「页面响应环境变化」的有效证据 |
| B-020 | 311 | 添加车辆 | BIZ | BIZ | envelope | 云侧命令，非 UI（车长页/车辆编辑面板无 UI 覆盖） |
| B-021 | 320 | 切到分车区（tab=2） | **soft** | soft | data | 依赖 B-015 的 tap，故同样恒失败 |
| B-022 | 328 | 分车面板渲染出车辆卡 | UI 硬 | soft | el | 用 `$` 单元素查询，实际能拿到，改为通道可判 |
| B-023 | 346 | 预览自动分车 → 方案弹层出差异行 | **`check(name, true)`** | soft | el | **硬编码 true**：断言恒真，等于没断言；且仅在分支内执行 |
| B-024 | 354 | 找到「明确确认并提交此方案」按钮 | 仅失败分支记 | soft | el | 成功时不记 UI 证据（旧模型「没报错就算过」） |
| B-025 | 357 | 方案弹层出错误 | 仅错误分支 | 合并进 B-023 | el | — |
| B-026 | 370 | 云侧降级 previewAssignments → assignment.commit | **计为通过** | BIZ + `uiUnverified` | envelope | **本轮核心修复点**：UI 失败→云侧兜底→旧模型当 UI 通过 |
| B-027 | 372 | 云侧降级 previewAssignments ok | BIZ | BIZ | envelope | — |
| B-028 | 377 | 提交方案 → 云端落库安排 | BIZ | BIZ | readback | 仅当 UI commit 为真时执行；`committed=false` 且云端已有安排时**整段无断言**（本轮补） |
| B-029 | 396 | 座位示意渲染已占座 | **soft** | soft | el attr | HEAD 恒 0 个 seat |
| B-030 | 433 | 推进 gathering | BIZ | BIZ | readback | — |
| B-031 | 446 | 现场区渲染已确认名单 | **soft** | soft | el count | HEAD 恒 0 vs 云端 8 |
| B-032 | 461 | 现场记录弹层打开 | UI 硬 | UI 硬 | 组件 data | 但 HEAD 下 `sheetBtns[0]` 恒不存在 → 此断言**从未执行过** |
| B-033 | 470 | UI 弹层签到 → 云端落库 | BIZ（自称 UI） | BIZ + 元素前置 soft | readback | HEAD 下从未执行 |
| B-034 | 473 | 弹层出现「确认现场签到」动作 | 仅失败分支 | 改为正向 soft | el | 「没报错就算过」的典型 |
| B-035 | 494 | UI 弹层出发核实 → 云端落库 | BIZ（自称 UI） | BIZ | readback | 第二次开弹层的 `sheetOpen` **无断言**（本轮补） |
| B-036 | 497 | 弹层出现「核实已随队出发」 | 仅失败分支 | 正向 soft | el | — |
| B-037 | 501 | 拼车乘客上车用命令补齐 | **无断言**（fire-and-forget） | BIZ + `uiUnverified` | envelope | 旧代码连返回值都不看 |
| B-038 | 508 | 现场区「现场记录」按钮渲染 | **soft 且恒传 false** | soft | el | 写死 `false` 的 soft：永远只是「跳过」 |
| B-039 | 535 | 批量签到/上车/出发核实完成 | BIZ | BIZ | envelope | 兜底路径；旧模型把它算进「UI E2E 通过数」 |
| B-040 | 544 | 推进 active（出发核实硬门） | BIZ | BIZ | readback | — |
| B-041 | 548 | 路线节点确认 | BIZ | BIZ | envelope | 命令路径，节点动作的 UI 入口未覆盖 |
| B-042 | 550 | 推进 closing | BIZ | BIZ | readback | — |
| B-043 | 567/573 | UI 弹层到家确认 → 云端落库 | BIZ（自称 UI） | BIZ | readback | HEAD 下从未执行 |
| B-044 | 575 | 弹层出现「核实安全到家」 | 仅失败分支 | 正向 soft | el | — |
| B-045 | 579-583 | 其余人到家批量命令 | **无断言** | BIZ（新增汇总断言） | envelope | 旧代码循环里不检查返回值，失败只会在归档时以 `UNRESOLVED_SAFETY` 间接暴露 |
| B-046 | 585 | 全员闭环后归档 | BIZ | BIZ | readback | — |
| B-047 | 591 | 归档后工作台：待到家指标归零 | UI 硬 | UI 硬 | data | try 内 |
| B-048 | 595 | 同上（catch） | **soft 且恒传 false** | ENV-BLOCKED | — | 注释「归档已由云端断言确认」= 用业务证据洗 UI 缺口 |
| B-049 | 600 | 工作台全链（沙盒）catch | BIZ | BIZ | envelope | 链中断记业务失败，合理 |
| B-050 | 607 | 建报名沙盒活动 | BIZ | BIZ | envelope | fixture |
| B-051 | 618 | 发布报名沙盒 | BIZ | BIZ | envelope | fixture；随后 `signup.cancel` 腾位**无断言** |
| B-052 | 635 | 报名沙盒通过装配（准入闸放行） | UI 硬 | UI 硬 | data | 真 UI 证据 |
| B-053 | 640 | 本人参与人来自档案（姓名回填） | UI 硬 | UI 硬 | data | — |
| B-054 | 641 | 紧急联系人回填 | UI 硬 | UI 硬 | data | 真机回归点，有效 |
| B-055 | 647 | 报名页 checkbox-group 渲染 | **soft** | soft | el | HEAD 恒 0 |
| B-056 | 654 | 真实原生 tap 切换授权 → 数据翻转 | UI 硬 | UI 硬 | tap+data | **全套件最强的 UI 断言**；但 HEAD 下因 B-055 恒 0 而从未执行 |
| B-057 | 664 | 我的页装配（档案姓名可见） | UI 硬 | UI 硬 | data | — |

### 注：本轮新增的断言（HEAD 不存在的站点）

| 新增 | 断言 | Dim | 为什么要加 |
|---|---|---|---|
| N-01 | 分车面板宿主可查询（transport-panel） | soft | `tp` 为 null 时旧代码直接 `tp.$` 抛异常，把整段洗成 catch |
| N-02 | UI 提交生效：弹层收起且出现成功反馈（组件 data） | UI | §9「动作真的发生」——tap 之后必须有 UI 侧反馈，不能只看后端落库 |
| N-03 | 分车预览 CTA 与方案弹层可达（元素级） | soft/UI 硬 | 通道健康却拿不到 → 判真实 UI 缺陷（旧代码此时**一条断言都不记**） |
| N-04 | 云端已有安排（本次未经 UI 提交）+ `uiUnverified` | BIZ+gap | 旧 `if/else` 漏掉的第三态：既不 committed 又已有安排 → 静默 |
| N-05 | 座位/名单/按钮等 8 处正向元素级 soft（替代「只在失败时记一条」） | soft | 把「缺失」与「未验」分开 |
| N-06 | 关遮罩后弹层可再次打开 / closing 阶段弹层可打开 | UI | 旧代码轮询 `sheetOpen` 却不断言 |
| N-07 | 云侧补齐上车落库 / 批量到家核实全部落库 | BIZ | 旧代码 fire-and-forget |
| N-08 | 工作台 UI 段 / 报名页 UI 段的 `SKIPPED` 留痕 | skip | 旧代码门槛没过时整段静默不执行 |
| N-09 | `==== VERDICT ====` 四态块 + 退出码 0/1/2 | — | 权威结论不再依赖 `passed=N` |

### 逐轮实测读数（同机同云，每行都来自脚本真实输出）

| 轮 | 代码状态 | 旧式读数 | 新模型读数 |
|---|---|---|---|
| ① | HEAD，自动化端口未就绪 | `✗ automator 连接` → throw → 退出码 **1** | ENV-BLOCKED → OVERALL **INCONCLUSIVE**（2） |
| ② | HEAD 逻辑 + 新账本 | `passed=31 failed=0`（**读起来像全通**） | BUSINESS PASS(17/0) · UI **INCONCLUSIVE**(14/0/9 skip) · OVERALL INCONCLUSIVE |
| ③ | 修 `queryAll` 的 `$`→`$$` | `passed=44 failed=5` | BUSINESS FAIL(17/1) · UI **FAIL**(27/4) · 0 skip |
| ④ | 弹层内容改从面板作用域查 + 上车顺序修正 | `passed=? failed=?` | UI 现场段首次真跑通；剩 2 项失败暴露出面板挂载读数过期与 `departure:'unknown'` 过滤缺陷 |
| ⑤ | 加 `labelsOf` 现场诊断 | `passed=55 failed=2` | BUSINESS FAIL(20/1) · UI FAIL(35/1) · 0 skip · 2 项 UI-UNVERIFIED |
| ⑥ | 修 `unknown` 过滤 + 阶段推进后重开页面 + 回读目标改从 `data.sel` 反查 | `passed=53 failed=3` | BUSINESS **PASS**(21/0) · UI FAIL(32/3) · 0 skip —— 3 项失败集中在分车面板空渲染（现场弹层链已全绿） |
| ⑦ | 车辆卡改条件轮询 + CTA 可点状态断言 + 面板 error/busy 进失败信息 | `passed=59 failed=0` | BUSINESS **PASS**(21/0) · UI **INCONCLUSIVE**(38/0/0 skip) · OVERALL INCONCLUSIVE —— 2 处 `UI-UNVERIFIED`（上车入口属车长角色、批量到家只 1 人经 UI） |

**读数的意义**：②与①的旧式输出都是「0 failed」，但②真实含义是 `UI: INCONCLUSIVE`。
③之后 UI 通过数从 14 涨到 32+ 而 skip 归零——**不是加了更多测试，是元素通道修好了**，
过去被洗成「跳过」的断言第一次真的执行并给出结论。

## 每动作的证据链核对（§九 要求的五级）

| 动作 | Action | UI Runtime | Page/组件 Data | Backend State | Evidence | 现状 |
|---|---|---|---|---|---|---|
| 分车预览→提交 | tap CTA（文案定位） | ✓ 元素存在 + `class` 无 disabled | ✓ `planOpen` / `planChanged` / 提交后 `message` | ✓ `readTransport.assignments` | shot 04 | 轮③起真跑通（轮⑥遇空渲染，待轮⑦定论） |
| 现场签到 | tap 「确认现场签到」 | ✓ 按钮元素 | ✓ `sheetOpen`、`data.error` | ✓ 行 `checkedIn` | shot 05 | ✓ 真跑通 |
| 出发核实 | tap 「核实已随队出发」 | ✓ | ✓ | ✓ 行 `departure==='joined'` | — | ✓ 真跑通（需先补齐上车前置，见 R16） |
| 到家核实 | tap 「核实安全到家」 | ✓ | ✓ `sheetOpen` | ✓ 行 `home===true` | — | ✓ 真跑通 |
| 授权勾选 | tap 原生 `checkbox` | ✓ | ✓ `participants[0].consent.dataUse` 翻转 | —（本地草稿，设计上不提交） | shot 04-signup | ✓ 真跑通 |
| 清点上车 | — | ✗ 组织者现场面板无此入口 | ✗ | ✓ 命令落库 | — | **UI 未验证**（记 `uiUnverified`） |
| 其余 7 人签到/出发/到家 | — | ✗ 批量命令 | ✗ | ✓ | — | **UI 未验证** |
| 审核 / 添加车辆 / 阶段推进 / 节点 | ✗ 云侧命令 | ✗ | ✗ | ✓ | — | **UI 未验证**（scenario-workspace 有页面级但非真渲染） |


