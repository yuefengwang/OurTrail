/* 复现审计 §4 E1：峨眉山 2026-10-11 16:00–18:00 的云海漏报，并单独量出 R2 在它身上改了什么
 *
 * 三栏对照（同一份真实快照、同一个 ctx）：
 *   ① 生产现状（固定 2,000–6,000 m 扫描 + R2 文案）—— 这处漏报**仍然存在**，R2 不修判据
 *   ② 影子包络扫描 + R2 之后的 OI —— 窗口出现，看它的证据文案怎么说
 *   ③ 影子包络扫描 + R2 之前的 OI（6d7a1dc）—— 同一个窗口，看旧文案怎么说
 *   ②/③ 之间：候选集合、层数值（base/top/thickness/cover/clearance）、窗口时刻、置信度、
 *   强度、阈值必须逐字相同，只有证据文本不同。
 *
 * 影子运行只在内存里临时改 CFF.ALT0/ALT1（cloudLayersAt 唯一的读取方），跑完立刻还原；
 * 仓库里的生产代码与测试一个字节都不改。
 *
 * 运行：node repro-emeishan-1011.js [R2 之前的 utils 目录]
 *   不给第二个参数时③跳过，报告会写明"未对照"，不会假装比过。
 *   取 R2 之前的 utils：git archive 6d7a1dc miniprogram/utils | tar -x -C <dir>
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))
const OI = require(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))
const PRE_DIR = process.argv[2] || null
let PRE = null, PRE_CFF = null
if (PRE_DIR && fs.existsSync(path.join(PRE_DIR, 'outdoor-intelligence.js'))) {
  PRE = require(path.join(PRE_DIR, 'outdoor-intelligence.js'))
  /* ⚠ 影子扫描必须改**该模块自己 require 到的那一份** cloud-field-svg。
     改本脚本顶层的 CFF 只会影响当前工作树的 OI —— PRE 拿到的是它自己目录里的实例，
     于是"包络扫描"悄悄退化成固定窗扫描，两侧比出来的差异是覆盖假象（本轮第一次就跑偏在这里）。 */
  PRE_CFF = require(path.join(PRE_DIR, 'cloud-field-svg.js'))
  const src = fs.readFileSync(path.join(PRE_DIR, 'outdoor-intelligence.js'), 'utf8')
  if (src.indexOf('baseBoundary') >= 0) {
    console.error('给定的 utils 目录里已经有 baseBoundary —— 那不是 R2 之前的版本')
    process.exit(2)
  }
  if (require.resolve(path.join(PRE_DIR, 'outdoor-intelligence.js')) ===
      require.resolve(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))) {
    console.error('给定的 utils 目录与当前工作树是同一份，比不出前后差异')
    process.exit(2)
  }
}

const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/weather-ux/qa/v2-oi-cloud-scan-audit-2026-10-09/tools/real-cloud.json'), 'utf8'))
const p = snap.places.emeishan
const DAY = '2026-10-11', ALT = p.elevation
const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: DAY, hours: 24, userAltitude: ALT })
if (!cf) { console.error('快照里没有峨眉山 ' + DAY + ' 的云场'); process.exit(2) }
const column = CFF.makeColumnSampler(cf)
const field = Object.assign({}, cf, { sample: (t, a) => CFF.sampleAtStations(column, cf.times.length, t, a), userAltitude: ALT })

function seas (mod, cff, scan) {
  mod = mod || OI; cff = cff || CFF
  const saved = { lo: cff.ALT0, hi: cff.ALT1 }
  if (scan) { cff.ALT0 = scan.lo; cff.ALT1 = scan.hi }
  let oi
  try {
    oi = mod.buildOutdoorIntelligence({
      date: DAY, detail: p.series.filter(r => r.d === DAY), userAltitude: ALT, elevOK: true,
      elevBasis: 'measured', lat: p.gcj[0], lng: p.gcj[1], cloudField: field, days: [],
    })
  } finally { cff.ALT0 = saved.lo; cff.ALT1 = saved.hi }
  return (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA').map(function (o) {
    return {
      from: o.from, to: o.to, confidence: o.confidence, rank: o.rank, strength: o.strength,
      overlapsSunrise: o.overlapsSunrise,
      layers: (o.layers || []).map(l => [l.t, l.base, l.top, l.cover, l.clearance]),
      flags: (o.layers || []).map(l => [l.baseBoundary === true, l.topBoundary === true]),
      evidence: (o.evidence || []).map(e => String(e.fact)),
    }
  })
}
const ENV = { lo: Math.floor(cf.covered.lo / 50) * 50, hi: Math.ceil(cf.covered.hi / 50) * 50 }
const A = seas(OI, CFF, null)
const B = seas(OI, CFF, ENV)
const C = PRE ? seas(PRE, PRE_CFF, ENV) : null
/* 影子扫描确实生效了的凭据：两侧在还原后都必须回到 2000–6000，且包络那跑的窗边界值不该出现在证据里 */
if (CFF.ALT0 !== 2000 || CFF.ALT1 !== 6000) { console.error('!! 影子运行没有还原生产扫描窗'); process.exit(1) }
/* 有效性门（没有它，"两侧都是 0 个窗口"会被当成比过了）：
 * 包络那跑必须真的扫出落在固定窗 2,000–6,000 之外的云层，否则宽扫描根本没生效。 */
