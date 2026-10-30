# 逐屏索引 · Stitch 天气原型（2026-10-30）

11 个屏族，一一对应 `manifest.json` 的 `screens[]`。所有链接均为**仓库内相对路径**
（相对于本文件所在目录）。页面 ID 与目录名相同。

> **没有任何一屏被确认为实施基线。** 下表"基线"一列全为「否（未裁决）」。
> "关系"一列只写可直接观察到的结构相似性，或明确标注为候选的推断；**不合并任何原型**。

## 总览

| ID | 页面 | 形态 | Tab | 基线 | HTML | PNG |
|---|---|---|---|---|---|---|
| `ourtrail_v7` | 天气页 · 云层剖面（早期深色版） | 独立页 | 云层剖面 | 否（未裁决） | [code.html](raw/ourtrail_v7/code.html) | [screen.png](raw/ourtrail_v7/screen.png) |
| `ourtrail_v12_1` | 全屏「山体与云层」剖面 | 独立页 / 全屏态 | 云层剖面 | 否（未裁决） | [code.html](raw/ourtrail_v12_1/code.html) | [screen.png](raw/ourtrail_v12_1/screen.png) |
| `ourtrail_v12_2` | 天气页 · 云层剖面（整页外壳） | 独立页 + 模态 | 云层剖面 | 否（未裁决） | [code.html](raw/ourtrail_v12_2/code.html) | [screen.png](raw/ourtrail_v12_2/screen.png) |
| `ourtrail_v14_72` | 天气页 · 云层剖面（72h 梯度） | 独立页 | 云层剖面 | 否（未裁决） | [code.html](raw/ourtrail_v14_72/code.html) | [screen.png](raw/ourtrail_v14_72/screen.png) |
| `ourtrail_72_v14` | 全屏「72 小时云层变化」 | 独立页 / 全屏态 | 云层剖面 | 否（未裁决） | [code.html](raw/ourtrail_72_v14/code.html) | [screen.png](raw/ourtrail_72_v14/screen.png) |
| `ourtrail_v16_1` | 天气页 · 沿途天气 | 独立页 | 沿途天气 | 否（未裁决） | [code.html](raw/ourtrail_v16_1/code.html) | [screen.png](raw/ourtrail_v16_1/screen.png) |
| `ourtrail_v16_2` | 天气页 · 逐时预报 | 独立页 | 逐时预报 | 否（未裁决） | [code.html](raw/ourtrail_v16_2/code.html) | [screen.png](raw/ourtrail_v16_2/screen.png) |
| `ourtrail_v16_3` | 天气页 · 日月天相 | 独立页 | 日月天相 | 否（未裁决） | [code.html](raw/ourtrail_v16_3/code.html) | [screen.png](raw/ourtrail_v16_3/screen.png) |
| `ourtrail_v18_1` | 逐时预报 + 地点选择浮层 | 页 + 浮层态 | 逐时预报 | 否（未裁决） | [code.html](raw/ourtrail_v18_1/code.html) | [screen.png](raw/ourtrail_v18_1/screen.png) ⚠ 乱码 |
| `ourtrail_v18_2` | 逐时预报 + 地点浮层（有数据） | 页 + 浮层态 | 逐时预报 | 否（未裁决） | [code.html](raw/ourtrail_v18_2/code.html) | [screen.png](raw/ourtrail_v18_2/screen.png) |
| `ourtrail_v18_3` | 逐时预报 + 地点浮层（空态） | 页 + 浮层态 | 逐时预报 | 否（未裁决） | [code.html](raw/ourtrail_v18_3/code.html) | [screen.png](raw/ourtrail_v18_3/screen.png) |

形态说明：**独立页** = 一整屏可独立存在；**全屏态** = 大概率由某页的"全屏查看"进入；
**页 + 浮层态** = 同一页的浮层展开状态，不是另一个页面。

现有实现位置对所有屏族都相同（见文末"实现对应"），逐屏只列与该屏最相关的入口。

---

## `ourtrail_v7` — 天气页 · 云层剖面（早期深色版）

