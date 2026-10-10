/* G1 取证：`LAYER_THICKNESS_MIN = 300 m` 的「说法」与「可复现性」是两件事，分开判。
 *
 * 这个脚本把上一轮靠人眼做的追溯变成可复跑的机器判据，输出四个独立维度：
 *   D1 说法在仓库里有几处、彼此是不是同一条来源（互相抄的不算两条证据）
 *   D2 引入它的提交里有没有样本 / 脚本 / 中间产物
 *   D3 全 ref + 不可达对象里能不能捞回样本（「证据是否可恢复」的硬检查）
 *   D4 仓库里现存每一份**落盘真实快照**上，该说法能不能被复现（P50 到底是多少、300 落在第几百分位）
 *
 * 只读：不改生产文件、不改阈值、不发网络（只用已落盘的快照）。
 * 运行：node g1-provenance.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))

function git (args) {
  const r = cp.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
  return String(r.stdout || '')
}
function grepFiles (needle, exts) {
  const out = []
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
    if (e.name === 'node_modules' || e.name === '.git') return
    const f = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name !== 'dist') walk(f); return }
    if (!exts.some(x => f.endsWith(x))) return
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    lines.forEach((l, i) => { if (l.indexOf(needle) >= 0) out.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), line: i + 1, text: l.trim() }) })
  })
  walk(ROOT)
  return out
}

const CLAIM = 'P50'
const THICK = 'LAYER_THICKNESS_MIN'
const out = { generatedAt: new Date().toISOString() }

/* ---------- D1 说法有几处（原始主张 vs 后续转述，两者不能混为「两条证据」） ---------- */
const META = /^(AGENTS\.md|SYNC\.md)$|^docs\/weather-ux\/(qa|superpowers)\//
const all = [].concat(grepFiles(CLAIM, ['.js', '.md']), grepFiles(THICK, ['.js', '.md']))
const uniq = []
const seen = new Set()
all.forEach(function (s) {
  const k = s.file + ':' + s.line
  if (seen.has(k)) return
  seen.add(k)
  uniq.push(s)
})
out.D1_原始主张出处 = uniq.filter(s => !META.test(s.file))
out.D1_后续转述 = uniq.filter(s => META.test(s.file)).map(s => s.file + ':' + s.line)
/* 原始主张里有几句真的写了「P50」？注释与文档表格若互相引用，算一条来源 */
out.D1_是否互相独立 = out.D1_原始主张出处.filter(s => s.text.indexOf(CLAIM) >= 0).map(s => s.file + ':' + s.line)

/* ---------- D2 引入阈值的提交里有没有样本/脚本（与「后来提到过 P50 的提交」分开算） ---------- */
const intro = git(['log', '--all', '--format=%H|%ad|%s', '--date=short', '-S' + THICK, '--', 'miniprogram/'])
  .trim().split('\n').filter(Boolean)
out.D2_引入阈值的提交 = intro.map(function (l) {
  const parts = l.split('|')
  const h = parts[0]
  const files = git(['show', '--name-only', '--format=', h]).split('\n').filter(Boolean)
  const data = files.filter(f => /\.(json|csv)$/.test(f))
  const stats = files.filter(f => /survey|calib|percentile|thickness|p50/i.test(f) && /\.js$/.test(f))
  return { sha: h.slice(0, 7), date: parts[1], subject: parts[2], 文件数: files.length,
    其中数据样本: data, 其中统计脚本: stats,
    该提交是否同时引入说法: git(['show', '--format=', h]).indexOf(CLAIM) >= 0 }
})
out.D2_提到该说法的后续提交 = git(['log', '--all', '--format=%h %ad %s', '--date=short', '-S' + CLAIM, '--', 'docs/', 'miniprogram/'])
  .trim().split('\n').filter(Boolean)

