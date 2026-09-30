// trailApiLab · 预演剧本（纯函数层）
// 给定当前 State，产出该阶段应执行的命令清单。不接触 wx/cloud/store——
// tools/lab-dryrun-test.js 用真实 domain 在内存里把同一份剧本从头演到尾，
// trailApiLab/index.js 在云端把同一份剧本落到真实数据库。
//
// 阶段表（真人扮演发起人，在 UI 里做所有组织者动作；剧本只演其余角色）：
//   0 建档     5 个演员档案 + 2 个同行人（无需活动）
//   1 报名     5 组报名（含整组同行人；满员自动转候补）
//   —— 真人在 UI：审核报名（通过/拒绝/候补处理）——
//   2 修与撤   演员三改上车点、演员四退出
//   —— 真人在 UI：把活动推进到「集结中」——
//   3 签到     逐人签到（本人模拟定位 / 同行人代确认 manual）
//   —— 真人在 UI：分车（建车辆+排座位）→ 逐人上车核实 → 发车 → 推进「进行中」——
//   4 现场     位置上报 ×3 + 节点确认 ×1
//   —— 真人在 UI：现场面板看位置/节点，可亲手报备并结案一条异常 → 推进「收尾」——
//   5 到家     各演员确认到家（同行人行凭 proxyHome 授权由提交人代确认；仅收尾阶段开放）
//   —— 真人在 UI：推进「归档」，导出名单 ——
//
// 幂等设计：requestId 按阶段+对象确定性生成，重跑阶段 = 已执行命令幂等重放、只补新的。
'use strict'

const PREFIX = '[预演]'
const OWNER = { id: 'u-owner', name: '预演发起人', phone: '13800000000' }

const ACTORS = [
  { id: 'u-lab-01', name: '演员大壮', phone: '13800000001' },
  { id: 'u-lab-02', name: '演员小二', phone: '13800000002' },
  { id: 'u-lab-03', name: '演员张三', phone: '13800000003' },
  { id: 'u-lab-04', name: '演员李四', phone: '13800000004' },
  { id: 'u-lab-05', name: '演员王五', phone: '13800000005' },
]
const ACTOR_BY_ID = {}
ACTORS.forEach(a => { ACTOR_BY_ID[a.id] = a })

const COMPANIONS = [
  { ownerId: 'u-lab-02', id: 'c-lab-02-1', name: '同伴小六', phone: '13800000006' },
  { ownerId: 'u-lab-03', id: 'c-lab-03-1', name: '同伴小七', phone: '13800000007' },
]

function mkPerson(name, phone) {
  return { name, phone, emergency: { name: '预演调度', phone: '13800000000' }, medical: '' }
}

// ---- State 查询助手 ----

// 找到预演活动：标题以 [预演] 开头、非草稿；配置了发起人则限定其名下；取最新发布的。
function findLabActivity(state, ownerOpenid) {
  const list = state.activities
    .filter(a => a.title.indexOf(PREFIX) === 0 && a.phase !== 'draft' && a.phase !== 'cancelled')
    .filter(a => !ownerOpenid || a.ownerId === ownerOpenid)
    .sort((x, y) => String(y.publishedAt || '').localeCompare(String(x.publishedAt || '')))
  return list[0] || null
}

function actorOwnRow(state, activityId, actorId) {
  return state.signups.find(s => s.activityId === activityId
    && s.submittedByUserId === actorId && s.personRef.kind === 'user') || null
}

// 演员在本活动当前有效的报名行（未取消/未移除）
function actorRows(state, activityId, actorId) {
  return state.signups.filter(s => s.activityId === activityId
    && s.submittedByUserId === actorId && s.status !== 'cancelled' && s.status !== 'removed')
}

function confirmedRows(state, activityId) {
  return state.signups.filter(s => s.activityId === activityId && s.status === 'confirmed')
}