- **功能**：高海拔气象概览 + 山体立面云剖面 + 峰顶测站状态 + 分层大气垂直构造。
- **资产**：[code.html](raw/ourtrail_v7/code.html) · [screen.png](raw/ourtrail_v7/screen.png)（780×3808）
- **关键视觉**：深色地形底、蓝色渐变强调、云层密度/透光率图例、540 hPa 峰顶块、分层高度表。
- **交互/状态**：单屏长页；底部 tab 仅静态高亮（活动/天气/路线/我的）。无 JS 业务交互。
- **与其它版本的关系**：与 `ourtrail_v12_2` 同为"云层剖面整页"，但配色与信息架构差异最大。
  先后与继承关系**无据可查**，记为候选。不与任何版本合并。
- **是否独立页面**：是。
- **是否实施基线**：否（未裁决）。
- **备注**：含演示性气象宣称（如"海平面约 53% 氧含量"、ECMWF 4 km / GFS 数据源），
  均属演示数据，不得进入业务文案。

## `ourtrail_v12_1` — 全屏「山体与云层」剖面

- **功能**：2,500–5,500 m 山体剖面上的云带分布、路线折线与航点详情。
- **资产**：[code.html](raw/ourtrail_v12_1/code.html) · [screen.png](raw/ourtrail_v12_1/screen.png)（780×1768）
- **关键视觉**：路线 19.8 km；航点 起点 3,200 / 打尖包 3,750 / 大本营 4,379 / 大峰 5,025 m；
  逆温云、谷地云、0°C 层 3,920 m 标注；顶栏蓝色 `#094cb2`。
- **交互/状态**：点击航点展开详情面板；提供无障碍表格替代视图（内联 JS）。
- **与其它版本的关系**：`ourtrail_v12_2` 页面内出现"全屏查看"，本屏像是该入口的目标态——
  由文案观察得出，记为候选。与 `ourtrail_72_v14` 同属全屏云剖面，但后者是时间维。
- **是否独立页面**：是（全屏态）。
- **是否实施基线**：否（未裁决）。
- **现有实现入口**：`miniprogram/pages/weather-chart/`、`miniprogram/components/route-profile/`。

## `ourtrail_v12_2` — 天气页 · 云层剖面（整页外壳）

- **功能**：四 tab 天气页外壳，云层剖面 tab 的早期完整形态，含全屏剖面模态。
- **资产**：[code.html](raw/ourtrail_v12_2/code.html) · [screen.png](raw/ourtrail_v12_2/screen.png)（780×2928）
- **关键视觉**：四 tab（逐时预报 / 云层剖面 / 沿途天气 / 日月天相）；高海拔气象概览；
  山体与云层剖面 + 全屏查看；云层时序与注意事项；"同步给队友" CTA。
- **交互/状态**：整页；点击"全屏查看"打开模态，可关闭（内联 JS）。
- **与其它版本的关系**：与 `ourtrail_v14_72` 同为云层剖面整页，后者增加 72h 梯度与时间选择；
  目录名暗示先后，但**目录名不是版本依据**，只记候选。
- **是否独立页面**：是。
- **是否实施基线**：否（未裁决）。

## `ourtrail_v14_72` — 天气页 · 云层剖面（72 小时云量梯度）

- **功能**：在云层剖面页内加入 72 小时云量时序、时间选择与选中时段事实卡。
- **资产**：[code.html](raw/ourtrail_v14_72/code.html) · [screen.png](raw/ourtrail_v14_72/screen.png)（780×3210）
- **关键视觉**：云量覆盖梯度图例；选中时段 06:00 卡片；72 小时云层变化二维场 + 全屏查看；
  时间 chip 行；注意事项列表。
- **交互/状态**：整页；切换时间 chip；打开全屏。
- **与其它版本的关系**：72h 区块与 `ourtrail_72_v14` 全屏页描述同一份数据（由文案观察）；
  `ourtrail_v12_2` 的后续迭代为候选。均不合并。
- **是否独立页面**：是。
- **是否实施基线**：否（未裁决）。

## `ourtrail_72_v14` — 全屏「72 小时云层变化」

- **功能**：时间维的云层横剖面，带高度范围档位与分层明细。
- **资产**：[code.html](raw/ourtrail_72_v14/code.html) · [screen.png](raw/ourtrail_72_v14/screen.png)（780×2702）
- **关键视觉**：档位"登山高度 3,000–6,500 / 全高度 2,000–12,000 / 72H 连续探空"；
  云层横剖面；峰顶趋势；ECMWF 局地模型图例；分层明细（卷云 / 冲顶高空 / 大本营逆温 / 河谷层积云 / 0°C）。
