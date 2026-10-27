'use strict'
// Slice 0 组件行为探针（证据脚本，不是门禁，不参与 check.js）。
// 目的：证明本层新增的 observer / 失败回退 / 事件守卫真的会执行，而不是只改了样式。
// 运行：node docs/ui-ux-redesign/evidence/style-b-slice0-2026-10-26/probe-components.js
const path = require('path')

const ROOT = path.resolve(__dirname, '../../../..')
process.chdir(ROOT)

const covers = require(path.join(ROOT, 'miniprogram/utils/covers.js'))

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) {
    passed++
    console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : ''))
  } else {
    failed++
    console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : ''))
  }
}
function section(t) { console.log('\n== ' + t + ' ==') }

function loadComponent(rel) {
  let captured = null
  const prev = global.Component
  global.Component = cfg => { captured = cfg }
  delete require.cache[require.resolve(path.join(ROOT, rel))]
  require(path.join(ROOT, rel))
  global.Component = prev
  if (!captured) throw new Error('未捕获 Component 配置：' + rel)
  return captured
}

function makeHost(cfg) {
  const host = { data: Object.assign({}, cfg.data || {}), events: [] }
  host.setData = function (patch) { Object.assign(this.data, patch) }
  host.triggerEvent = function (name, detail) { this.events.push({ name, detail }) }
  Object.assign(host, cfg.methods || {})
  return host
}

// ---------- brand-header ----------
section('brand-header：variant 默认值 + 实测高度')
global.wx = {
  getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 390 }),
  getMenuButtonBoundingClientRect: () => ({ top: 48, bottom: 80, left: 296, right: 383, width: 87, height: 32 }),
}
const brand = loadComponent('miniprogram/components/brand-header/brand-header.js')
check('variant 是 String 且默认 solid', brand.properties.variant.type === String && brand.properties.variant.value === 'solid')
check('只有一个 options 键（apply-shared）', brand.options && brand.options.styleIsolation === 'apply-shared')
const brandHost = makeHost(brand)
brand.lifetimes.attached.call(brandHost)
check('measure() 写入了状态栏高度 44', brandHost.data.statusBarHeight === 44, 'statusBar=' + brandHost.data.statusBarHeight)
check('measure() 给出的条高 > 状态栏且右侧留出胶囊避让',
  brandHost.data.height > brandHost.data.statusBarHeight && brandHost.data.contentRightInset > 0,
  'height=' + brandHost.data.height + ' inset=' + brandHost.data.contentRightInset)

// ---------- next-up-card ----------
section('next-up-card：氛围图派生 + 两档失败回退 + 事件守卫')
const nuc = loadComponent('miniprogram/components/next-up-card/next-up-card.js')
check('props 未变（empty/activityId/title/facts）',
  ['empty', 'activityId', 'title', 'facts'].every(k => nuc.properties[k]) && Object.keys(nuc.properties).length === 4,
  Object.keys(nuc.properties).join(','))
const nucHost = makeHost(nuc)
// 平台会把 properties 合进 data；探针手工补这一步，否则 onOpen 的守卫永远走不到
nucHost.data.activityId = 'act-1'
nuc.observers.activityId.call(nucHost, 'act-1')
check('按 activityId 稳定取氛围图', nucHost.data.coverSrc === covers.coverFor('act-1'), nucHost.data.coverSrc)
check('备选图已准备', !!nucHost.data.coverAlt, nucHost.data.coverAlt)
const altDiffers = nucHost.data.coverAlt !== nucHost.data.coverSrc
nucHost.onCoverError()
check('第一次失败：换一张（两张不同时 src 换成 alt）',
  altDiffers ? (nucHost.data.coverSrc === nucHost.data.coverAlt && nucHost.data.coverFailed === false)
    : nucHost.data.coverFailed === true,
  'altDiffers=' + altDiffers)
nucHost.onCoverError()
check('第二次失败：退回纯色底（coverFailed=true）', nucHost.data.coverFailed === true)
const beforeEvents = nucHost.events.length
nucHost.onOpen()
check('有 id 时抛 open 事件', nucHost.events.length === beforeEvents + 1 && nucHost.events[nucHost.events.length - 1].name === 'open' &&
  nucHost.events[nucHost.events.length - 1].detail.id === 'act-1')
const emptyHost = makeHost(nuc)
emptyHost.data.empty = true
emptyHost.data.activityId = 'act-1'
emptyHost.onOpen()
check('空态点卡不抛 open（primary 在卡内）', emptyHost.events.length === 0)
emptyHost.onCreate()
check('空态 primary 抛 create', emptyHost.events.length === 1 && emptyHost.events[0].name === 'create')

// ---------- activity-card ----------
section('activity-card：flat 默认 false + 封面失败两档')
const card = loadComponent('miniprogram/components/activity-card/activity-card.js')
check('flat 是 Boolean 且默认 false', card.properties.flat.type === Boolean && card.properties.flat.value === false)
check('compact 缩略图属性未被替换', card.properties.compact.type === Boolean)
const cardHost = makeHost(card)
card.observers['cover, activityId'].call(cardHost, '', 'act-2')
check('无外部封面时按 id 派生', cardHost.data.coverSrc === covers.coverFor('act-2'))
let cardErr = 0
const warn = console.warn
console.warn = () => { cardErr++ }
cardHost.onCoverError()
check('派生图失败：直接退回纯色（coverFailed）', cardHost.data.coverFailed === true)
const cardHost2 = makeHost(card)
card.observers['cover, activityId'].call(cardHost2, '/assets/photos/real.jpg', 'act-3')
cardHost2.onCoverError()
check('实拍封面失败：先换氛围图且不判失败',
  cardHost2.data.coverSrc === cardsFallback(cardHost2) && cardHost2.data.coverFailed === false, cardHost2.data.coverSrc)
cardHost2.onCoverError()
check('氛围图也失败：才判失败', cardHost2.data.coverFailed === true)
console.warn = warn
check('失败回退会留下 warn（不是静默）', cardErr >= 2, cardErr + ' 条')
function cardsFallback(host) { return covers.coverFor('act-3') }

card.observers.chips.call(cardHost, [{ key: 'date', text: '10-30' }, { key: 'distance', text: '8 km' }])
check('featured 的 restChips 过滤掉日期', cardHost.data.restChips.length === 1 && cardHost.data.restChips[0].key === 'distance')

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
