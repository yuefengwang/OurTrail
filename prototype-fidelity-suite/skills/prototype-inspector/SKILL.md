---
name: prototype-inspector
description: 把可运行的 HTML 原型变成可复核的捕获记录——页面清单、状态清单、每个状态的节点树/计算样式/截图，全部带来源与哈希。用于"先看清原型长什么样""这个页面有哪些状态"或保真验收的第一步；只读，不点击原型、不触发不可逆操作。
---

# prototype-inspector

把原型从「一页能打开的 HTML」变成「一份能引用的测量记录」。这一步不做判断，
只做取证：**看得到的写下来，看不到的写"没看到"，不许补**。

## 何时用

- 拿到一个可运行的原型，需要知道它有几个页面、每页有哪些状态。
- 保真验收需要"原型侧基线"截图与几何。
- 有人问「原型这里到底是什么样」而手边只有印象时。

## 硬约束（只读）

1. **不点击**原型里任何按钮/链接。状态通过 `pf.config.json` 里的 `inject`（执行一段
   设置状态的脚本）或 URL 参数进入，不靠模拟点击"走到"。
2. 不修改原型目录下的任何文件；捕获产物只写进项目目录的 `captures/`。
3. 不下载、不导航到外网；原型必须是本地文件。
4. 进入不了的状态**标 UNREACHABLE**，不要用"截个差不多的图"代替。

## 输入

| 输入 | 必需 | 说明 |
|---|---|---|
| 原型入口路径 | 是 | 本地 HTML；相对 `pf.config.json` 或绝对路径 |
| `frameSelector` | 建议 | 原型常带浏览器壳（状态栏/标题栏）；指定内容框，几何以它为原点 |
| `viewport` | 是 | 与目标设备一致，默认 `390×844` |
| 状态清单 | 是 | `pages[].states[]`；每个状态要么是 `real`，要么给 `inject` |
| 页面选择器 | 是 | 至少一个根选择器，否则节点树可能只抓到一个空 body |

## 依赖与前置

- Node ≥ 18（仓库零依赖；不要往仓库装 npm 包）。
- Playwright 在**仓库外**：`node cli/pf.js doctor` 显示 `playwright available` 才能跑。
- 原型能被 `file://` 打开并自行渲染完成（无后端依赖）。

## 步骤

1. `node cli/pf.js doctor` —— 三个 `available` 与端口状态先看清；不 available 就是
   BLOCKED，不要在缺工具的情况下"先写结论"。
2. 读原型的 HTML/CSS/JS，列出**屏幕**与**状态**（列表/空态/加载/错误/弹层）；
   写进 `pf.config.json` 的 `pages[]` / `states[]`。清单来自源码，不来自猜测。
3. 对每个状态执行
   `node cli/pf.js capture --project <dir> --page <id> --state <id> --side prototype`。
4. 打开 `captures/<page>/<state>/prototype/snapshot.json`，确认：
   节点数 > 0、根节点命中、每个关键选择器都有命中；没命中的记下来（这是后面
   UNVERIFIED 的来源，不是可以忽略的噪音）。
5. 把 snapshot 里的**实测值**（字号/行高/间距/圆角/颜色/盒模型）交给
   `design-contract-builder`；不要在这里做"设计意图"推断。

## 质量门

一条捕获只有在下列全部成立时才算 `captured`：

- `capture-manifest.json` 的 `verification: "captured"`，且截图 `sha256` 非空；
- `screenshot.size` 与磁盘 PNG 头一致；`screenshotScale` 已记录（原型侧应为 `1×1`）；
- `viewport`、`dpr`、`codeVersion`（git HEAD）三项都不为空；
- `dataSource: "real"`（用 `inject` 进入的状态会标 `injected`——这是合法的，
  但它从此**不能**当交互证据）；
- 至少一个根选择器命中，且节点数不为 0。

任一条不成立 ⇒ 该状态 UNVERIFIED / BLOCKED，**不得**进入后续判定。

## 失败处理

| 现象 | 处置 |
|---|---|
| `PLAYWRIGHT_MISSING` | 记 BLOCKED，给出 `doctor` 原文；不要改仓库依赖 |
| `FRAME_NOT_FOUND` | 原型可能未渲染完：先加 `waitForSelector`，仍失败则记 UNVERIFIED |
| 选择器 0 命中 | 记下选择器与所属 pair，后续状态记 UNVERIFIED；不要换一个"差不多"的选择器 |
| 状态只能靠点击进入 | 用 `inject` 复现数据；无法复现 ⇒ UNREACHABLE，写进 limitations |
| 页面有外链资源且加载失败 | 记录失败资源；截图仍可作版式证据，但图片缺失要点明 |

## 示例

```bash
node cli/pf.js doctor
node cli/pf.js capture --project examples/ourtrail \
  --page weather-hub-home --state real --side prototype
# prototype: 127 nodes · 390×844px (scale 1×1) · captures/weather-hub-home/real/prototype
```

## 与其他技能的关系

- 下游：`design-contract-builder`（把它变成声明的数据），`visual-fidelity-analyzer`
  （原型侧基线）。
- 上游：无。它是整条链的起点，可单独运行。
- 它**不写** `contracts/`、不做配对、不打分；那三件事各有其主。