/* ---------- D3 不可达对象里能不能捞回来 ---------- */
/* 命中关键词不等于「找到了样本」：本仓库自己的 SYNC.md 旧版本就写着「层厚≥300m」，
 * 那是**转述**，不是数据。必须按对象形态分类：数据/脚本 才算可恢复，文档转述不算。 */
const unf = git(['fsck', '--unreachable', '--no-progress'])
const unblobs = unf.split('\n').filter(x => /unreachable blob/.test(x)).map(x => x.split(' ')[2])
const recovered = []
unblobs.forEach(function (b) {
  const c = cp.spawnSync('git', ['cat-file', '-p', b], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout || ''
  if (!/P50|层厚|thickness|48 个/.test(c)) return
  const isData = /^\s*[\[{]/.test(c) && /cloudCover|altitudes|levels/.test(c)
  const isStatsScript = /function (quant|percentile|p50)\b|Math\.round\(.*\*\s*0\.5\)/.test(c) && /thickness|层厚/.test(c)
  recovered.push({ sha: b.slice(0, 8), bytes: c.length, 形态: isData ? '数据样本' : isStatsScript ? '统计脚本' : '文档转述',
    首行: c.split('\n')[0].slice(0, 70) })
})
out.D3_不可达对象检查 = {
  不可达blob数: unblobs.length,
  命中关键词的对象: recovered,
  其中数据或脚本: recovered.filter(r => r.形态 !== '文档转述').length,
  stash: git(['stash', 'list']).trim().split('\n').filter(Boolean).length,
  结论: recovered.some(r => r.形态 !== '文档转述')
    ? '不可达对象里有候选数据/脚本，需人工核对'
    : '不可达对象里只有历轮文档的转述，没有这份样本或脚本 ⇒ 原始样本不可恢复',
}

/* ---------- D4 现存快照上能不能复现 ---------- */
/* ---------- D4 现存快照上能不能复现 ---------- */
/* 两份 3 站快照是逐字节相同的副本（历轮各存了一份），按内容哈希去重，
 * 否则同一份数据会被算成两个独立样本、把「复现了几次」说虚。 */
const SNAPSHOTS = [
  { name: '3 站 × 72h（v2-window / v2-oi-scan-audit 两份副本）', p: 'docs/weather-ux/qa/v2-window-adaptive-2026-10-09/tools/real-cloud.json', days: 3 },
  { name: '3 站 × 72h 的第二份副本', p: 'docs/weather-ux/qa/v2-oi-cloud-scan-audit-2026-10-09/tools/real-cloud.json', days: 3 },
  { name: '4 站 × 168h（本轮新抓，含稻城）', p: 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', days: 7 },
]
const COVER_MIN = 80, STEP = 50
/* 独立重写的层提取（规则与生产 cloudLayersAt 一致、代码不复用），扫描范围由调用方给 */
function layersAt (sample, t, lo, hi) {
  const pts = []
  for (let alt = lo; alt <= hi; alt += STEP) pts.push({ alt: alt, cover: sample(t, alt) })
  const runs = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= COVER_MIN, prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const crossed = !!(prev && prev.cover < COVER_MIN)
      const base = crossed ? prev.alt + (COVER_MIN - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : pts[i].alt
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover], cut: !crossed }
    } else if (on && run) { run.top = pts[i].alt; run.covers.push(pts[i].cover) }
    else if (!on && run) { runs.push(run); run = null }
  }
  if (run) { run.top = hi; run.cut = true; runs.push(run) }
  return runs.map(function (l) {
    return { base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce((a, b) => a + b, 0) / l.covers.length), cut: l.cut }
  })
}
function quant (arr, q) {
  if (!arr.length) return null
  const s = arr.slice().sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo))
}
out.D4_可复现性 = []
const seenHash = new Set()
SNAPSHOTS.forEach(function (sn) {
  const abs = path.join(ROOT, sn.p)
  if (!fs.existsSync(abs)) { out.D4_可复现性.push({ 快照: sn.name, 状态: '文件不存在' }); return }
  const raw = fs.readFileSync(abs, 'utf8')
  const hash = require('crypto').createHash('sha256').update(raw).digest('hex').slice(0, 12)
  if (seenHash.has(hash)) { out.D4_可复现性.push({ 快照: sn.name, 状态: '与另一份逐字节相同（哈希 ' + hash + '），不重复计入样本量', sha: hash }); return }
  seenHash.add(hash)
  const snap = JSON.parse(raw)
  const rows = { 生产带: [], 全实测范围: [] }
  let cols = 0
  Object.keys(snap.places).forEach(function (k) {
    const p = snap.places[k]
    if (!p.cloudLevels) return
    const nDays = Math.min(sn.days, Math.floor(((p.series || []).length) / 24))
    for (let d = 0; d < nDays; d++) {
      const day = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
      const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: day, hours: 24, userAltitude: p.elevation })
      if (!cf || !cf.covered) continue
      const col = CFF.makeColumnSampler(cf)
      const at = (t, a) => CFF.sampleAtStations(col, cf.times.length, t, a)
      cols++
      const env = { lo: Math.floor(Math.max(0, cf.covered.lo) / STEP) * STEP, hi: Math.ceil(cf.covered.hi / STEP) * STEP }
      for (let h = 0; h < cf.times.length; h++) {
        layersAt(at, h, CFF.ALT0, CFF.ALT1).filter(l => l.meanCover >= COVER_MIN).forEach(l => rows.生产带.push(l))
        layersAt(at, h, env.lo, env.hi).filter(l => l.meanCover >= COVER_MIN).forEach(l => rows.全实测范围.push(l))
      }
    }
  })
  const one = function (label, arr) {
    const th = arr.map(l => l.thickness)
    const below = th.filter(x => x < 300).length
    return { 口径: label, 小时列: cols, 层数: arr.length,
      P25: quant(th, 0.25), P50: quant(th, 0.5), P75: quant(th, 0.75),
      三百米所处百分位: arr.length ? Math.round(below / arr.length * 100) + '%' : null,
      三百米是否等于P50: quant(th, 0.5) === 300 }
  }
  out.D4_可复现性.push({ 快照: sn.name, sha: hash, 取数日: snap.date,
    地点: Object.keys(snap.places).map(k => snap.places[k].name + ' ' + snap.places[k].elevation + 'm'),
    结果: [one('生产带 2,000–6,000', rows.生产带), one('全实测范围', rows.全实测范围)] })
})

