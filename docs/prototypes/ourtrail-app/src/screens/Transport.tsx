import { Fragment, useMemo, useState } from 'react';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../app/useView';
import { FormField } from '../components/FormField';
import { StatusPanel } from '../components/StatusPanel';
import { Overlay } from '../components/Overlay';
import { Icon } from '../components/Icon';
import type { AssignmentPreview, Payload, PersonRowView, ReadRequest, VehicleInput } from '../domain/contracts';
import type { ActivityRecord, DriverRecord, VehicleRecord } from '../domain/model';

const reasonLabels = { no_vehicle: '尚无可用车辆', pickup_mismatch: '上车点不匹配', group_too_large: '整组人数超过可用容量', no_seat: '可用座位不足' };
const usable = (vehicle: Pick<VehicleRecord, 'legalCapacity' | 'drivers' | 'blockedSeats'>) => vehicle.legalCapacity - vehicle.drivers.length - vehicle.blockedSeats;

export function Transport({ activityId }: { activityId: string }) {
  useRuntimeVersion();
  return <TransportContext key={`${activityId}:${runtime.getActor().userId}`} activityId={activityId} />;
}

function TransportContext({ activityId }: { activityId: string }) {
  useRuntimeVersion();
  const request = useMemo<ReadRequest>(() => ({ kind: 'activity', activityId, perspective: 'organizer' }), [activityId]);
  const view = useView(request);
  const transport = runtime.readTransport(activityId);
  const { run, busy } = useCommand();
  const [editor, setEditor] = useState<{ vehicleId: string | null } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [plan, setPlan] = useState<AssignmentPreview | null>(null);
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState('');
  const [target, setTarget] = useState<{ vehicleId: string; seatLabel: string | null } | null>(null);
  const [signupId, setSignupId] = useState('');
  const [swapId, setSwapId] = useState('');
  if (view.kind !== 'activity' || !transport.ok) return <StatusPanel kind="denied" title="无法管理车辆安排" detail={!transport.ok ? transport.error.message : view.kind === 'denied' ? view.message : '仅活动组织者可调整分车。'} />;
  const { vehicles, assignments, groups } = transport.value;
  const editable = view.permittedActions.includes('vehicle.save');
  const confirmed = view.rows.filter((row) => row.status === 'confirmed');
  const name = (id: string) => view.rows.find((row) => row.signupId === id)?.name ?? '不可见参与人';
  const label = (id: string) => vehicles.find((vehicle) => vehicle.id === id)?.label ?? '车辆已变更';
  const execute = async (payload: Payload, message: string) => { setFailure(''); setSuccess(''); const result = await run(payload); if (!result.ok) setFailure(result.error.message); else setSuccess(message); return result; };
  const preview = () => { setFailure(''); const result = runtime.previewAssignments(activityId); if (!result.ok) setFailure(result.error.message); else setPlan(result.value); };
  const changed = plan?.assignments.filter((next) => !assignments.some((current) => current.signupId === next.signupId && current.vehicleId === next.vehicleId && current.seatLabel === next.seatLabel)) ?? [];
  const removed = plan ? assignments.filter((current) => !plan.assignments.some((next) => next.signupId === current.signupId)) : [];
  const assignedPerson = assignments.find((assignment) => assignment.signupId === signupId);
  const openSeat = (vehicleId: string, seatLabel: string | null, occupant = '') => { setTarget({ vehicleId, seatLabel }); setSignupId(occupant); setSwapId(''); setFailure(''); };
  return <section className="stack">
    <div className="card-header"><h3 className="section-title">先看容量，再安排同行</h3>{editable && <button className="button text" onClick={() => setEditor({ vehicleId: null })}><Icon name="plus" size={18} />添加车辆</button>}</div>
    <div className="metrics"><div className="metric"><strong>{vehicles.length}</strong><span>辆车</span></div><div className="metric"><strong>{vehicles.reduce((sum, vehicle) => sum + usable(vehicle), 0)}</strong><span>可分配乘客位</span></div><div className="metric"><strong>{view.counters.unassigned}</strong><span>待安排乘客</span></div></div>
    <p className="small muted">可用乘客位 = 核载人数 − 司机人数 − 预留 / 禁用座位。参与者司机已计入司机，不再重复占乘客位。</p>
    {failure && <p role="alert" className="callout danger">{failure}</p>}{success && <p role="status" className="callout success">{success}</p>}
    {editable && <button className="button primary" disabled={busy} onClick={preview}>预览自动分车方案<Icon name="arrow" size={18} /></button>}
    {!vehicles.length && <StatusPanel kind="empty" title="还没有车辆安排" detail="先添加车辆、司机和覆盖的上车点，再预览分车。" />}
    {vehicles.map((vehicle) => {
      const passengers = assignments.filter((assignment) => assignment.vehicleId === vehicle.id);
      return <section className="stack" key={vehicle.id}><div className="card-header"><h3>{vehicle.label}</h3><span className="badge neutral">{passengers.length} / {usable(vehicle)} 乘客</span></div><p className="small muted">{vehicle.plate} · 核载 {vehicle.legalCapacity} − 司机 {vehicle.drivers.length} − 预留 {vehicle.blockedSeats} = {usable(vehicle)} 位</p><p className="small muted">司机：{vehicle.drivers.map((driver) => driver.kind === 'service' ? driver.name : name(driver.signupId)).join('、')}<br />上车点：{vehicle.pickupPointIds.map((id) => view.activity.pickupPoints.find((p) => p.id === id)?.name ?? '上车点已变更').join('、') || '尚未设置'}</p>
        {vehicle.seatLabels ? <div><p className="eyebrow">座位示意 · 点选座位安排人员</p><div className="seat-grid">{vehicle.seatLabels.map((seat, index) => {
          const occupant = passengers.find((assignment) => assignment.seatLabel === seat);
          return <Fragment key={seat}>{index % 4 === 2 && <span aria-hidden="true" />}<button className={`seat ${occupant ? 'occupied' : ''}`} disabled={!editable} aria-label={`${vehicle.label} ${seat}座 ${occupant ? name(occupant.signupId) : '空位'}，调整安排`} onClick={() => openSeat(vehicle.id, seat, occupant?.signupId)}><strong>{seat}</strong><span>{occupant ? name(occupant.signupId) : '空位'}</span></button></Fragment>;
        })}</div></div> : <div>{passengers.map((assignment) => <button key={assignment.signupId} className="list-row" disabled={!editable} onClick={() => openSeat(vehicle.id, null, assignment.signupId)}><span>{name(assignment.signupId)}<small>不编座号 · {view.rows.find((r) => r.signupId === assignment.signupId)?.pickup}</small></span><Icon name="arrow" size={16} /></button>)}{editable && <button className="button secondary" onClick={() => openSeat(vehicle.id, null)}>安排乘客至此车</button>}</div>}
        {editable && <div className="form-actions"><button className="button text" onClick={() => setEditor({ vehicleId: vehicle.id })}>编辑车辆与司机</button><button className="button text" onClick={() => { setRemoveId(vehicle.id); setFailure(''); }}>删除车辆</button></div>}<hr className="divider" />
      </section>;
    })}
    {groups.some((group) => group.keepTogether && group.signupIds.length > 1) && <section><h3 className="section-title">同车约束</h3>{groups.filter((group) => group.keepTogether && group.signupIds.length > 1).map((group) => <p key={group.id} className="list-row">{group.signupIds.map(name).join('、')} · 整组同车</p>)}</section>}
    <Overlay kind="sheet" open={plan !== null} title="分车方案预览" onClose={() => setPlan(null)}>{plan && <><p className="callout">仅预览，尚未修改。基于版本 {plan.baseRevision}；提交前仍会核对容量、上车点与同车约束。</p><div className="metrics"><div className="metric"><strong>{changed.length}</strong><span>新增 / 调整</span></div><div className="metric"><strong>{removed.length}</strong><span>移除安排</span></div><div className="metric"><strong>{plan.unassigned.length}</strong><span>未能安排</span></div></div>{changed.map((assignment) => { const previous = assignments.find((a) => a.signupId === assignment.signupId); return <div className="list-row" key={assignment.signupId}><span>{name(assignment.signupId)}<small>{previous ? `${label(previous.vehicleId)} ${previous.seatLabel ?? ''}` : '未安排'} → {label(assignment.vehicleId)} {assignment.seatLabel ? `${assignment.seatLabel}座` : '不编座号'}</small></span></div>; })}{removed.map((assignment) => <p key={assignment.signupId} className="callout warning">移除：{name(assignment.signupId)} · {label(assignment.vehicleId)}</p>)}{plan.unassigned.map((item) => <p key={item.signupId} className="callout warning">{name(item.signupId)}：{reasonLabels[item.reason]}</p>)}{failure && <p role="alert" className="callout danger">{failure}</p>}<button className="button primary" disabled={busy} onClick={async () => { const result = await execute({ type: 'assignment.commit', activityId, preview: plan }, '分车方案已保存。'); if (result.ok) setPlan(null); }}>明确确认并提交此方案</button><button className="button secondary" disabled={busy} onClick={preview}>按最新状态重新计算</button></>}</Overlay>
    <Overlay kind="sheet" open={target !== null} title="手动调整人员安排" onClose={() => setTarget(null)}>{target && <><p>{label(target.vehicleId)} · {target.seatLabel ? `${target.seatLabel}座` : '不编座号'}</p><FormField label="选择参与人"><select value={signupId} onChange={(e) => setSignupId(e.target.value)}><option value="">请选择已确认人员</option>{confirmed.map((row) => <option key={row.signupId} value={row.signupId}>{row.name} · {row.pickup} · {row.vehicle || '未分车'}</option>)}</select></FormField><p className="small muted">同车组与上车点仍受检查；不会因为手动安排跳过约束。</p>{failure && <p role="alert" className="callout danger">{failure}</p>}<button className="button primary" disabled={busy || !signupId} onClick={async () => { const result = await execute({ type: 'assignment.set', activityId, target: { signupId, vehicleId: target.vehicleId, seatLabel: target.seatLabel } }, '此人的车辆安排已保存。'); if (result.ok) setTarget(null); }}>确认安排至此座位 / 车辆</button>{assignedPerson && <><button className="button text" disabled={busy} onClick={async () => { const result = await execute({ type: 'assignment.remove', activityId, signupId }, '已移除此人的车辆安排。'); if (result.ok) setTarget(null); }}>移除此人原有安排</button><FormField label="与另一位已分车人员交换"><select value={swapId} onChange={(e) => setSwapId(e.target.value)}><option value="">请选择交换对象</option>{assignments.filter((a) => a.signupId !== signupId).map((a) => <option key={a.signupId} value={a.signupId}>{name(a.signupId)} · {label(a.vehicleId)} {a.seatLabel}</option>)}</select></FormField><button className="button secondary" disabled={busy || !swapId} onClick={async () => { const result = await execute({ type: 'assignment.swap', activityId, firstSignupId: signupId, secondSignupId: swapId }, '两人的车辆座位已交换。'); if (result.ok) setTarget(null); }}>确认交换两人安排</button></>}</>}</Overlay>
    <Overlay kind="dialog" open={removeId !== null} title="确认删除车辆" onClose={() => setRemoveId(null)}><p>删除 {removeId ? label(removeId) : ''}。如有人员安排、司机或任务关联不允许删除，系统会保留原安排并说明原因。</p>{failure && <p role="alert" className="callout danger">{failure}</p>}<button className="button danger" disabled={busy} onClick={async () => { if (!removeId) return; const result = await execute({ type: 'vehicle.remove', activityId, vehicleId: removeId }, '车辆已删除。'); if (result.ok) setRemoveId(null); }}>确认删除此车</button></Overlay>
    {editor && <VehicleEditor activity={view.activity} rows={confirmed} vehicle={vehicles.find((v) => v.id === editor.vehicleId)} onClose={() => setEditor(null)} />}
  </section>;
}

