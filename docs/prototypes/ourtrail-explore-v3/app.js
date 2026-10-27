'use strict';

const paths = {
  back: '<path d="m14 5-7 7 7 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  sliders: '<path d="M4 7h8m4 0h4M4 17h3m4 0h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  mountain: '<path d="m2 20 7-14 5 9 3-6 5 11H2Z"/><path d="m6 12 3 2 2-2"/>',
  sun: '<path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/><circle cx="12" cy="12" r="5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  users: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.4"/>',
  rise: '<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',
  route: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M5 7v8a4 4 0 0 0 4 4h3a4 4 0 0 0 0-8h-1a4 4 0 0 1 0-8h8v5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  pack: '<path d="M8 5V4a4 4 0 0 1 8 0v1M5 8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"/><rect x="8" y="12" width="8" height="6" rx="1"/><path d="M10 9h4"/>',
};
const icon = name => `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24">${paths[name] || paths.mountain}</svg></span>`;
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.classList.add('icon'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = `<svg viewBox="0 0 24 24">${paths[el.dataset.icon]}</svg>`; }); }
const state = { view: 'discover', query: '', quick: 'all', time: 'all', distance: 'all', openOnly: false, sort: 'date' };
const content = document.querySelector('#content');
const screen = document.querySelector('#screen');
const overlay = document.querySelector('#overlay');
const sheet = document.querySelector('#sheet');
let opener;
let toastTimer;

