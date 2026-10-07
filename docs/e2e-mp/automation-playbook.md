# 微信开发者工具自动化联调 · 交接手册

> 面向：要在 OurTrail 上跑真机 E2E（`tools/e2e-ui-test.js` / `tools/e2e-golden-path-test.js`）的 agent。
> 下面每一条都是**本机实测踩出来的**，不是文档转述。标了「现象」的，是你将来会看到的症状。
> 端口约定：IDE 服务端口 `33278`，自动化端口 `9420`。CLI：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（路径含中文，PowerShell 里必须用 `& '...'` 调用）。

## 0. 一句话版

模拟器不是一个稳定的测试靶子：它会被你自己的并行任务搞坏，会在冷启动时慢到让断言假红，会让"点下去没反应"看起来像"点成功了"。
**先证明会话活着，再证明产品对不对**——顺序反了就是在读垃圾。

---

## 1. 一次性前置（每台机器人工做一次，命令行做不到）

1. IDE → 设置 → 安全设置 → **服务端口**开启（我们这台是 33278）。未开时所有 `cli` 命令报 `IDE service port disabled`，
   而且**管道喂 `y` 无效**（需要真实交互 stdin）。
2. 扫码登录：`cli islogin` 要返回 `{"login":true}`。账号需对 appid 有开发者权限。
3. 服务端口页面上的 **CLI 访问令牌留空**——留空时 CLI 的 HTTP/WebSocket 不校验令牌。MCP 接口是另一套鉴权，别混。
4. 驱动库装在**仓库外**：`%LOCALAPPDATA%\Temp\opencode\mp-auto` 或 `~/.ourtrail-e2e`。
   本仓库零 npm 依赖是铁律，不能污染。PowerShell 下用 `npm.cmd`（执行策略会拦 `npm.ps1`）。

---

## 2. 每轮流程（照抄，别省步）

```bash
CLI="/c/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
"$CLI" quit   --port 33278                      # 见 §3：quit 不是 close
sleep 12
"$CLI" open   --project 'D:\OurTrail' --port 33278
sleep 30                                          # 等编译 + 模拟器起来，别省
"$CLI" auto   --project 'D:\OurTrail' --auto-port 9420 --trust-project --port 33278
sleep 5
node preflight.js                                 # §4 的会话体检，过了再跑测试
node tools/e2e-golden-path-test.js
```

- **改完代码必须重启项目窗口**，否则模拟器还在用旧 bundle。只调 `auto` 不会重新编译——
  本轮就因此对着"修复没生效"排查了很久。
- `auto` 偶发返回里没有 `"autoPort"`：窗口还没起来。**再跑一次 `auto` 就行**，不要以为是 IDE 坏了。
- 跑测试期间**不要再起第二个用设备的进程**（包括上一条没死干净的循环）。

---

## 3. 会话僵死：最贵的一课

**症状（三选一出现就是它）**

- `Error: Connection closed, check if wechat web devTools is still running`
- `Failed connecting to ws://127.0.0.1:9420 ...`
- 读数**大面积红**：编辑器 `.seg=0`、`page destroyed`、`page.$('roster-panel')` 返回 null、`page.data()` 返回 null
  ——但控制组 `$$ view` 仍然返回几百个元素（通道探针显示 healthy，骗人）。

**根因**：并行/遗留的第二个 automator 会话在抢同一个 9420 端口。典型来源是你用工具后台起了一个循环，
后来又 kill 掉它——**杀父进程不会杀子循环**。本轮实际发生过两次，第二次白烧了两轮十连跑。

**处置**

1. `cli quit`（**`close` 不够**，close 只关项目窗口，僵的正是这个项目会话）。
2. `sleep 12` → `open` → `sleep 30` → `auto` → `preflight.js`。
3. 清孤儿进程按 **CommandLine** 匹配精确杀，不要按进程名乱杀（IDE 自己有一堆 `node.exe`，而且机器上可能有别人的并行 agent）：

```powershell
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'e2e-golden-path-test|e2e-ui-test') -or
  ($_.Name -eq 'bash.exe'  -and $_.CommandLine -match 'p3-stability\.sh$')
}
```

**判读纪律**：大面积红先怀疑会话，不要怀疑产品。真产品缺陷长这样——`passed=191 failed=5`，红集中在 2~3 个节点；
会话坏掉长这样——`failed=32~50`，红从第一个交互开始一路级联。

---

