import { useState } from 'react';
import { runtime } from '../app/runtime';
import { useCommand, useRuntimeVersion } from '../app/useView';
import { useAppNavigation } from '../app/navigation';
import { FormField } from '../components/FormField';
import { Overlay } from '../components/Overlay';
import { StatusPanel } from '../components/StatusPanel';
import type { PersonRecord } from '../domain/model';

const emptyPerson = (): PersonRecord => ({ name: '', phone: '', emergency: { name: '', phone: '' }, medical: '' });
export function Profile() {
  useRuntimeVersion();
  return <ProfileContext key={runtime.getActor().userId ?? 'guest'} />;
}
function ProfileContext() {
  useRuntimeVersion();
  const view = runtime.read({ kind: 'profile' });
  const [person, setPerson] = useState<PersonRecord>(() => view.kind === 'profile' ? structuredClone(view.profile.person) : emptyPerson());
  const [companion, setCompanion] = useState<{ id: string | null; person: PersonRecord } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const { run, busy, error, success } = useCommand();
  const { go } = useAppNavigation();
  if (view.kind !== 'profile') return <StatusPanel kind="denied" title="先选择演示账号" detail="顶部演示工具可切换合成账号，这不是正式登录。请勿填写真实个人信息。" />;
  const activities = runtime.read({ kind: 'home', perspective: 'participant', openedActivityIds: [] });
  return <section className="stack"><header><span className="eyebrow">我的同行资料</span><h2 className="page-title">下次出发，少填一点。</h2><p className="muted">常用资料的修改不追溯更改已经提交的报名。</p></header>
    <PersonFields person={person} change={setPerson} /><button className="button primary" disabled={busy} onClick={() => void run({ type: 'profile.save', person })}>保存常用资料</button>
    <section className="stack"><div className="card-header"><h3>常用同行人</h3><button className="button text" onClick={() => setCompanion({ id: null, person: emptyPerson() })}>添加同行人</button></div>{view.profile.companions.map(c => <div className="list-row" key={c.id}><strong>{c.person.name}</strong><div className="cluster"><button className="button text" onClick={() => setCompanion({ id: c.id, person: structuredClone(c.person) })}>编辑</button><button className="button text" onClick={() => setRemoveId(c.id)}>移除</button></div></div>)}<p className="small muted">保存条目不等于代办授权。每次报名仍需逐人同意；代报到家还需独立授权。</p></section>
    <section className="stack"><h3>位置与资料使用</h3><p>只在活动中主动上报一次位置，不会后台持续追踪。收尾后工作视角停止展示位置。</p>{activities.kind === 'home' && activities.activities.flatMap(a => {
      const own = runtime.read({ kind: 'activity', activityId: a.id, perspective: 'participant' });
      return own.kind === 'activity' ? own.rows.filter(row => runtime.can({ type: 'position.revoke', activityId: a.id, signupId: row.signupId }).ok).map(row => <button key={row.signupId} className="button text" disabled={busy} onClick={() => void run({ type: 'position.revoke', activityId: a.id, signupId: row.signupId })}>撤回 {a.title} · {row.name} 的位置授权</button>) : [];
    })}</section>
    <button className="button secondary" onClick={() => go('/')}>回到我的活动</button>
    {error && <p role="alert" className="callout danger">{error.message}</p>}{success && <p role="status">{success}</p>}
    <Overlay kind="sheet" open={!!companion} title="常用同行人资料" onClose={() => setCompanion(null)}>{companion && <><PersonFields person={companion.person} change={value => setCompanion({ ...companion, person: value })} /><button className="button primary" disabled={busy} onClick={async () => { const result = await run({ type: 'companion.save', companionId: companion.id, person: companion.person }); if (result.ok) setCompanion(null); }}>保存同行人</button>{error && <p role="alert">{error.message}</p>}</>}</Overlay>
    <Overlay kind="dialog" open={removeId !== null} title="移除常用同行人" onClose={() => setRemoveId(null)}><p>只移除常用条目，已提交的报名与安全记录会保留。</p><button className="button danger" disabled={busy} onClick={async () => { if (!removeId) return; const result = await run({ type: 'companion.remove', companionId: removeId }); if (result.ok) setRemoveId(null); }}>确认移除常用条目</button>{error && <p role="alert">{error.message}</p>}</Overlay>
  </section>;
}
function PersonFields({ person, change }: { person: PersonRecord; change: (person: PersonRecord) => void }) {
  return <><FormField label="姓名"><input value={person.name} onChange={e => change({ ...person, name: e.target.value })} maxLength={80} /></FormField><FormField label="演示联系电话"><input value={person.phone} onChange={e => change({ ...person, phone: e.target.value })} inputMode="tel" maxLength={30} /></FormField><FormField label="紧急联系人姓名"><input value={person.emergency.name} onChange={e => change({ ...person, emergency: { ...person.emergency, name: e.target.value } })} /></FormField><FormField label="紧急联系演示号码"><input value={person.emergency.phone} onChange={e => change({ ...person, emergency: { ...person.emergency, phone: e.target.value } })} inputMode="tel" /></FormField><FormField label="健康备注（仅合成示例）"><textarea value={person.medical} onChange={e => change({ ...person, medical: e.target.value })} maxLength={2000} /></FormField></>;
}