/* ---------- 综合判定：两个维度各自独立，任何一条都不许代替另一条 ---------- */
const reps = out.D4_可复现性.filter(r => r.结果)
out.判定 = {
  维度一_说法有历史出处: out.D1_原始主张出处.length > 0,
  维度一_原始主张位置: out.D1_原始主张出处.map(s => s.file + ':' + s.line),
  维度一_是否互相独立: out.D1_是否互相独立,
  维度二_引入阈值的提交: out.D2_引入阈值的提交,
  维度二_该提交是否带样本或脚本: out.D2_引入阈值的提交.some(c => c.其中数据样本.length || c.其中统计脚本.length),
  维度三_原始样本可否恢复: out.D3_不可达对象检查.结论,
  维度四_现存快照上能否复现P50等于300: reps.some(r => r.结果.some(x => x.三百米是否等于P50)),
  维度四_现存快照给出的P50区间: reps.map(r => r.结果.map(x => x.口径 + ' P50=' + x.P50 + '（300 在 P' + x.三百米所处百分位.replace('%', '') + '）')),
  读法: '维度一说明「这句话写过」；维度二/三说明「凭据没入库、找不回来」；维度四说明「现存数据上复现不出 P50=300」，'
    + '但三份快照的 P50 本身就相差数倍 ⇒ 既不能据此判定 300 错，也不能据此判定 300 对。',
}

console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'g1-provenance.json'), JSON.stringify(out, null, 2))
