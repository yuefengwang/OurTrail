import { useMemo, useState } from 'react';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../app/useView';
import { useAppNavigation } from '../app/navigation';
import { FormField } from '../components/FormField';
import { PersonRow } from '../components/PersonRow';
import { StatusPanel } from '../components/StatusPanel';
import { Overlay } from '../components/Overlay';
import { Icon } from '../components/Icon';
import type { Payload, ReadRequest } from '../domain/contracts';
import type { Capability, MembershipRecord } from '../domain/model';

const statusLabel = { pending: '待审核', confirmed: '已确认', waitlisted: '候补', rejected: '已拒绝', cancelled: '已取消', removed: '已移除' };
const capabilityLabels: Record<Capability, string> = { roster: '查看名单', checkin: '签到确认', node: '路线节点', incident: '异常处理', position: '查看位置', home: '到家确认', sensitive: '必要敏感资料' };
type BatchAction = 'confirm' | 'reject' | 'promote' | 'cancel';
const actionLabels: Record<BatchAction, string> = { confirm: '确认报名', reject: '拒绝报名', promote: '递补候补', cancel: '取消报名' };

export function Roster({ activityId }: { activityId: string }) {
  useRuntimeVersion();
  return <RosterContext key={`${activityId}:${runtime.getActor().userId}`} activityId={activityId} />;
}

