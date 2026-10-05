// 预演面板页面级场景测试：node tools/scenario-lab-test.js
// 对象：miniprogram/pages/lab/lab.js —— 开发者专用页，但同样是"从未端到端跑过"的移植代码，
// 沿用项目手法（global.Page 捕获真配置 → makePage 驱动真 handler）兜住运行时。
// 网络桩：直接桩 wx.cloud.callFunction（本页不经 utils/api，走 wx.cloud 信封）。
'use strict'
const LAB_PATH = require.resolve('../miniprogram/pages/lab/lab.js')
const CONFIG_PATH = require.resolve('../miniprogram/config')

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 1500
  const t0 = Date.now()
  while (Date.now() - t0 < limit) { if (cond()) return true; await sleep(5) }
  return cond()
}

function boardFixture() {
  return [
    { stage: 0, title: '阶段 0 · 建档', status: 'done', reason: '' },
    { stage: 1, title: '阶段 1 · 报名', status: 'ready', reason: '尚未报名' },
    { stage: 2, title: '阶段 2 · 修改与退出', status: 'blocked', reason: '等阶段 1 完成后再跑' },
    { stage: 3, title: '阶段 3 · 签到', status: 'blocked', reason: '先推进到「集结中」' },
    { stage: 4, title: '阶段 4 · 现场', status: 'blocked', reason: '位置上报须在「进行中」阶段' },
    { stage: 5, title: '阶段 5 · 到家', status: 'blocked', reason: '到家确认在「收尾」阶段开放' },
  ]
}

function inspectEnvelope(over) {
  return {
    ok: true,
    data: Object.assign({
      caller: 'o-real-owner',
      allowlist: { configIds: ['o-owner-cfg'], ids: ['o-dev-1'] },
      board: boardFixture(),
      activity: { id: 'act-1', title: '[预演] 走查', phase: 'published', capacity: 8, signups: 0, byStatus: {}, openIncidents: 0 },
      actors: [{ id: 'u-lab-01', name: '演员大壮', companions: [] }],
      revision: 3,
    }, over || {}),
  }
}

// wx 桩：callFunction 按 action 路由到可配置信封；记录全部调用
function bootLab(opts) {
  opts = opts || {}
  const env = { calls: [], pulls: [] }
  global.wx = {
    cloud: {
      callFunction(req) {
        env.calls.push({ action: req.data.action, data: req.data })
        const action = req.data.action
        if (action === 'inspect') {
          if (opts.inspectFail) return Promise.resolve({ result: { ok: false, error: { code: opts.inspectFail.code || 'FORBIDDEN', message: opts.inspectFail.message } } })
          return Promise.resolve({ result: inspectEnvelope(opts.inspectOver) })
        }
        if (action === 'seed') {
          if (opts.seedFail) return Promise.resolve({ result: { ok: false, error: { code: 'WRONG_PHASE', message: opts.seedFail } } })
          return Promise.resolve({ result: { ok: true, data: { stage: req.data.stage, title: '阶段 0 · 建档', executed: [{ ok: true }], hint: '去真机建 [预演] 活动并发布' } } })
        }
        if (action === 'cleanup') {
          return Promise.resolve({ result: { ok: true, data: { removed: { activities: 1, signups: 7, attendance: 7, profiles: 5 } } } })
        }
        if (action === 'allowlist.add') {
          if (opts.allowFail) return Promise.resolve({ result: { ok: false, error: { code: 'INVALID_INPUT', message: opts.allowFail } } })
          return Promise.resolve({ result: { ok: true, data: { ids: ['o-dev-1', req.data.id] } } })
        }
        if (action === 'allowlist.remove') {
          return Promise.resolve({ result: { ok: true, data: { ids: [] } } })
        }
        return Promise.resolve({ result: { ok: true, data: {} } })
      },
    },
    stopPullDownRefresh() { env.pulls.push(1) },
  }
  global.Page = cfg => { global.__LAB_CFG = cfg }
  delete require.cache[LAB_PATH]
  delete require.cache[CONFIG_PATH]
  require(LAB_PATH)
  const cfg = global.__LAB_CFG
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page._patches = []
  page.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  return { page, env }
}

