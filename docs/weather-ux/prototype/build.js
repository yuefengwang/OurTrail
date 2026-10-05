// 把生产环境的天相引擎原样打包进浏览器（Weather UX Prototype 专用，不属于生产构建）。
//
//   node build.js   →  生成 ./engine.js
//
// 为什么存在：原型里的「户外条件分析」直接跑 miniprogram/utils/{astro,sky}.js 的真实代码，
// 而不是在原型里复刻一份阈值——复刻必然漂移（weather-model.js 顶部注释记录过原型阈值
// 与 sky.js 分叉的教训）。两文件均为纯 JS、无 wx 依赖（miniprogram/utils/AGENTS.md 铁律），
// CommonJS 在浏览器侧用一个 10 行的 registry 模拟即可。
//
// ⚠ 只打包、不改写：任何对引擎的修改都在生产源文件上进行，重新跑本脚本即可。
'use strict'
const fs = require('fs')
const path = require('path')

const UTILS = path.join(__dirname, '..', '..', '..', 'miniprogram', 'utils')
const OUT = path.join(__dirname, 'engine.js')

function load(file) {
  return fs.readFileSync(path.join(UTILS, file), 'utf8').replace(/^\uFEFF/, '')
}

const src = `// ⚠ 自动生成（node build.js），勿手改。源文件：
//   miniprogram/utils/astro.js  ·  miniprogram/utils/sky.js
// 用途：Weather UX Prototype 在浏览器里运行与生产完全相同的天相引擎。
(function () {
  'use strict'
  const registry = {}
  function req(name) {
    const key = String(name).replace(/^\\.\\//, '')
    if (!registry[key]) throw new Error('engine: unknown module ' + name)
    return registry[key].exports
  }
  function def(id, source) {
    registry[id] = { exports: {} }
    // CommonJS 包装：与 Node 的模块语义一致（module.exports 可整体替换）
    ;(new Function('module', 'exports', 'require', source))(
      registry[id], registry[id].exports, req
    )
  }
  def('astro', ${JSON.stringify(load('astro.js'))})
  def('format', ${JSON.stringify(load('format.js'))})
  def('sky', ${JSON.stringify(load('sky.js'))})
  window.OTengine = { astro: req('astro'), format: req('format'), sky: req('sky') }
})()
`

fs.writeFileSync(OUT, src, 'utf8')
console.log('engine.js 已生成：'
  + 'astro.js ' + load('astro.js').length + 'B · sky.js ' + load('sky.js').length + 'B → ' + OUT)
