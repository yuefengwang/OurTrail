'use strict'
// PAGE2（批次 3）行为门：node tools/page2-gates-test.js
//
// 覆盖：A-07（天气页日期控件位置 + 切日后的视口复位）、A-23（观察点卡内缩单源）、
//       A-24（GPX 卡标题不再逐字重复按钮）、A-26（逐卡免责收敛）。
//       M-18 见 §6：本批只落「没越界」的守卫，正文改动被派单外的条件卡住（见 out/PAGE2/handoff.md）。
//
// 三条本仓库实测过的假绿形态，本门各自的防法（不是礼节，是判据结构）：
// ① 铁律 21「数节点/数类名不是 UI 证据」⇒ 所有可见性判据都走**渲染可达性模型**：
//    同一条断言在 5 个不同的页面状态里各跑一遍，要求「该出现的出现、不该出现的不出现」，
//    并且三个顶层分支必须**互斥闭合**（恰好一个渲染）。计数只用于"同一个对象在同一个状态里"。
// ② 「夹具恰好让两个真值来源看起来一样」⇒ A-23 不只比两张卡的内缩相等，还做**影子改写**：
//    在内存里把 app.wxss 的 .card padding 从 16px 改成 24px，两张卡必须一起变 24，
//    还原后逐项相同。若某张卡靠页内规则或内联 style 自己写着 16px，影子追不上 ⇒ 当场红。
//    A-26 同理：夹具带 5 张结论卡与 1 张结论卡两种规模，判据必须都恰好剩 1 处。
// ③ 「断言依赖工作树的偶然状态」⇒ §0 有效性门先证明本门的每个被测对象在夹具里**真的存在**
//    （非空转），并统计「表达式求值失败」的数量——求值失败会被当成"不渲染"，
//    那正是最隐蔽的假绿，所以恒等 0 是硬性前置。
//
// 写法约束（都是本仓铁律）：
// · 铁律 30：钉行为不钉源码文本。WXML 被建成树再按 data 求值，WXSS 被建成规则再算层叠终值；
//    换一种等价写法（合并规则、调整书写次序、把 class 换成等价表达式）不改变判据结果。
// · 铁律 11：不在测试里镜像页面逻辑。§2 加载**真** weather.js 配置并打真 handler，
//    滚动判据读的是 wx.pageScrollTo 的实际调用，不是"代码里有没有这句"。
// · 铁律 17/设计系统：A-23 的判据读"赢家是哪条声明"，不读"文件里有几个 16px 字样"。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const P = (...p) => path.join(MP, ...p)

const WEATHER_WXML = P('pages', 'weather', 'weather.wxml')
const WEATHER_JS = P('pages', 'weather', 'weather.js')
const HUB_WXML = P('pages', 'weather-hub', 'weather-hub.wxml')
const HUB_WXSS = P('pages', 'weather-hub', 'weather-hub.wxss')
const APP_WXSS = P('app.wxss')
const NOTICES_WXML = P('pages', 'notices', 'notices.wxml')
const ANOTICES_WXML = P('pages', 'anotices', 'anotices.wxml')
const NOTICES_WXSS = P('pages', 'notices', 'notices.wxss')
const ANOTICES_WXSS = P('pages', 'anotices', 'anotices.wxss')

let passed = 0
let failed = 0
const fails = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; fails.push(name); console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }
function note(t) { console.log('  · ' + t) }
const src = f => fs.readFileSync(f, 'utf8')

/* ================= 渲染模型（WXML → 按 data 求值的可见节点/文本） ================= */
const KEYWORDS = ['true', 'false', 'null', 'undefined', 'typeof', 'new', 'in', 'of']
let unresolvable = []

function stripComments(s) { return s.replace(/<!--[\s\S]*?-->/g, ' ') }
function rawExpr(v) {
  if (typeof v !== 'string') return null
  const m = v.match(/^\s*\{\{([\s\S]*)\}\}\s*$/)
  return m ? m[1] : null
}
function stripLiterals(e) { return String(e).replace(/'[^']*'|"[^"]*"/g, '""') }
function rootsOf(expr) {
  const s = stripLiterals(expr)
  const out = []
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g
  let m
  while ((m = re.exec(s))) {
    // 只取「根标识符」：属性访问的头部（a.b 里的 a）、下标访问的头部（a[i] 里的 a）
    const before = s.slice(0, m.index)
    if (/\.\s*$/.test(before)) continue // 是别人的属性，不是根
    if (KEYWORDS.indexOf(m[0]) !== -1) continue
    if (out.indexOf(m[0]) === -1) out.push(m[0])
  }
  return out
}
function evalExpr(expr, scope) {
  const undeclared = rootsOf(expr).filter(n => !(n in scope))
  const prelude = undeclared.map(n => 'var ' + n + ' = undefined;').join('')
  return new Function('d', prelude + '\nwith (d) { return (' + expr + ') }')(scope)
}
function tryEval(expr, scope, where) {
  try { return { ok: true, value: evalExpr(expr, scope) } } catch (e) {
    unresolvable.push((where || '?') + ' {{' + expr + '}} → ' + String((e && e.message) || e).split('\n')[0])
    return { ok: false, error: String((e && e.message) || e) }
  }
}
function interpToString(text, scope, where) {
  return String(text).replace(/\{\{([\s\S]*?)\}\}/g, (_all, expr) => {
    const r = tryEval(expr, scope, where || 'interp')
    if (!r.ok) return ''
    return r.value === undefined || r.value === null ? '' : String(r.value)
  })
}
function parse(source) {
  const root = { tag: '#root', attrs: {}, children: [], start: 0 }
  const stack = [root]
  let i = 0
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      const tail = source.slice(i)
      if (tail.trim()) stack[stack.length - 1].children.push({ text: tail })
      break
    }
    const pending = source.slice(i, lt)
    if (pending.trim()) stack[stack.length - 1].children.push({ text: pending })
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt)
      i = end === -1 ? source.length : end + 3
      continue
    }
    if (source[lt + 1] === '/') {
      const gt = source.indexOf('>', lt)
      if (stack.length > 1) stack.pop()
      i = gt === -1 ? source.length : gt + 1
      continue
    }
    let j = lt + 1
    const nm = /^[A-Za-z0-9_-]+/.exec(source.slice(j))
    if (!nm) { i = lt + 1; continue }
    const name = nm[0]
    j += name.length
    const attrs = {}
    let selfClose = false
    while (j < source.length) {
      while (j < source.length && /\s/.test(source[j])) j++
      if (source[j] === '>') { j++; break }
      if (source[j] === '/') {
        if (source[j + 1] === '>') { selfClose = true; j += 2; break }
        j++
        continue
      }
      const am = /^[^\s=>/]+/.exec(source.slice(j))
      if (!am) { j++; continue }
      const key = am[0]
      j += key.length
      while (j < source.length && /\s/.test(source[j])) j++
      let val = ''
      if (source[j] === '=') {
        j++
        while (j < source.length && /\s/.test(source[j])) j++
        const q = source[j]
        if (q === '"' || q === "'") {
          const close = source.indexOf(q, j + 1)
          val = source.slice(j + 1, close === -1 ? source.length : close)
          j = close === -1 ? source.length : close + 1
        } else {
          const bare = /^[^\s>]*/.exec(source.slice(j))
          val = bare[0]
          j += val.length
        }
      }
      attrs[key] = val
    }
    const node = { tag: name, attrs, children: [], start: lt }
    stack[stack.length - 1].children.push(node)
    i = j
    if (!selfClose) stack.push(node)
  }
  return root
}
// 返回可见条目数组：[{kind:'node'|'text', uid, order, node, classes, text, scope, path}]
function render(source, data) {
  const root = parse(stripComments(source))
  const out = []
  let uid = 0
  let order = 0
  const walk = (node, scope, chain) => {
    let prev = null
    ;(node.children || []).forEach(ch => {
      if (ch.text !== undefined) {
        const raw = ch.text
        if (!raw.trim()) return
        out.push({ kind: 'text', uid: uid++, order: order++, text: raw, scope, path: chain.slice(), node: ch })
        return
      }
      const a = ch.attrs || {}
      let cond = null
      if ('wx:if' in a) {
        const e = rawExpr(a['wx:if'])
        cond = e
        prev = e === null ? 'true' : '!(' + e + ')'
      } else if ('wx:elif' in a) {
        const e = rawExpr(a['wx:elif'])
        cond = e === null ? (prev === null ? 'true' : prev) : (prev === null ? e : prev + ' && (' + e + ')')
        prev = e === null ? 'false' : (prev === null ? 'true' : prev) + ' && !(' + e + ')'
      } else if ('wx:else' in a) {
        cond = prev === null ? 'false' : prev
        prev = 'false'
      } else {
        prev = null
      }
      if (cond !== null) {
        const r = tryEval(cond, scope, 'wx-if')
        if (!r.ok || !r.value) return
      }
      let scopes = [scope]
      if ('wx:for' in a) {
        const fe = rawExpr(a['wx:for'])
        const r = tryEval(fe === null ? '' : fe, scope, 'wx-for')
        const list = r.ok ? r.value : null
        if (!Array.isArray(list)) return
        const iname = a['wx:for-item'] || 'item'
        const xname = a['wx:for-index'] || 'index'
        scopes = list.map((v, i) => Object.assign({}, scope, { [iname]: v, [xname]: i }))
      }
      if (ch.tag === 'overlay') {
        const oe = rawExpr(a.open)
        if (oe !== null) {
          const r = tryEval(oe, scopes[0], 'overlay.open')
          if (!r.ok || !r.value) return
        }
      }
      scopes.forEach(sc => {
        const self = uid++
        out.push({ kind: 'node', uid: self, order: order++, node: ch, scope: sc, path: chain.slice(), classes: classListOf(ch, sc) })
        walk(ch, sc, chain.concat([self]))
      })
    })
  }
  walk(root, data, [])
  return out
}
function classListOf(node, scope) {
  const raw = node.attrs && node.attrs.class
  if (!raw) return []
  return interpToString(raw, scope, 'class').trim().split(/\s+/).filter(Boolean)
}
function renderedText(entry, where) {
  return interpToString(entry.text, entry.scope, where || 'text').trim()
}
function hasClass(entry, cls) { return entry.kind === 'node' && entry.classes.indexOf(cls) !== -1 }
function entriesWithClass(entries, cls) { return entries.filter(e => hasClass(e, cls)) }
function within(entries, cardEntry) { return entries.filter(e => e.path.indexOf(cardEntry.uid) !== -1) }
function attrOf(entry, name) { return entry.node.attrs && name in entry.node.attrs ? entry.node.attrs[name] : null }
function attrResolved(entry, name, where) {
  const raw = attrOf(entry, name)
  if (raw === null) return null
  return interpToString(raw, entry.scope, where || ('attr:' + name))
}
function nodesTagged(entries, tag) { return entries.filter(e => e.kind === 'node' && e.node.tag === tag) }
function textsWith(entries, needle) {
  return entries.filter(e => e.kind === 'text' && renderedText(e).indexOf(needle) !== -1)
}

