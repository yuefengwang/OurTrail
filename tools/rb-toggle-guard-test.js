// R-B 第二项行为门：roster-panel 的 onToggleGroup 补在途守卫（busy/busyAt 成对 + 两路复位 + 单源宽限）。
//
// 缺陷本体：同行组约束直接 api.dispatchAndSync({type:'group.setTogether'})，既不读 busy 也不置 busy，
// 而同文件另外四个写点（onBatchConfirm / onExportConfirm / onRevokeConfirm / onAccessSave）都有守卫。
// 后果：连点两次 ⇒ 两条写命令、两次 revision 自增，第二次多半 CONFLICT，界面还没有任何「正在处理」的姿态。
//
// 这条门必须**双向**（派单书原话：只测一侧就是放过另一半 bug）：
//   方向 A：在途时第二次操作 ⇒ group.setTogether 命令数不增；
//   方向 B：busyAt 超过 J.BUSY_LIMIT_MS ⇒ 下一次必须能发出命令（残留不许永久锁死面板）。
// 另钉：busy 与 busyAt 成对置位、.then/.catch 两路都复位、宽限期判据只有 J.busyStale 一个出处
// （组件里不许出现第二个 8000、不许自己算时间差 —— 这是「不该存在的依赖」，不是钉源码写法，铁律 30②），
// 以及模板侧「在途点不动且带禁用态」的渲染可达性（取真实例在途那一刻的 data 求值，不是比对源码字符串）。
//
// 铁律 11：不镜像组件逻辑 —— 命令是否发出靠真调 handler + 真 api 桩记录；时间判据用 J.BUSY_LIMIT_MS 本身。
'use strict'
const fs = require('fs')
const path = require('path')

const api = require('../miniprogram/utils/api')
const J = require('../miniprogram/utils/journey')
const ROSTER_JS = require.resolve('../miniprogram/components/roster-panel/roster-panel.js')
const ROSTER_WXML = path.join(__dirname, '..', 'miniprogram', 'components', 'roster-panel', 'roster-panel.wxml')

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
  showToast: () => {}, hideToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  setClipboardData: () => {}, getStorageSync: () => '', vibrateShort: () => {},
}

function compConfig(p) {
  global.Component = cfg => { global.__RB2_CFG = cfg }
  delete require.cache[p]
  require(p)
  return global.__RB2_CFG
}
function makeComp(cfg, props) {
  const comp = Object.assign({}, cfg, cfg.methods || {})
  comp.data = Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), props || {})
  comp.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) setImmediate(cb) }
  comp.triggerEvent = () => {}
  return comp
}

const VIEW = {
  kind: 'activity',
  activity: { phase: 'gathering' },
  counters: { confirmed: 2, pending: 0, waitlisted: 0 },
  rows: [{ signupId: 's1', name: '张三', status: 'confirmed', tripMode: 'shared', pickup: '南门', vehicle: '1号车' }],
}
const GROUPS = { vehicles: [{ id: 'v1', label: '1号车' }], groups: [{ id: 'g1', keepTogether: true, signupIds: ['s1', 's2'] }] }

function boot(spec) {
  const env = { ors: [], cmds: [], gates: [] }
  api.read = () => Promise.resolve({ view: VIEW, revision: 7, now: '2026-10-14T12:00:00+08:00' })
  api.readOr = name => {
    env.ors.push(name)
    return Promise.resolve(spec && spec.deferTransport ? deferred().promise : GROUPS)
  }
  api.dispatchAndSync = (payload, rev) => {
    env.cmds.push({ payload, rev })
    const g = deferred()
    env.gates.push(g)
    return g.promise
  }
  const comp = makeComp(compConfig(ROSTER_JS), { activityId: 'a1' })
  if (comp.lifetimes && comp.lifetimes.attached) comp.lifetimes.attached.call(comp)
  return { env, comp }
}
const setCmds = env => env.cmds.filter(c => c.payload.type === 'group.setTogether')
const tap = comp => comp.onToggleGroup({ currentTarget: { dataset: { id: 'g1', keep: true } } })

