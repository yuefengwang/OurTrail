'use strict'
// PAGE2（批次 3）判据有没有牙齿：node tools/page2-gates-mutate.js
//
// 沙盒建在 %TEMP%（os.tmpdir()），逐条把「看起来也像修法」的改动注入**副本**，
// 要求 tools/page2-gates-test.js 在副本上必须报红；仍然全绿 ⇒ 那条判据是假的。
// 真实仓库一个字节都不改。
//
// 两类变异（缺一不可）：
//  · expect='red'  —— 缺陷回退 / 半个修法 / 越界改动 / 误伤合规句，必须被抓到；
//  · expect='green' —— **合法重构**（longhand 拆写、字面量改等价插值、三元改 if/else、换一句别的文案），
//    判据必须照样全绿。它红了就说明门钉的是源码文本而不是行为（铁律 30）。
//
// 四条自证纪律：
// ① 锚点命中必须恰 1 次，且必须落在真实代码行（只剩注释 ⇒ 注入失败 ⇒ 记漏网并 exit 1，不静默改错行充数）；
//    CRLF 文件里的跨行锚点按目标文件自己的 EOL 拼接（铁律 31⑥ 的"跨行锚点命中 0 次 = 静默没注入"）；
// ② 先跑「未变异副本全绿且与仓库同读数」的有效性门，否则沙盒不忠实，后面所有结论作废；
// ③ 崩红不算抓到，单列计数；
// ④ 改后文件与原件逐字节相同（等于没注入）⇒ 记注入失败。
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUITE = path.join('tools', 'page2-gates-test.js')
const HW = path.join('miniprogram', 'pages', 'weather-hub', 'weather-hub.wxml')
const HS = path.join('miniprogram', 'pages', 'weather-hub', 'weather-hub.wxss')
const AP = path.join('miniprogram', 'app.wxss')
const WW = path.join('miniprogram', 'pages', 'weather', 'weather.wxml')
const WJ = path.join('miniprogram', 'pages', 'weather', 'weather.js')

// 搬移块（A-07 的两块，逐字与仓库一致）
const PICKER = [
  '    <form-field label="查看日期">',
  '      <picker mode="date" value="{{date}}" bindchange="onDate">',
  '        <view class="picker">',
  '          <text class="picker-value">{{date}}</text>',
  '          <text class="picker-arrow">▾</text>',
  '        </view>',
  '      </picker>',
  '    </form-field>',
]
const DRAFT = '    <view wx:if="{{isOwner}}" class="button secondary block" hover-class="button-hover" bindtap="onDraftNotice">生成天气提醒草稿</view>'
const MOVED_BLOCK = PICKER.concat([''], [DRAFT])
const EMPTY_PANEL = '    <status-panel wx:else kind="{{emptyKind}}" title="{{emptyTitle || \'暂不展示天气数字\'}}" detail="{{emptyDetail || \'此路线节点没有坐标，暂无法查询天气。\'}}" action-label="重新查询" bind:action="fetchWeather" />'