- **交互/状态**：全屏；切换高度范围档位（内联 JS 高亮）；本屏 PNG 控件蓝绿混用。
- **与其它版本的关系**：对应 `ourtrail_v14_72` 的"全屏查看"目标态（由文案观察，候选）。
- **是否独立页面**：是（全屏态）。
- **是否实施基线**：否（未裁决）。
- **现有实现入口**：`miniprogram/pages/weather-chart/`、`miniprogram/utils/cloud-field-svg.js`。

## `ourtrail_v16_1` — 天气页 · 沿途天气

- **功能**：按路线分段（D1/D2）展示沿途微气象、海拔剖面与航点预报表。
- **资产**：[code.html](raw/ourtrail_v16_1/code.html) · [screen.png](raw/ourtrail_v16_1/screen.png)（780×4236）
- **关键视觉**：路线摘要 19.8 km / +1,825 m / 5,025 m；D1/D2 分段；海拔剖面与地图；
  航点预报表 5 节点（大本营 02:30、垭口 04:15、大峰 06:00、下撤 08:30、打尖包 13:00）；
  −0.65 °C/100 m 递减率；航迹导出。
- **交互/状态**：整页；分段切换、披露块展开、导出入口（内联 JS）。
- **与其它版本的关系**：与 `ourtrail_v16_2`、`ourtrail_v16_3` 共用同一四 tab 外壳（可直接观察）。
- **是否独立页面**：是。
- **是否实施基线**：否（未裁决）。
- **现有实现入口**：`miniprogram/pages/weather-plan/`、`miniprogram/utils/route-schedule.js`。

## `ourtrail_v16_2` — 天气页 · 逐时预报

- **功能**：逐时预报主屏，四轨联动曲线 + 微气象矩阵。
- **资产**：[code.html](raw/ourtrail_v16_2/code.html) · [screen.png](raw/ourtrail_v16_2/screen.png)（780×3830）
- **关键视觉**：选中小时（明天 06:00）事实带：风 / 降水 / 冰点 / 云层可见度；四条联动曲线；
  7 日趋势；5,025 m 微气象矩阵（湿度 / 气压 / 含氧 / 露点 / UV）；观测点列表。
- **交互/状态**：整页；选择小时；展开披露块（内联 JS）。
- **与其它版本的关系**：与 `ourtrail_v16_1`、`ourtrail_v16_3` 共用外壳（可直接观察）。
- **是否独立页面**：是。
- **是否实施基线**：否（未裁决）。
- **现有实现入口**：`miniprogram/components/meteogram/`、`miniprogram/utils/solar-arc.js`。

## `ourtrail_v16_3` — 天气页 · 日月天相

- **功能**：24 小时天穹带、晨昏时刻、太阳轨迹、月相与月光分析、活动窗口建议。
- **资产**：[code.html](raw/ourtrail_v16_3/code.html) · [screen.png](raw/ourtrail_v16_3/screen.png)（784×4460）
- **关键视觉**：天穹带（**含外部图片背景**）；晨昏两列表；太阳弧最大高度 48°，方位 108°/180°/252°；
  "晨昏照金山" 06:48–07:25；月相 82% 盈凸月与月出月落；月光分析；活动窗口；
  AR 对日 / 妖妹峰愿景（**当前实现不支持**）；日照 11h44m；Bortle 2。
- **交互/状态**：单屏长页；底部 tab 静态。
- **与其它版本的关系**：与 `ourtrail_v16_2` 共用外壳（可直接观察）。
- **是否独立页面**：是。
- **是否实施基线**：否（未裁决）。
- **备注**：截图宽度 784 px（其余 780 px）；PNG 顶栏与天穹带均为蓝色 `#094cb2`，
  而 HTML 主题声明绿色；天空带底图为 `lh3.googleusercontent.com` 外链，未随导出物提供。
- **现有实现入口**：`miniprogram/utils/sky.js`、`miniprogram/utils/sky-ephemeris.js`、
  `miniprogram/utils/astro.js`、`miniprogram/utils/solar-arc.js`。

## `ourtrail_v18_1` — 逐时预报 + 地点选择浮层

