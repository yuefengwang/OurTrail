/**
 * 天气模块 · 户外条件装配（V2）
 *
 * ── 边界（务必遵守，勿越界）────────────────────────────────────────
 * 本文件**不含任何天相阈值**。评级与结论一律来自 sky.summarize 的产出（score/label/tone），
 * 本文件只做三件事：安全提示的字面规则、总评的均值汇总、星级展示语言。
 * 与 utils/agenda.js 同一立场：图（meteogram 标记）/ 日程 / 结论卡共用 sky.js 一个来源。
 *
 * 「什么算一个实心云带」不在这里定义（切片二）：`factsFor('cloudSea')` 原先自己写了一遍
 * `band.cover >= 80`，与 `sky.hourMarks` 的 cloudSea 标记、`sky.cloudSeaConclusion` 的成层筛选
 * 是三处同值抄本——而那句话本来就是 provider `cloudBandAt` 的成带规则的重述。
 * 现在三处都调用 `cloud-layer-facts.isCloudBand`，数字只有一个出处；
 * 影子常量测试见 `tools/cloud-layer-facts-test.js` §7（改一处，三处一起动，否则门红）。
 *
 * 修复记录（2026-10，V2 迁移时顺手修正的确认 bug，见 docs/weather-ux/production-gap-analysis.md）：
 *   WMO 雪码范围 71–86 → 71–77 ∪ 85–86。80–82 是**阵雨**，旧范围会让 14°C 的阵雨日
 *   触发「0℃ 层低于此点，降水可能为雪」（真机截图可见此误报）。
 *
 * wx-free：不得出现任何 wx.*（tools/weather-v2-test 在 node 下跑）。
 */

'use strict'

const sky = require('./sky')
const CLF = require('./cloud-layer-facts.js')
const K = require('./evidence-kind.js').KIND

/* 结论项 `at` 的完整形态 `YYYY-MM-DDTHH:mm`。只有这种**带日期**的值才可能表示跨夜；
   旧的 `HH:mm` 锚点与任何缺测一律按"同日"处理（失败关闭到旧行为，不猜日期）。 */
const AT_FULL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/* ---------- 安全提示的字面规则 ---------- */

// WMO 天气码 → 是否雪：71–77 雪、85–86 阵雪；**80–82 是阵雨**（rain showers）
function isSnowCode(code) {
  const c = Number(code)
  if (!Number.isFinite(c)) return false
  return (c >= 71 && c <= 77) || (c >= 85 && c <= 86)
}

/**
 * 当日安全提示（danger/warning，独立于天相）。最多 2 条，按优先级截取。
 * 从 pages/weather 的 buildCallouts 迁入（V2）：①修 WMO 雪码范围；②删「清晨云海概率较大」
 * success callout——云海结论由 Conditions 的云海卡唯一表达，避免两处结论打架（V1 病根）。
 * @param day   days[] 中所选日（code / precipProbMax）
 * @param detail 所选日 24h 逐时（code/freezing/band/visibility/pop/showers）
 * @param elev  此点可信海拔（m），可能为 null
 */
function buildCallouts(day, detail, elev) {
  const out = []
  const d = day || {}
  const hours = detail || []
  if (Number(d.code) >= 95 || hours.some(h => Number(h.code) >= 95)) {
    out.push({ tone: 'danger', title: '有雷暴概率，不建议安排上山' })
  }
  if (isSnowCode(d.code)
    || (Number.isFinite(elev) && hours.some(h => Number.isFinite(h.freezing) && h.freezing < elev))) {
    out.push({ tone: 'danger', title: '0℃ 层低于此点，降水可能为雪' })
  }
  const inCloud = hours.some(h => h.band && Number.isFinite(elev)
    && h.band.base <= elev && elev <= h.band.top)
  if (hours.some(h => Number.isFinite(h.visibility) && h.visibility < 1) || inCloud) {
    out.push({ tone: 'warning', title: '此点可能入云（雾），观景窗口有限' })
  }
  if (Number(d.precipProbMax) >= 60
    && hours.some(h => h.t >= '12' && (h.pop >= 50 || Number(h.showers) > 0))) {
    out.push({ tone: 'warning', title: '午后阵雨概率高，建议早点出发' })
  }
  return out.slice(0, 2)
}

/* ---------- 评级展示语言（V2） ---------- */

// 星级：三级分档（沿用 sky.grade 的阈值与文案，不新增档位）→ ★ 数。
// **最高四星**：第五颗永远空着——留给「任何模型都无法保证」的那部分；
// **最低两星**：一星等同系统沉默（无窗口时不出卡，而不是打一星羞辱数据）。
function starsOf(score) {
  const n = Number(score) >= 70 ? 4 : Number(score) >= 45 ? 3 : 2
  return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n)
}

