/* oi-hour-hit-test.js — applySelection 的整点点击语义（Wave 2 补的缺陷修复）
 * 缺陷：条目 anchor hour = floor(fromMin/60)，而选中判据把 hour*60 当作**必须落在窗口段内**的点
 *       ⇒ 起点不在整点的子小时窗口（实测峨眉山 CLOUD_SEA「06:45–07:00」，anchor hour=6）永远点不中，
 *       而页面正是 data-hour="{{item.hour}}" → applySelection 这条路（weather.wxml:194/257 → weather.js:1046）。
 * 判据写法：包含关系由本文件**独立重写**为 oracle（不复用被测实现），用来钉「兜底只补空白、不动已有命中」。
 * 纯合成数据，不碰网络、不碰真钟。
 */
const OIP = require('../miniprogram/utils/oi-presentation.js')
let passed = 0, failed = 0
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
const section = t => console.log('\n== ' + t + ' ==')
const it = (timeText, summaryText, type) => ({ timeText, summaryText, type: type || 'CLOUD_SEA', tierText: '值得关注', title: 'x', hour: NaN })
const withAnchor = x => { /* 页面给出的 hour 就是 floor(起点/60)，这里按同一口径算，不手填 */
  const f = x.timeText.replace(/^今晚 /, '').split(/ → |–/)[0].split(':')
  x.hour = (+f[0]) % 24
  return x
}

/* ---------- oracle：独立重写的「整点落在窗口段内」 ---------- */
function hm(s) { const p = s.split(':'); return (+p[0]) * 60 + (+p[1]) }
function oracleSegs(timeText) {
  const hasArrow = timeText.indexOf('→') >= 0
  const from = hasArrow ? timeText.replace(/^今晚 /, '').split(' → ')[0] : timeText.split('–')[0]
  const to = hasArrow ? timeText.split(' → ')[1] : (timeText.split('–')[1] || timeText.split('–')[0])
  const f = hm(from), t = hm(to)
  if (f < 0 || t < 0) return []
  if (t === f) return [{ fromMin: f, toMin: Math.min(1440, f + 60) }]
  if (t > f) return [{ fromMin: f, toMin: t }]
  return [{ fromMin: f, toMin: 1440 }, { fromMin: 0, toMin: t }]
}
function oracleContain(itm, hour) {
  const m = hour * 60
  return oracleSegs(itm.timeText).some(sg => m >= sg.fromMin && m < sg.toMin)
}
function oracleFirstContainIndex(items, hour) {
  for (let i = 0; i < items.length; i++) if (oracleContain(items[i], hour)) return i
  return -1
}

/* ---------- 1. 子小时窗口：修前点不中的那一条 ---------- */
section('子小时窗口按自己的 anchor hour 必须选得中')
{
  const a = withAnchor(it('06:45–07:00', '云底 1,686 m 起成带'))
  const card = { items: [a], moreItems: [], selIndex: -2, selSummary: 'stale' }
  OIP.applySelection(card, a.hour)
  check('「06:45–07:00」用 anchor hour=6 选中自己', card.selIndex === 0, 'selIndex=' + card.selIndex)
  check('摘要跟着这一条走', card.selSummary === '云底 1,686 m 起成带', card.selSummary)
  check('这条按 oracle 的包含判据本不该命中（证明确实走的是兜底）',
    oracleFirstContainIndex([a], 6) === -1, 'oracle=' + oracleFirstContainIndex([a], 6))
}

/* ---------- 2. 包含优先：原本选得中的，一条都不许改选到别处 ---------- */
section('包含关系优先于重叠兜底')
{
  const containing = withAnchor(it('06:00–06:30', '包含 6 点'))
  const later = withAnchor(it('06:45–07:00', '重叠 6 点但起点在后'))
  ;[['包含项在前', [containing, later]], ['包含项在后', [later, containing]]].forEach(([nm, list]) => {
    const card = { items: list, moreItems: [], selIndex: -2, selSummary: '' }
    OIP.applySelection(card, 6)
    check(nm + '：仍选包含 6 点的那条', card.selIndex === list.indexOf(containing),
      'selIndex=' + card.selIndex + ' 应为 ' + list.indexOf(containing))
    check(nm + '：摘要与被选中的是同一条', card.selSummary === '包含 6 点')
  })
}

