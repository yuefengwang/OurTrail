import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../app/useView';
import { useAppNavigation } from '../app/navigation';
import { FormField } from '../components/FormField';
import { PersonRow } from '../components/PersonRow';
import { StatusPanel } from '../components/StatusPanel';
import { Overlay } from '../components/Overlay';
import { Icon, TrailArt } from '../components/Icon';
import { getDetailState, type DetailState } from '../domain/selectors';
import type { ActivityView, Payload, PersonRowView, ReadRequest } from '../domain/contracts';
import type { IncidentRecord } from '../domain/model';

const statusLabels = { pending: '待审核', confirmed: '已确认', waitlisted: '候补中', rejected: '未通过', cancelled: '已取消', removed: '已移除' };
const states: Record<DetailState, [string, string]> = {
  new: ['让我们，一起出发', '阅读路线与风险提示，准备好后提交报名。'], pending: ['报名已收到', '组织者正在确认安排，审核结果会更新在这里。'],
  confirmed: ['已确认，等待分车', '你的名额已确认，车辆与座位安排随后更新。'], ready: ['行前安排已就绪', '检查集合时间、上车点与装备，出发当天见。'],
  gathering: ['到集合点了吗？', '到达后主动签到，让领队知道你已到场。'], checked: ['签到完成，等你同行', '签到不等于已上车，请留意现场清点与出发安排。'],
  active: ['山野之间，彼此照应', '按节点确认进度；需要帮助或提前退出，请主动报备。'], closing: ['最后一程，记得报平安', '安全到家后为自己确认；同行人需有独立代理授权。'],
  finished: ['一起走过，平安收尾', '活动已归档，安排仅供回看。'], waitlist: ['你在候补队列中', '有空余名额后由组织者递补；候补不占正式名额。'],
  closed: ['本次报名已关闭', '活动安排仍可查看，暂不能提交新的报名。'], cancelled: ['活动已取消', '不再执行行程；费用与退改请在线下向组织者确认。'],
};
const time = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '待确定';

export function ActivityDetail() {
  const { activityId = '' } = useParams();
  useRuntimeVersion();
  return <DetailContext key={`${runtime.getActor().userId}:${activityId}`} activityId={activityId} />;
}

