import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../app/useView';
import { useAppNavigation } from '../app/navigation';
import { FormField } from '../components/FormField';
import { Icon } from '../components/Icon';
import { StatusPanel } from '../components/StatusPanel';
import { Overlay } from '../components/Overlay';
import type { ActivityInput, DomainError, ParticipantInput, ReadRequest } from '../domain/contracts';
import type { ActivityRecord, CoordinatesRecord, RoutePointRecord } from '../domain/model';

const emptyInput = (): ActivityInput => ({ title: '', description: '', organizerIntro: '', startAt: null, endAt: null, deadlineAt: null, acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null, routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, points: [], risks: [] }, pickupPoints: [], equipment: [], feeNote: '', cancellationNote: '' });
const localDate = (at: string | null) => at ? new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 16) : '';
const instant = (value: string) => value ? `${value}:00+08:00` : null;
const freshId = (kind: string) => `${kind}-${crypto.randomUUID()}`;
function inputFrom(activity: ActivityRecord): ActivityInput { const { id: _id, ownerId: _ownerId, phase: _phase, ...input } = activity; return input; }

export function ActivityEditor() {
  const { activityId } = useParams();
  useRuntimeVersion();
  return <EditorContext key={`${runtime.getActor().userId}:${activityId ?? 'new'}`} activityId={activityId} />;
}

function EditorContext({ activityId }: { activityId?: string }) {
  const request = useMemo<ReadRequest>(() => activityId ? { kind: 'activity', activityId, perspective: 'organizer' } : { kind: 'profile' }, [activityId]);
  const source = useView(request);
  if (source.kind === 'denied') return <StatusPanel kind="denied" title="无法编辑此活动" detail={source.message} />;
  if (activityId && source.kind !== 'activity') return <StatusPanel kind="denied" title="无法编辑此活动" detail="找不到对应活动。" />;
  if (source.kind === 'activity' && !source.permittedActions.includes('activity.edit')) return <StatusPanel kind="denied" title="活动已只读" detail="已结束或已取消的活动不能修改。可以从新建活动中复制自己的模板。" />;
  return <EditorForm activityId={activityId} initial={source.kind === 'activity' ? inputFrom(source.activity) : emptyInput()} phase={source.kind === 'activity' ? source.activity.phase : 'draft'} />;
}

