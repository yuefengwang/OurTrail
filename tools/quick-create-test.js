// 快速创建与可后补路线（2026-10-14，spec docs/superpowers/specs/2026-10-14-quick-create-deferred-route.md）：
//   ① 发布门只拦「标题 + 三个时间 + 集合点」；轨迹可解析项（路线名/节点/里程/爬升/风险/装备）
//      全部可忽略——整体可为空，但填了的条目必须完整；
//   ② gathering/active 阶段锁从「整体 JSON 锁」改为「只增不改」：交易性键仍锁，
//      路线/风险/上车点按 id 逐条不可变但允许追加；
//   ③ 投影单源：completeness 派生 + riskView 无损往返 + 空路线不广播 attendance.node。
// 运行：node tools/quick-create-test.js
// 口径：fixture 都经真实命令建立（不手工拼 State）；被拒命令必须零副作用；
// 夹具时间一律 Date.now() 偏移——门禁里的绝对日期就是时间引信（2026-10-10 e2e 红教训）。
'use strict'

const crypto = require('crypto')
const S = require('../cloudfunctions/trailApi/domain/schema')
const { reduceCommand, genId } = require('../cloudfunctions/trailApi/domain/commands')
const { assertInvariants } = require('../cloudfunctions/trailApi/domain/invariants')
const { selectView } = require('../cloudfunctions/trailApi/domain/selectors')
const { canonicalPayload, deepClone } = require('../cloudfunctions/trailApi/domain/contracts')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const MIN = 60000
const DAY = 86400000
// 与 tools/e2e-test.js:73 同款口径：永远在未来的北京时间墙上时刻
const iso = min => new Date(Date.now() + (min + 30 * 1440) * MIN + 8 * 3600000).toISOString().slice(0, 19) + '+08:00'
const NOW = iso(0)
const ctx = { now: NOW, id: genId }
const fp = payload => crypto.createHash('sha256').update(canonicalPayload(payload), 'utf8').digest('hex')

function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: NOW,
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], receipts: [],
  }
}

function dispatch(state, actor, payload, requestId) {
  return reduceCommand(state, {
    actor: { userId: actor }, requestId: requestId || genId('req'),
    expectedRevision: state.revision, fingerprint: fp(payload), payload,
  }, ctx)
}

const A = 'openid-owner'
const B = 'openid-guest'

function saveProfile(state, userId, name) {
  const r = dispatch(state, userId, {
    type: 'profile.save',
    person: { name, phone: '0000000000' + userId.slice(-1), emergency: { name: '家属', phone: '00000000009' }, medical: '' },
  })
  if (!r.ok) throw new Error('profile.save failed: ' + JSON.stringify(r.error))
  return r.value.state
}

// 空路线活动输入：标题/时间/集合点齐，routeSnapshot 全空——「不导轨迹也要能发」的形状
// 时间基准：NOW = iso(0)。报名门要求 now ≤ deadlineAt，故截止必须落在 NOW 之后、
// 出发之前——整条时间线比 NOW 晚一天半，别把截止写到过去（signup 撞「不在开放报名时段」）。
function emptyRouteInput(over) {
  return Object.assign({
    title: '周六青城山轻徒步', description: '', organizerIntro: '',
    startAt: iso(1440), endAt: iso(2040), deadlineAt: iso(1380),
    acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null,
    routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, points: [], risks: [] },
    pickupPoints: [{ id: 'pk-1', name: '地铁A口', meetingAt: iso(1410), address: '茶店子客运站', coordinates: null }],
    equipment: [], feeNote: '', cancellationNote: '',
  }, over || {})
}

