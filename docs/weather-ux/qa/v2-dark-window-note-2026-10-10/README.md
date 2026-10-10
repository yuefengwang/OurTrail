# Weather V2 第十二轮 · 「天文暗夜始」的机会句改由同源标记决定

- 基线：`d2e9d70`（第十一轮摄影窗口后缀末，分支 `win/weather-v2-rainbow-gate`，未并入 master）
- 本轮范围：生产文件 **1 个**（`miniprogram/utils/agenda.js`）+ 1 个套件（`tools/weather-v2-test.js` §2c）
- `cloudfunctions/`、`pages/`、`components/` 零改动 ⇒ **不需要重新部署 trailApi**
- 阈值改动数：**0**（没有新判据——机会句改为读 `sky.hourMarks` 已经打出来的 `galaxy` 标记）
- 真机：**VERIFIED**（三用例 PASS，含像素层文本命中核对）

---

## 一、这一处是哪来的

第十一轮报告 §八 记下了一处"发现但未动"：

> 时间轴「20:03 天文暗夜始」的 sub 仍写**「银河与深空窗口」**——满云那晚银河卡已被沉默闸收掉，
> 这半句却还在把暗夜说成银河机会，属同一类"把不可能包装成建议"。

用户选 A：那半句也交给同一套口径。

## 二、修法：不新造判据，读已经打出来的标记

`sky.hourMarks` 早就在逐小时打 `galaxy` 标记，条件是三件事同时成立：**银心季 + 月照 < 35% + 暗夜晴空**。
本轮只是让日程那半句去读这个标记：

```js
if (sun.astroDusk) add(sun.astroDusk, '天文暗夜始', hasMark(detail, marks, 'galaxy') ? '银河与深空窗口' : null, false)
```

`hasMark` 只做一件事：按 `h.d + 'T' + h.t` 查页面级 marks（与 `clustersOf` 同一键格式）。
**为什么不用"暗夜晴空率 > 0"或"银河卡 verdict"**：那会是第二次实现同一条判据（铁律 31②/30①），
而 marks 是这条判据在仓库里唯一已经落地的形态。

时刻与标题一字未改：**没有 galaxy 小时时，这一条只剩「20:03 天文暗夜始」**——
天文暗夜是客观钟点，不许被天气吃掉；被收回的只是那句机会主张。

## 三、判据（`tools/weather-v2-test.js` §2c，47→61→**67**）

- 满云与晴夜都有「天文暗夜始」且时刻相同（只改那一句话）
- 满云夜：sub 为空 **且** 银河卡 verdict 为 excluded（同一屏两处不许打架）
- 晴夜 · 银心季 · 残月：sub 仍是「银河与深空窗口」（不许一刀切）
- 单向一致：凡给出机会句的日子，银河卡 verdict 必为 `possible`
  （刻意不写成双向等价——标记还多要一个月照门槛，晴夜满月时卡片 possible 而标记不打，这是对的）
- 1 月晴夜：机会句不说、银河卡也沉默
- 静态门：`agenda.js` 里「银河与深空窗口」只许出现一次（防再养一份无条件文案）

## 四、差分对拍（`tools/ab-dark-window.js` → `ab-dark-window.json`）

改前侧 `git archive d2e9d70 miniprogram`，两侧各走自己的 agenda / sky / 真页面装配。

34 场景（6 合成 + 28 天真实快照）：**机会句被摘掉 9 处、保留 25 处、完全未变 25 个场景、越界 0**
（9 + 25 = 34 分区闭合）。越界的定义：

- 条目数、`t/title/key/l2/window` 任何一处变（时间不许裁）；
- 非「黄金/蓝调/天文暗夜始」的条目动了 `sub`；
- 机会句与 galaxy 标记**双向**不一致（没银河却仍说 / 有银河却被摘）；
- 上一轮的摄影后缀条数回退（跨轮回归门）；
- 六卡九字段、逐小时 marks、真页面卡集合、沉默行、总评任何一处变化（本轮没碰判据）。

## 五、变异自证（`tools/mutate-dark-window.js`）

6 条 **0 漏网**（先过"未变异副本 1 套 + 对拍全绿"的有效性门）：

