// P0 Golden Path v1：node tools/e2e-golden-path-test.js
// 目标不是「让测试变绿」，而是证明一个真实用户能否从创建一路走到归档——
// 每个关键状态转换都必须同时被「真实 UI 操作」和「backend 回读」证明。
//
// 结果语义沿用 tools/e2e-result.js（不另起一套）：BUSINESS 与 UI 两个独立维度，退出码 0/1/2。
// 本套件另按 GP 节点分组输出逐段 BUSINESS/UI 结论与证据（结尾的「逐节点账本」）。
//
// 硬约束（本轮判定线）：
//   · 禁止 callMethod / 改组件 data / 直接调页面 handler —— 一律真 tap·input，控件查不到就是查不到；
//   · 云侧命令只允许用于「测试环境准备」（建草稿 / 建同行人 / 补协作授权），这类步骤只记 BUSINESS，
//     被它替代的 UI 能力一律显式记 INCONCLUSIVE，绝不算 UI PASS；
//   · 原生 <picker> 在本基础库自动化通道里驱不动（实测 tap 后无可查询面板、值不变）——平台限制，
//     按 UI=INCONCLUSIVE 记账并指名控件；
//   · 已知产品缺陷不许绕过：面板阶段推进后不重读、协作授权 picker 无数据、
//     现场面板对未上车乘客提供「核实已随队出发」。撞到就记 FAIL + 证据，再按真实用户的补救动作继续，
//     以便一次运行拿到全部下游节点的结论。
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
const CLI = ['C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat'].find(p => fs.existsSync(p))

const L = createLedger({ dims: [BUSINESS, UI] })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const quiet = (label, e) => console.log('  · [忽略] ' + label + '：' + String((e && (e.message || e)) || 'unknown').slice(0, 120))

// —— 当前 GP 节点：断言名带前缀，结尾按节点汇总 ——
let GP = 'GP-00'
const node = (id, title) => { GP = id; console.log('\n──── [' + id + ' ' + title + '] ────') }
const b = (name, cond, ev) => L.b('[' + GP + '] ' + name, cond, ev)
const u = (name, cond, ev) => L.u('[' + GP + '] ' + name, cond, ev)
const ue = (name, cond, ev) => L.uEffect('[' + GP + '] ' + name, cond, ev)
const tap = (name, cond, ev) => L.uiTap('[' + GP + '] ' + name, cond, ev)
const unv = (name, reason) => L.uiUnverified('[' + GP + '] ' + name, reason)

// —— 完全确定的 fixture：身份/时间/车辆/座号全部写死，不依赖库里「碰巧存在」的数据 ——
// 单轮内确定、跨轮之间唯一：连跑 10 次不会互相污染（run4 就因同名遗留活动 hit=2 打偏过）
const RUN_TAG = 'r' + Date.now().toString(36).slice(-6)
const TITLE_PREFIX = '[GP·黄金路径] 青城后山半日'
const FIXTURE = {
  title: TITLE_PREFIX + '·' + RUN_TAG,
  description: '黄金路径自动化建场', organizerIntro: '自动化带队',
  startAt: '2027-03-14T08:00:00+08:00', endAt: '2027-03-14T18:00:00+08:00', deadlineAt: '2027-03-13T20:00:00+08:00',
  acceptingSignups: true, capacity: 6, approvalMode: 'manual', routeId: null,
  routeSnapshot: {
    title: '飞泉沟—珊瑚温泉', distanceKm: 9.5, ascentM: 420,
    points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null },
      { id: 'pt-2', name: '观景台', kind: 'finish', coordinates: null }],
    risks: [{ id: 'risk-1', title: '石阶湿滑', advice: '穿防滑鞋，扶栏慢行' }],
  },
  pickupPoints: [{ id: 'pk-1', name: '成都茶馆集合点', meetingAt: '2027-03-14T07:00:00+08:00', address: '文殊院路口', coordinates: null }],
  equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前电话联系',
}
// 核载 3 − 服务司机 1 − 预留 0 = 2 个乘客位 ⇒ 座号就这两个；
// 报名确认后恰好 2 位「按上车点集合」的乘客 ⇒ 自动方案的占用集合必然等于它（allocation.js 只发最低空座）。
// 期望值来自这份 fixture 与分配规则，不读回实际结果再当期望。
const VEHICLE = { label: '1号车', plate: '川A·GP001', legalCapacity: 3, blockedSeats: 0, driverName: ' GP服务司机', driverPhone: '00000000031' }
const SEAT_LABELS = ['01', '02']
const COMPANION = { name: 'GP同行甲', phone: '00000000021', emergency: { name: 'GP同行甲家属', phone: '00000000022' }, medical: '', avatar: '' }
// 阶段按钮文案 = 「进入」+ 下一阶段标签（format.js:74 PHASE_LABELS）——独立输入，不是读回
const PHASE_BTN = { published: '进入正在集合', gathering: '进入正在同行', active: '进入返程报平安', closing: '进入已归档' }

