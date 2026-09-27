import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { runtime } from '../app/runtime';
import { useRuntimeVersion, useView } from '../app/useView';
import { useAppNavigation } from '../app/navigation';
import { ActivityCard } from '../components/ActivityCard';
import { StatusPanel } from '../components/StatusPanel';
import { FormField } from '../components/FormField';
import { Icon } from '../components/Icon';
import type { ActivityRecord } from '../domain/model';
import type { ReadRequest } from '../domain/contracts';

const phaseLabels: Record<ActivityRecord['phase'], string> = { draft: '草稿', published: '行前准备', gathering: '正在集合', active: '正在同行', closing: '返程报平安', archived: '已归档', cancelled: '已取消' };
const dateLabel = (at: string | null) => at ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', weekday: 'short' }).format(new Date(at)) : '日期待定';

export function ActivityHome() {
  useRuntimeVersion();
  const [query, setQuery] = useSearchParams();
  const { go } = useAppNavigation();
  const openedKey = runtime.getOpenedActivityIds().join('|');
  const request = useMemo<ReadRequest>(() => ({ kind: 'home', perspective: 'participant', openedActivityIds: openedKey ? openedKey.split('|') : [] }), [openedKey]);
  const staffRequest = useMemo<ReadRequest>(() => ({ kind: 'home', perspective: 'staff', openedActivityIds: [] }), []);
  const vehicleRequest = useMemo<ReadRequest>(() => ({ kind: 'home', perspective: 'vehicle', openedActivityIds: [] }), []);
  const profileRequest = useMemo<ReadRequest>(() => ({ kind: 'profile' }), []);
  const home = useView(request);
  const staffHome = useView(staffRequest);
  const vehicleHome = useView(vehicleRequest);
  const profile = useView(profileRequest);
  const filter = query.get('filter') ?? 'mine';
  const search = query.get('search') ?? '';
  const updateQuery = (key: string, value: string) => { const next = new URLSearchParams(query); if (value) next.set(key, value); else next.delete(key); setQuery(next, { replace: true }); };
  if (home.kind !== 'home') return <StatusPanel kind="denied" title="暂时无法读取活动" detail={home.kind === 'denied' ? home.message : '请稍后重试。'} />;
  const all = [...new Map([home, staffHome, vehicleHome].flatMap((view) => view.kind === 'home' ? view.activities : []).map((a) => [a.id, a])).values()];
  const projected = all.map((activity) => {
    const personal = runtime.read({ kind: 'activity', activityId: activity.id, perspective: 'participant' });
    const staff = runtime.read({ kind: 'activity', activityId: activity.id, perspective: 'staff' });
    const vehicle = runtime.read({ kind: 'activity', activityId: activity.id, perspective: 'vehicle' });
    const owner = activity.ownerId === runtime.getActor().userId;
    const joined = personal.kind === 'activity' && personal.rows.some((r) => ['pending', 'confirmed', 'waitlisted'].includes(r.status));
    return { activity, personal, owner, joined, staff: staff.kind === 'activity', vehicle: vehicle.kind === 'activity' && !!vehicle.vehicleTask };
  });
  const tasks = projected.filter((p) => !['archived', 'cancelled'].includes(p.activity.phase) && (p.staff || p.vehicle));
  const filtered = projected.filter(({ activity, owner, joined }) => {
    const scope = filter === 'recent' ? openedKey.split('|').includes(activity.id) : filter === 'finished' ? ['archived', 'cancelled'].includes(activity.phase) : (owner || joined) && !['archived', 'cancelled'].includes(activity.phase);
    return scope && `${activity.title} ${activity.routeSnapshot.title} ${activity.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }).sort((a, b) => (a.activity.startAt ? Date.parse(a.activity.startAt) : Infinity) - (b.activity.startAt ? Date.parse(b.activity.startAt) : Infinity));
  const featured = filtered.find((p) => p.activity.phase !== 'draft');
  return <>
    <header className="stack"><div className="card-header"><span className="eyebrow">OURTRAIL · 一起走过</span><button className="button text" onClick={() => go('/activities/new')}><Icon name="plus" size={16} />发起活动</button></div><h2 className="page-title">{profile.kind === 'profile' ? `${profile.profile.person.name}，` : ''}下一次同行</h2><p className="muted">从出发到平安到家，把安排放在一起。</p></header>
    {tasks.length > 0 && <section aria-label="我的协作任务"><h3 className="section-title">需要我协作</h3>{tasks.map(({ activity, staff, vehicle }) => <button key={activity.id} className="list-row" onClick={() => { const task = runtime.read({ kind: 'activity', activityId: activity.id, perspective: 'vehicle' }); go(staff ? `/activities/${activity.id}/staff` : task.kind === 'activity' && task.vehicleTask ? `/activities/${activity.id}/vehicles/${task.vehicleTask.vehicle.id}` : `/activities/${activity.id}`); }}><span>{activity.title}<small>{[staff && '现场协作', vehicle && '车辆联络'].filter(Boolean).join(' · ')} · {phaseLabels[activity.phase]}</small></span><Icon name="arrow" size={18} /></button>)}</section>}
    <section className="stack"><div className="segmented" aria-label="活动范围">{[['mine', '我的活动'], ['recent', '最近查看'], ['finished', '已结束']].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => updateQuery('filter', value)}>{label}</button>)}</div><FormField label="查找我的活动"><input type="search" placeholder="搜索活动或路线" value={search} onChange={(e) => updateQuery('search', e.target.value)} /></FormField></section>
    {filtered.length === 0 ? <StatusPanel kind="empty" title={search ? '没有匹配的活动' : filter === 'recent' ? '还没有最近查看的活动' : '留一点时间，走进山野'} detail={search ? '换个关键词，或切换活动范围。' : '这里仅显示与你有关或你打开过的活动。收到活动链接后，可以查看安排并报名。'} action={search ? { label: '清除搜索', onClick: () => updateQuery('search', '') } : { label: '发起一场同行', onClick: () => go('/activities/new') }} /> : <section className="stack" aria-label="活动列表">{[...(featured ? [featured] : []), ...filtered.filter((p) => p !== featured)].map(({ activity, personal, owner, joined }) => <ActivityCard key={activity.id} title={activity.title || '未命名草稿'} date={dateLabel(activity.startAt)} meta={`${activity.routeSnapshot.title || '路线待完善'} · ${activity.routeSnapshot.distanceKm} km`} status={owner ? `我组织的 · ${phaseLabels[activity.phase]}` : joined ? phaseLabels[activity.phase] : '最近查看'} featured={featured?.activity.id === activity.id} onClick={() => { runtime.rememberActivity(activity.id); go(`/activities/${activity.id}`); }}>{personal.kind === 'activity' && <div className="cluster small"><span>已确认 {personal.counters.confirmed} 人</span><span>待审核 {personal.counters.pending} 人</span><span>名额 {activity.capacity} 人</span></div>}</ActivityCard>)}</section>}
  </>;
}
