import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { runtime } from '../app/runtime';
import { useView } from '../app/useView';
import { useAppNavigation } from '../app/navigation';
import { FormField } from '../components/FormField';
import { StatusPanel } from '../components/StatusPanel';
import type { ReadRequest } from '../domain/contracts';

export function Weather() {
  const { activityId = '' } = useParams();
  const request = useMemo<ReadRequest>(() => ({ kind: 'activity', activityId, perspective: 'participant' }), [activityId]);
  const view = useView(request);
  const [selectedPoint, setPoint] = useState('');
  const [selectedDate, setDate] = useState('');
  const { go } = useAppNavigation();
  if (view.kind !== 'activity') return <StatusPanel kind="denied" title="无法查看天气参考" detail={view.kind === 'denied' ? view.message : '活动不存在。'} />;
  const pointId = selectedPoint || view.activity.routeSnapshot.points[0]?.id || '';
  const date = selectedDate || (view.activity.startAt ? new Date(Date.parse(view.activity.startAt) + 8 * 3600000).toISOString().slice(0, 10) : runtime.getNow().slice(0, 10));
  const result = runtime.readWeather(activityId, pointId, date);
  return <section className="stack"><header><span className="eyebrow">行前参考</span><h2 className="page-title">留意天气，也留意脚下。</h2></header><div className="callout warning">固定模拟天气，不是真实预报，也不是出发许可。请出发前核实当地气象与路况。</div><FormField label="路线关键点"><select value={pointId} onChange={e => setPoint(e.target.value)}>{view.activity.routeSnapshot.points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField><FormField label="查看日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></FormField>
    {result.status === 'ready' ? <><p className="small muted">演示更新时间：{new Date(result.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>{result.hours.map(hour => <div className="list-row" key={hour.at}><strong>{hour.at.slice(11, 16)}</strong><span>{hour.temperature}°C<small>降水 {hour.precipitation} mm · {hour.wind}</small></span></div>)}</> : <StatusPanel kind="empty" title="暂不展示天气数字" detail={result.status === 'out_of_range' ? '所选日期超出今天起14天的模拟范围。请保留日期，临近出发再核实。' : result.message} />}
    {view.activity.ownerId === runtime.getActor().userId && <button className="button secondary" onClick={() => { runtime.setDraft(activityId, 'notice', { content: `${date} 天气提醒：出发前请核实当地预报与路况，准备防滑鞋与雨具。此处仅为模拟提示。` }); go(`/activities/${activityId}/notices`); }}>生成天气提醒草稿</button>}
  </section>;
}
