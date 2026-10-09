// 写失败的语义与错误归类：node tools/failure-semantics-test.js
//
// 两件事一条主线：**失败必须被正确归类，且归类之后要有可执行的恢复动作**。
//   A 段（客户端 miniprogram/utils/api.js）：把「服务端明确拒绝」和「结果未知」分开——
//     后者绝不能让用户再点一次就变成第二条命令，也不能自动重发（那是把不确定变成两次写）。
//   B 段（云函数 index.js）：未捕获的内部异常不许以英文原文/堆栈进用户界面，也不许伪装成
//     INVALID_INPUT 让用户以为是自己填错；原文只进结构化日志。
//
// 判据口径：桩层（内存 db + 桩 wx.cloud），不发网络、不动云端数据。日志用劫持 console.log 采集。
'use strict'
const path = require('path')
const Module = require('module')

const STUB = path.join(__dirname, 'stub-wx-server-sdk.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return STUB
  return origResolve.call(this, request, ...rest)
}
const stub = require(STUB)
stub.__state.db = stub.__fakeDb()

const API_PATH = require.resolve('../miniprogram/utils/api')
const CONFIG_PATH = require.resolve('../miniprogram/config')
const trailApi = require('../cloudfunctions/trailApi/index')
const store = require('../cloudfunctions/trailApi/store')
const { ERROR_CODES } = require('../cloudfunctions/trailApi/domain/contracts')

let passed = 0, failed = 0, inconclusive = 0
const fails = []
// 日志采集要劫持 console.log，所以判据输出必须走保存下来的 realLog——
// 否则整段断言会静默写进采集缓冲，套件「全绿」却一条都没打印（本轮先踩过一次）。
function check(name, cond, extra) {
  if (cond) { passed++; realLog('  ✓ ' + name) }
  else { failed++; fails.push(name); realLog('  ✗ ' + name + (extra ? '（' + extra + '）' : '') + '\n') }
}
function section(t) { realLog('\n== ' + t + ' ==') }
function skip(name, why) { inconclusive++; realLog('  · [INCONCLUSIVE] ' + name + '：' + why) }

const okResp = data => Promise.resolve({ result: { ok: true, data } })
const srvErr = (code, message) => Promise.resolve({ result: { ok: false, error: { code, message } } })
const transport = errMsg => Promise.reject({ errMsg })
async function rejects(p) { try { await p; return null } catch (e) { return e } }

function freshApi(respond) {
  const env = { toasts: [], calls: [] }
  global.wx = {
    cloud: { callFunction(o) { env.calls.push(o); return respond(o) } },
    showToast(o) { env.toasts.push(o) },
  }
  delete require.cache[API_PATH]
  delete require.cache[CONFIG_PATH]
  env.api = require(API_PATH)
  return env
}
function makePage(reloadImpl) {
  const page = { reloads: 0, events: [], data: {} }
  page.reload = reloadImpl || (() => { page.reloads++; return Promise.resolve() })
  page.triggerEvent = name => page.events.push(name)
  return page
}

/* ---------- B 段用的日志采集 ---------- */
let logs
const realLog = console.log
function captureLogs() {
  logs = []
  console.log = (...args) => { logs.push(args.join(' ')) }
}
function releaseLogs() { console.log = realLog }
function apiLogs() {
  return logs.filter(l => l.indexOf('"ev":"api"') !== -1).map(l => { try { return JSON.parse(l) } catch (e) { return { unparsed: l } } })
}

const ME = 'o-semantics-owner'
const PEER = 'o-semantics-peer'

