// GPX 解析：提取航点(wpt)/路线点(rtept)/轨迹点(trkpt)，生成路线节点 + 里程 + 爬升。
// 纯函数、无 wx 依赖，可直接在 node 下测试。
'use strict'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_POINTS = 12

// ele 合法区间与 cloudfunctions/trailApi/domain/schema.js 的 RoutePoint.ele（specNum(-500, 9000)）同源，
// tools/gpx-test.js 有跨检防止两处漂移。越界高程（-9999 哨兵、99999 脏值、英尺制）若透传，
// 会被 schema 严格模式拒绝——整场活动报「操作字段不完整或格式不正确」，而非降级为无高程。
const ELE_MIN = -500
const ELE_MAX = 9000

// 越界 ele 视为缺失（返回 null），而不是钳制到边界：哨兵值钳制后会污染云层带/云海判断。
function saneEle(v) {
  return Number.isFinite(v) && v >= ELE_MIN && v <= ELE_MAX ? Math.round(v) : null
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .trim()
}

function attr(attrs, name) {
  const m = new RegExp(name + '="([^"]*)"').exec(attrs)
  return m ? m[1] : ''
}

function child(text, tag) {
  const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>').exec(text)
  return m ? decodeEntities(m[1]) : ''
}

// 提取所有指定标签的点：<trkpt lat lon><ele/><name/></trkpt>，兼容自闭合
function extractPoints(xml, tags) {
  const out = []
  const re = new RegExp('<(' + tags.join('|') + ')\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/\\1>)', 'g')
  let m
  while ((m = re.exec(xml)) !== null) {
    const lat = Number(attr(m[2], 'lat'))
    const lng = Number(attr(m[2], 'lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    const inner = m[4] || ''
    const ele = Number(child(inner, 'ele'))
    const timeStr = child(inner, 'time')
    const time = timeStr ? Date.parse(timeStr) : NaN
    out.push({
      lat,
      lng,
      ele: inner.indexOf('<ele') !== -1 ? saneEle(ele) : null,
      name: decodeEntities(child(inner, 'name')),
      time: Number.isFinite(time) ? time : null,
    })
  }
  return out
}

// WGS-84 → GCJ-02 纠偏（中国境内；境外原样返回）。全站存储约定 GCJ-02：
// 地图选点/签到本就 GCJ，GPX（WGS）在导入时统一转换，否则上图偏移数百米。
const GCJ_A = 6378245.0
const GCJ_EE = 0.00669342162296594323

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0
  return ret
}

function wgsToGcj(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng }
  const radLat = (lat * Math.PI) / 180
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return { lat: Math.round((lat + dLat) * 1e6) / 1e6, lng: Math.round((lng + dLng) * 1e6) / 1e6 }
}

// GCJ-02 → WGS-84 逆变换：无解析逆，用局部线性反演迭代收敛（2 次即达亚毫米级）。
// 场景：库存坐标是 GCJ，喂给要 WGS-84 的外部服务（如 Open-Meteo）前转换。
function gcjToWgs(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng }
  let wLat = lat
  let wLng = lng
  for (let i = 0; i < 2; i++) {
    const cur = wgsToGcj(wLat, wLng)
    wLat += lat - cur.lat
    wLng += lng - cur.lng
  }
  return { lat: Math.round(wLat * 1e6) / 1e6, lng: Math.round(wLng * 1e6) / 1e6 }
}

// 按累计里程均匀采样到 max 点（保留首尾），画 polyline 用——原始轨迹可达数万点。
function simplifyTrack(points, max) {
  if (max === undefined) max = 200
  const n = points.length
  if (n <= max) return points.slice()
  const m = measure(points)
  const total = m.distance
  const out = []
  let cursor = 0
  let lastIdx = -1
  for (let k = 0; k < max; k++) {
    const target = (total * k) / (max - 1)
    while (cursor < n - 1 && m.cumulative[cursor + 1] <= target) cursor++
    if (cursor !== lastIdx) {
      out.push(points[cursor])
      lastIdx = cursor
    }
  }
  if (lastIdx !== n - 1) {
    // 浮点舍入可能让 k=max-1 的采样差一点没够到真实总里程（(total*(max-1))/(max-1) < total），
    // 循环停在倒数第二点——尾点必须进结果，但总数不得超 max（schema 严检 track ≤ 200，
    // 曾因 201 点被整单拒绝：2026-10-06 真机「操作字段不完整或格式不正确」）。
    if (out.length >= max) out[out.length - 1] = points[n - 1]
    else out.push(points[n - 1])
  }
  return out
}

