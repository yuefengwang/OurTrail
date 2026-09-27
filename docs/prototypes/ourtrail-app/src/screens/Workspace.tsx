import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../app/useView';
import { useAppNavigation } from '../app/navigation';
import { FormField } from '../components/FormField';
import { StatusPanel } from '../components/StatusPanel';
import { Overlay } from '../components/Overlay';
import { Icon } from '../components/Icon';
import type { ActivityPhase } from '../domain/model';
import type { Perspective, ReadRequest } from '../domain/contracts';
import { Roster } from './Roster';
import { Transport } from './Transport';
import { Field } from './Field';

const phaseLabel: Record<ActivityPhase, string> = { draft: '草稿', published: '行前准备', gathering: '集合签到', active: '活动进行中', closing: '返程收尾', archived: '已归档', cancelled: '已取消' };
const nextPhase: Partial<Record<ActivityPhase, ActivityPhase>> = { published: 'gathering', gathering: 'active', active: 'closing', closing: 'archived' };

export function Workspace() {
  const { activityId = '' } = useParams();
  useRuntimeVersion();
  return <WorkspaceContext key={`${activityId}:${runtime.getActor().userId}:${runtime.getPerspective()}`} activityId={activityId} />;
}

function WorkspaceContext({ activityId }: { activityId: string }) {
  const [query, setQuery] = useSearchParams();
  const { go } = useAppNavigation();
  const base = runtime.read({ kind: 'activity', activityId, perspective: 'participant' });
  const owner = base.kind === 'activity' && base.activity.ownerId === runtime.getActor().userId;
  const staff = runtime.read({ kind: 'activity', activityId, perspective: 'staff' });
  const vehicle = runtime.read({ kind: 'activity', activityId, perspective: 'vehicle' });
  const perspective: Perspective = owner ? 'organizer' : runtime.getPerspective() === 'vehicle' && vehicle.kind === 'activity' ? 'vehicle' : staff.kind === 'activity' ? 'staff' : 'vehicle';
  const request = useMemo<ReadRequest>(() => ({ kind: 'activity', activityId, perspective }), [activityId, perspective]);
  const view = useView(request);
  const [transition, setTransition] = useState<ActivityPhase | null>(null);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState('');
  const { run, busy } = useCommand();
  const tab = query.get('tab') ?? 'overview';
  const navigateTab = (value: string) => { const next = new URLSearchParams(query); next.set('tab', value); setQuery(next); };
  if (view.kind !== 'activity') return <StatusPanel kind="denied" title="没有此工作台的访问权限" detail={view.kind === 'denied' ? view.message : '请检查活动编号和账号授权。'} action={{ label: '查看活动', onClick: () => go(`/activities/${activityId}`) }} />;
  const { counters, activity } = view;
  const next = nextPhase[activity.phase];
  return <>
    <header className="stack"><div className="card-header"><span className="eyebrow">{owner ? '组织者工作台' : perspective === 'staff' ? '现场协作任务' : '车辆联络任务'}</span><span className="badge success">{phaseLabel[activity.phase]}</span></div><h2 className="page-title">{activity.title}</h2><p className="muted">先处理需要你确认的事，再安心出发。</p></header>
    <section className="metrics" aria-label="当前需要关注"><div className="metric"><strong>{counters.pending}</strong><span>待审核</span></div><div className="metric"><strong>{counters.unassigned}</strong><span>待分车</span></div><div className="metric"><strong>{activity.phase === 'published' || activity.phase === 'gathering' ? counters.unchecked : counters.pendingHome}</strong><span>{activity.phase === 'published' || activity.phase === 'gathering' ? '待签到' : '待到家'}</span></div></section>
    <nav className="segmented" aria-label="工作台分区">{[['overview', '总览'], ['roster', '名单'], ...(owner ? [['transport', '分车']] : []), ['field', '现场']].map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => navigateTab(value)}>{label}</button>)}</nav>
    {tab === 'roster' ? <Roster activityId={activityId} /> : tab === 'transport' ? <Transport activityId={activityId} /> : tab === 'field' ? <Field activityId={activityId} perspective={perspective} /> : <section className="stack">
      {success && <p role="status" className="callout success">{success}</p>}
      <div><h3 className="section-title">当前待办</h3>{owner && <><button className="list-row" onClick={() => navigateTab('roster')}><span>确认报名与候补<small>{counters.pending} 人待审核 · {counters.waitlisted} 人候补</small></span><Icon name="arrow" size={18} /></button><button className="list-row" onClick={() => navigateTab('transport')}><span>检查车辆与人员安排<small>{counters.unassigned} 人尚未分车 · 不自动拆分同车组</small></span><Icon name="arrow" size={18} /></button></>}<button className="list-row" onClick={() => navigateTab('field')}><span>{perspective === 'vehicle' ? '本车人员与发车确认' : '现场清点与安全收尾'}<small>{counters.unchecked} 人待签到 · {counters.openIncidents} 项异常待处理 · {counters.pendingHome} 人待到家</small></span><Icon name="arrow" size={18} /></button><button className="list-row" onClick={() => go(`/activities/${activityId}/notices`)}><span>活动通知<small>发布安排，核对通知的实际状态</small></span><Icon name="arrow" size={18} /></button></div>
      {owner && <section className="stack"><h3 className="section-title">活动进程</h3><ol className="timeline">{(['published', 'gathering', 'active', 'closing', 'archived'] as ActivityPhase[]).map((phase) => <li key={phase} className="timeline-item"><span className={phase === activity.phase ? 'badge success' : 'small muted'}>{phaseLabel[phase]}{phase === activity.phase ? ' · 当前' : ''}</span></li>)}</ol>{activity.phase === 'draft' ? <button className="button primary" onClick={() => go(`/activities/${activityId}/edit`)}>完善草稿并发布</button> : next && <button className="button primary" onClick={() => { setTransition(next); setFailure(''); setReason(''); }}>进入{phaseLabel[next]}</button>}{!['archived', 'cancelled'].includes(activity.phase) && <div className="form-actions"><button className="button text" onClick={() => go(`/activities/${activityId}/edit`)}>编辑活动</button><button className="button text" onClick={() => { setTransition('cancelled'); setFailure(''); setReason(''); }}>取消活动</button></div>}</section>}
      <button className="button secondary" onClick={() => go(`/activities/${activityId}`)}>以参与者视角查看活动</button>
    </section>}
    <Overlay kind="dialog" open={transition !== null} title={transition ? `确认进入${phaseLabel[transition]}` : '确认阶段变更'} onClose={() => setTransition(null)}><p>阶段变更会影响报名与现场操作。未处理的出发去向、车辆或安全事项可能阻止变更。</p><FormField label="变更原因" hint="请明确说明本次阶段变更的依据。"><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></FormField>{failure && <p role="alert" className="callout danger">{failure}</p>}<button className={`button ${transition === 'cancelled' ? 'danger' : 'primary'}`} disabled={!reason.trim() || busy} onClick={async () => { if (!transition) return; const result = await run({ type: 'activity.transition', activityId, next: transition, reason }); if (!result.ok) setFailure(result.error.message); else { setSuccess(`已进入${phaseLabel[transition]}。`); setTransition(null); } }}>确认变更，不跳过检查</button></Overlay>
  </>;
}
