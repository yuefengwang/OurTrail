# Weather V2 审计证据包（2026-10-09）

配套报告：`docs/weather-ux/weather-v2-final-visual-audit.md`。
本目录只放**证据**，不放结论；每张图对应的读数在两份 manifest 里。

## 真机截图（微信开发者工具 390×753 CSS px，dpr 3，线上真数据）

命名：`v2-{before|after|after-verify}-{地点}-{时间窗}-{宽度}px-{full|tap}.png`

| 前缀 | 含义 |
|---|---|
| `after-*` | 修复后（当前分支代码），三地点 × 24/48/72h 共 9 例 |
| `before-*` | 临时把 `utils/cloud-field-svg.js` 换回修复前实现、重新编译后拍摄，5 例（拍完立刻还原） |
| `after-verify-*` | 还原后重编译的复核张，读数与 `after` 一致 ⇒ 证明 before/after 的差来自代码而不是环境漂移 |
| `-full` | 整屏 |
| `-tap` | **一次真实点击 `.cf-img` 之后**的状态（选中层出现、读数改写）；`-full` 是点击前 |

`manifest-after.json` / `manifest-before.json` 每行记录：地点、经纬度、`ele` 入参与其来源、`viewSpan`、
云函数 `updatedAt`、`chartElev`、点卡 `eleText`、点击前后 `selSrc/hour/r2/r3`、字节数。

## 局部放大对照（Chromium 光栅化，非微信渲染管线）

`ot-zoom-emeishan-24h-375px.png`、`ot-zoom-emeishan-72h-414px.png`：
同一份真实气压层剖面、同一份生产渲染代码，只把「场数学」换成修复前/后，云场行 2× 放大并排。
左图可见：横穿云体的直线斜切（SVG `Z` 闭合弦）、云团内部白色空洞（自交环被 `evenodd` 挖穿）、针状碎片。

## tools/（复现脚本，仓库外运行，不属生产代码）

| 脚本 | 作用 |
|---|---|
| `fetch-real.js` | 用生产 `cloudfunctions/trailApi/lib/weather.js` 抓成都/峨眉山/理塘 168 h × 22 层真实剖面，写 `real-cloud.json` |
| `diag5.js` | 新旧实现同数据对拍：断链 / 自交环 / 长弦环 / 针状碎片 / 折角顶点占比 |
| `render-ab.js` | 18 组整卡新旧 SVG + `index.html`（24/48/72h × 375/390/414） |
| `render-zoom.js` | 18 组云场行 2× 放大 `zoom.html`（本目录两张放大图即来自它） |

脚本内是绝对路径（`D:/OurTrail/...` 与 `%TEMP%/ot-cf/...`），需要时改两行即可复跑；
`cloud-field-svg.BEFORE.js`（修复前快照）不入库，用 `git show 076bf11:miniprogram/utils/cloud-field-svg.js` 取回。
