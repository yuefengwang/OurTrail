# H-T06 · R6 → R0（门禁与变异）

## 产物
- 新增 6 个套件：`weather-v3-hourly-svg-test`(51)、`weather-v3-structure-test`(79)、`weather-v3-visual-test`(35)、`plans-test`(53)、`scenario-weather-v3-test`(49)、`ab-weather-v3`(43)
- 新增变异脚本：`mutate-weather-v3`（5 条变异 0 漏网）
- 判据替换 3 处：`page2-gates` §0/§3/§4、`m02-class-scope` §2 U0/§3、`swx2` T2.1（详见 T06 任务书）

## 验证（本轮实测）
- `node tools/check.js` → ALL CHECKS PASSED（G10 作用域 44 个 / token 未变 / G11 0）
- `node tools/check-handlers.js` → 新组件与 hub 0 死 handler
- 受影响套件：`weather-page 219`、`weather-v2 103`、`sky 280`、`smoke 262`、`lab-dryrun 165`、`routes 75`、`tasks 27`、`journey 155`、`journey-graph 15`、`e2e-test 72`、`e2e-permission 96`、`e2e-domain-negative 86`、`e2e-client-cas 54(bugs=1 既有)`、`e2e-interleave 67`、`e2e-panel-sync 40`、`e2e-release-gap 51`、`lifecycle-* 214/71/109/146/126/47`、`scenario-activity 212`、`scenario-editor 227`、`scenario-signup 106`、`scenario-workspace 125`、`scenario-me 145`、`scenario-discover 60`、`scenario-vehicle 66`、`scenario-staff 26`、`scenario-notices 105`、`scenario-api 29`、`scenario-lab 20`、`a20 39`、`b4-c11 171`、`b4-e05 49`、`rb-vehicle 41`、`rb-toggle 26`、`rc-transport 67`、`ra-field-panel 72`、`page2 119`、`m02 65`、`swx1 45`、`swx2 111`、`t4-e08 41`、`b4-pad 33`、`ui-consistency 19`、`header-layout 38`、`entry-layout 41`、`nav-chrome 15`、`weather-hub-gpx 23`
- **未跑全量 sweep**，不编总数。

## 未验证
- B 层三套（`e2e-ui*` / `e2e-golden-path`）需要开发者工具，未跑。

## 回滚
- 新脚本是新增文件；三处判据替换各自在文件内有替换理由注释，回滚即恢复旧断言（不建议：旧断言的前提已被 D2 推翻）。