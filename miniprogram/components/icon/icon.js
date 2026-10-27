// 图标组件：由原型 Icon.tsx 的 path 数据运行时生成 SVG data URI（base64）。
// 颜色不能从 CSS 继承，需通过 color 属性显式传入。
'use strict'

const PATHS = {
  activity: 'M5 5h14v16H5zM8 3v4M16 3v4M5 10h14M8 14h3M8 17h7',
  bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4',
  person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-2a7 7 0 0 1 14 0v2',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  car: 'M4 16V8l2-4h12l2 4v8H4ZM4 10h16M7 13h1M16 13h1M6 16v4M18 16v4',
  check: 'm5 12 4 4L19 6',
  route: 'M6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM18 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM8 5h6a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h6',
  cloud: 'M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10Z',
  sun: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM12 2.5v2M12 19.5v2M4.8 4.8l1.4 1.4M17.8 17.8l1.4 1.4M2.5 12h2M19.5 12h2M4.8 19.2l1.4-1.4M17.8 6.2l1.4-1.4',
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6',
  plus: 'M12 4v16M4 12h16',
  back: 'm14 5-7 7 7 7',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  more: 'M5 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM12 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM19 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
  close: 'm6 6 12 12M6 18 18 6',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  users: 'M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6M19 14a5 5 0 0 1 3 4v3',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  edit: 'm14 5 5 5M4 16 16 4a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L8 20l-5 1zM13 21h8',
  home: 'm3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10',
  alert: 'M10.3 4.5a2 2 0 0 1 3.4 0l7 12A2 2 0 0 1 19 20H5a2 2 0 0 1-1.7-3.5zM12 9v4M12 16v.2',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  settings: 'M10 3h4l.6 2.5 2 .9L19 5l2 3.5-1.9 1.7v2.6l1.9 1.7-2 3.5-2.4-1.4-2 .9L14 21h-4l-.6-3.5-2-.9L5 18l-2-3.5 1.9-1.7v-2.6L3 8.5 5 5l2.4 1.4 2-.9zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  // 装备图标：与 utils/equipment-icons.js 的 key 一一对应
  boot: 'M5 4v10l-1 2v3h16v-2c0-2-2-3-4-4l-3-1-2-4V4zM4 16h11',
  poles: 'M7 3v16M5 21h4M17 3v16M15 21h4M7 7h10',
  rain: 'M7 15h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9-1.5A3.5 3.5 0 0 0 7 15ZM8 18l-1 3M12 18l-1 3M16 18l-1 3',
  water: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z',
  headlamp: 'M4 8a8 8 0 0 1 16 0v2h-3V8a5 5 0 0 0-10 0v2H4zM7 13h10M9 17l-1 3M15 17l1 3',
  firstaid: 'M4 8h16v12H4zM9 8V5h6v3M12 11v6M9 14h6',
  food: 'M7 3v7a2 2 0 0 0 4 0V3M9 10v11M17 3c-2 0-3 2-3 4s1 3 3 3v11',
  tent: 'M12 3 3 21h18zM12 21V9M8 15l4-3 4 3',
  sleep: 'M6 3h8a4 4 0 0 1 4 4v14H6zM6 3v18M10 8h4M10 12h4',
  power: 'M4 8h13v8H4zM17 10h3v4h-3M7 10v4',
  id: 'M3 6h18v12H3zM7 15v-2a2 2 0 0 1 4 0v2M9 9.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3M14 10h4M14 14h3',
  backpack: 'M7 8a5 5 0 0 1 10 0v12H7zM10 8V5h4v3M7 12h10M10 16h4',
}

// 品牌图形（自定义 viewBox）
const ART = {
  trailMark: {
    viewBox: '0 0 32 36', strokeWidth: 3.5,
    d: 'M8 3v15c0 5 4 6 8 6s8 2 8 6v3M24 3v8c0 5-4 6-8 6S8 19 8 24v9',
  },
  trailArt: {
    viewBox: '0 0 200 240', strokeWidth: 2,
    d: 'M135-20C40 31 220 51 126 107S35 179 132 260',
    extra: 'M183-20C88 31 164 78 84 123S92 201 179 260', extraWidth: 1.25,
  },
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code >= 0x80) {
      // UTF-8 编码
      if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
      }
    } else bytes.push(code)
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : NaN
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : NaN
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | (isNaN(b1) ? 0 : b1 >> 4)]
    out += isNaN(b1) ? '=' : B64[((b1 & 15) << 2) | (isNaN(b2) ? 0 : b2 >> 6)]
    out += isNaN(b2) ? '=' : B64[b2 & 63]
  }
  return out
}

const cache = new Map()

function buildSvg(name, color) {
  const key = name + '|' + color
  if (cache.has(key)) return cache.get(key)
  let svg
  if (ART[name]) {
    const art = ART[name]
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + art.viewBox + '" fill="none" stroke="' + color
      + '" stroke-width="' + art.strokeWidth + '" stroke-linecap="round"><path d="' + art.d + '"/>'
      + (art.extra ? '<path d="' + art.extra + '" stroke-width="' + (art.extraWidth || art.strokeWidth) + '"/>' : '')
      + '</svg>'
  } else {
    const d = PATHS[name] || PATHS.activity
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' + color
      + '" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'
  }
  const uri = 'data:image/svg+xml;base64,' + base64(svg)
  cache.set(key, uri)
  return uri
}

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    name: { type: String, value: 'activity' },
    size: { type: null, value: 22 },
    color: { type: String, value: '#163E35' },
  },
  data: { src: '', w: 22, h: 22 },
  observers: {
    'name, size, color': function compute() {
      const size = Number(this.data.size) || 22
      this.setData({
        src: buildSvg(this.data.name, this.data.color || '#163E35'),
        w: size,
        h: size,
      })
    },
  },
  lifetimes: {
    attached() {
      const size = Number(this.data.size) || 22
      this.setData({
        src: buildSvg(this.data.name, this.data.color || '#163E35'),
        w: size,
        h: size,
      })
    },
  },
})

module.exports = { PATHS }
