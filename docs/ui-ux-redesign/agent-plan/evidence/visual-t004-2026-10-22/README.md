# 视觉验收取证 2026-10-22 · T004 活动详情长图文（最终：通过；中途抓到并修掉一个真回归）

授权范围：用户批准使用共享开发者工具会话（`cli close/open` 切换 worktree + `cli auto`）。
结果：**before/after 两侧各 10 屏全部 VALID**（注入门 + bundle 新鲜度门 + 形态门 + 锚点闭合全过），主控目视通过。

## 两侧与被测对象

| 侧 | worktree | commit | bundle 自证 |
|---|---|---|---|
| before | `D:/OurTrail-truth` | `e818e63`（T004 基线） | 眉题「介绍」无编号；`.article-img` 圆角实测 **8px** |
| after | `D:/OurTrail-night-ui-v1` | `235ee19`（T004） | 眉题 `01 活动简介 … 10 报名后` 逐字在屏；圆角实测 **14px**（= `--radius-card`） |

活动页三个文件在 `e818e63..fffe04f` 间 diff 为空（夜分支前三个任务只动 home/discover/app.wxss），
所以 truth@e818e63 是该页面的合法旧 bundle；`app.wxss` 的 +23 行（`.searchbar`）不影响本页。

## 方法（与 T001–T003 同口径）

- 驱动：`%LOCALAPPDATA%/Temp/opencode/mp-auto/shot-activity.js`（新写，活动详情专用），
  端口 before=9435 / after=9436；`cli.js` 路径参数在调用层加单引号（visual-2026-10-22 的翻案教训）。
- 夹具：合成活动详情数据，字段形状全部取自 `activity.js` 渲染产物的真实键名（只喂数据、不镜像页面逻辑）；
  费用字段只用文本不用金额数字；封面与正文图用仓库真实 asset（`/assets/photos/*.jpg`），
  否则 `cloud://` 在无云环境必然加载失败，测到的就是破图而不是样式。
- 滚动：走页面真实的 `onSectionNav`（`wx.pageScrollTo` selector），截图 10 个章节锚点。
- 门：①注入门（title/denied 回读一致）②bundle 新鲜度门（编号眉题在/无，两侧互斥）
  ③形态门（hero/双图/chips/费用行在屏）④锚点闭合（同锚点 scrollTop 两侧逐项相同）。

## 抓到的真回归（本轮最重要的产出）

第一版把 `.article-images` 的 gap 从 8px 调到 12px，但 `.article-images.double .article-cell`
的宽度仍按 `calc((100% - 8px) / 2)` 计算 ⇒ 两列 + 新 gap 超出容器，`flex-wrap` 把第二张图
挤到下一行：**after 侧自 `sec-facts` 起全部章节锚点比 before 低 152px**（= 一行 140px 图 + 12px 间隙）。
静态门禁全绿（swx2 只管色值/字重/触控，不看 flex 换行）——**只有滚动锚点对拍能抓到**。

修法：列宽 calc 的减数与 gap 同账（double `-12px`、triple `-24px`），
并把「改 gap 必须同步改减数」的教训写进 `activity.wxss` 注释。
修复后复跑：10 个锚点 scrollTop 与 before **逐项相同**，布局语义（single/double/triple）零变化。

## 主控目视结论（after 侧）

- hero：难度 pill + 日期 + 标题/副标题 + 指标行（16km/980m/12-20）+ 状态 callout（含 ● 时间锚点）
  + CTA（填写报名资料/分享）+ 分区锚点 chips，均与拼板 1.4 语言一致。
- 章节眉题：`01 活动简介 … 10 报名后` 按阅读顺序连续；草稿相位（sec-facts/sec-weather 隐藏）
  编号不跳号（探针实测 draft 为 01–08）；「推荐理由」「剖面」是段内子题，不编号。
- 风光图组：double 两图并排、圆角与摄影卡同档；段落/推荐理由/事实行节奏未变。
- 路线段：地图 markers + 海拔剖面（3200–3800m）+ 节点时间轴（01 · 起点 喇嘛寺 + 导航）接线完好。
- 费用段：只渲染文本字段，无金额数字；「OurTrail 不收款」与封面三态脚注逐字保留。
- 装备段：必带/建议 chips 化呈现（该形态改前已在，本轮未动其语义）。
- 宽度仅验 375（模拟器默认）；390/414 与真机长列表滚动仍待后续真机轮。

## 产物

- `before/before-*.png`（10 屏）+ `after/after-*.png`（10 屏）+ 两侧 `*-readings.json`
  （含 kicker 全量读数、`.article-img` 圆角实测值 8px/14px、逐屏 scrollTop）。

## 会话恢复

结束时按惯例恢复为用户主项目窗口（`cli open --project 'D:\OurTrail'` + `cli auto --auto-port 9425`）。
