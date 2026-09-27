// 活动内通知（组织者可发布/复制/记录投递）
'use strict'
const makeNoticesPage = require('../../utils/notices-page')

Page(makeNoticesPage(function () {
  return this._options ? this._options.id : null
}))
