// 天气本地缓存：查询失败时的「软降级」数据源。
//
// 立场：缓存**不替代**成功路径——查到新数据照常渲染、照常覆盖；它只在一件事上出场——
// 这一次没连上（超时/断网/气象服务故障），而同一个点、同一天不久前取到过数据。
// 那时一面错误墙不如一份标明了时效的旧数据：山里信号抖动是常态，
// 「先看 X 小时前的，连上再刷」比「什么都看不了」更接近户外人员的真实需要。
//
// 纯 util——**不引用 wx**（utils/AGENTS.md 纯度规则：wx 依赖只允许 api.js 与 draft.js）。
// storage 由调用方注入：页面传 draft.js 的 wxStorage 适配器，测试传内存 Map 适配器。
//
// 容量按字节风险设计：单条目是一整份预报返回体（168h series + cloudLevels，约百 KB 级），
// 而 wx.setStorageSync 单键上限 1MB ⇒ CAP 取 6；写失败被适配器吞掉，缓存是增强不是依赖。
'use strict'

const KEY = 'ourtrail.weather.v1'
const CAP = 6
// 兜底展示的最长时效：超过 12 小时的旧预报不再冒充「现在的天气」（云层时过境迁，
// 拿一天前的剖面讲今天的云海是编造）。页面按 ageMs 与它比较后决定用不用。
const MAX_AGE_MS = 12 * 3600000

function deepCopy(v) {
  return JSON.parse(JSON.stringify(v))
}

// 时效的人话：缓存条目 → 「X 分钟前 / X 小时前 / X 天前」（供页面横幅，纯函数）
function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '不久前'
  const m = Math.floor(ms / 60000)
  if (m < 1) return '不久前'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

/**
 * @param storage { get(key) -> any|null, set(key, value) -> void }
 * @param now     () => ms（测试注入假钟；缺省 Date.now）
 */
function createWeatherCache(storage, now) {
  const clock = typeof now === 'function' ? now : Date.now

  function readAll() {
    const v = storage.get(KEY)
    return v && typeof v === 'object' ? v : {}
  }

  // 只留最近 CAP 条：wx storage 单键 1MB 上限，旧数据先淘汰
  function writeAll(all) {
    const kept = {}
    Object.keys(all)
      .sort((a, b) => String((all[b] || {}).savedAt || '').localeCompare(String((all[a] || {}).savedAt || '')))
      .slice(0, CAP)
      .forEach(k => { kept[k] = all[k] })
    storage.set(KEY, kept)
  }

  return {
    MAX_AGE_MS,

    // scope = 点身份（id + 2dp 坐标网格，与云端缓存同口径）：换点/换日期都不误命中
    keyFor(scope, date) {
      return String(scope) + '|' + String(date)
    },

    /** @returns {{result, savedAt, ageMs}|null} 深拷贝，调用方改不坏缓存 */
    get(scope, date) {
      const entry = readAll()[this.keyFor(scope, date)]
      if (!entry || !entry.result) return null
      const savedAt = entry.savedAt || ''
      const t = Date.parse(savedAt)
      return {
        result: deepCopy(entry.result),
        savedAt,
        ageMs: Number.isFinite(t) ? Math.max(0, clock() - t) : Infinity,
      }
    },

    /** 只收 ready 形状（调用方保证）；存储失败静默——缓存是增强不是依赖 */
    put(scope, date, result) {
      if (!result || typeof result !== 'object' || result.status !== 'ready') return
      const all = readAll()
      all[this.keyFor(scope, date)] = {
        v: 1,
        savedAt: new Date(clock()).toISOString(),
        result: deepCopy(result),
      }
      writeAll(all)
    },
  }
}

module.exports = { createWeatherCache, ageText, KEY, CAP, MAX_AGE_MS }
