/**
 * 微信开发者工具真机驱动模板（agent 端到端闭环）
 *
 * 用法（**不要**在本仓库安装依赖——本仓库零 npm 依赖是铁律）：
 *   1) mkdir %LOCALAPPDATA%\Temp\opencode\mp-e2e
 *   2) cd %LOCALAPPDATA%\Temp\opencode\mp-e2e
 *   3) npm.cmd init -y && npm.cmd install miniprogram-automator
 *   4) 把本文件复制过去，改 SCENARIO 里的配置，然后 node drive.js
 *
 * 前置（人工，每台机器一次，详见 AGENTS.md「直连微信开发者工具」）：
 *   - 开发者工具 → 设置 → 安全设置 → 服务端口开启（本模板默认 33278）
 *   - 扫码登录：cli islogin 返回 {"login":true}
 *   - 每次改完代码要先 cli close + cli open，否则模拟器仍用旧 bundle
 *
 * 为什么值得这么做：静态门禁与纯逻辑测试**证明不了图长什么样**。
 * 本轮 P4 的 5 个真机 bug 里只有 1 个是逻辑问题，其余 4 个（slot 静默丢弃、
 * 漏导出被掩盖、播放头撑大轴、数据对渲染不对）逻辑测试全都测不到。
 */
'use strict'
const automator = require('miniprogram-automator')
const path = require('path')
const fs = require('fs')

/* ══════════ 配置区 ══════════ */

const CLI_PORT = 33278
const AUTO_PORT = 9421
const PAGE = '/pages/weather/weather'
const OUT = path.join(__dirname, 'shots')

/** 注入的合成数据。云函数未部署时页面取不到真数据。 */
const DATA = {
  loading: false, denied: '', loadingWeather: false, mode: 'activity',
  date: '2026-07-28', dayCards: [], pointLabels: [],
  chartSeries: [], chartMarks: {}, chartNight: {}, chartSelected: {},
  slots: [], callouts: [], conclusions: [], metrics: null,
  spaceSeries: [], spaceDays: [], spaceNodes: [],
  spaceLat: 30.67, spaceLng: 104.07, spaceObsAlt: null, spaceArriveT: '',
}

/** 交互脚本：每步 { at, do } —— at 是页面滚动位置，do 是要执行的动作。 */
const STEPS = [
  { at: 0, shot: '00-top.png' },
  { at: 1400, shot: '01-chart.png' },
]

/* ══════════ 以下一般不用改 ══════════ */

const wait = ms => new Promise(r => setTimeout(r, ms))

async function shot(mp, name) {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })
  // ⚠ screenshot() 返回 **base64 字符串**（以 iVBORw0KGgo 开头），不是 Buffer。
  //   直接写盘会得到「文本伪装的 png」，后续读图报「图片过大」/OutOfMemoryException。
  const buf = Buffer.from(String(await mp.screenshot()), 'base64')
  fs.writeFileSync(path.join(OUT, name), buf)
  console.log('  shot ' + name + ' (' + buf.length + ' B)')
}

/** 编译/重连期间页面可能被销毁，重试若干次再放弃 */
async function retry(label, fn, times) {
  let last
  for (let i = 0; i < (times || 6); i++) {
    try { return await fn() } catch (e) {
      last = e
      console.log('  retry ' + (i + 1) + '/' + (times || 6) + ' ' + label + ': ' + (e && e.message))
      await wait(4000)
    }
  }
  throw last
}

async function main() {
  const mp = await retry('connect', () => automator.connect({
    wsEndpoint: 'ws://127.0.0.1:' + AUTO_PORT,
  }))
  console.log('connected')

  const page = await retry('reLaunch', () => mp.reLaunch(PAGE))
  await page.waitFor(4000)
  console.log('launched ' + PAGE)

  // 先看页面真实状态——被 denied / loading 挡住时元素根本不在 DOM 里
  const before = await retry('data', () => page.data())
  console.log('  denied=' + JSON.stringify(before.denied)
    + ' loading=' + before.loading
    + ' loadingWeather=' + before.loadingWeather
    + ' dayCards=' + ((before.dayCards || []).length))

  await retry('setData', () => page.setData(DATA))
  await page.waitFor(3000)
  console.log('injected synthetic data')

  for (const s of STEPS) {
    if (s.at) await mp.pageScrollTo(s.at).catch(() => {})
    if (s.shot) await wait(700)
    if (s.shot) await shot(mp, s.shot)
    if (s.do) await retry('step', () => s.do(page, mp, shot))
  }

  await mp.disconnect()
  console.log('done')
}

main().catch(e => { console.error('FAILED ' + (e && e.message)); process.exit(1) })
