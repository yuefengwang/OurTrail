# 校验记录 · Stitch 天气设计资产（2026-10-30）

## 怎么复现

```bash
node tools/design-assets-check.js
node tools/design-assets-check.js --require-tracked   # 提交时/提交后跑这一条
```

脚本零依赖（只用 Node 内置 `fs` / `path` / `zlib` / `crypto` / `child_process`），
ZIP 校验由脚本自己解析（不依赖 `unzip` 命令）。任一条失败退出码为 1。

环境：macOS · Node（本次执行版本见下）· 仓库根目录。

## 校验项与它证明了什么

| # | 校验 | 证明什么 | 失败意味着 |
|---|---|---|---|
| 1 | manifest 可解析、schema 基本字段 | 清单是可被机器读取的，且关键字段存在 | 清单损坏或字段缺失 |
| 2 | 逐文件存在 / 字节数 / SHA-256 | 入库后**没有人改过任何一个原始文件** | 有人编辑、重压、转码或丢文件 |
| 3 | 快照文件总数 | 24 个资产 + 6 个文档，没有多也没有少 | 有未登记文件被塞进快照 |
| 4 | HTML ↔ PNG 成对；目录集合闭合 | 每个屏族都有可点击的 HTML 与截图，screens[] 与磁盘一致 | 有屏缺图、缺码或未登记 |
| 5 | Markdown 本地链接 | 文档里的链接**真的能点开**（相对路径解析到真实文件） | 死链 |
| 6 | ZIP ↔ raw 逐文件 | 保留的原始 ZIP 与解压副本**逐字节相同** | 副本被改过，或 ZIP 不是原始那份 |
| 7 | DESIGN.md 未改动 | 1,581 B / 固定 SHA-256 | 有人改写了设计说明 |
| 8 | 天气生产代码零改动 | `miniprogram/`、`cloudfunctions/` 在工作区与自基线提交以来均无改动 | 本轮越界改了业务代码 |
| 9 | Git 跟踪 | 全部资产已进版本库（`--require-tracked` 时强校验） | 有文件只在本机、换机器就丢 |
| 10 | 无个人目录绝对路径 | 文档与清单里没有以用户主目录开头的绝对路径，也没有本地文件协议 URL | 换机器后引用失效 |
| 11 | 无重复内容 | 同一 SHA-256 只对应一个路径 | 有文件被重复导入 |
| 12 | 外部依赖声明 ↔ HTML 实际 | 清单里的依赖清单与 HTML 里真实出现的**主机集合**一致 | 漏登记或编造依赖 |
| 13 | 状态词约束 | 本快照没有任何 `confirmed` 页面，DESIGN.md 状态为 `unresolved` | 有人把「入库」偷换成「定稿」 |

## 实际读数

执行：`node tools/design-assets-check.js --require-tracked`
（`git add` 之后、`commit` 之前；退出码 0。Node v24.14.1 / macOS）

```
1. manifest.json
  § 1. manifest.json：12 项通过

2. manifest.files ↔ 磁盘（存在 / 字节数 / SHA-256）
  § 2. manifest.files ↔ 磁盘（存在 / 字节数 / SHA-256）：6 项通过

3. 快照文件总数
  § 3. 快照文件总数：3 项通过

4. HTML ↔ PNG 成对
  § 4. HTML ↔ PNG 成对：4 项通过

5. Markdown 本地链接
  § 5. Markdown 本地链接：2 项通过

6. ZIP ↔ raw 逐文件一致
  § 6. ZIP ↔ raw 逐文件一致：4 项通过

7. DESIGN.md 未改动
  § 7. DESIGN.md 未改动：3 项通过

8. 天气生产代码零改动
  § 8. 天气生产代码零改动：2 项通过

9. Git 跟踪
  § 9. Git 跟踪：1 项通过

10. 无个人目录绝对路径
  § 10. 无个人目录绝对路径：1 项通过

11. 重复内容
  § 11. 重复内容：1 项通过

12. 外部依赖声明一致性
  § 12. 外部依赖声明一致性：3 项通过

13. 状态词约束
  § 13. 状态词约束：4 项通过

------------------------------------------------------------
design-assets-check: passed=46 failed=0
```

