import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, ExternalLink, Gavel, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api } from '../api.js';

function formatDate(value, withTime = true) {
  if (!value) return 'Ainda não consultado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(date);
}

function sourceUrl(court) {
  if (court === 'stf') return 'https://portal.stf.jus.br/processos/';
  return `https://api-publica.datajud.cnj.jus.br/api_publica_${court}/_search`;
}

export function ActionsPage() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({ label: '', query: '', court: 'stj' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [statusData, actionsData] = await Promise.all([api.actionsStatus(), api.actions()]);
      setStatus(statusData);
      setItems(actionsData.items || []);
    } catch (requestError) {
      setError(requestError.message);
      try { setStatus(await api.actionsStatus()); } catch { /* status is shown below when unavailable */ }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const sortedItems = useMemo(() => [...items].sort((a, b) => new Date(b.latestMovement?.date || b.updatedAt || 0) - new Date(a.latestMovement?.date || a.updatedAt || 0)), [items]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const result = editingId ? await api.updateAction(editingId, form) : await api.createAction(form);
      setItems((current) => editingId
        ? current.map((item) => item.id === result.item.id ? result.item : item)
        : [result.item, ...current.filter((item) => item.id !== result.item.id)]);
      setForm({ label: '', query: '', court: form.court });
      setEditingId('');
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  const edit = (item) => {
    setEditingId(item.id);
    setForm({ label: item.label || '', query: item.query || '', court: item.court || 'stj' });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingId('');
    setForm({ label: '', query: '', court: form.court });
  };

  const refresh = async (id) => {
    setRefreshing(id); setError('');
    try {
      const result = await api.refreshAction(id);
      setItems((current) => current.map((item) => item.id === id ? result.item : item));
    } catch (requestError) { setError(requestError.message); }
    finally { setRefreshing(''); }
  };

  const refreshAll = async () => {
    setRefreshing('all'); setError('');
    try {
      const result = await api.refreshAllActions();
      setItems(result.items || []);
    } catch (requestError) { setError(requestError.message); }
    finally { setRefreshing(''); }
  };

  const remove = async (id) => {
    if (!window.confirm('Remover este acompanhamento?')) return;
    setError('');
    try { await api.removeAction(id); setItems((current) => current.filter((item) => item.id !== id)); }
    catch (requestError) { setError(requestError.message); }
  };

  if (loading) return <div className="loading"><span /><p>Carregando acompanhamentos...</p></div>;

  return (
    <section className="actions-page">
      <div className="actions-intro">
        <div>
          <span><Gavel size={16} /> Dados processuais oficiais</span>
          <h2>Acompanhe temas e processos sem esquecer do andamento</h2>
          <p>Cadastre um tema tributário, como ICMS, ou um número CNJ. A cada atualização, o Informer compara a movimentação mais recente e mantém um histórico resumido.</p>
        </div>
        <button className="refresh-button actions-refresh" onClick={refreshAll} disabled={refreshing === 'all' || !items.length}><RefreshCw className={refreshing === 'all' ? 'spinning' : ''} size={16} />Atualizar tudo</button>
      </div>

      <div className="actions-grid">
        <form className="panel action-form" onSubmit={submit}>
          <div className="panel__heading"><div><h2>{editingId ? 'Editar acompanhamento' : 'Novo acompanhamento'}</h2><p>Uma consulta por tribunal</p></div>{editingId ? <button type="button" className="icon-button" title="Cancelar edição" onClick={cancelEdit}><X size={18} /></button> : <Plus size={20} />}</div>
          <label>Nome do acompanhamento<input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Tema ICMS" required maxLength={120} /></label>
          <label>Tema, processo ou link oficial<input value={form.query} onChange={(event) => setForm({ ...form, query: event.target.value })} placeholder={form.court === 'stf' ? 'https://portal.stf.jus.br/processos/detalhe.asp?incidente=...' : 'ICMS ou 0000000-00.0000.0.00.0000'} required maxLength={300} /><small>{form.court === 'stf' ? 'No STF, cole o link da página oficial do processo; o portal fornece andamentos e decisões.' : 'Para processo, use o número CNJ completo; para tema, use termos objetivos.'}</small></label>
          <label>Tribunal<select value={form.court} onChange={(event) => setForm({ ...form, court: event.target.value })}>{(status?.courts || []).map((court) => <option value={court.value} key={court.value}>{court.label}</option>)}</select><small>{form.court === 'stf' ? 'O STF é consultado diretamente no portal oficial, pois não possui índice público no DataJud.' : 'O número CNJ completo identifica automaticamente o tribunal quando essa informação está disponível.'}</small></label>
          <button className="primary-button" disabled={saving || !status?.enabled}><Search size={17} />{saving ? 'Consultando fonte oficial...' : editingId ? 'Salvar e consultar novamente' : 'Adicionar e consultar'}</button>
          {!status?.enabled && <p className="form-hint">A função será habilitada quando DATAJUD_API_KEY, chave de criptografia e persistência do backend estiverem configuradas.</p>}
        </form>

        <div className="actions-status panel">
          <div className="panel__heading"><div><h2>Conexão da fonte</h2><p>CNJ · API Pública do DataJud</p></div><Gavel size={20} /></div>
          <div className="action-status-row"><span className={status?.datajudConfigured ? 'status-icon status-icon--ok' : 'status-icon status-icon--off'}>{status?.datajudConfigured ? <CheckCircle2 /> : <AlertCircle />}</span><div><strong>API DataJud</strong><small>{status?.datajudConfigured ? 'Chave presente no backend' : 'DATAJUD_API_KEY não configurada'}</small></div><em>{status?.datajudConfigured ? 'Pronta' : 'Pendente'}</em></div>
          <div className="action-status-row"><span className={status?.persistenceConfigured ? 'status-icon status-icon--ok' : 'status-icon status-icon--off'}>{status?.persistenceConfigured ? <CheckCircle2 /> : <AlertCircle />}</span><div><strong>Persistência segura</strong><small>{status?.persistenceConfigured ? 'Acompanhamentos criptografados' : 'Configure a chave e o armazenamento do backend'}</small></div><em>{status?.persistenceConfigured ? 'Pronta' : 'Pendente'}</em></div>
          <a className="datajud-link" href="https://datajud-wiki.cnj.jus.br/api-publica/" target="_blank" rel="noreferrer">Documentação oficial do DataJud <ExternalLink size={13} /></a>
        </div>
      </div>

      {error && <div className="inline-error"><AlertCircle size={16} />{error}<button onClick={() => setError('')}>Fechar</button></div>}

      <div className="actions-list-heading"><div><span className="live-dot" /> Acompanhamentos ativos</div><small>{sortedItems.length} cadastrados</small></div>
      {!sortedItems.length && <div className="empty-state"><Gavel size={29} /><h3>Nenhum acompanhamento cadastrado</h3><p>Adicione o tema ou processo que deseja observar.</p></div>}
      <div className="tracked-actions-list">
        {sortedItems.map((item) => (
          <article className="tracked-action" key={item.id}>
            <div className="tracked-action__top"><div><span className="tracked-action__court">{item.court?.toUpperCase()} · {item.court === 'stf' ? 'Portal oficial' : 'DataJud'}</span><h3>{item.label}</h3><p className="tracked-action__query">Busca: <strong>{item.query}</strong></p></div><div className="tracked-action__buttons"><button className="icon-button" title="Editar acompanhamento" onClick={() => edit(item)}><Pencil size={16} /></button><button className="icon-button" title="Atualizar acompanhamento" onClick={() => refresh(item.id)} disabled={refreshing === item.id}><RefreshCw className={refreshing === item.id ? 'spinning' : ''} size={17} /></button><button className="icon-button danger-button" title="Remover acompanhamento" onClick={() => remove(item.id)}><Trash2 size={17} /></button></div></div>
            <div className="tracked-action__status"><span className={item.lastError ? 'status-pill status-pill--error' : 'status-pill'}>{item.lastError ? 'Erro na consulta' : item.status || 'Aguardando consulta'}</span><span><Clock3 size={13} /> Atualizado em {formatDate(item.lastCheckedAt || item.updatedAt)}</span></div>
            {item.lastError && <p className="tracked-action__error"><AlertCircle size={14} />{item.lastError}</p>}
            {item.latestMovement && <div className="latest-movement"><small>ÚLTIMA MOVIMENTAÇÃO · {formatDate(item.latestMovement.date)}</small><strong>{item.latestMovement.name}</strong>{item.latestMovement.complement && <p>{item.latestMovement.complement}</p>}<span>{item.latestMovement.processNumber || 'Tema consultado'}{item.latestMovement.court ? ` · ${item.latestMovement.court}` : ''}</span></div>}
            {!!item.movements?.length && <details><summary>Ver histórico ({item.movements.length})</summary><ol className="movement-history">{item.movements.slice(0, 12).map((movement) => <li key={movement.id}><time>{formatDate(movement.date)}</time><div><strong>{movement.name}</strong>{movement.complement && <small>{movement.complement}</small>}</div></li>)}</ol></details>}
            <a className="tracked-action__source" href={item.sourceUrl || sourceUrl(item.court)} target="_blank" rel="noreferrer">{item.court === 'stf' ? 'Abrir processo oficial do STF' : `Abrir índice oficial do ${item.court?.toUpperCase()}`} <ExternalLink size={12} /></a>
          </article>
        ))}
      </div>
    </section>
  );
}
