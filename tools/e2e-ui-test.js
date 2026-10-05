// B 层端到端（真模拟器）：node tools/e2e-ui-test.js
// 通过微信开发者工具的自动化端口驱动真实运行的小程序——真实渲染、真实原生组件事件、真实云端读。
// 与 A 层（tools/e2e-test.js，内存桩打 exports.main）互补：这一层验证的是「用户在界面上能不能做成」。
//
// 前置（一次性）：开发者工具 → 设置 → 安全 → 打开「服务端口」（CLI/HTTP）。
// 依赖：miniprogram-automator 装在 ~/.ourtrail-e2e（仓库保持零依赖，首次运行自动 npm install）。
//
// 结果语义（必读，别再改回去）：账本 tools/e2e-result.js + docs/testing/e2e-result-semantics.md。
//   · BUSINESS 与 UI 是两个独立维度；UI 的一条 PASS 必须由「真实 UI 操作 + 它的观测结果」两步构成；
//   · 云侧 fallback 只能证 BUSINESS，替 UI 做完动作必须显式记 L.uiUnverified；
//   · 门槛不过、通道退化 ⇒ INCONCLUSIVE（退出码 2），绝不是 PASS；
//   · 安全边界：只在本脚本自建的 [预演] 沙盒里写数据，绝不 tap 真实活动的提交/保存。
'use strict'
const path = require('path')
const fs = require('fs')
const os = require('os')
const net = require('net')
const { execFileSync } = require('child_process')
const { createLedger, auditSource, BUSINESS, UI } = require('./e2e-result')

const DEPS = path.join(os.homedir(), '.ourtrail-e2e')
const SHOTS = path.join(DEPS, 'shots')
const AUTOMATOR_PORT = 9420
const PROJECT = 'D:\\OurTrail'
const CLI_CANDIDATES = [
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat',
]

