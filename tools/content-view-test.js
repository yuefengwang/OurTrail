// 活动正文展示层纯函数（tools/content-view-test.js）
'use strict'

const check = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
let passed = 0
let failed = 0

const CV = require('../miniprogram/utils/content-view')

console.log('== 活动正文展示层 ==')
check('空行分段：两段', JSON.stringify(CV.splitParagraphs('第一段\n\n第二段')) === JSON.stringify(['第一段', '第二段']))
check('空行分段：多余空白/空段被丢弃', JSON.stringify(CV.splitParagraphs('\n  第一段  \n\n \n 第二段\n')) === JSON.stringify(['第一段', '第二段']))
check('单段保持一段', CV.splitParagraphs('只有一段').length === 1)
check('空文本不产生段落', CV.splitParagraphs('   ').length === 0)
check('非字符串安全', CV.splitParagraphs(null).length === 0)

const view = CV.buildView([
  { type: 'text', text: '第一段\n\n第二段' },
  { type: 'images', fileIds: ['a'] },
  { type: 'images', fileIds: ['b', 'c'] },
  { type: 'images', fileIds: ['d', 'e', 'f'] },
  { type: 'text', text: '   ' },
  { type: 'images', fileIds: [] },
])
check('文本块拆成 paragraphs', view[0].type === 'text' && view[0].paragraphs.length === 2, view[0])
check('单图 layout=single', view[1].layout === 'single' && view[1].images.length === 1, view[1])
check('双图 layout=double', view[2].layout === 'double' && view[2].images.length === 2, view[2])
check('三图 layout=triple', view[3].layout === 'triple' && view[3].images.length === 3, view[3])
check('空文本/空图块被丢弃（只剩 4 块）', view.length === 4, view.length)
check('旧活动无 content 返回空数组', CV.buildView(undefined).length === 0 && CV.buildView(null).length === 0)
check('坏块不抛', CV.buildView([null, { type: 'images' }, { type: 'text' }]).length === 0)

const imgs = CV.allImages(view)
check('allImages 按正文顺序收集', JSON.stringify(imgs) === JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']), imgs)
check('allImages 对空/坏输入失败关闭', CV.allImages(null).length === 0 && CV.allImages([]).length === 0)

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
