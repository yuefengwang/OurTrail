---
name: target-platform-adapter
description: 把原型的节点与目标技术栈的节点配成对，并把平台差异分成"有等价写法""需要实测确认""不可等价须升级"三类。用于"这页怎么落到小程序/React""哪些差异是平台造成的、哪些是实现漏的"；没有实测的等价性不许标成已解决。
---

# target-platform-adapter

原型的 `<div>` 不会自动变成小程序的 `<view>`。这一步负责把"两侧哪个东西对哪个东西"
写成机器可读的配对，并把**平台造成的差异**与**实现漏掉的差异**分开——否则后面每一次
判定都会把平台差异算成 bug，或者反向把 bug 说成平台限制。

## 何时用

- 原型已捕获、目标侧已能跑，需要建立 `platform-mappings`。
- 有人问"小程序做不出这个效果，是不是可以不等价"。
- 目标侧改动后需要复核配对是否仍然成立。

## 输入 / 输出

| 输入 | 输出 |
|---|---|
| `contracts/<page>/prototype-manifest.json`、`design-tokens.json` | `platform-mappings.json`：pairs、acceptedDifferences、coverage |
| 目标源码（WXML/JS/WXSS 或组件树） | 每个 pair 的目标选择器与 `styleProps` |
| `pf.config.json` 的 `pages[].mappings` | 人工维护的配对草稿（本技能负责把它写对） |
| `references/css-wxss-compatibility.md` | 平台差异的三类处置 |

## 依赖与前置

- 目标适配器的描述符（`adapters/*/adapter.json`）说明仪器能测什么；仪器测不到的，
  一律 UNVERIFIED，不能靠"我看了一眼"补。
- 目标侧源码可读（只读即可，不需要运行）；目标侧**运行**才能产出证据。

## 步骤

1. 读原型侧选择器清单（`prototype-manifest.mappings`）与目标侧页面结构，先做**一对一枚举**；
   一个原型节点对多个目标节点时，拆成多条 pair，不要写成"或"。
2. 给每条 pair 定 `criticality`：`critical` 只给"错了就是这一页坏了"的元素
   （标题、主操作、关键信息块）。关键项超预算会直接让整页 FAIL。
3. 给每条 pair 定 `styleProps`：只放这条 pair 真正有设计含义的属性。
   把 24 个属性全塞进去，等于把噪音也变成判据。
4. 逐条查平台差异，按 `references/css-wxss-compatibility.md` 归类：
   - **A 有等价写法** ⇒ 直接要求实现采用等价写法，不登记差异；
   - **B 写法不同、可能等价** ⇒ 登记为待实测，实测通过前不算解决；
   - **C 不可等价** ⇒ 写进 `acceptedDifferences`，必须给 `categories` 与 `reason`，
     并写明"这条差异下**仍然比什么**"。
5. `node cli/pf.js contract --project <dir> --page <id> --state <id>` 生成映射，
   跑 `node tests/run.js` 确认 schema 与交叉一致。
6. 把未解决的 C 类差异交给 `fidelity-orchestrator` 升级为产品决定。

## 质量门

- 每条 pair 都有 `id`（与后续 diff region 同名）、`role`、`criticality`、两侧选择器；
  任一缺失 ⇒ schema 会拒。
- `acceptedDifferences[].reason` 必须说清"为什么"，不允许"平台差异"四个字了事；
  带 `categories` 时必须真的只覆盖那些类别（用类别当挡箭牌去掩盖尺寸差是造假）。
- **`pixel: false` 只关像素比对**，几何与样式仍要判；用它让一条 pair "免检"是造假。
- 对齐锚点（`alignment.anchor`）只重定基 `dy`，尺寸永不重定基；
  把"外壳更高"重定基成"版式正确"是造假。
- 目标选择器未命中 ⇒ 该 pair UNVERIFIED；不许换一个"差不多"的选择器顶替。

## 失败处理

| 现象 | 处置 |
|---|---|
| 目标组件未注册（`usingComponents` 缺项） | 先修注册；在此之前所有相关 pair BLOCKED |
| 原型节点没有对应目标节点 | 登记 missingOnTarget + 原因；如果是设计遗漏，升级产品决定 |
| 差异只能靠"看起来一样"判断 | 记 UNVERIFIED（仪器测不出），不要写 PASS |
| 平台确实做不到（如原生导航栏/胶囊） | 走 C 类，写清楚"仍然比什么"，并在报告里出现 |

## 示例

```json
{
  "id": "title", "role": "主标题", "criticality": "critical",
  "prototypeSelector": ".home-header h1",
  "targetSelector": ".wh-title",
  "styleProps": ["font-size","font-weight","line-height","letter-spacing","color","margin","padding"],
  "pixelMode": "informational",
  "note": "文本叶节点：1× 浏览器与缩放后的模拟器截图之间字形栅格不可逐像素比；字阶/字重/行高/字距/颜色与行数仍逐项判定。"
}
```

## 与其他技能的关系

- 上游：`design-contract-builder`（声明与令牌）。
- 下游：`visual-fidelity-analyzer`（按 pair 生成 region）、`fidelity-repair-agent`
  （按 pair 定位要改的文件）。
- 平台差异的完整判据在 `references/css-wxss-compatibility.md`；那份清单的 A/B/C
  归类**用实测才生效**，没有实测就只能停在 B。