/* ================= 层叠模型（WXSS → 规则；内联 style 权重最高） ================= */
function parseDecls(body) {
  const out = []
  String(body).split(';').forEach(chunk => {
    const i = chunk.indexOf(':')
    if (i < 0) return
    const prop = chunk.slice(0, i).trim()
    const value = chunk.slice(i + 1).trim()
    if (prop) out.push({ prop, value })
  })
  return out
}
function parseSheet(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(text))) {
    const decls = parseDecls(m[2])
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(sel => rules.push({ sel, decls }))
  }
  return rules
}
function lastSegment(sel) { return String(sel).trim().split(/[\s>]+/).pop() || '' }
function selMatches(sel, classes, tag) {
  const last = lastSegment(sel)
  if (!last) return false
  const parts = last.match(/\.[A-Za-z0-9_-]+|^[A-Za-z0-9_-]+|[A-Za-z0-9_-]+/g) || []
  if (!parts.length) return false
  return parts.every(p => (p[0] === '.' ? classes.indexOf(p.slice(1)) !== -1 : p === tag))
}
function specOf(sel) {
  const s = String(sel)
  const cls = (s.match(/\.[A-Za-z0-9_-]+/g) || []).length
  const tags = (s.match(/(^|[\s>+~])([A-Za-z][A-Za-z0-9-]*)/g) || []).length
  return cls * 10 + tags
}
function expandPadding(value) {
  const parts = String(value).trim().split(/\s+/)
  const num = v => {
    if (/^-?\d*\.?\d+px$/i.test(v)) return Number(v.slice(0, -2))
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
    return Number.NaN // calc()/var() 等：本门不假装能算，返回 NaN 让判据如实红
  }
  if (parts.length === 1) return { t: num(parts[0]), r: num(parts[0]), b: num(parts[0]), l: num(parts[0]) }
  if (parts.length === 2) return { t: num(parts[0]), r: num(parts[1]), b: num(parts[0]), l: num(parts[1]) }
  if (parts.length === 3) return { t: num(parts[0]), r: num(parts[1]), b: num(parts[2]), l: num(parts[1]) }
  if (parts.length >= 4) return { t: num(parts[0]), r: num(parts[1]), b: num(parts[2]), l: num(parts[3]) }
  return { t: NaN, r: NaN, b: NaN, l: NaN }
}
// 给定渲染节点，算「左右内缩的层叠终值」以及赢家来自哪条选择器
function insetOf(entry, sheets) {
  const cls = entry.classes
  const tag = entry.node.tag
  const collected = []
  sheets.forEach((rules, si) => rules.forEach((r, ri) => {
    if (!selMatches(r.sel, cls, tag)) return
    r.decls.forEach(d => collected.push({ prop: d.prop, value: d.value, spec: specOf(r.sel), order: si * 1e7 + ri, from: r.sel, sheet: si }))
  }))
  const inline = entry.node.attrs && entry.node.attrs.style ? parseDecls(entry.node.attrs.style) : []
  inline.forEach((d, i) => collected.push({ prop: d.prop, value: d.value, spec: 1e9, order: i, from: 'inline style', sheet: -1 }))
  const winner = prop => {
    const same = collected.filter(x => x.prop === prop).sort((a, b) => (a.spec - b.spec) || (a.order - b.order))
    return same.length ? same[same.length - 1] : null
  }
  const short = winner('padding')
  const l = winner('padding-left')
  const r = winner('padding-right')
  const pick = (long, side) => {
    if (!long) return short ? { v: expandPadding(short.value)[side], from: short.from, sheet: short.sheet } : null
    const v = Number(String(long.value).replace(/px$/i, ''))
    return { v, from: long.from, sheet: long.sheet }
  }
  const L = pick(l, 'l')
  const R = pick(r, 'r')
  return { left: L ? L.v : NaN, right: R ? R.v : NaN, winnerLeft: L ? L.from + (L.sheet < 0 ? '' : '@sheet' + L.sheet) : null }
}
function findCard(entries, labelInside) {
  const cards = entriesWithClass(entries, 'card')
  if (!labelInside) return cards
  return cards.filter(c => textsWith(within(entries, c), labelInside).length > 0)
}
// 按**结构**认卡（卡内那个入口的 handler），不按文案认。
// 按文案认卡的门会在别人改文案时直接抛错（崩红 ≠ 抓到，本仓口径），而且它把"内容"与"对象"混成了一件事。
function cardByHandler(entries, handler) {
  return entriesWithClass(entries, 'card').filter(c =>
    within(entries, c).some(x => attrOf(x, 'bindtap') === handler || attrOf(x, 'catchtap') === handler))
}
function hubCards(entries) {
  const gpx = cardByHandler(entries, 'onImportGpx')[0] || null
  const pts = cardByHandler(entries, 'onPointTap')[0] || null
  const trk = cardByHandler(entries, 'onTrackToggle')[0] || null
  return { gpx, pts, trk }
}
// 崩红鉴别：段落里抛错记一条 ✗ 读数，后面的段落照常跑（否则一次抛错让整门没有读数）
function guarded(name, fn) {
  try { return fn() } catch (e) {
    failed++; fails.push(name + '（段内抛错）')
    console.error('  ✗ ' + name + ' 段内抛错（崩红，不算抓到）：' + String((e && e.message) || e).split('\n')[0])
    return null
  }
}

