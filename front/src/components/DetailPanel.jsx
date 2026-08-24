import { Bookmark, Check, ExternalLink, Lightbulb, ShieldAlert, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { displayAlertTitle, displayDocumentKind, sentenceTypeExplanation, sourceDocumentClassification } from '../utils/alertPresentation.js';

const ratings = [
  { value: 'irrelevante', label: 'Irrelevante', icon: ThumbsDown },
  { value: 'relevante', label: 'Relevante', icon: Check },
  { value: 'muito relevante', label: 'Muito relevante', icon: ThumbsUp },
];

export function DetailPanel({ alert, onClose, onFeedback, saved = false, onSave }) {
  const [selected, setSelected] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { setSelected(''); setSent(false); }, [alert?.id]);
  if (!alert) return null;

  const sourceClassification = sourceDocumentClassification(alert);
  const classificationExplanation = sentenceTypeExplanation(sourceClassification);
  const editorialPriority = alert.priority || (alert.status === 'Em andamento' ? 'Acompanhamento' : alert.score >= 8 ? 'Alta' : 'Média');
  const primarySourceUrl = alert.primarySourceUrl || (alert.provenance?.sourceType !== 'journalistic' ? alert.officialUrl : '');
  const legalBasis = Array.isArray(alert.legalBasis) ? alert.legalBasis : alert.legalBasis ? [alert.legalBasis] : [];

  const publishedDate = new Date(alert.publishedAt);
  const publishedLabel = Number.isNaN(publishedDate.getTime())
    ? 'Data de publicação não informada'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short' }).format(publishedDate);

  const submitFeedback = async (rating) => {
    setSelected(rating);
    await onFeedback(alert.id, rating);
    setSent(true);
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer">
        <button className="drawer__close icon-button" onClick={onClose} aria-label="Fechar"><X /></button>
        <div className="drawer__score"><strong>{String(alert.score).replace('.', ',')}</strong><span>/10 · {alert.relevance}</span></div>
        <div className="drawer__tags"><span>Prioridade {editorialPriority}</span><span>{alert.status}</span><span>{alert.agency}</span><span className="drawer__published">Publicado em {publishedLabel}</span>{(alert.taxes || []).map((tax) => <b key={tax}>{tax}</b>)}</div>
        <h2>{displayAlertTitle(alert.title)}</h2>

        <section><h3>O que aconteceu</h3><p>{alert.summary}</p></section>
        <section><h3>O que mudou</h3><p>{alert.whatChanged}</p></section>
        <section><h3>Impacto prático</h3><p>{alert.practicalImpact}</p></section>

        {(alert.issueOrSubject || alert.rulingOrRule || alert.legalReasoning || alert.effectiveDateOrDeadline) && <section className="detail-evidence"><h3>Leitura objetiva do documento</h3>
          {alert.issueOrSubject && <div><strong>Questão ou objeto</strong><p>{alert.issueOrSubject}</p></div>}
          {alert.rulingOrRule && <div><strong>Dispositivo ou regra</strong><p>{alert.rulingOrRule}</p></div>}
          {alert.legalReasoning && <div><strong>Fundamento identificado</strong><p>{alert.legalReasoning}</p></div>}
          {alert.effectiveDateOrDeadline && <div><strong>Vigência e prazos</strong><p>{alert.effectiveDateOrDeadline}</p></div>}
        </section>}

        <section><h3>Base jurídica</h3>{legalBasis.length
          ? <ul className="legal-basis-list">{legalBasis.map((basis) => <li key={basis}>{basis}</li>)}</ul>
          : <p>Referência jurídica não identificada no documento.</p>}</section>

        <div className="impact-box">
          <ShieldAlert size={21} />
          <div><strong>Oportunidade ou risco: {alert.impactType}</strong><p>{alert.officeAction}</p></div>
        </div>

        {alert.opportunity && (
          <div className="opportunity-box">
            <Lightbulb size={21} />
            <div><small>Oportunidade identificada</small><strong>{alert.opportunity.title}</strong><p>{alert.opportunity.action}</p><em>Confiança {alert.opportunity.confidence}</em></div>
          </div>
        )}

        <section><h3>Quem pode ser afetado</h3><div className="profile-tags">{(alert.affectedProfiles || []).map((profile) => <span key={profile}>{profile}</span>)}</div></section>

        {primarySourceUrl ? <a className="source-link" href={primarySourceUrl} target="_blank" rel="noreferrer">Acessar fonte primária oficial <ExternalLink size={17} /></a> : <span className="source-link source-link--disabled">Fonte primária oficial ainda não resolvida</span>}

        {onSave && <button className={`drawer-save ${saved ? 'drawer-save--active' : ''}`} onClick={() => onSave(alert)}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Publicação salva para ler depois' : 'Salvar publicação para ler depois'}</button>}

        {alert.provenance && <div className="provenance-box"><strong>Trilha de verificação</strong><span>Tipo: {alert.provenance.sourceType === 'journalistic' ? 'Fonte jornalística especializada' : 'Fonte oficial'}</span><span>Fonte: {alert.provenance.sourceName || alert.agency}</span><span>Documento: {displayDocumentKind(alert.provenance.documentKind || 'Publicação monitorada')}</span>{sourceClassification && <span>Classificação original do tribunal: {sourceClassification}{classificationExplanation ? ` — ${classificationExplanation}` : ''}. Não representa nota ou prioridade.</span>}<span>Coleta: {alert.provenance.collector} · análise local: {alert.provenance.analyzer}</span></div>}

        {onFeedback && <div className="feedback-box">
          <strong>{sent ? 'Obrigado pelo feedback.' : 'Este alerta foi útil?'}</strong>
          {!sent && <div>{ratings.map(({ value, label, icon: Icon }) => <button className={selected === value ? 'selected' : ''} onClick={() => submitFeedback(value)} key={value}><Icon size={16} />{label}</button>)}</div>}
        </div>}
      </aside>
    </div>
  );
}