function DetailContext({ activityId }: { activityId: string }) {
  const [query, setQuery] = useSearchParams();
  const selectedSignupId = query.get('signupId') || undefined;
  const request = useMemo<ReadRequest>(() => ({ kind: 'activity', activityId, perspective: 'participant', ...(selectedSignupId ? { selectedSignupId } : {}) }), [activityId, selectedSignupId]);
  const view = useView(request);
  const { go } = useAppNavigation();
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  useEffect(() => { if (view.kind === 'activity') runtime.rememberActivity(activityId); }, [activityId, view.kind]);
  if (view.kind !== 'activity') return <StatusPanel kind="denied" title="无法查看此活动" detail={view.kind === 'denied' ? view.message : '活动不可用。'} action={{ label: '回到我的活动', onClick: () => go('/') }} />;
  const { activity, counters } = view;
  const owner = activity.ownerId === runtime.getActor().userId;
  const isDraft = activity.phase === 'draft';
  const state = getDetailState(view, runtime.getNow());
  const primary = view.rows.find((row) => row.signupId === view.primarySignupId);
  const selected = view.rows.find((row) => row.signupId === sheetId);
  const choose = (id: string) => { const next = new URLSearchParams(query); next.set('signupId', id); setQuery(next, { replace: true }); };
  const share = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      const url = `${window.location.origin}${window.location.pathname}#/activities/${encodeURIComponent(activityId)}`;
      await navigator.clipboard.writeText(`${activity.title} · ${time(activity.startAt)}\n${url}`);
      setCopied('活动链接已复制。请自行选择发送对象。');
    } catch { setCopied('未能复制链接，浏览器未授予剪贴板权限。可以复制地址栏链接。'); }
  };
  return <>
    {isDraft && <div className="callout warning"><strong>未发布预览 · 仅你可见</strong><p>此预览不会发布活动，也不会替你报名。</p></div>}
    <section className="hero stack"><TrailArt /><div className="cluster"><span className="badge activity-card__status">{isDraft ? '草稿' : state === 'cancelled' ? '已取消' : state === 'finished' ? '已归档' : '一起同行'}</span><span className="small muted">{time(activity.startAt)}</span></div><h2 className="page-title">{activity.title || '未命名活动'}</h2><p className="muted">{activity.routeSnapshot.title || '路线待完善'}</p><div className="metrics"><div className="metric"><strong>{activity.routeSnapshot.distanceKm}<small>km</small></strong><span>路线里程</span></div><div className="metric"><strong>{activity.routeSnapshot.ascentM}<small>m</small></strong><span>累计爬升</span></div><div className="metric"><strong>{counters.confirmed}<small>/ {activity.capacity}</small></strong><span>已确认人数</span></div></div></section>
    {!isDraft && <section className={`callout ${['cancelled', 'closed', 'waitlist'].includes(state) ? 'warning' : 'success'}`}><h3>{states[state][0]}</h3><p>{states[state][1]}</p><p className="small">待审核 {counters.pending} 人 · 候补 {counters.waitlisted} 人 · 剩余 {counters.remaining} 个名额</p></section>}
    <div className="form-actions">{owner ? <button className="button primary" onClick={() => go(isDraft ? `/activities/${activityId}/edit` : `/activities/${activityId}/workspace`)}>{isDraft ? '返回编辑与发布' : '进入工作台'}<Icon name="arrow" size={18} /></button> : !isDraft && state === 'new' && view.permittedActions.includes('signup.submit') ? <button className="button primary" onClick={() => go(`/activities/${activityId}/signup`)}>填写报名资料</button> : primary?.status === 'confirmed' && ['gathering', 'checked', 'active', 'closing'].includes(state) ? <button className="button primary" onClick={() => setSheetId(primary.signupId)}>{state === 'gathering' ? '我已到达 · 去签到' : state === 'closing' ? '确认返程与到家' : '更新我的同行状态'}</button> : null}{!isDraft && <button className="button secondary" onClick={() => void share()}><Icon name="copy" size={18} />分享</button>}</div>
    {copied && <p role="status" className="small muted">{copied}</p>}
    {!isDraft && view.rows.length > 0 && <section><div className="card-header"><h3 className="section-title">我与同行人</h3><span className="small muted">每个人，独立确认</span></div><ul className="person-list">{view.rows.map((row) => <PersonRow key={row.signupId} name={row.name} status={statusLabels[row.status]} tone={row.status === 'confirmed' ? 'success' : 'neutral'} subtitle={[row.pickup, row.vehicle || (row.pickup !== '自行前往' ? '车辆待安排' : ''), row.seat ? `${row.seat} 座` : '', row.home ? '已安全到家' : row.checkedIn ? '已签到' : ''].filter(Boolean).join(' · ')}><button className={`button ${primary?.signupId === row.signupId ? 'secondary' : 'text'}`} aria-pressed={primary?.signupId === row.signupId} onClick={() => choose(row.signupId)}>{primary?.signupId === row.signupId ? '当前查看' : '切换查看'}</button><button className="button text" onClick={() => setSheetId(row.signupId)}>资料与操作<Icon name="arrow" size={16} /></button></PersonRow>)}</ul></section>}
    <section className="stack"><h3 className="section-title">这一次的安排</h3><p>{activity.description || '活动说明待补充。'}</p><dl><div className="list-row"><dt>出发时间</dt><dd>{time(activity.startAt)}</dd></div><div className="list-row"><dt>预计结束</dt><dd>{time(activity.endAt)}</dd></div><div className="list-row"><dt>报名截止</dt><dd>{time(activity.deadlineAt)}</dd></div></dl><p className="small muted">{activity.organizerIntro}</p></section>
    <section className="stack"><div className="card-header"><h3 className="section-title">路线与集合</h3><button className="button text" onClick={() => go(`/activities/${activityId}/weather`)}><Icon name="cloud" size={18} />天气参考</button></div><ol className="timeline">{activity.routeSnapshot.points.map((point, i) => <li className="timeline-item" key={point.id}><span className="eyebrow">{String(i + 1).padStart(2, '0')} · {point.kind === 'start' ? '起点' : point.kind === 'finish' ? '终点' : '途中节点'}</span><h3>{point.name}</h3></li>)}</ol>{activity.pickupPoints.map((p) => <div className="list-row" key={p.id}><span>{p.name}<small>{p.address}</small></span><span className="small">{time(p.meetingAt)}</span></div>)}</section>
    <section className="stack"><h3 className="section-title">风险提示</h3>{activity.routeSnapshot.risks.length ? activity.routeSnapshot.risks.map((risk) => <div className="callout warning" key={risk.id}><strong>{risk.title}</strong><p>{risk.advice}</p></div>) : <p className="muted">组织者尚未补充具体风险；户外活动存在天气与路况变化。</p>}</section>
    <section className="stack"><h3 className="section-title">出发前，检查装备</h3><div className="cluster">{activity.equipment.map((item, i) => <span key={`${i}-${item}`} className="badge neutral">{item}</span>)}</div></section>
    <section className="stack"><h3 className="section-title">费用与退出约定</h3><p>{activity.feeNote || '费用待组织者说明。'}</p><p className="muted">{activity.cancellationNote}</p><p className="small muted">OurTrail 不收款，不处理支付或退款。</p></section>
    {!isDraft && <button className="list-row" onClick={() => go(`/activities/${activityId}/notices`)}><span>活动通知<small>集合变更与最新安排</small></span><Icon name="arrow" /></button>}
    {selected && <PersonActions key={selected.signupId} view={view} row={selected} onClose={() => setSheetId(null)} />}
  </>;
}

