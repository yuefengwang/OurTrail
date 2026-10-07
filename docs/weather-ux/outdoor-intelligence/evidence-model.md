# Evidence Model —— 证据模型（OI-1）

每一个 Window / Condition 必须能回答「为什么」。证据是**结构化**的：
每条 = `{ fact: string, at: 'HH:mm' }`，fact 为一句可核对的事实陈述
（数字来自 L1 数据），at 为该事实在图上/时间轴上可定位的时刻。

## 1. 形状

```js
evidence: [
  { fact: '你的海拔 3,500 m',            at: '06:00' },
  { fact: '低层云带 2,260–2,950 m（覆盖 86%）', at: '06:00' },
  { fact: '清晨风 6 km/h',               at: '07:00' },
]
```

- fact 面向徒步者语言（「低层云带」「你的海拔」），不出现 hPa/变量名；
- at 让 UI 的「看图 ↗」能锚回 Unified Meteogram 的对应时刻；
- evidence 由来源模块产出（conditions.factsFor / 条件态证据 / 云场采样），
  UI 不自行拼装。

## 2. 各类型证据来源（复用优先）

| type | 证据来源 | 条目示例 |
|---|---|---|
| CLOUD_SEA | conditions.factsFor('cloudSea')（已有）+ 云场 denseSpan | 「低层云带 2,280–2,950 m」「清晨低云 39% · 高层云 5%」「清晨风 6 km/h」 |
| IN_CLOUD | 条件态证据（新增）：云场 denseSpan + 覆盖范围 | 「云区 3,075–3,800 m（峰值 84%）穿过你的海拔 3,079 m」「云场覆盖 155–6,680 m（23 层气压层）」 |
| VIEW_WINDOW | 条件态证据：高层云/能见度/无降水 | 「高层云 5%」「能见度 35 km」 |
| GOLDEN_LIGHT / BLUE_HOUR | astro.photoWindows（确定性） | 窗口本身即证据（from–to 分钟级） |
| ALPENGLOW | conditions.factsFor('alpenglow')（已有） | 「全日低云 12%」「中高云 40%」 |
| RAINBOW | conditions.factsFor('rainbow')（已有） | 「降水时段 2 小时」「午后湿度峰值 88%」 |
| STARGAZING / MILKY_WAY | conditions.factsFor('galaxy'/'star')（已有） | 「夜段高层云 5% · 中层云 10%」「月照 12%（残月）」 |

## 3. 置信（confidence）分档规则（确定性映射，非评分）

| 类型 | 高 | 中 | 低 |
|---|---|---|---|
| CLOUD_SEA | 覆盖 ≥90% 且风 ≤15 km/h | 其余达标时段 | — |
| IN_CLOUD | 用户处 ≥80% | 60–79% | — |
| VIEW_WINDOW | 高层 <20% 且无降水且（能见度 ≥30km 或缺省） | 其余 | — |
| RAINBOW | — | 实际降水 >0.05mm | 仅湿度/低云代理 |
| STARGAZING / MILKY_WAY | 月照 <10%（银河） | 其余达标 | — |
| GOLDEN_LIGHT / BLUE_HOUR | **明确**（天文确定性，不参与分档） | — | — |

规则实现于 `outdoor-intelligence.js` 的静态映射，同输入同输出。

## 4. 反模式（禁止）

- 「云海概率 83.72%」「日落成功率 91.3%」——没有统计学模型就不给百分比；
- 「徒步指数 87」——综合指数把不同量纲的东西加在一起，无法解释；
- 裸结论（「今天有云海」）不带时段与证据——每条输出必须能锚回图上时段；
- 把 evidence 写成一段不可拆的自然语言——证据是结构化条目，UI 才能做
  「为什么？→ 看 L1」的展开交互。
