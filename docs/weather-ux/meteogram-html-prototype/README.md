# Weather Meteogram 高保真 HTML Prototype

日期：2026-10-06（V1–V7 迭代）· Real Open-Meteo Data POC · 性质：**视觉设计验证原型**（非生产代码，不进小程序包）
上游输入：[../meteoblue-web-poc/technical-findings.md](../meteoblue-web-poc/technical-findings.md) ·
[../weather-page-v2-design.md](../weather-page-v2-design.md) · [../decision.md](../decision.md) ·
[../current-weather-architecture.md](../current-weather-architecture.md)

> 回答一个问题：**「这张天气图到底应该长什么样」**——在写任何小程序代码之前，
> 先在浏览器里把视觉结构、信息密度、交互模型定稿。

## Real Open-Meteo Data POC（真实数据验证）

`real-data.js`（POC 层适配器）+ `?real=litang|daocheng|emeishan|chengdu`：
用真实预报驱动同一套 renderer，验证等值带云场在真实数据下是否成立。

```
Open-Meteo（气压层 cloud_cover_*hPa + geopotential_height_*hPa，变量名与生产
            lib/weather.js CLOUD_LEVELS 同源；POC 增密中层 750/675/650/550/500/450）
  → 适配器：气压 → 海拔用 geopotential_height（生产 cloudBandAt 同款映射，
    公式仅兜底）；地下层（山区低压层）Open-Meteo 返回 null，逐时跳过插值
  → cloudField = { times, altitudes, values }（0–7000m，250m 网格）
  → renderer 只消费 Time × Altitude × Cover（双线性采样），不知道数据来源
```

- `?real=…` 可与 `&debug=1` 组合；加载失败自动回退 mock 并在读数条说明；
- mock 路径不变：mock 的 hourView 三层云量 + band 经由「数据适配层」
  （rawAt 密度剖面）合成同样的场结构——两种数据源在 renderer 前汇合；
- 「你在云中 / 云海 / 云在头顶」全部由场采样推导（`field(t, ELEV)` 等阈值），
  ELEV 泛化为任意海拔（成都 500m 时 YOU 线钳到面板下缘并标注）；
- 四地点实测截图：`screens/real-*.png`（理塘/稻城/峨眉山/成都）。

### Renderer Audit（真实数据尖角取证，2026-10-06）

峨眉山真实场 01–10h 曾出现三角形/楔形。取证方法：`?debug=2` 叠加原始采样点
（○ = 有效气压层样本，位势高度定位）+ 画布像素采样 + API 原始值对照。

**尖角来源判定：[×] 插值 [×] isoband 几何（已修）——非原始数据、非海拔映射。**

1. 采样点普查：21 层在峨眉山全部有效、垂直间距准均匀（无采样空洞、无重复海拔）；
2. 根因一：时间维**分段线性插值**在每个整点站产生等值线折角 → 改为
   Catmull-Rom（过站点平滑曲线，端点与值域双重钳制），mock 与 real 同一数学；
3. 根因二：等值网格 0.5h×100m 偏粗 → 加密至 0.25h×50m；
4. 根因三：数值噪声碎片 → 微环面积过滤（<12px² 剔除，有意义的孤立小云区保留）；
5. 未动真实数据一个字节：区域尖灭（如峨眉山 05–07h 700hPa 层 42%→13% 先消、
   500hPa 层 47%→56% 后消的差异消散斜边）确认为数据特征，如实保留。

## Mini Program SVG Migration POC（`miniprogram/pages/cloud-field-poc/`）

renderer 迁移验证（WXML 无 `<svg>` 标签 → 静态 SVG data-URI + `<image>` 双层）：

```
miniprogram/utils/cloud-field-svg.js      纯 renderer（wx-free，Node 可测；
                                          数学从 prototype V7 逐函数提取，未改逻辑）
miniprogram/pages/cloud-field-poc/*       POC 页：数据集切换 / 选中 chips / 双层 image / 性能 HUD
miniprogram/pages/cloud-field-poc/fixtures.js  冻结场（mock + emeishan + litang，0–7000m/250m）
tools/cloud-field-svg-test.js             27 断言：正确性 + 确定性 + 性能基准
```

