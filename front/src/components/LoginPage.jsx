import { ArrowLeft, CheckCircle2, Mail, Scale, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      const destination = window.location.pathname.startsWith('/admin') ? '/admin' : '/app';
      await api.requestMagicLink(email, `${window.location.origin}${destination}`);
      setStatus('sent');
      setMessage('Se este e-mail possui acesso, o link seguro já foi enviado. Ele expira em poucos minutos.');
    } catch (error) {
      setStatus('error');
      setMessage(error.message);
    }
  };

  return (
    <main className="login-page">
      <a className="login-page__back" href="/"><ArrowLeft size={16} /> Voltar ao feed público</a>
      <section className="login-card">
        <div className="login-brand"><span><Scale size={24} /></span><div><strong>informer</strong><small>inteligência tributária</small></div></div>
        <div className="login-card__heading"><span><ShieldCheck size={18} /> Área segura</span><h1>Entrar no Informer</h1><p>Use o e-mail autorizado pelo administrador. Não é necessário criar nem memorizar senha.</p></div>
        {status === 'sent' ? (
          <div className="login-success"><CheckCircle2 size={28} /><strong>Confira seu e-mail</strong><p>{message}</p><button type="button" onClick={() => { setStatus('idle'); setMessage(''); }}>Enviar novamente</button></div>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <label htmlFor="login-email">E-mail de acesso</label>
            <div><Mail size={18} /><input id="login-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" /></div>
            <button className="primary" type="submit" disabled={status === 'loading'}>{status === 'loading' ? 'Enviando link...' : 'Receber link de acesso'}</button>
            {message && <p className="login-error" role="alert">{message}</p>}
          </form>
        )}
        <small className="login-card__note">O acesso é liberado somente por convite. Se você ainda não foi cadastrado, fale com a administração.</small>
      </section>
    </main>
  );
}
