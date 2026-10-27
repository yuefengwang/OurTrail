'use strict';

// Design-only, deterministic fixtures. These are NOT observed or forecast weather.
// Place names match the activity prototype; elevations, nodes, times and values are fictional.
// Units: temperature °C; rain mm per hour; wind/gust km/h; visibility km; altitude m ASL.
// Profile cover is a synthetic model-level cloud fraction (%), not cloud-base/top geometry.
// A null cloud cover means no usable layer value. Never turn it into clear sky (0%).
window.WeatherDemo = (() => {
  const places = [
    {
      id: 'autumn', name: '毕棚沟', route: '秋日山谷环线', area: '阿坝 · 理县', activityDateIndex: 2,
      nodes: [
        {name: '山谷入口', altitude: 2600, distance: 0, x: 61, y: 151},
        {name: '林间休息点', altitude: 2950, distance: 4.2, x: 143, y: 106},
        {name: '山脊观景点', altitude: 3280, distance: 7.6, x: 242, y: 51},
        {name: '返回入口', altitude: 2600, distance: 12.8, x: 86, y: 169},
      ],
    },
    {
      id: 'forest', name: '青城后山', route: '五龙沟林间环线', area: '成都 · 都江堰', activityDateIndex: 3,
      nodes: [
        {name: '古镇入口', altitude: 920, distance: 0, x: 55, y: 160},
        {name: '溪谷步道', altitude: 1080, distance: 2.8, x: 147, y: 119},
        {name: '林间休息点', altitude: 1240, distance: 5.2, x: 246, y: 57},
        {name: '返回古镇', altitude: null, distance: 8.2, x: 88, y: 177},
      ],
    },
    {
      id: 'lake', name: '措普沟', route: '湖畔步道往返', area: '甘孜 · 巴塘', activityDateIndex: 9,
      nodes: [
        {name: '步道入口', altitude: 3950, distance: 0, x: 57, y: 158},
        {name: '湖岸休息点', altitude: 4020, distance: 2, x: 139, y: 112},
        {name: '折返点', altitude: 4130, distance: 3.2, x: 242, y: 57},
        {name: '返回入口', altitude: 3950, distance: 6.5, x: 83, y: 176},
      ],
    },
    {
      id: 'snow', name: '四姑娘山', route: '草甸与观景点往返', area: '阿坝 · 小金', activityDateIndex: 10,
      nodes: [
        {name: '草甸起点', altitude: 3200, distance: 0, x: 52, y: 160},
        {name: '山腰休息点', altitude: 3650, distance: 4.8, x: 145, y: 108},
        {name: '观景折返点', altitude: 4110, distance: 7.8, x: 250, y: 49},
        {name: '返回起点', altitude: 3200, distance: 15.6, x: 87, y: 175},
      ],
    },
  ];

  const dayStart = Date.UTC(2026, 9, 29);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const days = Array.from({length: 14}, (_, index) => {
    const date = new Date(dayStart + index * 86400000);
    return {iso: date.toISOString().slice(0, 10), label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`, weekday: week[date.getUTCDay()]};
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, digits = 0) => Number(value.toFixed(digits));
  const patterns = [
    {temperature: 1.2, cloud: 12, wet: 0, wind: 0},
    {temperature: 0, cloud: 35, wet: .35, wind: 2},
    {temperature: -1.1, cloud: 55, wet: .8, wind: 4},
    {temperature: -2.6, cloud: 78, wet: 1.7, wind: 6},
    {temperature: -.7, cloud: 32, wet: .2, wind: 1},
    {temperature: 1.8, cloud: 8, wet: 0, wind: -1},
    {temperature: .3, cloud: 48, wet: .65, wind: 3},
  ];

  function getHour(placeId, nodeIndex, dayIndex, hour) {
    const place = places.find(item => item.id === placeId);
    if (!place) throw new RangeError(`Unknown demonstration place: ${placeId}`);
    if (!Number.isInteger(nodeIndex) || !place.nodes[nodeIndex]) throw new RangeError('Unknown demonstration node');
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || !Number.isInteger(hour)) throw new RangeError('Invalid demonstration time');
    const absoluteHour = dayIndex * 24 + hour;
    if (absoluteHour < 0) throw new RangeError('Demonstration time precedes the dataset');
    const day = Math.floor(absoluteHour / 24);
    const h = absoluteHour % 24;
    const placeIndex = places.indexOf(place);
    const node = place.nodes[nodeIndex];
    const pattern = patterns[(day + (placeIndex === 2 ? 2 : 0)) % patterns.length];
    const daylight = Math.sin((h - 7) * Math.PI / 12);
    const afternoon = Math.max(0, 1 - Math.abs(h - 16) / 7);
    const sheltered = placeId === 'forest' ? 5 : 0;
    // This reference exists only to generate a normal point series for the unknown-elevation fixture.
    // It is not exposed as a measured altitude; nodeAltitude remains null so the UI cannot locate it in cloud.
    const fixtureReferenceAltitude = node.altitude === null ? 920 : node.altitude;
    const temp = round(2.6 + 5.1 * daylight + pattern.temperature + (3280 - fixtureReferenceAltitude) * .0052, 1);
    const wind = round(Math.max(2, 7 + pattern.wind + nodeIndex * 1.1 + afternoon * 5 + (placeId === 'snow' ? 5 : 0) - sheltered));
    const gust = round(wind + 7 + afternoon * 4 + (nodeIndex === 2 ? 1 : 0));
    const feels = round(temp - Math.max(0, wind - 3) * .13 - (temp < 0 ? .8 : 0), 1);
    const rainfallCycle = .5 + .5 * Math.sin((h - 11) * Math.PI / 10);
    const rain = round(Math.max(0, pattern.wet * Math.max(0, rainfallCycle) * (h >= 12 && h <= 21 ? 1 : .2) + (placeId === 'forest' && pattern.wet > .5 ? .2 : 0)), 1);
    const probability = clamp(round((rain > 0 ? 35 + Math.min(rain, 2) * 25 : pattern.wet ? 18 : 5) + afternoon * 8), 0, 98);
    const cloudLow = clamp(round(pattern.cloud + afternoon * 24 + (placeId === 'forest' ? 15 : 0) + nodeIndex * 2), 0, 100);
    const cloudMid = clamp(round(pattern.cloud * .75 + afternoon * 30 + 10 + Math.cos(h / 4) * 8), 0, 100);
    const cloudHigh = clamp(round(pattern.cloud * .45 + 16 + Math.sin((h + day) / 5) * 12), 0, 100);
    const condition = rain >= .4 ? (temp <= 0 ? '小雪' : '小雨') : Math.max(cloudLow, cloudMid) >= 78 ? '阴' : Math.max(cloudLow, cloudMid) >= 35 ? '多云' : '晴';
    const covered = {min: 1500, max: day % 3 === 2 ? 5000 : 5500};
    const cloudLevels = Array.from({length: 10}, (_, index) => {
      const altitude = 1500 + index * 500;
      const missing = (node.altitude !== null && altitude < node.altitude) || altitude > covered.max;
      const lowerBand = Math.exp(-Math.pow((altitude - (2700 + afternoon * 600)) / 850, 2));
      const upperBand = Math.exp(-Math.pow((altitude - 4900) / 1000, 2));
      const cover = missing ? null : clamp(round(cloudLow * lowerBand + cloudHigh * upperBand + 5), 0, 100);
      return {altitude, cover};
    });
    return {
      dayIndex: day, hour: h, time: `${String(h).padStart(2, '0')}:00`,
      temp, feels, rain, probability, wind, gust,
      windDirection: ['西南', '西南', '西', '西北'][Math.floor(h / 6)],
      cloudLow, cloudMid, cloudHigh, condition,
      humidity: clamp(round(40 + cloudLow * .44 + rain * 7 - daylight * 6), 25, 99),
      visibility: round(clamp(31 - cloudLow * .19 - rain * 4, 2, 35), 1),
      cloudLevels, covered, nodeAltitude: node.altitude,
    };
  }

  function getSeries(placeId, nodeIndex, dayIndex, count = 24) {
    if (!Number.isInteger(count) || count < 1 || count > 336) throw new RangeError('Demonstration series length must be 1–336 hours');
    return Array.from({length: count}, (_, index) => getHour(placeId, nodeIndex, dayIndex, index));
  }

  return {places, days, getHour, getSeries};
})();