## 4. 开工前体检（preflight）

`~/.ourtrail-e2e/preflight.js`，**三跳真点击**，任何一步不过就别开跑：

1. `reLaunch('/pages/home/home')` → `data.loading === false && !data.denied`；
2. 在页面按钮里按文案命中「发起活动」并 `tap()`；
3. 编辑器 `data.isNew === true` 且 `$$('.seg').length === 3`。

十连跑脚本把它做成门禁：**不过就重启再来，最多三次；三次仍不过该轮记 `ENV-ABORT`**，
绝不允许拿垃圾读数充当结果。

---

## 5. 元素查询语义

| 事实 | 后果 / 对策 |
|---|---|
| `page.$(sel)` **恒返回单个 Element**，`page.$$(sel)` 才给数组 | 本项目历史上写过 `Array.isArray(await page.$(...))` → 恒 false → **所有 tap 从未发生**而读数是绿的。`auditSource` 现在把 `Array.isArray` 当违规抓 |
| 自定义组件用**标签名**直接选：`page.$('field-panel')` | 组件的 `data()` 能读，`el.$$(...)` 在宿主作用域里查子树 |
| **子组件自己模板里的节点查不到**：`<overlay>` 内的 `.overlay-mask` / `.icon-button`，从宿主或从 `overlay` 元素都拿不到 | 别据此说产品坏。记 `uiUnverified` 并写清"三种查法都落空、同页 `.button` 查得到" |
| **slot 内容要从宿主面板作用域查**（`tp.$$('.button')` = 7 个；`overlayEl.$$` = 0 个） | 弹层里的按钮一律从面板句柄找 |
| 通道健康要用控制组探针：`$$('# view')` 非空才算 healthy | 退化时把整块记**门槛未过 → INCONCLUSIVE**，永远不是 PASS |
| `el.text()` / `el.attribute('class')` / `el.property('checked')` 可用 | 读渲染态与读 `data` 是两件事：`property('checked')` 抓到过"渲染已勾、数据为空"的产品缺陷 |

---

## 6. 点击语义：三个坑，每个都能造出假绿或假红

1. **重渲染之后旧句柄仍然会「点击成功」**。`await el.tap()` 不抛错，但作用在已经换掉的节点上 = 什么都没发生。
   本轮实测两次：上车第二条被重复点在同一人身上、签到循环把同一行点两次。
   对策：**每轮重新 `queryAll` 并按 `data-id` 点名**，绝不缓存元素数组按下标点第二行。
2. **条件绑定的按钮是空按钮**。本项目大量写：

   ```xml
   <view class="button {{busy ? 'disabled' : ''}}" bindtap="{{busy ? '' : 'onSave'}}">保存草稿</view>
   ```

   `busy` 期间 `bindtap` 绑的是空串——tap 成功、无报错、无效果。同理 `{{!reason || busy ? '' : 'onTransitionConfirm'}}`：
   **原因没落进 `data.reason`，「确认变更」就是个空按钮**，点了什么也不会发生。
   对策：点之前先轮询到 `page.data().busy === false`（以及该类按钮需要的就绪条件）。
3. **弹层开着时遮罩吞点击是正确行为**（不是 bug）。下一步操作前要么关层，要么重进页面。
4. 详情页/发布确认成功后**页面会被销毁并跳转**：拿旧句柄再查一次就是 `page destroyed`。
   对策：`page = await mp.currentPage()` **重绑句柄**再查；判定改走云端回读而不是页面状态。

---

## 7. 读数时机：假红的第一大来源

落库、重渲染、面板重读都是异步的。**一次性判读会把「还没回来」误诊成「没做到」。**
本轮定版十连跑修掉的四类，全是这一类：

| 症状 | 真相 | 对策 |
|---|---|---|
| 「确认没生效（弹层仍开、无红字）」但回读阶段已推进 | 页面要跑一轮云端往返才 `setData(transitionOpen:false)` | 轮询到「层关闭 **或** 出现红字」为止；都不来才算 FAIL |
| 「详情内容正确」读到 `title=""` | 详情页异步读装配 | 轮询到 `loading===false && title` 非空 |
| 「勾选落到数据」失败 | 面板保持挂载 ⇒ 页面级 `.textarea`/`.input` 会命中**别的分区**的输入框 | 填完**回读落地判据**（`data.reason === 所填文案`），不信任"`input()` 没抛错" |
| 逐人循环把同一人点两次、第二人永远没点 | 下一轮的「还缺谁」用云端回读算，而上一次点击**还没落库** | 每点一个人都等**他本人**的事实落库再算下一个缺口 |

