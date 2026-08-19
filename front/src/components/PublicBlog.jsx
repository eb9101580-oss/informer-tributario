import { ArrowRight, ExternalLink, RefreshCw, Scale, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { AlertCard } from './AlertCard.jsx';
import { DetailPanel } from './DetailPanel.jsx';

export function PublicBlog() {
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.alerts();
      setAlerts(data.items);
      setError('');
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  const feed = useMemo(() => [...alerts].sort((left, right) => right.score - left.score || new Date(right.publishedAt) - new Date(left.publishedAt)), [alerts]);

  return (
    <div className="public-blog">
      <header className="public-blog__header">
        <a className="public-blog__brand" href="/"><span><Scale size={22} /></span><strong>informer</strong><small>radar tributário</small></a>
        <div className="public-blog__actions"><a href="/admin">Área administrativa <ArrowRight size={15} /></a><button onClick={load} disabled={loading} aria-label="Atualizar feed"><RefreshCw className={loading ? 'spinning' : ''} size={17} /></button></div>
      </header>
      <main className="public-blog__main">
        <section className="public-blog__intro"><div><span><ShieldCheck size={16} /> Fontes verificadas</span><h1>Radar tributário</h1><p>Decisões, normas e notícias jornalísticas sobre direito tributário brasileiro, organizadas por relevância.</p></div><small>Atualizado automaticamente<br />a cada 10 minutos</small></section>
        {error && <div className="inline-error">{error}<button onClick={load}>Tentar novamente</button></div>}
        {loading && !alerts.length ? <div className="public-blog__loading"><span className="loading-spinner" />Carregando o feed...</div> : <section className="public-blog__feed"><div className="public-blog__feed-heading"><h2>Últimas publicações</h2><span>{feed.length} itens</span></div><div className="alerts-list">{feed.map((alert) => <AlertCard key={alert.id} alert={alert} onOpen={setSelected} />)}</div>{!feed.length && <p className="public-blog__empty">Nenhuma publicação relevante foi analisada ainda.</p>}</section>}
      </main>
      <footer className="public-blog__footer"><span>Informer · inteligência tributária</span><a href="/admin">Acessar administração <ExternalLink size={14} /></a></footer>
      <DetailPanel alert={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