- 数据契约：renderer 只接受 `{times, altitudes, values}`（values[time][alt] = cover%）；
  mock（hourView→密度剖面）与 real（气压层→位势高度）在适配层汇合成同一结构；
- 分层渲染：基础场（等值带+海拔线+入云交线+昼夜底）按数据集构建一次；
  **选中时刻只重生成小 overlay svg**（<1KB，毫秒级），不重算场与等值带；
- 性能（Node 稳态）：峨眉山 8ms 构建 / 5ms 等值带 / 5 条 path 1486 点；基础 svg
  38–60KB；选中切换 <1ms；SVG 生成 12–37ms；
- 浏览器已验证（与小程序 `<image>` 同为栅格化静态 SVG）：375/390/414 三宽度、
  三数据集、选中层叠加、采样点叠加（POC 默认开；生产集成时不传 rawSamples 即无点）；
- **待人工验证**：微信开发者工具（服务端口+扫码登录，见 docs/e2e-mp/README.md）
  编译打开 `pages/cloud-field-poc/cloud-field-poc`，核对 data-URI `<image>` 渲染、
  clipPath/文字/透明度表现与真机差异；POC 页含「实时抓取」（wx.request，
  DevTools 需勾选「不校验合法域名」）。

## Weather V2 Phase 1 —— 生产集成（2026-10-07）

Cloud Field 正式接入生产数据链路与现有天气页（additive，全部可降级）：

```
cloudfunctions/trailApi/lib/weather.js
  · CLOUD_LEVELS 9 → 23 层（加密中层，山区 2000–6000m 剖面不再稀疏）
  · buildCloudLevels(times, h, start, count)：cloudLevels 透出结构
    { times[24], levels: [{pressure, altitudes[24], cloudCover[24]}], unit }
    —— null 可识别、NaN 不出数据层、整层全空省略、异常整体返回 null
  · fetchForecast / pointResponse / index.js getWeather：additive 透出
miniprogram/utils/weather-cloud-field.js
  · 适配器：生产返回体 → cloudField{times, altitudes, values, userAltitude, covered}
  · 缺失小时用最近可用列回填（meta.gapHours 可查）；覆盖范围外不采样
miniprogram/utils/cloud-field-svg.js
  · 冻结 renderer（复用）；新增 inferState coverage 参数：
    用户海拔在场覆盖范围外时按「覆盖区与用户相对位置」推导（成都 500m 场景）
miniprogram/pages/weather/
  · applyWeather：构建 Cloud Field 卡（几何按 updatedAt|date|elev|width 缓存）
  · selectHour：图上选小时 → 云场 overlay 同步（<1ms，不重算等值带）
  · 云场卡自带 0–23 时刻条 → 与图共用 selectHour 单一链路
  · 数据缺失/渲染异常 → 整卡隐藏，其余天气功能不受影响
tools/weather-cloud-field-test.js        29 断言（数据/适配/三态/沉默/覆盖语义/性能）
cloudfunctions/trailApi/smoke-test.js    +12b 段（cloudLevels 8 断言）
```

真实三地点生产管线验证（`screens/prod-*-375.png`）：峨眉山午后云层上金顶、
理塘高层云 + 低层碎云、成都全天晴——三态推导与沉默优先全部正确。
**待办**：云函数重新部署 trailApi 后生产生效（部署前旧缓存响应无 cloudLevels，页面自动降级）。

## Weather V2 Phase 2 —— 统一 Meteogram（2026-10-07）

温度/降水/Cloud Field/风 从「三张独立图」融合为**一张统一天气图**：

