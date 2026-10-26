# Style B · Slice 5c 证据 —— 车辆 / 现场协作 / 预演 / 隐私 / 云场 POC（2026-10-26）

## 0. 口径与结论一句话

同 5a/5b：这五页**没有逐屏板**（`style-b-fidelity-matrix-2026-10-26.md` §2.3），
其中 `lab` / `privacy` / `cloud-field-poc` 还按矩阵排除在视觉批次之外（DEV_ONLY 预演 / 法务正文 / POC）。
任务书对这三页另有一条硬边界：**不凭 denied 态改结构**（`signup` / `staff` / `vehicle` 的真实态 UNVERIFIED）。

本片实际改动 = **`lab.wxml` 两处类名替换**，其余四页**一行未动**；
真正交付的是那条判据从"我改过的页"升成**全仓**，并证明新门的扫描面确实比我的写集宽。

## 1. 实际改了什么

| # | 位置 | 改前 | 改后 |
|---|---|---|---|
| C1 | `lab.wxml:24` 预演活动标题 | `style="font-weight:600;min-width:0;word-break:break-all;"` | `class="row-title" style="min-width:0;word-break:break-all;"`（**`break-all` 原样保留**：这是该页对 64 位身份码/哈希串的既有强断策略，比 `anywhere` 更狠，不能被"收敛"顺手换掉） |
| C2 | `lab.wxml:38` 阶段卡标题 | `style="font-weight:600;"` | `class="row-title"` |

`lab` 的内联 style 13 → 12。**业务、导航、四态、底部留白零改动**：这四页一行未碰，
所以"不回归"对它们是按构造成立的（不是测出来的）；`lab` 那两行只换样式归属，不触碰 handler、dataset、`wx:if` 链。

## 2. 判据升成全仓，并且**先证明那把尺能产生差**

原来那条门只扫 5 个页（route / route-edit / editor / signup / lab）——这种门答绿是免费的：
它看不见任何我没碰过的页。新门 `全仓独立的内联字重行标题为 0；复合内联字重只剩登记的这 2 处` 扫
**全部页面 + 全部组件的 wxml**，并且把剩下的两处**复合**内联逐条点名比对（不是数"≤ 2 就算过"）：

- `editor.wxml:638` 的「完成/编辑」——带语义色的**文字动作**，不是行标题 ⇒ 有意保留；
- `activity.wxml:166` 的同族行标题——`activity` 属已验收的 Slice 2/3 写集，**登记为后续项，本轮不重开该文件**。

改完全仓读数：**独立形态 0 处**（14 处抄写已在 5b/5c 收干），复合形态恰好上面那 2 处。

牙齿自证 `tools/mutate-5c.js`：**6 条 0 漏网**，逐条 sha256 还原并独立复验，变异前全绿否则 `exit 2` 记 INVALID。
六条的分工是刻意凑齐的"宽度矩阵"，不是随便挑六个点：

| 变异 | 打在哪 | 证什么 |
|---|---|---|
| P1 | `lab`（我改过的页）一处退回独立内联 | 门内页仍然会红（且同时触发 5b 那条页级门 ⇒ 实际红 2 项，符合预期不是连带噪音） |
| P2 | **`staff`——本轮一行未动**加一处独立内联 | **扫描面不是"只覆盖写集"**：没碰过的页也会红 |
| P3 | **`vehicle`——同样一行未动**加一处**复合**内联 | 例外名单是**逐条比对**：多一处复合就红，不是"≤2 就过" |
| P4 | 把已登记的 `activity` 复合形态改成**独立**形态 | 例外名单不会反过来保护新写法（复合 ⇒ 独立 的漂移要能咬） |
| P5 | `components/roster-panel` 加一处独立内联 | **组件目录也在扫描面内**（页面之外的第 20 个模板宿主） |
| P6 | `app.wxss` 的 `.row-title` 只留 `overflow-wrap` 丢掉字重 | "两半同处"是双向的：5b 的 N8 打掉断词那一半，这里打掉字重那一半 |

