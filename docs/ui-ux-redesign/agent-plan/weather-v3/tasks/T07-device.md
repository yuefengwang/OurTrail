# T07 — 真机 E3（blocked）

- 目标：§10.4 六个区域截图 + 缺资料/无海拔/超范围/stale 四态；读数取 `el.text()`（DOM/像素双读）。
- 需要：`cli islogin` 正常、服务端口 33278 在听、`cli open --project 'D:\OurTrail'` + `auto` 拿到 `{"autoPort":…}` 且端口 LISTENING。
- 本轮状态：**blocked（ENV）**。没有可用的自动化会话；按 `docs/e2e-mp/automation-playbook.md` 记 ENV-ABORT，不猜 PASS。
- 恢复步骤（需用户授权，因为会动共享的开发者工具会话）：
  ```
  cli close --project 'D:\OurTrail' --port 33278
  cli open  --project 'D:\OurTrail' --port 33278
  sleep 25
  cli auto  --project 'D:\OurTrail' --auto-port 9421 --trust-project --port 33278
  ```
- 截图前必须先断言门槛链（`ready === true`、`hourlyColumns > 0`、`cloud !== null`、`sky.cards.length === 3`），否则读到的是旧 bundle 或空页。
- 证据目录（本轮只建占位）：`docs/ui-ux-redesign/evidence/weather-v3-2026-10-27/`。
- 不得改代码；只写证据与 UNVERIFIED 清单。