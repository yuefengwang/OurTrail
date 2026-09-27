import { useMemo, useState } from 'react';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../app/useView';
import { FormField } from '../components/FormField';
import { Overlay } from '../components/Overlay';
import { PersonRow } from '../components/PersonRow';
import { StatusPanel } from '../components/StatusPanel';
import type { Payload, Perspective, ReadRequest } from '../domain/contracts';

export function Field({ activityId, perspective = 'organizer' }: { activityId: string; perspective?: Perspective }) {
  useRuntimeVersion();
  return <FieldContext key={`${runtime.getActor().userId}:${activityId}:${perspective}`} activityId={activityId} perspective={perspective} />;
}

function FieldContext({ activityId, perspective }: { activityId: string; perspective: Perspective }) {
  const request = useMemo<ReadRequest>(() => ({ kind: 'activity', activityId, perspective }), [activityId, perspective]);
  const view = useView(request);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pointId, setPointId] = useState('');
  const [search, setSearch] = useState('');
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const { run, busy, error, success, clearError } = useCommand();
  if (view.kind !== 'activity') return <StatusPanel kind="denied" title="当前任务不可用" detail={view.kind === 'denied' ? view.message : '请检查活动与账号。'} />;
  const phase = view.activity.phase;
  const selected = view.rows.find(row => row.signupId === selectedId);
  const evidence = { at: runtime.getNow(), by: runtime.getActor().userId ?? '', note };
  const eligible = view.rows.filter(row => row.status === 'confirmed');
  const rows = eligible.filter(row => row.name.includes(search) && (!unresolvedOnly || row.departure === 'unknown' || row.departure === 'coordinating' || (row.departure === 'joined' && !row.home)));
  const execute = (payload: Payload) => { void run(payload); };
  const actions: Array<{ label: string; payload: Payload }> = [];
  if (selected) {
    const signupId = selected.signupId;
    if (phase === 'gathering' || (phase === 'active' && selected.departure === 'coordinating')) {
      if (!selected.checkedIn) actions.push({ label: '确认现场签到', payload: { type: 'attendance.checkin', activityId, signupId, checkIn: { method: 'manual', evidence } } });
      actions.push(...(['joined', 'not_departed', 'coordinating'] as const).map((kind, i) => ({ label: ['核实已随队出发', '核实未出发', '标记迟到协调'][i], payload: { type: 'attendance.departure' as const, activityId, signupId, outcome: { kind, evidence } } })));
    }
    if (phase === 'active' && selected.departure === 'joined' && pointId) actions.push({ label: '确认到达此节点', payload: { type: 'attendance.node', activityId, signupId, pointId, note } });
    if (phase === 'closing' && selected.departure === 'joined' && !selected.home) actions.push({ label: '核实安全到家', payload: { type: 'attendance.home', activityId, signupId, note } });
    if (['active', 'closing'].includes(phase) && selected.departure === 'joined') actions.push({ label: selected.returnPlan === 'independent' ? '改回原车返程' : '记录另行返程', payload: { type: 'attendance.returnPlan', activityId, signupId, plan: selected.returnPlan === 'independent' ? 'assigned' : 'independent', note } });
    if (['gathering', 'active', 'closing'].includes(phase)) actions.push({ label: '记录下撤报备', payload: { type: 'incident.report', activityId, signupIds: [signupId], kind: 'withdrawal', description: note } }, { label: '记录其他异常', payload: { type: 'incident.report', activityId, signupIds: [signupId], kind: 'other', description: note } });
  }
  return <section className="stack">
    <div className="callout warning"><h3>{phase === 'closing' ? '逐人核实，安心收尾' : '现场事实，逐项确认'}</h3><p>签到、上车、出发与到家分别记录，不能相互替代。</p><div className="cluster"><strong>待到家 {view.counters.pendingHome} 人</strong><strong>未结异常 {view.counters.openIncidents} 项</strong></div></div>
    <FormField label="查找现场人员"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="输入姓名" /></FormField>
    <label className="check-label"><input type="checkbox" checked={unresolvedOnly} onChange={e => setUnresolvedOnly(e.target.checked)} /><span>只看去向或到家待核实人员</span></label>
    <ul className="person-list">{rows.map(row => <PersonRow key={row.signupId} name={row.name} subtitle={`${row.pickup} · ${row.checkedIn ? '已签到' : '未签到'} · ${row.vehicle || '无乘车安排'}`} status={row.home ? '已到家' : ({ unknown: '出发待核实', joined: '已随队', not_departed: '未出发', coordinating: '协调中' })[row.departure]} tone={row.home || row.departure === 'not_departed' ? 'success' : 'warning'}><button className="button text" onClick={() => { setSelectedId(row.signupId); setNote(''); clearError(); }}>现场记录</button></PersonRow>)}</ul>
    {!rows.length && <p className="muted">当前范围没有符合条件的人员。</p>}
    <section className="stack"><h3 className="section-title">异常与处理</h3>{view.incidents.map(incident => <article className="card stack" key={incident.id}><span className={`badge ${incident.resolved ? 'success' : 'warning'}`}>{incident.resolved ? '已核实处理' : '待跟进'}</span><p>{incident.description}</p>{!incident.resolved && ['gathering', 'active', 'closing'].includes(phase) && runtime.can({ type: 'incident.resolve', activityId, incidentId: incident.id, note }).ok && <><FormField label={`处理结果 · ${incident.id}`}><textarea value={selectedId === incident.id ? note : ''} onChange={e => { setSelectedId(incident.id); setNote(e.target.value); }} /></FormField><button className="button secondary" disabled={busy || selectedId !== incident.id || !note.trim()} onClick={() => execute({ type: 'incident.resolve', activityId, incidentId: incident.id, note })}>确认本条已解决</button></>}</article>)}{!view.incidents.length && <p className="muted">当前范围没有异常记录。</p>}</section>
    {phase === 'active' && <section className="stack"><h3 className="section-title">最后一次主动上报</h3><p className="small muted">模拟位置 · 非实时追踪 · 不用于导航。超过30分钟的点位不代表当前所在。</p>{view.positions.length > 0 && <div className="map"><svg viewBox="0 0 320 140" role="img" aria-label="授权上报点示意，非导航">{view.positions.map((p, i) => <g key={p.signupId}><circle cx={24 + (i % 6) * 52} cy={40 + Math.floor(i / 6) * 48} r="6" fill={p.stale ? 'var(--muted)' : 'var(--forest)'} /><text x={12 + (i % 6) * 52} y={62 + Math.floor(i / 6) * 48} fontSize="10">{p.name}</text></g>)}</svg></div>}{view.positions.map(p => <div className="list-row" key={p.signupId}><span>{p.name}<small>{p.coordinates.lat}, {p.coordinates.lng}</small></span><span className={`badge ${p.stale ? 'warning' : 'neutral'}`}>{new Date(p.reportedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}{p.stale ? ' · 已过时' : ''}</span></div>)}{!view.positions.length && <p className="muted">没有仍在授权期内的上报点。</p>}</section>}
    {error && <p role="alert" className="callout danger">{error.message}</p>}{success && <p role="status" className="callout success">{success}</p>}
    <Overlay kind="sheet" open={!!selected} title={selected ? `${selected.name} · 现场记录` : '现场记录'} onClose={() => setSelectedId(null)}><FormField label="逐人核实依据"><textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="填写现场、电话核实的实际结果" /></FormField>{phase === 'active' && <FormField label="路线节点"><select value={pointId} onChange={e => setPointId(e.target.value)}><option value="">选择节点</option>{view.activity.routeSnapshot.points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField>}{actions.filter(action => runtime.can(action.payload).ok).map(action => <button key={action.label} className="button secondary" disabled={busy || !note.trim()} onClick={() => execute(action.payload)}>{action.label}</button>)}{error && <p role="alert" className="callout danger">{error.message}</p>}{success && <p role="status">{success}</p>}</Overlay>
  </section>;
}
