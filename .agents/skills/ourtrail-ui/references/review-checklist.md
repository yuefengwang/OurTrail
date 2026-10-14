# UI 交付与审查清单（按证据层组织）

**用法**：先按 SKILL.md §2 定模式，再选档。M3 只读审计跑 T1–T4（T5–T7 记"未执行"）；M1/M2 至少 T1–T4 + 任何结构/样式改动后的 T5 或 T6；M4 就是 T5–T7 本身。
**铁规矩**：任何一档没跑就写 `NOT_RUN`，跑不动写 `INCONCLUSIVE` / `ENV-ABORT`。**不许把未执行的检查标通过**，也不许把 T1 的通过写成"界面正常"。

每行的三段含义：**对象**＝要看的东西；**判据**＝怎样算过；**证据**＝交付时要留下什么（行号 / 命令 + 退出码 / 截图路径 / DOM 读数）。

## T1 静态代码审查（无需运行，可复核）

| 对象 | 判据 | 证据 |
|---|---|---|
| 全局静态门 | `node tools/check.js` 与 `node tools/check-handlers.js`（可加页名只测一页）均 exit 0 | 命令 + 输出末行 `ALL CHECKS PASSED` |
| 新组件作用域 | 引用了全局类的组件有 `options: { styleIsolation: 'apply-shared' }`，且 `options` 键在该 `Component()` 内只出现 1 次 | `file:line`；`grep -c "^\s*options:"` ≤1 |
| 具名 slot | 用了 `<slot name=…>` 的组件必须 `multipleSlots: true` | wxml 行号 + js 行号 |
| 组件注册 | 组件在**页面 json** 用根绝对路径注册；WXML 里出现的自定义标签都已注册（`check.js` 步骤 5 与 5b 正反双向） | 页面 json 行号 / check.js 退出码 |
| 新页面注册 | 四件套齐全 + 已进 `app.json` `pages`；若是 tab 页，`tabBar` 与本页 wxss 的底部留白都要在 | `app.json` 行号 + 页 wxss 行号 |
| handler 解析 | 所有 `bind*/catch*` 指向存在的 handler（含工厂造出来的） | `check-handlers.js` 输出 |
| 状态词单源 | 页面 JS/WXML 里没有新打的中文状态词字面量；WXML 不比较服务端枚举原文（改读布尔） | `journey-graph-test.js` 退出码（**唯一常驻门**） |
| 提交路径 | 写命令走 `api.dispatchAndSync(payload, this.revision, this)`；裸 `dispatch` 必须能写出"本页不再展示刚改的数据 + revision 链自行推进"的理由（现存唯一合法例：`pages/signup/signup.js:378`） | 调用点行号 + 例外说明 |
| revision 契约 | `this.revision/now/view` 是实例属性、不进 `data`；每次读写后刷新 | 页 js 行号 |
| 溢出与数字 | 长文本 `word-break`/省略；时间里程人数用 `.tabular` | wxml/wxss 行号 |

## T2 设计系统一致性

| 对象 | 判据 | 证据 |
|---|---|---|
| 复用优先 | 新写的类/色/字号在 `app.wxss` 或 `design-system.md` 里没有等价物（全局搜过） | 搜过的类名清单 |
| 颜色 | 组件与页面 wxss 不出现新的色字面量；`var(--x, #literal)` 兜底与注释不计；tab-bar 是唯一允许的字面量区 | 行号；新语义色已进 `app.wxss` 并登记 `design-system.md` |
| 已知债不扩大 | 不新增 `home/discover/weather/activity/overlay` 那类字面量副本（清单见 `design-system.md` §现状色值债登记） | diff 内 0 新命中 |
| 天相/图表配色 | 改 `MARK_STYLE` 同步 `sky.js` `hourMarks` + `space-time/layout.js`；画布字面量带 `// = --token` 注释 | 三处行号；`weather-page-test.js` 交叉核对退出码 |
| 对比度 | 正文对 ≥4.5:1、描边 ≥3:1；`--muted` 不再调淡；色块上文字用 `inkOn()` 判 | 配对计算或引用 `layout.js:106-113` |
| 触控与节奏 | 新可点主目标引用 `--touch-target`/`--action-height`；纵向用 `.stack` 而非随意 margin | 行号；豁免要写理由 |
| 座位网格 | 仍是 4 座 + 1 过道，宽度表达式未回退成 `25%` | `app.wxss:406/:425` 或页面覆写行号 |

