import { Activity, AlertTriangle, CalendarSearch, CheckCircle2, Clock3, ExternalLink, FileSearch, LoaderCircle, Play, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const dateTime = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Ainda não executada';
const dateOnly = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : '';
const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const statusLabels = { pending: 'Na fila', analyzing: 'Analisando', analyzed: 'Publicado', discarded: 'Sem relevância', error: 'Erro' };
const coverageLabels = { exact: 'arquivo/API da data', 'date-filtered': 'filtrado pela data', mixed: 'decisões da data + notícias do índice', 'current-index': 'índice atual' };

export function MonitorPage({ onAlerts }) {
  const [status, setStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [targetDate, setTargetDate] = useState(today);
  const [candidateDate, setCandidateDate] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async (dateFilter = candidateDate) => {
    try {
      const [statusData, runData, candidateData] = await Promise.all([api.monitorStatus(), api.monitorRuns(), api.monitorCandidates('', dateFilter)]);
      setStatus(statusData); setRuns(runData.items); setCandidates(candidateData.items); setError('');
    } catch (requestError) { setError(requestError.message); }
  };

  useEffect(() => {
    load(candidateDate);
    const interval = setInterval(() => load(candidateDate), status?.runtime.running ? 3000 : 10000);
    return () => clearInterval(interval);
  }, [status?.runtime.running, candidateDate]);

  const start = async (analyze, date = '') => {
    try {
      await api.runMonitor(analyze, date);
      if (date) {
        setCandidateDate(date);
        setNotice(`Busca iniciada para ${dateOnly(date)}. Notícias, atos, normas, proposições e decisões encontrados serão colocados na fila.`);
      } else {
        setNotice('Varredura geral iniciada.');
      }
      await load(date || candidateDate);
    } catch (requestError) { setError(requestError.message); }
  };

  const clearDateFilter = () => {
    setCandidateDate('');
    setNotice('');
  };

  if (!status) return <div className="loading"><span /><p>Carregando o monitor...</p></div>;
  const latest = runs[0];
  const hosted = !status.runtime.enabled;

  return (
    <section className="monitor-page">
      <div className="monitor-hero">
        <div className={`monitor-pulse ${status.runtime.running ? 'monitor-pulse--active' : ''}`}><Activity /></div>
        <div><small>{hosted ? 'Agendamento hospedado ativo' : 'Agendamento local ativo'}</small><h2>{status.runtime.running ? 'Varredura em andamento' : 'Monitor oficial em espera'}</h2><p>{status.runtime.running ? `${status.runtime.phase === 'analysis' ? 'Analisando documentos' : 'Consultando fontes'}${status.runtime.currentSource ? ` — ${status.runtime.currentSource}` : ''}` : hosted ? 'O GitHub consulta e analisa as fontes aproximadamente a cada 20 minutos.' : `Próximo ciclo: ${dateTime(status.nextRunAt)} · intervalo de ${status.runtime.intervalMinutes} minutos`}</p></div>
        <div className="monitor-actions">{hosted ? <a className="primary" href="https://github.com/eb9101580-oss/informer-tributario/actions/workflows/tax-monitor.yml" target="_blank" rel="noreferrer"><Play size={16} />Fazer varredura no GitHub <ExternalLink size={14} /></a> : <><button disabled={status.runtime.running} onClick={() => start(false)}><RefreshCw size={16} />Só descobrir</button><button className="primary" disabled={status.runtime.running} onClick={() => start(true)}>{status.runtime.running ? <LoaderCircle className="spinning" size={16} /> : <Play size={16} />}Varrer e analisar</button></>}</div>
      </div>

      <div className="panel monitor-date-search">
        <div className="monitor-date-search__icon"><CalendarSearch /></div>
        <div className="monitor-date-search__copy">
          <h2>Buscar publicações por data</h2>
          <p>Puxa notícias, atos, normas, proposições e decisões tributárias disponíveis nas fontes monitoradas.</p>
        </div>
        <label className="monitor-date-field"><span>Data da publicação</span><input type="date" max={today()} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
        <button className="primary monitor-date-submit" disabled={hosted || status.runtime.running || !targetDate} onClick={() => start(false, targetDate)}>{status.runtime.running ? <LoaderCircle className="spinning" size={16} /> : <CalendarSearch size={16} />}Puxar publicações</button>
        <p className="monitor-date-help">STF, STJ, Câmara e os seis TRFs permitem consulta judicial pela data. Nas páginas de notícias, a busca filtra as publicações datadas que o portal ainda exibe.</p>
        {hosted && <p className="monitor-date-warning"><AlertTriangle size={14} />A busca manual exige que o front esteja conectado ao backend persistente da sua máquina.</p>}
      </div>

      {error && <div className="collector-error"><AlertTriangle size={17} />{error}</div>}
      {notice && <div className="monitor-notice"><CheckCircle2 size={17} />{notice}</div>}
      <div className="monitor-metrics">
        <div><FileSearch /><strong>{status.sources}</strong><span>fontes monitoradas</span></div>
        <div><Clock3 /><strong>{status.queued}</strong><span>documentos na fila</span></div>
        <div><CheckCircle2 /><strong>{status.analyzed}</strong><span>alertas reais publicados</span></div>
        <div><AlertTriangle /><strong>{status.errors}</strong><span>itens com erro</span></div>
      </div>
      <div className="monitor-grid">
        <div className="panel">
          <div className="panel__heading"><div><h2>{candidateDate ? `Publicações de ${dateOnly(candidateDate)}` : 'Documentos descobertos'}</h2><p>{candidateDate ? 'Resultados tributários encontrados em todas as categorias' : 'Links oficiais filtrados por assunto tributário'}</p></div>{candidateDate ? <button className="text-button monitor-filter-clear" onClick={clearDateFilter}><X size={13} />Ver fila inteira</button> : <button className="text-button" onClick={onAlerts}>Abrir alertas</button>}</div>
          <div className="candidate-list">
            {candidates.slice(0, 18).map((item) => <div className="candidate" key={item.id}><span className={`candidate__status candidate__status--${item.status}`}>{statusLabels[item.status] || item.status}</span><div><strong>{item.title}</strong><small>{item.sourceAcronym} · {item.documentKind} · Publicado em {dateTime(item.publishedAt || item.discoveredAt)} · coletado em {dateTime(item.discoveredAt)}</small>{item.error && <em>{item.error}</em>}</div><a href={item.url} target="_blank" rel="noreferrer" aria-label="Abrir documento oficial"><ExternalLink size={15} /></a></div>)}
            {!candidates.length && <p className="monitor-empty">{candidateDate ? `Nenhuma publicação tributária de ${dateOnly(candidateDate)} foi encontrada até agora.` : 'Execute a primeira varredura para preencher a fila.'}</p>}
          </div>
        </div>
        <aside className="panel monitor-runs">
          <div className="panel__heading"><div><h2>Histórico de ciclos</h2><p>Sucesso e falha por fonte</p></div></div>
          {runs.map((run) => <details key={run.id} open={run.id === latest?.id}><summary><span><strong>{dateTime(run.startedAt)}</strong><small>{run.targetDate ? `busca de ${dateOnly(run.targetDate)}` : run.trigger} · {run.discovered} novos · {run.published} publicados</small></span><em>{run.errors ? `${run.errors} erros` : 'Concluído'}</em></summary><div className="source-run-list">{run.sources.map((source) => <div key={source.id}><span className={source.status === 'ok' ? 'ok' : 'fail'} /><b>{source.acronym}</b><small>{source.status === 'ok' ? `${source.found} encontrados${source.dateCoverage ? ` · ${coverageLabels[source.dateCoverage] || source.dateCoverage}` : ''}` : source.message}</small></div>)}</div></details>)}
          {!runs.length && <p className="monitor-empty">Nenhum ciclo registrado.</p>}
        </aside>
      </div>
    </section>
  );
}
