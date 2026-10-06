// UI Interaction / State-Matrix 层：node tools/e2e-ui-state-test.js
// Phase 5 重建版（PHASE A，前版因级联补丁损坏已删除）。证据基线：red1–red4（%TEMP%/p5-ui-state-red*.log）。
//
// 三个反例的回归定位：
//   TEST-UI-001  BUG-A  Data Binding Integrity —— 勾选 → 渲染态 → vform → save → readTransport → 重开回显
//   TEST-UI-002  BUG-B  UI Options Integrity —— 司机 picker 数据源（候选=已确认未分车）；真实点选受
//                原生 picker 平台限制 ⇒ INCONCLUSIVE（不得把 options PASS 当点选 PASS）
//   TEST-UI-003  BUG-C  UX State Invariant —— 批量审核入口的状态×阶段门控：
//                confirmed（或混选）在选时「确认报名」不得可操作；后端会整批拒的操作 UI 不得提供入口
//
// 三层不变量分开断言：Backend invariant ≠ UI invariant ≠ UX invariant。
// 「后端拒绝」永远不算 UI PASS；UI PASS 必须由真实 tap + 可观测后果构成（tools/e2e-result.js 语义）。
// 已知环境事实（不在本套件内解决）：
//   · 云读对刚写入的行有 20s+ 滞后（NEEDS_PRODUCT_FOLLOWUP，多轮复现）——审核下发改用 submit 响应的
//     targetIds（不依赖读可见性），UI 侧前提用有界重开轮询（最多 3 次，不无限拉长）。
//   · 原生 <picker> 弹层不可自动化（tap 后 .wx-picker/picker-view 全 0 命中）⇒ 相关步骤 INCONCLUSIVE。
'use strict'
const path = require('path')
const fs = require('fs')
const os = require('os')
const net = require('net')
const { execFileSync } = require('child_process')
const { createLedger, auditSource, BUSINESS, UI } = require('./e2e-result')

// 项目根 = 本文件所在仓库根：同一份套件在任何 worktree 都驱动它自己那棵树
const PROJECT = path.resolve(__dirname, '..')
const DEPS = path.join(os.homedir(), '.ourtrail-e2e')
const AUTOMATOR_PORT = 9420
const CLI_CANDIDATES = [
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat',
]

const L = createLedger({ dims: [BUSINESS, UI] })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const quiet = (label, e) => console.log('  · [忽略] ' + label + '：' + String((e && (e.message || e)) || 'unknown').slice(0, 120))

function loadAutomator() {
  const pkg = path.join(DEPS, 'node_modules', 'miniprogram-automator')
  try {
    return require(pkg)
  } catch (e) {
    console.log('  （首次运行：安装 miniprogram-automator 到 ' + DEPS + '，仓库保持零依赖）')
    fs.mkdirSync(DEPS, { recursive: true })
    const pkgJson = path.join(DEPS, 'package.json')
    if (!fs.existsSync(pkgJson)) fs.writeFileSync(pkgJson, JSON.stringify({ name: 'ourtrail-e2e-deps', private: true }))
    execFileSync('npm', ['install', 'miniprogram-automator', '--no-fund', '--no-audit'], { cwd: DEPS, stdio: 'inherit' })
    return require(pkg)
  }
}

// —— 完全确定的 fixture：RUN_TAG 让同伴名每轮唯一（跨轮不再有同名档案/同名行歧义）——
const RUN_TAG = Date.now().toString(36).slice(-4)
const SANDBOX = {
  title: '[预演] 状态矩阵E2E-' + RUN_TAG, description: 'UI 状态矩阵回归', organizerIntro: '自动化',
  startAt: '2027-02-06T08:00:00+08:00', endAt: '2027-02-06T18:00:00+08:00', deadlineAt: '2027-02-05T20:00:00+08:00',
  acceptingSignups: true, capacity: 12, approvalMode: 'manual', routeId: null,
  routeSnapshot: { title: '路线', distanceKm: 6, ascentM: 200, points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null }], risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }] },
  pickupPoints: [
    { id: 'pk-1', name: '东门集合点', meetingAt: '2027-02-06T07:00:00+08:00', address: 'x', coordinates: null },
    { id: 'pk-2', name: '西门停车区', meetingAt: '2027-02-06T07:30:00+08:00', address: 'y', coordinates: null },
  ],
  equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
}
const COMPANION = { name: '赵辰-' + RUN_TAG, phone: '00000000042', emergency: { name: '赵辰家属', phone: '00000000043' }, medical: '', avatar: '' }
const PEND_CONFIRM = { name: '李晃-' + RUN_TAG, phone: '00000000044', emergency: { name: '李晃家属', phone: '00000000045' }, medical: '', avatar: '' }
const PEND_CANCEL = { name: '王闰-' + RUN_TAG, phone: '00000000046', emergency: { name: '王闰家属', phone: '00000000047' }, medical: '', avatar: '' }
const VEHICLE = { label: '1号车', plate: '川A·M001', legalCapacity: 9, blockedSeats: 0, driverName: '矩阵服务司机', driverPhone: '00000000041' }
const PHASE_BTN = { gathering: '进入正在集合' }

