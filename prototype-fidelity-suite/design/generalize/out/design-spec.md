# 社区图书借阅 · 设计规格

由 `design-dna-generalizer` 从知识库 `ourtrail-design-dna`（revision 128）生成。
本页家族：未声明（只允许全局规则）。

功能 4 项：已取证选型 1、未取证 3；交互契约 1/2。

## 1. 信息架构

| 序 | 区块 | 表面 | 承载功能 |
|---|---|---|---|
| 1 | 页头 | header | 显示书名与借阅点 |
| 2 | 查找 | content | 按书名筛选 |
| 3 | 在架图书 | content | 浏览在架图书 |
| 4 | 操作 | footer | 借阅这本 |

顺序取自业务给出的 `sections`，不取自任何原型屏。

## 2. 组件选择

| 功能 | 角色 | 形态 | 出处 | 依据 |
|---|---|---|---|---|
| 显示书名与借阅点 | text | **未选型** | — | 全库没有可用于本页的该角色形态 |
| 按书名筛选 | text | **未选型** | — | 全库没有可用于本页的该角色形态 |
| 浏览在架图书 | list | **未选型** | — | 全库没有可用于本页的该角色形态 |
| 借阅这本 | button | `button > span` | `component.button-span` | 库里 16 个实例里最常用的 "button" 角色形态 |

## 3. 布局规划

- `head`：header 面，纵向堆叠，第 1 位
- `search`：content 面，纵向堆叠，第 2 位
- `shelf`：content 面，纵向堆叠，第 3 位
- `actions`：footer 面，纵向堆叠，第 4 位

绝对间距没有测量证据（知识库里没有间距阶），因此原型只用相对单位；间距留给实现按 token 补，不在此处编造数值。

## 4. 交互设计

- `confirm-dialog` ← `interaction.dialog-sheet`（global）：`{"role":"dialog","ariaModal":"true","focusable":"tabindex=\"-1\"","hiddenBy":"由外层 overlay 的 hidden 控制显隐，关闭态不得命中点击","observed":3}`
- `status-feedback`：**没有可用契约**（全库没有本页可用的该契约）

## 5. 设计决策与规则引用

- **D-color** 色板只用库里的 7 个全局颜色变量，不新造色值（`token.var.green`、`token.var.green-bright`、`token.var.green-soft`、`token.var.ink`、`token.var.line`、`token.var.muted`、`token.var.pale`）
- **D-type-scale** 字号从既有阶里取（10px / 11px / 12px / 13px / 16px / 17px / 9px），不新增字号（`token.size.10px`、`token.size.11px`、`token.size.12px`、`token.size.13px`、`token.size.16px`、`token.size.17px`、`token.size.9px`）
- **D-radius** 圆角只用库里量到的 5 个值（18px / 3px / 4px / 50% / 9px），不新造圆角（`token.radius.18px`、`token.radius.3px`、`token.radius.4px`、`token.radius.50`、`token.radius.9px`）
- **D-component-04** 1 处功能沿用 `button > span`（`component.button-span`）
- **D-confirm-dialog** confirm-dialog 按库里观测到的契约实现（interaction.dialog-sheet）（`interaction.dialog-sheet`）
- **D-tap-target** 可点区高度中位数 46px；3/45 个 <31px，16/45 个 <44px（`principle.tap-target`）
- **D-hairline-separation** 区块分隔主要靠 1px #e8ece7 上边框（13 处），阴影 4 处只用于外壳与浮层（`principle.hairline-separation`）
- **D-type-hierarchy** 字号阶 32px×1 / 25px×1 / 24px×4 / 21px×1 / 19px×1 / 18px×4 / 17px×14 / 16px×37 / 15px×6 / 14px×5 / 13px×35 / 12px×35 / 11px×52 / 10px×46 / 9px×5；5 处 <10px（`principle.type-hierarchy`）
- **D-icon-stroke** 图标为内联 SVG 描边（63 个），主流形态 1.8px/outline/round（39/63）（`principle.icon-stroke`）

## 6. 缺口（必须由人或实现补齐）

- `ROLE_UNRESOLVED` @ `head/show-title`：全库没有可用于本页的 "text" 形态：component.span-row-body：只在 activity-list 上量到；那是那一屏自己的排版，不是可复用的约定；component.span-row-body-h3：只在 activity-list 上量到；那是那一屏自己的排版，不是可复用的约定；component.p-row-route：只在 activity-list 上量到；那是那一屏自己的排版，不是可复用的约定；component.button-small：只属于 activity/weather 族；本页未声明家族，不按家族规则处理；component.div-solar-event-time：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.div-weather-section-heading-h2：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.span-stop-time-small：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.span-stop-body：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.small-stop-note：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.p-chart-note：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.p-time-hint：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定
- `ROLE_UNRESOLVED` @ `search/filter-books`：全库没有可用于本页的 "text" 形态：component.span-row-body：只在 activity-list 上量到；那是那一屏自己的排版，不是可复用的约定；component.span-row-body-h3：只在 activity-list 上量到；那是那一屏自己的排版，不是可复用的约定；component.p-row-route：只在 activity-list 上量到；那是那一屏自己的排版，不是可复用的约定；component.button-small：只属于 activity/weather 族；本页未声明家族，不按家族规则处理；component.div-solar-event-time：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.div-weather-section-heading-h2：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.span-stop-time-small：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.span-stop-body：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.small-stop-note：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.p-chart-note：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定；component.p-time-hint：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定
- `ROLE_UNRESOLVED` @ `shelf/list-books`：全库没有可用于本页的 "list" 形态：component.div-activity-list：只在 activity-list 上量到；那是那一屏自己的排版，不是可复用的约定
- `INTERACTION_UNRESOLVED` @ `interactions/status-feedback`：全库没有可用于本页的 status-feedback 契约

## 7. 被范围挡掉的规则

- 39 条：只在 weather 上量到；那是那一屏自己的排版，不是可复用的约定
- 20 条：只在 activity-list 上量到；那是那一屏自己的排版，不是可复用的约定
- 15 条：只属于 activity/weather 族；本页未声明家族，不按家族规则处理
- 11 条：只在 activity-detail 上量到；那是那一屏自己的排版，不是可复用的约定
- 5 条：只属于 activity 族；本页未声明家族，不按家族规则处理
