// 天气页 V3 视觉门：皮肤变量封闭表、字号档、触控尺寸、无卡片语言。
// 运行：node tools/weather-v3-visual-test.js
//
// 判据来源：实施文档 §6.1–§6.4 与 D2（天气页允许单独一套皮肤）。
// 「封闭表」的意思是：**新增一个色值必须先改这张表**，不是"看到新颜色就放行"。
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const FILES = [
  'components/weather-detail/weather-detail.wxss',
  'components/weather-plan-sheet/weather-plan-sheet.wxss',
  'pages/weather-hub/weather-hub.wxss',
]
const rd = p => fs.readFileSync(path.join(MP, p), 'utf8')
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '')

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; return }
  failed++
  console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
}
function section(t) { console.log('\n§ ' + t) }

// 皮肤变量（§6.1 唯一一张表）
const SKIN = {
  '--w-green': '#16783E',
  '--w-green-soft': '#EDF7ED',
  '--w-bg': '#FFFFFF',
  '--w-ink': '#18211B',
  '--w-muted': '#69716B',
  '--w-line': '#E8ECE7',
  '--w-pale': '#F5F7F4',
  '--w-blue': '#4186AA',
  '--w-teal': '#457E78',
  '--w-amber': '#A87928',
}

// 几何变量（不是皮肤）：值由组件实测后在 wxml 行内覆盖。与 SKIN 分表，
// 因为「新增一个颜色必须先改这张表」这条约束只该管颜色；混进几何会让色表失去意义。
const GEOMETRY = { '--wv3-chrome': '64px' }

// 封闭色表：每一项都在 design-system.md §17 登记过（皮肤 + 中性灰 + 图表变量 + 语义色）
const PALETTE = new Set([
  // 皮肤
  '#16783E', '#EDF7ED', '#FFFFFF', '#18211B', '#69716B', '#E8ECE7', '#F5F7F4', '#4186AA', '#457E78', '#A87928',
  // 中性灰（副文/轴/图例）
  '#657168', '#6B756D', '#707971', '#6C766E', '#7A877B', '#758078', '#89938B', '#667269', '#737C75', '#748078',
  '#747E76', '#69766D', '#6D7870', '#859087', '#6B776F', '#738077', '#6C7C70', '#4C5F51', '#6C776E', '#788278',
  '#65725F', '#7A847A', '#727B6C', '#8A8578', '#6F7369', '#788171', '#708076', '#8B958C', '#7B857C', '#6D7A70',
  '#7D877C', '#68766A', '#6F7A72', '#79837A', '#77817A', '#8A968C', '#758070', '#5B675E', '#3C4A41', '#5B675E',
  // 绿系（选中/浅底/深字）
  '#EEF6ED', '#E4F2E6', '#145F32', '#213D2A', '#2C5A38', '#2C3C31', '#365B3B', '#3C5544', '#22402D', '#506650',
  '#3D4B41', '#DCEDD9', '#D5E2D3', '#F2F6F0', '#F2F5F1', '#F7F9F5', '#F0F2EF', '#F5F7F4', '#EDF0EC', '#F4F5F1',
  '#F1F3EE', '#F3F1EE', '#F6F3EA', '#F2F6F0', '#EDF1E9',
  // 图表变量（温度/体感/风/阵风/降水）
  '#263E35', '#A6B5AB', '#427B72', '#83A9A4', '#69A5C6', '#73AACA', '#48584E',
  // 灰阶斜坡端点（云量图例）
  '#C4CCC3', '#7E8C80', '#354C3D', '#7C9A83',
  // 语义色（错误/警示/琥珀文字）
  '#96403C', '#F9ECEB', '#7A5C1E',
])

