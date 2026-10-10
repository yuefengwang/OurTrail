/**
 * 天气模块 · 今日户外时间轴聚合（V2）
 *
 * ── 边界（务必遵守，勿越界）────────────────────────────────────────
 * 本文件**不含任何天相阈值**。窗口判定一律来自 sky.hourMarks 的产出（调用方传入 marks），
 * 天文时刻来自 astro（sun/win 由调用方传入）——与 meteogram 标记行、结论卡共用同一来源，
 * 图、日程、卡三处不会互相打架。天气转折只做相邻小时差分（L1 事实陈述，非预测）。
 * 摄影窗口（黄金/蓝调）的"当时值不值得蹲"后缀只按**引用**读 `sky.LIGHT_LIMITS.LOW_CLOUD_MAX`
 * （与光染、彩虹同一把尺），数字不在本文件里出现第二次。
 *
 * 可见性规则（presentation 层唯一一处裁剪）：云海窗口与**民用晨光–民用暮光**取交集。
 * sky.js 的 cloudSea 判定不含昼夜条件，凌晨 01:00 的云况成立但不可见；
 * 在聚合层裁掉，sky.js 阈值与其余 65 例测试零改动（任务 §20 的落点）。
 *
 * wx-free：不得出现任何 wx.*，否则会被移出 Node 测试覆盖（utils/AGENTS.md 铁律）。
 */

'use strict'

const sky = require('./sky')
const F = require('./format')

// 日程的 L2（OurTrail 分析）主角顺序：徒步者真正会追的窗口在前。
// golden/blueHour 是客观天文时刻，走 L1 天文事件，不在这里参与竞选。
const AGENDA_KEYS = ['cloudSea', 'alpenglow', 'rainbow', 'galaxy', 'star']

const TITLES = {
  cloudSea: '云海观察窗口',
  alpenglow: '晨昏光染可能',
  rainbow: '彩虹可能',
  galaxy: '银河窗口',
  star: '星空条件',
}

function primaryOf(list) {
  for (let i = 0; i < AGENDA_KEYS.length; i++) {
    if (list.indexOf(AGENDA_KEYS[i]) !== -1) return AGENDA_KEYS[i]
  }
  return null
}

/* ---------- L1：天气转折（相邻小时差分，只陈述不预测） ---------- */

function weatherTransitions(detail) {
  const out = []
  for (let i = 1; i < detail.length; i++) {
    const a = detail[i - 1] // 前一小时（旧状态）
    const b = detail[i]     // 当前小时（新状态，转折记在它头上）
    const wetA = ((a.precip || 0) + (a.showers || 0)) > 0
    const wetB = ((b.precip || 0) + (b.showers || 0)) > 0
    if (wetB && !wetA) {
      out.push({
        t: b.t,
        title: Number(b.temp) != null && Number(b.temp) <= 1 ? '降雪开始' : '降水开始',
        sub: '降水概率 ' + (b.pop == null ? '—' : b.pop) + '%',
      })
    } else if (!wetB && wetA) {
      out.push({ t: b.t, title: '降水结束' })
    }
    const lowA = (a.cloud && a.cloud.low) || 0
    const lowB = (b.cloud && b.cloud.low) || 0
    const delta = lowB - lowA
    if (delta >= 25) out.push({ t: b.t, title: '云层上升', sub: '低云 ' + lowA + '% → ' + lowB + '%' })
    else if (delta <= -25) out.push({ t: b.t, title: '云层消散', sub: '低云 ' + lowA + '% → ' + lowB + '%' })
  }
  return out
}

/* ---------- L2：sky.hourMarks 簇（连续同相小时合并） ---------- */

