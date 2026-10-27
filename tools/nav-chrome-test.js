// 导航底色契约（style-B 批次二 b，2026-10-26）。
// 背景：app.json 的 window 长期是深绿 #163E35/白字，而 14 个页面各自声明了米白/黑字；
// 7 个没声明的页面（signup/editor/weather/weather-chart/privacy/lab/cloud-field-poc）
// 于是顶着深绿导航、主体却是米白 —— 同一产品两种顶栏，且没有任何套件钉住它。
// 这门钉的是**配置契约**，不是源码文本：任何页面都不许把导航底色改成别的值。
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')

const LIGHT = { bg: '#f5f5f0', text: 'black' }
const BRAND = '#163e35'

let passed = 0, failed = 0
function check(name, ok, extra) {
  if (ok) { passed++; console.log('  PASS ' + name) }
  else { failed++; console.error('  FAIL ' + name + (extra === undefined ? '' : ' → ' + extra)) }
}
function section(t) { console.log('\n== ' + t + ' ==') }

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
const norm = v => String(v == null ? '' : v).trim().toLowerCase()

// 判定核：只回答「这份页面 json 的导航声明是否与全站浅底黑字一致」。
// 未声明 = 继承 app.json（继承值由 §1 单独钉住）。
function judgePageNav(json) {
  const out = { ok: true, inherits: false, reasons: [] }
  if (json.navigationBarBackgroundColor === undefined && json.navigationBarTextStyle === undefined) {
    out.inherits = true
    return out
  }
  if (json.navigationBarBackgroundColor !== undefined && norm(json.navigationBarBackgroundColor) !== LIGHT.bg) {
    out.ok = false
    out.reasons.push('底色=' + json.navigationBarBackgroundColor)
  }
  if (json.navigationBarTextStyle !== undefined && norm(json.navigationBarTextStyle) !== LIGHT.text) {
    out.ok = false
    out.reasons.push('字色=' + json.navigationBarTextStyle)
  }
  // 只声明了一项也要与另一项的全站口径一致：缺的那项由 app.json 继承，而 app.json 已在 §1 钉死。
  return out
}

const app = readJson(path.join(MP, 'app.json'))
const win = app.window || {}

section('§1 全站默认（继承源）')
check('app.json window 导航底色 = #F5F5F0（米白）', norm(win.navigationBarBackgroundColor) === LIGHT.bg, win.navigationBarBackgroundColor)
check('app.json window 导航字色 = black', norm(win.navigationBarTextStyle) === LIGHT.text, win.navigationBarTextStyle)
check('下拉背景底色 = #F5F5F0（与导航同值，滚动时不露色缝）', norm(win.backgroundColor) === LIGHT.bg, win.backgroundColor)

section('§2 页面级声明：只允许同一对浅底黑字')
const pageDirs = fs.readdirSync(path.join(MP, 'pages'), { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
const declared = []
const inherit = []
const broken = []
for (const dir of pageDirs) {
  const file = path.join(MP, 'pages', dir, dir + '.json')
  if (!fs.existsSync(file)) continue
  let json
  try { json = readJson(file) } catch (e) { broken.push(dir + ' (JSON 解析失败: ' + e.message + ')'); continue }
  const res = judgePageNav(json)
  if (!res.ok) broken.push(dir + ' ' + res.reasons.join(' '))
  else if (res.inherits) inherit.push(dir)
  else declared.push(dir)
}
check('app.json pages 列出的页面与页面目录一一对应（' + app.pages.length + ' 页）',
  app.pages.length === pageDirs.length, 'pages=' + app.pages.length + ' dirs=' + pageDirs.length)
check('没有页面把导航底色/字色改成浅底黑字以外的值', broken.length === 0, broken.join(' | '))
check('每份页面 json 都被分类（显式声明 / 继承），没有漏扫',
  inherit.length + declared.length === pageDirs.length,
  'inherit=' + inherit.length + ' declared=' + declared.length + ' dirs=' + pageDirs.length)
check('至少有一个页面显式声明浅底黑字（否则本门只是在核一把没人用的尺）', declared.length > 0, 'declared=' + declared.length)
console.log('    继承默认导航色（' + inherit.length + ' 页）：' + (inherit.join(' / ') || '（无）'))

section('§3 品牌强调色没有被「统一浅色」顺手改掉')
const tabBar = app.tabBar || {}
check('tabBar.selectedColor 仍是品牌绿 #163E35', norm(tabBar.selectedColor) === BRAND, tabBar.selectedColor)
check('tabBar.backgroundColor 仍是 #FFFFFF', norm(tabBar.backgroundColor) === '#ffffff', tabBar.backgroundColor)

section('§4 牙齿：判定核对错得起来')
const green = judgePageNav({ navigationBarBackgroundColor: '#163E35', navigationBarTextStyle: 'white' })
check('合成「深绿 + 白字」必须判红（回归就是这样发生的）', !green.ok && green.reasons.length === 2, JSON.stringify(green.reasons))
const halfGreen = judgePageNav({ navigationBarBackgroundColor: '#163E35' })
check('只写底色、不写字色也必须判红（半份声明不能过关）', !halfGreen.ok, JSON.stringify(halfGreen.reasons))
const halfWhite = judgePageNav({ navigationBarTextStyle: 'white' })
check('只写字色、不写底色也必须判红', !halfWhite.ok, JSON.stringify(halfWhite.reasons))
const lightPair = judgePageNav({ navigationBarBackgroundColor: '#F5F5F0', navigationBarTextStyle: 'black' })
check('合成「浅底黑字」必须判绿', lightPair.ok && !lightPair.inherits)
const caseInsensitive = judgePageNav({ navigationBarBackgroundColor: '#f5f5f0', navigationBarTextStyle: 'BLACK' })
check('大小写不改变判定（#f5f5f0 / BLACK 与现值同义）', caseInsensitive.ok)
const missing = judgePageNav({})
check('完全未声明 = 继承，不算违规但也不算显式声明', missing.ok && missing.inherits)

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
