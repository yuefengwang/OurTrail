# Style B · Slice 5 真机回读报告（2026-10-26，IDE 模拟器）

覆盖 5a / 5b / 5c 三批的像素与计算样式回读。帧文件分散在各批的 `device/` 目录里，本报告是唯一索引。

## 1. 环境与有效性前置

| 项 | 值 |
|---|---|
| 通道 | 微信开发者工具服务端口 33278；自动化 `ws://127.0.0.1:9441`（新绑，端口进入 LISTENING 后才驱动） |
| bundle 新鲜 | 经负责人授权 `cli close --project 'D:\OurTrail'` → `cli open` 重编译（**没有 `quit` IDE**）。新鲜度**由屏上事实自证**：`.card.rows` 这个类只存在于 5a 之后的代码，且其计算值 `padding-top = 4px`（A1/A2） |
| 视口 | 390 宽（由几何反算：卡 left 20 + 卡宽 350 + 20 = 390；`.page` 左右各 20px）。**375 / 414 本轮未驱动** |
| 数据 | **全部真实数据**，不是注入世界：`me` 已激活、统计 131 / 119 / 293、常用同行人 85 条、路线库 299 条、编辑器有真实日程（泰安古镇 / 白云寺 / 五龙沟）、`lab` 有真实 [预演] 活动 |
| 写操作 | **零**。全程 `reLaunch` / `setData` / 元素读数 / 截图，没有点过任何提交类按钮，没有 dispatch 任何命令 |
| 帧内容注意 | 因为是**真实账号**，`A-me-freshness.png` / `B-me-companions-personrow-longname.png` / `V1-me-personrow-scrolled.png` 里能看到本机昵称、头像首字与「我的协作码」前缀，`V2-routes-row-scrolled.png` 里是真实路线名。**结构化读数已复核：手机号 0 处**（四份 `readings*.json` 全扫）。入库前若要抹掉昵称/协作码，说一声，我用打码帧替换——默认按仓库既有惯例（历次真机证据同样含本机账号界面）保留 |
| 注入 | 只用于把"断词分支"和"组件行"逼到屏上（`companions` 2 条、`form.points` 1 条），载荷取页面**当前真实 data** 回填，不手拼半截对象 |

## 2. 读数（18 条，全 PASS）

### 5a —— `.card.rows` 与 `<person-row>`

| # | 读数 | 值 |
|---|---|---|
| A1/A2/A3 | `.card.rows` 在屏 + 计算 `padding-top` = **4px** + 旧内联 `[style*="4px"]` 命中 **0** | 帧 `A-me-freshness.png` |
| B1 | 渲染门槛链成立（`stack-sections` 在屏、`denied=false`、`loading=false`、真实同行人 85） | — |
| B2 | 注入 2 条 ⇒ `.person-row` **2 个**、`.person-name` 2 个 | 帧 `V1-me-personrow-scrolled.png` |
| B3 | 姓名计算 `font-size` = **16px**（组件档，不再是本页私有的 14px） | — |
| B5 | 头像实测宽 **44px**（36px 私有小头像确实消失了） | — |
| B4 | 80 字无空格拉丁串：姓名盒 `left 93 + width 260 = 353` ≤ 卡右沿 `20+350 = 370` ⇒ **没溢出** | — |
| B6 | 长名行高 **158**、短名行高 **120** ⇒ 两读数不同，折行真的发生（污染自证） | — |
| C1/C2/C3 | loading / denied / empty 三态各有 `status-panel`，空态文案是解释过的（「还没有同行记录 / 从首页的「发现活动」开始」） | 帧 `C1-*.png` `C2-*.png` `C3-*.png` |
| D1 | 编辑器第 3 步分区标题由 `.row-title` 承担，文本 `简介与推荐理由（可选）` | 帧 `D1-*.png` |

### 5b —— `.metrics.compact` 与 `.row-title` 的断词

| # | 读数 | 值 |
|---|---|---|
| E1 | 路线库指标行走 `.metrics.compact`，**299 条真实路线** | 帧 `E1-*.png` |
| E2r / E2r-b | 每行 3 格，格间实测 **11.66px**（= `.metrics` 的 12px gap），**同行无压叠**、**全部在容器内**（容器 314 宽） | 帧 `E2r-*.png` `V2-routes-row-scrolled.png` |
| E2r-c | `.metric-value` 计算 `font-size` = **18px**（= `--text-title`，不是全局 26px）⇒ 单源类在真机解析对了 | — |
| D2r2 6/6 | 节点行按**文本反查**命中；计算 `overflow-wrap` = **anywhere**；长名盒 316×**44**（两行）不越卡沿（37+316=353 ≤ 370）；短名盒 70×**22**（单行）⇒ 长短差异来自断词，不是选择器抖动 | 帧 `D2r2-*.png` `V3-editor-node-scrolled.png` |