/* ================= 夹具：天气页的五个真实状态 ================= */
const COORD = { lat: 30.0, lng: 103.0 }
const DAY0 = '2026-10-15'
function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10) }
function fixtureDayCards(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = addDays(DAY0, i)
    out.push({ date: d, label: '周' + i, dateLabel: d.slice(5), phrase: { label: '多云', tone: 'ok' }, tMax: 18, tMin: 6, precipProbMax: 20, selected: i === 0 })
  }
  return out
}
function fixtureCondCards(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({
      key: 'k' + i, title: '天相' + i, window: '06:40–07:10', text: '有条件成立的可能', look: '朝东（约 92 度）',
      tone: 'ok', gradeLabel: '一般', stars: '★★★☆☆', featured: i === 0, advice: '出发前再看一眼云',
      evidence: [{ fact: '低云 20%', at: '06:40' }],
    })
  }
  return out
}
function baseWeatherData(over) {
  return Object.assign({
    denied: '', loading: false, loadingWeather: false,
    pointCard: null, pointLabels: ['起点'], pointIndex: 0, scheduleBasis: '',
    date: DAY0, isOwner: false, providerLabel: 'Open-Meteo', updatedAt: DAY0 + ' 07:00',
    weatherStale: null, retryNote: '', emptyKind: 'empty', emptyTitle: '', emptyDetail: '',
    dayCards: [], viewSpan: 24, unified: null, oiCard: null, oiHorizon: null, oiMultiDay: [],
    chartView: [], chartMarks: {}, chartNight: {}, chartSelected: {}, chartElev: null, chartNow: null,
    chartPick: null, hourChip: null, agenda: [], callouts: [], detailRows: [], showDetail: false,
    condOverall: null, condCards: [], condSilent: null, openEvidence: {},
  }, over || {})
}
const WEATHER_STATES = {
  denied: baseWeatherData({ denied: '缺少活动编号。' }),
  loading: baseWeatherData({ loading: true }),
  loadingWeather: baseWeatherData({ loadingWeather: true, retryNote: '网络不太稳，正在重试（第 1 次）…' }),
  data: baseWeatherData({
    dayCards: fixtureDayCards(7),
    unified: { src: 'data:image/svg+xml;base64,AAA', selSrc: '', hour: null, r1: '云区 2,400 m', r2: 'r2', r3: 'r3', r4: 'r4', elevShown: true, legendElev: '此点海拔', legendIn: '此刻处于云中', readout: '点图即读' },
    condCards: fixtureCondCards(5),
    condOverall: { stars: '★★★★☆', label: '较好', tone: 'good' },
    agenda: [{ t: '06:40', title: '天文晨光始', l2: false, sub: '', window: '', gradeLabel: '', tone: '' }],
    callouts: [{ title: '午后有雷雨的可能', tone: 'warn' }],
    isOwner: true,
  }),
  dataClassic: baseWeatherData({
    dayCards: fixtureDayCards(7), unified: null, oiCard: null,
    condCards: fixtureCondCards(1), hourChip: { t: '08:00', phrase: { label: '晴' }, temp: 10, feels: 9, pop: 10, precip: 0, wind: 7, windDir: '北', rh: 60, pressure: '812', band: '2400–2600 m', tags: ['云海窗口'], inCloud: false },
  }),
  empty: baseWeatherData({ emptyKind: 'error', emptyTitle: '气象服务暂时连不上', emptyDetail: '不是路线或坐标的问题。' }),
  // 阳性对照（P15 第一次漏网就是因为缺了这一档）：组织者 + 没有数据。
  // 少了它，"给草稿按钮多加一条 dayCards.length 可见条件"这种顺手改判据在夹具里**与现状不可分辨**。
  ownerNoData: baseWeatherData({ isOwner: true }),
}
const DATA_STATES = ['loadingWeather', 'data', 'dataClassic', 'empty', 'ownerNoData']

/* ================= 夹具：weather-hub（观察点 / 轨迹点组） ================= */
function hubData(over) {
  return Object.assign({
    points: [
      { id: 'w1', display: '冷杉坪', subText: '3,580 m · 2026-10-14', },
      { id: 'w2', display: '垭口', subText: '4,120 m · 2026-10-14' },
    ],
    tracks: [{ id: 't1', name: '四姑娘山大峰', statsText: '12 个节点', nodes: [{ id: 'n1', name: '起点', label: '0 min' }, { id: 'n2', name: '垭口', label: '+180 min' }] }],
    trackOpen: { t1: true },
    manualOpen: false, manual: { name: '', lat: '', lng: '', ele: '', wgs: false }, manualError: '',
    gpxOpen: false, gpxError: '', gpxMeta: null, gpxPoints: [],
    deleteOpen: false, deleteInfo: { type: 'point', id: '', name: '' },
  }, over || {})
}

/* ================= §0 有效性门（本门不是空转） ================= */
function resetUnresolvable() { unresolvable = [] }
section('§0 有效性门：判据的输入必须真的存在')
{
  resetUnresolvable()
  const e = render(src(WEATHER_WXML), WEATHER_STATES.data)
  check('天气页夹具真的渲染出 5 张结论卡（否则 §5 整段空转）',
    entriesWithClass(e, 'cond-pheno').length === 5, String(entriesWithClass(e, 'cond-pheno').length))
  check('天气页夹具真的渲染出 7 张日条卡与统一图卡（否则 §1 的位置判据空转）',
    entriesWithClass(e, 'day-card').length === 7 && entriesWithClass(e, 'cloud-field-card').length === 1,
    entriesWithClass(e, 'day-card').length + '/' + entriesWithClass(e, 'cloud-field-card').length)
  check('天气页夹具的表达式全部求值得动（求值失败会被当成"不渲染"= 假绿）',
    unresolvable.length === 0, unresolvable.slice(0, 3).join(' ｜ '))
  resetUnresolvable()
  const ec = render(src(WEATHER_WXML), WEATHER_STATES.dataClassic)
  check('经典 canvas 分支的夹具渲染出 .timeline-card 且不出云场卡（两条分支各有阳性对照）',
    entriesWithClass(ec, 'timeline-card').length === 1 && entriesWithClass(ec, 'cloud-field-card').length === 0,
    String(entriesWithClass(ec, 'timeline-card').length))
  check('经典分支同样无求值失败', unresolvable.length === 0, unresolvable.slice(0, 3).join(' ｜ '))
  resetUnresolvable()
  const h = render(src(HUB_WXML), hubData())
  check('hub 夹具渲染出 3 张 .card（GPX 卡 + 观察点卡 + 轨迹点组卡）',
    entriesWithClass(h, 'card').length === 3, String(entriesWithClass(h, 'card').length))
  check('hub 夹具的观察点卡里真的有一行行内容（.list-row ≥ 2）',
    (() => {
      const pts = hubCards(h).pts
      return !!pts && entriesWithClass(within(h, pts), 'list-row').length >= 2
    })(), '')
  check('hub 夹具表达式全部求值得动', unresolvable.length === 0, unresolvable.slice(0, 3).join(' ｜ '))
  resetUnresolvable()
  const noPoints = render(src(HUB_WXML), hubData({ points: [] }))
  check('没有观察点时那张卡不渲染（判据不是靠"文件里有这个类"成立的）',
    hubCards(noPoints).pts === null, String(hubCards(noPoints).pts))
}

