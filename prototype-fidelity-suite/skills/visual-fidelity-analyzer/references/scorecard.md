# 评分卡：五维、判定次序、以及它证明不了什么

评分卡是 `fidelity-validation-report.json#scorecard`，由 `core/lib/score.js` 生成。
它**没有总分**，也没有"相似度百分比"——一个能把 severe 缺陷平均掉的总分会把验收变成修辞。

## 1. 维度与来源

| 维度 | 对应任务书 | 量什么 | 来源字段 |
|---|---|---|---|
| `geometry` | A 几何 | 每对 `dx/dy`（位置）、`dw/dh`（尺寸），可选 `spacing` | `regions[].geometry`、`tolerances.position/size/gap` |
| `typography` | B 字体 | `font-size / font-weight / line-height / letter-spacing` + 文本相等 + 行数差 | `regions[].styles/text` |
| `appearance` | C 外观 | `color / background-color / border-radius / border-*-width / border-top-color / box-shadow / opacity` + 必填缺失 | `regions[].styles/presence` |
| `state` | D 状态 | 声明与捕获是否一致、注入态能否充当交互证据（量**模式**，不量外观） | `page-state-manifest` + 两侧 `capture-manifest` |
| `interaction` | E 交互 | 声明的动作是否执行、后果是否被观测 | `interaction-contract` 的观测记录 |

三条硬规则：

1. **状态的外观由 A/B/C 在该状态自己的捕获上判**。D 不重复判外观，它只回答
   "这个状态是怎么来的、这张图能不能当交互证据"。
2. **交互只能把 PASS 拉下来，不能把 UNVERIFIED 拉上去**。驱动不可达 ⇒ `BLOCKED` ⇒ 页面 `UNVERIFIED`。
3. **缺证据默认 UNVERIFIED**，包括"只有一侧报了某属性"——那说明比较没发生，不是"一致"。

## 2. 每个维度长什么样

```json
"geometry": {
  "checks": { "total": 30, "pass": 28, "fail": 2, "unverified": 0 },
  "metrics": {
    "position": { "total": 15, "fail": 1, "criticalFail": 0, "maxAbsPx": 15, "meanAbsPx": 1.0 },
    "size":     { "total": 15, "fail": 1, "criticalFail": 1, "maxAbsPx": 110, "meanAbsPx": 7.4 }
  },
  "verdict": "FAIL"
}
```

- `checks` 是给人看的计数；`metrics` 是给归因用的读数（`maxAbsPx` 取 `max(|dx|,|dy|)` 或 `max(|dw|,|dh|)`）。
- 几何失败同时计一次 `position` 或 `size`；`criticalFail` 只在**该配对 critical** 时才加。
- `appearance` 的分母含"测过的配对"（每个配对至少占一格），所以"没声明样式"不会让维度变成 0 检查通过。

## 3. 判定次序（顺序即优先级）

单个配对（`cli/pf.js` 的 `doDiff`）：

```
可选且任一侧不存在        → NOT_APPLICABLE
任一侧不存在且必填        → FAIL
两侧存在但某维度无法测量  → UNVERIFIED（记 unknown，不记 pass）
有 FAIL 维度且未被接受    → FAIL
其余                      → PASS
```

维度（`score.dimensionVerdict`）：

```
criticalFail > 0            → FAIL
fail > budget.nonCritical   → FAIL
total === 0                 → UNVERIFIED
unverified > 0              → UNVERIFIED
其余                         → PASS
```

页面（`score.buildScorecard`）：

```
criticalFailures.length > 0        → FAIL
nonCriticalFailures > budget       → FAIL
任一维度 FAIL                       → FAIL
任一维度 UNVERIFIED                 → UNVERIFIED
存在未验证配对                      → UNVERIFIED
其余                                → PASS
```

`state` / `interaction` 走 `checkDimension`：任一 FAIL → FAIL；
任一条 UNVERIFIED 或 BLOCKED → UNVERIFIED；全 PASS 且条数 > 0 → PASS。

## 4. 预算（budget）怎么用

默认 `{ criticalFailures: 0, nonCriticalFailures: 0 }`（`score.DEFAULT_BUDGET`）。
`pf.config.json#tolerances.budget` 可放宽非 critical 的失败数——**critical 没有预算**：
`criticalFailures` 是 0 或不是 0 的问题，不是比例问题。

放宽预算不是"允许偏差"，是"已知并接受这些非关键差异"：
每一条被预算吸收的失败仍然出现在 `nonCriticalFailures[]` 里，报告读者看得见。

## 5. 覆盖度（coverage）

```json
{ "pairsDeclared": 15, "criticalPairs": 3, "pairsMeasured": 11,
  "pairsUnverified": 0, "notApplicable": 4, "missingOnTarget": 0,
  "missingOnPrototype": 0, "pixelsCompared": 8 }
```

必检恒等式：`criticalPairs` 之外的配对里，
`declared = measured + unverified + notApplicable + (missingOnTarget/missingOnPrototype 的必填项)`。
对不上就说明某个配对既没测、也没被登记为不适用——那是覆盖漏洞，不是小数目。

`pixelsCompared` 只统计真的做了区域像素比较的配对；
`pixel: false` 的配对仍参与几何与样式判定（**关像素只关像素**）。

## 6. 这套卡证明不了什么

| 读法 | 为什么不成立 |
|---|---|
| "geometry PASS ⇒ 看起来一样" | 字体、图标、图片内容都没进几何；文本对只按墨迹签名比 |
| "typography PASS ⇒ 字形一致" | 只比计算属性与行数，不比字重渲染、字距微调、字体回退 |
| "像素比 0%" | 两侧截图缩放不同（如 306×660 对 390×844）时，裁剪已归一化，差值不是 1:1 证据 |
| "state PASS ⇒ 状态显示正确" | D 只证明"声称的进入方式与实际捕获一致" |
| "interaction PASS ⇒ 全流程可用" | 只证明声明的那几步；未声明的路径是"没问"，不是"没问题" |
| "appearance PASS ⇒ 伪元素也对" | 伪元素不是节点（WEB-03），只能通过区域像素间接暴露 |
| "native chrome 没差异" | 状态栏/胶囊/原生 picker 不在元素 API 里（WX-08），量不到即 UNVERIFIED |

反过来也要守住：**这些限制不允许被用来解释字号、行距、内边距这类实打实的差异**。
"平台差异"只对 `references/css-wxss-compatibility.md` 的 C 类成立，且必须写进 `acceptedDifferences[]`。
