// 发现页服务端筛选：日期/难度/排序，旧请求（只有 search）行为不变。
// 运行：node tools/discover-filter-test.js
'use strict'
const crypto = require('crypto')
const { reduceCommand, genId } = require('../cloudfunctions/trailApi/domain/commands')
const { canonicalPayload } = require('../cloudfunctions/trailApi/domain/contracts')
const { selectView } = require('../cloudfunctions/trailApi/domain/selectors')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const NOW = new Date()
const nowIso = new Date(NOW.getTime() + 60000).toISOString()
const A = 'actor-a'
let tick = 0
// 每次命令推进 1 秒：publishedAt 才有先后，发布时间倒序才可测。
const ctx = () => ({ now: new Date(NOW.getTime() + (tick++) * 1000).toISOString(), id: genId })
const fp = payload => crypto.createHash('sha256').update(canonicalPayload(payload), 'utf8').digest('hex')

function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: nowIso,
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], tasks: [], plans: [], receipts: [],
  }
}
function dispatch(state, payload) {
  return reduceCommand(state, {
    actor: { userId: A }, requestId: genId('req'),
    expectedRevision: state.revision, fingerprint: fp(payload), payload,
  }, ctx())
}
function ok(r, label) {
  if (!r.ok) throw new Error(label + ' failed: ' + JSON.stringify(r.error))
  return r.value.state
}
function isoOffset(days, hour) {
  const d = new Date(Date.now() + days * 86400000)
  d.setUTCHours((hour || 8) - 8, 0, 0, 0) // 北京时间 hour:00
  return d.toISOString()
}
function cnDate(days) {
  return new Date(Date.now() + 8 * 3600000 + days * 86400000).toISOString().slice(0, 10)
}
function input(id, over) {
  return Object.assign({
    title: id, description: '筛选测试', organizerIntro: '',
    startAt: isoOffset(5, 8), endAt: isoOffset(5, 18), deadlineAt: isoOffset(4, 20),
    acceptingSignups: true, capacity: 10, approvalMode: 'manual', routeId: null,
    routeSnapshot: {
      title: '测试路线', distanceKm: 8, ascentM: 400,
      difficulty: 'easy',
      points: [{ id: id + '-pt', name: '起点', kind: 'start', coordinates: { lat: 30, lng: 103 } }],
      risks: [],
    },
    pickupPoints: [{ id: id + '-pk', name: '集合点', meetingAt: isoOffset(5, 7), address: '测试地址', coordinates: null }],
    equipment: [], equipmentSuggested: [], feeNote: '', cancellationNote: '',
  }, over || {})
}
function createPublished(state, id, over) {
  state = ok(dispatch(state, { type: 'activity.create', input: input(id, over) }), 'create ' + id)
  const act = state.activities.find(a => a.title === id)
  return ok(dispatch(state, { type: 'activity.publish', activityId: act.id, participation: null }), 'publish ' + id)
}
function discover(state, request) {
  return selectView(state, { userId: A }, Object.assign({ kind: 'discover', search: '' }, request || {}), nowIso)
}
function titles(view) {
  return view.activities.map(a => a.title)
}

