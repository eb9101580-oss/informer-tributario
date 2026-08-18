import { ArrowUpRight } from 'lucide-react';

export function MetricCard({ label, value, detail, icon: Icon, tone = 'teal' }) {
  return (
    <article className={`metric metric--${tone}`}>
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
