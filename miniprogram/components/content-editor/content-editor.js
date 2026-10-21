'use strict'
const api = require('../../utils/api')
const CV = require('../../utils/content-view')

const MAX_IMAGES = 20
const MAX_GROUP_IMAGES = 9
const MAX_TEXT_BLOCK = 2000

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

// 服务端 ContentBlock.text 上限 2000（schema.specText）。连续输入区可以写 2 万字，
// 保存时必须按段落/字符切成多个文本块；按段落切保证渲染出的段落不增不减。
function textBlocksOf(paragraphs) {
  const blocks = []
  let current = ''
  const push = () => {
    if (current.trim()) blocks.push(current)
    current = ''
  }
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_TEXT_BLOCK) {
      push()
      for (let i = 0; i < paragraph.length; i += MAX_TEXT_BLOCK) {
        blocks.push(paragraph.slice(i, i + MAX_TEXT_BLOCK))
      }
      continue
    }
    const candidate = current ? current + '\n\n' + paragraph : paragraph
    if (candidate.length > MAX_TEXT_BLOCK) {
      push()
      current = paragraph
    } else {
      current = candidate
    }
  }
  push()
  return blocks
}

function imageIdsOf(groups) {
  const out = []
  ;(groups || []).forEach(group => {
    if (group && Array.isArray(group.fileIds)) out.push.apply(out, group.fileIds)
  })
  return out
}

