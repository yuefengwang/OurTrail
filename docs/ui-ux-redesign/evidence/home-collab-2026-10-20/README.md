# 首页「一个列表 + 卡片协作入口」真机核验（2026-10-20）

改动：删掉列表上方的裸 `.list-row` 任务区，协作动作下沉到 `activity-card`，筛选段加第四档「需要协作 N」。
设计与判据：`docs/superpowers/specs/2026-10-20-home-dual-list-dedup.md`；门 `tools/home-collab-list-test.js`（25）+ 变异 `tools/home-collab-list-mutate.js`（9 条 0 漏网）。

## 通道与前置

- 服务端口 33278、`islogin` 正常；自动化端口按轮次重绑 **9425 → 9426 → 9427 → 9428**（每轮改代码后 `close --project` → `open` → `auto`，未 `quit` IDE）。
- **一次真实的通道假可用**：`cli auto` 回了 `autoPort` 且 WS 能连上，但每条命令 10s 超时。IDE 日志给出根因
  `app.json: 在项目根目录未找到 app.json` —— 我用 `execSync` 走 cmd.exe 传 `'D:\OurTrail'`，**cmd 不认单引号**，
  于是注册出一个带撇号的假项目路径（AGENTS.md 记的是 Git Bash 吃反斜杠那个坑，同一族、换了触发方式）。
  改成双引号 `"D:\OurTrail"` 后模拟器正常启动，读数立刻出来了。
- bundle 新鲜度前置门：页面 `data` 里有 `collabCount` 且**旧数组 `tasks` 已不存在**（旧 bundle 一定带 `tasks: []`）。
- 设备：模拟器 **390×753**。

## 读数（`readings.json`，14 条判定全过）

| 用例 | 读数 |
|---|---|
| 真实数据（本机账号） | `collabCount=18`、`cards=151`、四档渲染为 `我的活动 / 最近查看 / 已结束 / 需要协作 18` |
| 真实数据点第四档 | 列表从 **151 场收缩到 18 场**，且 18 张卡**每一张都至少带一枚协作入口**；`.seg.on` 只有第 4 个 |
| A 双角色（受控） | featured 卡上「现场协作」「车辆联络」**两枚都在**，同一行（`top` 均为 752），每枚高 **48px** ≥ 44px 触控目标 |
| B 无授权（受控） | 第四档**整档不出现**（只剩三档），卡上零枚入口 |
| C 空列表（受控） | 空态正常渲染（截图 `05-C-empty.png`） |

截图：`01-real-home-top.png`（真实首屏）、`07-real-collab-tab.png`（真实第四档）、
`02/03-A-dual-role-featured.png`（双角色卡，03 为滚到卡处的整屏——这个 automator 版本没有元素级截图）、
`04-B-no-grant.png`、`05-C-empty.png`。

## 首轮真机抓到的两个缺陷（静态门与 Node 逻辑门全部放过）

1. **低对比**：协作入口原本用 `.button.text`（透明底 + `--forest` 深绿字），在 featured 卡的 `--forest-deep`
   深绿底上几乎不可读，箭头还是 `#163E35` 深色字面量。⇒ 改为与主入口同一套 `button leaf` 浅底深字，
   两种卡上都成立。
2. **逐枚竖排**：`.affordance-open { flex: 1 1 auto }` 让主入口吃掉整行，两枚协作按钮被挤成各占一行。
   ⇒ 主入口 `flex: 1 1 100%` 独占一行（与改前逐像素同形），协作入口包进 `.collab-row` 成组排第二行。

这两条已转成**机器读数**而不只是"看图发现了"：驱动现在记录每枚入口的 `top`（同卡必须同行）与
`class`（必须含 `leaf`），下一轮若有人改回透明底或改回 `flex: 1 1 auto`，判定直接红。

## 仍未证 / 留裁决

- **375px 未拍像素**：这个 automator 版本没有 `setViewport`（实测 `mp.setViewport is not a function`），
  换设备档位要动 IDE 图形界面。按 390 实测反推：一档文字需 **71px**，375 下等分只剩 **67px**
  ⇒ **推算**第四档标签会在按钮内换行（行高变两行，整段不会溢出，因为 `.segmented` 有 `flex-wrap`）。
  这是推算，不是像素证据。若要消掉，最短路径是把标签从「需要协作 18」改成「协作 18」，属一行改动，等裁决。
- **真机点击落页未测**：点「车辆联络」是否真的落到 `/pages/vehicle/vehicle`，本轮只测到 DOM 与几何；
  跳转逻辑由 `tools/home-collab-list-test.js` §5 与 `journey-graph` 的静态边覆盖。
- **视觉层级（可选打磨）**：featured 卡上现在最多三枚 leaf chip 叠排，主入口靠"整行"占优。
  若要更明确的主次，可把协作入口降为 `--leaf-on-forest` 底 + `--leaf` 字（同一张卡上那枚状态徽标已经在用这对
  token，可读性已被证明），只作用于 `.activity-card--featured`。本轮未擅自改。