function pickupAt(activity, index) {
  const pks = activity.pickupPoints || []
  if (!pks.length) return null
  return pks[Math.min(index, pks.length - 1)]
}

// ---- 命令清单 ----

// stage 0：建档（无需活动）
function stageSetup() {
  const commands = []
  for (const a of ACTORS) {
    commands.push({
      actorId: a.id, requestId: 'lab-s0-profile-' + a.id.slice(-2),
      payload: { type: 'profile.save', person: mkPerson(a.name, a.phone) },
    })
  }
  for (const c of COMPANIONS) {
    commands.push({
      actorId: c.ownerId, requestId: 'lab-s0-comp-' + c.id.slice(-3),
      payload: { type: 'companion.save', companionId: null, person: mkPerson(c.name, c.phone) },
    })
  }
  return {
    title: '阶段 0 · 演员建档',
    commands,
    actors: ACTORS.map(a => ({ id: a.id, name: a.name })),
    hint: '演员已建档。下一步在真机用你的账号新建活动：标题以「' + PREFIX + '」开头，'
      + '人数上限建议 ≥8（含同行人），发布它，然后回来跑阶段 1。'
      + '若想试协作授权，把上面某位演员的身份码（openid）粘进「现场协作 / 车辆联络」授权表单。',
  }
}

// stage 1：报名。participants 按人显式构造；满员时由执行器转 waitlist 重试。
function stageSignups(state, activityId) {
  const activity = state.activities.find(a => a.id === activityId)
  if (!activity) return { error: '找不到活动 ' + activityId }
  if (activity.phase !== 'published') {
    return { error: '活动当前阶段是「' + activity.phase + '」，报名须在「已发布」阶段执行。' }
  }
  const commands = []
  const skips = []
  const roster = [
    { actor: ACTORS[0], extras: [], tripIndex: null },
    { actor: ACTORS[1], extras: [COMPANIONS[0]], tripIndex: 0 },
    { actor: ACTORS[2], extras: [COMPANIONS[1]], tripIndex: null },
    { actor: ACTORS[3], extras: [], tripIndex: 1 },
    { actor: ACTORS[4], extras: [], tripIndex: null },
  ]
  for (const row of roster) {
    const existing = actorRows(state, activityId, row.actor.id)
    if (existing.length) { skips.push(row.actor.name + ' 已有报名，跳过（重放语义见 requestId）'); continue }
    // companionId 由服务端在 companion.save 时生成，须从档案按名字回查（ownerId+companionId 是授权闸门）
    const profile = state.profiles.find(p => p.id === row.actor.id)
    const companions = []
    for (const c of row.extras) {
      const comp = profile && profile.companions.find(x => x.person.name === c.name)
      if (!comp) return { error: row.actor.name + ' 的档案里没有同行人「' + c.name + '」。请先跑阶段 0 建档。' }
      companions.push(comp)
    }
    const participants = [{
      personRef: { kind: 'user', userId: row.actor.id },
      participant: mkPerson(row.actor.name, row.actor.phone),
      trip: row.tripIndex === null || !pickupAt(activity, row.tripIndex)
        ? { mode: 'self' }
        : { mode: 'shared', pickupPointId: pickupAt(activity, row.tripIndex).id },
      consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    }]
    for (const comp of companions) {
      participants.push({
        personRef: { kind: 'companion', ownerId: row.actor.id, companionId: comp.id },
        participant: mkPerson(comp.person.name, comp.person.phone),
        trip: row.tripIndex === null || !pickupAt(activity, row.tripIndex)
          ? { mode: 'self' }
          : { mode: 'shared', pickupPointId: pickupAt(activity, row.tripIndex).id },
        // 代报名需要同行人的明确授权（域层 CONSENT_REQUIRED 闸门）；
        // proxyHome 一并授权，收尾时提交人才能代确认同行人到家
        consent: { dataUse: true, proxyAuthority: true, proxyHome: true },
      })
    }
    commands.push({
      actorId: row.actor.id, requestId: 'lab-s1-' + row.actor.id.slice(-2),
      payload: { type: 'signup.submit', activityId, participants, keepTogether: true, mode: 'apply' },
    })
  }
  return {
    title: '阶段 1 · 报名',
    commands, skips,
    hint: '报名已提交（满员的组会自动转整组候补）。下一步到工作台「名单」面板审核：'
      + '通过演员一/二/三/四，演员五可试着拒绝或转正，然后回这里跑阶段 2。',
  }
}