## 3. 审查后**没动**的（附理由，别在下一轮重复提议）

| 对象 | 现状 | 不动的理由 |
|---|---|---|
| `.title-md` 候选：`--text-title` + 26px + 600 这个三元组在 `me.wxss:32`（工具入口标题）、`routes.wxss:26`（路线标题）、`staff.wxss:11`（身份头标题）**各抄一份** | 未合并 | **同值不同义**（铁律 31②）：三者是三种屏上的三种对象——一个 CTA 的入口名、一个列表项主标题、一个角色身份头。它们今天同值，没有理由绑成一起改；`.card.rows`（同一含义抄 5 份）与 `.row-title`（同一含义抄 14 份且**漏了另一半**）都有"含义同一"的证据，这一条没有。并且它**不产生行为缺口**（三处都自带所需颜色/断词），收它要重钉两条与"长文本换行"有关的既有断言，为零行为收益冒放宽的风险。**登记为待裁决**，不自行做 |
| `cloud-field-poc.wxss` 的 `15px / 11px / 10px` 与 `.poc-title{15px;600}` | 未动 | POC 页按矩阵排除在视觉批次；它的字号确实无源，但收它等于给一个 DEV_ONLY 页新建全局档位的第二个消费者。登记，不做 |
| `privacy.wxss` 的 `27rpx` 正文档 | 未动 | 文件头注释已写明"与全站 px 口径不一致，那是 **E-09 的账**，未动"——先于本轮存在且已归属，不重复登记 |
| `vehicle.wxss` 注释自述"本页不写任何 min-height 字面量（M-07）" | 属实 | 实测该文件 `min-height:` 字面量 **0 处**，触控高由 `.person-row` / `.button` 的全局 `--action-height` 承担。这条不是"看着像"，是 grep 复算过的 |
| `staff.wxml` 1 处、`vehicle.wxml` 3 处内联 style | 未动 | 全是 `.stack`/`.cluster` 的布局覆盖（`gap:8px`、`justify-content:space-between`），不是数值出处；已由 5b 的棘轮管住"只许变少" |

## 4. 门禁读数

```
personal-route-layout 72/0（5b 后 71 → +1 条全仓门；check() 顺带补上 extra 参数，失败时打印命中清单）
scenario-lab 20/0 · lab-dryrun 165/0 · routes 75/0 · scenario-editor 227/0 · scenario-signup 106/0
scenario-activity 212/0 · scenario-me 145/0 · scenario-vehicle 66/0 · scenario-staff 26/0
page2-gates 124/0 · swx1 45/0 · swx2 110/0 · m02-class-scope 66/0 · t4-e08 41/0
ui-consistency 19/0 · journey-graph 15/0 · b4-pad-final-value 33/0
check.js ALL CHECKS PASSED（G10 命中 0 ｜ 作用域单元 42 ｜ class token 3195 ｜ app.wxss 类名 139）
check-handlers 门 B 通过，死 handler 仍是存量 1 条（editor#onNumber）
```

## 5. 真机状态（2026-10-26 回读后更新）

**本批的 `lab` 两处已回读**：预演页 `.row-title` **7 个在屏**，文本含真实活动标题
`[预演] 状态矩阵E2E-7cm7`（就是带 `break-all` 的那一处）与各阶段卡标题 ⇒ 改过的两处确实被渲染。
帧 `device/G1-lab-rowtitle.png`，读数字段见 `../style-b-slice5-device-2026-10-26/README.md` §2。

其余四页**一行未动**，因此不需要新帧来证明"没变"——它们的现状与批次二 b 那次真机回读之间没有我方改动。
仍缺的（不属本批）：`break-all` 在超长哈希串下的实际断行位置只在真机上看过普通长度活动名，
未专门喂 64 位串；375 / 414 两档未驱动。

结论上限：`lab` 两处升到 **E3（真实数据 + 元素读数）**；其余按"未改动"处理，不记通过也不记缺口。
