# MORNING_REVIEW_REPORT — T011 合并准入复核

审查日期：2026-10-23。结论：**READY WITH CONDITIONS**，不是合并批准，也不是全站视觉验收通过。

本轮只读生产代码；只编写审查材料、规划和任务卡。未 merge、push、rebase、stash、checkout 覆盖、部署或操作开发者工具。历史报告保留为历史；当前结论以本文、[遗留台账](FOLLOWUP_TASK_LEDGER.md)、[执行计划](FLASH_EXECUTION_PLAN.md)、[决策记录](DECISION_LOG.md) 为准。旧 Flash 工具包引用已不存在的 worktree，不可直接执行。

## 1. 合并结论与最小前置

代码层面没有发现 T011 新增的业务/权限/数据写入变更：7 个唯一客户端文件，事件绑定签名逐项相同，共享样式和业务 JS 差异为零。现存 PNG 可见浅色导航、引导卡右端箭头和撤回红字，但历史新鲜度判据、版本映射、独立复验范围及部分测试归因记录不足，不能无条件 READY。

| 条件 | 最小动作 | 通过条件 | 对应任务 |
|---|---|---|---|
| C1 订正验收依据 | 给历史文档加前向勘误，修正机器队列、计数、截图与探针结论；不删除历史 | 不再称 `.stack-gap3` 唯一、不再把截图检查当真实交互；T011 不再被重复派发 | FU-01，READY，Flash |
| C2 最终代码定点补证 | 经会话授权后，仅复拍 notices/anotices 首屏与 me 普通/长昵称/未激活/短列表撤回状态；同夹具记录最终代码指纹、DOM 几何、computed style；引导卡做打开→关闭的真实 tap | 新鲜度可区分 master/a81e3b7/最终版；18px/600 由样式读数确认；箭头不掉行；不溢出；tap 后 overlay 开/关；无生产写入 | FU-02，BLOCKED，等 D-01 |
| C3 收口裁决 | 强模型或独立审查者核 C1/C2 和最终 diff，重新核本地 master 是否移动 | 没有新增失败；m02 只保留已知 PV5；不存在未解释的 page2 新签名；维持 7 文件边界 | Integration Owner；不执行合并 |

**不进入本次条件**：通知分页/类型、撤回确认产品选择、全局页头、editor 新能力、天气/privacy 解冻。昵称省略号本身不是必要验收条件：它是原生可编辑 input，应验证完整值可编辑和不侵占邻区，而不是自行改成省略文本。

## 2. 现场与提交链

原工作区 `D:/OurTrail`，Git 根相同，分支 `agent/ourtrail-night-ui-v2`，HEAD `220a91c`。本地 master=`c1a5aeb`，`rev-list --left-right --count master...night`=`0 3`，本地可快进，但本轮不执行。起始只有这一 worktree。

```
c1a5aeb (master, agent/ourtrail-night-ui-v1)
  -> a81e3b7  2026-10-22 22:36:31 +08:00
  -> 5395f02  2026-10-22 22:50:01 +08:00
  -> 220a91c  2026-10-22 22:53:28 +08:00
```

原工作区无 tracked 修改；4 个 untracked 顶层条目为两份提示词、一个 zip、交付包目录，与历史清单相符，不等于只有4个内部文件。没有触碰它们。没有发现另一个未报告的 tracked patch。当前 origin 是 GitHub 直连；夜间分支没有 upstream，未查询实时远端，故“远端未推送”仍是历史陈述，不由本地引用证明；本轮没有 fetch/pull/远端写入。

为保护未跟踪材料，新建同仓库工作树 `D:/OurTrail-ui-followup-20261023`、分支 `win/ui-followup-plan-20261023`，从 `220a91c` 起，规划文件未提交。不是独立仿制项目。工作树创建是唯一 Git 元数据写入。

原始事实：[repository-facts.json](../evidence/morning-review-2026-10-23/repository-facts.json) 保存程序化读取的完整 SHA、工作树、路径、绑定签名统计和 PNG SHA256；未手抄长标识符。

## 3. 累计 diff 与作用域

| 分区 | 唯一文件数 | 内容 |
|---|---:|---|
| 生产 | 7 | notices/anotices 各 json+wxml；me 的 json+wxml+wxss |
| 文档 | 12 | engineering-workflow 10份、证据 README、SYNC.md |
| PNG | 25 | before 6、after 主帧6、states13 |
| 合计 | 44 | `git diff --stat master...night`：555 insertions / 12 deletions（文本） |

生产文本单独为 +25/−12。两次实现提交的“7+2”是文件触及次数，不能加成9个唯一文件；第二次两个文件都已在第一次集合内。

- 三页 json 只添加纸色导航背景与黑字；不改注册/路由。
- `.stack + gap:12px` → `.stack-gap3`：`app.wxss:104-108` 证明同值；去掉两处与全局一致的 cluster gap；页面末端安全留白未动。
- me.wxss:75 字号17→`var(--text-title,18px)`；:102 撤回只改色/字重；:106-107 引导文字列 nowrap/min-width 修正。都是页面局部类。
- notices/anotices WXML 仍逐字节相同；bind/catch **完整属性签名**排序比较：12=12、12=12、me 51=51，内容相同，不只是计数相同。
- cloudfunctions/、tools/、utils/、components/、app.wxss 全部 diff 为空。没有共享样式新增副作用路径，也没有未说明的 JS/命令改动。只能证明源码契约未变，不能替代点击与命中验证。

