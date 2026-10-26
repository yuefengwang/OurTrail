# Style B 批次一 · 真机验收证据（2026-10-26）

**形态**：微信开发者工具模拟器（iPhone 12/13 画布 390×844，截图 1× 390×844），
`miniprogram-automator` 0.13.0 直连 `ws://127.0.0.1:9434`。
**驱动脚本**（仓库外，一次性工具）：`%TEMP%\opencode\mp-auto\verify-style-b-2026-10-26.js`；
A3 只读探针：同目录 `probe-a3-pulldown.js`。
**代码版本**：分支 `agent/ourtrail-style-a-20261023` 的工作树（未提交），已 `close --project` → `open` 重编译，
**bundle 新鲜度自证**：本批最后一处改动（featured 卡日期行删「出发」两字）在 `home.png` 中可见
（`10/03 周六 · 已过时`）；同屏出现的新文案只存在于新代码。

## 一次运行的总账

```
passed=31 failed=0
exceptions=0 consoleErrors=0
```

31 条断言全部读**实测几何/文本**，不含「元素存在即算通过」；两条几何口径见下。

## 截图

| 文件 | 内容 | 说明 |
|---|---|---|
| `home.png` | 首页首屏（品牌词标 / 下一次同行 / 动作行 / 筛选 / 列表） | A1 口径：状态卡完整 + 首卡露出标题与 chips |
| `discover.png` | 发现页（原生返回栏，无品牌栏） | body 内眉题「发现活动」已删，页头只剩一句标题 |
| `notices.png` | 通知页顶部 | 分区头只一处；条数/排序/未读降为一行 12px caption |
| `notices-pulldown.png` | 通知页下拉（API 触发） | **不构成 A3 证据**，见下文 A3 |
| `me.png` | 我的页品牌栏 | 无 `.page-title` |
| `activity-top.png` | 活动详情首屏 | 吸顶条在流内，静止时位于底栏之后 |
| `activity-scrolled.png` | 详情滚到 1743.5 | 吸顶条贴视口顶，「安全」下划线 |
| `activity-after-tap.png` | 从顶部点「安全」段后 | 落点 55px，标题不被条盖住 |
| `probe-nav-top.png` / `probe-nav-scroll60.png` | 坐标语义探针 | 证明 `.section-nav` 在流内 642.9–697.9、底部固定 CTA 占 646–753 |
| `probe-a3-pulldown-{120,500,1000}.png` | A3 探针三帧 | 120/500/1000 ms 均**没有**渲染指示器 |
| `readings.json` | 本次 31 条断言的原始读数 | |

## 关键读数

**坐标口径（一次踩坑换来的）**：`element.offset()` 返回**文档坐标**（吸顶元素贴视口顶时会报
`offset().top === scrollTop`）；页面**视口坐标**只能走 `wx.createSelectorQuery().boundingClientRect()`
（`evaluate` 内取，0 = 原生导航栏下沿）。

| 项 | 读数 |
|---|---|
| 系统 | window 390×844，statusBar 47，windowHeight 844 |
| 品牌栏（首页） | 实测 **87** = statusBar 47 + navBar 40；右侧给胶囊内缩 **102**；`position: fixed / z-index 90 / rgb(245,245,240)` |
| 首屏可用下沿 | **749** = 自定义 tab 栏上沿（`.tabbar` heigh 95），不是 windowHeight 844 |
| 下一次同行卡 | 111–217（整卡在可用区内）；动作行 233–281 |
| 首卡标题 / chips | 标题 627–657、chips 690.7–708.7，均在 749 之上 |
| 卡片 chips 串 | `30.5 km · 2883 m`（日期已在卡片顶部行，不重复） |
| 发现页 chips | `02/06 周六 · 6 km · 200 m` |
| 通知页分区头 | 1 处；caption `共 677 条 · 最新的在最上面 · 左侧深色边线的是还没读的`（12px） |
| 详情分段条 | sticky / top 0 / z-index 20 / 纸底；**实测高 55**（CSS 合成为 44 + 10 + 1） |
| 详情滚动 | maxScroll **1747**；点「安全」落点 **55px**；滚动落点 **59px**（= 55 + 4 留白） |
| 高亮 | 首屏 `intro`；滚/点后均为几何算得的 `safety`（首个与观测窗相交的段） |