function widened (ws) { return ws.some(w => (w.layers || []).some(l => l[1] < 2000 || l[2] > 6000)) }
const validB = widened(B), validC = C ? widened(C) : null
const has1618 = ws => ws.some(w => w.from <= '16:00' && w.to >= '18:00') || ws.some(w => w.from === '16:00')

function biz (ws) { return ws.map(w => [w.from, w.to, w.confidence, w.rank, w.strength, w.overlapsSunrise, JSON.stringify(w.layers)].join(' | ')) }

console.log('峨眉山 ' + DAY + '，点海拔 ' + ALT + ' m，数据实测覆盖 ' + JSON.stringify(cf.covered) + '，影子包络扫描 ' + JSON.stringify(ENV))
console.log('生产扫描窗（未被改动）：' + CFF.ALT0 + '–' + CFF.ALT1 + ' m')
console.log('\n① 生产现状（固定窗 + R2）云海窗口 ' + A.length + ' 个：' + JSON.stringify(A.map(w => w.from + '–' + w.to + '/' + w.confidence)))
console.log('   16:00–18:00 是否成窗：' + (has1618(A) ? '是' : '否 —— 审计 §4 E1 那处漏报在 R2 之后仍然存在（R2 明确不动判据，修它是 R1）'))
if (A.length) console.log('   它的证据文案：' + JSON.stringify(A[0].evidence))
console.log('\n② 包络扫描 + R2 之后 云海窗口 ' + B.length + ' 个：' + JSON.stringify(B.map(w => w.from + '–' + w.to + '/' + w.confidence)))
console.log('   有效性门：包络扫描是否真的扫到了固定窗之外的云层 = ' + widened(B))
console.log('   16:00–18:00 是否成窗：' + (has1618(B) ? '是' : '否'))
const w2 = B.filter(w => has1618([w]))[0] || B[0]
if (w2) {
  console.log('   层数值 ' + JSON.stringify(w2.layers))
  console.log('   边界标记 ' + JSON.stringify(w2.flags))
  console.log('   证据文案 ' + JSON.stringify(w2.evidence, null, 0))
}
if (C) {
  const w3 = C.filter(w => has1618([w]))[0] || C[0]
  console.log('\n③ 包络扫描 + R2 之前 云海窗口 ' + C.length + ' 个：' + JSON.stringify(C.map(w => w.from + '–' + w.to + '/' + w.confidence)))
  console.log('   有效性门：包络扫描在 PRE 侧是否真的生效 = ' + widened(C) +
    '（PRE 用的是它自己目录里的 cloud-field-svg 实例，改错实例会悄悄退化成固定窗扫描）')
  if (!widened(C) || !widened(B)) {
    console.log('   ⇒ 判定 INVALID：影子扫描没有生效，这一栏不构成前后对照，不能读成"R2 改了业务判据"。')
  } else if (!w3) {
    console.log('   ⇒ 判定 INVALID：PRE 侧一个窗口都没有，没有可比的证据文本。')
  }
  if (w3) {
    console.log('   层数值 ' + JSON.stringify(w3.layers))
    console.log('   证据文案 ' + JSON.stringify(w3.evidence, null, 0))
    const sameBiz = JSON.stringify(biz(B)) === JSON.stringify(biz(C))
    const sameEv = JSON.stringify(B.map(w => w.evidence)) === JSON.stringify(C.map(w => w.evidence))
    console.log('\n② vs ③  候选集合/窗口/置信度/强度/层数值 完全相同 = ' + sameBiz + '；证据文本完全相同 = ' + sameEv)
    console.log('   ⇒ ' + (sameBiz && !sameEv
      ? 'R2 的改动面恰好等于"证据文本"这一层，一个业务字段都没碰到（本案例直接验证）'
      : (sameBiz && sameEv ? '这个案例 R2 前后文本也没变（说明它两端都实测到了）' : '!! 业务字段变了，R2 越界，必须回退')))
    const o = (w3.evidence || []), n = (w2 && w2.evidence) || []
    console.log('\n   逐句差异：')
    const max = Math.max(o.length, n.length)
    for (let i = 0; i < max; i++) console.log('     ' + (o[i] === n[i] ? '=' : '旧 ' + o[i] + '\n     ' + '新 ' + n[i]))
  }
} else {
  console.log('\n③ 未对照：没有给 R2 之前的 utils 目录 —— 证据文案差异本轮未在此案例上实测')
}

fs.writeFileSync(path.join(__dirname, '..', 'repro-emeishan-1011.json'), JSON.stringify({
  day: DAY, place: p.name, altitude: ALT, covered: cf.covered, envScan: ENV,
  生产固定窗: A, 包络R2后: B, 包络R2前: C, 已对照: !!C,
  有效性: { 后侧宽扫描生效: validB, 前侧宽扫描生效: validC, 两侧都生效: !!(validB && validC) },
}, null, 2))
console.log('\n→ repro-emeishan-1011.json')