function PersonActions({ view, row, onClose }: { view: ActivityView; row: PersonRowView; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [purpose, setPurpose] = useState('');
  const [showSensitive, setShowSensitive] = useState(false);
  const [consent, setConsent] = useState(false);
  const [pointId, setPointId] = useState('');
  const [kind, setKind] = useState<IncidentRecord['kind']>('other');
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const { run, busy } = useCommand();
  const { go } = useAppNavigation();
  useRuntimeVersion();
  const activityId = view.activity.id;
  const signupId = row.signupId;
  const point = view.activity.routeSnapshot.points.find((p) => p.id === pointId);
  const evidence = { at: runtime.getNow(), by: runtime.getActor().userId ?? '', note };
  const can = (payload: Payload) => runtime.can(payload).ok;
  const execute = async (payload: Payload, success: string) => { setFailure(''); setMessage(''); const result = await run(payload); if (result.ok) setMessage(success); else setFailure(result.error.message); };
  const checkin: Payload = { type: 'attendance.checkin', activityId, signupId, checkIn: { method: 'manual', evidence } };
  const home: Payload = { type: 'attendance.home', activityId, signupId, note };
  const revoke: Payload = { type: 'position.revoke', activityId, signupId };
  const cancel: Payload = { type: 'signup.cancel', activityId, signupIds: [signupId], reason: note };
  const sensitive = showSensitive ? runtime.readSensitive(activityId, signupId, purpose) : null;
  return <Overlay kind="sheet" open title={`${row.name} · 同行状态`} onClose={onClose}>
    <p><span className="badge neutral">{statusLabels[row.status]}</span> {row.pickup} {row.vehicle} {row.seat && `${row.seat}座`}</p>
    {message && <p role="status" className="callout success">{message}</p>}{failure && <p role="alert" className="callout danger">{failure}</p>}
    <FormField label="本次说明" hint="取消、异常与代理确认时请说明原因；操作只作用于当前这位参与人。"><textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></FormField>
    <div className="form-actions">{row.status === 'confirmed' && !row.checkedIn && view.permittedActions.includes('attendance.checkin') && can(checkin) && <button className="button primary" disabled={busy} onClick={() => void execute(checkin, '签到已保存。')}>确认已到集合点</button>}{view.activity.phase === 'closing' && row.status === 'confirmed' && row.departure === 'joined' && !row.home && can(home) && <button className="button primary" disabled={busy} onClick={() => void execute(home, '安全到家已记录。')}>确认已安全到家</button>}</div>
    {view.activity.phase === 'active' && row.status === 'confirmed' && <section className="stack"><FormField label="到达的路线节点"><select value={pointId} onChange={(e) => setPointId(e.target.value)}><option value="">请选择节点</option>{view.activity.routeSnapshot.points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField><button className="button secondary" disabled={busy || !pointId} onClick={() => void execute({ type: 'attendance.node', activityId, signupId, pointId, note }, '节点到达已保存。')}>确认到达此节点</button></section>}
    {['gathering', 'active'].includes(view.activity.phase) && row.status === 'confirmed' && <details><summary>模拟位置上报</summary><div className="stack"><p className="small muted">仅报告你明确选择的路线点坐标，不读取真实定位，不持续追踪。</p><FormField label="模拟所在路线点"><select value={pointId} onChange={(e) => setPointId(e.target.value)}><option value="">选择一个有坐标的点</option>{view.activity.routeSnapshot.points.filter((p) => p.coordinates).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField>{point?.coordinates && <p className="small muted">演示坐标 {point.coordinates.lat}, {point.coordinates.lng}</p>}<label className="check-label"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>同意为本次活动共享所选模拟位置，活动结束后失效</span></label><button className="button secondary" disabled={busy || !consent || !point?.coordinates} onClick={() => { if (point?.coordinates) void execute({ type: 'position.report', activityId, signupId, coordinates: point.coordinates, consent }, '本次模拟位置已保存。'); }}>上报选定的模拟位置</button>{can(revoke) && <button className="button text" disabled={busy} onClick={() => void execute(revoke, '位置共享已撤回。')}>撤回位置共享</button>}</div></details>}
    {['gathering', 'active', 'closing'].includes(view.activity.phase) && row.status === 'confirmed' && <details><summary>需要帮助 / 退出同行</summary><div className="stack"><FormField label="报备类型"><select value={kind} onChange={(e) => setKind(e.target.value as IncidentRecord['kind'])}><option value="other">其他需要协助</option><option value="late">迟到</option><option value="withdrawal">提前退出同行</option><option value="injury">伤病</option></select></FormField><p className="small muted">使用上方“本次说明”写明现状、去向与需要的帮助；报备不等于已完成安全收尾。</p><button className="button danger" disabled={busy || !note.trim()} onClick={() => void execute({ type: 'incident.report', activityId, signupIds: [signupId], kind, description: note }, '报备已保存，请主动联系现场负责人。')}>提交报备</button></div></details>}
    {view.activity.phase === 'published' && ['pending', 'confirmed', 'waitlisted'].includes(row.status) && <div className="form-actions"><button className="button secondary" onClick={() => go(`/activities/${activityId}/signup?signupId=${encodeURIComponent(signupId)}`)}>修改此人资料</button>{can(cancel) && <button className="button danger" disabled={busy || !note.trim()} onClick={() => void execute(cancel, '此人的报名已取消，其他同行人的状态未改变。')}>确认取消此人报名</button>}</div>}
    <details onToggle={(e) => { if (!e.currentTarget.open) setShowSensitive(false); }}><summary>查看必要安全联络资料</summary><div className="stack"><FormField label="查看用途"><input value={purpose} onChange={(e) => { setPurpose(e.target.value); setShowSensitive(false); }} placeholder="说明本次查看的必要用途" /></FormField><button className="button text" disabled={!purpose.trim()} onClick={() => setShowSensitive(true)}>按用途查看</button>{sensitive && (sensitive.ok ? <div className="callout"><p>紧急联系人：{sensitive.value.emergency.name}</p><p>演示号码：{sensitive.value.emergency.phone}</p><p>健康备注：{sensitive.value.medical || '未填写'}</p></div> : <p role="alert" className="callout warning">{sensitive.error.message}</p>)}</div></details>
  </Overlay>;
}
