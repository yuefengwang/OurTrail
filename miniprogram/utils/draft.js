// 草稿：按 actor+activityId+form 存 wx storage，与原型 runtime drafts 语义一致。
'use strict'
const KEY = 'ourtrail.drafts.v1'

function loadAll() {
  try {
    return wx.getStorageSync(KEY) || {}
  } catch (e) {
    return {}
  }
}

function saveAll(all) {
  try {
    wx.setStorageSync(KEY, all)
  } catch (e) {
    // 存储失败不影响主流程
  }
}

function key(activityId, form) {
  return [wxOpenId(), activityId, form].join('|')
}

let cachedOpenId = ''
function wxOpenId() {
  if (cachedOpenId) return cachedOpenId
  try {
    cachedOpenId = wx.getStorageSync('ourtrail.openid') || ''
  } catch (e) {
    cachedOpenId = ''
  }
  return cachedOpenId
}

function setOpenId(id) {
  cachedOpenId = id || ''
  try {
    wx.setStorageSync('ourtrail.openid', cachedOpenId)
  } catch (e) { /* ignore */ }
}

function getDraft(activityId, form) {
  const all = loadAll()
  const entry = all[key(activityId, form)]
  return entry === undefined ? undefined : JSON.parse(JSON.stringify(entry))
}

function setDraft(activityId, form, value) {
  const all = loadAll()
  all[key(activityId, form)] = JSON.parse(JSON.stringify(value))
  saveAll(all)
}

function clearDraft(activityId, form) {
  const all = loadAll()
  delete all[key(activityId, form)]
  saveAll(all)
}

// 最近查看的活动（首页「最近」筛选 + 打开活动记忆）
const OPENED_KEY = 'ourtrail.opened.v1'
function getOpened() {
  try {
    return wx.getStorageSync(OPENED_KEY) || []
  } catch (e) {
    return []
  }
}
function rememberActivity(activityId) {
  const list = getOpened().filter(id => id !== activityId)
  list.unshift(activityId)
  try {
    wx.setStorageSync(OPENED_KEY, list.slice(0, 50))
  } catch (e) { /* ignore */ }
}

module.exports = { getDraft, setDraft, clearDraft, getOpened, rememberActivity, setOpenId, wxOpenId }
