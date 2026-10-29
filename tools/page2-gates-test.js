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
const WEATHER_WXSS = P('pages', 'weather', 'weather.wxss')
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
// 计算某个属性的「层叠终值」（同特异度按出现顺序；app.wxss 在前、页级 wxss 在后；内联最高）。
// 只服务于「页级覆盖有没有把方向复位」这类判据——读的是终值，不是文件里出现过什么字样。
function computedOf(entry, prop, sheets) {
  const cls = entry.classes
  const tag = entry.node.tag
  const collected = []
  sheets.forEach((rules, si) => rules.forEach((r, ri) => {
    if (!selMatches(r.sel, cls, tag)) return
    r.decls.forEach(d => {
      if (d.prop === prop) collected.push({ value: d.value, spec: specOf(r.sel), order: si * 1e7 + ri, from: r.sel + '@sheet' + si })
    })
  }))
  const inline = entry.node.attrs && entry.node.attrs.style ? parseDecls(entry.node.attrs.style) : []
  inline.forEach((d, i) => {
    if (d.prop === prop) collected.push({ value: d.value, spec: 1e9, order: i, from: 'inline style' })
  })
  collected.sort((a, b) => (a.spec - b.spec) || (a.order - b.order))
  return collected.length ? collected[collected.length - 1] : null
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
    weatherTab: 'cloud', cloudWindow: 'auto', tabOptions: [{ key: 'hourly', label: '逐时预报' }, { key: 'cloud', label: '云层剖面' }, { key: 'sky', label: '日月天相' }],
    hourOptions: ['00:00'], selectedHourIndex: 0, selectedTime: '00:00', skyInputLoading: false, skyInputNote: '',
    pointCard: null, pointLabels: ['起点'], pointIndex: 0, scheduleBasis: '',
    date: DAY0, isOwner: false, providerLabel: 'Open-Meteo', updatedAt: DAY0 + ' 07:00',
    weatherStale: null, retryNote: '', emptyKind: 'empty', emptyTitle: '', emptyDetail: '',
    dayCards: [], viewSpan: 24, unified: null, oiCard: null, oiHorizon: null, oiMultiDay: [],
    chartView: [], chartMarks: {}, chartNight: {}, chartSelected: {}, chartElev: null, chartNow: null,
    chartPick: null, hourChip: null, agenda: [], callouts: [], detailRows: [], showDetail: false,
    // 2026-10-26 style-B 4：图上方逐时摘要带 / 图下降水概率行 / 详细数据四行。
    // 默认给空数组是**页面 data 的缺省值**（else 语法求值会因 undefined.length 抛错，
    // 被「表达式求值得动」那条门判成假绿）；下面 data / dataClassic 两档再填真形状，让新块真的渲染。
    hourStrip: [], popShown: false, briefRows: [],
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
    // 24h 窗：3 小时一格 × 8 列（与 buildHourStrip 的步长一致），pop 全有值 ⇒ 概率行出现
    hourStrip: [0, 3, 6, 9, 12, 15, 18, 21].map(hh => ({
      k: '2026-10-20T' + (hh < 10 ? '0' : '') + hh + ':00',
      t: (hh < 10 ? '0' : '') + hh + ':00',
      phrase: { label: hh % 6 === 0 ? '多云' : '晴', tone: hh % 6 === 0 ? 'warning' : 'success' },
      temp: (6 + hh) + '°',
      pop: (hh * 2) + '%',
    })),
    popShown: true,
    briefRows: [
      { k: '温度', v: '6 – 16°C' }, { k: '降水量', v: '0 – 2.4 mm/h' },
      { k: '风速', v: '2 – 6 km/h' }, { k: '云量', v: '30 – 80%' },
    ],
    isOwner: true,
  }),
  dataClassic: baseWeatherData({ weatherTab: 'hourly',
    dayCards: fixtureDayCards(7), unified: null, oiCard: null,
    condCards: fixtureCondCards(1), hourChip: { t: '08:00', phrase: { label: '晴' }, temp: 10, feels: 9, pop: 10, precip: 0, wind: 7, windDir: '北', rh: 60, pressure: '812', band: '2400–2600 m', tags: ['云海窗口'], inCloud: false },
    // 经典分支也铺一份：48h 窗 6 小时一格 × 2 列，其中一格缺概率 ⇒ 印「—」，整行仍在
    hourStrip: [
      { k: '2026-10-20T00:00', t: '00:00', phrase: { label: '晴', tone: 'success' }, temp: '8°', pop: '10%' },
      { k: '2026-10-20T06:00', t: '06:00', phrase: { label: '多云', tone: 'warning' }, temp: '7°', pop: '—' },
    ],
    popShown: true,
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
    plans: [{ id: 'plan1', name: '两日行程', startDate: DAY0, visits: [{}, {}] }], recent: [], routes: [], routeOpen: false, routeLoading: false, routeError: '', busy: false, error: '', manualEditId: '',
    manualOpen: false, manual: { name: '', lat: '', lng: '', ele: '', wgs: false }, manualError: '',
    gpxOpen: false, gpxError: '', gpxMeta: null, gpxPoints: [],
    deleteOpen: false, deleteInfo: { type: 'point', id: '', name: '' },
  }, over || {})
}

