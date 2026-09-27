import { useId, type ReactNode } from 'react';
import { Icon, TrailArt } from './Icon';

export interface ActivityCardProps {
  title: string;
  date: string;
  meta: string;
  status: string;
  onClick: () => void;
  featured?: boolean;
  children?: ReactNode;
}

export function ActivityCard({ title, date, meta, status, onClick, featured = false, children }: ActivityCardProps) {
  const id = useId();
  return (
    <article className={`card activity-card${featured ? ' hero activity-card--featured' : ''}`}>
      {featured && <TrailArt />}
      <div className="card-header activity-card__header">
        <span className="activity-card__date small" id={`${id}-date`}>{date}</span>
        <span className={`badge ${featured ? 'activity-card__status' : 'neutral'}`} id={`${id}-status`}>{status}</span>
      </div>
      <h2 className="activity-card__title">
        <button type="button" className="activity-card__action" aria-describedby={`${id}-date ${id}-meta ${id}-status`} onClick={onClick}>{title}</button>
      </h2>
      <p className="activity-card__meta muted" id={`${id}-meta`}>{meta}</p>
      {children && <div className="activity-card__info">{children}</div>}
      <span className={`activity-card__affordance${featured ? ' button leaf' : ''}`} aria-hidden="true">查看活动安排<Icon name="arrow" size={18} /></span>
    </article>
  );
}
