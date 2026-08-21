import { ArrowRight, Bookmark, Building2, Clock3, ThumbsDown, ThumbsUp } from 'lucide-react';
import { displayAlertTitle } from '../utils/alertPresentation.js';

const scoreTone = (score) => score >= 9 ? 'critical' : score >= 8 ? 'high' : score >= 6 ? 'medium' : 'low';

export function AlertCard({ alert, onOpen, onFeedback, feedback = 0, saved = false, onSave }) {
  const tone = scoreTone(alert.score);
  const editorialPriority = alert.priority || (alert.status === 'Em andamento' ? 'Acompanhamento' : alert.score >= 8 ? 'Alta' : 'Média');
  const publishedDate = new Date(alert.publishedAt);
  const publishedLabel = Number.isNaN(publishedDate.getTime())
    ? 'Data de publicação não informada'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(publishedDate);

  return (
    <article className="alert-card" onClick={() => onOpen(alert)}>
      <div className={`score score--${tone}`}>
        <strong>{String(alert.score).replace('.', ',')}</strong>
        <small>/10</small>
      </div>
      <div className="alert-card__body">
        <div className="alert-card__meta">
          <span className={`priority priority--${tone}`}>Prioridade {editorialPriority}</span>
          <span className="status">{alert.status}</span>
          <span className="source-kind">{alert.provenance?.sourceType === 'journalistic' ? 'Jornalística' : 'Oficial'}</span>
        </div>
        <h3>{displayAlertTitle(alert.title)}</h3>
        <p>{alert.summary}</p>
        <div className="alert-card__footer">
          <span><Building2 size={15} />{alert.agency}</span>
          <time dateTime={alert.publishedAt}><Clock3 size={15} />Publicado em {publishedLabel}</time>
          <div className="taxes">{(alert.taxes || []).map((tax) => <b key={tax}>{tax}</b>)}</div>
          {onFeedback && <div className="card-feedback" aria-label="Avaliar relevância">
            <button className={feedback === 1 ? 'selected' : ''} aria-label="Gostei" aria-pressed={feedback === 1} onClick={(event) => { event.stopPropagation(); onFeedback(1); }}><ThumbsUp size={16} /><span>Gostei</span></button>
            <button className={feedback === -1 ? 'selected dislike' : ''} aria-label="Não gostei" aria-pressed={feedback === -1} onClick={(event) => { event.stopPropagation(); onFeedback(-1); }}><ThumbsDown size={16} /><span>Não gostei</span></button>
          </div>}
          {onSave && <button className={`card-save ${saved ? 'selected' : ''}`} aria-label={saved ? 'Remover dos salvos' : 'Salvar publicação'} aria-pressed={saved} onClick={(event) => { event.stopPropagation(); onSave(); }}><Bookmark size={17} fill={saved ? 'currentColor' : 'none'} /><span>{saved ? 'Salvo' : 'Salvar'}</span></button>}
          <button aria-label="Abrir detalhes"><ArrowRight size={19} /></button>
        </div>
      </div>
    </article>
  );
}
