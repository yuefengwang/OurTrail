'use strict';

(() => {
  const D = window.WeatherDemo;
  const qs = new URLSearchParams(location.search);
  const requestedPlace = D.places.find(p => p.id === qs.get('activity'));
  const initialPlace = requestedPlace || D.places[0];
  const saved = history.state?.weather;
  const state = saved && D.places.some(p => p.id === saved.place) ? saved : {place:initialPlace.id,node:2,day:initialPlace.activityDateIndex,cursor:13,period:24,tab:'hourly',metric:'temp',level:3500,scroll:0};
  const weatherScreen = document.querySelector('#weather-screen');
  const body = document.querySelector('#weather-body');
  const overlay = document.querySelector('#weather-overlay');
  const sheet = document.querySelector('#weather-sheet');
  const CELL = 42;
  const previewWidth = Number(qs.get('width'));
  if ([375,390,414].includes(previewWidth)) {
    document.documentElement.style.setProperty('--device-width',previewWidth+'px');
    document.querySelector('#device').classList.add('preview-width');
  }
  let sheetFocus = null;
  let chartLeft = null;
  const sym = {
    back:'<path d="m15 5-7 7 7 7"/>', next:'<path d="m9 5 7 7-7 7"/>', down:'<path d="m6 9 6 6 6-6"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>', check:'<path d="m5 12 4 4L19 6"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>',
    cloud:'<path d="M7 18h11a4 4 0 0 0 0-8h-1a6 6 0 0 0-11-2 5 5 0 0 0 1 10Z"/>',
    rain:'<path d="M6 14h12a4 4 0 0 0-1-8 5 5 0 0 0-9-1 4.5 4.5 0 0 0-2 9Zm1 3-1 3m6-3-1 3m6-3-1 3"/>',
    snow:'<path d="M6 13h12a4 4 0 0 0-1-8 5 5 0 0 0-9 0 4.5 4.5 0 0 0-2 8Zm1 4v4m-2-2h4m8-2v4m-2-2h4"/>',
    mountain:'<path d="m2 20 7-14 5 9 3-6 5 11H2Z"/><path d="m6 12 3 2 2-2"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M9 20h6"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
    wind:'<path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h5"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${sym[name] || sym.cloud}</svg>`;
  const conditionIcon = value => icon(value==='晴'?'sun':value==='小雨'?'rain':value==='小雪'?'snow':'cloud');
  const place = () => D.places.find(p => p.id === state.place);
  const node = () => place().nodes[state.node];
  const series = () => D.getSeries(state.place,state.node,state.day,state.period);
  const selected = () => D.getHour(state.place,state.node,state.day,state.cursor);
  const fmt = value => Number(value).toLocaleString('en-US');
  const date = index => D.days[index];
  const selectedDate = () => date(state.day + Math.floor(state.cursor / 24));
  const persist = () => history.replaceState({...history.state,weather:{...state,scroll:weatherScreen.scrollTop}},'',location.href);
  const txt = (x,y,text,size=10,color='#66766c',anchor='middle') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}">${text}</text>`;
  const line = (arr,getY) => arr.map((h,i)=>`${i?'L':'M'}${i*CELL+CELL/2},${getY(h)}`).join(' ');

  function renderHeader() {
    const p = place(), n=node(), currentDay = selectedDate();
    document.querySelector('#place-name').textContent=p.name;
    document.querySelector('#choose-node').innerHTML=`${icon('pin')}${n.name} · ${n.altitude===null?'海拔待确认':fmt(n.altitude)+' m'}${icon('down')}`;
    const start=Math.max(0,Math.min(currentDay ? state.day+Math.floor(state.cursor/24)-2 : state.day, D.days.length-5));
    document.querySelector('#weather-days').innerHTML=D.days.slice(start,start+5).map((day,i)=>{
      const index=start+i, sample=D.getHour(state.place,state.node,index,13);
      const all=D.getSeries(state.place,state.node,index,24);
      return `<button role="tab" data-day="${index}" aria-selected="${index===state.day+Math.floor(state.cursor/24)}" aria-label="${day.label} ${day.weekday}"><b>${day.weekday}</b><span>${day.label}</span><span class="day-condition">${conditionIcon(sample.condition)}<small>${Math.round(Math.min(...all.map(h=>h.temp)))}° / ${Math.round(Math.max(...all.map(h=>h.temp)))}°</small></span><span class="day-mark">${index===p.activityDateIndex?'活动日':' '}</span></button>`;
    }).join('');
    document.querySelectorAll('[data-tab]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.tab===state.tab)));
    document.querySelector('.weather-tabs').dataset.context=`${p.name} · ${n.name} · ${currentDay.label} ${selected().time}`;
    document.title=`${p.name} · ${['hourly','cloud','route','sky'].includes(state.tab)?{hourly:'逐时预报',cloud:'云层剖面',route:'沿途天气',sky:'日月天相'}[state.tab]:'天气'} · OurTrail`;
  }
  function periodToggle() {
    return `<div class="period-toggle" aria-label="预报时长">${[24,48,72].map(n=>`<button data-period="${n}" class="${state.period===n?'selected':''}" aria-pressed="${state.period===n}" ${selected().dayIndex+n/24>D.days.length?'disabled':''}>${n} 小时</button>`).join('')}</div>`;
  }
  function readout() {
    const h=selected();
    return `<div class="weather-readout" aria-live="polite"><div class="readout-primary"><span class="condition-icon">${conditionIcon(h.condition)}</span><strong>${Math.round(h.temp)}°</strong><div><p><b>${selectedDate().label} ${h.time}</b></p><p>${h.condition} · 体感 ${Math.round(h.feels)}°</p></div></div><div class="readout-secondary"><div><b>${h.rain.toFixed(1)} <small>mm</small></b><span>降水量</span></div><div><b>${h.gust} <small>km/h</small></b><span>阵风</span></div></div></div>`;
  }
  function scrubber() {
    return `<div class="time-scrubber"><button data-step="-1" aria-label="前一个小时" ${state.cursor===0?'disabled':''}>${icon('back')}</button><input type="range" min="0" max="${state.period-1}" value="${state.cursor}" id="weather-hour" aria-label="预报时刻" aria-valuetext="${selectedDate().label} ${selected().time}"><button data-step="1" aria-label="后一个小时" ${state.cursor===state.period-1?'disabled':''}>${icon('next')}</button></div><p class="time-hint">${state.tab==='route'?'拖动时刻，比较沿途各点天气':'左右滑动图表 · 点按小时或拖动时间滑块'}</p>`;
  }
  function board(svg,height,axis,cloud=false) {
    const all=series(), w=all.length*CELL;
    return `<div class="chart-board"><div class="chart-axis ${cloud?'cloud-axis':''}" style="height:${height+30}px">${axis}</div><div class="chart-scroll" id="chart-scroll" tabindex="0" aria-label="${cloud?'云层时间剖面':'逐时天气图'}，可横向滚动"><div class="chart-inner" style="width:${w}px"><div class="hour-buttons">${all.map((h,i)=>`<button data-hour="${i}" class="${state.cursor===i?'selected':''}" aria-pressed="${state.cursor===i}" aria-label="选择 ${date(h.dayIndex).label} ${h.time}">${h.hour===0?date(h.dayIndex).label:h.time.slice(0,2)}</button>`).join('')}</div><svg class="weather-chart" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" role="img" aria-label="${cloud?'高度与时间对应的模型层云量，斜线区域无资料':'同一时间轴上的温度、降水、风速与分层云量'}">${svg}</svg></div></div></div>`;
  }
  function grid(w,ys,height) {
    return `${series().map((_,i)=>`<path class="grid" d="M${i*CELL+CELL/2} 0V${height}"/>`).join('')}${ys.map(y=>`<path class="grid" d="M0 ${y}H${w}"/>`).join('')}<rect class="selection" x="${state.cursor*CELL}" y="0" width="${CELL}" height="${height}"/>`;
  }
  function cursor(height) {return `<path class="cursor" d="M${state.cursor*CELL+CELL/2} 0V${height}"/>`;}
  function hourlyChart() {
    const all=series(),w=all.length*CELL,H=310;
    const minT=Math.floor(Math.min(...all.map(h=>h.feels))/5)*5, maxT=Math.ceil(Math.max(...all.map(h=>h.temp))/5)*5+1;
    const ty=v=>68-(v-minT)/(maxT-minT)*45;
    const windMax=Math.max(40,Math.ceil(Math.max(...all.map(h=>h.gust))/10)*10), wy=v=>214-v/windMax*45;
    const rainMax=Math.max(2,Math.ceil(Math.max(...all.map(h=>h.rain))));
    let svg=grid(w,[22,68,111,149,175,214],H);
    svg+=`<path class="feels-line" d="${line(all,h=>ty(h.feels))}"/><path class="temp-line" d="${line(all,h=>ty(h.temp))}"/>`;
    all.forEach((h,i)=>{const x=i*CELL+21;svg+=txt(x,ty(h.temp)-9,`${Math.round(h.temp)}°`,11,'#293f31');});
    [83,158,237].forEach(y=>svg+=`<path class="separator" d="M0 ${y}H${w}"/>`);
    all.forEach((h,i)=>{const x=i*CELL+21,bar=h.rain/rainMax*34;svg+=`<rect x="${x-7}" y="${141-bar}" width="14" height="${Math.max(h.rain>0?2:0,bar)}" rx="2" fill="#73aaca"/>${txt(x,103,h.rain?`${h.rain.toFixed(1)}`:'—',10,h.rain?'#3e779b':'#a6b0a9')}${txt(x,152,`${h.probability}%`,8,'#809486')}`;});
    svg+=`<path class="gust-line" d="${line(all,h=>wy(h.gust))}"/><path class="wind-line" d="${line(all,h=>wy(h.wind))}"/>`;
    all.forEach((h,i)=>{const x=i*CELL+21;svg+=txt(x,wy(h.gust)-5,h.gust,10,'#668e88')+txt(x,231,`${h.windDirection} ${h.wind}`,8,'#6c7e70');});
    [['cloudHigh',244],['cloudMid',264],['cloudLow',284]].forEach(([key,y])=>all.forEach((h,i)=>{const value=h[key],l=96-value*.49;svg+=`<rect x="${i*CELL+2}" y="${y}" width="38" height="17" rx="2" fill="hsl(110 7% ${l}%)"/>${txt(i*CELL+21,y+11,`${value}`,8,value>65?'#fff':'#52634f')}`;}));
    svg+=cursor(H);
    const axis='<div class="axis-time">时刻</div><div style="top:42px"><b>温度</b>°C</div><div style="top:122px"><b>降水</b>mm<br><span style="font-size:8px">概率 %</span></div><div style="top:204px"><b>风</b>km/h</div><div style="top:273px">高云</div><div style="top:293px">中云</div><div style="top:313px">低云</div>';
    return board(svg,H,axis);
  }
  function hourly() {
    const h=selected();
    return `${readout()}<div class="chart-toolbar"><span class="chart-caption">北京时间 · 云量单位 %</span>${periodToggle()}</div>${hourlyChart()}<div class="chart-legend"><span><i></i>气温</span><span><i class="lg-feels"></i>体感</span><span><i class="lg-rain"></i>降水</span><span><i class="lg-wind"></i>风速</span><span><i class="lg-gust"></i>阵风</span></div>${scrubber()}<section class="weather-section"><div class="weather-section-heading"><h2>${h.time} 的详细读数</h2><span>${node().name}</span></div><dl class="detail-grid"><div><dt>降水概率</dt><dd>${h.probability}<small>%</small></dd></div><div><dt>风向 / 风速</dt><dd>${h.windDirection}<small>${h.wind} km/h</small></dd></div><div><dt>阵风</dt><dd>${h.gust}<small>km/h</small></dd></div><div><dt>相对湿度</dt><dd>${h.humidity}<small>%</small></dd></div><div><dt>能见度</dt><dd>${h.visibility}<small>km</small></dd></div><div><dt>节点海拔</dt><dd>${node().altitude===null?'—':fmt(node().altitude)}<small>${node().altitude===null?'待确认':'m'}</small></dd></div></dl></section><button class="weather-link-row" data-tab="cloud"><div><span>云层在哪个高度？</span><small>查看这一地点的高度—时间剖面</small></div>${icon('next')}</button><button class="weather-link-row" data-tab="route"><div><span>沿途其他地点的天气</span><small>保留 ${selectedDate().label} ${h.time}，比较四个路线节点</small></div>${icon('next')}</button>`;
  }
  function cloudChart() {
    const all=series(),w=all.length*CELL,H=240,n=node(),low=n.altitude===null?0:Math.max(0,Math.floor((n.altitude-500)/500)*500),high=6000;
    const y=v=>(high-v)/(high-low)*H;
    let svg=`<defs><pattern id="cloud-missing" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill="#fafbf9"/><path d="M-1 1l8 8M5-1l4 4" stroke="#dce3dc" stroke-width="1"/></pattern><clipPath id="cloud-plot"><rect width="${w}" height="${H}"/></clipPath></defs><g clip-path="url(#cloud-plot)"><rect width="${w}" height="${H}" fill="url(#cloud-missing)"/>`;
    all.forEach((h,i)=>h.cloudLevels.forEach(layer=>{if(layer.cover===null)return;const lower=Math.max(low,layer.altitude-250,n.altitude??low,h.covered.min),upper=Math.min(high,layer.altitude+250,h.covered.max);if(lower>=upper)return;const l=97-layer.cover*.58;svg+=`<rect x="${i*CELL}" y="${y(upper)}" width="${CELL}" height="${y(lower)-y(upper)+.3}" fill="hsl(112 7% ${l}%)"/>`;}));
    for(let level=Math.ceil(low/1000)*1000;level<=high;level+=1000)svg+=`<path class="grid" d="M0 ${y(level)}H${w}"/>`;
    if(n.altitude!==null){const ground=y(n.altitude);svg+=`<rect x="0" y="${ground}" width="${w}" height="${H-ground}" fill="#e9eee2"/><path d="M0 ${ground}H${w}" stroke="#6d8868" stroke-width="1.6" stroke-dasharray="5 3"/>`;svg+=txt(state.cursor*CELL+24,Math.min(H-7,ground+15),`节点 ${fmt(n.altitude)} m`,9,'#56704e','start');}
    svg+=`<path d="M0 ${y(state.level)}H${w}" stroke="#9a7f39" stroke-width="1" stroke-dasharray="2 5"/>${cursor(H)}</g>`;
    let axis='<div class="axis-unit">海拔 m</div>';
    for(let level=Math.ceil(low/1000)*1000;level<=high;level+=1000)axis+=`<div class="altitude-tick" style="top:${Math.max(29,y(level)+24)}px">${fmt(level)}</div>`;
    return board(svg,H,axis,true);
  }
  function cloud() {
    const h=selected(),n=node(),layer=h.cloudLevels.find(l=>l.altitude===state.level),terrain=n.altitude!==null&&state.level<n.altitude;
    const value=terrain?'地形以下':layer?.cover===null||layer?.cover===undefined?'无层资料':layer.cover+'%';
    const options=Array.from({length:10},(_,i)=>1500+i*500).map(v=>`<option value="${v}" ${v===state.level?'selected':''}>${fmt(v)} m</option>`).join('');
    return `<div class="cloud-heading"><h2>云随高度与时间变化</h2><button data-help="cloud">读图说明 ${icon('info')}</button></div><div class="chart-toolbar"><span class="chart-caption">${selectedDate().label} ${h.time} · ${node().name}</span>${periodToggle()}</div>${cloudChart()}<div class="cloud-scale"><span>云量 0%</span><span class="cloud-ramp"></span><span>100%</span><span class="hatch-key"></span><span>无层资料</span></div><div class="cloud-readout"><label for="profile-level">读取高度 <select id="profile-level" aria-label="读取云量的海拔">${options}</select></label><div><span class="cloud-value">${value}</span><small> 模型云量</small></div></div>${n.altitude===null?'<div class="unknown-message"><strong>此点海拔待确认</strong>可看模型层云量，但无法标出节点高度，也无法判断此点是否在云中。</div>':''}<p class="chart-note">${n.altitude===null?'未绘制节点海拔线。':'绿色横虚线标出节点海拔。'}琥珀横虚线标出读取高度。斜线区没有模型层资料，<strong>不能当作晴空</strong>；图中灰阶表示云量，并非实测云底、云顶。</p>${scrubber()}<section class="weather-section"><div class="weather-section-heading"><h2>${h.time} 的分层云量</h2><span>模型层 · 海拔 m</span></div><div class="layer-table">${h.cloudLevels.slice().reverse().map(l=>`<div class="layer-row"><span>${fmt(l.altitude)} m</span><i>${l.cover===null?'':`<b style="width:${l.cover}%"></b>`}</i><span>${l.cover===null?(n.altitude!==null&&l.altitude<n.altitude?'地形以下':'无资料'):l.cover+'%'}</span></div>`).join('')}</div></section>`;
  }
  function metricValue(h) {return state.metric==='rain'?h.rain.toFixed(1):state.metric==='gust'?h.gust:Math.round(h.temp);}
  function metricUnit() {return {temp:'°C',rain:'mm',gust:'km/h'}[state.metric];}
  function routeMap() {
    const p=place(),h=selected();
    return `<div class="weather-map"><svg viewBox="0 0 320 214" preserveAspectRatio="none" aria-hidden="true"><rect width="320" height="214" fill="#edf2e7"/><path d="M-10 143C47 109 89 10 170 31S231 126 340 57V-10H-10Z" fill="#e1e9d9"/><path d="M-20 79C67 58 85-7 162 15S250 110 339 39M-20 90C67 69 85 4 162 26S250 121 339 50M-20 102C67 81 85 16 162 38S250 133 339 62M-20 116C67 95 85 30 162 52S250 147 339 76" stroke="#cddac3" stroke-width=".8" fill="none"/><path d="M189 225C142 172 220 190 263 155S280 125 334 129" stroke="#c3d8d4" stroke-width="8" fill="none"/><path d="M61 151C56 118 117 155 143 106S214 78 242 51C279 84 276 124 223 151S136 193 86 169" stroke="white" stroke-width="7" fill="none"/><path d="M61 151C56 118 117 155 143 106S214 78 242 51C279 84 276 124 223 151S136 193 86 169" stroke="#77926d" stroke-width="2.5" stroke-dasharray="5 4" fill="none"/><text x="23" y="28" class="map-label">路线节点天气</text></svg>${p.nodes.map((n,i)=>{const v=D.getHour(p.id,i,h.dayIndex,h.hour);const pos=[[18,55],[44,43],[76,25],[32,79]][i];return `<button data-node-map="${i}" class="${state.node===i?'active':''}" style="left:${pos[0]}%;top:${pos[1]}%" aria-label="选择${n.name}">${metricValue(v)}<small>${metricUnit()} · ${i+1} 号点</small></button>`;}).join('')}<span class="map-notice">路线与天气均为示意</span></div>`;
  }
  function route() {
    const h=selected(),p=place();
    return `<div class="route-weather-context"><div><b>${p.route}</b><small>${selectedDate().label} ${h.time} · 同一时刻比较</small></div><span class="chart-caption">4 个地点</span></div><div class="map-metrics" aria-label="地图天气指标">${[['temp','温度'],['rain','降水量'],['gust','阵风']].map(([key,label])=>`<button data-metric="${key}" class="${key===state.metric?'selected':''}" aria-pressed="${key===state.metric}">${label}</button>`).join('')}</div>${routeMap()}${scrubber()}<div class="route-point-list">${p.nodes.map((n,i)=>{const v=D.getHour(p.id,i,h.dayIndex,h.hour);return `<button class="route-point ${state.node===i?'active':''}" data-node-map="${i}" aria-label="查看${n.name}的天气"><span class="node-number">${i+1}</span><span><b>${n.name}</b><small>${n.distance} km · ${n.altitude===null?'海拔待确认':fmt(n.altitude)+' m'}</small></span><span class="node-weather">${conditionIcon(v.condition)}<span class="node-value">${metricValue(v)}<em>${metricUnit()}</em></span></span></button>`;}).join('')}<button class="full-width-action" data-tab="hourly">查看「${node().name}」逐时预报 →</button></div><p class="chart-note">每个标记只代表该地点的读数，不代表两点之间的连续天气。此图不含降水雷达影像。</p>`;
  }
  function sky() {
    // Objective times and incomplete evidence states are design fixtures, not astronomical calculations.
    const d=selected().dayIndex, rise=`07:${String(17+d%7).padStart(2,'0')}`,set=`18:${String(26-d%7).padStart(2,'0')}`;
    return `<section class="sun-summary"><h2>${selectedDate().label} ${selectedDate().weekday}</h2><p>${node().name} · 日照与天文时刻示意</p><svg class="sun-arc" viewBox="0 0 330 135" role="img" aria-label="日出${rise}，日落${set}，时刻示意"><defs><linearGradient id="sun-fill" x2="0" y2="1"><stop stop-color="#f3e7b7" stop-opacity=".6"/><stop offset="1" stop-color="#fff8e0" stop-opacity=".2"/></linearGradient></defs><path d="M25 105C68-15 262-15 305 105Z" fill="url(#sun-fill)"/><path d="M25 105C68-15 262-15 305 105" stroke="#c6a85c" stroke-width="1.5" stroke-dasharray="3 4"/><path d="M12 105H318" stroke="#dfe6da"/><circle cx="165" cy="15" r="10" fill="#ddbf6d"/><circle cx="25" cy="105" r="4" fill="#a9904c"/><circle cx="305" cy="105" r="4" fill="#a9904c"/>${txt(25,127,'日出',10,'#8a8e73')}${txt(305,127,'日落',10,'#8a8e73')}${txt(165,86,'白昼约 11 小时',12,'#7c835f')}</svg><div class="sun-facts"><div><b>${rise}</b><span>日出</span></div><div><b>${set}</b><span>日落</span></div><div><b>23%</b><span>月面照明 · 示例</span></div></div></section><section class="weather-section"><div class="weather-section-heading"><h2>晨昏与暗夜</h2><span>客观时刻</span></div><div class="solar-events">${[['06:49','晨间蓝调','太阳接近地平线；色彩表现还受云层影响。'],[rise,'日出','时刻本身不代表能直接看到太阳。'],['17:43','傍晚黄金时刻','暖光能否照到山体，仍需结合低云。'],[set,'日落','地形遮挡可能影响实际可见时刻。'],['19:39','天文暗夜始','太阳已降至地平线下 18°。']].map(([time,label,note])=>`<div class="solar-event"><time>${time}</time><div><b>${label}</b><p>${note}</p></div></div>`).join('')}</div></section><section class="weather-section"><div class="weather-section-heading"><h2>天相条件</h2><button data-help="sky">如何判断 ${icon('info')}</button></div>${[['云海',node().altitude===null?'此点缺少可信海拔，无法确认与云层的相对位置。':'需要连续云层、地点净空等证据；单个高度的云量不足以确认。'],['星空与银河','还缺少月亮高度、银心位置与连续暗夜晴空资料。'],['晨昏光染','需要结合晨昏方向和光能否到达山体，不能只看日出日落时刻。']].map(([name,reason])=>`<article class="sky-item"><div><b>${name}</b><span>资料不足</span></div><p>${reason}</p></article>`).join('')}<p class="sky-note">没有可确认的窗口，不代表一定看不到。资料不足会保留说明；已有证据排除的现象会收起并说明原因。</p></section>`;
  }
  function renderBody(keep=true,center=false) {
    const top=weatherScreen.scrollTop, old=body.querySelector('#chart-scroll');
    if(old)chartLeft=old.scrollLeft;
    body.innerHTML=({hourly,cloud,route,sky}[state.tab]||hourly)();
    renderHeader();
    const chart=body.querySelector('#chart-scroll');
    if(chart){chart.scrollTo({left:center||chartLeft===null?Math.max(0,state.cursor*CELL-chart.clientWidth/2+CELL/2):chartLeft,behavior:'instant'});chartLeft=chart.scrollLeft;}
    if(keep)weatherScreen.scrollTo({top,behavior:'instant'});
    persist();
  }
  function setCursor(value,center=true) {const keepSliderFocus=document.activeElement?.id==='weather-hour';state.cursor=Math.max(0,Math.min(state.period-1,Number(value)));renderBody(true,center);if(keepSliderFocus)document.querySelector('#weather-hour')?.focus({preventScroll:true});}
  function changeTab(tab) {if(!['hourly','cloud','route','sky'].includes(tab))return;state.tab=tab;renderBody();weatherScreen.scrollTo({top:0,behavior:'instant'});persist();}
  function openSheet(title,content) {
    sheetFocus=document.activeElement;
    sheet.innerHTML=`<div class="sheet-head"><h2 id="weather-sheet-title">${title}</h2><button class="close-button" data-dismiss aria-label="关闭弹层">${icon('close')}</button></div>${content}`;
    overlay.hidden=false;weatherScreen.style.overflow='hidden';sheet.focus();
  }
  function closeSheet() {overlay.hidden=true;weatherScreen.style.overflow='';sheetFocus?.focus({preventScroll:true});}
  function placeOptions(filter='') {
    const photos={autumn:'ridge.jpg',forest:'forest-v2.jpg',lake:'lake.jpg',snow:'snow-v2.jpg'};
    const matches=D.places.filter(p=>`${p.name}${p.area}${p.route}`.includes(filter));
    return matches.length?matches.map(p=>`<button class="place-option" data-place="${p.id}"><img class="place-thumb" src="assets/${photos[p.id]}" alt="${p.name}的示意配图"><span><b>${p.name}</b><small>${p.area} · 4 个路线节点</small></span>${state.place===p.id?icon('check'):icon('next')}</button>`).join(''):'<p class="weather-empty">没有匹配地点，试试“青城”或“四姑娘山”。</p>';
  }
  function choosePlace() {openSheet('去哪里看天气',`<input class="place-search" id="place-search" placeholder="搜索已有活动地点" aria-label="搜索天气地点"><div class="place-list" id="place-list">${placeOptions()}</div><p class="sheet-quiet-label">当前展示四个示例活动的地点。配图为示意，<a href="assets/sources.json" target="_blank" rel="noopener">查看照片来源与许可 ↗</a>。</p>`);}
  function chooseNode() {openSheet('选择路线地点',`<p class="sheet-quiet-label">${place().route} · 切换后沿用当前日期与时刻</p>${place().nodes.map((n,i)=>`<button class="node-option" data-node="${i}"><span>${i+1} · ${n.name}<small>${n.distance} km · ${n.altitude===null?'海拔待确认':fmt(n.altitude)+' m'}</small></span>${i===state.node?icon('check'):icon('next')}</button>`).join('')}`);}
  function help(kind) {
    const content={
      source:['数据与时间','<h3>当前是交互设计演示</h3><p>所有天气数值、路线坐标、海拔与天文时刻均为合成示例，不是实时数据，也不是未来天气预报。</p><h3>时间与单位</h3><p>北京时间 UTC+8；气温 °C，逐时降水量 mm，风速与阵风 km/h，云量 %，海拔 m。</p><h3>资料缺失</h3><p>斜线纹理表示没有可用模型层资料；空值不表示晴空。缺少可信海拔时，不判断地点与云层的相对位置。</p>'],
      cloud:['怎样读云层剖面','<h3>横轴是时间，纵轴是海拔</h3><p>灰阶越深，表示该模型高度的云量越多。选中小时后，调整“读取高度”可以查看该层读数。</p><h3>节点高度与数据范围分开看</h3><p>绿色虚线为所选节点海拔。斜线区没有层资料，绿色浅底为地形以下。扩大显示范围不会增加模型资料。</p><h3>它不是实测云底、云顶</h3><p>离散高度的模型云量不能直接给出真实云层边界。本图没有气象雷达影像，也不以图形范围判断云海。</p>'],
      sky:['时刻与天相是两件事','<h3>时刻可以确定，能否看到需要证据</h3><p>日出、日落与天文暗夜是天文时刻。云海、光染、星空与银河还依赖云层、地形与月光等条件。</p><h3>三种结果</h3><p>有条件：展示窗口及依据；已排除：收起并说明原因；资料不足：保留缺失原因。本示例展示资料不足状态，不把缺资料换成零分。</p>'],
    };
    const [title,copy]=content[kind];openSheet(title,`<div class="weather-sheet-copy">${copy}</div><button class="weather-sheet-action" data-dismiss>知道了</button>`);
  }
  document.addEventListener('click',event=>{
    const el=event.target.closest('button');if(!el)return;
    if(el.hasAttribute('data-dismiss')){closeSheet();return;}
    if(el.dataset.width){document.documentElement.style.setProperty('--device-width',el.dataset.width+'px');document.querySelectorAll('[data-width]').forEach(b=>{b.classList.toggle('on',b===el);b.setAttribute('aria-pressed',String(b===el));});return;}
    if(el.id==='choose-place'){choosePlace();return;}if(el.id==='choose-node'){chooseNode();return;}
    if(el.id==='data-source'){help('source');return;}if(el.dataset.help){help(el.dataset.help);return;}
    if(el.dataset.place){const p=D.places.find(p=>p.id===el.dataset.place);Object.assign(state,{place:p.id,node:2,day:p.activityDateIndex,cursor:13,period:24});chartLeft=null;closeSheet();renderBody(false,true);weatherScreen.scrollTop=0;persist();return;}
    if(el.dataset.node!==undefined){state.node=Number(el.dataset.node);closeSheet();renderBody(true);return;}
    if(el.dataset.nodeMap!==undefined){state.node=Number(el.dataset.nodeMap);renderBody();return;}
    if(el.dataset.day!==undefined){state.day=Number(el.dataset.day);state.cursor=state.cursor%24;if(state.day+state.period/24>D.days.length)state.period=24;chartLeft=null;renderBody(true,true);return;}
    if(el.dataset.tab){changeTab(el.dataset.tab);return;}
    if(el.dataset.period){const h=selected();state.period=Number(el.dataset.period);state.day=h.dayIndex;state.cursor=h.hour;renderBody(true,true);return;}
    if(el.dataset.hour!==undefined){setCursor(el.dataset.hour,false);return;}
    if(el.dataset.step){setCursor(state.cursor+Number(el.dataset.step));return;}
    if(el.dataset.metric){state.metric=el.dataset.metric;renderBody();return;}
    if(el.dataset.nav==='explore'){location.href='index.html';return;}
    if(el.dataset.nav==='weather'){weatherScreen.scrollTo({top:0,behavior:'smooth'});return;}
    if(el.dataset.nav){openSheet(el.dataset.nav==='me'?'我的':'通知','<p class="weather-sheet-copy">这个入口将在后续原型中展开。当前可以完整体验探索、活动详情和天气页面。</p><button class="weather-sheet-action" data-dismiss>返回天气</button>');return;}
    if(el.id==='weather-back'){if(document.referrer&&new URL(document.referrer).origin===location.origin)history.back();else location.href='index.html'+(requestedPlace?'#activity='+requestedPlace.id:'');}
  });
  overlay.querySelector('.scrim').addEventListener('click',closeSheet);
  document.addEventListener('input',event=>{if(event.target.id==='place-search')document.querySelector('#place-list').innerHTML=placeOptions(event.target.value.trim());});
  // Commit slider changes on release, preserving the native drag interaction.
  document.addEventListener('change',event=>{if(event.target.id==='weather-hour')setCursor(event.target.value);if(event.target.id==='profile-level'){state.level=Number(event.target.value);renderBody();}});
  document.addEventListener('keydown',event=>{
    if(!overlay.hidden){if(event.key==='Escape')closeSheet();if(event.key==='Tab'){const targets=[...sheet.querySelectorAll('button,input,a[href]')];const first=targets[0],last=targets[targets.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===sheet)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===sheet)){event.preventDefault();first?.focus();}}return;}
    if(event.target.id==='chart-scroll'&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setCursor(state.cursor+(event.key==='ArrowRight'?1:-1));document.querySelector('#chart-scroll')?.focus({preventScroll:true});}
  });
  weatherScreen.addEventListener('scroll',()=>{weatherScreen.classList.toggle('is-scrolled',weatherScreen.scrollTop>160);persist();},{passive:true});
  document.querySelectorAll('[data-w-icon]').forEach(el=>el.innerHTML=icon(el.dataset.wIcon));
  if(qs.get('from')==='activity'){const back=document.querySelector('#weather-back');back.hidden=false;back.innerHTML=icon('back');}
  const restoredTop=state.scroll||0;
  renderHeader();renderBody(false,true);weatherScreen.scrollTo({top:restoredTop,behavior:'instant'});
})();
