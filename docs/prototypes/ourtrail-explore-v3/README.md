# OurTrail · 探索、活动详情与天气原型

2026-10-26。探索入口：[index.html](index.html)；天气入口：[weather.html](weather.html)。本地 HTML/CSS/JavaScript 原型，可直接打开，无安装、不请求业务数据；图片保存在本目录。包含探索首页、我的同行、全页活动详情和四视图天气页。旧原型与生产小程序均未修改。

## 本轮访谈确认的方向

- 产品仍以约朋友出行为核心，学习 AllTrails、Strava 的精致、清晰和顺手。
- 首页先逛活动、决定参加；“我的同行”保留为并列入口。
- 一场重点活动使用大图，其余活动使用紧凑图文列表。
- 风景为照片主体：山脊、森林、湖泊；人可以在景中。
- 白底、清晰黑字，鲜明绿色用于主要操作与选中状态。
- 文案有温度和具体场景，避免空泛口号与文艺腔。
- 活动详情照片先行，随后呈现活动名、距离爬升、时间与同行信息；本轮已从简短活动预览展开为全页详情。

## 本页可操作内容

- 搜索活动名称、路线、描述、出发地与示例发起人；无结果时清除搜索与筛选。
- 切换“发现活动 / 我的同行”。
- “本周出发”“10 km 以内”快捷筛选；时间、路线长度、报名状态的组合筛选。
- 按出发时间或路线长度排序，支持切回。
- 点击大图或列表活动进入全页详情，查看照片、路线指标、集合、发起人介绍、当天安排、装备与参与提醒。详情有“概览 / 路线 / 安排 / 须知”页内导航和固定底部操作。
- 点击路线节点切换高亮与说明，放大查看节点顺序图。图内标明“虚构路线 · 非导航”，没有接入地图底图、定位或实测轨迹。
- 未报名示例点击“报名同行”，仅展示报名成员、联系方式与出行、紧急联系人与参与确认三个后续步骤；尚无报名表，也不会提交报名或模拟报名成功。
- 已确认示例点击“查看我的安排”，查看当前演示成员自己的集合时间、集合点与自行前往方式。弹层可通过关闭按钮、遮罩或 Escape 关闭。
- 从详情返回时恢复首页的搜索、筛选、排序、发现/我的同行选项与列表滚动位置。在同一浏览器历史条目刷新详情后再返回，也恢复这些已保存状态；直接打开 `#activity=活动ID` 则返回本地默认首页。
- 桌面上方切换 375 / 390 / 414 预览宽度。
- 底部“天气”和活动详情的“路线天气”进入天气原型；发起、通知、我的入口继续说明后续范围，不伪造成功提交。

演示参考日期固定为 **2026-10-26**，“本周”截至 11 月 1 日，“下周”为 11 月 2–8 日，避免以后查看原型时全部活动消失。所有活动与数值均为虚构，未调用、写入生产服务，不收集个人信息。

**自己的集合与群体出发分开表达。** 青城后山示例中，集中出发的伙伴于 08:30 在成都犀浦集合；当前演示成员选择自行前往，应于 10:00 到泰安古镇入口。“我的同行”列表、详情顶部和“我的安排”显示后者；路线集合区和当天时间线保留队伍的集中出发安排，并说明个人选择。两组时间不互相替代。

## 天气原型

用户选择“**先看专业数据：逐时预报、云层剖面和天气图**”。因此天气页以地点、节点、海拔和选中时刻为共同上下文，分为“逐时预报 / 云层剖面 / 沿途天气 / 日月天相”四个视图，不用总星级或结论卡占据首屏。完整说明见 [WEATHER-DESIGN.md](WEATHER-DESIGN.md)。

- 逐时图的温度、体感、降水、风速/阵风与分层云量共用时间轴；24 / 48 / 72 小时保持同一小时列宽，可横向滚动、点选小时或使用时间滑块。
- 切换视图和路线节点保留日期与时刻。切换活动地点则载入该活动的示例日期和默认节点；进入天气时可从活动详情带入活动。
- 云层剖面可选择读取高度，分别表达节点海拔、模型层云量、地形以下和缺层区域；青城后山“返回古镇”展示海拔未知状态，不画虚假的海拔线，不把缺资料当作晴空。
- 沿途图在同一时刻比较四个节点，切换温度、降水量、阵风指标，并可进入选中节点的逐时预报。**独立沿途批量比较是接入提案**：现生产页每次获取单个节点天气，本原型只用各节点合成样本演示。
- 日出日落、晨昏与暗夜时刻、月面照明均为示意；天相展示“资料不足（unknown）”及原因。这些视觉状态已完成，**不代表本轮实现了天文或天相计算**。

天气样本日期固定为 **2026-10-29 至 2026-11-11**，与活动示例日期对应。天气数值、海拔、路线位置与天文时刻均为合成数据，不是实测或真实预报。本轮未实现独立坐标查询、地图选点、GPX 导入、真实天气获取/缓存及天相计算；没有删除或替换生产小程序中的这些能力。

## 与真实产品的接缝

- 活动名、描述、发起人介绍、路线名、距离、爬升、日期、确认人数和容量已有服务端字段；搜索也已有能力。排序、时间/长度筛选、卡片发起人短称与本轮详情编排均使用本地示例数据，正式接入需核对响应投影与权限。
- 生产已有路线节点与可选轨迹，但本原型的路线点位、连线和地形底色均为手绘示意；不代表真实路线或地理坐标。
- **活动封面属于新增设计提案。** 当前 Activity / Route 无封面或相册字段，编辑器无活动图片上传。正式落地需补字段、上传入口、存储与响应投影。
- 当前发现范围不是好友图谱；本页没有虚构“仅好友可见”“智能推荐”或个性化推荐算法。
- 同行信息用人数表达，未加入普通浏览者无权读取的报名者头像墙或姓名名单。
- 原型 `accepting` 是示例活动自带的开放状态，不按“确认人数小于容量”另造可报名判据。生产报名资格、待审核占位、截止时间、候补和权限必须继续消费原有服务端语义。
- 没有新增评分、收藏、难度评级、离我距离等无现成数据的装饰性功能。
- 正式小程序实现应映射为 WXML/WXSS/CommonJS；浏览器原型中的 HTML、SVG、媒体查询不是可直接部署的小程序代码。

