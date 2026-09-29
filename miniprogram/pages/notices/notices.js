// 通知 Tab（全局列表）
'use strict'
const makeNoticesPage = require('../../utils/notices-page')

Page(makeNoticesPage(function () {
  return null
}, { tabBarIndex: 2 }))
