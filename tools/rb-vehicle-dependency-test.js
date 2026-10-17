// C-20 行为门（R-B）：协作授权弹层的「负责车辆」候选必须是那条唯一 readTransport 的**显式依赖**。
//
// 缺陷本体（findings.md C-20）：roster-panel 的弹层装配直接读 this.data.transportVehicles，
// 而那份 data 是**另一条并发读**（loadTransport）的产物，两个读没有先后保证 ⇒
// readAccess 先回时下拉恒为空，保存时给出「先在分车里添加车辆」的错误指引，而车辆其实存在。
//
// 本套件因此必须**真的构造出两种先后顺序**并各自断言（这是它的红/绿对照），而不是只断言「vehicles 非空」：
//   §1 access 先回 / transport 还在飞 ⇒ 不许给出任何终态结论，也不许指路去分车区；落地后候选必须齐；
//   §2 transport 先回 ⇒ 同一份终态，且打开弹层不多发一次读；
//   §3 读取失败 ⇒ 说「没读到 + 重试」，绝不写成「这场活动没有车辆」（读故障≠空态）；
//   §4 确实没有车辆 ⇒ 这才许指路分车区；
//   §5 不另发第二次读（依赖收口，不造第二个真值源）；
//   §6 range 与 id 必须配对来自同一次读（按下标取到的是同一辆车）；
//   §7 模板三态的渲染可达性：按那一刻真组件的 data 求「哪一条分支会出现在屏幕上」。
//
// 写法约束（本仓铁律，不是自创）：
// · 铁律 30：门钉行为，不钉源码文本；§7 只用 handler 名定位区域（改中文文案不会让它假红）。
// · 铁律 21：不数节点。§7 断言的是「这份 data 下这条链渲染成哪一支」，不是「有几个 view」。
// · 铁律 11：不镜像组件逻辑——顺序、失败、重试全部走真 api 桩的 promise 与真 handler 调用。
// · 铁律 24：读可以重试，写绝不自动重发（§3 的重试是用户点出来的，不是自动的）。
'use strict'
const path = require('path')

const api = require('../miniprogram/utils/api')
const ROSTER_JS = require.resolve('../miniprogram/components/roster-panel/roster-panel.js')
const ROSTER_WXML = path.join(__dirname, '..', 'miniprogram', 'components', 'roster-panel', 'roster-panel.wxml')
const fs = require('fs')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }
const sleep = ms => new Promise(r => setTimeout(r, ms))
function deferred() {
  const d = {}
  d.promise = new Promise((res, rej) => { d.resolve = res; d.reject = rej })
  return d
}

global.wx = {
  showToast: () => {},
  hideToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  setClipboardData: () => {},
  getStorageSync: () => '',
  vibrateShort: () => {},
}

// ---- 真组件装载（与 scenario-workspace 同一套范式：捕获 Component() 配置，methods 展开到实例）----
function compConfig(p) {
  global.Component = cfg => { global.__RB_CFG = cfg }
  delete require.cache[p]
  require(p)
  return global.__RB_CFG
}
function makeComp(cfg, props) {
  const comp = Object.assign({}, cfg, cfg.methods || {})
  comp.data = Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), props || {})
  comp.setData = function (patch, cb) {
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  comp.triggerEvent = () => {}
  return comp
}
function attach(comp) {
  if (comp.lifetimes && comp.lifetimes.attached) comp.lifetimes.attached.call(comp)
}

