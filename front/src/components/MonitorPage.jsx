import { Activity, AlertTriangle, CheckCircle2, Clock3, ExternalLink, FileSearch, LoaderCircle, Play, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const dateTime = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Ainda não executada';
const statusLabels = { pending: 'Na fila', analyzing: 'Analisando', analyzed: 'Publicado', discarded: 'Sem relevância', error: 'Erro' };

export function MonitorPage({ onAlerts }) {
  const [status, setStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [statusData, runData, candidateData] = await Promise.all([api.monitorStatus(), api.monitorRuns(), api.monitorCandidates()]);
      setStatus(statusData); setRuns(runData.items); setCandidates(candidateData.items); setError('');
    } catch (requestError) { setError(requestError.message); }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, status?.runtime.running ? 3000 : 10000);
    return () => clearInterval(interval);
  }, [status?.runtime.running]);

  const start = async (analyze) => {
    try { await api.runMonitor(analyze); await load(); } catch (requestError) { setError(requestError.message); }
  };

  if (!status) return <div className="loading"><span /><p>Carregando o monitor...</p></div>;
  const latest = runs[0];
  const hosted = !status.runtime.enabled;

  return (
    <section className="monitor-page">
      <div className="monitor-hero">
        <div className={`monitor-pulse ${status.runtime.running ? 'monitor-pulse--active' : ''}`}><Activity /></div>
        <div><small>{hosted ? 'Agendamento hospedado ativo' : status.runtime.enabled ? 'Agendamento local ativo' : 'Agendamento desativado'}</small><h2>{status.runtime.running ? 'Varredura em andamento' : 'Monitor oficial em espera'}</h2><p>{status.runtime.running ? `${status.runtime.phase === 'analysis' ? 'Analisando documentos' : 'Consultando fontes'}${status.runtime.currentSource ? ` — ${status.runtime.currentSource}` : ''}` : hosted ? 'O GitHub consulta e analisa as fontes aproximadamente a cada 20 minutos.' : `Próximo ciclo: ${dateTime(status.nextRunAt)} · intervalo de ${status.runtime.intervalMinutes} minutos`}</p></div>
        <div className="monitor-actions">{hosted ? <a className="primary" href="https://github.com/eb9101580-oss/informer-tributario/actions/workflows/tax-monitor.yml" target="_blank" rel="noreferrer"><Play size={16} />Fazer varredura no GitHub <ExternalLink size={14} /></a> : <><button disabled={status.runtime.running} onClick={() => start(false)}><RefreshCw size={16} />Só descobrir</button><button className="primary" disabled={status.runtime.running} onClick={() => start(true)}>{status.runtime.running ? <LoaderCircle className="spinning" size={16} /> : <Play size={16} />}Varrer e analisar</button></>}</div>
      </div>
      {error && <div className="collector-error"><AlertTriangle size={17} />{error}</div>}
      <div className="monitor-metrics">
        <div><FileSearch /><strong>{status.sources}</strong><span>fontes monitoradas</span></div>
        <div><Clock3 /><strong>{status.queued}</strong><span>documentos na fila</span></div>
        <div><CheckCircle2 /><strong>{status.analyzed}</strong><span>alertas reais publicados</span></div>
        <div><AlertTriangle /><strong>{status.errors}</strong><span>itens com erro</span></div>
      </div>
      <div className="monitor-grid">
        <div className="panel">
          <div className="panel__heading"><div><h2>Documentos descobertos</h2><p>Links oficiais filtrados por assunto tributário</p></div><button className="text-button" onClick={onAlerts}>Abrir alertas</button></div>
          <div className="candidate-list">
            {candidates.slice(0, 18).map((item) => <div className="candidate" key={item.id}><span className={`candidate__status candidate__status--${item.status}`}>{statusLabels[item.status] || item.status}</span><div><strong>{item.title}</strong><small>{item.sourceAcronym} · {item.documentKind} · Publicado em {dateTime(item.publishedAt || item.discoveredAt)} · coletado em {dateTime(item.discoveredAt)}</small>{item.error && <em>{item.error}</em>}</div><a href={item.url} target="_blank" rel="noreferrer" aria-label="Abrir documento oficial"><ExternalLink size={15} /></a></div>)}
            {!candidates.length && <p className="monitor-empty">Execute a primeira varredura para preencher a fila.</p>}
          </div>
        </div>
        <aside className="panel monitor-runs">
          <div className="panel__heading"><div><h2>Histórico de ciclos</h2><p>Sucesso e falha por fonte</p></div></div>
          {runs.map((run) => <details key={run.id} open={run.id === latest?.id}><summary><span><strong>{dateTime(run.startedAt)}</strong><small>{run.trigger} · {run.discovered} novos · {run.published} publicados</small></span><em>{run.errors ? `${run.errors} erros` : 'Concluído'}</em></summary><div className="source-run-list">{run.sources.map((source) => <div key={source.id}><span className={source.status === 'ok' ? 'ok' : 'fail'} /><b>{source.acronym}</b><small>{source.status === 'ok' ? `${source.found} encontrados` : source.message}</small></div>)}</div></details>)}
          {!runs.length && <p className="monitor-empty">Nenhum ciclo registrado.</p>}
        </aside>
      </div>
    </section>
  );
}
