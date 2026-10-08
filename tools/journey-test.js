// 状态可解释性层回归：node tools/journey-test.js
//
// 这一套测的不是「好不好看」，而是「用户看不看得到自己在哪儿、下一步是什么」。
// 判据全部是可断言的性质：
//   · 任何阶段/状态枚举都不可能把英文原值印到界面上；
//   · 每个错误码都必须有「标题 + 原因」，不允许有码落到兜底文案；
//   · 参与者十二态每一态都要给出下一步与一个可点的动作；
//   · self 与 shared 的「怎么去」必须各说各的，self 不出现车辆字段；
//   · 领队待办按是否阻塞推进排序；
//   · 时间线在强光下不能只靠颜色，必须有 ✓/●/○ 形状标记。
'use strict'

const J = require('../miniprogram/utils/journey')
const F = require('../miniprogram/utils/format')
const { ERROR_CODES } = require('../cloudfunctions/trailApi/domain/contracts')

let passed = 0
let failed = 0
const fails = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; fails.push(name); console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const NOW = '2026-10-08T07:00:00+08:00'
const MEET = '2026-10-11T07:00:00+08:00'
const START = '2026-10-11T08:00:00+08:00'
const DEADLINE = '2026-10-10T20:00:00+08:00'

/* ================= 1. 一套词汇，不允许有第二套 ================= */

section('1. 阶段与状态标签只有一套出处，且永不外泄英文枚举')
{
  const phases = Object.keys(F.PHASE_LABELS)
  for (const p of phases) {
    check('phaseLabel(' + p + ') 是中文', /^[一-鿿]/.test(J.phaseLabel(p)), J.phaseLabel(p))
    check('phaseScene(' + p + ') 说了这一刻在发生什么', J.phaseScene(p).length >= 8 && /[一-鿿]/.test(J.phaseScene(p)), J.phaseScene(p))
    check('phaseTone(' + p + ') 取自既有语气档位', ['neutral', 'success', 'warning'].indexOf(J.phaseTone(p)) !== -1, J.phaseTone(p))
  }
  check('未知阶段也给中文而不是把枚举原样打印', J.phaseLabel('weird_phase') === '安排整理中' && !/weird/.test(J.phaseLabel('weird_phase')), J.phaseLabel('weird_phase'))
  check('未知报名状态不回退成英文裸值（要么中文、要么标注待配置）', J.signupLabel('pending') === '待审核' && typeof J.signupLabel('nope') === 'string', J.signupLabel('nope'))
  const filters = J.statusFilterOptions()
  check('筛选器选项直接来自 STATUS_LABELS（不再有两份漂移）',
    filters.length === Object.keys(F.STATUS_LABELS).length + 1
      && filters.slice(1).every((o, i) => o.label === F.STATUS_LABELS[Object.keys(F.STATUS_LABELS)[i]]),
    JSON.stringify(filters.map(f => f.label)))
  check('筛选器第一项是「全部状态」', filters[0].value === 'all' && filters[0].label === '全部状态')
}

/* ================= 2. 倒计时：从「无人调用」变成真的有人用 ================= */

section('2. 剩余时间读数（户外一眼看懂：只给一个主单位）')
{
  const cases = [
    ['2026-10-08T07:00:00+08:00', '2026-10-08T07:30:00+08:00', '剩 30 分钟', true],
    ['2026-10-08T07:00:00+08:00', '2026-10-08T09:00:00+08:00', '剩 2 小时', true],
    ['2026-10-08T07:00:00+08:00', '2026-10-10T07:00:00+08:00', '剩 2 天', false],
    ['2026-10-08T07:00:00+08:00', '2026-10-08T06:00:00+08:00', '已过时', false],
    ['2026-10-08T07:00:00+08:00', '2026-10-08T07:00:30+08:00', '就在眼前', true],
  ]
  for (const [now, at, text, soon] of cases) {
    const r = J.remaining(now, at)
    check('remaining(' + at.slice(11, 16) + ') = ' + text, r.text === text && r.soon === soon, JSON.stringify(r))
  }
  check('没有日期时说「时间待定」而不是 NaN', J.remaining(NOW, null).text === '时间待定' && J.remaining(NOW, 'garbage').text === '时间待定')
  check('overdue 只在过去时为真', J.remaining(NOW, '2026-10-07T00:00:00+08:00').overdue === true && J.remaining(NOW, START).overdue === false)
  const same = J.dayPrefix(NOW, '2026-10-08T20:00:00+08:00')
  const next = J.dayPrefix(NOW, '2026-10-09T08:00:00+08:00')
  check('今天 → 今天', same === '今天', same)
  check('次日 → 明天', next === '明天', next)
}