function matchesFilters(item) {
  const day = item.start.slice(0, 10);
  if (state.view === 'mine' && !item.mine) return false;
  if (state.query && ![item.title, item.route, item.description, item.departure, item.organizerShort].join(' ').toLowerCase().includes(state.query.toLowerCase())) return false;
  if ((state.quick === 'week' || state.time === 'week') && day > '2026-11-01') return false;
  if (state.time === 'next' && (day < '2026-11-02' || day > '2026-11-08')) return false;
  if ((state.quick === 'short' || state.distance === 'short') && item.distance > 10) return false;
  if (state.distance === 'long' && item.distance <= 10) return false;
  // A fixture-owned flag, not a new client-side capacity/deadline/permission calculation.
  if (state.openOnly && !item.accepting) return false;
  return true;
}
function photo(item, className) { return `<img class="${className}" src="assets/${item.photo}" alt="${esc(item.alt)}" loading="${className === 'row-photo' ? 'lazy' : 'eager'}">`; }
function renderFeature(item) {
  return `<button class="featured" data-activity="${item.id}" aria-label="查看活动：${esc(item.title)}">
    <div class="hero-photo">${photo(item, '')}<span class="photo-demo">配图示意</span></div>
    <div class="feature-info"><p class="feature-date">${item.date} ${item.weekday} · ${item.time} 集合</p><h2>${item.title}</h2><p class="feature-context">${item.area}<i></i>${item.departure}<i></i>${item.organizerShort}</p><div class="feature-bottom"><div class="route-metrics"><span>${icon('route')}<b>${item.distance}</b><span class="metric-unit">km</span></span><span>${icon('rise')}<b>${item.ascent}</b><span class="metric-unit">m 爬升</span></span></div><span class="joined-count">${icon('users')}${item.confirmed} 人已确认</span></div></div>
  </button>`;
}
function renderRow(item) {
  return `<button class="activity-row" data-activity="${item.id}" aria-label="查看活动：${esc(item.title)}">${photo(item, 'row-photo')}<span class="row-body"><span class="row-date">${item.date} ${item.weekday} · ${state.view === 'mine' && item.myTime ? item.myTime : item.time}${state.view === 'mine' ? `<span class="mine-status">${item.status}</span>` : ''}</span><h3>${item.title}</h3><p class="row-route">${state.view === 'mine' && item.myMeeting ? item.myMeeting : item.departure} · ${item.organizerShort}</p><span class="row-meta"><span class="row-metrics"><span>${item.distance} km</span><span>↗ ${item.ascent} m</span></span><span class="row-joined ${item.accepting ? '' : 'paused'}">${item.accepting ? item.confirmed + ' 人同行' : '暂停报名'}</span></span></span></button>`;
}
function sortButton() { return `<button class="sort-button" id="sort">${state.sort === 'date' ? '出发时间' : '路线由短到长'}${icon('chevron')}</button>`; }
function render() {
  let items = activities.filter(matchesFilters);
  items.sort((a, b) => state.sort === 'date' ? a.start.localeCompare(b.start) : a.distance - b.distance);
  const defaultView = state.view === 'discover' && !state.query && state.quick === 'all' && state.time === 'all' && state.distance === 'all' && !state.openOnly && state.sort === 'date';
  if (!items.length) {
    content.innerHTML = `<div class="empty-state">${icon('search')}<h2>暂时没有合适的活动</h2><p>换个关键词，或放宽筛选条件，<br>看看还有哪些地方可以一起去。</p><button id="reset">清除筛选</button></div>`;
  } else if (defaultView) {
    content.innerHTML = renderFeature(items[0]) + `<div class="activities-heading"><h2>还有这些好去处</h2>${sortButton()}</div><div class="activity-list">${items.slice(1).map(renderRow).join('')}</div>`;
  } else {
    const title = state.query ? '搜索结果' : state.view === 'mine' ? '即将一起出发' : '符合条件的活动';
    content.innerHTML = `<div class="results-header"><h2>${title}<small>${items.length}</small></h2>${sortButton()}</div>${state.view === 'mine' ? `<div class="mine-note">${icon('check')}你的报名与安排，都在这里。</div>` : ''}<div class="activity-list">${items.map(renderRow).join('')}</div>`;
  }
  document.querySelector('.list-end').hidden = !items.length;
  document.querySelector('#clear-search').hidden = !state.query;
  document.querySelector('#filter-dot').hidden = state.time === 'all' && state.distance === 'all' && !state.openOnly;
  document.querySelectorAll('[data-filter]').forEach(el => { const active = el.dataset.filter === state.quick; el.classList.toggle('selected', active); el.setAttribute('aria-pressed', active); });
  document.querySelectorAll('[data-view]').forEach(el => { const active = el.dataset.view === state.view; el.classList.toggle('active', active); el.setAttribute('aria-selected', active); });
}
function showSheet(html) { opener = document.activeElement; sheet.innerHTML = html; overlay.hidden = false; screen.style.overflow = 'hidden'; document.querySelector('#detail-screen').style.overflow = 'hidden'; sheet.scrollTop = 0; sheet.focus(); }
function closeSheet() { overlay.hidden = true; sheet.innerHTML = ''; screen.style.overflow = ''; document.querySelector('#detail-screen').style.overflow = ''; if (opener && opener.isConnected) opener.focus({preventScroll:true}); }
function sheetHead(title) { return `<div class="sheet-head"><h2 id="sheet-title">${title}</h2><button class="close-button" data-close aria-label="关闭">${icon('close')}</button></div>`; }
function toast(text) { clearTimeout(toastTimer); const el = document.querySelector('#toast'); el.textContent = text; el.classList.add('show'); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
function showActivity(id) {
  window.DetailView.open(id);
}
function showFilters() {
  let draft = { time: state.quick === 'week' ? 'week' : state.time, distance: state.quick === 'short' ? 'short' : state.distance, openOnly: state.openOnly };
  const choices = (key, options) => `<div class="option-grid">${options.map(([value, label]) => `<button data-choice="${key}" data-value="${value}" class="${String(draft[key]) === value ? 'selected' : ''}" aria-pressed="${String(draft[key]) === value}">${label}</button>`).join('')}</div>`;
  showSheet(`${sheetHead('找到想去的那一程')}<p class="sheet-label">什么时候出发</p>${choices('time', [['all','不限时间'],['week','本周'],['next','下周']])}<p class="sheet-label">想走多远</p>${choices('distance', [['all','不限距离'],['short','10 km 以内'],['long','10 km 以上']])}<p class="sheet-label">报名状态</p>${choices('openOnly', [['false','全部活动'],['true','仍可报名']])}<div class="sheet-actions"><button class="secondary" id="reset-filters">重置</button><button class="primary" id="apply-filters">查看活动</button></div>`);
  sheet.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.choice;
    draft[key] = key === 'openOnly' ? button.dataset.value === 'true' : button.dataset.value;
    sheet.querySelectorAll(`[data-choice="${key}"]`).forEach(el => { const selected = el === button; el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', selected); });
  }));
  sheet.querySelector('#reset-filters').addEventListener('click', () => {
    draft = {time:'all', distance:'all', openOnly:false};
    sheet.querySelectorAll('[data-choice]').forEach(el => { const selected = el.dataset.value === String(draft[el.dataset.choice]); el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', selected); });
  });
  sheet.querySelector('#apply-filters').addEventListener('click', () => { Object.assign(state, draft, {quick:'all'}); closeSheet(); render(); });
}
function showScope(name, symbol, copy) { showSheet(`${sheetHead(name)}<div class="scope-icon">${icon(symbol)}</div><p class="scope-copy">${copy}</p><p class="demo-caption">本轮为探索首页原型，此入口的后续页面暂未展开。</p><div class="sheet-actions"><button class="primary" data-close>回到探索</button></div>`); }
function reset() { Object.assign(state, { query:'', quick:'all', time:'all', distance:'all', openOnly:false, sort:'date' }); document.querySelector('#search').value = ''; render(); }

document.addEventListener('click', event => {
  const activity = event.target.closest('[data-activity]');
  if (activity) { showActivity(activity.dataset.activity); return; }
  if (event.target.closest('[data-close]')) { closeSheet(); return; }
  const quick = event.target.closest('[data-filter]');
  if (quick) { state.quick = quick.dataset.filter; state.time = 'all'; state.distance = 'all'; render(); return; }
  const tab = event.target.closest('[data-view]');
  if (tab) { state.view = tab.dataset.view; reset(); return; }
  if (event.target.closest('#sort')) { state.sort = state.sort === 'date' ? 'distance' : 'date'; render(); toast(state.sort === 'distance' ? '已按路线距离从短到长排列' : '已按出发时间排列'); return; }
  if (event.target.closest('#reset')) reset();
  const width = event.target.closest('[data-width]');
  if (width) { document.documentElement.style.setProperty('--device-width', width.dataset.width + 'px'); document.querySelectorAll('[data-width]').forEach(el => { el.classList.toggle('on', el === width); el.setAttribute('aria-pressed', el === width); }); }
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    const name = nav.dataset.nav;
    if (name === 'explore') { state.view = 'discover'; reset(); screen.scrollTo({top:0,behavior:'smooth'}); }
    if (name === 'weather') {
      history.replaceState({page:'home',home:{filters:{...state},scroll:screen.scrollTop,focusId:null}},'',location.href);
      location.href = 'weather.html';
    }
    if (name === 'notices') showScope('通知', 'bell', '报名结果、集合调整和出行提醒，会在这里及时找到你。');
    if (name === 'me') showScope('我的', 'user', '你的个人资料、同行记录与常用信息，会放在这里。');
  }
});
document.querySelector('#search').addEventListener('input', event => { state.query = event.target.value.trim(); render(); });
document.querySelector('#clear-search').addEventListener('click', () => { state.query = ''; document.querySelector('#search').value = ''; render(); document.querySelector('#search').focus(); });
document.querySelector('#filters').addEventListener('click', showFilters);
document.querySelector('#create').addEventListener('click', () => showScope('发起一次同行', 'plus', '选好路线，约定时间，再邀请朋友一起出发。<br><br>新的发起流程将支持<strong>添加活动封面</strong>，让大家先看见你想去的地方。'));
document.addEventListener('keydown', event => {
  if (overlay.hidden) return;
  if (event.key === 'Escape') closeSheet();
  if (event.key === 'Tab') {
    const targets = [...sheet.querySelectorAll('button,input,a[href]')].filter(el => !el.disabled);
    const first = targets[0], last = targets[targets.length - 1];
    if (!targets.length) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === sheet)) { event.preventDefault(); first.focus(); }
  }
});
hydrateIcons();
render();
