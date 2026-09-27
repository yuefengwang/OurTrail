import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../app/useView';
import { PersonRow } from '../components/PersonRow';
import { StatusPanel } from '../components/StatusPanel';
import type { ReadRequest } from '../domain/contracts';
import type { LegSchema } from '../domain/model';
import type { z } from 'zod';

export function VehicleTask() {
  const { activityId = '', vehicleId = '' } = useParams();
  useRuntimeVersion();
  return <VehicleContext key={`${runtime.getActor().userId}:${vehicleId}`} activityId={activityId} vehicleId={vehicleId} />;
}
function VehicleContext({ activityId, vehicleId }: { activityId: string; vehicleId: string }) {
  const request = useMemo<ReadRequest>(() => ({ kind: 'activity', activityId, vehicleId, perspective: 'vehicle' }), [activityId, vehicleId]);
  const view = useView(request);
  const [chosenLeg, setLeg] = useState<z.infer<typeof LegSchema> | null>(null);
  const [message, setMessage] = useState('');
  const { run, busy, error, success } = useCommand();
  if (view.kind !== 'activity' || !view.vehicleTask) return <StatusPanel kind="denied" title="本车任务不可用" detail={view.kind === 'denied' ? view.message : '本车联络授权已结束。'} />;
  const { vehicle, passengers } = view.vehicleTask;
  const leg = chosenLeg ?? (view.activity.phase === 'closing' ? 'return' : 'outbound');
  const expected = passengers.filter(p => leg === 'outbound' ? !['not_departed', 'coordinating'].includes(p.departure) : p.departure === 'joined' && p.returnPlan === 'assigned');
  const boarded = expected.filter(p => leg === 'outbound' ? p.outboundBoarded : p.returnBoarded);
  const enabled = leg === 'outbound' ? ['gathering', 'active'].includes(view.activity.phase) : ['active', 'closing'].includes(view.activity.phase);
  return <section className="stack"><header className="hero stack"><span className="eyebrow">本车联络任务</span><h2>{vehicle.label}</h2><p>{vehicle.plate} · 演示车牌</p><p className="small">核载 {vehicle.legalCapacity} − 司机 {vehicle.drivers.length} − 不可用 {vehicle.blockedSeats} = {vehicle.legalCapacity - vehicle.drivers.length - vehicle.blockedSeats} 个乘客位</p></header>
    <div className="segmented" aria-label="行车方向"><button aria-pressed={leg === 'outbound'} onClick={() => setLeg('outbound')}>去程</button><button aria-pressed={leg === 'return'} onClick={() => setLeg('return')}>返程</button></div>
    <h3>应到 {expected.length} 人 · 已上车 {boarded.length} 人</h3><p className="muted">{vehicle.legs[leg].completed ? '本程已完成' : vehicle.legs[leg].departed ? '本程已发车' : '逐人清点后再发车'}</p>
    <ul className="person-list">{passengers.map(p => <PersonRow key={p.signupId} name={p.name} subtitle={`${p.pickup} · ${p.seat ? `${p.seat}号座` : '未编号'}`} status={leg === 'return' && p.returnPlan === 'independent' ? '另行返程' : (leg === 'outbound' ? p.outboundBoarded : p.returnBoarded) ? '已上车' : '未上车'}><button className="button text" onClick={async () => { try { await navigator.clipboard.writeText(`${p.name} · 演示号码 ${p.phone}`); setMessage('示例联系信息已复制，不会拨号。'); } catch { setMessage(`${p.name} · 示例号码 ${p.phone}，复制未获授权，请手动选择。`); } }}>复制示例联系</button>{enabled && !vehicle.legs[leg].departed && expected.some(person => person.signupId === p.signupId) && !(leg === 'outbound' ? p.outboundBoarded : p.returnBoarded) && <button className="button secondary" disabled={busy} onClick={() => void run({ type: 'attendance.board', activityId, signupId: p.signupId, leg, boarded: true, note: '本车联系人现场逐人清点' })}>确认上车</button>}</PersonRow>)}</ul>
    {enabled && <div className="form-actions"><button className="button primary" disabled={busy || !!vehicle.legs[leg].departed} onClick={() => void run({ type: 'vehicle.depart', activityId, vehicleId, leg, note: '本车清点后发车' })}>确认本程发车</button><button className="button secondary" disabled={busy || !vehicle.legs[leg].departed || !!vehicle.legs[leg].completed} onClick={() => void run({ type: 'vehicle.complete', activityId, vehicleId, leg, note: '本程行驶已完成' })}>完成本程行驶</button></div>}
    <p className="small muted">行驶完成不等于参与者安全到家；如有人未上车，请由现场负责人核实去向。</p>{message && <p role="status">{message}</p>}{error && <p role="alert" className="callout danger">{error.message}</p>}{success && <p role="status">{success}</p>}
  </section>;
}