/* ================= 3. 参与者十二态：每态都要能回答四问 ================= */

section('3. participantNext：每个 detailState 都有状态、里程碑、下一步与可点动作')
{
  const STATES = ['new', 'pending', 'confirmed', 'ready', 'gathering', 'checked', 'active', 'closing', 'finished', 'waitlist', 'closed', 'cancelled']
  for (const state of STATES) {
    const ctx = {
      phase: 'published', detailState: state, now: NOW,
      startAt: START, deadlineAt: DEADLINE, meetingAt: MEET,
      tripMode: 'shared', pickupName: '茶店子', vehicleLabel: '一号车', seatLabel: '1A', driverLabel: '张师傅',
    }
    const out = J.participantNext(ctx)
    check(state + '：状态标签非空且中文', !!out.status && /[一-鿿]/.test(out.status), JSON.stringify(out.status))
    check(state + '：说了下一步是什么', !!out.nextTitle && /[一-鿿]/.test(out.nextTitle), out.nextTitle)
    check(state + '：给了可点动作', !!out.cta && !!out.cta.label && ['signup', 'sheet', 'meeting', 'discover', 'notices'].indexOf(out.cta.target) !== -1, JSON.stringify(out.cta))
    check(state + '：有时间锚点（里程碑）', !!out.milestone, out.milestone)
    check(state + '：语气落在既有档位', ['info', 'success', 'warning', 'neutral'].indexOf(out.statusTone) !== -1, out.statusTone)
  }
  // self / shared 的分歧是本项目最容易说谎的地方
  check('十二态文案仍只在 format.js 里定义一份（本层不得另起一套）',
    Object.keys(F.DETAIL_STATE_TITLES).every(s => J.participantNext({ detailState: s, now: NOW }).nextTitle === F.DETAIL_STATE_TITLES[s][0]),
    JSON.stringify(Object.keys(F.DETAIL_STATE_TITLES).filter(s => J.participantNext({ detailState: s, now: NOW }).nextTitle !== F.DETAIL_STATE_TITLES[s][0])))
  const shared = J.participantNext({ detailState: 'ready', phase: 'published', now: NOW, startAt: START, meetingAt: MEET, tripMode: 'shared', pickupName: '茶店子', vehicleLabel: '一号车', seatLabel: '2B', driverLabel: '张师傅' })
  check('shared 的「怎么去」含上车点、车、座位、司机', /茶店子/.test(shared.how) && /一号车/.test(shared.how) && /2B 座/.test(shared.how) && /张师傅/.test(shared.how), shared.how)
  check('shared 但还没排到车时不编造车辆', /车辆待领队安排/.test(J.participantNext({ detailState: 'ready', phase: 'published', now: NOW, meetingAt: MEET, tripMode: 'shared' }).how))
  const self = J.participantNext({ detailState: 'ready', phase: 'published', now: NOW, meetingAt: MEET, startAt: START, tripMode: 'self', pickupName: '茶店子' })
  check('self 明说自行前往，且不摆车辆/座位字段', /自行前往/.test(self.how) && !/座/.test(self.how.replace('集合', '')) && !/车：/.test(self.how), self.how)
  const gone = J.participantNext({ detailState: 'cancelled', phase: 'cancelled', now: NOW, tripMode: 'shared' })
  check('活动取消态仍给出路（不是只剩一句已取消），且不再宣称乘车安排', !!gone.cta && gone.how === '', JSON.stringify(gone))
  check('待确认与候补不写「去签到」这种做不到的动作',
    ['signup', 'meeting'].indexOf(J.participantNext({ detailState: 'pending', phase: 'published', now: NOW }).cta.target) !== -1
      && ['signup', 'meeting'].indexOf(J.participantNext({ detailState: 'waitlist', phase: 'published', now: NOW }).cta.target) !== -1)
  check('集合态的主动作是去签到', J.participantNext({ detailState: 'gathering', phase: 'gathering', now: NOW, meetingAt: MEET }).cta.target === 'sheet')
}

/* ================= 4. 领队待办与阶段门槛 ================= */