/* ================= §1 A-07 模板半边：日期控件不再被 stranded ================= */
section('§1 A-07 模板：日期控件的位置与「移动块没改判据」')
guarded('§1', () => {
  const byState = {}
  Object.keys(WEATHER_STATES).forEach(k => {
    resetUnresolvable()
    byState[k] = render(src(WEATHER_WXML), WEATHER_STATES[k])
    if (unresolvable.length) byState[k].unresolvable = unresolvable.slice()
  })
  const dirty = Object.keys(byState).filter(k => byState[k].unresolvable)
  check('五个页面状态全部求值干净（求值失败会伪装成"没渲染"）', dirty.length === 0, dirty.join(','))

  // 顶层三分支互斥闭合：denied / loading / wx:else 恰有一个渲染
  const rootSrc = stripComments(src(WEATHER_WXML))
  const tree = parse(rootSrc)
  const pageView = (tree.children || [])[0]
  const three = (pageView.children || []).filter(ch => 'wx:if' in (ch.attrs || {}) || 'wx:elif' in (ch.attrs || {}) || 'wx:else' in (ch.attrs || {}))
  check('模板顶层确有 denied / loading / else 三个互斥分支（判据的输入存在）', three.length === 3, String(three.length))
  Object.keys(byState).forEach(k => {
    const e = byState[k]
    const ids = new Set(e.filter(x => x.kind === 'node').map(x => x.uid))
    const rendered = e.filter(x => x.kind === 'node' && ids.has(x.uid)).length
    const topRendered = e.filter(x => x.kind === 'node' && x.path.length === 1).length
    check('状态 ' + k + '：顶层互斥分支恰好渲染一个（门槛链没被改成并存）', topRendered === 1,
      'rendered=' + topRendered + ' total=' + rendered)
  })

  // 日期控件与提醒按钮的可达状态 == 「denied / loading 之外恒可见」
  const pickerOf = e => nodesTagged(e, 'picker').filter(n => attrOf(n, 'mode') === 'date')
  const draftBtn = e => textsWith(e, '生成天气提醒草稿')
  Object.keys(byState).forEach(k => {
    const e = byState[k]
    const expect = DATA_STATES.indexOf(k) !== -1 || k === 'loadingWeather'
    check('状态 ' + k + '：查看日期 picker 的可见性与「denied/loading 之外恒可见」一致',
      (pickerOf(e).length === 1) === expect, '实际 ' + pickerOf(e).length + ' 个，应为 ' + (expect ? 1 : 0))
    const ownerExpect = expect && WEATHER_STATES[k].isOwner === true
    check('状态 ' + k + '：提醒草稿按钮仍只由 isOwner 决定（没顺手加/去可见条件）',
      (draftBtn(e).length >= 1) === ownerExpect, '实际=' + draftBtn(e).length + ' isOwner=' + WEATHER_STATES[k].isOwner)
  })

  const e = byState.data
  const picker = pickerOf(e)[0]
  const strip = entriesWithClass(e, 'day-strip')[0]
  const chart = entriesWithClass(e, 'cloud-field-card')[0]
  const upd = textsWith(e, '更新时间：')[0]
  const prov = textsWith(e, '数据来源')[0]
  check('日期控件确实与它控制的内容同区且在图表之前（原来在最末端）',
    !!picker && !!strip && !!chart && picker.order < strip.order && picker.order < chart.order,
    'picker=' + (picker && picker.order) + ' strip=' + (strip && strip.order) + ' chart=' + (chart && chart.order))
  check('日期控件排在出处脚注之前（脚注不再是控件的邻居）',
    !!picker && !!prov && picker.order < prov.order,
    'picker=' + (picker && picker.order) + ' 脚注=' + (prov && prov.order))
  check('脚注仍在页面最后（更新时间 → 数据来源的次序未改）',
    !!upd && !!prov && upd.order < prov.order, 'upd=' + (upd && upd.order) + ' prov=' + (prov && prov.order))

  // 移动块不得改块内文案 / 事件归属
  const formField = nodesTagged(e, 'form-field').filter(n => attrResolved(n, 'label') === '查看日期')[0]
  check('块内文案一字未改：label 仍是「查看日期」', !!formField)
  check('picker 的 value 仍绑定当前日期、bindchange 仍是 onDate（没改事件归属）',
    !!picker && attrResolved(picker, 'value') === DAY0 && attrOf(picker, 'bindchange') === 'onDate',
    picker && (attrResolved(picker, 'value') + '/' + attrOf(picker, 'bindchange')))
  check('提醒草稿按钮文案一字未改且 handler 仍是 onDraftNotice',
    (() => {
      const t = textsWith(e, '生成天气提醒草稿')[0]
      if (!t) return false
      const owner = e.filter(x => x.kind === 'node' && x.uid === t.path[t.path.length - 1])[0]
      return !!owner && renderedText(t) === '生成天气提醒草稿' &&
        attrResolved(owner, 'class').indexOf('secondary') !== -1 && attrOf(owner, 'bindtap') === 'onDraftNotice'
    })(), '')
  /* 许可与出处必须仍在同一条脚注里。括号形状不是契约：URL 也放在同一对括号内时，
     `（CC BY 4.0）` 这种带括号的精确串会假红，而真正要守的是署名文本本身。 */
  check('脚注原文未回退（CC BY 4.0 署名与「本机按坐标与海拔推算」仍在）',
    !!prov && renderedText(prov).indexOf('CC BY 4.0') !== -1 && renderedText(prov).indexOf('本机按坐标与海拔推算') !== -1,
    prov && renderedText(prov))
  check('切日入口没有变多：mode="date" 的 picker 全页恰好一个',
    pickerOf(e).length === 1, String(pickerOf(e).length))
  const mete = nodesTagged(e, 'meteogram').filter(n => attrOf(n, 'bind:pickhour'))
  check('图上点小时仍只做选中（bind:pickhour 仍指向 onChartPickHour，没有新增第二个切日入口）',
    mete.length === 0 || mete.every(n => attrOf(n, 'bind:pickhour') === 'onChartPickHour'), '')

  // 渲染门槛链的其余承重关系（不许因移动块而变）
  // status-panel 的标题是**属性**不是文本节点，所以要按属性求值来查（按文本查就是恒 0 的假绿）。
  const panels = e2 => nodesTagged(e2, 'status-panel').map(n => ({ node: n, kind: attrResolved(n, 'kind'), title: attrResolved(n, 'title') }))
  const lw = byState.loadingWeather
  const lwPanels = panels(lw)
  check('loadingWeather 只出「正在查询天气」面板，不出图表（注入数据看不见图的那条链未被动）',
    lwPanels.length === 1 && lwPanels[0].title === '正在查询天气' &&
    entriesWithClass(lw, 'cloud-field-card').length === 0 && entriesWithClass(lw, 'timeline-card').length === 0,
    'panels=' + JSON.stringify(lwPanels.map(p => p.title)))
  const dn = byState.denied
  const dnPanels = panels(dn)
  check('denied 态除状态面板外不渲染任何卡片（门槛链第一环未动）',
    dnPanels.length === 1 && dnPanels[0].kind === 'denied' && dnPanels[0].title === '无法查看天气参考' &&
    entriesWithClass(dn, 'card').length === 0, JSON.stringify(dnPanels.map(p => p.title)))
  const em = byState.empty
  const emPanels = panels(em)
  check('空态出 status-panel 且出日期控件（改日期仍是出路，不是死页）',
    emPanels.length === 1 && emPanels[0].kind === 'error' && emPanels[0].title === '气象服务暂时连不上' &&
    pickerOf(em).length === 1, JSON.stringify(emPanels.map(p => p.title)))
  check('组织者 + 没有数据这一档里两个控件都在（缺了它，"顺手多加一条可见条件"与现状不可分辨）',
    pickerOf(byState.ownerNoData).length === 1 &&
    textsWith(byState.ownerNoData, '生成天气提醒草稿').length === 1, '')
})