async function main() {
  section('1. 首屏装配：inspect 状态板')
  {
    const { page, env } = bootLab()
    page.onShow()
    await waitFor(() => page.data.loading === false)
    check('inspect 恰好调用一次', env.calls.filter(c => c.action === 'inspect').length === 1, '')
    check('状态板六项进 data、活动卡与名册装配',
      page.data.board.length === 6 && page.data.activity.title === '[预演] 走查' && page.data.actors.length === 1,
      JSON.stringify(page.data.board.map(b => b.status)))
    check('无 denied、loading 收尾', page.data.denied === '' && page.data.loading === false, '')
    const ran = page.data.board.filter(b => b.status === 'ready')
    check('状态板里恰好一个「可执行」阶段（渲染执行按钮的依据）', ran.length === 1 && ran[0].stage === 1, JSON.stringify(ran.map(r => r.stage)))
  }

  section('2. 鉴权被拒：FORBIDDEN 原文透出到 denied')
  {
    const { page } = bootLab({ inspectFail: { code: 'FORBIDDEN', message: '未获预演工具授权：把你的身份码「oXyz」加入 OWNER_OPENIDS' } })
    page.onShow()
    await waitFor(() => page.data.loading === false)
    check('denied 展示加白指引（含身份码）', page.data.denied.indexOf('oXyz') !== -1 && page.data.board.length === 0,
      page.data.denied)
  }

  section('3. 网络不可达与超时：分开话术')
  {
    const { page, env } = bootLab()
    env.calls.splice(0, env.calls.length)
    global.wx.cloud.callFunction = () => Promise.reject(new Error('cloud not init'))
    page.onShow()
    await waitFor(() => page.data.loading === false)
    check('callFunction 抛错 → denied 显示「预演工具不可达」', page.data.denied.indexOf('预演工具不可达') !== -1, page.data.denied)
  }
  {
    const { page } = bootLab()
    await waitFor(() => page.data.loading === false)
    // 超时的 reject 形如 { errMsg: '...errCode: -504003...' }，无 code 字段
    global.wx.cloud.callFunction = () => Promise.reject({ errMsg: 'errCode: -504003 cloud function execution timeout' })
    page.onRunStage({ currentTarget: { dataset: { stage: 0 } } })
    await waitFor(() => page.data.busyStage === -1 && !!page.data.error)
    check('超时 → 话术指明 -504003 与幂等重试，不再误报「未部署」',
      page.data.error.indexOf('-504003') !== -1 && page.data.error.indexOf('幂等') !== -1 && page.data.error.indexOf('不可达') === -1,
      page.data.error)
  }

  section('4. 执行阶段：seed 成功 → message 拼装 + 自动刷新')
  {
    const { page, env } = bootLab()
    page.onShow()
    await waitFor(() => page.data.loading === false)
    const before = env.calls.length
    page.onRunStage({ currentTarget: { dataset: { stage: 0 } } })
    check('busyStage 锁定（防连点）', page.data.busyStage === 0, String(page.data.busyStage))
    await waitFor(() => page.data.busyStage === -1 && !!page.data.message)
    check('执行成功：message = 阶段标题 + 结果 + hint', page.data.message.indexOf('阶段 0 · 建档') === 0
      && page.data.message.indexOf('1 条命令') !== -1 && page.data.message.indexOf('[预演]') !== -1,
      page.data.message)
    check('执行后自动刷新（inspect 再查一次）', env.calls.slice(before).filter(c => c.action === 'inspect').length === 1, '')
  }

  section('5. 执行阶段：失败透出、busy 复位')
  {
    const { page } = bootLab({ seedFail: '活动当前阶段是「published」…' })
    page.onShow()
    await waitFor(() => page.data.loading === false)
    page.onRunStage({ currentTarget: { dataset: { stage: 1 } } })
    await waitFor(() => page.data.busyStage === -1 && !!page.data.error)
    check('seed 失败 → error 透出、busy 复位', page.data.error.indexOf('published') !== -1 && page.data.busyStage === -1,
      page.data.error)
  }

  section('6. 清理：两段确认（勾选理解才可执行）')
  {
    const { page, env } = bootLab()
    page.onShow()
    await waitFor(() => page.data.loading === false)
    page.onCleanupAsk()
    check('弹层打开、未勾选', page.data.cleanupOpen === true && page.data.cleanupArmed === false, '')
    page.onCleanupConfirm()
    check('未勾选时确认 no-op（不发 cleanup）', page.data.cleanupOpen === true
      && env.calls.filter(c => c.action === 'cleanup').length === 0, '')
    page.onCleanupArm({ detail: { value: ['on'] } })
    page.onCleanupConfirm()
    await waitFor(() => page.data.cleanupOpen === false)
    check('勾选后执行 → 清理计数进 message、弹层关闭',
      page.data.message.indexOf('已清理预演数据') === 0 && page.data.message.indexOf('profiles 5') !== -1,
      page.data.message)
    check('清理后自动刷新', env.calls.filter(c => c.action === 'inspect').length >= 2, '')
  }

  section('7. 下拉刷新收尾')
  {
    const { page, env } = bootLab()
    page.onShow()
    await waitFor(() => page.data.loading === false)
    page.onPullDownRefresh()
    await waitFor(() => env.pulls.length > 0)
    check('stopPullDownRefresh 收尾', env.pulls.length === 1, String(env.pulls.length))
  }

  section('8. 白名单管理卡')
  {
    const { page, env } = bootLab()
    page.onShow()
    await waitFor(() => page.data.loading === false)
    check('身份码与名单装配（配置固定 1 + 动态 1）',
      page.data.caller === 'o-real-owner' && page.data.allowConfig.length === 1 && page.data.allowDb.length === 1,
      JSON.stringify({ caller: page.data.caller, cfg: page.data.allowConfig, db: page.data.allowDb }))
    page.onAllowInput({ detail: { value: 'o-new-dev' } })
    page.onAllowAdd()
    await waitFor(() => !!page.data.message && page.data.allowInput === '')
    check('添加：调用 allowlist.add、清空输入、提示',
      env.calls.some(c => c.action === 'allowlist.add' && c.data.id === 'o-new-dev')
        && page.data.message.indexOf('已加入白名单：o-new-dev') === 0, page.data.message)
    page.onAllowRemove({ currentTarget: { dataset: { id: 'o-dev-1' } } })
    await waitFor(() => page.data.message.indexOf('已移出白名单') === 0)
    check('移除：调用 allowlist.remove、提示', env.calls.some(c => c.action === 'allowlist.remove' && c.data.id === 'o-dev-1'), '')
  }
  {
    const { page } = bootLab({ allowFail: '该身份码已在白名单内。' })
    page.onShow()
    await waitFor(() => page.data.loading === false)
    page.onAllowInput({ detail: { value: 'o-dev-1' } })
    page.onAllowAdd()
    await waitFor(() => !!page.data.error)
    check('添加失败 → error 透出、busy 复位', page.data.error.indexOf('已在白名单') !== -1 && page.data.allowBusy === false, page.data.error)
  }

  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  failed++
  console.error('  ✗ 场景执行异常（' + ((e && e.stack) || e) + '）')
  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped)
  process.exit(1)
})