## T3 交互与状态

| 对象 | 判据 | 证据 |
|---|---|---|
| 四态 | denied / loading / empty / error 齐备，用 `<status-panel>`；empty 的 detail 说明"为什么空 + 下一步"。纯静态页（`staff`/`privacy`/`cloud-field-poc`）可豁免并写明 | wxml 行号；豁免说明 |
| denied 有出路 | 拒绝态屏上有重试或返回出口（`journey-graph-test.js` 查这条） | 行号 / 门退出码 |
| 六态之 offline 与 submitting | 离线/超时走 `<status-panel kind="offline">` 或兜底横幅；`busy` 期间不可重复触发 | 行号 + 触发路径 |
| 禁用三层 | `.disabled` + `bindtap` 置空 + handler 守卫，三者一致 | 三处行号 |
| hover | 所有可点元素 `hover-class="button-hover"` | 行号 |
| 危险操作 | 入口为文字/次要样式 → `overlay kind="dialog"` 确认 → 需后果处自陈影响范围 → 需要原因则必填。**确认弹窗内的红实心是允许的** | wxml 行号 |
| 键盘与格式 | `number/digit/nickname` 正确，placeholder 说明格式 | 行号 |
| 失焦自动保存 | 成功与失败都有反馈（toast + 状态行），失败不静默 | 行号 |
| 面板间失效 | 宿主页绑定 `bind:written` 并重键 `sync-key`，否则兄弟面板必撞 CAS CONFLICT | 页 js 行号 |

## T4 视觉层级与信息密度（可静态判的部分）

| 对象 | 判据 | 证据 |
|---|---|---|
| 主任务 | 一句话说得清，且首屏有推进路径 | 写在交付说明里 |
| 层级 | 强调靠字重/颜色，不靠放大字号；字重四档（400/500/600/700 仅 page-title） | wxss 行号 |
| 卡片预算 | 单对象详情 ≤2 张同级卡；≥5 张同级且无 section 分级 ⇒ 记发现（现存：`me` 9、`route` 8、`editor` 11 且嵌套） | 行号区间 + 计数 |
| 主按钮预算 | 一屏一个"唯一推进动作"；互斥分支/弹层各算一次并能指认互斥证据 | 行号 + `wx:if` 条件 |
| 边框叠用 | 容器不同时具备边框与底色差 | wxss 行号 |
| 空态控件 | 空态下隐藏无功能的筛选项/分段 | wxml 条件 |
| `label: value` | ≥3 行同构罗列 ⇒ 合并进值或降为次级文本 | 行号 |
| 重复句 | 同一说明不在多行重印，上提为区块说明一次 | 行号 |

> T4 里"看起来挤不挤"属主观，按 `audit-verification.md` 的 E4 处理：可写建议，不计缺陷数、不定严重度。

## T5 渲染截图视觉审查

- [ ] 环境记录：工具与基础库（3.8.12）/ WebView 渲染 / 视口宽度（375·390·414）/ 数据来源（真实云端或注入 + 载荷与生产字段对照）——缺任一项则截图不作数（模板 `audit-verification.md` §5）
- [ ] bundle 新鲜：改过代码后 `close`+`open` 重编译再截图，且新鲜度可自证（新文案出现在屏上，或 `SYNC.md:560` 的 `bundleFresh` 探针）
- [ ] 门槛链先断言再截：例如天气页需 `denied=''`、`loading=false`、`loadingWeather=false`、`dayCards.length>0`、`unified!=null`、`oiCard!=null`；不满足就是元素根本不在 DOM 里
- [ ] 多用例打穿缓存：每例 `reLaunch` + 不同 `updatedAt`，两例读数必须互不相同，相同则整批判**无效**并移入 `invalid/`（不删除、不重跑充数）
- [ ] 逐条判读写清依据：叠压/截断/重叠/对比度结论要指到具体元素与其 `wx:if` 条件（注意 T1 的 `.timeline-card` 兜底块陷阱）
- [ ] 自动化截图不等于判据：`tools/e2e-ui-test.js` 的截图明文"仅作 Evidence"（`:25/:990`），默认落在仓库外临时目录
- [ ] 三档宽度都要覆盖的元素（图表标签、图例、长文案行）分别截图，命名含宽度

