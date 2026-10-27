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
 * 可见性规则（裁剪判据的单源在 sky.js）：云海窗口与**民用晨光–民用暮光**取交集。
 * sky.js 的 cloudSea 判定不含昼夜条件，凌晨 01:00 的云况成立但不可见；
 * 判据住在 `sky.civilWindow` / `sky.clipRange`（依赖方向 agenda → sky 已存在，反向会成环），
 * 结论卡、本日程、机会窗口三处走同一份，不存在"第二处裁剪"。
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

/* 夜间天相 = 只认这两个 key。星座/银河以外的标记（云海/光染/彩虹/晨昏）都是**当日**
   的自然现象，不能搬进"今晚"序列（它们要么依赖白天光照，要么依赖民用晨昏）。 */
function isNightKey(key) {
  return key === 'galaxy' || key === 'star'
}

/* 24h OI 卡表达不了的夜间窗口：跨零点（今晚起、次日止）与纯次日窗口。
   同日夜间窗口 OI 卡已经列得下，页面在 OI 可见时不必在日程里再重复一遍
   （旧规则"OI 可见就不重复 L2"仍然适用于它们）。 */
function isSpanningNightEvent(e) {
  if (!e || !e.l2 || !isNightKey(e.key)) return false
  return e.dayOffset === 1 || String(e.window || '').indexOf('→ 次日') !== -1
}

/* 跨夜小时序列的形状门：数组非空、每项带非空日期 `d`、且按绝对时间严格递增。
   必须带 `d` 是因为聚类/排序/「今晚→次日」标签全靠它区分哪几个小时属于次日；
   没有日期的裸小时列表（旧调用形态）过不了这道门，调用方据此退回旧口径（不猜、不补）。 */
function isNightSequence(hours) {
  if (!Array.isArray(hours) || !hours.length) return false
  let prev = null
  for (const h of hours) {
    if (!h || typeof h.d !== 'string' || !h.d) return false
    const m = sky.hourMin(h.t)
    const day = Date.parse(h.d + 'T00:00:00Z')
    if (!Number.isFinite(m) || !Number.isFinite(day)) return false
    const abs = day + m * 60000
    if (prev != null && !(abs > prev)) return false
    prev = abs
  }
  return true
}

/* 日期差（以 originDate 为 0）。只用于把跨夜小时换算成可比较的绝对分钟；
   `d` 缺失或格式不对时按 0 处理（与"缺字段不增信息"一致，不编造跨日）。 */