## 照片来源

照片只作原型配图，不作为示例活动真实路线、季节或天气的证据。完整下载链接、地点、尺寸与许可见 [assets/sources.json](assets/sources.json)。五张 Unsplash 素材按 [Unsplash License](https://unsplash.com/license) 使用；新增雪山照片单独按 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) 使用。

| 文件与当前用途 | 摄影师 | 实际地点与来源 | 许可 |
|---|---|---|---|
| ridge.jpg，首页主图 | Federica Galli | [意大利多洛米蒂秋林](https://unsplash.com/photos/golden-larch-forest-below-mountain-peaks-pF1ug8ysTtY) | Unsplash |
| forest-v2.jpg，森林活动配图 | Charles Black | [日光下的林间步道](https://unsplash.com/photos/pathway-in-forest-with-yellow-sunlight-F7HGqkkMYAU)；原页未注明地点，不标作青城后山实拍 | Unsplash |
| lake.jpg，湖畔活动配图 | Karthik Sreenivas | [加拿大 Emerald Lake](https://unsplash.com/photos/a-lake-with-a-mountain-in-the-background-1cTNbip1_qw) | Unsplash |
| snow-v2.jpg，雪山活动配图 | Johannes Böckh（Mrilabs） | [Mount Siguniang - 4 Sisters](https://commons.wikimedia.org/wiki/File:Mount_Siguniang_-_4_Sisters.jpg)，四川四姑娘山，2019-03-29 | CC BY-SA 3.0 |
| forest.jpg，保留的旧配图 | John Thomas | [阿拉斯加 Eklutna Lake 附近](https://unsplash.com/photos/pathway-between-green-trees-during-daytime-PDscI-0miR8) | Unsplash |
| hero.jpg，保留的旧配图 | Joseph Daniel | [四川新都桥附近](https://unsplash.com/photos/snow-covered-mountain-during-daytime-74W5O7_4Pkg) | Unsplash |

雪山署名：**Mount Siguniang - 4 Sisters — Johannes Böckh (Mrilabs), Wikimedia Commons, CC BY-SA 3.0**。采用 Wikimedia 缩小版本，网页显示裁切；素材未作本地像素编辑。详情页保留原图与许可链接。该照片为春季四姑娘山，不作为秋季实景证明；如再改编该素材，应保留适用的相同方式共享条件。

参考界面来自 [AllTrails 官方商店展示](https://apps.apple.com/us/app/alltrails-hike-bike-run/id405075943)、[Strava 官方商店展示](https://apps.apple.com/us/app/strava-run-bike-walk/id426826309)。学习其照片/地图的内容地位、清晰层级与克制的基础界面；没有使用其品牌图形或冒充其产品。

## 验证

以下均为本地 HTML 浏览器原型验证，**不代表微信开发者工具或真机验证**。

**上一版首页验证**记录在 [verification.json](verification.json)：375 / 390 / 414 px 无横向溢出、首屏完整露出第一条紧凑活动；实际操作覆盖搜索、空态恢复、筛选、双向排序、我的同行及旧活动预览弹层，未捕获浏览器异常为 0。该版本仓库 `node tools/check.js`、`node tools/check-handlers.js` 通过。这些结果是上一版记录，不能当成本轮全页详情已经在三个宽度重复验证的证据。

**本轮 V3.2 验证**使用 Codex 内置浏览器（IAB）的 **506 × 691 px** 视口，实际交互与最终观察记录在 [verification-refinement.json](verification-refinement.json)。验证范围以该记录为准；重点为完整详情、路线节点与放大、报名流程说明、个人集合安排，以及返回和详情刷新后的首页状态恢复。本轮没有据此宣称 375 / 390 / 414 px 的最终版重测通过。

本轮详情未观察到横向溢出，浏览器 error 日志为 0；从列表下方返回保留了 455 px 滚动位置。详情刷新曾导致历史增加与搜索丢失，修复后复测历史长度保持 3、搜索“青城”和单条结果保留，前后证据均记录在验证文件中。三个 JavaScript 文件语法检查、仓库静态检查、处理器检查及已跟踪文件空白检查均通过。

本轮最终截图：[首页](preview-home-live.png)、[完整详情](preview-detail-live.png)、[路线示意](preview-route-live.png)、[我的同行](preview-mine-live.png)。

上一版截图保留作对照：[精修前首页](preview-home-before-refinement.png)、[下方列表](preview-list.png)、[我的同行](preview-mine.png)、[旧活动预览](preview-activity.png)、[桌面预览](preview-desktop.png)。`preview-home.png`、`preview-detail.png` 与 `preview-route.png` 为本轮中途截图；最终外观以带 `-live` 的四张截图为准。

**天气页验证另行记录**在 [weather-verification.json](weather-verification.json)，实际视口、交互覆盖、异常与限制以该文件为准，不沿用首页或详情页的通过结论。天气截图：[逐时](weather-hourly.png)、[云层](weather-cloud.png)、[沿途](weather-route.png)、[日月](weather-sky.png)、[缺海拔状态](weather-unknown.png)。这些证据只验证本地原型的展示与交互，不验证天气模型、预报准确性或生产小程序。
