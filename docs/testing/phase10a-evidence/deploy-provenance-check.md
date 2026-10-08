# Phase 10A — 部署来源取证（决定性：线上仍是 master 版）

## 为什么需要这一步

部署后 K=6×6 复跑仍见 `STORAGE_UNAVAILABLE`（5/30）。这有两种可能，**读数本身无法区分**：
① 新代码没上线（部署来源不对）；② 新代码上线了但修复不够（SDK 自身的事务中止错误也走 `store.js:129`）。
预写的判据只说"仍见 STORAGE_UNAVAILABLE ⇒ 判新代码未上线，不写 GREEN"，但它不能替我证明是哪一种。

⇒ 用 **`cli cloud functions download` 把线上代码拉回来 diff**，直接看部署包里有没那 6 行哨兵。这是只读取证（写到仓库外的临时目录，不动任何 worktree）。

## 取证命令与结果

```bash
mkdir -p %TEMP%/opencode/p10a-deployed
cli cloud functions download --env cloud1-d9ghcm034574b9d55 --name trailApi \
    --path 'C:\...\p10a-deployed' --project 'D:\OurTrail-p10a'
```

| 检查 | 线上实际 | 结论 |
|---|---|---|
| `store.js` 里 `conflicted` 出现次数 | **0** | 哨兵不在 ⇒ 修复未上线 |
| `store.js` vs `D:/OurTrail-p9`（未修版） | **逐字节一致** | 同上（p9 也未改 store.js） |
| `store.js` vs `D:/OurTrail-p10a`（修复版） | 差 `conflicted` 哨兵段 | p10a 的改动没进包 |
| `domain/activity.js` 里 Phase 8 的 handler owner 门 | **不存在**（`grep -c` = 0） | 线上比 Phase 8 还早 |
| `domain/activity.js` vs `D:/OurTrail`（master `686fa7c`） | **逐字节一致** | ⇒ **部署来源是主 worktree `D:\OurTrail`** |
| `config.json` / `cli cloud functions info` | `timeout: 20`、status Active | IDE 部署保留了控制台超时（这条是好消息） |

## 结论

**BUG-C3 的真云端 GREEN 尚未取得，也不可能是失败——修复压根没上线。** 因此：
1. 今天两次 K=6 读数（13/30 与 5/30）**都是未修代码**，只是并发时序不同；
2. 这两次差 2.6 倍 ⇒ 再次确认"** STORAGE 比率**"不能当跨轮对比指标，能当指标的只有"该请求是不是过了层①又掉进 `store.js:129`"这一**代码级**事实；
3. 部署后必须**先做来源取证再跑行为探针**，否则会把"没部署上"读成"修得不够"，进而错误地扩生产改动范围。这条顺序已写进报告 §5。

## 附：线上与仓库的完整落差（供部署时一次带走）

`master` 之后的云函数侧改动只有两个文件、共三处：
- `cloudfunctions/trailApi/domain/activity.js` +3 行（Phase 8.0 handler 层 owner 门，纵深防御；`canExecute` 已 owner-only，所以缺它**不是**越权漏洞）
- `cloudfunctions/trailApi/store.js` 冲突哨兵（Phase 10A / BUG-C3 修复）

（Phase 9 的改动全在 `miniprogram/` 与 `tools/`，与云函数无关；`trailApiLab` 是另一支函数，未部署也不影响生产。）
