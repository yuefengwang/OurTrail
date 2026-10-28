# T08 — 收口（SYNC / 设计系统 / 文档回写）

- 目标：把本轮的事实写进仓库，而不是留在对话里。
- 允许修改：`SYNC.md`、`.agents/skills/ourtrail-ui/references/design-system.md`、`docs/**`（本目录、证据包、spec 状态行）。
- 步骤：1) SYNC 条目（根因/修法/门禁读数/部署需求/真机状态）；2) design-system §17 皮肤例外登记；3) 证据包 README（UNVERIFIED 逐条）；4) 实施文档状态从"设计稿"改为"已实施（含未完成项）"。
- 判据：`node tools/check.js` 通过；SYNC 条目里出现"需要重新部署 trailApi"（本轮 `cloudfunctions/` 已改）。
- 不做：不改任何业务代码；不把"没跑真机"写成"已验证"。