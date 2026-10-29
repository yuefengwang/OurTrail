# 天气页 1:1 落地实施文档（原型 `ourtrail-explore-v3` → 小程序）

-   日期：2026-10-27
-   状态：**已实施（2026-10-27）**。执行记录与未完成项见 `docs/ui-ux-redesign/agent-plan/weather-v3/`（README 偏差 1–5、state.md 读数表）与证据包 `docs/ui-ux-redesign/evidence/weather-v3-2026-10-27/README.md`。**真机 M5 NOT_RUN、云端未部署**（`cloudfunctions/` 已改，需先部署 `trailApi`/`trailApiLab`）。产品裁决已于 2026-10-27 全部闭合（§1.1 D1–D5、§13）。
-   输入：`docs/prototypes/ourtrail-explore-v3/`（`weather.html` / `weather.css` / `weather.js` / `weather-data.js` / `WEATHER-DESIGN.md`）；用户 2026-10-27 提供的生产云图截图（连续等值带样式）。
-   证据口径：本文现状数字均为 2026-10-27 工作树实测；行号会漂，定位一律以文件路径与函数名。
-   相关 ADR：`docs/weather-ux/architecture/weather-v2-three-layer-evolution.md`、`weather-v2-three-layer-slice-2.md`。
-   协同方案：**§16 多 Agent 协同方案**（角色 R0–R8、文件所有权、冻结契约、里程碑 M0–M6、任务书/交接单模板、冲突升级）。

* * *

## 0\. 一页结论

| 问题 | 结论 |
| --- | --- |
| 能不能 1:1 落地 | **能**，按 §1.1 的口径；有 3 类平台硬边界（§1.2）不计入比对 |
| 最大风险 | 逐时图从「压屏宽」改为「42px/列 + 横滑」；SVG 文本字体跨端 |
| 最大工作量 | 逐时图重写 + 个人计划（新集合/命令/权限）+ 门禁重立 |
| 不需要做的 | 云层渲染（**沿用生产样式**，用户 2026-10-27 指定） |
| 需要先验的 | 逐时 SVG 图在 24/48/72h 下的解码耗时与文字可读性（真机） |

* * *

## 1\. 口径与边界

### 1.1 四项裁决（用户已确认）

| # | 议题 | 裁决 |
| --- | --- | --- |
| D1 | 1:1 的验收口径 | **布局与静态视觉一致**：同尺寸真机截图肉眼一致；接受系统外壳、原生控件、图表文字渲染差异 |
| D2 | 是否允许天气页脱离现有设计系统 | **允许**单独一套皮肤（鲜绿 `#16783E` + 纯白底 + 9–11px 小字 + 去卡片化） |
| D3 | 「沿途天气」范围 | **必须包含可保存的个人计划**（D1/D2 分组、抵达时刻、复制副本），即新增云端能力 |
| D4 | 详情页归属 | **方案 A**：选源首页与四视图详情同处 `pages/weather-hub`（tab 页），底栏常驻；活动深链另走独立页 |
| D5 | 个人计划是否可分享 | **支持分享给同行者**（owner 写、被授权者只读；复制副本归复制者） |

### 1.1.1 D5 的连带影响（本版已并入）

分享打开了一条新的授权面，必须同时落四件事，缺一即视为未完成：

1.  实体增加 `sharedWith`（并派生 `visibility`，**不允许两者矛盾**——对齐 `routes.js` 的 `normalize`）；
2.  读视图按 `owner || sharedWith.includes(actor)` 过滤，投影显式给出 `isOwner`；
3.  写命令保持 **owner 双层授权**（`canExecute` 一次 + handler 内一次），被授权者调用 `plan.update/delete` 必须 `FORBIDDEN`；
4.  「复制为独立计划」对被授权者**开放**（读→create，新 `ownerId` = 复制者），这是分享的正向用途，不属于越权。

### 1.2 不可 1:1 的三项（验收时单列，不参与比对）

1.  **系统外壳**：状态栏、微信胶囊、Home Indicator 由系统/微信绘制；`navigationStyle: custom` 只能让位，不能自绘胶囊。
2.  **原生控件展开态**：`slider`、`picker`（selector/time）的展开面板是系统 UI，触发区可 1:1，展开态不可。
3.  **图表文字字形**：原型是 inline SVG + 页面字体；小程序只能是 `data:image/svg+xml` 图片或 canvas，字形由解码器决定，存在亚像素差。

另有一条用户指定例外：

4.  **云层图不按原型画**：保留生产连续等值带（用户上传截图），**不做**原型的 500m 固定格、`hsl` 灰阶格、`<pattern>` 斜线。

### 1.3 证据档（沿用 `audit-verification.md`）

| 档 | 含义 | 本文要求 |
| --- | --- | --- |
| E1 | 代码存在 | 不单独作为证据 |
| E2 | 静态门禁通过 | 每阶段必过 |
| E3 | 真机截图 + 读数断言 | 每个视觉阶段必达 |
| E4 | 用户确认 | 仅 D1–D4 已具备 |

* * *

## 2\. 目标与非目标

### 2.1 目标

1.  底部「天气」进入选源首页，选中上下文后进入四视图详情；两屏同处一个 tab 页，底栏常驻。
2.  四视图：**逐时 / 云层 / 沿途 / 日月**，共享同一地点、节点、日期、小时。
3.  视觉按原型：白底、鲜绿、无卡片、图表主导、9–11px 密集小字。
4.  云层图**保留生产样式**（等值带 + 此点海拔 + 显示窗范围 + 缺资料文案）。
5.  沿途天气支持可保存的个人计划（含跨天营地、同日逆序阻止、复制为独立计划），**并可分享给同行者（被授权者只读）**。
6.  活动深链仍可直达详情（独立页，无底栏），入参与返回语义保持现状。

### 2.2 非目标

-   不做与原型 PNG 的逐像素比对。
-   不把系统外壳、原生选择器、无障碍语义改造成原型形态。
-   不做深色模式（原型 `WEATHER-DESIGN.md` 已明确「暂不做」）。
-   不做真实地图底图接入（首页「地图选点」沿用现有 `chooseLocation`/手动坐标，不新增瓦片服务）。
-   不引入新的天相算法；日月视图只做版式，数据接 `astro.js` / `sky.js`。
-   不改全站主色、tab 文案、其余 20 页的卡片语言。

* * *

## 3\. 现状基线（2026-10-27 实测）

### 3.1 客户端