```
miniprogram/utils/meteogram-svg.js        统一渲染器（新增）：
  · 单一 timeScale：X(h) = L + (h+0.5)·plotW/24，四变量全部共用
    （云场等值带网格同一线性映射，仅差半列的采样中心/边界约定）
  · 行结构：天气图标+温度曲线（墨色+极值标注）→ 降水双柱（+pop≥50 底带）
    → Cloud Field（冻结等值带 + YOU 线 + 入云交线）→ 风向箭头+风速/阵风曲线
    → 共用时间轴；行间距自适应由 plotW 承担（375/390/414 同字号）
  · 单根 crosshair：选中时刻只重生成全高 overlay（<1ms），贯穿四变量
miniprogram/pages/weather/weather.js + wxml/wxss
  · cloudLevels 可用且 viewSpan=24 → 统一卡（读数三级：L1 天气事实 /
    L2 云场事实 / L2.5 OurTrail 解读（色区分））
  · cloudLevels 缺失或 48/72h 视图 → 回退经典 canvas meteogram（原样保留）
  · 云态文案 presentation 修正：云在头顶 → 头顶有云层（算法/阈值未动）
cloud-field-svg.js                        导出场数学（makeColumnSampler/buildFieldGrid/
                                          isoBandsFromGrid/sampleAt 等）——只导出未改数学
```

- 三地点 × 375/390/414 × 06:00/16:00 全组合验证（`screens/unified-*.svg/png`）；
- 回归：meteogram-svg-test 25/25（新增）+ Phase 1 全套 29/27/167/136/45/82/65 +
  check/check-handlers/e2e 71/1/1 全绿；
- **待办同 Phase 1**：trailApi 重新部署（NOT DEPLOYED）；DevTools/真机人工核验清单。

## V7 isoband contour renderer（V6 栅格场的收口）

V6 的 48-strip 栅格渲染解决了「云对象」问题，但带来新的「模糊热力图」感：
可见的采样列 + 渐变过渡 = heatmap 语言。V7 保持 `cloudCover(time, altitude)`
二维场模型不变，只把**场的表达**换成专业气象图语言：

```
场网格（0.5h × 100m，含复制边缘的外扩圈）
  → 3×3 数学平滑 ×1（几何平滑，非 blur filter）
  → marching squares：按 10 / 25 / 50 / 75 / 90% 五条等值线提取连续等值区域
  → 端点链合成闭合环 → Chaikin 圆化一轮
  → 由浅到深嵌套 SVG path 填充（evenodd，clip 裁掉出界部分）
```

- **没有 grid cell**：每个等值带是整条闭合 path，无逐块填充；
- **没有 blur**：边界清晰、结构清楚，平滑全部发生在场数据上；
- **边界连续、自然弯曲**：marching squares 线性插值 + Chaikin，等值线随场弯曲，
  局部深核（如晨带 90%+ 核心、午后对流核心）自然出现；
- **区域可以接近/融合/分离**：等值线拓扑随场演化，但没有「几朵云」的对象语义；
- 云量灰阶五档与图例「淡→浓」带严格一致。
- 实现细节：场网格外扩一圈复制边缘值 → 贴边云自然出血；ambiguous case（5/10）
  以固定走向拆分；isosurface 全部闭合（外扩圈保证），clip 裁剪出界段。

## V6 Cloud Cover Field（渲染模型更换，V7 沿用其场函数与解读层）

V1–V5 的云图无论多平滑，本质都是「把 low/mid/high/band 画成若干云对象的形状」——
用户看到的是**几块云**。V6 把渲染模型整个换掉：

```
Weather Data（hourView：low/mid/high 云量 + band 云底/顶/量）
        ↓  垂直密度剖面（平台 + smoothstep 渐变沿，无硬边界）
        ↓  确定性低频调制（高度×时间正弦，±8%，无随机噪声）→ 各层不同步、等值区不规则
cloudCover(time, altitude)  ——  二维连续采样场（0–100%），各层取 max 合成
        ↓  （V6：48 条渐变 strip 栅格 → V7：marching squares 等值带，
           详见上方 V7 章节）
Cloud Field 渲染（没有任何云轮廓 / 云底顶线 / 透镜 / 楔形 / polygon）
        ↓  全部解读由场采样推导
OurTrail Interpretation：你在云中 = field(t,3500)≥60；云海 = 用户以下峰值≥68
且用户处 <45；读数条「云区」= 场 ≥70% 密集区间（峰值所在区）；事件道同源
```

- **不存在 cloud base/top polygon**：band 的 base/top 只是密度剖面的输入参数；
- **不存在逐时云对象**：strip 之间线性插值，场的演化连续；
- **3500 m 线只是参考线**：删掉它云场自身完全成立；
- **`?debug=1`**：只渲染云场面板（+时间轴+海拔线），直接判断 renderer。

