# Design DNA 草案（2026-10-29T11:32:41.489Z）

规则 128 条：token 56 · component 56 · page 5 · interaction 5 · principle 5 · exception 1
范围：global 34 · page-family 20 · page 74（全部为候选）

## 设计 token（56）

| id | 范围 | 可信度 | 陈述 |
|---|---|---|---|
| `token.var.device-width` | global | high | --device-width = 390px，被 14 处声明引用（.device、.weather-device.preview-width） |
| `token.var.green` | global | high | --green = #16783e，被 289 处声明引用（.wordmark svg、.create-button、.browse-tabs button.active::after 等） |
| `token.var.green-bright` | global | low | --green-bright = #198b47，本轮未发现消费者 |
| `token.var.green-soft` | global | high | --green-soft = #edf7ed，被 48 处声明引用（.chip.selected、.mine-status、.option-grid button.selected 等） |
| `token.var.ink` | global | high | --ink = #18211b，被 63 处声明引用（:root、.preview-sizes button.on、.search-wrap input 等） |
| `token.var.line` | global | high | --line = #e8ece7，被 204 处声明引用（.browse-tabs、.activities-heading、.activity-row 等） |
| `token.var.muted` | global | high | --muted = #69716b，被 229 处声明引用（.preview-brand span、.preview-info、.preview-sizes button 等） |
| `token.var.pale` | global | high | --pale = #f5f7f4，被 45 处声明引用（.search-wrap、.empty-state > .icon、.close-button 等） |
| `token.literal-colours` | page-family | medium | 样式表里有 177 个未 token 化的色值，其中 8 个重复出现 ≥3 次（最高 rgb(255,255,255) × 25） |
| `token.size.34px` | page | low | font-size 34px：1 个节点（weather） |
| `token.size.32px` | page | medium | font-size 32px：2 个节点（activity-list） |
| `token.size.25px` | page | low | font-size 25px：1 个节点（weather） |
| `token.size.24px` | page-family | high | font-size 24px：12 个节点（activity-detail、weather） |
| `token.size.21px` | page-family | high | font-size 21px：3 个节点（activity-list、weather） |
| `token.size.19px` | page | low | font-size 19px：1 个节点（activity-list） |
| `token.size.18px` | page-family | high | font-size 18px：9 个节点（activity-detail、weather） |
| `token.size.17px` | global | high | font-size 17px：75 个节点（activity-list、activity-detail、weather） |
| `token.size.16px` | global | high | font-size 16px：588 个节点（activity-list、activity-detail、weather） |
| `token.size.15px` | page-family | high | font-size 15px：21 个节点（activity-list、activity-detail） |
| `token.size.14px` | page-family | high | font-size 14px：10 个节点（activity-list、weather） |
| `token.size.13px` | global | high | font-size 13px：165 个节点（activity-list、activity-detail、weather） |
| `token.size.12px` | global | high | font-size 12px：121 个节点（activity-list、activity-detail、weather） |
| `token.size.11px` | global | high | font-size 11px：227 个节点（activity-list、activity-detail、weather） |
| `token.size.10-8333px` | page | medium | font-size 10.8333px：2 个节点（weather） |
| `token.size.10px` | global | high | font-size 10px：411 个节点（activity-list、activity-detail、weather） |
| `token.size.9px` | global | high | font-size 9px：44 个节点（activity-list、activity-detail、weather） |
| `token.size.8px` | page | high | font-size 8px：122 个节点（weather） |
| `token.weight.400` | global | high | font-weight 400：1447 个节点（activity-list、activity-detail、weather） |
| `token.weight.700` | global | high | font-weight 700：110 个节点（activity-list、activity-detail、weather） |
| `token.weight.760` | page-family | high | font-weight 760：28 个节点（activity-list、weather） |
| `token.weight.500` | global | high | font-weight 500：20 个节点（activity-list、activity-detail、weather） |
| `token.weight.600` | global | high | font-weight 600：107 个节点（activity-list、activity-detail、weather） |
| `token.weight.650` | global | high | font-weight 650：59 个节点（activity-list、activity-detail、weather） |
| `token.weight.690` | page | low | font-weight 690：1 个节点（activity-list） |
| `token.weight.720` | page | low | font-weight 720：1 个节点（activity-list） |
| `token.weight.550` | page-family | high | font-weight 550：13 个节点（activity-list、activity-detail） |
| `token.weight.680` | page-family | high | font-weight 680：24 个节点（activity-detail、weather） |
| `token.weight.730` | page | high | font-weight 730：5 个节点（weather） |
| `token.radius.22px` | page | medium | border-radius 22px：2 个节点（activity-list） |
| `token.radius.18px` | global | high | border-radius 18px：15 个节点（activity-list、activity-detail、weather） |
| `token.radius.12px` | page-family | high | border-radius 12px：3 个节点（activity-list、weather） |
| `token.radius.11px` | page | medium | border-radius 11px：2 个节点（activity-detail） |
| `token.radius.10px` | page-family | high | border-radius 10px：5 个节点（activity-list、weather） |
| `token.radius.9px` | global | high | border-radius 9px：14 个节点（activity-list、activity-detail、weather） |
| `token.radius.8px` | page | high | border-radius 8px：3 个节点（weather） |
| `token.radius.7px` | page | high | border-radius 7px：8 个节点（activity-detail） |
| `token.radius.6px` | page-family | high | border-radius 6px：4 个节点（activity-detail、weather） |
| `token.radius.5px` | page-family | high | border-radius 5px：26 个节点（activity-detail、weather） |
| `token.radius.4px` | global | high | border-radius 4px：17 个节点（activity-list、activity-detail、weather） |
| `token.radius.3px` | global | high | border-radius 3px：14 个节点（activity-list、activity-detail、weather） |
| `token.radius.2px` | page | low | border-radius 2px：1 个节点（weather） |
| `token.radius.1px` | page | low | border-radius 1px：1 个节点（weather） |
| `token.radius.50` | global | high | border-radius 50%：24 个节点（activity-list、activity-detail、weather） |
| `token.shadow.rgb-255-255-255-0px-0px-0px-1-5px-inset` | global | high | box-shadow rgb(255, 255, 255) 0px 0px 0px 1.5px inset：9 个节点（activity-list、activity-detail、weather） |
| `token.shadow.rgba-24-37-28-0-1-0px-1px-6px-0px` | page | medium | box-shadow rgba(24, 37, 28, 0.1) 0px 1px 6px 0px：2 个节点（activity-detail） |
| `token.shadow.rgba-32-59-32-0-063-0px-1px-3px-0px` | page | medium | box-shadow rgba(32, 59, 32, 0.063) 0px 1px 3px 0px：2 个节点（weather） |

