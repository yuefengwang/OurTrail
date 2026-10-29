# 独立验证夹具（independent fixtures）

> 目的：用**不是实现者写的**样本证明这套能力真的成立。
> 单元套件（`tests/*.test.js`）证明的是"我按我的理解实现了"，
> 这里要回答的是"换个只看公开契约的人，能不能用它做出同样的判断"。

## 两条硬规则

1. **夹具里没有任何实现代码。** 每个场景只声明"跑什么命令、看哪份产物、期望什么"，
   判定由 `run.js` 通用解释；实现层不认识任何夹具的名字。
2. **期望值只写在夹具里。** 不允许为了过夹具去改 `core/` `cli/` 的判据；
   夹具红了先分"夹具错"还是"能力错"，改判据要单独说明理由。

## 目录

```
tests/fixtures/
├─ README.md          本文件
├─ run.js             通用执行器（不认识任何具体场景）
├─ _template/         格式样例（下划线开头 = 不计数）
└─ scenario-<nn>-<slug>/
   ├─ fixture.json    场景声明
   └─ …               该场景自带的静态文件（HTML/CSS/配置/语料）
```

`run.js` 会把整个场景目录复制到 `os.tmpdir()` 下再执行，**不会**污染仓库。

## 九类场景（缺一类 `run.js` 直接判失败）

| 类别 `class` | 要证明什么 |
|---|---|
| `rule-extraction` | 从原型里抽出的规则带出处/范围/可信度，且"未经确认"必须是 `candidate` |
| `kb-conflict` | 同一主题的两条规则矛盾时能被查出，且不影响无关规则 |
| `component-variant` | 同一组件的变体被识别为变体（同族），而不是两条无关规则 |
| `unseen-page` | 给一份未见页的 brief，生成物**只用库里允许的规则** |
| `function-preservation` | 生成页保留 brief 里的全部业务功能（缺失即失败） |
| `visual-deviation` | 真实渲染的偏差被检出并归到声明层，而不是只给一个分数 |
| `interaction-state` | 交互由"真动作 + 后果观测"判定；点不动、没变化都不得记为通过 |
| `post-repair-regression` | 修复后复验通过，且**没有**在别处引入新失败 |
| `missing-evidence` | 缺证据时给 `UNVERIFIED` / 退出码 2，绝不变成 `PASS` |

`adversarial: true` 的场景专门构造"看起来该通过、其实不该通过（或反之）"的样本，
例如：源码相同但渲染不同、声明齐全但元素不存在、修复修错了地方。

## `fixture.json` 格式

```json
{
  "id": "s01-rule-extraction",
  "class": "rule-extraction",
  "adversarial": false,
  "purpose": "一句话：这条夹具想推翻什么",
  "requires": ["playwright"],          // 可选；缺失时本场景记 BLOCKED，不算通过
  "steps": [
    {
      "run": ["dna", "--sources", "sources.json", "--out", "dna"],
      "expectExit": 0,                 // 必填：0 / 1 / 2
      "captureStdout": "dna.stdout.txt" // 可选：把这步 stdout 存成文件供 checks 用
    }
  ],
  "checks": [
    { "file": "dna/design-dna.json", "path": "$.rules[0].source", "exists": true },
    { "file": "dna/design-dna.json", "path": "$.rules[*].confirmation", "equals": "candidate" },
    { "file": "dna.substr", "contains": "原型" },
    { "fileMissing": "dna/design-dna.json" }
  ]
}
```

### step

| 字段 | 说明 |
|---|---|
| `run` | `pf` 的参数数组（**不要**写 `pf` 或 `node`）。相对路径以场景目录为 cwd |
| `expectExit` | 必填。`0` 通过 / `1` 有真实失败 / `2` 环境或未验证 |
| `captureStdout` | 可选。把 stdout（含 stderr）写进同名文件，供 `checks` 用 |
| `cwd` | 可选。相对场景目录的子目录（默认场景根） |

### check（每条独立判定）

| 字段 | 说明 |
|---|---|
| `file` | 相对场景目录的产物文件；`.json` 后缀会自动按 JSON 解析 |
| `path` | 取值路径：`$.a.b`、`$.a[0].b`、`$.a[*].b`（`[*]` 展开为多个值） |
| `equals` / `notEquals` | 深比较（多值时要求**全部**满足） |
| `exists` | `true` / `false`（缺键、空数组都算不存在） |
| `contains` | 字符串包含；数组则要求包含该元素 |
| `matches` | 正则（字符串形式） |
| `minLength` / `length` | 数组或字符串长度 |
| `gte` / `lte` | 数值比较 |
| `fileMissing` | 该产物**不得**存在（单独一条 check，不需要 `file`） |

## 跑

```bash
node tests/fixtures/run.js                 # 全部场景
node tests/fixtures/run.js --only s01      # 按 id 前缀
node tests/fixtures/run.js --list          # 只列清单
node tests/fixtures/run.js --keep          # 保留临时工作目录
```

退出码：`0` 全部符合夹具期望 · `1` 至少一条不符 · `2` 环境缺失（如 Playwright）导致有场景无法运行。

## 套件级结构门（防悄悄缩水）

`run.js` 除了跑场景，还会检查这四条；任何一条不成立即退出码 1：

| 门 | 为什么 |
|---|---|
| 场景数 ≥ 9 | 删掉一个场景不该让套件变"全绿" |
| 9 类 `class` 各至少一个 | 覆盖是逐类声明的，不是靠场景名暗示 |
| `adversarial` ≥ 3 | "看起来该通过、其实不该通过"的样本是判据牙齿的来源 |
| 每个场景至少 1 个 step + 1 个 check | 只留目录和 id、把断言清空，前三条都看不出来 |
