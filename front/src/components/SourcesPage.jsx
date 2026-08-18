import { ArrowUpRight, BookOpenCheck, Building2, CalendarClock, ExternalLink, Landmark, Scale, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const sourceIcons = { 'receita-federal': Building2, 'diario-oficial': BookOpenCheck, camara: Landmark, senado: Landmark, stf: Scale, stj: ShieldCheck, carf: Scale };

export function SourcesPage({ onCollector }) {
  const [sources, setSources] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => { api.sources().then((data) => setSources(data.items)).catch((requestError) => setError(requestError.message)); }, []);

  return (
    <section className="sources-page">
      <div className="sources-intro">
        <div><span><ShieldCheck size={17} /> Curadoria de fontes primárias</span><h2>Onde nasce a informação tributária confiável</h2><p>O radar cobre administração fiscal, Diário Oficial, Congresso, STF, STJ, CARF e os seis TRFs. Notícias ajudam na descoberta, mas todo alerta real mantém o link do documento oficial analisado.</p></div>
        <button onClick={onCollector}>Analisar uma publicação <ArrowUpRight size={17} /></button>
      </div>
      {error && <div className="collector-error">{error}</div>}
      <div className="sources-grid">
        {sources.map((source) => {
          const Icon = sourceIcons[source.id] || Building2;
          return (
            <article className={`source-card source-card--${source.color}`} key={source.id}>
              <div className="source-card__top"><span><Icon /></span><b>{source.acronym}</b><em>{source.sourceType === 'journalistic' ? 'Fonte jornalística' : `Prioridade ${source.priority}`}</em></div>
              <small>{source.category}</small><h3>{source.name}</h3><p>{source.description}</p>
              <div className="source-focus">{source.focus.map((item) => <span key={item}>{item}</span>)}</div>
              <div className="source-card__footer"><span><CalendarClock size={15} /> {source.monitoring}</span><a href={source.url} target="_blank" rel="noreferrer">Abrir fonte <ExternalLink size={15} /></a></div>
            </article>
          );
        })}
      </div>
      <div className="source-guidance"><BookOpenCheck size={20} /><div><strong>Proveniência verificável</strong><p>O monitor registra órgão, método de descoberta, horário, endereço oficial e modelo usado. Uma falha de coleta aparece como falha; ela nunca é interpretada como ausência de decisões.</p></div></div>
    </section>
  );
}
