# 天气模块 Stitch 设计资产（统一入口）

本目录是 **OurTrail 天气模块 Google Stitch 原型的唯一入库入口**。它只存放「设计参考物」，
不是设计系统本身，也不是实现代码，更不是已裁决的设计基线。

- 设计系统与 token 的权威出处仍是 `miniprogram/app.wxss` + `.agents/skills/ourtrail-ui/references/design-system.md`。
- 现有实现位于 `miniprogram/pages/weather/` 及其依赖的 `components/`、`utils/`。
- 这里的 HTML/PNG **只是原型证据**，不能当作规范、不能当作数据来源、不能当作"已完成的界面"。

## 层级

```
design-references/stitch/weather/
├── README.md            ← 你在这里：总入口（版本一览、使用规则）
└── <YYYY-MM-DD>/        ← 一次导入 = 一个不可变快照
    ├── README.md        ← 快照说明（来源、完整性、边界）
    ├── manifest.json    ← 机器可读清单（文件、SHA-256、页面 ID、外部依赖）
    ├── SCREEN_INDEX.md  ← 逐屏索引（可点击链接、状态、对应实现位置）
    ├── DESIGN_CONFLICTS.md ← A 事实 / B 现状 / C 差异 / D 待裁决
    ├── ASSET_AUDIT.md   ← 外部依赖与可移植性
    ├── VERIFICATION.md  ← 本轮完整性校验的实际输出
    ├── raw/             ← 原始文件，逐字节未改动
    └── source/*.zip     ← 原始 ZIP（若导入时有）
```

查找顺序固定为：**总入口 → 版本快照 → 页面索引 → 具体资产**。不要跳过层级直接引用某张 PNG。

## 版本一览

| 快照 ID | 日期 | 模块 | 页面数 | 状态 | 入口 |
|---|---|---|---|---|---|
| `stitch-weather-2026-10-30` | 2026-10-30 | weather | 11 | 未裁决（snapshot-unratified） | [2026-10-30/README.md](2026-10-30/README.md) |

后续版本的规则：**新增日期目录，不覆盖旧快照**。任何"最新版"的判断都必须出自
`SCREEN_INDEX.md` / `DESIGN_CONFLICTS.md` 里显式写下的裁决，而不是目录名或文件日期。
本仓库当前**没有任何**被确认为实施基线的 Stitch 版本。

## 状态词表

| 值 | 含义 | 允许的用途 |
|---|---|---|
| `confirmed` | 已由负责人裁决为实施基线 | 可作为视觉验收基准 |
| `candidate` | 可能是某一页/某一状态的对应物，但没有官方或负责人确认 | 只能作为参考，不能作为验收基准 |
| `iteration` | 同一屏族内的另一版尝试 | 参考 |
| `unresolved` | 版本关系或适用性尚未裁决 | 默认值；引用时必须写明"未裁决" |

当前所有页面均为 `unresolved`。关系字段（`relations`）里的 `confidence` 只区分
`observed`（可直接从内容观察到）与 `candidate`（推断，未经确认）。

## 引用规则

1. 一律使用**仓库相对路径**，例如
   `design-references/stitch/weather/2026-10-30/raw/ourtrail_v16_2/screen.png`。
   禁止在文档、代码、提交信息里写以个人主目录开头的绝对路径（本机路径换台机器就失效）。
2. 引用某屏时，同时给出它的稳定 ID（`ourtrail_v16_2`）与 `manifest.json` 中的路径，
   不要只贴图片。
3. 谈"设计意图"必须标明出处是 **DESIGN.md** / **HTML 主题** / **PNG 像素** 中的哪一个——
   三者在本批资产里互相矛盾，见 [DESIGN_CONFLICTS.md](2026-10-30/DESIGN_CONFLICTS.md)。
4. 谈"当前实现"必须给出仓库文件路径，不能引用原型截图代替阅读代码。
5. 原型里的数值、地名、气象结论都是**演示数据**，不得写进业务代码或用户文案。

## 与其它目录的分工

| 位置 | 是什么 | 能不能改 |
|---|---|---|
| `design-references/stitch/weather/**` | Stitch 原型快照（只读参考） | 只允许新增快照或修文档，不改 `raw/` |
| `docs/prototypes/ourtrail-app/` | 冻结的 React 设计规范（另一套历史参考） | 冻结 |
| `docs/superpowers/specs/2026-10-30-weather-stitch-redesign.md` | 上一轮实施记录（历史文档） | 只加前向指针，不改写历史 |
| `.agents/skills/ourtrail-ui/` | 现行 UI 规则与设计系统说明 | 按规则维护 |
| `miniprogram/app.wxss` | 现行 token 单源 | 按设计系统流程修改 |

## 校验

```bash
node tools/design-assets-check.js
```

它核对：文件数与 manifest 一致、逐文件 SHA-256/尺寸、HTML↔PNG 成对、
Markdown 本地链接可解析、ZIP 与 `raw/` 逐文件一致、`DESIGN.md` 未被改写、
天气生产代码零改动、所有资产已被 Git 跟踪、文档中无个人目录绝对路径。
