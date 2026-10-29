# 逐时预报空图 + 24/48/72 云层剖面不一致 —— 证据包（2026-10-28）

对应 `SYNC.md` 2026-10-28 同日第二条。用户报障形态：① 逐时预报 tab 只有图身空白（表头/日期条/读数行/左轴/时刻标签都在）；② 同一节点切 24h 与 48h，云层剖面纵轴范围与云带密度全变。

## 1. 环境（读这份证据前先认这几条）

| 项 | 值 |
|---|---|
| 设备 | **微信开发者工具 IDE 模拟器**，等效视口 390×844（截图落盘 306×660） |
| 基础库 | `libVersion 3.8.12`，`skylineRenderEnable: false`（WebView 渲染） |
| 重编译 | 用户授权 `cli close --project 'D:\OurTrail' --port 33278` → `open` → `auto --auto-port 9421`；**未 `quit` IDE**（共享资源） |
| 自动化 | `miniprogram-automator@0.13.0`，装在仓库外 `%LOCALAPPDATA%\Temp\opencode\mp-auto3`（仓库保持零 npm 依赖） |
| 数据 | **生产链实取**：`pages/weather-hub` 的 `goPoint({name:'峨眉山', lat:29.5197, lng:103.3317, ele:3099, eleSource:'manual'})` → 云函数未变的取数路径 → Open-Meteo 真回 |
| 未被验证 | **物理手机**（需上传开发版进审核或 `cli preview` 扫码，两者均未执行）；用户最初那次手机空白的确切原因 |

门槛链在每张截图前先断言（`readings.json.gate`）：`dayStrip=5` / `hourlySrc` 长度 43783 / `cloud.src` 存在。元素不在 DOM 里时读数是假的，这一条是截图有效性的前置。

## 2. 截图索引

| 文件 | 说明 | 结论 |
|---|---|---|
| `hourly-full-24.png` | 逐时预报 24h，**整张图完整入镜**（按元素 offset 定位滚动，不是写死的 700） | 温度+体感、降水+概率、风+阵风、高/中/低云五段全在：24 列、1008×310 px。**① 已修** |
| `hourly-full-72.png` | 逐时预报 72h | 72 列 / 3024×310 px，同结构正常 |
| `hourly-24.png` / `hourly-72.png` | 第一版截图（`pageScrollTo(700)`） | **半有效**：温度段被标题栏滚掉，只作"图身有内容"的旁证；结论以 `hourly-full-*` 为准 |
| `cloud-24.png` / `cloud-48.png` / `cloud-72.png` | 云层剖面三档 | 三档 `剖面 0–4,000 m`、刻度 4,000/3,000/2,000/1,000/0 m、`虚线 = 此点海拔`、`此点 3,099 m` **逐字相同**。**② 已修** |
| `sky-24.png` / `sky-arc.png` | 日月天相 | 日照弧 07:08 / 18:33 / 白昼约 11 小时 25 分（顺带证明 `weather-v3.js:390` 的 `xmlns` 修复有效） |
| `gate-failed.png` | 首次驱动门槛链未过时的画面 | 留档：那次读数无效，不作任何结论 |
| `readings.json` | 三档 DOM 文本读数 + 日志 + 污染自证 | `distinct(period)→3`，说明 `period` 真的生效 |

`readings.json` 里 `lo..hi=undefined / ticks=undefined` 是**探针字段取错**（`cloud` 对象上没有这两个键，真值在 SVG 与 DOM 文本里），已按 `rangeLabelData` / `legendElevData` 取文本读数为准，且三档 SVG 长度分别 90260 / 99213 / 137456 字节，互不相同。

### 2b. 设备上真实 SVG 的图元清点（`probe2/device-*.svg`，`dump-svg.js` 解码落盘）

`probe2/device-hourly-24.svg`（27,282 B，根节点 `xmlns` + `width/height/viewBox`，`hsl(` 0 处、`font-family` 0 处、多余引号 0 处）：

| 段 | path | rect | text |
|---|---|---|---|
| temp | 2（温度线 + 体感线） | 0 | 24 |
| precip | 0 | 24（每小时一根柱） | 48（数值 + 概率） |
| wind | 2（风 + 阵风） | 0 | 48（数值 + 风向） |
| cloud-high / mid / low | 0 | 1 / 1 / 1（连续色带） | 24 / 24 / 24 |

