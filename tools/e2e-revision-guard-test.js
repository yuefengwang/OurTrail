// 服务端 revision 漏斗门：node tools/e2e-revision-guard-test.js
//
// 补的是 e2e-test.js 没覆盖的一面：**「expectedRevision 缺失」这条路径在服务器上必须失败关闭**。
// 现状（index.js:122）把它缺省成"服务端当前 revision"，于是两道保护同时失效：
//   · commands.js:122 的 CONFLICT 检查变成永真（缺省值必然等于 state.revision）；
//   · schema 的 expectedRevision: specCount 校验被喂了假值，也过了。
// 客户端 utils/api.js:99 已经堵了自己的口（BUG-C1），但**小程序客户端是会滞后于云函数的**：
// 旧版本包仍在发不带 revision 的命令，服务器无法拒绝 ⇒ 后写者静默覆盖前写者（数据无损、无人报错、
// 谁也查不出来）。e2e-test.js:111 那句注释「传 undefined → 服务端按当前 revision 提交」正是这个洞
// 被当成特性用下来的证据，本套件把它改判为缺陷。
//
// 判据全部落在**最终数据状态**上：被拒的写必须零落库（revision 不变 + 字段不变），
// 且补齐 revision 后同一命令要能正常提交（拒绝不能变成永久卡死）。
'use strict'
const path = require('path')
const Module = require('module')

const STUB = path.join(__dirname, 'stub-wx-server-sdk.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return STUB
  return origResolve.call(this, request, ...rest)
}

const stub = require('./stub-wx-server-sdk')
stub.__state.db = stub.__fakeDb()

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const trailApi = require('../cloudfunctions/trailApi/index')

const LIN = 'o-guard-lin'
const CHEN = 'o-guard-chen'

// 形状对齐 e2e-test.js 的 person()：字段名不一样会被 schema 判成 INVALID_INPUT，
// 那会把"洞"伪装成"参数错"，所以这里必须用真实形状。
const person = (name, phone, ename, ephone) =>
  ({ name, phone, emergency: { name: ename, phone: ephone }, medical: '', avatar: '' })

function as(openid) {
  const call = (action, extra) => {
    stub.__state.openid = openid
    return trailApi.main(Object.assign({ action }, extra))
  }
  return {
    readProfile: () => call('read', { request: { kind: 'profile' } }),
    // 忠实镜像客户端 api.js：三个形参一个都不补，缺失就原样送进服务器
    dispatchRaw: body => call('dispatch', body),
    dispatch: (payload, expectedRevision, requestId) =>
      call('dispatch', { payload, expectedRevision, requestId }),
  }
}

const lin = as(LIN)
const chen = as(CHEN)

async function revision(who) {
  const r = await who.readProfile()
  return r.ok ? r.data.revision : null
}

/** 档案里的人名；未建档时返回 null（用它证"零落库"，比 revision 更硬）。 */
async function profileName(who) {
  const r = await who.readProfile()
  const p = r.ok && r.data.view ? r.data.view.profile : null
  return p && p.person ? p.person.name : null
}

;(async () => {
  section('0. 建立：带正确 revision 的正常写必须成功（防误伤）')
  const r0 = await lin.dispatch({ type: 'profile.save', person: person('林溪', '00000000001', '林母', '00000000051') }, 0)
  check('首次建档（expectedRevision=0）ok', r0.ok === true, JSON.stringify(r0.error || ''))
  check('建档后 revision 前进到 1', (await revision(lin)) === 1, 'got ' + await revision(lin))
  check('建档可回读', (await profileName(lin)) === '林溪', 'got ' + await profileName(lin))

  section('1. 主案：缺 expectedRevision 的命令必须被服务器拒绝，且零落库')
  {
    const before = await revision(lin)
    const r = await chen.dispatchRaw({
      payload: { type: 'profile.save', person: person('陈屿', '99999999999', '陈父', '00000000052') },
      requestId: 'guard-missing-rev-1',
    })
    check('缺 revision ⇒ 拒绝', r.ok === false, '竟然成功了：' + JSON.stringify(r.data || {}))
    check('错误码是 NO_REVISION（与客户端 api.js 同词汇：页面走"重开页面"而不是"保留输入重试"）',
      !!(r.error && r.error.code === 'NO_REVISION'), JSON.stringify(r.error || {}))
    check('被拒的写没有推进全局 revision', (await revision(lin)) === before,
      before + ' → ' + await revision(lin))
    const nameBefore = await profileName(chen)
    check('被拒的写没有落库（档案仍是拒前状态）', (await profileName(chen)) === nameBefore,
      JSON.stringify(nameBefore) + ' → ' + JSON.stringify(await profileName(chen)))
  }

  section('2. 非整数 revision 同样失败关闭（旧客户端会发空串 / null / 字符串 "2" / 小数）')
  for (const bad of [null, '', '2', 1.5]) {
    const before = await revision(lin)
    const nameBefore = await profileName(chen)
    const r = await chen.dispatchRaw({
      payload: { type: 'profile.save', person: person('陈屿', '99999999999', '陈父', '00000000052') },
      requestId: 'guard-bad-' + JSON.stringify(bad),
      expectedRevision: bad,
    })
    const after = await revision(lin)
    check('expectedRevision=' + JSON.stringify(bad) + ' ⇒ NO_REVISION 且零落库',
      r.ok === false && !!(r.error && r.error.code === 'NO_REVISION') && after === before
        && (await profileName(chen)) === nameBefore,
      JSON.stringify(r.error || r.data || {}) + ' rev ' + before + '→' + after)
  }

  section('3. 陈旧 revision 仍是 CONFLICT（既有保护不许被改弱）')
  {
    const cur = await revision(lin)
    const nameBefore = await profileName(chen)
    const r = await chen.dispatch({
      type: 'profile.save', person: person('陈屿', '99999999999', '陈父', '00000000052'),
    }, Math.max(0, cur - 1), 'guard-stale-1')
    check('陈旧 revision ⇒ CONFLICT', r.ok === false && !!(r.error && r.error.code === 'CONFLICT'),
      JSON.stringify(r.error || {}))
    check('CONFLICT 零落库（名字仍是拒前的值）', (await profileName(chen)) === nameBefore,
      nameBefore + ' → ' + await profileName(chen))
    check('CONFLICT 不推进 revision', (await revision(lin)) === cur, 'now ' + await revision(lin))
  }

  section('4. 补齐 revision 后同一命令可正常提交（拒绝不是永久卡死）')
  {
    const cur = await revision(lin)
    const r = await chen.dispatch({
      type: 'profile.save', person: person('陈屿', '00000000002', '陈父', '00000000052'),
    }, cur, 'guard-recovered-1')
    check('带正确 revision 重发 ok', r.ok === true, JSON.stringify(r.error || ''))
    check('数据确实落库', (await profileName(chen)) === '陈屿', 'got ' + await profileName(chen))
  }

  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
})().catch(e => {
  console.error('harness error:', e && (e.stack || e.message))
  process.exit(1)
})