function loadAutomator() {
  const pkg = path.join(DEPS, 'node_modules', 'miniprogram-automator')
  try { return require(pkg) } catch (e) {
    console.log('  （首次运行：装 miniprogram-automator 到 ' + DEPS + '，仓库保持零依赖）')
    fs.mkdirSync(DEPS, { recursive: true })
    const pj = path.join(DEPS, 'package.json')
    if (!fs.existsSync(pj)) fs.writeFileSync(pj, JSON.stringify({ name: 'ourtrail-e2e-deps', private: true }))
    execFileSync('npm', ['install', 'miniprogram-automator', '--no-fund', '--no-audit'], { cwd: DEPS, stdio: 'inherit' })
    return require(pkg)
  }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const automator = loadAutomator()
  let mp = null
  let reconnected = false
  let page = null
  let AID = ''
  let myUserId = ''   // 本轮登录身份的 userId（read{profile} 回读，用作 organizer 一致性的判据）
  let vehicleId = ''
  let seatViaUi = false
  // 本轮真正要代报的那位同行人（按 id 锁定，不按候选顺序——账号里可能有别的遗留同行人）
  const companionRef = { id: '', name: COMPANION.name }

  // ===== GP-00 环境与源码自检 =====
  node('GP-00', '环境')
  const selfFindings = auditSource(fs.readFileSync(__filename, 'utf8'), 'e2e-golden-path-test.js')
  L.b('[' + GP + '] 本脚本源码完整性自检（0 违规）', selfFindings.length === 0,
    selfFindings.length ? selfFindings.slice(0, 5).map(f => f.rule + ':' + f.line).join(' | ') : 'auditSource 无 findings')
  L.env('找到开发者工具 cli.bat', !!CLI, CLI || CLI.join(' / '))
  const runCli = args => { try { return execFileSync(CLI, args, { timeout: 150000 }).toString() } catch (e) { quiet('cli ' + args[0], e); return String(e) } }
  const waitPort = port => new Promise(resolve => {
    const probe = net.connect({ port, host: '127.0.0.1' })
    probe.once('connect', () => { probe.destroy(); resolve(true) })
    probe.once('error', () => resolve(false))
  })
  for (let attempt = 1; attempt <= 3 && !mp; attempt++) {
    try { mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTOMATOR_PORT }); break } catch (e) {
      if (attempt === 1) runCli(['auto', '--project', PROJECT, '--auto-port', String(AUTOMATOR_PORT)])
      if (attempt === 2) { runCli(['close', '--project', PROJECT]); await sleep(4000); runCli(['auto', '--project', PROJECT, '--auto-port', String(AUTOMATOR_PORT)]) }
      for (let i = 0; i < 12 && !mp; i++) {
        await sleep(4000)
        if (await waitPort(AUTOMATOR_PORT)) {
          try { mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTOMATOR_PORT }) } catch (e2) { quiet('端口开但服务未就绪', e2) }
        }
      }
    }
  }
  L.env('automator 连接（自动化端口 ' + AUTOMATOR_PORT + '）', !!mp, mp ? 'connected' : '三次梯度重连仍无会话')
  const sys = await mp.systemInfo()
  L.env('模拟器运行中', !!(sys && sys.SDKVersion), 'SDKVersion=' + (sys && sys.SDKVersion))
  const shot = name => mp.screenshot({ path: path.join(SHOTS, 'gp-' + name + '.png') }).then(() => {}).catch(e => quiet('截图 ' + name, e))

  // —— 助手：元素查询一律 $$（$ 恒返回单元素，按数组用就永远查不到 —— 历史 tap 全部静默的根因）——
  const queryAll = async (scope, sel, tries) => {
    for (let i = 0; i < (tries || 4); i++) {
      const els = scope ? await scope.$$(sel) : []
      if (els && els.length) return els
      await sleep(800)
    }
    return []
  }
  // 组件/元素句柄可能查不到（控件本来就不存在时这是结论，不是崩溃）——统一走 dataOf
  const dataOf = async el => { if (!el) return null; try { return await el.data() } catch (e) { quiet('data', e); return null } }
  const tapEl = async el => { if (!el) return false; try { await el.tap(); return true } catch (e) { quiet('tap', e); return false } }
  const inputEl = async (el, v) => { if (!el) return false; try { await el.input(v); return true } catch (e) { quiet('input', e); return false } }
  const textsOf = async (scope, sel) => {
    const out = []
    for (const e of (await (scope ? scope.$$(sel) : [])) || []) out.push(String((await e.text()) || '').trim())
    return out
  }
  // 按文案命中按钮：反复重查直到匹配（弹层子树晚于 data 落位；面板正文里本来就有同名类）
  const byText = async (scope, label) => {
    for (let i = 0; i < 6; i++) {
      for (const sc of [scope, page]) {
        if (!sc) continue
        for (const sel of ['.button', 'button']) {
          const els = (await sc.$$(sel)) || []
          for (const el of els) if (String((await el.text()) || '').trim() === label) return el
        }
      }
      await sleep(700)
    }
    return null
  }
  const probeChannel = async pg => {
    const all = await queryAll(pg, 'view', 3)
    L.setChannel(all.length > 0 ? 'healthy' : 'degraded', '$$ view → ' + all.length + ' 个元素')
    return all.length > 0
  }
  const healthy = () => L.channel() === 'healthy'
  const uiGate = (reason, actions) => () => (healthy() ? { ok: true, actions: actions || 0 } : { ok: false, reason: reason || '元素查询通道退化（控制组 $$ 返回空）' })
  // 「活动进程」区块（含阶段按钮）只在 tab===0 渲染（workspace.wxml:33 的 wx:if），
  // 所以推进阶段前必须真实点回「总览」——这是用户的做法，不是把断言搬到后端。
  const overview = async () => {
    const segs = await queryAll(page, '.seg')
    const total = segs[0] || null
    const ok = await tapEl(total)
    tap('点回「总览」分区（阶段按钮只在这里渲染）', ok, 'tap .seg[0]「总览」@ workspace')
    await page.waitFor(1200)
    const d = await page.data()
    ue('分区切换生效（data.tab=0）', !!d && d.tab === 0, 'tab=' + (d && d.tab))
  }
  const open = async url => {
    let lastErr
    for (let i = 0; i < 3; i++) {
      try {
        const p = await mp.reLaunch(url)
        await p.waitFor(1200)
        for (let t = 0; t < 20; t++) {
          const d = await p.data()
          if (d && d.loading === false) break
          await p.waitFor(900)
        }
        return p
      } catch (e) { lastErr = e; await sleep(4000) }
    }
    throw lastErr || new Error('页面打不开：' + url)
  }
  // 阶段推进的真实用户流程：回总览 → 点阶段按钮 → 填原因 → 确认。
  // 若此前刚在面板里下发过命令，页级 revision 就旧了，服务端以 CONFLICT 拒第一次确认并提示
  // 「安排已被他人更新，已刷新，请重试」（api.js:111-119：只重读页面，不代重发）——用户于是再点一次。
  // 两次尝试都单独记账：第一次被拒是事实，不是可以藏起来的噪声。
  const phaseAdvance = async (label, reasonText) => {
    await overview()
    await waitIdle()   // 阶段按钮同样受 busy 条件绑定，busy=true 时点下去不触发任何 handler
    const go = await byText(page, label)
    const okGo = await tapEl(go)
    tap('点「' + label + '」', okGo, 'tap 阶段按钮@ workspace 总览（文案=进入+PHASE_LABELS[next]）')
    await page.waitFor(1800)
    const opened = await page.data()
    ue('阶段确认弹层打开（transitionOpen=true）', !!opened && opened.transitionOpen === true, 'transitionOpen=' + (opened && opened.transitionOpen))
    // 工作台的四个面板是「保持挂载、用类名隐藏」的（workspace.wxml:27-31），所以页面上同时存在
    // 现场面板的备注 textarea 与弹层的原因 textarea。只取 queryAll[0] 会填错地方：
    // 原因落不进 data.reason，「确认变更」就是 disabled 的空按钮（点了没反应）。
    // 判据只能是填完之后 data.reason 真的等于所填文案。
    const fillReason = async () => {
      const areas = await queryAll(page, '.textarea')
      for (let i = 0; i < areas.length; i++) {
        if (!await inputEl(areas[i], reasonText)) continue
        const d = await page.data()
        if (d && String(d.reason || '') === reasonText) return { ok: true, idx: i, n: areas.length }
      }
      return { ok: false, idx: -1, n: areas.length }
    }
    const r1 = await fillReason()
    tap('填写阶段变更原因（落到 data.reason）', r1.ok,
      '页面共 ' + r1.n + ' 个 .textarea（弹层原因框 + 挂载中的面板备注框）；落到 data.reason 的是第 ' + r1.idx + ' 个')
    const confirm = await byText(page, '确认变更，不跳过检查')
    const okConfirm = await tapEl(confirm)
    tap('点「确认变更，不跳过检查」（第 1 次）', okConfirm, 'tap 确认变更')
    // 确认后页面要跑一次云端往返再 setData(transitionOpen:false)，固定 3 秒判读会把已经成功的推进
    // 误报成「按钮没生效」（本轮普查：9 次里 3 次踩到，回读 phase 其实已经变了）。
    const judged = await settle(async () => page.data(), d => !!d && (d.transitionOpen === false || !!d.error), 10)
    let st = judged.v
    const stillOpen = !!(st && st.transitionOpen)
    let firstErr = st && st.error ? String(st.error) : ''
    if (stillOpen && !firstErr) {
      u('第 1 次确认没生效：弹层仍开着且无红字（按钮 disabled，原因未落地）', false,
        JSON.stringify({ stillOpen, reason: (st && st.reason) || '', usedIdx: r1.idx, 等待次数: judged.waited }))
      return { error: '（确认未生效）', sheetOpen: stillOpen, triedTwice: false }
    }
    if (firstErr) {
      u('第 1 次确认被拒并给出红字（乐观并发闸：面板刚下发过命令）', firstErr.length > 0,
        JSON.stringify({ error: firstErr, sheetStillOpen: stillOpen }))
      // 产品原话是「请核对最新状态后重新提交」，而 api.js:115 的 page.reload() 是 fire-and-forget：
      // 立刻再点一次会拿着还没更新的页级 revision 再撞一次 CONFLICT。
      // 所以这里等页面真的把最新 revision 读回来（读实例属性只做同步判据，点击一律还是真 UI）。
      const target = (await orgView()).revision
      let pageRev = null
      let polls = -1
      for (let i = 0; i < 12; i++) {
        pageRev = await mp.evaluate(new Function('return getCurrentPages().slice(-1)[0].revision'))
        if (pageRev === target) { polls = i; break }
        await sleep(900)
      }
      u('CONFLICT 后页面按提示重读到了最新 revision（「核对最新状态」这一步可观测）', pageRev === target,
        JSON.stringify({ pageRevision: pageRev, cloudRevision: target, polls }))
      if (!stillOpen) {
        const again = await byText(page, label)
        const okAgain = await tapEl(again)
        tap('按提示重新打开「' + label + '」确认层', okAgain, 'tap 阶段按钮（第 2 次，用户级重试）')
        await page.waitFor(1800)
      }
      const r2 = await fillReason()
      tap('第 2 次填写阶段变更原因（落到 data.reason）', r2.ok,
        'CONFLICT 后页面已重读；落到 data.reason 的是第 ' + r2.idx + ' 个（共 ' + r2.n + ' 个 .textarea）')
      const c2 = await byText(page, '确认变更，不跳过检查')
      const okC2 = await tapEl(c2)
      tap('点「确认变更，不跳过检查」（第 2 次）', okC2, 'tap 确认变更')
      await page.waitFor(3000)
      st = await page.data()
    }
    return { error: (st && st.error) || '', sheetOpen: !!(st && st.transitionOpen), triedTwice: !!firstErr }
  }
  // 面板的失效重读是一次异步读：立刻判读会把「还没回来」误诊成「没重读」。
  // 这里是轮询到目标 phase 落地，并把等待次数记进证据；等不到就是 FAIL，不放宽。
  const waitPanelPhase = async (fp, want) => {
    let d = null
    for (let i = 0; i < 10; i++) {
      d = fp ? await dataOf(fp) : null
      if (d && d.phase === want) return { d, waited: i }
      await sleep(800)
    }
    return { d, waited: -1 }
  }
  // 面板/后端的落库与重渲染都是异步的：一次性判读会把「还没回来」误诊成「没做到」。
  // settle 轮询到目标成立为止（等不到返回 -1），断言仍照原样判 —— 只是不再靠运气。
  const settle = async (read, pred, tries) => {
    let v = null
    for (let i = 0; i < (tries || 10); i++) {
      v = await read()
      if (pred(v)) return { v, waited: i }
      await sleep(800)
    }
    return { v, waited: -1 }
  }
  const waitIdle = tries => settle(async () => page.data(), d => !!d && d.busy === false, tries || 8)
  const currentRoute = () => mp.evaluate(new Function('return getCurrentPages().slice(-1)[0].route'))
  const cloud = (name, action, data) => {
    const call = () => mp.evaluate(
      new Function('name', 'action', 'data', 'return new Promise(res => wx.cloud.callFunction({ name, data: Object.assign({ action }, data) }).then(r => res(r.result)).catch(e => res({ ok: false, err: String(e && e.errMsg || e) })))'),
      name, action, data)
    return (async () => {
      let r
      for (let i = 0; i < 3; i++) {
        try { r = await call(); if (r) return r } catch (e) {
          if (i === 2) throw e
          try { await mp.disconnect() } catch (e1) { quiet('disconnect(重连前)', e1) }
          await sleep(2000)
          try { mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTOMATOR_PORT }); reconnected = true } catch (e2) { quiet('重连未就绪', e2) }
          await sleep(1500)
        }
        await sleep(3500)
      }
      return r
    })()
  }
  const read = req => cloud('trailApi', 'read', { request: req })
  const dispatch = (payload, expectedRevision) => cloud('trailApi', 'dispatch', { payload, expectedRevision })
  // 服务端返回 {view, revision, now}：activity/rows/counters 在 view 里，revision 在 data 上。
  // 合并成一个对象返回，避免各处写错一层而抛「Cannot read properties of undefined」。
  const orgView = async () => {
    const r = await read({ kind: 'activity', activityId: AID, perspective: 'organizer' })
    const d = (r && r.data) || {}
    return Object.assign({}, d.view || {}, { revision: d.revision, readOk: r && r.ok })
  }
  const transport = async () => {
    const tr = await cloud('trailApi', 'readTransport', { activityId: AID })
    return (tr && tr.ok && tr.data.ok !== false && tr.data.value) || { vehicles: [], assignments: [] }
  }

  // ===== GP-00 通道预检：元素查询通道一开场就退化时立即中断 =====
  // 不做这件事的话，后面 13 个节点会整片被门槛挡掉，产出一份「全是未验证」的误导性报告。
  // 通道退化的真实处置是重启项目窗口（cli close + open + auto），见 docs/e2e-mp/README.md。
  page = await open('/pages/home/home')
  await probeChannel(page)
  L.env('元素查询通道可用（控制组 $$ view 非空）', healthy(),
    L.channel() === 'healthy' ? 'healthy' : '本会话元素查询通道退化：请 cli close + open + auto 重启项目窗口后重跑（中断，不算通过也不算失败）')

  // —— 清掉历史轮次遗留的 [GP·黄金路径] 活动（它们还挂在发现列表里会干扰本轮定位）——
  await L.block('GP-00 清理历史 GP 沙盒（业务入口）', 1, async () => {
    const disc = await read({ kind: 'discover' })
    const stale = ((disc.data && disc.data.view.activities) || []).filter(a => String(a.title || '').indexOf(TITLE_PREFIX) === 0)
    let done = 0
    for (const a of stale.slice(0, 8)) {
      const one = await read({ kind: 'activity', activityId: a.id, perspective: 'organizer' })
      if (!one || !one.ok || !one.data.view.activity) continue
      const r = await dispatch({ type: 'activity.transition', activityId: a.id, next: 'cancelled', reason: '黄金路径自动化：清理上一轮遗留沙盒' }, one.data.revision)
      if (r && r.ok) done++
    }
    // 带报名的历史沙盒按域规则取消不掉（取消不得残留有效报名）——那是正确行为，不是本轮前提。
    // 本轮真正需要的前提是「标题带 RUN_TAG 唯一」：任何一轮都不会与别的轮次撞名。
    const collide = ((await read({ kind: 'discover' })).data.view.activities || [])
      .filter(a => a.title === FIXTURE.title)
    b('本轮标题唯一（不与历史轮撞名，起点不依赖「碰巧存在」的数据）',
      collide.length === 0, JSON.stringify({ staleTotal: stale.length, cancelled: done, sameTag: collide.length, title: FIXTURE.title }))
  }, () => ({ ok: true }))

  // ============================================================
  // GP-01 创建活动：真实入口 = 首页「发起活动」→ 编辑器
  // ============================================================
  node('GP-01', 'Create 创建活动')
  await L.block('GP-01 编辑器真实交互', 9, async () => {
    page = await open('/pages/home/home')
    await probeChannel(page)
    const createBtn = await byText(page, '发起活动')
    const okCreate = await tapEl(createBtn)
    tap('点首页「发起活动」进入编辑器', okCreate, 'tap 「发起活动」@ home')
    await page.waitFor(3000)
    const route0 = await currentRoute()
    ue('真实导航落到编辑器页', String(route0) === 'pages/editor/editor', '当前页=' + route0)
    page = await open('/pages/editor/editor')
    await probeChannel(page)
    const ed = await page.data()
    u('编辑器装配（isNew=true、三步标签）', !!ed && ed.isNew === true && (ed.stepLabels || []).length === 3,
      JSON.stringify({ isNew: ed && ed.isNew, steps: (ed && ed.stepLabels || []).length }))
    const inputs = await queryAll(page, '.input')
    const okTitle = await inputEl(inputs[0], FIXTURE.title)
    tap('在标题栏输入活动名', okTitle, 'input .input[0] data-key=title')
    const afterTitle = await page.data()
    ue('标题落到表单状态（form.title 等于所填）', afterTitle.form.title === FIXTURE.title, JSON.stringify({ title: afterTitle.form.title }))
    const segs = await queryAll(page, '.seg')
    const okStep = await tapEl(segs[1])
    tap('点第 02 步「路线与集合」', okStep, 'tap .seg[1]')
    await page.waitFor(1200)
    ue('步骤切换生效（data.step=1）', (await page.data()).step === 1, 'step=' + (await page.data()).step)
    const back0 = await tapEl((await page.$$('.seg'))[0])
    tap('回到第 01 步准备填时间', back0, 'tap .seg[0]')
    await page.waitFor(1000)
    const timeRow = (await page.$$('[data-key="dt_start"]'))[0] || null
    const okTimeOpen = await tapEl(timeRow)
    tap('点开「出发时间」行', okTimeOpen, 'tap [data-key=dt_start]')
    await page.waitFor(1200)
    const afterTime = await page.data()
    ue('时间行展开（expandedTimes.dt_start=true）',
      !!(afterTime.expandedTimes && afterTime.expandedTimes.dt_start === true), JSON.stringify(afterTime.expandedTimes))
    const pickers = await page.$$('picker')
    const beforePicker = (await page.data()).form.dt_start
    if (pickers.length) { await tapEl(pickers[0]); await page.waitFor(2000) }
    const afterPicker = (await page.data()).form.dt_start
    // 这不是产品的错，也不是用户做不到的事——是自动化通道的能力边界。记 INCONCLUSIVE，不冒充 FAIL。
    unv('原生 <picker mode=date/time> 驱动出发时间',
      '实测 picker ' + pickers.length + ' 个，tap 后 dt_start=' + JSON.stringify(afterPicker) +
      '（与改前 ' + JSON.stringify(beforePicker) + ' 相同）：DevTools 原生层不可查询、不可驱动')
    unv('「出发时间由用户亲手选定」这条真实路径', '原生 <picker mode=date/time> 驱不动（实测无面板、值不变）；出发时间只能由业务命令补齐 ⇒ 草稿落库只有 BUSINESS 证据')
  }, uiGate('编辑器元素通道退化'))

  await L.block('GP-01 草稿落库（业务入口，非 UI）', 2, async () => {
    const created = await dispatch({ type: 'activity.create', input: FIXTURE })
    b('activity.create → 草稿落库 ok', created && created.ok === true, JSON.stringify((created && (created.error || created.err)) || 'ok').slice(0, 200))
    AID = created && created.ok ? created.data.targetIds[0] : ''
    if (!AID) { b('取得草稿 activityId（后续 12 个节点的前提）', false, '没有草稿 id，本轮无法继续'); return }
    const v = await orgView()
    b('回读：phase=draft 且标题/名额等于 fixture 输入',
      v.activity.phase === 'draft' && v.activity.title === FIXTURE.title && v.activity.capacity === FIXTURE.capacity,
      JSON.stringify({ phase: v.activity.phase, title: v.activity.title, capacity: v.activity.capacity }))
  }, () => ({ ok: true }))
  if (!AID) throw new L.AbortRun('GP-01 草稿未建立，后续 12 个节点全部无从进行（中断，不算通过）')

  // ============================================================
  // GP-02 编辑活动：真实进入编辑器改一个明确字段并保存
  // ============================================================
  node('GP-02', 'Edit 编辑活动')
  await L.block('GP-02 编辑并保存', 8, async () => {
    const before = await orgView()
    const revBefore = before.revision
    page = await open('/pages/activity/activity?id=' + AID)
    await probeChannel(page)
    const back = await byText(page, '返回编辑与发布')
    const okBack = await tapEl(back)
    tap('从草稿详情点「返回编辑与发布」', okBack, 'tap 「返回编辑与发布」@ activity')
    await page.waitFor(3000)
    const route = await currentRoute()
    ue('真实导航落到编辑器', String(route) === 'pages/editor/editor', '当前页=' + route)
    page = await open('/pages/editor/editor?id=' + AID)
    await probeChannel(page)
    const ed = await page.data()
    u('编辑器按已存草稿装配（isNew=false、标题回填）',
      !!ed && ed.isNew === false && ed.form.title === FIXTURE.title, JSON.stringify({ isNew: ed && ed.isNew, title: ed && ed.form.title }))
    const note = '黄金路径编辑追加：集合点提前十分钟到。'
    // 「详细介绍（可选）」是折叠卡（editor.wxml:136 toggleIntro），里面的 textarea 在展开前根本不存在
    const introRow = (await page.$$('.card [hover-class], .card .cluster'))[0] || null
    const rows = (await page.$$('.cluster')) || []
    let target = null
    for (const r of rows) { if (String((await r.text()) || '').indexOf('详细介绍') !== -1) { target = r; break } }
    const okExpand = await tapEl(target || introRow)
    tap('展开「详细介绍（可选）」折叠', okExpand, 'tap .cluster 含「详细介绍」文案@ editor step0')
    await page.waitFor(1200)
    const exp = await page.data()
    ue('折叠展开生效（expandedIntro=true，介绍输入位出现）',
      !!(exp && exp.expandedIntro === true), JSON.stringify({ expandedIntro: exp && exp.expandedIntro, textareas: (await page.$$('.textarea')).length }))
    const descArea = (await queryAll(page, '.textarea'))[0] || null
    const okDesc = await inputEl(descArea, note)
    tap('在活动介绍里填写新内容', okDesc, 'input .textarea[0]（data-key=description）')
    const typed = await page.data()
    ue('新介绍落到表单状态（form.description 等于所填）', !!typed && typed.form.description === note,
      JSON.stringify({ description: ((typed && typed.form.description) || '').slice(0, 30) }))
    await waitIdle()   // 编辑器的「保存草稿」在 busy 期间没有 handler，抢点等于没点
    const save = await byText(page, '保存草稿')
    const okSave = await tapEl(save)
    tap('点「保存草稿」提交修改', okSave, 'tap .button.secondary「保存草稿」@ editor（phase=draft 时的文案）')
    // 编辑器保存要走两次往返（先读档案再下发），一次固定等待会误诊成「没落库」
    const got = await settle(orgView, v => v.activity.description === note && v.revision === revBefore + 1, 12)
    const edNow = (await page.data()) || {}
    const edRev = String(await mp.evaluate(new Function('return getCurrentPages().slice(-1)[0].revision')))
    const now = got.v
    const act = now.activity
    b('activity.edit 回读：说明已改变，其它字段没被覆盖，revision 恰好 +1',
      act.description === note && act.title === FIXTURE.title && act.capacity === FIXTURE.capacity
      && act.routeSnapshot.points.length === FIXTURE.routeSnapshot.points.length
      && now.revision === revBefore + 1,
      JSON.stringify({ revBefore, revAfter: now.revision, 等待次数: got.waited, editorPageRevision: edRev,
        failure: edNow.failure || '', busy: !!edNow.busy, desc: (act.description || '').slice(0, 24), capacity: act.capacity }))
  }, uiGate('编辑要经真实表单，元素通道退化时无法验证'))

  // ============================================================
  // GP-03 发布：真实点「发布活动」→ 弹层 → 「确认发布」
  // ============================================================
  node('GP-03', 'Publish 发布')
  await L.block('GP-03 真实发布与重复发布', 8, async () => {
    const segs = await queryAll(page, '.seg')
    const okStep = await tapEl(segs[2])
    tap('切到第 03 步「招募与风险」（发布按钮只在这一步渲染）', okStep, 'tap .seg[2]@ editor')
    await page.waitFor(1200)
    const st = await page.data()
    ue('步骤切换生效（data.step=2）', !!st && st.step === 2, 'step=' + (st && st.step))
    const pubIntent = await byText(page, '发布活动')
    const okIntent = await tapEl(pubIntent)
    tap('点「发布活动」打开发布弹层', okIntent, 'tap .button.primary「发布活动」@ editor')
    // onPublishIntent 会先静默保存（一次完整往返）再开层：慢一点云就会「按钮还没落位」，
    // 固定 1800ms 判读会把这条钉成假红（本轮 run 4 实测）。改为等按钮真的出现，等不到才算红。
    const sheetG = await settle(async () => byText(page, '确认发布'), b => !!b, 10)
    const sheetBtn = sheetG.v
    const sheet = await page.data()
    ue('发布弹层已打开（弹层内的「确认发布」按钮可被查到）', !!sheetBtn,
      '「确认发布」命中=' + !!sheetBtn + '；等待 ' + sheetG.waited + ' 次；publishOpen 读数=' + (sheet && sheet.publishOpen) + '（onPublishIntent 会先静默保存再开层，flags 读数会滞后）')
    const confirm = sheetBtn
    const okPublish = await tapEl(confirm)
    tap('点弹层内「确认发布」', okPublish, 'tap .button.primary.block「确认发布」')
    const pubG = await settle(orgView, x => x.activity.phase === 'published', 10)
    const v1 = pubG.v
    const publishedSnapshot = JSON.stringify(v1.activity)
    b('发布后 phase=published', v1.activity.phase === 'published',
      JSON.stringify({ phase: v1.activity.phase, 等待次数: pubG.waited }))
    b('发布未勾选「我本人也参加」⇒ 名单为空（发布与报名是两件事）',
      (v1.rows || []).length === 0, JSON.stringify({ rows: (v1.rows || []).length }))
    // 发布成功后产品会把用户送到活动页：编辑器句柄随之销毁，
    // 重复发布的 UI 检查只能在「当前真实所在页」上做，不能拿旧句柄（旧句柄只会抛 page destroyed）。
    page = (await mp.currentPage()) || page
    const again = await byText(page, '发布活动')
    u('已发布活动不再提供「发布活动」入口（重复发布先被 UI 挡住）', again === null,
      '发布后所在页=' + page.path + '；查找「发布活动」：' + (again === null ? '已消失' : '仍存在'))
    const dup = await dispatch({ type: 'activity.publish', activityId: AID }, v1.revision)
    const v2 = await orgView()
    // 「零副作用」的判据必须是**这场活动本身**：`revision` 是全局 CAS 计数（store.js:115），
    // 这套 ot_* 集合被多条链路共用，别人的一次写入就会把它推进 —— 拿它当本活动的副作用判据是错的 oracle，
    // 不是更严。这里改成逐字段比对活动快照（比原来只比 phase 更强），全局 revision 只作为证据记录。
    b('服务端拒绝重复发布且这场活动逐字段零变化',
      dup && dup.ok === false && ['WRONG_PHASE', 'INVALID_INPUT', 'CONFLICT'].indexOf(dup.error.code) !== -1
      && v2.activity.phase === 'published'
      && JSON.stringify(v2.activity) === publishedSnapshot,
      JSON.stringify({ err: (dup && dup.error && dup.error.code) || '居然成功了', phase: v2.activity.phase,
        本活动逐字段一致: JSON.stringify(v2.activity) === publishedSnapshot,
        全局revision: { before: v1.revision, after: v2.revision, 说明: '共享云的 CAS 计数，可能被他人写入推进，不作判据' } }))
  }, uiGate('发布链要经真实按钮'))

  // ============================================================
  // GP-04 发现：普通用户从「发现活动」列表点进详情
  // ============================================================
  node('GP-04', 'Discover 发现活动')
  await L.block('GP-04 发现列表 → 详情（精确身份链）', 10, async () => {
    page = await open('/pages/home/home')
    await probeChannel(page)
    const disc = await byText(page, '发现活动')
    const okDisc = await tapEl(disc)
    tap('点首页「发现活动」', okDisc, 'tap 「发现活动」@ home')
    await page.waitFor(3000)
    const route = await currentRoute()
    ue('真实导航落到发现页', String(route) === 'pages/discover/discover', '当前页=' + route)
    page = await mp.currentPage()
    // 发现页的 cards 也是异步装配的：拿一次空快照再回头用它核对下标，会把对的卡判成错的（普查 run 4 实测）。
    // 先等页面数据里确实只有这一场，再往下做「渲染元素 ↔ 页面数据下标」的绑定。
    const ddG = await settle(async () => page.data(), c => !!c && c.loading === false
      && (c.cards || []).filter(x => x.id === AID).length === 1, 10)
    let dd = ddG.v
    const want = FIXTURE.title
    const all = ((await read({ kind: 'discover' })).data.view.activities || [])
    const listed = all.filter(a => a.id === AID)
    // 期望值全部来自 fixture 与创建时的返回值：AID 是 activity.create 的结果，want/organizerIntro 是我填的文案
    b('发现流里 id=AID 的活动恰好一条，且 phase=published、标题与 organizerIntro 等于 fixture 输入',
      listed.length === 1 && listed[0].phase === 'published' && listed[0].title === want
      && listed[0].organizerIntro === FIXTURE.organizerIntro,
      JSON.stringify({ hits: listed.map(a => ({ id: a.id, phase: a.phase, title: a.title })) }))
    u('列表页确实渲染出这一张卡（不是靠 id 直达详情）',
      !!dd && dd.loading === false && (dd.cards || []).filter(c => c.id === AID).length === 1
      && (dd.cards || []).filter(c => c.title === want).length === 1,
      JSON.stringify({ cards: (dd.cards || []).length, byId: (dd.cards || []).filter(c => c.id === AID).length, byTitle: (dd.cards || []).filter(c => c.title === want).length }))
    const comp = await queryAll(page, 'activity-card')
    // 按渲染出来的标题文本定位卡片（标题含唯一 RUN_TAG，历史轮不会撞名）
    let target = null
    let targetIndex = -1
    for (let i = 0; i < comp.length; i++) {
      const t = await comp[i].$('.activity-card__title')
      if (t && String(await t.text() || '').trim() === want) { target = comp[i]; targetIndex = i; break }
    }
    // 绑定必须在「扫完 DOM 之后」重新取一次页面数据：中间若列表又刷新过一次，旧快照的下标就是错的
    dd = (await page.data()) || dd
    u('命中的那张卡按 wx:for 下标回读页面数据，其 id 必须等于本轮 AID',
      !!target && targetIndex >= 0 && !!dd && (dd.cards || [])[targetIndex] && (dd.cards || [])[targetIndex].id === AID,
      JSON.stringify({ targetIndex, cardId: ((dd.cards || [])[targetIndex] || {}).id, AID, 卡数: comp.length }))
    const cardText = target ? String(await target.text() || '') : ''
    u('卡片文案自证 organizer 关系：服务端算出的 owner 标志渲染成「我组织的」',
      cardText.indexOf('我组织的') !== -1, '卡片可见文本=' + cardText.slice(0, 120))
    // 真正可点的是组件内 <article bindtap="onTap">；点宿主组件节点不触发（本轮实测）
    const inner = target ? await target.$('article') : null
    const okCard = await tapEl(inner || target)
    tap('点该活动卡片', okCard, 'tap activity-card > article')
    await page.waitFor(2000)
    const route2 = await currentRoute()
    ue('点卡片后落到活动详情', String(route2) === 'pages/activity/activity', '当前页=' + route2)
    // 详情页自己是异步读装配的：固定等待会读到 loading=true 的空壳（普查中真发生过 title="" 误报）
    const detailG = await settle(async () => {
      const cur = await mp.currentPage()
      return cur ? await cur.data() : null
    }, d => !!d && d.loading === false && !d.denied && !!d.title, 10)
    page = await mp.currentPage()
    const ad = detailG.v
    u('详情内容正确（标题一致、非 denied、带队介绍就是我填的那句）',
      !!ad && String(ad.title || '') === want
      && String(ad.organizerIntro || '') === FIXTURE.organizerIntro && !!ad.stateTitle,
      JSON.stringify({ title: ad && ad.title, organizerIntro: ad && ad.organizerIntro, stateTitle: ad && ad.stateTitle, 等待次数: detailG.waited }))
    const prof = await read({ kind: 'profile' })
    myUserId = prof.data.view.profile.id
    const det = await read({ kind: 'activity', activityId: AID, perspective: 'participant' })
    const da = det.data.view.activity
    b('后端权威态对齐：详情记录 id=AID，ownerId 等于本轮登录身份（= activity.create 的下发者）',
      da.id === AID && da.ownerId === myUserId && da.phase === 'published',
      JSON.stringify({ detailId: da.id, ownerId: da.ownerId, myUserId, phase: da.phase }))
    b('发现流那一条与详情是同一条记录（不是同名活动）', da.title === want && listed[0].id === da.id,
      JSON.stringify({ discoverId: listed[0].id, detailId: da.id }))
  }, uiGate('发现页要经真实卡片点击'))

  // ============================================================
  // GP-05 报名：真实勾选 + 真实提交（本轮最关键的一段）
  // ============================================================
  node('GP-05', 'Signup 真实报名')
  await L.block('GP-05 报名前置（业务入口）', 2, async () => {
    const prof = await read({ kind: 'profile' })
    const me = prof.data.view.profile
    if (!(me.companions || []).some(c => c.person.name === COMPANION.name)) {
      const c = await dispatch({ type: 'companion.save', companionId: null, person: COMPANION }, prof.data.revision)
      b('环境准备：companion.save 建一名常用同行人（勾选候选的来源，业务入口）', c.ok === true,
        JSON.stringify(c.error || c.err || 'ok').slice(0, 200))
    } else {
      b('环境准备：所需同行人已在档案里且恰有一名同名候选（无需新建）',
        (me.companions || []).filter(c => c.person.name === COMPANION.name).length === 1,
        JSON.stringify({ names: me.companions.map(c => c.person.name) }))
    }
    const re = await read({ kind: 'profile' })
    const again = re.data.view.profile.companions || []
    const hit = again.find(c => c.person.name === COMPANION.name)
    companionRef.id = hit ? hit.id : ''
    b('回读并锁定同行人 id（候选勾选按 id 精确命中，不按顺序）', !!companionRef.id,
      JSON.stringify({ id: companionRef.id, names: again.map(c => c.person.name) }))
  }, () => ({ ok: true }))

  await L.block('GP-05 真实勾选与提交', 10, async () => {
    // 角色闸实测：详情页的报名 CTA 是 isOwner 的 wx:elif 分支（activity.wxml:48），
    // 组织者看得到「进入工作台」、看不到「填写报名资料」——这是按设计的角色分流，不是缺陷。
    const ownerCta = await byText(page, '进入工作台')
    const okOwnerTap = await tapEl(ownerCta)
    tap('组织者详情页给出的是「进入工作台」', okOwnerTap, 'tap 「进入工作台」@ activity（isOwner 分支）')
    await page.waitFor(2500)
    const backToDetail = await open('/pages/activity/activity?id=' + AID)
    page = backToDetail
    const wsGone = await byText(page, '填写报名资料')
    u('组织者视角的详情页不提供报名 CTA（角色闸按设计生效）', wsGone === null,
      '在详情页查找「填写报名资料」：' + (wsGone === null ? '不存在（符合 wx:elif 设计）' : '居然存在'))
    unv('「参与者从他人活动点进报名页」这一段', '本自动化通道只有一个登录身份：他人活动的报名 CTA 归他人，第二身份点不进来。' +
      '因此报名页改由 URL 直达，页内每一个控件（勾选框/授权/提交）仍全部走真实 tap——被跳过的那一步是导航，不是被测控件')
    page = await open('/pages/signup/signup?id=' + AID)
    await probeChannel(page)
    const d = await page.data()
    u('报名页服务端准入闸放行（permittedActions 含 signup.submit 才会装配成功）',
      !!d && d.loading === false && !d.denied, JSON.stringify({ denied: d && d.denied, loading: d && d.loading }))
    u('报名页装配（mode=new、只有本人）',
      !!d && d.mode === 'new' && (d.participants || []).length === 1,
      JSON.stringify({ mode: d && d.mode, parts: (d && d.participants || []).length }))
    const groups = (await page.$$('checkbox-group')) || []
    const keys = []
    for (const g of groups) keys.push(String((await g.attribute('data-key')) || ''))
    const wantKey = 'c:' + companionRef.id
    const ci = keys.indexOf(wantKey)
    u('本轮那位同行人候选行渲染，且 data-key 挂在 checkbox-group 上（上一轮修的那处）', ci !== -1,
      '期望 key=' + wantKey + '；group data-key 序列=' + JSON.stringify(keys))
    const okPick = ci === -1 ? false : await tapEl(await groups[ci].$('checkbox'))
    tap('点同行人候选的勾选框', okPick, 'tap checkbox @ group[' + ci + ']')
    await page.waitFor(1500)
    const d2 = await page.data()
    ue('勾选后同行人进入参与人列表（两位参与人）', (d2.participants || []).length === 2,
      JSON.stringify({ n: (d2.participants || []).length, keys: (d2.participants || []).map(p => p.key) }))
    // 授权勾选：本人+同行人的 dataUse，同行人还要 proxyAuthority（代报授权）
    const g2 = (await page.$$('checkbox-group')) || []
    const consent = []
    for (const g of g2) consent.push(String((await g.attribute('data-key')) || '') + '#' + String((await g.attribute('data-index')) || ''))
    const wantToCheck = []
    for (let i = 0; i < consent.length; i++) {
      const k = consent[i]
      if (k.indexOf('dataUse') === 0 || k.indexOf('proxyAuthority') === 0) wantToCheck.push(i)
    }
    u('授权勾选位齐全（dataUse×2 + proxyAuthority×1）', wantToCheck.length === 3,
      '勾选位序列=' + JSON.stringify(consent))
    for (const idx of wantToCheck) {
      const keyName = consent[idx].split('#')[0]
      const pi = Number(consent[idx].split('#')[1] || 0)
      const okBox = await tapEl(await g2[idx].$('checkbox'))
      tap('勾选第 ' + (pi + 1) + ' 位的「' + keyName + '」', okBox, 'tap checkbox @ group[' + idx + ']')
      const st = await page.data()
      ue('「' + keyName + '」落到第 ' + (pi + 1) + ' 位参与人状态', st.participants[pi].consent[keyName] === true,
        JSON.stringify({ pi, keyName, val: st.participants[pi].consent[keyName] }))
    }
    const submit = await byText(page, '提交报名')
    const okSubmit = await tapEl(submit)
    tap('点「提交报名」', okSubmit, 'tap 「提交报名」@ signup')
    await page.waitFor(4000)
    // 提交成功后页面跳走（本轮实测 page destroyed）——判定用回读，不用页面状态
    const subG = await settle(orgView, v => (v.rows || []).filter(r => r.status === 'pending').length === 2, 10)
    const v = subG.v
    const pend = (v.rows || []).filter(r => r.status === 'pending')
    const mineName = (await read({ kind: 'profile' })).data.view.profile.person.name
    // 期望值来自 fixture：本人那条 + 按 id 锁定的那位同行人，与页面上「碰巧」勾选到谁无关
    b('报名落库：两条 pending（本人 + ' + companionRef.name + '）',
      pend.length === 2 && pend.map(r => r.name).sort().join(',') === [mineName, companionRef.name].sort().join(','),
      JSON.stringify({ 等待次数: subG.waited, rows: (v.rows || []).map(r => r.name + '/' + r.status), expect: [mineName, companionRef.name] }))
    b('整组语义：两条报名挂在同一个报名组', new Set(pend.map(r => r.groupId)).size === 1,
      JSON.stringify({ groups: Array.from(new Set(pend.map(r => r.groupId))) }))
  }, uiGate('报名必须经真实勾选与提交'))

  // ============================================================
  // GP-06 审核：组织者真实勾选名单并确认
  // ============================================================
  node('GP-06', 'Review 报名审核')
  await L.block('GP-06 名单勾选与确认', 8, async () => {
    page = await open('/pages/activity/activity?id=' + AID)
    await probeChannel(page)
    const ws = await byText(page, '进入工作台')
    const okWs = await tapEl(ws)
    tap('从详情点「进入工作台」', okWs, 'tap 「进入工作台」@ activity（isOwner）')
    await page.waitFor(3000)
    const route = await currentRoute()
    ue('真实导航落到工作台', String(route) === 'pages/workspace/workspace', '当前页=' + route)
    page = await mp.currentPage()
    const segs = await queryAll(page, '.seg')
    u('工作台四个分区渲染', segs.length === 4, '.seg 命中 ' + segs.length)
    const okRoster = await tapEl(segs[1])
    tap('点「名单」分区', okRoster, 'tap .seg[1]')
    await page.waitFor(1500)
    const rp = await page.$('roster-panel')
    const rows = rp ? await queryAll(rp, 'person-row') : []
    u('名单面板渲染两条待审核', rows.length === 2, 'person-row ' + rows.length + ' 个')
    const boxes = rp ? await queryAll(rp, 'checkbox-group') : []
    const ids = []
    for (const g of boxes) ids.push(String((await g.attribute('data-id')) || ''))
    u('每行选择框是带 data-id 的 checkbox-group', boxes.length >= 2, 'checkbox-group ' + boxes.length + ' 个，data-id 序列=' + JSON.stringify(ids))
    const wantIds = ((await orgView()).rows || []).filter(r => r.status === 'pending').map(r => r.signupId)
    for (let i = 0; i < wantIds.length; i++) {
      const gi = ids.indexOf(wantIds[i])
      const okBox = gi === -1 ? false : await tapEl(await boxes[gi].$('checkbox'))
      tap('勾选待审核行 ' + (i + 1) + '（按 signupId 命中）', okBox, 'tap checkbox @ group[data-id=' + wantIds[i].slice(-6) + ']，面板位置=' + gi)
      await page.waitFor(900)
    }
    const rpd = await dataOf(rp)
    ue('勾选状态进入面板数据（selectedCount=2）', !!rpd && Number(rpd.selectedCount) === 2,
      JSON.stringify({ selectedCount: rpd && rpd.selectedCount, keys: Object.keys((rpd && rpd.selected) || {}).length }))
    const confirm = await byText(rp, '确认报名')
    const okConfirm = await tapEl(confirm)
    tap('点「确认报名」打开确认弹层', okConfirm, 'tap 「确认报名」@ roster-panel（onBatch 只开弹层，不直接下发）')
    await page.waitFor(1800)
    const rpOpen = await dataOf(await page.$('roster-panel'))
    ue('确认弹层打开（batch=confirm，标题带人数）', !!rpOpen && rpOpen.batch === 'confirm',
      JSON.stringify({ batch: rpOpen && rpOpen.batch, selectedCount: rpOpen && rpOpen.selectedCount }))
    const go = await byText(await page.$('roster-panel'), '确认仅处理这 ' + ((rpOpen && rpOpen.selectedCount) || 0) + ' 人')
    const okGo = await tapEl(go)
    tap('点「确认仅处理这 N 人」下发 signup.review', okGo, '命中：' + !!go)
    const rvG = await settle(orgView, x => x.counters.confirmed === 2 && x.counters.pending === 0, 10)
    const v = rvG.v
    // 十连跑里出现过一次「12 步 UI 全绿、审核却没落库」：当时面板上到底有没有红字没有被记下来，无法定案。
    // 补上这一次读数——按钮点着了但服务端没动，必须能看到面板当时的状态。
    const rpAfter = rvG.waited === -1 ? ((await dataOf(await page.$('roster-panel'))) || {}) : {}
    b('审核后 confirmed=2 且待审核归零', v.counters.confirmed === 2 && v.counters.pending === 0,
      JSON.stringify({ counters: v.counters, 等待次数: rvG.waited,
        面板当时: rvG.waited === -1 ? { error: rpAfter.error || '', busy: !!rpAfter.busy,
          selectedCount: rpAfter.selectedCount, batch: rpAfter.batch, rows: (rpAfter.rows || []).length } : '（落库成功，未取）' }))
  }, uiGate('审核要经名单勾选与按钮'))

  // ============================================================
  // GP-07 车辆组织：真实表单添加车辆（服务司机不踩 picker）+ 协作授权取证
  // ============================================================
  node('GP-07', 'Vehicle 车辆组织')
  await L.block('GP-07 添加车辆', 13, async () => {
    const segs = await queryAll(page, '.seg')
    const okT = await tapEl(segs[2])
    tap('点「分车」分区', okT, 'tap .seg[2]')
    // 面板是自取数据的：loading 未完就点「添加车辆」会点到一个还没装配好的控件（本轮实测偶发开不出弹层）
    const loaded = await settle(async () => dataOf(await page.$('transport-panel')), d => !!d && d.loading === false, 8)
    const tp = await page.$('transport-panel')
    const addBtn = await byText(tp, '添加车辆')
    const okAdd = await tapEl(addBtn)
    tap('点「添加车辆」', okAdd, 'tap 按文案命中「添加车辆」@ transport-panel（面板 loading=false，等待 ' + loaded.waited + ' 次）')
    const openedG = await settle(async () => dataOf(await page.$('transport-panel')), d => !!d && d.editorOpen === true, 8)
    const opened = openedG.v
    ue('车辆编辑弹层打开（editorOpen=true）', !!opened && opened.editorOpen === true,
      'editorOpen=' + (opened && opened.editorOpen) + '；等待 ' + openedG.waited + ' 次；vform 已在=' + !!(opened && opened.vform))
    // 「司机名单」初始为空（vform.drivers=[]）⇒ 必须像真实用户那样先点「添加司机」
    const addDriver = await byText(tp, '添加司机')
    const okAddDriver = await tapEl(addDriver)
    tap('点「添加司机」加一名服务司机', okAddDriver, 'tap 「添加司机」@ transport-panel（默认类型=服务司机，不需要 picker）')
    await page.waitFor(1200)
    const ins = await queryAll(tp, '.input')
    u('表单渲染出名称/车牌/核载/司机姓名/电话等输入位', ins.length >= 6, '.input ' + ins.length + ' 个')
    const okLabel = await inputEl(ins[0], VEHICLE.label)
    tap('填写车辆名称', okLabel, 'input .input[0] data-key=label')
    const okPlate = await inputEl(ins[1], VEHICLE.plate)
    tap('填写车牌', okPlate, 'input .input[1] data-key=plate')
    const okLegal = await inputEl(ins[2], String(VEHICLE.legalCapacity))
    tap('填写核载人数', okLegal, 'input .input[2] type=number data-key=legal（3 核载 − 1 司机 = 2 乘客位）')
    const okBlocked = await inputEl(ins[3], String(VEHICLE.blockedSeats))
    tap('填写预留/禁用座位', okBlocked, 'input .input[3] type=number data-key=blocked')
    const okDriver = await inputEl(ins[4], VEHICLE.driverName.trim())
    tap('填写服务司机姓名', okDriver, 'input .input[4] data-key=name（司机类型默认「服务司机」，不需要 picker）')
    const okPhone = await inputEl(ins[5], VEHICLE.driverPhone)
    tap('填写司机联系电话', okPhone, 'input .input[5] type=number data-key=phone')
    const st = await dataOf(tp)
    ue('各字段落到 vform 状态', st.vform.label === VEHICLE.label && st.vform.plate === VEHICLE.plate
      && String(st.vform.legal) === String(VEHICLE.legalCapacity) && st.vform.drivers[0].name === VEHICLE.driverName.trim(),
      JSON.stringify({ label: st.vform.label, legal: st.vform.legal, drivers: (st.vform.drivers || []).length, driver: st.vform.drivers[0] && st.vform.drivers[0].name }))
    // 上车点：无条件真实点一次（用户的做法），再断言数据是否真的接住。
    // 同时读「渲染层的 checked」与「vform.pickupIds」：二者背离 = 产品缺陷，不是我没点着。
    const pre = await dataOf(await page.$('transport-panel'))
    const pkGroup = (await tp.$$('checkbox-group'))[0] || null
    const pkBox = pkGroup ? (await pkGroup.$$('checkbox'))[0] : null
    const renderedChecked = pkBox ? await pkBox.property('checked') : null
    const okPk = await tapEl(pkBox)
    tap('点「覆盖的上车点」第 1 项（真实勾选）', okPk, 'tap checkbox-group>checkbox[0]@ 车辆编辑弹层')
    await page.waitFor(1500)
    const stPk = await dataOf(await page.$('transport-panel'))
    const idsNow = (stPk && stPk.vform && stPk.vform.pickupIds) || []
    u('勾选落到 vform.pickupIds（含 pk-1）', idsNow.indexOf('pk-1') !== -1,
      JSON.stringify({ renderedChecked, beforeIds: (pre && pre.vform && pre.vform.pickupIds) || [], afterIds: idsNow })
        + '——Phase 4 已把选中态改为 JS 预计算（wxml 绑不了 indexOf）；若此处仍红说明回退或回归')
    // 明确座号：change 载体已改为 checkbox-group（与上车点同一模式；裸 <checkbox bindchange> 真机永不触发）
    const boxGroups = (await tp.$$('checkbox-group')) || []
    const seatGroup = boxGroups[1] || null
    const seatToggle = seatGroup ? (await seatGroup.$$('checkbox'))[0] : null
    const okSeat = await tapEl(seatToggle)
    tap('勾选「使用明确座号」', okSeat, 'tap 第 2 个 checkbox-group 的 checkbox@ 「使用明确座号」（组数=' + boxGroups.length + '）')
    await page.waitFor(1500)
    const st2 = await dataOf(tp)
    seatViaUi = !!(st2 && st2.vform && st2.vform.seatLabelsOn === true)
    u('「使用明确座号」勾选生效（checkbox-group 载体的 change 可达）', seatViaUi,
      JSON.stringify({ seatLabelsOn: st2 && st2.vform && st2.vform.seatLabelsOn, groups: boxGroups.length, autoText: st2 && st2.vform && st2.vform.seatLabelsText }))
    if (seatViaUi) {
      const seatInput = (await tp.$$('[data-key="seatLabelsText"]'))[0] || null
      const okSeats = await inputEl(seatInput, SEAT_LABELS.join(','))
      tap('填写乘客座号 ' + SEAT_LABELS.join(','), okSeats, 'input [data-key=seatLabelsText]')
    }
    const save = await byText(tp, '保存车辆安排')
    const okSave = await tapEl(save)
    tap('点「保存车辆安排」', okSave, 'tap 「保存车辆安排」')
    await page.waitFor(3500)
    const saved = await dataOf(await page.$('transport-panel'))
    u('保存后面板未报错（有错说明被前端校验挡下，而不是没点着）',
      !!saved && !saved.error, JSON.stringify({ error: saved && saved.error, busy: saved && saved.busy }))
    // 无论保存成没成，真实用户都会关掉弹层再继续。关掉它有两个把手：遮罩与右上角 X。
    // 它们都在 <overlay> 组件自己的模板里（不在 slot 内），能不能查到本身就是要取证的事。
    const ov = tp ? await tp.$('overlay') : null
    const mask = (await queryAll(tp, '.overlay-mask'))[0] || (ov ? await ov.$('.overlay-mask') : null)
    const xBtn = (await queryAll(tp, '.icon-button'))[0] || (ov ? await ov.$('.icon-button') : null)
    const closer = mask || xBtn
    const okClose = await tapEl(closer)
    if (!closer) {
      unv('点把手关闭车辆编辑弹层', '遮罩与右上角 X 都在 <overlay> 组件内部模板：tp.$$(".overlay-mask")/' +
        'tp.$$(".icon-button")/ov.$() 三种查法实测全部落空（元素通道本身健康，同页 .button 查得到）⇒ 通道看不见组件内部，不能据此说产品坏')
    } else {
      tap('点把手关闭车辆编辑弹层（' + (mask ? '遮罩' : '右上角 X') + '）', okClose,
        'tap ' + (mask ? '.overlay-mask' : '.icon-button') + '（overlay 句柄=' + !!ov + '）')
      await page.waitFor(1500)
      const closed = await dataOf(await page.$('transport-panel'))
      ue('弹层已关闭（editorOpen=false，正文重新可点）', !!closed && closed.editorOpen === false,
        'editorOpen=' + (closed && closed.editorOpen))
    }
    const tv = await transport()
    const vs = tv.vehicles || []
    vehicleId = vs[0] ? vs[0].id : ''
    b('readTransport 回读到 1 号车：1 名服务司机、乘客位 2、座号等于 fixture',
      vs.length === 1 && vs[0].label === VEHICLE.label && vs[0].drivers.length === 1 && vs[0].drivers[0].kind === 'service'
      && (vs[0].seatLabels || []).join(',') === SEAT_LABELS.join(','),
      JSON.stringify({ n: vs.length, v: vs[0] && { label: vs[0].label, drivers: vs[0].drivers.length, seatLabels: vs[0].seatLabels } }))
  }, uiGate('车辆表单要经真实输入与保存'))

  if (!vehicleId) {
    // 真实表单没落成车辆 ⇒ 后续座位/上车节点失去前提。用业务入口补一次，并显式记 UI 未验证。
    await L.block('GP-07 车辆兜底（业务入口）', 2, async () => {
      const v = await orgView()
      const c = await dispatch({ type: 'vehicle.save', activityId: AID, vehicleId: null, input: {
        label: VEHICLE.label, plate: VEHICLE.plate, legalCapacity: VEHICLE.legalCapacity, blockedSeats: VEHICLE.blockedSeats,
        drivers: [{ kind: 'service', name: VEHICLE.driverName.trim(), phone: VEHICLE.driverPhone, userId: null }],
        seatLabels: SEAT_LABELS, pickupPointIds: ['pk-1'] } }, v.revision)
      b('环境准备：vehicle.save 补一辆车（不充当 UI 证据）', c.ok === true, JSON.stringify(c.error || c.err || 'ok').slice(0, 200))
      const tv = await transport()
      vehicleId = ((tv.vehicles || [])[0] || {}).id || ''
      b('回读车辆 id', !!vehicleId, JSON.stringify({ vehicleId }))
    }, () => ({ ok: true }))
    unv('「车辆由组织者在分车面板真实添加」', '上一步 UI 表单未产出车辆（见 GP-07 失败明细），改由业务命令补齐')
  }

  await L.block('GP-07 车辆联络授权（真实 UI 可行性取证）', 3, async () => {
    const segs = await queryAll(page, '.seg')
    await tapEl(segs[1])
    await page.waitFor(1500)
    const rp = await page.$('roster-panel')
    const grant = await byText(rp, '协作授权')
    const okG = await tapEl(grant)
    tap('在名单面板点「协作授权」', okG, 'tap 「协作授权」@ roster-panel')
    await page.waitFor(1800)
    const rpData = await dataOf(rp)
    const roleOptions = (rpData && rpData.roleOptions) || null
    const scopeOptions = (rpData && rpData.scopeOptions) || null
    u('协作授权弹层的角色 picker 有数据（车辆联络能否经 UI 授予）',
      !!roleOptions && roleOptions.length > 0,
      'WXML:161/181 绑 {{roleOptions}}/{{scopeOptions}}，组件 data 实测 = ' + JSON.stringify({ roleOptions, scopeOptions })
      + '（Phase 4 已把 ROLE_OPTIONS/SCOPE_OPTIONS 挂进 data；为 null 即回归）')
    let grantErr = 'ok'
    const v = await orgView()
    const prof = await read({ kind: 'profile' })
    const me = prof.data.view.profile
    const m = await dispatch({ type: 'membership.save', activityId: AID, membership: {
      id: 'gp-veh-contact-' + AID.slice(-6), role: 'vehicle_contact', activityId: AID, userId: me.id,
      vehicleId, expiresAt: '2027-03-15T23:59:59+08:00' } }, v.revision)
    grantErr = JSON.stringify(m.error || m.err || 'ok').slice(0, 200)
    b('环境准备：membership.save 自授车辆联络（只为让车长页可进，不充当 UI 证据）', m.ok === true, grantErr)
    unv('「组织者在名单面板经授权弹层授予车辆联络」的 tap-through',
      '角色/范围/授权截止时间是原生 <picker>：tap 后弹层不在可查询树（探针实测 .wx-picker/picker-view 全 0 命中、截图无弹层）⇒ 选角色这步无法自动化；'
      + 'picker 数据源已修复（上一条 UI 断言），保存链契约由 A 层 4b 钉住，上车走车长页真实点击（GP-10）')
  }, uiGate('协作授权弹层需要元素通道'))

  // ============================================================
  // GP-08 座位分配：真实预览自动分车并提交
  // ============================================================
  node('GP-08', 'Seat 座位分配')
  let sharedSignupId = ''
  await L.block('GP-08 前置：全部已确认乘客改为按上车点集合', 3, async () => {
    let v = await orgView()
    const conf = (v.rows || []).filter(r => r.status === 'confirmed')
    if (!conf.length) { b('存在已确认乘客可改为按上车点集合', false, JSON.stringify({ rows: (v.rows || []).map(r => r.name + '/' + r.status) })); return }
    let changed = 0
    for (const row of conf) {
      v = await orgView()
      const form = await cloud('trailApi', 'readForm', { activityId: AID, signupId: row.signupId, purpose: '自动化读取报名资料以改动出行方式' })
      const participant = form && form.ok && form.data.ok !== false && form.data.value.input.participant
      const e = await dispatch({ type: 'signup.edit', activityId: AID, signupId: row.signupId, participant, trip: { mode: 'shared', pickupPointId: 'pk-1' }, purpose: '自动化：改为按上车点集合（出行方式是原生 picker，驱不动）' }, v.revision)
      if (e && e.ok) changed++
    }
    b('环境准备：' + conf.length + ' 位乘客全部改为 shared/pk-1（业务入口，不充当 UI 证据）',
      changed === conf.length, JSON.stringify({ changed, of: conf.length }))
    sharedSignupId = (conf.find(r => r.name === companionRef.name) || conf[0]).signupId
    const v2 = await orgView()
    b('回读：两位乘客都挂在集合上车点（keepTogether 组不会因混合出行方式被整体拒分）',
      (v2.rows || []).filter(r => r.status === 'confirmed' && r.pickup === '成都茶馆集合点').length === conf.length,
      JSON.stringify((v2.rows || []).map(r => ({ n: r.name, pickup: r.pickup }))))
    unv('「乘客在报名页选『按上车点集合』」这条真实路径', '报名页出行方式是原生 <picker>（signup 的 onPartTrip），自动化通道驱不动 ⇒ UI 提交的报名只能落在「自行前往」；本节点用业务命令改出行方式，只记 BUSINESS')
  }, () => ({ ok: true }))

  await L.block('GP-08 预览并提交分车', 6, async () => {
    page = await open('/pages/workspace/workspace?id=' + AID)
    await probeChannel(page)
    const segs = await queryAll(page, '.seg')
    const okS = await tapEl(segs[2])
    tap('重进工作台后点「分车」分区（离开再回来也是真实用户清掉弹层的做法）', okS, 'tap .seg[2]')
    await page.waitFor(1500)
    const tp0 = await page.$('transport-panel')
    const st0 = await dataOf(tp0)
    u('分车面板无残留弹层（三个弹层位都是关的）',
      !!st0 && st0.editorOpen === false && st0.planOpen === false && st0.assignOpen === false,
      JSON.stringify({ editorOpen: st0 && st0.editorOpen, planOpen: st0 && st0.planOpen, assignOpen: st0 && st0.assignOpen }))
    const tp = await page.$('transport-panel')
    const preview = await byText(tp, '预览自动分车方案')
    const okP = await tapEl(preview)
    tap('点「预览自动分车方案」', okP, 'tap 「预览自动分车方案」@ transport-panel')
    // 预览是一次云调用，面板要等结果回来才排差异行；固定等待会偶发读到 changed=0（本轮实测）
    const planG = await settle(async () => dataOf(await page.$('transport-panel')), d => !!d && (d.planChanged || []).length === 2, 10)
    const planBefore = planG.v
    const planRows = planBefore ? (planBefore.planChanged || []).length : 0
    ue('预览产出的方案含 2 条新增（面板 planChanged 读数）', planRows === 2,
      JSON.stringify({ changed: planRows, counts: planBefore && planBefore.planCounts, 等待次数: planG.waited }))
    const commit = await byText(tp, '明确确认并提交此方案')
    const okC = await tapEl(commit)
    tap('点「明确确认并提交此方案」', okC, '命中：' + (commit ? '是' : '否') + '；面板按钮=' + JSON.stringify(await textsOf(tp, '.button')).slice(0, 200))
    await page.waitFor(3000)
    const tv = await transport()
    const asg = tv.assignments || []
    const labels = asg.map(a => a.seatLabel).sort()
    // 独立推导：车辆乘客位只有 SEAT_LABELS 两个；符合分配条件的只有 1 位 shared 乘客
    // ⇒ 必然拿自然序最低的那个（allocation.js:84-90 只发最低空座），而不是读回结果当期望。
    b('两位乘客都被分到 1号车，座号集合恰好等于 fixture 的 ' + SEAT_LABELS.join('/'),
      asg.length === 2 && asg.every(a => a.vehicleId === vehicleId) && labels.join(',') === SEAT_LABELS.slice().sort().join(','),
      JSON.stringify({ asg: asg.map(a => ({ s: String(a.signupId).slice(-4), seat: a.seatLabel })), expect: SEAT_LABELS }))
    b('整组同车：两条安排挂同一辆车（keepTogether 语义）',
      new Set(asg.map(a => a.vehicleId)).size === 1 && asg.length === 2, JSON.stringify({ cars: Array.from(new Set(asg.map(a => a.vehicleId))) }))
    // 提交方案后面板会重读并重排座位格；立刻读渲染会把「还没重排完」误判成「渲染没跟上」
    const seatG = await settle(async () => {
      const list = tp ? await queryAll(tp, '.seat') : []
      let n = 0
      for (const s of list) if (String((await s.attribute('class')) || '').indexOf('occupied') !== -1) n++
      return { seats: list.length, occupied: n }
    }, r => r.occupied === 2, 8)
    ue('座位示意把两个座位都显示为已占', seatG.v.occupied === 2,
      JSON.stringify({ seats: seatG.v.seats, occupied: seatG.v.occupied, 等待次数: seatG.waited }))
  }, uiGate('分车预览与提交要经真实按钮'))

  // ============================================================
  // GP-09 集合与签到
  // ============================================================
  node('GP-09', 'Check-in 集合与签到')
  await L.block('GP-09 推进集合', 4, async () => {
    page = await open('/pages/workspace/workspace?id=' + AID)
    await probeChannel(page)
    const st = await phaseAdvance(PHASE_BTN.published, '按期集合，全队到齐')
    const gG = await settle(orgView, x => x.activity.phase === 'gathering', 10)
    const v = gG.v
    b('phase=gathering（回读阶段）', v.activity.phase === 'gathering',
      '用户可见红字=' + JSON.stringify({ error: st.error, sheetOpen: st.sheetOpen }) + '；回读 ' + JSON.stringify({ phase: v.activity.phase, 等待次数: gG.waited }))
  }, uiGate('阶段推进要经真实按钮与原因输入'))

  await L.block('GP-09 面板随阶段自行重读（BUG-1 修复验证）', 3, async () => {
    const segs = await queryAll(page, '.seg')
    const okF = await tapEl(segs[3])
    tap('阶段推进后直接点「现场」分区（不退出重进）', okF, 'tap .seg[3]@ workspace')
    await page.waitFor(1500)
    const fp = await page.$('field-panel')
    const got = await waitPanelPhase(fp, 'gathering')
    const fpd = got.d
    u('已挂载的现场面板把 phase 重读到 gathering',
      !!fpd && fpd.phase === 'gathering',
      JSON.stringify({ panelPhase: fpd && fpd.phase, panelSyncKey: fpd && fpd.syncKey, 等待次数: got.waited, cloudPhase: 'gathering', syncKey: ((await page.data()) || {}).syncKey }))
    const rowsNow = (fpd && fpd.rows) || []
    ue('重读后的名单是新的（两位已确认参与者都在，且标着未签到）',
      rowsNow.length === 2 && rowsNow.every(r => String(r.subtitle).indexOf('未签到') !== -1),
      JSON.stringify(rowsNow.map(r => ({ n: r.name, s: r.subtitle }))))
    const btns = fp ? await queryAll(fp, '.button.text') : []
    const okOpen = await tapEl(btns[0])
    tap('点开第一行的「现场记录」', okOpen, 'tap .button.text[0]')
    await page.waitFor(1500)
    const fpd2 = fp ? await dataOf(fp) : null
    ue('弹层动作表按新阶段装配（不再全空）',
      !!(fpd2 && (fpd2.actions || []).some(a => a.label === '确认现场签到')),
      JSON.stringify({ sheetOpen: fpd2 && fpd2.sheetOpen, actions: (fpd2 && fpd2.actions || []).map(a => a.label) }))
  }, uiGate('现场面板需要元素通道'))

  await L.block('GP-09 逐人真实签到（用户级补救＝退出重进）', 15, async () => {
    page = await open('/pages/workspace/workspace?id=' + AID)
    await probeChannel(page)
    const segs = await queryAll(page, '.seg')
    const okF = await tapEl(segs[3])
    tap('重进后点「现场」分区', okF, 'tap .seg[3]')
    await page.waitFor(1500)
    const fp = await page.$('field-panel')
    const rows = fp ? await queryAll(fp, 'person-row') : []
    u('现场区渲染两位已确认参与者', rows.length === 2, 'person-row ' + rows.length)
    const fpRows = (await dataOf(fp) || {}).rows || []
    const needBoardIdx = fpRows.findIndex(r => r.signupId === sharedSignupId)
    u('面板行序里能定位到「需要上车的那位乘客」', needBoardIdx >= 0, JSON.stringify({ names: fpRows.map(r => r.name), needBoardIdx }))
    // 逐人签到：field.js:85 的上车前置是「本人已签到」，只签一位会让另一位永远上不了车
    const confNow = ((await orgView()).rows || []).filter(r => r.status === 'confirmed')
    for (let round = 0; round < confNow.length + 1; round++) {
      const vNow = await orgView()
      const need = (vNow.rows || []).filter(r => r.status === 'confirmed' && r.checkedIn !== true)
      if (!need.length) break
      const fpNow = await page.$('field-panel')
      const rowsNow = ((await dataOf(fpNow)) || {}).rows || []
      const idx = rowsNow.findIndex(r => r.signupId === need[0].signupId)
      const btnsNow = fpNow ? await queryAll(fpNow, '.button.text') : []
      const okOpen = await tapEl(btnsNow[idx])
      tap('点开「' + need[0].name + '」的现场记录', okOpen, 'tap .button.text[' + idx + ']@ field-panel')
      await page.waitFor(1800)
      const fpd = await dataOf(fpNow)
      ue('弹层动作表含「确认现场签到」（' + need[0].name + '）',
        !!(fpd && fpd.sheetOpen === true && (fpd.actions || []).some(x => x.label === '确认现场签到')),
        JSON.stringify({ sheetOpen: fpd && fpd.sheetOpen, actions: (fpd && fpd.actions || []).map(x => x.label) }))
      const areas = await queryAll(fpNow, '.textarea')
      const NOTE = '黄金路径核实：' + need[0].name + ' 集合点当面确认'
      const okNote = await inputEl(areas[areas.length - 1], NOTE)
      tap('为「' + need[0].name + '」填写核实依据', okNote, 'input .textarea@ field-panel，命中 ' + areas.length + ' 个')
      const st = await dataOf(fpNow)
      ue('核实依据落到组件状态（data.note 等于所填）', !!st && st.note === NOTE, JSON.stringify({ note: st && st.note }))
      const cBtn = await byText(fpNow, '确认现场签到')
      const okCheckin = await tapEl(cBtn)
      tap('点「确认现场签到」（' + need[0].name + '）', okCheckin, '命中：' + !!cBtn + '；面板按钮=' + JSON.stringify(await textsOf(fpNow, '.button')).slice(0, 160))
      // 逐人循环都必须等「这一个」落库再算下一个缺口，否则会重复点同一个人（普查 run 8 的上车段实测）
      await settle(orgView, x => (x.rows || []).some(r => r.signupId === need[0].signupId && r.checkedIn === true), 8)
    }
    const ciG = await settle(orgView, v => (v.rows || []).filter(r => r.status === 'confirmed').length === 2
      && (v.rows || []).filter(r => r.status === 'confirmed').every(r => r.checkedIn === true), 10)
    const v = ciG.v
    const conf = (v.rows || []).filter(r => r.status === 'confirmed')
    b('两位乘客都 checkedIn=true（签到是上车与出发的前置，全部经真实弹层点击）',
      conf.length === 2 && conf.every(r => r.checkedIn === true),
      JSON.stringify({ people: conf.map(r => ({ n: r.name, c: r.checkedIn })), 等待次数: ciG.waited }))
    b('签到对象包含那位同行人（后续上车与出发取证的主体一致）',
      conf.some(r => r.signupId === sharedSignupId && r.checkedIn === true), JSON.stringify({ sharedSignupId }))
  }, uiGate('签到必须经真实弹层控件'))

  // ============================================================
  // GP-10 出发：先取证死按钮，再走真正的上车入口，最后核实出发
  // ============================================================
  node('GP-10', 'Departure 出发')
  await L.block('GP-10 未上车者不给死按钮（修复验证）', 3, async () => {
    page = await open('/pages/workspace/workspace?id=' + AID)
    await probeChannel(page)
    const segs0 = await queryAll(page, '.seg')
    const okTab = await tapEl(segs0[3])
    tap('点「现场」分区', okTab, 'tap .seg[3]@ workspace')
    await page.waitFor(1500)
    const fp = await page.$('field-panel')
    const fpRows0 = ((await dataOf(fp)) || {}).rows || []
    const idx0 = Math.max(0, fpRows0.findIndex(r => r.signupId === sharedSignupId))
    const btns = fp ? await queryAll(fp, '.button.text') : []
    const okOpen = await tapEl(btns[idx0])
    tap('点开该乘客（需上车者）的「现场记录」', okOpen, 'tap .button.text[' + idx0 + ']')
    await page.waitFor(1800)
    const fpd = (await dataOf(fp)) || {}
    u('面板不再对「未上车的拼车乘客」提供「核实已随队出发」',
      (fpd.actions || []).every(a => a.outcome !== 'joined'),
      JSON.stringify({ actions: (fpd.actions || []).map(a => a.label), hint: fpd.sheetHint }))
    ue('缺的事实被说清楚并把用户指向车长任务页',
      String(fpd.sheetHint || '').indexOf('车长任务页') !== -1, JSON.stringify({ hint: fpd.sheetHint }))
    const v = await orgView()
    const shared = (v.rows || []).find(r => r.signupId === sharedSignupId)
    b('没有可点的死按钮 ⇒ 也没有误下发的出发记录（departure 仍 unknown，零副作用）',
      !!shared && shared.departure === 'unknown', JSON.stringify({ name: shared && shared.name, departure: shared && shared.departure }))
  }, uiGate('出发入口可用性需要弹层'))

  await L.block('GP-10 车长页真实上车', 4, async () => {
    page = await open('/pages/vehicle/vehicle?id=' + AID)
    await probeChannel(page)
    const vd = await page.data()
    u('车长任务页对本人可进（车辆联络授权生效）',
      !!vd && vd.loading === false && !vd.denied, JSON.stringify({ loading: vd && vd.loading, denied: vd && vd.denied }))
    // 每次点完都要重新查一遍：上车一条落库后车长页会重渲染，旧句柄点下去是「成功但没作用」的空点击。
    // 更要等「刚点的那一个人的事实真的落库」再算下一个缺口——否则回读还是旧的，会把同一个人点两次
    // 而第二个人永远没点（本轮普查 run 8 实测：boarded 只有 1 人，active 因此整段推不动）。
    const wantBoard = (((await orgView()).rows) || []).filter(r => r.status === 'confirmed').map(r => r.signupId)
    for (let round = 0; round < 6; round++) {
      const vNow = await orgView()
      const done = new Set((vNow.rows || []).filter(r => r.outboundBoarded === true).map(r => r.signupId))
      const missing = (vNow.rows || []).filter(r => r.status === 'confirmed' && !done.has(r.signupId))
      if (!missing.length) break
      const btns = (await page.$$('.button.secondary')) || []
      let hit = null
      let hitName = ''
      let hitId = ''
      for (const el of btns) {
        if (String((await el.text()) || '').trim() !== '确认上车') continue
        const did = String((await el.attribute('data-id')) || '')
        if (did !== missing[0].signupId) continue
        hit = el
        hitName = missing[0].name
        hitId = did
        break
      }
      if (!hit) { await page.waitFor(1500); continue }
      await waitIdle()   // 车页「确认上车」也是 busy 条件绑定，busy 期间点下去没有 handler
      const ok = await tapEl(hit)
      tap('点「确认上车」（' + hitName + '）', ok, '按 data-id 点名：' + (hitName || '') + '/' + hitId.slice(-6))
      // 等这一位的事实落库，再进入下一轮算缺口
      await settle(orgView, x => (x.rows || []).some(r => r.signupId === hitId && r.outboundBoarded === true), 8)
    }
    const brdG = await settle(orgView, x => (x.rows || []).filter(r => r.status === 'confirmed' && r.outboundBoarded === true).length === 2, 10)
    const v = brdG.v
    const boarded = (v.rows || []).filter(r => r.status === 'confirmed' && r.outboundBoarded === true)
    b('两位乘客去程上车落库（outboundBoarded=true，经车长页真实点击「确认上车」）',
      boarded.length === 2, JSON.stringify({ boarded: boarded.map(r => r.name), 等待次数: brdG.waited, rows: (v.rows || []).map(r => r.name + ':' + r.outboundBoarded) }))
    b('上车对象包含那位同行人（后续出发核实的主体一致）',
      boarded.some(r => r.signupId === sharedSignupId), JSON.stringify({ sharedSignupId }))
  }, uiGate('上车必须在车长页真实点击'))

  await L.block('GP-10 出发核实与推进同行', 4, async () => {
    page = await open('/pages/workspace/workspace?id=' + AID)
    await probeChannel(page)
    const segs = await queryAll(page, '.seg')
    await tapEl(segs[3])
    await page.waitFor(1500)
    // 与到家核实同构：按 signupId 点名待核实的人，落库后面板重排也不会重复点同一行
    for (let round = 0; round < 4; round++) {
      const vNow = await orgView()
      const need = (vNow.rows || []).filter(r => r.status === 'confirmed' && r.departure !== 'joined')
      if (!need.length) break
      const fpNow = await page.$('field-panel')
      const rowsNow = ((await dataOf(fpNow)) || {}).rows || []
      const idx = rowsNow.findIndex(r => r.signupId === need[0].signupId)
      const btns = fpNow ? await queryAll(fpNow, '.button.text') : []
      const okOpen = await tapEl(btns[idx])
      tap('点开「' + need[0].name + '」的现场记录（待核实出发）', okOpen,
        'tap .button.text[' + idx + ']，本轮待办 ' + need.length + ' 人')
      await page.waitFor(1800)
      const dep = await byText(fpNow, '核实已随队出发')
      const okDep = await tapEl(dep)
      tap('点「核实已随队出发」（' + need[0].name + '）', okDep, '命中：' + (dep ? '是' : '否'))
      await settle(orgView, x => (x.rows || []).some(r => r.signupId === need[0].signupId && r.departure === 'joined'), 8)
    }
    const depG = await settle(orgView, v => (v.rows || []).filter(r => r.status === 'confirmed').length === 2
      && (v.rows || []).filter(r => r.status === 'confirmed').every(r => r.departure === 'joined'), 10)
    const conf = (depG.v.rows || []).filter(r => r.status === 'confirmed')
    b('两人 departure=joined（签到 + 去程上车齐备后服务端才放行）',
      conf.length === 2 && conf.every(r => r.departure === 'joined'),
      JSON.stringify({ people: conf.map(r => ({ n: r.name, d: r.departure })), 等待次数: depG.waited }))
    const st = await phaseAdvance(PHASE_BTN.gathering, '全员到齐发车')
    const actG = await settle(orgView, x => x.activity.phase === 'active', 10)
    const v2 = actG.v
    b('gathering→active 成功（出发核实硬门通过）', v2.activity.phase === 'active',
      '用户可见红字=' + JSON.stringify({ error: st.error, sheetOpen: st.sheetOpen, triedTwice: st.triedTwice })
      + '；回读 ' + JSON.stringify({ phase: v2.activity.phase, 等待次数: actG.waited }))
  }, uiGate('出发核实需要弹层'))

  // ============================================================
  // GP-11 到达：车长发车与完成本程；路线节点受原生 picker 限制
  // ============================================================
  node('GP-11', 'Arrival 到达')
  await L.block('GP-11 车长发车与完成本程', 4, async () => {
    page = await open('/pages/vehicle/vehicle?id=' + AID)
    await probeChannel(page)
    const depart = await byText(page, '确认本程发车')
    const okDepart = await tapEl(depart)
    tap('点「确认本程发车」', okDepart, 'tap 「确认本程发车」@ vehicle')
    // 「完成本程行驶」只有在车长页把发车事实读回来之后才是可用按钮；读早了就是点了个 disabled
    const depG = await settle(transport, t => (t.vehicles || [])[0] && (t.vehicles || [])[0].legs.outbound.departed, 10)
    let tv = depG.v
    let vs = tv.vehicles || []
    b('去程已发车（vehicle.depart 落库，发车证据由服务端覆写）',
      vs.length === 1 && !!vs[0].legs.outbound.departed,
      JSON.stringify({ departed: vs[0] && vs[0].legs.outbound.departed, 等待次数: depG.waited }))
    // 车页的两个按钮是条件绑定的：`完成本程行驶` 只在 busy=false 且 departed=true 时才真的挂了 handler
    // （vehicle.wxml:43）。云端回读到了不代表页面已经重渲染，抢点就是点了个空按钮（本轮 run 4 实测）。
    const legG = await settle(async () => page.data(), d => !!d && d.busy === false && d.departed === true, 12)
    const completeBtn = await byText(page, '完成本程行驶')
    const okComplete = await tapEl(completeBtn)
    tap('点「完成本程行驶」', okComplete, 'tap 「完成本程行驶」@ vehicle（页面 busy=false/departed=true 等待 ' + legG.waited + ' 次）')
    const compG = await settle(transport, t => (t.vehicles || [])[0] && (t.vehicles || [])[0].legs.outbound.completed, 10)
    // 没落地就把页面当时的红字读出来：车页的两个动作都走 dispatchAndSync，CONFLICT 时产品只重读页面不代重发，
    // 真实用户的下一步就是「照提示再点一次」——两次尝试都单独记账。
    let legErr = ''
    let retried = false
    if (compG.waited === -1) {
      const pd = (await page.data()) || {}
      legErr = String(pd.error || '')
      if (legErr) {
        u('第 1 次「完成本程行驶」被页面红字拒住（' + legErr.slice(0, 40) + '）', legErr.length > 0,
          JSON.stringify({ error: legErr, busy: !!pd.busy, departed: !!pd.departed }))
        await waitIdle()
        const retry = await byText(page, '完成本程行驶')
        const okRetry = await tapEl(retry)
        tap('按提示再点一次「完成本程行驶」', okRetry, 'tap 「完成本程行驶」（第 2 次）；红字=' + legErr)
        retried = true
        await settle(transport, t => (t.vehicles || [])[0] && (t.vehicles || [])[0].legs.outbound.completed, 10)
      }
    }
    const compNow = await transport()
    vs = compNow.vehicles || []
    b('去程行驶完成（到达的运力事实）', !!vs[0] && !!vs[0].legs.outbound.completed,
      JSON.stringify({ completed: vs[0] && vs[0].legs.outbound.completed, 等待次数: compG.waited,
        页面红字: legErr, 再点一次: retried }))
    // 路线节点确认：动作按钮在，但选点是原生 picker ⇒ 只能记未验证（不做后端代发冒充 UI）
    const wsPage = await open('/pages/workspace/workspace?id=' + AID)
    await probeChannel(wsPage)
    page = wsPage
    const segs = await queryAll(page, '.seg')
    await tapEl(segs[3])
    await page.waitFor(1500)
    const fp = await page.$('field-panel')
    const rowBtns = fp ? await queryAll(fp, '.button.text') : []
    await tapEl(rowBtns[0])
    await page.waitFor(1800)
    const nodeBtn = await byText(fp, '确认到达此节点')
    u('现场弹层提供「确认到达此节点」按钮', !!nodeBtn, '命中：' + !!nodeBtn)
    unv('「参与者抵达某条路线节点」经 UI 确认', '选点是原生 <picker range=pointLabels>，自动化通道驱不动（同 GP-01 结论）；attendance.node 只有域层与 A 层证据，本轮不代发冒充 UI')
    page = await open('/pages/vehicle/vehicle?id=' + AID)
  }, uiGate('到达段需要车长页与弹层控件'))

  // ============================================================
  // GP-12 回家：真实到家核实
  // ============================================================
  node('GP-12', 'Home 安全到家')
  await L.block('GP-12 返程收尾与到家', 6, async () => {
    page = await open('/pages/workspace/workspace?id=' + AID)
    await probeChannel(page)
    const st = await phaseAdvance(PHASE_BTN.active, '全队返程，逐人确认到家')
    const clG = await settle(orgView, x => x.activity.phase === 'closing', 10)
    const v = clG.v
    b('phase=closing', v.activity.phase === 'closing',
      '用户可见红字=' + JSON.stringify({ error: st.error, sheetOpen: st.sheetOpen, triedTwice: st.triedTwice })
      + '；回读 ' + JSON.stringify({ phase: v.activity.phase, 等待次数: clG.waited }))
    // BUG-1 修复的第二处验证：阶段刚变 closing，常驻面板必须自己跟上，否则「核实安全到家」这个按钮根本不会出现。
    // 这里不再用「退出重进」绕过——绕过去就等于没测到失效机制。
    const segs = await queryAll(page, '.seg')
    const okF = await tapEl(segs[3])
    tap('推进 closing 后直接点「现场」分区（不退出重进）', okF, 'tap .seg[3]@ workspace')
    await page.waitFor(1500)
    const staleFp = await page.$('field-panel')
    const gotClose = await waitPanelPhase(staleFp, 'closing')
    const staleData = gotClose.d
    u('面板 phase 已随 syncKey 重读到 closing',
      !!staleData && staleData.phase === 'closing',
      JSON.stringify({ panelPhase: staleData && staleData.phase, 等待次数: gotClose.waited, cloudPhase: 'closing' }))
    const fp = await page.$('field-panel')
    // 到家核实逐人做，按 signupId 点名（不是按数组下标）：第一条落库后面板会重读重排，
    // 用下标点第二行会点到同一个已办的人，第二个人就永远没被核实（本轮实测过一次）。
    for (let round = 0; round < 4; round++) {
      const vNow = await orgView()
      const need = (vNow.rows || []).filter(r => r.status === 'confirmed' && r.home !== true)
      if (!need.length) break
      const fpNow = await page.$('field-panel')
      const rowsNow = ((await dataOf(fpNow)) || {}).rows || []
      const idx = rowsNow.findIndex(r => r.signupId === need[0].signupId)
      const btns = fpNow ? await queryAll(fpNow, '.button.text') : []
      const okOpen = await tapEl(btns[idx])
      tap('点开「' + need[0].name + '」的现场记录（待到家）', okOpen,
        'tap .button.text[' + idx + ']@ closing，目标 signupId=' + need[0].signupId + '，本轮待办 ' + need.length + ' 人')
      await page.waitFor(1800)
      const areas = fpNow ? await queryAll(fpNow, '.textarea') : []
      const okNote = await inputEl(areas[areas.length - 1], '黄金路径到家核实：' + need[0].name + ' 本人报平安')
      tap('为「' + need[0].name + '」填写到家依据', okNote, 'input 弹层最后一个 .textarea（逐人核实依据）')
      const homeBtn = await byText(fpNow, '核实安全到家')
      const okH = await tapEl(homeBtn)
      tap('点「核实安全到家」（' + need[0].name + '）', okH, '命中：' + (homeBtn ? '是' : '否'))
      await settle(orgView, x => (x.rows || []).some(r => r.signupId === need[0].signupId && r.home === true), 8)
    }
    const homeG = await settle(orgView, v => (v.rows || []).filter(r => r.status === 'confirmed').length === 2
      && (v.rows || []).filter(r => r.status === 'confirmed').every(r => r.home === true), 10)
    const conf = (homeG.v.rows || []).filter(r => r.status === 'confirmed')
    b('两人 home=true（安全闭环完成）', conf.length === 2 && conf.every(r => r.home === true),
      JSON.stringify({ people: conf.map(r => ({ n: r.name, home: r.home })), 等待次数: homeG.waited }))
  }, uiGate('到家核实需要现场弹层'))

  // ============================================================
  // GP-13 完成：归档 + 归档后读面关闭
  // ============================================================
  node('GP-13', 'Complete 归档收尾')
  await L.block('GP-13 归档', 4, async () => {
    const st = await phaseAdvance(PHASE_BTN.closing, '全员到家，结档')
    const arcG = await settle(orgView, x => x.activity.phase === 'archived', 10)
    const v = arcG.v
    b('phase=archived（人人安全闭环后归档成功）', v.activity.phase === 'archived',
      '用户可见红字=' + JSON.stringify({ error: st.error, sheetOpen: st.sheetOpen, triedTwice: st.triedTwice })
      + '；回读 ' + JSON.stringify({ phase: v.activity.phase, 等待次数: arcG.waited }))
    const pv = await read({ kind: 'activity', activityId: AID, perspective: 'participant' })
    b('归档后参与者视角 detailState=finished', pv.data.view.detailState === 'finished', JSON.stringify({ state: pv.data.view.detailState }))
    const exp = await cloud('trailApi', 'readExport', { activityId: AID, signupIds: (v.rows || []).map(r => r.signupId), mode: 'sensitive', purpose: '归档后补导出（应被拒）' })
    b('归档即关闭工作数据能力：敏感导出被拒', exp.ok === true && exp.data.ok === false,
      JSON.stringify({ transportOk: exp.ok, err: exp.data && exp.data.error && exp.data.error.code, phase: v.activity.phase }))
  }, uiGate('归档需要阶段按钮'))

  await shot('final')
  await mp.disconnect()

  const v = L.print()
  report(v)
  process.exit(v.exitCode)

  // —— 逐节点账本：从 entries 的名字前缀还原，不另存一套状态 ——
  function report(verdict) {
    const entries = L.entries()
    const TITLE = {
      'GP-00': '环境', 'GP-01': 'Create', 'GP-02': 'Edit', 'GP-03': 'Publish', 'GP-04': 'Discover',
      'GP-05': 'Signup', 'GP-06': 'Review', 'GP-07': 'Vehicle', 'GP-08': 'Seat', 'GP-09': 'Check-in',
      'GP-10': 'Departure', 'GP-11': 'Arrival', 'GP-12': 'Home', 'GP-13': 'Complete',
    }
    const ids = Array.from(new Set(entries.map(e => (e.name.match(/^\[(GP-\d+)/) || [])[1]).filter(Boolean))).sort()
    const stateOf = list => {
      if (list.some(x => x.state === 'FAIL')) return 'FAIL'
      if (list.some(x => x.state === 'INCONCLUSIVE')) return 'INCONCLUSIVE'
      return list.length ? 'PASS' : 'NONE'
    }
    console.log('\n==== GOLDEN PATH 逐节点账本 ====')
    console.log('节点                 BUSINESS     UI            断言(B/UI)')
    ids.forEach(id => {
      const ent = entries.filter(e => e.name.indexOf('[' + id + ']') === 0)
      const biz = ent.filter(e => e.dim === BUSINESS)
      const ui = ent.filter(e => e.dim !== BUSINESS)
      console.log((id + ' ' + (TITLE[id] || '')).padEnd(21) + stateOf(biz).padEnd(13) + stateOf(ui).padEnd(14) + biz.length + '/' + ui.length)
    })
    const bad = entries.filter(e => e.state === 'FAIL')
    if (bad.length) {
      console.log('\n失败明细（' + bad.length + ' 条）：')
      bad.forEach(e => console.log('  · [' + e.dim + '] ' + e.name + ' —— ' + String(e.detail).slice(0, 200)))
    }
    const unk = entries.filter(e => e.state === 'INCONCLUSIVE')
    if (unk.length) {
      console.log('\n未验证清单（' + unk.length + ' 条，一律不得当作通过）：')
      unk.forEach(e => console.log('  · [' + e.dim + '] ' + e.name + ' —— ' + String(e.detail).slice(0, 160)))
    }
    console.log('\nOVERALL=' + verdict.overall + '  BUSINESS=' + verdict.business + '  UI=' + verdict.ui + '  exit=' + verdict.exitCode)
  }
}

main().catch(e => {
  if (e && e.name === 'AbortRun') console.error('环境前置不成立，已中断（结论 INCONCLUSIVE，不是通过）：' + e.message)
  else console.error('Golden Path 执行异常：', e && (e.stack || e.message || e))
  const v = L.print()
  process.exit(e && e.name === 'AbortRun' ? 2 : (v.exitCode === 0 ? 1 : v.exitCode))
})
