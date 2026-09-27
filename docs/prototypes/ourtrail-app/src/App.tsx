import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { runtime, startRuntimeClock } from './app/runtime';
import { useRuntimeVersion } from './app/useView';
import { useAppNavigation } from './app/navigation';
import { AppShell } from './components/AppShell';
import { Overlay } from './components/Overlay';
import { FormField } from './components/FormField';
import { StatusPanel } from './components/StatusPanel';
import { Icon } from './components/Icon';
import { fixtureNames, type FixtureName } from './data/fixtures';
import { ActivityHome } from './screens/ActivityHome';
import { ActivityDetail } from './screens/ActivityDetail';
import { Signup } from './screens/Signup';
import { ActivityEditor } from './screens/ActivityEditor';
import { Workspace } from './screens/Workspace';
import { StaffTask } from './screens/StaffTask';
import { VehicleTask } from './screens/VehicleTask';
import { Weather } from './screens/Weather';
import { Notices } from './screens/Notices';
import { Profile } from './screens/Profile';

const accounts = [['u-lin', '林溪 · 参与者'], ['u-owner', '陈屿 · 组织者'], ['u-staff', '许安 · 协作'], ['u-driver', '许川 · 车辆联系人'], ['u-zhou', '周遥 · 同行人代报'], ['u-new', '顾言 · 新参与者'], ['u-other', '沈禾 · 无关账号'], ['', '访客']] as const;
const scenes: Record<FixtureName, string> = { empty: '空白起步', signup: '报名审核', transport: '分车安排', gathering: '集合签到', active: '活动进行中', closing: '安全收尾', archived: '已归档', 'cross-day': '跨日活动' };

function Application() {
  useRuntimeVersion();
  const { pathname } = useLocation();
  const { go, back } = useAppNavigation();
  const [tools, setTools] = useState(false);
  const [scene, setScene] = useState<FixtureName>('signup');
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');
  const [clock, setClock] = useState(runtime.getNow());
  useEffect(() => startRuntimeClock(), []);
  useEffect(() => {
    const online = () => runtime.setOffline(!navigator.onLine);
    const refresh = () => { if (document.visibilityState === 'visible') runtime.setDemoTime(new Date(Date.parse(runtime.getNow()) + 1).toISOString()); };
    window.addEventListener('online', online); window.addEventListener('offline', online); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', online); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const root = ['/', '/notices', '/me'].includes(pathname);
  const bootError = runtime.getBootError();
  const title = pathname === '/' ? '活动' : pathname === '/me' ? '我的' : pathname.endsWith('/notices') ? '通知' : pathname.endsWith('/signup') ? '报名同行' : pathname.endsWith('/workspace') ? '活动工作台' : pathname.endsWith('/weather') ? '天气参考' : pathname.endsWith('/edit') || pathname.endsWith('/new') ? '发起活动' : pathname.includes('/vehicles/') ? '本车任务' : pathname.endsWith('/staff') ? '协作任务' : '活动详情';
  const actor = runtime.getActor().userId;
  return <AppShell title={title} root={root} onBack={root ? undefined : back} tools={<button className="button text" onClick={() => { setTools(true); setConfirmReset(false); setClock(runtime.getNow()); }}>演示工具</button>} footer={root && <nav className="tabs" aria-label="主导航">{[['/', '活动', 'activity'], ['/notices', '通知', 'bell'], ['/me', '我的', 'person']].map(([path, label, icon]) => <button className="tab" key={path} aria-current={pathname === path ? 'page' : undefined} onClick={() => go(path)}><Icon name={icon as 'activity' | 'bell' | 'person'} size={21} />{label}</button>)}</nav>}>
    {runtime.isOffline() && <div role="status" className="callout warning">离线演示：当前记录可读，修改不会保存。请保留输入。</div>}
    {bootError ? <StatusPanel kind="error" title="演示记录暂不可用" detail={bootError.message} action={{ label: '打开演示恢复工具', onClick: () => setTools(true) }} /> : <Routes key={actor ?? 'guest'}><Route path="/" element={<ActivityHome />} /><Route path="/me" element={<Profile />} /><Route path="/notices" element={<Notices />} /><Route path="/activities/new" element={<ActivityEditor />} /><Route path="/activities/:activityId" element={<ActivityDetail />} /><Route path="/activities/:activityId/signup" element={<Signup />} /><Route path="/activities/:activityId/edit" element={<ActivityEditor />} /><Route path="/activities/:activityId/workspace" element={<Workspace />} /><Route path="/activities/:activityId/staff" element={<StaffTask />} /><Route path="/activities/:activityId/vehicles/:vehicleId" element={<VehicleTask />} /><Route path="/activities/:activityId/weather" element={<Weather />} /><Route path="/activities/:activityId/notices" element={<Notices />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>}
    <Overlay kind="sheet" open={tools} title="演示工具" onClose={() => setTools(false)}><p className="small muted">仅切换本地合成账号与场景，不是正式登录。分享链接只指向本浏览器已有数据，不会同步给其他设备。</p><FormField label="演示账号"><select value={actor ?? ''} onChange={e => { runtime.setDemoUser(e.target.value || null); setTools(false); }}>{accounts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></FormField><label className="check-label"><input type="checkbox" checked={runtime.isOffline()} onChange={e => runtime.setOffline(e.target.checked)} /><span>模拟离线，不保存业务修改</span></label><FormField label="演示时钟（含时区）"><input value={clock} onChange={e => setClock(e.target.value)} /></FormField><button className="button secondary" onClick={() => { const result = runtime.setDemoTime(clock); setMessage(result.ok ? '演示时间已更新。' : result.error.message); }}>更新演示时间</button><FormField label="演示场景"><select value={scene} onChange={e => { setScene(e.target.value as FixtureName); setConfirmReset(false); }}>{fixtureNames.map(name => <option key={name} value={name}>{scenes[name]}</option>)}</select></FormField>{confirmReset ? <div className="callout warning"><p>本原型的全部当前活动修改会被合成样本替换，不影响其他站点数据。确认重置？</p><button className="button danger" onClick={() => { const result = runtime.resetDemo(scene); if (!result.ok) setMessage(result.error.message); else { setTools(false); setConfirmReset(false); go('/'); } }}>确认重置演示记录</button></div> : <button className="button danger" onClick={() => setConfirmReset(true)}>重置为所选场景</button>}{message && <p role="status">{message}</p>}</Overlay>
  </AppShell>;
}
export function App() { return <HashRouter><Application /></HashRouter>; }