section('4. leaderQueue / transitionBlocker：先说拦路的，再说能做的')
{
  const q = J.leaderQueue({
    phase: 'published', now: NOW, deadlineAt: DEADLINE, meetingAt: MEET, startAt: START, vehicleTravel: 5,
    counters: { pending: 3, waitlisted: 1, unassigned: 2, unchecked: 4, openIncidents: 0, pendingHome: 0 },
  })
  check('待办按「先确认后排队再清点」排序', q.items.map(i => i.id).join() === 'review,transport,checkin', JSON.stringify(q.items.map(i => i.id)))
  check('primary 就是第一条（一个页面一个主动作）', q.primary && q.primary.id === 'review')
  check('每条待办都带人数，不是光一个标题', q.items.every(i => /[0-9]/.test(i.detail)), JSON.stringify(q.items))
  check('每条待办都指向能解决的分区', q.items.every(i => ['roster', 'transport', 'field', 'edit'].indexOf(i.target) !== -1))
  check('里程碑给出报名截止倒计时', /剩 .*截止/.test(q.milestone), q.milestone)

  const clean = J.leaderQueue({ phase: 'published', now: NOW, startAt: START, meetingAt: MEET, vehicleTravel: 2, counters: { pending: 0, waitlisted: 0, unassigned: 0, unchecked: 0, openIncidents: 0, pendingHome: 0 } })
  check('没有拦路事时明说「暂时没有」，不摆一堆 0', clean.items.length === 1 && clean.items[0].id === 'idle' && clean.items[0].blocking === false, JSON.stringify(clean.items))

  const draft = J.leaderQueue({ phase: 'draft', now: NOW, counters: {} })
  check('草稿唯一待办是发布', draft.items.length === 1 && draft.items[0].target === 'edit' && draft.items[0].blocking === true, JSON.stringify(draft))

  check('集合前的门槛说清「谁挡着」', /待审核/.test(J.transitionBlocker({ next: 'gathering', counters: { pending: 2 } })), J.transitionBlocker({ next: 'gathering', counters: { pending: 2 } }))
  check('出发前的门槛提到车长任务页', /车长任务页/.test(J.transitionBlocker({ next: 'active', counters: {}, unassignedBoarding: 2 })), J.transitionBlocker({ next: 'active', counters: {}, unassignedBoarding: 2 }))
  check('归档前的门槛区分到家与异常', /到家/.test(J.transitionBlocker({ next: 'archived', counters: { pendingHome: 1 } })) && /异常/.test(J.transitionBlocker({ next: 'archived', counters: { openIncidents: 1 } })))
  check('协调中也会挡住归档（与域内同一条件）', /协调中/.test(J.transitionBlocker({ next: 'archived', counters: {}, coordinating: 1 })))
  check('已出发后不能再取消', /不能再取消/.test(J.transitionBlocker({ next: 'cancelled', counters: {}, hasTravelFact: true })))
  check('没有门槛时返回空串（不硬造阻碍）', J.transitionBlocker({ next: 'closing', counters: {} }) === '')
}

/* ================= 5. 时间线只是投影 ================= */

section('5. timeline：形状 + 文字标记，不靠颜色独承重')
{
  const t = J.timeline(NOW, 'active')
  check('节点顺序与阶段推进一致', t.map(x => x.phase).join() === 'published,gathering,active,closing,archived', JSON.stringify(t.map(x => x.phase)))
  check('已过去的标 ✓、当前标 ●、未来标 ○', t[0].mark === '✓' && t[2].mark === '●' && t[4].mark === '○', JSON.stringify(t.map(x => x.mark)))
  check('当前节点有 current 文字位（不只颜色）', t[2].current === true && t[2].done === false)
  check('归档后全部 ✓', J.timeline(NOW, 'archived').every(x => x.mark === '✓' && x.done === true))
  check('取消后不留「进行中」的假象', J.timeline(NOW, 'cancelled').every(x => x.current === false))
  check('每个节点都是中文标签', t.every(x => /^[一-鿿]+$/.test(x.label)))
}

/* ================= 6. 每个错误码都要能被解释 ================= */

