# 验收方案（acceptance-plan）

## 1. 自动门（每任务必跑，worktree 内）
```
node tools/check.js
node tools/check-handlers.js
node tools/scenario-discover-test.js      # T003
node tools/scenario-workspace-test.js     # 回归抽查（home/discover 投影共用）
node tools/a20-owner-hero-test.js         # 卡片/hero 相关回归
node tools/swx1-style-gates-test.js && node tools/swx2-style-gates-test.js
node tools/t4-e08-test.js && node tools/m02-class-scope-test.js && node tools/page2-gates-test.js
node tools/ui-consistency-test.js
```
（T002 另跑 `node tools/scenario-activity-test.js` 若卡片组件被 activity 复用。）
退出码非 0＝失败；未跑的写「未验证」，禁止写通过。

## 2. 主控 diff 审查清单（每任务）
越界文件？业务语义变化？硬编码示例数据？交互/路由丢失？六态缺失？虚构字段？
styleIsolation/safe-area/canvas？重复组件？状态词二次定义（铁律 22）？新色值（铁律 17）？

## 3. 视觉验收
本夜 **NOT_RUN**。原因：微信开发者工具为共享会话（项目记忆：禁 quit/close；重开项目需授权），
且 worktree 不含用户在途天气改动，截图会与用户当前工作不一致。
⇒ 任务结论最高只能到「代码与静态测试通过，视觉待验」。授权后按 docs/e2e-mp/automation-playbook.md 补拍，
对照基线 `docs/ui-snapshots/ourtrail-all-pages-2026-10-20.png` 与交付包 A1/B/C。

## 4. 提交规则
每任务一个提交：`ui(T00x): …`；只含该任务文件；提交前 `git status` 核对无冻结集路径混入。
不 push。分支保留 `agent/ourtrail-night-ui-v1` 供用户检查。