实现备注：SVG 线性渐变的 stop offset 必须非递减（乱序会被钳制成平色）——
strip 的 stops 从面板顶部向底部升序输出；strip 采样时刻为 `(k+0.5)·Δt`，与时间轴零偏移。

## V5 密度渐变收口（已被 V6 渲染模型取代，交互/图例/页脚规范沿用）

V4 的云场仍有最后一处「物体感」：每段等值带是**均匀填充**，读作几个平滑的灰色
云团对象。V5 只改一件事——**让密度在层内连续变化**：

- 每层云的填充从平色改为一条沿时间轴的 `userSpaceOnUse` 线性渐变，
  **每个小时一个 stop（色 = 该时云量档位灰阶）**，SVG 在相邻 stop 间自动插值；
- 形状不变（V4 的连续包络 + 楔形边界原样保留），只换填充：90% 深核在晨带里
  缓缓鼓起又退去，中云盖随午后对流渐深渐浅，低云在边缘淡出——
  「云量在大气空间中随时间变化」，不再是沿时间轴移动的均匀物体；
- 档位灰阶语义不丢（渐变 stop 就是那五档色），图例的「淡→浓」连续带与之严格对应。

配套三处微调（其余一律未动）：

- **选中态减重**：竖线 0.5px/40% 透明、列洗降至 3.5%、去掉 YOU 交点圆点与
  加粗风向箭头复绘、圆环缩小——时间牌保留，成为唯一的中等强度元素；
- **图例两行有意排版**：第一行 = 图形变量（云量带/雨/温度/风），第二行 = 唯一
  需要解释的约定（风向箭头指向），不再依赖 accidental wrapping；
- **页脚再弱化**：8px 最浅灰，数据源说明不与天气内容争注意力。

## V4 Cloud Field + 最后 5%（依据对 V3 截图的人工评审）

V3 的结构、图层与交互语义**全部保留**。V4 两件事：

**A. 云剖面 → 连续大气云场（Cloud Cover Field）**

V3 的逐时四边形仍留有「每小时一道色阶缝」的格子残留。V4 重写云渲染：

- **每层云 = 一条连续平滑包络 + 按档位分段的等值填充**：包络（云底/云顶曲线）
  整层一条 Catmull-Rom 路径，永不逐时跳动；五档灰阶只在「真实发生档位变化的
  小时」分段，段与段共享同一条包络——meteoblue isoband 的构成方式：
  场是连续的，等值面是分档的；
- **楔形层边界**：层的起止边缘（云出现/消散处）顶层曲线向云底收成楔尖——
  云在边缘变薄消失，不再垂直切墙；档位之间的边界保持垂直色阶（isoband 语义）；
- **层厚随云量伸缩**（V3 语义保留）：低云散去薄成一线、中云随发展增厚下压、
  高云平时沉在 6000 m 视野之上、增多时才降入图中；
- **「你在云中」回归推导注释**：删除面板内整列底色；入云时段改为
  3500 m 海拔线上的一段琥珀色实线——「云层 ∩ 用户海拔」的交集可视化，
  与事件道的入云段同色同源。

**B. 最后 5% 产品化**

- 读数条数字层级：云量/云底/云顶/风速数字用墨色 tabular-nums 强调，标签退为灰色；
- 图例压缩：云量五档数据字典 → 一条「淡→浓」连续灰阶带；
- 页头去掉 Open-Meteo 开发标记（移至页脚），更新时间为末级灰；
- 其余（事件道、时间牌、时间轴）V3 已定型，未动。

## V3 视觉精修（依据对 V2 截图的人工评审，只解决三个问题）

V2 的结构、图层与交互语义**全部保留**。V3 只做精修：

**A. 一张图（最重要）**
- 删掉四个面板的独立标题条（「温度 °C」「降水 mm/h」…），单位并入顶部刻度标签
  （`16°` / `3 mm` / `6000 m` / `30 km/h`），面板间隙 16px → 9px；
- 昼夜底色与竖网格本就连续贯穿，标题条移除后四个区域融为一体；
- 降水面板去掉 1/2mm 内部横线，只留刻度，减少横向分块感。