const FONT_ALLOWED = [9, 10, 11, 12, 13, 14, 16, 17, 18, 21, 24, 25, 26, 34]
// 「9–11px 只允许出现在图表轴、图例、日期条、副行」——按选择器名判（登记过的角色）
const SMALL_TEXT_CTX = /(axis|label|unit|legend|lg-|caption|hint|foot|note|sub|meta|day|hour|pill|tag|clock|time-sub|sec-meta|range|cell-label|chev|caret|read|node|source|banner|warn|period|link|cloud|elev|fact|sky|overall|notice|quiet|arrow|columns|error|eyebrow|asset|group|track|retry|clear)/
// 触控：必须是 ≥44 的主/次行动（§6.4）
const TAPPABLE_44 = [
  ['components/brand-header/brand-header.wxss', '.brand-header__back'],
  ['components/weather-detail/weather-detail.wxss', '.wv3-btn'],
  ['components/weather-detail/weather-detail.wxss', '.wv3-tab'],
  ['components/weather-detail/weather-detail.wxss', '.wv3-link-row'],
  ['components/weather-detail/weather-detail.wxss', '.wv3-node-option'],
  ['components/weather-plan-sheet/weather-plan-sheet.wxss', '.wp-input'],
  ['components/weather-plan-sheet/weather-plan-sheet.wxss', '.wp-btn'],
  ['pages/weather-hub/weather-hub.wxss', '.wh-primary'],
  ['pages/weather-hub/weather-hub.wxss', '.wh-row-btn'],
  ['pages/weather-hub/weather-hub.wxss', '.wh-asset'],
  ['pages/weather-hub/weather-hub.wxss', '.wh-place-row'],
]
// 次级、非主路径（§6.4 允许 <44，但必须在这里登记）
const SECONDARY_SMALL = [
  ['components/weather-detail/weather-detail.wxss', '.wv3-step', 34, '前后步进；有 slider 与点列两条等价路径'],
  ['components/weather-detail/weather-detail.wxss', '.wv3-hour', 30, '小时列的宽度＝图表列宽（24h 一屏时约 12.5px），不是独立按钮；精确选时有滑块与前后步进'],
  ['components/weather-detail/weather-detail.wxss', '.wv3-link', 0, '文字链接（读图说明 / 重取节点天气）'],
  ['pages/weather-hub/weather-hub.wxss', '.wh-inline-link', 0, '文字链接（重新读取计划）'],
  ['components/weather-plan-sheet/weather-plan-sheet.wxss', '.wp-time-clear', 0, '文字动作（把抵达时刻改回待安排；时间本身仍可再选）'],
]

function rulesOf(text) {
  const out = []
  const src = stripComments(text)
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(src))) {
    const sel = m[1].trim()
    const decls = m[2].split(';').map(x => x.trim()).filter(Boolean).map(x => {
      const i = x.indexOf(':')
      return { prop: x.slice(0, i).trim(), val: x.slice(i + 1).trim() }
    })
    out.push({ sel, decls })
  }
  return out
}
function decl(rules, sel, prop) {
  for (let i = rules.length - 1; i >= 0; i--) {
    if (rules[i].sel !== sel) continue
    const d = rules[i].decls.filter(x => x.prop === prop)[0]
    if (d) return d.val
  }
  return null
}

/* ------------------------------------------------------------------ */
section('§1 皮肤变量封闭表')

