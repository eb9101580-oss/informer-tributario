import { ArrowRight, Building2, Clock3 } from 'lucide-react';

const scoreTone = (score) => score >= 9 ? 'critical' : score >= 8 ? 'high' : score >= 6 ? 'medium' : 'low';

export function AlertCard({ alert, onOpen }) {
  const tone = scoreTone(alert.score);
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(alert.publishedAt));

  return (
    <article className="alert-card" onClick={() => onOpen(alert)}>
      <div className={`score score--${tone}`}>
        <strong>{String(alert.score).replace('.', ',')}</strong>
        <small>/10</small>
      </div>
      <div className="alert-card__body">
        <div className="alert-card__meta">
          <span className={`priority priority--${tone}`}>{alert.relevance}</span>
          <span className="status">{alert.status}</span>
          {alert.isDemo && <span className="demo-tag">Demonstração</span>}
        </div>
        <h3>{alert.title}</h3>
        <p>{alert.summary}</p>
        <div className="alert-card__footer">
          <span><Building2 size={15} />{alert.agency}</span>
          <span><Clock3 size={15} />Hoje, {time}</span>
          <div className="taxes">{alert.taxes.map((tax) => <b key={tax}>{tax}</b>)}</div>
          <button aria-label="Abrir detalhes"><ArrowRight size={19} /></button>
        </div>
      </div>
    </article>
  );
}