function pad2(n) { return n < 10 ? '0' + n : '' + n }
function dayStamp() {
  const d = new Date()
  return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
}
function randomSuffix() { return Math.random().toString(36).slice(2, 8) }

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    initialContent: { type: Array, value: [] },
    initialCover: { type: String, value: '' },
    // 页面 reload 时递增，让组件用新的 initialContent 重置；平时输入不触发。
    resetKey: { type: Number, value: 0 },
  },
  data: {
    bodyText: '',
    bodyLength: 0,
    bodyFocused: false,
    paragraphCount: 0,
    // groups: [{ id, fileIds: [], anchor }]，anchor = 图片组放在第几段之后（0 = 正文开头）
    groups: [],
    managedGroupId: '',
    coverFileId: '',
    effectiveCover: '',
    coverOptions: [],
    coverOpen: false,
    imageCount: 0,
    uploading: false,
    uploadTotal: 0,
    uploadDone: 0,
    message: '',
    error: '',
  },
  observers: {
    resetKey() { this.initFromProps() },
  },
  lifetimes: {
    attached() { this.initFromProps() },
  },
  methods: {
    initFromProps() {
      const wasUploading = this.data.uploading
      this._uploadToken = (this._uploadToken || 0) + 1
      const source = Array.isArray(this.data.initialContent) ? this.data.initialContent : []
      const texts = []
      const groups = []
      let paragraphCount = 0
      source.forEach(block => {
        if (!block) return
        if (block.type === 'images' && Array.isArray(block.fileIds) && block.fileIds.length) {
          groups.push({ id: this.nextId(), fileIds: block.fileIds.slice(), anchor: paragraphCount })
          return
        }
        if (block.type === 'text') {
          const text = String(block.text || '')
          if (text.trim()) texts.push(text)
          paragraphCount += CV.splitParagraphs(text).length
        }
      })
      const bodyText = texts.join('\n\n')
      const all = imageIdsOf(groups)
      const cover = all.indexOf(this.data.initialCover) !== -1 ? this.data.initialCover : ''
      this.setData(Object.assign({
        bodyText: bodyText,
        bodyLength: bodyText.length,
        bodyFocused: false,
        paragraphCount: CV.splitParagraphs(bodyText).length,
        groups: groups,
        managedGroupId: '',
        coverFileId: cover,
        coverOpen: false,
        uploading: false, uploadTotal: 0, uploadDone: 0,
        message: '', error: '',
      }, this.metaOf(groups, cover)), () => this.emitChange())
      // 上传过程中被 reset（页面重读/组件重建）时，宿主可能还停在 contentBusy；
      // 这次重置没有 worker 会再发 busy=false，必须由这里补上，否则保存/发布入口会一直禁用。
      if (wasUploading) this.triggerEvent('busy', { busy: false })
    },
    nextId() {
      this._seq = (this._seq || 0) + 1
      return 'ce-' + this._seq + '-' + Date.now().toString(36)
    },
    metaOf(groups, coverFileId) {
      const all = imageIdsOf(groups)
      const cover = all.indexOf(coverFileId) !== -1 ? coverFileId : ''
      return {
        imageCount: all.length,
        coverOptions: all,
        coverFileId: cover,
        effectiveCover: cover || all[0] || '',
      }
    },
    // 保存形状：文本与图片组按 anchor 重新拼成交替块；同段落的连续图片组合并到 9 张一组。
    buildContent() {
      const body = String(this.data.bodyText || '')
      const paragraphs = CV.splitParagraphs(body)
      const groups = (this.data.groups || [])
        .filter(group => group && Array.isArray(group.fileIds) && group.fileIds.length)
        .map((group, index) => ({
          fileIds: group.fileIds.slice(),
          anchor: clamp(Number(group.anchor), 0, paragraphs.length),
          index: index,
        }))
        .sort((a, b) => a.anchor - b.anchor || a.index - b.index)

      const blocks = []
      let cursor = 0
      groups.forEach(group => {
        if (group.anchor > cursor) {
          textBlocksOf(paragraphs.slice(cursor, group.anchor)).forEach(text => blocks.push({ type: 'text', text: text }))
          cursor = group.anchor
        }
        let remaining = group.fileIds
        const prev = blocks[blocks.length - 1]
        if (prev && prev.type === 'images' && prev.fileIds.length < MAX_GROUP_IMAGES) {
          const room = MAX_GROUP_IMAGES - prev.fileIds.length
          prev.fileIds.push.apply(prev.fileIds, remaining.slice(0, room))
          remaining = remaining.slice(room)
        }
        while (remaining.length) {
          blocks.push({ type: 'images', fileIds: remaining.slice(0, MAX_GROUP_IMAGES) })
          remaining = remaining.slice(MAX_GROUP_IMAGES)
        }
      })
      if (cursor < paragraphs.length) {
        textBlocksOf(paragraphs.slice(cursor)).forEach(text => blocks.push({ type: 'text', text: text }))
      }
      const images = []
      blocks.forEach(block => {
        if (block.type === 'images') images.push.apply(images, block.fileIds)
      })
      return {
        content: blocks,
        coverFileId: images.indexOf(this.data.coverFileId) !== -1 ? this.data.coverFileId : '',
      }
    },
    emitChange() {
      const clean = this.buildContent()
      const meta = this.metaOf(
        (clean.content || []).filter(block => block.type === 'images').map(block => ({ fileIds: block.fileIds })),
        clean.coverFileId
      )
      if (meta.imageCount !== this.data.imageCount
        || meta.effectiveCover !== this.data.effectiveCover
        || meta.coverFileId !== this.data.coverFileId) {
        this.setData(meta)
      }
      this.triggerEvent('change', clean)
    },

    // ---- 连续正文 ----
    onBodyInput(e) {
      const bodyText = e.detail.value
      const paragraphCount = CV.splitParagraphs(bodyText).length
      const groups = this.data.groups.map(group => Object.assign({}, group, {
        anchor: clamp(group.anchor, 0, paragraphCount),
      }))
      this.setData({
        bodyText: bodyText,
        bodyLength: bodyText.length,
        paragraphCount: paragraphCount,
        groups: groups,
        message: '',
      }, () => this.emitChange())
    },
    onBodyFocus() { this.setData({ bodyFocused: true }) },
    onBodyBlur() { this.setData({ bodyFocused: false }) },

    // ---- 图片组 ----
    pickImages() {
      if (this.data.uploading) return
      const remaining = MAX_IMAGES - this.data.imageCount
      if (remaining <= 0) {
        this.setData({ error: '活动图片最多 ' + MAX_IMAGES + ' 张。' })
        return
      }
      const self = this
      wx.chooseMedia({
        count: Math.min(MAX_GROUP_IMAGES, remaining),
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: function (res) {
          const paths = (res.tempFiles || []).map(file => file.tempFilePath).filter(Boolean)
          if (paths.length) self.uploadFiles(paths)
        },
        fail: function (err) {
          const msg = String((err && err.errMsg) || '')
          if (/cancel/i.test(msg)) return
          self.setData({ error: '打开相册失败，请重试。' })
        },
      })
    },
    uploadFiles(paths) {
      if (this.data.uploading || !paths.length) return
      const self = this
      const token = this._uploadToken
      const group = { id: this.nextId(), fileIds: [], anchor: this.data.paragraphCount }
      const groups = this.data.groups.concat([group])
      const results = new Array(paths.length).fill('')
      let cursor = 0
      let done = 0
      this.setData(Object.assign({
        groups: groups,
        uploading: true,
        uploadTotal: paths.length,
        uploadDone: 0,
        message: '',
        error: '',
      }, this.metaOf(groups, this.data.coverFileId)))
      this.triggerEvent('busy', { busy: true })
      const worker = function () {
        if (cursor >= paths.length) return Promise.resolve()
        const slot = cursor
        cursor += 1
        return self.one(paths[slot]).then(function (fileID) {
          if (token !== self._uploadToken) return Promise.resolve()
          results[slot] = fileID
          done += 1
          self.setData({ uploadDone: done })
          return worker()
        })
      }
      const workers = []
      for (let i = 0; i < Math.min(3, paths.length); i++) workers.push(worker())
      Promise.all(workers).then(function () {
        if (token !== self._uploadToken) return
        const added = results.filter(Boolean)
        let nextGroups = self.data.groups.slice()
        const target = nextGroups.find(item => item.id === group.id)
        if (target) target.fileIds = target.fileIds.concat(added)
        if (!added.length) nextGroups = nextGroups.filter(item => item.id !== group.id)
        self.setData(Object.assign({
          groups: nextGroups,
          uploading: false,
          message: added.length
            ? '已添加 ' + added.length + ' 张图片' + (added.length < paths.length ? '，其余未通过检查。' : '。')
            : '',
        }, self.metaOf(nextGroups, self.data.coverFileId)), function () { self.emitChange() })
        self.triggerEvent('busy', { busy: false })
      }).catch(function () {
        if (token !== self._uploadToken) return
        const nextGroups = self.data.groups.filter(item => item.id !== group.id)
        self.setData(Object.assign({ groups: nextGroups, uploading: false, error: '图片处理失败，请重试。' },
          self.metaOf(nextGroups, self.data.coverFileId)))
        self.triggerEvent('busy', { busy: false })
      })
    },
    one(path) {
      const self = this
      return this.compress(path).then(function (tmp) {
        return self.upload(tmp)
      }).then(function (up) {
        return api.call('checkImage', {
          fileID: up.fileID,
          contentType: self.contentType(up.path || ''),
        }).then(function (result) {
          if (!result || !result.pass) {
            wx.cloud.deleteFile({ fileList: [up.fileID] })
            self.setData({ error: self.reasonText(result && result.reason) })
            return ''
          }
          return up.fileID
        }).catch(function () {
          wx.cloud.deleteFile({ fileList: [up.fileID] })
          self.setData({ error: '图片安全检查失败，请重试。' })
          return ''
        })
      }).catch(function () {
        self.setData({ error: '图片上传失败，请重试。' })
        return ''
      })
    },
    compress(src) {
      return new Promise(function (resolve) {
        if (!wx.compressImage) return resolve(src)
        wx.compressImage({
          src: src, quality: 70, compressedWidth: 1280,
          success: function (res) { resolve(res.tempFilePath || src) },
          fail: function () { resolve(src) },
        })
      })
    },
    contentType(path) {
      return /\.png$/i.test(path) ? 'image/png' : 'image/jpeg'
    },
    upload(path) {
      const contentType = this.contentType(path)
      const ext = contentType === 'image/png' ? '.png' : '.jpg'
      return new Promise(function (resolve, reject) {
        wx.cloud.uploadFile({
          cloudPath: 'activity-media/' + dayStamp() + '/' + Date.now() + '-' + randomSuffix() + ext,
          filePath: path,
          success: function (res) { resolve({ fileID: res.fileID, path: path }) },
          fail: reject,
        })
      })
    },
    reasonText(reason) {
      if (reason === 'unsafe') return '有图片未通过安全检查，已移除。'
      if (reason === 'too_large') return '有图片超过 1MB，已移除。'
      if (reason === 'read_failed') return '有图片读取失败，请重新上传。'
      return '图片安全检查暂不可用，请稍后重试。'
    },
    removeImage(e) {
      if (this.data.uploading) return
      const groupId = e.currentTarget.dataset.id
      const fileid = e.currentTarget.dataset.fileid
      let nextGroups = this.data.groups.map(group => {
        if (group.id !== groupId) return group
        return Object.assign({}, group, { fileIds: group.fileIds.filter(id => id !== fileid) })
      }).filter(group => group.fileIds.length)
      this.setData(Object.assign({ groups: nextGroups }, this.metaOf(nextGroups, this.data.coverFileId)), () => this.emitChange())
    },
    toggleGroupManage(e) {
      const id = e.currentTarget.dataset.id
      this.setData({ managedGroupId: this.data.managedGroupId === id ? '' : id })
    },
    moveGroup(e) {
      if (this.data.uploading) return
      const id = e.currentTarget.dataset.id
      const delta = Number(e.currentTarget.dataset.delta) || 0
      const paragraphCount = this.data.paragraphCount
      let moved = false
      const groups = this.data.groups.map(group => {
        if (group.id !== id) return group
        const anchor = clamp(group.anchor + delta, 0, paragraphCount)
        if (anchor !== group.anchor) moved = true
        return Object.assign({}, group, { anchor: anchor })
      })
      if (!moved) return
      this.setData({ groups: groups }, () => this.emitChange())
    },
    removeGroup(e) {
      if (this.data.uploading) return
      const id = e.currentTarget.dataset.id
      const self = this
      wx.showModal({
        title: '删除这组图片？',
        content: '这些图片会从正文移除；已上传到云存储的文件不会自动删除。',
        confirmText: '删除',
        confirmColor: '#B43D3B', // = --danger
        success: function (res) {
          if (!res.confirm) return
          const groups = self.data.groups.filter(group => group.id !== id)
          self.setData(Object.assign({ groups: groups, managedGroupId: '' },
            self.metaOf(groups, self.data.coverFileId)), function () { self.emitChange() })
        },
      })
    },
    openCover() { this.setData({ coverOpen: true }) },
    closeCover() { this.setData({ coverOpen: false }) },
    setCover(e) {
      const fileid = e.currentTarget.dataset.fileid || ''
      this.setData(Object.assign({ coverOpen: false }, this.metaOf(this.data.groups, fileid)), () => this.emitChange())
    },
    useDefaultCover() {
      this.setData(Object.assign({ coverOpen: false }, this.metaOf(this.data.groups, '')), () => this.emitChange())
    },
  },
})