| 变异 | 被抓于 |
|---|---|
| D1 永远说（回到用户报的原状） | weather-v2 + 对拍 |
| D2 **永远不说**（一刀切把真机会也抹掉） | weather-v2 + 对拍（双向一致门 + 一刀切门） |
| D3 判据放宽成"能看星就说银河"（galaxy → star） | weather-v2 |
| D4 标记键少写日期前缀（marks 查不到 ⇒ 静默恒 false） | weather-v2 + 对拍 |
| D5 没银河时把时刻也裁掉（客观事实被天气吃掉） | weather-v2 + 对拍 |
| D6 摄影后缀改成无条件（跨轮回退） | weather-v2 + 对拍 |

D2 是这套脚本存在的理由：它把用户报的现象"治好"了，却把真有机会的夜晚一起抹掉——
只测"被摘掉"的差分对拍会放过它，必须靠双向一致 + 一刀切门才会红。
D4 抓的是键格式：`marks` 是 `date + 'T' + HH:mm`，写成 `h.t` 会静默查不到、恒为 false，
行为看起来"更安全"，其实是把功能关掉。

## 六、真机核验：VERIFIED

改完代码 `close` → `open` → `auto`（端口重绑 9424），三用例各 `reLaunch` + 独立 `updatedAt`，
截图前先断言渲染门槛链，最后做三用例读数互不相同的污染自证：

| 用例 | 天文暗夜始 | 像素层 | 摄影后缀（上一轮） | 结论卡 | 判定 |
|---|---|---|---|---|---|
| A 满云 | 时刻 20:03 在，sub = **null** | 日程整块文本**不**含机会句 | 4/4 条带「当时低云 100%…」 | 0 张 + 沉默行 1 行 | PASS |
| B 晴夜有戏 | 时刻 20:03 在，sub = **「银河与深空窗口」** | 命中 | 0 条 | 5 张 | PASS |
| C 无高程 | 同 B | 命中 | 0 条 | 5 张（云海 ★★ 自带"缺少可信海拔"） | PASS |

截图 `device/A-overcast-2.png` 直接看得见：四条摄影窗口带着上一轮的云后缀，
而「20:03 天文暗夜始」下面**不再有机会句**——同一屏里"客观钟点"与"机会主张"分开了。

## 七、门禁（本轮跑出一条**与本轮无关**的时间引信红）

63 个可无头套件逐套独立跑（本地钟 2026-10-10 20:33）：**62 套 exit 0**，
`weather-v2-test 61→67`，读数合计 **4299**（不含中途抛错的那一套）。

唯一红：**`tools/e2e-test.js` exit 1** —— `signup.submit → WRONG_PHASE「本场活动不在开放报名时段」`，
随后 `:145` 取 `undefined.signupId` 抛错中断。根因是夹具把报名截止写成了绝对时刻：

```js
// tools/e2e-test.js:72
startAt: '2026-10-11T08:00:00+08:00', …, deadlineAt: '2026-10-10T20:00:00+08:00',
```

`cloudfunctions/trailApi/domain/signup.js:115` 的闸是 `Date.parse(context.now) >= Date.parse(deadlineAt)`，
而 `context.now` 出自 `index.js:26` 的真实时钟 ⇒ **今天 20:00 之后必红**，10-11 08:00 之后会更红。

归属已核实，与本轮（以及第九~十一轮）无关：同一份 `tools/e2e-test.js` 在
`git archive origin/master`（`abf08f0`，我方 5 个提交一个都不含）的干净副本里跑出**同样的红、同样的行号**。
16:53 那一次全量复跑（第十一轮）当时钟还没过 20:00，所以是绿的——这条红是钟走过截止点带来的，
不是被哪次改动引入的。修法很小（把三个时间改成按 `Date.now()` 偏移推导），但它动的是公共门禁夹具，
本轮没有擅自改，留给用户裁决；已同步登记进 AGENTS.md 的常驻红清单（原来只记了
`outdoor-intelligence-ui` 一条，实际是两条，且这一条是**确定性**的：过点必红）。

## 八、复现

```bash
node tools/weather-v2-test.js                                                  # 67
node docs/weather-ux/qa/v2-dark-window-note-2026-10-10/tools/ab-dark-window.js # 34 场景 / 越界 0
node docs/weather-ux/qa/v2-dark-window-note-2026-10-10/tools/mutate-dark-window.js
WS_PORT=9424 node verify-dark-window-device.js                                 # 需开发者工具通道
```
