// 命令通道业务场景测试：node tools/scenario-api-test.js
// 对象：miniprogram/utils/api.js —— 全站 31 处调用点共用的命令封装。
// 目的：把「页面发什么命令、冲突了怎么办、错误怎么变成用户可读文案」这条链在 node 下兜住。
// 手法：与 tools/weather-page-test.js 同一风格；桩 global.wx.cloud.callFunction，
//       每个用例重建 global.wx 与 require 缓存，保证互不污染。
'use strict'
const API_PATH = require.resolve('../miniprogram/utils/api')
const CONFIG_PATH = require.resolve('../miniprogram/config')
const FUNC_NAME = require('../miniprogram/config').FUNC_NAME

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

// ---- 桩环境 ----
// respond(opts) 返回 callFunction 应答的 Promise；calls/toasts 由环境自动记录。
function freshApi(respond) {
  const env = { toasts: [], calls: [] }
  global.wx = {
    cloud: { callFunction(opts) { env.calls.push(opts); return respond(opts) } },
    showToast(o) { env.toasts.push(o) },
  }
  delete require.cache[API_PATH]
  delete require.cache[CONFIG_PATH]
  env.api = require(API_PATH)
  return env
}
const ok = (data) => Promise.resolve({ result: { ok: true, data } })
const srvErr = (code, message) => Promise.resolve({ result: { ok: false, error: { code, message } } })
async function rejects(p) { try { await p; return null } catch (e) { return e } }

