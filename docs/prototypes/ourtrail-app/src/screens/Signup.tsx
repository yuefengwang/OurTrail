import { useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../app/useView';
import { useAppNavigation } from '../app/navigation';
import { FormField } from '../components/FormField';
import { StatusPanel } from '../components/StatusPanel';
import { Icon } from '../components/Icon';
import type { ActivityView, DomainError, ParticipantInput, ReadRequest } from '../domain/contracts';
import type { PersonRecord, ProfileRecord, Trip } from '../domain/model';

type Draft = { participants: ParticipantInput[]; keepTogether: boolean };
type Errors = Record<string, string>;
const noConsent = () => ({ dataUse: false, proxyAuthority: false, proxyHome: false });
const personKey = (input: ParticipantInput) => input.personRef.kind === 'user' ? input.personRef.userId : input.personRef.companionId;

function validatePerson(input: ParticipantInput, index: number, consentRequired: boolean): Errors {
  const errors: Errors = {};
  const prefix = `person-${index}-`;
  if (!input.participant.name.trim()) errors[`${prefix}name`] = '请填写姓名';
  if (!/^\d{11}$/.test(input.participant.phone)) errors[`${prefix}phone`] = '请填写11位演示联系电话';
  if (!input.participant.emergency.name.trim()) errors[`${prefix}emergency-name`] = '请填写紧急联系人';
  if (!/^\d{11}$/.test(input.participant.emergency.phone)) errors[`${prefix}emergency-phone`] = '请填写11位演示紧急联系电话';
  if (input.trip.mode === 'shared' && !input.trip.pickupPointId) errors[`${prefix}trip`] = '请选择上车点';
  if (consentRequired && !input.consent.dataUse) errors[`${prefix}dataUse`] = '请确认本次活动的数据使用授权';
  if (consentRequired && input.personRef.kind === 'companion' && !input.consent.proxyAuthority) errors[`${prefix}proxyAuthority`] = '代报名需要同行人明确授权';
  return errors;
}

function ParticipantFields({ input, index, activity, errors, editing, onChange }: {
  input: ParticipantInput; index: number; activity: ActivityView['activity']; errors: Errors;
  editing?: boolean; onChange: (input: ParticipantInput) => void;
}) {
  const prefix = `person-${index}-`;
  const person = input.participant;
  const update = (patch: Partial<PersonRecord>) => onChange({ ...input, participant: { ...person, ...patch } });
  const labels = { dataUse: '同意本次活动使用报名与安全联络资料', proxyAuthority: '已获同行人授权，代为报名和处理行程', proxyHome: '授权代为确认安全到家（可选，独立授权）' };
  return <div className="stack">
    <FormField id={`${prefix}name`} label="姓名" error={errors[`${prefix}name`]}><input autoComplete="off" maxLength={80} value={person.name} onChange={(e) => update({ name: e.target.value })} /></FormField>
    <FormField id={`${prefix}phone`} label="联系电话" hint="仅填写 000 开头的演示号码，不使用真实个人资料。" error={errors[`${prefix}phone`]}><input type="text" inputMode="numeric" maxLength={11} autoComplete="off" value={person.phone} onChange={(e) => update({ phone: e.target.value })} /></FormField>
    <FormField id={`${prefix}emergency-name`} label="紧急联系人" error={errors[`${prefix}emergency-name`]}><input autoComplete="off" maxLength={80} value={person.emergency.name} onChange={(e) => update({ emergency: { ...person.emergency, name: e.target.value } })} /></FormField>
    <FormField id={`${prefix}emergency-phone`} label="紧急联系电话" error={errors[`${prefix}emergency-phone`]}><input inputMode="numeric" maxLength={11} autoComplete="off" value={person.emergency.phone} onChange={(e) => update({ emergency: { ...person.emergency, phone: e.target.value } })} /></FormField>
    <FormField label="健康与用药备注" hint="可选，仅用于本次活动的必要安全协作。"><textarea maxLength={2000} value={person.medical} onChange={(e) => update({ medical: e.target.value })} /></FormField>
    <FormField id={`${prefix}trip`} label="出行方式 / 上车点" error={errors[`${prefix}trip`]}><select value={input.trip.mode === 'self' ? 'self' : input.trip.pickupPointId} onChange={(e) => onChange({ ...input, trip: e.target.value === 'self' ? { mode: 'self' } : { mode: 'shared', pickupPointId: e.target.value } })}>
      <option value="self">自行前往</option>{activity.pickupPoints.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></FormField>
    <div>
      {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => <div key={key}>
        <label className="check-label"><input id={`${prefix}${key}`} type="checkbox" checked={input.consent[key]} disabled={editing} aria-invalid={!!errors[`${prefix}${key}`]} onChange={(e) => onChange({ ...input, consent: { ...input.consent, [key]: e.target.checked } })} /><span>{labels[key]}</span></label>
        {errors[`${prefix}${key}`] && <p className="field-error">{errors[`${prefix}${key}`]}</p>}
      </div>)}
      {editing && <p className="small muted">原授权只读。修改资料不会追加或扩大同行人的授权。</p>}
    </div>
  </div>;
}

export function Signup() {
  const { activityId = '' } = useParams();
  const [query] = useSearchParams();
  useRuntimeVersion();
  const actor = runtime.getActor().userId;
  return <SignupContext key={`${actor}:${activityId}:${query.get('signupId') ?? ''}`} activityId={activityId} signupId={query.get('signupId')} />;
}

function SignupContext({ activityId, signupId }: { activityId: string; signupId: string | null }) {
  const request = useMemo<ReadRequest>(() => ({ kind: 'activity', activityId, perspective: 'participant' }), [activityId]);
  const profileRequest = useMemo<ReadRequest>(() => ({ kind: 'profile' }), []);
  const view = useView(request);
  const profile = useView(profileRequest);
  const { go } = useAppNavigation();
  if (view.kind !== 'activity') return <StatusPanel kind="denied" title="无法打开报名" detail={view.kind === 'denied' ? view.message : '活动信息不可用。'} action={{ label: '回到活动', onClick: () => go('/') }} />;
  if (profile.kind !== 'profile') return <StatusPanel kind="denied" title="请先选择账号" detail={profile.kind === 'denied' ? profile.message : '当前资料不可用。'} />;
  if (signupId) return <EditSignup activity={view} signupId={signupId} />;
  if (!view.permittedActions.includes('signup.submit')) return <StatusPanel kind="denied" title="当前无法报名" detail="活动尚未开放、已截止或没有报名权限。已有安排不会改变。" action={{ label: '查看活动安排', onClick: () => go(`/activities/${activityId}`) }} />;
  return <NewSignup activity={view} profile={profile.profile} />;
}

function NewSignup({ activity, profile }: { activity: ActivityView; profile: ProfileRecord }) {
  const activityId = activity.activity.id;
  const own: ParticipantInput = { personRef: { kind: 'user', userId: profile.id }, participant: profile.person, trip: { mode: 'self' }, consent: noConsent() };
  const [draft, setDraft] = useState<Draft>(() => runtime.getDraft<Draft>(activityId, 'signup') ?? { participants: [own], keepTogether: true });
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<DomainError | null>(null);
  const [capacity, setCapacity] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const { run, busy } = useCommand();
  const { go } = useAppNavigation();
  const update = (next: Draft) => { setDraft(next); runtime.setDraft(activityId, 'signup', next); setFailure(null); setCapacity(false); };
  const candidates: ParticipantInput[] = [own, ...profile.companions.map((companion): ParticipantInput => ({ personRef: { kind: 'companion', ownerId: profile.id, companionId: companion.id }, participant: companion.person, trip: { mode: 'self' }, consent: noConsent() }))];
  const submit = async (mode: 'apply' | 'waitlist') => {
    const nextErrors = Object.assign({}, ...draft.participants.map((input, index) => validatePerson(input, index, true))) as Errors;
    if (!draft.participants.length) nextErrors.selection = '请至少选择一位参与人';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { form.current?.querySelector<HTMLElement>(`[id="${Object.keys(nextErrors)[0]}"]`)?.focus(); return; }
    const result = await run({ type: 'signup.submit', activityId, participants: draft.participants, keepTogether: draft.keepTogether, mode });
    if (!result.ok) { setFailure(result.error); setCapacity(result.error.code === 'CAPACITY'); return; }
    runtime.clearDraft(activityId, 'signup');
    const updated = runtime.read({ kind: 'activity', activityId, perspective: 'participant' });
    const created = updated.kind === 'activity' ? updated.rows.find((row) => result.value.targetIds.includes(row.signupId)) : undefined;
    go(`/activities/${activityId}${created ? `?signupId=${encodeURIComponent(created.signupId)}` : ''}`);
  };
  return <form className="stack" ref={form} noValidate onSubmit={(e) => { e.preventDefault(); void submit('apply'); }}>
    <header className="stack"><span className="eyebrow">一起出发 · 报名资料</span><h2 className="page-title">这次，和谁同行？</h2><p className="muted">{activity.activity.title} · 还可申请 {activity.counters.remaining} 人。资料仅用于本次同行与安全联络。</p></header>
    <section><h3>选择参与人</h3>{candidates.map((input) => <label className="check-label" key={personKey(input)}><input type="checkbox" checked={draft.participants.some((p) => personKey(p) === personKey(input))} onChange={(e) => update({ ...draft, participants: e.target.checked ? [...draft.participants, input] : draft.participants.filter((p) => personKey(p) !== personKey(input)) })} /><span>{input.participant.name}<span className="small muted"> · {input.personRef.kind === 'user' ? '本人' : '同行人'}</span></span></label>)}{errors.selection && <p role="alert" className="field-error">{errors.selection}</p>}<button type="button" className="button text" onClick={() => go('/me')}>管理常用同行人 <Icon name="arrow" size={16} /></button></section>
    {draft.participants.map((input, index) => <section className="stack" key={personKey(input)} aria-label={`${input.participant.name || '参与人'}的报名资料`}><div className="card-header"><h3>{String(index + 1).padStart(2, '0')} / {input.personRef.kind === 'user' ? '我的资料' : '同行人资料'}</h3><span className="badge neutral">本次活动快照</span></div><ParticipantFields input={input} index={index} activity={activity.activity} errors={errors} onChange={(next) => update({ ...draft, participants: draft.participants.map((p, i) => i === index ? next : p) })} /><hr className="divider" /></section>)}
    <label className="check-label"><input type="checkbox" checked={draft.keepTogether} onChange={(e) => update({ ...draft, keepTogether: e.target.checked })} /><span>尽量安排同行人同车<span className="small muted" style={{ display: 'block' }}>整组安排；容量不足时不会静默拆组。</span></span></label>
    {failure && <div role="alert" className="callout danger">{failure.message}</div>}
    {capacity && <section className="callout warning stack"><h3>名额不足，是否整组候补？</h3><p>{draft.participants.length} 人将一起进入候补，不会自动占用正式名额。</p><button type="button" className="button secondary" disabled={busy} onClick={() => void submit('waitlist')}>明确同意整组候补</button></section>}
    <div className="form-actions"><button className="button primary" type="submit" disabled={busy}>{busy ? '正在提交…' : '提交报名'}</button></div><p className="small muted">{activity.activity.approvalMode === 'manual' ? '提交后等待组织者审核，以活动页状态为准。' : '符合条件时自动确认，以实际提交结果为准。'}</p>
  </form>;
}

function EditSignup({ activity, signupId }: { activity: ActivityView; signupId: string }) {
  useRuntimeVersion();
  const [purpose, setPurpose] = useState('');
  const [approvedPurpose, setApprovedPurpose] = useState('');
  // Store only user edits. The original sensitive projection is re-authorized on every render.
  const [patch, setPatch] = useState<Partial<Omit<PersonRecord, 'emergency'>> & { emergency?: Partial<PersonRecord['emergency']> }>({});
  const [trip, setTrip] = useState<Trip | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<DomainError | null>(null);
  const { run, busy } = useCommand();
  const { go } = useAppNavigation();
  const activityId = activity.activity.id;
  const source = approvedPurpose ? runtime.readSignupForm(activityId, signupId, approvedPurpose) : null;
  if (!source) return <section className="stack"><h2>修改一位参与人的资料</h2><p className="muted">资料包含紧急联络与健康备注。请说明本次读取、修改的必要用途。</p><FormField label="修改用途"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例如：本人更新本次上车点" /></FormField><button className="button primary" disabled={!purpose.trim()} onClick={() => setApprovedPurpose(purpose.trim())}>按此用途读取资料</button></section>;
  if (!source.ok) return <StatusPanel kind="denied" title="无法读取报名资料" detail={source.error.message} />;
  const original = source.value.input.participant;
  const input: ParticipantInput = { ...source.value.input, participant: { ...original, ...patch, emergency: { ...original.emergency, ...patch.emergency } }, trip: trip ?? source.value.input.trip };
  const updateEdits = (next: ParticipantInput) => {
    const edits: typeof patch = {};
    for (const key of ['name', 'phone', 'medical'] as const) if (next.participant[key] !== original[key]) edits[key] = next.participant[key];
    for (const key of ['name', 'phone'] as const) if (next.participant.emergency[key] !== original.emergency[key]) edits.emergency = { ...edits.emergency, [key]: next.participant.emergency[key] };
    setPatch(edits); setTrip(next.trip);
  };
  return <form className="stack" noValidate onSubmit={async (e) => {
    e.preventDefault();
    const nextErrors = validatePerson(input, 0, false); setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { requestAnimationFrame(() => document.getElementById(Object.keys(nextErrors)[0])?.focus()); return; }
    const result = await run({ type: 'signup.edit', activityId, signupId, participant: input.participant, trip: input.trip, purpose: approvedPurpose });
    if (!result.ok) setFailure(result.error); else go(`/activities/${activityId}?signupId=${encodeURIComponent(signupId)}`);
  }}><header><span className="eyebrow">仅修改选中的参与人</span><h2>{input.participant.name} · 报名资料</h2></header><p className="callout">用途：{approvedPurpose}</p><ParticipantFields input={input} index={0} activity={activity.activity} errors={errors} editing onChange={updateEdits} />{failure && <p role="alert" className="callout danger">{failure.message}</p>}<button type="submit" className="button primary" disabled={busy}>{busy ? '正在保存…' : '保存此人的修改'}</button></form>;
}
