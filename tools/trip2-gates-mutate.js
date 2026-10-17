// TRIP2 门的判别力自证：node tools/trip2-gates-mutate.js
// 手法：把 miniprogram/（不含 assets）与 tools/trip2-gates-test.js 复制进仓库外的沙盒，逐条在沙盒里
// 注入变异，跑同一套门，要求每条变异都被**对应段落**的断言判红；未变异的沙盒副本必须先全绿
// （有效性门，否则后面的红可能来自环境而不是变异）。崩红（进程撞停 / 没有 passed= 读数）不算抓到。
// 每条锚点必须命中恰 1 次：命中 0 次＝没注入（假绿），>1 次＝改错了地方——两种都计一条失败，
// 不静默改错行充数。
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.join(__dirname, '..')
const SANDBOX = path.join(os.tmpdir(), 'trip2-mutate-' + process.pid)
const SB_MP = path.join(SANDBOX, 'miniprogram')
const SB_TOOLS = path.join(SANDBOX, 'tools')
const SB_TEST = path.join(SB_TOOLS, 'trip2-gates-test.js')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }
const sbFile = relPath => path.join(SANDBOX, ...relPath.split('/'))
const readSb = relPath => fs.readFileSync(sbFile(relPath), 'utf8')
const writeSb = (relPath, text) => fs.writeFileSync(sbFile(relPath), text)
// 行尾自适应：工作树若是 CRLF，锚点按 \n 写就会命中 0 次（那是注入失败，不是「没抓到」）
function nl(text, host) {
  return host.indexOf('\r\n') !== -1 ? text.replace(/\r?\n/g, '\r\n') : text
}

const V = 'miniprogram/pages/vehicle/vehicle.js'
const VW = 'miniprogram/pages/vehicle/vehicle.wxml'
const SW = 'miniprogram/pages/signup/signup.wxml'
const AJ = 'miniprogram/pages/activity/activity.js'
const SJ = 'miniprogram/pages/staff/staff.js'
const SN = 'miniprogram/pages/staff/staff.json'

