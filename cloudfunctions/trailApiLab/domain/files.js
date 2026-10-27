// 活动图片文件的纯函数集合：fileID 白名单与引用计数。
// 这里不碰云 API——删除动作在 index.js 的写后钩子里做，本文件只回答「哪些文件被活动引用」。
'use strict'

const MEDIA_PREFIX = '/activity-media/'

// 只接受本应用上传的活动图片路径。头像在 /avatars/ 下，不能走这个白名单。
function isActivityMediaFileId(fileID) {
  return typeof fileID === 'string' && fileID.indexOf('cloud://') === 0 && fileID.indexOf(MEDIA_PREFIX) !== -1
}

// 一条活动引用的全部图片：封面 + 正文图片块。
function activityFiles(activity) {
  const out = new Set()
  if (!activity || typeof activity !== 'object') return out
  if (activity.coverFileId) out.add(activity.coverFileId)
  const blocks = Array.isArray(activity.content) ? activity.content : []
  for (const block of blocks) {
    if (!block || block.type !== 'images' || !Array.isArray(block.fileIds)) continue
    for (const fileID of block.fileIds) if (fileID) out.add(fileID)
  }
  return out
}

// 全部活动求并集：删除前用它做引用计数，避免删掉另一场活动（含 copy）还在用的图。
function collectActivityFiles(state) {
  const out = new Set()
  const activities = state && Array.isArray(state.activities) ? state.activities : []
  for (const activity of activities) {
    for (const fileID of activityFiles(activity)) out.add(fileID)
  }
  return out
}

// 写后清理的纯判定：写入前引用、写入后已无人引用。index.js 只负责把结果交给 cloud.deleteFile。
function removedActivityFiles(beforeState, afterState) {
  const before = collectActivityFiles(beforeState)
  const after = collectActivityFiles(afterState)
  const removed = []
  before.forEach(fileID => { if (!after.has(fileID)) removed.push(fileID) })
  return removed
}

module.exports = { MEDIA_PREFIX, isActivityMediaFileId, activityFiles, collectActivityFiles, removedActivityFiles }
