const fs = require('fs')
const path = require('path')
const MP = 'D:/OurTrail-ui/miniprogram/pages'
const rows = []
for (const dir of fs.readdirSync(MP)) {
  const w = path.join(MP, dir, dir + '.wxml')
  if (!fs.existsSync(w)) continue
  const src = fs.readFileSync(w, 'utf8')
  const cards = (src.match(/class="[^"]*\bcard\b/g) || []).length
  const heads = (src.match(/section-head/g) || []).length
  const sticky = /class="[^"]*sticky-action/.test(src)
  const hasSticky = /has-sticky/.test(src)
  const root = (src.match(/^\s*<view class="([^"{]*)"/m) || [])[1] || '(动态)'
  const firstLine = src.split('\n').find(l => /<view class=/.test(l) && /class="page/.test(l)) ? 'page' : 'NO-page'
  const hardColor = (src.match(/#[0-9A-Fa-f]{6}/g) || []).length
  rows.push({ page: dir, root: firstLine, cards, heads, sticky: sticky ? (hasSticky ? 'Y+Y' : 'Y-!') : '-', hardColor })
}
console.log('page          root    cards heads sticky hardColor')
for (const r of rows) {
  console.log(r.page.padEnd(14) + r.root.padEnd(8) + String(r.cards).padEnd(6) + String(r.heads).padEnd(6) + r.sticky.padEnd(7) + String(r.hardColor))
}