section('6. explain：39 命令族会用到的每个错误码都有标题与原因')
{
  const missing = []
  for (const code of ERROR_CODES) {
    const out = J.explain({ code, message: '原始信息' }, { counters: { pending: 1, unchecked: 1, unassigned: 1, pendingHome: 1, openIncidents: 1 }, next: 'active' })
    if (!out.title || out.title === '这一步没有完成' && code !== 'UNKNOWN') missing.push(code + '（无专属标题）')
    if (!out.cause || !/[一-鿿]/.test(out.cause)) missing.push(code + '（原因不是人话）')
  }
  check(ERROR_CODES.length + ' 个错误码全部落到人话', missing.length === 0, JSON.stringify(missing))
  check('CONFLICT 说清「已被别人改过 + 已重读 + 再做一次」', /改过|更新/.test(J.explain({ code: 'CONFLICT', message: '' }, {}).cause))
  check('网络失败明确「原安排没被改动」', /原安排没被改动/.test(J.explain({ code: 'NETWORK', message: '' }, {}).cause))
  check('座位类错误给出跳回分车区的动作', J.explain({ code: 'SEAT_TAKEN', message: 'm' }, {}).action.target === 'transport')
  check('安全收尾类错误给出跳向现场的动作', J.explain({ code: 'UNRESOLVED_SAFETY', message: 'm' }, { counters: { pendingHome: 2 } }).action.target === 'field')
  check('出发门槛带上「几个人没签到/没排车」的具体数', /1/.test(J.explain({ code: 'UNRESOLVED_DEPARTURE', message: 'm' }, { next: 'active', counters: { unchecked: 1, unassigned: 1 } }).cause))
  check('服务端的原始 message 不被丢弃（无专属解释时仍显示它）',
    J.explain({ code: 'GROUP_SCOPE', message: '同行组需要安排同车；请先明确记录允许分开。' }, {}).cause.indexOf('同行组') !== -1)
  check('未知码走兜底且不崩', J.explain({}, {}).title === '这一步没有完成')
  check('disabledReason 空因不硬凑', J.disabledReason('') === '' && /现在不能点/.test(J.disabledReason('还差一步')))
}

/* ================= 6b. 指标位、构成行与只读锁：措辞只有一份，切换要有反照 ================= */

section('6b. 指标位 / 出行方式构成 / 排车只读锁')
{
  const c = { confirmed: 6, selfTravel: 2, vehicleTravel: 4, assigned: 3 }
  check('构成行把「自行前往」与「需要乘车」分成两格说',
    J.tripMixLine(c) === '全部已确认 6 · 自行前往 2 · 需要乘车 4（已安排 3）', J.tripMixLine(c))
  check('缺字段按 0 说话，不印 undefined', /0/.test(J.tripMixLine({})) && !/undefined/.test(J.tripMixLine({})))
  check('指标位在集合阶段看签到、收尾阶段看到家（会随阶段变，不是恒一条）',
    J.fieldMetric('gathering').key === 'unchecked' && J.fieldMetric('published').label === '待签到'
    && J.fieldMetric('closing').key === 'pendingHome' && J.fieldMetric('archived').label === '待到家')
  check('排车锁：出发前可安排，出发后与结束后改为只读并说出去哪儿补',
    J.transportLock('published') === '' && J.transportLock('draft') === ''
    && /只读/.test(J.transportLock('active')) && /现场/.test(J.transportLock('active'))
    && /回看/.test(J.transportLock('archived')) && /回看/.test(J.transportLock('cancelled')))
  check('锁文案不与服务端门槛相反（transport.js 只放行 published/gathering 写）',
    ['gathering', 'published'].every(p => J.transportLock(p) === '')
    && ['active', 'closing', 'archived', 'cancelled'].every(p => J.transportLock(p) !== ''))
}

/* ================= 7. 反空断言：这些性质不是恒真 ================= */
section('7. 反空断言（判据本身有牙）')
{
  const labels = Object.keys(F.PHASE_LABELS).map(p => J.phaseLabel(p))
  check('阶段标签不是同一个常量串（否则测不出漂移）', new Set(labels).size === labels.length, JSON.stringify(labels))
  const marks = J.timeline(NOW, 'active').map(x => x.mark).join('')
  check('时间线三种标记同时存在（不是恒返回 ✓）', /✓/.test(marks) && /●/.test(marks) && /○/.test(marks), marks)
  const selfHow = J.participantNext({ detailState: 'ready', now: NOW, tripMode: 'self', meetingAt: MEET }).how
  const sharedHow = J.participantNext({ detailState: 'ready', now: NOW, tripMode: 'shared', meetingAt: MEET, vehicleLabel: '一号车' }).how
  check('self 与 shared 的「怎么去」确实不同文', selfHow !== sharedHow && !/一号车/.test(selfHow))
  check('排序会随事实变化（不是写死的第一条）',
    J.leaderQueue({ phase: 'gathering', now: NOW, counters: { unchecked: 2, pending: 0, unassigned: 0 }, vehicleTravel: 2 }).primary.id === 'checkin')
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
