import { ArrowUpRight } from 'lucide-react';

export function MetricCard({ label, value, detail, icon: Icon, tone = 'teal', onClick }) {
  const activate = () => onClick?.();

  return (
    <article className={`metric metric--${tone} ${onClick ? 'metric--interactive' : ''}`} onClick={activate} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="metric__top">
        <span className="metric__icon"><Icon size={20} /></span>
        <ArrowUpRight className="metric__arrow" size={17} />
      </div>
      <strong>{value ?? '—'}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </article>
  );
}