## T6 开发者工具 / 自动化交互验证

- [ ] 一条 UI PASS 必须由**一次真实 tap/input + 它的后果观测**构成（`docs/e2e-mp/automation-playbook.md:188`，实现 `tools/e2e-result.js:87-100`）
- [ ] 观测后果用对象自身状态读数（`planOpen` / `planChanged.length` / `busy` / `el.text()`），**不用元素数量、不用同名泛指元素**（铁律 21）
- [ ] `data` 读数不是像素证据：需要"用户看得见"的结论必须有 DOM 文本或截图（铁律 32⑥a）
- [ ] 门槛不过 / 通道退化 ⇒ INCONCLUSIVE（exit 2），**永远不是 PASS**；无开发者工具那台机器记 ENV-ABORT
- [ ] 驱动脚本放仓库外运行（本仓库零 npm 依赖是铁律），路径含中文或空格时按 `docs/e2e-mp/README.md` 的调用形态
- [ ] 会话僵死（`cli auto` 挂起、端口从不 LISTENING）按 playbook 恢复；`quit`/`close` 会动共享会话，须先获负责人授权
- [ ] 跑完 `disconnect`，不留悬挂会话

## T7 真机专项（模拟器测不到的）

- [ ] 底部安全区与 tabBar 遮挡（列表末行 + 删除按钮可点）
- [ ] 系统字体放大后的断裂（一行多标量的行、按钮文案、图例）
- [ ] 真机内核下的 WXSS 表现（本项目未证实 `color-mix()`/`dvh` 等，若新代码用到必须先验）
- [ ] 原生 `map` 的圆角与同层渲染降级（低版本基础库圆角失效是接受项，但**不许在 map 上叠普通 view**）
- [ ] 键盘类型与 `nickname`/`chooseAvatar`/`getPhoneNumber` 的真实弹授权流程（隐私声明缺失会直接报 scope 错）
- [ ] 弱网/超时：写操作结果未知时**只重读不自动重发**（铁律 24），读操作才允许自动重试
- [ ] 云函数改动后部署核对：`cloudfunctions/` 有改动就必须重新部署 `trailApi`，并复核云端超时是否仍为 20 秒（控制台值是唯一权威，CLI 部署不继承）
- [ ] 深色模式：本项目实测无 `darkmode` 配置 ⇒ 真机深色下页面仍走浅色是预期，别当 bug 报，也别自行加 `@media (prefers-color-scheme)`

## T8 回归与登记

- [ ] 涉及 domain/投影：`node cloudfunctions/trailApi/smoke-test.js`；动过 `cloudfunctions/trailApi/domain/*` 或 `store.js`：`node tools/sync-lab.js` 后跑 `node tools/lab-dryrun-test.js`
- [ ] 受影响页面的 T1–T4 全跑，T5/T6 至少一项（结构或样式改动过就必须有一档运行时证据）
- [ ] `SYNC.md` 变更日志登记（含根因与测试计数），动云函数标「需重新部署 trailApi」
- [ ] 多 Agent：改动清单与发现分列；他人文件未改（`git status` 复核）；争议项保留并注明双方证据档

## 最小必跑（一页改动的底线）

```bash
node tools/check.js && node tools/check-handlers.js <页名>
node tools/journey-graph-test.js          # 状态词与页面图闭合
# 涉及 domain/投影再加：
node cloudfunctions/trailApi/smoke-test.js
```

**这套门只覆盖 T1 的一小部分**（apply-shared、色值、四态、触控、token 登记都没有闸门）——其余判据靠本清单逐条核。

> 出处说明：T4 的分层判据沿用本项目自写的可执行规则（历史上署名"refactoring-ui 诊断表"）。`refactoring-ui` 与 `design-system` 属用户级安装的 skill，**不在仓库里**，任何 agent 不得把它们的内容当作本清单的依赖或据此改判；署名只作来源凭证保留。