各段含义：

- §1 是 manifest 自身的字段约束（12 项），不含文件比对。
- §2 是逐文件的**存在 / 字节数 / SHA-256**，外加"manifest 24 条"与"磁盘↔清单双向一致"。
- §3 是总数闭合（24 资产 + 6 文档 = 30）。
- §4 是 11 个屏目录成对 + screens[] 与磁盘目录集合闭合 + 每屏的 `html`/`png` 都出现在 `files[]` + `module` 字段。
- §5 是文档内**所有**相对链接（本快照 40+ 条）都能解析到真实文件。
- §6 是 ZIP 条目数 / 文件数 / 逐字节 / 解压总字节。
- §7–§9 是"没被改写""没动生产代码""都已进版本库"三条边界。
- §10–§13 是路径卫生、去重、依赖声明与状态词约束。

> 提交后如需复核，直接重跑同一条命令即可；脚本不依赖本机路径、不依赖 `unzip`、不写任何文件。

## 逐项补充说明

### 文件与哈希

- `manifest.files[]` 共 **24** 条：23 个 raw 文件（11×`code.html` + 11×`screen.png` + 1×`DESIGN.md`）+ 1 个 ZIP。
- 断言的是**逐字节**：`bytes` 与 `sha256` 两列都对得上才算过。
- 快照内文件总数 **30** = 24 资产 + 6 文档（`README.md`、`manifest.json`、`SCREEN_INDEX.md`、
  `DESIGN_CONFLICTS.md`、`ASSET_AUDIT.md`、`VERIFICATION.md`）。

### ZIP 与 raw 的关系

- ZIP 条目 **36**（13 目录 + 23 文件），解压后总计 **5,475,222** 字节。
- 脚本把 ZIP 内 `stitch_ourtrail_ui_optimization/` 前缀去掉后，与 `raw/` 同名文件逐字节比对。
- **不声称**这个 ZIP 是 Google 的「原始导出包」；它就是导入时拿到的那一份，原样保存，未重打包。

### 天气生产代码

- 判据一：`git diff --name-only HEAD -- miniprogram cloudfunctions` 为空（工作区干净）。
- 判据二：`git diff --name-only <基线>..HEAD -- miniprogram cloudfunctions` 为空
  （基线 = 本任务开始时的分支头 `e5a3d5e`；脚本可用 `--base=<rev>` 覆盖）。
- 两条都为空 ⇒ 本轮没有动任何天气业务代码、云函数或全局样式。

## 明确未验证（UNVERIFIED）

这些不属「校验失败」，而是本轮**没有能力或没有授权**证明的事项。不得当作已通过：

| 项 | 原因 |
|---|---|
| 原型截图与浏览器渲染是否一致 | 本轮未在浏览器打开 HTML 做像素对照 |
| Stitch 项目 ID | 导出物与 ZIP 里都没有 |
| `lh3.googleusercontent.com` 图片内容 | 未下载、未探测；仓库内无字节 |
| 哪个版本是最终设计 | 属下一阶段的裁决，不在校验范围 |
| 原型 vs 现有实现的视觉差异 | 本轮未做任何实机对照 |
| 375 / 414 宽度下的原型表现 | 截图固定 780（一份 784）宽 |

## 与门禁的关系

`tools/design-assets-check.js` 是**本任务专用**的资产校验，不替代、也不修改既有门禁。
既有 `node tools/check.js` / `node tools/check-handlers.js` 仍然照跑（本轮只新增了文档与一个工具脚本，
未改任何 WXML/WXSS/JS 业务文件，见上「天气生产代码」）。
