// 光污染 / 天空亮度：DarkSkySites 免费 API（x-api-key，30k/月，全球，SQM/Bortle）。
// 这是仓库第一个外部密钥：只从云函数环境变量 DARKSKY_API_KEY 读取，绝不写进代码/仓库；
// 无 key / 401 / 超时都返回 {lightPollution:null, reason}，由客户端明确标“未计入光污染”并封顶星级。
// 解析函数纯逻辑，可在 node 下测；网络只在 fetchLightPollution 内。
'use strict'

const https = require('https')

const API = 'https://darkskysites.com/api/sqm'

function apiKey() {
  return String(process.env.DARKSKY_API_KEY || '').trim()
}

function url(lat, lng) {
  return API + '?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng)
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parseLightPollution(json) {
  if (!json || typeof json !== 'object') return null
  const sqm = num(json.sqm)
  const bortle = num(json.bortleClass != null ? json.bortleClass : json.bortle)
  if (sqm == null && bortle == null) return null
  return {
    source: 'darkskysites',
    sqm: sqm == null ? null : Math.round(sqm * 100) / 100,
    bortle: bortle == null ? null : Math.round(bortle),
    dataset: json.dataset ? String(json.dataset) : null,
  }
}

function getJson(target, key) {
  return new Promise((resolve, reject) => {
    const req = https.get(target, { headers: { 'x-api-key': key } }, res => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(Object.assign(new Error('光污染服务不可用（' + res.statusCode + '）'), { status: res.statusCode }))
      }
      let buf = ''
      res.on('data', c => { buf += c })
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) } catch (e) { reject(new Error('光污染数据解析失败')) }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('光污染服务超时')))
  })
}

async function fetchLightPollution(lat, lng) {
  const key = apiKey()
  if (!key) return { lightPollution: null, reason: 'no-key' }
  try {
    const json = await getJson(url(lat, lng), key)
    return { lightPollution: parseLightPollution(json), reason: null }
  } catch (e) {
    const status = e && e.status
    return { lightPollution: null, reason: status === 401 || status === 403 ? 'unauthorized' : 'unavailable' }
  }
}

module.exports = { API, apiKey, url, parseLightPollution, fetchLightPollution }