- **功能**：在逐时预报之上展开地点/路线选择浮层。
- **资产**：[code.html](raw/ourtrail_v18_1/code.html) · [screen.png](raw/ourtrail_v18_1/screen.png)（780×1768）
- **关键视觉**：分组计数 全部(6) / 我的路线(3) / 我的地点(3)；"最近使用"；选中路线；相机地点；
  底栏三动作（地图选点 / 导入 GPX / 新建路线）。
- **交互/状态**：浮层展开态；分组切换（内联 JS）。
- **与其它版本的关系**：与 `ourtrail_v18_2`、`ourtrail_v18_3` 结构相同、数据不同；
  三者是否构成"有数据 / 空态 / 另一数据态"的成对设计，**未裁决**。
- **是否独立页面**：否，是同一页的浮层状态。
- **是否实施基线**：否（未裁决）。
- **⚠ 截图不可用于判断文案**：`screen.png` 文本乱码（mojibake）。文案以 `code.html` 为准。
- **现有实现入口**：`miniprogram/pages/weather/weather.js`（地点浮层）、`miniprogram/pages/weather-hub/`。

## `ourtrail_v18_2` — 逐时预报 + 地点浮层（有数据态）

- **功能**：同上，浮层内有 2 条路线 + 3 个地点，按最近活动排序。
- **资产**：[code.html](raw/ourtrail_v18_2/code.html) · [screen.png](raw/ourtrail_v18_2/screen.png)（780×1768）
- **关键视觉**：分组计数；"按最近活动排序"提示；路线/地点条目；底栏三动作。
  当前分组用 `border-secondary-fixed` 标记；PNG 底栏按钮为蓝色 `#094cb2`。
- **交互/状态**：浮层展开态（有数据）；分组切换。
- **与其它版本的关系**：与 `ourtrail_v18_1` / `ourtrail_v18_3` 同结构（候选对应）。
- **是否独立页面**：否，浮层状态。
- **是否实施基线**：否（未裁决）。
- **现有实现入口**：`miniprogram/pages/weather/weather.js`（地点浮层）、`miniprogram/pages/routes/`。

## `ourtrail_v18_3` — 逐时预报 + 地点浮层（空态）

- **功能**：同上，零数据空态与新手引导。
- **资产**：[code.html](raw/ourtrail_v18_3/code.html) · [screen.png](raw/ourtrail_v18_3/screen.png)（780×1768）
- **关键视觉**：计数 全部(0)/我的路线(0)/我的地点(0)；空态插画"还没有保存的地点或路线"；
  新手指引；底栏三动作。
- **交互/状态**：浮层展开态（空）；分组切换。
- **与其它版本的关系**：与 `ourtrail_v18_2` 构成"空态 ↔ 有数据"的对应（候选，无官方说明）。
- **是否独立页面**：否，浮层状态。
- **是否实施基线**：否（未裁决）。
- **备注**：空态插画是排版资产，不是可移植的业务图；不得当作图标复用。

---

## 实现对应（全体）

原型是"四 tab"结构，现有实现也是四 tab。**这是结构对应，不是视觉一致**：

| Tab key | 现有标签 | 页面 | 相关组件 / 工具 |
|---|---|---|---|
| `hourly` | 逐时预报 | `miniprogram/pages/weather/` | `components/meteogram/`、`utils/solar-arc.js` |
| `cloud` | 云层剖面 | `miniprogram/pages/weather/`、`pages/weather-chart/` | `utils/cloud-field-svg.js`、`utils/weather-cloud-field.js`、`components/meteogram/` |
| `enroute` | 沿途天气 | `miniprogram/pages/weather/`、`pages/weather-plan/` | `utils/route-schedule.js`、`components/route-profile/` |
| `sky` | 日月天相 | `miniprogram/pages/weather/` | `utils/sky.js`、`utils/sky-ephemeris.js`、`utils/astro.js`、`utils/solar-arc.js` |

地点选择浮层：`miniprogram/pages/weather/weather.js`（浮层实现）、`pages/weather-hub/`、
`pages/routes/`、`pages/route-edit/`。

> 以上对应关系由阅读 `miniprogram/pages/weather/weather.js` 的 tab 常量
> （`TAB_HOURLY` / `TAB_CLOUD` / `TAB_ENROUTE` / `TAB_SKY`）与目录内容核实，
> 但并不表示原型与实现在视觉或信息层级上已经一致——**本轮未做任何视觉对照**。