/**
 * 徒步条件总评：只把 sky.js 判为「有戏」的项
 * 计入均值（score ≥ 45；「没有彩虹」不是这条线路的缺陷），客观时刻（light）不参与，
 * 分档仍交给 sky.grade。**不新增任何阈值。**
 *
 * 判过不成立（verdict==='excluded'）的项必须一起退出：它们在页面上已经不出现，
 * 却可能带着不低的分数（云海"此点不在带顶上方"最高可到 62 = 条件一般 ★★★）——
 * 让看不见的卡决定看得见的总评，等于用被撤回的证据下结论。
 * @returns { score, tone, label, stars }
 */
function overallGrade(items) {
  /* 只让“判过且不是未知”的天相投票；unknown 不是 0 分，不该拉低总评。
     星空与银河是同一类（银河是星空子集），同时出现时只算银河一次，避免双计。
     全部被判不成立（excluded）是“条件差”，不是“没数据”；只有没有任何可判读项
     （空清单 / 全 unknown / 全 light）才说“数据不足”。 */
  const present = (items || []).filter(it => it.key !== 'light')
  const excluded = present.filter(it => sky.isSilent(it))
  const known = present.filter(it => !sky.isSilent(it) && it.verdict !== sky.VERDICT.UNKNOWN)
  const hasGalaxy = known.some(it => it.key === 'galaxy')
  const dedup = known.filter(it => it.key !== 'star' || !hasGalaxy)
  if (!dedup.length) {
    if (excluded.length) {
      const g = sky.grade(0)
      return { score: g.score, tone: g.tone, label: g.label, stars: starsOf(g.score), insufficient: false }
    }
    return { score: null, tone: 'neutral', label: '数据不足', stars: '', insufficient: true }
  }
  const live = dedup.filter(it => it.score >= 45)
  const pool = live.length ? live : dedup
  const score = pool.reduce((s, x) => s + x.score, 0) / pool.length
  const g = sky.grade(score)
  return { score: g.score, tone: g.tone, label: g.label, stars: starsOf(g.score), insufficient: false }
}

/* ---------- Evidence（V2 核心新增）：结论 → 可验证的事实清单 ---------- */

// 时段内有效值均值（取整）；无有效值返回 null
function meanOf(list, get) {
  const xs = (list || []).map(get).filter(v => Number.isFinite(v))
  return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null
}

/**
 * 每个天相结论的证据行。**全部取样自 series/days/astro 的原始事实**——
 * 每一条都能在上方图表（Timeline/云带剖面/日照轴）或数字表里被用户亲眼核对。
 *
 * 指标**选取**与 sky.js 各现象的信号表对应（weather-ux-design.md §9.4），但本函数
 * 只读原始数值、不做任何判定：结论与分档仍由 sky.summarize 唯一给出。
 * 唯一的例外曾经是真的：这里的云带筛选自己写过一遍 `cover >= 80`（注释却声称没有），
 * 切片二起改为 `CLF.isCloudBand` —— 它不是判定，是对上游成带事实的重述，且只有一个出处。
 * 「<30」这类天相阈值仍然一个都没有。
 *
 * @param key sky.js 结论 key（cloudSea/alpenglow/rainbow/galaxy/star）
 * @param ctx { date, detail(当日24h), days, elevation, sun(sunTimes), moon(moonInfo), lightPollution,
 *   night?, item? } night = sky.summarize 的跨夜小时序列；item = 该卡自己的结论项（页面传入），
 *   其 `at` 只在**真跨夜**时接管 galaxy/star 的锚点（F4 阶段一）。
 * @param opts { omitLightPollution } OI 证据不注入光污染事实行：OI 窗口判据不读光污染，
 *   边界由 `outdoor-intelligence.nightLimit` 统一声明，两套口径不能混进同一张卡。
 * @returns [{ fact:'清晨低云 86%', at:'07:00', kind:'cloud-amount' }]
 *   at = 「看图↗」锚定的小时列；非跨夜为 `HH:mm`，跨夜（F4 阶段一）为完整
 *   `YYYY-MM-DDTHH:mm`，页面按完整键跳到次日。kind = 证据类别（`utils/evidence-kind.js`），
 *   呈现层据此挑摘要与分组，**不解析 fact**。
 */