async function main() {
  // ---- 1. 协议解包 ----
  section('1. 协议解包：成功 / 服务端错误 / 旧协议兼容')
  {
    const env = freshApi(() => ok({ view: { kind: 'home' }, revision: 7, now: 'now' }))
    const r = await env.api.read({ kind: 'home' })
    check('read 解包 data；调用名与 action、请求体正确',
      r.revision === 7 && env.calls.length === 1 && env.calls[0].name === FUNC_NAME
      && env.calls[0].data.action === 'read' && env.calls[0].data.request.kind === 'home',
      JSON.stringify(env.calls[0]).slice(0, 140))
  }
  {
    const env = freshApi(() => srvErr('FORBIDDEN', '只有未发布的草稿可以删除'))
    const e = await rejects(env.api.read({ kind: 'profile' }))
    check('服务端 ok:false → 抛错且 code/message 透传',
      !!e && e.code === 'FORBIDDEN' && e.message === '只有未发布的草稿可以删除',
      e && e.message)
  }
  {
    const env = freshApi(() => Promise.resolve({ result: { ok: false, error: '未知操作：read' } }))
    const e = await rejects(env.api.read({ kind: 'home' }))
    check('旧协议 error 为字符串 → message=字符串、code 兜底 INVALID_INPUT',
      !!e && e.message === '未知操作：read' && e.code === 'INVALID_INPUT', e && e.message)
  }
  {
    const env = freshApi(() => Promise.resolve({}))
    const e = await rejects(env.api.read({ kind: 'home' }))
    check('未部署（无 result）→ 提示部署话术',
      !!e && /没有返回结果/.test(e.message) && /部署/.test(e.message), e && e.message)
  }
  {
    const env = freshApi(() => Promise.resolve({ result: { errMsg: 'cloud exec failed' } }))
    const e = await rejects(env.api.read({ kind: 'home' }))
    check('result.errMsg 兜底 → message=errMsg', !!e && e.message === 'cloud exec failed', e && e.message)
  }

  // ---- 2. 网络层异常分类 ----
  section('2. 网络层异常分类（code=NETWORK 的四种话术）')
  {
    const env = freshApi(() => Promise.reject({ errMsg: 'errCode: -404011 cloud function not found' }))
    const e = await rejects(env.api.read({ kind: 'home' }))
    check('not found → 部署话术', !!e && e.code === 'NETWORK' && /尚未部署/.test(e.message) && /上传并部署/.test(e.message), e && e.message)
  }
  {
    const env = freshApi(() => Promise.reject({ errMsg: '-504003 FUNCTIONS_TIME_LIMIT_EXCEEDED' }))
    const e = await rejects(env.api.read({ kind: 'home' }))
    check('-504003 → 超时处置话术（20 秒配置指引）', !!e && e.code === 'NETWORK' && /超时/.test(e.message) && /20 秒/.test(e.message), e && e.message)
  }
  {
    const env = freshApi(() => Promise.reject({ errMsg: 'request timed out' }))
    const e = await rejects(env.api.read({ kind: 'home' }))
    check('timed out 同样归类超时', !!e && e.code === 'NETWORK' && /超时/.test(e.message), e && e.message)
  }
  {
    const env = freshApi(() => Promise.reject({ errMsg: 'boom' }))
    const e = await rejects(env.api.read({ kind: 'home' }))
    check('其他 errMsg → 云函数调用失败：boom', !!e && e.code === 'NETWORK' && e.message === '云函数调用失败：boom', e && e.message)
  }
  {
    const env = freshApi(() => Promise.reject({}))
    const e = await rejects(env.api.read({ kind: 'home' }))
    check('空 errMsg → 网络异常话术', !!e && e.code === 'NETWORK' && e.message === '网络异常，请稍后再试', e && e.message)
  }
  {
    const env = freshApi(() => Promise.reject(Object.assign(new Error('revision conflict'), { code: 'CONFLICT' })))
    const e = await rejects(env.api.read({ kind: 'home' }))
    check('已是带 code 的 Error 原样透传（不被二次包装成 NETWORK）',
      !!e && e.code === 'CONFLICT' && e.message === 'revision conflict', e && (e.code + ' ' + e.message))
  }

  // ---- 3. dispatch：requestId 幂等与 CONFLICT 语义 ----
  section('3. dispatch：requestId 与 CONFLICT 标记')
  {
    const env = freshApi(() => ok({ targetIds: ['t1'], replayed: false }))
    await env.api.dispatch({ kind: 'activity.create' }, 5, 'req-fixed')
    check('透传 payload/expectedRevision/固定 requestId',
      env.calls[0].data.action === 'dispatch' && env.calls[0].data.payload.kind === 'activity.create'
      && env.calls[0].data.expectedRevision === 5 && env.calls[0].data.requestId === 'req-fixed',
      JSON.stringify(env.calls[0].data).slice(0, 140))
  }
  {
    const env = freshApi(() => ok({ targetIds: [], replayed: false }))
    await env.api.dispatch({ kind: 'x' }, 1)
    const id = env.calls[0].data.requestId
    check('未传 requestId 时自动生成非空 id', typeof id === 'string' && id.length >= 6, String(id))
  }
  {
    const env = freshApi(() => ok({ targetIds: [], replayed: false }))
    await env.api.dispatch({ kind: 'x' }, 1, 'req-1')
    await env.api.dispatch({ kind: 'x' }, 2, 'req-1')
    check('重放场景：同一 requestId 两次原样透传（幂等键由调用方掌控）',
      env.calls[0].data.requestId === 'req-1' && env.calls[1].data.requestId === 'req-1', '')
  }
  {
    const env = freshApi(() => srvErr('CONFLICT', '请刷新后重试'))
    const e = await rejects(env.api.dispatch({ kind: 'x' }, 1))
    check('CONFLICT → 挂 needRefresh=true 后再抛', !!e && e.code === 'CONFLICT' && e.needRefresh === true, e && e.code)
  }
  {
    const env = freshApi(() => srvErr('FORBIDDEN', '越权'))
    const e = await rejects(env.api.dispatch({ kind: 'x' }, 1))
    check('非 CONFLICT 不挂 needRefresh', !!e && e.code === 'FORBIDDEN' && e.needRefresh === undefined, e && e.code)
  }

  // ---- 4. dispatchAndSync：冲突自愈 ----
  section('4. dispatchAndSync：CONFLICT 自动重读')
  {
    const env = freshApi(() => srvErr('CONFLICT', '请刷新后重试'))
    const reloads = []
    const page = { reload: () => { reloads.push(1); return Promise.resolve() } }
    const e = await rejects(env.api.dispatchAndSync({ kind: 'x' }, 1, page))
    check('CONFLICT：恰好重读一次并弹提示，错误仍向上抛（调用方要 catch）',
      !!e && e.code === 'CONFLICT' && reloads.length === 1 && env.toasts.length === 1
      && env.toasts[0].title.indexOf('安排已被他人更新') === 0,
      'reloads=' + reloads.length + ' toasts=' + env.toasts.length)
  }
  {
    const env = freshApi(() => srvErr('CONFLICT', '请刷新后重试'))
    const e = await rejects(env.api.dispatchAndSync({ kind: 'x' }, 1, {}))
    check('CONFLICT 但页面无 reload → 只拒绝不炸、不弹重读提示',
      !!e && e.code === 'CONFLICT' && env.toasts.length === 0, String(env.toasts.length))
  }
  {
    const env = freshApi(() => srvErr('CONFLICT', '请刷新后重试'))
    const reloads = []
    const page = { reload: () => { reloads.push(1); return Promise.reject(new Error('reload fail')) } }
    const e = await rejects(env.api.dispatchAndSync({ kind: 'x' }, 1, page))
    check('reload 自身失败被吞掉，原 CONFLICT 错误不受影响',
      !!e && e.code === 'CONFLICT' && reloads.length === 1, e && e.message)
  }
  {
    const env = freshApi(() => srvErr('FORBIDDEN', '越权'))
    const reloads = []
    const page = { reload: () => { reloads.push(1); return Promise.resolve() } }
    const e = await rejects(env.api.dispatchAndSync({ kind: 'x' }, 1, page))
    check('非 CONFLICT：不重读、不提示', !!e && e.code === 'FORBIDDEN' && reloads.length === 0 && env.toasts.length === 0, '')
  }

  // ---- 5. readOr ----
  section('5. readOr：Result 型读取的解包')
  {
    const env = freshApi(() => ok({ ok: true, value: { rows: [1, 2] } }))
    const v = await env.api.readOr('readTransport', { activityId: 'a1' })
    check('ok:true → 返回 value；action 与参数透传',
      v.rows.length === 2 && env.calls[0].data.action === 'readTransport' && env.calls[0].data.activityId === 'a1', '')
  }
  {
    const env = freshApi(() => ok({ ok: false, error: { code: 'NOT_FOUND', message: '报名不存在' } }))
    const e = await rejects(env.api.readOr('readForm', { activityId: 'a1', signupId: 's1', purpose: 'edit' }))
    check('ok:false → 抛带 code/message 的错', !!e && e.code === 'NOT_FOUND' && e.message === '报名不存在', e && e.message)
  }

  // ---- 6. Result 透传型 / previewAssignments / getWeather ----
  section('6. 透传型接口：页面契约不被 api 层吃掉')
  {
    const data = { ok: true, value: { view: { kind: 'form' }, purpose: 'edit' } }
    const env = freshApi(() => ok(data))
    const r = await env.api.readForm('a1', 's1', 'edit')
    check('readForm 原样透传（不拆包），参数齐全',
      r === data && r.ok === true && env.calls[0].data.activityId === 'a1'
      && env.calls[0].data.signupId === 's1' && env.calls[0].data.purpose === 'edit', '')
  }
  {
    const data = { ok: false, error: { code: 'FORBIDDEN', message: '无权查看' } }
    const env = freshApi(() => ok(data))
    const r = await env.api.readSensitive('a1', 's1', 'emergency')
    check('readSensitive 的 ok:false 也由页面自行判断（api 不抛）', r === data && r.ok === false, '')
  }
  {
    const env = freshApi(() => ok({ assignments: [], unassigned: [] }))
    const r = await env.api.previewAssignments('a1')
    check('previewAssignments 成功 → 重建 {ok:true,value}', r.ok === true && r.value.unassigned.length === 0, JSON.stringify(r).slice(0, 100))
  }
  {
    const env = freshApi(() => srvErr('FORBIDDEN', '无权分车'))
    const r = await env.api.previewAssignments('a1')
    check('previewAssignments 失败 → 不抛，重建 {ok:false,error.message}',
      r.ok === false && r.error.message === '无权分车' && r.error.code === undefined, JSON.stringify(r).slice(0, 100))
  }
  {
    const env = freshApi(() => ok({ status: 'ready', days: [], detail: [] }))
    const r = await env.api.getWeather('a1', 'p1', '2026-10-03')
    check('getWeather 原样返回 {status,...}；三参与齐',
      r.status === 'ready' && env.calls[0].data.action === 'getWeather'
      && env.calls[0].data.pointId === 'p1' && env.calls[0].data.date === '2026-10-03', '')
  }
}

main()
  .catch(e => { failed++; console.error('  ✗ 用例执行异常（' + (e && e.message) + '）') })
  .then(() => {
    console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=0')
    process.exit(failed ? 1 : 0)
  })
