import { useEffect, useMemo, useState } from 'react';
import {
  BellRing, Bookmark, Building2, CalendarDays, ChevronDown, CircleAlert, CircleDollarSign,
  FileSearch, Menu, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, X,
} from 'lucide-react';
import { api } from './api.js';
import { Sidebar } from './components/Sidebar.jsx';
import { MetricCard } from './components/MetricCard.jsx';
import { AlertCard } from './components/AlertCard.jsx';
import { DetailPanel } from './components/DetailPanel.jsx';
import { OpportunityCard } from './components/OpportunityCard.jsx';
import { CollectorPage } from './components/CollectorPage.jsx';
import { SourcesPage } from './components/SourcesPage.jsx';
import { MonitorPage } from './components/MonitorPage.jsx';

const pageTitles = {
  monitor: ['Varredura automática', 'Decisões, normas e proposições consultadas diretamente nas fontes oficiais.'],
  overview: ['Visão geral', 'O que realmente importa no cenário tributário hoje.'],
  radar: ['Radar tributário diário', 'As principais movimentações organizadas por relevância.'],
  alerts: ['Central de alertas', 'Acontecimentos que pedem atenção do escritório.'],
  opportunities: ['Radar de oportunidades', 'Possibilidades de atuação que merecem análise jurídica.'],
  collector: ['Coletor inteligente', 'Transforme documentos oficiais em análises estruturadas.'],
  sources: ['Fontes oficiais', 'Os canais primários que alimentam o radar tributário.'],
  feedback: ['Aprendizado de relevância', 'Seu feedback ajuda o radar a priorizar melhor.'],
};

function LoadingState() {
  return <div className="loading"><span /><p>Analisando o radar tributário...</p></div>;
}

function ErrorState({ message, onRetry }) {
  return <div className="empty-state"><CircleAlert size={30} /><h3>Não foi possível carregar o radar</h3><p>{message}</p><button onClick={onRetry}><RefreshCw size={17} />Tentar novamente</button></div>;
}