**B. 云剖面连续化**
- 所有云层改为**变厚度平滑包络**：层厚随云量伸缩（云越厚层越深越厚），
  边界二轮滑动平均，逐时四边形填充（保留五档灰阶的阶梯语义）；
- 高云在转晴时沉出 6000m 视野、低云散去时薄成一线——垂直方向读作
  「云层在空间中的连续分布」，不再是矩形堆。

**C. OurTrail 事件道去甘特化**
- 彩带从 3.5px 粗条改为 2.5px 细带 + 两端小竖线（annotation span 语言）；
- 标签只写「云海」「入云」，删掉 `00–10h` 区间文字（区间由共享时间轴表达）；
- 标签从居中改为左对齐（跟随 OURTRAIL 前缀，读作一句话而非甘特行）。

**附带小精修**
- 选中线 0.75px/75% → 0.6px/55%，删除云面板整列描边；新增「选中时刻 × 3500m」
  交点小圆点（此刻你在剖面上的位置）；
- 读数条隐藏湿度/能见/体感（按评审要求），云行改为
  「云 3,120–3,820 m · 量 86% **→** 你在云中」——事实在前、解读在后，箭头表达推导；
- 页头数据源/更新时间弱化为最末级灰色。

## V2 视觉迭代（依据对 V1 截图的人工评审）

V1 验证了「温度/降水/云剖面/风/时间轴能组成一张 meteogram」，但暴露的核心问题是
**所有信息平铺、没有层级**。V2 不加信息，只做减法与分层：

| V1 评审问题 | V2 处理 |
|---|---|
| 图例 14 项平铺，气象变量与 OurTrail 解读混在一级 | 图例只留天气可视化（云量五档/连续雨/阵雨/温度/风速/阵风/风向）；「云海 / 入云」移入图表内的 **OURTRAIL 事件道** |
| 「你在云中」「观景点」与温度/风像同一级变量 | 解释层获得自有视觉语言：时间轴下方的彩色事件段（与云面板底色同色）+ 读数条里的彩色状态词；不再进图例 |
| 顶部读数像「天气 API 返回结果」 | 三级层级：主行（时刻/温度大字号/天相/降水量）→ 云行（状态词 + 云底顶）→ 小行（风/湿/能见/体感） |
| 贯穿竖线含义不明（选中？当前？） | **默认无任何贯穿线**；点选后 = 底部时间轴上的森林绿时间牌 + 0.75px 细线 + 极轻列洗；再点同列取消。视图是全天展望，无「当前时间」标记，二者不会混淆 |
| 四个区域像四张独立小图 | 去掉四面板边框盒，整图只剩一个外框；共享竖网格 + 底部唯一时间轴；面板靠标题条与留白分隔 |
| 云剖面像方块堆积 | band 层改**平滑包络**（base/top 滑动平均）+ 逐时四边形填充——轮廓有机、内部仍按五档灰阶阶梯（meteoblue 的「软轮廓 + 阶梯色」质感）；中/高云按同色相邻列合并成 patch，减少 24 道竖缝 |
| 温度/降水/云/风权重不分 | 温度 = 1.5px 主线；降水 = 柱；云 = 最大面板；风 = 底部辅助（0.9/1.1px 细线） |
| 信息重复 | 图上不写逐时数值（数值只在点选读数条出现）；云高不写在图上（图形表达）；「无降水」不再占主行 |

存档对照：`screens/v1/`（V1 原始截图）vs `screens/`（V2）。

## 打开方式

```bash
cd docs/weather-ux/meteogram-html-prototype
python3 -m http.server 8137
```

- mock：`http://127.0.0.1:8137/`
- 真实数据：`http://127.0.0.1:8137/?real=litang`（或 daocheng / emeishan / chengdu）
- 纯云场评审：加 `&debug=1`（如 `?debug=1&real=litang`）

零依赖、零构建，三种方式任选：

```bash
# 1) 直接双击 index.html（file:// 即可运行，无 fetch/module）

# 2) 或起一个本地服务
cd docs/weather-ux/meteogram-html-prototype
python3 -m http.server 8137
# → http://127.0.0.1:8137/

# 3) 桌面浏览器打开后，用页内工具条切换 375 / 390 / 414 / 满宽(430) 模拟手机宽度
```