`probe2/device-cloud-{24,48,72}.svg`：三档 Y 轴刻度**逐字相同** `0 / 1,000 / 2,000 / 3,000 / 4,000`，三档都写着 `此点 3,099 m` 与 `剖面 0–4,000 m`；差异只出现在数据本身的图元与时间标签上（24h 逐时 00…22，48/72h 六小时一格）——这正是"同一把尺、不同的数据"。

## 3. ① 的定位链（二分过程可复现）

1. 模拟器上**复现同一块空白**（生产数据、生产形状载荷）。
2. 同一 `<image>` 注入**最小 SVG**（一个 `<rect>`）⇒ 正常出墨；注入生产 `hourlySrc` ⇒ 空白。**解码器没问题，是这份 SVG 非法。**（`probe/01-rect.png` … `06-produced.png`）
3. 变体矩阵 `probe/bisect/`：去渐变、去全部 `<text>`、去 `<defs>` 均仍空白；**去掉 `<g>` 开闭标签后立刻出墨** ⇒ 元凶在 `<g>` 上。
4. 根因：`'<g data-seg="temp"">'` —— 开标签多一个引号，XML 非法 ⇒ 严格解析器丢弃整份文档。表头与刻度是 DOM，照常渲染，所以现场像"渲染没生效"而不是"图坏了"。
5. 这个引号是上一轮删 `font-family` 时写坏的。**用户最初报障时的文件是合法 XML**（原写法带 `font-family`），所以手机那次空白的原因**仍未证**——考古探针 `probe2/p4-all.png` 把 `font-family`、`hsl()`、`role`+`aria-label` 三者一起加回，模拟器上照常出墨，说明手机解码器可能不同，但本机无法证。

## 4. 复跑方式

```bash
# 仓库外装驱动库（仓库零 npm 依赖，不要装进来）
cd %LOCALAPPDATA%\Temp\opencode && mkdir mp-auto3 && cd mp-auto3
npm.cmd init -y && npm.cmd install miniprogram-automator
cp <本目录>/tools/*.js .

# 重编译（需用户授权，且只 close --project + open，不 quit）
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" close --project 'D:\OurTrail' --port 33278
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" open  --project 'D:\OurTrail' --port 33278
# 等 25s
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto --project 'D:\OurTrail' --auto-port 9421 --trust-project --port 33278

node v3-drive.js    # 主验证：门槛链 → hourly → cloud 24/48/72 → readings.json
node final-shot.js  # 按元素 offset 定位滚动，整张逐时图入镜（hourly-full-24/72）
node dump-svg.js    # 把设备上真实的 hourlySrc / cloud.src 解码落盘到 probe2/device-*.svg
node diag.js        # 数据键清单 + 最小 SVG 矩阵
node bisect.js      # 六个变体（a 原样 / b 去渐变 / c 去 text / d 去 g / e 去 opacity dot / f 去 defs）
node probe2.js      # 考古：p0 当前 / p1 font / p2 hsl / p3 role / p4 三者同时
node sky.js         # 日月天相
node extra.js       # 天相 tab + 72h 逐时
```

脚本里的截图输出路径写的是本目录；若在别处跑，注意 `mp.screenshot()` 返回 **base64 字符串**，必须 `Buffer.from(String(raw), 'base64')` 再落盘（直接 `writeFileSync` 得到的是"文本伪装的 png"）。

## 5. 无效/作废记录

- `gate-failed.png`：门槛链未过，该次任何读数与截图不作结论。
- `readings.json` 的 `lo..hi` / `ticks` 字段为 `undefined`：探针取错键，不是页面缺值；结论只取 DOM 文本项。

## 6. 这包证据能证明什么、不能证明什么

**能**：在 IDE 模拟器上、生产数据、生产形状载荷下，① 逐时图出墨且 72h 正常；② 24/48/72 云层剖面显示窗/刻度/图例逐字相同，且三档 SVG 两两不同（不是复用同一张图）。

**不能**：不能说"手机上已修好"。物理手机未跑；用户最初那次手机空白的确切原因未证（三条可疑特性在模拟器上都不致命）；72h 逐时图的解码耗时未测。