统一用有界轮询，而不是加 sleep：

```js
const settle = async (read, pred, tries) => {
  let v = null
  for (let i = 0; i < (tries || 10); i++) {
    v = await read()
    if (pred(v)) return { v, waited: i }
    await sleep(800)
  }
  return { v, waited: -1 }        // 等不到 → 照原样记 FAIL，绝不算通过
}
```

**把 `等待次数` 写进证据字段**。这样"轮询很久才到"和"一次就到"在读数上可区分，也堵住了"用无限等待换绿"的路。

---

## 8. 云函数侧

- 改 `cloudfunctions/trailApi/**` 必须**重新部署**才生效：
  `cli cloud functions deploy --e cloud1-d9ghcm034574b9d55 --n trailApi --r --project 'D:\OurTrail' --port 33278`。
- **CLI 部署不继承控制台超时**：本轮实测 `trailApi` 拿到 `config.json` 的 20 秒，`trailApiLab` 掉回默认 3 秒。
  部署后必查：`cli cloud functions info --e <env> --names trailApi trailApiLab ...`，看 `timeout` 列。
- **刚部署完会冷启动**：首读能到秒级。历史脚本里那些「固定等 1s 就断言面板有几行」的地方会集体假红——
  本轮 B 层第一次复跑就是这么红的，加轮询后归零。
- `mp.evaluate` 承载 `wx.cloud.callFunction` 只用于**环境准备与回读**。它能证 BUSINESS，**永远不能充当 UI 证据**。
- **别拿全局 `revision` 当"某个活动零副作用"的判据**：`revision` 是 `ot_meta/main` 上的单一 CAS 计数，
  这套 `ot_*` 集合被多条链路共用，别人一次写入就会推进它。要比就比**那个活动自己的字段快照**。
- 单账号通道只有一个登录身份：`isOwner` 分支下的 CTA 你就是点不到。相关步骤记 `uiUnverified`，
  页内控件照常真点，只把"导航那一步"记未验证。

---

## 9. 平台限制与坏味道（产品侧要背的，不是测试侧能绕的）

- **原生 `<picker mode=date/time/range>` 驱不动**：tap 后既没有任何可查询面板（`.picker-panel`/`picker-view`/`.weui-picker` 全 0），值也不变。
  ⇒ 凡是必须过 picker 的用户路径，只能记 **INCONCLUSIVE**。要让端到端覆盖它，得产品给非-picker 入口（或 `picker-view`）。
- **裸 `<checkbox bindchange>` 永不触发**：微信只定义了 `checkbox-group` 的 change 语义。已进 `tools/check.js` 静态门禁（存量白名单只允许变少）。
- `page.callMethod()` / 直接 `setData` / 直接调页面 handler **一律禁止**充当用户操作。`auditSource` 会抓 `.callMethod(`。
- `mp.evaluate` 读 `getCurrentPages().slice(-1)[0].revision` 这类**实例属性**只能用作同步判据（"页面确实读回最新状态了"），不能替代点击。

---

## 10. 速查：看到这个现象，先查这个

| 现象 | 先怀疑 |
|---|---|
| 大面积红 + 控制组探针显示通道 healthy | 会话被抢（§3），`cli quit` 重启 |
| `Connection closed` / 连不上 9420 | 有第二个循环或孤儿进程；或 IDE 窗口没起来，`auto` 再跑一次 |
| tap 报成功但什么都没发生 | 空按钮（§6.2）或旧句柄（§6.1） |
| 断言 intermittent，重跑就好 | 你在一次跑动中改了测试文件 → 混合构建；改完等一轮跑完再换 |
| 每次红的位置不同、集中在异步边界 | 一次性判读（§7），改轮询 |
| `Array.isArray` 出现在查询里 | 必错，改成 `$$`（历史上整批 tap 因此从未发生） |
| 只有 BUSINESS 绿、UI 想跟着绿 | 不许。UI 必须由「一次真实操作 + 它的后果观测」构成 |

## 11. 退出码语义（别改）

`0` = 全绿；`1` = 有 FAIL（产品或测试真有问题）；`2` = INCONCLUSIVE（环境/通道/平台限制导致无法验证）。
**2 永远不是通过**。宁可红、宁可 2，也不要假绿。
