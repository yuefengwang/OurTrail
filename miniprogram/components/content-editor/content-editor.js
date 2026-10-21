'use strict'
const api = require('../../utils/api')

const MAX_IMAGES = 20
const MAX_BLOCK_IMAGES = 9

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
    blocks: [],
    coverFileId: '',
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
      const source = Array.isArray(this.data.initialContent) ? this.data.initialContent : []
      const blocks = source.map(block => block && block.type === 'images'
        ? { id: this.nextId(), type: 'images', fileIds: Array.isArray(block.fileIds) ? block.fileIds.slice() : [] }
        : { id: this.nextId(), type: 'text', text: (block && block.text) || '' })
      const all = this.fileIdsOf(blocks)
      const cover = all.indexOf(this.data.initialCover) !== -1 ? this.data.initialCover : ''
      this.setData({
        blocks: blocks,
        coverFileId: cover,
        imageCount: all.length,
        uploading: false, uploadTotal: 0, uploadDone: 0, message: '', error: '',
      })
      this.emitChange()
    },
    nextId() {
      this._seq = (this._seq || 0) + 1
      return 'ce-' + this._seq + '-' + Date.now().toString(36)
    },
    fileIdsOf(blocks) {
      const out = []
      ;(blocks || []).forEach(block => {
        if (block && block.type === 'images' && Array.isArray(block.fileIds)) out.push.apply(out, block.fileIds)
      })
      return out
    },
    clean() {
      const content = this.data.blocks
        .filter(block => block.type === 'text' ? block.text.trim() : block.fileIds.length)
        .map(block => block.type === 'text'
          ? { type: 'text', text: block.text }
          : { type: 'images', fileIds: block.fileIds.slice() })
      const all = this.fileIdsOf(content)
      return {
        content: content,
        coverFileId: all.indexOf(this.data.coverFileId) !== -1 ? this.data.coverFileId : '',
      }
    },
    emitChange() {
      const clean = this.clean()
      const count = this.fileIdsOf(clean.content).length
      if (count !== this.data.imageCount) this.setData({ imageCount: count })
      this.triggerEvent('change', clean)
    },
    onText(e) {
      const index = Number(e.currentTarget.dataset.index)
      this.setData({ ['blocks[' + index + '].text']: e.detail.value }, () => this.emitChange())
    },
    addText() {
      this.setData({ blocks: this.data.blocks.concat([{ id: this.nextId(), type: 'text', text: '' }]) }, () => this.emitChange())
    },
    addImages() {
      this.setData({ blocks: this.data.blocks.concat([{ id: this.nextId(), type: 'images', fileIds: [] }]) }, () => this.emitChange())
    },
    moveBlock(e) {
      if (this.data.uploading) return
      const index = Number(e.currentTarget.dataset.index)
      const target = index + Number(e.currentTarget.dataset.delta)
      if (target < 0 || target >= this.data.blocks.length) return
      const blocks = this.data.blocks.slice()
      const tmp = blocks[index]
      blocks[index] = blocks[target]
      blocks[target] = tmp
      this.setData({ blocks: blocks }, () => this.emitChange())
    },
    removeBlock(e) {
      if (this.data.uploading) return
      const index = Number(e.currentTarget.dataset.index)
      const blocks = this.data.blocks.slice()
      const removed = blocks.splice(index, 1)[0]
      const next = { blocks: blocks }
      if (removed && removed.type === 'images' && removed.fileIds.indexOf(this.data.coverFileId) !== -1) next.coverFileId = ''
      this.setData(next, () => this.emitChange())
    },
    setCover(e) {
      this.setData({ coverFileId: e.currentTarget.dataset.fileid || '' }, () => this.emitChange())
    },
    removeImage(e) {
      if (this.data.uploading) return
      const index = Number(e.currentTarget.dataset.index)
      const fileid = e.currentTarget.dataset.fileid
      const block = this.data.blocks[index]
      if (!block || block.type !== 'images') return
      const fileIds = block.fileIds.filter(f => f !== fileid)
      const next = { ['blocks[' + index + '].fileIds']: fileIds }
      if (this.data.coverFileId === fileid) next.coverFileId = ''
      this.setData(next, () => this.emitChange())
    },
    pickImages(e) {
      if (this.data.uploading) return
      const index = Number(e.currentTarget.dataset.index)
      const block = this.data.blocks[index]
      if (!block || block.type !== 'images') return
      const remaining = MAX_IMAGES - this.data.imageCount
      if (remaining <= 0) {
        this.setData({ error: '活动图片最多 ' + MAX_IMAGES + ' 张。' })
        return
      }
      const count = Math.max(1, Math.min(3, MAX_BLOCK_IMAGES - block.fileIds.length, remaining))
      const self = this
      wx.chooseMedia({
        count: count,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: function (res) {
          const paths = (res.tempFiles || []).map(f => f.tempFilePath).filter(Boolean)
          if (paths.length) self.uploadFiles(index, paths)
        },
        fail: function (err) {
          const msg = String((err && err.errMsg) || '')
          if (/cancel/i.test(msg)) return
          self.setData({ error: '打开相册失败，请重试。' })
        },
      })
    },
    uploadFiles(index, paths) {
      if (this.data.uploading || !paths.length) return
      const self = this
      const results = new Array(paths.length).fill('')
      let cursor = 0
      let done = 0
      this.setData({ uploading: true, uploadTotal: paths.length, uploadDone: 0, message: '', error: '' })
      this.triggerEvent('busy', { busy: true })
      const worker = function () {
        if (cursor >= paths.length) return Promise.resolve()
        const slot = cursor
        cursor += 1
        return self.one(paths[slot]).then(function (fileID) {
          results[slot] = fileID
          done += 1
          self.setData({ uploadDone: done })
          return worker()
        })
      }
      const workers = []
      for (let i = 0; i < Math.min(3, paths.length); i++) workers.push(worker())
      Promise.all(workers).then(function () {
        const added = results.filter(Boolean)
        const block = self.data.blocks[index]
        if (block && block.type === 'images' && added.length) {
          self.setData({
            ['blocks[' + index + '].fileIds']: block.fileIds.concat(added),
            uploading: false,
            message: '已添加 ' + added.length + ' 张图片' + (added.length < paths.length ? '，其余未通过检查。' : '。'),
          }, function () { self.emitChange() })
        } else {
          self.setData({ uploading: false })
        }
        self.triggerEvent('busy', { busy: false })
      }).catch(function () {
        self.setData({ uploading: false, error: '图片处理失败，请重试。' })
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
  },
})
