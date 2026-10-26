#!/usr/bin/env node
'use strict'
// Offline only. Import the reusable harness, NEVER a *-test.js or the cloud router.
// Existing output is reused byte-for-byte: before/after must share one clock and hash.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const assert = require('assert')
const DEFAULT_BASE = 'C:/Users/thinkbook/AppData/Local/Temp/opencode/ourtrail-crosspage-a215-baseline'
const OUTPUT = path.resolve(__dirname, '../fixtures/responses.json')
function argsOf(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(args[i])
    if (!m) throw Error('Unknown argument: ' + args[i])
    out[m[1]] = m[2] === undefined ? args[++i] : m[2]
  }
  return out
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
function hashes(root, prefix) {
  const out = {}
  function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name)
      if (f.isDirectory()) walk(p)
      else if (/\.(js|json|wxml|wxss|wxs)$/.test(p)) out[path.relative(root, p).replace(/\\/g, '/')] = sha(fs.readFileSync(p))
    }
  }
  walk(path.join(root, prefix))
  return out
}
function main() {
  const args = argsOf(process.argv.slice(2))
  if (Object.keys(args).some(k => k !== 'baseline')) throw Error('Only --baseline <absolute path> is supported; output is fixed to ../fixtures/responses.json')
  const base = args.baseline || DEFAULT_BASE
  if (!path.isAbsolute(base)) throw Error('--baseline must be absolute')
  if (fs.existsSync(OUTPUT)) {
    const raw = fs.readFileSync(OUTPUT)
    const fixture = JSON.parse(raw)
    assert.equal(fixture.schemaVersion, 1)
    console.log('Reusing frozen fixture: ' + OUTPUT + '\nsha256=' + sha(raw) + '\ngeneratedAt=' + fixture.generatedAt)
    return
  }
  // Defense in depth: the generator cannot accidentally use a network library/SDK.
  const Module = require('module')
  const load = Module._load
  Module._load = function (name) {
    if (/^(?:node:)?(?:https?|net|tls|dgram)$/.test(name) || /wx-server-sdk|miniprogram-automator/.test(name)) throw Error('Offline generator blocked dependency: ' + name)
    return load.apply(this, arguments)
  }
  const { createWorld } = require(path.join(base, 'tools/lifecycle-harness.js'))
  const selectors = require(path.join(base, 'cloudfunctions/trailApi/domain/selectors.js'))
  const now = new Date().toISOString()
  const t = h => new Date(Date.parse(now) + h * 3600000).toISOString()
  const w = createWorld({ now })
  const ME = 'demo-self', OTHER = 'demo-other', PEOPLE = ['demo-walker-1', 'demo-walker-2', 'demo-walker-3']
  const person = () => ({ name: '演示同行人', phone: '00000000000', emergency: { name: '演示同行人', phone: '00000000000' }, medical: '' })
  function ok(r, label) { assert(r && r.ok, label + ': ' + JSON.stringify(r)); return r }
  function send(actor, payload) { return ok(w.dispatch(actor, payload), payload.type) }
  for (const id of [ME, OTHER].concat(PEOPLE)) send(id, { type: 'profile.save', person: person() })
  send(ME, { type: 'companion.save', companionId: null, person: person() })
  const syntheticRoute = {
    title: '合成坐标演示线（非实地路线）', distanceKm: 3.2, ascentM: 180, difficulty: 'easy',
    points: [
      { id: 'demo-start', name: '合成起点', kind: 'start', coordinates: { lat: 30.6, lng: 104.0 }, ele: 500 },
      { id: 'demo-mid', name: '合成休息点', kind: 'checkpoint', coordinates: { lat: 30.61, lng: 104.01 }, ele: 680 },
      { id: 'demo-end', name: '合成终点', kind: 'finish', coordinates: { lat: 30.62, lng: 104.02 }, ele: 520 },
    ],
    risks: [{ id: 'demo-risk', title: '合成风险提示', advice: '仅供页面排版验收，不作出行依据', severity: 'low' }],
    track: [{ lat: 30.6, lng: 104.0, ele: 500 }, { lat: 30.61, lng: 104.01, ele: 680 }, { lat: 30.62, lng: 104.02, ele: 520 }],
  }
  const noCoordsRoute = { title: '无坐标演示线', distanceKm: 0, ascentM: 0, difficulty: 'moderate', points: [], risks: [] }
  const ownRoute = send(ME, { type: 'route.create', input: syntheticRoute }).targetIds[0]
  const sharedRoute = send(OTHER, { type: 'route.create', input: Object.assign({}, noCoordsRoute, { title: '共享给我的演示路线', sharedWith: [ME], visibility: 'shared' }) }).targetIds[0]
  function activity(owner, title, routeId, route, startHours, visibility) {
    const input = {
      title, description: '合成验收数据；不是真实活动，坐标与轨迹不得用于导航。', organizerIntro: '演示同行人',
      startAt: t(startHours), endAt: t(startHours + 10), deadlineAt: t(startHours - 12),
      acceptingSignups: true, capacity: 12, approvalMode: 'manual', routeId, routeSnapshot: route,
      pickupPoints: [{ id: 'demo-pickup', name: '合成集合点', meetingAt: t(startHours - 1), address: '演示地址（非实际集合点）', coordinates: null }],
      equipment: ['防滑鞋'], equipmentSuggested: ['饮用水'], feeNote: '仅供演示', cancellationNote: '出发前联系演示同行人',
      visibility: visibility || 'discover', leader: '演示同行人',
    }
    const id = send(owner, { type: 'activity.create', input }).targetIds[0]
    send(owner, { type: 'activity.publish', activityId: id, participation: null })
    return id
  }
  const activityId = activity(ME, '演示活动 · 有坐标同行', ownRoute, syntheticRoute, 48)
  const noCoordsId = activity(OTHER, '演示活动 · 无坐标同行', sharedRoute, noCoordsRoute, 96)
  function signup(actor, id, mode) {
    const r = send(actor, { type: 'signup.submit', activityId: id, keepTogether: false, mode: 'apply', participants: [{ personRef: { kind: 'user', userId: actor }, participant: person(), trip: mode === 'self' ? { mode: 'self' } : { mode: 'shared', pickupPointId: 'demo-pickup' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    const owner = w.state.activities.find(a => a.id === id).ownerId
    send(owner, { type: 'signup.review', activityId: id, signupIds: r.targetIds, decision: 'confirm' })
    return r.targetIds[0]
  }
  const selfSignup = signup(ME, activityId, 'self')
  const passengers = PEOPLE.slice(0, 2).map(id => signup(id, activityId, 'shared'))
  signup(PEOPLE[2], activityId, 'self')
  signup(ME, noCoordsId, 'self')
  const vehicleId = send(ME, { type: 'vehicle.save', activityId, vehicleId: null, input: {
    label: '演示车辆 A', plate: '演示车牌', legalCapacity: 5, blockedSeats: 0,
    drivers: [{ kind: 'service', name: '演示同行人', phone: '00000000000', userId: null }],
    seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['demo-pickup'],
  } }).targetIds[0]
  passengers.forEach((signupId, i) => send(ME, { type: 'assignment.set', activityId, target: { signupId, vehicleId, seatLabel: String(i + 1) } }))
  send(ME, { type: 'membership.save', activityId, membership: { id: 'demo-staff-grant', role: 'staff', activityId, userId: ME, expiresAt: t(240), scope: { kind: 'all' }, capabilities: ['roster', 'checkin', 'node', 'incident', 'position', 'home'] } })
  send(ME, { type: 'membership.save', activityId, membership: { id: 'demo-vehicle-grant', role: 'vehicle_contact', activityId, userId: ME, vehicleId, expiresAt: t(240) } })
  send(ME, { type: 'activity.transition', activityId, next: 'gathering', reason: '合成数据，演示集合阶段' })
  ok(w.checkin(ME, activityId, selfSignup), 'checkin self')
  ok(w.checkin(ME, activityId, passengers[0]), 'checkin passenger')
  ok(w.board(ME, activityId, passengers[0], 'outbound'), 'board passenger')
  for (const [title, category, status] of [['核对演示装备', 'gear', 'doing'], ['准备演示饮水', 'food', 'todo'], ['整理演示记录', 'logistics', 'done']]) {
    const id = send(ME, { type: 'task.create', activityId, input: { title, note: '合成条目，不执行实际采购或通知', category, assigneeName: '演示同行人', dueAt: t(36) } }).targetIds[0]
    if (status !== 'todo') send(ME, { type: 'task.status', activityId, taskId: id, status })
  }
  // Add an archived activity to exercise me.stats.finished without polluting discover.
  const archiveId = activity(ME, '演示活动 · 已结束', ownRoute, syntheticRoute, 144, 'link')
  const archiveSignup = signup(ME, archiveId, 'self')
  ok(w.toGathering(ME, archiveId), 'archive gathering')
  ok(w.verifyAllDeparted(ME, archiveId), 'archive active')
  send(ME, { type: 'position.report', activityId: archiveId, signupId: archiveSignup, coordinates: { lat: 30.6, lng: 104.0 }, consent: true })
  ok(w.phase(ME, archiveId, 'closing'), 'archive closing')
  ok(w.home(ME, archiveId, archiveSignup), 'archive home')
  ok(w.phase(ME, archiveId, 'archived'), 'archive')
  assert.deepEqual(w.problems, [], 'Domain harness reported invalid fixtures')
  const revision = w.state.revision
  const read = request => ({ view: w.read(ME, request), revision, now })
  const result = r => { ok(r, 'selector'); return r }
  const unwrap = r => Object.assign({ revision, now }, result(r).value)
  const responses = {
    profile: read({ kind: 'profile' }), me: read({ kind: 'me' }),
    home: {}, discover: read({ kind: 'discover' }), activities: {},
    transport: { [activityId]: result(selectors.selectTransport(w.state, { userId: ME }, activityId)) },
    access: { [activityId]: result(selectors.selectAccess(w.state, { userId: ME }, activityId)) },
    tasks: { [activityId]: read({ kind: 'tasks', activityId }) },
    routes: unwrap(selectors.selectRoutes(w.state, { userId: ME })), route: {},
    // Explicit no-data, NOT invented weather. Route node calls settle through their real failed/no-coords branches.
    weather: { status: 'unavailable', reason: '合成验收不提供天气', hours: [], days: [], detail: null, series: [], pointElevation: null },
  }
  for (const perspective of ['participant', 'staff', 'vehicle', 'organizer']) responses.home[perspective] = read({ kind: 'home', perspective, openedActivityIds: [] })
  for (const id of [activityId, noCoordsId, archiveId]) {
    responses.activities[id] = {}
    for (const perspective of ['participant', 'organizer', 'staff', 'vehicle']) responses.activities[id][perspective] = read({ kind: 'activity', activityId: id, perspective, ...(id === activityId && perspective === 'vehicle' ? { vehicleId } : {}) })
  }
  for (const id of [ownRoute, sharedRoute]) responses.route[id] = unwrap(selectors.selectRoutes(w.state, { userId: ME }, id))
  const homeLists = ['participant', 'staff', 'vehicle'].map(p => responses.home[p].view.activities)
  assert(homeLists.every(list => list.some(a => a.id === activityId)), 'Three-perspective overlap missing')
  assert.equal(responses.discover.view.activities.length, 2)
  assert.equal(responses.discover.view.activities.filter(a => a.routeSnapshot.points.some(p => p.coordinates)).length, 1)
  assert(responses.me.view.positionRows.length > 0 && responses.me.view.recent.length > 0)
  assert.equal(responses.activities[activityId].vehicle.view.vehicleTask.passengers.length, 2)
  const fixture = {
    schemaVersion: 1, generatedAt: now, baseline: path.resolve(base),
    dataSource: 'offline real domain commands and selectors; synthetic identities and coordinates',
    privacy: { personName: '演示同行人', phone: '00000000000 (synthetic non-dialable placeholder)', realIdentity: false, realLocation: false },
    ids: { actorId: ME, activityId, noCoordsId, archiveId, vehicleId, ownRoute, sharedRoute, selfSignup },
    expectations: { homeUniqueMine: 2, discoverCards: 2, discoverMarkers: 1, vehiclePassengers: 2, tasks: 3, positionRows: responses.me.view.positionRows.length },
    responses,
    emptyResponses: { home: { view: { kind: 'home', activities: [] }, revision, now }, discover: { view: { kind: 'discover', activities: [] }, revision, now }, routes: { routes: [], revision, now }, tasks: { view: { kind: 'tasks', activityId, activityTitle: '演示活动 · 空任务', canManage: true, tasks: [] }, revision, now } },
    baselineSourceSha: hashes(base, 'miniprogram'),
    generation: { commandCount: w.steps, revision, harness: 'tools/lifecycle-harness.js', selector: 'cloudfunctions/trailApi/domain/selectors.js', fixtureContractReferences: ['tools/scenario-workspace-test.js', 'tools/scenario-vehicle-test.js', 'tools/scenario-tasks-test.js', 'tools/routes-test.js'] },
  }
  const raw = JSON.stringify(fixture, null, 2) + '\n'
  assert(!/cloud:\/\/|https?:\/\//.test(JSON.stringify(responses)), 'Fixture must not contain remote image URLs')
  fs.writeFileSync(OUTPUT, raw, { flag: 'wx' })
  console.log('Generated: ' + OUTPUT + '\nsha256=' + sha(raw) + '\ngeneratedAt=' + now)
}
if (require.main === module) {
  try { main() } catch (e) { console.error(e.stack); process.exitCode = 1 }
}