| 项 | 实测 |
| --- | --- |
| 页面 | 21（`miniprogram/pages/` 目录数） |
| 组件目录 | 20（`miniprogram/components/`） |
| utils | 30 个 `.js` |
| 测试套件 | 115 个 `tools/*-test.js` |
| 天气详情页 | `pages/weather`：JS **1716 行** / WXML **531 行** / WXSS **362 行**；`weather.json` 为原生导航栏，注册 `icon`/`form-field`/`status-panel`/`meteogram` |
| 天气入口页 | `pages/weather-hub`：JS **309 行** / WXML **160 行**；`navigationStyle: custom`；`app.json` tabBar 第 2 项 |
| 全图页 | `pages/weather-chart`：横屏 + `hour-width` + `meteogram` 的 `scroll-view`/canvas 横滑 |
| 图表管线 | 主图 `meteogram-svg.buildUnified(opts)` → SVG 字符串 → `data:image/svg+xml;charset=utf-8,` + `encodeURIComponent` → `<image mode="widthFix">`（`pages/weather/weather.js` 的 `cfToDataUri`）；宽度默认 \`opts.width |
| 经典图 | `components/meteogram`：`scroll-view` + `canvas type="2d"` + `hour-width`（已验证的横滑路径） |
| 云场 | `utils/cloud-field-svg.js`（819 行）负责网格/几何/等值带；`utils/weather-cloud-field.js` 做适配 |
| 天相 | `utils/sky.js`（1234 行）、`utils/conditions.js`、`utils/agenda.js` |
| 设计 token | `app.wxss` 784 行；`--forest:#163E35`、`--paper:#F5F5F0`、`--line:#DEE3DB`、字号 scale 12/14/16/18/28 |

### 3.2 云端

| 项 | 实测 |
| --- | --- |
| action | **16**（`cloudfunctions/trailApi/index.js` 的 `ROUTES`，`read` … `checkImage`） |
| 命令类型 | **44**（`domain/commands.js` 唯一 `a.b` 字符串） |
| 集合 | `store.COLLECTIONS` **15** 项 + `ot_meta` + `weather_cache` = 17 |
| 读视图 | `selectors.selectView(state, actor, request, now)` 按 `request.kind` 分支（`profile` / `me` / `tasks` / …） |
| 归属口径 | `ownerId = actor.userId`（`routes.js` 的 `route.create` 即此口径） |
| 既有路线日程 | `miniprogram/utils/route-schedule.js` 的 `RS.schedule(points, startAt)`，天气页已用它算节点抵达 |

### 3.3 原型侧关键数值

| 项 | 值 | 出处 |
| --- | --- | --- |
| 列宽 | `CELL = 42` | `weather.js:31` |
| 逐时图高 | `H = 310` | `weather.js` `hourlyChart` |
| 云层图高 | `H = 240` | `weather.js` `cloudChart` |
| 24/48/72h | 均横滑；24h = 1008px、72h = 3024px | `board()` 用 `all.length * CELL` |
| 页头抬头 | `h1` 24–26px / `font-weight:730` | `weather.css:4,22` |
| 字号 | 9 / 10 / 11 / 12 / 13 / 14 / 16 / 17 / 18 / 21 / 24 / 25 / 26 / 34 | `weather.css` |
| 主色 | `--green:#16783E`；底 `#FFFFFF` | `style.css:1` |
| 两屏 | `weather-home` / `weather-detail` 同页 `hidden` 切换 | `weather.html:14-15`、`weather.js` `renderAll` |
| 底栏 | 位于滚动区之外，常驻 | `weather.html:23` |

### 3.4 结构差异（必须改的）

| 维度 | 现在 | 目标 |
| --- | --- | --- |
| 页面组织 | 长页：逐时 + 云场 + OI + 时间轴 + 天相卡 + 详情 | 四视图平级 tab，共享上下文 |
| 入口 | `weather-hub` 只做入口，点选后 `navigateTo` 详情 | 屏内切换，底栏常驻 |
| 图表宽度 | 压屏宽（`width=375`） | 42px/列 + 横滑（仅逐时） |
| 云层 | 等值带（保留） | 等值带（保留）+ 原型框架 |
| 沿途 | 单点切换（`pointIndex`） | 行程流 + 可编辑个人计划 |
| 视觉 | 卡片 + `#F5F5F0` + 墨绿 | 无卡片 + 纯白 + 鲜绿（局部皮肤） |

* * *

## 4\. 目标架构

### 4.1 方案 A

```
pages/weather-hub  (tabBar #2, navigationStyle: custom)
├─ 屏 1  选源首页            state.screen = 'home'
└─ 屏 2  四视图详情          state.screen = 'detail'
        ↑ 共享详情单元（组件）

pages/weather      (二级页, 保留)
└─ 同一个共享详情单元        深链：活动 / 分享 / 观察点（历史入口）

```

### 4.2 为什么抽共享详情单元

同一套四视图要在两个宿主出现。**不允许写两份**（本仓已有“页面逻辑镜像到测试/第二实现”的事故史）。做法：

-   `components/weather-detail/`：外壳 + 四视图 tab + 视图容器；持有详情级状态（place/node/day/cursor/period/tab/level）。
-   纯逻辑（状态迁移、视图选择、读数挑选）放 `utils/weather-v3.js`，**wx-free**，可被 `tools/*-test.js` 直接打。
-   图表生成器保持纯函数：`utils/weather-v3-hourly-svg.js`（新），云层复用 `utils/meteogram-svg.js`（不改）。

### 4.3 路由与入参矩阵

| 入口 | 宿主 | 入参 | 底栏 | 返回 |
| --- | --- | --- | --- | --- |
| 底栏「天气」 | `weather-hub` | 无 | ✅ | — |
| 首页资产 / 选点 / 导入 | `weather-hub`（屏内切换） | 内存 `state` | ✅ | 屏内回首页 |
| 活动详情「路线天气」 | `pages/weather` | `?id=<activityId>&point=<i>` | ❌ | 原生返回 |
| 观察点 / 轨迹点 | `pages/weather` | `?src=local&set=<setId>&point=<i>` 或 `?src=local&lat=&lng=` | ❌ | 原生返回 |
| 分享链接 | `pages/weather` | `?src=local&lat=&lng=&date=` | ❌ | 原生返回 |

约束：`switchTab` 不支持 query，tab 页内**不得**依赖 URL 传参；上下文走内存/`globalData`。

### 4.4 滚动与吸顶

-   走**页面级滚动**（不用整页 `scroll-view`），否则四视图 tab 的 `position: sticky` 不可靠。
-   横向滚动只用于图表容器：`<scroll-view scroll-x>` 包住固定宽 SVG。
-   底部留白按 `app.json` tabBar 分档（`b4-pad-final-value` 门的要求）；独立页无需 tabBar 留白。

* * *

## 5\. 页面规格

### 5.1 屏 1：选源首页

结构（自上而下）：

1.  品牌行（自绘，含胶囊避让）
2.  眉题 `山野天气` + 主标题 `看清天气，再出发。` + 副行
3.  主行动：`地图选点`（唯一实心按钮）
4.  次行动：`输入经纬度` / `导入 GPX`
5.  `继续上次`：最近一条个人计划（无则整块不出现）
6.  资产三 tab：`个人计划` / `常用地点` / `共用路线`
7.  尾注（云端同步为目标方案）

数据映射：

| 区块 | 来源 |
| --- | --- |
| 个人计划 | 新集合 `ot_plans`，`read {kind:'plans'}`；分两组：**我创建的** / **共享给我的**（后者行尾标 `由 XXX 共享`，只读） |
| 常用地点 | 现有观察点（`weather-hub` 的 `points`） |
| 共用路线 | `readRoutes`（`pages/routes` 已有） |
| GPX / 经纬度 / 地图 | 沿用 `weather-hub.js` 现有流程，不改行为 |