{
  const text = rd('components/weather-detail/weather-detail.wxss')
  const rules = rulesOf(text)
  const root = rules.filter(r => r.sel === '.weather-v3')[0]
  check('根节点真的声明了皮肤变量（判据输入存在）', !!root)
  const declared = root ? root.decls.filter(d => /^--w-/.test(d.prop)) : []
  check('声明的 --w-* 恰好 10 个（= §6.1 表）', declared.length === 10, declared.map(d => d.prop))
  const wrong = declared.filter(d => SKIN[d.prop] && String(d.val).toUpperCase() !== SKIN[d.prop])
  check('每个变量的值与登记表逐字一致', wrong.length === 0, wrong.map(d => d.prop + '=' + d.val))
  const unknown = declared.filter(d => !SKIN[d.prop])
  check('没有表外的自定义属性', unknown.length === 0, unknown.map(d => d.prop))

  const sheet = rd('components/weather-plan-sheet/weather-plan-sheet.wxss')
  const allVars = new Set()
  FILES.forEach(f => (stripComments(rd(f)).match(/--[a-z][\w-]*\s*:/g) || []).forEach(x => allVars.add(x.replace(/\s*:$/, ''))))
  const registered = v => Object.prototype.hasOwnProperty.call(SKIN, v) || Object.prototype.hasOwnProperty.call(GEOMETRY, v)
  check('三个文件里出现的自定义属性都在登记表内（皮肤表或几何表）',
    Array.from(allVars).every(registered),
    Array.from(allVars).filter(v => !registered(v)))

  // 几何变量同样要闭合：值可核、且必须真的被 var() 消费（写成没人读的声明就是第二个真值源）
  const geoDeclared = rulesOf(text)
    .flatMap(r => r.decls.filter(d => Object.prototype.hasOwnProperty.call(GEOMETRY, d.prop)))
  check('几何变量只登记了 --wv3-chrome，值与表逐字一致',
    geoDeclared.length === 1 && GEOMETRY[geoDeclared[0].prop] === geoDeclared[0].val,
    geoDeclared.map(d => d.prop + '=' + d.val))
  check('几何变量真的被消费（不是只定义不读）',
    /var\(--wv3-chrome\)/.test(stripComments(text)))
  check('弹层组件自带同名变量（组件作用域自包含，值仍来自登记表）', /--w-green:\s*#16783E/.test(sheet))
}

/* ------------------------------------------------------------------ */
section('§2 色值封闭：不出现表外颜色')

{
  FILES.forEach(f => {
    const colors = Array.from(new Set((stripComments(rd(f)).match(/#[0-9a-fA-F]{3,8}\b/g) || []).map(x => x.toUpperCase())))
    const out = colors.filter(c => !PALETTE.has(c))
    check(f + '：色值全部在封闭表内（' + colors.length + ' 种）', out.length === 0, out)
  })
  const detail = stripComments(rd('components/weather-detail/weather-detail.wxss'))
  check('没有 hsl() 动态色（会绕过封闭表）', !/hsl\(/.test(detail), '')
  check('没有 color-mix / :root / dvh（平台不支持或全站禁用）',
    !/color-mix|:root|dvh|svh|lvh/.test(FILES.map(rd).join('\n')))
}

/* ------------------------------------------------------------------ */
section('§3 字号档：9–11px 只出现在轴/图例/日期条/副行')

{
  const bad = []
  FILES.forEach(f => {
    rulesOf(rd(f)).forEach(r => {
      r.decls.filter(d => d.prop === 'font-size').forEach(d => {
        const px = Number(String(d.val).replace('px', ''))
        if (!Number.isFinite(px)) return
        if (FONT_ALLOWED.indexOf(px) === -1) bad.push(f + ' ' + r.sel + '=' + px)
        if (px < 12 && !SMALL_TEXT_CTX.test(r.sel)) bad.push(f + ' ' + r.sel + '=' + px + '(正文位)')
      })
    })
  })
  check('字号只用登记档（9/10/11/12/13/14/16/17/18/21/24/25/26/34），且 9–11 只在允许位置',
    bad.length === 0, bad)
  const detail = rulesOf(rd('components/weather-detail/weather-detail.wxss'))
  check('主标题 24px（原型 h1 24–26px 的下限）', decl(detail, '.wv3-place-name', 'font-size') === '24px')
  check('主温 34px', decl(detail, '.wv3-temp', 'font-size') === '34px')
  const hub = rulesOf(rd('pages/weather-hub/weather-hub.wxss'))
  check('首页大标题 25px', decl(hub, '.wh-title', 'font-size') === '25px')
}

/* ------------------------------------------------------------------ */
section('§4 触控：主/次行动 ≥44px，次级文字按钮逐个登记')

{
  TAPPABLE_44.forEach(([f, sel]) => {
    const rules = rulesOf(rd(f))
    const h = decl(rules, sel, 'min-height') || decl(rules, sel, 'height')
    const px = Number(String(h || '').replace('px', ''))
    check(f.split('/').pop() + ' ' + sel + ' 触控高度 ≥44', Number.isFinite(px) && px >= 44, h)
  })
  SECONDARY_SMALL.forEach(([f, sel, px, why]) => {
    const rules = rulesOf(rd(f))
    const h = Number(String(decl(rules, sel, 'min-height') || decl(rules, sel, 'height') || '0').replace('px', ''))
    check('次级控件 ' + sel + ' 已登记且高度不超过 ' + (px || '文字') + 'px（理由：' + why + '）', (px === 0 || h <= px), h)
  })
  const detail = rd('components/weather-detail/weather-detail.wxss')
  check('主页面没有 44px 以下的实心行动按钮', !/\.wv3-btn[^}]*min-height:\s*([0-3]\d)px/.test(detail), '')
}

/* ------------------------------------------------------------------ */
section('§5 视觉语言：无卡片、无阴影泛滥、无渐变滥用')

{
  const all = FILES.map(rd).join('\n')
  check('天气页不使用 .card（D2 的无卡片语言）', !/\.card\b/.test(all))
  const detail = rd('components/weather-detail/weather-detail.wxss')
  const shadows = (detail.match(/box-shadow:/g) || []).length
  check('阴影只在息票/选中态上用（≤2 处）', shadows <= 2, shadows)
  const gradients = (detail.match(/linear-gradient/g) || []).length
  check('渐变只用于云量图例与色带（≤2 处）', gradients <= 2, gradients)
  check('没有 !important 硬覆盖', !/!important/.test(all))
}

console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)