# 「我的」页 · 山野档案 v3 实施证据（2026-10-29）

原型：`D:\OurTrail_UI_Lab\ourtrail-expansion\profile\option-b.html`（B · 山野档案 v3，`docs/expansion/handoff.md` 记录已选型）
实现：`miniprogram/pages/me/{me.wxml,me.wxss,me.js}`

## 1. 已定裁决

| # | 裁决 | 落地 |
|---|---|---|
| 1 | 布局像素级 1:1，字号按小程序规范放大 | 头图 148 / 头像 72 / 大卡封面 82 / 履历四格 / 安全三行；9–11px → 12/14/16/18/21 |
| 2 | 只显示真实数据 | 头图用 `cover-snow.jpg` + 「配图示意」；无签名行；履历 = 同行（进行中+已完成）/ 进行中 / 路线库 / 由我发起 |
| 3 | 协作码按原型删除 | 删 `displayIdentity` / 复制入口；`route.wxml` / `roster-panel.wxml` 三处「去我的页复制」改为「由对方提供」 |
| 4 | 扩展 me 视图并重部署 | `stats.routes` + `recent[].pickupName`；trailApi / trailApiLab 已部署 |
| 5 | 授权重开 DevTools 真机 | 见 §4 |

## 2. 真机读数（VERIFIED，390 宽 IDE 模拟器，端口 9421）

真实账号（走查用户）回读：

```json
{
  "stats": { "ongoing": 1, "finished": 0, "organized": 1, "routes": 2 },
  "ledger": { "trips": 1, "ongoing": 1, "routes": 2, "organized": 1 },
  "recent": 1,
  "tripNext": "走查测试活动",
  "position": { "has": false, "badge": "未上报", "sub": "还没有在活动中上报过位置" }
}
```

- `me-drive.js` **17/0**：页面载入、身份数据、履历四格、大卡装配、位置三态之一、头图 148、头像 72×72、安全卡三行、页脚、四态截图。
- `me-lower.js` **6/0**：安全区 5 个标题（安全卡 3 + 路线库 + 位置授权）、同行人条、路线库数字、两个独立行、页脚、下半屏截图。
- 大卡 overline 是「**最近一场 · 你发起**」而不是「下一程」——活动 `startAt` 已过、阶段不是进行中，页面没有把它包装成期待（`isUpcoming` 判据）。
- 集合点「东门集合点」、`routes = 2` 来自线上新字段，证明部署生效。

## 3. 截图

| 文件 | 内容 |
|---|---|
| `me-normal-390.png` | 正常态首屏（头图 / 身份 / 履历 / 大卡） |
| `me-normal-lower-390.png` | 正常态下半屏（安全卡 / 同行人胶囊 / 路线库 / 位置授权 / 页脚） |
| `me-incomplete-390.png` | 待完善态（徽标「资料待完善」+ 暖色引导卡 + 占位昵称） |
| `me-empty-390.png` | 空行程态（履历隐藏、虚线空态卡、安全区保留） |
| `me-denied-390.png` | denied 态（头图占位 + 问候 + gate + 重新尝试） |

## 4. 真机通道事故（记录，不是产品缺陷）

PowerShell `Set-Content -Encoding UTF8` 给 `me.wxss` 写入 BOM（`EF BB BF`）后，IDE 报「编译 .wxss 文件错误」，模拟器白屏，`miniprogram-automator` 的每个请求都返回 `timeout waiting for automator response`。用 `[IO.File]::WriteAllText(..., new UTF8Encoding($false))` 去 BOM 后一次恢复。

- `tools/check.js` 不检查 BOM；
- 本次 `@media (max-width: 380px)` 也让 G7/G8/G11 三门「拒绝工作」（门不假装看过），已删除该段，未做 375 分档；
- 结论：**改仓库源文件只用编辑工具，不用 `Set-Content`。**

## 5. 1:1 例外（如实登记）

- 圆角 15/13/12 → token 14/8；阴影 → 白描边 + 细线（全站零阴影）；
- 原型绿 `#16783e` → `--forest`；9–11px → 12/14（否则真机不可读）；
- 头图固定本地山景照 + 「配图示意」，不是用户自定义封面；
- 空态保留安全区（安全资料与活动无关，原型 empty 隐藏属演示缺陷）；
- denied 不冒充「未登录」：小程序始终有 openid，读失败给真实原因 + 重试；
- 安全行副标题允许两行（原型 9px 单行省略，放大后会截掉路线库关键半句）。

## 6. 仍未覆盖

375 / 414 宽度分档、真机上同行人 > 0 的胶囊横滑、有位置授权（可撤回 / 已过期）的 sheet 态、物理手机。