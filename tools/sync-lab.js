// 把 trailApi 的 domain 层与 store 同步进 trailApiLab：node tools/sync-lab.js
// 云函数各自打包，无法跨目录 require——lab 与主函数共用同一份 domain 代码靠本脚本复制。
// 每次改动 cloudfunctions/trailApi/domain 或 store.js 后、重新部署 trailApiLab 前跑一次。
// 只覆盖 store.js 与 domain/，lab 自己的文件（index/stages/lab.config 等）不受影响。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'cloudfunctions', 'trailApi')
const DST = path.join(ROOT, 'cloudfunctions', 'trailApiLab')

function copy(rel) {
  const from = path.join(SRC, rel)
  const to = path.join(DST, rel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  return to
}

const copied = [copy('store.js')]
fs.mkdirSync(path.join(DST, 'domain'), { recursive: true })
for (const f of fs.readdirSync(path.join(SRC, 'domain'))) {
  if (f.endsWith('.js')) copied.push(copy(path.join('domain', f)))
}

// 语法自检：复制产物必须全部可加载
for (const file of copied) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
}
console.log('synced ' + copied.length + ' files into cloudfunctions/trailApiLab（store.js + domain/*），node --check 全部通过')
