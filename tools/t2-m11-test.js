// toast 文案不得被切成半句：node tools/t2-m11-test.js
//
// 钉的是审计 M-11（合并 C-21 + D-12）的**缺陷本体**，也就是 miniprogram/utils/api.js 的 `toast()`。
// 同波次已有 tools/g2-toast-copy-test.js 钉的是**写侧**（新文案不许越过预算），两者判据不重叠：
//   · g2 那道把上屏长度**量**出来后要求「预算之外的新文案为 0」——于是它测不出「有人把预算调回 20」
//     这种回归（存量那条正好在它的 KNOWN_OVERBUDGET 账上，调小它照样绿）；
//   · 所以本门自带**下限**判据（预算 ≥ 23、20 码点的整句必须活着）与「收口三态」的行为判据；
//   · 本门不扫全仓调用点：那是 g2 那道已经做好的静态侧，复刻过来就是铁律 11 反对的第二份实现。
//
// 手法：桩 global.wx.showToast / wx.showModal，劫持 console.warn，走**真** api.toast()。
// 判据全是「wx.showToast 到底收到了什么」「有没有留痕」「弹的是哪个通道」，不读 api.js 源码文本（铁律 30）。
'use strict'
const API_PATH = require.resolve('../miniprogram/utils/api')
const CONFIG_PATH = require.resolve('../miniprogram/config')

let passed = 0, failed = 0
const fails = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; fails.push(name); console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
function note(t) { console.log('  · ' + t) }
const cp = s => Array.from(String(s)).length // 按码点：一个 emoji 是 1 个字、2 个 UTF-16 码元
const cps = s => Array.from(String(s))
// 孤立代理对 = 被从中间切开的 emoji，屏幕上就是一块豆腐
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

// M-11 的两条**实例**文案（原文照抄：它们是缺陷的证据，不是本门发明的输入）
//   · pages/weather-hub/weather-hub.js:97 —— 23 码点，基线上被截成「…暂无法地」
//   · pages/signup/signup.js:415 / :558 —— 恰好 20 码点，零余量
const WEATHER_HUB = '平台隐私指引未声明「位置信息」，暂无法地图选点'
const SIGNUP_SUBMIT = '报名已提交，资料同步失败可在「我的」补存'
const SIGNUP_EDIT = '修改已保存，资料同步失败可在「我的」补存'
const API_CONFLICT = '安排已被他人更新，已刷新，请重试' // api.js 自己弹的那句（16 码点）

/* ---------- 桩环境：每次重建，读数互不串味 ---------- */
const REAL_WARN = console.warn
let activeRec = null
function freshApi() {
  const rec = { toasts: [], modals: [], warns: [] }
  global.wx = {
    cloud: { init() {}, callFunction: () => ({ then: () => Promise.resolve({ result: { ok: true, data: {} } }) }) },
    showToast(o) { rec.toasts.push(o) },
    showModal(o) { rec.modals.push(o) }, // 记下来而不是让它发生：toast→modal 是交互模式变更，未裁决
  }
  activeRec = rec
  delete require.cache[API_PATH]
  delete require.cache[CONFIG_PATH]
  const api = require(API_PATH)
  return {
    api, rec,
    /** 调一次真 toast，返回这一次的观察结果（title / 完整参数 / 本次新增留痕） */
    toast(title, icon) {
      const t0 = rec.toasts.length, w0 = rec.warns.length, m0 = rec.modals.length
      api.toast(title, icon)
      const opts = rec.toasts[t0] || null
      return {
        title: opts && opts.title, opts,
        warns: rec.warns.slice(w0),
        toasts: rec.toasts.length - t0,
        modals: rec.modals.length - m0,
      }
    },
  }
}
console.warn = (...args) => { if (activeRec) activeRec.warns.push(args.map(String).join(' ')) }

