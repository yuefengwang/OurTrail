// 品牌栏布局（纯函数，wx-free）：把运行时读到的三段系统值换算成
// 「固定头的总高度 + 右侧给微信胶囊让出的内缩」。
//
// 为什么必须用实测胶囊而不是猜一个 96px：胶囊在不同机型上的 left/高度并不固定，
// 写死值在窄屏会把「OurTrail」压到胶囊底下，在平板上又会留出半个屏幕的空隙。
// 本文件只做算术，不读 wx：页面/组件负责取数（getWindowInfo + getMenuButtonBoundingClientRect），
// Node 侧直接喂三组实测值就能钉住公式（tools/header-layout-test.js）。
'use strict'

// 读不到系统值时的兜底（等于 iPhone SE 一档的常见形态）。宁可给一个能画的高度，
// 也不让 header 变成 0px 把页面内容顶到状态栏里。
const FALLBACK = {
  statusBarHeight: 20,
  menuButton: { top: 26, height: 32, width: 87 },
  windowWidth: 375,
  gap: 8,
}

function finite(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback
}

/**
 * @param {{statusBarHeight?:number, menuButton?:{top?:number,left?:number,width?:number,height?:number}, windowWidth?:number}} input
 * @returns {{statusBarHeight:number, navBar:number, height:number, contentRightInset:number}}
 */
function layoutFor(input) {
  const src = input || {}
  const windowWidth = Math.max(0, finite(src.windowWidth, FALLBACK.windowWidth))
  const statusBarHeight = Math.max(0, finite(src.statusBarHeight, FALLBACK.statusBarHeight))
  const mb = src.menuButton || {}
  // 胶囊上下留白对称：navBar = 上间隙 ×2 + 胶囊高度。
  const mbTop = finite(mb.top, statusBarHeight + 6)
  const mbHeight = Math.max(0, finite(mb.height, FALLBACK.menuButton.height))
  const mbLeft = finite(mb.left, windowWidth - FALLBACK.menuButton.width - FALLBACK.gap)
  const navBar = Math.max(0, (mbTop - statusBarHeight) * 2 + mbHeight)
  return {
    statusBarHeight,
    navBar,
    height: statusBarHeight + navBar,
    // 右侧内容（品牌词标 / 页面标题）右边界：胶囊左沿再让 8px。
    contentRightInset: Math.max(0, windowWidth - mbLeft + FALLBACK.gap),
  }
}

module.exports = { layoutFor, FALLBACK }