### 5.2 屏 2：详情外壳

1.  自绘导航行：`weather-back`（仅深链出现）+ 品牌；右侧胶囊避让
2.  页头：地点名（点击→地点弹层）+ 节点行（点击→节点弹层）+ 数据源标（点击→帮助弹层）
3.  日期条：单点=5 日卡（含天气图标与 `min/max`）；路线=`D1/D2…` + `活动日` 标记 + 超范围禁用
4.  四视图 tab（sticky）
5.  视图内容
6.  尾注（北京时间 · 单位）
7.  （仅 `weather-hub`）底部 tabBar

### 5.3 逐时视图

顺序：读数 → 时长切换 → 图表 → 图例 → 滑块 → 详细读数 → 两个跳转行（去云层 / 去沿途）。

| 元素 | 规格 |
| --- | --- |
| 读数 | 天气图标 + 主温 34px；右侧降水 mm / 阵风 km/h |
| 图表 | `H=310`，列宽 42px，五段：温度+体感、降水+概率、高低中云三行、风速+阵风、风向文字；横向滚动 |
| 轴 | 左侧独立固定列 49px（不随图滚动），刻度为「时刻 / 温度 / 降水 / 风 / 高云 / 中云 / 低云」 |
| 选中 | 选中列底色 + 竖向虚线；点列 / 前后步进 / 滑块三者同步 |
| 详细读数 | 6 项：降水概率、风向/风速、阵风、相对湿度、能见度、节点海拔 |
| 时长 | 24/48/72；切换时保留当前时刻，以该时刻所在日期重设窗口起点 |

### 5.4 云层视图（保留生产样式 —— 硬约束）

**不实现**原型的三项：固定 500m 格、`hsl(112 7% l)` 灰阶格、`<pattern>` 斜线。

保留（生产）：

-   连续灰阶等值带（`cloud-field-svg` 的网格 + 等值带 + 外扩填 0 + 交叉点按网格边身份）
-   `此点 <海拔> m` 虚线标注（`F.elevLineLabel`，带来源）
-   显示窗范围标注（`F.profileRangeLabel`，如 `4,250–5,750 m`）
-   缺资料 / 无成层云带文案（`no-deck`），**不画纹理**
-   点图选小时 + `r1/r2/r3/r4` 读数行
-   两行图例（云量/温度/降水/阵雨/风/阵风 + 此点海拔/琥珀段/风向）
-   `planProfile` 自适应显示窗与判读分离

容器改造（仅版式）：

-   放进四视图的「云层」tab，标题行按原型：`云随高度与时间变化` + `读图说明`
-   时长切换 24/48/72 置于图上方
-   图下方说明改写为生产口径（`无成层云带 ≠ 晴空`），**不得**写「斜线区」
-   **不保留**原型的「读取高度 1500–6000」下拉（D5-1 已确认）：生产没有“任意高度读数”的判据，硬加会造第二套判读；读数改由点选小时 + `r1/r2/r3/r4` 承担
-   **不保留**原型的逐层云量表格（D5-2 已确认）

实现方式（P3 首选）：**整图复用** `meteogram-svg.buildUnified`，零渲染改造。  
若产品要求“只留云区”，再评估给 `buildUnified` 增加 `opts.sections`（会动被测模块，须重跑 `meteogram-svg-test 25` 与 `meteogram-readability-test 86`）。

已知代价：逐时图 42px/列、云层图压屏宽 ⇒ 两图同小时的 x 位置不同。读数与联动仍按绝对小时正确。

### 5.5 沿途视图（行程流）

结构：

1.  计划上下文行：计划名 + 出发日 + 天数 + `未保存计划/个人计划` + `从活动带入`
2.  日期按钮（D1/D2…；超范围禁用 + 「行程已保留，临近出发再查」）
3.  提示条：`按各节点预计抵达时刻查询，不是把同一时刻铺满路线`
4.  行程流：`时刻 | 节点名/海拔/第 N 天 | 该时刻天气`
5.  `调整每天的节点与时间` / `复制为独立计划`（**共享给我的计划：隐藏前者，保留后者**；D5 裁决）
6.  说明：计划不修改原始 GPX；同营地可跨天重复

数据：

-   节点：路线库 `route.points` 或 GPX 解析结果
-   抵达时刻：计划里的 `stops[].time`；无值显示「待安排」，**不虚构**
-   天气：按 `day + hour` 取该节点的 series（需要逐节点取数；见 §7.4）
-   未进入预报范围：整段显示“暂无该日期的可用预报”，不拿别的日期冒充
-   共享给我的计划：只读视图；可查看、可复制为自己的副本，**不可编辑/删除**（D5）

### 5.6 日月视图

-   日照弧（SVG 几何，可作独立小图，无需滚动）
-   `日出 / 日落 / 月面照明` 三格
-   晨昏与暗夜 5 条（客观时刻，**不许被天气裁掉**）
-   天相三卡：`云海 / 星空·银河 / 彩虹·晨昏光染`
    -   版式按原型（名称 + 状态胶囊 + 一句说明）
    -   内容接生产三态：**possible / excluded / unknown**；`excluded` 显示原因，`unknown` 明说缺什么，**不得**统一写「资料不足」（D5-4 已确认允许生产真实结论）
    -   总评沿用 `conditions.overallGrade`，被排除项不参与投票

### 5.7 弹层

| 弹层 | 复用 | 新增 |
| --- | --- | --- |
| 地点选择（含搜索、配图） | `overlay` | 列表数据来自活动 + 路线库 |
| 节点选择 | `overlay` | 路线节点投影 |
| 行程编辑（计划名/出发日/节点×天×时刻） | `overlay` + `form-field` + `picker` | 同日逆序校验 |
| 计划分享（选择同行者、取消分享） | `overlay` + 身份码选择列表（对齐路线库共享） | `sharedWith` 全量提交；被授权者列表只读 |
| GPX 导入 | `weather-hub` 现有 | 无 |
| 经纬度 | `weather-hub` 现有 | 无 |
| 地图选点 | `weather-hub` 现有 | 无 |
| 帮助（数据源 / 读图 / 天相） | `overlay` | 三段文案 |

### 5.8 状态矩阵

每个视图都要有：`loading` / `empty` / `error` / `stale` / `outOfRange` / `denied`。  
沿用生产既有语义（`weather-resilience`）：

-   瞬时失败自动重试 3 次；
-   仍失败 → 本地缓存 12h 内兜底 + 时效横幅；
-   云端外呼失败 → 返回 `stale/staleAt`，页面显示“显示的是 X 小时前的预报”；
-   超范围 → 保留行程，显示“临近出发再查”。

* * *

## 6\. 视觉规格

### 6.1 皮肤作用域

在天气页根节点（`.weather-v3`）定义局部变量，**不写进 `app.wxss` 的 `page` 块**：