function factsFor(key, ctx, opts) {
  const omitLP = !!(opts && opts.omitLightPollution)
  const date = (ctx && ctx.date) || ''
  const d = (ctx && ctx.detail) || []
  const days = (ctx && ctx.days) || []
  const elev = ctx && ctx.elevation
  const sun = (ctx && ctx.sun) || null
  const moon = (ctx && ctx.moon) || null
  const out = []
  if (!d.length) return out

  if (key === 'cloudSea') {
    const bandHours = d.filter(h => CLF.isCloudBand(h.band))
    if (bandHours.length) {
      const base = Math.min.apply(null, bandHours.map(h => h.band.base))
      const top = Math.max.apply(null, bandHours.map(h => h.band.top))
      const at = bandHours[0].t
      out.push({ fact: '低层云带 ' + Math.round(base) + '–' + Math.round(top) + ' m', at, kind: K.LAYER_POSITION })
      if (Number.isFinite(elev)) {
        out.push({
          fact: '此点 ' + Math.round(elev) + ' m，' + (elev > top ? '高于' : '不高于') + '云带顶 ' + Math.round(top) + ' m',
          at,
          kind: K.LAYER_POSITION,
        })
      }
    }
    const morning = d.filter(h => sky.hourMin(h.t) < 10 * 60)
    if (morning.length) {
      const at = (d.find(h => h.t === '07:00') || morning[0]).t
      const low = meanOf(morning, h => h.cloud && h.cloud.low)
      const high = meanOf(morning, h => h.cloud && h.cloud.high)
      if (low != null) out.push({ fact: '清晨低云 ' + low + '% · 高层云 ' + (high == null ? '—' : high) + '%', at, kind: K.CLOUD_AMOUNT })
      const wind = meanOf(morning, h => h.wind)
      if (wind != null) out.push({ fact: '清晨风 ' + wind + ' km/h', at, kind: K.WIND })
      /* 逆温是云海的关键条件；只有温湿廓线与层高都在时才给这条，缺测不编 0 */
      const inv = morning
        .map(h => sky.inversionAt(h, date, ctx && ctx.cloudLevels, ctx && ctx.elevation))
        .filter(Boolean)
      if (inv.length) {
        const n = inv.filter(x => x.inversion).length
        out.push({ fact: '清晨逆温 ' + n + '/' + inv.length + ' 小时', at, kind: K.INVERSION })
      }
    }
    const prev = days.find(x => x.date === sky.addDays(date, -1))
    if (prev && Number(prev.precipSum) > 0) {
      out.push({ fact: '前日降水 ' + prev.precipSum + ' mm', at: d[0].t, kind: K.PRECIP })
    }
    return out
  }

  if (key === 'alpenglow') {
    const at = (sun && sun.sunrise) || d[0].t
    const low = meanOf(d, h => h.cloud && h.cloud.low)
    const midHigh = meanOf(d, h => ((h.cloud && h.cloud.mid) || 0) + ((h.cloud && h.cloud.high) || 0))
    if (low != null) out.push({ fact: '全日低云 ' + low + '%（少则光能到山体）', at, kind: K.CLOUD_AMOUNT })
    if (midHigh != null) out.push({ fact: '中高云 ' + midHigh + '%（有则可被染色）', at, kind: K.CLOUD_AMOUNT })
    const precip = d.reduce((s, h) => s + (h.precip || 0) + (h.showers || 0), 0)
    out.push({ fact: '全日降水 ' + (Math.round(precip * 10) / 10) + ' mm', at, kind: K.PRECIP })
    return out
  }

  if (key === 'rainbow') {
    const wet = d.filter(h => (h.precip || 0) + (h.showers || 0) > 0)
    if (wet.length) out.push({ fact: '降水时段 ' + wet.length + ' 小时', at: wet[0].t, kind: K.PRECIP })
    let best = null
    d.forEach(h => {
      if (sky.hourMin(h.t) >= 12 * 60 && (!best || (Number(h.rh) || 0) > (Number(best.rh) || 0))) best = h
    })
    if (best && Number.isFinite(best.rh)) out.push({ fact: '午后湿度峰值 ' + Math.round(best.rh) + '%', at: best.t, kind: K.HUMIDITY })
    return out
  }

  if (key === 'galaxy' || key === 'star') {
    const dawn = sun ? sky.hourMin(sun.astroDawn) : NaN
    const dusk = sun ? sky.hourMin(sun.astroDusk) : NaN
    // 锚点 = 天文暗夜开始的那一小时（傍晚段窗口的起点，「看图」落在夜间底色上）
    let anchor = d[0].t
    if (Number.isFinite(dusk)) {
      const hit = d.find(h => dusk >= sky.hourMin(h.t) && dusk < sky.hourMin(h.t) + 60)
      if (hit) anchor = hit.t
    }
    /* 夜段优先用 sky.summarize 算好的跨夜窗口（今晚入夜 → 次日晨）；
       没有它时退回自然日口径，保持旧调用可用。 */
    const night = (ctx && ctx.night) || (Number.isFinite(dawn) && Number.isFinite(dusk)
      ? d.filter(h => { const m = sky.hourMin(h.t); return m < dawn || m > dusk })
      : [])
    /* F4 阶段一：结论项自报的 `at` 只在**真跨夜**（它的日期与本节所选日不同）且
       **页面传入了非空夜段**（ctx.night）时才接管锚点——那时证据行与「看图」必须落到次日
       那个小时，否则会指到银河没升起的前夜。其余一切情况（无 item / at 缺失 / 格式不对 /
       同日 / 没有 ctx.night）保持旧的 dusk 锚点，非跨夜输出因此逐字节不变（阳性对照）。
       注意夜段判据只看**调用方传入的** ctx.night：下面为本函数自己算的 fallback 夜段
       （自然日口径）服务的，缺 ctx.night 时不能凭它猜"这是跨夜场景"。 */
    const itemAt = ctx && ctx.item && typeof ctx.item.at === 'string' ? ctx.item.at : ''
    const hasNightCtx = !!(ctx && Array.isArray(ctx.night) && ctx.night.length > 0)
    const crossNight = !!date && AT_FULL_RE.test(itemAt) && itemAt.slice(0, 10) !== date && hasNightCtx
    /* 证据行的 at：跨夜给完整日期（页面据此跳到次日同小时），非跨夜仍是 HH:mm（旧形态）。
       atmosphereAt 的时间参数同样用完整日期——否则会读到**本节所选日**的气溶胶/seeing。 */
    const rowAt = crossNight ? itemAt : anchor
    const atmosphereTime = crossNight ? itemAt : date + 'T' + anchor
    const high = meanOf(night, h => h.cloud && h.cloud.high)
    const mid = meanOf(night, h => h.cloud && h.cloud.mid)
    if (high != null) out.push({ fact: '夜段高层云 ' + high + '% · 中层云 ' + (mid == null ? '—' : mid) + '%', at: rowAt, kind: K.CLOUD_AMOUNT })
    // 观察点上方云量剖面：低云在脚下不挡天顶，在头顶才挡（sky.cloudAboveAt 单源）
    const profiles = night
      .map(h => sky.cloudAboveAt(h, date, ctx && ctx.cloudLevels, ctx && ctx.elevation))
      .filter(Boolean)
    if (profiles.length) {
      const peak = Math.round(profiles.reduce((s, p) => s + p.max, 0) / profiles.length)
      out.push({ fact: '夜段观察点上方云量峰值 平均 ' + peak + '%', at: rowAt, kind: K.CLOUD_AMOUNT })
    }
    if (moon) out.push({ fact: '月照 ' + moon.illumination + '%（' + moon.name + '）', at: rowAt, kind: K.MOONLIGHT })
    /* 大气透明度/seeing/气溶胶：有就读出来，缺测不编 0 */
    const atm = sky.atmosphereAt(ctx && ctx.atmosphere, atmosphereTime)
    if (atm) {
      if (atm.aod != null) out.push({ fact: 'CAMS 气溶胶 AOD ' + atm.aod, at: rowAt, kind: K.VISIBILITY })
      if (atm.transparency != null || atm.seeing != null) {
        out.push({
          fact: '7Timer 透明度 ' + (atm.transparency == null ? '—' : atm.transparency + '/8')
            + '（越小越好） · seeing ' + (atm.seeing == null ? '—' : atm.seeing + '/8') + '（越小越好）',
          at: rowAt,
          kind: K.VISIBILITY,
        })
      }
    }
    if (!omitLP) {
      if (ctx && ctx.lightPollution) {
        const bits = []
        if (ctx.lightPollution.bortle != null) bits.push('Bortle ' + ctx.lightPollution.bortle)
        if (ctx.lightPollution.sqm != null) bits.push('SQM ' + ctx.lightPollution.sqm)
        out.push({ fact: '天空亮度 ' + bits.join(' · ') + '（DarkSkySites.com，模型估算）', at: rowAt, kind: K.LIGHT_POLLUTION })
        /* 「没有读数」有两种来源：显式 null（查过、没有值）与调用方根本没传这个字段
           （首屏 / getSkyContext 整体失败 / 配额用尽，页面传的就是 undefined）。
           两者都必须在证据行里说出来——缺测不许印成「天空很暗」，也不许悄悄消失。 */
      } else if (ctx) {
        out.push({ fact: '光污染未计入（无读数）', at: rowAt, kind: K.NIGHT_LIMIT })
      }
    }
    return out
  }

  return out
}

module.exports = {
  isSnowCode,
  buildCallouts,
  starsOf,
  overallGrade,
  factsFor,
}