const L = createLedger({ dims: [BUSINESS, UI] })
const sleep = ms => new Promise(r => setTimeout(r, ms))
// 清理动作的失败不参与任何结论，但必须出声——静默的 catch 就是下一个假 PASS。
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

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const automator = loadAutomator()
  const shot = name => miniProgram.screenshot({ path: path.join(SHOTS, name + '.png') }).then(() => {}).catch(e => quiet('截图 ' + name, e))

  // —— 0. 自我源码完整性门禁：本文件若重新长出假 PASS 通道，这一条先红 ——
  const findings = auditSource(fs.readFileSync(__filename, 'utf8'), 'e2e-ui-test.js')
  L.b('本脚本源码完整性自检（0 违规）', findings.length === 0,
    findings.length ? findings.slice(0, 5).map(f => f.rule + ':' + f.line).join(' | ') : 'auditSource 无 findings')

  // —— 1. 建立自动化连接（梯度重试：直连 → cli auto → 关项目窗再以自动化模式重开）——
  // 注意：HTTP /v2/auto 与 cli auto 混用会互相重置自动化会话，这里只用 CLI。
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
      // 项目窗以自动化模式冷启要十几秒：轮询端口就绪后再连
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

  // 重连会让既有 page/元素句柄全部失效；ensurePage 在元素操作前按标志重开页面。
  let reconnected = false

  // —— 助手：元素查询一律走 $$（$ 恒返回单个 Element，按数组用就永远查不到，历史上 tap 因此静默不发生）——
  // 默认 4 次保持不变（元素密集段前有 hardReconnect，全局拉长轮询会把会话拖到断开——本轮实测）；
  // 面板内容需要更久的等待时在调用点显式传 tries，谁在等什么写清楚。
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
  // 通道健康控制组：一个必然存在的标签查不到，就是元素通道退化（不是产品问题）。
  const probeChannel = async page => {
    const all = await queryAll(page, 'view', 3)
    L.setChannel(all.length > 0 ? 'healthy' : 'degraded', '$$ view → ' + all.length + ' 个元素')
    return all.length > 0
  }
  const healthy = () => L.channel() === 'healthy'
  const uiGate = (reason, actions) => () => (healthy() ? { ok: true, actions: actions || 0 } : { ok: false, reason: reason || '元素查询通道退化（控制组 $ 返回空）' })
  // 页面打开助手：冷启动编译/模拟器预热可能超时，统一重试并等 loading 落位
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
  const cloudCall = async (name, action, data) => {
    const call = () => miniProgram.evaluate(
      new Function('name', 'action', 'data', 'return new Promise(res => wx.cloud.callFunction({ name, data: Object.assign({ action }, data) }).then(r => res(r.result)).catch(e => res({ ok: false, err: String(e && e.errMsg || e) })))'),
      name, action, data)
    let r
    for (let i = 0; i < 3; i++) {
      try { r = await call(); if (r) return r } catch (e) {
        if (i === 2) throw e
        // evaluate 超时 = 自动化会话老化：重连后再试
        try { await miniProgram.disconnect() } catch (e1) { quiet('disconnect(重连前)', e1) }
        await sleep(2000)
        try { miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTOMATOR_PORT }); reconnected = true } catch (e2) { quiet('重连未就绪', e2) }
        await sleep(1500)
      }
      await sleep(4000)
    }
    return r
  }
  // 幂等收敛：cleanup/stage 的每条删除/建档都幂等，超时（-504003）重试会接着上次进度推进
  const converge = async (name, action, data, tries) => {
    let r = null
    for (let i = 0; i < (tries || 6); i++) {
      try {
        r = await cloudCall(name, action, data)
        const bad = (r && r.ok && r.data && r.data.executed || []).filter(x => !x.ok)
        if (r && r.ok && !bad.length) return r
      } catch (e) { quiet('converge ' + action, e) }
      await sleep(2500)
    }
    return r
  }
  // 元素查询通道会随长会话退化（data 通道不受影响）：元素密集段前强制换新会话
  const hardReconnect = async () => {
    try { await miniProgram.disconnect() } catch (e) { quiet('disconnect(hardReconnect)', e) }
    await sleep(2000)
    for (let i = 0; i < 3; i++) {
      try { miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTOMATOR_PORT }); reconnected = false; return true } catch (e) { quiet('hardReconnect 第 ' + (i + 1) + ' 次', e); await sleep(4000) }
    }
    return false
  }
  const ensurePage = async (pg, url) => {
    if (!reconnected) return pg
    reconnected = false
    return open(url)
  }

  // ===== 2. 首页装配（渲染自洽；详情页要用到活动 id，改由本层自建沙盒提供）=====
  let page = await open('/pages/home/home')
  await probeChannel(page)
  await L.block('首页装配', 2, async () => {
    const homeData = await page.data()
    L.u('首页装配完成（loading=false 且未 denied）',
      !!homeData && homeData.loading === false && !homeData.denied,
      JSON.stringify({ loading: homeData && homeData.loading, denied: homeData && homeData.denied }))
    const cards = (homeData && homeData.cards) || []
    // 「首页恰好有活动」不是被测事实，依赖它会让整条链从第一跳就错位（本轮实测：GP 把活动都走成归档后首页为空）。
    // 这里只断言渲染自洽；详情页那一步改用本层自己建的沙盒 id，确定可控。
    L.u('首页卡片渲染自洽（每张卡都有 id 与标题）',
      cards.every(c => !!c.id && !!c.title), JSON.stringify({ n: cards.length, titles: cards.map(c => String(c.title).slice(0, 16)) }))
  }, uiGate())
  await shot('01-home')

  // ===== 3. 活动详情页装配：用下面自建的沙盒 id（见「沙盒建档与发布」之后）=====

  // ===== 4. 工作台全链（[预演] 沙盒，沿用 trailApiLab 能力）=====
  // 沙盒建/发与 lab 演员报名是本层的测试环境准备 ⇒ 记 BUSINESS；
  // 面板渲染、tab 切换、弹层、按钮点击一律记 UI，且必须有真实 tap 打头。
  const sandboxInput = {
    title: '[预演] 工作台E2E', description: '自动化端到端', organizerIntro: '自动化',
    startAt: '2027-01-09T08:00:00+08:00', endAt: '2027-01-09T18:00:00+08:00', deadlineAt: '2027-01-08T20:00:00+08:00',
    acceptingSignups: true, capacity: 10, approvalMode: 'manual', routeId: null,
    routeSnapshot: { title: '路线', distanceKm: 8, ascentM: 300, points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null }], risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }] },
    pickupPoints: [
      { id: 'pk-1', name: '东门集合点', meetingAt: '2027-01-09T07:00:00+08:00', address: 'x', coordinates: null },
      { id: 'pk-2', name: '西门停车区', meetingAt: '2027-01-09T07:30:00+08:00', address: 'y', coordinates: null },
    ],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
  }
  let sandboxId = ''
  section('工作台全链（[预演] 沙盒）')
  await L.block('沙盒建档与发布', 2, async () => {
    // lab cleanup {profiles:true} 是预演体系的设计复位：清 [预演] 活动 + 演员档案与回执。
    // 回执（Receipt）没有 activityId 字段，确定性请求号只能靠这一步复位；演员档案由阶段 0 幂等重建。
    const cl = await converge('trailApiLab', 'cleanup', { profiles: true })
    console.log('  · lab cleanup（设计复位）：' + JSON.stringify((cl && cl.data && cl.data.removed) || (cl && (cl.error || cl.err)) || '多次重试后仍超时').slice(0, 160))
    const created = await converge('trailApi', 'dispatch', { payload: { type: 'activity.create', input: sandboxInput } }, 3)
    L.b('建 [预演] 活动草稿', !!created && created.ok === true, JSON.stringify((created && (created.error || created.err)) || 'ok').slice(0, 200))
    sandboxId = created && created.ok ? created.data.targetIds[0] : ''
    const prof = await cloudCall('trailApi', 'read', { request: { kind: 'profile' } })
    const me = prof && prof.ok ? prof.data.view.profile : null
    const published = me ? await cloudCall('trailApi', 'dispatch', { payload: { type: 'activity.publish', activityId: sandboxId, participation: { personRef: { kind: 'user', userId: me.id }, participant: me.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } } } }) : { ok: false, err: '没有档案' }
    L.b('发布（发布即报名本人）', published.ok === true, JSON.stringify(published.error || published.err || 'ok').slice(0, 200))
  }, () => ({ ok: true }))

  // 详情页装配用自建沙盒的 id：不再从首页「碰巧有的一条」里抓（那是数据依赖，不是被测事实）
  if (sandboxId) {
    page = await open('/pages/activity/activity?id=' + sandboxId)
    await L.block('活动详情页装配（自建沙盒）', 1, async () => {
      const d = await page.data()
      L.u('详情页装配（非 denied / 非 loading，且标题就是这场沙盒）',
        !!d && d.loading === false && !d.denied && String(d.title || '') === sandboxInput.title,
        JSON.stringify({ loading: d && d.loading, denied: d && d.denied, title: d && d.title }))
    }, uiGate())
    await shot('02-activity')
  } else {
    L.skip(UI, '活动详情页装配', '沙盒没建起来（见上条 BUSINESS 失败），详情页无处可开——不静默跳过')
  }

  let rows0 = []
  let pending0 = []
  await L.block('lab 演员报名落库', 3, async () => {
    const lab0 = await converge('trailApiLab', 'seed', { stage: 0 })
    L.b('lab 阶段 0：建档演员与同行人', lab0 && lab0.ok === true,
      JSON.stringify((lab0 && lab0.data && lab0.data.executed || []).filter(x => !x.ok).slice(0, 2) || 'ok').slice(0, 300))
    // 阶段 1 幂等（确定性 requestId）。仍 REQUEST_REUSED 就按设计复位 + 重建沙盒再走一次。
    let lab = null
    for (let i = 0; i < 3 && !(lab && lab.ok === true && !(lab.data && lab.data.executed || []).some(x => !x.ok)); i++) {
      lab = await cloudCall('trailApiLab', 'seed', { stage: 1 })
      const bad = (lab && lab.ok && lab.data && lab.data.executed || []).filter(x => !x.ok)
      if (lab && lab.ok === true && !bad.length) break
      if (bad.length && bad.every(x => x.code === 'REQUEST_REUSED')) {
        console.log('  · 阶段 1 命中 REQUEST_REUSED → 设计复位（cleanup profiles:true）后重建沙盒')
        const reset = await converge('trailApiLab', 'cleanup', { profiles: true })
        L.b('阶段 1 复位（cleanup profiles:true）幂等收敛', !!reset && reset.ok === true, JSON.stringify((reset && (reset.error || reset.err)) || 'ok').slice(0, 160))
        const created2 = await cloudCall('trailApi', 'dispatch', { payload: { type: 'activity.create', input: sandboxInput } })
        if (created2 && created2.ok) sandboxId = created2.data.targetIds[0]
        const prof2 = await cloudCall('trailApi', 'read', { request: { kind: 'profile' } })
        const me2 = prof2 && prof2.ok ? prof2.data.view.profile : null
        if (me2) {
          const republish = await cloudCall('trailApi', 'dispatch', { payload: { type: 'activity.publish', activityId: sandboxId, participation: { personRef: { kind: 'user', userId: me2.id }, participant: me2.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } } } })
          L.b('沙盒重建后重新发布', republish.ok === true, JSON.stringify(republish.error || republish.err || 'ok').slice(0, 160))
        }
        const reseed0 = await converge('trailApiLab', 'seed', { stage: 0 })
        L.b('复位后重建演员档案（阶段 0）', !!reseed0 && reseed0.ok === true, JSON.stringify((reseed0 && (reseed0.error || reseed0.err)) || 'ok').slice(0, 160))
        lab = await converge('trailApiLab', 'seed', { stage: 1 })
      } else {
        lab = await converge('trailApiLab', 'seed', { stage: 1 }, 4)
      }
    }
    const labFailed = (lab && lab.ok && lab.data && lab.data.executed || []).filter(x => !x.ok)
    L.b('lab 阶段 1：演员报名多组（含整组与候补）', !!lab && lab.ok === true && !labFailed.length,
      lab && (lab.error || lab.err) && /504003|timed out/i.test(String((lab.error && lab.error.message) || lab.err || ''))
        ? '云函数执行超时——需重新上传部署 trailApiLab 并在控制台把超时调到 20 秒（见 SYNC.md 预演工具条目）'
        : JSON.stringify(labFailed.length ? labFailed.slice(0, 2) : (lab && (lab.error || lab.err) || 'ok')).slice(0, 300))
    const view0 = await cloudCall('trailApi', 'read', { request: { kind: 'activity', activityId: sandboxId, perspective: 'organizer' } })
    rows0 = (view0 && view0.ok && view0.data.view.rows) || []
    pending0 = rows0.filter(r => r.status === 'pending')
    L.b('演员报名落库：organizer 回读得到待审核行', rows0.length > 1 && pending0.length > 0,
      JSON.stringify({ rows: rows0.length, pending: pending0.length }))
  }, () => sandboxId ? { ok: true } : { ok: false, dim: BUSINESS, reason: '沙盒未建立，后续全链无从进行' })

  if (sandboxId) {
    const readOrg = async () => {
      for (let i = 0; i < 3; i++) {
        const r = await cloudCall('trailApi', 'read', { request: { kind: 'activity', activityId: sandboxId, perspective: 'organizer' } })
        if (r && r.ok && r.data && r.data.view) return r
        await sleep(2500)
      }
      throw new Error('organizer read 多次失败')
    }
    const revNow = async () => (await readOrg()).data.revision
    // 写操作健壮封装：STORAGE_UNAVAILABLE/CONFLICT 等瞬时失败自动重读 revision 重试；
    // 其余错误码原样返回（重试不能把业务失败洗成通过）。
    const robustDispatch = async payload => {
      let r = { ok: false, error: { code: 'NOT_RUN', message: '未执行' } }
      for (let i = 0; i < 3; i++) {
        r = await cloudCall('trailApi', 'dispatch', { expectedRevision: await revNow(), payload })
        const code = r && r.error && r.error.code
        if (r && r.ok) return r
        if (code !== 'STORAGE_UNAVAILABLE' && code !== 'CONFLICT') return r
        await sleep(2500)
      }
      return r
    }
    const advance = async (next, reason) => {
      const r = await robustDispatch({ type: 'activity.transition', activityId: sandboxId, next, reason })
      const v = await readOrg()
      return { ok: r.ok === true, phase: (v && v.ok && v.data.view.kind === 'activity' && v.data.view.activity.phase) || '', err: r.error || r.err || '' }
    }
    // 阶段推进走真实工作台：总览 → 阶段按钮 → 填原因 → 确认。
    // 只有让「页面自己」观察到状态变化，挂载中的面板才会收到新的 syncKey ——
    // 用云命令推阶段的话，面板压根不知道世界变了，那条重读断言就变成不可能成立的假考题。
    const advanceViaUI = async (label, reasonText) => {
      const segs0 = await queryAll(page, '.seg')
      await tapEl(segs0[0])
      await page.waitFor(1200)
      const go = await findButtonByText(page, label)
      const okGo = await tapEl(go)
      L.uiTap('点「' + label + '」', okGo, (go ? '命中' : '未找到') + '；屏上按钮=' + JSON.stringify(await buttonLabels(page)).slice(0, 200))
      await page.waitFor(1500)
      let opened = null
      for (let i = 0; i < 6; i++) {
        opened = await page.data()
        if (opened && opened.transitionOpen === true) break
        await page.waitFor(800)
      }
      L.uEffect('阶段确认弹层打开', !!(opened && opened.transitionOpen === true), 'transitionOpen=' + (opened && opened.transitionOpen))
      // 工作台四个面板保持挂载，页面里同时有现场备注框与弹层原因框：填完必须回读 data.reason 才算填对
      const areas = await queryAll(page, '.textarea')
      let okReason = false
      let usedIdx = -1
      for (let i = 0; i < areas.length; i++) {
        if (!await inputEl(areas[i], reasonText)) continue
        const d = await page.data()
        if (d && String(d.reason || '') === reasonText) { okReason = true; usedIdx = i; break }
      }
      L.uiInput('填写阶段变更原因（落到 data.reason）', okReason,
        '页面 ' + areas.length + ' 个 .textarea，落到 data.reason 的是第 ' + usedIdx + ' 个')
      const confirm = await findButtonByText(page, '确认变更，不跳过检查')
      const okC = await tapEl(confirm)
      L.uiTap('点「确认变更，不跳过检查」', okC, (confirm ? '命中' : '未找到'))
      await page.waitFor(2500)
      const v = await readOrg()
      return { phase: (v && v.ok && v.data.view.activity.phase) || '' }
    }
    // 按文案命中按钮必须反复重查直到匹配：面板正文本来就有 .button，
    // 查一次非空就返回会永远漏掉随后才落位的弹层动作按钮（本轮实测踩过）。
    const buttonLabels = async scope => {
      const btns = (await scope.$$('.button')) || []
      const out = []
      for (const b of btns) out.push(String((await b.text()) || '').trim())
      return out
    }
    // 按文案命中按钮：反复重查直到匹配（面板正文本来就有 .button，查一次非空就返回会漏掉
    // 随后才落位的弹层动作按钮）；先在宿主组件作用域找，再退到页面作用域——弹层经 scroll-view
    // 承载时两个作用域的可见集合可能不同。失败时把「屏上实际有什么」带进证据，不留谜团。
    const findButtonByText = async (scope, label) => {
      for (let i = 0; i < 5; i++) {
        for (const sc of [scope, page]) {
          const btns = (await sc.$$('.button')) || []
          for (const b of btns) {
            if (String((await b.text()) || '').trim() === label) return b
          }
        }
        await page.waitFor(900)
      }
      return null
    }

    await hardReconnect()
    page = await open('/pages/workspace/workspace?id=' + sandboxId)
    await probeChannel(page)

    await L.block('工作台装配与指标对账', 2, async () => {
      page = await ensurePage(page, '/pages/workspace/workspace?id=' + sandboxId)
      const ws = await page.data()
      L.u('工作台装配（organizer 视角非 denied、loading 落位）', !!ws && ws.loading === false && !ws.denied,
        JSON.stringify({ loading: ws && ws.loading, denied: ws && ws.denied }))
      L.u('页头待审核数与云端回读一致', ws && ws.pending === pending0.length,
        JSON.stringify({ ui: ws && ws.pending, cloud: pending0.length }))
    }, uiGate('工作台元素通道退化，面板显隐与指标无法核对'))

    await L.block('名单区真实渲染', 4, async () => {
      const segs = await queryAll(page, '.seg')
      L.u('四个分区 tab 渲染（总览/名单/分车/现场）', segs.length === 4, '.seg 命中 ' + segs.length + ' 个')
      const ok = await tapEl(segs[1])
      L.uiTap('点「名单」分区 tab', ok, 'tap .seg[1]')
      await page.waitFor(1000)
      const rosterEl = await page.$('roster-panel')
      const rosterCls = rosterEl ? String((await rosterEl.attribute('class')) || '') : '(查无 roster-panel)'
      L.u('名单面板可见（hide 类已摘除——类名方案的真机回归点）', !!rosterEl && rosterCls.indexOf('hide') === -1, 'class=' + rosterCls)
      const rosterRows = rosterEl ? await queryAll(rosterEl, 'person-row', 10) : []
      L.u('名单行数与云端一致（面板真实渲染报名数据）', rosterRows.length === rows0.length,
        JSON.stringify({ ui: rosterRows.length, cloud: rows0.length }))
      await shot('03-workspace-roster')
    }, uiGate('名单区需要元素通道', 1))

    await L.block('审核消化', 2, async () => {
      if (!pending0.length) { L.b('本沙盒没有待审核行（上一轮已消化）', pending0.length === 0, JSON.stringify({ pending: pending0.length })); return }
      const reviewed = await cloudCall('trailApi', 'dispatch', { payload: { type: 'signup.review', activityId: sandboxId, signupIds: pending0.map(r => r.signupId), decision: 'confirm' }, expectedRevision: await revNow() })
      L.b('审核确认全部待审核（组织者动作）', reviewed.ok === true, JSON.stringify(reviewed.error || reviewed.err || 'ok').slice(0, 200))
      page = await open('/pages/workspace/workspace?id=' + sandboxId)
      await page.waitFor(1500)
      const ws = await page.data()
      L.u('审核后工作台指标归零（页面响应环境变化）', !!ws && ws.pending === 0, JSON.stringify({ ui: ws && ws.pending }))
    }, () => ({ ok: true }))

    await L.block('真实 UI 表单添加车辆（pickup 勾选 + 明确座号）', 19, async () => {
      const profNow = await cloudCall('trailApi', 'read', { request: { kind: 'profile' } })
      const meName = (profNow && profNow.ok && profNow.data.view.profile.person.name) || ''
      const rows1 = ((await readOrg()).data.view.rows) || []
      const confirmedCount = rows1.filter(r => r.status === 'confirmed' && r.name !== meName).length
      L.b('已确认乘客在案（车辆表单的前提）', confirmedCount > 0, JSON.stringify({ confirmed: confirmedCount }))
      page = await open('/pages/workspace/workspace?id=' + sandboxId)
      await page.waitFor(1500)
      const segsPrev = await queryAll(page, '.seg')
      const okTab = await tapEl(segsPrev[2])
      L.uiTap('点「分车」分区 tab', okTab, 'tap .seg[2]')
      await page.waitFor(1200)
      const tp = await page.$('transport-panel')
      // 面板是自取数据的：loading 未完就点「添加车辆」会开不出弹层（GP-07 同款教训）
      let loaded = false
      for (let t = 0; t < 8 && !loaded; t++) {
        const d = tp ? await tp.data() : null
        if (d && d.loading === false) loaded = true
        else await page.waitFor(1000)
      }
      const addBtn = tp ? await findButtonByText(tp, '添加车辆') : null
      const okAdd = await tapEl(addBtn)
      L.uiTap('点「添加车辆」打开编辑弹层', okAdd, 'tap 「添加车辆」@ transport-panel（面板 loading=' + (loaded ? 'false' : '超时') + '）')
      let opened = null
      for (let t = 0; t < 6 && !opened; t++) {
        const d = tp ? await tp.data() : null
        if (d && d.editorOpen === true && d.vform) opened = d
        else await page.waitFor(1000)
      }
      L.uEffect('车辆编辑弹层打开（editorOpen=true 且 vform 就绪）', !!opened, 'editorOpen=' + (opened && opened.editorOpen))
      const addDriverBtn = tp ? await findButtonByText(tp, '添加司机') : null
      const okDriver = await tapEl(addDriverBtn)
      L.uiTap('点「添加司机」（默认服务司机，不踩 picker）', okDriver, 'tap 「添加司机」')
      await page.waitFor(1000)
      const ins = tp ? await queryAll(tp, '.input') : []
      L.u('表单渲染出名称/车牌/核载/预留/司机姓名/电话输入位', ins.length >= 6, '.input ' + ins.length + ' 个')
      await inputEl(ins[0], '1号车')
      await inputEl(ins[1], '川A·E2E')
      await inputEl(ins[2], '9')
      await inputEl(ins[3], '0')
      await inputEl(ins[4], '服务司机')
      await inputEl(ins[5], '00000000009')
      const stF = tp ? await tp.data() : null
      const vf = (stF && stF.vform) || {}
      L.uEffect('表单字段落到 vform（名称/核载/司机姓名）', vf.label === '1号车' && String(vf.legal) === '9'
        && vf.drivers && vf.drivers[0] && vf.drivers[0].name === '服务司机',
        JSON.stringify({ label: vf.label, legal: vf.legal, drivers: (vf.drivers || []).length }))
      // —— Case A：上车点勾选。渲染态与数据双读：只信「点了之后 vform.pickupIds 真的接住」。 ——
      const groups = tp ? await tp.$$('checkbox-group') : []
      const pkGroup = groups[0] || null
      const pkBox = pkGroup ? (await pkGroup.$$('checkbox'))[0] : null
      const pkValue = pkBox ? String((await pkBox.attribute('value')) || '') : ''
      const checkedBefore = pkBox ? await pkBox.property('checked') : null
      const okPk = await tapEl(pkBox)
      L.uiTap('点「覆盖的上车点」第 1 项（真实勾选）', okPk, 'tap checkbox-group[0]>checkbox[0] value=' + pkValue + '；渲染态 before=' + checkedBefore)
      await page.waitFor(1500)
      const stPk = tp ? await tp.data() : null
      const idsNow = ((stPk && stPk.vform) || {}).pickupIds || []
      L.uEffect('勾选落到 vform.pickupIds（UI 操作 → 组件状态，BUG-1 修复验证）',
        idsNow.indexOf(pkValue) !== -1 && idsNow.length === 1,
        JSON.stringify({ pkValue, beforeIds: (opened && opened.vform && opened.vform.pickupIds) || [], afterIds: idsNow }))
      // —— Case B：明确座号。change 载体已改为 checkbox-group（裸 <checkbox bindchange> 真机永不触发）。 ——
      const seatGroup = groups[1] || null
      const seatBox = seatGroup ? (await seatGroup.$$('checkbox'))[0] : null
      const okSeat = await tapEl(seatBox)
      L.uiTap('勾选「使用明确座号」', okSeat, 'tap checkbox-group[1]>checkbox[0]')
      await page.waitFor(1500)
      const stSeat = tp ? await tp.data() : null
      L.uEffect('「使用明确座号」勾选生效（BUG-2 修复验证）',
        !!((stSeat && stSeat.vform) || {}).seatLabelsOn,
        JSON.stringify({ seatLabelsOn: stSeat && stSeat.vform && stSeat.vform.seatLabelsOn, autoText: stSeat && stSeat.vform && stSeat.vform.seatLabelsText }))
      const seatInput = tp ? (await tp.$$('[data-key="seatLabelsText"]'))[0] || null : null
      L.u('座号配置区随勾选出现（wx:if 生效）', !!seatInput, 'seatLabelsText 输入位 ' + (seatInput ? '命中' : '缺失'))
      const saveBtn = tp ? await findButtonByText(tp, '保存车辆安排') : null
      const okSave = await tapEl(saveBtn)
      L.uiTap('点「保存车辆安排」', okSave, 'tap 「保存车辆安排」')
      let savedErr = '(超时未关闭)'
      for (let t = 0; t < 8; t++) {
        await page.waitFor(1500)
        const d = tp ? await tp.data() : null
        if (d && d.editorOpen === false) { savedErr = d.error || ''; break }
        if (d && d.error) { savedErr = d.error; break }
      }
      L.uEffect('保存后面板无报错且弹层关闭（前端校验放行 → 命令下发）', savedErr === '', JSON.stringify({ error: savedErr }))
      // —— Case A/B 落库回读（backend readback）——
      const trV = await cloudCall('trailApi', 'readTransport', { activityId: sandboxId })
      const v0 = trV && trV.ok && trV.data.ok !== false ? (trV.data.value.vehicles || [])[0] || null : null
      L.b('readTransport 回读：车辆在案且 pickupPointIds 含所勾集合点（UI → 后端）',
        !!v0 && (v0.pickupPointIds || []).indexOf(pkValue) !== -1,
        JSON.stringify(v0 ? { label: v0.label, pickups: v0.pickupPointIds, seats: v0.seatLabels } : trV && trV.data))
      L.b('readTransport 回读：seatLabels 与 UI 自动填充一致（8 个唯一座号）',
        !!v0 && !!v0.seatLabels && v0.seatLabels.length === 8 && new Set(v0.seatLabels).size === 8,
        JSON.stringify(v0 && v0.seatLabels))
      // —— Case A/B 重开回显（UI reload 一致性）——
      const editBtn = tp ? await findButtonByText(tp, '编辑车辆与司机') : null
      const okEdit = await tapEl(editBtn)
      L.uiTap('重开车辆编辑（回显验证入口）', okEdit, 'tap 车辆卡上的「编辑车辆与司机」')
      await page.waitFor(2000)
      const stRe = tp ? await tp.data() : null
      const groupsRe = tp ? await tp.$$('checkbox-group') : []
      const pkBoxRe = groupsRe[0] ? (await groupsRe[0].$$('checkbox'))[0] : null
      const checkedRe = pkBoxRe ? await pkBoxRe.property('checked') : null
      L.u('重开弹层：pickupIds 回显含所勾集合点、座号开关仍开、渲染态 checked=true',
        !!stRe && !!stRe.vform && stRe.vform.pickupIds.indexOf(pkValue) !== -1
        && stRe.vform.seatLabelsOn === true && checkedRe === true,
        JSON.stringify({ pickupIds: stRe && stRe.vform && stRe.vform.pickupIds, seatLabelsOn: stRe && stRe.vform && stRe.vform.seatLabelsOn, renderedChecked: checkedRe }))
      // 关弹层不依赖查不到的 overlay 把手：再点一次保存（幂等）
      const save2 = tp ? await findButtonByText(tp, '保存车辆安排') : null
      await tapEl(save2)
      await page.waitFor(2000)
      let cardSeen = false
      for (let t = 0; t < 6 && !cardSeen; t++) {
        const cards2 = tp ? await tp.$$('.card') : []
        cardSeen = cards2.length > 0
        if (!cardSeen) await page.waitFor(1500)
      }
      L.uEffect('分车面板渲染出车辆卡（保存后面板自重读）', cardSeen, 'transport-panel .card ' + (cardSeen ? '命中' : '为空'))
    }, uiGate('车辆表单要经真实输入与保存', 1))

    // 分车提交：UI 通道与云侧降级是两个不同结论——降级只证服务链路，UI 维度必须记未验证。
    let uiCommitted = false
    await L.block('UI 预览并提交分车方案', 4, async () => {
      const tp = await page.$('transport-panel')
      const planOv = tp ? (await tp.$$('overlay'))[0] : null
      const previewBtns = tp ? await queryAll(tp, '.button.primary.block') : []
      const okPrev = await tapEl(previewBtns[0])
      L.uiTap('点「预览自动分车」按钮', okPrev && !!planOv, 'tap .button.primary.block @ transport-panel；overlay ' + (planOv ? '存在' : '缺失'))
      // overlay 的具名 slot 内容在本基础库查不到，从面板作用域查渲染结果
      let planRows = 0
      let danger = null
      for (let t = 0; t < 6; t++) {
        await page.waitFor(2000)
        planRows = tp ? (await tp.$$('.list-row')).length : 0
        danger = tp ? (await tp.$$('.callout.danger'))[0] : null
        if (planRows > 0 || danger) break
      }
      L.uEffect('预览自动分车 → 面板渲染出差异行（allocation 惰性 require 的真机回归点）', planRows > 0,
        '.list-row 命中 ' + planRows + ' 行' + (danger ? '；同屏错误文案：' + String((await danger.text()) || '').slice(0, 120) : ''))
      await shot('04-workspace-plan')
      const commitBtn = tp ? await findButtonByText(tp, '明确确认并提交此方案') : null
      const okCommit = await tapEl(commitBtn)
      L.uiTap('点「明确确认并提交此方案」按钮', okCommit, 'findButtonByText 命中：' + (commitBtn ? '是' : '否') + '；面板可见 ' + JSON.stringify(await buttonLabels(tp)).slice(0, 200))
      await page.waitFor(2500)
      const tr = await cloudCall('trailApi', 'readTransport', { activityId: sandboxId })
      const assigns = (tr && tr.ok && tr.data.ok !== false && tr.data.value.assignments) || []
      uiCommitted = okCommit && assigns.length > 0
      L.b('UI 提交后云端确实落库安排', assigns.length > 0, JSON.stringify(assigns).slice(0, 200))
    }, uiGate('分车提交要走真实 UI 通道', 1))
    if (!uiCommitted) {
      // 允许 fallback 继续走履约链，但 UI 维度必须留下「未验证」的账
      L.uiUnverified('分车提交经真实 UI 完成', '元素通道不足，改由云侧 previewAssignments+assignment.commit 代做')
      const pv = await cloudCall('trailApi', 'previewAssignments', { activityId: sandboxId })
      L.b('云侧降级 previewAssignments → ok', pv && pv.ok === true, JSON.stringify((pv && (pv.error || pv.err)) || 'ok').slice(0, 160))
      if (pv && pv.ok) {
        const cm = await cloudCall('trailApi', 'dispatch', { expectedRevision: await revNow(), payload: { type: 'assignment.commit', activityId: sandboxId, preview: pv.data } })
        L.b('云侧降级 assignment.commit → ok', cm.ok === true, JSON.stringify(cm.error || cm.err || 'ok').slice(0, 160))
      }
    }

    await hardReconnect()
    page = await open('/pages/workspace/workspace?id=' + sandboxId)
    await probeChannel(page)
    await L.block('座位示意渲染', 2, async () => {
      const segsSeat = await queryAll(page, '.seg')
      const okSeat = await tapEl(segsSeat[2])
      L.uiTap('回到「分车」分区看座位示意', okSeat, 'tap .seg[2]')
      await page.waitFor(1500)
      const tpSeats = await page.$('transport-panel')
      const seatEls = tpSeats ? await queryAll(tpSeats, '.seat', 10) : []
      let occupied = 0
      for (const seat of seatEls) {
        if (String((await seat.attribute('class')) || '').indexOf('occupied') !== -1) occupied++
      }
      L.u('座位示意渲染出已占座（分车提交的可视结果）', occupied > 0,
        JSON.stringify({ seats: seatEls.length, occupied }))
    }, uiGate('座位示意需要元素通道', 1))

    let gath
    await L.block('推进 gathering', 2, async () => {
      gath = await advanceViaUI('进入正在集合', '按期集合')
      L.b('推进 gathering 并回读到阶段值（经真实工作台按钮）', gath.phase === 'gathering', JSON.stringify(gath).slice(0, 160))
      // BUG-1 的验证点：工作台切区只 setData，面板靠页面下发的 syncKey（phase@revision）自失效重读。
      // 阶段推到集合后，仍挂着的现场面板必须已经是新 phase，弹层动作表才不会是空的。
      const fpStale = await page.$('field-panel')
      // 失效重读是异步的：轮询到落地为止（等不到才算红），把等待次数一并记进证据
      let staleData = null
      let waited = -1
      for (let i = 0; i < 10; i++) {
        staleData = fpStale ? await fpStale.data() : null
        if (staleData && staleData.phase === 'gathering') { waited = i; break }
        await page.waitFor(800)
      }
      L.u('阶段推进后已挂载的现场面板随 syncKey 重读到新 phase',
        !!staleData && staleData.phase === 'gathering',
        JSON.stringify({ panelPhase: staleData && staleData.phase, cloudPhase: gath.phase, waited }))
    }, uiGate('需要读到已挂载面板的 phase', 0))
    // 面板已随 syncKey 自失效重读（上面那条断言钉住），这里重开页面只是为了拿新鲜句柄
    page = await open('/pages/workspace/workspace?id=' + sandboxId)
    await probeChannel(page)

    // —— 现场区：第一名参与者走真实弹层（tap 开层 → input 写依据 → tap 动作按钮），其余批量走命令 ——
    const confirmedRowsAll = ((await readOrg()).data.view.rows || []).filter(r => r.status === 'confirmed')
    let uiTarget = confirmedRowsAll[0]
    const uiDone = { checkin: false, departure: false }
    await L.block('现场弹层签到（真实用户路径）', 8, async () => {
      page = await ensurePage(page, '/pages/workspace/workspace?id=' + sandboxId)
      const segsField = await queryAll(page, '.seg')
      const okField = await tapEl(segsField[3])
      L.uiTap('点「现场」分区 tab', okField, 'tap .seg[3]')
      await page.waitFor(1500)
      const fp = await page.$('field-panel')
      const fieldRows = fp ? await queryAll(fp, 'person-row', 10) : []
      L.u('现场区渲染已确认名单', fieldRows.length === confirmedRowsAll.length,
        JSON.stringify({ ui: fieldRows.length, cloud: confirmedRowsAll.length }))
      const sheetBtns = fp ? await queryAll(fp, '.button.text', 10) : []
      const okOpen = await tapEl(sheetBtns[0])
      L.uiTap('点第一名参与者的「现场记录」', okOpen, 'tap .button.text @ field-panel，命中 ' + sheetBtns.length + ' 个')
      let fpData = null
      for (let t = 0; t < 6; t++) {
        fpData = await fp.data()
        if (fpData && fpData.sheetOpen === true) break
        await page.waitFor(800)
      }
      await page.waitFor(1200)
      L.uEffect('现场记录弹层打开（组件 data.sheetOpen=true）', !!(fpData && fpData.sheetOpen === true), 'sheetOpen=' + (fpData && fpData.sheetOpen))
      // 具名 slot 的内容归属宿主子树：从 field-panel 作用域查（从 overlay 元素往下查是 0 个，本轮实测）
      const areas = fp ? await queryAll(fp, '.textarea') : []
      const okInput = await inputEl(areas[areas.length - 1], '自动化核实：集合点当面确认')
      L.uiInput('在弹层里填写核实依据', okInput, 'input .textarea @ field-panel 作用域，命中 ' + areas.length + ' 个')
      const noteState = await fp.data()
      L.uEffect('核实依据落到组件状态（data.note 等于所填文本）', !!noteState && noteState.note === '自动化核实：集合点当面确认', JSON.stringify({ note: noteState && noteState.note }))
      const checkinBtn = fp ? await findButtonByText(fp, '确认现场签到') : null
      const okCheckin = await tapEl(checkinBtn)
      L.uiTap('点「确认现场签到」', okCheckin, (checkinBtn ? '命中' : '未找到') + '；面板可见按钮 ' + JSON.stringify(await buttonLabels(fp)).slice(0, 160) + '；弹层 actions=' + JSON.stringify((await fp.data()).actions || []))
      await page.waitFor(2500)
      let rowsNow = ((await readOrg()).data.view.rows || [])
      const targetRow = rowsNow.find(r => r.signupId === (uiTarget && uiTarget.signupId)) || {}
      uiDone.checkin = targetRow.checkedIn === true
      L.b('弹层签到经服务端落库（' + (targetRow.name || '') + ' checkedIn）', uiDone.checkin, JSON.stringify({ checkedIn: targetRow.checkedIn }))
    }, uiGate('现场弹层需要元素通道', 1))

    const tr0 = await cloudCall('trailApi', 'readTransport', { activityId: sandboxId })
    const assignsMid0 = (tr0 && tr0.ok && tr0.data.ok !== false && tr0.data.value.assignments) || []
    const vehiclesMid0 = (tr0 && tr0.ok && tr0.data.value.vehicles) || []
    // 顺序按产品真实语义走：拼车乘客的「去程上车」入口在车长任务页，没有这个事实，
    // field.js 的 joined 门就会拒 —— 授权本体 + 上车事实都在这一段补齐：授权走业务命令
    // （角色/日期是原生 picker 弹层，探针实测驱不动，如实记 unv），上车走车长页真实点击（Case D）。
    if (uiTarget) {
      const asgUi = assignsMid0.find(a => a.signupId === uiTarget.signupId)
      const drvUi = vehiclesMid0.some(v => v.drivers.some(d => d.kind === 'participant' && d.signupId === uiTarget.signupId))
      if (asgUi && !drvUi) {
        const profMe = await cloudCall('trailApi', 'read', { request: { kind: 'profile' } })
        const meId = profMe && profMe.ok && profMe.data.ok !== false ? profMe.data.view.profile.id : ''
        const grant = await robustDispatch({ type: 'membership.save', activityId: sandboxId, membership: {
          id: 'e2e-veh-contact-' + String(sandboxId).slice(-6), role: 'vehicle_contact', activityId: sandboxId, userId: meId,
          vehicleId: (vehiclesMid0[0] || {}).id || '', expiresAt: '2027-03-15T23:59:59+08:00' } })
        L.b('环境准备：membership.save 自授车辆联络（授权本体不充当 UI 证据）', grant.ok === true,
          JSON.stringify(grant.error || grant.err || 'ok').slice(0, 160))
        L.uiUnverified('「组织者在授权弹层经角色 picker 授予车辆联络」的 tap-through',
          'role/scope/授权截止时间都是原生 <picker>：tap 后弹层不在可查询树（探针实测 .wx-picker/picker-view 全部 0 命中、截图无弹层）⇒ 无法自动化；'
          + 'picker 数据源已修复在案（roleOptions=现场协作/车辆联络），保存链契约由 A 层 4b 钉住')
        // Case D：车长任务页真实点击「确认上车」
        page = await open('/pages/vehicle/vehicle?id=' + sandboxId)
        await probeChannel(page)
        const vd = await page.data()
        L.u('车长任务页对本人可进（车辆联络授权生效）',
          !!vd && vd.loading === false && !vd.denied, JSON.stringify({ loading: vd && vd.loading, denied: vd && vd.denied }))
        let boardedUi = false
        for (let round = 0; round < 6 && !boardedUi; round++) {
          const btns = (await page.$$('.button.secondary')) || []
          let hit = null
          for (const el of btns) {
            if (String((await el.text()) || '').trim() !== '确认上车') continue
            const did = String((await el.attribute('data-id')) || '')
            if (did === String(uiTarget.signupId)) { hit = el; break }
          }
          if (!hit) { await page.waitFor(1500); continue }
          const okB = await tapEl(hit)
          L.uiTap('车长页点「确认上车」（' + (uiTarget.name || '') + '）', okB,
            'tap .button.secondary[data-id=' + uiTarget.signupId + ']@ pages/vehicle（第 ' + (round + 1) + ' 轮）')
          await page.waitFor(2500)
          const rowsB = ((await readOrg()).data.view.rows || [])
          boardedUi = (rowsB.find(r => r.signupId === uiTarget.signupId) || {}).outboundBoarded === true
        }
        L.b('上车经车长任务页真实点击落库（outboundBoarded=true）', boardedUi,
          JSON.stringify({ signupId: uiTarget.signupId, name: uiTarget.name }))
        // 车长页不经过工作台，面板不知道世界变了；真实用户是「从车长页退回工作台」——重开页面等效
        page = await open('/pages/workspace/workspace?id=' + sandboxId)
        await probeChannel(page)
      }
    }
    await L.block('现场弹层出发核实（真实用户路径）', 4, async () => {
      const fp = await page.$('field-panel')
      const sheetBtns = fp ? await queryAll(fp, '.button.text', 10) : []
      const okOpen = await tapEl(sheetBtns[0])
      L.uiTap('再次点开「现场记录」弹层', okOpen, 'tap .button.text，命中 ' + sheetBtns.length + ' 个')
      let fpData = null
      for (let t = 0; t < 6; t++) {
        fpData = await fp.data()
        if (fpData && fpData.sheetOpen === true) break
        await page.waitFor(800)
      }
      L.uEffect('第二次开层同样成功（弹层可复用，不是一次性控件）', !!(fpData && fpData.sheetOpen === true), 'sheetOpen=' + (fpData && fpData.sheetOpen))
      const areas2 = fp ? await queryAll(fp, '.textarea') : []
      await inputEl(areas2[areas2.length - 1], '自动化核实：随队出发')
      const depBtn = fp ? await findButtonByText(fp, '核实已随队出发') : null
      const okDep = await tapEl(depBtn)
      L.uiTap('点「核实已随队出发」', okDep, (depBtn ? '命中' : '未找到') + '；屏上可见 ' + JSON.stringify(await buttonLabels(fp)).slice(0, 200))
      await page.waitFor(2500)
      const rowsNow = ((await readOrg()).data.view.rows || [])
      const targetRow = rowsNow.find(r => r.signupId === (uiTarget && uiTarget.signupId)) || {}
      uiDone.departure = targetRow.departure === 'joined'
      L.b('弹层出发核实经服务端落库（departure=joined）', uiDone.departure, JSON.stringify({ departure: targetRow.departure }))
    }, uiGate('现场弹层需要元素通道', 1))

    // 上车已在本段之前补齐（见「现场弹层签到」之后那段），此处不再重复。

    // 批量兜底：签到 →（拼车乘客）上车 → 出发核实。
    // 判「已办」必须排除 departure==='unknown'（selectors.js:125 无记录时就是 'unknown'，按真值判断会把没办的人当办完）。
    const resolved = r => r.checkedIn === true && r.departure && r.departure !== 'unknown'
    const rowsMid = ((await readOrg()).data.view.rows || []).filter(r => r.status === 'confirmed' && !resolved(r))
    const trMid = await cloudCall('trailApi', 'readTransport', { activityId: sandboxId })
    const assignsMid = (trMid && trMid.ok && trMid.data.ok !== false && trMid.data.value.assignments) || []
    const vehiclesMid = (trMid && trMid.ok && trMid.data.value.vehicles) || []
    const bulkFail = []
    for (const row of rowsMid) {
      if (row.checkedIn !== true) {
        const r = await robustDispatch({ type: 'attendance.checkin', activityId: sandboxId, signupId: row.signupId, checkIn: { method: 'manual', evidence: { at: '', by: '', note: '自动化批量签到' } } })
        if (!r.ok) { bulkFail.push(row.name + ' 签到:' + JSON.stringify(r.error || r.err || '')); break }
      }
      const asg = assignsMid.find(a => a.signupId === row.signupId)
      const isDriver = vehiclesMid.some(v => v.drivers.some(d => d.kind === 'participant' && d.signupId === row.signupId))
      if (asg && !isDriver && row.outboundBoarded !== true) {
        const r = await robustDispatch({ type: 'attendance.board', activityId: sandboxId, signupId: row.signupId, leg: 'outbound', boarded: true, note: '自动化清点上车' })
        if (!r.ok) { bulkFail.push(row.name + ' 上车:' + JSON.stringify(r.error || r.err || '')); break }
      }
      if (!row.departure || row.departure === 'unknown') {
        const r = await robustDispatch({ type: 'attendance.departure', activityId: sandboxId, signupId: row.signupId, outcome: { kind: 'joined', evidence: { at: '', by: '', note: '自动化随队出发' } } })
        if (!r.ok) { bulkFail.push(row.name + ' 出发:' + JSON.stringify(r.error || r.err || '')); break }
      }
    }
    L.b('批量签到/上车/出发核实全部成功（' + rowsMid.length + ' 人）', bulkFail.length === 0, bulkFail.join(' | ').slice(0, 240) || 'ok')
    const dumpRows = ((await readOrg()).data.view.rows || []).filter(r => r.status === 'confirmed')
    for (const r of dumpRows) console.log('    · ' + r.name + ' checkedIn=' + !!r.checkedIn + ' departure=' + (r.departure || 'NONE') + ' vehicle=' + (r.vehicle || '无'))

    let active
    let nodeR
    let closing
    await L.block('推进 active → 节点 → closing', 3, async () => {
      active = await advance('active', '全员到齐发车')
      L.b('推进 active（出发核实硬门通过）', active.ok && active.phase === 'active', JSON.stringify(active).slice(0, 160))
      const ownerName = ((await cloudCall('trailApi', 'read', { request: { kind: 'profile' } }) || {}).data || {}).view
      const meName2 = ownerName && ownerName.profile ? ownerName.profile.person.name : ''
      const ownerRow = dumpRows.find(r => r.name === meName2) || dumpRows[0]
      nodeR = await cloudCall('trailApi', 'dispatch', { expectedRevision: await revNow(), payload: { type: 'attendance.node', activityId: sandboxId, signupId: ownerRow.signupId, pointId: 'pt-1', note: '全队抵达山门（自动化）' } })
      L.b('路线节点确认 ok', nodeR.ok === true, JSON.stringify(nodeR.error || nodeR.err || 'ok').slice(0, 160))
      closing = await advance('closing', '返程收尾')
      L.b('推进 closing', closing.ok && closing.phase === 'closing', JSON.stringify(closing).slice(0, 160))
      // 同 gathering：不重挂载的话现场面板按 active 算动作表，closing 的「核实安全到家」不会出现
      page = await open('/pages/workspace/workspace?id=' + sandboxId)
      await probeChannel(page)
    }, () => ({ ok: true }))

    let uiHomeDone = false
    await L.block('现场弹层到家核实（真实用户路径）', 4, async () => {
      const fp2 = await page.$('field-panel')
      const homeBtns = fp2 ? await queryAll(fp2, '.button.text', 10) : []
      const okHome = await tapEl(homeBtns[0])
      L.uiTap('点第一名参与者的「现场记录」（closing 阶段）', okHome, 'tap .button.text，命中 ' + homeBtns.length + ' 个')
      let fp2Data = null
      for (let t = 0; t < 6; t++) {
        fp2Data = await fp2.data()
        if (fp2Data && fp2Data.sheetOpen === true) break
        await page.waitFor(800)
      }
      L.uEffect('closing 阶段弹层可再次打开', !!(fp2Data && fp2Data.sheetOpen === true), 'sheetOpen=' + (fp2Data && fp2Data.sheetOpen))
      const areas3 = fp2 ? await queryAll(fp2, '.textarea') : []
      await inputEl(areas3[areas3.length - 1], '自动化核实：家属电话确认到家')
      const homeBtn = fp2 ? await findButtonByText(fp2, '核实安全到家') : null
      const okTap = await tapEl(homeBtn)
      L.uiTap('点「核实安全到家」', okTap, (homeBtn ? '命中' : '未找到') + '；屏上可见 ' + JSON.stringify(await buttonLabels(fp2)).slice(0, 200))
      await page.waitFor(2500)
      const rowsNow = ((await readOrg()).data.view.rows || [])
      const targetRow = rowsNow.find(r => r.signupId === (uiTarget && uiTarget.signupId)) || {}
      uiHomeDone = targetRow.home === true
      L.b('弹层到家确认经服务端落库', uiHomeDone, JSON.stringify({ home: targetRow.home }))
    }, uiGate('到家核实需要元素通道', 1))

    const homeFail = []
    const rowsEnd = ((await readOrg()).data.view.rows || []).filter(r => r.status === 'confirmed')
    for (const row of rowsEnd) {
      if (row.home === true) continue
      const r = await robustDispatch({ type: 'attendance.home', activityId: sandboxId, signupId: row.signupId, note: '自动化批量到家确认' })
      if (!r.ok) homeFail.push(row.name + ':' + JSON.stringify(r.error || r.err || ''))
    }
    L.b('其余人员到家确认全部成功（含逐人返回值核对）', homeFail.length === 0, homeFail.join(' | ').slice(0, 240) || 'ok')

    let archive
    await L.block('归档与归档后指标归零', 2, async () => {
      archive = await advance('archived', '结档归档')
      L.b('全员闭环后归档 ok', archive.ok && archive.phase === 'archived', JSON.stringify(archive).slice(0, 160))
      await hardReconnect()
      page = await open('/pages/workspace/workspace?id=' + sandboxId)
      await page.waitFor(1500)
      const ws = await page.data()
      L.u('归档后工作台「待到家」归零', !!ws && ws.thirdValue === 0 && ws.thirdLabel === '待到家',
        JSON.stringify({ v: ws && ws.thirdValue, l: ws && ws.thirdLabel }))
      await shot('06-workspace-archived')
    }, uiGate('归档后的工作台读数需要元素通道；本轮未取得', 0))
    console.log('  · 沙盒活动已走完全履约链并归档（[预演] 工作台E2E，可在预演面板 cleanup 清理）')
  }

  // ===== 5. 报名页：真实用户路径能否勾选同行人（P0-3 的裁决点）=====
  // 准入闸：报名页只放行「已发布 + 未报名」，所以沙盒要发布后取消本人那条报名。
  const suInput = Object.assign({}, sandboxInput, { title: '[预演] 报名E2E', capacity: 5 })
  let suId = ''
  let suPage = null
  let suData = null
  await L.block('报名沙盒装配', 5, async () => {
    const suCreated = await converge('trailApi', 'dispatch', { payload: { type: 'activity.create', input: suInput } }, 3)
    L.b('建报名沙盒活动', !!suCreated && suCreated.ok === true, JSON.stringify((suCreated && (suCreated.error || suCreated.err)) || 'ok').slice(0, 140))
    suId = suCreated && suCreated.ok ? suCreated.data.targetIds[0] : ''
    const profS = await cloudCall('trailApi', 'read', { request: { kind: 'profile' } })
    const meS = profS && profS.ok ? profS.data.view.profile : null
    const pub = await cloudCall('trailApi', 'dispatch', { payload: { type: 'activity.publish', activityId: suId, participation: { personRef: { kind: 'user', userId: meS.id }, participant: meS.person, trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } } } })
    L.b('发布报名沙盒（发布即报名本人）', pub.ok === true, JSON.stringify(pub.error || pub.err || 'ok').slice(0, 140))
    // 常用同行人是勾选候选的来源；没有就按 fixture 造一个（环境准备，记 BUSINESS）
    if (!((meS.companions || []).length)) {
      const c = await cloudCall('trailApi', 'dispatch', { expectedRevision: await (async () => (await cloudCall('trailApi', 'read', { request: { kind: 'profile' } })).data.revision)(), payload: { type: 'companion.save', companionId: null, person: { name: '自动化同行人', phone: '00000000008', emergency: { name: '自动化家属', phone: '00000000007' }, medical: '', avatar: '' } } })
      L.b('fixture：造一名常用同行人（勾选候选的来源）', c.ok === true, JSON.stringify(c.error || c.err || 'ok').slice(0, 140))
    }
    // 取消本人那条报名，腾出「可再次报名」状态
    const v0 = await cloudCall('trailApi', 'read', { request: { kind: 'activity', activityId: suId, perspective: 'organizer' } })
    const ownRow = ((v0 && v0.ok && v0.data.view.rows) || [])[0]
    if (ownRow) {
      const c2 = await cloudCall('trailApi', 'dispatch', { expectedRevision: await (async () => (await cloudCall('trailApi', 'read', { request: { kind: 'activity', activityId: suId, perspective: 'organizer' } })).data.revision)(), payload: { type: 'signup.cancel', activityId: suId, signupIds: [ownRow.signupId], reason: 'E2E 报名沙盒腾位' } })
      L.b('取消本人报名行以腾出可报名状态', c2.ok === true, JSON.stringify(c2.error || c2.err || 'ok').slice(0, 200))
    }
    await hardReconnect()
    suPage = await open('/pages/signup/signup?id=' + suId)
    await probeChannel(suPage)
    suData = await suPage.data()
    L.u('报名页装配（准入闸放行、mode=new、参与人列表非空）',
      !!suData && suData.loading === false && !suData.denied && suData.mode === 'new' && (suData.participants || []).length > 0,
      JSON.stringify({ loading: suData && suData.loading, denied: suData && suData.denied, mode: suData && suData.mode, parts: (suData && suData.participants || []).length }))
    const own = (suData && suData.participants || [])[0] || {}
    L.u('本人资料来自档案回填', !!(own.person && own.person.name), JSON.stringify(own.person && own.person.name))
    L.u('紧急联系人回填（档案有则直接展示）', !!(own.person && own.person.emergency && own.person.emergency.name),
      JSON.stringify(own.person && own.person.emergency))
  }, () => ({ ok: true }))

  await L.block('报名页勾选同行人（真实 tap，不做任何绕过）', 5, async () => {
    const candAll = (await suPage.$$('checkbox-group')) || []
    // 每个候选行自带一个 checkbox-group，data-key 挂在 group 上（挂内层 label 会被 checkbox-group 的
    // currentTarget 语义吃掉——本轮真机已复现，修在此记录）。按 data-key 前缀认出同行人那一行。
    const companionGroup = (await mapAttr(candAll, 'data-key')).filter(a => String(a.attr || '').indexOf('c:') === 0)[0]
    L.u('候选区渲染出同行人勾选行（data-key 在 checkbox-group 上）', !!companionGroup,
      JSON.stringify((await mapAttr(candAll, 'data-key')).map(x => x.attr)).slice(0, 200))
    const cb = companionGroup ? await companionGroup.el.$('checkbox') : null
    const partsBefore = ((await suPage.data()).participants || []).map(p => p.key)
    const okTap = await tapEl(cb)
    L.uiTap('点同行人候选行的勾选框', okTap, 'tap checkbox @ checkbox-group[data-key^="c:"]')
    await suPage.waitFor(1200)
    const partsAfter = ((await suPage.data()).participants || []).map(p => p.key)
    const added = partsAfter.filter(k => String(k).indexOf('c:') === 0)
    L.uEffect('勾选后同行人进入参与人列表（真实用户路径可完成多人报名）',
      added.length === partsBefore.filter(k => String(k).indexOf('c:') === 0).length + 1,
      JSON.stringify({ before: partsBefore, after: partsAfter }))
    const okUntap = await tapEl(cb)
    L.uiTap('再点一次取消勾选', okUntap, 'tap 同一勾选框')
    await suPage.waitFor(1200)
    const partsFinal = ((await suPage.data()).participants || []).map(p => p.key)
    L.uEffect('取消勾选后同行人被移出参与人列表', partsFinal.length === partsBefore.length,
      JSON.stringify({ before: partsBefore.length, after: partsFinal.length }))
    await shot('07-signup-companion')
  }, uiGate('报名页元素通道退化，勾选框无法经真实 tap 验证', 1))

  // ===== 6. 我的页 =====
  page = await open('/pages/me/me')
  await probeChannel(page)
  await L.block('我的页装配', 1, async () => {
    const meData = await page.data()
    L.u('我的页装配（档案姓名可见）', !!meData && !meData.denied && !!(meData.person && meData.person.name),
      JSON.stringify(meData && meData.person && meData.person.name))
    await shot('08-me')
  }, uiGate())

  await miniProgram.disconnect()
  const v = L.print()
  console.log('截图目录（仅作 Evidence，不参与任何判定）：' + SHOTS)
  process.exit(v.exitCode)
}

// 读一组元素的某个 attribute（automator 的 attribute() 是异步的， map 不能直接 await）
async function mapAttr(els, attr) {
  const out = []
  for (const el of els) out.push({ el, attr: await el.attribute(attr) })
  return out
}

function section(t) { console.log('== ' + t + ' ==') }

main().catch(e => {
  if (e && e.name === 'AbortRun') console.error('环境前置不成立，已中断（结论记 INCONCLUSIVE，不是通过）：' + e.message)
  else console.error('UI E2E 执行异常：', e && (e.stack || e.message || e))
  console.error('排查：①开发者工具已登录且打开了 D:\\OurTrail；②设置→安全→服务端口已开；③关掉已开的自动化端口再试（工具右上角调试器）。')
  const v = L.print()
  process.exit(e && e.name === 'AbortRun' ? 2 : (v.exitCode === 0 ? 1 : v.exitCode))
})
