import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../app/useView';
import { useAppNavigation } from '../app/navigation';
import { FormField } from '../components/FormField';
import { StatusPanel } from '../components/StatusPanel';
import type { AudienceRecord } from '../domain/model';
import type { ReadRequest } from '../domain/contracts';

export function Notices() {
  const { activityId } = useParams();
  useRuntimeVersion();
  return <NoticeContext key={`${runtime.getActor().userId}:${activityId ?? ''}`} activityId={activityId} />;
}
function NoticeContext({ activityId }: { activityId?: string }) {
  const request = useMemo<ReadRequest>(() => ({ kind: 'notices', ...(activityId ? { activityId } : {}) }), [activityId]);
  const view = useView(request);
  const { go } = useAppNavigation();
  const [content, setContent] = useState(() => activityId ? runtime.getDraft<{ content: string }>(activityId, 'notice')?.content ?? '' : '');
  const [audienceKind, setAudience] = useState<AudienceRecord['kind']>('activity');
  const [target, setTarget] = useState('');
  const [message, setMessage] = useState('');
  const { run, busy, error, success } = useCommand();
  if (view.kind !== 'notices') return <StatusPanel kind="denied" title="暂不能查看通知" detail={view.kind === 'denied' ? view.message : '请先选择演示账号。'} />;
  const management = activityId ? runtime.readNoticeManagement(activityId) : null;
  const activity = activityId ? runtime.read({ kind: 'activity', activityId, perspective: 'participant' }) : null;
  const canPublish = management?.ok && activity?.kind === 'activity' && !['archived', 'cancelled'].includes(activity.activity.phase);
  const publish = async () => {
    if (!activityId) return;
    const audience: AudienceRecord = audienceKind === 'activity' ? { kind: 'activity' } : audienceKind === 'vehicle' ? { kind: 'vehicle', vehicleId: target.trim() } : { kind: 'signups', signupIds: target.split(/[,，\s]+/u).filter(Boolean) };
    const result = await run({ type: 'notice.publish', activityId, audience, content });
    if (result.ok) { setContent(''); runtime.clearDraft(activityId, 'notice'); }
  };
  return <section className="stack"><header><span className="eyebrow">同行消息</span><h2 className="page-title">重要安排，不错过。</h2><p className="muted">站内发布、你已阅读与外部发送，是不同的记录。</p></header>
    {canPublish && <details open={!!content}><summary>发布活动通知</summary><div className="stack"><FormField label="通知内容"><textarea value={content} onChange={e => { setContent(e.target.value); runtime.setDraft(activityId!, 'notice', { content: e.target.value }); }} maxLength={2000} /></FormField><FormField label="通知范围"><select value={audienceKind} onChange={e => setAudience(e.target.value as AudienceRecord['kind'])}><option value="activity">本活动相关人员</option><option value="signups">指定报名人员</option><option value="vehicle">指定车辆</option></select></FormField>{audienceKind !== 'activity' && <FormField label={audienceKind === 'vehicle' ? '车辆编号' : '报名编号（逗号分隔）'}><input value={target} onChange={e => setTarget(e.target.value)} /></FormField>}<button className="button primary" disabled={busy || !content.trim()} onClick={() => void publish()}>发布站内通知</button></div></details>}
    {view.notices.length === 0 && <StatusPanel kind="empty" title="还没有需要你查看的通知" detail="报名确认或集合安排更新后，会在这里显示。" />}
    {[...view.notices].reverse().map(notice => {
      const owned = management?.ok ? management.value.notices.find(n => n.id === notice.id) : null;
      return <article className="notice-card" key={notice.id} data-unread={!notice.read}><div className="card-header"><span className={`badge ${notice.read ? 'neutral' : 'success'}`}>{notice.read ? '已读' : '未读'}</span><time className="small muted">{new Date(notice.publishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time></div><p>{notice.content}</p><div className="form-actions">{!notice.read && <button className="button text" disabled={busy} onClick={() => void run({ type: 'notice.read', activityId: notice.activityId, noticeId: notice.id })}>标记已读</button>}<button className="button text" onClick={() => go(`/activities/${notice.activityId}`)}>查看活动安排</button>{owned && <button className="button secondary" disabled={busy} onClick={async () => {
        try { await navigator.clipboard.writeText(notice.content); } catch { setMessage(`未能复制，请手动选择通知内容；站内发布不受影响。`); return; }
        const result = await run({ type: 'notice.delivery', activityId: notice.activityId, noticeId: notice.id, channel: 'copy', status: 'copied', detail: '浏览器剪贴板已完成' });
        setMessage(result.ok ? '已复制；复制记录已保存。请自行选择发送对象。' : `已复制，但记录未保存：${result.error.message}`);
      }}>复制通知</button>}</div>{owned && <details><summary>模拟订阅结果（非微信发送）</summary><div className="cluster">{(['simulated_success', 'failed', 'not_authorized'] as const).map((status, i) => <button key={status} className="button text" disabled={busy} onClick={() => void run({ type: 'notice.delivery', activityId: notice.activityId, noticeId: notice.id, channel: 'subscription_simulation', status, detail: '仅模拟渠道结果，未向微信发送' })}>{['模拟成功', '模拟失败', '模拟未授权'][i]}</button>)}</div>{owned.deliveries.map(d => <p className="small muted" key={d.id}>{d.channel === 'copy' ? '复制' : '模拟订阅'} · {({ copied: '已复制', simulated_success: '模拟成功', failed: '失败', not_authorized: '未授权' })[d.status]}</p>)}</details>}</article>;
    })}
    {message && <p role="status" className="callout">{message}</p>}{error && <p role="alert" className="callout danger">{error.message}</p>}{success && <p role="status">{success}</p>}
  </section>;
}
