// UI 一致性门禁：node tools/ui-consistency-test.js
// 目的：把两轮 UI 重构里「靠人眼才发现」的布局/规范问题变成会红的门禁。
//
// 背景（每条都是真机上抓到或审计里查出的真问题，不是假想）：
//  ① 自定义 tabBar 是 fixed 覆盖层：tab 页必须自己留出 84px + 安全区，否则页尾内容被压住。
//     仓库约定的落法是**每个 tab 页自己的 wxss** 写 .page 的 padding-bottom
//     （miniprogram/AGENTS.md:96 明确写了这条口径），而不是抽一条公共类——
//     本门按这个约定断言，并且反向要求非 tab 页不得留这截空白（anotices 就是反例）。
//  ② privacy 页曾用 .container/.h1/.h2，而这三个类全站无定义 ⇒ 标题按正文默认字号渲染。
//  ③ 封面用「绝对定位 + 百分比高」的 <image> 在部分基础库上不绘制（第一轮真机实测）。
//  ④ 门禁会钉住选择器与布局类（scenario-vehicle钉了 `<view wx:else class="stack">`），
//     所以这里的断言都写成「读 app.json / 读 WXSS 的规则本身」，不写死某个页面的具体写法。
//
// 判定口径：只断言「跨页面的系统事实」，不冻结任何单页的视觉细节——单页细节归设计评审。
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

function walk(dir, ext, out) {
  out = out || []
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, ext, out)
    else if (ext.some(e => n.endsWith(e))) out.push(p)
  }
  return out
}
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/')
const appJSON = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'))
const appWxss = fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8')
const wxssFiles = walk(MP, ['.wxss'])
const wxmlFiles = walk(MP, ['.wxml'])
const allWxss = wxssFiles.map(f => ({ f, src: fs.readFileSync(f, 'utf8') }))

/* ---------- §1 tabBar 底隙：tab 页按仓库约定在自己 wxss 里留位，非 tab 页不留 ---------- */
section('§1 自定义 tabBar 底隙（fixed 覆盖层 ⇒ 页面必须自己让位）')
const tabPages = appJSON.tabBar.list.map(x => x.pagePath)
check('T1.1 app.json 仍用自定义 tabBar（custom=true，覆盖层语义）', appJSON.tabBar.custom === true)
{
  // 约定口径见 miniprogram/AGENTS.md:96 —— 每个 tab 页自己的 wxss 写
  // .page { padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom)) }
  const wantRe = /padding-bottom:\s*calc\(\s*32px\s*\+\s*84px\s*\+\s*env\(safe-area-inset-bottom\)\s*\)/
  const missing = tabPages.filter(p => {
    const f = path.join(MP, p + '.wxss')
    if (!fs.existsSync(f)) return true
    return !wantRe.test(fs.readFileSync(f, 'utf8'))
  })
  check('T1.2 每个 tab 页在自己的 wxss 里留出 84px + 安全区（AGENTS.md:96 约定）',
    missing.length === 0, missing.join(', ') || tabPages.join(', '))
  // 反向：非 tab 页留这截空白 = 给不存在的 tabBar 让位（anotices 是活动内子页，反例）
  const over = wxmlFiles.map(f => rel(f)).filter(f => {
    const base = 'miniprogram/' + f
    if (tabPages.some(p => base === 'miniprogram/' + p + '.wxml')) return false
    const wxss = path.join(ROOT, base.replace(/\.wxml$/, '.wxss'))
    if (!fs.existsSync(wxss)) return false
    return wantRe.test(fs.readFileSync(wxss, 'utf8'))
  })
  check('T1.3 非 tab 页不留 tabBar 的 84px（列表短时页尾会空一大截）', over.length === 0, over.join(', ') || 'ok')
  // 真正要防的是「两种落法叠加」= 既有每页公式又抽公共类（白留两截 84px）。
  // 注意：home 根节点上那个条件类 {{…? 'with-tabbar' : ''}} 是仓库登记在册的**空开关**
  //（app.wxss 不定义它；b4-pad-final-value 与 swx1 都按这个形状钉），本门不得逼它删。
  const sharedRule = /\.page\.with-tabbar\s*\{/.test(appWxss)
  check('T1.4 不与公共类方案叠加（app.wxss 若也定义 .page.with-tabbar，就会多留 84px 死空白）',
    !sharedRule, sharedRule ? 'app.wxss 定义了 .page.with-tabbar，与每页公式并存' : 'ok')
}

/* ---------- §2 固定底栏与 has-sticky 必须成对 ---------- */
section('§2 固定底栏（sticky-action）与页面留白成对')
{
  const stickyPages = wxmlFiles.filter(f => /class="[^"]*\bsticky-action\b/.test(fs.readFileSync(f, 'utf8')))
  check('T2.1 至少有一个页面在用固定底栏（本轮把报名/编辑器也纳入了）', stickyPages.length >= 3, stickyPages.map(rel).join(', '))
  const bad = stickyPages.filter(f => {
    const src = fs.readFileSync(f, 'utf8')
    return !/has-sticky/.test(src)
  })
  check('T2.2 每个用固定底栏的页面都配了 has-sticky 留白（否则页尾被压住）', bad.length === 0, bad.map(rel).join(', ') || stickyPages.map(rel).join(', '))
  // sticky 底栏的显隐条件必须与 has-sticky 同源（g2-platform-gate 的口径在页面层再钉一次）
  const mism = wxmlFiles.filter(f => {
    const src = fs.readFileSync(f, 'utf8')
    if (!/has-sticky/.test(src)) return false
    const m = src.match(/class="page \{\{([^}]*)\}\}"/)
    if (!m) return true
    return !/sticky-action/.test(src)
  })
  check('T2.3 has-sticky 的条件表达式与底栏 wx:if 同源（同一条件的两种写法视为同源）', mism.length === 0, mism.map(rel).join(', ') || 'ok')
}