## 文件

| 文件 | 职责 |
|---|---|
| `index.html` | 页面骨架：工具条 / Header / 读数条 / SVG 图表 / 图例 |
| `styles.css` | 页面样式（图表内的文字样式在 SVG 属性里，便于逐字迁移） |
| `mock-data.js` | 格聂 3,500 m · 2026-10-06 全天 24h 手工 mock（`window.OT_MOCK`），含 console 自检 |
| `meteogram.js` | 渲染器 V2：布局计算 → SVG 字符串 → 交互（点选时间牌 + 三级读数条） |
| `screens/` | V7 mock 自检截图 + `real-*.png` 四地点真实数据截图；`screens/v6/`…`v1/` 为历史版本存档 |
| `real-data.js` | Real Open-Meteo 适配器（POC 层）：气压层 → cloudField，见上方「Real Open-Meteo Data POC」 |

## 图层清单（自上而下）

1. **温度面板**：3h 间隔手绘天气图标（纯 SVG path，无 emoji/图片）+ 温度标注、
   逐时温度平滑曲线（1.5px 主线）+ 轻填充、日最高/最低红字标在峰谷侧位；
2. **降水面板**：逐时柱状，连续雨（深蓝）在下、阵雨（浅蓝）叠上，纵轴 mm/h；
3. **云量·海拔剖面**（视觉主角，纵轴 2000–6000 m）：
   五档灰阶云块（band 层平滑包络 + 其余层同色合并 patch）+ **观景点海拔线「你 · 3,500 m」**
   + 三态底色（云在脚下=绿 / 你在云中=琥珀 / 云在头顶=无色，色与事件道同源）；
4. **风面板**（底部辅助）：逐时风向箭头（指向吹去的方向）+ 风速/阵风双细线；
5. **公共骨架**：整图单一外框、贯穿竖网格（每 2h）、底部唯一时间轴（逐时小刻度）、
   **OURTRAIL 事件道**（时间轴下方：绿段「云海 00–10h」/ 琥珀段「入云 15–18h」，
   解释层自有通道）、昼夜底色（夜间极轻灰蓝 + 晨昏 45min 过渡）、单层天气图例、
   点选读数条。

## Mock 数据的故事线（三种云状态刻意全部出现）

| 时段 | 天气 | 云状态 |
|---|---|---|
| 00–10h | 毛雨收尾 → 日出 07:06 | 低云带 2,260–3,300 m 在观景点下方（**云在脚下** = 云海窗口） |
| 11–14h | 短暂晴朗，14.1 °C 峰值 | 带消散；中云发展压低（抬头见云在聚集） |
| 15–18h | 阵雨 1.2–2.2 mm/h，阵风 29 | 对流云团 3,120–3,950 m 罩住观景点（**你在云中**） |
| 19–23h | 转晴冷，月夜 | 低云散、中高云残留（**云在头顶** → 无带） |

字段形状对齐生产 `NormalizedWeatherData` hourView（与 `mock/genie-72h.js` 同源同义）。
唯一刻意超出生产规则的时段：10h 带 cover=72%（<80 不成带），用于验证「薄带消散」的
可视化；生产 `cloudBandAt` 不会产生它。

## 参考了 meteoblue 什么 / 哪些是 OurTrail 自己的

**参考（信息表达方式，非代码）：**
- 三面板同轴堆叠的总体结构（温度带 → 降水+云剖面 → 风）；
- 五档灰阶云量图例（10–25% … 90–100%）与块状（非平滑）云剖面质感；
- 风向箭头一行 + 风速/阵风双曲线；昼夜底色；日最高/最低标在温度曲线上；
- 克制的工程图气质：白底、细线、小字号、高信息密度、无装饰渐变。

**OurTrail 自己的设计：**
- **观景点海拔线**贯穿云剖面（meteoblue 只有抽象海拔轴，不知道「你」在哪）；
- **三态底色**：把 v2 设计文档 §2 的「云在我脚下 / 罩住我 / 在我头顶」直接画成底色，
  与读数条的状态 chip 同色同源；