## 4. 真实截图直接复核

使用 `ourtrail-ui` M3 和 visual-regression-review 的截图回归方法；本轮读 PNG，不启动浏览器仿制页，不把像素宽当 CSS viewport。

[旧证据包](../evidence/night-v2-2026-10-22/README.md) 的25张 PNG 在文件系统及 Git 中均存在，PNG头有效，实测全是 **306×660**。报告称330px不准确。截图元数据没有 DPR、CSS viewport、IDE版本、基础库运行版本，不能倒推18 CSS px。

| 直接检查对象 | 本轮可确认 | 不能据此确认 |
|---|---|---|
| before/after 三页 `*-top.png` | 深绿导航→浅色；卡片标题、按钮、徽标等在所见首屏保留 | 所有业务链路可用、完整 bundle 对应某 commit |
| before/after `me-scroll.png` | 同行人中段列表和底栏位置无明显变化 | 已到页尾、最后一项不被挡；这不是底部帧 |
| states/me-onboarding.png | 箭头在说明右侧；与最终 nowrap 代码一致 | 原缺陷前后成对复验；首轮同名帧已被覆盖 |
| states/me-longnick.png | 单行输入在右边截去可见部分，统计未被覆盖 | 18px/600、完整80字编辑、原生键盘；截图不要求自动带省略号 |
| states/notices-readmix.png | 已读无左线/无标记已读按钮；未读两者都有 | `notice.read` 命令真的执行；该帧是注入 |
| states/notices-longtext.png | 当前短于2000字的长文样本换行、操作仍可见 | maxlength=2000 的极限排版；历史 QA 将其称2000字级过强 |
| states/me-revoke-short-y2100.png | 红色撤回与中性复制同屏、短列表页尾可见 | 真实授权撤回成功；列表与授权行为均未执行 |

### 4.1 新鲜度与复验记录的具体缺口

1. 仓库外 `shot-night-v2-after.js:14-18` 只查 `.stack-gap3`。**master me.wxml:189 已有此类；master notices/anotices.wxml:42 的投递分支也有**。这个判据不能证明新 bundle，更不能区分箭头修复前后。导航像素只能旁证浅色配置已经生效。
2. states脚本同名覆盖写；最终 me-onboarding 只有一张。README 声称归属5395f02，但图片时钟22:42早于22:50提交，准确表述应是“报告称当时工作树内容后来提交为5395f02”；缺当时源码指纹，不能把“提交后重编译”当已证时序。
3. 四个驱动只导航/滚动/setData/截图，无真实 tap+后果。独立QA最初未审 onboarding，后补帧和箭头修正没有第二份独立复验原始记录；“独立QA最终全部通过”超过可核范围。
4. 三张 revoke 深滚帧未拍到目标；README 已解释过程帧，不得计作撤回的三个通过样本。当前13张states也不是13个独立通过案例。
5. me的 input 绑定 `onField/onBlurSave`（me.wxml:20-30）：真实输入可能写本地草稿并自动提交。补证必须用受控隔离账号/经验证的写入阻断，不准在真实资料上试填长昵称。

以上是**证据不足/方法错误**，不是把截图判成伪造，也不是已证产品故障。

## 5. 本轮测试，与历史分栏

本轮：2026-10-23 09:40 +08:00；Node **v24.19.0**（与夜报v24.18.0不同）；在独立工作树实际执行，每条保留 stdout/stderr、退出码、起始时间，未用管道末端退出码冒充测试码。

| 实际命令（`node tools/` 后缀） | passed/failed | exit |
|---|---|---:|
| check.js | ALL CHECKS PASSED | 0 |
| check-handlers.js | 见完整日志 | 0 |
| scenario-notices-test.js | 91/0 | 0 |
| scenario-me-test.js | 143/0 | 0 |
| swx1-style-gates-test.js | 45/0 | 0 |
| swx2-style-gates-test.js | 110/0 | 0 |
| t4-e08-test.js | 41/0 | 0 |
| m02-class-scope-test.js | 65/1 | 1 |
| b4-pad-final-value-test.js | 32/0 | 0 |
| b4-e05-checklabel-test.js | 49/0 | 0 |
| ui-consistency-test.js | 17/0 | 0 |
| page2-gates-test.js | 98/0 | 0 |

12项中11项exit0；没有全量sweep。原始结果：[test-results.json](../evidence/morning-review-2026-10-23/test-results.json)，同目录含每套 `.stdout.txt/.stderr.txt`（空stderr是有效空输出，不是丢日志）。

m02当前唯一失败为PV5：要求4个privacy章节，实际5个且每个样式16px/600均正确；tools/m02、privacy、app.wxss 相对master未改，签名与旧台账一致。**本轮没重新跑master副本**，不把历史stash归因冒充本轮对拍，也不删隐私章节换绿。

