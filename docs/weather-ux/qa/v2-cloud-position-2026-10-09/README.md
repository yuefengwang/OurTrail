# 云层位置语义统一 · 真机证据包（2026-10-09 续轮）

分支 `win/weather-v2-cloud-position`（基线 `3627079`）。本轮只做一件事：把「云在这个查询点的哪里」
收敛成三个互斥的确定态 + 一组有名有姓的「判不出」，并把主语从「你」改成查询点。

## 环境

- 微信开发者工具（Windows，服务端口 33278），视口固定 **390×753 @ dpr 3**。
- 数据是**线上真实预报**（`trailApi` 已部署版本 → Open-Meteo），不是注入的合成数据。
  每行的 `updatedAt` 已记进 manifest，前后两组相差约 25 分钟，因此**同一小时同一地点的读数会随预报更新**；
  本包主张的是**词汇与主语**的变化，云区数字（`r2`）只是顺带的对照。
- 驱动：`tools/shots-cp.js`（依赖 `miniprogram-automator` 装在仓库外 `%TEMP%/opencode/mp-auto`，本仓库零 npm）。
  ```
  node shots-cp.js <OUT_DIR> ws://127.0.0.1:<AUTO_PORT> <before|after> [id,id]
  ```

## bundle 新鲜度探针（为什么这两组不是旧编译产物）

`unified.legendIn` 是本轮新加的字段（图例文字从 `format.js` 的三态表生成）。
manifest 每行的 `bundleFresh` 记录它是否非空：**before 组根本没有这个字段**，after 组 12 张全部 `fresh=true`。
所以 after 组不可能是旧 bundle，也不可能是"改了但没生效"。

## 文件

- `v2-before-*` / `manifest-before.json`：**9 个场景 × (full+tap) = 18 张 PNG**（3 地点 × 24/48/72h），基线 `3627079` 的编译产物。
  工作树当时只有一处**未提交的加法改动**（`format.js` 新增三态词表与原因表，没有任何渲染点引用它），
  渲染结果与 `3627079` 一致；这一条如实记在这里，而不是假装工作树是干净的。
- `cp-after-*` / `manifest-after.json`：**12 个场景 × (full+tap) = 24 张 PNG**（4 地点 × 24/48/72h，含「理塘（手填坐标）」这一新变量）。
- `before-run.log` / `after-run.log`：控制台读数原文。
- `e2e-ui-test-verdict.log`：本轮代码上的 B 层真机套件原文（自动化端口 9420 先绑后跑）。
  读数 **BUSINESS PASS 26/0/0，UI 64 通过 / 0 失败 / 1 未验证，OVERALL INCONCLUSIVE，exit=2**——
  唯一那 1 项未验证就是原生 `<picker>` 的 tap-through（tap 后弹层不在可查询树），**本轮保持 INCONCLUSIVE，没有记成通过**。

## before → after 对照（同一地点、同一海拔入参、同一点击小时）

| 地点（海拔入参） | 点选小时 | 修复前 `r3` | 修复后 `r3` | 说明 |
|---|---|---|---|---|
| 峨眉山 3,004 m（picked） | 10 / 21 / 8 时 | 你在云中 | 此点正处于云中 | 三态①；主语改为查询点 |
| 理塘 4,058 m（picked） | 10 / 8 时 | 头顶有云层 | 云层在此点上方 | 三态③ |
| 理塘 4,058 m（picked） | 48h 视图 21 时 | （空） | （空） | `r2` 为「海拔 4,058 m 云量 0%」——判过是**晴空**，不是证据不足 |
| 成都 489 m（无 ele ⇒ 模型估算） | 10 / 21 / 8 时 | 头顶有云层 | 云层在此点上方 | 模型海拔的误差带（±600 m）够不到 2,246 m 以上的云带 ⇒ 仍给确定结论 |
| 理塘 4,058 m（**手填**坐标） | 10 / 8 时 | —（before 集没有这一档） | 云层在此点上方 | 手填与选点走同一条主语规则；before 侧的同一字符串已由上面「理塘（picked）」行取证 |

`subjectOk`（after 组 12/12 true）= 点击之后屏幕上的 `r3` 与图例都不含「你」字。

## 未覆盖 / 仍是 INCONCLUSIVE

- **375 与 414 两档真机仍未拍**：本机模拟器固定 390 宽。这两档只有 SVG/几何层判据
  （`tools/cloud-field-geometry-test.js`、`tools/meteogram-readability-test.js`）与 SVG 光栅化对照，
  **不得当作真机验证**。
- **原生 `<picker>` 交互仍是 INCONCLUSIVE**：自动化通道能触发 `onPoint`/`bindchange` 的处理函数，
  但无法证明真机上的选择器弹出与选中回调链条。本轮沿用「程序化驱动 + 数据读数」的证据等级，
  没有把 `<picker>` 记成已验证。
- **B 层真机套件**（`tools/e2e-ui-test.js`）在本轮代码上跑过，结论见上一段（OVERALL INCONCLUSIVE，exit=2）。
  另两套需要 DevTools 的（`e2e-ui-state-test.js` / `e2e-golden-path-test.js`）**本轮未跑**：
  无头全量扫描里它们记的是环境前置不成立 ⇒ INCONCLUSIVE，不是通过，也不代表失败。
- 日照金山一类需要 DEM/视线数据的机会：本轮**没有新增任何**这类主张（判据见 `tools/oi-claim-gate-test.js`）。
