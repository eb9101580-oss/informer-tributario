import { ArrowRight, Building2, Clock3, ThumbsDown, ThumbsUp } from 'lucide-react';

const scoreTone = (score) => score >= 9 ? 'critical' : score >= 8 ? 'high' : score >= 6 ? 'medium' : 'low';

export function AlertCard({ alert, onOpen, onFeedback, feedback = 0 }) {
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
          <span className="source-kind">{alert.provenance?.sourceType === 'journalistic' ? 'Jornalística' : 'Oficial'}</span>
        </div>
        <h3>{alert.title}</h3>
        <p>{alert.summary}</p>
        <div className="alert-card__footer">
          <span><Building2 size={15} />{alert.agency}</span>
          <span><Clock3 size={15} />Hoje, {time}</span>
          <div className="taxes">{alert.taxes.map((tax) => <b key={tax}>{tax}</b>)}</div>
          {onFeedback && <div className="card-feedback" aria-label="Avaliar relevância">
            <button className={feedback === 1 ? 'selected' : ''} aria-label="Gostei" aria-pressed={feedback === 1} onClick={(event) => { event.stopPropagation(); onFeedback(1); }}><ThumbsUp size={16} /><span>Gostei</span></button>
            <button className={feedback === -1 ? 'selected dislike' : ''} aria-label="Não gostei" aria-pressed={feedback === -1} onClick={(event) => { event.stopPropagation(); onFeedback(-1); }}><ThumbsDown size={16} /><span>Não gostei</span></button>
          </div>}
          <button aria-label="Abrir detalhes"><ArrowRight size={19} /></button>
        </div>
      </div>
    </article>
  );
}
