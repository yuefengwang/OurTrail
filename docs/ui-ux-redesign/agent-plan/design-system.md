# 设计系统映射（design-system）

权威源：`miniprogram/app.wxss`（164 个共享类、44 个自定义属性）+ `.agents/skills/ourtrail-ui/references/design-system.md`。
本文件只定义**交付包视觉语言 → 现有 token 的映射**与 **N1 新增的共用类契约**；不发明新色值（铁律 17）。

## 1. 目标语言 → 现有 token

| 目标视觉（A1/B/C 实测） | 现有 token / 类 | 备注 |
|---|---|---|
| 克制森林绿主色、绿底 CTA | `--forest` / `--success` / `.button.primary` | 不新增绿 |
| 白底 + 细分割线列表 | `--white` `--paper` / `--line` / `.hairline` `.divider` | |
| 摄影卡圆角 | `--radius-card`(14) | 新增媒体容器类复用之 |
| 状态 pill（进行中/已满/待审核） | `.badge` + `.badge.success/warning/danger/info/neutral`、`.badge.on-forest`（压照片时用） | 文案仍只来自 `format.js`/`journey.js`（铁律 22） |
| 指标行 16km/980m | `.fact-row` 或新增 `.metrics`（横排） | 数字用 `.tabular` |
| 大图 hero + 压底渐变 | `.hero` `.hero-cover` / `--scrim-hero` | 已存在，activity 在用 |
| 分段筛选 | 新增 `.seg` | 现有 home 用文字行，视觉升级 |
| 搜索框 | 新增 `.searchbar` | home/discover 已有 search 数据 |
| 底部固定 CTA | `.sticky-action` | 已存在 |
| 空/加载/失败 | `.callout.*` + `.muted` | 每页必须保留六态 |

## 2. N1 新增共用类契约（只增不改；零新色值；全部 var() 取色）

**盘点修正（2026-10-22 实施前实测）**：下列目标形态**仓库已存在**，禁止重复定义——
`.segmented/.seg/.seg.on`（app.wxss:409–436）、`.field/.field-label/.input`、`.filter-row/.filter-chip`、
`.hero/.hero-cover/.hero-cover-media`、`.badge.on-forest`、activity-card 的 `__media/__cover/__scrim/__thumb` 媒体形态
（封面来源 `utils/covers.js` 按活动 id 稳定选取的**场景氛围图**，非实拍，组件注释已自陈）。
⇒ N1 实际只新增两组：

```
.searchbar / .searchbar__input      图标内嵌圆角搜索条（--stone 底、--radius-button、高 36px）；
                                    .field/.input 保留给真表单，不互替
```

指标行**复用存量** `.metrics / .metric / .metric-value / .metric-unit / .metric-label`
（app.wxss:437–447，activity/route/me/tasks/workspace/transport-panel 六处在用，含 M-16 溢出处置）。
首版契约曾写 `.metrics__*` 平行体系，实施时被 G11 拦下（同选择器 `display` 双写）⇒ 已删，教训入 §9 登记。

导航栏浅色（拼板白底深字）不走 WXSS：`app.json` 在冻结集内，改**页面 json** 的
`navigationBarBackgroundColor/#F6F3EC` + `navigationBarTextStyle/black`（home/discover 各自 json，非冻结）。

约束：
- 新类一律写在 `app.wxss` 末尾「Night V1 共用类」分区，带一行用途注释；**不得**改存量 164 类任何声明。
- 组件内使用需 `styleIsolation: 'apply-shared'`（铁律 14）；`activity-card` 组件若改用新类须先确认其 options 键唯一（铁律 1）。
- 门禁：`swx1/swx2-style-gates`、`t4-e08`、`m02-class-scope`、G10 全绿才算过。

## 3. 明确不做
- 不改 tabBar 形态（4 tab，A2 明令）。
- 不给天气页/冻结集页面套新页头。
- 不引入评分圆环、收藏心形、5 槽 FAB（gap G-03/G-04/G-07/G-08）。