/* ================= §2 A-07 JS 半边：切日之后把图带回视口（真页面驱动） ================= */
async function gateWeatherJs() {
  section('§2 A-07 接线：改日期 ⇒ 主图回到视口（真 weather.js + 真 handler）')
  api = require('../miniprogram/utils/api')
  chartStore = require('../miniprogram/utils/chart-store')
  /* D-10：不再用固定 30ms 猜「页面跑完了没有」。两条真实信号：
     setData 回调计数（applyWeather 的滚动就发生在回调里）+ 在途天气请求计数。
     测试仍按原样给 api 赋值，setter 只负责计数，不改变返回值与异常语义。 */
  let inflight = 0
  function tracked(fn) {
    return function () {
      inflight++
      let p
      try { p = Promise.resolve(fn.apply(this, arguments)) } catch (e) { inflight--; throw e }
      p.then(() => { inflight-- }, () => { inflight-- })
      return p
    }
  }
  ;['getWeather', 'getWeatherByPoint'].forEach(key => {
    let impl = tracked(api[key])
    Object.defineProperty(api, key, {
      configurable: true,
      get: () => impl,
      set: fn => { impl = typeof fn === 'function' ? tracked(fn) : fn },
    })
  })
  const PAGE_PATH = require.resolve(WEATHER_JS)
  function pageConfig() {
    global.Page = cfg => { global.__P2_PAGE = cfg }
    delete require.cache[PAGE_PATH]
    require(PAGE_PATH)
    return global.__P2_PAGE
  }
  function makePage(cfg) {
    const page = Object.assign({}, cfg)
    page.data = JSON.parse(JSON.stringify(cfg.data || {}))
    page._patches = []
    page._pendingCbs = 0
    page.setData = function (patch, cb) {
      this._patches.push(patch)
      Object.assign(this.data, patch)
      if (!cb) return
      this._pendingCbs++
      setImmediate(() => {
        try { cb() } finally { this._pendingCbs-- }
      })
    }
    return page
  }
  function stubWx(rects, opts) {
    opts = opts || {}
    const rec = { queries: [], scrolls: [], throws: 0 }
    const store = {}
    global.wx = {
      getStorageSync: k => (k in store ? store[k] : ''),
      setStorageSync: (k, v) => { store[k] = v },
      removeStorageSync: k => { delete store[k] },
      showToast: () => {},
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 667 }),
      createSelectorQuery: () => {
        const q = {
          in() { return q },
          select(s) { rec._s = s; rec.queries.push(s); return q },
          boundingClientRect(cb) { rec._cb = cb; return q },
          exec() {
            const rect = rects[rec._s]
            if (rect === undefined || rect === null) { if (rec._cb) rec._cb(null) } else if (rec._cb) rec._cb(rect)
            return q
          },
        }
        return q
      },
      pageScrollTo(o) { rec.scrolls.push(o); if (opts.scrollThrows) { rec.throws++; throw new Error('scroll boom') } },
      navigateTo: () => {},
    }
    return rec
  }
  function freshPage(rec) {
    const cfg = pageConfig()
    const page = makePage(cfg)
    page.mode = 'activity'
    page.activityId = 'a1'
    page.revision = 3
    page.data.date = DAY0
    page.data.pointIndex = 0
    page.view = { activity: { routeSnapshot: { points: [{ id: 'p1', name: '冷杉坪', coordinates: COORD }] } } }
    page._localPoints = []
    return page
  }
  function series(from, days) {
    const out = []
    for (let i = 0; i < days * 24; i++) {
      out.push({
        d: addDays(from, Math.floor(i / 24)), t: String(i % 24).padStart(2, '0') + ':00',
        temp: 11, pop: 10, precip: 0, showers: 0, code: 2, wind: 7, gust: 12, rh: 62, uv: 3,
        pressure: 650, visibility: 24, dewPoint: 2, cloud: { low: 20, mid: 30, high: 30 }, band: null,
      })
    }
    return out
  }
  function days(from, n) {
    const out = []
    for (let i = 0; i < n; i++) out.push({ date: addDays(from, i), code: 2, tMax: 18, tMin: 6, precipProbMax: 20, cloud: { low: 20, mid: 30, high: 30 } })
    return out
  }
  function okResult(from) {
    // status:'ready' 是生产返回体的必备键：缺了它，真页面会走「瞬时故障 ⇒ 自动重试」那条路，
    // 测试就会在 1200ms 的重试间隔外读到半成品状态（本轮第一次就是这么假红的）。
    return { status: 'ready', series: series(from, 7), days: days(from, 7), updatedAt: from + 'T07:00:00+08:00', pointElevation: 3500 }
  }
  /* 等「页面自己排的回调 + 在途请求」全部归零，而不是猜一个 30ms：
     applyWeather 的滚动发生在 setData 回调里，中间隔着一轮 Promise 与可能较重的同步装配；
     负载高时固定 30ms 会先到点（历史读数 98/0 与 95/2 交替）。
     判据是连续两轮 setImmediate 都无待跑回调且在途请求为 0；回调里再 setData/再请求都会把计数加回去。 */
  async function settle(page) {
    // 超时只防死锁，不是等待时长：计数器归零即返回；用墙钟是因为 setImmediate 空转几百轮
    // 可能还不到一个 80ms 定时器（D-10 自证用例就是这么撞出来的）。
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      await new Promise(r => setImmediate(r))
      if (page._pendingCbs === 0 && inflight === 0) {
        await new Promise(r => setImmediate(r))
        if (page._pendingCbs === 0 && inflight === 0) return
      }
    }
    throw new Error('settle 超时：pendingCbs=' + page._pendingCbs + ' inflight=' + inflight)
  }

  // —— 等待机制自身的牙齿（D-10）：80ms 迟到的响应，旧 30ms 读数读不到滚动，新信号必须读到
  {
    const rec = stubWx({ '.timeline-card': { top: 5000 } })
    const page = freshPage(rec)
    api.getWeather = () => new Promise(r => setTimeout(() => r(okResult(DAY0)), 80))
    api.getWeatherByPoint = api.getWeather
    chartStore.clear()
    page.onDate({ detail: { value: DAY0 } })
    await new Promise(r => setTimeout(r, 30))
    const early = rec.scrolls.length
    await settle(page)
    check('等待信号有牙齿：响应迟到 80ms 时，固定 30ms 读不到滚动，回调+在途计数读到',
      early === 0 && rec.scrolls.length === 1 && rec.scrolls[0].selector === '.timeline-card',
      'early=' + early + ' settled=' + JSON.stringify(rec.scrolls))
    check('等待结束后 setData 回调归零（信号不是一次性的假闩）', page._pendingCbs === 0,
      'pendingCbs=' + page._pendingCbs)
  }

  // —— 单元层：ensureMeteogramVisible 的分支选择与静默降级
  {
    const rec = stubWx({ '.cloud-field-card': { top: 5000, width: 300 } })
    const page = freshPage(rec)
    page.data.dayCards = [{ date: DAY0 }]
    page.data.unified = { src: 'x' }
    page.ensureMeteogramVisible()
    check('统一图在屏 ⇒ 滚向 .cloud-field-card',
      rec.queries.length === 1 && rec.queries[0] === '.cloud-field-card' && rec.scrolls.length === 1 && rec.scrolls[0].selector === '.cloud-field-card',
      JSON.stringify(rec.queries) + '/' + JSON.stringify(rec.scrolls))
  }
  {
    const rec = stubWx({ '.timeline-card': { top: 5000, width: 300 } })
    const page = freshPage(rec)
    page.data.dayCards = [{ date: DAY0 }]
    page.data.unified = null
    page.ensureMeteogramVisible()
    check('回退经典 canvas ⇒ 滚向 .timeline-card（原先这一支直接 early return，切日停在页尾）',
      rec.queries.length === 1 && rec.queries[0] === '.timeline-card' && rec.scrolls.length === 1 && rec.scrolls[0].selector === '.timeline-card',
      JSON.stringify(rec.queries) + '/' + JSON.stringify(rec.scrolls))
  }
  {
    const rec = stubWx({})
    const page = freshPage(rec)
    page.data.dayCards = []
    page.data.unified = null
    page.ensureMeteogramVisible()
    check('没有图（空态/loadingWeather）⇒ 一条查询都不发（不滚向不在屏的对象）',
      rec.queries.length === 0 && rec.scrolls.length === 0, JSON.stringify(rec.queries))
  }
  {
    const rec = stubWx({ '.timeline-card': { top: 100, width: 300 } })
    const page = freshPage(rec)
    page.data.dayCards = [{ date: DAY0 }]
    page.ensureMeteogramVisible()
    check('图已在视口内 ⇒ 不滚（增强不是硬跳）', rec.scrolls.length === 0, JSON.stringify(rec.scrolls))
  }
  {
    const rec = stubWx({ '.timeline-card': null })
    const page = freshPage(rec)
    page.data.dayCards = [{ date: DAY0 }]
    let escaped = false
    try { page.ensureMeteogramVisible() } catch (e) { escaped = true }
    check('rect 读不到 ⇒ 不滚也不抛（滚动是增强不是功能依赖）', !escaped && rec.scrolls.length === 0, '')
  }
  {
    const rec = stubWx({ '.timeline-card': { top: 5000 } }, { scrollThrows: true })
    const page = freshPage(rec)
    page.data.dayCards = [{ date: DAY0 }]
    let escaped = false
    try { page.ensureMeteogramVisible() } catch (e) { escaped = true }
    check('pageScrollTo 自己抛错也被吞掉（失败静默，不阻断链路）', !escaped && rec.throws === 1, '')
  }

  // —— 链路层：真 handler ⇒ 真 fetch ⇒ 真 applyWeather ⇒ 恰一次滚动
  {
    const rec = stubWx({ '.timeline-card': { top: 5000 } })
    const page = freshPage(rec)
    let called = 0
    api.read = () => Promise.resolve({ view: { kind: 'activity', activity: { id: 'a1', title: 't', phase: 'active', routeSnapshot: { points: [{ id: 'p1', name: '冷杉坪', coordinates: COORD }] } } }, revision: 3, now: '' })
    api.getWeather = (activityId, pointId, date) => { called++; return Promise.resolve(okResult(date)) }
    api.getWeatherByPoint = () => Promise.resolve(okResult(DAY0))
    chartStore.clear()
    page.data.dayCards = []
    page.onDate({ detail: { value: addDays(DAY0, 3) } })
    await settle(page)
    check('onDate 之后取了一次天气（没被滚动打断）', called === 1, String(called))
    check('改日期 ⇒ 恰一次 pageScrollTo（不新造第二套滚动状态）',
      rec.scrolls.length === 1 && rec.scrolls[0].selector === '.timeline-card', JSON.stringify(rec.scrolls))
    check('数据真的落到页面（图与卡非空，滚动才有意义）',
      page.data.dayCards.length === 7 && (page._chartSeries || []).length === 168,
      page.data.dayCards.length + '/' + (page._chartSeries || []).length)
    check('一次性闩已消费（不留挂起）', page._revealChartAfterApply === false, String(page._revealChartAfterApply))
    /* 页面重量：7 天 168 小时序列只活在实例上。WXML 没有任何 {{chartSeries}}，
       进了 data 就是白付一次 setData 序列化。 */
    check('168 小时序列不进入 setData（this._chartSeries 持有）',
      page.data.chartSeries === undefined && page._chartSeries.length === 168,
      String(page.data.chartSeries && page.data.chartSeries.length))
  }
  {
    const rec = stubWx({ '.timeline-card': { top: 5000 } })
    const page = freshPage(rec)
    api.getWeather = () => Promise.resolve(okResult(DAY0))
    api.getWeatherByPoint = () => Promise.resolve(okResult(DAY0))
    chartStore.clear()
    page.data.date = DAY0
    page.fetchWeather()
    await settle(page)
    check('阳性对照：不改日期的取数（首屏/重新查询）不滚 —— 红则说明改成无条件滚了',
      page.data.dayCards.length === 7 && rec.scrolls.length === 0, JSON.stringify(rec.scrolls))
  }
  {
    const rec = stubWx({ '.timeline-card': { top: 5000 } })
    const page = freshPage(rec)
    let called = 0
    api.getWeather = (a, p, date) => { called++; return Promise.reject(new Error('服务挂了')) }
    chartStore.clear()
    page.onDate({ detail: { value: addDays(DAY0, 5) } })
    await settle(page)
    check('改日 + 取数失败 ⇒ 不滚（没有图可滚）', rec.scrolls.length === 0, JSON.stringify(rec.scrolls))
    check('失败即作废挂起的复位承诺（不漏到下一次无关刷新）',
      page._revealChartAfterApply === false, String(page._revealChartAfterApply))
    api.getWeather = (a, p, date) => Promise.resolve(okResult(date))
    page.fetchWeather()
    await settle(page)
    check('下一次非改日期的成功刷新仍然不滚（承诺不会迟到发作）',
      page.data.dayCards.length === 7 && rec.scrolls.length === 0, JSON.stringify(rec.scrolls))
    check('（旁证）这次刷新确实成功过', called >= 1, String(called))
  }
  {
    const rec = stubWx({ '.timeline-card': { top: 5000 } })
    const page = freshPage(rec)
    let called = 0
    api.getWeather = (a, p, date) => { called++; return Promise.resolve(okResult(date)) }
    chartStore.clear()
    page.data.dayCards = fixtureDayCards(7)
    page.data.dayCards[0].date = DAY0
    page.onDayTap({ currentTarget: { dataset: { date: DAY0 } } })
    await settle(page)
    check('点日条里已选中的那天 ⇒ 早退：不取数也不滚（没多出一条空操作）',
      called === 0 && rec.scrolls.length === 0, called + '/' + JSON.stringify(rec.scrolls))
    page.onDayTap({ currentTarget: { dataset: { date: addDays(DAY0, 2) } } })
    await settle(page)
    check('点日条换到另一天 ⇒ 恰一次复位滚动（与 picker 同一条承诺）',
      rec.scrolls.length === 1 && rec.scrolls[0].selector === '.timeline-card', JSON.stringify(rec.scrolls))
  }
  {
    const rec = stubWx({ '.cloud-field-card': { top: 5000 } })
    const page = freshPage(rec)
    const withCloud = okResult(addDays(DAY0, 1))
    // 云场返回体的真实形状：result.cloudLevels = { times[], levels[{altitudes[], cloudCover[]}] }
    // （不是逐小时的 h.cloudLevels —— 那种写法 buildCloudFieldRange 直接返回 null，
    //   于是"统一图分支"根本没被跑过，判据就成了空转。）
    const times = []
    for (let i = 0; i < 24; i++) times.push(addDays(DAY0, 1) + 'T' + String(i).padStart(2, '0') + ':00')
    withCloud.cloudLevels = {
      times,
      levels: [
        { altitudes: times.map(() => 1500), cloudCover: times.map(() => 90) },
        { altitudes: times.map(() => 3000), cloudCover: times.map(() => 20) },
        { altitudes: times.map(() => 5000), cloudCover: times.map(() => 5) },
      ],
    }
    api.getWeather = (a, p, date) => Promise.resolve(date === addDays(DAY0, 1) ? withCloud : okResult(date))
    chartStore.clear()
    page.data.dayCards = []
    page.onDate({ detail: { value: addDays(DAY0, 1) } })
    await settle(page)
    const gotUnified = !!page.data.unified
    check('云场夹具真的造出了 unified（否则这一支根本没跑，判据是空转）', gotUnified,
      'unified=' + JSON.stringify(!!page.data.unified) + ' emptyTitle=' + JSON.stringify(page.data.emptyTitle))
    check('统一图在屏时改日期 ⇒ 滚向 .cloud-field-card（同一助手，锚点由 data 选，不写死两处）',
      gotUnified && rec.scrolls.length === 1 && rec.scrolls[0].selector === '.cloud-field-card',
      JSON.stringify(rec.scrolls))
    check('两条分支互斥：这次只查在屏的那个锚点，没有去查另一条分支的 .timeline-card',
      gotUnified && rec.queries.indexOf('.timeline-card') === -1 &&
      rec.queries.filter(q => q === '.cloud-field-card').length === 1, JSON.stringify(rec.queries))
  }
}