**吸顶条与底栏的关系（登记为事实，不改）**：静止时 `.section-nav` 在流内 642.9–697.9，而固定底栏
占 646–753（视口 753）⇒ 首屏那 55px 里条被底栏盖住；滚动约 52px 后完全露出，滚到 643 起贴顶。
设计文档 §4.5 把导航之上的 hero/信息块列为**不动**，故本批不改首屏堆叠，只把这条读数留档。

## 真机抓到的缺陷（本批修掉 4 条）

1. **`IntersectionObserver` 一个实例只能 `observe` 一次**。原实现一个实例 observe 9 个锚点，
   真机抛 `"observe" call can be only called once in IntersectionObserver`（`exceptions=1`），
   整条高亮直接死掉。改成**每锚点一个实例**（账本 order/seen/map 仍共一份），`onUnload` 逐个 disconnect。
   **桩同源缺陷**：旧测试桩允许实例复用 ⇒ 这类平台限制永远测不出来；`tools/scenario-activity-test.js` 的桩
   已按平台行为改成第二次 `observe` 抛错，并新增「每锚点各一实例、violations 0、create 9、observes 9」断言。
2. **吸顶条自身高度从 45 改 55**。旧值让「被条盖住的那 10px」仍算在观测窗里 ⇒ 高亮慢一屏；
   同一常数还是点段跳转的落点偏移（`-STICKY_NAV_OFFSET`），此前点「约定」标题会压在条底下。
3. **下一次同行卡不把过期活动当「下一次」**（过期活动曾顶在卡上）。
4. **featured 卡日期行文案**：`{{date}} · 出发 {{when}}` 里的 `when` 是倒计时短语（剩 35 天 / 已过时），
   渲染成「10/03 周六 · 出发 已过时」——把状态词挂在动作后面。删掉「出发」两个字（plain 卡无此串）。

另：发现页 body 内的眉题「发现活动」按设计 §4.2 删除（原生导航已印同一句话）；无门钉过该字面量
（`tools/entry-layout-test.js:68` 只查首页源码）。

## 门禁（改后逐套实测）

`check.js` exit 0 `ALL CHECKS PASSED`（G10：42 scope units / 3138 class tokens / 134 class names）·
`check-handlers.js` exit 0（死 handler 仍只有 `pages/editor/editor.js#onNumber`）·
`scenario-activity 212/0`（§15 新增：9 锚点各一 observer、观测窗上沿 -55、点段落点 -55）·
`home-collab-list 42/0` · `scenario-discover 60/0` · `entry-layout 41/0` · `a20-owner-hero 36/0` ·
`page2-gates 102/0` · `scenario-me 145/0` · `swx2-style-gates 110/0`（此前登记的
`activity.wxss:90 .highlight-dot` font-weight 红随本批样式重写消失）· `ui-consistency 19/0` ·
`card-view 24/0` · `header-layout 38/0`。

## 边界（如实标 UNVERIFIED）

- **375 宽未验**：automator 0.13.0 没有 `setWindowSize`，无法程序化改画布；390 是模拟器默认。
  品牌栏的右内缩按**实测胶囊**换算，375 只会更窄 ⇒ 结构上不会压到胶囊，但无像素证据。
- **A3 下拉刷新未验**：`wx.startPullDownRefresh` 在模拟器里**不渲染**原生指示器
  （120/500/1000 ms 三帧一致，页面不位移），三帧只能证明「API 调用不抛错、内容不永久下移」。
  保留回退方案：`backgroundTextStyle: dark` + 顶部偏移，或这两页改 `<scroll-view refresher-enabled>`。
- **原生控件未驱动**：相册选择器、分享面板、picker 弹层、键盘焦点态。
- **注入与真实**：页面数据全部来自真实云端读取（通知 677 条、首页 cards 投影 158 条、发现 50 场），
  未使用 `setData` 注入合成载荷；`[预演]` 前缀的条目是 lab 沙盒数据，形态与生产同构。
