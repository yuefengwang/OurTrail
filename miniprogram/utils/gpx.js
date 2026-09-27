// GPX 解析：提取航点(wpt)/路线点(rtept)/轨迹点(trkpt)，生成路线节点 + 里程 + 爬升。
// 纯函数、无 wx 依赖，可直接在 node 下测试。
'use strict'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_POINTS = 12

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
    out.push({
      lat,
      lng,
      ele: Number.isFinite(ele) && inner.indexOf('<ele') !== -1 ? ele : null,
      name: decodeEntities(child(inner, 'name')),
    })
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
      source.push({ lat: p.lat, lng: p.lng, ele: p.ele, name: km > 0.05 ? '约 ' + km + ' 公里处' : '' })
    }
  }
  if (source.length < 2) return []

  return source.map((p, i) => {
    let name = p.name
    if (!name) {
      if (i === 0) name = '起点'
      else if (i === source.length - 1) name = '终点'
      else name = '节点 ' + i
    }
    return {
      name,
      kind: i === 0 ? 'start' : (i === source.length - 1 ? 'finish' : 'checkpoint'),
      coordinates: { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 },
    }
  })
}

/**
 * 解析 GPX 文本 → { ok, points, distanceKm, ascentM, stats }
 * points: [{name, kind, coordinates:{lat,lng}}]，可直接填入编辑器路线节点。
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
  return {
    ok: true,
    points,
    distanceKm: Math.round(m.distance * 10) / 10,
    ascentM: Math.round(m.ascent),
    stats: {
      waypoints: parsed.waypoints.length,
      routePoints: parsed.routePoints.length,
      trackPoints: parsed.track.length,
      hasElevation: parsed.track.some(p => p.ele !== null) || parsed.routePoints.some(p => p.ele !== null),
    },
  }
}

module.exports = { parseGpx, decodeEntities, extractPoints, measure, haversineKm, MAX_FILE_BYTES }
