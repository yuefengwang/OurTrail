import { useId } from 'react';
import { Icon, type IconName } from './Icon';

export interface StatusPanelProps {
  kind: 'empty' | 'loading' | 'error' | 'denied' | 'offline';
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}

const statusIcons: Record<StatusPanelProps['kind'], IconName> = {
  empty: 'route', loading: 'clock', error: 'alert', denied: 'shield', offline: 'cloud',
};

export function StatusPanel({ kind, title, detail, action }: StatusPanelProps) {
  const titleId = useId();
  return (
    <section className={`empty-state status-panel status-panel--${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-labelledby={titleId} aria-busy={kind === 'loading' ? true : undefined}>
      <span className="status-panel__icon"><Icon name={statusIcons[kind]} size={24} /></span>
      <div className="stack status-panel__copy">
        <h2 id={titleId} className="section-title">{title}</h2>
        <p className="muted">{detail}</p>
      </div>
      {kind === 'loading' && <div className="status-skeleton" aria-hidden="true"><span /><span /><span /></div>}
      {action && <button type="button" className="button secondary" onClick={action.onClick}>{action.label}<Icon name="arrow" size={18} /></button>}
    </section>
  );
}