## 组件模式（56）

| id | 范围 | 可信度 | 陈述 |
|---|---|---|---|
| `component.span-icon` | page-family | medium | span.icon：27 个实例，高 13–23px（中位 17px） |
| `component.div-hour-buttons-button` | page | medium | div.hour-buttons > button：24 个实例，高 30px · 10px 字号 |
| `component.div-layer-row-span` | page | medium | div.layer-row > span：20 个实例，高 14–15px（中位 14.5px） |
| `component.button-span` | global | medium | button > span：16 个实例，高 10–23px（中位 15.5px） · 10px 字号 |
| `component.span-row-metrics-span` | page | high | span.row-metrics > span：10 个实例，高 16px · 12px 字号 |
| `component.div-layer-row` | page | high | div.layer-row：10 个实例，高 15px · 11px 字号 |
| `component.nav-bottom-nav-button` | page-family | medium | nav.bottom-nav > button：8 个实例，高 51px · 10px 字号 |
| `component.div-chart-axis-div` | page | medium | div.chart-axis > div：6 个实例，高 13.5–42px（中位 21px） · 9px 字号 |
| `component.dl-detail-grid-div` | page | high | dl.detail-grid > div：6 个实例，高 42px · 16px 字号 |
| `component.button-activity-row` | page | high | button.activity-row：5 个实例，高 127px · 16px 字号 |
| `component.span-row-body` | page | high | span.row-body：5 个实例，高 87.8px · 16px 字号 |
| `component.span-row-date` | page | high | span.row-date：5 个实例，高 15px · 11px 字号 |
| `component.span-row-body-h3` | page | high | span.row-body > h3：5 个实例，高 21.8px · 15px 字号 |
| `component.p-row-route` | page | high | p.row-route：5 个实例，高 15px · 11px 字号 |
| `component.span-row-meta` | page | high | span.row-meta：5 个实例，高 16px · 12px 字号 |
| `component.span-row-metrics` | page | high | span.row-metrics：5 个实例，高 16px · 12px 字号 |
| `component.button-small` | page-family | medium | button > small：5 个实例，高 14px · 10px 字号 |
| `component.ol-day-schedule-li` | page | medium | ol.day-schedule > li：5 个实例，高 42.2–66.2px（中位 66.2px） · 16px 字号 |
| `component.div-equipment-tags-span` | page | high | div.equipment-tags > span：5 个实例，高 29px · 11px 字号 · 圆角 5px |
| `component.div-chart-legend-span` | page | high | div.chart-legend > span：5 个实例，高 12px · 9px 字号 |
| `component.div-solar-event` | page | high | div.solar-event：5 个实例，高 40.5px · 16px 字号 |
| `component.div-solar-event-time` | page | high | div.solar-event > time：5 个实例，高 17px · 12px 字号 |
| `component.div-solar-event-div` | page | high | div.solar-event > div：5 个实例，高 40.5px · 16px 字号 |
| `component.nav-detail-tabs-button` | page | medium | nav.detail-tabs > button：4 个实例，高 46px · 13px 字号 |
| `component.section-detail-section` | page | medium | section.detail-section：4 个实例，高 198.5–699.7px（中位 404.6px） · 16px 字号 |
| `component.div-route-stops-button` | page | medium | div.route-stops > button：4 个实例，高 80px · 16px 字号 · 圆角 7px |
| `component.nav-weather-tabs-role-tablist-button` | page | medium | nav.weather-tabs[role=tablist] > button：4 个实例，高 45px · 13px 字号 |
| `component.div-time-scrubber-button` | page | high | div.time-scrubber > button：4 个实例，高 34px · 16px 字号 |
| `component.div-weather-section-heading` | page | medium | div.weather-section-heading：4 个实例，高 21–25px（中位 21px） · 16px 字号 |
| `component.div-weather-section-heading-h2` | page | high | div.weather-section-heading > h2：4 个实例，高 21px · 16px 字号 |
| `component.div-altitude-tick` | page | high | div.altitude-tick：4 个实例，高 13.5px · 9px 字号 |
| `component.button-plan-stop` | page | medium | button.plan-stop：4 个实例，高 89–118px（中位 89px） · 16px 字号 |
| `component.span-stop-time` | page | medium | span.stop-time：4 个实例，高 58–87px（中位 58px） · 12px 字号 |
| `component.span-stop-time-small` | page | high | span.stop-time > small：4 个实例，高 12px · 9px 字号 |
| `component.span-stop-body` | page | medium | span.stop-body：4 个实例，高 58–87px（中位 58px） · 16px 字号 |
| `component.span-stop-name` | page | high | span.stop-name：4 个实例，高 17px · 13px 字号 |
| `component.span-stop-meta` | page | high | span.stop-meta：4 个实例，高 14px · 10px 字号 |
| `component.small-stop-note` | page | high | small.stop-note：4 个实例，高 16px · 10px 字号 |
| `component.button-chip` | page | medium | button.chip：3 个实例，高 31px · 12px 字号 · 圆角 18px |
| `component.span-row-joined` | page | high | span.row-joined：3 个实例，高 15px · 11px 字号 |
| `component.section-weather-section` | page | medium | section.weather-section：3 个实例，高 200–359.1px（中位 347.5px） · 16px 字号 |
| `component.p-chart-note` | page | medium | p.chart-note：3 个实例，高 33–69.5px（中位 53px） · 10px 字号 |
| `component.div-sky-item` | page | high | div.sky-item：3 个实例，高 76.7px · 16px 字号 |
| `component.span-metric-unit` | page | medium | span.metric-unit：2 个实例，高 15px · 11px 字号 |
| `component.button-sort-button` | page | medium | button.sort-button：2 个实例，高 31px · 11px 字号 |
| `component.div-activity-list` | page | medium | div.activity-list：2 个实例，高 254–381px（中位 317.5px） · 16px 字号 |
| `component.span-paused-row-joined` | page | medium | span.paused.row-joined：2 个实例，高 15px · 11px 字号 |
| `component.span-mine-status` | page | medium | span.mine-status：2 个实例，高 14.8px · 9px 字号 · 圆角 3px |
| `component.div-key-fact` | page | medium | div.key-fact：2 个实例，高 56.1px · 16px 字号 |
| `component.details-notice-fold` | page | medium | details.notice-fold：2 个实例，高 50–103.6px（中位 76.8px） · 16px 字号 |
| `component.button-data-source` | page | medium | button.data-source：2 个实例，高 30px · 10px 字号 |
| `component.span-demo-dot` | page | medium | span.demo-dot：2 个实例，高 5px · 10px 字号 · 圆角 50% |
| `component.span-chart-caption` | page | medium | span.chart-caption：2 个实例，高 14–15px（中位 14.5px） · 10px 字号 |
| `component.div-time-scrubber` | page | medium | div.time-scrubber：2 个实例，高 50px · 16px 字号 |
| `component.p-time-hint` | page | medium | p.time-hint：2 个实例，高 29px · 10px 字号 |
| `component.button-weather-link-row` | page | medium | button.weather-link-row：2 个实例，高 71px · 16px 字号 |

