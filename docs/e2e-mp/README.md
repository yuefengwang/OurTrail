# 真机端到端（e2e）驱动

配合 `AGENTS.md` 的「直连微信开发者工具：agent 端到端实现/测试闭环」一节使用。

> **要动手跑真机 E2E 之前先读 [`automation-playbook.md`](./automation-playbook.md)** ——
> 会话僵死怎么认、`quit` 与 `close` 的差别、旧句柄"点击成功但没作用"、`busy` 期间的空按钮、
> 一次性判读造成的假红、云函数部署与超时、退出码 0/1/2 的含义。全部是本机实测，不是通用文档转述。

## 为什么需要它

`tools/check.js`、`check-handlers.js` 与全部 `tools/*-test.js` 都**看不见像素**。
它们能证明代码跑得通、图元合法，但证明不了：

- 具名 slot 的内容到底显没显示（数据在 `data` 里，页面上是空的）
- 画布有没有浮在正文上（`type="2d"` 图层偏移）
- 文字会不会折行、颜色会不会糊成一片
- WXML 的 `wx:if` 门槛链有没有把组件挡在 DOM 外

本轮 P4 的 5 个真机 bug 里，**只有 1 个是逻辑正确性问题**，其余 4 个逻辑测试全都测不到。

## 结果语义（先读这条，否则读数会骗人）

`tools/e2e-ui-test.js` 的权威结论是 `==== VERDICT ====` 块，而不是 `passed=N`：

| 维度 | 证据来源 | 退出码 |
|---|---|---|
| BUSINESS | dispatch 信封 / read·readTransport·readExport·readForm 回读 / 领域不变量 | 0 全绿 · 1 确有失败 · 2 无法验证 |
| UI | 真实 `element.tap()` / `input()` + 后果观测（元素数量·class·文本·page.data·组件 data） | 同上（OVERALL 取两维较差者） |

硬规则：UI 的一条 PASS 必须先有一次成功的真实操作（`L.uiTap`/`L.uiInput`），其后的
`L.uEffect(...)` 才算用户路径证据；不依赖操作的纯渲染读数用 `L.u(...)`。云侧 fallback 代做
被测动作只能记 BUSINESS，UI 侧必须显式 `L.uiUnverified(...)`。门槛不过 / 通道退化 ⇒ INCONCLUSIVE，
**不是 PASS**。账本 API 在 `tools/e2e-result.js`，判别力自证在 `tools/e2e-fault-probe-test.js`。

## 真机新采到的三个坑（都已写进代码注释）

1. **`page.$(sel)` 恒返回单个 Element，`$$` 才给数组**（实测 `.card`：$=Element / $$=38）。
   按数组用 `$` ⇒ 查询恒空 ⇒ 历史所有 tap 静默不发生，而 `page.data()` 一切正常。
2. **具名 slot 的内容要按「宿主组件作用域」查**：`transport-panel` 弹层里的 `.list-row` 与
   「明确确认并提交此方案」按钮，从 `tp.$$` 查得到，从 `overlay` 元素往下查是 0 个。
3. **弹层有过渡，`data.sheetOpen` 立刻为 true 不代表子树已落位**：查控件前先 waitFor + 轮询，
   并以「所填文本是否落到组件 `data.note`」这类可验证后果确认命中的是目标控件。

顺带一条测试侧纪律：给 `String.replace` 传含 `$$` 的替换串会被吃掉一个 `$`，
`fp.$$'.textarea'` 会写成 `fp.$'.textarea'` —— 替换一律用函数形式 `s.replace(a, () => b)`。

## 三档手段的分工

| 手段 | 覆盖 | 需要 DevTools | 能进 CI |
|---|---|---|---|
| 纯逻辑测试 | 函数契约 / 阈值 / 边界 | 否 | 是 |
| `space-time-draw-test`（记录式 2D 上下文） | **真的执行 `draw()`**：图层顺序 / dpr / 色值 / 无 NaN 坐标 | 否 | 是 |
| **本目录的驱动** | 像素 / slot / 实际布局 / 文字折行 | **是** | 否 |

`multipleSlots` 那个 bug 就是被中间档放过的 —— 它数据全对，只是没画出来。

## 用法

依赖装在**仓库外**（本仓库零 npm 依赖是铁律）：

```bash
mkdir %LOCALAPPDATA%\Temp\opencode\mp-e2e
cd %LOCALAPPDATA%\Temp\opencode\mp-e2e
npm.cmd init -y
npm.cmd install miniprogram-automator
copy D:\OurTrail\docs\e2e-mp\drive.js .
# 改 drive.js 的配置区，然后：
node drive.js
```

PowerShell 下必须用 `npm.cmd`（执行策略拦 `npm.ps1`）。

一次性人工前置：开发者工具「设置 → 安全设置 → **服务端口开启**」+ 扫码登录。
详见 `AGENTS.md` 对应一节。

## 改完代码一定要重开项目

```bash
# ⚠ 路径必须加单引号：Git Bash 会把未加引号的 D:\OurTrail 吃成 D:OurTrail（驱动器相对路径），
#   开发者工具照它注册一个新项目并写进 last_compiled，此后每次编译都报
#   「app.json: 在项目根目录未找到 app.json」——见 SYNC.md 2026-10-09。
cli close --project 'D:\OurTrail' --port 33278
cli open  --project 'D:\OurTrail' --port 33278
cli auto  --project 'D:\OurTrail' --auto-port 9421 --trust-project --port 33278
```

只调 `auto` 不会重新编译，模拟器会用旧 bundle —— 这会让人误以为修复没生效。
本轮曾因此对着旧代码排查了很久。

## 截图怎么读

`screenshot()` 返回 base64 字符串，模板里已用 `Buffer.from(..., 'base64')` 解码。
解码后直接用读图工具看即可；`mp.screenshot()` 是**整个视口**，组件常在折叠线以下，
要先 `mp.pageScrollTo(n)`。

## 注意

- 注入的是**合成数据**：渲染路径是仓库真实代码，只有数据来源是假的。这正是逻辑测试覆盖不到的部分。
- 改完 WXML/WXSS/组件结构后，静态门禁通过**不代表**页面正常。跑一次这里才算完。