/* ================= §3 A-23：观察点卡的横向留白回到单源 ================= */
section('§3 A-23：观察点卡内缩 = 同页兄弟卡，且由 .card 一处承载')
guarded('§3', () => {
  const appRules = parseSheet(src(APP_WXSS))
  const hubRules = parseSheet(src(HUB_WXSS))
  const sheets = [appRules, hubRules]
  const e = render(src(HUB_WXML), hubData())
  const { gpx, pts, trk } = hubCards(e)
  check('三张卡都按结构认到了（GPX/观察点/轨迹点组；认不到就是判据没有输入）',
    !!gpx && !!pts && !!trk, JSON.stringify([!!gpx, !!pts, !!trk]))
  const gi = insetOf(gpx, sheets)
  const pi = insetOf(pts, sheets)
  const ti = insetOf(trk, sheets)
  check('观察点卡与 GPX 卡的左右内缩逐值相同（同屏两张卡不再不一致）',
    pi.left === gi.left && pi.right === gi.right, 'pts=' + pi.left + '/' + pi.right + ' gpx=' + gi.left + '/' + gi.right)
  check('观察点卡与轨迹点组卡也相同（本页没有第四种形态）',
    pi.left === ti.left && pi.right === ti.right, 'trk=' + ti.left + '/' + ti.right)
  check('内缩是正数（原来被内联 padding 归零 ⇒ 文字贴圆角边）',
    Number.isFinite(pi.left) && pi.left > 0 && Number.isFinite(pi.right) && pi.right > 0, 'left=' + pi.left + ' right=' + pi.right)
  check('留白确实来自 app.wxss 的 .card 一处（赢家不是内联、也不是页内重印）',
    pts.node.attrs.style === undefined && pi.winnerLeft === '.card@sheet0',
    'winner=' + pi.winnerLeft + ' inline=' + JSON.stringify(pts.node.attrs.style))
  check('卡内直接子元素自己不带左右 padding（"靠 .card 一处给留白"这条前提成立）',
    (() => {
      const header = within(e, pts).filter(x => hasClass(x, 'card-header'))[0]
      const row = within(e, pts).filter(x => hasClass(x, 'list-row'))[0]
      if (!header || !row) return false
      const free = v => !Number.isFinite(v.left) || v.left === 0
      const freeRight = v => !Number.isFinite(v.right) || v.right === 0
      return [insetOf(header, sheets), insetOf(row, sheets)].every(v => free(v) && freeRight(v))
    })(), '')
  // 影子改写（铁律 31③）：单源必须是"改得动"的
  {
    // 影子必须同时覆盖 padding 简写与 longhand 两种合法写法，否则"把简写拆成四条写"这种
    // 等价重构会让影子静默失效（本轮 P26 第一次就是这么误伤的）。
    const SHADOW = '24px'
    const shadow = appRules.map(r => ({
      sel: r.sel,
      decls: r.decls.map(d => (r.sel === '.card' && /^padding(-top|-right|-bottom|-left)?$/.test(d.prop) && /px$/i.test(d.value)
        ? Object.assign({}, d, { value: SHADOW }) : d)),
    }))
    const shSheets = [shadow, hubRules]
    const c2 = hubCards(render(src(HUB_WXML), hubData()))
    const gi2 = insetOf(c2.gpx, shSheets)
    const pi2 = insetOf(c2.pts, shSheets)
    const ti2 = insetOf(c2.trk, shSheets)
    check('影子把 .card 的横向内缩改成 24px ⇒ 三张卡一起变 24（单源可改写，不是三个巧合的 16）',
      gi2.left === 24 && pi2.left === 24 && ti2.left === 24 && gi2.right === 24 && pi2.right === 24 && ti2.right === 24,
      [gi2.left, pi2.left, ti2.left].join('/'))
    const back = insetOf(hubCards(render(src(HUB_WXML), hubData())).pts, sheets)
    check('还原后逐项相同（影子没有把状态留在别处）',
      back.left === pi.left && back.right === pi.right, back.left + '/' + pi.left)
  }
  check('既有补偿没有被顺手清掉：轨迹组展开区仍是左 16px（同页观感一致的那条旧账）',
    (() => {
      const expanded = within(e, trk).filter(x => hasClass(x, 'stack'))[0]
      if (!expanded) return false
      const v = insetOf(expanded, sheets)
      return v.left === 16 && v.right === 16
    })(), '')
  check('删除按钮与行的事件层级未动：catchtap 仍是 onDeleteTap、行仍是 bindtap onPointTap（padding 改动没碰事件）',
    (() => {
      const row = within(e, pts).filter(x => hasClass(x, 'list-row'))[0]
      if (!row) return false
      const del = within(e, row).filter(x => hasClass(x, 'button'))[0]
      return attrOf(row, 'bindtap') === 'onPointTap' && !!del && attrOf(del, 'catchtap') === 'onDeleteTap'
    })(), '')
})