/* ================= §0 有效性门（本门不是空转） ================= */
function resetUnresolvable() { unresolvable = [] }
section('§0 新架构有效性：三标签互斥，夹具无求值失败')
const datePickers = entries => nodesTagged(entries, 'picker').filter(node => attrOf(node, 'mode') === 'date')
const viewFor = (tab, overrides) => render(src(WEATHER_WXML), Object.assign({}, WEATHER_STATES.data, { weatherTab: tab }, overrides))
for (const tab of ['cloud', 'hourly', 'sky']) {
  resetUnresolvable()
  const entries = viewFor(tab)
  check(tab + '：七日条与三个标签始终可达', entriesWithClass(entries, 'day-card').length === 7 && entriesWithClass(entries, 'seg').length === 3)
  check(tab + '：只在云层标签显示剖面', entriesWithClass(entries, 'cloud-field-card').length === (tab === 'cloud' ? 1 : 0))
  check(tab + '：只在逐时标签显示 canvas', nodesTagged(entries, 'meteogram').length === (tab === 'hourly' ? 1 : 0))
  check(tab + '：只在日月标签显示结论卡', entriesWithClass(entries, 'cond-pheno').length === (tab === 'sky' ? 5 : 0))
  check(tab + '：输入表达式无求值失败', unresolvable.length === 0, unresolvable.join(' / '))
  check(tab + '：不显示空的沿途模块', textsWith(entries, '沿途天气').length === 0)
}
section('§1 日期、权限、加载、空态和出处')
for (const state of Object.keys(WEATHER_STATES)) {
  resetUnresolvable()
  const entries = render(src(WEATHER_WXML), WEATHER_STATES[state])
  const accessible = state !== 'denied' && state !== 'loading'
  check(state + '：顶部状态分支互斥', entries.filter(entry => entry.kind === 'node' && entry.path.length === 1).length === 1)
  check(state + '：浏览日期在加载天气与空态仍可更换', datePickers(entries).length === (accessible ? 1 : 0))
  check(state + '：提醒按钮仍由组织者权限控制', textsWith(entries, '生成天气提醒草稿').length === (accessible && WEATHER_STATES[state].isOwner ? 1 : 0))
  check(state + '：无求值失败', unresolvable.length === 0, unresolvable.join(' / '))
}
{
  const entries = viewFor('cloud')
  const picker = datePickers(entries)[0]
  const chart = entriesWithClass(entries, 'cloud-field-card')[0]
  check('日期在图表之前，且明确不修改行程', picker.order < chart.order && textsWith(entries, '浏览日期（不修改行程）').length === 1)
  check('日期值和事件接线不变', attrResolved(picker, 'value') === DAY0 && attrOf(picker, 'bindchange') === 'onDate')
  check('来源与许可真实保留且只一处', textsWith(entries, 'CC BY 4.0').length === 1 && textsWith(entries, '本机按坐标计算').length === 1)
  check('出行安全声明不因切标签被删除', ['cloud', 'hourly', 'sky'].every(tab => textsWith(viewFor(tab), '不是出发许可').length === 1))
  const missing = viewFor('cloud', { unified: null })
  check('缺云层数据显式空态，不自动转画晴空', nodesTagged(missing, 'status-panel').some(node => attrResolved(node, 'title') === '这次没有可用云层剖面') && !entriesWithClass(missing, 'cloud-field-card').length)
  const noWeather = render(src(WEATHER_WXML), WEATHER_STATES.empty)
  check('天气失败可重试且可改日期', nodesTagged(noWeather, 'status-panel').some(node => attrOf(node, 'bind:action') === 'fetchWeather') && datePickers(noWeather).length === 1)
}

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
    page.data.weatherTab = 'hourly'
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
    page.data.weatherTab = 'cloud'
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
    page.data.weatherTab = 'cloud'
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

