import { BrainCircuit, CheckCircle2, DatabaseZap, ExternalLink, Globe2, LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function CollectorPage({ onCollected, onOpen }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.intelligenceStatus().then(setStatus).catch(() => setStatus(null)); }, []);

  const analyze = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await api.analyzeUrl(url, true);
      setResult(data);
      if (data.persisted) onCollected();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="collector-page">
      <div className="pipeline">
        <div><span><Globe2 /></span><strong>Fonte oficial</strong><small>URL validada</small></div><i />
        <div><span><DatabaseZap /></span><strong>Scrapling</strong><small>Coleta adaptativa</small></div><i />
        <div><span><BrainCircuit /></span><strong>Ollama</strong><small>Análise local</small></div><i />
        <div><span><ShieldCheck /></span><strong>Radar</strong><small>Relevância calculada</small></div>
      </div>

      <div className="collector-grid">
        <div className="collector-form panel">
          <div className="panel__heading"><div><h2>Analisar documento oficial</h2><p>Cole o endereço direto de uma publicação, decisão ou norma</p></div></div>
          <form onSubmit={analyze}>
            <label>Endereço da fonte oficial<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required placeholder="https://www.gov.br/..." /></label>
            <p className="form-hint">Por segurança e qualidade, somente domínios oficiais previamente autorizados são aceitos.</p>
            <button disabled={loading}>{loading ? <LoaderCircle className="spinning" /> : <BrainCircuit />}{loading ? 'Coletando e analisando...' : 'Analisar e incluir no radar'}</button>
          </form>
          {error && <div className="collector-error"><TriangleAlert size={18} /><span>{error}</span></div>}
        </div>

        <aside className="integration-status panel">
          <div className="panel__heading"><div><h2>Integrações locais</h2><p>Estado dos componentes da análise</p></div></div>
          <div><span className="status-icon status-icon--ok"><CheckCircle2 /></span><p><strong>Scrapling</strong><small>Adaptador configurado no backend</small></p><em>Pronto</em></div>
          <div><span className={`status-icon ${status?.ollama.available ? 'status-icon--ok' : 'status-icon--off'}`}>{status?.ollama.available ? <CheckCircle2 /> : <TriangleAlert />}</span><p><strong>Ollama · {status?.ollama.model || 'qwen3:4b'}</strong><small>{status?.ollama.available ? (status.ollama.installed ? 'Serviço e modelo disponíveis' : 'Serviço ativo; baixe o modelo configurado') : 'Serviço local não detectado'}</small></p><em>{status?.ollama.available ? 'Conectado' : 'Offline'}</em></div>
        </aside>
      </div>

      {result && (
        <div className="collector-result panel">
          <span className="result-check"><CheckCircle2 /></span>
          <div><small>{result.persisted ? 'Incluído no radar' : 'Análise concluída sem persistência'}</small><h2>{result.alert.title}</h2><p>Nota {String(result.alert.score).replace('.', ',')}/10 · {result.alert.relevance} · {result.alert.agency}</p></div>
          <button onClick={() => onOpen(result.alert)}>Ver análise <ExternalLink size={16} /></button>
        </div>
      )}
    </section>
  );
}
