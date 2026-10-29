// 日码派生 A/B 对拍（2026-10-28）
// 目的：用**同一份** Open-Meteo 原始返回体，分别跑改前（git HEAD 的 lib/weather.js）与改后的
// fetchForecast，证明：
//   ① 逐时字段（含 code、visibility）、days[].code、cloudLevels、长度 —— 逐字节零差异（只多 fog/dayCode）
//   ② 日徽标确实变了（目标 4 天从「雾」变为白昼现象），不是空改
//   ③ 阳性对照：11-02 毛毛雨、11-03 阵雪两侧一致（不是一刀切抹掉雾）
// 用法：node docs/weather-ux/qa/v2-meteoblue-consistency-2026-10-28/ab-daycode.js
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const https = require('https')
const { PassThrough } = require('stream')
const { EventEmitter } = require('events')

const HERE = __dirname
const ROOT = path.join(HERE, '../../../..')
const RAW_PATH = path.join(HERE, 'ab-raw.json')
const LAT = 30.30
const LNG = 101.64

let passed = 0
let failed = 0
function check(name, ok, extra) {
  if (ok) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}

/* ---------- 网络替身：tee 一次真实响应，再回放给两个版本 ---------- */
let mode = 'tee'
let raw = null
const origGet = https.get
https.get = function (url, cb) {
  const fake = new EventEmitter()
  fake.setTimeout = () => fake
  fake.destroy = () => {}
  if (mode === 'replay') {
    const res = new PassThrough()
    res.statusCode = 200
    process.nextTick(() => { cb(res); res.end(JSON.stringify(raw)) })
    return fake
  }
  const req = origGet.call(https, url, res => {
    const out = new PassThrough()
    out.statusCode = res.statusCode
    const chunks = []
    res.on('data', c => { chunks.push(c); out.write(c) })
    res.on('end', () => {
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        fs.writeFileSync(RAW_PATH, JSON.stringify(raw))
      } catch (e) {
        console.error('  ✗ 原始响应解析失败：' + e.message)
        process.exit(2)
      }
      out.end()
    })
    cb(out)
  })
  req.setTimeout = function () { return req }
  const d = req.destroy.bind(req)
  req.destroy = function (e) { return d(e) }
  return req
}

const NEW = require(path.join(ROOT, 'cloudfunctions/trailApi/lib/weather.js'))
const F = require(path.join(ROOT, 'miniprogram/utils/format.js'))

function deepDiff(a, b, prefix, out) {
  const A = a === undefined ? undefined : a
  const B = b === undefined ? undefined : b
  if (A === null || B === null || typeof A !== 'object' || typeof B !== 'object') {
    if (A !== B) out.push(prefix + ': ' + JSON.stringify(A) + ' ≠ ' + JSON.stringify(B))
    return out
  }
  const keys = new Set(Object.keys(A).concat(Object.keys(B)))
  for (const k of keys) deepDiff(A[k], B[k], prefix + '.' + k, out)
  return out
}