export default function App() {
  const [activePage, setActivePage] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [search, setSearch] = useState('');
  const [relevance, setRelevance] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(new Date());

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboardData, alertData] = await Promise.all([api.dashboard(), api.alerts()]);
      setDashboard(dashboardData);
      setAlerts(alertData.items);
      setUpdatedAt(new Date());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const filteredAlerts = useMemo(() => {
    const term = search.toLocaleLowerCase('pt-BR').trim();
    return alerts.filter((alert) => alert.isDemo === false && alert.score >= 6 && alert.officialUrl).filter((alert) => {
      const searchable = [alert.title, alert.summary, alert.theme, alert.agency, ...alert.taxes].join(' ').toLocaleLowerCase('pt-BR');
      const relevanceMatch = relevance === 'all' || (relevance === 'urgent' ? alert.score >= 8 : alert.score >= 6 && alert.score < 8);
      return (!term || searchable.includes(term)) && relevanceMatch;
    });
  }, [alerts, search, relevance]);

  const opportunities = alerts.filter((alert) => alert.opportunity);
  const [title, subtitle] = pageTitles[activePage];

  const sendFeedback = async (alertId, rating) => {
    try { await api.sendFeedback({ alertId, rating }); } catch (requestError) { setError(requestError.message); }
  };

  const mainContent = () => {
    if (loading) return <LoadingState />;
    if (error && !dashboard) return <ErrorState message={error} onRetry={loadData} />;

    if (activePage === 'opportunities') return (
      <section className="page-section">
        <div className="opportunity-hero">
          <div><span><Sparkles size={18} /> Inteligência aplicada</span><h2>{opportunities.length} frentes para avaliação</h2><p>Estas hipóteses sinalizam trabalho potencial, mas dependem de validação jurídica e documental de cada cliente.</p></div>
          <CircleDollarSign size={70} />
        </div>
        <div className="opportunity-grid">{opportunities.map((alert) => <OpportunityCard key={alert.id} alert={alert} onOpen={setSelectedAlert} />)}</div>
      </section>
    );

    if (activePage === 'collector') return <CollectorPage onCollected={loadData} onOpen={setSelectedAlert} />;

    if (activePage === 'sources') return <SourcesPage onCollector={() => setActivePage('collector')} />;

    if (activePage === 'monitor') return <MonitorPage onAlerts={() => { setActivePage('alerts'); loadData(); }} />;

    if (activePage === 'feedback') return (
      <section className="page-section feedback-page">
        <div className="feedback-intro"><span><SlidersHorizontal /></span><div><h2>O radar aprende com o escritório</h2><p>Abra um alerta e informe se ele foi irrelevante, relevante ou muito relevante. As avaliações ficam registradas para orientar os critérios futuros.</p></div></div>
        <div className="feedback-steps"><div><b>01</b><strong>Leia o alerta</strong><p>Confira a fonte, o impacto e a possível atuação.</p></div><div><b>02</b><strong>Avalie</strong><p>Use os botões de feedback no fim do detalhamento.</p></div><div><b>03</b><strong>Refine</strong><p>Padrões recorrentes ajudam a melhorar a priorização.</p></div></div>
      </section>
    );

    if (activePage === 'radar' || activePage === 'alerts') return (
      <section className="page-section">
        <div className="filters filters--wide">
          <label><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tema, tributo ou órgão..." />{search && <button onClick={() => setSearch('')}><X size={15} /></button>}</label>
          <div className="segmented"><button className={relevance === 'all' ? 'active' : ''} onClick={() => setRelevance('all')}>Todos</button><button className={relevance === 'urgent' ? 'active' : ''} onClick={() => setRelevance('urgent')}>Alta prioridade</button><button className={relevance === 'relevant' ? 'active' : ''} onClick={() => setRelevance('relevant')}>Relevantes</button></div>
        </div>
        <div className="section-heading"><div><span className="live-dot" /> Monitoramento ativo</div><small>{filteredAlerts.length} resultados</small></div>
        <div className="alerts-list">{filteredAlerts.map((alert) => <AlertCard key={alert.id} alert={alert} onOpen={setSelectedAlert} />)}</div>
        {!filteredAlerts.length && <div className="empty-state"><FileSearch size={29} /><h3>Nenhum alerta encontrado</h3><p>Tente remover um filtro ou buscar outro termo.</p></div>}
      </section>
    );

    return (
      <>
        <section className="metrics-grid">
          <MetricCard icon={FileSearch} value={dashboard.metrics.relevant} label="Itens relevantes" detail="Nota 6 ou superior" tone="blue" />
          <MetricCard icon={BellRing} value={dashboard.metrics.urgent} label="Alertas urgentes" detail="Ação prioritária" tone="red" />
          <MetricCard icon={CircleDollarSign} value={dashboard.metrics.opportunities} label="Oportunidades" detail="Para análise jurídica" tone="gold" />
          <MetricCard icon={Building2} value={dashboard.metrics.monitoredSources} label="Fontes no radar" detail="Fontes oficiais prioritárias" tone="teal" />
        </section>

        <div className="content-grid">
          <section className="panel panel--alerts">
            <div className="panel__heading"><div><h2>Prioridades de hoje</h2><p>Ordenadas por impacto e potencial de atuação</p></div><button className="text-button" onClick={() => setActivePage('radar')}>Ver radar completo</button></div>
            <div className="alerts-list">{filteredAlerts.slice(0, 3).map((alert) => <AlertCard key={alert.id} alert={alert} onOpen={setSelectedAlert} />)}</div>
          </section>

          <aside className="right-column">
            <section className="panel">
              <div className="panel__heading"><div><h2>Oportunidades</h2><p>Possíveis frentes de atuação</p></div><Bookmark size={20} /></div>
              <div className="opportunities-list">{opportunities.slice(0, 3).map((alert) => <OpportunityCard key={alert.id} alert={alert} onOpen={setSelectedAlert} />)}</div>
              <button className="full-button" onClick={() => setActivePage('opportunities')}>Ver todas as oportunidades</button>
            </section>
          </aside>
        </div>
      </>
    );
  };

  return (
    <div className="app-shell">
      <Sidebar active={activePage} onChange={setActivePage} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen && <div className="mobile-backdrop" onClick={() => setSidebarOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)}><Menu /></button>
          <div className="topbar__date"><CalendarDays size={17} /><span>{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date())}</span></div>
          <div className="topbar__right"><span className="environment"><ShieldCheck size={16} /> Fontes oficiais</span><button className="icon-button notification"><BellRing size={20} /><i /></button></div>
        </header>
        <div className="page">
          <div className="page-header">
            <div><p className="eyebrow">Radar tributário brasileiro</p><h1>{title}</h1><p>{subtitle}</p></div>
            <button className="refresh-button" onClick={loadData} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} size={17} />Atualizado às {new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(updatedAt)}<ChevronDown size={15} /></button>
          </div>
          {error && dashboard && <div className="inline-error">{error}<button onClick={() => setError('')}>Fechar</button></div>}
          {mainContent()}
        </div>
      </main>
      <DetailPanel alert={selectedAlert} onClose={() => setSelectedAlert(null)} onFeedback={sendFeedback} />
    </div>
  );
}
