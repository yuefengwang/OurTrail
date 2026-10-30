# Stitch 天气原型快照 · 2026-10-30

- **资产集 ID**：`stitch-weather-2026-10-30`
- **模块**：weather
- **平台**：Google Stitch
- **Stitch 项目名**：`stitch_ourtrail_ui_optimization`
- **Stitch 项目 ID**：未知（导出物与 ZIP 内都没有可核验的 ID，按未知记录）
- **导入日期**：2026-10-30
- **状态**：`snapshot-unratified` —— 只登记"当时生成了什么"，**未裁决**任何页面是否为实施基线

## 这是什么

一次 Google Stitch 导出的原样入库。共 11 个屏族，每屏一份 `code.html` + 一份 `screen.png`，
外加一份独立的 `alexandria/DESIGN.md`。原始 ZIP 一并保留。

## 这不是什么

- 不是设计规范。规范仍是 `miniprogram/app.wxss` 与 `.agents/skills/ourtrail-ui/`。
- 不是实现。现有天气实现位于 `miniprogram/pages/weather/` 等处，见 [SCREEN_INDEX.md](SCREEN_INDEX.md)。
- 不是数据来源。原型里的气象数值、地名、结论全部是演示数据。
- 不是已完成的界面。**本轮没有做任何视觉重建，也没有做过"原型 vs 实机"的像素对照。**

## 来源与完整性

| 项 | 值 |
|---|---|
| 原始 ZIP 文件名 | `stitch_ourtrail_ui_optimization (1).zip` |
| ZIP 路径 | [source/stitch_ourtrail_ui_optimization.zip](source/stitch_ourtrail_ui_optimization.zip) |
| ZIP SHA-256 | `121621e74237f50ee45926d32b8e5bbe0ac20f26b42208e28c5c254ac0b3d1e6` |
| ZIP 字节数 | 5,053,393 |
| ZIP 条目 | 36（13 目录 + 23 文件） |
| 解压后总字节 | 5,475,222 |
| `raw/` 文件数 | 23 |
| ZIP ↔ `raw/` | **逐文件 SHA-256 完全一致** |

导入方式只有"解压 + 复制"：未编辑、未重新压缩、未重绘、未转码、未改文件名或相对路径。
`raw/` 下保留了原始层级（`alexandria/`、`ourtrail_*/code.html`、`ourtrail_*/screen.png`）。

## 逐文件清单

机器可读版本见 [manifest.json](manifest.json)（`files[]`：仓库相对路径、类型、字节数、SHA-256）。
摘要：

| 类型 | 数量 |
|---|---|
| `code.html` | 11 |
| `screen.png` | 11 |
| `DESIGN.md` | 1 |
| ZIP | 1 |
| **快照内文件合计** | **24** |

页面 ID 与目录名相同，稳定且唯一：`ourtrail_v7`、`ourtrail_v12_1`、`ourtrail_v12_2`、
`ourtrail_v14_72`、`ourtrail_72_v14`、`ourtrail_v16_1`、`ourtrail_v16_2`、`ourtrail_v16_3`、
`ourtrail_v18_1`、`ourtrail_v18_2`、`ourtrail_v18_3`。

> **目录名不是版本结论。** `v18` 不一定优于 `v16`，`v14_72` 与 `72_v14` 也不代表先后关系。
> 版本关系见 [SCREEN_INDEX.md](SCREEN_INDEX.md) 的 `relations`，且一律标注为观察或候选。

## 这份快照里已经能看见的三处冲突

细节与取证在 [DESIGN_CONFLICTS.md](DESIGN_CONFLICTS.md)，这里只列现象：

1. **HTML 主题与 PNG 像素不一致。** 11 份 HTML 的 Tailwind 主题都声明森林绿
   （primary `#00231a`、surface `#f9f9ff`），但 PNG 里 6 屏的主控件呈蓝色 `#094cb2`
   （v12_1、v16_3、v18_1、v18_2、v18_3，v7 为蓝色渐变），4 屏为绿色（v12_2、v14_72、v16_1、v16_2），
   1 屏混用（72_v14）。`#094cb2` 恰是 `alexandria/DESIGN.md` 的 Primary。
2. **`alexandria/DESIGN.md` 与所有 HTML 都不是一回事。** 它用 Noto Serif/Inter/Public Sans、
   "No-Line Rule"、80% 玻璃拟态；而 HTML 用 Hanken Grotesk/Manrope + 1px 边线。没有任何 HTML 引用 "Alexandria"。
3. **字体族与现行实现不同。** 原型是 Hanken Grotesk + Manrope；OurTrail 是系统字体栈
   （`-apple-system, …, PingFang SC, Microsoft YaHei`）。中文字形实际由系统字体渲染，原型 HTML 未内嵌中文字体。

本轮**只记录，不裁决**。三条都不构成"应该改成什么"的结论。

## 已知边界（使用前必读）

| 项 | 状态 | 说明 |
|---|---|---|
| 版本先后 / 最终版 | **未裁决** | 无官方说明，目录名不作依据 |
| Stitch 项目 ID | **未知** | 导出物中不存在 |
| 原型与实机的像素对照 | **未做** | 本轮禁止也不做视觉重建 |
| `ourtrail_v18_1/screen.png` 文案 | **不可用** | 截图文本乱码；以同目录 `code.html` 为准 |
| `ourtrail_v16_3` 截图宽度 | 784 px | 其余为 780 px，做比例归一化时需单独处理 |
| `ourtrail_v16_3` 天空带底图 | 外部 URL | `lh3.googleusercontent.com` 图片未随导出物提供，仓库内无字节 |
| HTML 离线可用性 | **不可离线** | 样式全部来自 Tailwind CDN，字体/图标来自 Google Fonts |
| 原型数据 | **演示数据** | 不得进入业务代码、文案或测试夹具 |

## 目录

```
2026-10-30/
├── README.md            ← 本文件
├── manifest.json        ← 机器可读清单
├── SCREEN_INDEX.md      ← 逐屏索引与实现对应
├── DESIGN_CONFLICTS.md  ← A 事实 / B 现状 / C 差异 / D 待裁决
├── ASSET_AUDIT.md       ← 外部依赖与可移植性
├── VERIFICATION.md      ← 校验实际输出
├── raw/                 ← 逐字节未改动
│   ├── alexandria/DESIGN.md
│   └── ourtrail_*/{code.html,screen.png} × 11
└── source/stitch_ourtrail_ui_optimization.zip
```

## 下一阶段怎么用（交接）

本轮交付的是**可被引用的资产**，不是设计决定。后续至少还有四步，均不在本轮范围内：

1. **基线裁决**：由负责人逐屏选定 `confirmed` 页面，并回答 [DESIGN_CONFLICTS.md](DESIGN_CONFLICTS.md) 的 D 段问题
   （尤其"蓝还是绿"、"DESIGN.md 是否作废"）。
2. **真实页面视觉重建**：按裁决后的基线改 `miniprogram/pages/weather/**`，走 UI Skill 的 M2 模式。
3. **独立视觉验收**：以本快照的 `screen.png` 作为对照基准（注意 v18_1 乱码与 784 px 两处例外）。
4. **功能 + 视觉双验收**：功能门禁仍以 `tools/*-test.js` 与真机驱动为准。

给下一个 agent 的最小指令：**先读本文件与 [SCREEN_INDEX.md](SCREEN_INDEX.md)，再读 [DESIGN_CONFLICTS.md](DESIGN_CONFLICTS.md)；
在负责人裁决之前，把这里的每一屏都当作"未裁决参考"，不要据此修改任何生产代码。**