/* ---------- 3. 通用回归：oracle 命中的场合，新旧结果必须逐条相同 ---------- */
section('无回归全称（oracle 有命中的每个 hour × 形状，结果同一对象）')
{
  const shapes = ['05:20–06:10', '06:00–07:00', '06:45–07:00', '07:00–08:30', '今晚 22:00 → 02:00', '09:00', '13:15–13:20']
  let checked = 0, diff = 0
  shapes.forEach(tt => shapes.slice().reverse().forEach(tt2 => {
    const list = [withAnchor(it(tt, 'A')), withAnchor(it(tt2, 'B'))]
    for (let h = 0; h < 24; h++) {
      const exp = oracleFirstContainIndex(list, h)
      const card = { items: list, moreItems: [], selIndex: -2, selSummary: '' }
      OIP.applySelection(card, h)
      if (exp >= 0) {
        checked++
        if (card.selIndex !== exp) { diff++; console.log('    ! ' + tt + ' / ' + tt2 + ' @' + h + ' 期望 ' + exp + ' 实得 ' + card.selIndex) }
      }
    }
  }))
  check('oracle 命中的场合全部逐条一致（命中数 ' + checked + '，差异 ' + diff + '）', diff === 0 && checked > 0,
    'checked=' + checked + ' diff=' + diff)
}

/* ---------- 4. 兜底的确定性：多个重叠候选取本小时内最早开始 ---------- */
section('兜底候选的次序是确定的')
{
  const early = withAnchor(it('06:20–06:35', '最早'))
  const late = withAnchor(it('06:50–07:10', '较晚'))
  const card = { items: [late, early], moreItems: [], selIndex: -2, selSummary: '' }
  OIP.applySelection(card, 6)
  check('两条都不包含 6 点整 ⇒ 取起点最早的 06:20', card.selIndex === 1, 'selIndex=' + card.selIndex)
  check('摘要是「最早」那条', card.selSummary === '最早', card.selSummary)
}

/* ---------- 5. 终点开区间：兜底不得顺手放宽成闭区间 ---------- */
section('窗口结束的那一格不算命中')
{
  const w = withAnchor(it('06:45–07:00', '止于 7 点'))
  const card = { items: [w], moreItems: [], selIndex: -2, selSummary: 'stale' }
  OIP.applySelection(card, 7)
  check('点 7:00 不选中 06:45–07:00', card.selIndex === -1, 'selIndex=' + card.selIndex)
  check('选不中时摘要清空（不留下上一条的旧文字）', card.selSummary === '', JSON.stringify(card.selSummary))
}

/* ---------- 6. 折叠提升：selIndex 与 selSummary 必须同一个对象 ---------- */
section('提升折叠区条目时下标与摘要同源')
{
  const visible = withAnchor(it('06:00–07:00', '可见'))
  const foldedA = withAnchor(it('10:00–11:00', '折叠首条'))
  const foldedB = withAnchor(it('14:00–15:00', '折叠非首条'))
  const card = { items: [visible], moreItems: [foldedA, foldedB], selIndex: -2, selSummary: '' }
  OIP.applySelection(card, 14)
  const picked = card.items[card.selIndex]
  check('命中折叠区非首条 ⇒ 提升到可见列表并被选中', !!picked && picked.summaryText === '折叠非首条',
    'selIndex=' + card.selIndex + ' summary=' + card.selSummary)
  check('selSummary 与 selIndex 指向同一条', card.selSummary === (picked ? picked.summaryText : null),
    card.selSummary + ' vs ' + (picked && picked.summaryText))
  check('折叠区里不再留着被提升的那条', card.moreItems.indexOf(foldedB) === -1 && card.moreItems.length === 1)
}

/* ---------- 7. 跨零点与单小时形状仍按原语义解析 ---------- */
section('跨零点与单小时形状')
{
  const night = withAnchor(it('今晚 22:00 → 02:00', '夜里成带'))
  ;[[22, true], [23, true], [0, true], [1, true], [2, false], [12, false]].forEach(([h, expect]) => {
    const card = { items: [night], moreItems: [], selIndex: -2, selSummary: '' }
    OIP.applySelection(card, h)
    check('「今晚 22:00 → 02:00」点 ' + h + ':00 ' + (expect ? '应命中' : '不应命中'),
      (card.selIndex >= 0) === expect, 'selIndex=' + card.selIndex)
  })
  const one = withAnchor(it('09:00', '单小时'))
  const c1 = { items: [one], moreItems: [], selIndex: -2, selSummary: '' }
  OIP.applySelection(c1, 9)
  check('单小时形状 09:00 点 9 命中', c1.selIndex === 0 && c1.selSummary === '单小时', 'selIndex=' + c1.selIndex)
  const c2 = { items: [one], moreItems: [], selIndex: -2, selSummary: 'stale' }
  OIP.applySelection(c2, 10)
  check('单小时形状点 10 不命中且清摘要', c2.selIndex === -1 && c2.selSummary === '')
}

/* ---------- 8. 缺 card / 空列表不得抛 ---------- */
section('边界：无 card、无条目')
check('applySelection(null) 返回 false', OIP.applySelection(null, 6) === false)
{
  const card = { items: [], moreItems: [], selIndex: -2, selSummary: 'stale' }
  const r = OIP.applySelection(card, 6)
  check('空列表返回 true 且 selIndex=-1、摘要清空', r === true && card.selIndex === -1 && card.selSummary === '')
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