/* ---------- §3 封面：定高媒体盒 + 文档流图片（平台坑） ---------- */
section('§3 封面绘制路径（绝对定位+百分比高在部分基础库不绘制）')
{
  const heroPages = wxmlFiles.filter(f => /class="[^"]*\bhero-cover\b/.test(fs.readFileSync(f, 'utf8')))
  // 2026-10-23 跨页重构：路线详情改为「地图优先」构图（路线模型没有图片字段，首屏给空间信息），
  // 原「活动详情 + 路线详情两处复用」的前提已不存在。改为「机制仍在使用 + 确有页面注册组件」，
  // T3.2–T3.4 继续对全部使用处生效；若整条机制被删，这两条会一起红。
  check('T3.1 至少一个页面使用 hero-cover 封面机制（2026-10-23 起由活动详情承载）', heroPages.length >= 1, heroPages.map(rel).join(', '))
  const heroUsers = walk(MP, ['.json']).filter(f => /"activity-hero"\s*:/.test(fs.readFileSync(f, 'utf8')))
  check('T3.1b hero-cover 机制确有页面注册（不是只剩组件里的死样式）', heroUsers.length >= 1, heroUsers.map(rel).join(', ') || '无人注册 activity-hero')
  const mBox = /\.hero-cover-media\s*\{[^}]*height:\s*(\d+)px/
  const h = mBox.exec(appWxss)
  check('T3.2 媒体盒是定高（px）而不是百分比高', !!h, h ? 'height=' + h[1] + 'px' : '未找到 .hero-cover-media 的定高规则')
  const absImg = heroPages.filter(f => {
    const src = fs.readFileSync(f, 'utf8')
    const imgTag = (src.match(/<image[^>]*hero-cover-img[^>]*>/) || [''])[0]
    return /position:\s*absolute/.test(imgTag)
  })
  check('T3.3 封面 <image> 不写成绝对定位（走文档流绘制，微信里最稳）', absImg.length === 0, absImg.map(rel).join(', ') || 'ok')
  const noErr = heroPages.filter(f => !/binderror="/.test(fs.readFileSync(f, 'utf8')))
  check('T3.4 每个 hero-cover 都绑了 binderror 回退（破图零容忍）', noErr.length === 0, noErr.map(rel).join(', ') || 'ok')
}

