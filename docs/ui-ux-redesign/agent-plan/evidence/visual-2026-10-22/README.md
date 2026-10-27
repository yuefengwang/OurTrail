# 视觉验收取证 2026-10-22（最终：通过；中途 ENV-ABORT 已翻案）

授权范围：用户批准重开共享开发者工具会话补拍 before/after。
结果：**4 张截图全部 VALID**（注入自证 + bundle 新鲜度门全过），主控目视验收通过。

## 产物
| 文件 | 来源 | bundle 自证 |
|---|---|---|
| before-home.png / before-discover.png | `D:/OurTrail-truth` @ e818e63 | `.field` 在、`.searchbar` 无 |
| after-home.png / after-discover.png | `D:/OurTrail-night-ui-v1` @ b385ae7 | `.searchbar` 在、`.field` 无 |
| before-readings.json / after-readings.json | 同轮驱动读数 | cards=2 注入回读一致 |

## 根因翻案链（重要，别重犯）
1. 首轮 9 步排除链（含授权内 `cli quit`）观察到「ws 桥在听、页内 agent 永不响应」，
   曾归因为「IDE 自动化开关需人工开启 / 孤儿会话」——**两者均被证伪**（孤儿扫描 0 命中；规范化 quit→open→30s→auto→6 次重试体检仍 DEAD）。
2. 用户报 IDE 错误「在项目根目录没有找到 app.json」并质问打开路径 ⇒ 真因浮出：
   **我经自建 `cli.js` 传 `--project D:\OurTrail-truth` 时未加单引号**，Git Bash 把反斜杠当转义吃掉
   （`D:\OurTrail-truth` → `D:OurTrail-truth` 驱动器相对路径），IDE 照它注册项目 ⇒ 解析到无 app.json 的目录 ⇒
   模拟器常驻编译错误 ⇒ agent 永不启动。这正是 SYNC.md 2026-10-09 已登记的坑，playbook 里路径加单引号就是防它；
   我在自己的调用层把它丢了。**所有「通道死」读数都是这一个错误的下游症状。**
3. 加单引号重跑：`probe2` 一次 ALIVE、before/after 两轮全门通过。
4. 教训入库：经任何自建包装层调 `cli.bat` 时，路径参数的引号必须在 **bash 层**就加（`'D:\...'`），
   包装层内部再加引号救不回已经被 bash 吃掉的反斜杠。

## 主控目视验收结论
- home：浅色导航（纸底黑字）生效；页头一行化；图标内嵌搜索条；照片在上卡 + 状态 pill 压图 +
  指标行「距离 16 km / 爬升 980 m / 人数 12/20」三级清晰；tab 栏与安全区无变化。与拼板 1.1 语言一致。
- discover：页头左标题 + 右视图分段；诚实 callout 文案逐字保留、压 caption 级；筛选行三控件 + 计数未增未减；
  卡片同 home 形态。与拼板 1.2 语言一致。
- 已知非缺陷：after-discover 合成卡媒体区为灰底——discover 的 cover 由页面投影给（真实卡恒非空），
  合成夹具刻意不带 cover；before 同因灰缩略图，非回归。
- 宽度仅验 375（模拟器默认）；390/414 与长列表滚动仍待后续真机轮。

## 会话恢复
结束时会话已用**加引号**路径恢复为用户主项目窗口（`cli open --project 'D:\OurTrail'`），islogin=true。
副作用登记：IDE 项目注册表里留有数个被吃路径的坏登记项（`D:OurTrail-truth` 等），未手工改注册表；
如碍眼可在 IDE 项目列表里手动移除。
