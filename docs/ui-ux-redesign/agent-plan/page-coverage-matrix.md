# 页面覆盖矩阵（page-coverage-matrix）

设计覆盖以 A1 拼板 21 屏 + B 长图文 + C 天气五屏实测核对；"当前实现"以本 worktree 源码 + D2 基线截图核对。
覆盖率不按拼板屏数算，按 **app.json 21 页**算：用户向 19 页（除 lab / cloud-field-poc）。

| 页面 | 拼板屏 | 专项图 | 当前实现状态 | 本夜任务 | 风险 |
|---|---|---|---|---|---|
| home | 1.1 | — | 文字列表、搜索已有、分段已有(filter)、无摄影卡 | **T002 (N2)** | 低 |
| discover | 1.2 / 1.3 | — | 搜索/筛选/地图已有（Wave1 落地） | **T003 (N3)** | 低 |
| activity | 1.4 | **B（12 段）** | hero+指标已有；长图文 ContentBlock 已有（10-21 落地） | T004（后续夜） | 中 |
| signup | 2.1 / 2.2 | — | 完整 | 后续 | 中 |
| workspace（含 2.3/5.2/5.3） | 5.1–5.3 | — | 完整 + panels | 后续 | 高（sync-key） |
| routes / route / route-edit | 3.1–3.3 | — | 完整（10-13 落地） | 后续 | 中（GPX 契约） |
| editor | 4.1–4.3 | — | 4 步 + 发布门 | 后续 | 高 |
| staff / vehicle | 6.1 / 6.2 | — | 完整 | 后续 | 高（现场触控） |
| tasks | **无设计** | — | 完整（10-20 落地） | 记差异 G-01 | — |
| weather-hub | 7.1 | C-1 | **冻结集** | **跳过（G-06）** | — |
| weather | 7.2 | **C-2..5** | 统一 meteogram+OI+沉默闸 | 记差异 G-02..G-05 | — |
| weather-chart | **无设计** | — | 横屏 SVG | 记差异 G-01 | — |
| notices / anotices | 8.1 | — | 完整 | 后续 | 低 |
| me | 8.2 | — | 完整 | 后续 | 低 |
| privacy | 8.3 | — | 静态长文 | 后续 | 低 |
| lab / cloud-field-poc | — | — | 开发页，A2 明确排除 | 不做 | — |

**覆盖结论**：用户向 19 页中 16 页有拼板设计、3 页无（tasks / weather-chart / anotices 仅 8.1 覆盖 notices）。
专项图 B 覆盖 activity 的 12 段结构；专项图 C 的 5 屏中 2 屏（概览/逐时）与现有能力对齐、3 屏含仓库不存在的能力（见 gap）。
