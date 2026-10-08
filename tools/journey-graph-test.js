// 页面图与词汇单源的静态门（重构 §10/§25）。
// 它不执行页面代码，只读 app.json、路由字符串与模板：所以能进无头门禁，也能在
// 没有微信开发者工具的那台机器上跑。目的是让「死页面 / 困页 / 各页自造一套状态词」
// 这三类问题在提交时就被拦下，而不是等真机走查。
'use strict'
const fs = require('fs')
const path = require('path')

let passed = 0, failed = 0, skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')) }
}
function section(t) { console.log('\n== ' + t + ' ==') }

const MP = path.join(__dirname, '..', 'miniprogram')
const APP = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'))
const PAGES = APP.pages
const TABS = (APP.tabBar && APP.tabBar.list ? APP.tabBar.list : []).map(t => t.pagePath.replace(/^\//, ''))

// 只给开发机用的页面：故意不给用户入口，但必须自己声明「这是内部工具」，
// 也绝不许被用户页跳过去。新增页面要么进这个表并写理由，要么必须有入口。
const DEV_ONLY = {
  'pages/lab/lab': '预演工具（trailApiLab 白名单账号），只由编译直连路由打开',
  'pages/cloud-field-poc/cloud-field-poc': 'Cloud Field SVG 迁移 POC，其 fixtures 被 cloud-field-svg/meteogram-svg 两套测试 require',
}

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|wxml)$/.test(f)) out.push(p)
  }
  return out
}
const ROOT = path.join(__dirname, '..')
const toRel = p => path.relative(ROOT, p).split(path.sep).join('/')
const FILES = walk(MP, []).map(p => ({ file: toRel(p), text: fs.readFileSync(p, 'utf8') }))

