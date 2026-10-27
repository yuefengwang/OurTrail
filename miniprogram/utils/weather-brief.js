// 活动详情「出发日天气」摘要（纯函数，wx-free）。
// 只组合 getWeatherByPoint / getWeather 已经返回的事实；不新增阈值、不重算天相、不承诺天气。
'use strict'

const F = require('./format')

function round(v) {
  return Number.isFinite(v) ? String(Math.round(v)) : '—'
}

function noData(text, retry) {
  return {
    ready: false,
    status: 'empty',
    text: text,
    retry: !!retry,
    dayLabel: '',
    phraseLabel: '',
    tone: 'neutral',
    hourText: '',
    dayText: '',
    pointText: '',
    staleText: '',
    riskText: '',
  }
}

/**
 * @param {object} input { startAt, pointName, result, risks }
 * @returns flat display object; `ready` 才渲染小时/日读数，否则只渲染 text。
 */
function buildBrief(input) {
  const startAt = input && input.startAt
  const pointName = (input && input.pointName) || ''
  const result = (input && input.result) || {}
  const risks = (input && input.risks) || []

  if (!startAt) return noData('活动还没有确定出发时间，暂时不能按出发日查天气。')
  if (!Number.isFinite(Date.parse(startAt))) return noData('出发时间不是有效时刻，暂时查不了天气。')
  if (!pointName) return noData('路线还没有可定位的起点，暂时查不了出发日天气。')
  if (result.status === 'out_of_range') return noData('出发日不在 14 天预报窗口内，临近再查。')
  if (result.status !== 'ready') {
    return noData(result.message || '天气服务暂时没有返回可用数据。', true)
  }

  const p = F.cnParts(startAt)
  const date = p.date
  const days = result.days || []
  const day = days.find(d => d.date === date)
  if (!day) return noData('出发日没有逐日预报，临近再查。', true)

  // 只认“出发那一小时”的精确读数；没有就只给全天，不拿 00:00 冒充 08:00。
  const series = result.series || []
  const hour = series.find(h => h.d === date && h.t === p.time) || null
  const phrase = F.weatherPhrase(day.code)
  const hourPhrase = hour ? F.weatherPhrase(hour.code) : null
  const hourText = hour
    ? p.time + ' ' + hourPhrase.label + ' ' + round(hour.temp) + '°C · 降水 ' + round(hour.pop) + '% · 风 ' + round(hour.wind) + ' km/h'
    : ''
  const dayText = '全天 ' + round(day.tMin) + '–' + round(day.tMax) + '°C · 降水概率 ' + round(day.precipProbMax) + '%'
  const staleText = result.stale
    ? '天气数据不是实时' + (result.staleAt ? '（取于 ' + F.dtFull(result.staleAt) + '）' : '')
    : ''
  const riskText = risks.length && risks[0].title
    ? '首要风险：' + risks[0].title + '。完整说明见下方风险提示。'
    : ''

  return {
    ready: true,
    status: 'ready',
    text: '',
    retry: false,
    dayLabel: F.dateLabel(startAt),
    phraseLabel: phrase.label,
    tone: phrase.tone,
    hourText,
    dayText,
    pointText: '起点 · ' + pointName,
    staleText,
    riskText,
  }
}

module.exports = { buildBrief }