```css
.weather-v3 {
  --w-green:#16783E; --w-green-soft:#EDF7ED; --w-bg:#FFFFFF;
  --w-ink:#18211B; --w-muted:#69716B; --w-line:#E8ECE7; --w-pale:#F5F7F4;
  --w-blue:#4186AA; --w-teal:#457E78; --w-amber:#A87928;
}

```

约束：

-   组件必须 `options: { styleIsolation: 'apply-shared' }` 才能读到（铁律 14），且 `options` 只能出现一次。
-   在 `design-system.md` 登记「天气页局部皮肤例外 + 生效范围 + 理由」，否则下轮会被当违规重提。
-   除上表外，页面内新增色值一律先登记再使用（封闭表原则）。

### 6.2 字号（天气页专用档）

`9 / 10 / 11 / 12 / 13 / 14 / 16 / 17 / 18 / 21 / 24 / 25 / 26 / 34`。

-   9–11px 仅允许出现在**图表轴、图例、日期条、副行**；正文级不得低于 12px。
-   这是对全局 scale（12/14/16/18/28）的**登记例外**，不是新 scale。

### 6.3 间距

-   页面左右 20px（≤380 时 16px）。
-   分区 `padding: 21px 20px`，以 1px 分割线分段，**不做卡片**。
-   页头 `padding: 12px 20px 11px`；日期条 `padding: 0 15px 10px`。
-   图表轴列 49px（≤380 时 45px）。

### 6.4 触控

-   主行动、tab、日期卡、行程行、弹层按钮 ≥ 44px。
-   次级文字按钮（数据源标、读图说明、帮助）允许 < 44px，但需在验证记录里登记“次级、非主路径”。

### 6.5 图表

-   统一走 `data:image/svg+xml` + `scroll-view`；SVG 内必须**显式写** `font-family`（不能依赖 `inherit`）与 `font-variant-numeric`（用具体字宽策略，SVG 不支持该 CSS 时按等宽数字位置手工对齐）。
-   文本、网格、选中列、虚线的样式全部内联到 SVG 属性，**不允许**依赖外部 CSS class（图片内不生效）。
-   点选反解：`boundingClientRect` → `(px - left) * (svgWidth / rect.width)` → 列号，沿用 `onCfTap` 的归一做法。
-   72h 图宽度 3024px：需实测单张解码耗时；若 >300ms，降级为 canvas（`components/meteogram` 路径）。

* * *

## 7\. 数据契约

### 7.1 逐时（`series[]`）

已具备：`t / d / temp / feels / pop / precip / showers / code / wind / gust / windDir / rh / pressure / dewPoint / cloud{total,low,mid,high} / uv / visibility`。

映射：温度线=temp、虚线=feels、柱=precip、概率=pop、风=wind、阵风=gust、三行云量=cloud.low/mid/high。

缺值规则：`null/undefined` **不补 0**；图表断线、读数印「—」。

### 7.2 云层（`cloudLevels`）

```
{ times:[...], levels:[{ pressure, altitudes:[m|null], cloudCover:[%|null] }], unit:{altitude:'m ASL', cloudCover:'%'} }

```

-   只用于生产等值带渲染，不投影成固定格。
-   `altitudes` 逐时变化 ⇒ 剖面上的“高度”是随时间倾斜的，这是模型事实，不是缺陷。
-   判读（`inferState` / `denseSpanAt` / `peakCover`）只吃 `covered` 与扫描范围，不吃显示窗。

### 7.3 日月

`astro.js`：日出/日落/晨昏/暗夜；`sky.js`：三态与机会窗口；`conditions.js`：总评。  
页面只插值，不自造状态词（铁律 22）。

### 7.4 行程

-   计划：`routeId + startDate + stops[{nodeIndex, day, time}]`
-   逐节点取数：**每个节点一次 `getWeatherByPoint`**，按该节点抵达日的日窗口取 24h；缓存键含 `lat/lng/date`。
-   失败策略：单节点失败只标注该节点“天气未取到”，不整条失败；重试只给读操作。
-   禁止：用一个节点的数据冒充整条路线。

* * *

## 8\. 后端：个人计划

### 8.1 实体

```js
Plan {
  id, ownerId, routeId, name,
  startDate,                 // 'YYYY-MM-DD'
  stops: [{ nodeIndex, day, time }],   // day: 1..7; time: 'HH:mm' | ''
  sharedWith,                // [userId]；派生 visibility，客户端提交的 visibility 一律忽略
  visibility,                // 'private' | 'shared'，由 sharedWith 长度推导（对齐 routes.normalize）
  updatedAt                  // 服务端时间戳，客户端不可提交
}

```

约束：

-   `ownerId = actor.userId`（与 `route.create` 同口径）。
-   `sharedWith` 去重、剔除 actor 自己；`visibility` 由名单派生，**禁止**提交 `private + 非空名单` 或 `shared + 空名单`（`routes.js:25-36` 已给出同一套写法，直接复用，不重写第二份推导）。
-   分享通过**身份码（userId）**，不引入手机号/昵称匹配。
-   `stops[].nodeIndex` 必须落在 `routeId` 的 `points` 范围内（写入端校验，不进全域 `invariants`）。
-   同一天内 `time` 不得沿 `stops` 顺序逆序；空值不参与比较。
-   同一 `nodeIndex` 可在不同 `day` 重复（跨天营地）。

### 8.2 命令（3 条）

