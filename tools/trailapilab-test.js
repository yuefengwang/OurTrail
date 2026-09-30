// trailApiLab 云函数集成测试：node tools/trailapilab-test.js
// 通过 Module._resolveFilename 把 wx-server-sdk 指到内存桩（tools/stub-wx-server-sdk.js），
// 让 exports.main 连同 store.js 持久化管线（loadState → reduce → CAS persist）真实跑起来。
// 覆盖：鉴权矩阵（白名单/secret/全无）→ ping → seed 阶段 0（真实落库）→ 幂等重放 →
//       inspect 状态板 → 错误阶段 → cleanup。剧本业务语义由 lab-dryrun-test 覆盖，不在此重复。
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
const cfg = require('../cloudfunctions/trailApiLab/lab.config')
stub.__state.db = stub.__fakeDb() // index.js 在模块加载时即调 cloud.database()，须先就位

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const lab = require('../cloudfunctions/trailApiLab/index')

async function main() {
  section('1. 鉴权矩阵')
  {
    cfg.LAB_SECRET = ''
    cfg.OWNER_OPENIDS = []
    stub.__state.openid = ''
    const r = await lab.main({ action: 'ping' })
    check('无白名单命中且无 secret → FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r))
    check('报错带调用者身份码提示（方便加白）', (r.error.message || '').indexOf('身份码') !== -1, r.error && r.error.message)
  }
  {
    cfg.LAB_SECRET = 'test-secret'
    stub.__state.openid = ''
    const r = await lab.main({ action: 'ping', secret: 'wrong' })
    check('secret 不匹配 → FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r))
    const r2 = await lab.main({ action: 'ping', secret: 'test-secret' })
    check('secret 命中 → ok，authedVia=secret、无 openid 通道',
      r2.ok === true && r2.data.authedVia === 'secret' && r2.data.secretConfigured === true && r2.data.ownerAllowlist === 0,
      JSON.stringify(r2))
  }
  {
    cfg.OWNER_OPENIDS = ['o-real-owner']
    stub.__state.openid = 'o-real-owner'
    const r = await lab.main({ action: 'ping' })
    check('openid 白名单命中（不带 secret）→ ok，authedVia=openid 白名单',
      r.ok === true && r.data.authedVia === 'openid 白名单' && r.data.caller === 'o-real-owner', JSON.stringify(r))
    stub.__state.openid = 'o-stranger'
    const r2 = await lab.main({ action: 'ping' })
    check('白名单外的 openid 仍被拒', r2.ok === false && r2.error.code === 'FORBIDDEN', '')
    stub.__state.openid = 'o-real-owner'
  }

  section('2. seed 阶段 0：真实落库（loadState → reduce → CAS persist）')
  {
    const r = await lab.main({ action: 'seed', stage: 0 })
    check('seed 阶段 0 → ok，7 条命令全部成功',
      r.ok === true && r.data.executed.length === 7 && r.data.executed.every(x => x.ok === true),
      JSON.stringify(r.ok ? r.data.executed.filter(x => !x.ok) : r))
    check('5 个演员档案已写入内存库', stub.__state.db.__count('ot_profiles') === 5,
      String(stub.__state.db.__count('ot_profiles')))
  }

  section('3. 幂等重放：重跑阶段 0 零新变更')
  {
    const before = (await lab.main({ action: 'inspect' })).data.revision
    const r = await lab.main({ action: 'seed', stage: 0 })
    const after = (await lab.main({ action: 'inspect' })).data.revision
    check('重跑阶段 0 全部 replayed=true、revision 不变',
      r.ok === true && r.data.executed.every(x => x.ok && x.replayed === true) && before === after,
      'revision ' + before + '→' + after)
  }

  section('4. inspect 状态板')
  {
    const r = await lab.main({ action: 'inspect' })
    check('inspect → ok，board 六项、activity 为 null（还没建）',
      r.ok === true && r.data.board.length === 6 && r.data.activity === null, JSON.stringify(r.ok ? r.data.board.map(b => b.status) : r))
    check('状态板：建档 done、报名 blocked（提示建 [预演] 活动）',
      r.data.board[0].status === 'done' && r.data.board[1].status === 'blocked' && r.data.board[1].reason.indexOf('[预演]') !== -1,
      JSON.stringify(r.data.board.map(b => b.status)))
    check('演员名册 5 行', r.data.actors.length === 5, String(r.data.actors.length))
  }

  section('5. 错误阶段与未建活动')
  {
    const r1 = await lab.main({ action: 'seed', stage: 1 })
    check('未建活动时 seed 阶段 1 → NOT_FOUND（提示建 [预演] 活动）',
      r1.ok === false && r1.error.code === 'NOT_FOUND' && r1.error.message.indexOf('[预演]') !== -1, JSON.stringify(r1))
    const r2 = await lab.main({ action: 'seed', stage: 1, activityId: 'act-not-exist' })
    check('不存在的 activityId → WRONG_PHASE（找不到活动）',
      r2.ok === false && r2.error.code === 'WRONG_PHASE' && r2.error.message.indexOf('找不到活动') !== -1, JSON.stringify(r2))
    const r3 = await lab.main({ action: 'seed', stage: 9 })
    check('未知阶段 → WRONG_PHASE（可用阶段清单）',
      r3.ok === false && r3.error.code === 'WRONG_PHASE' && r3.error.message.indexOf('未知阶段') === 0, JSON.stringify(r3))
  }

  section('6. cleanup')
  {
    const r = await lab.main({ action: 'cleanup', profiles: true })
    check('cleanup profiles → ok，档案与回执清空',
      r.ok === true && r.data.removed.profiles === 5 && r.data.removed.receipts === 7, JSON.stringify(r.ok ? r.data.removed : r))
    const after = await lab.main({ action: 'inspect' })
    check('清理后演员名册为空、建档阶段回到 ready',
      after.data.actors.length === 0 && after.data.board[0].status === 'ready',
      JSON.stringify(after.data.board.map(b => b.status)))
  }

  section('7. 动态白名单管理（存库，免部署）')
  {
    stub.__state.openid = 'o-stranger'
    const r0 = await lab.main({ action: 'allowlist.list' })
    check('白名单外账号不能管理名单', r0.ok === false && r0.error.code === 'FORBIDDEN', JSON.stringify(r0))
    stub.__state.openid = 'o-real-owner'
    const r1 = await lab.main({ action: 'allowlist.add', id: 'o-dev-1' })
    check('白名单内账号添加开发者 → ok', r1.ok === true && r1.data.ids.indexOf('o-dev-1') !== -1, JSON.stringify(r1))
    const r2 = await lab.main({ action: 'allowlist.add', id: 'o-dev-1' })
    check('重复添加 → INVALID_INPUT', r2.ok === false && r2.error.code === 'INVALID_INPUT', JSON.stringify(r2))
    const r3 = await lab.main({ action: 'allowlist.add', id: 'o-real-owner' })
    check('配置内身份码 → 提示已在配置白名单', r3.ok === false && r3.error.code === 'INVALID_INPUT' && r3.error.message.indexOf('配置') !== -1, JSON.stringify(r3))
    stub.__state.openid = 'o-dev-1'
    const r4 = await lab.main({ action: 'ping' })
    check('动态加白立即生效（新身份码可调 ping）', r4.ok === true && r4.data.authedVia === 'openid 白名单', JSON.stringify(r4))
    stub.__state.openid = 'o-real-owner'
    const r5 = await lab.main({ action: 'allowlist.remove', id: 'o-dev-1' })
    check('移除 → ok', r5.ok === true && r5.data.ids.indexOf('o-dev-1') === -1, JSON.stringify(r5))
    const r6 = await lab.main({ action: 'allowlist.remove', id: 'o-real-owner' })
    check('配置固定身份码不可移除 → NOT_FOUND', r6.ok === false && r6.error.code === 'NOT_FOUND', JSON.stringify(r6))
    stub.__state.openid = 'o-dev-1'
    const r7 = await lab.main({ action: 'ping' })
    check('移除后立即失效', r7.ok === false && r7.error.code === 'FORBIDDEN', JSON.stringify(r7))
    stub.__state.openid = 'o-real-owner'
  }

  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=0')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  failed++
  console.error('  ✗ 集成测试执行异常（' + ((e && e.stack) || e) + '）')
  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=0')
  process.exit(1)
})