const CALL = /wx\.(navigateTo|redirectTo|reLaunch|switchTab)\s*\(\s*\{[\s\S]{0,240}?url:\s*['"]\/(pages\/[a-z0-9_-]+\/[a-z0-9_-]+)/g
const ANY = /\/(pages\/[a-z0-9_-]+\/[a-z0-9_-]+)/g

const inbound = {}
for (const p of PAGES) inbound[p] = []
for (const { file, text } of FILES) {
  const seen = new Map()
  let m
  CALL.lastIndex = 0
  while ((m = CALL.exec(text))) seen.set(m[2], m[1])
  ANY.lastIndex = 0
  while ((m = ANY.exec(text))) if (!seen.has(m[1])) seen.set(m[1], 'mention')
  for (const [to, api] of seen) {
    // 自己跳自己（例：tab 页 reLaunch 回首页）不算别人的入口
    if (to === file.replace(/^miniprogram\//, '').replace(/\.(js|wxml)$/, '')) continue
    if (inbound[to]) inbound[to].push({ api, from: file })
  }
}
const apisOf = p => inbound[p].map(x => x.api)
const ownFiles = p => FILES.filter(x => x.file.indexOf('miniprogram/' + p + '.') === 0)
const ownText = p => ownFiles(p).map(x => x.text).join('\n')

section('A. 页面可达性：注册在 app.json 的每一页都必须有入口，或明确登记为内部页')
check('app.json 的 pages 与实际目录一一对应（' + PAGES.length + ' 页）',
  PAGES.every(p => fs.existsSync(path.join(MP, p + '.js')) && fs.existsSync(path.join(MP, p + '.wxml')) && fs.existsSync(path.join(MP, p + '.json'))),
  PAGES.filter(p => !fs.existsSync(path.join(MP, p + '.json'))).join(', '))
const orphans = PAGES.filter(p => TABS.indexOf(p) === -1 && DEV_ONLY[p] === undefined && !inbound[p].length)
check('没有无人可达的页面（首页是启动页、tabBar 四页常驻，其余必须有跳进来的代码）',
  orphans.length === 0, orphans.join(', '))
check('内部页只有登记过的两页，且各自写明了理由',
  Object.keys(DEV_ONLY).length === 2 && Object.keys(DEV_ONLY).every(k => DEV_ONLY[k].length > 8 && PAGES.indexOf(k) !== -1),
  JSON.stringify(Object.keys(DEV_ONLY)))
check('内部页绝不许出现在用户页的代码里（否则「仅内部」就成了假话）',
  Object.keys(DEV_ONLY).every(p => inbound[p].every(e => DEV_ONLY[e.from.replace(/^miniprogram\//, '').split('/')[1]] !== undefined
    || e.from.indexOf('/' + p.split('/')[1] + '/') !== -1)),
  JSON.stringify(Object.keys(DEV_ONLY).map(p => p + ': ' + inbound[p].map(e => e.from).join('|'))))
check('内部页自己声明了内部身份（模板里有「内部/预演/POC」字样，别人误开时能看懂）',
  Object.keys(DEV_ONLY).every(p => /(内部|预演|POC|开发工具)/.test(ownText(p))))

section('B. 返回路径：没有系统返回键可用时，页面必须自带出路')
// navigateTo 会留下返回栈；redirectTo/reLaunch/switchTab 不会。只被后者打开的页面
// 若自己不给出口，用户就困在这一页里——这是「有入口没有返回路径」的机器可查形式。
const trapped = PAGES.filter(p => {
  if (TABS.indexOf(p) !== -1) return false
  const a = apisOf(p)
  if (a.indexOf('navigateTo') !== -1) return false
  const self = ownText(p)
  return !/wx\.(navigateTo|switchTab|reLaunch|redirectTo)\s*\(/.test(self) && !/wx\.navigateBack\s*\(/.test(self)
})
check('每一页要么由 navigateTo 打开（有系统返回键），要么自带跳走的出口',
  trapped.length === 0, trapped.join(', '))
const deniedNoExit = PAGES.filter(p => {
  const t = ownText(p)
  const i = t.indexOf('kind="denied"')
  if (i === -1) return false
  const tag = t.slice(t.lastIndexOf('<', i), t.indexOf('/>', i) + 2)
  if (/action-?[lL]abel/.test(tag) || /bind:action/.test(tag)) return false
  return TABS.indexOf(p) === -1 && apisOf(p).indexOf('navigateTo') === -1
})
check('拒绝态要么给 actionLabel 出口，要么本身由 navigateTo 打开（不让人困在「不可用」里）',
  deniedNoExit.length === 0, deniedNoExit.join(', '))

section('C. 模板不认服务端枚举：阶段/状态原文只允许出现在 JS 与 domain')
const RAW = require('../cloudfunctions/trailApi/domain/schema.js')
const phaseWords = ['draft', 'published', 'gathering', 'active', 'closing', 'archived', 'cancelled']
const statusWords = ['pending', 'confirmed', 'waitlisted', 'rejected', 'removed']
const enumInWxml = []
for (const { file, text } of FILES) {
  if (!/\.wxml$/.test(file)) continue
  for (const w of phaseWords.concat(statusWords)) {
    const re = new RegExp("===\\s*['\"]" + w + "['\"]|!==\\s*['\"]" + w + "['\"]")
    if (re.test(text)) enumInWxml.push(file + ' ~ ' + w)
  }
}
check('WXML 里不出现 phase/status 枚举原文的比较（模板只读 JS 与投影算好的布尔）',
  enumInWxml.length === 0, enumInWxml.join('; '))
check('枚举集合与 domain/schema 的声明一致（服务端加了新取值，这条门会先红，逼前端跟上）',
  phaseWords.every(w => JSON.stringify(RAW).indexOf(w) !== -1), JSON.stringify(Object.keys(RAW)))

section('D. 状态词汇只有一个来源：页面不许自造中文状态词')
const F = require('../miniprogram/utils/format.js')
const J = require('../miniprogram/utils/journey.js')
const VOCAB = []
  .concat(Object.keys(F.PHASE_LABELS).map(k => F.PHASE_LABELS[k]))
  .concat(Object.keys(F.STATUS_LABELS).map(k => F.STATUS_LABELS[k]))
  .concat(Object.keys(F.DEPARTURE_LABELS).map(k => F.DEPARTURE_LABELS[k]))
  .concat(Object.keys(F.TRIP_MODE_LABELS).map(k => F.TRIP_MODE_LABELS[k]))
const stripComments = t => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
// 零引用的旧模块：仓库的先例是「停用但保留文件」（privacy-popup 同例），所以不在这里删它，
// 但也不让它混进「在屏文案」的门。它的 roster 导出仍按 status==='active' 说话，而域里早已
// 没有这个取值——这条门同时把「它确实是死代码」钉住，一旦被 require 就必须先改文案。
const DEAD_MODULES = {
  'miniprogram/utils/util.js': '无任何文件 require 它；名单导出走服务端 readExport',
}
const requiredNames = FILES.reduce((acc, { file, text }) => {
  for (const m of text.matchAll(/require\(\s*['"][^'"]*?([A-Za-z0-9_-]+\.js)['"]\s*\)/g)) acc[m[1]] = (acc[m[1]] || 0) + 1
  return acc
}, {})
check('登记过的死模块确实无人引用（有人用了就必须先把它的旧文案改对）',
  Object.keys(DEAD_MODULES).every(f => !requiredNames[path.basename(f)]),
  Object.keys(DEAD_MODULES).join(', '))
const drift = []
for (const { file, text } of FILES) {
  if (!/\.js$/.test(file)) continue
  if (/utils[\\/](format|journey)\.js$/.test(file)) continue
  if (DEAD_MODULES[file]) continue
  const body = stripComments(text)
  for (const w of VOCAB) {
    // 只报「整页把它当文案在用」的情况：字面量里出现受管状态词
    if (new RegExp("['\"]" + w + "['\"]").test(body)) drift.push(file + ' ~ ' + w)
  }
}
check('受管状态词（阶段/报名/出发/出行方式）只在 format.js 与 journey.js 里出现',
  drift.length === 0, drift.join('; '))
check('指标位与构成行的措辞由 journey 给出，页面只做插值',
  typeof J.tripMixLine === 'function' && typeof J.fieldMetric === 'function'
  && J.tripMixLine({ confirmed: 6, selfTravel: 2, vehicleTravel: 4, assigned: 3 }) === '全部已确认 6 · 自行前往 2 · 需要乘车 4（已安排 3）'
  && J.fieldMetric('gathering').key === 'unchecked' && J.fieldMetric('closing').label === '待到家')

console.log('\n==== passed=' + passed + ' failed=' + failed + ' skipped=' + skipped + ' ====')
process.exit(failed ? 1 : 0)