function RosterContext({ activityId }: { activityId: string }) {
  useRuntimeVersion();
  const participant = runtime.read({ kind: 'activity', activityId, perspective: 'participant' });
  const owner = participant.kind === 'activity' && participant.activity.ownerId === runtime.getActor().userId;
  const request = useMemo<ReadRequest>(() => ({ kind: 'activity', activityId, perspective: owner ? 'organizer' : 'staff' }), [activityId, owner]);
  const view = useView(request);
  const { go } = useAppNavigation();
  const { run, busy } = useCommand();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [batch, setBatch] = useState<BatchAction | null>(null);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState('');
  const [personId, setPersonId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('');
  const [sensitiveRequest, setSensitiveRequest] = useState<{ signupId: string; purpose: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'ordinary' | 'sensitive'>('ordinary');
  const [exportPurpose, setExportPurpose] = useState('');
  const [accessOpen, setAccessOpen] = useState(false);
  if (view.kind !== 'activity') return <StatusPanel kind="denied" title="无法查看名单" detail={view.kind === 'denied' ? view.message : '当前没有名单访问权限。'} />;
  const transport = runtime.readTransport(activityId);
  const rows = view.rows.filter((row) => (status === 'all' || row.status === status) && `${row.name} ${row.pickup} ${row.vehicle}`.includes(search));
  const selectedRows = view.rows.filter((row) => selected.includes(row.signupId));
  const selection = selectedRows.map((row) => row.signupId);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const execute = async (payload: Payload, message: string) => { setFailure(''); setSuccess(''); const result = await run(payload); if (!result.ok) setFailure(result.error.message); else setSuccess(message); return result; };
  const person = view.rows.find((row) => row.signupId === personId);
  const contact = person ? runtime.readContact(activityId, person.signupId) : null;
  // Never retain the returned projection, only the requested ID and purpose.
  const sensitive = sensitiveRequest && sensitiveRequest.signupId === personId ? runtime.readSensitive(activityId, sensitiveRequest.signupId, sensitiveRequest.purpose) : null;
  const download = async () => {
    const actorId = runtime.getActor().userId;
    const ids = [...selection];
    const mode = exportMode;
    const purpose = exportPurpose.trim();
    const audit = await execute({ type: 'export.record', activityId, signupIds: ids, mode, purpose }, '导出审计已记录。');
    if (!audit.ok || actorId !== runtime.getActor().userId) return;
    const csv = runtime.readExport(activityId, ids, mode, purpose);
    if (!csv.ok) { setFailure(csv.error.message); return; }
    try {
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv.value], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `ourtrail-${activityId}-${mode}.csv`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSuccess(`已生成 ${ids.length} 人的${mode === 'ordinary' ? '普通' : '敏感'}名单并请求浏览器下载。`); setExportOpen(false);
    } catch { setFailure('审计已保存，但浏览器未能创建下载文件。请检查下载权限后重试。'); }
  };
  return <section className="stack">
    <div className="card-header"><h3 className="section-title">参与人名单</h3>{owner && <button className="button text" onClick={() => setAccessOpen(true)}><Icon name="shield" size={16} />协作授权</button>}</div>
    <p className="small muted">已确认 {view.counters.confirmed} · 待审核 {view.counters.pending} · 候补 {view.counters.waitlisted}。仅显示你有权查看的人员。</p>
    <FormField label="搜索名单"><input type="search" value={search} placeholder="姓名、上车点或车辆" onChange={(e) => setSearch(e.target.value)} /></FormField>
    <FormField label="报名状态"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">全部状态</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
    {failure && <p role="alert" className="callout danger">{failure}</p>}{success && <p role="status" className="callout success">{success}</p>}
    <div className="card-header"><label className="check-label"><input type="checkbox" checked={rows.length > 0 && rows.every((row) => selected.includes(row.signupId))} onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...rows.map((row) => row.signupId)])] : selected.filter((id) => !rows.some((row) => row.signupId === id)))} /><span>选择当前结果</span></label><span className="small muted">已选 {selection.length} 人</span></div>
    {rows.length ? <ul className="person-list">{rows.map((row) => <PersonRow key={row.signupId} name={row.name} status={statusLabel[row.status]} tone={row.status === 'confirmed' ? 'success' : row.status === 'pending' ? 'warning' : 'neutral'} subtitle={[row.pickup, row.vehicle || '未分车', row.seat ? `${row.seat}座` : '', row.checkedIn ? '已签到' : '', row.home ? '已到家' : ''].filter(Boolean).join(' · ')}><label className="check-label"><input type="checkbox" aria-label={`选择${row.name}`} checked={selected.includes(row.signupId)} onChange={() => toggle(row.signupId)} /><span>选择</span></label><button className="button text" onClick={() => { setPersonId(row.signupId); setPurpose(''); setSensitiveRequest(null); }}>联络与资料</button></PersonRow>)}</ul> : <StatusPanel kind="empty" title="没有匹配的参与人" detail="尝试其他姓名或报名状态。" />}
    {owner && <section className="stack"><div className="form-actions">{(['confirm', 'reject', 'promote', 'cancel'] as BatchAction[]).map((action) => <button className={`button ${action === 'confirm' ? 'primary' : 'secondary'}`} key={action} disabled={!selection.length || busy || !view.permittedActions.includes(action === 'promote' ? 'signup.promote' : action === 'cancel' ? 'signup.cancel' : 'signup.review')} onClick={() => { setBatch(action); setFailure(''); setReason(''); }}>{actionLabels[action]}</button>)}</div><button className="button text" disabled={!selection.length || busy} onClick={() => { setFailure(''); setExportOpen(true); }}><Icon name="download" size={18} />导出选中的 {selection.length} 人</button></section>}
    {owner && transport.ok && transport.value.groups.some((g) => g.signupIds.length > 1) && <details><summary>同行组与同车约束</summary>{transport.value.groups.filter((g) => g.signupIds.length > 1).map((group) => <div key={group.id} className="list-row"><span>{view.rows.filter((r) => group.signupIds.includes(r.signupId)).map((r) => r.name).join('、')}<small>{group.keepTogether ? '整组同车，不允许自动拆分' : '允许分开安排'}</small></span><button className="button text" disabled={busy || !view.permittedActions.includes('group.setTogether')} onClick={() => void execute({ type: 'group.setTogether', activityId, groupId: group.id, keepTogether: !group.keepTogether }, '同行组约束已保存。')}>{group.keepTogether ? '允许分车' : '保持同车'}</button></div>)}</details>}
    <Overlay kind="dialog" open={batch !== null} title={batch ? `${actionLabels[batch]} · ${selection.length} 人` : '确认名单操作'} onClose={() => setBatch(null)}><p>仅处理以下明确选中的人员。同行组约束若不满足，本次操作将整体失败。</p><p>{selectedRows.map((row) => row.name).join('、')}</p>{batch === 'cancel' && <FormField label="取消原因"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>}{failure && <p role="alert" className="callout danger">{failure}</p>}<button className="button primary" disabled={busy || !selection.length || (batch === 'cancel' && !reason.trim())} onClick={async () => { if (!batch) return; const payload: Payload = batch === 'promote' ? { type: 'signup.promote', activityId, signupIds: selection } : batch === 'cancel' ? { type: 'signup.cancel', activityId, signupIds: selection, reason } : { type: 'signup.review', activityId, signupIds: selection, decision: batch }; const result = await execute(payload, `${actionLabels[batch]}已保存。`); if (result.ok) { setBatch(null); setSelected([]); } }}>确认仅处理这 {selection.length} 人</button></Overlay>
    <Overlay kind="sheet" open={personId !== null} title={person ? `${person.name} · 联络资料` : '联络资料'} onClose={() => { setPersonId(null); setSensitiveRequest(null); setPurpose(''); }}>{contact && (contact.ok ? <p>演示联系电话：{contact.value.phone}</p> : <p className="callout warning">{contact.error.message}</p>)}<FormField label="必要的查看用途"><input value={purpose} placeholder="例如：核实伤病后的紧急联络" onChange={(e) => { setPurpose(e.target.value); setSensitiveRequest(null); }} /></FormField><button className="button secondary" disabled={!purpose.trim() || !person} onClick={() => { if (person) setSensitiveRequest({ signupId: person.signupId, purpose: purpose.trim() }); }}>查看紧急联络与健康备注</button>{sensitive && (sensitive.ok ? <div className="callout"><p>紧急联系人：{sensitive.value.emergency.name}</p><p>演示号码：{sensitive.value.emergency.phone}</p><p>健康备注：{sensitive.value.medical || '未填写'}</p></div> : <p role="alert" className="callout warning">{sensitive.error.message}</p>)}{person && owner && view.permittedActions.includes('signup.edit') && <button className="button text" onClick={() => go(`/activities/${activityId}/signup?signupId=${encodeURIComponent(person.signupId)}`)}>按用途修改此人的报名资料</button>}</Overlay>
    <Overlay kind="dialog" open={exportOpen} title="确认导出范围" onClose={() => setExportOpen(false)}><p>选中 {selection.length} 人：{selectedRows.map((row) => row.name).join('、')}</p><FormField label="导出内容"><select value={exportMode} onChange={(e) => setExportMode(e.target.value as typeof exportMode)}><option value="ordinary">普通名单 · 不含电话和健康资料</option><option value="sensitive">敏感名单 · 含紧急联络及健康备注</option></select></FormField><FormField label="导出用途"><textarea value={exportPurpose} onChange={(e) => setExportPurpose(e.target.value)} /></FormField><p className="small muted">先记录审计，再按当前权限重新生成 CSV。请妥善保存，不向无关人员转发。</p>{failure && <p role="alert" className="callout danger">{failure}</p>}<button className="button primary" disabled={busy || !selection.length || !exportPurpose.trim()} onClick={() => void download()}>确认用途并下载选中名单</button></Overlay>
    {accessOpen && <AccessManager activityId={activityId} selectedIds={selection} onClose={() => setAccessOpen(false)} />}
  </section>;
}