### 5c —— lab 的两处类名替换

| # | 读数 | 值 |
|---|---|---|
| G1 | 预演页 `.row-title` **7 个**，文本含真实活动标题 `[预演] 状态矩阵E2E-7cm7` 与各阶段卡标题 ⇒ 改过的两处确实在屏 | 帧 `G1-lab-rowtitle.png` |

## 3. 本轮撞到并修掉的**两个探针缺陷**（不是页面缺陷，但必须记）

1. **E2 跨行比** —— 第一版把"本行最后一格"与"下一行第一格"拿来判压叠（299 条路线 ⇒ 每行的第一格都回到 left 56，必然"压叠"）。
   报红 1 条。修法是**只比 `top` 相同的兄弟**，重测 3 条全 PASS。页面从头到尾没问题，错在尺。
2. **D2 量错对象 + 夹具没走到那一支** —— 第一版只断言"屏上有一个 `.row-title`"，量到的是别处行标题（宽 56）；
   真节点行套在 `<block wx:if="{{routeDetailsOpen}}">` 里（`editor.wxml:233`、`editor.js:849`），我只回填了 `form.points` 没打开这一支。
   第二版仍失败（`matched=""`，这恰恰是真话），第三版**显式 `routeDetailsOpen: true` + 按长名文本反查 + 短名阴性对照**才成立。
   这是铁律 34⑥ 的第三次现形：**缺输入/条件分支类断言，必须先证明被查那一支真的在屏上**。
   被作废的 3 张帧隔离在 `style-b-slice5a-2026-10-26/device/invalid/`。
3. 另有两处工具事实：`mp.pageScrollTo` 要传**数字**（传对象静默不滚，第一版 V1/V2/V3 三张帧与首屏逐字节同形，靠"字节数变了"才确认滚动生效）；
   该 automator 版本**没有** `element.screenshot()` ⇒ 元素级帧只能用"滚到目标再截整屏"。

## 4. 一处被真机推翻的自估数字（5a §2）

5a 写代价时我估"行高从 ≈72px 增到 ≈100px，每位同行人多 ≈28px"。**实测短名行 120px、长名行 158px**
⇒ 真实增量是 **+48px/行**（85 条同行人 ⇒ 列表长度差 4 公里级别，不是 2 公里）。
估算偏低一半，原因：漏算了 `.person-row__actions` 的 `margin-top:8px` 与按钮自身的 `min-height`。
这条改判了 Q3 的量级 —— 见 §5。

## 5. 仍未证的（不要把这份报告读成"全绿"）

| 缺口 | 状态 | 缺什么才能证 |
|---|---|---|
| `weather-chart` 的 `.fc-modes .seg ≥ 44`（5b C4 的像素项） | **NOT_RUN** | 该页数据来自跨页总线、无独立入口；要从天气页真实点进全图（含横屏姿态） |
| 375 / 414 两档宽度 | **未驱动** | 换视口重跑同一批读数（本轮只 390） |
| 真机（非 IDE 模拟器） | **未做** | 需要真机预览；模拟器内核与用户端可能不同 |
| `route` 详情页的 `.row-title`（节点名/天气行名） | **未单独驱动** | 需要一个真实 routeId 的进入路径（本轮只证了 routes 列表与 editor） |
| 同行人 85 条时"编辑/移除各占一行"的读感 | **有帧、无判读结论** | 属产品判断，交负责人看 `V1-me-personrow-scrolled.png` 裁决（Q3） |

## 6. 复现

```bash
# 前置：开发者工具已开服务端口 33278 且已扫码登录；驱动脚本必须放在仓库外的 mp-auto 目录
"C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" close --project 'D:\OurTrail' --port 33278
"C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" open  --project 'D:\OurTrail' --port 33278
sleep 30
"C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" auto  --project 'D:\OurTrail' --auto-port 9441 --trust-project --port 33278
cd %LOCALAPPDATA%\Temp\opencode\mp-auto
node drive-slice5-2026-10-26.js        # A/B/C/D1/E1 + 污染自证
node drive-slice5-fix-2026-10-26.js    # E2r（同行比）+ D2r（按文本反查）
node drive-slice5-node-2026-10-26.js   # D2r2 节点行断词（routeDetailsOpen + 长短双向）
node drive-slice5-visual-2026-10-26.js # V1/V2/V3 滚动后整屏帧
```
四份脚本与四份原始日志在本目录 `tools/` 下；结构化读数在各批 `device/readings*.json`。