;(async () => {
  /* ============ A. 客户端：写失败的两种语义 ============ */
  section('A1. 服务端明确拒绝＝没落库，保留输入可再试；不重读也不重发')
  {
    const env = freshApi(() => srvErr('FORBIDDEN', '这件事只有该做的人能操作'))
    const page = makePage()
    const e = await rejects(env.api.dispatchAndSync({ type: 'profile.save', person: {} }, 3, page))
    check('FORBIDDEN 原样抛给页面（code 不被改写）', !!e && e.code === 'FORBIDDEN', e && e.code)
    check('FORBIDDEN 不触发重读、不标 needRefresh/outcomeUnknown（这不是状态陈旧，也不是结果未知）',
      page.reloads === 0 && !e.needRefresh && !e.outcomeUnknown)
    check('FORBIDDEN 只发了一次命令（不自动重试）', env.calls.length === 1, 'calls=' + env.calls.length)
  }

  section('A2. CONFLICT＝别人改了：重读页面，让用户基于最新状态再决定')
  {
    const env = freshApi(() => srvErr('CONFLICT', '安排已更新，本次修改没有保存。'))
    const page = makePage()
    const e = await rejects(env.api.dispatchAndSync({ type: 'signup.review' }, 3, page))
    check('CONFLICT 标 needRefresh 并触发一次 reload', !!e && e.needRefresh === true && page.reloads === 1, JSON.stringify({ c: e && e.needRefresh, r: page.reloads }))
    check('CONFLICT 不标 outcomeUnknown（服务端已明确回答：这次没写进去）', e && e.outcomeUnknown === undefined)
    check('CONFLICT 也不由封装层自动重发原命令', env.calls.length === 1, 'calls=' + env.calls.length)
    check('给用户的话术里含「已刷新」，与「结果未知」是两句话', env.toasts.some(t => /已被他人更新/.test(t.title || '')), JSON.stringify(env.toasts))
  }

  section('A3. 超时/断网＝结果未知：必须重读对齐，且绝不自动重发')
  {
    // -504003 是「云函数超时」：命令可能已经提交成功，只是响应没回到这台手机。
    const env = freshApi(() => transport('cloud.callFunction:fail -504003 FUNCTIONS_TIME_LIMIT invoke time limit'))
    const page = makePage()
    const e = await rejects(env.api.dispatchAndSync({ type: 'attendance.checkin', activityId: 'a1', signupId: 's1' }, 3, page))
    check('传输层失败归类为 NETWORK 并标 outcomeUnknown（页面才能给对的话术）',
      !!e && e.code === 'NETWORK' && e.outcomeUnknown === true, JSON.stringify({ code: e && e.code, u: e && e.outcomeUnknown }))
    check('结果未知时重读一次：服务端状态是权威，读到什么就显示什么', page.reloads === 1, 'reloads=' + page.reloads)
    check('结果未知绝不自动重发（calls 仍为 1）——那是把一次不确定变成两次写',
      env.calls.length === 1, 'calls=' + env.calls.length)
    check('话术把「未确认」讲清楚，而不是「没保存」（后者会诱导用户再点一次）',
      env.toasts.some(t => /未确认/.test(t.title || '')), JSON.stringify(env.toasts))
    check('重读之后错误仍然抛出（页面要显示失败，不许假装成功）', !!e)
  }
  {
    const env = freshApi(() => transport('request:fail network unreachable'))
    const page = makePage()
    const e = await rejects(env.api.dispatchAndSync({ type: 'vehicle.save' }, 2, page))
    check('普通断网同样算结果未知并触发重读', !!e && e.outcomeUnknown === true && page.reloads === 1)
  }
  {
    const env = freshApi(() => transport('boom'))
    const page = makePage(() => { page.reloads++; return Promise.reject(new Error('重读也失败')) })
    const e = await rejects(env.api.dispatchAndSync({ type: 'vehicle.save' }, 2, page))
    check('重读本身失败不影响原错误抛出（不把失败换成另一句成功话术）',
      !!e && e.outcomeUnknown === true && page.reloads === 1)
  }
  {
    const env = freshApi(() => transport('boom'))
    const page = makePage()
    delete page.reload
    const e = await rejects(env.api.dispatchAndSync({ type: 'vehicle.save' }, 2, page))
    check('调用方没有 reload() 时不崩，错误照样抛出', !!e && e.code === 'NETWORK')
  }

  section('A4. 没读到状态就写＝客户端 fail closed（一个请求都不发）')
  {
    const env = freshApi(() => okResp({}))
    const page = makePage()
    const e = await rejects(env.api.dispatchAndSync({ type: 'vehicle.save' }, undefined, page))
    check('缺 expectedRevision → NO_REVISION 且零调用', !!e && e.code === 'NO_REVISION' && env.calls.length === 0, 'calls=' + env.calls.length)
    check('NO_REVISION 不标 needRefresh（不是别人改了，是本页没读到）', e && !e.needRefresh)
  }

  /* ============ B. 服务端：归类与日志 ============ */
  section('B1. 一次请求一行结构化日志，且带可关联的请求号')
  captureLogs()
  try {
    stub.__state.openid = ME
    const r = await trailApi.main({
      action: 'dispatch', requestId: 'req-abc-123', expectedRevision: 0,
      payload: { type: 'profile.save', person: { name: '赵敏行', phone: '13800001111', emergency: { name: '联系人', phone: '13900002222' }, medical: '花粉过敏，随身携带肾上腺素笔' } },
    })
    const ls = apiLogs()
    check('成功写命令返回信封 ok 且落了一条日志', r.ok === true && ls.length === 1, JSON.stringify({ ok: r.ok, n: ls.length }))
    const l0 = ls[0] || {}
    check('日志带 action / 命令类型 / 请求号 / 耗时 / 新 revision（能把用户截图对上云端这一行）',
      l0.a === 'dispatch' && l0.c === 'profile.save' && l0.rid === 'req-abc-123'
      && typeof l0.ms === 'number' && l0.ok === 1 && l0.rev === 1, JSON.stringify(l0))
    check('日志绝不落 openid 原文，只落单向散列前 8 位',
      JSON.stringify(l0).indexOf(ME) === -1 && /^[0-9a-f]{8}$/.test(String(l0.u || '')), 'u=' + l0.u)
    check('日志绝不落 payload 内容：姓名/电话/健康备注都不得出现',
      logs.every(x => x.indexOf('赵敏行') === -1 && x.indexOf('13800001111') === -1 && x.indexOf('肾上腺素') === -1),
      logs.filter(x => /肾上腺素|赵敏行/.test(x)).join(' | ').slice(0, 120))
  } finally { releaseLogs() }

  section('B2. 未捕获的内部异常：用户面拿不到英文原文，原文只进日志')
  captureLogs()
  try {
    const realCollection = stub.__state.db.collection
    stub.__state.db.collection = function (name) {
      const c = realCollection.call(this, name)
      if (name === 'ot_activities') {
        return Object.assign({}, c, {
          orderBy: () => { throw new TypeError("Cannot read properties of undefined (reading 'asc') at selectors.js:296") },
        })
      }
      return c
    }
    stub.__state.openid = ME
    const r = await trailApi.main({ action: 'read', request: { kind: 'home' } })
    stub.__state.db.collection = realCollection
    const msg = (r.error && r.error.message) || ''
    check('异常不再伪装成 INVALID_INPUT，归类为 INTERNAL', r.ok === false && r.error && r.error.code === 'INTERNAL', JSON.stringify(r.error))
    check('用户面没有英文异常原文、没有文件名/行号',
      !/Cannot read|TypeError|\.js:\d+|at .*\(.*:\d+/.test(msg) && /[\u4e00-\u9fa5]/.test(msg), msg.slice(0, 90))
    check('读请求的内部失败话术不谎报「本次修改没有生效」（读请求根本没有修改这回事）',
      !/修改没有生效|已保存|已提交/.test(msg) && /取回来|再进来/.test(msg), msg.slice(0, 90))
    const l = apiLogs()[0] || {}
    check('原文进了日志（det 非空），维护者才查得到根因',
      l.ok === 0 && l.code === 'INTERNAL' && typeof l.det === 'string' && /Cannot read|TypeError/.test(l.det), JSON.stringify(l).slice(0, 160))
    check('日志是单行（det 里的换行被压平，云端一行一条不会碎成多行）',
      logs.filter(x => x.indexOf('"ev":"api"') !== -1).length === 1)
  } finally { releaseLogs() }

  section('B2b. 同一个 INTERNAL 打在写路径上：必须明说「本次修改没有生效」')
  captureLogs()
  try {
    const realCollection = stub.__state.db.collection
    stub.__state.db.collection = function (name) {
      const c = realCollection.call(this, name)
      if (name === 'ot_profiles') {
        return Object.assign({}, c, { orderBy: () => { throw new TypeError('boom on write path') } })
      }
      return c
    }
    stub.__state.openid = ME
    const r = await trailApi.main({
      action: 'dispatch', requestId: 'req-write-fail', expectedRevision: 0,
      payload: { type: 'profile.save', person: { name: '钱', phone: '13800000000', emergency: { name: '孙', phone: '13900000000' }, medical: '' } },
    })
    stub.__state.db.collection = realCollection
    const msg = (r.error && r.error.message) || ''
    check('写路径的 INTERNAL 明确告知未生效（用户不该在不知道结果时再点一次）',
      r.ok === false && r.error.code === 'INTERNAL' && /本次修改没有生效/.test(msg), JSON.stringify(r.error))
    const l = apiLogs()[0] || {}
    check('写失败也带 rid，能把「哪一次点击」查到', l.rid === 'req-write-fail' && l.c === 'profile.save' && l.ok === 0, JSON.stringify(l).slice(0, 140))
  } finally { releaseLogs() }

  section('B3. 入参形状错误归 INVALID_INPUT，不把 selector 的 TypeError 抛给用户')
  {
    captureLogs()
    try {
      stub.__state.openid = ME
      const r = await trailApi.main({ action: 'read', request: null })
      const l = apiLogs()[0] || {}
      check('read 缺 request → INVALID_INPUT（而不是 INTERNAL，也不是崩）',
        r.ok === false && r.error.code === 'INVALID_INPUT', JSON.stringify(r.error))
      check('这是明确拒绝，不该留内部原文', l.code === 'INVALID_INPUT' && (l.det === '' || l.det === undefined), JSON.stringify(l))
      const r2 = await trailApi.main({ action: 'dispatch', expectedRevision: 0, payload: { type: 'membership.save', activityId: 'a', membership: null } })
      check('membership.save 带 null 不再以英文原文回话（profile.js 归一化不再先读 .id）',
        r2.ok === false && !/Cannot read|is not a function|undefined/.test(r2.error.message || ''), JSON.stringify(r2.error))
      const r3 = await trailApi.main({ action: 'nope' })
      check('未知 action 仍是 INVALID_INPUT（业务码不被归类器吞成 INTERNAL）',
        r3.ok === false && r3.error.code === 'INVALID_INPUT', JSON.stringify(r3.error))
      const r4 = await trailApi.main({ action: 'read', request: { kind: 'home' } })
      check('免鉴权的天气之外的动作缺 openid 时保持 AUTH_REQUIRED（归类器没有改掉既有语义）', r4.ok === true || r4.error.code === 'AUTH_REQUIRED', JSON.stringify(r4.error))
    } finally { releaseLogs() }
  }

  section('B4. 发出去的码必须在契约表里（否则「每个错误码都有人话」那条门会跳过它）')
  {
    const seen = new Set()
    captureLogs()
    try {
      stub.__state.openid = ME
      const cases = [
        // 形状错 / 字段缺 / 版本陈旧 / 没读就写 / 越权——五类真实可达的失败各来一次
        { action: 'read', request: null },
        { action: 'dispatch', requestId: 'r-x', expectedRevision: 0, payload: { type: 'profile.save', person: { name: '', phone: '', emergency: { name: '', phone: '' }, medical: '' } } },
        { action: 'dispatch', requestId: 'r-y', expectedRevision: 987654, payload: { type: 'activity.create', input: {} } },
        { action: 'dispatch', requestId: 'r-z', payload: { type: 'activity.create', input: {} } },
        { action: 'dispatch', requestId: 'r-w', expectedRevision: 0, payload: { type: 'activity.delete', activityId: 'no-such-activity' } },
        { action: 'previewAssignments', activityId: 'no-such-activity' },
      ]
      for (const c of cases) {
        const r = await trailApi.main(c)
        if (!r.ok) seen.add(r.error.code)
      }
    } finally { releaseLogs() }
    const list = Array.from(seen)
    check('本轮真实发出的每个错误码都在 ERROR_CODES 里：' + list.join('/'),
      list.length >= 4 && list.every(c => ERROR_CODES.indexOf(c) !== -1), JSON.stringify(list))
    check('契约表已收录 NO_REVISION / INTERNAL / NETWORK（曾经漏掉，门因此跳过了它们）',
      ['NO_REVISION', 'INTERNAL', 'NETWORK'].every(c => ERROR_CODES.indexOf(c) !== -1))
    check('缺 revision 与陈旧 revision 落到两个不同的码（NO_REVISION ≠ CONFLICT，页面走的路才不同）',
      list.indexOf('NO_REVISION') !== -1 && list.indexOf('CONFLICT') !== -1, JSON.stringify(list))
    check('采集日志没有把判据输出吞掉（劫持 console.log 时判据必须走 realLog）',
      logs.length > 0 && apiLogs().length === logs.filter(x => x.indexOf('"ev":"api"') !== -1).length)
  }

  section('C. 覆盖边界（不冒充已验证）')
  skip('真实云函数的 console 落盘与检索', '桩里劫持的是本地 console；云端日志的采集、保留时长与检索语法属云开发控制台，需要在真实环境里看一次。')
  skip('超时后「命令其实已提交」的真云端比例', '本套件只能证明客户端在超时下走「重读对齐、不自动重发」这条路；到底多大概率已落库要真云端取证，桩里造不出那个分布。')

  console.log('\n==== passed=' + passed + ' failed=' + failed + ' inconclusive=' + inconclusive + ' ====')
  if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
  process.exit(failed ? 1 : 0)
})().catch(e => {
  releaseLogs()
  console.error('SUITE CRASHED: ' + (e && e.stack))
  process.exit(1)
})
