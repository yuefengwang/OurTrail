# VISUAL_GAP_ANALYSIS — 设计目标 vs 实际表现（night-v2，2026-10-22）

四类分法按任务书 4.4。试点三页证据＝本夜 before/ 真实截图（真实云数据：notices 669 条 / anotices 1 条 / me 完整档案）；全站结论引用 night-v1 与 Wave 取证。

## 1. 总览图明确要求、且本轮可交付的效果

| 效果 | 区域 | 本轮处置 |
|---|---|---|
| 浅色导航（paper 底 + 黑字）与已重设计页家族一致 | 全站共性（1.1/3.x/5.x 屏均为浅导航） | **实施**：notices/anotices/me 三页 json |
| 个人中心＝头像 hero + 昵称 + 三格统计 + 分组菜单 | 8.2 | 现状已具备骨架（identity 卡 + metrics + C–H 分组卡）；本轮收敛层级：昵称升标题级字阶、撤回着 danger 语义色 |
| 通知＝卡片列表 + 未读强调 + 时间右置 | 8.1 | 现状 `.notice-card.unread` 森林左边线 + 徽标已承重；本轮对齐间距 token 类（去行内 gap）、保持同源 |
| 空/加载/失败/未登录/长文案六态 | 8.1/8.2 | 现状 status-panel 四态 + me onboarding 卡已具备；本轮补**注入态截图取证** |

## 2. 当前实现与设计意图的实际差距（试点三页，基线截图实测）

| # | 差距 | 实际表现（before/） | 目标 | 影响 | 修正 | 复验 |
|---|---|---|---|---|---|---|
| G1 | 导航bar 深绿默认态 | 三页顶栏 forest 底白字 | paper 底黑字（家族一致） | 中 | json 两键 | 待 after 截图 |
| G2 | me 昵称字阶低于标题级 | `.nick-input` 17px/600 | 18px（--text-title）与 page-title 同级身份感 | 低 | me.wxss 一字 | 待复验 |
| G3 | 位置撤回为中性文字色 | `.button text` forest | danger 语义色（T011 书）；交互不加确认（越界登记） | 低 | me.wxss 新类 + wxml 类名 | 待复验 |
| G4 | 列表间距走行内 style | notices/anotices/me 多处 `style="gap:12px"` | 全局类 `.stack-gap3`（同值 12px，去行内） | 低 | wxml 类替换（两页保持逐字节同源） | 静态门 + 截图 |
| G5 | anotices 单条时下方大片纸色空白 | before/anotices-top | 可接受（paper 底 + 无假内容）；不造填充 | 低 | 不修，登记 | — |

## 3. 总览图未表达、需结合业务设计的细节（本轮不动，登记）

- 未读徽标色相：现状 `badge.success`（绿）表"待处理"，与左边线 forest 双通道；总览图 8.1 用类型色图标，语义不同源 ⇒ 不混改。
- 669 条通知一次渲染：性能与分页策略需产品裁决（虚拟列表/分段加载），视觉层不动。
- me onboarding 卡位置：现状在身份卡之后（非模态引导）；总览图未画未激活态 ⇒ 保留。
- sheet 内表单层级：form-field 体系全站统一，不为单页改。

## 4. 当前缺少证据、不能贸然修改

- 拼板 8.1 顶部两枚 chip 的准确文案与行为（低分辨率不可辨）⇒ 不实现分段筛选，不编文案。
- 8.2 菜单六入口与「足迹」统计：无数据源/无功能 ⇒ 不造（铁律：缺数据不得印成有利事实的同族）。
- 天气五屏：冻结集 + 专图含仓库不存在能力 ⇒ 只记差异（G-02..G-05 继承）。
- 总览图所有精确像素/字重：缩略图不具尺寸效力 ⇒ 一律以 app.wxss token 落值。

## 5. 全站层面（继承，非本轮）

- night-v1 openDebts 6 条、discover filter-chip 34px、home/discover 双拷贝类 ⇒ 见 UI_AUDIT_REPORT §5。
- 已对齐区段：home/discover/activity/signup/editor/routes×3/workspace/vehicle/staff/tasks(json) 共 13 页有取证；天气线 3 页冻结；privacy 冻结。
