import { CheckCircle2, Link2, MessageSquareText, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

function SuggestionList({ items, admin, onStatus }) {
  if (!items.length) return <p className="suggestions-empty">Nenhuma sugestão registrada ainda.</p>;
  return <div className="suggestions-list">{items.map((item) => (
    <article key={item.id}>
      <div><span>{item.kind === 'source' ? <Link2 size={15} /> : <MessageSquareText size={15} />}{item.kind === 'source' ? 'Fonte sugerida' : 'Sugestão'}</span><em className={`suggestion-status suggestion-status--${item.status}`}>{item.status === 'pending' ? 'Pendente' : item.status === 'accepted' ? 'Aceita' : item.status === 'rejected' ? 'Rejeitada' : 'Em análise'}</em></div>
      <h3>{item.title || (item.kind === 'source' ? item.url : 'Sugestão enviada')}</h3>
      {item.url && <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>}
      <p>{item.message}</p>
      <small>{item.userName || item.userEmail || 'Você'} · {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.createdAt))}</small>
      {admin && !['accepted', 'rejected'].includes(item.status) && <div className="suggestion-actions"><button onClick={() => onStatus(item.id, 'accepted')}>Aceitar</button>{item.status !== 'reviewing' && <button onClick={() => onStatus(item.id, 'reviewing')}>Colocar em análise</button>}<button onClick={() => onStatus(item.id, 'rejected')}>Rejeitar</button></div>}
    </article>
  ))}</div>;
}

export function FeedbackPage({ user, preferences, onPreferencesChange }) {
  const [kind, setKind] = useState('suggestion');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isAdmin = String(user?.role || '').split(',').map((role) => role.trim()).includes('admin');

  const load = async () => {
    try {
      const data = isAdmin ? await api.adminSuggestions() : await api.suggestions();
      setItems(data.items || []);
    } catch (error) { setNotice(error.message); }
  };
  useEffect(() => { load(); }, [isAdmin]);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice('');
    try {
      await api.createSuggestion({ kind, title, message, ...(kind === 'source' ? { url } : {}) });
      setTitle(''); setMessage(''); setUrl('');
      setNotice(kind === 'source' ? 'Fonte enviada para validação do administrador.' : 'Sugestão enviada ao administrador.');
      await load();
    } catch (error) { setNotice(error.message); }
    finally { setSubmitting(false); }
  };

  const updateStatus = async (id, status) => {
    try { await api.updateSuggestion(id, { status }); await load(); }
    catch (error) { setNotice(error.message); }
  };

  const updatePreference = async (field, value) => {
    setNotice('');
    try {
      const result = await api.updatePreferences({ [field]: value });
      onPreferencesChange?.(result.preferences);
      setNotice('Preferências de e-mail atualizadas.');
    } catch (error) { setNotice(error.message); }
  };

  return (
    <section className="page-section feedback-page">
      <div className="feedback-intro"><span><MessageSquareText /></span><div><h2>{isAdmin ? 'Sugestões da equipe' : 'Ajude o Informer a ficar melhor'}</h2><p>{isAdmin ? 'Leia e acompanhe as sugestões enviadas pelos usuários.' : 'Conte o que podemos melhorar ou indique uma fonte tributária que merece entrar no radar.'}</p></div></div>
      {!isAdmin && <form className="suggestion-form" onSubmit={submit}>
        <div className="segmented"><button type="button" className={kind === 'suggestion' ? 'active' : ''} onClick={() => setKind('suggestion')}><MessageSquareText size={16} /> Sugestão</button><button type="button" className={kind === 'source' ? 'active' : ''} onClick={() => setKind('source')}><Link2 size={16} /> Indicar fonte</button></div>
        <label>Título<input required minLength="3" maxLength="120" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === 'source' ? 'Nome da fonte' : 'Resumo da sugestão'} /></label>
        {kind === 'source' && <label>Endereço HTTPS<input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://exemplo.com.br/tributario" /></label>}
        <label>Detalhes<textarea required minLength="10" maxLength="2000" rows="5" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Explique o que gostaria de ver no sistema..." /></label>
        <div><span><ShieldCheck size={16} /> Fontes indicadas passam por validação antes da coleta.</span><button className="primary" disabled={submitting}><Send size={16} />{submitting ? 'Enviando...' : 'Enviar'}</button></div>
      </form>}
      {!isAdmin && <section className="notification-preferences">
        <div><span><ShieldCheck size={17} /> Notificações</span><h2>Seus alertas por e-mail</h2><p>O padrão é avisar sobre publicações com nota {preferences?.minimumScore || 8} ou superior e sobre novas movimentações das suas ações.</p></div>
        <label><input type="checkbox" checked={preferences?.emailAlerts !== false} onChange={(event) => updatePreference('emailAlerts', event.target.checked)} /><span><strong>Receber alertas por e-mail</strong><small>Controle geral dos avisos enviados à sua conta.</small></span></label>
        <label className={preferences?.emailAlerts === false ? 'disabled' : ''}><input type="checkbox" disabled={preferences?.emailAlerts === false} checked={preferences?.actionAlerts !== false} onChange={(event) => updatePreference('actionAlerts', event.target.checked)} /><span><strong>Movimentações processuais</strong><small>Avisar quando uma ação acompanhada tiver andamento novo.</small></span></label>
      </section>}
      {notice && <div className="feedback-notice"><CheckCircle2 size={17} />{notice}</div>}
      <div className="section-heading"><div>{isAdmin ? 'Caixa de entrada' : 'Meus envios'}</div><small>{items.length} registro(s)</small></div>
      <SuggestionList items={items} admin={isAdmin} onStatus={updateStatus} />
    </section>
  );
}
