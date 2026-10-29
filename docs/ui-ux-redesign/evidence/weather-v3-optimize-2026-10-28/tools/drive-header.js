// 跑法：复制到仓库外的 mp-auto 目录后 WSPORT=<auto端口> node drive-header.js
// 页头占位修复的真机（IDE 模拟器）取证：加载态与失败态下，节点行与节点弹层都要有内容
// 前置：close+open 重编译后 auto --auto-port 9431
// 地点是**注入的生产形状载荷**（三个命名节点），天气仍走真实取数
const automator = require('miniprogram-automator')
const fs = require('fs')
const B = String.fromCharCode(92)
const OUT = 'D:' + B + 'OurTrail' + B + 'docs' + B + 'ui-ux-redesign' + B + 'evidence' + B + 'weather-v3-optimize-2026-10-28'
const TODAY = '2026-10-28'
const PLACE = {
  id: 'route:hdr', kind: 'route', name: '页头取证线', lat: 29.8, lng: 99.7, routeId: 'hdr', activityDate: null,
  nodes: [
    { name: '取证起点', lat: 29.8, lng: 99.7, altitude: 3200, eleSource: 'gpx' },
    { name: '取证观景台', lat: 29.81, lng: 99.71, altitude: 3800, eleSource: 'gpx' },
    { name: '取证营地', lat: 29.82, lng: 99.72, altitude: 3500, eleSource: 'gpx' },
  ],
}
let mp = null, passed = 0, failed = 0
const R = { capturedAt: new Date().toISOString(), port: +(process.env.WSPORT || 9431), place: '注入的生产形状路线载荷（3 个命名节点）', weather: '真实取数', cases: {} }
function check(n, c, e) { if (c) { passed++; console.log('  ✓ ' + n) } else { failed++; console.log('  ✗ ' + n + (e === undefined ? '' : '  → ' + JSON.stringify(e))) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function shot(f) {
  let buf = null
  for (let i = 0; i < 3 && !buf; i++) {
    try { buf = Buffer.from(String(await mp.screenshot()), 'base64') } catch (e) { console.log('  shot retry: ' + e.message); await sleep(4000) }
  }
  if (!buf) { console.log('  ✗ 截图未取到 ' + f); failed++; return }
  fs.writeFileSync(OUT + B + f, buf); (R.files = R.files || []).push(f); console.log('  · shot ' + f)
}
async function open(initial) {
  const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
  await sleep(1800)
  await page.callMethod('enterDetail', PLACE, initial)
  let wd = null
  for (let i = 0; i < 30; i++) { wd = await page.$('weather-detail'); if (wd) break; await sleep(300) }
  if (!wd) throw new Error('weather-detail 不在 DOM')
  return { page, wd }
}
;(async () => {
  mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.WSPORT || 9431) + '' })
  try {
    /* ---------- C 加载在途 ---------- */
    console.log('\n§ C 加载在途（页头节点行不许只剩图钉）')
    let { page, wd } = await open({ node: 1, date: TODAY, hour: 13, period: 24, tab: 'hourly' })
    let snap = null
    for (let i = 0; i < 60; i++) {
      const d = await wd.data()
      if (d.placeName === PLACE.name) { snap = d; break }
      await sleep(100)
    }
    R.cases.loading = snap && { loading: snap.loading, placeName: snap.placeName, placeSub: snap.placeSub, isPoint: snap.isPoint, nodeOptions: (snap.nodeOptions || []).map(o => o.name + ':' + o.selected) }
    check('C1 组件已拿到地点（否则后面的断言全是空转）', !!snap && snap.placeName === PLACE.name, R.cases.loading)
    check('C2 此刻仍在取数（loading 为真 ⇒ 这一帧不是"事后回看"）', !!snap && snap.loading === true, R.cases.loading)
    check('C3 加载态节点行有完整一句话（旧形态此时是空串 ⇒ 这条同时是 bundle 新鲜度门）',
      !!snap && snap.placeSub === '取证观景台 · 3,800 m', R.cases.loading)
    check('C4 加载态节点弹层已可打开（3 项、勾在第 2 项）',
      !!snap && snap.nodeOptions.length === 3 && snap.nodeOptions[1].selected === true && snap.nodeOptions[0].selected === false && snap.nodeOptions[2].selected === false,
      R.cases.loading && R.cases.loading.nodeOptions)
    check('C5 路线 ⇒ isPoint 为假（节点行带箭头，与占位同时到位）', !!snap && snap.isPoint === false, R.cases.loading)
    await shot('after-header-loading.png')
    for (let i = 0; i < 90; i++) { const d = await wd.data(); if (d.ready || d.errorCode) break; await sleep(1000) }
    const done = await wd.data()
    R.cases.afterReady = { ready: done.ready, code: done.errorCode, placeSub: done.placeSub }
    check('C6 数据到位后这一行逐字不变（占位与装配同一出处，不是一次"先糊后改"）',
      done.placeSub === '取证观景台 · 3,800 m', R.cases.afterReady)

    /* ---------- D 取数不成立（超范围 / 错误） ---------- */
    console.log('\n§ D 取数不成立（日期放到预报范围外）')
    const o = await open({ node: 2, date: '2027-01-01', hour: 13, period: 24, tab: 'hourly' })
    wd = o.wd
    let bad = null
    for (let i = 0; i < 90; i++) { const d = await wd.data(); if (d.errorCode) { bad = d; break } await sleep(1000) }
    R.cases.error = bad && { code: bad.errorCode, emptyTitle: bad.emptyTitle, placeSub: bad.placeSub, nodeOptions: (bad.nodeOptions || []).length }
    check('D1 确实落在非ready 态（outOfRange 或 error）', !!bad && (bad.errorCode === 'outOfRange' || bad.errorCode === 'error'), R.cases.error)
    check('D2 失败态节点行仍是那句话（缺的是天气，不是地点）',
      !!bad && bad.placeSub === '取证营地 · 3,500 m', R.cases.error)
    check('D3 失败态弹层仍有 3 项且勾在第 3 项', !!bad && bad.nodeOptions.length === 3 && bad.nodeOptions[2].selected === true && bad.nodeOptions[0].selected === false, (bad||{}).nodeOptions && bad.nodeOptions.map(o=>o.name+':'+o.selected))
    await shot('after-header-error.png')
    try {
      await wd.callMethod('onNodePick', { currentTarget: { dataset: { index: '0' } } })
      await sleep(800)
      const after = await wd.data()
      R.cases.afterPick = { placeSub: after.placeSub, sel: (after.nodeOptions || []).map(x => x.selected).join(',') }
      check('D4 失败态换节点：这一行与选中位跟着走（rebuild 静默返回时也不留旧值）',
        after.placeSub === '取证起点 · 3,200 m' && R.cases.afterPick.sel === 'true,false,false', R.cases.afterPick)
    } catch (e) { check('D4 换节点（callMethod 通路）', false, e.message) }

    console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
  } catch (e) {
    failed++; console.log('  ✗ 驱动异常：' + (e && e.message))
  } finally {
    R.gates = { passed, failed }
    fs.writeFileSync(OUT + B + 'header-readings.json', JSON.stringify(R, null, 1), 'utf8')
    if (mp) await mp.disconnect()
  }
  process.exit(failed ? 1 : 0)
})()
