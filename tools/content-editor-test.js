// content-editor 组件纯逻辑测试：node tools/content-editor-test.js
// 手法同 scenario-editor：捕获 Component() 配置，setData 同步落 data，wx/api 用桩。
'use strict'
const path = require('path')
const api = require('../miniprogram/utils/api')

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 3000)
  while (Date.now() < end) {
    if (fn()) return true
    await sleep(10)
  }
  return false
}

function setPath(obj, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]]
  cur[parts[parts.length - 1]] = value
}

function makeInstance(config) {
  const inst = {
    data: JSON.parse(JSON.stringify(config.data || {})),
    events: [],
    setData(patch, cb) {
      Object.keys(patch).forEach(key => {
        if (key.indexOf('.') === -1) this.data[key] = patch[key]
        else setPath(this.data, key, patch[key])
      })
      if (cb) cb()
    },
    triggerEvent(name, detail) { this.events.push({ name: name, detail: detail }) },
  }
  Object.keys(config.properties || {}).forEach(key => { inst.data[key] = config.properties[key].value })
  Object.keys(config.methods || {}).forEach(key => { inst[key] = config.methods[key].bind(inst) })
  return inst
}

function loadComponent() {
  let captured = null
  const oldComponent = global.Component
  global.Component = config => { captured = config }
  const file = path.resolve(__dirname, '../miniprogram/components/content-editor/content-editor.js')
  delete require.cache[file]
  require(file)
  global.Component = oldComponent
  return captured
}

function stubWx(state) {
  global.wx = {
    compressImage: o => o.success({ tempFilePath: o.src + '.compressed.jpg' }),
    chooseMedia: o => { state.chooseCalls.push(o); o.success({ tempFiles: o.__files || [] }) },
    cloud: {
      uploadFile: o => {
        state.uploads.push(o)
        const base = String(o.filePath).split('/').pop().replace('.compressed.jpg', '')
        setTimeout(() => o.success({ fileID: 'cloud://env.abc/activity-media/' + base }), 5)
      },
      deleteFile: o => { state.deleted.push(o.fileList.slice()); o.success && o.success({}) },
    },
  }
}

async function main() {
  const config = loadComponent()
  const state = { uploads: [], deleted: [], chooseCalls: [] }
  const oldWx = global.wx
  const oldCall = api.call
  let active = 0
  let maxActive = 0
  api.call = () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    return new Promise(resolve => setTimeout(() => {
      active -= 1
      resolve({ pass: true })
    }, 30))
  }
  stubWx(state)
  try {
    console.log('== content-editor 组件 ==')

    // 1. 初始化：旧内容无 id、封面不在正文 → 清空封面
    let inst = makeInstance(config)
    inst.data.initialContent = [
      { type: 'text', text: '第一段\n\n第二段' },
      { type: 'images', fileIds: ['a', 'b'] },
    ]
    inst.data.initialCover = 'not-in-content'
    inst.initFromProps()
    check('初始化生成稳定块 id', inst.data.blocks.length === 2 && !!inst.data.blocks[0].id && !!inst.data.blocks[1].id, inst.data.blocks)
    check('封面不在正文 → 清空', inst.data.coverFileId === '', inst.data.coverFileId)
    check('初始化发 change 事件', inst.events.some(e => e.name === 'change' && e.detail.content.length === 2), inst.events)

    // 2. clean：空文本/空图块丢弃，封面只保留正文内的图
    inst.addText()
    inst.addImages()
    inst.setCover({ currentTarget: { dataset: { fileid: 'b' } } })
    let clean = inst.clean()
    check('clean 丢弃空块并保留封面', clean.content.length === 2 && clean.coverFileId === 'b', clean)

    // 3. 删除含封面的图片块 → 封面清空
    inst.removeBlock({ currentTarget: { dataset: { index: 1 } } })
    check('删除含封面的图片块 → 封面清空', inst.data.coverFileId === '', inst.data.coverFileId)

    // 4. 上传：5 张，并发 ≤3，按选择顺序追加
    state.uploads.length = 0
    state.deleted.length = 0
    active = 0
    maxActive = 0
    inst = makeInstance(config)
    inst.data.initialContent = [{ type: 'images', fileIds: [] }]
    inst.initFromProps()
    inst.uploadFiles(0, ['/tmp/1.jpg', '/tmp/2.jpg', '/tmp/3.jpg', '/tmp/4.jpg', '/tmp/5.jpg'])
    await waitFor(() => inst.data.uploading === false, 5000)
    const ids = inst.data.blocks[0].fileIds
    check('5 张全部上传并追加', ids.length === 5, ids)
    check('追加顺序 = 选择顺序', ids.map(x => x.split('/').pop()).join(',') === '1.jpg,2.jpg,3.jpg,4.jpg,5.jpg', ids)
    check('并发不超过 3', maxActive <= 3 && maxActive >= 2, maxActive)
    check('上传期间发出 busy true/false', inst.events.filter(e => e.name === 'busy').map(e => e.detail.busy).join(',') === 'true,false', inst.events.filter(e => e.name === 'busy'))
    check('imageCount 同步', inst.data.imageCount === 5, inst.data.imageCount)

    // 5. 未通过检查：删文件、不入块、给出原因
    api.call = () => Promise.resolve({ pass: false, reason: 'unsafe' })
    state.uploads.length = 0
    state.deleted.length = 0
    inst = makeInstance(config)
    inst.data.initialContent = [{ type: 'images', fileIds: [] }]
    inst.initFromProps()
    inst.uploadFiles(0, ['/tmp/bad.jpg'])
    await waitFor(() => inst.data.uploading === false, 3000)
    check('未通过检查 → 不入块', inst.data.blocks[0].fileIds.length === 0, inst.data.blocks[0])
    check('未通过检查 → 删除已上传文件', state.deleted.length === 1 && state.deleted[0].length === 1, state.deleted)
    check('未通过检查 → 错误文案', /未通过安全检查/.test(inst.data.error), inst.data.error)

    // 6. pickImages 在 20 张上限处直接拒绝，不打开相册
    inst = makeInstance(config)
    inst.data.initialContent = [{ type: 'images', fileIds: [] }]
    inst.initFromProps()
    inst.data.imageCount = 20
    state.chooseCalls.length = 0
    inst.pickImages({ currentTarget: { dataset: { index: 0 } } })
    check('20 张上限 → 不打开相册并报错', state.chooseCalls.length === 0 && /最多 20 张/.test(inst.data.error), inst.data.error)

    // 7. contentType / reasonText
    check('contentType 识别 png/jpg', inst.contentType('/tmp/a.PNG') === 'image/png' && inst.contentType('/tmp/a.jpg') === 'image/jpeg', '')
    check('reasonText 覆盖四种原因', /未通过/.test(inst.reasonText('unsafe')) && /1MB/.test(inst.reasonText('too_large'))
      && /读取失败/.test(inst.reasonText('read_failed')) && /暂不可用/.test(inst.reasonText('unavailable')), '')
  } finally {
    api.call = oldCall
    global.wx = oldWx
  }
  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

main().catch(e => {
  console.error('CONTENT_EDITOR_TEST_FAILED', e && (e.stack || e.message || e))
  process.exit(1)
})
