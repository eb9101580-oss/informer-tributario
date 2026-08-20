import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, Scale, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      await api.login(email, password);
      const destination = window.location.pathname.startsWith('/admin') ? '/admin' : '/app';
      window.location.assign(destination);
    } catch (error) {
      setStatus('error');
      setMessage(error.status === 401 ? 'E-mail ou senha incorretos.' : error.message);
    }
  };

  return (
    <main className="login-page">
      <a className="login-page__back" href="/"><ArrowLeft size={16} /> Voltar ao feed público</a>
      <section className="login-card">
        <div className="login-brand"><span><Scale size={24} /></span><div><strong>informer</strong><small>inteligência tributária</small></div></div>
        <div className="login-card__heading"><span><ShieldCheck size={18} /> Área segura</span><h1>Entrar no Informer</h1><p>Use o e-mail e a senha fornecidos pelo administrador.</p></div>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="login-email">E-mail de acesso</label>
          <div><Mail size={18} /><input id="login-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" /></div>
          <label htmlFor="login-password">Senha</label>
          <div><LockKeyhole size={18} /><input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required minLength="10" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha de acesso" /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          <button className="primary" type="submit" disabled={status === 'loading'}>{status === 'loading' ? 'Entrando...' : 'Entrar'}</button>
          {message && <p className="login-error" role="alert">{message}</p>}
        </form>
        <small className="login-card__note">As contas são criadas somente pelo administrador. O e-mail não é usado para entrar por link.</small>
      </section>
    </main>
  );
}