function haversineKm(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

// 沿点列累计距离与爬升
function measure(points) {
  let distance = 0
  let ascent = 0
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(points[i - 1], points[i])
    distance += d
    cumulative.push(distance)
    const e0 = points[i - 1].ele
    const e1 = points[i].ele
    if (e0 !== null && e1 !== null && e1 > e0) ascent += e1 - e0
  }
  return { distance, ascent, cumulative }
}

// 生成路线节点：首点起点、末点终点、其余 checkpoint。
// 优先用有名字的航点/路线点；不足时按里程均分采样轨迹点。
function toRoutePoints(parsed) {
  let source = []
  if (parsed.waypoints.length >= 2) {
    source = parsed.waypoints.slice(0, MAX_POINTS)
  } else if (parsed.routePoints.length >= 2) {
    source = parsed.routePoints.slice(0, MAX_POINTS)
  } else if (parsed.track.length >= 2) {
    const m = measure(parsed.track)
    const total = m.distance
    const count = Math.min(8, Math.max(1, Math.round(total / 1.5)))
    const picks = [0, parsed.track.length - 1]
    for (let k = 1; k <= count; k++) {
      const target = (total * k) / (count + 1)
      let best = 0
      for (let i = 1; i < m.cumulative.length; i++) {
        if (Math.abs(m.cumulative[i] - target) < Math.abs(m.cumulative[best] - target)) best = i
      }
      picks.push(best)
    }
    picks.sort((a, b) => a - b)
    // 去重（首尾可能与采样点重合）
    const seen = new Set()
    source = []
    for (const i of picks) {
      if (seen.has(i)) continue
      seen.add(i)
      const p = parsed.track[i]
      const km = Math.round(m.cumulative[i] * 10) / 10
      source.push({ lat: p.lat, lng: p.lng, ele: p.ele, time: p.time, name: km > 0.05 ? '约 ' + km + ' 公里处' : '' })
    }
  }
  if (source.length < 2) return []

  // 航点/路线点常常没有 <time>/<ele>（只有轨迹点带），按最近的轨迹点补齐：
  // 这是需求"按轨迹标注点判断第几天抵达"的必要一步——具名航点正是用户看天气时对照的点。
  // 时间误差等于轨迹采样间隔（通常秒到分钟级），高程误差等于相邻采样点的高程差。
  const timed = parsed.track.filter(p => Number.isFinite(p.time) || Number.isFinite(p.ele))
  const dense = timed.length > 2000 ? timed.filter((_, i) => i % Math.ceil(timed.length / 2000) === 0) : timed
  const nearest = p => {
    if (!dense.length || (Number.isFinite(p.time) && Number.isFinite(p.ele))) return p
    let best = null
    let bestKm = Infinity
    for (const t of dense) {
      const d = haversineKm(p, t)
      if (d < bestKm) { bestKm = d; best = t }
    }
    return best ? { time: best.time, ele: best.ele } : p
  }

  return source.map((p, i) => {
    let name = p.name
    if (!name) {
      if (i === 0) name = '起点'
      else if (i === source.length - 1) name = '终点'
      else name = '节点 ' + i
    }
    const c = wgsToGcj(p.lat, p.lng)
    const out = {
      name,
      kind: i === 0 ? 'start' : (i === source.length - 1 ? 'finish' : 'checkpoint'),
      coordinates: c,
    }
    // 轨迹附带的时刻与高程：用户不可编辑，供按节点推算抵达日与判断是否高过云层带
    const meta = nearest(p)
    const time = Number.isFinite(p.time) ? p.time : meta.time
    const ele = saneEle(Number.isFinite(p.ele) ? p.ele : meta.ele)
    if (Number.isFinite(time)) out.time = new Date(time).toISOString()
    if (ele !== null) out.ele = ele
    return out
  })
}