function EditorForm({ activityId, initial, phase }: { activityId?: string; initial: ActivityInput; phase: ActivityRecord['phase'] }) {
  const draftId = activityId ?? 'new';
  const [input, setInput] = useState<ActivityInput>(() => runtime.getDraft<ActivityInput>(draftId, 'activity-editor') ?? initial);
  const [step, setStep] = useState(0);
  const [savedId, setSavedId] = useState(activityId ?? '');
  const [failure, setFailure] = useState<DomainError | null>(null);
  const [message, setMessage] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [participate, setParticipate] = useState(false);
  const [dataUse, setDataUse] = useState(false);
  const [tripPoint, setTripPoint] = useState('self');
  const [templateId, setTemplateId] = useState('');
  const { run, busy } = useCommand();
  const { go } = useAppNavigation();
  const profileRequest = useMemo<ReadRequest>(() => ({ kind: 'profile' }), []);
  const homeRequest = useMemo<ReadRequest>(() => ({ kind: 'home', perspective: 'organizer', openedActivityIds: [] }), []);
  const profile = useView(profileRequest);
  const home = useView(homeRequest);
  const update = (patch: Partial<ActivityInput>) => { const next = { ...input, ...patch }; setInput(next); runtime.setDraft(draftId, 'activity-editor', next); setMessage(''); };
  const route = (patch: Partial<ActivityInput['routeSnapshot']>) => update({ routeSnapshot: { ...input.routeSnapshot, ...patch } });
  const save = async (preview: boolean) => {
    setFailure(null); setMessage('');
    if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 500) { setStep(2); setFailure({ code: 'INVALID_INPUT', message: '人数上限请填写 1–500 的整数。' }); requestAnimationFrame(() => document.getElementById('activity-capacity')?.focus()); return; }
    const result = await run(savedId ? { type: 'activity.edit', activityId: savedId, input } : { type: 'activity.create', input });
    if (!result.ok) { setFailure(result.error); return; }
    const id = savedId || result.value.targetIds[0];
    if (!id) { setFailure({ code: 'NOT_FOUND', message: '保存响应未返回活动编号，未跳转或发布。' }); return; }
    setSavedId(id); runtime.clearDraft(draftId, 'activity-editor');
    setMessage(phase === 'draft' ? '草稿已保存，尚未发布，也没有自动报名。' : '活动修改已保存。');
    if (preview) go(`/activities/${id}?preview=1`);
  };
  const publish = async () => {
    if (!savedId) return;
    let participation: ParticipantInput | null = null;
    if (participate) {
      if (!dataUse || profile.kind !== 'profile') { setFailure({ code: 'CONSENT_REQUIRED', message: '本人参加需要独立确认资料使用授权。' }); return; }
      participation = { personRef: { kind: 'user', userId: profile.profile.id }, participant: profile.profile.person, trip: tripPoint === 'self' ? { mode: 'self' } : { mode: 'shared', pickupPointId: tripPoint }, consent: { dataUse, proxyAuthority: false, proxyHome: false } };
    }
    const result = await run({ type: 'activity.publish', activityId: savedId, participation });
    if (!result.ok) { setFailure(result.error); return; }
    runtime.clearDraft(draftId, 'activity-editor'); go(`/activities/${savedId}`);
  };
  const dateField = (key: 'startAt' | 'endAt' | 'deadlineAt', label: string) => <FormField key={key} label={label} hint="北京时间 UTC+08:00"><input type="datetime-local" value={localDate(input[key])} onChange={(e) => update({ [key]: instant(e.target.value) })} /></FormField>;
  const routePoint = (point: RoutePointRecord, index: number, patch: Partial<RoutePointRecord>) => route({ points: input.routeSnapshot.points.map((p, i) => i === index ? { ...point, ...patch } : p) });
  return <div className="stack">
    <header className="stack"><span className="eyebrow">{savedId ? '编辑活动' : '发起一次同行'}</span><h2 className="page-title">把出发，安排妥当。</h2><p className="muted">先保存想法，准备好后再发布。保存草稿不会自动报名。</p></header>
    <nav className="segmented" aria-label="活动编辑步骤">{['01 内容与时间', '02 路线与集合', '03 招募与风险'].map((label, index) => <button key={label} aria-pressed={step === index} onClick={() => setStep(index)}>{label}</button>)}</nav>
    {step === 0 && <section className="stack">
      {!savedId && home.kind === 'home' && home.activities.some((a) => a.ownerId === runtime.getActor().userId) && <details><summary>从我组织过的活动复制</summary><div className="stack"><FormField label="选择自己的活动模板"><select value={templateId} onChange={(e) => setTemplateId(e.target.value)}><option value="">请选择</option>{home.activities.filter((a) => a.ownerId === runtime.getActor().userId).map((a) => <option key={a.id} value={a.id}>{a.title || '未命名草稿'}</option>)}</select></FormField><p className="small muted">创建一份新的草稿；不复制报名人员、车辆、授权与通知。</p><button className="button secondary" disabled={!templateId || busy} onClick={async () => { const result = await run({ type: 'activity.copy', sourceActivityId: templateId }); if (!result.ok) setFailure(result.error); else if (result.value.targetIds[0]) go(`/activities/${result.value.targetIds[0]}/edit`); }}>创建模板副本并编辑</button></div></details>}
      <FormField label="活动名称"><input value={input.title} maxLength={100} placeholder="这次想去哪里？" onChange={(e) => update({ title: e.target.value })} /></FormField>
      <FormField label="活动介绍"><textarea value={input.description} maxLength={2000} placeholder="写下这次行程的节奏与适合人群" onChange={(e) => update({ description: e.target.value })} /></FormField>
      <FormField label="组织者与协作说明"><textarea value={input.organizerIntro} maxLength={2000} onChange={(e) => update({ organizerIntro: e.target.value })} /></FormField>
      {dateField('startAt', '出发时间')}{dateField('endAt', '预计结束时间')}{dateField('deadlineAt', '报名截止时间')}
    </section>}
    {step === 1 && <section className="stack">
      <FormField label="路线名称"><input value={input.routeSnapshot.title} onChange={(e) => route({ title: e.target.value })} /></FormField>
      <div className="form-actions"><FormField label="距离（km）"><input type="number" min="0" step="0.1" value={input.routeSnapshot.distanceKm} onChange={(e) => route({ distanceKm: Number(e.target.value) })} /></FormField><FormField label="爬升（m）"><input type="number" min="0" step="1" value={input.routeSnapshot.ascentM} onChange={(e) => route({ ascentM: Number(e.target.value) })} /></FormField></div>
      <div className="card-header"><h3>路线节点</h3>{input.routeSnapshot.points.length === 0 && <button className="button text" onClick={() => route({ title: '示例路线（请自行修改）', points: [{ id: freshId('point'), name: '示例起点', kind: 'start', coordinates: null }, { id: freshId('point'), name: '示例终点', kind: 'finish', coordinates: null }] })}>使用明确标注的示例路线</button>}</div>
      {input.routeSnapshot.points.map((point, index) => <fieldset key={point.id} className="stack"><legend>节点 {index + 1}</legend><FormField label="节点名称"><input value={point.name} onChange={(e) => routePoint(point, index, { name: e.target.value })} /></FormField><FormField label="节点类型"><select value={point.kind} onChange={(e) => routePoint(point, index, { kind: e.target.value as RoutePointRecord['kind'] })}><option value="start">起点</option><option value="checkpoint">途中节点</option><option value="finish">终点</option></select></FormField><CoordinateInputs value={point.coordinates} onChange={(coordinates) => routePoint(point, index, { coordinates })} /><button className="button text" onClick={() => route({ points: input.routeSnapshot.points.filter((p) => p.id !== point.id) })}>移除此节点</button></fieldset>)}
      <button className="button secondary" onClick={() => route({ points: [...input.routeSnapshot.points, { id: freshId('point'), name: '', kind: input.routeSnapshot.points.length ? 'checkpoint' : 'start', coordinates: null }] })}><Icon name="plus" size={18} />添加路线节点</button>
      <h3>集合与上车点</h3>{input.pickupPoints.map((point, index) => { const change = (patch: Partial<typeof point>) => update({ pickupPoints: input.pickupPoints.map((p, i) => i === index ? { ...p, ...patch } : p) }); return <fieldset key={point.id} className="stack"><legend>上车点 {index + 1}</legend><FormField label="上车点名称"><input value={point.name} onChange={(e) => change({ name: e.target.value })} /></FormField><FormField label="详细集合位置"><input value={point.address} onChange={(e) => change({ address: e.target.value })} /></FormField><FormField label="集合时间（北京时间）"><input type="datetime-local" value={localDate(point.meetingAt)} onChange={(e) => change({ meetingAt: instant(e.target.value) })} /></FormField><CoordinateInputs value={point.coordinates} onChange={(coordinates) => change({ coordinates })} /><button className="button text" onClick={() => update({ pickupPoints: input.pickupPoints.filter((p) => p.id !== point.id) })}>移除此上车点</button></fieldset>; })}
      <button className="button secondary" onClick={() => update({ pickupPoints: [...input.pickupPoints, { id: freshId('pickup'), name: '', address: '', meetingAt: null, coordinates: null }] })}><Icon name="plus" size={18} />添加上车点</button>
    </section>}
    {step === 2 && <section className="stack">
      <FormField id="activity-capacity" label="人数上限" hint="1–500 人，待审核与已确认人数都占用名额。"><input type="number" min="1" max="500" step="1" value={input.capacity} onChange={(e) => update({ capacity: Number(e.target.value) })} /></FormField>
      <FormField label="报名确认方式"><select value={input.approvalMode} onChange={(e) => update({ approvalMode: e.target.value as ActivityInput['approvalMode'] })}><option value="manual">组织者手动审核</option><option value="automatic">符合条件自动确认</option></select></FormField>
      <label className="check-label"><input type="checkbox" checked={input.acceptingSignups} onChange={(e) => update({ acceptingSignups: e.target.checked })} /><span>发布后开放报名</span></label>
      <h3>明确风险与应对方式</h3>{input.routeSnapshot.risks.map((risk, index) => <fieldset key={risk.id} className="stack"><legend>风险 {index + 1}</legend><FormField label="风险提示"><input value={risk.title} onChange={(e) => route({ risks: input.routeSnapshot.risks.map((r, i) => i === index ? { ...r, title: e.target.value } : r) })} /></FormField><FormField label="应对建议"><textarea value={risk.advice} onChange={(e) => route({ risks: input.routeSnapshot.risks.map((r, i) => i === index ? { ...r, advice: e.target.value } : r) })} /></FormField><button className="button text" onClick={() => route({ risks: input.routeSnapshot.risks.filter((r) => r.id !== risk.id) })}>移除此风险</button></fieldset>)}
      <button className="button secondary" onClick={() => route({ risks: [...input.routeSnapshot.risks, { id: freshId('risk'), title: '', advice: '' }] })}>添加风险提示</button>
      <FormField label="装备清单" hint="每行一项"><textarea value={input.equipment.join('\n')} onChange={(e) => update({ equipment: e.target.value.split('\n') })} /></FormField>
      <FormField label="费用说明" hint="仅说明费用，线下结算；不收款。"><textarea value={input.feeNote} onChange={(e) => update({ feeNote: e.target.value })} /></FormField><FormField label="取消与退出约定"><textarea value={input.cancellationNote} onChange={(e) => update({ cancellationNote: e.target.value })} /></FormField>
    </section>}
    {failure && <div role="alert" className="callout danger"><p>{failure.message}</p>{failure.fieldErrors && <ul>{Object.entries(failure.fieldErrors).map(([key, value]) => <li key={key}>{value}</li>)}</ul>}</div>}{message && <p role="status" className="callout success">{message}</p>}
    <div className="form-actions">{step > 0 && <button className="button text" onClick={() => setStep(step - 1)}>上一步</button>}{step < 2 && <button className="button primary" onClick={() => setStep(step + 1)}>下一步<Icon name="arrow" size={18} /></button>}</div>
    <div className="form-actions"><button className="button secondary" disabled={busy} onClick={() => void save(false)}>{phase === 'draft' ? '保存草稿' : '保存修改'}</button><button className="button secondary" disabled={busy} onClick={() => void save(true)}>保存并预览</button></div>
    {savedId && phase === 'draft' && <button className="button primary" disabled={busy || !message} onClick={() => { setFailure(null); setPublishOpen(true); }}>发布已保存的活动</button>}
    <Overlay kind="dialog" open={publishOpen} title="准备好发布了吗？" onClose={() => setPublishOpen(false)}><p>发布当前已保存的活动。报名、同行人和车辆不会自动创建。</p><label className="check-label"><input type="checkbox" checked={participate} onChange={(e) => { setParticipate(e.target.checked); setDataUse(false); }} /><span>我本人也参加本次活动（可选）</span></label>{participate && <><p className="small muted">使用当前账号资料：{profile.kind === 'profile' ? profile.profile.person.name : '资料不可用'}。请先在“我的”检查本人及紧急联络信息。</p><FormField label="本人出行方式"><select value={tripPoint} onChange={(e) => setTripPoint(e.target.value)}><option value="self">自行前往</option>{input.pickupPoints.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField><label className="check-label"><input type="checkbox" checked={dataUse} onChange={(e) => setDataUse(e.target.checked)} /><span>独立同意本次活动使用我的报名与安全联络资料</span></label></>}{failure && <p role="alert" className="callout danger">{failure.message}</p>}<button className="button primary" disabled={busy || (participate && !dataUse)} onClick={() => void publish()}>{participate ? '确认发布并为本人报名' : '只发布活动，不为本人报名'}</button></Overlay>
  </div>;
}

function CoordinateInputs({ value, onChange }: { value: CoordinatesRecord | null; onChange: (value: CoordinatesRecord | null) => void }) {
  const [lat, setLat] = useState(value ? String(value.lat) : '');
  const [lng, setLng] = useState(value ? String(value.lng) : '');
  const change = (latitude: string, longitude: string) => {
    setLat(latitude); setLng(longitude);
    const valid = latitude.trim() !== '' && longitude.trim() !== '' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;
    onChange(valid ? { lat: Number(latitude), lng: Number(longitude) } : null);
  };
  return <details><summary>可选坐标</summary><div className="stack"><p className="small muted">只填写已核实坐标。两项完整且有效时才保存；留空则不设置位置。</p><FormField label="纬度"><input type="number" step="any" min="-90" max="90" value={lat} onChange={(e) => change(e.target.value, lng)} /></FormField><FormField label="经度"><input type="number" step="any" min="-180" max="180" value={lng} onChange={(e) => change(lat, e.target.value)} /></FormField>{(lat || lng) && !value && <p className="field-error">坐标未完整或超出范围，本点将不保存坐标。</p>}</div></details>;
}
