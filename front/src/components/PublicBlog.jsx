import { ArrowRight, ExternalLink, Mail, RefreshCw, Scale, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { AlertCard } from './AlertCard.jsx';
import { DetailPanel } from './DetailPanel.jsx';
import { compareFeedAlerts } from '../utils/alertSorting.js';

export function PublicBlog() {
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [subscriptionMessage, setSubscriptionMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
  const feed = useMemo(() => [...alerts].sort(compareFeedAlerts), [alerts]);

  const subscribe = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setSubscriptionMessage('');
    try {
      const result = await api.subscribe(email);
      setSubscriptionMessage(result.delivery === 'sent' ? 'Cadastro confirmado. Verifique seu e-mail.' : 'Cadastro recebido. O envio será ativado assim que o serviço de e-mail estiver configurado.');
      setEmail('');
    } catch (requestError) { setSubscriptionMessage(requestError.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="public-blog">
      <header className="public-blog__header">
        <a className="public-blog__brand" href="/"><span><Scale size={22} /></span><strong>informer</strong><small>radar tributário</small></a>
        <div className="public-blog__actions"><a href="/admin">Área administrativa <ArrowRight size={15} /></a><button onClick={load} disabled={loading} aria-label="Atualizar feed"><RefreshCw className={loading ? 'spinning' : ''} size={17} /></button></div>
      </header>
      <main className="public-blog__main">
        <section className="public-blog__intro"><div><span><ShieldCheck size={16} /> Fontes verificadas</span><h1>Radar tributário</h1><p>Decisões, normas e notícias jornalísticas sobre direito tributário brasileiro, das mais novas para as mais antigas.</p></div><small>Atualizado automaticamente<br />a cada 20 minutos</small></section>
        {error && <div className="inline-error">{error}<button onClick={load}>Tentar novamente</button></div>}
        {loading && !alerts.length ? <div className="public-blog__loading"><span className="loading-spinner" />Carregando o feed...</div> : <section className="public-blog__feed"><div className="public-blog__feed-heading"><h2>Último mês</h2><span>{feed.length} itens</span></div><div className="alerts-list">{feed.map((alert) => <AlertCard key={alert.id} alert={alert} onOpen={setSelected} />)}</div>{!feed.length && <p className="public-blog__empty">Nenhuma publicação relevante do último mês foi analisada ainda.</p>}</section>}
        <section className="public-blog__subscribe"><div><span><Mail size={16} /> Alertas por e-mail</span><h2>Receba primeiro o que merece atenção</h2><p>Cadastre seu e-mail e receba uma mensagem quando uma publicação atingir nota 8 ou superior.</p></div><form onSubmit={subscribe}><label htmlFor="public-subscription-email">Seu melhor e-mail</label><div><input id="public-subscription-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" /><button type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Quero receber'}</button></div>{subscriptionMessage && <small>{subscriptionMessage}</small>}</form></section>
      </main>
      <footer className="public-blog__footer"><span>Informer · inteligência tributária</span><a href="/admin">Acessar administração <ExternalLink size={14} /></a></footer>
      <DetailPanel alert={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
