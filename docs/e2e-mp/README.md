# 真机端到端（e2e）驱动

配合 `AGENTS.md` 的「直连微信开发者工具：agent 端到端实现/测试闭环」一节使用。

## 为什么需要它

`tools/check.js`、`check-handlers.js` 与全部 `tools/*-test.js` 都**看不见像素**。
它们能证明代码跑得通、图元合法，但证明不了：

- 具名 slot 的内容到底显没显示（数据在 `data` 里，页面上是空的）
- 画布有没有浮在正文上（`type="2d"` 图层偏移）
- 文字会不会折行、颜色会不会糊成一片
- WXML 的 `wx:if` 门槛链有没有把组件挡在 DOM 外

本轮 P4 的 5 个真机 bug 里，**只有 1 个是逻辑正确性问题**，其余 4 个逻辑测试全都测不到。

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
cli close --project D:\OurTrail --port 33278
cli open  --project D:\OurTrail --port 33278
cli auto  --project D:\OurTrail --auto-port 9421 --trust-project --port 33278
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