## 页面模式（5）

| id | 范围 | 可信度 | 陈述 |
|---|---|---|---|
| `page.activity-list.discover` | page | medium | activity-list/discover：5 个纵向区块，顺序 页头 → 搜索 → 筛选 → 内容区 → 页脚说明 |
| `page.activity-detail.overview` | page | medium | activity-detail/overview：4 个纵向区块，顺序 主视觉 → 页头 → 视图切换 → 内容区 |
| `page.weather.home` | page | medium | weather/home：5 个纵向区块，顺序 页头 → 操作区 → 最近记录 → 视图切换 → 内容区 |
| `page.weather.hourly` | page | medium | weather/hourly：5 个纵向区块，顺序 页头 → 视图切换(#weather-days) → 视图切换(.weather-tabs) → 内容区 → 页脚说明 |
| `page.phone-frame` | global | high | 三页共用手机外壳（statusbar 29px，wechatbar 43px，bottom-nav 57px，home-indicator 23/20px） |

## 交互模式（5）

| id | 范围 | 可信度 | 陈述 |
|---|---|---|---|
| `interaction.tablist` | page-family | high | 视图切换使用 role=tablist/tab 与 aria-selected 表达选中，共 3 处 |
| `interaction.dialog-sheet` | global | medium | 浮层使用 role=dialog + aria-modal=true，共 3 个元素（其中 3 个在采集状态里是关闭的，只证明契约存在，不证明实际观感） |
| `interaction.status-toast` | page-family | low | 轻提示使用 role=status（2 处），采集时 2 处处于不可见状态（#toast[opacity:0]） |
| `interaction.text-field` | page-family | medium | 输入控件 4 个，4 个字号 ≥14px（移动端防缩放） |
| `interaction.state-class-toggles` | page-family | medium | 状态切换通过类名表达（#mine-tab↔active，.chip↔selected，.active↔active，#device↔on-detail，.selected↔selected） |

## 设计原则（5）

| id | 范围 | 可信度 | 陈述 |
|---|---|---|---|
| `principle.tap-target` | global | medium | 可点区高度中位数 46px；3/45 个 <31px，16/45 个 <44px |
| `principle.hairline-separation` | global | medium | 区块分隔主要靠 1px #e8ece7 上边框（13 处），阴影 4 处只用于外壳与浮层 |
| `principle.type-hierarchy` | global | high | 字号阶 32px×1 / 25px×1 / 24px×4 / 21px×1 / 19px×1 / 18px×4 / 17px×14 / 16px×37 / 15px×6 / 14px×5 / 13px×35 / 12px×35 / 11px×52 / 10px×46 / 9px×5；5 处 <10px |
| `principle.primary-action-green` | page | high | #16783e 作为主操作底色，出现在 4 个节点 / 1 个页面 |
| `principle.icon-stroke` | global | medium | 图标为内联 SVG 描边（63 个），主流形态 1.8px/outline/round（39/63） |

## 例外（1）

| id | 范围 | 可信度 | 陈述 |
|---|---|---|---|
| `exception.sheet-overrides` | global | high | 32 条声明被后加载的样式表覆盖（同一选择器同一属性出现两个值） |

## 覆盖与缺口

- activity-list: 可见节点 147，其中落在重复组件签名内 59（40%），单例签名 39
- activity-detail: 可见节点 222，其中落在重复组件签名内 60（27%），单例签名 53
- weather: 可见节点 98，其中落在重复组件签名内 17（17%），单例签名 37

## 告警
- 177 个色值未 token 化（8 个重复 ≥3 次）
- 7 条结构性规则在全部页面上成立，但仍只是“全局候选”：未经用户确认不得当作全局规范（page.phone-frame、interaction.dialog-sheet、principle.tap-target、principle.hairline-separation、principle.type-hierarchy、principle.icon-stroke、exception.sheet-overrides）
