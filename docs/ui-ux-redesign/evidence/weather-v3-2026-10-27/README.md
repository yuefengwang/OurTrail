# 天气页 V3 · 证据包（2026-10-27）

**结论上限：E1 + E2。真机 E3 全部 NOT_RUN。**

本轮没有可用的微信开发者工具自动化会话（`cli auto` 需要重开共享会话，未擅自执行），因此：

- 没有任何「渲染正确 / 更好看」的结论；
- 没有 390 宽截图；
- 没有像素/DOM 双读；
- 逐时 SVG 在 24/48/72h 的解码耗时没有读数（>300ms 应降级 canvas，见实施文档 §6.5）。

## 已有证据（可复跑）

| 证据 | 命令 | 读数 |
|---|---|---|
| 逐时图几何/缺值/内联样式 | `node tools/weather-v3-hourly-svg-test.js` | 51 / 0 |
| 两屏结构 + 四视图 + 状态机契约 | `node tools/weather-v3-structure-test.js` | 79 / 0 |
| 皮肤封闭表 / 字号档 / 触控 | `node tools/weather-v3-visual-test.js` | 35 / 0 |
| 计划域（CRUD/授权/分享/CAS） | `node tools/plans-test.js` | 53 / 0 |
| 真组件装配与交互 | `node tools/scenario-weather-v3-test.js` | 49 / 0 |
| 与独立 oracle 对拍 | `node tools/ab-weather-v3.js` | 43 / 0 |
| 变异自证 | `node tools/mutate-weather-v3.js` | 11 / 0（5 条 0 漏网） |
| 静态门 | `node tools/check.js` / `check-handlers.js` | ALL CHECKS PASSED |

## M5 出口清单（未完成项逐条）

| 区域 | 状态 | 前置条件 |
|---|---|---|
| 页头（地点/节点/数据源） | NOT_RUN | 开发者工具会话 |
| 日期条（5 日卡 / D1-Dn） | NOT_RUN | 同上 |
| 四视图 tab 吸顶（前后各一张） | NOT_RUN | 同上 |
| 逐时图 24/48/72 | NOT_RUN（且缺解码耗时读数） | 同上 |
| 云层图（缺资料 / 无海拔 / 正常） | NOT_RUN | 同上；需构造三种载荷 |
| 日月（possible / unknown / excluded 各一张） | NOT_RUN | 同上 |
| 行程流（待安排 / 超范围 / 正常） | NOT_RUN | 同上 |
| 弹层 ×6（地点/节点/编辑/分享/帮助/GPX） | NOT_RUN | 同上 |
| stale 横幅（缓存兜底） | NOT_RUN | 同上；需先让一次查询失败 |
| 375 / 414 宽度 | NOT_RUN | 同上 |

## 恢复手顺（需用户授权）

```
cli close --project 'D:\OurTrail' --port 33278
cli open  --project 'D:\OurTrail' --port 33278
sleep 25
cli auto  --project 'D:\OurTrail' --auto-port 9421 --trust-project --port 33278
```

截图前先断言：`ready===true`、`hourlyColumns>0`、`cloud!==null`、`sky.cards.length===3`；否则读到的是旧 bundle 或空页（历史上三次假证据都是这么来的）。

## 全量 sweep（收尾补跑）

117 个可无头套件：**114 exit 0**，**3 exit 1**——`cold-start-work 8/2`、`g2-platform-gate 14/1`、`trip2-gates 66/10`，三条均在 `git archive HEAD` 干净副本上复现同样读数与失败项 ⇒ **先于本轮存在**，与本轮改动无因果关系。断言总数不编（以各脚本 `passed=` 为准）。

## 部署状态

- `cloudfunctions/trailApi/**` 已改（13 文件 + 新增 `domain/plans.js`），`sync-lab` 已跑，lab 副本逐字节一致。
- **未部署**。部署顺序：`trailApi` → `trailApiLab` → 客户端上传。旧服务端会拒绝 `plan.*`。