function run() {
  let state = emptyState()
  state = ok(dispatch(state, {
    type: 'profile.save',
    person: { name: '筛选人', phone: '00000000001', emergency: { name: '家属', phone: '00000000002' }, medical: '' },
  }), 'profile.save')

  section('0. 构造：3 个未来活动（不同难度/日期）+ 草稿 + 已取消 + 过去活动')
  state = createPublished(state, 'A-easy-day5', { startAt: isoOffset(5, 8), endAt: isoOffset(5, 18), deadlineAt: isoOffset(4, 20) })
  state = createPublished(state, 'B-moderate-day2', {
    startAt: isoOffset(2, 8), endAt: isoOffset(2, 18), deadlineAt: isoOffset(1, 20),
    routeSnapshot: Object.assign(input('B', {}).routeSnapshot, { difficulty: 'moderate' }),
  })
  state = createPublished(state, 'C-unmarked-day8', {
    startAt: isoOffset(8, 8), endAt: isoOffset(8, 18), deadlineAt: isoOffset(7, 20),
    routeSnapshot: Object.assign(input('C', {}).routeSnapshot, { difficulty: undefined }),
  })
  state = ok(dispatch(state, { type: 'activity.create', input: input('D-draft', { startAt: isoOffset(4, 8) }) }), 'create draft')
  state = createPublished(state, 'E-cancelled', { startAt: isoOffset(4, 8), endAt: isoOffset(4, 18), deadlineAt: isoOffset(3, 20) })
  const cancelled = state.activities.find(a => a.title === 'E-cancelled')
  state = ok(dispatch(state, { type: 'activity.transition', activityId: cancelled.id, next: 'cancelled', reason: '测试取消' }), 'cancel')
  state = createPublished(state, 'F-past', { startAt: isoOffset(-2, 8), endAt: isoOffset(-1, 18), deadlineAt: isoOffset(-3, 20) })
  check('构造后 6 个活动落库', state.activities.length === 6, state.activities.length)

  section('1. 默认请求：只返回未来、未取消、已发布')
  {
    const v = discover(state)
    check('默认排序 = 发布时间倒序', JSON.stringify(titles(v)) === JSON.stringify(['C-unmarked-day8', 'B-moderate-day2', 'A-easy-day5']), titles(v))
    check('草稿不出现', titles(v).indexOf('D-draft') === -1, titles(v))
    check('已取消不出现', titles(v).indexOf('E-cancelled') === -1, titles(v))
    check('过去活动不出现', titles(v).indexOf('F-past') === -1, titles(v))
    check('三场都在', titles(v).length === 3, titles(v))
    check('窄投影不泄露 ownerId / pickupPoints', v.activities.every(a => !('ownerId' in a) && !('pickupPoints' in a)),
      JSON.stringify(Object.keys(v.activities[0])))
    const easy = v.activities.find(a => a.title === 'A-easy-day5')
    check('发现投影带难度', easy.routeSnapshot.difficulty === 'easy', easy.routeSnapshot.difficulty)
    check('发现投影带建议装备数组', Array.isArray(easy.equipmentSuggested), typeof easy.equipmentSuggested)
  }

  section('2. 日期筛选：按活动开始日（北京时间）')
  {
    const v = discover(state, { dateFrom: cnDate(3), dateTo: cnDate(6) })
    check('+3~+6 只剩 day5', JSON.stringify(titles(v)) === JSON.stringify(['A-easy-day5']), titles(v))
    const onlyFrom = discover(state, { dateFrom: cnDate(6) })
    check('只给起始日：day8 留下、day2/day5 排除', JSON.stringify(titles(onlyFrom)) === JSON.stringify(['C-unmarked-day8']), titles(onlyFrom))
    const onlyTo = discover(state, { dateTo: cnDate(2) })
    check('只给结束日：day2 留下', JSON.stringify(titles(onlyTo)) === JSON.stringify(['B-moderate-day2']), titles(onlyTo))
  }

  section('3. 难度筛选：未标注不冒充任何难度')
  {
    const easy = discover(state, { difficulty: 'easy' })
    check('easy → 只有 A', JSON.stringify(titles(easy)) === JSON.stringify(['A-easy-day5']), titles(easy))
    const moderate = discover(state, { difficulty: 'moderate' })
    check('moderate → 只有 B', JSON.stringify(titles(moderate)) === JSON.stringify(['B-moderate-day2']), titles(moderate))
    const bogus = discover(state, { difficulty: 'bogus' })
    check('非法难度值被忽略（不制造空结果）', titles(bogus).length === 3, titles(bogus))
    const unmarked = discover(state)
    check('未标注活动在「全部」里可见（C）', titles(unmarked).indexOf('C-unmarked-day8') !== -1, titles(unmarked))
  }

  section('4. 排序：最近出发与发布时间倒序不同')
  {
    const published = discover(state, { sort: 'published' })
    const start = discover(state, { sort: 'start' })
    check('published 首条 = 最后发布的 C', titles(published)[0] === 'C-unmarked-day8', titles(published))
    check('start 首条 = 最早出发的 B', titles(start)[0] === 'B-moderate-day2', titles(start))
    check('start 顺序 B→A→C', JSON.stringify(titles(start)) === JSON.stringify(['B-moderate-day2', 'A-easy-day5', 'C-unmarked-day8']), titles(start))
  }

  section('5. 组合筛选与旧请求兼容')
  {
    const v = discover(state, { dateFrom: cnDate(4), dateTo: cnDate(7), difficulty: 'easy' })
    check('日期 + 难度组合只剩 A', JSON.stringify(titles(v)) === JSON.stringify(['A-easy-day5']), titles(v))
    const empty = discover(state, { dateFrom: cnDate(20), dateTo: cnDate(21) })
    check('没有命中的日期区间返回空列表而不是报错', Array.isArray(empty.activities) && empty.activities.length === 0, empty.activities)
  }

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}
run()