function AccessManager({ activityId, selectedIds, onClose }: { activityId: string; selectedIds: string[]; onClose: () => void }) {
  useRuntimeVersion();
  const access = runtime.readAccess(activityId);
  const transport = runtime.readTransport(activityId);
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [role, setRole] = useState<'staff' | 'vehicle_contact'>('staff');
  const [userId, setUserId] = useState('');
  const [expires, setExpires] = useState('');
  const [scope, setScope] = useState<'all' | 'selected'>('selected');
  const [scopeIds, setScopeIds] = useState(selectedIds);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const { run, busy } = useCommand();
  const edit = (membership: MembershipRecord) => {
    setMembershipId(membership.id); setRole(membership.role); setUserId(membership.userId); setExpires(new Date(Date.parse(membership.expiresAt) + 8 * 3600000).toISOString().slice(0, 16));
    if (membership.role === 'staff') { setCapabilities(membership.capabilities); setScope(membership.scope.kind); setScopeIds(membership.scope.kind === 'selected' ? membership.scope.signupIds : []); } else setVehicleId(membership.vehicleId);
  };
  return <Overlay kind="sheet" open title="协作授权" onClose={onClose}>{!access.ok ? <StatusPanel kind="denied" title="无法管理授权" detail={access.error.message} /> : <>
    <p className="small muted">授权限定人员范围、能力与有效期。到期自动失效，撤销后立即按新权限读取。</p>
    {access.value.memberships.map((membership) => <div className="list-row" key={membership.id}><span>{membership.userId}<small>{membership.role === 'staff' ? '现场协作' : '车辆联络'} · 截止 {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(membership.expiresAt))}</small></span><div className="cluster"><button className="button text" onClick={() => edit(membership)}>调整</button><button className="button text" disabled={busy} onClick={async () => { const result = await run({ type: 'membership.revoke', activityId, membershipId: membership.id }); if (!result.ok) setFailure(result.error.message); else setMessage('授权已撤销。'); }}>撤销授权</button></div></div>)}
    <h3>{membershipId ? '调整现有授权' : '添加授权'}</h3><FormField label="目标演示账号 ID" hint="输入已存在的演示账号，例如 u-staff 或 u-driver；不会创建真实账号。"><input value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="off" /></FormField><FormField label="协作角色"><select value={role} onChange={(e) => setRole(e.target.value as typeof role)}><option value="staff">现场协作</option><option value="vehicle_contact">车辆联络</option></select></FormField><FormField label="授权截止时间（北京时间）"><input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} /></FormField>
    {role === 'staff' ? <><FormField label="可见人员范围"><select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}><option value="selected">明确选中的人员（{scopeIds.length} 人）</option><option value="all">本活动全部人员</option></select></FormField><button className="button text" onClick={() => setScopeIds([...selectedIds])}>使用当前名单选择（{selectedIds.length} 人）</button><div>{(Object.keys(capabilityLabels) as Capability[]).map((capability) => <label key={capability} className="check-label"><input type="checkbox" checked={capabilities.includes(capability)} onChange={(e) => setCapabilities(e.target.checked ? [...capabilities, capability] : capabilities.filter((c) => c !== capability))} /><span>{capabilityLabels[capability]}</span></label>)}</div></> : <FormField label="负责车辆"><select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}><option value="">请选择车辆</option>{transport.ok && transport.value.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>)}</select></FormField>}
    {failure && <p role="alert" className="callout danger">{failure}</p>}{message && <p role="status" className="callout success">{message}</p>}
    <button className="button primary" disabled={busy || !userId.trim() || !expires || (role === 'staff' ? !capabilities.length || (scope === 'selected' && !scopeIds.length) : !vehicleId)} onClick={async () => { const common = { id: membershipId ?? `membership-${crypto.randomUUID()}`, activityId, userId: userId.trim(), expiresAt: `${expires}:00+08:00` }; const membership: MembershipRecord = role === 'staff' ? { ...common, role, capabilities, scope: scope === 'all' ? { kind: 'all' } : { kind: 'selected', signupIds: scopeIds } } : { ...common, role, vehicleId }; const result = await run({ type: 'membership.save', activityId, membership }); if (!result.ok) setFailure(result.error.message); else { setMembershipId(membership.id); setFailure(''); setMessage('授权已保存。'); } }}>保存明确授权</button><button className="button text" onClick={() => { setMembershipId(null); setUserId(''); setCapabilities([]); setScope('selected'); setScopeIds([...selectedIds]); setExpires(''); setVehicleId(''); }}>清空表单，新增另一份授权</button>
  </>}</Overlay>;
}