;(async () => {
  // 1) 先真实取一次（tee），拿到原始返回体
  const date = NEW.cnToday()
  const live = await NEW.fetchForecast(LAT, LNG, date)
  if (!raw) { console.error('  ✗ 没有捕获到原始响应'); process.exit(2) }
  console.log('  · 原始响应已保存 ' + path.basename(RAW_PATH) + '（' + live.days.length + ' 天）')

  // 2) 回放给改后 / 改前两版
  mode = 'replay'
  const newResp = await NEW.fetchForecast(LAT, LNG, date)

  const tmp = path.join(os.tmpdir(), 'ourtrail-ab-daycode-old-' + Date.now() + '.js')
  // 基线 = **工作区改前状态**，不是 HEAD：工作区另有一处未提交的 300 hPa 剖面天花板改动
  // （PROFILE_CLOUD_LEVELS），它先于本改动存在。直接拿 HEAD 比会把那处差异误算进本轮。
  const NEW_SRC = fs.readFileSync(path.join(ROOT, 'cloudfunctions/trailApi/lib/weather.js'), 'utf8')
  let src = execFileSync('git', ['show', 'HEAD:cloudfunctions/trailApi/lib/weather.js'], { cwd: ROOT, encoding: 'utf8' })
  const ceiling = NEW_SRC.match(/\/\* 剖面显示用的更高气压层[\s\S]*?for \(const lv of PROFILE_CLOUD_LEVELS\) \{/)
  if (!ceiling) { console.error('  ✗ 基线构造失败：没取到 300 hPa 天花板代码块'); process.exit(2) }
  src = src.replace(/\/\/ 气压层剖面：[^\n]*\nfor \(const lv of CLOUD_LEVELS\) \{/, ceiling[0])
  // 只改 buildCloudLevels（4 空格缩进）那一处。cloudBandAt（2 空格）必须继续扫 CLOUD_LEVELS：
  // 抬显示天花板不得顺带改天相结论（铁律 28）——第一版就是这里放错，把业务成带扫到 300 hPa，
  // 对拍当场报出 series 150 附近 band 假差异。
  src = src.replace('\n    for (const lv of CLOUD_LEVELS) {', '\n    for (const lv of PROFILE_CLOUD_LEVELS) {')
  fs.writeFileSync(tmp, src)
  const OLD = require(tmp)
  check('对拍基线有效：含在途 300 hPa 剖面改动、不含本改动',
    /PROFILE_CLOUD_LEVELS/.test(src) && !/representativeDayCode/.test(src) && !/fogConfirmed/.test(src))
  check('对拍基线：cloudBandAt 仍扫 CLOUD_LEVELS（显示天花板不透传业务判据）',
    /\n  for \(const lv of CLOUD_LEVELS\) \{/.test(src))
  const oldResp = await OLD.fetchForecast(LAT, LNG, date)

  // 3) 零差异：除新增键外逐字段相同
  const newDaysNoCode = newResp.days.map(d => { const c = Object.assign({}, d); delete c.dayCode; return c })
  check('days[]：除 dayCode 外逐字节相同', deepDiff(oldResp.days, newDaysNoCode, 'days', []).length === 0,
    deepDiff(oldResp.days, newDaysNoCode, 'days', []).slice(0, 3).join(' | '))

  const stripFog = list => list.map(h => { const c = Object.assign({}, h); delete c.fog; return c })
  check('series[]：除 fog 外逐字节相同（含逐时 code / visibility）',
    deepDiff(oldResp.series, stripFog(newResp.series), 'series', []).length === 0,
    deepDiff(oldResp.series, stripFog(newResp.series), 'series', []).slice(0, 3).join(' | '))
  check('detail[]：除 fog 外逐字节相同',
    deepDiff(oldResp.detail, stripFog(newResp.detail), 'detail', []).length === 0,
    deepDiff(oldResp.detail, stripFog(newResp.detail), 'detail', []).slice(0, 3).join(' | '))
  check('cloudLevels 逐字节相同', deepDiff(oldResp.cloudLevels, newResp.cloudLevels, 'cloudLevels', []).length === 0)
  check('elevation 相同', oldResp.elevation === newResp.elevation, oldResp.elevation + ' vs ' + newResp.elevation)
  check('新返回体每天都有 dayCode（number）',
    newResp.days.every(d => typeof d.dayCode === 'number' && Number.isFinite(d.dayCode)))
  check('旧返回体没有 dayCode / fog（证明对拍两侧真是两个版本）',
    oldResp.days.every(d => !('dayCode' in d)) && oldResp.series.every(h => !('fog' in h)))

  // 4) 用户可见变化：旧侧（weatherPhrase(day.code)）vs 新侧（dayPhrase(day)）
  console.log('\n  日期        provider 旧徽标 → 新徽标   白昼码')
  const changed = []
  const same = []
  for (let i = 0; i < newResp.days.length; i++) {
    const d = newResp.days[i]
    const oldLabel = F.weatherPhrase(d.code).label
    const newLabel = F.dayPhrase(d).label
    console.log('  ' + d.date + '  ' + String(d.code).padStart(6) + '  ' + oldLabel + ' → ' + newLabel +
      '   ' + String(d.dayCode).padStart(4))
    if (oldLabel !== newLabel) changed.push(d.date); else same.push(d.date)
  }
  check('确实有日徽标变化（不是空改）', changed.length > 0, 'changed=' + changed.length)
  check('阳性对照：至少 2 天徽标不变（不是一刀切抹掉雾）', same.length >= 2, 'same=' + same.length)

  const byDate = {}
  for (const d of newResp.days) byDate[d.date] = d
  const wet = byDate['2026-11-02']
  const snow = byDate['2026-11-03']
  if (wet) check('11-02 毛毛雨两侧一致（降水不被投票抹掉）', F.dayPhrase(wet).label === '毛毛雨', F.dayPhrase(wet).label)
  else console.log('  · 11-02 不在本次窗口，跳过阳性对照（降水类）')
  if (snow) check('11-03 阵雪两侧一致（恶劣天气一票否决）', F.dayPhrase(snow).label === '阵雪', F.dayPhrase(snow).label)
  else console.log('  · 11-03 不在本次窗口，跳过阳性对照（恶劣天气）')

  const fogDays = newResp.days.filter(d => d.code === 45 || d.code === 48)
  if (fogDays.length) {
    check('provider 日码=雾的日子里，至少有 1 天不再显示「雾」',
      fogDays.some(d => F.dayPhrase(d).label !== '雾'),
      fogDays.map(d => d.date + ':' + F.dayPhrase(d).label).join(','))
  } else {
    console.log('  · 本次窗口没有 provider 雾码日，跳过雾→白昼用例')
  }

  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error('  ✗ 对拍执行异常：' + e.message); process.exit(1) })