function clustersOf(detail, marks) {
  const out = []
  let cur = null
  for (const h of detail) {
    const key = primaryOf(marks[h.d + 'T' + h.t] || [])
    if (key && cur && cur.key === key && sky.hourMin(h.t) === sky.hourMin(cur.to) + 60) {
      cur.to = h.t
    } else if (key) {
      if (cur) out.push(cur)
      cur = { key, from: h.t, to: h.t }
    } else if (cur) {
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out
}

// 民用晨光–暮光窗口（分钟）。天文数据缺失时 ok=false，调用方不裁剪（宁可多给，不给错）
function civilWindow(sun) {
  const from = sky.hourMin(sun && sun.civilDawn)
  const to = sky.hourMin(sun && sun.civilDusk)
  return { from, to, ok: Number.isFinite(from) && Number.isFinite(to) }
}

// 云海簇与民用晨昏取交集。返回 null = 整段不可见（应从日程丢弃）
function visibleSeaWindow(fromT, toT, civil) {
  if (!civil.ok) return { fromT, toT }
  const s = Math.max(sky.hourMin(fromT), civil.from)
  const e = Math.min(sky.hourMin(toT) + 60, civil.to) // 簇末小时覆盖 [toT, toT+60)
  if (!(e > s)) return null
  return { fromT: F.minutesLabel(s), toT: F.minutesLabel(e) }
}

/* 某个标记在这一天是否真的出现过。口径一律在 sky.hourMarks 里（银心季 + 月照 + 暗夜晴空
   三件事都在那条闸上），本文件不另判一遍——否则就是第四次抄同一把尺。 */
function hasMark (detail, marks, key) {
  return (detail || []).some(h => ((marks || {})[h.d + 'T' + h.t] || []).indexOf(key) !== -1)
}

/* ---------- L1 摄影窗口的事实后缀（不裁时间，只说当时的云） ---------- */

// 该时刻所在小时的低云量。没有读数返回 null（不编造，也不给否定结论）
// 只认 number：`Number(null) === 0` 会把"这一小时没有云量"印成"低云 0%，光好"——那是凭空造有利事实。
function lowCloudAt(detail, t) {
  if (!Array.isArray(detail) || !t) return null
  const m = sky.hourMin(t)
  if (!Number.isFinite(m)) return null
  const h = detail.find(x => {
    const xm = sky.hourMin(x.t)
    return Number.isFinite(xm) && xm <= m && m < xm + 60
  })
  const low = h && h.cloud && h.cloud.low
  return typeof low === 'number' && Number.isFinite(low) ? low : null
}

/* 黄金/蓝调是太阳高度角的穿越点，**任何天气下都发生**，所以时间本身不裁（裁掉就是把事实藏了）。
   但"这一小时值不值得为它蹲守"是另一件事：低云厚到一定程度，斜射暖光到不了山体、
   蓝调的天空可能只发灰不发蓝。这句用 sky.LIGHT_LIMITS 的单源口径（与光染、彩虹同一把尺），
   本文件不写数字。缺云量读数 ⇒ 不加后缀：判不出不能写成"看得到"，也不能写成"看不到"。 */
function lightNote(detail, from, kind) {
  const low = lowCloudAt(detail, from)
  if (low == null || low < sky.LIGHT_LIMITS.LOW_CLOUD_MAX) return null
  return '当时低云 ' + low + '%，' + (kind === 'blue' ? '天空可能只发灰不发蓝' : '斜射暖光可能到不了山体')
}
function subWith(base, note) {
  if (!note) return base
  return base ? base + '（' + note + '）' : note
}

/* ---------- 主入口 ---------- */

/**
 * 构建某一天的户外日程。
 * @param input { date, detail(当日24h), marks(页面级 {'dateTHH:mm': [key]}), sun(sunTimes), win(photoWindows) }
 * @returns [{ t:'HH:mm', title, sub?, l2?:true, key?, window? }]
 *          l2=true 的条目由页面按 key 关联 sky.summarize 的同 key 结论补上评级与文案。
 */
function buildDayAgenda(input) {
  const { detail, marks, sun, win } = input || {}
  if (!Array.isArray(detail) || !detail.length) return []
  const civil = civilWindow(sun)
  const events = []

  const add = (t, title, sub, l2, key, window) => events.push({ t, title, sub, l2, key, window })

  // 天文时刻（L1，客观）：三重暮光 + 晨昏光 + 日出日落
  if (sun) {
    if (sun.astroDawn) add(sun.astroDawn, '天文晨光始', '天空开始变亮', false)
    if (win && win.dawnBlue) add(win.dawnBlue.from, '蓝调时刻（晨）', subWith('天空最蓝的十几分钟', lightNote(detail, win.dawnBlue.from, 'blue')), false)
    if (win && win.morningGolden) add(win.morningGolden.from, '黄金时刻（晨）', subWith('斜射暖光开始', lightNote(detail, win.morningGolden.from, 'golden')), false)
    if (sun.sunrise) add(sun.sunrise, '日出', null, false)
    if (sun.sunset) add(sun.sunset, '日落', null, false)
    if (win && win.eveningGolden) add(win.eveningGolden.from, '黄金时刻（昏）', subWith(null, lightNote(detail, win.eveningGolden.from, 'golden')), false)
    if (win && win.duskBlue) add(win.duskBlue.from, '蓝调时刻（昏）', subWith(null, lightNote(detail, win.duskBlue.from, 'blue')), false)
    /* 这句 sub 是机会主张，不是钟点：满天云或不在银心季的那晚，银河卡已被沉默闸收掉，
       这一行却还替它背书 ⇒ 只有 marks 里真有 galaxy 小时才说；否则这一条只剩时刻（事实）。 */
    if (sun.astroDusk) add(sun.astroDusk, '天文暗夜始', hasMark(detail, marks, 'galaxy') ? '银河与深空窗口' : null, false)
  }

  // 天气转折（L1）
  weatherTransitions(detail).forEach(e => add(e.t, e.title, e.sub, false))

  // OurTrail 窗口（L2，同源 hourMarks）；云海做可见性交集
  clustersOf(detail, marks || {}).forEach(c => {
    if (c.key === 'cloudSea') {
      const vis = visibleSeaWindow(c.from, c.to, civil)
      if (!vis) return
      add(vis.fromT, TITLES[c.key], null, true, c.key,
        vis.fromT === vis.toT ? vis.fromT : vis.fromT + '–' + vis.toT)
      return
    }
    add(c.from, TITLES[c.key], null, true, c.key,
      c.from === c.to ? c.from : c.from + '–' + c.to)
  })

  events.sort((a, b) => sky.hourMin(a.t) - sky.hourMin(b.t))
  // 同刻同题去重（天文与差分可能撞在同一整点）
  return events.filter((e, i) => i === 0 || !(e.t === events[i - 1].t && e.title === events[i - 1].title))
}

module.exports = {
  AGENDA_KEYS,
  buildDayAgenda,
  weatherTransitions,
  clustersOf,
  civilWindow,
  visibleSeaWindow,
  lowCloudAt,
  lightNote,
  hasMark,
}
