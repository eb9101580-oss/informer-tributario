import { BookOpenCheck, Building2, CalendarClock, ExternalLink, Landmark, Link2, Plus, Scale, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const sourceIcons = { 'receita-federal': Building2, 'diario-oficial': BookOpenCheck, camara: Landmark, senado: Landmark, stf: Scale, stj: ShieldCheck, carf: Scale };

export function SourcesPage() {
  const [sources, setSources] = useState([]);
  const [customSources, setCustomSources] = useState([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const load = async () => {
    try {
      const [defaults, custom] = await Promise.all([api.sources(), api.customSources()]);
      setSources(defaults.items || []);
      setCustomSources(custom.items || []);
      setError('');
    } catch (requestError) { setError(requestError.message); }
  };
  useEffect(() => { load(); }, []);

  const addSource = async (event) => {
    event.preventDefault();
    try {
      await api.createCustomSource({ name, url });
      setName(''); setUrl('');
      await load();
    } catch (requestError) { setError(requestError.message); }
  };

  const setStatus = async (id, status) => {
    try { await api.updateCustomSource(id, { status }); await load(); }
    catch (requestError) { setError(requestError.message); }
  };

  return (
    <section className="sources-page">
      <div className="sources-intro">
        <div><span><ShieldCheck size={17} /> Curadoria de fontes primárias</span><h2>Onde nasce a informação tributária confiável</h2><p>O radar cobre Receita Federal (COSIT, IN, Notas e Atos), DOU, NF-e, SPED, informativos do STF e STJ, Congresso, CARF, PGFN e os seis TRFs. Notícias ajudam na descoberta, mas todo alerta real mantém o link da publicação original.</p></div>
      </div>
      {error && <div className="collector-error">{error}</div>}
      <section className="custom-sources-panel">
        <div><span><Link2 size={17} /> Administração</span><h2>Adicionar uma fonte ao coletor</h2><p>As fontes padrão permanecem fixas. Um novo domínio passa por validação de segurança antes de ser ativado.</p></div>
        <form onSubmit={addSource}><label>Nome<input required minLength="2" maxLength="120" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da publicação" /></label><label>Endereço HTTPS<input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></label><button className="primary"><Plus size={16} /> Adicionar</button></form>
        {!!customSources.length && <div className="custom-sources-list">{customSources.map((source) => <article key={source.id}><div><strong>{source.name}</strong><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></div><span className={`source-state source-state--${source.status}`}>{source.status === 'active' ? 'Ativa' : source.status === 'rejected' ? 'Rejeitada' : source.status === 'paused' ? 'Pausada' : 'Pendente'}</span><div>{source.status !== 'active' && <button onClick={() => setStatus(source.id, 'active')}>Aprovar</button>}{source.status !== 'rejected' && <button onClick={() => setStatus(source.id, 'rejected')}>Rejeitar</button>}</div></article>)}</div>}
      </section>
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