section('§3 常用地点、路线、行程分类与样式单源')
{
  resetUnresolvable()
  const entries = render(src(HUB_WXML), hubData())
  check('两个查询场景与三类已存资产分开', entriesWithClass(entries, 'weather-entry').length === 2 && entriesWithClass(entries, 'card').length === 3)
  check('首页夹具无表达式失败', unresolvable.length === 0, unresolvable.join(' / '))
  const handlers = entries.filter(entry => entry.kind === 'node').map(entry => attrOf(entry, 'bindtap'))
  check('地图、坐标、轨迹、路线库均有入口', ['onPickMap', 'onManualOpen', 'onImportGpx', 'onRouteLibrary'].every(handler => handlers.includes(handler)))
  check('轨迹直接查沿途，常用地点直接查点位，计划单独打开', ['onTrackWeather', 'onPointTap', 'onPlan'].every(handler => handlers.includes(handler)))
  check('原型云同步没有冒充已落地', textsWith(entries, '天气资产云同步尚未接入').length === 1)
  const appRules = parseSheet(src(APP_WXSS))
  const hubRules = parseSheet(src(HUB_WXSS))
  const cards = entriesWithClass(entries, 'card')
  const paddings = cards.map(card => insetOf(card, [appRules, hubRules]))
  check('三类资产卡横向留白由全局 card 单源提供', paddings.every(value => value.left > 0 && value.left === paddings[0].left && value.right === paddings[0].right && value.winnerLeft === '.card@sheet0'))
  const shadow = appRules.map(rule => ({ sel: rule.sel, decls: rule.decls.map(decl => rule.sel === '.card' && /^padding(-top|-right|-bottom|-left)?$/.test(decl.prop) && /px$/i.test(decl.value) ? Object.assign({}, decl, { value: '24px' }) : decl) }))
  check('影子修改全局 padding 时三类卡片同步变化', cards.every(card => { const value = insetOf(card, [shadow, hubRules]); return value.left === 24 && value.right === 24 }))
  const empty = render(src(HUB_WXML), hubData({ points: [], tracks: [], plans: [] }))
  check('无保存资产不是空白页，给出查询后主动保存的出路', entriesWithClass(empty, 'card').length === 0 && nodesTagged(empty, 'status-panel').some(node => attrResolved(node, 'detail').includes('主动保存')))
  const recent = render(src(HUB_WXML), hubData({ recent: [{ id: 'recent1', name: '最近地点', lat: 30, lng: 103 }] }))
  check('最近查询独立展示且声明不上传不收藏', textsWith(recent, '不代表已收藏，也不会上传').length === 1)
  const preview = render(src(HUB_WXML), hubData({ gpxOpen: true, gpxMeta: { fileName: 'test.gpx', count: 2 }, gpxPoints: [{ name: '起点', coordinates: COORD }, { name: '终点', coordinates: COORD }] }))
  check('GPX 预览有独立核对标题和保存动作', nodesTagged(preview, 'overlay').some(node => attrResolved(node, 'title') === '核对轨迹关键节点') && textsWith(preview, '保存轨迹，查看沿途天气').length === 1)
  check('GPX 原文件本机保存边界明确', textsWith(preview, '不会上传原文件').length === 1)
}
section('§4 逐时、云层、日月读数契约')
{
  const skyEntries = viewFor('sky')
  const hourlyEntries = viewFor('hourly')
  const cloudEntries = viewFor('cloud')
  check('五卡与一卡免责都仅一处', [5, 1].every(count => textsWith(viewFor('sky', { condCards: fixtureCondCards(count) }), '只汇总天相').length === 1))
  check('结论卡实质内容完整且无逐卡免责', entriesWithClass(skyEntries, 'cond-pheno').every(card => {
    const inner = within(skyEntries, card)
    return ['pheno-window', 'pheno-text', 'sky-look', 'pheno-advice', 'cond-why'].every(className => entriesWithClass(inner, className).length === 1) && !textsWith(inner, '只汇总天相').length
  }))
  const pills = entriesWithClass(skyEntries, 'cond-pill')
  check('总评一次，五个摘要与结论卡同源', entriesWithClass(skyEntries, 'cond-card').length === 1 && pills.length === 5 && pills.every((pill, index) => within(skyEntries, pill).filter(entry => entry.kind === 'text').map(renderedText).join('') === WEATHER_STATES.data.condCards[index].title + WEATHER_STATES.data.condCards[index].stars))
  const grade = entriesWithClass(skyEntries, 'cond-grade')[0]
  check('星串评级使用 view 容器与两个独立 text', grade.node.tag === 'view' && within(skyEntries, grade).filter(entry => entry.kind === 'node' && entry.node.tag === 'text').length === 2)
  const silent = viewFor('sky', { condCards: [], condSilent: { text: '这些天相今天条件不成立，就不单独列出：云海、彩虹。' } })
  check('沉默有说明而无空详解标题', entriesWithClass(silent, 'cond-silent').length === 1 && textsWith(silent, '天相详解').length === 0)
  check('天文确定性与天气推算的边界未删除', stripComments(src(WEATHER_WXML)).includes('天文时刻为确定性事件'))
  const sheets = [parseSheet(src(APP_WXSS)), parseSheet(src(WEATHER_WXSS))]
  const actionHeads = entriesWithClass(hourlyEntries, 'has-action')
  check('带操作区头保持横排', actionHeads.length === 2 && actionHeads.every(head => computedOf(head, 'flex-direction', sheets).value === 'row'))
  const plainHeads = entriesWithClass(skyEntries, 'section-head')
  check('非操作区头仍保持竖排', plainHeads.length > 0 && plainHeads.every(head => computedOf(head, 'flex-direction', sheets).value === 'column'))
  check('逐时概要四指标默认可读，全表默认折叠', entriesWithClass(hourlyEntries, 'fact-row').length === 4 && !entriesWithClass(hourlyEntries, 'num-sheet').length && entriesWithClass(viewFor('hourly', { showDetail: true }), 'num-sheet').length === 1)
  const summary = entriesWithClass(hourlyEntries, 'brief-rows')[0]
  check('概要温度降水风云各自一行', ['温度', '降水量', '风速', '云量'].every(label => textsWith(within(hourlyEntries, summary), label).length === 1))
  for (const tab of ['hourly', 'cloud']) {
    const entries = viewFor(tab)
    const columns = entriesWithClass(entries, 'hour-strip__item')
    check(tab + '：八列摘要按跨日唯一键渲染', columns.length === 8 && columns.every(column => attrOf(column, 'wx:key') === 'k'))
    check(tab + '：概率行与摘要同列且缺数据可隐藏', entriesWithClass(entries, 'pop-strip__v').length === 8 && !entriesWithClass(viewFor(tab, { popShown: false }), 'pop-strip').length)
    check(tab + '：不依赖拖动也可逐时切换', nodesTagged(entries, 'view').filter(node => attrOf(node, 'bindtap') === 'onHourStep').length === 2 && nodesTagged(entries, 'picker').some(node => attrOf(node, 'bindchange') === 'onHourPicker'))
  }
  check('云层灰阶语义与数据缺测语义明确', textsWith(cloudEntries, '分层云量').length === 1 && textsWith(cloudEntries, '斜纹 = 缺测或高度覆盖外').length === 1)
  const location = viewFor('cloud', { pointCard: { name: '大峰', coordText: '31.0632, 102.9085', eleText: '5025 m · 手动填写' } })
  check('地点名坐标海拔来源与保存入口齐备', textsWith(location, '大峰').length === 1 && textsWith(location, '31.0632, 102.9085').length === 1 && textsWith(location, '5025 m · 手动填写').length === 1 && nodesTagged(location, 'view').filter(node => attrOf(node, 'bindtap') === 'onSavePoint').length === 1)
}

