import { useId, type ReactNode } from 'react';
import { Icon, TrailMark } from './Icon';

export interface AppShellProps {
  title: string;
  children: ReactNode;
  onBack?: () => void;
  footer?: ReactNode;
  tools?: ReactNode;
  root?: boolean;
}

export function AppShell({ title, children, onBack, footer, tools, root = false }: AppShellProps) {
  const mainId = useId();
  return (
    <div className="app-shell">
      <aside className="prototype-context" aria-label="原型说明">
        <div className="brand"><TrailMark /><span>OurTrail</span></div>
        <p>一次活动，一套协作。</p>
      </aside>
      <div className={`app-frame${root ? ' app-frame--root' : ''}`}>
        <a className="skip-link" href={`#${mainId}`} onClick={event => { event.preventDefault(); document.getElementById(mainId)?.focus({ preventScroll: true }); }}>跳到主要内容</a>
        <header className="app-header">
          {root ? <div className="brand app-brand"><TrailMark /><span>OurTrail</span></div> : <>
            {onBack && <button type="button" className="icon-button" aria-label="返回" onClick={onBack}><Icon name="back" /></button>}
            <h1 className="app-header__title">{title}</h1>
          </>}
          {tools && <div className="app-header__tools">{tools}</div>}
        </header>
        <main className="app-main" id={mainId} tabIndex={-1}>
          {root && <h1 className="page-title">{title}</h1>}
          {children}
        </main>
        <footer className="app-footer">
          {footer}
          <p className="prototype-disclaimer">演示原型，请勿输入真实个人信息</p>
        </footer>
      </div>
    </div>
  );
}