// 从解析结果推断建议的风险提示与装备清单：节点名关键词 + 里程/爬升/天数规则。
// 只做"预填建议"——导入后在编辑器步骤 3 可修改，且只填空字段不覆盖用户已填内容。
function suggestTrailInfo(parsed, m) {
  const text = [].concat(parsed.waypoints, parsed.routePoints)
    .map(p => p.name || '').join(' ')
  const km = Math.round(m.distance)
  const ascent = Math.round(m.ascent)
  // 轨迹时间戳跨天数（无时间戳视为单日）：多日判定驱动露营/补给类建议
  const allTimes = [].concat(parsed.track, parsed.routePoints, parsed.waypoints)
    .map(p => p.time).filter(t => Number.isFinite(t))
  const days = allTimes.length >= 2
    ? Math.round((Math.max.apply(null, allTimes) - Math.min.apply(null, allTimes)) / 86400000) + 1
    : 1
  const risks = []
  const equipment = ['徒步鞋（防滑）', '饮用水（每人至少 1.5L）', '防晒（帽子/防晒霜）']
  if (/溪|河|涧|湖|桥|瀑|沟|谷|潭/.test(text)) {
    risks.push({ title: '涉水与湿滑路段', advice: '溪谷行进保持队距，湿滑处互相照应，水位上涨时果断绕行或折返。' })
    equipment.push('溯溪鞋或备用鞋', '防水袋（护手机与证件）')
  }
  if (/垭口|山脊|崖|顶|峰|岩/.test(text)) {
    risks.push({ title: '垭口大风与天气突变', advice: '出发前查天气窗，随身备防风保暖衣物，大风时不停留垭口。' })
    equipment.push('冲锋衣（防风）')
  }
  if (/营地|宿营|露营|扎营|民宿/.test(text)) {
    risks.push({ title: '夜间低温与照明不足', advice: '天黑前扎营，头灯与保暖层每人必备，夜间不单独行动。' })
    equipment.push('帐篷/睡袋（按人数）', '头灯', '炉具与餐具')
  } else if (days >= 2) {
    // 轨迹跨多天但节点名没有露营收敛词：按多日徒步补给给建议
    risks.push({ title: days + ' 天行程的露营与补给', advice: '营地选背风、近水源处，按 ' + days + ' 天带足饮水、食物与备用电源，夜间不单独行动。' })
    equipment.push('帐篷/睡袋（按人数）', '头灯', '备用电池/充电宝')
  }
  if (ascent >= 800) {
    risks.push({ title: '累计爬升约 ' + ascent + ' 米，体力消耗大', advice: '控制节奏、按体能分队，出发前保证睡眠与补给。' })
    equipment.push('登山杖')
  }
  if (km >= 15) {
    risks.push({ title: '长距离（约 ' + km + ' km）', advice: '分段休息与补给，携带足量水与能量食品，预留天黑前下撤时间。' })
    equipment.push('能量食品（坚果/能量胶）')
  }
  if (!risks.length) {
    risks.push({ title: '山区天气多变', advice: '出发前查看天气预报，备雨具与保暖层，恶劣天气果断改期。' })
  }
  return {
    risks,
    equipment: equipment.filter((item, i) => equipment.indexOf(item) === i),
    days,
  }
}

/**
 * 解析 GPX 文本 → { ok, points, track, distanceKm, ascentM, stats, suggestions }
 * points: [{name, kind, coordinates:{lat,lng}}]，可直接填入编辑器路线节点。
 * track: 采样到 ≤200 点的轨迹折线（已转 GCJ-02），供地图画线；无轨迹时为 []。
 * suggestions: 按节点关键词与里程/爬升推断的风险/装备预填建议。
 */
function parseGpx(xml) {
  if (typeof xml !== 'string' || xml.length > MAX_FILE_BYTES) {
    return { ok: false, error: '文件为空或超过 8MB，请换一个 GPX 文件。' }
  }
  if (xml.indexOf('<gpx') === -1) {
    return { ok: false, error: '不是有效的 GPX 文件（缺少 <gpx> 根节点）。' }
  }
  const parsed = {
    waypoints: extractPoints(xml, ['wpt']),
    routePoints: extractPoints(xml, ['rtept']),
    track: extractPoints(xml, ['trkpt']),
  }
  const points = toRoutePoints(parsed)
  if (points.length < 2) {
    return { ok: false, error: 'GPX 里没有可用的路线点（需要至少 2 个航点/路线点，或一条轨迹）。' }
  }
  const m = measure(parsed.track.length >= 2 ? parsed.track : parsed.routePoints)
  const lineSource = parsed.track.length >= 2 ? parsed.track : (parsed.routePoints.length >= 2 ? parsed.routePoints : [])
  const track = simplifyTrack(lineSource, 200).map(p => wgsToGcj(p.lat, p.lng))
  return {
    ok: true,
    points,
    track,
    distanceKm: Math.round(m.distance * 10) / 10,
    ascentM: Math.round(m.ascent),
    suggestions: suggestTrailInfo(parsed, m),
    stats: {
      waypoints: parsed.waypoints.length,
      routePoints: parsed.routePoints.length,
      trackPoints: parsed.track.length,
      hasElevation: parsed.track.some(p => p.ele !== null) || parsed.routePoints.some(p => p.ele !== null),
    },
  }
}

module.exports = { parseGpx, decodeEntities, extractPoints, measure, haversineKm, wgsToGcj, gcjToWgs, simplifyTrack, suggestTrailInfo, saneEle, ELE_MIN, ELE_MAX, MAX_FILE_BYTES }