// stage 2：修改与退出（建议在审核之后跑）
function stageAdjust(state, activityId) {
  const activity = state.activities.find(a => a.id === activityId)
  if (!activity) return { error: '找不到活动 ' + activityId }
  const commands = []
  const skips = []

  const a03 = ACTORS[2]
  const row03 = actorOwnRow(state, activityId, a03.id)
  if (!row03) skips.push('演员张三没有报名行，跳过修改')
  else if (row03.status === 'cancelled') skips.push('演员张三的报名已取消，跳过修改')
  else {
    const pk = pickupAt(activity, 0)
    const participant = JSON.parse(JSON.stringify(row03.participant))
    const trip = pk ? { mode: 'shared', pickupPointId: pk.id } : { mode: 'self' }
    if (!pk) participant.medical = '晕车，备晕车药（预演）'
    commands.push({
      actorId: a03.id, requestId: 'lab-s2-edit-03',
      payload: { type: 'signup.edit', activityId, signupId: row03.id, participant, trip, purpose: '改为搭乘集合车，更新上车点（预演）' },
    })
  }

  const a04 = ACTORS[3]
  const row04 = actorOwnRow(state, activityId, a04.id)
  if (!row04) skips.push('演员李四没有报名行，跳过退出')
  else if (row04.status === 'cancelled') skips.push('演员李四已退出过，跳过')
  else {
    commands.push({
      actorId: a04.id, requestId: 'lab-s2-cancel-04',
      payload: { type: 'signup.cancel', activityId, signupIds: [row04.id], reason: '临时有事，退出（预演）' },
    })
  }
  return {
    title: '阶段 2 · 修改与退出',
    commands, skips,
    hint: '演员张三已改上车点（会留编辑记录），演员李四已退出。到工作台确认名单变化后，'
      + '把活动推进到「集结中」，然后跑阶段 3。',
  }
}

// stage 3：签到（gathering）。本人行 → 模拟定位（无坐标退 manual）；同行人行 → 提交人代确认 manual。
// 分车与上车/发车核实是组织者的 UI 动作（且上车必须先有座位安排），不在剧本内。
function stageDepart(state, activityId) {
  const activity = state.activities.find(a => a.id === activityId)
  if (!activity) return { error: '找不到活动 ' + activityId }
  if (activity.phase !== 'gathering') {
    return { error: '活动当前阶段是「' + activity.phase + '」。请先在工作台推进到「集结中」再跑本阶段。' }
  }
  const rows = confirmedRows(state, activityId)
  if (!rows.length) return { error: '还没有已确认的报名：请先在工作台审核通过报名，再跑本阶段。' }
  const startCoords = activity.routeSnapshot.points[0] && activity.routeSnapshot.points[0].coordinates
  const commands = []
  const skips = []
  for (const s of rows) {
    const who = ACTOR_BY_ID[s.submittedByUserId]
    const label = who ? who.name : s.submittedByUserId
    const att = state.attendance.find(x => x.signupId === s.id)
    if (att && att.checkIn) { skips.push(label + ' 已签到，跳过'); continue }
    const isSelf = s.personRef.kind === 'user'
    const checkIn = isSelf && startCoords
      ? { method: 'simulation', evidence: { at: '', by: '', note: '本人定位签到（预演）' }, coordinates: startCoords }
      : { method: 'manual', evidence: { at: '', by: '', note: isSelf ? '已到集合点，现场情况正常（预演）' : '同行人已到，代确认（预演）' } }
    commands.push({
      actorId: s.submittedByUserId, requestId: 'lab-s3-checkin-' + s.id,
      payload: { type: 'attendance.checkin', activityId, signupId: s.id, checkIn },
    })
  }
  return {
    title: '阶段 3 · 签到',
    commands, skips,
    hint: '签到已落库。接下来是组织者的活：在工作台「分车」面板建车辆、排座位并提交安排，'
      + '然后到「现场」面板逐人「上车」核实、确认发车，把活动推进到「进行中」。'
      + '若你刚审核通过了新报名，重跑本阶段即可补签到。',
  }
}