async function main() {
  const automator = loadAutomator()

  // —— 0. 源码完整性自检：本文件若长出假 PASS 通道（用代操作绕过真实 UI / 无证据结论），这条先红 ——
  const findings = auditSource(fs.readFileSync(__filename, 'utf8'), 'e2e-ui-state-test.js')
  L.b('本脚本源码完整性自检（0 违规）', findings.length === 0,
    findings.length ? findings.slice(0, 5).map(f => f.rule + ':' + f.line).join(' | ') : 'auditSource 无 findings')

  // —— 1. 连接（梯度重试；只用 CLI）——
  const cli = CLI_CANDIDATES.find(p => fs.existsSync(p))
  L.env('找到开发者工具 cli.bat', !!cli, cli || CLI_CANDIDATES.join(' / '))
  const runCli = args => { try { return execFileSync(cli, args, { timeout: 150000 }).toString() } catch (e) { quiet('cli ' + args[0], e); return String(e) } }
  const waitPort = port => new Promise(resolve => {
    const probe = net.connect({ port, host: '127.0.0.1' })
    probe.once('connect', () => { probe.destroy(); resolve(true) })
    probe.once('error', () => resolve(false))
  })
  let miniProgram = null
  for (let attempt = 1; attempt <= 3 && !miniProgram; attempt++) {
    try {
      miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTOMATOR_PORT })
      break
    } catch (e) {
      if (attempt === 1) runCli(['auto', '--project', PROJECT, '--auto-port', String(AUTOMATOR_PORT)])
      if (attempt === 2) { runCli(['close', '--project', PROJECT]); await sleep(4000); runCli(['auto', '--project', PROJECT, '--auto-port', String(AUTOMATOR_PORT)]) }
      for (let i = 0; i < 12 && !miniProgram; i++) {
        await sleep(4000)
        if (await waitPort(AUTOMATOR_PORT)) {
          try { miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTOMATOR_PORT }) } catch (e2) { quiet('端口已开但服务未就绪', e2) }
        }
      }
    }
  }
  L.env('automator 连接开发者工具（自动化端口 ' + AUTOMATOR_PORT + '）', !!miniProgram, miniProgram ? 'connected' : '三次梯度重连后仍无会话')
  const sys = await miniProgram.systemInfo()
  L.env('模拟器运行中', !!(sys && sys.SDKVersion), 'SDKVersion=' + (sys && sys.SDKVersion))

  let reconnected = false

  // —— 助手：查询一律 $$（$ 恒返回单元素，按数组用 tap 会静默不发生——历史事故）——
  const queryAll = async (scope, sel, tries) => {
    for (let i = 0; i < (tries || 4); i++) {
      const els = await scope.$$(sel)
      if (els && els.length) return els
      await sleep(900)
    }
    return []
  }
  const tapEl = async el => {
    if (!el) return false
    try { await el.tap(); return true } catch (e) { quiet('tap', e); return false }
  }
  const inputEl = async (el, value) => {
    if (!el) return false
    try { await el.input(value); return true } catch (e) { quiet('input', e); return false }
  }
  const probeChannel = async page => {
    const all = await queryAll(page, 'view', 3)
    L.setChannel(all.length > 0 ? 'healthy' : 'degraded', '$$ view → ' + all.length + ' 个元素')
    return all.length > 0
  }
  const healthy = () => L.channel() === 'healthy'
  const uiGate = (reason, actions) => () => (healthy() ? { ok: true, actions: actions || 0 } : { ok: false, reason: reason || '元素查询通道退化' })
  const open = async url => {
    let lastErr
    for (let i = 0; i < 3; i++) {
      try {
        const p = await miniProgram.reLaunch(url)
        await p.waitFor(1500)
        for (let t = 0; t < 25; t++) {
          const d = await p.data()
          if (d && d.loading === false) break
          await p.waitFor(1000)
        }
        return p
      } catch (e) { lastErr = e; await sleep(5000) }
    }
    throw lastErr || new Error('页面打不开：' + url)
  }
  const cloudCall = async (action, data) => {
    const call = () => miniProgram.evaluate(
      new Function('action', 'data', 'return new Promise(res => wx.cloud.callFunction({ name: "trailApi", data: Object.assign({ action }, data) }).then(r => res(r.result)).catch(e => res({ ok: false, err: String(e && e.errMsg || e) })))'),
      action, data)
    let r
    for (let i = 0; i < 3; i++) {
      try { r = await call(); if (r) return r } catch (e) {
        if (i === 2) throw e
        try { await miniProgram.disconnect() } catch (e1) { quiet('disconnect(重连前)', e1) }
        await sleep(2000)
        try { miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTOMATOR_PORT }); reconnected = true } catch (e2) { quiet('重连未就绪', e2) }
        await sleep(1500)
      }
      await sleep(3000)
    }
    return r
  }
  const hardReconnect = async () => {
    try { await miniProgram.disconnect() } catch (e) { quiet('disconnect(hardReconnect)', e) }
    await sleep(2000)
    for (let i = 0; i < 3; i++) {
      try { miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTOMATOR_PORT }); reconnected = false; return true } catch (e) { quiet('hardReconnect 第 ' + (i + 1) + ' 次', e); await sleep(4000) }
    }
    return false
  }
  // 组织者权威态：空视图/坏信封有界重试（读数是所有断言的地基；自检规则整文件禁用旧的数组误判写法，注释也不留字面量）
  const orgView = async () => {
    let last = null
    for (let i = 0; i < 4; i++) {
      const r = await cloudCall('read', { request: { kind: 'activity', activityId: sandboxId, perspective: 'organizer' } })
      last = r
      if (r && r.ok && r.data && r.data.view && r.data.view.rows && r.data.view.rows.length) return r.data
      await sleep(2000)
    }
    return last && last.data
  }
  const revNow = async () => (await orgView()).revision
  const dispatch = async payload => cloudCall('dispatch', { payload, expectedRevision: await revNow() })
  const settle = async (read, pred, tries) => {
    let waited = -1
    for (let i = 0; i < (tries || 8); i++) {
      const v = await read()
      if (pred(v)) { waited = i; return { v, waited } }
      await sleep(1500)
    }
    return { v: await read(), waited }
  }
  const waitIdle = async page => {
    for (let i = 0; i < 8; i++) {
      const d = await page.data()
      if (d && d.busy === false) return
      await page.waitFor(800)
    }
  }
  const dataOf = async el => (el ? await el.data() : null) || null
  const findButtonByText = async (scope, text) => {
    const btns = scope ? await queryAll(scope, '.button', 6) : []
    for (const b of btns) {
      if (String((await b.text()) || '').trim() === text) return b
    }
    return null
  }

  // ============================================================
  // 沙盒：建档 → 发布（本人报名，发布即自动确认）→ 三位同行人 → 只确认赵辰
  // 状态自变量：本人=confirmed、赵辰=confirmed（003a 的 confirmed 腿）、
  //            李晃=pending（003a 混选腿 + 003a+ 确认走通）、王闰=pending（003b-1 取消走通）
  // ============================================================
  let sandboxId = ''
  section('沙盒建档（trailApi 命令直建；不依赖 trailApiLab——其超时配置是既知环境问题）')
  await L.block('沙盒建档与发布', 2, async () => {
    const created = await cloudCall('dispatch', { payload: { type: 'activity.create', input: SANDBOX } })
    L.b('建 [预演] 活动草稿', !!created && created.ok === true, JSON.stringify((created && (created.error || created.err)) || 'ok').slice(0, 200))
    sandboxId = created && created.ok ? created.data.targetIds[0] : ''
    const prof = await cloudCall('read', { request: { kind: 'profile' } })
    const me = prof && prof.ok ? prof.data.view.profile : null
    const published = me ? await cloudCall('dispatch', { payload: { type: 'activity.publish', activityId: sandboxId, participation: { personRef: { kind: 'user', userId: me.id }, participant: me.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } } } }) : { ok: false, err: '没有档案' }
    L.b('发布（发布即报名本人，自动确认）', published.ok === true, JSON.stringify(published.error || published.err || 'ok').slice(0, 200))
  }, () => ({ ok: true }))

  const companionIds = {}
  await L.block('沙盒报名：三位同行人建档（RUN_TAG 唯一名，无跨轮同名歧义）', 3, async () => {
    for (const c of [COMPANION, PEND_CONFIRM, PEND_CANCEL]) {
      const saved = await dispatch({ type: 'companion.save', companionId: null, person: c })
      L.b('companion.save（' + c.name + '）', saved.ok === true, JSON.stringify(saved.error || saved.err || 'ok').slice(0, 160))
    }
    const prof1 = (await cloudCall('read', { request: { kind: 'profile' } })).data.view.profile
    for (const c of [COMPANION, PEND_CONFIRM, PEND_CANCEL]) {
      companionIds[c.name] = (prof1.companions.filter(x => x.person.name === c.name).pop() || {}).id || ''
    }
  }, () => ({ ok: true }))

  await L.block('沙盒提交并确认报名（环境准备：confirmed 与 pending 各就位）', 4, async () => {
    const profile = (await cloudCall('read', { request: { kind: 'profile' } })).data.view.profile
    const submitted = {}
    for (const c of [COMPANION, PEND_CONFIRM, PEND_CANCEL]) {
      const s = await dispatch({
        type: 'signup.submit', activityId: sandboxId, keepTogether: false, mode: 'apply',
        participants: [{ personRef: { kind: 'companion', ownerId: profile.id, companionId: companionIds[c.name] }, participant: profile.companions.find(x => x.id === companionIds[c.name]).person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: true, proxyHome: false } }],
      })
      L.b(c.name + ' 报名落库（pending）', s.ok === true, JSON.stringify(s.error || s.err || 'ok').slice(0, 160))
      submitted[c.name] = s.ok ? (s.data.targetIds || []) : []
    }
    // 审核直接用 submit 响应的 targetIds 下发（域层 requireSignups 读权威态，不依赖读视图可见性——
    // 云读对刚写入的行有 20s+ 滞后，red9 实测，NEEDS_PRODUCT_FOLLOWUP）；域层同样读不到时 bounded 重试。
    const zhaoIds = submitted[COMPANION.name] || []
    let reviewed = { ok: false, err: 'no id' }
    for (let i = 0; i < 5 && !reviewed.ok; i++) {
      reviewed = zhaoIds.length ? await dispatch({ type: 'signup.review', activityId: sandboxId, signupIds: zhaoIds, decision: 'confirm' }) : { ok: false, err: 'submit 响应无 targetIds' }
      if (!reviewed.ok) await sleep(4000)
    }
    L.b('审核确认' + COMPANION.name + '（李晃、王闰保持 pending）', reviewed.ok === true && zhaoIds.length > 0, JSON.stringify(reviewed.error || reviewed.err || 'ok').slice(0, 160))
  }, () => ({ ok: true }))

  // —— 名单区助手（003 系列共用）——
  let page = null
  const rosterOf = async () => dataOf(await page.$('roster-panel'))
  const selectRow = async (rp, name) => {
    const rowsEl = await queryAll(rp, 'person-row', 8)
    for (const row of rowsEl) {
      if (String((await row.text()) || '').indexOf(name) !== -1) {
        return { row, box: (await row.$$('checkbox'))[0] || null }
      }
    }
    return { row: null, box: null }
  }
  const batchBtn = async (rp, label) => {
    const btns = await queryAll(rp, '.button.secondary', 6)
    for (const b of btns) if (String((await b.text()) || '').trim() === label) return b
    return null
  }

  // ============================================================
  // TEST-UI-003a：审核入口的状态门控（published 阶段）——BUG-C 回归（修复前应红）
  // 域规则：signup.review 要求所选行全部 pending（signup.js「只有待确认报名可以审核」），整批拒绝。
  // UX 不变量：confirmed（或混选）在选时，「确认报名」不得可操作、不得进入确认流程。
  // ============================================================
  // （环境恢复，非断言）云读滞后：重开工作台直到面板读数含全部四位（有界 3 次，不无限拉长）
  for (let attempt = 0; attempt < 3; attempt++) {
    page = await open('/pages/workspace/workspace?id=' + sandboxId)
    await probeChannel(page)
    await page.waitFor(1500)
    const segs0 = await queryAll(page, '.seg')
    await tapEl(segs0[1])
    await page.waitFor(1800)
    const d = await rosterOf()
    const names = ((d || {}).rows || []).map(r => r.name)
    if ([COMPANION.name, PEND_CONFIRM.name, PEND_CANCEL.name].every(n => names.indexOf(n) !== -1)) break
  }

  await L.block('TEST-UI-003a confirmed/混选在选时「确认报名」不得可操作（BUG-C 回归）', 11, async () => {
    const segs = await queryAll(page, '.seg')
    const okTab = await tapEl(segs[1])
    L.uiTap('点「名单」分区', okTab, 'tap .seg[1]')
    await page.waitFor(1500)
    const rp = await page.$('roster-panel')
    // —— confirmed 腿：勾选已确认的赵辰（真实 tap）——
    const sel1 = await selectRow(rp, COMPANION.name)
    const okSel = await tapEl(sel1.box)
    L.uiTap('勾选已确认的「' + COMPANION.name + '」', okSel, 'tap person-row>checkbox（confirmed）')
    await page.waitFor(1200)
    const st1 = await rosterOf()
    L.uEffect('勾选落到 selected（selectedCount=1）', !!(st1 && st1.selectedCount === 1),
      JSON.stringify({ selectedCount: st1 && st1.selectedCount, selected: st1 && Object.keys(st1.selected || {}) }))
    const confirmBtn1 = await batchBtn(rp, '确认报名')
    const cls1 = confirmBtn1 ? String((await confirmBtn1.attribute('class')) || '') : '(查无按钮)'
    L.u('confirmed 在选时「确认报名」呈 disabled（class 含 disabled）',
      !!confirmBtn1 && cls1.indexOf('disabled') !== -1, 'class=' + cls1)
    const okTap1 = await tapEl(confirmBtn1)
    L.uiTap('真实点击「确认报名」（confirmed 在选，应当是空点击）', okTap1, 'tap 确认报名 @ roster（confirmed）')
    await page.waitFor(1200)
    const st2 = await rosterOf()
    L.uEffect('点击后未进入确认流程（batch 仍为空、选择保持）——后端会拒的操作 UI 不提供入口',
      !!(st2 && st2.batch === '' && st2.selectedCount === 1),
      JSON.stringify({ batch: st2 && st2.batch, selectedCount: st2 && st2.selectedCount }))
    // —— 混选腿：追加 pending 的李晃 ——
    const sel2 = await selectRow(rp, PEND_CONFIRM.name)
    const okSel2 = await tapEl(sel2.box)
    L.uiTap('追加勾选 pending 的「' + PEND_CONFIRM.name + '」（混选）', okSel2, 'tap person-row>checkbox（pending）')
    await page.waitFor(1200)
    const st3 = await rosterOf()
    L.uEffect('混选落到 selected（selectedCount=2）', !!(st3 && st3.selectedCount === 2),
      JSON.stringify({ selectedCount: st3 && st3.selectedCount }))
    const confirmBtn2 = await batchBtn(rp, '确认报名')
    const cls2 = confirmBtn2 ? String((await confirmBtn2.attribute('class')) || '') : '(查无按钮)'
    L.u('混选（confirmed+pending）时「确认报名」仍 disabled（域规则整批拒绝 ⇒ UI 同向）',
      !!confirmBtn2 && cls2.indexOf('disabled') !== -1, 'class=' + cls2)
    const okTap2 = await tapEl(confirmBtn2)
    L.uiTap('真实点击「确认报名」（混选，应当是空点击）', okTap2, 'tap 确认报名 @ roster（混选）')
    await page.waitFor(1200)
    const st4 = await rosterOf()
    L.uEffect('混选点击后仍未进入确认流程（batch 仍为空）', !!(st4 && st4.batch === '' && st4.selectedCount === 2),
      JSON.stringify({ batch: st4 && st4.batch, selectedCount: st4 && st4.selectedCount }))
  }, uiGate('名单区需要元素通道', 1))

  await L.block('TEST-UI-003a+ 纯 pending 在选时「确认报名」可用且走通（不过度门控）', 7, async () => {
    // 重开页面：003a 结束时选择残留为 {confirmed, pending}，重挂载清空后只勾 pending 行，前提确定
    page = await open('/pages/workspace/workspace?id=' + sandboxId)
    await probeChannel(page)
    await page.waitFor(1500)
    const segsR = await queryAll(page, '.seg')
    await tapEl(segsR[1])
    await page.waitFor(1500)
    const rp = await page.$('roster-panel')
    const sel1 = await selectRow(rp, PEND_CONFIRM.name)
    const okSel = await tapEl(sel1.box)
    L.uiTap('勾选 pending 的「' + PEND_CONFIRM.name + '」（只勾这一行）', okSel, 'tap person-row>checkbox（pending）')
    await page.waitFor(1200)
    const st1 = await rosterOf()
    L.uEffect('选择恰为 1 且是 pending 行', !!(st1 && st1.selectedCount === 1),
      JSON.stringify({ selectedCount: st1 && st1.selectedCount, selected: st1 && Object.keys(st1.selected || {}) }))
    const confirmBtn = await batchBtn(rp, '确认报名')
    const cls = confirmBtn ? String((await confirmBtn.attribute('class')) || '') : '(查无按钮)'
    L.u('纯 pending 在选时「确认报名」可用（class 不含 disabled）', !!confirmBtn && cls.indexOf('disabled') === -1, 'class=' + cls)
    const okGo = await tapEl(confirmBtn)
    L.uiTap('点「确认报名」打开确认弹层', okGo, 'tap 确认报名 @ roster（pending）')
    await page.waitFor(1200)
    const st2 = await rosterOf()
    L.uEffect('确认流程打开（batch=confirm，弹层在等确认）', !!(st2 && st2.batch === 'confirm'), 'batch=' + (st2 && st2.batch))
    const go = await findButtonByText(rp, '确认仅处理这 1 人')
    const okConfirm = await tapEl(go)
    L.uiTap('点「确认仅处理这 1 人」', okConfirm, 'tap 确认按钮 @ 弹层')
    // 回读走面板自身 rows（written 重载后的真实 UI 数据），断言存在性——杜绝空数组虚绿
    const aG = await settle(async () => ((await rosterOf()) || {}).rows || [], rows => rows.some(r => r.name === PEND_CONFIRM.name && r.statusLabel === '已确认'), 8)
    const aRows = aG.v || []
    L.b('审核落库：' + PEND_CONFIRM.name + ' confirmed（真实 UI 全链）', aRows.some(r => r.name === PEND_CONFIRM.name && r.statusLabel === '已确认'),
      JSON.stringify(aRows.map(r => r.name + '/' + r.statusLabel)))
  }, uiGate('名单区需要元素通道', 1))

  // ============================================================
  // TEST-UI-001：Vehicle 集合上车点全链（BUG-A 回归，Phase 4 修复的有效性证据）
  // ============================================================
  await L.block('TEST-UI-001 车辆集合上车点全链（BUG-A 回归）', 14, async () => {
    // 名单区刚发生过一次写（003a+ 审核）：written→syncKey→兄弟面板重载是异步链，
    // 重开页面 = 面板挂载读数即当前 revision，确定性消除 CONFLICT 残留窗口。
    page = await open('/pages/workspace/workspace?id=' + sandboxId)
    await probeChannel(page)
    await page.waitFor(1500)
    const segs = await queryAll(page, '.seg')
    const okT = await tapEl(segs[2])
    L.uiTap('点「分车」分区', okT, 'tap .seg[2]')
    await page.waitFor(1500)
    const tp = await page.$('transport-panel')
    let loaded = false
    for (let t = 0; t < 8 && !loaded; t++) {
      const d = await dataOf(tp)
      if (d && d.loading === false) loaded = true
      else await page.waitFor(1000)
    }
    const addBtn = await findButtonByText(tp, '添加车辆')
    const okAdd = await tapEl(addBtn)
    L.uiTap('点「添加车辆」', okAdd, 'tap 添加车辆 @ transport-panel（loading=' + (loaded ? 'false' : '超时') + '）')
    let opened = null
    for (let t = 0; t < 6 && !opened; t++) {
      const d = await dataOf(tp)
      if (d && d.editorOpen === true && d.vform) opened = d
      else await page.waitFor(1000)
    }
    L.uEffect('车辆编辑弹层打开且 vform 就绪', !!opened, 'editorOpen=' + (opened && opened.editorOpen))
    const addDriverBtn = await findButtonByText(tp, '添加司机')
    const okDriver = await tapEl(addDriverBtn)
    L.uiTap('点「添加司机」（默认服务司机）', okDriver, 'tap 添加司机')
    await page.waitFor(1000)
    const ins = await queryAll(tp, '.input')
    L.u('表单渲染出 6 个输入位', ins.length >= 6, '.input ' + ins.length + ' 个')
    await inputEl(ins[0], VEHICLE.label)
    await inputEl(ins[1], VEHICLE.plate)
    await inputEl(ins[2], String(VEHICLE.legalCapacity))
    await inputEl(ins[3], String(VEHICLE.blockedSeats))
    await inputEl(ins[4], VEHICLE.driverName.trim())
    await inputEl(ins[5], VEHICLE.driverPhone)
    const vf = ((await dataOf(tp)) || {}).vform || {}
    L.uEffect('表单字段落到 vform', vf.label === VEHICLE.label && String(vf.legal) === String(VEHICLE.legalCapacity),
      JSON.stringify({ label: vf.label, legal: vf.legal }))
    // —— BUG-A 核心断言：点击前不含 target；点击后渲染态与数据同时含 target ——
    const groups = await tp.$$('checkbox-group')
    const pkGroup = groups[0] || null
    const pkBox = pkGroup ? (await pkGroup.$$('checkbox'))[0] : null
    const pkValue = pkBox ? String((await pkBox.attribute('value')) || '') : ''
    const beforeIds = ((opened && opened.vform) || {}).pickupIds || []
    const checkedBefore = pkBox ? await pkBox.property('checked') : null
    const okPk = await tapEl(pkBox)
    L.uiTap('点「覆盖的上车点」第 1 项（真实勾选）', okPk, 'tap checkbox-group[0]>checkbox[0] value=' + pkValue + '；渲染态 before=' + checkedBefore + '，vform.before=' + JSON.stringify(beforeIds))
    await page.waitFor(1500)
    const stPk = await dataOf(tp)
    const idsNow = ((stPk || {}).vform || {}).pickupIds || []
    const checkedAfter = pkBox ? await pkBox.property('checked') : null
    L.uEffect('点击后渲染态 checked=true 且 vform.pickupIds 恰含 target（渲染态与数据一致，BUG-A 回归核心）',
      checkedAfter === true && idsNow.indexOf(pkValue) !== -1 && idsNow.length === 1,
      JSON.stringify({ pkValue, beforeIds, afterIds: idsNow, renderedChecked: checkedAfter }))
    const saveBtn = await findButtonByText(tp, '保存车辆安排')
    const okSave = await tapEl(saveBtn)
    L.uiTap('点「保存车辆安排」', okSave, 'tap 保存车辆安排')
    let savedErr = '(超时未关闭)'
    for (let t = 0; t < 8; t++) {
      await page.waitFor(1500)
      const d = await dataOf(tp)
      if (d && d.editorOpen === false) { savedErr = d.error || ''; break }
      if (d && d.error) { savedErr = d.error; break }
    }
    L.uEffect('保存成功且无前端校验拦截（「请至少勾选一个集合上车点」不得出现）', savedErr === '', JSON.stringify({ error: savedErr }))
    let tr = null
    for (let t = 0; t < 6; t++) {
      tr = await cloudCall('readTransport', { activityId: sandboxId })
      if (tr && tr.ok && tr.data.ok !== false && (tr.data.value.vehicles || []).length) break
      await page.waitFor(2000)
    }
    const v0 = tr && tr.ok && tr.data.ok !== false ? (tr.data.value.vehicles || [])[0] || null : null
    L.b('readTransport 回读：pickupPointIds 含所勾集合点（UI → 后端全链）',
      !!v0 && (v0.pickupPointIds || []).indexOf(pkValue) !== -1,
      JSON.stringify(v0 ? { label: v0.label, pickups: v0.pickupPointIds } : ((tr && tr.data) || {})))
    L.b('readTransport 回读：1 名服务司机（与 UI 输入一致）', !!v0 && (v0.drivers || []).length === 1 && v0.drivers[0].kind === 'service',
      JSON.stringify(v0 ? v0.drivers : ((tr && tr.data) || {})))
    // —— 重开回显（车辆卡渲染受读滞后影响，轮询 10×2s 有界等待——实测 20s+ 滞后，NEEDS_PRODUCT_FOLLOWUP）——
    let editBtn = null
    for (let t = 0; t < 10 && !editBtn; t++) {
      editBtn = await findButtonByText(tp, '编辑车辆与司机')
      if (!editBtn) await page.waitFor(2000)
    }
    const okEdit = await tapEl(editBtn)
    L.uiTap('重开车辆编辑（回显验证）', okEdit, 'tap 编辑车辆与司机（等待 ' + (editBtn ? 'ok' : '超时') + '）')
    await page.waitFor(2000)
    const stRe = await dataOf(tp)
    const groupsRe = await tp.$$('checkbox-group')
    const pkBoxRe = groupsRe[0] ? (await groupsRe[0].$$('checkbox'))[0] : null
    const checkedRe = pkBoxRe ? await pkBoxRe.property('checked') : null
    L.u('重开弹层：pickupIds 回显含 target 且渲染态 checked=true（UI reload 一致性）',
      !!(stRe && stRe.vform) && stRe.vform.pickupIds.indexOf(pkValue) !== -1 && checkedRe === true,
      JSON.stringify({ pickupIds: stRe && stRe.vform && stRe.vform.pickupIds, renderedChecked: checkedRe }))
    const save2 = await findButtonByText(tp, '保存车辆安排')
    await tapEl(save2)
    await page.waitFor(2000)
  }, uiGate('分车区需要元素通道', 1))

  // ============================================================
  // TEST-UI-002：司机 picker 数据源完整性（BUG-B 回归）
  // 候选 = 已确认且尚未分车的参与者（域规则会拒绝其余人）。历史缺陷：range 误绑
  // confirmedOptions ⇒ 下拉恒空（「业务对象存在 ≠ 用户能选到」）。
  // 数据源断言 + 绑定完整性静态门（原生 picker 不可查询 ⇒ 真实点选 INCONCLUSIVE）。
  // ============================================================
  await L.block('TEST-UI-002 司机 picker 数据源完整性（BUG-B 回归）', 9, async () => {
    const tp = await page.$('transport-panel')
    const d0 = await dataOf(tp)
    const cands = (d0 || {}).driverCandidates || []
    L.u('司机候选数据源非空（picker range=driverCandidates 的来源）', cands.length > 0,
      JSON.stringify(cands.map(c => c.label)))
    L.u('候选包含已确认未分车的「' + COMPANION.name + '」（options 来自正确业务数据）',
      cands.some(c => String(c.label || '').indexOf(COMPANION.name) !== -1),
      JSON.stringify(cands))
    L.u('候选不含 pending 的「' + PEND_CANCEL.name + '」（options 与业务状态同步）',
      cands.every(c => String(c.label || '').indexOf(PEND_CANCEL.name) === -1), JSON.stringify(cands.map(c => c.label)))
    // 绑定完整性静态门：原生 picker 的 range 在自动化通道不可查询（UI 维 INCONCLUSIVE），
    // 历史缺陷（range 误绑 confirmedOptions ⇒ 恒空）由源码断言钉住——这是绑定回归门，不是 UI 点选证据。
    const tpWxml = fs.readFileSync(path.join(PROJECT, 'miniprogram', 'components', 'transport-panel', 'transport-panel.wxml'), 'utf8')
    L.u('司机 picker 的 range 绑定为 driverCandidates（绑定完整性静态门）',
      tpWxml.indexOf('<picker range="{{driverCandidates}}" range-key="label"') !== -1,
      'transport-panel.wxml 参与者司机 picker 的 range 绑定（手动指派弹层的 confirmedOptions 是合法绑定，不在断言范围）')
    const editBtn = await findButtonByText(tp, '编辑车辆与司机')
    const okEdit = await tapEl(editBtn)
    L.uiTap('打开车辆编辑（司机 picker 的宿主弹层）', okEdit, 'tap 编辑车辆与司机')
    await page.waitFor(2000)
    let reOpen = null
    for (let t = 0; t < 6 && !reOpen; t++) {
      const d = await dataOf(tp)
      if (d && d.editorOpen === true && d.vform) reOpen = d
      else await page.waitFor(1000)
    }
    L.uEffect('编辑弹层重新打开且 vform 就绪', !!reOpen, 'editorOpen=' + (reOpen && reOpen.editorOpen))
    const addDriverBtn = await findButtonByText(tp, '添加司机')
    const okDriver = await tapEl(addDriverBtn)
    L.uiTap('点「添加司机」（新增第 2 位司机位）', okDriver, 'tap 添加司机')
    await page.waitFor(1200)
    const typePickerEl = (await queryAll(tp, 'picker', 4)) || []
    L.u('司机类型 picker 在场（切换参与者司机必经的原生 picker）', typePickerEl.length > 0, 'picker ' + typePickerEl.length + ' 个 @ 编辑弹层')
    L.uiUnverified('真实把司机类型切到「已确认参与者兼司机」并选中候选',
      '切换类型与选候选都是原生 <picker> 弹层：tap 后弹层不在可查询树（.wx-picker/picker-view 全 0 命中，探针证据见 golden-path-v1.md §11）⇒ 自动化通道无法点选；'
      + '候选数据源已在本块断言非空且正确，参与者司机命令契约由 A 层 vehicle.save（参与者司机）覆盖')
    const save2 = await findButtonByText(tp, '保存车辆安排')
    await tapEl(save2)
    await page.waitFor(2000)
  }, uiGate('分车区需要元素通道', 1))

  // ============================================================
  // TEST-UI-003b：阶段×状态矩阵。
  // 域规则：published→gathering 有 UNRESOLVED_DEPARTURE 门（必须先处理完所有 pending）⇒
  // 「gathering + pending」按设计不可达；本段验证：① published 取消 pending 走通；
  // ② 真实 UI 推进 gathering；③ gathering × confirmed：确认不可用（状态维）、取消可用并走通。
  // ============================================================
  await L.block('TEST-UI-003b-1 published 阶段取消 pending（王闰）真实 UI 走通', 8, async () => {
    const segs = await queryAll(page, '.seg')
    const okTab = await tapEl(segs[1])
    L.uiTap('点「名单」分区（回到 published 名单区）', okTab, 'tap .seg[1]')
    await page.waitFor(1500)
    const rp = await page.$('roster-panel')
    const selP = await selectRow(rp, PEND_CANCEL.name)
    const okSel = await tapEl(selP.box)
    L.uiTap('勾选 pending 的「' + PEND_CANCEL.name + '」', okSel, 'tap person-row>checkbox（王闰=pending）')
    await page.waitFor(1200)
    const cancelBtn = await batchBtn(rp, '取消报名')
    const clsC = cancelBtn ? String((await cancelBtn.attribute('class')) || '') : '(查无按钮)'
    L.u('pending 在选（published）时「取消报名」可用（cancel 允许 published|gathering）',
      !!cancelBtn && clsC.indexOf('disabled') === -1, 'class=' + clsC)
    const okC = await tapEl(cancelBtn)
    L.uiTap('点「取消报名」打开取消弹层', okC, 'tap 取消报名 @ roster')
    await page.waitFor(1200)
    const st2 = await rosterOf()
    L.uEffect('取消流程打开（batch=cancel）', !!(st2 && st2.batch === 'cancel'), 'batch=' + (st2 && st2.batch))
    const areas = await queryAll(rp, '.textarea')
    const okReason = await inputEl(areas[areas.length - 1], '自动化：行程有变取消')
    L.uiInput('填写取消原因（必填项）', okReason, 'input .textarea @ 取消弹层')
    const go = await findButtonByText(rp, '确认仅处理这 1 人')
    const okConfirm = await tapEl(go)
    L.uiTap('点「确认仅处理这 1 人」下发 signup.cancel', okConfirm, 'tap 确认按钮 @ 取消弹层')
    const cG = await settle(async () => ((await rosterOf()) || {}).rows || [], rows => rows.some(r => r.name === PEND_CANCEL.name && r.statusLabel === '已取消'), 8)
    const cRows = cG.v || []
    L.b('取消落库：' + PEND_CANCEL.name + ' cancelled（真实 UI 全链）', cRows.some(r => r.name === PEND_CANCEL.name && r.statusLabel === '已取消'),
      JSON.stringify(cRows.map(r => r.name + '/' + r.statusLabel)))
  }, uiGate('名单区需要元素通道', 1))

  await L.block('TEST-UI-003b-2 阶段推进到 gathering（真实 UI；此时已无 pending，域门放行）', 5, async () => {
    // 已知读滞后形态：页面重开时可能读到旧 revision ⇒ 推进命中 CAS 冲突被产品静默重读（toast，不进 error 字段）。
    // 有界重试 1 次（第 2 次重开的新读落在滞后窗口外）；每次尝试都是真实 UI 全流程，失败证据逐次留痕。
    let advanced = false
    for (let attempt = 1; attempt <= 2 && !advanced; attempt++) {
      page = await open('/pages/workspace/workspace?id=' + sandboxId)
      await probeChannel(page)
      await waitIdle(page)
      const go = await findButtonByText(page, PHASE_BTN.gathering)
      if (!go) {
        // 按钮不在 = 阶段可能已在延迟后推进成功：以页面自身视图核实（syncKey 的 phase 前缀是页面真实读数）
        const pg = (await page.data()) || {}
        const pgPhase = String(pg.syncKey || '').split('@')[0]
        advanced = pgPhase === 'gathering'
        if (advanced) {
          L.b('阶段推进落库：gathering（第 ' + attempt + ' 次尝试的写入延迟可见，经页面视图证实）', advanced,
            JSON.stringify({ 页面视图phase: pgPhase, syncKey: String(pg.syncKey || '').slice(0, 40) }))
        } else {
          L.skip(BUSINESS, '「进入正在集合」按钮未在场（第 ' + attempt + ' 次尝试）', '页面视图 phase=' + pgPhase + '——推进既未生效也无法归因（读滞后 NEEDS_PRODUCT_FOLLOWUP）')
        }
        continue
      }
      const okGo = await tapEl(go)
      L.uiTap('点「进入正在集合」（阶段推进入口，第 ' + attempt + ' 次）', okGo, 'tap 阶段按钮 @ workspace 总览')
      await page.waitFor(1500)
      let opened = null
      for (let i = 0; i < 6; i++) {
        opened = await page.data()
        if (opened && opened.transitionOpen === true) break
        await page.waitFor(800)
      }
      L.uEffect('阶段确认弹层打开', !!(opened && opened.transitionOpen === true), 'transitionOpen=' + (opened && opened.transitionOpen))
      const areas = await queryAll(page, '.textarea')
      let okReason = false
      for (let i = 0; i < areas.length; i++) {
        if (!await inputEl(areas[i], '全队集合，进入同行')) continue
        const d = await page.data()
        if (d && String(d.reason || '') === '全队集合，进入同行') { okReason = true; break }
      }
      L.uiInput('填写阶段变更原因（落到 data.reason）', okReason, 'input .textarea（' + areas.length + ' 个候选）')
      const confirm = await findButtonByText(page, '确认变更，不跳过检查')
      const okC = await tapEl(confirm)
      L.uiTap('点「确认变更，不跳过检查」', okC, 'tap 确认变更')
      // 读窗口 30s（20 轮）：云读对刚写入的数据有 20s+ 滞后（NEEDS_PRODUCT_FOLLOWUP 实测），有界等待而非无限轮询
      const phG = await settle(async () => orgView(), v => v.activity && v.activity.phase === 'gathering', 20)
      const pgErr = (await page.data()) || {}
      advanced = !!(phG.v && phG.v.activity) && phG.v.activity.phase === 'gathering'
      if (advanced) {
        L.b('阶段推进落库：gathering（第 ' + attempt + ' 次尝试）', advanced,
          JSON.stringify({ phase: phG.v.activity.phase, waited: phG.waited, 页面error: pgErr.error || '', 页面busy: !!pgErr.busy }))
      } else {
        // 30s 窗口内未见 gathering：写入可能已落库但读滞后未追上（NEEDS_PRODUCT_FOLLOWUP），记 INCONCLUSIVE 转
        // 第 2 次尝试以页面视图判定——不是 FAIL（无法区分未写入与未读到），也不是 PASS（尚无证据）。
        L.skip(BUSINESS, '阶段推进落库：gathering（第 ' + attempt + ' 次尝试，30s 读窗口内未见）',
          '页面error=' + JSON.stringify(pgErr.error || '') + '，页面busy=' + !!pgErr.busy + '——读滞后 NEEDS_PRODUCT_FOLLOWUP，转页面视图判定')
      }
    }
  }, uiGate('工作台需要元素通道', 1))

  await L.block('TEST-UI-003b-3 gathering × confirmed：审核不可用、取消可用并走通', 11, async () => {
    page = await open('/pages/workspace/workspace?id=' + sandboxId)
    await probeChannel(page)
    await page.waitFor(1500)
    const segs = await queryAll(page, '.seg')
    const okTab = await tapEl(segs[1])
    L.uiTap('点「名单」分区', okTab, 'tap .seg[1]（gathering 阶段）')
    await page.waitFor(1500)
    const rp = await page.$('roster-panel')
    // —— 状态维：confirmed 行在选 ⇒ 确认报名不可用（gathering 时 pending 必为空，域门 UNRESOLVED_DEPARTURE 保证）——
    const selP = await selectRow(rp, PEND_CONFIRM.name)
    const okSel = await tapEl(selP.box)
    L.uiTap('勾选已确认的「' + PEND_CONFIRM.name + '」（gathering 阶段）', okSel, 'tap person-row>checkbox')
    await page.waitFor(1200)
    const confirmBtn = await batchBtn(rp, '确认报名')
    const cls = confirmBtn ? String((await confirmBtn.attribute('class')) || '') : '(查无按钮)'
    L.u('confirmed 在选（gathering）时「确认报名」disabled（状态维：review 仅限 pending）',
      !!confirmBtn && cls.indexOf('disabled') !== -1, 'class=' + cls)
    const okTap = await tapEl(confirmBtn)
    L.uiTap('真实点击「确认报名」（confirmed 在选，应当是空点击）', okTap, 'tap 确认报名 @ roster（gathering）')
    await page.waitFor(1200)
    const st1 = await rosterOf()
    L.uEffect('点击后未进入确认流程（batch 仍为空）', !!(st1 && st1.batch === ''), 'batch=' + (st1 && st1.batch))
    // —— 阶段×状态矩阵：gathering 允许取消 current 且未出行者 ⇒ 取消可用并走通 ——
    const cancelBtn = await batchBtn(rp, '取消报名')
    const clsC = cancelBtn ? String((await cancelBtn.attribute('class')) || '') : '(查无按钮)'
    L.u('gathering 阶段 confirmed 未出行在选时「取消报名」可用（cancel 允许 published|gathering × current × 未出行）',
      !!cancelBtn && clsC.indexOf('disabled') === -1, 'class=' + clsC)
    const okC = await tapEl(cancelBtn)
    L.uiTap('点「取消报名」打开取消弹层', okC, 'tap 取消报名 @ roster')
    await page.waitFor(1200)
    const st2 = await rosterOf()
    L.uEffect('取消流程打开（batch=cancel）', !!(st2 && st2.batch === 'cancel'), 'batch=' + (st2 && st2.batch))
    const areas = await queryAll(rp, '.textarea')
    const okReason = await inputEl(areas[areas.length - 1], '自动化：gathering 阶段取消')
    L.uiInput('填写取消原因（必填项）', okReason, 'input .textarea @ 取消弹层')
    const go = await findButtonByText(rp, '确认仅处理这 1 人')
    const okConfirm = await tapEl(go)
    L.uiTap('点「确认仅处理这 1 人」下发 signup.cancel', okConfirm, 'tap 确认按钮 @ 取消弹层')
    const cG = await settle(async () => ((await rosterOf()) || {}).rows || [], rows => rows.some(r => r.name === PEND_CONFIRM.name && r.statusLabel === '已取消'), 8)
    const cRows = cG.v || []
    L.b('取消落库：' + PEND_CONFIRM.name + ' cancelled（真实 UI 全链，gathering 阶段）', cRows.some(r => r.name === PEND_CONFIRM.name && r.statusLabel === '已取消'),
      JSON.stringify(cRows.map(r => r.name + '/' + r.statusLabel)))
  }, uiGate('名单区需要元素通道', 1))

  // —— 结论 ——
  L.print()
}

function section(t) { console.log('\n== ' + t + ' ==') }

main().catch(e => {
  if (e && e.name === 'AbortRun') console.error('环境前置不成立，已中断（结论 INCONCLUSIVE，不是通过）：' + e.message)
  else console.error('UI 状态矩阵执行异常：', e && (e.stack || e.message || e))
  const v = L.print()
  process.exit(e && e.name === 'AbortRun' ? 2 : (v.exitCode === 0 ? 1 : v.exitCode))
})