// ---- api 桩：两条读各自可控（immediate / defer / fail），并记录每一次外呼 ----
const VIEW = {
  kind: 'activity',
  activity: { phase: 'gathering' },
  counters: { confirmed: 2, pending: 0, waitlisted: 0 },
  rows: [{ signupId: 's1', name: '张三', status: 'confirmed', tripMode: 'shared', pickup: '南门', vehicle: '1号车' }],
}
const ACCESS_OK = {
  memberships: [
    { id: 'm1', role: 'vehicle_contact', userId: 'u-9', expiresAt: '2026-10-20T18:00:00+08:00', vehicleId: '' },
  ],
}
function installApi(spec) {
  const env = { ors: [], cmds: [], pending: {} }
  api.read = () => Promise.resolve({ view: VIEW, revision: 7, now: '2026-10-14T12:00:00+08:00' })
  api.readOr = (name, data) => {
    env.ors.push({ name, data })
    const s = spec[name]
    if (s && s.mode === 'defer') {
      const d = deferred()
      env.pending[name] = d
      return d.promise
    }
    if (s && s.mode === 'fail') return Promise.reject(new Error('云函数这次没有回话'))
    if (s && s.mode === 'failNext') {
      // 第一次失败、之后成功：§3 的重试要用它，但不允许组件自己「自动」重试
      if (!env['_failUsed' + name]) { env['_failUsed' + name] = true; return Promise.reject(new Error('云函数这次没有回话')) }
      return Promise.resolve(s.value)
    }
    return Promise.resolve(s ? s.value : {})
  }
  api.dispatchAndSync = (payload, rev) => {
    env.cmds.push({ payload, rev })
    return Promise.resolve({ revision: (rev || 0) + 1, targetIds: [], replayed: false })
  }
  env.transportCalls = () => env.ors.filter(o => o.name === 'readTransport').length
  env.accessCalls = () => env.ors.filter(o => o.name === 'readAccess').length
  return env
}
async function boot(spec, props) {
  const env = installApi(spec)
  const comp = makeComp(compConfig(ROSTER_JS), Object.assign({ activityId: 'a1' }, props || {}))
  attach(comp)
  await sleep(6)
  return { env, comp }
}

// ---- §7 用的渲染可达性模型：只回答「这份 data 下这条 if/elif/else 链渲染成哪一支」----
function vehicleRegion(wxml) {
  // 用 handler 名定位（语义契约），不用中文文案：改文案不该让这条门假红（铁律 30）
  const i = wxml.indexOf('bindchange="onVehiclePick"')
  if (i < 0) return null
  const start = wxml.lastIndexOf('<form-field', i)
  const end = wxml.indexOf('</form-field>', i)
  if (start < 0 || end < i) return null
  return wxml.slice(start, end)
}
function getAttr(attrs, name) {
  const m = attrs.match(new RegExp(name + '="([^"]*)"'))
  return m ? m[1] : null
}
function evalExpr(expr, data) {
  return new Function('d', 'with (d) { return (' + expr + ') }')(data)
}
function unwrap(expr) { return String(expr).replace(/^\s*\{\{/, '').replace(/\}\}\s*$/, '') }
function chainMembers(region) {
  const out = []
  const re = /<(picker|view|text|button)((?:\s[^>]*?)?)>/g
  let m
  while ((m = re.exec(region))) {
    const attrs = m[2] || ''
    const cond = getAttr(attrs, 'wx:if')
    const elif = getAttr(attrs, 'wx:elif')
    const hasElse = /\bwx:else\b/.test(attrs)
    if (cond === null && elif === null && !hasElse) continue
    out.push({
      tag: m[1],
      kind: cond !== null ? 'if' : (elif !== null ? 'elif' : 'else'),
      expr: cond !== null ? unwrap(cond) : unwrap(elif),
      from: m.index,
      attrs,
    })
  }
  out.forEach((n, idx) => {
    const next = idx + 1 < out.length ? out[idx + 1].from : region.length
    n.body = region.slice(region.indexOf('>', n.from) + 1, next)
  })
  return out
}
function renderedMember(region, data) {
  // 按 wx:if/wx:elif/wx:else 的真实语义求渲染：一条链里最多一支出现；
  // 把 elif 改写成 if 会让两支同时"渲染"，在这里计成 count>1（不是靠比对源码文本）。
  const members = chainMembers(region)
  let picked = null
  let count = 0
  let chainHot = false
  for (const n of members) {
    if (n.kind === 'if') chainHot = false
    let v
    if (n.kind === 'else') {
      v = !chainHot
    } else {
      try { v = !!evalExpr(n.expr, data) } catch (e) { return { error: n.expr + ' 求值失败：' + e.message, members } }
      if (v) chainHot = true
    }
    if (v) { count++; if (!picked) picked = n }
  }
  return { members, hit: picked, count }
}