function dayOffsetOf(d, originDate) {
  if (!originDate || !d) return 0
  const a = Date.parse(d + 'T00:00:00Z')
  const b = Date.parse(originDate + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((a - b) / 86400000)
}

function absMinutes(h, originDate) {
  return dayOffsetOf(h.d, originDate) * 1440 + sky.hourMin(h.t)
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

/**
 * 连续同相小时聚簇。
 * @param originDate 可选。传了就用「日偏移 × 1440 + 分钟」判连续（只有这样才能把
 *   23:00 与次日 00:00 连成一簇），并额外输出 { fromD, toD, hours }；
 *   不传时输出形状与旧实现逐字节相同（{ key, from, to }）。
 */
function clustersOf(detail, marks, originDate) {
  const out = []
  let cur = null
  let curAbs = -1
  for (const h of detail) {
    const key = primaryOf(marks[h.d + 'T' + h.t] || [])
    const abs = originDate ? absMinutes(h, originDate) : sky.hourMin(h.t)
    if (key && cur && cur.key === key && abs === curAbs + 60) {
      cur.to = h.t
      if (originDate) { cur.toD = h.d; cur.hours.push(h) }
      curAbs = abs
    } else if (key) {
      if (cur) out.push(cur)
      cur = originDate
        ? { key, from: h.t, to: h.t, fromD: h.d, toD: h.d, hours: [h] }
        : { key, from: h.t, to: h.t }
      curAbs = abs
    } else if (cur) {
      out.push(cur)
      cur = null
      curAbs = -1
    }
  }
  if (cur) out.push(cur)
  return out
}

// 民用晨光–暮光窗口（分钟）。判据本体在 sky.civilWindow（单源）；本处保留同名导出供 OI 使用。
function civilWindow(sun) {
  return sky.civilWindow(sun)
}

// 云海簇与民用晨昏取交集。返回 null = 整段不可见（应从日程丢弃）
function visibleSeaWindow(fromT, toT, civil) {
  /* 缺天文数据时原样返回（宁可多给，不给错）。不能把 `civil` 直接当 [fromT,toT] 用：
     clipRange 吃的是半开区间 [start,end)，簇末小时必须先把结束时刻补成 toT+60 再取交集。 */
  if (!civil.ok) return { fromT: fromT, toT: toT }
  const seg = sky.clipRange(sky.hourMin(fromT), sky.hourMin(toT) + 60, civil) // 簇末小时覆盖 [toT, toT+60)
  if (!seg) return null
  return { fromT: F.minutesLabel(seg.from), toT: F.minutesLabel(seg.to) }
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

/* 日程排序键：今日事件 = 0:00 起的分钟；`次日` 事件（纯次日窗口）整体排在今日之后。
   今日事件之间这个键与旧实现 `sky.hourMin(t)` 完全同序（前缀为空、dayOffset 未设）。 */
function sortKeyOf(e) {
  const next = e.dayOffset === 1 || /^次日 /.test(String(e.t || ''))
  const m = sky.hourMin(String(e.t || '').replace(/^次日 /, ''))
  return (next ? 1440 : 0) + (Number.isFinite(m) ? m : 0)
}

/**
 * 构建某一天的户外日程。
 * @param input { date, detail(当日24h), marks(页面级 {'dateTHH:mm': [key]}), sun(sunTimes), win(photoWindows),
 *                nightHours?（可选，sky.summarize 产出的跨夜小时序列，元素带 d） }
 * @returns [{ t:'HH:mm'|'次日 HH:mm', title, sub?, l2?:true, key?, window?, dayOffset? }]
 *          l2=true 的条目由页面按 key 关联 sky.summarize 的同 key 结论补上评级与文案。
 *
 * 跨夜（计划 §5.3）：给了合法的 nightHours 时，galaxy/star 只按**今晚**序列聚类——
 *   当日 detail 里的 galaxy/star 是**前夜尾段**，从日簇里剔除；今晚序列跨零点能连成一簇，
 *   起点在次日的事件标「次日 HH:mm」并排在当日事件之后（dayOffset=1，只给这类事件加）。
 *   没给 nightHours 时整份输出与旧实现逐字节相同（含事件字段集合）。
 */
function buildDayAgenda(input) {
  const { detail, marks, sun, win } = input || {}
  if (!Array.isArray(detail) || !detail.length) return []
  const date = input.date
  const nights = isNightSequence(input.nightHours) ? input.nightHours : null
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
       这一行却还替它背书 ⇒ 只有 marks 里真有 galaxy 小时才说；否则这一条只剩时刻（事实）。
       跨夜序列存在时必须问**今晚**（次日凌晨的银河也是今晚的），而不是问当日那段尾段。 */
    if (sun.astroDusk) add(sun.astroDusk, '天文暗夜始', hasMark(nights || detail, marks, 'galaxy') ? '银河与深空窗口' : null, false)
  }

  // 天气转折（L1）
  weatherTransitions(detail).forEach(e => add(e.t, e.title, e.sub, false))

  // OurTrail 窗口（L2，同源 hourMarks）；云海做可见性交集
  clustersOf(detail, marks || {}).forEach(c => {
    /* 有今晚序列时，当日 detail 里的 galaxy/star 是前夜尾段（00:00–05:00 那一段），
       真正的今晚窗口在下面的夜簇里；这里必须先剔除，否则同一现象会出现两次、且早上那次是错的。 */
    if (nights && isNightKey(c.key)) return
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

  // 今晚序列的夜间天相（只取 galaxy/star；跨零点为一簇，起点在次日的事件带 dayOffset）
  if (nights) {
    clustersOf(nights, marks || {}, date).forEach(c => {
      if (!isNightKey(c.key)) return
      const startNextDay = c.fromD !== date
      const endNextDay = c.toD !== date
      const t = startNextDay ? '次日 ' + c.from : c.from
      let window
      if (startNextDay) {
        // 纯次日簇：整个窗口都在次日（24h 日程无法用"今晚"表示半截，只能照实标「次日」）
        window = '次日 ' + c.from + (c.to === c.from ? '' : '–' + c.to)
      } else if (endNextDay) {
        // 跨零点：起点今晚、终点次日
        window = '今晚 ' + c.from + ' → 次日 ' + c.to
      } else {
        window = c.from === c.to ? c.from : c.from + '–' + c.to
      }
      add(t, TITLES[c.key], null, true, c.key, window)
      if (startNextDay) events[events.length - 1].dayOffset = 1
    })
  }

  events.sort((a, b) => sortKeyOf(a) - sortKeyOf(b))
  // 同刻同题去重（天文与差分可能撞在同一整点）
  return events.filter((e, i) => i === 0 || !(e.t === events[i - 1].t && e.title === events[i - 1].title))
}

module.exports = {
  AGENDA_KEYS,
  buildDayAgenda,
  weatherTransitions,
  clustersOf,
  isNightKey,
  isNightSequence,
  isSpanningNightEvent,
  civilWindow,
  visibleSeaWindow,
  lowCloudAt,
  lightNote,
  hasMark,
}