- **点选读数条**：整列贯穿高亮 + 顶部事实读数（降水/云底云顶/风/湿度/能见度/体感），
  是未来 Evidence / Outdoor Analysis 的交互基座；
- 全中文、移动端 375px 原生密度（meteoblue 桌面密度缩到 375 实测不可读，
  见 meteoblue-integration-v2.md §5.1）；
- 图标为自绘 24×24 stroke glyph（无 emoji、无图片资源、可迁 SVG/canvas）。

## 交互（V2 语义）

默认**无选中**：图上没有贯穿线，读数条显示操作提示——纯事实视图。
点按任意小时列 → 该列出现「时间牌」（时间轴上的森林绿牌）+ 0.75px 细线 + 极轻列洗
+ 各面板元素细描边，读数条显示该时刻三级事实。再点同一列取消。
事件道与读数条中的「云海 / 入云 / 云在脚下 / 你在云中」是 OurTrail 标注层，
与气象事实在视觉上分离（位置、颜色通道、字号均不同源）。

## 小程序 SVG 迁移注记

- 全部图元只用了 `rect / line / path / circle / text / g / use / linearGradient`——
  每一项都有 canvas `ctx` 对应指令；若走 `<image>`+data-URI SVG 路线也可整体序列化；
- 布局是「测容器宽 → 算像素 → 画」，与小程序 canvas 的 `getNode().width` 手势同构，
  无 CSS 布局依赖；
- 图标用 `<use>` 复用，对应小程序侧「图标绘制函数 + 参数复用」；
- 唯一要注意的是 `paint-order: stroke`（文字描边底）在小程序 canvas 需改为
  「先画描边字再画填充字」两遍。

## 已知限制 / 下一轮候选（V4 后）

1. 单日 24h 窗口，日期换日分隔线（Tue 06 → Wed 07）已设计未启用——48h/72h 窗口
   是下一步（同画布换窗，v2 设计 §16）；
2. 中/高云的变厚度包络是**演示用合成模型**（边界由云量推导）。生产数据没有逐时
   云底云顶——接入时需要决定：按固定气压层画，还是保留「厚度随云量」的视觉模型
   （低云的 band 有真实 base/top，不受影响）；
3. 事件道只有 云海/入云 两类；黄金光/蓝调/星空接入需要不冲突的通道编码；
4. 逐时 24 支风向箭头密度到顶，加变量需降为 2h 一支；
5. 图例 2 行（375px），若要单行可把「风向（指向吹去方向）」缩为「风向」。

## 自检记录（任务书 §25 的 12 问）

375 / 390 / 414 / 桌面 430 四档实测（截图见 `screens/`）：

1. 第一眼像专业 Meteogram？**是**——三面板同轴、灰阶剖面、细网格，观感对齐 meteoblue；
2. 时间轴统一？**是**——单一 `X(h)` 映射，所有面板几何共享，竖线贯穿验证；
3. 温度清晰？**是**——曲线 + 3h 标注 + 高/低红字；曲线振幅中等，够读趋势；
4. 降水清晰？**是**——15–18h 阵雨柱一眼可辨；凌晨毛雨微量柱偏小但可辨；
5. 云层垂直剖面清晰？**是**——晨带/午块/晚散三层故事可读，五档灰阶拉开；
6. 用户海拔清晰？**是**——3500 m 虚线 + 「你」标签贯穿，三种相对关系一眼可判；
7. 风速/阵风清晰？**是**——双线主峰 15–18h 与阵雨同时，可读；
8. 风向清晰？**是**——逐时箭头 + 读数条文字（西南风 ↗），夜间谷风/午后山风转换可读；
9. 夜间/白天清晰？**是**——夜底极轻灰蓝 + 45min 晨昏过渡，无「旅游 App」渐变；
10. 信息是否过密？**临界但成立**——375px 下 24 列是密度上限，箭头行最满；
11. 像天气工具而非 Dashboard？**是**——无卡片墙、无评分星级、无营销色，Weather Facts First；
12. 适合迁小程序 SVG？**是**——图元白名单 + 测宽再画的手势都对齐 canvas/SVG 两条路线。