function VehicleEditor({ activity, rows, vehicle, onClose }: { activity: ActivityRecord; rows: PersonRowView[]; vehicle?: VehicleRecord; onClose: () => void }) {
  const formKey = `vehicle-${vehicle?.id ?? 'new'}`;
  const initial: VehicleInput = vehicle ? { label: vehicle.label, plate: vehicle.plate, legalCapacity: vehicle.legalCapacity, blockedSeats: vehicle.blockedSeats, drivers: vehicle.drivers, seatLabels: vehicle.seatLabels, pickupPointIds: vehicle.pickupPointIds } : { label: '', plate: '', legalCapacity: 7, blockedSeats: 0, drivers: [], seatLabels: null, pickupPointIds: [] };
  const [input, setInput] = useState<VehicleInput>(() => runtime.getDraft<VehicleInput>(activity.id, formKey) ?? initial);
  const [failure, setFailure] = useState('');
  const { run, busy } = useCommand();
  const update = (patch: Partial<VehicleInput>) => { const next = { ...input, ...patch }; setInput(next); runtime.setDraft(activity.id, formKey, next); };
  const updateDriver = (index: number, driver: DriverRecord) => update({ drivers: input.drivers.map((d, i) => i === index ? driver : d) });
  return <Overlay kind="sheet" open title={vehicle ? '编辑车辆与司机' : '添加车辆'} onClose={onClose}>
    <FormField label="车辆名称"><input value={input.label} placeholder="例如：1号车" onChange={(e) => update({ label: e.target.value })} /></FormField><FormField label="车牌 / 演示标记"><input value={input.plate} onChange={(e) => update({ plate: e.target.value })} /></FormField>
    <FormField label="核载人数（含司机）"><input type="number" min="1" max="60" step="1" value={input.legalCapacity} onChange={(e) => update({ legalCapacity: Number(e.target.value) })} /></FormField><FormField label="预留 / 禁用座位数"><input type="number" min="0" max="60" step="1" value={input.blockedSeats} onChange={(e) => update({ blockedSeats: Number(e.target.value) })} /></FormField><p className="callout">{input.legalCapacity} 核载 − {input.drivers.length} 位司机 − {input.blockedSeats} 预留 = <strong>{usable(input)} 个乘客位</strong></p>
    <h3>司机名单</h3>{input.drivers.map((driver, index) => <fieldset key={index} className="stack"><legend>司机 {index + 1}</legend><FormField label="司机类型"><select value={driver.kind} onChange={(e) => updateDriver(index, e.target.value === 'service' ? { kind: 'service', name: '', phone: '', userId: null } : { kind: 'participant', signupId: '' })}><option value="service">服务司机，不占参与者名额</option><option value="participant">已确认参与者兼司机</option></select></FormField>{driver.kind === 'service' ? <><FormField label="司机姓名"><input value={driver.name} onChange={(e) => updateDriver(index, { ...driver, name: e.target.value })} /></FormField><FormField label="司机演示联系电话" hint="仅填写 000 开头的演示号码"><input inputMode="numeric" maxLength={11} value={driver.phone} onChange={(e) => updateDriver(index, { ...driver, phone: e.target.value })} /></FormField><FormField label="关联演示账号 ID（可选）"><input value={driver.userId ?? ''} onChange={(e) => updateDriver(index, { ...driver, userId: e.target.value || null })} /></FormField></> : <FormField label="选择参与者司机"><select value={driver.signupId} onChange={(e) => updateDriver(index, { kind: 'participant', signupId: e.target.value })}><option value="">请选择</option>{rows.map((row) => <option key={row.signupId} value={row.signupId}>{row.name}</option>)}</select></FormField>}<button className="button text" onClick={() => update({ drivers: input.drivers.filter((_, i) => i !== index) })}>移除此司机</button></fieldset>)}<button className="button secondary" onClick={() => update({ drivers: [...input.drivers, { kind: 'service', name: '', phone: '', userId: null }] })}>添加司机</button>
    <h3>覆盖的上车点</h3>{activity.pickupPoints.map((point) => <label className="check-label" key={point.id}><input type="checkbox" checked={input.pickupPointIds.includes(point.id)} onChange={(e) => update({ pickupPointIds: e.target.checked ? [...input.pickupPointIds, point.id] : input.pickupPointIds.filter((id) => id !== point.id) })} /><span>{point.name}</span></label>)}
    <label className="check-label"><input type="checkbox" checked={input.seatLabels !== null} onChange={(e) => update({ seatLabels: e.target.checked ? Array.from({ length: Math.max(0, Math.min(60, usable(input))) }, (_, i) => String(i + 1).padStart(2, '0')) : null })} /><span>使用明确座号（仅为可分配乘客位编号）</span></label>{input.seatLabels !== null && <FormField label="乘客座号" hint="用英文逗号分隔；数量应与可分配乘客位一致。"><input value={input.seatLabels.join(',')} onChange={(e) => update({ seatLabels: e.target.value.split(',').map((label) => label.trim()) })} /></FormField>}
    {failure && <p role="alert" className="callout danger">{failure}</p>}<button className="button primary" disabled={busy} onClick={async () => {
      if (!input.label.trim() || !Number.isInteger(input.legalCapacity) || input.legalCapacity < 1 || input.legalCapacity > 60 || !Number.isInteger(input.blockedSeats) || input.blockedSeats < 0 || usable(input) < 0 || !input.drivers.length || input.drivers.some((d) => d.kind === 'service' ? !d.name.trim() || !/^000\d{8}$/.test(d.phone) : !d.signupId)) { setFailure('请填写车辆名称、有效核载人数和完整司机信息；演示号码须为 000 开头的11位数字。'); return; }
      const result = await run({ type: 'vehicle.save', activityId: activity.id, vehicleId: vehicle?.id ?? null, input }); if (!result.ok) setFailure(result.error.message); else { runtime.clearDraft(activity.id, formKey); onClose(); }
    }}>保存车辆安排</button><p className="small muted">仅保存车辆资料，不重置已有去程与返程执行记录。</p>
  </Overlay>;
}
