# H-T07 · R7 → R0（真机 E3：ENV-ABORT）

## 状态
**NOT_RUN / ENV-ABORT**。本轮执行环境没有可用的微信开发者工具自动化会话，且按 playbook §3，
恢复通道要 `cli quit` + 重开**共享的** IDE 会话——那会打断用户正在用的窗口，未经授权不执行。

## 已尝试的判据（不是"猜"）
- 未执行 `cli auto`（没有已注册的自动化端口，直接调用只会在超时后留下僵死会话）；
- 证据包只写已有 E1/E2 读数，不写任何像素结论。

## 恢复后必须先做的事（否则证据会假）
1. `close --project 'D:\OurTrail'` → `open` → `auto`（不 `quit`），拿到 `autoPort` 且端口 LISTENING；
2. 每个用例前 `reLaunch`（清 `_geo/_unified` 这类实例缓存）+ 独立 `updatedAt`；
3. 截图前断言门槛链：`ready===true` / `hourlyColumns>0` / `cloud!==null` / `sky.cards.length===3`；
4. 星级与读数取 `el.text()`，不从 data 推断；
5. 两个用例的云图/OI 读数必须不同（污染自证），相同即整批无效。

## 需要的六区 + 四态
页头 / 日期条 / 四视图 tab（吸顶前后）/ 逐时图（24·48·72）/ 云层（缺资料·无海拔·正常）/ 日月（三态）/ 行程流（待安排·超范围·正常）/ 六个弹层 / stale 横幅 / 375·414。

## 回滚
无代码改动。