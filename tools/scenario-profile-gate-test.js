// 按需资料门组件：打开时读档案、微信头像/昵称/手机号、保存并继续、失败不静默。
// 运行：node tools/scenario-profile-gate-test.js
'use strict'
const path = require('path')
const api = require('../miniprogram/utils/api')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
const tick = () => new Promise(r => setImmediate(r))

function boot() {
  const events = []
  const uploads = []
  const apiState = { lastPayload: null, lastRevision: null }
  global.wx = {
    cloud: {
      uploadFile(o) {
        uploads.push(o)
        o.success({ fileID: 'cloud://avatar-new.jpg' })
      },
    },
  }
  api.read = () => Promise.resolve({
    view: {
      kind: 'profile',
      profile: {
        id: 'u1',
        person: {
          name: '', phone: '', avatar: 'cloud://avatar-old.jpg',
          emergency: { name: '妈妈', phone: '13900000000' }, medical: '花粉过敏',
        },
      },
    },
    revision: 3,
  })
  api.dispatch = (payload, revision) => {
    apiState.lastPayload = payload
    apiState.lastRevision = revision
    return Promise.resolve({ targetIds: ['u1'], revision: 4 })
  }
  api.call = (action, data) => {
    if (action === 'getPhoneNumber' && data.code === 'ok') return Promise.resolve({ phone: '13800000000' })
    return Promise.reject(new Error('phone failed'))
  }
  global.Component = cfg => { global.__PROFILE_GATE_CFG = cfg }
  const file = require.resolve('../miniprogram/components/profile-gate/profile-gate.js')
  delete require.cache[file]
  require(file)
  const cfg = global.__PROFILE_GATE_CFG
  const inst = {
    data: JSON.parse(JSON.stringify(cfg.data)),
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) setImmediate(cb) },
    triggerEvent(name, detail) { events.push({ name, detail }) },
    uploads,
    apiState,
  }
  Object.assign(inst, cfg.methods)
  return { cfg, inst, events, uploads, apiState }
}

async function main() {
  section('1. 打开时读取档案并预填')
  {
    const { inst } = boot()
    inst.loadProfile()
    await tick()
    check('读档案后 loading 收束', inst.data.loading === false)
    check('姓名/手机号从档案预填', inst.data.person.name === '' && inst.data.person.phone === '', JSON.stringify(inst.data.person))
    check('头像从档案预填', inst.data.person.avatar === 'cloud://avatar-old.jpg')
  }

  section('2. 微信头像 / 手机号 / 手动输入')
  {
    const { inst } = boot()
    inst.loadProfile()
    await tick()
    inst.onChooseAvatar({ detail: { avatarUrl: '/tmp/a.jpg' } })
    check('chooseAvatar 上传到云存储', inst.uploads.length === 1 && inst.uploads[0].cloudPath.indexOf('avatars/u1/') === 0,
      JSON.stringify(inst.uploads[0] && inst.uploads[0].cloudPath))
    await tick()
    check('头像上传后写回 fileID', inst.data.person.avatar === 'cloud://avatar-new.jpg', inst.data.person.avatar)
    inst.onPhoneCode({ detail: { code: 'ok' } })
    await tick()
    check('getPhoneNumber 成功后填入手机号', inst.data.person.phone === '13800000000', inst.data.person.phone)
    inst.onField({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '阿秋' } })
    check('昵称手动输入生效', inst.data.person.name === '阿秋')
    inst.onPhoneCode({ detail: { errMsg: 'getPhoneNumber:fail cancel' } })
    check('取消手机号授权：提示可手填，不当错误', inst.data.hint.indexOf('手动填写') !== -1 && inst.data.error === '')
  }

  section('3. 保存：校验、保留安全字段、事件')
  {
    const { inst, events } = boot()
    inst.loadProfile()
    await tick()
    inst.onField({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '  阿秋  ' } })
    inst.onField({ currentTarget: { dataset: { key: 'phone' } }, detail: { value: '13800000000' } })
    inst.onChooseAvatar({ detail: { avatarUrl: '/tmp/a.jpg' } })
    await tick()
    inst.onSave()
    await tick()
    const p = inst.apiState.lastPayload
    check('保存发 profile.save', p && p.type === 'profile.save', p && p.type)
    check('姓名/手机号 trim 后提交', p && p.person.name === '阿秋' && p.person.phone === '13800000000',
      JSON.stringify(p && p.person))
    check('保留档案里的紧急联系人与医疗备注', p && p.person.emergency.name === '妈妈' && p.person.medical === '花粉过敏',
      JSON.stringify(p && p.person))
    check('使用新头像 fileID', p && p.person.avatar === 'cloud://avatar-new.jpg')
    check('用读到的 revision 做 CAS', inst.apiState.lastRevision === 3, String(inst.apiState.lastRevision))
    check('保存成功触发 saved 事件', events.some(e => e.name === 'saved'), JSON.stringify(events))
  }
  {
    const { inst, events } = boot()
    inst.loadProfile()
    await tick()
    inst.onSave()
    check('空姓名拦截、不发命令', inst.data.error.indexOf('姓名') !== -1 && inst.apiState.lastPayload === null, inst.data.error)
    inst.onField({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '阿秋' } })
    inst.onField({ currentTarget: { dataset: { key: 'phone' } }, detail: { value: '123' } })
    inst.onSave()
    check('非法手机号拦截、不发命令', inst.data.error.indexOf('11 位') !== -1 && inst.apiState.lastPayload === null, inst.data.error)
    inst.onClose()
    check('关闭触发 close 事件', events.some(e => e.name === 'close'))
  }

  section('4. CONFLICT 刷新后可重存')
  {
    const { inst } = boot()
    inst.loadProfile()
    await tick()
    inst.onField({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '阿秋' } })
    inst.onField({ currentTarget: { dataset: { key: 'phone' } }, detail: { value: '13800000000' } })
    api.dispatch = () => {
      const e = new Error('conflict')
      e.code = 'CONFLICT'
      return Promise.reject(e)
    }
    inst.onSave()
    await tick()
    check('CONFLICT 不静默：提示已刷新、请再保存', inst.data.error.indexOf('已刷新') !== -1, inst.data.error)
    check('CONFLICT 后 saving 复位', inst.data.saving === false)
  }

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
