// 观察点与轨迹点组：独立天气模块的本地数据层（P3 设计文档 §6）。
//
// 纯 util——**不引用 wx**（utils/AGENTS.md 的纯度规则：wx 依赖只允许 api.js 与 draft.js）。
// storage 由调用方注入：页面传 draft.js 导出的 wxStorage 适配器，测试传内存 Map 适配器，
// 因此本文件可以被 tools/*-test.js 在无桩的 Node 下直接 require。
//
// 坐标约定：库存一律 GCJ-02（全站既有决策）。WGS-84 输入的转换在调用方完成
// （gpx.js 的 wgsToGcj），本文件只存数字、不关心坐标系来历。
'use strict'

const POINTS_CAP = 20
const TRACKS_CAP = 10
const POINTS_KEY = 'ourtrail.watchpoints.v1'
const TRACKS_KEY = 'ourtrail.watchtracks.v1'

function genId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function deepCopy(v) {
  return JSON.parse(JSON.stringify(v))
}

// 去重网格：3dp ≈ 百米级。同格视为"同一个点"，由调用方决定是否提示替换。
function dedupeKey(lat, lng) {
  return Number(lat).toFixed(3) + ',' + Number(lng).toFixed(3)
}

// 点名缺省时的展示文案（查询页与 hub 共用，不显示"未命名"）
function coordName(lat, lng) {
  return '北纬 ' + Number(lat).toFixed(2) + ' · 东经 ' + Number(lng).toFixed(2)
}

// 分享降精度（P3 §5.3 决策 (b)：分享 URL 只带 3dp 坐标，不带 name/ele）。
// ≈百米网格足够定位山头，且不泄露选点时的精确位置。
function sharePointPayload(lat, lng) {
  return { lat: Number(Number(lat).toFixed(3)), lng: Number(Number(lng).toFixed(3)) }
}

/**
 * 从 parseGpx 返回体组装轨迹点组（P3 §6 评审校对：字段来源按实际返回取）：
 * - distanceKm/ascentM 取顶层（恒为数字）；
 * - hasEle 取 stats.hasElevation；
 * - hasTime parseGpx 不给，遍历 points 判定（每点 time 是否可解析）——
 *   当年 editor 丢 ele 的教训：字段在哪一层组装就在哪一层显式写明，不在下游补猜。
 * points 投影为 TrackPoint { id, name, lat, lng, ele, eleSource:'gpx', time }，
 * id 在导入时生成且不变——查询页的窗口缓存按 point.id 判定，切节点不能误复用。
 */
function fromGpx(parsed, fileName) {
  if (!parsed || !parsed.ok || !parsed.points || parsed.points.length < 2) return null
  const points = parsed.points.map(p => ({
    id: genId('wp'),
    name: p.name || '',
    lat: p.coordinates.lat,
    lng: p.coordinates.lng,
    ele: Number.isFinite(p.ele) ? Math.round(p.ele) : null,
    eleSource: 'gpx',
    time: p.time || null,
  }))
  return {
    id: genId('wt'),
    name: String(fileName || '轨迹').replace(/\.gpx$/i, ''),
    importedAt: new Date().toISOString(),
    stats: {
      count: points.length,
      distanceKm: Number(parsed.distanceKm) || 0,
      ascentM: Number(parsed.ascentM) || 0,
      hasEle: parsed.stats ? parsed.stats.hasElevation === true : points.some(p => p.ele !== null),
      hasTime: points.some(p => p.time && Number.isFinite(Date.parse(p.time))),
    },
    points,
  }
}

/**
 * @param storage { get(key) -> any|null, set(key, value) -> void }  只这两个原子操作
 */
function createWatchPoints(storage) {
  function readList(key) {
    const v = storage.get(key)
    return Array.isArray(v) ? v : []
  }
  function writeList(key, list) {
    storage.set(key, list)
  }

  return {
    POINTS_CAP,
    TRACKS_CAP,

    listPoints() { return deepCopy(readList(POINTS_KEY)) },
    listTracks() { return deepCopy(readList(TRACKS_KEY)) },
    getTrack(id) {
      return deepCopy(readList(TRACKS_KEY).find(t => t.id === id) || null)
    },

    // 保存单点：带已有 id = 更新（替换语义沿用原 id/createdAt，不产生重复行）；
    // 否则追加。容量超限返回 {ok:false, reason:'cap'}，由调用方给明确提示，不静默挤掉。
    savePoint(input) {
      const list = readList(POINTS_KEY)
      const lat = Number(input.lat)
      const lng = Number(input.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { ok: false, reason: 'invalid' }
      }
      const existing = input.id ? list.find(p => p.id === input.id) : null
      if (existing) {
        Object.assign(existing, {
          name: input.name || '',
          lat, lng,
          ele: Number.isFinite(input.ele) ? Math.round(input.ele) : null,
          eleSource: input.eleSource || 'manual',
        })
        writeList(POINTS_KEY, list)
        return { ok: true, point: deepCopy(existing), updated: true }
      }
      if (list.length >= POINTS_CAP) return { ok: false, reason: 'cap' }
      const point = {
        id: genId('wp'),
        name: input.name || '',
        lat, lng,
        ele: Number.isFinite(input.ele) ? Math.round(input.ele) : null,
        eleSource: input.eleSource || 'manual',
        createdAt: new Date().toISOString(),
      }
      list.push(point)
      writeList(POINTS_KEY, list)
      return { ok: true, point: deepCopy(point), updated: false }
    },

    deletePoint(id) {
      writeList(POINTS_KEY, readList(POINTS_KEY).filter(p => p.id !== id))
    },

    saveTrack(set) {
      const list = readList(TRACKS_KEY)
      if (list.length >= TRACKS_CAP) return { ok: false, reason: 'cap' }
      list.push(deepCopy(set))
      writeList(TRACKS_KEY, list)
      return { ok: true }
    },

    deleteTrack(id) {
      writeList(TRACKS_KEY, readList(TRACKS_KEY).filter(t => t.id !== id))
    },
  }
}

module.exports = {
  createWatchPoints, fromGpx, dedupeKey, coordName, sharePointPayload,
  POINTS_CAP, TRACKS_CAP, POINTS_KEY, TRACKS_KEY,
}
