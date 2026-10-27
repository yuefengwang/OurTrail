// 活动正文块的纯展示层：把服务端 content 块拆成 WXML 可直接渲染的段落/图片组。
// 不做判读、不碰 wx；服务端已保证块形状，这里只处理空行分段与 1/2/3+ 张图的布局分类。
'use strict'

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(Boolean)
}

function buildView(content) {
  const blocks = Array.isArray(content) ? content : []
  const out = []
  for (const block of blocks) {
    if (!block) continue
    if (block.type === 'text') {
      const paragraphs = splitParagraphs(block.text)
      if (paragraphs.length) out.push({ type: 'text', paragraphs: paragraphs })
    } else if (block.type === 'images' && Array.isArray(block.fileIds) && block.fileIds.length) {
      const count = block.fileIds.length
      out.push({
        type: 'images',
        layout: count === 1 ? 'single' : count === 2 ? 'double' : 'triple',
        images: block.fileIds.map(fileid => ({ fileid: fileid })),
      })
    }
  }
  return out
}

function allImages(blocks) {
  const out = []
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || block.type !== 'images' || !Array.isArray(block.images)) continue
    for (const image of block.images) if (image && image.fileid) out.push(image.fileid)
  }
  return out
}

module.exports = { splitParagraphs, buildView, allImages }