// 完整活动输入：存量形状（GPX 导入后的样子），用于「不放水也不误伤」的对拍基线
function fullInput(over) {
  return Object.assign({
    title: '青城后山环线', description: '轻徒步', organizerIntro: '阿秋带队',
    startAt: iso(1440), endAt: iso(2040), deadlineAt: iso(1380),
    acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null,
    routeSnapshot: {
      title: '飞泉沟环线', distanceKm: 12.8, ascentM: 680,
      points: [
        { id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.93, lng: 103.48 }, time: iso(-60), ele: 720 },
        { id: 'pt-2', name: '又一村', kind: 'checkpoint', coordinates: { lat: 30.94, lng: 103.49 }, ele: 920 },
      ],
      risks: [{ id: 'rk-1', title: '湿滑', advice: '防滑鞋', severity: 'mid' }],
      track: [{ lat: 30.93, lng: 103.48 }, { lat: 30.94, lng: 103.49 }],
    },
    pickupPoints: [{ id: 'pk-1', name: '地铁A口', meetingAt: iso(-30), address: '茶店子客运站', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
  }, over || {})
}

// 真编辑器的出线形状：读投影 → 剥掉服务端/投影键 → 整份提交（editor.js reload() 同款）。
// 必须走投影而不是存储记录——存储记录带 publishedAt（ActivityInput 严格 schema 会拒），
// 投影还不带 completeness（编辑器自建 input，从不透传视图）。
function formOf(state, activityId) {
  const view = selectView(state, { userId: A }, { kind: 'activity', activityId, perspective: 'organizer' }, NOW)
  const form = deepClone(view.activity)
  delete form.id; delete form.ownerId; delete form.phase; delete form.completeness
  return form
}

function run() {
  let state = emptyState()
  state = saveProfile(state, A, '阿秋')
  state = saveProfile(state, B, '林溪')

  /* ---------- 1. 发布门：空路线可发布 ---------- */
  section('1. 发布门：轨迹可解析项全部可忽略')
  {
    let r = dispatch(state, A, { type: 'activity.create', input: emptyRouteInput() })
    check('空路线 create ok（schema 本就允许空 title/points/risks）', r.ok === true, r.error)
    const emptyId = r.value ? r.value.state.activities[0].id : ''
    state = r.value.state

    r = dispatch(state, A, { type: 'activity.publish', participation: null, activityId: emptyId })
    check('空路线 publish ok（发布门只拦标题/时间/集合点）', r.ok === true, r.error)
    state = r.value ? r.value.state : state
    check('publish 后 phase=published', (state.activities.find(a => a.id === emptyId) || {}).phase === 'published')
    check('publish 后 assertInvariants 通过（放宽不同源就会在这里红，并拖垮此后每条命令）',
      assertInvariants(state).ok, assertInvariants(state).error)

    // 发布后补：published 的 edit 仍跑 full 校验，必须存得进空值、也存得进后续补的值
    const form = formOf(state, emptyId)
    form.routeSnapshot.title = '青城山小道'
    form.routeSnapshot.points = [{ id: 'pt-new', name: '山门', kind: 'start', coordinates: { lat: 30.93, lng: 103.48 } }]
    form.routeSnapshot.risks = [{ id: 'rk-new', title: '湿滑', advice: '防滑鞋' }]
    r = dispatch(state, A, { type: 'activity.edit', activityId: emptyId, input: form })
    check('published 阶段补路线名称/节点/风险 ok（「发布后补」承诺）', r.ok === true, r.error)
    state = r.value ? r.value.state : state
    const filled = state.activities.find(a => a.id === emptyId)
    check('补写落库：title/points/risks 均生效',
      filled.routeSnapshot.title === '青城山小道' && filled.routeSnapshot.points.length === 1 && filled.routeSnapshot.risks.length === 1)
    check('补写后 persistPrivateRoute 落私有路线并回填 routeId',
      !!filled.routeId && state.routes.some(ro => ro.id === filled.routeId && ro.ownerId === A))
    check('补写后不变量仍通过', assertInvariants(state).ok, assertInvariants(state).error)

    // 混合形态：有节点无风险 / 有风险无节点，都允许
    r = dispatch(state, A, { type: 'activity.create', input: emptyRouteInput({
      title: '只有节点', routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, points: [{ id: 'pt-x', name: '起点', kind: 'start', coordinates: null }], risks: [] },
    }) })
    check('有节点无风险 create ok', r.ok === true, r.error)
    const onlyPointsId = r.ok ? r.value.state.activities[r.value.state.activities.length - 1].id : ''
    state = r.value.state
    r = dispatch(state, A, { type: 'activity.publish', participation: null, activityId: onlyPointsId })
    check('有节点无风险 publish ok', r.ok === true, r.error)
    state = r.ok ? r.value.state : state

    r = dispatch(state, A, { type: 'activity.create', input: emptyRouteInput({
      title: '只有风险', routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, points: [], risks: [{ id: 'rk-y', title: '风大', advice: '备衣' }] },
    }) })
    check('有风险无节点 create ok', r.ok === true, r.error)
    const onlyRisksId = r.ok ? r.value.state.activities[r.value.state.activities.length - 1].id : ''
    state = r.value.state
    r = dispatch(state, A, { type: 'activity.publish', participation: null, activityId: onlyRisksId })
    check('有风险无节点 publish ok', r.ok === true, r.error)
    state = r.ok ? r.value.state : state

    // copy 不受形状影响
    r = dispatch(state, A, { type: 'activity.copy', sourceActivityId: onlyRisksId })
    check('activity.copy 空/半成品路线 ok', r.ok === true, r.error)
    state = r.ok ? r.value.state : state
  }

  /* ---------- 2. 发布门：必填没有放水 ---------- */
  section('2. 发布门：必填项与条目级完整不放水')
  {
    const before = state.revision
    const cases = [
      ['缺标题', emptyRouteInput({ title: '  ' }), '标题'],
      ['缺出发时间', emptyRouteInput({ startAt: null }), '完整'],
      ['缺截止时间', emptyRouteInput({ deadlineAt: null }), '完整'],
      ['缺集合点', emptyRouteInput({ pickupPoints: [] }), '完整'],
      ['上车点缺地址', emptyRouteInput({ pickupPoints: [{ id: 'pk-1', name: '地铁A口', meetingAt: iso(-30), address: '  ', coordinates: null }] }), '完整'],
      ['上车点缺集合时间', emptyRouteInput({ pickupPoints: [{ id: 'pk-1', name: '地铁A口', meetingAt: null, address: '茶店子', coordinates: null }] }), '完整'],
      ['时间顺序错（截止晚于出发）', emptyRouteInput({ deadlineAt: iso(1500) }), '截止'],
      ['节点缺名称', emptyRouteInput({ routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, points: [{ id: 'pt-1', name: ' ', kind: 'start', coordinates: null }], risks: [] } }), '路线节点需要名称'],
      ['风险缺应对', emptyRouteInput({ routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, points: [], risks: [{ id: 'rk-1', title: '风大', advice: '' }] } }), '风险提示需要'],
    ]
    for (const [name, input, frag] of cases) {
      const c = dispatch(state, A, { type: 'activity.create', input })
      if (!c.ok) { check(name + ' → create 即被 schema/域层拒', /INVALID_INPUT/.test(c.error.code), c.error); continue }
      // publish 必须跑在 create 成功后的新 state 上（旧 state 里没有这个活动 ⇒ NOT_FOUND，红因就错了）
      const p = dispatch(c.value.state, A, { type: 'activity.publish', participation: null, activityId: c.value.state.activities[c.value.state.activities.length - 1].id })
      check(name + ' → publish INVALID_INPUT（' + frag + '）',
        p.ok === false && p.error.code === 'INVALID_INPUT' && String(p.error.message).indexOf(frag) !== -1, p.error)
    }
    check('2 组全部拒绝后 revision 不变（零副作用）', state.revision === before, state.revision - before)
  }

  /* ---------- 3. 阶段锁：只增不改 ---------- */
  section('3. gathering/active：交易性键锁死，路线数组只增不改')
  {
    let r = dispatch(state, A, { type: 'activity.create', input: emptyRouteInput({ title: '只增不改' }) })
    const actId = r.value.state.activities[r.value.state.activities.length - 1].id
    state = r.value.state
    r = dispatch(state, A, { type: 'activity.publish', participation: null, activityId: actId })
    state = r.value.state
    r = dispatch(state, A, { type: 'activity.transition', activityId: actId, next: 'gathering', reason: '按期集合' })
    check('推进 gathering ok', r.ok === true, r.error)
    state = r.value ? r.value.state : state

    // ① 交易性键
    for (const [name, patch, frag] of [
      ['改标题', { title: '换个名字' }, '仅可补充'],
      ['改出发时间', { startAt: iso(30) }, '仅可补充'],
      ['改名额', { capacity: 30 }, '仅可补充'],
      ['改审核方式', { approvalMode: 'automatic' }, '仅可补充'],
      ['重开报名开关', { acceptingSignups: true }, '仅可补充'],
    ]) {
      const p = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: Object.assign(formOf(state, actId), patch) })
      check('gathering ' + name + ' → WRONG_PHASE', p.ok === false && p.error.code === 'WRONG_PHASE' && String(p.error.message).indexOf(frag) !== -1, p.error)
    }
    {
      const short = Object.assign(formOf(state, actId), { endAt: iso(60) })
      const p = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: short })
      check('gathering 缩短 endAt → WRONG_PHASE', p.ok === false && p.error.code === 'WRONG_PHASE', p.error)
      const longer = Object.assign(formOf(state, actId), { endAt: iso(2400) })
      const q = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: longer })
      check('gathering 延长 endAt ok（既有规则不回退）', q.ok === true, q.error)
      state = q.ok ? q.value.state : state
    }

    // ② 信息性数组只增不改
    {
      const appendPoint = Object.assign(formOf(state, actId), {
        routeSnapshot: {
          title: '补个名字', distanceKm: 3.2, ascentM: 120, risks: [],
          points: [{ id: 'pt-late', name: '山门', kind: 'start', coordinates: { lat: 30.93, lng: 103.48 } }],
        },
      })
      const p = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: appendPoint })
      check('gathering 追加路线节点 ok（发布时留空的路线，出发后补得回来）', p.ok === true, p.error)
      state = p.ok ? p.value.state : state
      check('追加后 routeSnapshot.title 标量同笔可改（信息性标量不锁）',
        (state.activities.find(a => a.id === actId) || {}).routeSnapshot.title === '补个名字')

      const rename = formOf(state, actId)
      rename.routeSnapshot.points[0].name = '改个名'
      const q = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: rename })
      check('gathering 改已有节点名 → WRONG_PHASE（已发出的条目一字不能动）', q.ok === false && q.error.code === 'WRONG_PHASE', q.error)

      const drop = formOf(state, actId)
      drop.routeSnapshot.points = []
      const d = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: drop })
      check('gathering 删已有节点 → WRONG_PHASE', d.ok === false && d.error.code === 'WRONG_PHASE', d.error)

      const appendRisk = Object.assign(formOf(state, actId), {
        routeSnapshot: Object.assign({}, formOf(state, actId).routeSnapshot, {
          risks: [{ id: 'rk-late', title: '天气多变', advice: '备雨具' }],
        }),
      })
      const e = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: appendRisk })
      check('gathering 追加风险 ok', e.ok === true, e.error)
      state = e.ok ? e.value.state : state

      const editRisk = formOf(state, actId)
      editRisk.routeSnapshot.risks[0].advice = '改应对'
      const f = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: editRisk })
      check('gathering 改已有风险 → WRONG_PHASE', f.ok === false && f.error.code === 'WRONG_PHASE', f.error)

      const appendPickup = Object.assign(formOf(state, actId), {
        pickupPoints: formOf(state, actId).pickupPoints.concat([{ id: 'pk-2', name: '地铁B口', meetingAt: iso(-30), address: '一品天下', coordinates: null }]),
      })
      const g = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: appendPickup })
      check('gathering 追加上车点 ok', g.ok === true, g.error)
      state = g.ok ? g.value.state : state

      const editPickup = formOf(state, actId)
      editPickup.pickupPoints[0].name = '改个集合点名'
      const h = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: editPickup })
      check('gathering 改已有上车点 → WRONG_PHASE', h.ok === false && h.error.code === 'WRONG_PHASE', h.error)

      const desc = Object.assign(formOf(state, actId), { description: '集合点改到B口旁边', equipment: ['雨具'] })
      const i = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: desc })
      check('gathering 改说明/装备 ok（既有允许字段不回退）', i.ok === true, i.error)
      state = i.ok ? i.value.state : state
    }

    // ③ active 同规则抽查 + 空路线活动走到 active 仍能补
    r = dispatch(state, A, { type: 'activity.transition', activityId: actId, next: 'active', reason: '出发' })
    check('推进 active ok', r.ok === true, r.error)
    state = r.value ? r.value.state : state
    {
      const append2 = Object.assign(formOf(state, actId), {
        routeSnapshot: Object.assign({}, formOf(state, actId).routeSnapshot, {
          points: formOf(state, actId).routeSnapshot.points.concat([{ id: 'pt-active', name: '中途补给', kind: 'checkpoint', coordinates: null }]),
        }),
      })
      const p = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: append2 })
      check('active 追加节点 ok', p.ok === true, p.error)
      state = p.ok ? p.value.state : state
      const rename2 = formOf(state, actId)
      rename2.routeSnapshot.points[0].name = '行程中改个名'
      const q = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: rename2 })
      check('active 改已有节点 → WRONG_PHASE', q.ok === false && q.error.code === 'WRONG_PHASE', q.error)
    }
    check('阶段锁全部用例后 revision 仍前进、不变量通过', assertInvariants(state).ok, assertInvariants(state).error)
  }

  /* ---------- 4. 引用守卫不回退 ---------- */
  section('4. 删改的既有引用守卫不受「只增不改」影响')
  {
    let r = dispatch(state, A, { type: 'activity.create', input: emptyRouteInput({ title: '拼车场' }) })
    const actId = r.value.state.activities[r.value.state.activities.length - 1].id
    state = r.value.state
    r = dispatch(state, A, { type: 'activity.publish', participation: null, activityId: actId })
    state = r.value.state
    const prof = (dispatch(state, B, { type: 'profile.save', person: { name: '林溪', phone: '00000000002', emergency: { name: '家属', phone: '00000000009' }, medical: '' } }), state.profiles.find(p => p.id === B).person)
    r = dispatch(state, B, { type: 'signup.submit', activityId: actId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: B }, participant: prof, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    check('拼车报名 ok', r.ok === true, r.error)
    const signupId = r.ok ? r.value.targetIds[0] : ''
    state = r.value ? r.value.state : state
    r = dispatch(state, A, { type: 'signup.review', activityId: actId, signupIds: [signupId], decision: 'confirm' })
    check('审核确认 ok', r.ok === true, r.error)
    state = r.value ? r.value.state : state

    // 换掉被引用的上车点（不是清空——清空先撞「发布需要集合点」的门，验不到引用守卫这层）
    const dropPickup = Object.assign(formOf(state, actId), {
      pickupPoints: [{ id: 'pk-9', name: '换一个', meetingAt: iso(-30), address: '别处', coordinates: null }],
    })
    r = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: dropPickup })
    check('published 删被拼车报名引用的上车点 → INVALID_INPUT（引用守卫兜底「只增不改」）',
      r.ok === false && r.error.code === 'INVALID_INPUT' && /上车点/.test(String(r.error.message)), r.error)

    // 拼车者推进到 gathering 后，只增不改的锁先于引用守卫拒删除——两层都必须拒，这里钉住锁这层
    r = dispatch(state, A, { type: 'activity.transition', activityId: actId, next: 'gathering', reason: '集合' })
    check('有已确认报名也推进 gathering ok', r.ok === true, r.error)
    state = r.value ? r.value.state : state
    const dropInGathering = Object.assign(formOf(state, actId), { pickupPoints: [] })
    r = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: dropInGathering })
    check('gathering 删被引用上车点 → WRONG_PHASE（锁这层先拒）', r.ok === false && r.error.code === 'WRONG_PHASE', r.error)
    check('4 组后不变量通过', assertInvariants(state).ok, assertInvariants(state).error)
  }

  /* ---------- 5. 投影单源 ---------- */
  section('5. 投影：completeness 派生 / riskView 无损 / 空路线不广播 attendance.node')
  {
    // completeness + riskView 往返
    let r = dispatch(state, A, { type: 'activity.create', input: fullInput() })
    const fullId = r.value.state.activities[r.value.state.activities.length - 1].id
    state = r.value.state
    r = dispatch(state, A, { type: 'activity.publish', participation: null, activityId: fullId })
    state = r.value.state
    let view = selectView(state, { userId: A }, { kind: 'activity', activityId: fullId, perspective: 'organizer' }, NOW)
    check('完整活动 completeness 全 true',
      view.activity.completeness.route === true && view.activity.completeness.points === true
      && view.activity.completeness.risks === true && view.activity.completeness.pickups === true, view.activity.completeness)
    check('riskView 无损：severity 投影不丢（编辑器往返 → 阶段门逐字节比对的地基）',
      view.activity.routeSnapshot.risks[0].severity === 'mid', view.activity.routeSnapshot.risks[0])

    r = dispatch(state, A, { type: 'activity.create', input: emptyRouteInput({ title: '空路线投影' }) })
    const emptyId = r.value.state.activities[r.value.state.activities.length - 1].id
    state = r.value.state
    r = dispatch(state, A, { type: 'activity.publish', participation: null, activityId: emptyId })
    state = r.value.state
    view = selectView(state, { userId: A }, { kind: 'activity', activityId: emptyId, perspective: 'organizer' }, NOW)
    check('空路线 completeness：route/points/risks false、pickups true',
      view.activity.completeness.route === false && view.activity.completeness.points === false
      && view.activity.completeness.risks === false && view.activity.completeness.pickups === true, view.activity.completeness)
    check('home 投影同源带 completeness（activityView 复用）', (function () {
      const home = selectView(state, { userId: A }, { kind: 'home', perspective: 'organizer', openedActivityIds: [] }, NOW)
      const row = (home.activities || []).find(a => a.id === emptyId)
      return !!row && row.completeness && row.completeness.points === false
    })())

    // attendance.node 广播门：走完整「发布空路线 → 集合 → 出发 → 行程中」链条
    const actId = emptyId
    const prof = state.profiles.find(p => p.id === B).person
    r = dispatch(state, B, { type: 'signup.submit', activityId: actId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: B }, participant: prof, trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    check('自行前往报名 ok', r.ok === true, r.error)
    const sid = r.ok ? r.value.targetIds[0] : ''
    state = r.value ? r.value.state : state
    r = dispatch(state, A, { type: 'signup.review', activityId: actId, signupIds: [sid], decision: 'confirm' })
    state = r.value ? r.value.state : state
    r = dispatch(state, A, { type: 'activity.transition', activityId: actId, next: 'gathering', reason: '集合' })
    state = r.value ? r.value.state : state
    // 随队出发的门：先签到（人工签到需现场核实依据），才能记 departure=joined
    r = dispatch(state, A, { type: 'attendance.checkin', activityId: actId, signupId: sid, checkIn: { method: 'manual', evidence: { at: NOW, by: A, note: '现场核实' } } })
    check('签到 ok', r.ok === true, r.error)
    state = r.value ? r.value.state : state
    r = dispatch(state, A, { type: 'attendance.departure', activityId: actId, signupId: sid, outcome: { kind: 'joined', evidence: { at: NOW, by: A, note: '' } } })
    check('记录出发 ok', r.ok === true, r.error)
    state = r.value ? r.value.state : state
    r = dispatch(state, A, { type: 'activity.transition', activityId: actId, next: 'active', reason: '行程' })
    check('推进 active ok', r.ok === true, r.error)
    state = r.value ? r.value.state : state
    view = selectView(state, { userId: A }, { kind: 'activity', activityId: actId, perspective: 'organizer' }, NOW)
    check('active 且空路线：permittedActions 不含 attendance.node（没有必然红字的按钮）',
      view.permittedActions.indexOf('attendance.node') === -1, view.permittedActions)
    const appendMidway = Object.assign(formOf(state, actId), {
      routeSnapshot: Object.assign({}, formOf(state, actId).routeSnapshot, {
        points: [{ id: 'pt-mid', name: '中途点', kind: 'checkpoint', coordinates: null }],
      }),
    })
    r = dispatch(state, A, { type: 'activity.edit', activityId: actId, input: appendMidway })
    check('行程中补节点 ok', r.ok === true, r.error)
    state = r.value ? r.value.state : state
    view = selectView(state, { userId: A }, { kind: 'activity', activityId: actId, perspective: 'organizer' }, NOW)
    check('补节点后 attendance.node 重新广播', view.permittedActions.indexOf('attendance.node') !== -1, view.permittedActions)
    check('终态不变量通过', assertInvariants(state).ok, assertInvariants(state).error)
  }

  /* ---------- 6. 存量形状零变化 ---------- */
  section('6. 存量（完整）活动：放宽不放水也不误伤')
  {
    const before = JSON.stringify(state.activities.map(a => a.routeSnapshot))
    let r = dispatch(state, A, { type: 'activity.create', input: fullInput({ title: '存量复现' }) })
    const actId = r.value.state.activities[r.value.state.activities.length - 1].id
    state = r.value.state
    r = dispatch(state, A, { type: 'activity.publish', participation: null, activityId: actId })
    check('完整活动 publish ok', r.ok === true, r.error)
    state = r.value ? r.value.state : state
    const stored = state.activities.find(a => a.id === actId)
    check('routeSnapshot 逐字节落库（title/points/risks/track/里程爬升不丢）',
      stored.routeSnapshot.title === '飞泉沟环线' && stored.routeSnapshot.points.length === 2
      && stored.routeSnapshot.risks[0].severity === 'mid' && stored.routeSnapshot.track.length === 2
      && stored.routeSnapshot.distanceKm === 12.8 && stored.routeSnapshot.ascentM === 680,
      stored.routeSnapshot)
    // 基线只含本轮新建之前的活动；新建的那条本身就是被观测对象，不能混进「未改动」集合
    const after = JSON.stringify(state.activities.filter(a => a.id !== actId).map(a => a.routeSnapshot))
    check('已有活动的 routeSnapshot 未被本轮任何用例改动', after === before)
  }

  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

run().catch(e => {
  console.error('harness error:', e && e.stack || e.message)
  process.exit(1)
})