// [编号, 说明, 文件, [[锚点, 替换], …], 期望被抓的段落前缀]
const MUTATIONS = [
  ['M1', '主按钮回到单击直发（确认层整段摘掉）', VW, [
    [`bindtap="{{busy || departed ? '' : 'onDepartAsk'}}"`, `bindtap="{{busy || departed ? '' : 'onDepart'}}"`],
  ], 'V'],
  ['M2', 'onDepartAsk 改成无条件直发（有缺口也不问）', V, [
    [`    if (!this.data.pendingCount) { this.onDepart(); return }
    this.setData({ departAsk: true, error: '', message: '' })`, `    this.onDepart()`],
  ], 'V'],
  ['M3', '预检人数不再等于「应到 − 已上车」（改成应到总数）', V, [
    [`      pendingCount: pending.length,`, `      pendingCount: expected.length,`],
  ], 'V'],
  ['M4', '名单改用另一套判据（谁没签到）＝在页面里重推「谁该上车」', V, [
    [`    const pending = expected.filter(p => boarded.indexOf(p) === -1)`,
      `    const pending = vt.passengers.filter(p => !p.checkedIn)`],
  ], 'V'],
  ['M5', '预检提示无条件常驻（没有「一次都不提示」的对照）', V, [
    [`      showPendingNotice: pending.length > 0 && canOperate && !legInfo.departed,`,
      `      showPendingNotice: true,`],
  ], 'V'],
  ['M6', '弹层 open 恒真（关不掉＝下一轮的点了没反应）', VW, [
    [`<overlay open="{{departAsk}}" kind="dialog" title="确认本程发车"`,
      `<overlay open="{{true}}" kind="dialog" title="确认本程发车"`],
  ], 'V'],
  ['M7', 'onDepart 的 busy 入口守卫被删（加层反而稀释了防抖）', V, [
    [`  onDepart() {
    if (this.data.busy || this.data.departed) return`, `  onDepart() {`],
  ], 'V'],
  ['M8', '确认按钮换成恒绑（只剩 class 置灰、不摘 handler：C-01 配对缺一半）', VW, [
    [`class="button danger block {{busy || departed ? 'disabled' : ''}}" hover-class="button-hover" bindtap="{{busy || departed ? '' : 'onDepart'}}"`,
      `class="button danger block {{busy || departed ? 'disabled' : ''}}" hover-class="button-hover" bindtap="onDepart"`],
  ], 'V'],
  ['M9', '失败行搬回页尾（红字又在按钮之后，V29 该咬）', VW, [
    [`    <view wx:if="{{error}}" class="callout danger">{{error}}</view>

    <!-- 清点没点完时`, `    <!-- 清点没点完时`],
    [`    <text wx:if="{{message}}" class="small muted">{{message}}</text>`,
      `    <text wx:if="{{message}}" class="small muted">{{message}}</text>
    <view wx:if="{{error}}" class="callout danger">{{error}}</view>`],
  ], 'V'],
  ['M10', '失败行再复制一处（同一句话印两遍）', VW, [
    [`    <view wx:if="{{error}}" class="callout danger">{{error}}</view>`,
      `    <view wx:if="{{error}}" class="callout danger">{{error}}</view>
    <view wx:if="{{error}}" class="callout danger">{{error}}</view>`],
  ], 'V'],
  ['M11', 'A-13 没落地：候补按钮仍是 secondary', SW, [
    [`<view class="button primary block {{busy ? 'disabled' : ''}}" hover-class="button-hover" bindtap="{{busy ? '' : 'onWaitlist'}}">明确同意整组候补</view>`,
      `<view class="button secondary block {{busy ? 'disabled' : ''}}" hover-class="button-hover" bindtap="{{busy ? '' : 'onWaitlist'}}">明确同意整组候补</view>`],
  ], 'S'],
  ['M12', 'A-13 过度修：把「提交报名」在询问态锁死', SW, [
    [`<view class="button {{capacityAsk ? 'secondary' : 'primary'}} block {{busy ? 'disabled' : ''}}" hover-class="button-hover" bindtap="{{busy ? '' : 'onSubmit'}}">`,
      `<view class="button {{capacityAsk ? 'secondary disabled' : 'primary'}} block {{busy ? 'disabled' : ''}}" hover-class="button-hover" bindtap="{{busy || capacityAsk ? '' : 'onSubmit'}}">`],
  ], 'S'],
  ['M13', 'A-02 没落地：参与者该格退回 milestone 原文（重印回来）', AJ, [
    [`        ? '待审核 ' + v.counters.pending + ' 人 · 候补 ' + v.counters.waitlisted + ' 人 · 剩余 ' + v.counters.remaining + ' 个名额'
        : '',`,
      `        ? '待审核 ' + v.counters.pending + ' 人 · 候补 ' + v.counters.waitlisted + ' 人 · 剩余 ' + v.counters.remaining + ' 个名额'
        : (journey.milestone || journey.how || ''),`],
  ], 'A'],
  ['M14', 'staff 页没有下拉钩子（json 开了手势却没人接）', SJ, [
    [`  onPullDownRefresh() {
    this.setData({ syncKey: nextSyncKey() })
    if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh()
  },`, `  onPullDownRefreshNoop() {},`],
  ], 'F'],
  ['M15', '失效信号只带时间戳（同毫秒两次下拉撞成同一个串）', SJ, [
    [`const nextSyncKey = () => 'staff@' + Date.now() + '.' + (++seq)`,
      `const nextSyncKey = () => 'staff@' + Date.now()`],
  ], 'F'],
  ['M16', 'staff.json 关掉 enablePullDownRefresh（手势根本不存在）', SN, [
    [`,
  "enablePullDownRefresh": true
}`, `
}`],
  ], 'F'],
  // 反向门：加层不该动服务端契约 —— 把确认后的命令换成别的 payload
  ['M17', '确认层把命令换成 vehicle.complete（契约被顺手改掉）', V, [
    [`api.dispatchAndSync({ type: 'vehicle.depart', activityId: this.activityId, vehicleId: this.vehicleId, leg: this.data.leg, note: '本车清点后发车' }, this.revision, this)`,
      `api.dispatchAndSync({ type: 'vehicle.depart', activityId: this.activityId, vehicleId: this.vehicleId, leg: this.data.leg, note: '客户端预检通过' }, this.revision, this)`],
  ], 'V'],
]