const MUTATIONS = [
  /* ---------- A-23 ---------- */
  { id: 'P1', expect: 'red', file: HW, name: '原始缺陷请回来：观察点卡重新带内联 padding 归零',
    edits: [['    <view wx:if="{{points.length}}" class="card">', '    <view wx:if="{{points.length}}" class="card" style="padding:0;">']] },
  { id: 'P2', expect: 'red', file: HW, name: '半个修法：改用另一个内联 style 补 16px（数值对了，但留白不再是单源，而是每页自己写一遍）',
    edits: [['    <view wx:if="{{points.length}}" class="card">', '    <view wx:if="{{points.length}}" class="card" style="padding:16px;">']] },
  { id: 'P3', expect: 'red', file: HS, name: '假单源：页内重印一份 .card 的 16px（看着一致，影子改 app.wxss 时这张卡不跟着动）',
    edits: [{ append: true, to: '\n.card { padding: 16px; }\n' }] },
  /* ---------- A-24 ---------- */
  { id: 'P4', expect: 'red', file: HW, name: '标题改回与按钮逐字同文（缺陷本体）',
    edits: [['        <text class="card-label">有 GPX 轨迹？逐点看天气</text>', '        <text class="card-label">导入 GPX 轨迹</text>']] },
  { id: 'P5', expect: 'red', file: HW, name: '"去掉多余一行"式修法：整块 card-header 删掉（标题信息一起没了）',
    edits: [{ del: ['      <view class="card-header">', '        <text class="card-label">有 GPX 轨迹？逐点看天气</text>', '      </view>'] }] },
  { id: 'P6', expect: 'red', file: HW, name: '越界：把 GPX 按钮升成 primary（本页主行动唯一化那条刻意安排被改掉）',
    edits: [['      <view class="button secondary block" style="margin-top:12px;" hover-class="button-hover" bindtap="onImportGpx">导入 GPX 轨迹</view>',
      '      <view class="button primary block" style="margin-top:12px;" hover-class="button-hover" bindtap="onImportGpx">导入 GPX 轨迹</view>']] },
  { id: 'P7', expect: 'green', file: HW, name: '合法重构：标题换成另一句不同文的说法（判据不该钉我选的那句字）',
    edits: [['        <text class="card-label">有 GPX 轨迹？逐点看天气</text>', '        <text class="card-label">有 GPX 文件？逐点看天气</text>']] },
  /* ---------- A-26 ---------- */
  { id: 'P8', expect: 'red', file: WW, name: '逐卡免责请回来（每张结论卡各带一行）',
    edits: [{ after: '        <view wx:if="{{item.advice}}" class="pheno-advice">建议：{{item.advice}}</view>', add: '        <text class="pheno-disclaimer small muted">基于天气数据估算，非气象预报。</text>' }] },
  { id: 'P9', expect: 'red', file: WW, name: '一刀切：把区块副标题也删了（这层意思一次都不说 = 过度收敛）',
    edits: [{ del: ['        <text class="section-sub">由上方天气事实推算的条件判断，不是气象预报</text>'] }] },
  { id: 'P10', expect: 'red', file: WW, name: '误伤合规话术：页首 callout 里「不是出发许可」被删（安全话术不是可选装饰）',
    edits: [['<view class="callout warning">这是概率判断，不是出发许可。', '<view class="callout warning">这是概率判断。']] },
  { id: 'P11', expect: 'green', file: WW, name: '合法重构：副标题这句话拆成「文字 + 等价插值」两段（渲染出的仍是同一句）',
    edits: [['        <text class="section-sub">由上方天气事实推算的条件判断，不是气象预报</text>',
      '        <text class="section-sub">由上方天气事实推算的条件判断，{{\'不是气象预报\'}}</text>']] },
  /* ---------- A-07 模板 ---------- */
  { id: 'P12', expect: 'red', file: WW, name: '把日期控件与草稿按钮搬回页面最末端（脚注之后）= 原缺陷',
    edits: [{ del: MOVED_BLOCK }, { after: EMPTY_PANEL, add: MOVED_BLOCK }] },
  { id: 'P13', expect: 'red', file: WW, name: '把日期控件挪进 dayCards 分支（位置对了但可达状态被改：加载中/空态再也换不了日期）',
    edits: [{ del: MOVED_BLOCK }, { after: '    <block wx:elif="{{dayCards.length}}">', add: PICKER }] },
  { id: 'P14', expect: 'red', file: WW, name: '移动块顺手改文案：label 换成别的字（派单禁止"移动时顺手改内容"）',
    edits: [['    <form-field label="查看日期">', '    <form-field label="换个日期">']] },
  { id: 'P15', expect: 'red', file: WW, name: '移动块顺手改判据：给草稿按钮多加一个可见条件（isOwner 之外还挑数据）',
    edits: [['    ' + '<view wx:if="{{isOwner}}" class="button secondary block" hover-class="button-hover" bindtap="onDraftNotice">生成天气提醒草稿</view>'.trim(),
      '    <view wx:if="{{isOwner && dayCards.length}}" class="button secondary block" hover-class="button-hover" bindtap="onDraftNotice">生成天气提醒草稿</view>']] },
  { id: 'P16', expect: 'red', file: WW, name: '误伤渲染门槛链：loadingWeather 分支的面板标题改写（那条链是三轮真机的承重结构）',
    edits: [['<status-panel kind="loading" title="正在查询天气"', '<status-panel kind="loading" title="正在加载"']] },
  { id: 'P17', expect: 'green', file: WW, name: '合法重构：label 写成等价插值（判据必须照样绿，否则钉的是源码文本）',
    edits: [['    <form-field label="查看日期">', '    <form-field label="{{\'查看日期\'}}">']] },
  /* ---------- A-07 接线 ---------- */
  { id: 'P18', expect: 'red', file: WJ, name: 'onDate 不再置位（切日不复位视口 = 原缺陷的 JS 半边）',
    edits: [{ del: ['    // A-07：数据落地后把主图带回视口（一次性闩，消费点在 applyWeather 的 setData 回调）', '    this._revealChartAfterApply = true'] }] },
  { id: 'P19', expect: 'red', file: WJ, name: 'onDayTap 不再置位（7 日条那条链路漏接，两处承诺只兑现一处）',
    edits: [{ del: ['    // A-07：与 picker 同一条承诺——换了哪一天，就让那一天的图回到眼前', '    this._revealChartAfterApply = true'] }] },
  { id: 'P20', expect: 'red', file: WJ, name: '无条件滚（去掉一次性闩）：首屏/切节点/点重新查询都会被滚一屏',
    edits: [{ del: ['      if (this._revealChartAfterApply) {', '        this._revealChartAfterApply = false', '        this.ensureMeteogramVisible()', '      }'] },
      { after: '      this.probeStageWidth()', add: '      this.ensureMeteogramVisible()' }] },
  { id: 'P21', expect: 'red', file: WJ, name: '恢复旧分支闸：非 unified 直接 early return（经典 canvas 点位切完仍停在页尾）',
    edits: [{ after: '  ensureMeteogramVisible() {', add: '    if (!this.data.unified) return' }] },
  { id: 'P22', expect: 'red', file: WJ, name: '取数失败不清闩（承诺漏到下一次无关刷新，凭空滚一屏）',
    edits: [['    // 不清就会漏到下一次无关的成功刷新（如点「重新查询」）上，凭空滚一屏。\r\n    this._revealChartAfterApply = false',
      '    // 不清就会漏到下一次无关的成功刷新（如点「重新查询」）上，凭空滚一屏。']] },
  { id: 'P23', expect: 'red', file: WJ, name: '把"滚动失败静默"改成抛错（派单明确要求保持静默降级，失败不得阻断链路）',
    edits: [['    } catch (e) { /* 静默 */ }', '    } catch (e) { throw e }']] },
  { id: 'P24', expect: 'red', file: WJ, name: '锚点写死成云场卡（不看 data 的分支 ⇒ 经典视图滚向不在屏的对象）',
    edits: [['    const sel = this.data.unified ? \'.cloud-field-card\' : \'.timeline-card\'', '    const sel = \'.cloud-field-card\'']] },
  { id: 'P25', expect: 'green', file: WJ, name: '合法重构：三元换成 if/else 两条语句（行为逐字相同）',
    edits: [{ del: ['    const sel = this.data.unified ? \'.cloud-field-card\' : \'.timeline-card\''] },
      { after: '    if (!this.data.dayCards || !this.data.dayCards.length) return',
        add: ['    let sel', '    if (this.data.unified) {', '      sel = \'.cloud-field-card\'', '    } else {', '      sel = \'.timeline-card\'', '    }'].join('@EOL@') }] },
  /* ---------- 样式单源的等价重构 ---------- */
  { id: 'P26', expect: 'green', file: AP, name: '合法重构：.card 的 padding 简写拆成四条 longhand（层叠终值不变）',
    edits: [['.card {\r\n  padding: 16px;', '.card {\r\n  padding-top: 16px;\r\n  padding-right: 16px;\r\n  padding-bottom: 16px;\r\n  padding-left: 16px;']] },
]