// stage 4：现场（active）。位置=本人上报；节点=本人。异常报备/结案是组织者的 UI 动作，不在剧本内。
function stageField(state, activityId) {
  const activity = state.activities.find(a => a.id === activityId)
  if (!activity) return { error: '找不到活动 ' + activityId }
  if (activity.phase !== 'active') {
    return { error: '活动当前阶段是「' + activity.phase + '」。请先在工作台推进到「进行中」再跑本阶段。' }
  }
  const commands = []
  const skips = []
  const points = activity.routeSnapshot.points
  const base = (points[0] && points[0].coordinates) || { lat: 30.912, lng: 103.478 }
  const reporters = [ACTORS[0], ACTORS[1], ACTORS[2]]
  reporters.forEach((a, i) => {
    const row = actorOwnRow(state, activityId, a.id)
    if (!row || row.status !== 'confirmed') { skips.push(a.name + ' 无有效报名，跳过位置上报'); return }
    const existing = state.positions.find(p => p.signupId === row.id)
    if (existing) { skips.push(a.name + ' 已上报过位置（每人保留最新一条，重跑会覆盖）'); return }
    commands.push({
      actorId: a.id, requestId: 'lab-s4-pos-' + a.id.slice(-2),
      payload: {
        type: 'position.report', activityId, signupId: row.id, consent: true,
        coordinates: { lat: Number((base.lat + 0.0004 * (i + 1)).toFixed(6)), lng: Number((base.lng + 0.0003 * (i + 1)).toFixed(6)) },
      },
    })
  })
  const node = points.find(p => p.kind === 'checkpoint') || points[1]
  const row01 = actorOwnRow(state, activityId, ACTORS[0].id)
  if (node && row01 && row01.status === 'confirmed'
    && !(state.attendance.find(x => x.signupId === row01.id) || { nodes: [] }).nodes.some(n => n.pointId === node.id)) {
    commands.push({
      actorId: ACTORS[0].id, requestId: 'lab-s4-node-01',
      payload: { type: 'attendance.node', activityId, signupId: row01.id, pointId: node.id, note: '到达「' + node.name + '」（预演）' },
    })
  } else skips.push('节点确认跳过（无 checkpoint / 未确认 / 已到过）')
  return {
    title: '阶段 4 · 现场',
    commands, skips,
    hint: '位置上报与节点确认已落库。到工作台「现场」面板看位置点，到详情页看演员大壮的节点记录；'
      + '可以亲手给某位演员报备一条异常（收尾前记得结案）。然后跑阶段 5 收口。',
  }
}

