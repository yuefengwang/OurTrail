// 受控示意数据，复用生产渲染器；不是实时预报，也不产生天相结论。
const fs = require('fs');
const U = require('../../../../miniprogram/utils/meteogram-svg');
const surface = Array.from({length:24}, (_, h) => ({t:String(h).padStart(2,'0')+':00',d:'2026-10-31',temp:8+Math.sin(h/4)*5,feels:7,pop:h>15?65:10,precip:h>15?0.8:0,showers:0,code:h>15?61:2,wind:8+h/2,gust:18+h/2,windDir:180,rh:70,cloud:{low:40,mid:30,high:10},uv:3,visibility:15,freezing:3500}));
const cf={times:surface.map((_,h)=>h),altitudes:Array.from({length:29},(_,i)=>i*250),values:surface.map((_,h)=>Array.from({length:29},(_,i)=>Math.max(0,95-Math.abs(i*250-(2100+200*Math.sin(h/4)))/5))),covered:{lo:250,hi:6750}};
const geo=U.buildUnified({surface,cloudField:cf,userAltitude:2800,elevSource:'gpx',width:350,horizon:24});
fs.writeFileSync(__dirname+'/weather.svg', U.renderUnifiedBase(geo,{}).svg);