### 5.1 page2 OPEN 不自动挡合并

源码 `tools/page2-gates-test.js:584,649,798-807` 确有 setImmediate 与固定30ms等待，支持时序脆弱的判断；本轮一次98/0并不关闭它。

仓库无夜间probe/noop/bisect原始日志。已知临时目录仍有17份10-22的 `p2*.txt`（12份96/2、5份98/0），但无命令/commit/diff/分组映射；文件名不能证明clean或noop。临时 `p2probe.js/probe_main.txt/probe_wt.txt` 为空，未找到latch探针原始输出。因此夜报的“7绿/7红”和“原因已完全排除”保持**历史转述，独立归因未完成**，不能为其补编证明。

不修tools、不用延长sleep换绿。若后续出现不同失败签名，应停止并重新归因；相同两条仍为OPEN，待技术负责人解冻后用事件完成信号与正反控制验证。

历史未重跑：trip2、GP-01及三套IDE E2E、cold-start、g2；它们不得出现在本轮通过数里。

## 6. 页面、设计、UI Lab 的版本边界

程序化实点：21注册页、14组件目录、44 tokens、106个`tools/*-test.js`。前述静态数量不代表覆盖完成度。

night-v1报告列出的已取证页面集合实际 **12** 个：home/discover/activity/signup/editor/routes/route/route-edit/workspace/vehicle/staff/tasks；加T011三页共15。15+天气3+privacy1+内部2=21。旧“13页”是数错；不能把不同版本历史截图升级为当前代码全站验证。

无独立设计稿：tasks/weather-chart；anotices没有独立画稿，但v2明确借notices的8.1变体，故“完全无映射2页”与“缺独立画稿3页”是不同口径。

夜间十文档已读取。`night-run-state.json:38,42` 仍是T011 ready、nextExecutable T008；不符合提交现状。旧flash-dispatch-kit:12-16指向已删除worktree并描述90+在途修改，不能沿用其执行路径/授权。

UI Lab 是另一仓库 `D:/OurTrail-UI-Lab`（本轮实读HEAD 666d7a3），不是当前生产worktree。已读 `docs/ui-design/round-7/07-production-migration-plan.md:4-8,40-59` 与 `13-m4-report.md:4-11,46-57`：迁移基线b9c7d4d，历史M1/M2已清理，patch保留，未完整通过真机/权限验证。`D:/OurTrail-UI-Lab-Qwen/.../baseline.md:3-7,36` 是10-17独立实验目录、20页旧基线。它们可以作设计背景，不能把Lab的CSS、测试读数、假流程或已接受的设计方向当作生产已迁移事实。

## 7. 后续范围核查要点

- 通知：schema.js:308-311没有Notice.kind；sourceEventId可能指向已独立淘汰的事件；普通投影裁掉关联，不能靠中文分类。`notices-page.js:64` 只是reverse，无未读优先/时间显式sort；PAGE_SPEC:13“未读在前”须勘误，排序问题另立FU-19。
- 669仅旧截图。客户端分批可减setData/渲染量，但当前store完整加载与下载不减；真正分页须同时处理动态权限、稳定游标、事件/通知800上限和并发，不是CSS任务。
- 撤回写revokedAt、不删坐标（field.js:43-46）；以后能满足active/已随队/未过期/重新同意条件时重新上报（:153-159），不是“恢复旧授权”。另有既存位置过期文案风险，见FU-20，不与确认弹窗混包。
- 页头：home.wxss:16-17/discover.wxss:10-11仅2对同形文字规则。只上收这两对净减2条物理规则行；卡片信息另4行重复不是同一任务。不能改被17注册页76处引用的 `.section-head` 基类。
- editor：封面、正文图选封面、装备数组与编辑已存在；缺的是指定布局/交互。人工Day计划模型、活动公开权限是独立产品/架构问题，详台账EDI系列。

## 8. 工具链结论与风险上限

现有CLI+automator足以继续小程序采证，但缺可移植驱动、可靠版本门、不可覆盖帧、样式/视口记录、输入隔离及独立最终复核；**当前历史闭环不能原样作为自动放行器**。先补流程，不安装更多Skills，不重审外部四仓。

浏览器Playwright截图不可冒充小程序；原生picker、键盘/微信身份、物理手机触控与安全区需人工补。独立离线像素diff可将来用作变化探测，不能决定设计是否合适；版本/状态未锁定前不引入。不得遮罩昵称和按钮等本次关键区域来压低diff。

本轮实际使用writing-plans、using-git-worktrees、ourtrail-ui、dispatching-parallel-agents、visual-regression-review。三名只读研究者分查通知、共享页头/editor、历史探针；主控直接读diff和截图、运行测试并复核关键源行；未把搜索摘要当结论。

最终工作区安全记录及计划完整性检查见 [planning-validation.json](../evidence/morning-review-2026-10-23/planning-validation.json)。本轮无生产实现、无提交；下一步由用户选择任务派发与会话授权。
