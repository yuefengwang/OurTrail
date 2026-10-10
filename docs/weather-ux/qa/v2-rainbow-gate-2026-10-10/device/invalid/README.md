# 这批截图判定为**无效证据**（2026-10-10，彩虹遮光闸真机核验）

三轮尝试各犯一种错，共同点是：**读数看着对，页面其实不对**。全部留在这里，不进正文证据。

## `*-scroll*.png` —— 驱动 v1：页面根本没渲染

只注入了 `series`，`days` 传空数组 ⇒ `dayCards` 为空 ⇒ `weather.wxml:37`
的门槛 `wx:elif="{{dayCards.length}}"` 不成立 ⇒ 整块内容（含结论卡）不渲染，
屏幕停在「暂不展示天气数字」的空态分支。
而 `page.data('condCards')` 已经读到正确数据 —— **数据读数不是像素证据**
（AGENTS.md 铁律 21「元素数量不是 UI 证据」的同一类，只是换了主体）。

## `*-cards*.png` —— 驱动 v2：结论卡对了，但整页是降级版

补上生产形状的 `days[]` 之后结论卡渲染正常，但载荷里**没有 `cloudLevels`**
⇒ `WCFF.buildCloudFieldRange` 返回 null ⇒ `unified = null` ⇒ 页面回退经典 canvas meteogram，
OI 卡也不出。截图里的页面长得像"旧版本"，作为**页面级**证据不合格。

## `*-full-*.png` —— 驱动 v3：补齐了 cloudLevels，但第二用例的图是缓存

`buildUnifiedCard` / `buildOiCard` 的缓存键是
`updatedAt|date|elevation|lat2dp|width`（`weather.js:824`）。两个用例用了同一个 `updatedAt`
⇒ B 用例直接复用 A 用例的云场图与 OI 卡 —— **两张截图一模一样**，
而 B 的结论卡却是新的（那部分每次重算）。发现方式就是去比对两张图，而不是相信流程。

---

## 有效证据在同级目录：`*-v4-*.png`

驱动 v4（`../tools/verify-rainbow-device.js`）做了三件事：

1. 每个用例前 `reLaunch` 页面 —— 清掉 `_unified` / `_oiCache` 这类**实例属性**缓存；
2. 每用例给不同 `updatedAt`；
3. 自带**污染自证**：两个用例的 `unified.r1/r3` 与 OI 首条摘要必须不同，
   相同就 `exit 1` 并判整批截图无效（不靠人眼事后发现）。

实测：A 的 OI 首条 =「此点正处于云中 / 云区 197–6,572 m（峰值 100%）穿过此点海拔 489 m」（1 条机会），
B 的 OI 首条 =「银河窗口 / 夜段高层云 5% · 中层云 5%」（3 条机会）⇒ 不同 ✓
