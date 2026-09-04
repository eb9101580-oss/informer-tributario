import { useEffect, useMemo, useState } from 'react';
import {
  BellRing, Bookmark, Building2, CalendarDays, ChevronDown, CircleAlert, CircleDollarSign,
  FileSearch, Menu, RefreshCw, Search, ShieldCheck, Sparkles, ThumbsUp, X,
} from 'lucide-react';
import { api } from './api.js';
import { Sidebar } from './components/Sidebar.jsx';
import { MetricCard } from './components/MetricCard.jsx';
import { AlertCard } from './components/AlertCard.jsx';
import { DetailPanel } from './components/DetailPanel.jsx';
import { OpportunityCard } from './components/OpportunityCard.jsx';
import { SourcesPage } from './components/SourcesPage.jsx';
import { MonitorPage } from './components/MonitorPage.jsx';
import { PublicBlog } from './components/PublicBlog.jsx';
import { ActionsPage } from './components/ActionsPage.jsx';
import { SectionPage } from './components/SectionPage.jsx';
import { SettingsPage } from './components/SettingsPage.jsx';
import { LoginPage } from './components/LoginPage.jsx';
import { FeedbackPage } from './components/FeedbackPage.jsx';
import { EditorialBriefing } from './components/EditorialBriefing.jsx';

const pageTitles = {
  monitor: ['Varredura automática', 'Decisões, normas e proposições consultadas diretamente nas fontes oficiais.'],
  overview: ['Visão geral', 'O que realmente importa no cenário tributário hoje.'],
  alerts: ['Central de alertas', 'Acontecimentos que pedem atenção do escritório.'],
  opportunities: ['Radar de oportunidades', 'Possibilidades de atuação que merecem análise jurídica.'],
  sources: ['Fontes monitoradas', 'Canais oficiais e jornalísticos que alimentam o radar tributário.'],
  feedback: ['Aprendizado de relevância', 'Seu feedback ajuda o radar a priorizar melhor.'],
  actions: ['Ações acompanhadas', 'Status e movimentações recentes dos temas e processos que você escolheu observar.'],
  reforma: ['Reforma tributária', 'IBS, CBS, CGIBS, regulamentação e impactos operacionais.'],
  obrigacoes: ['Obrigações acessórias', 'Manuais, leiautes e alterações nas escriturações digitais.'],
  settings: ['Configurações', 'Preferências de alertas e entrega de notificações.'],
};

function LoadingState() {
  return <div className="loading"><span /><p>Analisando o radar tributário...</p></div>;
}

function ErrorState({ message, onRetry }) {
  return <div className="empty-state"><CircleAlert size={30} /><h3>Não foi possível carregar o radar</h3><p>{message}</p><button onClick={onRetry}><RefreshCw size={17} />Tentar novamente</button></div>;
}

function rankFeedAlerts(items, feedback) {
  const profileScore = (alert) => feedback.reduce((total, vote) => {
    if (vote.alertId === alert.id) return total + vote.value * 2;
    const sameAgency = vote.agency && vote.agency === alert.agency ? 0.35 : 0;
    const sameTheme = vote.theme && vote.theme === alert.theme ? 0.4 : 0;
    const sharedTaxes = (alert.taxes || []).filter((tax) => (vote.taxes || []).includes(tax)).length * 0.25;
    return total + vote.value * (sameAgency + sameTheme + sharedTaxes);
  }, 0);
  const personalizedScore = (alert) => {
    const published = Date.parse(alert.publishedAt || alert.createdAt || '') || Date.now();
    const ageDays = Math.max(0, (Date.now() - published) / 86400000);
    return Number(alert.score || 0) + profileScore(alert) - Math.min(2, ageDays * 0.35);
  };
  return [...items].sort((left, right) => {
    const preferenceDifference = personalizedScore(right) - personalizedScore(left);
    if (Math.abs(preferenceDifference) > 0.15) return preferenceDifference;
    return (Date.parse(right.publishedAt || right.createdAt || '') || 0) - (Date.parse(left.publishedAt || left.createdAt || '') || 0);
  });
}