/* ================= §4 A-24：卡片标题不再逐字重复按钮 ================= */
section('§4 A-24：GPX 卡的标题与按钮不再同文')
guarded('§4', () => {
  const e = render(src(HUB_WXML), hubData())
  const card = hubCards(e).gpx
  check('带 onImportGpx 按钮的那张卡仍按结构认得到（判据输入存在；按文案认卡会在别人改文案时崩红）', !!card, '')
  const header = within(e, card).filter(x => hasClass(x, 'card-label'))[0]
  const btns = within(e, card).filter(x => hasClass(x, 'button'))
  check('卡内那颗按钮的文案一字未改（仍是「导入 GPX 轨迹」）',
    btns.length === 1 && textsWith(within(e, btns[0]), '导入 GPX 轨迹').length === 1, String(btns.length))
  check('按钮 handler 名未改（仍是 onImportGpx，天气 Hub 的入口归属没动）',
    btns.length === 1 && attrOf(btns[0], 'bindtap') === 'onImportGpx', btns[0] && attrOf(btns[0], 'bindtap'))
  const headerText = (() => {
    if (!header) return ''
    const t = within(e, header).filter(x => x.kind === 'text')[0]
    return t ? renderedText(t) : ''
  })()
  check('标题与按钮不再同文（缺陷本体 = 同一串字面文本两种身份）',
    !!header && headerText !== '导入 GPX 轨迹', JSON.stringify(headerText))
  check('标题非空且仍在说这块是干什么的（不是"删掉多余一行"式修法）',
    headerText.length > 0 && headerText.indexOf('GPX') !== -1, JSON.stringify(headerText))
  check('这张卡的可点入口仍只有那一个（没有新增按钮）',
    (() => {
      const taps = within(e, card).filter(x => x.kind === 'node' && (attrOf(x, 'bindtap') || attrOf(x, 'catchtap')))
      return taps.length === 1 && attrOf(taps[0], 'bindtap') === 'onImportGpx'
    })(), '')
  check('按钮仍是 secondary（主行动唯一化：地图选点仍是本页唯一实心按钮，没有升格）',
    btns.length === 1 && attrResolved(btns[0], 'class').indexOf('secondary') !== -1 && attrResolved(btns[0], 'class').indexOf('primary') === -1,
    btns[0] && attrResolved(btns[0], 'class'))
  check('页头那颗实心按钮仍是 onPickMap/primary（我没顺手改主次）',
    (() => {
      const map = nodesTagged(e, 'view').filter(x => attrOf(x, 'bindtap') === 'onPickMap')[0]
      return !!map && attrResolved(map, 'class').indexOf('primary') !== -1
    })(), '')
  // 弹层是关闭态时整个子树不渲染（overlay 语义），所以这一条要拿"打开"的状态读它的 title 属性
  const open = render(src(HUB_WXML), hubData({
    gpxOpen: true,
    gpxMeta: { fileName: 'abc.gpx', count: 3, distanceKm: 5.2, hasElevation: true, ascentM: 400, hasTime: false },
    gpxPoints: [{ name: '起点', coordinates: { lat: 30.1, lng: 103.1 } }],
  }))
  const sheet = nodesTagged(open, 'overlay').filter(n => attrResolved(n, 'title') === '导入 GPX 轨迹')
  check('导入预览弹层打开时标题仍是「导入 GPX 轨迹」（那一处按按钮即弹，标题身份正确，不许被顺手改掉）',
    sheet.length === 1, String(sheet.length))
})

