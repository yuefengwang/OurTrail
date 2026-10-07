# Window Model —— 统一窗口数据结构（OI-1）

所有户外机会共用同一个 Window 抽象。禁止每种天象各自造一套
start/end/score/reason。

## 1. Condition（L2，逐时）

```js
{
  t: 'HH:mm',                      // 该小时的开始时刻
  key: 'IN_CLOUD' | 'CLOUD_BELOW' | 'CLOUD_ABOVE' | 'CLEAR' | null,
                                   // null = 证据不足（沉默，不硬造状态）
  source: 'cloud-field' | 'hour-view',
                                   // cloud-field：field(t,userAlt) 推导（Phase 1 阈值）
                                   // hour-view：band + sky 标记的有限回退
  evidence: [{ fact: '云区 3,075–3,800 m 穿过你的海拔 3,500 m', at: '16:00' }],
}
```

条件→状态词映射（presentation，UI 层使用）：

| key | 状态词 | 判定（Phase 1 冻结阈值） |
|---|---|---|
| IN_CLOUD | 你在云中 | field(t,userAlt) ≥ 60% |
| CLOUD_BELOW | 云在脚下 | 用户下方峰值 ≥ 68% 且用户处 < 45% |
| CLOUD_ABOVE | 头顶有云层 | 用户上方峰值 ≥ 40% 且用户处 < 45% |
| CLEAR | 晴 | 用户/上/下均 < 15% |
| null | （沉默） | 以上证据皆不足 |

用户海拔在数据覆盖范围（covered lo–hi）之外时：不采样外插值，
按「覆盖区与用户的相对位置」推导（成都 500m 场景）。

## 2. Window（L3，Opportunity）

```js
{
  type: 'CLOUD_SEA',                // 注册表键（opportunity-registry.md）
  interpretation: '云海窗口',        // 中文短词（presentation）
  from: '06:38',                    // 'HH:mm'（天文窗口分钟级精确）
  to: '09:00',                      // 簇末小时的结束时刻（半开区间 [from, to)）
  confidence: '高',                 // '明确'（天文）/ '高' | '中' | '低'（证据分档）
  rank: 'primary',                  // 'primary'（稀有×高价值）/ 'secondary'
  evidence: [ { fact: '…', at: '06:00' }, … ],   // 结构化证据（可解释性）
  hours: [ hourView… ],             // 窗口内的原始小时事实（供 UI 展开核对）
  source: 'cloud-field' | 'hour-view',
}
```

规则：
- `confidence` 不使用百分比（不伪造精度）；
- `rank` 不与 score 混合（primary = 稀有×高价值：云海/光染/银河）；
- 窗口 = 连续同条件小时的半开区间；相邻同型小时自动合并；
- 与更具体的窗口重叠时让位（CLOUD_SEA 优先于 VIEW_WINDOW）；
- 夜段云海与民用晨昏无交集 → 整窗丢弃（不可见 = 沉默，复用 agenda 规则）。

## 3. 聚类规则（detect → validate → evidence → rank → present）

```
detect     逐时：sky.hourMarks（8 键阈值）∪ L2 Condition（云场/覆盖感知）
validate   连续同型 ≥2 小时（golden/blueHour/star 等天文/单小时型 ≥1）
           云海额外过民用晨昏可见性交集；VIEW_WINDOW 需白天 + 无降水
evidence   conditions.factsFor（既有）+ 条件态证据（新增）+ 云场采样（云区/覆盖）
rank       BASE_RANK[type] × confidence（静态表，不合成分数）
present    interpretation + from–to + confidence + evidence（UI 按需展开）
```

## 4. 时间语义

- 一律北京时间（'HH:mm'，与 hourView/detail 同源）；
- 小时簇窗口：from = 首小时开始，to = 末小时**结束**（+60min，半开区间）；
- 天文窗口：from/to 直接来自 astro.photoWindows（分钟级）；
- 跨日窗口暂不支持（detail 为单日 24h；多日窗口属 Phase 3）。