export default function App() {
  if (window.location.pathname === '/' || window.location.pathname === '/blog') return <PublicBlog />;
  return <InternalApp />;
}

function InternalApp() {
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
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [feedback, setFeedback] = useState([]);
  const [savedAlertIds, setSavedAlertIds] = useState([]);
  const [savedPublications, setSavedPublications] = useState([]);
  const [feedDismissedIds, setFeedDismissedIds] = useState([]);
  const [preferences, setPreferences] = useState({ emailAlerts: true, actionAlerts: true, minimumScore: 8 });

  const isAdmin = String(user?.role || '').split(',').includes('admin');

  useEffect(() => {
    api.me().then((data) => {
      const reactions = data.reactions || [];
      const savedIds = data.savedAlertIds || [];
      setUser(data.user);
      setFeedback(reactions);
      setSavedAlertIds(savedIds);
      setSavedPublications(data.savedPublications || []);
      setFeedDismissedIds([...new Set([
        ...savedIds,
        ...reactions.filter((vote) => vote.value === 1).map((vote) => vote.alertId),
      ])]);
      setPreferences(data.preferences || { emailAlerts: true, actionAlerts: true, minimumScore: 8 });
    }).catch(() => setUser(null)).finally(() => setAuthLoading(false));
  }, []);

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

  useEffect(() => { if (user) loadData(); }, [user?.id]);

  useEffect(() => {
    const adminOnly = ['monitor', 'sources', 'settings'];
    if (user && !isAdmin && adminOnly.includes(activePage)) setActivePage('overview');
  }, [activePage, isAdmin, user]);

  const filteredAlerts = useMemo(() => {
    const term = search.toLocaleLowerCase('pt-BR').trim();
    const archivedPublications = [
      ...savedPublications.map((saved) => ({ publicationId: saved.publicationId, snapshot: saved.snapshot })),
      ...feedback.filter((vote) => vote.value === 1 && vote.snapshot).map((vote) => ({ publicationId: vote.alertId, snapshot: vote.snapshot })),
    ];
    const availableAlerts = ['saved', 'liked'].includes(relevance)
      ? [...alerts, ...archivedPublications
        .filter((archived) => !alerts.some((alert) => alert.id === archived.publicationId))
        .map((archived) => ({ ...archived.snapshot, id: archived.snapshot?.id || archived.publicationId }))]
      : alerts;
    return availableAlerts.filter((alert) => alert.isDemo === false && alert.score >= 6 && alert.officialUrl
      && alert.provenance?.analysisMode !== 'fast-triage').filter((alert) => {
      const searchable = [alert.title, alert.summary, alert.theme, alert.agency, ...(alert.taxes || [])].join(' ').toLocaleLowerCase('pt-BR');
      const relevanceMatch = relevance === 'all'
        || (relevance === 'urgent' ? alert.score >= 8
          : relevance === 'saved' ? savedAlertIds.includes(alert.id)
            : relevance === 'liked' ? feedback.some((vote) => vote.alertId === alert.id && vote.value === 1)
              : alert.score >= 6 && alert.score < 8);
      return (!term || searchable.includes(term)) && relevanceMatch;
    });
  }, [alerts, search, relevance, savedAlertIds, savedPublications, feedback]);

  const rankedAlerts = useMemo(() => rankFeedAlerts(filteredAlerts, feedback), [filteredAlerts, feedback]);
  const overviewAlerts = useMemo(() => rankFeedAlerts(alerts.filter((alert) => alert.isDemo === false
    && alert.score >= 6
    && alert.officialUrl
    && !feedDismissedIds.includes(alert.id)), feedback), [alerts, feedback, feedDismissedIds]);
  const opportunities = overviewAlerts.filter((alert) => alert.opportunity);
  const [title, subtitle] = pageTitles[activePage];

  const sendFeedback = async (alertId, rating) => {
    const alert = alerts.find((item) => item.id === alertId)
      || savedPublications.find((item) => item.publicationId === alertId)?.snapshot
      || feedback.find((item) => item.alertId === alertId)?.snapshot;
    if (!alert) return;
    const value = ['muito relevante', 'relevante'].includes(rating) ? 1 : -1;
    const vote = { alertId, value, agency: alert.agency, theme: alert.theme, taxes: alert.taxes || [], snapshot: alert };
    const previous = feedback;
    const next = [...feedback.filter((item) => item.alertId !== alertId), vote];
    setFeedback(next);
    try { await api.setReaction(alertId, value, { agency: alert.agency, theme: alert.theme, taxes: alert.taxes || [] }, alert); }
    catch (requestError) { setFeedback(previous); setError(requestError.message); }
  };

  const voteFor = (alertId) => feedback.find((item) => item.alertId === alertId)?.value || 0;
  const savedFor = (alertId) => savedAlertIds.includes(alertId);
  const toggleSaved = async (alertOrId) => {
    const alertId = typeof alertOrId === 'string' ? alertOrId : alertOrId?.id;
    const alert = typeof alertOrId === 'string'
      ? alerts.find((item) => item.id === alertId) || savedPublications.find((item) => item.publicationId === alertId)?.snapshot
      : alertOrId;
    if (!alertId || !alert) return;
    const wasSaved = savedFor(alertId);
    setSavedAlertIds((items) => wasSaved ? items.filter((id) => id !== alertId) : [...items, alertId]);
    setSavedPublications((items) => wasSaved
      ? items.filter((item) => item.publicationId !== alertId)
      : [{ publicationId: alertId, snapshot: alert, savedAt: new Date().toISOString() }, ...items.filter((item) => item.publicationId !== alertId)]);
    try { if (wasSaved) await api.removeSavedAlert(alertId); else await api.saveAlert(alert); }
    catch (requestError) {
      setSavedAlertIds((items) => wasSaved ? [...items, alertId] : items.filter((id) => id !== alertId));
      setSavedPublications((items) => wasSaved
        ? [{ publicationId: alertId, snapshot: alert, savedAt: new Date().toISOString() }, ...items]
        : items.filter((item) => item.publicationId !== alertId));
      setError(requestError.message);
    }
  };

  const logout = async () => {
    try { await api.logout(); } finally { window.location.assign('/login'); }
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

    if (activePage === 'sources' && isAdmin) return <SourcesPage />;

    if (activePage === 'monitor') return <MonitorPage onAlerts={() => { setActivePage('alerts'); loadData(); }} />;

    if (activePage === 'actions') return <ActionsPage />;

    if (activePage === 'settings' && isAdmin) return <SettingsPage />;

    if (activePage === 'reforma' || activePage === 'obrigacoes') return <SectionPage sectionId={activePage} onOpen={setSelectedAlert} onFeedback={sendFeedback} feedbackFor={voteFor} savedFor={savedFor} onSave={toggleSaved} />;

    if (activePage === 'feedback') return <FeedbackPage user={user} preferences={preferences} onPreferencesChange={setPreferences} />;

    if (activePage === 'alerts') return (
      <section className="page-section">
        <div className="filters filters--wide">
          <label><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tema, tributo ou órgão..." />{search && <button onClick={() => setSearch('')}><X size={15} /></button>}</label>
          <div className="segmented"><button className={relevance === 'all' ? 'active' : ''} onClick={() => setRelevance('all')}>Todos</button><button className={relevance === 'urgent' ? 'active' : ''} onClick={() => setRelevance('urgent')}>Alta prioridade</button><button className={relevance === 'relevant' ? 'active' : ''} onClick={() => setRelevance('relevant')}>Relevantes</button><button className={relevance === 'liked' ? 'active' : ''} onClick={() => setRelevance('liked')}><ThumbsUp size={15} /> Curtidos</button><button className={relevance === 'saved' ? 'active' : ''} onClick={() => setRelevance('saved')}><Bookmark size={15} /> Salvos</button></div>
        </div>
        <div className="section-heading"><div><span className="live-dot" /> Monitoramento ativo</div><small>{filteredAlerts.length} resultados</small></div>
        <div className="alerts-list">{rankedAlerts.map((alert) => <AlertCard key={alert.id} alert={alert} onOpen={setSelectedAlert} onFeedback={(value) => sendFeedback(alert.id, value === 1 ? 'muito relevante' : 'irrelevante')} feedback={voteFor(alert.id)} saved={savedFor(alert.id)} onSave={() => toggleSaved(alert)} />)}</div>
        {!filteredAlerts.length && <div className="empty-state"><FileSearch size={29} /><h3>Nenhum alerta encontrado</h3><p>Tente remover um filtro ou buscar outro termo.</p></div>}
      </section>
    );

    return (
      <>
        <section className="metrics-grid">
          <MetricCard icon={FileSearch} value={dashboard.metrics.relevant} label="Itens relevantes" detail="Nota 6 ou superior" tone="blue" onClick={() => { setActivePage('alerts'); setRelevance('all'); }} />
          <MetricCard icon={BellRing} value={dashboard.metrics.urgent} label="Alertas urgentes" detail="Nota 8 ou superior" tone="red" onClick={() => { setActivePage('alerts'); setRelevance('urgent'); }} />
          <MetricCard icon={CircleDollarSign} value={dashboard.metrics.opportunities} label="Oportunidades" detail="Para análise jurídica" tone="gold" onClick={() => setActivePage('opportunities')} />
          <MetricCard icon={Building2} value={dashboard.metrics.monitoredSources} label="Fontes no radar" detail="Fontes oficiais e jornalísticas" tone="teal" onClick={isAdmin ? () => setActivePage('sources') : undefined} />
        </section>

        <EditorialBriefing alerts={overviewAlerts} onOpen={setSelectedAlert} />

        <section className="panel overview-feed">
          <div className="panel__heading"><div><h2>Feed tributário personalizado</h2><p>Publicações mais novas primeiro; seus votos ajudam a aperfeiçoar a relevância</p></div><span className="live-dot" /></div>
          <div className="alerts-list">{overviewAlerts.map((alert) => <AlertCard key={alert.id} alert={alert} onOpen={setSelectedAlert} onFeedback={(value) => sendFeedback(alert.id, value === 1 ? 'muito relevante' : 'irrelevante')} feedback={voteFor(alert.id)} saved={savedFor(alert.id)} onSave={() => toggleSaved(alert)} />)}</div>
          {!overviewAlerts.length && <div className="empty-state"><FileSearch size={29} /><h3>Você já organizou todas as publicações atuais</h3><p>Itens curtidos ficam em Alertas › Curtidos e os salvos em Alertas › Salvos.</p></div>}
        </section>
      </>
    );
  };

  if (authLoading) return <div className="auth-loading"><LoadingState /></div>;
  if (!user) return <LoginPage />;

  return (
    <div className="app-shell">
      <Sidebar active={activePage} onChange={setActivePage} open={sidebarOpen} onClose={() => setSidebarOpen(false)} user={user} onLogout={logout} />
      {sidebarOpen && <div className="mobile-backdrop" onClick={() => setSidebarOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)}><Menu /></button>
          <div className="topbar__date"><CalendarDays size={17} /><span>{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date())}</span></div>
          <div className="topbar__right"><span className="environment"><ShieldCheck size={16} /> Fontes verificadas</span><button className="icon-button notification" onClick={() => { setActivePage('alerts'); setRelevance('urgent'); }} aria-label="Abrir alertas nota 8 ou superior" title="Alertas nota 8 ou superior"><BellRing size={20} /><i /></button></div>
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
      <DetailPanel alert={selectedAlert} onClose={() => setSelectedAlert(null)} onFeedback={sendFeedback} saved={selectedAlert ? savedFor(selectedAlert.id) : false} onSave={toggleSaved} />
    </div>
  );
}
