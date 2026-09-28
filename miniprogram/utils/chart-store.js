// 全图展示（横屏页）与天气页之间的图表数据桥。
// wx.navigateTo 会把天气页留在页面栈里，所以横屏页只要读这份内存数据即可：
// 既不用把 168 小时序列塞进 URL（有长度限制，也白白走一遍 query string 编解码），
// 也不用在天气页 onShow 里重新装配一次。
'use strict'

let payload = null

module.exports = {
  // payload: { series, marks, night, selected, pointName, date }
  set(p) { payload = p || null },
  get() { return payload },
  clear() { payload = null },
}