/* ---------- 沙盒 ---------- */
function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'page2-mutate-'))
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, SUITE), path.join(dir, SUITE))
  return dir
}
function run(dir) {
  const r = cp.spawnSync(process.execPath, [SUITE], { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const out = (r.stdout || '') + (r.stderr || '')
  const m = out.match(/passed=(\d+)\s+failed=(\d+)/)
  return {
    code: r.status,
    passed: m ? Number(m[1]) : null,
    failed: m ? Number(m[2]) : null,
    crashed: !m,
    tail: out.split(/\r?\n/).filter(l => l.indexOf('✗') !== -1).slice(0, 3).join(' ｜ '),
  }
}
const eolOf = t => (t.indexOf('\r\n') !== -1 ? '\r\n' : '\n')
const asText = (x, eol) => (Array.isArray(x) ? x.join(eol) : String(x).replace(/@EOL@/g, eol))

function applyEdits(dir, rel, edits) {
  const file = path.join(dir, rel)
  const text = fs.readFileSync(file, 'utf8')
  const eol = eolOf(text)
  let next = text
  for (const ed of edits) {
    if (ed.append) { next = next + ed.to; continue }
    if (ed.del) {
      const find = asText(ed.del, eol)
      const hits = next.split(find).length - 1
      if (hits !== 1) return { error: '删除锚点命中 ' + hits + ' 次（要求恰 1）：' + String(ed.del).slice(0, 60) }
      next = next.split(find + eol).join('')
      if (next === text) return { error: '删除后逐字节相同（等于没注入）' }
      continue
    }
    if (ed.after) {
      const find = asText(ed.after, eol)
      const hits = next.split(find).length - 1
      if (hits !== 1) return { error: '插入锚点命中 ' + hits + ' 次（要求恰 1）：' + find.slice(0, 60) }
      next = next.replace(find, find + eol + asText(ed.add, eol))
      continue
    }
    const find = asText(ed[0], eol)
    const hits = next.split(find).length - 1
    if (hits !== 1) return { error: '锚点命中 ' + hits + ' 次（要求恰 1）：' + find.slice(0, 60) }
    next = next.replace(find, asText(ed[1], eol))
  }
  if (next === text) return { error: '改后与原件逐字节相同（等于没注入）' }
  // 注入必须落在真实代码行：如果变异只落在注释里，判据当然不动 —— 那不算抓到，算注入无效
  const codeOnly = s => s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*(\/\/.*|#[^\n]*)$/gm, ' ')
  if (codeOnly(next) === codeOnly(text)) return { error: '变异只落在注释里（真实代码行没动，等于没注入）' }
  fs.writeFileSync(file, next, 'utf8')
  return { ok: true }
}

function main() {
  console.log('== 0. 有效性门：仓库全绿 + 沙盒同读数 ==')
  const base = run(ROOT)
  if (base.crashed || base.failed !== 0) {
    console.error('✗ 仓库里的门没有全绿（failed=' + base.failed + ' code=' + base.code + '），本次自证作废')
    process.exit(1)
  }
  console.log('  ✓ 仓库门 passed=' + base.passed + ' failed=0')
  {
    const dir = makeSandbox()
    const fresh = run(dir)
    if (fresh.crashed || fresh.failed !== 0 || fresh.passed !== base.passed) {
      console.error('✗ 沙盒副本不忠实（passed=' + fresh.passed + ' failed=' + fresh.failed + ' code=' + fresh.code + '）：' + fresh.tail)
      fs.rmSync(dir, { recursive: true, force: true })
      process.exit(1)
    }
    console.log('  ✓ 未变异沙盒 passed=' + fresh.passed + ' failed=0（与仓库同读数）')
    fs.rmSync(dir, { recursive: true, force: true })
  }

  console.log('\n== 1. 逐条注入（red = 缺陷/越界/误伤，green = 合法重构） ==')
  let caught = 0, missed = 0, crashed = 0, hurt = 0, injectionFailed = 0
  for (const mut of MUTATIONS) {
    const dir = makeSandbox()
    const res = applyEdits(dir, mut.file, mut.edits)
    if (res.error) {
      injectionFailed++
      missed++
      console.error('  ✗ ' + mut.id + ' 注入失败：' + res.error + '（按漏网计，不静默改错行充数）')
      fs.rmSync(dir, { recursive: true, force: true })
      continue
    }
    const r = run(dir)
    const label = mut.expect === 'red' ? '缺陷/越界' : '等价重构'
    if (r.crashed) {
      crashed++
      console.error('  ✗ ' + mut.id + ' 崩红（门自己抛异常，不算抓到）：' + mut.name)
    } else if (mut.expect === 'red') {
      if (r.failed > 0) { caught++; console.log('  ✓ ' + mut.id + ' [' + label + '] 被抓到 failed=' + r.failed + ' ｜ ' + r.tail.slice(0, 150)) }
      else { missed++; console.error('  ✗ ' + mut.id + ' [' + label + '] 漏网（判据全绿 = 这条判据是假的）：' + mut.name) }
    } else if (r.failed > 0) {
      hurt++
      console.error('  ✗ ' + mut.id + ' [' + label + '] 等价重构被误伤 failed=' + r.failed + '（门在钉源码文本，铁律 30）：' + r.tail.slice(0, 150))
    } else {
      caught++
      console.log('  ✓ ' + mut.id + ' [' + label + '] 合法重构照样全绿 passed=' + r.passed)
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
  const redTotal = MUTATIONS.filter(m => m.expect === 'red').length
  const greenTotal = MUTATIONS.filter(m => m.expect === 'green').length
  console.log('\n变异总数=' + MUTATIONS.length + '（缺陷/越界 ' + redTotal + '，等价重构 ' + greenTotal + '）')
  console.log('抓到=' + caught + ' 漏网=' + missed + ' 崩红=' + crashed + ' 误伤=' + hurt)
  const closed = (caught + missed + crashed) === MUTATIONS.length
  console.log('闭合：抓到+漏网+崩红 = ' + (caught + missed + crashed) + ' / ' + MUTATIONS.length + (closed ? '（闭合）' : '（不闭合！）'))
  if (!closed) console.error('✗ 计数不闭合，自证作废')
  const bad = missed + crashed + hurt + injectionFailed + (closed ? 0 : 1)
  console.log(bad === 0 ? '\n==== 全部缺陷被抓、全部等价重构未误伤 ====' : '\n==== 存在漏网/崩红/误伤，见上 ====')
  process.exit(bad === 0 ? 0 : 1)
}
main()
