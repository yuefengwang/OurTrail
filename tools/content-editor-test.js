// content-editor 组件纯逻辑测试：node tools/content-editor-test.js
// 覆盖：连续正文、图片组锚点、2000 字文本块切分、上传/安全检查、封面、顺序往返。
'use strict'
const path = require('path')
const api = require('../miniprogram/utils/api')
const CV = require('../miniprogram/utils/content-view')

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

function makeInstance(config) {
  const inst = {
    data: JSON.parse(JSON.stringify(config.data || {})),
    events: [],
    setData(patch, cb) {
      Object.keys(patch).forEach(key => { this.data[key] = patch[key] })
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
    chooseMedia: o => { state.chooseCalls.push(o); o.success({ tempFiles: state.chooseFiles || [] }) },
    showModal: o => {
      state.modals.push({ title: o.title, content: o.content })
      if (o.success) o.success({ confirm: state.modalConfirm !== false })
    },
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

function setBody(inst, text) {
  inst.onBodyInput({ detail: { value: text } })
}

function lastChange(inst) {
  const events = inst.events.filter(e => e.name === 'change')
  return events.length ? events[events.length - 1].detail : null
}

async function main() {
  const config = loadComponent()
  const state = { uploads: [], deleted: [], chooseCalls: [], chooseFiles: [], modals: [], modalConfirm: true }
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
    console.log('== content-editor 连续正文 + 图片组 ==')

    // 1. 初始化：旧内容无 id、封面不在正文 → 清空封面；段落与图片顺序保留
    let inst = makeInstance(config)
    inst.data.initialContent = [
      { type: 'text', text: '第一段\n\n第二段' },
      { type: 'images', fileIds: ['a', 'b'] },
    ]
    inst.data.initialCover = 'not-in-content'
    inst.initFromProps()
    check('初始化把段落合并为连续正文', inst.data.bodyText === '第一段\n\n第二段' && inst.data.paragraphCount === 2, inst.data.bodyText)
    check('初始化保留图片组与锚点', inst.data.groups.length === 1 && inst.data.groups[0].fileIds.join(',') === 'a,b'
      && inst.data.groups[0].anchor === 2, inst.data.groups)
    check('封面不在正文 → 清空', inst.data.coverFileId === '', inst.data.coverFileId)
    check('默认封面取第一张', inst.data.effectiveCover === 'a', inst.data.effectiveCover)
    check('初始化发 change 事件', lastChange(inst) && lastChange(inst).content.length === 2, lastChange(inst))

    // 2. 连续输入：空行分段，图片锚点随段落数收缩
    setBody(inst, '开头\n\n第二段\n\n第三段')
    check('连续输入更新段落数并夹紧锚点', inst.data.paragraphCount === 3 && inst.data.groups[0].anchor === 2,
      JSON.stringify({ paragraphs: inst.data.paragraphCount, anchor: inst.data.groups[0].anchor }))
    setBody(inst, '只剩一段')
    check('删段后图片锚点收回到末尾', inst.data.paragraphCount === 1 && inst.data.groups[0].anchor === 1,
      JSON.stringify({ paragraphs: inst.data.paragraphCount, anchor: inst.data.groups[0].anchor }))

    // 3. 图片组锚点决定内容顺序（同一份内容可往返）
    inst = makeInstance(config)
    inst.data.initialContent = [
      { type: 'text', text: '第一段' },
      { type: 'images', fileIds: ['a'] },
      { type: 'text', text: '第二段' },
      { type: 'images', fileIds: ['b'] },
    ]
    inst.initFromProps()
    check('初始化得到两个图片组、锚点 1/2', inst.data.groups.map(g => g.anchor).join(',') === '1,2',
      inst.data.groups.map(g => g.anchor))
    let built = inst.buildContent()
    check('原样往返：文本/图片顺序不变',
      built.content.map(b => b.type + (b.type === 'images' ? ':' + b.fileIds.join(',') : ':' + b.text)).join('|')
        === 'text:第一段|images:a|text:第二段|images:b',
      built.content)
    setBody(inst, '第一段\n\n第二段\n\n第三段')
    const firstGroupId = inst.data.groups[0].id
    inst.moveGroup({ currentTarget: { dataset: { id: firstGroupId, delta: '1' } } })
    built = inst.buildContent()
    const movedView = CV.buildView(built.content)
    check('图片组后移一段 → 两组图片都落到第 2 段后，正文段落不丢',
      movedView.length === 3 && movedView[0].type === 'text' && movedView[0].paragraphs.length === 2
        && movedView[1].type === 'images' && movedView[1].images.map(img => img.fileid).join(',') === 'a,b'
        && movedView[2].type === 'text' && movedView[2].paragraphs[0] === '第三段',
      built.content)

    // 4. 单段 >2000 字：切成多个服务端可接受的文本块，渲染段落不丢失
    inst = makeInstance(config)
    inst.initFromProps()
    const long = '甲'.repeat(4500)
    setBody(inst, long)
    built = inst.buildContent()
    check('长段落切成多个 ≤2000 字文本块', built.content.length >= 3 && built.content.every(b => b.type !== 'text' || b.text.length <= 2000),
      built.content.map(b => b.type === 'text' ? b.text.length : b.type))
    check('长段落不丢字', built.content.filter(b => b.type === 'text').map(b => b.text).join('') === long,
      built.content.filter(b => b.type === 'text').map(b => b.text.length))

    // 5. 上传：5 张并发 ≤3，按选择顺序进入新图片组
    state.uploads.length = 0
    state.deleted.length = 0
    active = 0
    maxActive = 0
    inst = makeInstance(config)
    inst.initFromProps()
    inst.uploadFiles(['/tmp/1.jpg', '/tmp/2.jpg', '/tmp/3.jpg', '/tmp/4.jpg', '/tmp/5.jpg'])
    await waitFor(() => inst.data.uploading === false, 5000)
    const ids = inst.data.groups.length ? inst.data.groups[0].fileIds : []
    check('5 张全部上传并进入一组', ids.length === 5, ids)
    check('追加顺序 = 选择顺序', ids.map(x => x.split('/').pop()).join(',') === '1.jpg,2.jpg,3.jpg,4.jpg,5.jpg', ids)
    check('并发不超过 3', maxActive <= 3 && maxActive >= 2, maxActive)
    check('上传期间发出 busy true/false', inst.events.filter(e => e.name === 'busy').map(e => e.detail.busy).join(',') === 'true,false',
      inst.events.filter(e => e.name === 'busy'))
    check('imageCount 与默认封面同步', inst.data.imageCount === 5 && inst.data.effectiveCover === ids[0], inst.data.imageCount)

    // 6. 未通过检查：删文件、不入组、给出原因
    api.call = () => Promise.resolve({ pass: false, reason: 'unsafe' })
    state.uploads.length = 0
    state.deleted.length = 0
    inst = makeInstance(config)
    inst.initFromProps()
    inst.uploadFiles(['/tmp/bad.jpg'])
    await waitFor(() => inst.data.uploading === false, 3000)
    check('未通过检查 → 不入组', inst.data.groups.length === 0, inst.data.groups)
    check('未通过检查 → 删除已上传文件', state.deleted.length === 1 && state.deleted[0].length === 1, state.deleted)
    check('未通过检查 → 错误文案', /未通过安全检查/.test(inst.data.error), inst.data.error)
    api.call = () => Promise.resolve({ pass: true })

    // 7. 20 张上限：不打开相册
    inst = makeInstance(config)
    inst.data.initialContent = [{ type: 'images', fileIds: new Array(20).fill(0).map((_, i) => 'img-' + i) }]
    inst.initFromProps()
    state.chooseCalls.length = 0
    inst.pickImages()
    check('20 张上限 → 不打开相册并报错', state.chooseCalls.length === 0 && /最多 20 张/.test(inst.data.error), inst.data.error)

    // 8. 选择多张图片：一次 chooseMedia 可形成图片组
    inst = makeInstance(config)
    inst.initFromProps()
    state.chooseCalls.length = 0
    state.chooseFiles = [{ tempFilePath: '/tmp/a.jpg' }, { tempFilePath: '/tmp/b.jpg' }, { tempFilePath: '/tmp/c.jpg' }]
    inst.pickImages()
    await waitFor(() => inst.data.uploading === false, 4000)
    check('一次选择 3 张 → 打开一次相册并形成三张图片组', state.chooseCalls.length === 1
      && state.chooseCalls[0].count === 9 && inst.data.groups.length === 1 && inst.data.groups[0].fileIds.length === 3,
      JSON.stringify({ calls: state.chooseCalls.length, count: state.chooseCalls[0] && state.chooseCalls[0].count, groups: inst.data.groups }))

    // 9. 移除图片与封面回退
    inst = makeInstance(config)
    inst.data.initialContent = [{ type: 'images', fileIds: ['a', 'b'] }]
    inst.data.initialCover = 'a'
    inst.initFromProps()
    const gid = inst.data.groups[0].id
    inst.removeImage({ currentTarget: { dataset: { id: gid, fileid: 'a' } } })
    check('移除封面图 → 封面回退到剩余第一张', inst.data.coverFileId === '' && inst.data.effectiveCover === 'b',
      JSON.stringify({ cover: inst.data.coverFileId, effective: inst.data.effectiveCover }))
    inst.removeImage({ currentTarget: { dataset: { id: gid, fileid: 'b' } } })
    check('最后一张移除 → 图片组消失', inst.data.groups.length === 0 && inst.data.imageCount === 0, inst.data.groups)

    // 10. 删除整组：二次确认后连同封面一起清
    inst = makeInstance(config)
    inst.data.initialContent = [{ type: 'images', fileIds: ['a'] }]
    inst.data.initialCover = 'a'
    inst.initFromProps()
    const g2 = inst.data.groups[0].id
    inst.removeGroup({ currentTarget: { dataset: { id: g2 } } })
    check('删除整组有二次确认', state.modals.length === 1 && inst.data.groups.length === 0 && inst.data.effectiveCover === '',
      JSON.stringify({ modal: state.modals.length, groups: inst.data.groups }))

    // 11. 封面选择：显式选 + 恢复默认
    inst = makeInstance(config)
    inst.data.initialContent = [{ type: 'images', fileIds: ['a', 'b'] }]
    inst.initFromProps()
    inst.setCover({ currentTarget: { dataset: { fileid: 'b' } } })
    check('显式选封面 → coverFileId=b', inst.data.coverFileId === 'b' && inst.data.effectiveCover === 'b', inst.data.coverFileId)
    inst.useDefaultCover()
    check('恢复默认封面 → 第一张', inst.data.coverFileId === '' && inst.data.effectiveCover === 'a', inst.data.effectiveCover)

    // 12. 上传中 reset：必须补发 busy=false，否则宿主保存/发布入口会永久禁用
    inst = makeInstance(config)
    inst.initFromProps()
    inst.data.uploading = true
    inst.events = []
    inst.initFromProps()
    check('上传中 reset 补发 busy=false', inst.events.some(e => e.name === 'busy' && e.detail.busy === false)
      && inst.data.uploading === false, inst.events)

    // 13. contentType / reasonText
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
