import { ArrowUpRight, CircleDollarSign } from 'lucide-react';

export function OpportunityCard({ alert, onOpen }) {
  return (
    <button className="opportunity-card" onClick={() => onOpen(alert)}>
      <span className="opportunity-card__icon"><CircleDollarSign size={21} /></span>
      <span className="opportunity-card__content">
        <small>{alert.taxes.join(' · ')}</small>
        <strong>{alert.opportunity?.title || alert.title}</strong>
        <em>{alert.affectedProfiles.slice(0, 2).join(' · ')}</em>
      </span>
      <ArrowUpRight size={19} />
    </button>
  );
}