async function main() {
  // =============== §1 首次操作：命令发出 + busy/busyAt 成对 ===============
  section('§1 空闲态点一次：命令发出，busy 与 busyAt 成对置位')
  {
    const { env, comp } = boot()
    await sleep(6)
    check('§1.0 夹具确实有同行组（否则 handler 无从点起，整段会空转）',
      (comp.data.groups || []).length === 1, JSON.stringify(comp.data.groups))
    tap(comp)
    check('§1.1 发出 group.setTogether 且 keepTogether 取反',
      setCmds(env).length === 1 && setCmds(env)[0].payload.keepTogether === false,
      JSON.stringify(setCmds(env)[0] && setCmds(env)[0].payload))
    check('§1.2 置忙（界面有「正在处理」的姿态可依赖）',
      comp.data.busy === true, 'busy=' + comp.data.busy)
    check('§1.3 busyAt 同步置位（没有 busyAt 的 busy 永远解不开，等于永久锁死）',
      typeof comp.data.busyAt === 'number' && comp.data.busyAt > 0, 'busyAt=' + comp.data.busyAt)
    env.gates[0].resolve({ revision: 8 })
    await sleep(6)
    check('§1.4 成功路径复位 busy', comp.data.busy === false, 'busy=' + comp.data.busy)
    check('§1.5 成功路径把 busyAt 一起归零（成对置位就要成对复位）',
      comp.data.busyAt === 0, 'busyAt=' + comp.data.busyAt)
  }

  // =============== §2 方向 A：在途时第二次操作不增命令 ===============
  section('§2 在途守卫（方向 A）：第一条还没回来时，第二次操作不许再发命令')
  {
    const { env, comp } = boot()
    await sleep(6)
    tap(comp)
    const inFlight = JSON.parse(JSON.stringify(comp.data))
    tap(comp)
    tap(comp)
    await sleep(6)
    check('§2.1 连点三次只发出一条 group.setTogether（原缺陷会发三条）',
      setCmds(env).length === 1, 'count=' + setCmds(env).length)
    check('§2.2 取的是「真在途那一刻」的 data（这条读数不是硬编出来的）',
      inFlight.busy === true && inFlight.busyAt > 0, JSON.stringify({ busy: inFlight.busy, at: inFlight.busyAt }))
    env.gates[0].resolve({ revision: 8 })
    await sleep(6)
    check('§2.3 在途期间 revision 没被乱改（只有落地那次才推进）',
      comp.revision === 8, 'revision=' + comp.revision)
  }

  // =============== §3 方向 B：超过宽限期的残留必须放行下一次 ===============
  section('§3 残留自愈（方向 B）：busyAt 超过 J.BUSY_LIMIT_MS ⇒ 下一次操作必须能发出命令')
  {
    const { env, comp } = boot()
    await sleep(6)
    comp.setData({ busy: true, busyAt: Date.now() - J.BUSY_LIMIT_MS - 1000 })
    tap(comp)
    check('§3.1 残留的 busy 不许永久锁死：这一次必须真的把命令发出去',
      setCmds(env).length === 1, 'count=' + setCmds(env).length)
    check('§3.2 放行后重新成对置忙（不是"发出去但界面仍无姿态"）',
      comp.data.busy === true && comp.data.busyAt > 0, JSON.stringify({ busy: comp.data.busy, at: comp.data.busyAt }))
  }
  section('§3b 反向对照：还在宽限期内就不许放行（否则 §3 那条可以写成无条件放行）')
  {
    const { env, comp } = boot()
    await sleep(6)
    tap(comp)                                  // 真在途
    comp.setData({ busyAt: Date.now() })        // 钉成「刚刚置的忙」
    tap(comp)
    check('§3b.1 宽限期内的第二次操作仍被挡（说明放行判据真的在判时间，不是永远放行）',
      setCmds(env).length === 1, 'count=' + setCmds(env).length)
    env.gates[0].resolve({ revision: 8 })
  }
  section('§3c 边界与单源：宽限期的刻度就是 J.BUSY_LIMIT_MS 本身')
  {
    const { env, comp } = boot()
    await sleep(6)
    comp.setData({ busy: true, busyAt: Date.now() - J.BUSY_LIMIT_MS + 200 })
    tap(comp)
    check('§3c.1 差一点到宽限期 ⇒ 仍不算残留，不放行',
      setCmds(env).length === 0, 'count=' + setCmds(env).length)
    comp.setData({ busy: true, busyAt: Date.now() - J.BUSY_LIMIT_MS - 200 })
    tap(comp)
    check('§3c.2 越过宽限期 ⇒ 放行（与 §3c.1 用的是同一个数，说明没有第二个阈值）',
      setCmds(env).length === 1, 'count=' + setCmds(env).length)
    const fresh = J.busyStale(Date.now(), Date.now())
    const stale = J.busyStale(Date.now() - J.BUSY_LIMIT_MS - 1, Date.now())
    check('§3c.3 单源判据自身仍是两态（门没有对着一个恒真的东西断言）',
      fresh === false && stale === true, JSON.stringify({ fresh, stale }))
  }

  // =============== §4 失败路径也要复位（两路都复位）===============
  section('§4 写失败：busy/busyAt 复位且把原因说出来')
  {
    const { env, comp } = boot()
    await sleep(6)
    tap(comp)
    env.gates[0].reject(new Error('CONFLICT'))
    await sleep(6)
    check('§4.1 失败后 busy 复位', comp.data.busy === false, 'busy=' + comp.data.busy)
    check('§4.2 失败后 busyAt 归零', comp.data.busyAt === 0, 'busyAt=' + comp.data.busyAt)
    check('§4.3 失败不静默：面板自己说出原因',
      String(comp.data.error || '') !== '', 'error=' + JSON.stringify(comp.data.error))
    tap(comp)
    check('§4.4 失败之后可以再试一次（残留守卫没有把面板锁死）',
      setCmds(env).length === 2, 'count=' + setCmds(env).length)
  }

  // =============== §5 模板侧：在途那一刻这个入口点不动且带禁用态 ===============
  section('§5 渲染可达性：用真实例在途那一刻的 data 求这个入口的 bindtap/class')
  {
    const wxml = fs.readFileSync(ROSTER_WXML, 'utf8')
    const tags = wxml.match(/<[a-zA-Z-]+(?:\s[^>]*?)?\/?>/g) || []
    const entries = []
    tags.forEach(t => {
      const bt = (t.match(/bindtap="([^"]*)"/) || [])[1]
      if (!bt) return
      entries.push({ tag: t, bindtap: bt, cls: (t.match(/class="([^"]*)"/) || [])[1] || '' })
    })
    const ev = (s, d) => {
      try {
        return {
          value: String(s).replace(/\{\{([\s\S]*?)\}\}/g, (_a, e) => {
            const v = new Function('d', 'with (d) { return (' + e + ') }')(d)
            return v === undefined || v === null ? '' : String(v)
          }),
        }
      } catch (e) { return { error: e.message } }
    }
    const { env, comp } = boot()
    await sleep(6)
    const idle = JSON.parse(JSON.stringify(comp.data))
    tap(comp)
    const flight = JSON.parse(JSON.stringify(comp.data))
    const hitIdle = entries.filter(e => e.tag.indexOf('onToggleGroup') !== -1 && ev(e.bindtap, idle).value === 'onToggleGroup')
    const hitFlight = entries.filter(e => /onToggleGroup/.test(e.bindtap) && ev(e.bindtap, flight).value !== '')
    check('§5.1 空闲态确实存在一个通向 onToggleGroup 的入口（门没在空转）',
      hitIdle.length === 1, 'n=' + hitIdle.length)
    check('§5.2 在途那一刻这个入口不再挂 handler（bindtap 求值成空串 = 点下去什么都不会发生）',
      hitFlight.length === 0, JSON.stringify(hitFlight.map(x => x.bindtap)))
    const node = entries.filter(e => /onToggleGroup/.test(e.bindtap))[0]
    const clsFlight = node ? ev(node.cls, flight) : { error: '未找到入口' }
    const clsIdle = node ? ev(node.cls, idle) : { error: '未找到入口' }
    check('§5.3 在途时带 disabled 视觉态（点不动但不长成"坏了"）',
      !!clsFlight.value && String(clsFlight.value).indexOf('disabled') !== -1, JSON.stringify(clsFlight))
    check('§5.4 空闲时不该挂着 disabled（否则永远是灰的，反向对照）',
      !!clsIdle.value && String(clsIdle.value).indexOf('disabled') === -1, JSON.stringify(clsIdle))
    env.gates[0].resolve({ revision: 8 })
  }

  // =============== §6 单源：组件里不许出现第二个宽限期数字 / 自己算时间差 ===============
  section('§6 判据单源（查「不该存在的依赖」，不钉写法）')
  {
    const src = fs.readFileSync(ROSTER_JS, 'utf8').split(/\r?\n/)
      .map(l => l.replace(/\/\/.*$/, ''))        // 注释里写 8000 不算依赖
      .join('\n')
    check('§6.1 roster-panel.js 里没有第二个 8000 字面量',
      !/\b8000\b/.test(src), (src.match(/.{0,40}\b8000\b.{0,40}/) || [''])[0])
    check('§6.2 没有自算的时间差（Date.now() 直接减 busyAt 就是第二个实现）',
      !/Date\.now\(\)\s*-?\s*(this\.)?data\.busyAt/.test(src) && !/busyAt\s*[-+]\s*Date\.now\(\)/.test(src),
      (src.match(/.{0,50}busyAt.{0,30}/) || [''])[0])
    check('§6.3 宽限期判据确实被消费（J.busyStale 至少出现在同行组那条路径上）',
      /J\.busyStale\(this\.data\.busyAt/.test(src), '未找到 J.busyStale 消费点')
  }

  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

main().catch(e => {
  console.error('套件异常：' + ((e && e.stack) || e))
  console.log('passed=' + passed + ' failed=' + (failed + 1))
  process.exit(1)
})