| 命令 | 语义 |
| --- | --- |
| `plan.create` | 新建；`requestId` 幂等；“复制为独立计划”由客户端读后 create（新 id），不另设命令 |
| `plan.update` | 改名称/出发日/stops/**sharedWith**（即分享与取消分享都走这里）；CAS + owner 双层授权 |
| `plan.delete` | 删除；owner 双层授权 |

> 不新增 `plan.share`/`plan.unshare`：分享就是 `sharedWith` 的全量替换，和 `route.update` 完全同构（少一组命令 = 少一处权限分支）。被授权者调用 `plan.create` 永远生成自己的副本，`ownerId` 取当前 actor。

新增命令按 `cloudfunctions/trailApi/domain/AGENTS.md` 的六步：`schema.js` 的 Payload → `commands.handle` 的 case + `summaries` → 模块实现 → `permissions.canExecute` 分支 → 不变量（必要时）→ `smoke-test.js`。

### 8.3 读视图

`selectors.selectView` 增加 `request.kind === 'plans'` 分支：

-   未登录 → `AUTH_REQUIRED` 的 denied view；
-   只返回 `ownerId === actor.userId || sharedWith.includes(actor.userId)` 的计划；
-   投影白名单：`id/routeId/name/startDate/stops/visibility/isOwner/sharedBy/updatedAt`；
-   **不回传 `ownerId` 与 `sharedWith` 原文**（对齐 `selectRoutes` 的“不暴露他人身份码”）：共享场景只给 `isOwner=false` + `sharedBy=<显示名>`；显示名从 `state.profiles` 取 `person.name`，取不到回落「同行者」。

### 8.4 集合注册（三处，缺一不可）

1.  `store.js` 的 `COLLECTIONS` 增加 `plans: 'ot_plans'`；
2.  `smoke-test.js` 的 `emptyState()`；
3.  `schema.js` 的 `stateSpec`。

> 漏一处会让 `assertInvariants` 拒绝此后每一次写入（见 `domain/AGENTS.md`）。

### 8.5 部署

1.  `node tools/sync-lab.js`（否则 `trailApiLab` 与生产不一致，`lab-dryrun` 会红）；
2.  部署 `trailApi`（云端安装依赖，超时改回 20s）与 `trailApiLab`；
3.  **先部署服务端，再发客户端**：旧服务端 schema 是 strict，会以 `INVALID_INPUT` 拒绝新命令。

* * *

## 9\. 客户端改动清单

### 9.1 新增

| 文件 | 职责 |
| --- | --- |
| `components/weather-detail/*` | 详情外壳 + 四视图容器 + tab + 读数条 |
| `components/weather-plan-sheet/*` | 行程编辑弹层（计划名/出发日/节点×天×时刻） |
| `utils/weather-v3.js` | 详情状态机（屏/视图/上下文/时长/小时），wx-free |
| `utils/weather-v3-hourly-svg.js` | 逐时五段图 SVG 生成器，纯函数 |
| `utils/weather-v3-format.js`（可选） | 该页专属标签（日期条、状态胶囊），避免污染 `format.js` |

### 9.2 修改

| 文件 | 改动 |
| --- | --- |
| `pages/weather-hub/{js,wxml,wxss,json}` | 两屏切换；首页改版；屏 2 挂共享详情单元；`json` 注册新组件 |
| `pages/weather/{js,json}` | 收敛为“深链壳”：解析 `id` / `src=local` → 挂同一详情单元 |
| `pages/weather.wxml/wxss` | 旧长页内容迁出（保留期间可共存，见 §11 P1） |
| `cloudfunctions/trailApi/{index.js,store.js}` | `selectView kind='plans'`（若走 selectView 则仅 selectors）；集合注册 |
| `cloudfunctions/trailApi/domain/{schema,commands,permissions,selectors}.js` | 新实体/命令/权限/投影 |
| `cloudfunctions/trailApi/domain/plans.js`（新） | 计划业务 |

### 9.3 不改

-   `miniprogram/utils/api.js`（`read`/`dispatch` 已通用）
-   `page/weather` 的既有数据管道（`getWeather` / 重试 / 缓存）
-   `meteogram-svg.js` / `cloud-field-svg.js`（云层按生产样式）
-   `app.wxss` 的 `page` 块与全站 token

* * *

## 10\. 门禁与测试计划

### 10.1 复用（不得删断言）

| 套件 | 覆盖 |
| --- | --- |
| `tools/weather-page-test.js`（219） | 云场/天相/文案/页面契约（云端→页面→组件） |
| `tools/cloud-field-geometry-test.js`（206） | 等值带拓扑、外扩、变异自证 |
| `tools/cloud-position-test.js`（62） | 三态、缺资料、海拔基准 |
| `tools/meteogram-readability-test.js`（86） | 图元可读性、宽度、范围自证 |
| `tools/meteogram-svg-test.js`（25） | 统一图构建 |
| `tools/weather-v2-test.js`（67） | 天相沉默、摄影后缀、暗夜机会句 |
| `tools/sky-test.js`（82） | 六类结论三态 |
| `tools/weather-resilience-test.js`（45） | 重试/缓存/stale |

### 10.2 新增

| 套件 | 判据 |
| --- | --- |
| `tools/weather-v3-structure-test.js` | 两屏结构、四视图 tab、屏内切换、深链壳；`check.js` 之外的布局契约（轴列固定、tab sticky、底部留白按 tabBar 分档） |
| `tools/weather-v3-hourly-svg-test.js` | 列宽 42、24/48/72 宽度、五段分区、缺值断线、选中列、文本属性内联（无外部 class） |
| `tools/weather-v3-visual-test.js` | 皮肤变量封闭表（不得出现未登记色值）、字号档、触控 44 |
| `tools/plans-test.js` | 计划 CRUD、owner 双层授权、同日逆序拒绝、跨天重复、CAS、复制不覆盖；**分享面**：被授权者可读不可写（update/delete 均 `FORBIDDEN`）、取消分享后立即不可读、`visibility` 与 `sharedWith` 不允许矛盾态、列表不泄漏他人身份码 |
| `tools/scenario-weather-v3-test.js` | 真页面装配：首页 → 详情 → 四视图切换 → 选时 → 编辑计划 → 保存 |
| `tools/ab-weather-v3.js` | 新旧详情对同一份云端载荷的读数对拍（业务判据 0 差异） |
| `tools/mutate-weather-v3.js` | 变异自证：列宽改 24、缺值补 0、云层改格子、计划越权（**被授权者写**）、逆序放行、**共享名单泄漏进投影**、**取消分享后仍可读** —— 全须报红 |

### 10.3 门禁口径

-   变异脚本必须先跑“未变异副本全绿”的有效性门；
-   锚点命中数必须==1，失败计漏网并 `exit 1`；
-   替换类判据遵循“替换而非削弱”，改写理由写入提交信息。

### 10.4 真机（B 层）

-   每阶段至少 1 轮开发者工具 + 1 次 390 宽真机截图；
-   云层缺资料、无海拔、超范围、stale 四个状态必须各有一张；
-   读数取自 `el.text()`（像素/DOM 双读），不做 data 推断。

* * *

## 11\. 分阶段实施

> 角色分工、文件所有权、并行边界、交接与裁决规则见 **§16 多 Agent 协同方案**。§11 的 P0–P7 与 §16 的 M0–M6 是同一张时间轴的两种视图：P* 是“做什么”，M* 是“什么时候算做完、由谁做”。

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| **P0 探针** | 逐时 SVG：24h 单图 + `scroll-view` 横滑 + 点选反解；测解码耗时与文字可读 | 真机 3 端；>300ms 则改 canvas |
| **P1 骨架** | `weather-hub` 两屏 + 四视图 tab + 底栏常驻；旧长页暂留 | 屏内切换、深链仍可用；E2 全绿 |
| **P2 逐时** | 原型五段图 + 读数 + 图例 + 滑块 + 详细读数 | 42px/列、24/48/72、缺值不补 0 |
| **P3 云层** | 生产统一图入 tab + 原型标题/图例位置 | 云图断言零变化；缺资料/无海拔三态截图 |
| **P4 日月** | 日照弧 + 时刻 + 三卡（接生产三态） | 时刻不被天气裁掉；excluded/unknown 文案正确 |
| **P5 后端** | `ot_plans` + 3 命令 + 权限 + 读视图 + smoke | `plans-test`、`lab-dryrun`、部署 |
| **P6 沿途** | 行程流 + 编辑弹层 + 复制 | 逆序阻止、待安排不虚构、跨天重复 |
| **P7 收口** | 首页资产三 tab、皮肤登记、A/B 对拍、变异自证、真机证据包 | E3 全量；旧页下线或保留决定 |

每阶段结束必须：`node tools/check.js` + `node tools/check-handlers.js` + 受影响套件复跑，并把计数写进 `SYNC.md`。

* * *

## 12\. 风险登记

| # | 风险 | 等级 | 处置 |
| --- | --- | --- | --- |
| R1 | 42px/列 + 72h 的 SVG 体积与解码耗时 | 高 | P0 探针；超阈值改 canvas |
| R2 | SVG 内文字字体跨端不一致 | 中 | 显式 `font-family` + 真机比对；必要时改 canvas |
| R3 | 两宿主（tab 页/独立页）状态分叉 | 中 | 单一共享单元 + `utils/weather-v3.js` 纯函数 + 结构门 |
| R4 | tab 页体积膨胀、首屏变慢 | 中 | `lazyCodeLoading: requiredComponents`；先量再优化 |
| R5 | 逐节点取数放大请求量与超时 | 中 | 串行限流 + 缓存 + 单节点失败隔离 |
| R6 | 旧门禁大面积红 | 中 | 替换式重立；旧页并存期间保留 |
| R7 | 云层“整图复用”与“只要云区”的需求分歧 | 低 | P3 先整图；要裁剪再加 `opts.sections` |
| R8 | 皮肤例外被后续审查当违规 | 低 | 设计系统登记 + 视觉门封闭表 |
| R9 | 天相被写回“资料不足” | 中 | 三态接入作为验收硬条件 |
| R10 | 计划分享导致权限泄漏（他人身份码可见 / 被授权者可写） | 中 | 复用 `routes` 的派生与投影口径；`plans-test` 分享面四条全绿；`ownerId/sharedWith` 不出投影 |

**回滚**：P1–P6 期间 `pages/weather` 旧长页保持可用；`weather-hub` 的两屏切换用单一开关（常量）控制，异常时切回入口行为。后端命令只新增，不改既有命令，回滚只需客户端不调用。

* * *

## 13\. 裁决记录（2026-10-27，已全部闭合）

| # | 问题 | 裁决 | 落到本文 |
| --- | --- | --- | --- |
| 13.1 | 云层控件语言 | 接受生产的「小时点选 + 读数行」，**放弃**「读取高度 1500–6000」 | §5.4 |
| 13.2 | 逐层云量表格 | **不保留** | §5.4 |
| 13.3 | 逐时与云层都含温度/风 | 接受（作为同一时间轴的上下文） | §5.4 末尾 |
| 13.4 | 日月是否用生产真实结论 | **允许**（possible / excluded / unknown） | §5.6 |
| 13.5 | 个人计划是否共享 | **支持**（owner 写、被授权者只读、复制归复制者） | §1.1.1、§5.1、§5.5、§8.1–8.3、§10.2 |

> 至此没有未决的产品问题。后续若出现新的分歧，按“先写判据再改实现”的惯例补进本节，不直接改 UI。

* * *

## 14\. 附录 A：原型元素 → 小程序映射

| 原型 | 小程序 |
| --- | --- |
| `<svg>` inline | `data:image/svg+xml` → `<image>`；或 canvas |
| `.chart-scroll`（DOM 横向滚动） | `<scroll-view scroll-x>` |
| `<input type=range>` | `<slider>`（外观近似） |
| `<select>` | `<picker mode=selector>` + 自绘触发区 |
| `<input type=time>` | `<picker mode=time>` |
| `history.replaceState` | `wx.setStorageSync` / `globalData` |
| `document.addEventListener('click')` 委托 | 各节点 `bindtap` / `catchtap` |
| `role/aria-selected` | 无（用 class 表达选中态） |
| `focus-visible` / 方向键 | 无 |
| `structuredClone` | `JSON.parse(JSON.stringify())` 或 `domain/contracts.deepClone` 的客户端等价 |
| `hsl()` 动态色 | 预生成色阶（SVG 内可用，但需登记） |
| `<pattern>` 斜线 | **不使用**（云层按生产样式） |

## 15\. 附录 B：验收对照表模板

| 区域 | 基准 | 判定 | 证据 |
| --- | --- | --- | --- |
| 页头 | 原型 | 待测 | 390 截图 |
| 日期条 | 原型 | 待测 | 390 截图 |
| 四视图 tab | 原型 | 待测 | 吸顶前后各一张 |
| 逐时图 | 原型 | 待测 | 24/48/72 各一张 |
| 云层图 | **生产现图** | 待测 | 缺资料/无海拔/正常三张 |
| 日月 | 原型版式 + 生产数据 | 待测 | 三态各一张 |
| 行程流 | 原型 | 待测 | 待安排/超范围/正常 |
| 弹层 | 原型 | 待测 | 6 个各一张 |
| 系统外壳 | 不计 | — | — |
| 原生控件展开态 | 不计 | — | — |
| 图表文字字形 | 不计 | — | — |

* * *

## 16\. 多 Agent 协同方案

> 本章是执行约定，不是产品设计。它解决的问题只有一个：**同一份工作树里，多个 agent 不互相踩、不重复探索、不把证据丢在临时目录。**
> 任务书格式沿用 `docs/ui-ux-redesign/agent-plan/tasks/T001.md`（自包含 / Prompt 可直接投喂）。

### 16.1 协同原则（四条，优先级从高到低）

1. **契约先行**：接口（props / events / payload / 导出签名）在 M0 冻结；冻结后任何改动必须由 R0 裁决并更新 §16.5，不允许两边各自“先写着”。
2. **文件独占**：一个文件同一时间只有一个写者（§16.3）。需要别人文件的改动 → 提给 owner，不自己动手。
3. **阶段门禁**：每个里程碑有唯一出口判据（§16.6）。出口未过，下游不开工。
4. **证据入仓**：所有验证读数、截图、交接单写进仓库（§16.8），**不得只留在 `%TEMP%` 或对话里**（历史教训：`fix-round2/state/commit-list-wave2.md` 曾因在仓库外而差点丢失）。

### 16.2 角色与职责边界

| 代号 | 角色 | 核心职责 | 可写文件（独占） | 明确不做 |
|---|---|---|---|---|
| **R0** | Orchestrator / 主控 | 冻结契约、拆任务书、裁决冲突、维护状态板、唯一 commit/push 决策 | `docs/.../weather-v3/state.md`、任务书 | 不写业务代码；不代替 owner 改文件 |
| **R1** | Chart Engineer | 逐时五段图生成器 + P0 真机探针（SVG vs canvas 选型） | `utils/weather-v3-hourly-svg.js`（新） | 不改 `meteogram-svg.js` / `cloud-field-svg.js` |
| **R2** | Detail Frontend | 共享详情单元：外壳、四视图容器、读数、图例、滑块、状态矩阵 | `components/weather-detail/*`（新）、`utils/weather-v3.js`（新） | 不改 `weather-hub` / `pages/weather` |
| **R3** | Hub Frontend | 首页改版、两屏切换、深链壳、`app.json` | `pages/weather-hub/*`、`pages/weather/*`、`app.json` | 不改详情组件内部；不改云端 |
| **R4** | Domain Backend | `ot_plans`、3 条命令、权限、读视图、`sync-lab`、部署准备 | `cloudfunctions/trailApi/**`、`trailApiLab`（仅生成） | 不改客户端；不自行部署（需授权） |
| **R5** | Plan Frontend | 行程流、编辑 sheet、分享 sheet、复制 | `components/weather-plan-sheet/*`（新） | 不改 `weather-detail` 内部（只按契约挂载） |
| **R6** | QA Gates | 新套件、变异自证、A/B 对拍、全量复跑 | `tools/**`（新增文件）；`SYNC.md` 不归他 | **不许删断言换绿**；不改生产代码 |
| **R7** | Device Verifier | 真机驱动、截图、像素/`el.text()` 双读、证据包 | `docs/ui-ux-redesign/evidence/weather-v3-*/**` | 不改代码；通道僵死按 ENV-ABORT 记 |
| **R8** | Integrator / Chronicler | 收口：`SYNC.md`、设计系统例外登记、文档回写、索引 | `SYNC.md`、`docs/**`（除状态板） | 不重复 QA 的判定 |

**角色合并规则**：小规模执行时允许 R1+R2 合并、R5 并入 R2、R8 并入 R0；**R4 与 R6 不得合并**（写实现的人不给自己立门）。

### 16.3 文件所有权矩阵（防并发冲突的唯一依据）

**热点文件（必须单写者，且只追加不重排）**

| 文件 | 唯一写者 | 说明 |
|---|---|---|
| `cloudfunctions/trailApi/domain/schema.js` | R4 | 新增 `Plan`/`Payload` 变体；不得动既有 spec |
| `domain/commands.js` | R4 | 新增 3 个 case + `summaries`；不得重排 |
| `domain/permissions.js` | R4 | 新增 `canExecute` 分支 |
| `domain/selectors.js` | R4 | 新增 `kind==='plans'` 分支 + `selectPlans` |
| `store.js` | R4 | `COLLECTIONS` 加一行 |
| `index.js` | R4 | 仅当需要新 action（本方案不需要） |
| `miniprogram/app.json` | R3 | 页面/tab 配置唯一入口 |
| `miniprogram/pages/weather-hub/*` | R3 | 两屏宿主 |
| `miniprogram/pages/weather/*` | R3 | 深链壳 |
| `components/weather-detail/*` | R2 | 详情唯一实现 |
| `utils/weather-v3.js` | R2 | 状态机；他人只读 |
| `utils/weather-v3-hourly-svg.js` | R1 | 纯函数生成器 |
| `SYNC.md` | R8 | 变更日志唯一写者 |
| `tools/check.js` / `check-handlers.js` | 不动 | 已覆盖，无需改 |

**生成产物**

- `cloudfunctions/trailApiLab/**` 只能由 R4 在改完 `trailApi` 后跑 `node tools/sync-lab.js` 生成；**任何人不得手改**。
- `docs/.../state.md` 由 R0 维护；各 agent 只提交“自己的行怎么变”，不直接改文件（避免同时写）。

**只读区（任何人不得改）**

- `miniprogram/app.wxss` 的 `page` 块与全站 token；
- `meteogram-svg.js` / `cloud-field-svg.js` / `weather-cloud-field.js`；
- `miniprogram/utils/api.js`；
- `docs/prototypes/ourtrail-explore-v3/**`（原型冻结，只读参考）。

### 16.4 依赖图与并行边界

```
M0 契约冻结（R0）
 ├─ M1a 图表探针        (R1)  ─┐
 ├─ M1b 后端 plans      (R4)  ─┼─ 可并行（写集不相交）
 └─ M1c 门禁骨架+基线   (R6)  ─┘
        │
        ├─ M2a 详情外壳/四视图 (R2)  ← 依赖 M0 契约，不依赖 M1
        └─ M2b 首页两屏/深链   (R3)  ← 依赖 M0 契约，不依赖 M1
                 │
M3 集成：R2 接 R1 图、R3 接 R2 组件、R5 接 R4 后端
                 │
M4 门禁全量 + 变异 + A/B（R6）
                 │
M5 真机 E3（R7，需授权）
                 │
M6 收口（R8）
```

- **可并行**：R1 / R4 / R6（M1）；R2 / R3（M2）；R5 与 R3 的首页资产区。
- **必须串行**：`weather-hub` 挂载详情组件之前，R2 必须交付可用版本；`sync-lab` 只能在 R4 改完后跑；`check.js` 全仓门在每次合并前跑。
- **不可并行**：R2 与 R3 同时改 `components/weather-detail` 的接口；R4 与任何人同时改 `cloudfunctions/**`。

### 16.5 冻结的接口契约（M0 产出）

| 契约 | 形状 | 归属 |
|---|---|---|
| 详情上下文 | `{ place, node, day, cursor, period, tab, level }`；`tab ∈ hourly/cloud/route/sky` | R2 定义，R0 冻结 |
| 详情组件 props | `mode`（`tab`/`deep`）、`activityId`、`local:{setId|lat,lng}`、`initial:{node,day,cursor,tab}` | R2 |
| 详情组件 events | `bind:screenback`、`bind:opendetail`、`bind:sharestate` | R2 |
| 纯逻辑导出 | `utils/weather-v3.js`：`initialState()` / `setTab()` / `selectHour()` / `changePeriod()` / `dayStrip()` / `readoutOf()` | R2 |
| 图表生成器 | `buildHourlySvg({series, cursor, period, node, width}) → { svg, width }` | R1 |
| 计划 payload | `plan.create {input}` / `plan.update {planId, input, expectedRevision}` / `plan.delete {planId, expectedRevision}` | R4 |
| 计划读视图 | `{ kind:'plans', plans:[{id,routeId,name,startDate,stops,visibility,isOwner,sharedBy,updatedAt}] }` | R4 |
| 皮肤变量 | 根节点 `.weather-v3` 上的 `--w-*`；组件 `apply-shared` | R2 定义，R8 登记 |

冻结后的变更流程：提出方写进交接单 → R0 判定 → 更新本节 + 通知所有消费方 → 消费方各自改自己的文件。

### 16.6 里程碑出口判据

**P ↔ M 的对齐（不是一一对应）**

| §11 阶段 | 内容 | 对应里程碑 |
| --- | --- | --- |
| P0 | 图表选型探针 | M1a |
| P1 | 两屏 + 四视图壳 | M0 契约 → M2a / M2b |
| P2 | 逐时图 + 读数 | M2a → M3 |
| P3 | 云层（生产图入 tab） | M3 |
| P4 | 日月（版式 + 三态） | M3 |
| P5 | 后端 plans | **M1b（前置并行，不等 UI）** |
| P6 | 沿途行程流 | M3 |
| P7 | 收口（门禁/真机/SYNC） | M4 / M5 / M6 |

> P5 被提前到 M1b 是刻意安排：后端是**关键路径**，与 R1 图表、R6 门禁骨架的写集不相交，可完全并行；若等 UI 做完再开后端，整个项目会多出一个串行往返。

| 里程碑 | 出口（全部满足才算过） |
|---|---|
| M0 | 本章 §16.5 全部填满；任务书 T01–T08 落盘；状态板可读 |
| M1a | 探针在 390 宽、24/48/72h 各出图；解码耗时读数记录；选型结论（SVG/canvas）写入交接单 |
| M1b | `plans-test` 全绿；`lab-dryrun` 全绿；`sync-lab` 已跑且 diff 为空；部署**待授权** |
| M1c | 基线读数表（受影响 8 套各跑一次）落盘 |
| M2a | 四视图空壳可切换；读数/图例/滑块渲染；`check.js` + `check-handlers` 通过 |
| M2b | 两屏切换、深链壳、底栏常驻；`journey-graph` 通过（无死页面/无无返回路径） |
| M3 | 十项联调清单逐条过（见 §16.7） |
| M4 | 新增 7 套全绿 + 变异 0 漏网 + A/B 业务差异 0；旧 8 套不倒退 |
| M5 | 6 区对照截图 + 缺资料/无海拔/超范围/stale 四态；UNVERIFIED 逐条列明 |
| M6 | `SYNC.md` 有本轮条目（含部署需求、真机状态、门禁计数）；设计系统例外已登记 |

### 16.7 联调清单（M3，R0 主持）

1. 首页选点 → 详情：上下文正确（地点/节点/日期/小时）
2. 四视图切换：地点、节点、日期、小时不丢
3. 逐时点列 ↔ 滑块 ↔ 前后步进 三者同步
4. 时长切换：保留当前时刻并重设窗口起点
5. 云层图点选 → 读数行与小时间一致
6. 沿途流「待安排」→ 不虚构时刻
7. 编辑计划：同日逆序被阻止、保存后回到行程流
8. 分享计划：被授权者只读、可复制
9. 深链：活动/观察点/分享链接进入后返回正确
10. 六态：loading / empty / error / stale / outOfRange / denied

### 16.8 交互方式：任务书、状态板、交接单

**目录**

```
docs/ui-ux-redesign/agent-plan/weather-v3/
├── README.md          # 一页索引：角色、依赖图、里程碑
├── state.md           # 状态板（R0 维护）
├── contracts.md       # §16.5 的冻结副本（R0 维护）
├── tasks/
│   ├── T01-chart-probe.md
│   ├── T02-detail-shell.md
│   ├── T03-hub-screens.md
│   ├── T04-backend-plans.md
│   ├── T05-plan-ui.md
│   ├── T06-gates.md
│   ├── T07-device.md
│   └── T08-sync.md
└── handoffs/
    └── H-<Txx>-<agent>.md
```

**状态板（`state.md`）字段**

| 任务 | owner | 状态 | 分支/worktree | 最后读数 | 阻塞 | 更新时间 |
|---|---|---|---|---|---|---|
| T01 | R1 | doing | `win/weather-v3-chart` | — | 无 | 10-27 20:10 |

状态取值：`todo / doing / blocked / review / done`。**只有 R0 能把 `review` 改成 `done`。**

**任务书模板（照 T001 格式）**

```md
# Txx — <一句话目标>

- 目标：
- 设计输入：（原型文件 / 截图 / 本文档章节）
- 代码阅读范围：（只列本任务需要的文件，避免重复探索）
- 允许修改：（精确路径）
- 禁止修改：（精确路径 + 冻结区）
- 前置依赖：（任务号 / 契约条目）
- 步骤：1) … 2) … 3) …
- 业务不变量：（引用 §7 / §8 / 铁律编号）
- 状态：正常=…；异常=…（异常即停并交接）
- 测试：`node tools/…`（逐条列出，含预期读数）
- 视觉验收：NOT_RUN / E3（需授权）
- 回滚：单提交 revert / 删除新增文件
- 完成定义：（可机器判定；含 `git diff --stat` 只含允许文件）
```

**交接单模板（`handoffs/H-Txx-<agent>.md`）**

```md
# H-Txx · <agent> → <next>

## 产物
- 改动文件：…（附 `git diff --stat` 输出）
- 新增文件：…

## 验证
- 已跑：`node tools/xxx-test.js` → passed=N failed=0
- 已跑：`node tools/check.js` → ALL CHECKS PASSED

## 接口（给下游）
- 导出了什么 / props / events / payload

## 未验证（UNVERIFIED）
- 真机未跑：…
- 外部依赖：…

## 阻塞 / 需裁决
- …

## 回滚
- `git revert <sha>` 或删除 <文件>
```

**交接纪律**

- 交接单必须落盘，**不允许只在对话里说“我做完了”**；
- 下游接手前先读交接单 + 状态板，不读全仓；
- 一次交接只覆盖一个任务；跨任务改动视为越界。

### 16.9 冲突、阻塞与升级

| 情形 | 处理 |
|---|---|
| 两个 agent 要改同一文件 | 以 §16.3 裁决；非 owner 提交“需求说明”，不提交代码 |
| 契约不够用 | 停写 → 写进交接单 → R0 更新 §16.5 → 再开工 |
| 门禁红但认为断言过时 | 不允许直接改断言；写“判据替换提案”（旧断言为什么不再成立 + 新断言更强在哪），由 R6 与 R0 双签 |
| 连续两次修复失败 | 标 `blocked`，写 OPEN 记录，**不硬试**（本仓有过“注入失败被计漏网”的教训） |
| 需要部署 / 真机 | 只能由用户授权；agent 只准备命令与证据包 |
| 工具链僵死（开发者工具） | 按 `docs/e2e-mp/automation-playbook.md` 记 ENV-ABORT，不猜 PASS |

### 16.10 分支与工作树

- 沿用 `PARALLEL_DEV.md`：**不直接推 `master`**；本机分支 `win/weather-v3-<slice>`。
- 单机多 agent 建议**每人一个 `git worktree`**（例如 `..\wt-chart`、`..\wt-detail`），避免同一工作树互相覆盖未提交改动；合并由 R0 在集成 worktree 完成。
- 同一 worktree 内**禁止两个 agent 同时写**（文件所有权只解决“谁写”，不解决“同时写”）。
- 合并顺序：后端 → 图表 → 详情 → 首页 → 沿途 → 门禁 → 文档。

### 16.11 上下文预算（防止重复探索）

- 每个任务书列“代码阅读范围”，agent 只读这些文件 + 本文档对应章节；
- 已在本轮勘察过的结论（原型数值、云端契约、门禁清单）直接引用本文档，不再重读原型；
- 任何 agent 发现文档与代码不一致 → 记进交接单「文档漂移」，由 R8 回写，**不擅自按代码改文档结论**。

### 16.12 与既有仓库惯例的接口

- 提交前必跑：`node tools/check.js` + `node tools/check-handlers.js` + 受影响套件（铁律 3）；
- 云函数改动：`sync-lab` → 部署 `trailApi` + `trailApiLab`（§8.5）；
- 每轮收口写 `SYNC.md`（根因 / 修法 / 门禁计数 / 是否需要重新部署 / 真机状态）；
- 视觉结论只用 E1–E4 表述，禁止“看起来更好”这类无法判定的句子。