// stage 5：到家（closing——域层规定「行程结束后」才可确认到家）。
// 每人确认自己；同行人行凭 proxyHome 授权由提交人代确认。
function stageClose(state, activityId) {
  const activity = state.activities.find(a => a.id === activityId)
  if (!activity) return { error: '找不到活动 ' + activityId }
  if (activity.phase !== 'closing') {
    return { error: '活动当前阶段是「' + activity.phase + '」。到家确认在「收尾」阶段开放（域层规则：行程结束后）。请先推进到「收尾」。' }
  }
  const rows = confirmedRows(state, activityId)
  if (!rows.length) return { error: '没有已确认的报名，无从确认到家。' }
  const commands = []
  const skips = []
  for (const s of rows) {
    const att = state.attendance.find(x => x.signupId === s.id)
    if (att && att.home) { skips.push((ACTOR_BY_ID[s.submittedByUserId] || { name: s.submittedByUserId }).name + ' 该行已确认到家，跳过'); continue }
    commands.push({
      actorId: s.submittedByUserId, requestId: 'lab-s5-home-' + s.id,
      payload: { type: 'attendance.home', activityId, signupId: s.id, note: s.personRef.kind === 'user' ? '已安全到家（预演）' : '同行人已安全到家，代确认（预演）' },
    })
  }
  return {
    title: '阶段 5 · 到家',
    commands, skips,
    hint: '全员到家已确认。下一步把活动推进「归档」（未结异常会挡住归档门槛），'
      + '然后在名单面板试「导出名单」（CSV 复制到剪贴板）。全程结束后跑 cleanup 清理预演数据。',
  }
}

const STAGE_IDS = [0, 1, 2, 3, 4, 5]
const STAGE_MENU = '0 建档 / 1 报名 / 2 修与撤 / 3 签到 / 4 现场 / 5 到家'
const STAGE_BUILDERS = {
  0: state => stageSetup(),
  1: (state, ctx) => stageSignups(state, ctx.activityId),
  2: (state, ctx) => stageAdjust(state, ctx.activityId),
  3: (state, ctx) => stageDepart(state, ctx.activityId),
  4: (state, ctx) => stageField(state, ctx.activityId),
  5: (state, ctx) => stageClose(state, ctx.activityId),
}

function hasStage(stage) {
  return STAGE_IDS.indexOf(stage) !== -1
}

function buildStage(stage, state, ctx) {
  const builder = STAGE_BUILDERS[stage]
  if (!builder) return { error: '未知阶段 ' + stage + '（可用：' + STAGE_MENU + '）' }
  return builder(state, ctx || {})
}