section('§6 边界：写入集与追加条款（M-18 本批只做一半都不算完成）')
{
  const nw = src(NOTICES_WXML)
  const aw = src(ANOTICES_WXML)
  // S4（style-b 批次一，2026-10-26）：通知 Tab 页加了品牌头，并把两个分区头并成一个。
  // 旧断言钉的是「两份 wxml 逐字节相同」——那记录的是 M-18 未修时的形态，不是不变量：
  // 两份页面的**页头身份本来就不同**（notices 是 tab 页、自绘品牌栏；anotices 是原生导航的子页），
  // 合法差异一落地它必然假红（铁律 30：门钉行为，不钉当时长什么样）。
  // 换成钉真正必须同构的那一层：卡片正文、未读标记、分批、发布 sheet 的接线两边一致。
  // 2026-10-29：两页同步为原型 A 行动流（notice-row + 日期分组 groups），
  // 锚点随结构替换；钉的仍是「正文/未读/分批/发布接线两页同构」。
  const bodyAnchors = ['notice-row', 'groups', 'onMarkRead', 'onOpenActivity', 'onCopy',
    'onLoadMore', 'hiddenCount', 'overlay open="{{publishOpen}}"', 'onPublish']
  const missing = bodyAnchors.filter(a => nw.indexOf(a) === -1 || aw.indexOf(a) === -1)
  check('M-18 两份通知页的正文 / 未读标记 / 日期分组 / 分批 / 发布接线仍同构（差异只允许在页头）',
    missing.length === 0, '缺锚点：' + missing.join(' '))
  check('品牌头只在 tab 版通知页（anotices 走原生导航，不顶第二条自绘品牌栏）',
    nw.indexOf('<brand-header') !== -1 && aw.indexOf('<brand-header') === -1)
  check('通知页页头只出现一次页面身份（tab 用 notice-head，活动内用 section-head；不再有「同行消息」）',
    (nw.match(/class="notice-head"/g) || []).length === 1
    && (aw.match(/class="section-head anotices-head"/g) || []).length === 1
    && nw.indexOf('同行消息') === -1 && aw.indexOf('同行消息') === -1, '')
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
