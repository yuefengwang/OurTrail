# 作废截图与驱动故障登记（invalid/）

日期：2026-10-23
证据包：[../README.md](../README.md)
环境：微信开发者工具 2.02.2609231 · 基础库 3.8.12 · iPhone 12/13 (Pro) 模拟器 · 390×753 CSS px · dpr 3

---

## 1. 首启未上样式帧（3 个文件，保留不删）

| 文件 | 场景 | 命中的条件 | 实测读数 |
|---|---|---|---|
| `s1-rich-first-launch-unstyled-top.png` | S1 · rich，`close`+`open` 后第一次 `reLaunch` | 数据与 DOM 已就绪，但页面 WXSS 尚未生效 | hero top **0**（应 24）、媒体高 **291**（应 240）、压图 delta **−0.5**（应 −72）、卡片 delta **−0.5**（应 −24）、信息卡 **390 宽 / 4 行 1 列**（应 350 宽 / 2 行 2 列） |
| `s1-rich-first-launch-unstyled-info.png` | 同上，滚动到信息卡 | 同上 | 同上；画面可见按钮、卡片、网格均为裸 WXML 样式 |
| `s1-rich-first-launch-unstyled.json` | 同上，读数 | 同上 | 三道旧门 `loadingFalse / titleIntact / selectorFound` 全为 true；§7 的 S1 标记也全部成立；`status` 字段仍是旧门的 `VALID` |

**为什么作废**：截图不满足 BASELINE §6 的几何判据（媒体高、压图 delta、卡片 delta、两列网格四项全部越界），画面是"样式表未生效"的裸 WXML，不能作为设计结论的证据。

**为什么当时没被 §4.4 拦住**：§4.4 的三道门只校验数据落地、哨兵不被迟到 reload 覆盖、目标元素在 DOM 里——**样式表是否生效不在其中**。这是门的缺口，不是数据问题，也不是页面设计问题。作废帧的 JSON 保留旧门判定的 `VALID` 原样，便于复核"旧门为何放行"，不篡改历史读数。

**重拍方式**：驱动 `tools/capture-s1.js` 新增 gate4 `stylesReady`——轮询到媒体高 240±1（S1 追加信息卡宽 ≥300）才允许截图，超时 12s 判 INVALID。S1 整批重跑 **5/5 VALID**，`styleWaitMs` 17–46ms：
rich 46 / sparse 25 / long-title 29 / cover-failed 24 / route 17。

**保留原因**：BASELINE §8 要求作废图移入 `invalid/` 且不许删除，保留可复核性。

---

## 2. 未产生截图的驱动故障（仅登记）

1. **cover-failed 两次 `timeout waiting for automator response`**
   探针仍可连接，当前页标题正确，重试时每一步都返回成功；第三次重试完成并产出有效截图与读数。
   判定：自动化通道瞬时僵死，非产品缺陷；最终证据有效（`s1/s1-cover-failed-top.png`、`readings/s1-cover-failed.json`）。
   未产生无效截图，故本目录无对应文件。

2. **route 抓取 `TypeError: Cannot read properties of undefined (reading 'windowWidth')`**
   `captureRoute()` 在 viewport 赋值前返回，异常发生在截图之前，**无截图产物**。
   修复：把 `viewport` 作为参数传入（`captureRoute(mp, viewport)`），重跑得到 `s1/s1-route-top.png` 与 `readings/s1-route.json`。

3. **重复文件 `a1-rich-info.png`（已删除，不在 invalid/ 留副本）**
   基线页没有 `.act-info`，早先驱动条件写成"有卡片就拍 info"，截出的实际是顶部，与 `a1-rich-top.png` 字节相同。
   修复：驱动改为 `name === 'rich' && isS1` 才抓 info；重复文件已删除。
   它不是"作废截图"，而是字节重复、不含额外可复核信息；如需复核，可用 `tools/capture-s1.js --side=a1` 重拍。