function runSuite() {
  const r = cp.spawnSync(process.execPath, [SB_TEST], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const m = /passed=(\d+) failed=(\d+)/.exec(out)
  return {
    out, code: r.status,
    passed: m ? Number(m[1]) : null,
    failed: m ? Number(m[2]) : null,
    crashed: !m,
    reds: (out.match(/^ {2}✗ .*$/gm) || []).map(s => s.trim()),
  }
}

function main() {
  section('0. 沙盒准备（仓库外，不碰工作树）')
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(SB_TOOLS, { recursive: true })
  fs.cpSync(path.join(ROOT, 'miniprogram'), SB_MP, { recursive: true, filter: s => !/[\\/]assets[\\/]/.test(s) })
  fs.copyFileSync(path.join(ROOT, 'tools', 'trip2-gates-test.js'), SB_TEST)
  check('0.1 沙盒里有 miniprogram 与被测门', fs.existsSync(SB_MP) && fs.existsSync(SB_TEST))
  const baseline = runSuite()
  check('0.2 有效性门：未变异的沙盒副本全绿（否则后面的红可能来自环境而不是变异）',
    baseline.crashed === false && baseline.failed === 0,
    JSON.stringify({ code: baseline.code, passed: baseline.passed, failed: baseline.failed, reds: baseline.reds.slice(0, 3) }))
  check('0.3 基线读数不为空（门真的在跑）', baseline.passed > 50, 'passed=' + baseline.passed)

  section('1. 逐条变异：每条都必须被对应段落抓到')
  const misses = []
  MUTATIONS.forEach(mu => {
    const id = mu[0]
    const desc = mu[1]
    const file = mu[2]
    const edits = mu[3]
    const expectPart = mu[4]
    const original = readSb(file)
    let text = original
    let bad = null
    edits.forEach(pair => {
      const a = nl(pair[0], original)
      const b = nl(pair[1], original)
      const hits = text.split(a).length - 1
      if (hits !== 1) bad = '锚点命中 ' + hits + ' 次'
      else text = text.replace(a, b)
    })
    if (bad) {
      failed++
      misses.push(id + '（' + bad + ' ⇒ 这条根本没注入）')
      console.error('  ✗ ' + id + ' ' + desc + '（' + bad + '）')
      return
    }
    writeSb(file, text)
    const r = runSuite()
    writeSb(file, original)
    if (r.crashed) {
      failed++
      misses.push(id + '（进程撞停＝崩红，不计为抓到）')
      console.error('  ✗ ' + id + ' ' + desc + '（崩红，不计抓到）：' + r.out.split('\n').slice(-3).join(' / ').slice(0, 120))
      return
    }
    const partRe = new RegExp('✗\\s*' + expectPart + '\\d')
    const caught = r.failed > 0 && r.reds.some(t => partRe.test(t))
    const restored = readSb(file) === original
    if (caught && restored) {
      passed++
      console.log('  ✓ ' + id + ' ' + desc + ' → 抓到 ' + r.failed + ' 条：' + r.reds.filter(t => partRe.test(t))[0].slice(0, 44))
    } else {
      failed++
      misses.push(id + (r.failed > 0 ? '（只红了别处：' + r.reds.join(' | ').slice(0, 70) + '）' : '（全绿＝漏网）'))
      console.error('  ✗ ' + id + ' ' + desc + ' → ' + (r.failed > 0 ? '红在别的段落，' + expectPart + ' 段没咬' : '漏网（全绿）'))
    }
  })

  section('2. 回滚自证：还原后的沙盒必须重新全绿（变异没留下残渣）')
  const after = runSuite()
  check('2.1 全部变异还原后复跑仍全绿', after.crashed === false && after.failed === 0,
    JSON.stringify({ failed: after.failed, reds: after.reds.slice(0, 3) }))

  fs.rmSync(SANDBOX, { recursive: true, force: true })
  console.log('\npassed=' + passed + ' failed=' + failed)
  if (misses.length) console.log('漏网/注入失败：' + misses.join(' ; '))
  process.exit(failed > 0 ? 1 : 0)
}
main()
