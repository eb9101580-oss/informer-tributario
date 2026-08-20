import { BellRing, CheckCircle2, Mail, RefreshCw, ShieldAlert, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function SettingsPage() {
  const [status, setStatus] = useState(null);
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [delivery, userData] = await Promise.all([api.subscriptionStatus(), api.adminUsers()]);
      setStatus(delivery);
      setUsers(userData.items || userData.users || []);
      setMessage('');
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const invite = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const result = await api.inviteUser({ email, name, role: 'user' });
      setEmail(''); setName('');
      setMessage(result.message || 'Usuário criado e convite enviado por e-mail.');
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setSubmitting(false); }
  };

  const toggleUser = async (user) => {
    try { await api.updateUser(user.id, { active: user.active === false }); await load(); }
    catch (error) { setMessage(error.message); }
  };

  const ready = Boolean(status?.emailConfigured);
  return (
    <section className="page-section settings-page">
      <div className="settings-hero"><div><span><Users size={17} /> Administração de acesso</span><h2>Usuários do Informer</h2><p>Crie contas somente por convite e controle quem pode entrar na área interna.</p></div><button className="icon-button" onClick={load} disabled={loading} aria-label="Atualizar"><RefreshCw className={loading ? 'spinning' : ''} size={18} /></button></div>

      <form className="user-invite-form" onSubmit={invite}>
        <div><UserPlus size={21} /><span><strong>Convidar novo usuário</strong><small>Ele receberá um link de acesso seguro no e-mail informado.</small></span></div>
        <label>Nome<input required minLength="2" maxLength="100" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome completo" /></label>
        <label>E-mail<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="usuario@empresa.com.br" /></label>
        <button className="primary" disabled={submitting}><Mail size={16} />{submitting ? 'Enviando...' : 'Criar e convidar'}</button>
      </form>
      {message && <div className="settings-message">{message}</div>}

      <div className="users-table-wrap"><table className="users-table"><thead><tr><th>Usuário</th><th>Papel</th><th>Status</th><th>Ação</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name || 'Sem nome'}</strong><small>{user.email}</small></td><td>{user.role === 'admin' ? 'Administrador' : 'Usuário'}</td><td><span className={user.active === false ? 'user-status user-status--off' : 'user-status'}>{user.active === false ? 'Bloqueado' : 'Ativo'}</span></td><td>{user.role !== 'admin' && <button onClick={() => toggleUser(user)}>{user.active === false ? 'Reativar' : 'Bloquear'}</button>}</td></tr>)}</tbody></table>{!users.length && !loading && <p>Nenhum usuário cadastrado.</p>}</div>

      <div className={`settings-status ${ready ? 'settings-status--ready' : ''}`}>{ready ? <CheckCircle2 size={19} /> : <ShieldAlert size={19} />}<div><strong>{ready ? 'Resend pronto para enviar' : 'Envio de e-mail pendente'}</strong><p>{ready ? 'Convites, alertas nota alta e movimentações processuais podem ser entregues.' : 'Configure RESEND_API_KEY e ALERTS_FROM_EMAIL com um domínio verificado.'}</p></div><BellRing size={20} /></div>
    </section>
  );
}
