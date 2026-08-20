import { BellRing, CheckCircle2, KeyRound, RefreshCw, ShieldAlert, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function SettingsPage() {
  const [status, setStatus] = useState(null);
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [resetting, setResetting] = useState(null);
  const [newPassword, setNewPassword] = useState('');
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

  const createAccount = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const result = await api.createUser({ email, name, password, role: 'user' });
      setEmail(''); setName(''); setPassword('');
      setMessage(result.message || 'Conta criada com sucesso.');
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setSubmitting(false); }
  };

  const toggleUser = async (user) => {
    try { await api.updateUser(user.id, { active: user.active === false }); await load(); }
    catch (error) { setMessage(error.message); }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    try {
      const result = await api.resetUserPassword(resetting.id, newPassword);
      setMessage(result.message);
      setResetting(null); setNewPassword('');
    } catch (error) { setMessage(error.message); }
  };

  const ready = Boolean(status?.emailConfigured);
  return (
    <section className="page-section settings-page">
      <div className="settings-hero"><div><span><Users size={17} /> Administração de acesso</span><h2>Usuários do Informer</h2><p>Crie contas com e-mail e senha e controle quem pode entrar na área interna.</p></div><button className="icon-button" onClick={load} disabled={loading} aria-label="Atualizar"><RefreshCw className={loading ? 'spinning' : ''} size={18} /></button></div>

      <form className="user-invite-form" onSubmit={createAccount}>
        <div><UserPlus size={21} /><span><strong>Criar novo usuário</strong><small>Defina uma senha inicial e entregue-a por um canal seguro.</small></span></div>
        <label>Nome<input required minLength="2" maxLength="100" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome completo" /></label>
        <label>E-mail<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="usuario@empresa.com.br" /></label>
        <label>Senha inicial<input required type="password" autoComplete="new-password" minLength="10" maxLength="128" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 10 caracteres" /></label>
        <button className="primary" disabled={submitting}><UserPlus size={16} />{submitting ? 'Criando...' : 'Criar conta'}</button>
      </form>
      {message && <div className="settings-message">{message}</div>}

      <div className="users-table-wrap"><table className="users-table"><thead><tr><th>Usuário</th><th>Papel</th><th>Status</th><th>Ações</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name || 'Sem nome'}</strong><small>{user.email}</small></td><td>{user.role === 'admin' ? 'Administrador' : 'Usuário'}</td><td><span className={user.active === false ? 'user-status user-status--off' : 'user-status'}>{user.active === false ? 'Bloqueado' : 'Ativo'}</span></td><td><div className="user-row-actions"><button onClick={() => { setResetting(user); setNewPassword(''); }}><KeyRound size={13} /> Nova senha</button>{user.role !== 'admin' && <button onClick={() => toggleUser(user)}>{user.active === false ? 'Reativar' : 'Bloquear'}</button>}</div></td></tr>)}</tbody></table>{!users.length && !loading && <p>Nenhum usuário cadastrado.</p>}</div>

      {resetting && <form className="password-reset-form" onSubmit={resetPassword}><div><KeyRound size={18} /><span><strong>Redefinir senha</strong><small>{resetting.name} · {resetting.email}</small></span></div><label>Nova senha<input required type="password" autoComplete="new-password" minLength="10" maxLength="128" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Mínimo de 10 caracteres" /></label><button className="primary">Salvar nova senha</button><button type="button" onClick={() => setResetting(null)}>Cancelar</button></form>}

      <div className={`settings-status ${ready ? 'settings-status--ready' : ''}`}>{ready ? <CheckCircle2 size={19} /> : <ShieldAlert size={19} />}<div><strong>{ready ? 'Resend pronto para alertas' : 'Envio de alertas pendente'}</strong><p>{ready ? 'O e-mail é usado apenas para publicações com nota 8 ou superior e movimentações acompanhadas.' : 'Configure RESEND_API_KEY e ALERTS_FROM_EMAIL com um domínio verificado.'}</p></div><BellRing size={20} /></div>
    </section>
  );
}
