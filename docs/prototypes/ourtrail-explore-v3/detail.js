'use strict';

// Page navigation is local to this prototype. No cloud calls, location or signup writes.
window.DetailView = (() => {
  const detail = document.querySelector('#detail-screen');
  const actions = document.querySelector('#detail-action');
  const device = document.querySelector('#device');
  const nav = document.querySelector('.bottom-nav');
  let current = null;
  let homeSnapshot = null;
  let sectionFrame = 0;
  const baseUrl = location.pathname + location.search;

  function snapshotHome() {
    return { filters: {...state}, scroll: screen.scrollTop, focusId: document.activeElement?.dataset?.activity || null };
  }
  function routeSvg(item, selected = 0) {
    const [a,b,c,d] = item.stops;
    // A schematic connector through the fictional nodes; never a recorded geographic track.
    const connector = `M${a.x} ${a.y} C${a.x-28} ${a.y-34} ${b.x-45} ${b.y+40} ${b.x-48} ${b.y+10} S${b.x-18} ${b.y-30} ${b.x} ${b.y} C${b.x+20} ${b.y+23} ${c.x-57} ${c.y+38} ${c.x-51} ${c.y+19} S${c.x-18} ${c.y+18} ${c.x} ${c.y} C${c.x+24} ${c.y-19} ${c.x+44} ${c.y+37} ${c.x+17} ${c.y+61} S${d.x+107} ${d.y-31} ${d.x+91} ${d.y-8} S${d.x+27} ${d.y+31} ${d.x} ${d.y}`;
    return `<svg class="route-diagram" viewBox="0 0 320 214" role="img" aria-label="${esc(item.route)}，四个示例节点的顺序示意，不用于导航">
      <rect width="320" height="214" fill="#f1f5ed"/>
      <path d="M-15 142C48 116 66 37 136 46S231 142 341 81V-10H-15Z" fill="#e5eddf"/>
      <path d="M-13 78C55 57 66-4 146 12S259 96 341 35M-13 91C55 70 66 9 146 25S259 109 341 48M-13 104C55 83 66 22 146 38S259 122 341 61" stroke="#d3dec9" stroke-width="1"/>
      <path d="M173 222C146 184 187 158 235 163S287 134 336 155" stroke="#c7ddd7" stroke-width="6"/>
      <path d="${connector}" stroke="white" stroke-width="8"/>
      <path d="${connector}" stroke="#16783e" stroke-width="3" stroke-dasharray="5 5"/>
      ${item.stops.map((point, index) => `<g><circle cx="${point.x}" cy="${point.y}" r="${index === selected ? 16 : 12}" fill="${index === selected ? '#16783e' : '#fff'}" stroke="${index === selected ? '#fff' : '#16783e'}" stroke-width="2"/><text x="${point.x}" y="${point.y + 4}" text-anchor="middle" fill="${index === selected ? '#fff' : '#16783e'}" font-size="11" font-weight="700" stroke="none">${index + 1}</text></g>`).join('')}
      <text x="14" y="22" font-size="10" fill="#697667" stroke="none">路线节点示意</text>
      <text x="306" y="199" text-anchor="end" font-size="9" fill="#71806b" stroke="none">虚构路线 · 非导航</text>
    </svg>`;
  }
  function stats(item) {
    return `<div class="activity-stats"><div><b>${item.distance}</b><span>km</span><p>路线距离</p></div><div><b>${item.ascent}</b><span>m</span><p>累计爬升</p></div><div><b>${item.confirmed}</b><span>人</span><p>已确认同行</p></div></div>`;
  }
  function renderDetail(item) {
    current = item;
    const paused = !item.accepting;
    const meetingTime = item.mine ? item.myTime || item.time : item.time;
    const meetingName = item.mine ? item.myMeeting || item.meeting : item.meeting;
    detail.innerHTML = `
      <div class="detail-hero">${photo(item,'detail-cover')}<span class="photo-demo">配图示意</span></div>
      <div class="activity-summary">
        <div class="activity-eyebrow"><span class="status-tag ${paused ? 'is-paused' : ''}">${paused ? '暂停报名' : '报名中'}</span><span>${icon('pin')}${item.area}</span></div>
        <h1 id="activity-title" tabindex="-1">${item.title}</h1>
        ${stats(item)}
        <div class="key-fact">${icon('calendar')}<div><strong>${item.date} ${item.weekday} · ${meetingTime} ${item.mine?'你的集合':'集合'}</strong><p>当天 ${item.end} 计划结束</p></div></div>
        <div class="key-fact">${icon('pin')}<div><strong>${meetingName}</strong><p>${item.mine ? '你的集合点 · 自行前往' : item.departure + ' · 集中出发的集合点'}</p></div></div>
        ${item.mine ? `<button class="your-outing" data-arrangements>${icon('check')}<span><b>你已确认同行</b><small>自行前往 · 查看你的集合安排</small></span>${icon('arrow')}</button>` : ''}
      </div>
      <nav class="detail-tabs" aria-label="详情页内导航">${[['overview','概览'],['route','路线'],['schedule','安排'],['notes','须知']].map(([id,label],i)=>`<button data-section="${id}" ${i===0?'aria-current="location"':''}>${label}</button>`).join('')}</nav>
      <div class="detail-body">
        <section id="section-overview" class="detail-section">
          <h2>这一程，一起走</h2><p class="body-copy">${item.description}</p>
          <div class="organizer-intro">${icon('users')}<div><strong>${item.organizerIntro}</strong><p>${item.organizerNote}</p></div></div>
        </section>
        <section id="section-route" class="detail-section">
          <div class="detail-section-head"><h2>路线与集合</h2><span>${item.route}</span></div>
          <div class="route-visual"><div id="route-canvas">${routeSvg(item)}</div><button class="map-expand" data-map aria-label="放大路线示意图">${icon('expand')}</button></div>
          <div class="route-stops" aria-label="路线节点">${item.stops.map((stop,i)=>`<button data-stop="${i}" class="${i===0?'selected':''}" aria-pressed="${i===0}"><span>${i+1}</span><b>${stop.name}</b><small>${stop.distance}</small></button>`).join('')}</div>
          <p class="stop-note" id="stop-note">${icon('pin')}<span>${item.stops[0].note}</span></p>
          <p class="terrain-note">${item.terrain}</p>
          <div class="meeting-block"><span class="small-label">集合地点 · ${item.time}</span><h3>${item.meeting}</h3><p>${item.address}</p><p class="transport-note">${item.transport}</p></div>
          <button class="weather-link" data-route-weather>${icon('sun')}<span><strong>出发前，看一眼路线天气</strong><small>温度、降水与沿途云层</small></span>${icon('arrow')}</button>
        </section>
        <section id="section-schedule" class="detail-section"><h2>当天怎么走</h2><p class="section-subtitle">按队伍节奏同行，时间以实际情况为准。</p><ol class="day-schedule">${item.schedule.map(([time,title,note])=>`<li><time>${time}</time><div><h3>${title}</h3><p>${note}</p></div></li>`).join('')}</ol></section>
        <section id="section-notes" class="detail-section">
          <h2>出发前，准备好这些</h2><div class="equipment-tags">${item.equipment.map(text=>`<span>${text}</span>`).join('')}</div>
          <details class="notice-fold" open><summary>路况与参与提醒${icon('chevron')}</summary><ul>${item.risks.map(text=>`<li>${text}</li>`).join('')}</ul></details>
          <details class="notice-fold"><summary>费用与退出约定${icon('chevron')}</summary><p>OurTrail 不收款。个人发生的交通、餐饮等开支由本人自行承担。</p><p>${item.cancellation}</p></details>
          <button class="notice-link" data-activity-notices>${icon('bell')}<span>查看活动通知</span>${icon('arrow')}</button>
        </section>
        <div class="prototype-note">设计原型 · 活动、人物、里程与安排均为虚构。<br>照片为氛围配图，路线图为节点示意，不作为实际出行依据。<a href="assets/sources.json" target="_blank" rel="noopener">查看照片来源与许可 ↗</a>${item.id==='snow'?'<span>雪山照片：Johannes Böckh (Mrilabs) · <a href="https://commons.wikimedia.org/wiki/File:Mount_Siguniang_-_4_Sisters.jpg" target="_blank" rel="noopener">原图</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a>；网页显示裁切。</span>':''}</div>
      </div>`;
    const mine = item.cta === 'arrangements';
    actions.innerHTML = `<div class="action-context"><b>${mine ? '已确认同行' : item.accepting ? '报名开放中' : '报名已暂停'}</b><span>${mine ? `${item.date} · ${meetingTime} 集合` : item.accepting ? `${item.deadline} 截止` : '可继续看看其他活动'}</span></div><button class="primary" id="activity-primary">${mine ? '查看我的安排' : item.accepting ? '报名同行' : '看看其他活动'}${icon('arrow')}</button>`;
    screen.hidden = true;
    nav.hidden = true;
    document.querySelector('.wordmark').hidden = true;
    document.querySelector('#detail-navigation').hidden = false;
    detail.hidden = false;
    actions.hidden = false;
    device.classList.add('on-detail');
    detail.scrollTop = history.state?.id === item.id ? history.state.detailScroll || 0 : 0;
    document.title = item.title + ' · OurTrail';
    document.querySelector('#activity-title').focus({preventScroll:true});
  }
  function open(id) {
    const item = activities.find(activity => activity.id === id);
    if (!item) return;
    homeSnapshot = snapshotHome();
    history.replaceState({page:'home',home:homeSnapshot},'',baseUrl);
    history.pushState({page:'activity',id,home:homeSnapshot},'',`${baseUrl}#activity=${id}`);
    renderDetail(item);
  }
  function restoreHome(saved) {
    closeSheet();
    current = null;
    detail.hidden = true; actions.hidden = true;
    screen.hidden = false; nav.hidden = false;
    document.querySelector('.wordmark').hidden = false;
    document.querySelector('#detail-navigation').hidden = true;
    device.classList.remove('on-detail');
    document.title = 'OurTrail · 探索下一程';
    const home = saved || homeSnapshot;
    if (home) { Object.assign(state,home.filters); document.querySelector('#search').value = state.query; }
    render();
    requestAnimationFrame(() => {
      screen.scrollTo({top:home?.scroll || 0,behavior:'instant'});
      if (home?.focusId) document.querySelector(`[data-activity="${home.focusId}"]`)?.focus({preventScroll:true});
    });
  }
  function back() { if (!overlay.hidden) { closeSheet(); return; } if (history.state?.page === 'activity') history.back(); else restoreHome(); }
  function arrangements(item) {
    showSheet(`${sheetHead('我的同行安排')}<div class="arrangement-status">${icon('check')}已确认同行</div><h3 class="sheet-title">${item.title}</h3><div class="detail-line">${icon('calendar')}<div><strong>${item.date} ${item.weekday} · ${item.myTime || item.time}</strong><p>请按自己的集合时间到达。</p></div></div><div class="detail-line">${icon('pin')}<div><strong>${item.myMeeting || item.meeting}</strong><p>${item.myAddress || item.address}</p></div></div><div class="detail-line">${icon('route')}<div><strong>自行前往</strong><p>请自行安排到达集合点的交通。</p></div></div><p class="demo-caption">以上为当前演示成员的示例安排。</p><div class="sheet-actions"><button class="primary" data-close>知道了</button></div>`);
  }
  function signupPreview(item) {
    showSheet(`${sheetHead('报名同行')}<div class="signup-context"><strong>${item.title}</strong><span>${item.date} ${item.weekday} · ${item.time} 集合</span></div><p class="sheet-label">接下来，需要确认</p><ol class="signup-steps"><li><b>报名成员</b><p>选择本人或同行人，代报需获得对方授权。</p></li><li><b>联系方式与出行</b><p>填写联系信息，选择搭乘车辆或自行前往。</p></li><li><b>紧急联系人与参与确认</b><p>补全紧急联系人，阅读风险提示与资料使用说明。</p></li></ol><p class="demo-caption">这里展示报名入口与后续步骤；本版尚未展开报名表，不会提交真实报名。</p><div class="sheet-actions"><button class="primary" data-close>返回活动</button></div>`);
  }
  function fullMap(item) {
    showSheet(`${sheetHead('路线节点示意')}<div class="enlarged-route">${routeSvg(item)}</div><ol class="map-legend">${item.stops.map((stop,i)=>`<li><span>${i+1}</span><strong>${stop.name}</strong><small>${stop.distance}</small></li>`).join('')}</ol><p class="demo-caption">这是虚构节点的顺序示意，未接入地图或实测轨迹，不用于导航。</p><div class="sheet-actions"><button class="primary" data-close>返回路线</button></div>`);
  }
  document.querySelector('#back-home').addEventListener('click', back);
  actions.addEventListener('click', event => {
    if (!event.target.closest('#activity-primary') || !current) return;
    if (current.cta === 'arrangements') arrangements(current);
    else if (current.accepting) signupPreview(current);
    else back();
  });
  detail.addEventListener('click', event => {
    if (!current) return;
    const section = event.target.closest('[data-section]');
    if (section) {
      const target = detail.querySelector('#section-' + section.dataset.section);
      detail.scrollTo({top:target.offsetTop - 58,behavior:'smooth'});
    }
    const stop = event.target.closest('[data-stop]');
    if (stop) {
      const index = Number(stop.dataset.stop);
      detail.querySelector('#route-canvas').innerHTML = routeSvg(current,index);
      detail.querySelector('#stop-note span:last-child').textContent = current.stops[index].note;
      detail.querySelectorAll('[data-stop]').forEach(button => { const on = button === stop; button.classList.toggle('selected',on); button.setAttribute('aria-pressed',String(on)); });
    }
    if (event.target.closest('[data-map]')) fullMap(current);
    if (event.target.closest('[data-arrangements]')) arrangements(current);
    if (event.target.closest('[data-route-weather]')) {
      history.replaceState({...history.state,detailScroll:detail.scrollTop},'',location.href);
      location.href = `weather.html?activity=${current.id}&from=activity`;
    }
    if (event.target.closest('[data-activity-notices]')) showSheet(`${sheetHead('活动通知')}<div class="scope-icon">${icon('bell')}</div><p class="scope-copy">集合调整和行前提醒会出现在这里。</p><p class="demo-caption">此示例活动没有真实通知。</p><div class="sheet-actions"><button class="primary" data-close>返回活动</button></div>`);
  });
  detail.addEventListener('scroll', () => {
    if (sectionFrame) return;
    sectionFrame = requestAnimationFrame(() => {
      sectionFrame = 0;
      let selected = 'overview';
      detail.querySelectorAll('.detail-section').forEach(section => { if (section.offsetTop <= detail.scrollTop + 100) selected = section.id.replace('section-',''); });
      detail.querySelectorAll('[data-section]').forEach(button => { if (button.dataset.section === selected) button.setAttribute('aria-current','location'); else button.removeAttribute('aria-current'); });
    });
  }, {passive:true});
  window.addEventListener('popstate', event => {
    closeSheet();
    if (event.state?.page === 'activity') {
      homeSnapshot = event.state.home;
      const item = activities.find(activity => activity.id === event.state.id);
      if (item) renderDetail(item); else restoreHome(event.state.home);
    } else restoreHome(event.state?.home);
  });
  const directId = new URLSearchParams(location.hash.replace(/^#/, '')).get('activity');
  const savedHistory = history.state;
  const directItem = activities.find(item => item.id === directId);
  if (directItem && savedHistory?.page === 'activity' && savedHistory.id === directId && savedHistory.home) {
    // Reload an existing detail entry without replacing its saved home or adding history.
    homeSnapshot = savedHistory.home;
    Object.assign(state,homeSnapshot.filters);
    document.querySelector('#search').value = state.query;
    render();
    renderDetail(directItem);
  } else if (directItem) {
    // A newly opened deep link needs one local home entry for the in-app back button.
    history.replaceState({page:'home',home:snapshotHome()},'',baseUrl);
    open(directId);
  } else if (savedHistory?.page === 'home' && savedHistory.home) {
    restoreHome(savedHistory.home);
  } else {
    history.replaceState({page:'home',home:snapshotHome()},'',baseUrl);
  }
  return {open};
})();