/* ================= §5 A-26：免责从 N+1 处收敛到 1 处 ================= */
section('§5 A-26：逐卡免责已收敛（区块副标题说一次就够）')
guarded('§5', () => {
  const five = render(src(WEATHER_WXML), WEATHER_STATES.data)
  const one = render(src(WEATHER_WXML), WEATHER_STATES.dataClassic)
  /* 2026-10-21 起区块从「户外条件/气象预报」改名为「天相条件」，免责语也随之改成
     「只汇总天相，不是徒步安全评级」——A-26 要守的是“免责只说一次”，不是旧词本身。 */
  const hits5 = textsWith(five, '只汇总天相')
  const hits1 = textsWith(one, '只汇总天相')
  check('5 张结论卡时，「只汇总天相」的边界在页面上恰好出现 1 次（原先是 1+5）',
    hits5.length === 1, String(hits5.length))
  check('1 张结论卡时也恰好 1 次（收敛与卡数无关，不是数出来的巧合）',
    hits1.length === 1, String(hits1.length))
  check('那唯一一次就是「天相条件」区块副标题（不是别处冒出来的）',
    (() => {
      const head = entriesWithClass(five, 'section-head').filter(x => textsWith(within(five, x), '只汇总天相').length)[0]
      return !!head && head.path.length > 0
    })(), '')
  check('每张结论卡内部都不带免责行（按卡作用域逐个查，不是全站总数）',
    (() => {
      const cards = entriesWithClass(five, 'cond-pheno')
      return cards.length === 5 && cards.every(c => textsWith(within(five, c), '只汇总天相').length === 0)
    })(), String(entriesWithClass(five, 'cond-pheno').length))
  // 防误伤：合规话术三处一个都不能少
  check('页首「不是出发许可」的概率声明仍在（合规职责，不能顺手删）',
    (() => {
      const co = entriesWithClass(five, 'callout').filter(x => textsWith(within(five, x), '不是出发许可').length)[0]
      return !!co && textsWith(within(five, co), '概率判断').length === 1
    })(), '')
  check('经典图注「灰底 = 天文暗夜」仍在',
    textsWith(five, '灰底 = 天文暗夜').length + textsWith(one, '灰底 = 天文暗夜').length >= 1, '')
  check('OI 卡图注里「天文时刻为确定性事件」仍在模板中（客观时刻与天气推算的分界句）',
    stripComments(src(WEATHER_WXML)).indexOf('天文时刻为确定性事件') !== -1, '')
  /* 「点按复制数据来源与许可链接」也含“数据来源”四个字；按脚注正文计数，
     否则一行新增的复制入口会把这条门变成“页面只能有一个来源标签”的假契约。 */
  check('出处脚注（Open-Meteo 署名）仍在且只有一条',
    textsWith(five, '本机按坐标与海拔推算').length === 1,
    String(textsWith(five, '本机按坐标与海拔推算').length))
  check('沉默说明卡的判据仍在（不出卡 ≠ 不说明，第十轮的承重设计没被一起清掉）',
    (() => {
      const e = render(src(WEATHER_WXML), baseWeatherData({
        dayCards: fixtureDayCards(7), condCards: fixtureCondCards(2),
        condSilent: { count: 2, titles: '云海、彩虹', text: '这些天相今天条件不成立，就不单独列出：云海、彩虹。' },
      }))
      const card = entriesWithClass(e, 'cond-silent')[0]
      return !!card && textsWith(within(e, card), '条件不成立').length === 1
    })(), '')
  check('结论卡的实质内容一字未减（时间窗/判断/往哪看/建议/依据都还在卡里）',
    (() => {
      const c = entriesWithClass(five, 'cond-pheno')[0]
      const inner = within(five, c)
      return ['pheno-window', 'pheno-text', 'sky-look', 'pheno-advice', 'cond-why'].every(cls => entriesWithClass(inner, cls).length === 1)
    })(), '')
})

/* ================= §6 边界守卫：越界即整批退回的那几条 ================= */
section('§6 边界：写入集与追加条款（M-18 本批只做一半都不算完成）')
{
  const nw = src(NOTICES_WXML)
  const aw = src(ANOTICES_WXML)
  // S4（style-b 批次一，2026-10-26）：通知 Tab 页加了品牌头，并把两个分区头并成一个。
  // 旧断言钉的是「两份 wxml 逐字节相同」——那记录的是 M-18 未修时的形态，不是不变量：
  // 两份页面的**页头身份本来就不同**（notices 是 tab 页、自绘品牌栏；anotices 是原生导航的子页），
  // 合法差异一落地它必然假红（铁律 30：门钉行为，不钉当时长什么样）。
  // 换成钉真正必须同构的那一层：卡片正文、未读标记、分批、发布 sheet 的接线两边一致。
  const bodyAnchors = ['notice-card', 'visibleItems', 'onMarkRead', 'onOpenActivity', 'onCopy',
    'onLoadMore', 'hiddenCount', 'overlay open="{{publishOpen}}"', 'onPublish']
  const missing = bodyAnchors.filter(a => nw.indexOf(a) === -1 || aw.indexOf(a) === -1)
  check('M-18 两份通知页的卡片正文 / 未读标记 / 分批 / 发布接线仍同构（差异只允许在页头）',
    missing.length === 0, '缺锚点：' + missing.join(' '))
  check('品牌头只在 tab 版通知页（anotices 走原生导航，不顶第二条自绘品牌栏）',
    nw.indexOf('<brand-header') !== -1 && aw.indexOf('<brand-header') === -1)
  check('通知页分区头只留一处（旧版「同行消息」+「通知」两个头连出两次「通知」）',
    (nw.match(/class="section-head"/g) || []).length === 1
    && nw.indexOf('同行消息') === -1
    && nw.indexOf('<text class="kicker">通知</text>') !== -1, '')
  const padRe = /padding-bottom:\s*calc\(\s*84px|padding-bottom:\s*calc\(\s*32px\s*\+\s*84px/
  // 旧桩（本文件上一版）写的是「两份通知 wxss 逐字节相同」与「anotices 的 tab 留白原样保留」——
  // 那钉的是 M-18 **未修**的中间态，合法修复一落地就假红（铁律 30：门钉行为，不钉当时长什么样）。
  // 换成按 tab 身份分档的判据：真值源取 app.json 的 tabBar.list，不是我或任何人的印象。
  const tabPages = new Set((JSON.parse(src(P('app.json'))).tabBar || {}).list
    ? JSON.parse(src(P('app.json'))).tabBar.list.map(x => x.pagePath) : [])
  check('tabBar.list 真值源读得出来，且 anotices 确实不在里面',
    tabPages.size === 4 && !tabPages.has('pages/anotices/anotices') && tabPages.has('pages/notices/notices'),
    JSON.stringify([...tabPages]))
  {
    const watch = ['pages/home/home', 'pages/weather-hub/weather-hub', 'pages/notices/notices', 'pages/me/me', 'pages/anotices/anotices']
    const wrong = watch.filter(f => padRe.test(src(P(...f.split('/')) + '.wxss')) !== tabPages.has(f))
    check('84px 留白只出现在 tab 页（M-18 样式半 + 追加 1 的合并判据）',
      wrong.length === 0, '错位页：' + wrong.join(' '))
  }
  // 下面三条读的是**别人的写入集**（app.wxss / home / me / weather.wxss），
  // 本批禁写 ⇒ 只记读数不记判据，否则别的 Agent 在途改动会把本门撞成假红。
  const cross = ['pages/home/home.wxss', 'pages/me/me.wxss', 'pages/weather-hub/weather-hub.wxss', 'pages/notices/notices.wxss', 'pages/anotices/anotices.wxss']
    .filter(f => padRe.test(src(P(...f.split('/')))))
  note('跨页 84px 留白公式当前命中 ' + cross.length + '/5 处：' + cross.join(' '))
  note('app.wxss 的 .tabbar-safe：' + (/\.tabbar-safe\s*\{/.test(src(APP_WXSS)) ? '仍在' : '已被他人删除（与本批追加 1 的裁定冲突，已上报 requests.md）'))
  note('weather.wxss 的 .pheno-disclaimer：' + (src(P('pages', 'weather', 'weather.wxss')).indexOf('.pheno-disclaimer') !== -1 ? '仍在但已无使用者（A-26 删掉的逐卡免责留下的死类，登记 requests 由样式页 owner 收）' : '已被他人收掉'))
  note('M-18 活动身份那一半的状态是 BLOCKED，不是本门放过：anotices 正文要出活动标题，')
  note('  三条路都不在本批写入集内——① 工厂 utils/notices-page.js 参数化页头；② 三个 navigateTo 入边（activity.js:413 / workspace.js:180 / weather.js:1424）传标题；')
  note('  ③ 页面自己补一次 read(kind:activity)，但 tools/scenario-notices-test.js 的 §3 第二条断言「非所有者不读活动判发布权」禁止这条路径，')
  note('     而本批禁写 tools/ 下已存在的文件（详见 out/PAGE2/requests.md）。')
  note('跨版本读数：审计 A-26 原报「四个层级、每卡一份」，HEAD 复量为「气象预报」2 处（区块副标题 + 逐卡一行），已按实测处理，未照抄「4」。')
}

/* ================= 运行 ================= */
async function main() {
  await gateWeatherJs()
  console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
  if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
  process.exit(failed ? 1 : 0)
}
let api = null
let chartStore = null
main().catch(e => {
  console.error('门自身抛错（记为崩红，不算抓到）：' + ((e && e.stack) || e))
  process.exit(3)
})
