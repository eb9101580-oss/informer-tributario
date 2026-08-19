import { ArrowUpRight, BookOpenCheck, Building2, CalendarClock, ExternalLink, Landmark, Scale, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { AlertCard } from './AlertCard.jsx';
import { compareFeedAlerts } from '../utils/alertSorting.js';

const icons = { reforma: Scale, obrigacoes: BookOpenCheck };
const sourceIcons = { 'reforma-cgibs': Landmark, 'confaz-ajustes': Building2, 'nfe-notas-tecnicas': BookOpenCheck };

export function SectionPage({ sectionId, onOpen, onFeedback, feedbackFor }) {
  const [section, setSection] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [sectionData, alertData] = await Promise.all([api.section(sectionId), api.alerts({ section: sectionId })]);
      setSection(sectionData);
      setAlerts(alertData.items || []);
      setError('');
    } catch (requestError) { setError(requestError.message); }
  };

  useEffect(() => { load(); }, [sectionId]);
  const Icon = icons[sectionId] || ShieldCheck;
  const feed = useMemo(() => [...alerts].sort(compareFeedAlerts), [alerts]);

  if (!section && !error) return <div className="loading"><span /><p>Carregando seção...</p></div>;
  if (error && !section) return <div className="empty-state"><ShieldCheck size={28} /><h3>Não foi possível carregar a seção</h3><p>{error}</p><button onClick={load}>Tentar novamente</button></div>;

  return (
    <section className="section-page">
      <div className={`section-hero section-hero--${section.color || 'teal'}`}>
        <div><span><Icon size={17} /> Curadoria temática</span><h2>{section.title}</h2><p>{section.description}</p><div className="section-focus">{section.focus.map((item) => <b key={item}>{item}</b>)}</div></div>
        <button className="refresh-button" onClick={load}><CalendarClock size={16} />Atualizar seção</button>
      </div>

      <div className="section-page__heading"><div><h2>Fontes desta seção</h2><p>Links reais que entram na varredura automática.</p></div><span>{section.sources.length} fontes</span></div>
      <div className="sources-grid section-sources-grid">
        {section.sources.map((source) => {
          const SourceIcon = sourceIcons[source.id] || (source.sourceType === 'journalistic' ? Landmark : Building2);
          return <article className={`source-card source-card--${source.color}`} key={source.id}><div className="source-card__top"><span><SourceIcon /></span><b>{source.acronym}</b><em>{source.sourceType === 'journalistic' ? 'Jornalística' : 'Oficial'}</em></div><small>{source.category}</small><h3>{source.name}</h3><p>{source.description}</p><div className="source-focus">{source.focus.map((item) => <span key={item}>{item}</span>)}</div><div className="source-card__footer"><span><CalendarClock size={15} /> {source.monitoring}</span><a href={source.url} target="_blank" rel="noreferrer">Abrir fonte <ExternalLink size={15} /></a></div></article>;
        })}
      </div>

      <div className="section-page__heading section-page__heading--feed"><div><h2>Alertas e alterações detectadas</h2><p>Publicações oficiais têm prioridade; notícias são mantidas como contexto e levam ao texto original.</p></div><span>{feed.length} itens</span></div>
      {error && <div className="inline-error">{error}<button onClick={load}>Tentar novamente</button></div>}
      <div className="alerts-list">{feed.map((alert) => <AlertCard key={alert.id} alert={alert} onOpen={onOpen} onFeedback={onFeedback ? (value) => onFeedback(alert.id, value === 1 ? 'muito relevante' : 'irrelevante') : undefined} feedback={feedbackFor?.(alert.id)} />)}</div>
      {!feed.length && <div className="empty-state"><ArrowUpRight size={28} /><h3>Nenhuma publicação dos últimos 30 dias</h3><p>As fontes estão cadastradas e aparecerão após o próximo ciclo de varredura.</p></div>}
    </section>
  );
}