function main() {
  /* ---------- 1. 预算：可量出来、单源、且有下限 ---------- */
  section('1. 上屏预算来自真函数，并与调用点旁边写的那个数是同一个数')
  let BUDGET = 0
  {
    const env = freshApi()
    const probe = env.toast('一'.repeat(400))
    BUDGET = cp(probe.title)
    check('预算量得出来（>0）——量不出来本门就是在空转', BUDGET > 0, 'BUDGET=' + BUDGET)
    note('实测上屏预算 = ' + BUDGET + ' 码点')
    check('导出的 TOAST_TEXT_BUDGET 与实测上屏长度同源（写了不生效、或函数里另有硬编码都算没单源）',
      env.api.TOAST_TEXT_BUDGET === BUDGET,
      JSON.stringify({ exported: env.api.TOAST_TEXT_BUDGET, measured: BUDGET }))
    // 下限判据：g2 那道给不了——它只拿实测值比对新文案，实测值被调小它照样绿。
    check('预算 ≥ M-11 实例文案的长度（' + cp(WEATHER_HUB) + ' 码点）：缺陷不再发生的下限',
      BUDGET >= cp(WEATHER_HUB), 'BUDGET=' + BUDGET)
    const near = env.toast('一'.repeat(22))
    check('旧上限 20 不得以别的形式回来：22 码点的句子必须整句上屏',
      cp(near.title) === 22, cp(near.title))
  }

  /* ---------- 2. 预算之内一字不动（存量零回退） ---------- */
  section('2. 预算之内的话术：一个字都不许多丢，被截掉的那个关键词必须活着')
  {
    const env = freshApi()
    for (const [name, text, mustKeep] of [
      ['weather-hub 隐私话术（M-11 / C-21 的实证案例）', WEATHER_HUB, '图选点'],
      ['signup 提交后同步失败（M-11 / D-12）', SIGNUP_SUBMIT, '补存'],
      ['signup 修改后同步失败（M-11 / D-12）', SIGNUP_EDIT, '「我的」'],
      ['api.js 冲突提示（e2e/scenario 按全文比对的那句）', API_CONFLICT, '已被他人更新'],
      // 21 码点这一档不是凑数：pages/activity/activity.js:593 把同一句话同时写进弹层 callout 与 toast，
      // 旧实让两边**不同文**（toast 少一个句末句号），tools/scenario-activity-test.js 曾经把那个断句
      // 当成期望值钉着。这一档钉住「callout 与 toast 同一条完整话术」不再退化。
      ['activity 取消反馈（21 码点，与页面 callout 必须同文）', '此人的报名已取消，其他同行人的状态未改变。', '改变。'],
      ['恰好等于预算', '一'.repeat(BUDGET), '一'],
    ]) {
      const r = env.toast(text)
      check(name + '：逐字节原样上屏', r.title === text, JSON.stringify(r.title))
      check(name + '：可行动信息活着（含「' + mustKeep + '」）',
        !!r.title && r.title.indexOf(mustKeep) !== -1, JSON.stringify(r.title))
    }
    check('预算内的存量话术一条都不该在控制台留痕（warn 变噪音就等于没有 warn）',
      env.rec.warns.length === 0, JSON.stringify(env.rec.warns.slice(0, 2)))
    // 阳性对照：预算 +1 必须真的被收口，否则上面那五条「原样」是空跑出来的。
    const over = env.toast('一'.repeat(BUDGET + 1))
    check('预算 +1 确实收口（本门的阳性对照：预算不是摆设）',
      cp(over.title) === BUDGET && over.title !== '一'.repeat(BUDGET + 1),
      JSON.stringify({ got: cp(over.title), BUDGET }))
  }

  /* ---------- 3. 超长只许收口成一句读得通的话 ---------- */
  section('3. 超出预算：断在句读处 + 显式省略号，不许留半截词')
  {
    const env = freshApi()
    const long = '这一句是特意铺到预算之外的验证文案，前半句先说清楚发生了什么，后半句交代用户现在能做的两件事。'
    check('夹具确实超出预算（否则这一段根本走不到收口分支）', cp(long) > BUDGET, cp(long))
    const r = env.toast(long)
    check('超长文案以省略号收尾：截断要明说，不能让用户以为话就这么长',
      /\…$/.test(r.title || ''), JSON.stringify(r.title))
    const body = (r.title || '').replace(/…$/, '')
    check('断点落在句读上：屏幕上剩下的是一句读得通的话，不是「…暂无法地」那种半截词',
      body === '' || /[。！？；，、』」】）]$/.test(body), JSON.stringify(body.slice(-4)))
    check('收口后总长仍在预算内（省略号也算一格）', cp(r.title) <= BUDGET, cp(r.title))
    check('留下的部分是原文的码点前缀（不重复、不改写、不补字）',
      cps(r.title).slice(0, -1).join('') === cps(long).slice(0, cps(r.title).length - 1).join(''),
      JSON.stringify(r.title))

    const noSep = '一路没有句读标点铺到底的超长验证文案'.repeat(3)
    check('夹具：完全没有句读的超长文案（收口收不住时按预算硬截，仍要留省略号）',
      cp(noSep) > BUDGET && !/[。！？；，、]/.test(noSep), cp(noSep))
    const hard = env.toast(noSep)
    check('无句读可靠预算硬截，但必须补省略号且总长恰为预算',
      cp(hard.title) === BUDGET && /…$/.test(hard.title || ''), JSON.stringify(hard.title))
    check('硬截同样是原文的码点前缀（预算-1 个字 + 省略号）',
      cps(hard.title).slice(0, -1).join('') === cps(noSep).slice(0, BUDGET - 1).join(''),
      JSON.stringify(hard.title))
  }

  /* ---------- 4. 截断不许静默 ---------- */
  section('4. 每一次截断都在开发期留痕，且留痕里能找到原文')
  {
    const env = freshApi()
    const long = '故意超长的第二例：这一句被收口之后控制台必须点名它，写文案的人才知道预算边界在哪儿。'
    check('夹具超出预算', cp(long) > BUDGET, cp(long))
    const r = env.toast(long)
    check('截断发生 ⇒ 控制台留痕恰一条（一次弹层不该刷屏）',
      r.warns.length === 1, JSON.stringify(r.warns))
    check('留痕里带原文（作者要能认出是哪一句）',
      r.warns.length === 1 && r.warns[0].indexOf(long) !== -1, JSON.stringify(r.warns))
    check('留痕里带预算这个数（越界多少要一眼看得见）',
      r.warns.length === 1 && r.warns[0].indexOf(String(BUDGET)) !== -1, JSON.stringify(r.warns))
    const ok = env.toast('预算内的短文案')
    check('没截断就不留痕：预算内那一条的留痕数为 0', ok.warns.length === 0, JSON.stringify(ok.warns))
  }

  /* ---------- 5. 按码点计数：不许把 emoji 切成豆腐块 ---------- */
  section('5. 计数与切分按码点：emoji 从中间切开就是孤立代理对（屏幕上一块豆腐）')
  {
    const env = freshApi()
    const emojiShort = '✅ 已存入观察点'
    check('夹具：含 emoji 的短文案', cp(emojiShort) < BUDGET, cp(emojiShort))
    const keep = env.toast(emojiShort)
    check('预算内含 emoji 的文案逐字节原样', keep.title === emojiShort, JSON.stringify(keep.title))
    // 28 个 BMP 字 + 1 个 emoji：emoji 的两个码元正好压在预算线上（旧写法在这里切出孤立代理对）
    const astral = '风'.repeat(BUDGET - 2) + '🏔' + '山顶见与后面这一句都放不下'
    check('夹具：emoji 跨在预算线上且整句超出预算',
      cp(astral) > BUDGET && astral.length > cp(astral), JSON.stringify({ cps: cp(astral), units: astral.length }))
    const cut = env.toast(astral)
    check('收口后没有孤立代理对（屏上不出现豆腐块）',
      !!cut.title && !LONE_SURROGATE.test(cut.title), JSON.stringify(cut.title))
    check('留在屏幕上的部分仍是原文的码点前缀（成对字符要么整留要么整去）',
      cps(cut.title).slice(0, -1).join('') === cps(astral).slice(0, cps(cut.title).length - 1).join(''),
      JSON.stringify(cps(cut.title).slice(0, -1).join('')))
    check('豆腐块检测本身有效：把 emoji 劈开就该判红（否则第 5 段是在空跑）',
      LONE_SURROGATE.test('风'.repeat(BUDGET - 2) + '\uD83D') === true)
  }

  /* ---------- 6. 只动文案，别动别的（通道 / 旁参 / 兜底） ---------- */
  section('6. 越界门：一次 toast 只弹一次、只有文案可变、不许降级成 showModal')
  {
    const env = freshApi()
    const one = env.toast('很短')
    check('一次 api.toast 恰好一次 wx.showToast（不弹两条、也不静默不弹）',
      one.toasts === 1, JSON.stringify({ toasts: one.toasts, all: env.rec.toasts.length }))
    const long = '故意超出预算的第三例，为了让收口分支跑一次：前半句交代结论，后半句交代出路给用户看。'
    const r = env.toast(long)
    check('截断路径仍只走 wx.showToast，没有改成 wx.showModal（弹窗要用户点确认，属交互模式变更，未裁决）',
      r.modals === 0 && env.rec.modals.length === 0, JSON.stringify(env.rec.modals))
    check('缺省 icon 仍是 none', r.opts && r.opts.icon === 'none', JSON.stringify(r.opts))
    const suc = env.toast('已保存', 'success')
    check('显式 icon 原样透传（第二参是 icon 名，不被当成文案计入长度）',
      suc.opts && suc.opts.icon === 'success' && suc.title === '已保存', JSON.stringify(suc.opts))
    check('时长仍是 2400ms（本轮不动观感与时长——见 requests R-T2-2）',
      env.rec.toasts.every(t => t.duration === 2400),
      JSON.stringify(env.rec.toasts.map(t => t.duration)))
    const before = env.rec.toasts.length
    for (const [name, input] of [['空串', ''], ['undefined', undefined], ['null', null]]) {
      const fb = env.toast(input)
      check('兜底仍在：' + name + ' → 「完成」，且不算截断（不刷 warn）',
        fb.title === '完成' && fb.warns.length === 0, JSON.stringify(fb.title))
    }
    check('三条兜底各弹一次、共三次', env.rec.toasts.length - before === 3, env.rec.toasts.length - before)
  }

  console.warn = REAL_WARN
  console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
  if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
  process.exit(failed ? 1 : 0)
}

try { main() } catch (e) {
  console.warn = REAL_WARN
  console.error('套件异常中止（崩红不算判据有效）：', e && e.stack || e)
  process.exit(1)
}