/* ---------- §4 死类普查：模板里用了、但全站样式都没定义的类 ---------- */
section('§4 死类普查（WXML 用了、任何 WXSS 都没定义 ⇒ 样式静默失效）')
{
  const defined = new Set()
  for (const { src } of allWxss) {
    for (const m of src.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1])
  }
  // 微信内置/框架类与本项目约定的非样式类（不进判据）
  const IGNORE = new Set(['native', 'open-type', 'catchtap', 'bindtap'])
  // 「静态前缀 + 插值」在运行时才拼成类名（tone-{{statusTone}} ⇒ tone-doing），静态判不出取值，
  // 按 m02-class-scope-rules 的同一口径排除。带 `--`/`-` 尾巴的静态片段都是前缀，不是类名。
  function staticClassesOf(classAttr) {
    const out = []
    for (const raw of classAttr.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean)) {
      if (IGNORE.has(raw)) continue
      if (raw.endsWith('--')) { const base = raw.slice(0, -2); if (base) out.push(base); continue }
      if (raw.endsWith('-')) continue
      out.push(raw)
    }
    return out
  }
  const probe = staticClassesOf('__probe_dead__ tone-{{item.statusTone}} status-panel--{{kind}}')
  check('T4.0 死类普查器自身有效：静态死类仍被抓、动态前缀不误报',
    probe.length === 2 && probe[0] === '__probe_dead__' && probe[1] === 'status-panel', probe.join(','))
  const dead = []
  for (const f of wxmlFiles) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\bclass="([^"]*)"/g)) {
      for (const c of staticClassesOf(m[1])) {
        if (!defined.has(c)) dead.push(rel(f) + ' :: .' + c)
      }
    }
  }
  // 组件根标签上常见的样式类由组件自身 WXSS 定义（已并入 defined），此处只报真死类
  const uniq = Array.from(new Set(dead))
  check('T4.1 模板里没有「全站无定义」的类（privacy 的 .h1/.h2 与 .with-tabbar 当年就是这样查出来的）',
    uniq.length === 0, uniq.slice(0, 12).join(' | ') || '0 处')
  check('T4.2 普查器自身有效：确实读到了模板与样式（否则上一条会假绿）',
    wxmlFiles.length >= 30 && defined.size >= 100, 'wxml=' + wxmlFiles.length + ' 定义类=' + defined.size)
}

/* ---------- §5 小屏静态口径：375 宽内容区 335px，不得有超宽的固定宽度 ---------- */
section('§5 小屏（375px）静态口径 —— 真机换机型需人工，这里钉住可静态判定的部分')
{
  const LIM = 335 // 375 − .page 左右 20×2
  // 横滚容器里的宽表是合法例外（天气页 .num-table min-width:760px 是「全字段横滚表」，
  // 本来就要横着滑）。先按模板找出 scroll-view 块里的类，把它们排除在本节判据外，
  // 否则这条门会逼人把专业数据表压成手机屏宽度——那才是真回退。
  const scrollScoped = new Set()
  for (const f of wxmlFiles) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/<scroll-view[^>]*>([\s\S]*?)<\/scroll-view>/g)) {
      for (const cm of m[1].matchAll(/\bclass="([^"]*)"/g)) {
        for (const c of cm[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean)) scrollScoped.add(c)
      }
    }
  }
  const offenders = []
  for (const { f, src } of allWxss) {
    if (rel(f).includes('custom-tab-bar')) continue
    for (const m of src.matchAll(/(^|[;{\s])(width|min-width)\s*:\s*(\d{3,4})px/g)) {
      const n = Number(m[3])
      if (n <= LIM) continue
      const head = src.slice(0, m.index)
      const ruleStart = head.lastIndexOf('}')
      const rule = src.slice(ruleStart + 1, m.index)
      const cls = (rule.match(/^\s*\.([\w-]+)/) || [])[1]
      if (cls && scrollScoped.has(cls)) continue
      offenders.push(rel(f) + ' :: .' + (cls || '?') + ' ' + m[2] + ':' + n + 'px')
    }
  }
  check('T5.1 没有超过 375 内容区（335px）的固定宽度声明（横滚容器内的宽表按设计豁免）',
    offenders.length === 0, offenders.join(' | ') || '0 处')
  check('T5.1b 横滚豁免不是空跑：天气页的全字段横滚表确实被识别为豁免项',
    scrollScoped.has('num-table') === true, 'scroll-view 内识别到的类样本：' + Array.from(scrollScoped).slice(0, 6).join(', '))
  // 关键弹性约束：英雄指标与工作台指标是多格 flex，必须 min-width:0 才不会撑破小屏
  const metrics = /(^|[};])\s*\.metrics\s*\{([^}]*)\}/m.exec(appWxss)
  check('T5.2 顶层 .metrics 是多格 flex 且 .metric 有 min-width:0（小屏下数字不会把容器撑破）',
    !!metrics && /display:\s*flex/.test(metrics[2]) && /\.metric\s*\{[^}]*min-width:\s*0/.test(appWxss),
    metrics ? '.metrics {' + metrics[2].replace(/\s+/g, ' ') : '未找到顶层 .metrics')
  check('T5.3 hero 大标题与事实值都有断词保护（.display word-break / .fact-value word-break）',
    /\.display\s*\{[^}]*word-break/.test(appWxss) && /\.fact-row \.fact-value\s*\{[^}]*word-break/.test(appWxss))
}

console.log('\n== 汇总 ==\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