async function main() {
  const ROSTER_W = fs.readFileSync(ROSTER_WXML, 'utf8')
  const TWO = { vehicles: [{ id: 'v1', label: '1号车' }, { id: 'v2', label: '2号车' }], groups: [] }

  // =============== §1 access 先回、transport 还在飞（C-20 的原始触发顺序）===============
  section('§1 readAccess 先回、readTransport 还在飞：不许给出终态结论，落地后候选必须齐')
  {
    const { env, comp } = await boot({
      readTransport: { mode: 'defer' },
      readAccess: { value: ACCESS_OK },
    })
    check('§1.1 面板挂载后那条 readTransport 已发出（依赖的是同一条读，不是弹层自己另发的）',
      env.transportCalls() === 1, 'transportCalls=' + env.transportCalls())
    comp.onAccessOpen()
    await sleep(6)
    check('§1.2 名单读取先回：授权列表照常出现（等车辆依赖不许把整块弹层拖住）',
      (comp.data.memberships || []).length === 1, JSON.stringify(comp.data.memberships))
    check('§1.3 此刻车辆候选还没有终态：必须说「正在读取」',
      comp.data.vehicleLoading === true, 'loading=' + comp.data.vehicleLoading)
    check('§1.4 未落地期间绝不许判成「确实没有车辆」或「读取失败」',
      comp.data.vehicleEmpty === false && comp.data.vehicleFailed === false,
      'empty=' + comp.data.vehicleEmpty + ' failed=' + comp.data.vehicleFailed)
    // 这一刻用户就会去点保存：给的话术不许把人指去分车区（原缺陷的错误指引）
    comp.setData({ roleIndex: 1, vehicleIndex: -1, mUserId: 'u-9', expires: { date: '2026-10-20', time: '18:00' } })
    comp.onAccessSave()
    const guidance = String(comp.data.error || '')
    check('§1.5 在飞期间点保存：必须有话说，且不许是「先去分车添加车辆」那类指路',
      guidance !== '' && guidance.indexOf('添加车辆') === -1 && guidance.indexOf('没有车辆') === -1, guidance)
    check('§1.6 在飞期间点保存：一条写命令都不许发出去',
      env.cmds.length === 0, JSON.stringify(env.cmds))
    env.pending.readTransport.resolve(TWO)
    await sleep(6)
    check('§1.7 那条读落地后候选必须补齐（等齐的是同一条读，不是重新发一条）',
      comp.data.vehicles.join('|') === '1号车|2号车', JSON.stringify(comp.data.vehicles))
    check('§1.8 落地后三态布尔互相排斥且不再报「正在读取」',
      comp.data.vehicleLoading === false && comp.data.vehicleEmpty === false && comp.data.vehicleFailed === false,
      JSON.stringify({ l: comp.data.vehicleLoading, e: comp.data.vehicleEmpty, f: comp.data.vehicleFailed }))
    comp.setData({ vehicleIndex: 1 })
    comp.onAccessSave()
    const sent = env.cmds[0]
    check('§1.9 补开后保存发出 membership.save，且带的是下标 1 对应那辆车',
      !!sent && sent.payload.type === 'membership.save' && sent.payload.membership.vehicleId === 'v2',
      JSON.stringify(sent && sent.payload.membership))
    check('§1.10 全程 readTransport 只发过 1 次、readAccess 1 次（弹层没有另发读）',
      env.transportCalls() === 1 && env.accessCalls() === 1,
      't=' + env.transportCalls() + ' a=' + env.accessCalls())
  }

  // =============== §2 transport 先回（另一种顺序必须落到同一份终态）===============
  section('§2 readTransport 先回、readAccess 后回：终态必须与 §1 逐字相同')
  {
    const { env, comp } = await boot({
      readTransport: { value: TWO },
      readAccess: { value: ACCESS_OK },
    })
    comp.onAccessOpen()
    await sleep(6)
    check('§2.1 反序下候选同样齐（下拉不依赖两条读的相对先后）',
      comp.data.vehicles.join('|') === '1号车|2号车' && comp.transportVehicleIds.join('|') === 'v1|v2',
      JSON.stringify({ v: comp.data.vehicles, ids: comp.transportVehicleIds }))
    check('§2.2 反序下没有任何「失败/空/在读」标记',
      !comp.data.vehicleLoading && !comp.data.vehicleEmpty && !comp.data.vehicleFailed,
      JSON.stringify({ l: comp.data.vehicleLoading, e: comp.data.vehicleEmpty, f: comp.data.vehicleFailed }))
    comp.setData({ roleIndex: 1, vehicleIndex: 0, mUserId: 'u-9', expires: { date: '2026-10-20', time: '18:00' } })
    comp.onAccessSave()
    check('§2.3 反序下保存直接可成（不被 §1 那句「正在读取」误伤）',
      env.cmds.length === 1 && env.cmds[0].payload.membership.vehicleId === 'v1',
      JSON.stringify(env.cmds.map(c => c.payload.type)))
    check('§2.4 打开弹层没有多发一条 readTransport（复用已在位的那份）',
      env.transportCalls() === 1, 'transportCalls=' + env.transportCalls())
  }

  // =============== §3 读取失败 ≠ 空态 ===============
  section('§3 readTransport 失败：说「没读到 + 可以重试」，绝不写成「这场活动没有车辆」')
  {
    const { env, comp } = await boot({
      readTransport: { mode: 'failNext', value: TWO },
      readAccess: { value: ACCESS_OK },
    })
    comp.onAccessOpen()
    await sleep(6)
    check('§3.1 失败态被显式命名',
      comp.data.vehicleFailed === true && comp.data.vehicleLoading === false,
      JSON.stringify({ f: comp.data.vehicleFailed, l: comp.data.vehicleLoading }))
    check('§3.2 读故障绝不许被判成「确实没有车辆」（读故障≠空态）',
      comp.data.vehicleEmpty === false, 'vehicleEmpty=' + comp.data.vehicleEmpty)
    check('§3.3 失败不影响名单读取本身（access 成功照旧装配）',
      (comp.data.memberships || []).length === 1 && !comp.data.accessError,
      JSON.stringify({ m: (comp.data.memberships || []).length, err: comp.data.accessError }))
    comp.setData({ roleIndex: 1, vehicleIndex: -1, mUserId: 'u-9', expires: { date: '2026-10-20', time: '18:00' } })
    comp.onAccessSave()
    const guidance = String(comp.data.error || '')
    check('§3.4 失败时保存被拦且话术不含「添加车辆」（不许把读故障指路成补数据）',
      env.cmds.length === 0 && guidance !== '' && guidance.indexOf('添加车辆') === -1, guidance)
    check('§3.5 失败话术给出出路（重试），不是一句「没有车辆」',
      guidance.indexOf('重试') !== -1 || guidance.indexOf('重新读取') !== -1, guidance)
    comp.onRetryVehicles()
    await sleep(6)
    check('§3.6 用户点重试之后候选补齐（重试只走那一条读，不是第二个数据源）',
      comp.data.vehicles.join('|') === '1号车|2号车' && comp.data.vehicleFailed === false,
      JSON.stringify({ v: comp.data.vehicles, f: comp.data.vehicleFailed }))
    check('§3.7 失败期间没有自动重试（读的重试是用户点出来的）',
      env.transportCalls() === 2, 'transportCalls=' + env.transportCalls())
    comp.setData({ vehicleIndex: 0 })
    comp.onAccessSave()
    check('§3.8 重试成功后保存放行',
      env.cmds.length === 1 && env.cmds[0].payload.membership.vehicleId === 'v1', JSON.stringify(env.cmds))
  }

  // =============== §4 确实没有车辆才许指路分车区 ===============
  section('§4 readTransport 成功但车辆为空：这才许说「先在分车区添加车辆」')
  {
    const { env, comp } = await boot({
      readTransport: { value: { vehicles: [], groups: [] } },
      readAccess: { value: ACCESS_OK },
    })
    comp.onAccessOpen()
    await sleep(6)
    check('§4.1 空态被显式命名，且与失败/在读严格分开',
      comp.data.vehicleEmpty === true && comp.data.vehicleFailed === false && comp.data.vehicleLoading === false,
      JSON.stringify({ e: comp.data.vehicleEmpty, f: comp.data.vehicleFailed, l: comp.data.vehicleLoading }))
    comp.setData({ roleIndex: 1, vehicleIndex: -1, mUserId: 'u-9', expires: { date: '2026-10-20', time: '18:00' } })
    comp.onAccessSave()
    const guidance = String(comp.data.error || '')
    check('§4.2 真空态才给出「去分车区添加车辆」这条指路（阳性对照：§1/§3 都不给）',
      env.cmds.length === 0 && guidance.indexOf('分车') !== -1, guidance)
  }

  // =============== §5 现场再开一次弹层：不许因为「重开」多发读 ===============
  section('§5 反复开关弹层：候选依赖收口在同一条读上（不制造第二个真值源）')
  {
    const { env, comp } = await boot({
      readTransport: { value: TWO },
      readAccess: { value: ACCESS_OK },
    })
    comp.onAccessOpen(); await sleep(5)
    comp.onAccessClose(); await sleep(5)
    comp.onAccessOpen(); await sleep(5)
    comp.onAccessOpen(); await sleep(5)
    check('§5.1 三次开弹层，readTransport 仍然只发过 1 次',
      env.transportCalls() === 1, 'transportCalls=' + env.transportCalls())
    check('§5.2 候选仍然在位（复用已在位的那份渲染，不是每次重读）',
      comp.data.vehicles.join('|') === '1号车|2号车', JSON.stringify(comp.data.vehicles))
  }

  // =============== §6 range 与 id 必须配对来自同一次读 ===============
  section('§6 装配单源：vehicles[i] 与 transportVehicleIds[i] 必须是同一辆车')
  {
    const shuffled = { vehicles: [{ id: 'vB', label: '乙车' }, { id: 'vA', label: '甲车' }], groups: [] }
    const { env, comp } = await boot({
      readTransport: { value: shuffled },
      readAccess: { value: ACCESS_OK },
    })
    comp.onAccessOpen(); await sleep(6)
    const pairs = comp.data.vehicles.map((l, i) => l + '=' + comp.transportVehicleIds[i]).join(',')
    check('§6.1 下标配对逐字成立（range 来自 A、ids 来自 B 的老写法会在这里报红）',
      pairs === '乙车=vB,甲车=vA', pairs)
    comp.setData({ roleIndex: 1, vehicleIndex: 1, mUserId: 'u-9', expires: { date: '2026-10-20', time: '18:00' } })
    comp.onAccessSave()
    check('§6.2 选「甲车」保存下发的就是 vA',
      env.cmds.length === 1 && env.cmds[0].payload.membership.vehicleId === 'vA',
      JSON.stringify(env.cmds[0] && env.cmds[0].payload.membership))
  }

  // =============== §7 三态的渲染可达性（按那一刻真组件的 data 求渲染）===============
  section('§7 模板三态：那一刻的 data 下，屏幕上出现的是哪一支分支')
  {
    const region = vehicleRegion(ROSTER_W)
    check('§7.0 定位到「负责车辆」字段的分支区域（按 handler 名定位，改文案不会让它假红）',
      !!region, String(region))
    if (region) {
      const members = chainMembers(region)
      const kinds = members.map(m => m.kind).join('/')
      check('§7.1 该区域是一条 if/elif/elif/else 单链（四支互斥，不存在两支同真）',
        kinds === 'if/elif/elif/else', kinds)
      // 四个「那一刻」都取真组件实例的真实 data：在飞 / 读取失败 / 确实没有 / 候选齐备
      const shots = []
      {
        const c = await boot({ readTransport: { mode: 'defer' }, readAccess: { value: ACCESS_OK } })
        c.comp.onAccessOpen(); await sleep(6)
        shots.push({ label: '§7.2 在飞', data: JSON.parse(JSON.stringify(c.comp.data)), env: c.env })
        shots[0].resolve = () => c.env.pending.readTransport.resolve(TWO)
      }
      {
        const c = await boot({ readTransport: { mode: 'failNext', value: TWO }, readAccess: { value: ACCESS_OK } })
        c.comp.onAccessOpen(); await sleep(6)
        shots.push({ label: '§7.3 读取失败', data: JSON.parse(JSON.stringify(c.comp.data)) })
      }
      {
        const c = await boot({ readTransport: { value: { vehicles: [], groups: [] } }, readAccess: { value: ACCESS_OK } })
        c.comp.onAccessOpen(); await sleep(6)
        shots.push({ label: '§7.4 确实没有', data: JSON.parse(JSON.stringify(c.comp.data)) })
      }
      {
        const c = await boot({ readTransport: { value: TWO }, readAccess: { value: ACCESS_OK } })
        c.comp.onAccessOpen(); await sleep(6)
        shots.push({ label: '§7.5 候选齐备', data: JSON.parse(JSON.stringify(c.comp.data)) })
      }
      const expect = [
        d => d.tag === 'view' && !/onRetryVehicles/.test(d.body) && d.body.indexOf('读取') !== -1,
        d => d.tag === 'view' && /onRetryVehicles/.test(d.body),
        d => d.tag === 'view' && !/onRetryVehicles/.test(d.body) && d.body.indexOf('分车') !== -1,
        d => d.tag === 'picker',
      ]
      shots.forEach((s, i) => {
        const r = renderedMember(region, s.data)
        check(s.label + '：只有一支会渲染（三态互斥，不是并列显示）',
          r.count === 1 && !!r.hit, 'count=' + r.count + ' ' + (r.error || ''))
        check(s.label + '：渲染的就是这一支该有的样子',
          !!r.hit && expect[i](r.hit), r.hit ? r.hit.tag + ' | ' + r.hit.body.replace(/\s+/g, ' ').slice(0, 60) : '无')
        if (s.resolve) s.resolve()
      })
      await sleep(6)
    }
  }

  // =============== §8 既有授权的车辆回显（findings 副作用风险点名要保留的那条链）===============
  section('§8 「调整」一条既有授权：vehicleIndex 必须按 transportVehicleIds 回显（依赖收口后仍可回显）')
  {
    const withGrant = {
      memberships: [
        { id: 'm7', role: 'vehicle_contact', userId: 'u-7', expiresAt: '2026-10-20T18:00:00+08:00', vehicleId: 'v2' },
      ],
    }
    // 故意让 access 先回：回显靠的是「等齐那条读」，不是运气
    const { comp } = await boot({ readTransport: { mode: 'defer' }, readAccess: { value: withGrant } })
    comp.onAccessOpen()
    await sleep(6)
    let threw = null
    try { comp.onEditMembership({ currentTarget: { dataset: { id: 'm7' } } }) } catch (e) { threw = e }
    check('§8.1 候选还在飞时点「调整」不许抛错（id 表还没落地，回显成未选即可）',
      !threw, threw && String(threw.message))
    check('§8.1b 在飞期间不许回显成一辆不存在的车，也不许给出一个能保存的假下标',
      !threw && (comp.data.vehicleIndex === -1 || comp.data.vehicleIndex === 1), 'vehicleIndex=' + comp.data.vehicleIndex)
    const { comp: c2 } = await boot({ readTransport: { value: TWO }, readAccess: { value: withGrant } })
    c2.onAccessOpen()
    await sleep(6)
    c2.onEditMembership({ currentTarget: { dataset: { id: 'm7' } } })
    check('§8.2 依赖落地后点「调整」：m7 那辆车回显成下标 1（v2 在候选里的位置）',
      c2.data.vehicleIndex === 1 && c2.data.vehicles[c2.data.vehicleIndex] === '2号车',
      'vehicleIndex=' + c2.data.vehicleIndex + ' vehicles=' + JSON.stringify(c2.data.vehicles))
  }

  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

main().catch(e => {
  console.error('套件异常：' + ((e && e.stack) || e))
  console.log('passed=' + passed + ' failed=' + (failed + 1))
  process.exit(1)
})
