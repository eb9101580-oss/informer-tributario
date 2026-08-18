import { ArrowUpRight, Check, ExternalLink, Lightbulb, ShieldAlert, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { useState } from 'react';

const ratings = [
  { value: 'irrelevante', label: 'Irrelevante', icon: ThumbsDown },
  { value: 'relevante', label: 'Relevante', icon: Check },
  { value: 'muito relevante', label: 'Muito relevante', icon: ThumbsUp },
];

export function DetailPanel({ alert, onClose, onFeedback }) {
  const [selected, setSelected] = useState('');
  const [sent, setSent] = useState(false);
  if (!alert) return null;

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
        <div className="drawer__tags"><span>{alert.status}</span>{alert.taxes.map((tax) => <b key={tax}>{tax}</b>)}</div>
        <h2>{alert.title}</h2>

        <section><h3>O que aconteceu</h3><p>{alert.summary}</p></section>
        <section><h3>O que mudou</h3><p>{alert.whatChanged}</p></section>
        <section><h3>Impacto prático</h3><p>{alert.practicalImpact}</p></section>

        <div className="impact-box">
          <ShieldAlert size={21} />
          <div><strong>{alert.impactType}</strong><p>{alert.officeAction}</p></div>
        </div>

        {alert.opportunity && (
          <div className="opportunity-box">
            <Lightbulb size={21} />
            <div><small>Oportunidade identificada</small><strong>{alert.opportunity.title}</strong><p>{alert.opportunity.action}</p><em>Confiança {alert.opportunity.confidence}</em></div>
          </div>
        )}

        <section><h3>Clientes potencialmente afetados</h3><div className="profile-tags">{alert.affectedProfiles.map((profile) => <span key={profile}>{profile}</span>)}</div></section>

        {alert.officialUrl ? <a className="source-link" href={alert.officialUrl} target="_blank" rel="noreferrer">Acessar fonte oficial <ExternalLink size={17} /></a> : <span className="source-link source-link--disabled">Fonte oficial pendente de confirmação</span>}

        {alert.provenance && <div className="provenance-box"><strong>Trilha de verificação</strong><span>Tipo: {alert.provenance.sourceType === 'journalistic' ? 'Fonte jornalística especializada' : 'Fonte oficial'}</span><span>Fonte: {alert.provenance.sourceName || alert.agency}</span><span>Documento: {alert.provenance.documentKind || 'Publicação monitorada'}</span><span>Coleta: {alert.provenance.collector} · análise local: {alert.provenance.analyzer}</span></div>}

        <div className="feedback-box">
          <strong>{sent ? 'Obrigado pelo feedback.' : 'Este alerta foi útil?'}</strong>
          {!sent && <div>{ratings.map(({ value, label, icon: Icon }) => <button className={selected === value ? 'selected' : ''} onClick={() => submitFeedback(value)} key={value}><Icon size={16} />{label}</button>)}</div>}
        </div>
      </aside>
    </div>
  );
}
