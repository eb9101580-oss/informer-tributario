import { BellRing, CheckCircle2, Mail, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function SettingsPage() {
  const [status, setStatus] = useState(null);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setStatus(await api.subscriptionStatus()); setMessage(''); }
    catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const subscribe = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const result = await api.subscribe(email);
      setEmail('');
      setMessage(result.delivery === 'sent'
        ? 'Cadastro confirmado. Confira sua caixa de entrada.'
        : 'Cadastro salvo. O envio será ativado quando o provedor de e-mail estiver configurado.');
      setStatus(await api.subscriptionStatus());
    } catch (error) { setMessage(error.message); }
    finally { setSubmitting(false); }
  };

  const ready = Boolean(status?.enabled);
  return (
    <section className="page-section settings-page">
      <div className="settings-hero">
        <div><span><BellRing size={17} /> Preferências do radar</span><h2>Alertas por e-mail</h2><p>Receba uma mensagem quando uma publicação real atingir nota {status?.threshold || 8} ou superior.</p></div>
        <button className="icon-button" onClick={load} disabled={loading} aria-label="Atualizar status"><RefreshCw className={loading ? 'spinning' : ''} size={18} /></button>
      </div>
      <div className={`settings-status ${ready ? 'settings-status--ready' : ''}`}>
        {ready ? <CheckCircle2 size={19} /> : <ShieldAlert size={19} />}
        <div><strong>{ready ? 'Envio de alertas ativo' : 'Envio aguardando configuração'}</strong><p>{ready ? 'Seu cadastro será usado pelo ciclo automático do monitor.' : 'O cadastro só pode ser concluído depois que o armazenamento seguro e o provedor de e-mail estiverem configurados.'}</p></div>
      </div>
      <form className="settings-form" onSubmit={subscribe}>
        <label htmlFor="settings-email">E-mail para receber alertas</label>
        <div><Mail size={17} /><input id="settings-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" /><button className="primary" type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Cadastrar e-mail'}</button></div>
        {message && <small>{message}</small>}
      </form>
      <div className="settings-notes"><strong>Como funciona</strong><p>As inscrições são armazenadas de forma criptografada. A cada varredura automática, o Informer envia uma mensagem para cada cadastro ativo, sem repetir o mesmo alerta.</p></div>
    </section>
  );
}
