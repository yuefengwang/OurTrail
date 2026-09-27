import type { ReactNode } from 'react';

export interface PersonRowProps {
  name: string;
  subtitle?: string;
  status?: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
  children?: ReactNode;
}

export function PersonRow({ name, subtitle, status, tone = 'neutral', children }: PersonRowProps) {
  return (
    <li className="person-row">
      <span className="avatar" aria-hidden="true">{Array.from(name.trim())[0] ?? '—'}</span>
      <div className="person-row__body">
        <div className="person-row__heading"><strong>{name}</strong>{status && <span className={`badge ${tone}`}>{status}</span>}</div>
        {subtitle && <p className="small muted">{subtitle}</p>}
      </div>
      {children && <div className="person-row__actions">{children}</div>}
    </li>
  );
}
