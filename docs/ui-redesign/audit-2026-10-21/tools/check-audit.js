'use strict'
/* 审计交付完整性检查（只核对，不删除、不修改） */
const fs = require('fs')
const path = require('path')
const BASE = path.resolve(__dirname, '..')
let fail = 0
const bad = m => { console.log('FAIL ' + m); fail++ }
const ok = m => console.log('ok   ' + m)

// 1. manifest 存在且每条 file 都存在
const mf = JSON.parse(fs.readFileSync(path.join(BASE, 'capture-manifest.json'), 'utf8'))
let missing = 0
for (const it of mf.items) {
  if (!fs.existsSync(path.join(BASE, it.file))) { bad('manifest 引用不存在: ' + it.file); missing++ }
}
if (!missing) ok('manifest ' + mf.items.length + ' 条记录的截图全部存在')

// 2. screenshots/ 中每个 png 都在 manifest 里（反向核对）
const listed = new Set(mf.items.map(i => i.file))
let extra = 0
function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    const r = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) walk(p, r)
    else if (e.name.endsWith('.png')) {
      const key = 'screenshots/' + r.replace(/\\/g, '/')
      if (!listed.has(key)) { bad('截图未登记在 manifest: ' + key); extra++ }
    }
  }
}
walk(path.join(BASE, 'screenshots'), '')
if (!extra) ok('screenshots/ 全部图片均在 manifest 中')

// 3. 21 个注册页面每页至少 1 张截图
const pages = JSON.parse(fs.readFileSync(path.join(BASE, '..', '..', '..', 'miniprogram', 'app.json'), 'utf8')).pages
const shotIds = new Set(mf.items.map(i => i.pageId))
const ID_BY_PAGE = {
  'pages/home/home': 'HOME', 'pages/weather-hub/weather-hub': 'WEATHER-HUB',
  'pages/notices/notices': 'NOTICES', 'pages/me/me': 'ME',
  'pages/activity/activity': 'ACT-DETAIL', 'pages/discover/discover': 'DISCOVER',
  'pages/signup/signup': 'SIGNUP', 'pages/editor/editor': 'ACT-CREATE',
  'pages/routes/routes': 'ROUTES', 'pages/route/route': 'ROUTE',
  'pages/route-edit/route-edit': 'ROUTE-EDIT', 'pages/workspace/workspace': 'WORKSPACE',
  'pages/tasks/tasks': 'TASKS', 'pages/staff/staff': 'STAFF',
  'pages/vehicle/vehicle': 'VEHICLE', 'pages/weather/weather': 'WEATHER',
  'pages/weather-chart/weather-chart': 'WEATHER-CHART', 'pages/anotices/anotices': 'ANOTICES',
  'pages/lab/lab': 'LAB', 'pages/privacy/privacy': 'PRIVACY',
  'pages/cloud-field-poc/cloud-field-poc': 'CLOUD-POC',
}
let noShot = 0
for (const p of pages) {
  const id = ID_BY_PAGE[p]
  if (!id) { bad('页面无 ID 映射: ' + p); noShot++; continue }
  if (!shotIds.has(id)) { bad('注册页面无截图: ' + p + ' (' + id + ')'); noShot++ }
}
if (!noShot) ok(pages.length + ' 个注册页面全部有截图')

// 4. 文档中引用的截图路径真实存在
const DOCS = ['README.md', 'environment.md', 'product-map.md', 'page-inventory.csv',
  'interaction-flows.md', 'interaction-issues.md', 'design-system-audit.md',
  'evidence/test-results.md', 'evidence/blockers.md']
const re = /(?:screenshots\/)?([A-Z][A-Z-]+_\d+[a-z0-9_-]*\.png)/g
let docMiss = 0
for (const d of DOCS) {
  const text = fs.readFileSync(path.join(BASE, d), 'utf8')
  let m
  while ((m = re.exec(text))) {
    const name = m[1]
    const hits = []
    function find(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) find(p)
        else if (e.name === name) hits.push(p)
      }
    }
    find(path.join(BASE, 'screenshots'))
    if (!hits.length) { bad(d + ' 引用截图不存在: ' + name); docMiss++ }
  }
}
if (!docMiss) ok('文档引用的截图全部存在')

// 5. 文档齐全
for (const d of DOCS.concat(['capture-manifest.json'])) {
  if (!fs.existsSync(path.join(BASE, d))) bad('缺少交付物: ' + d)
}
if (!fail) ok('交付物齐全')

console.log(fail === 0 ? '\nALL_CHECKS_PASSED' : '\nCHECKS_FAILED=' + fail)
process.exit(fail === 0 ? 0 : 1)
