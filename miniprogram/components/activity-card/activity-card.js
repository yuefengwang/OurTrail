// 活动卡：普通（图 + 标题 / chips / foot 三行）/ featured（大幅封面照 + 压底）。
// 封面优先用外部传入的 cover；没传时只给 activityId，本组件按 id 稳定取一张
//（utils/covers.js）——派生刻意留在组件内：页面 cards 数组是投影契约，
//  a20-owner-hero 门按字节比对它们，展示派生字段不该进那个对象。
//
// 2026-10-26（style-B）：正文从「四行拼接串」收成三槽——标题 / chips / foot。
// chips 与人数由页面经 utils/card-view.js 派生后传入，组件不自己算（投影口径归页面）；
// 相位短词单独走 badge，归属短词走 roleNote——两者原先拼在 status 一处，
// 于是「我组织的 · 报名中」既当徽章又当元信息，密度全花在重复上。
'use strict'
const covers = require('../../utils/covers')

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    title: { type: String, value: '' },
    date: { type: String, value: '' },
    when: { type: String, value: '' },
    featured: { type: Boolean, value: false },
    // 这个人在这场活动上欠下的协作事项：[{ key: 'staff'|'vehicle', label: '现场协作' }]。
    // 判据与文案都由页面从服务端投影的 meta 派生（utils/journey.collabRoles），
    // 组件只负责画与回抛 key——授权判断不进组件。
    collab: { type: Array, value: [] },
    cover: { type: String, value: '' },
    activityId: { type: String, value: '' },
    // 路线名：标题下一行的「去哪」。
    routeName: { type: String, value: '' },
    // 紧凑行：80px 缩略图 + 标题列。
    compact: { type: Boolean, value: false },
    // 平铺行（发现页）：同一张卡退成纸面上的行——去底色/边框/圆角，不像一张卡。
    // 与 compact 正交：flat 只管外观，缩略图与内边距仍由 compact 给。
    flat: { type: Boolean, value: false },
    // 三槽正文（2026-10-26）：chips 是 [{ key, text }]，次序即截断优先级
    //（日期 > 难度 > 距离 > 爬升），由 utils/card-view.chipsOf 统一给。
    chips: { type: Array, value: [] },
    // 人数只印一处：people = 「已确认 3/10」；pending = 组织者工作队列「待审核 7 人」。
    people: { type: String, value: '' },
    pending: { type: String, value: '' },
    // 与活动的关系（「我组织的」/「最近查看」/协作角色），细字一行，缺失即不印。
    roleNote: { type: String, value: '' },
    // 相位短词（「报名中」「报名已截止」），只做徽章。
    badge: { type: String, value: '' },
  },
  data: {
    // 照片加载失败：缩略图退回 --stone 灰底、featured 封面藏起（纯色 hero 兜底）
    coverFailed: false,
    // 实际要用的封面地址（外部传入优先，否则按 activityId 派生）
    coverSrc: '',
    // 实拍封面失败时的氛围图兜底；已经是氛围图还失败才走纯色
    coverFallback: '',
    // featured 的 header 已经印了日期，chips 里去掉日期那一项再画（顺序保持，
    // 分隔点按过滤后的下标给——直接在模板里按原始下标跳过会多出一个「·」）。
    restChips: [],
  },
  observers: {
    'cover, activityId'(cover, activityId) {
      const fallback = activityId ? covers.coverFor(activityId) : ''
      const next = cover || fallback
      if (next === this.data.coverSrc) return
      this.setData({ coverSrc: next, coverFallback: fallback, coverFailed: false })
    },
    chips(chips) {
      this.setData({ restChips: (chips || []).filter(c => c.key !== 'date') })
    },
  },
  methods: {
    onTap() { this.triggerEvent('open') },
    onCollab(e) { this.triggerEvent('collab', { key: e.currentTarget.dataset.key }) },
    onCoverError() {
      const fallback = this.data.coverFallback
      if (fallback && this.data.coverSrc !== fallback) {
        console.warn('[activity-card] 实拍封面加载失败，回退氛围图：', this.data.coverSrc)
        this.setData({ coverSrc: fallback, coverFailed: false })
        return
      }
      if (this.data.coverFailed) return
      console.warn('[activity-card] 封面图加载失败：', this.data.coverSrc)
      this.setData({ coverFailed: true })
    },
  },
})
