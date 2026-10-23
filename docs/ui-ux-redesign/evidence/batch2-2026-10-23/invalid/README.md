# batch2 真机核验：作废轮次说明

本目录存放两次**驱动脚本自身缺陷**导致的作废运行读数。两次都不是产品缺陷，
其中第二次连截图都没有产出。有效运行的读数与截图在上层目录
（`readings.json` + 7 张 306×660 PNG，16/16 marker 全真）。

## attempt1-marker-bug-readings.json（作废）

- **失败读数**：`FAIL=VALIDITY noticesButtonGone,anoticesButtonGone`
- **原因在判据不在产品**：第一版 marker 假定「点一次加载更多后按钮就消失」。
  真实数据有 669 条，点一次只从 20 条展开到 40 条，还剩 629 条，按钮**本应继续存在**。
  驱动把一个正确行为判成了失败。
- **改法**：把「按钮消失」从这一轮删除，换成四条能区分对错的读数——
  `Step20`（每点一次可见数 +20）、`HiddenShrunk`（隐藏数同步 -20）、
  `DomMatches`（DOM 卡片数 === visibleItems 长度）、`ButtonAccurate`（按钮文案里的数字 === hiddenCount）。
  「点到底后按钮消失」另用一份 25 条的注入数据单独验证（`notices-tail.png`）。

## attempt2-page-destroyed-readings.json（作废）

- **失败读数**：`Error: page destroyed`
- **原因在驱动生命周期**：尾部用例复用了 notices 的页面句柄 `n`，
  而中途已经 `mp.reLaunch('/pages/anotices/anotices')`，旧句柄随页面销毁失效。
- **改法**：尾部用例前重新 `reLaunch('/pages/notices/notices')` 拿新句柄 `n2` 再注入，
  有效运行的 `noticesTail` 读数（25 / 0 / DOM 25 / 按钮消失）就是这么得到的。

## 有效性边界（有效轮次同样适用）

- **me 的位置行是注入的**：两条 `positionRows`（一条已过期、一条仍有效）由驱动
  `setData` 注入，验的是**渲染分岔**（「已过期（活动已结束）」vs「本次活动的位置授权仍然有效」）
  与撤回后果文案常驻；**全程零点击撤回**，没有写云端、没有改账号数据。
- **notices / anotices 用的是真实数据**：669 条真实通知，未注入。
- 状态页（`me` / `discover`）的生效前提是真 bundle：新文案
  「撤回后本次不再共享；如需恢复需重新上报。」只存在于本批代码，
  屏幕上出现它即证明模拟器加载的是重编译后的 bundle。