// ---- 阶段状态板（inspect 用；done=已完成 / ready=可执行 / blocked=被前置挡住）----
// 判定全部基于当前 State，与各阶段的幂等/跳过语义一致：
// 已取消的报名不算"撤回阶段 1"，但会让阶段 1 稳定保持 done（按"提交过"判定）。
function buildStageBoard(state, activityId) {
  const TITLES = ['阶段 0 · 建档', '阶段 1 · 报名', '阶段 2 · 修改与退出', '阶段 3 · 签到', '阶段 4 · 现场', '阶段 5 · 到家']
  const activity = activityId ? state.activities.find(a => a.id === activityId) : null
  const phase = activity ? activity.phase : ''
  const rowsOf = actorId => state.signups.filter(s => s.activityId === activityId && s.submittedByUserId === actorId)
  const currentRows = activityId ? state.signups.filter(s => s.activityId === activityId
    && s.status !== 'cancelled' && s.status !== 'removed') : []
  const confirmed = currentRows.filter(s => s.status === 'confirmed')
  const att = sid => state.attendance.find(x => x.signupId === sid) || { nodes: [] }

  const allActorsIn = ACTORS.every(a => !!state.profiles.find(p => p.id === a.id))
  const companionsIn = COMPANIONS.every(c => {
    const p = state.profiles.find(p => p.id === c.ownerId)
    return !!p && p.companions.some(x => x.person.name === c.name)
  })
  const everyoneSubmitted = ACTORS.every(a => rowsOf(a.id).length > 0)
  const everyoneHome = confirmed.length > 0 && confirmed.every(s => !!att(s.id).home)
  const anyPosition = activityId && state.positions.some(p => currentRows.some(s => s.id === p.signupId))
  const nodeVisited = activityId && currentRows.some(s => {
    const row = rowsOf(s.submittedByUserId).find(x => x.personRef.kind === 'user' && x.id === s.id)
    return row && att(row.id).nodes.length > 0
  })

  const board = []
  board.push({ stage: 0, title: TITLES[0], status: allActorsIn && companionsIn ? 'done' : 'ready',
    reason: allActorsIn && companionsIn ? '' : '5 位演员与 2 位同行人尚未建档' })

  if (!activity) board.push({ stage: 1, title: TITLES[1], status: 'blocked', reason: '先在真机新建活动：标题以「' + PREFIX + '」开头，发布后再来' })
  else if (phase !== 'published') board.push({ stage: 1, title: TITLES[1], status: everyoneSubmitted ? 'done' : 'blocked', reason: everyoneSubmitted ? '' : '报名须在「已发布」阶段执行，当前是「' + phase + '」' })
  else board.push({ stage: 1, title: TITLES[1], status: everyoneSubmitted ? 'done' : 'ready', reason: everyoneSubmitted ? '' : '尚未报名（满员的组会自动转整组候补）' })

  const a04gone = rowsOf('u-lab-04').every(s => ['cancelled', 'removed'].indexOf(s.status) !== -1) && rowsOf('u-lab-03').length > 0
  if (!activity || !everyoneSubmitted) board.push({ stage: 2, title: TITLES[2], status: 'blocked', reason: '等阶段 1 完成后再跑' })
  else if (phase !== 'published') board.push({ stage: 2, title: TITLES[2], status: a04gone ? 'done' : 'ready', reason: a04gone ? '' : '演员张三改上车点、演员李四退出（建议在审核后、推进前执行）' })
  else board.push({ stage: 2, title: TITLES[2], status: a04gone ? 'done' : 'ready', reason: a04gone ? '' : '建议先在 UI 审核报名，再跑本阶段' })

  const allCheckedIn = confirmed.length > 0 && confirmed.every(s => !!att(s.id).checkIn)
  if (!activity || phase === 'draft' || phase === 'published') board.push({ stage: 3, title: TITLES[3], status: 'blocked', reason: '先在 UI 完成审核，把活动推进到「集结中」' })
  else if (phase === 'gathering') board.push({ stage: 3, title: TITLES[3], status: allCheckedIn ? 'done' : 'ready', reason: allCheckedIn ? '' : '逐人签到（本人模拟定位 / 同行人代确认）' })
  else board.push({ stage: 3, title: TITLES[3], status: allCheckedIn ? 'done' : 'blocked', reason: allCheckedIn ? '' : '阶段已到「' + phase + '」；若刚转正了候补，退回集结中不可行，请让新演员在详情页自行签到' })

  if (!activity || ['gathering', 'published', 'draft'].indexOf(phase) !== -1) board.push({ stage: 4, title: TITLES[4], status: 'blocked', reason: '位置上报须在「进行中」阶段' })
  else board.push({ stage: 4, title: TITLES[4], status: anyPosition && nodeVisited ? 'done' : phase === 'active' ? 'ready' : (anyPosition ? 'done' : 'blocked'), reason: anyPosition && nodeVisited ? '' : phase === 'active' ? '3 人位置上报 + 演员大壮的节点确认' : '阶段已到「' + phase + '」' })

  if (!activity || phase !== 'closing') board.push({ stage: 5, title: TITLES[5], status: everyoneHome ? 'done' : 'blocked', reason: everyoneHome ? '' : '到家确认在「收尾」阶段开放（域层规则：行程结束后）' })
  else board.push({ stage: 5, title: TITLES[5], status: everyoneHome ? 'done' : 'ready', reason: everyoneHome ? '' : '全员确认到家（同行人行凭 proxyHome 代确认）' })

  return board
}

module.exports = { PREFIX, OWNER, ACTORS, COMPANIONS, STAGE_MENU, hasStage, findLabActivity, buildStage, buildStageBoard, mkPerson, pickupAt }
