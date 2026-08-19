import { config } from '../config.js';

const analysisSchema = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    title: { type: 'string', maxLength: 180 },
    theme: { type: 'string', maxLength: 80 },
    agency: { type: 'string', maxLength: 100 },
    taxes: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 30 } },
    status: { type: 'string', enum: ['Fato confirmado', 'Em andamento', 'Análise', 'Oportunidade potencial'] },
    kind: { type: 'string', maxLength: 80 },
    impactType: { type: 'string', enum: ['Oportunidade', 'Risco', 'Ambos', 'Informativo'] },
    publishedAt: { type: 'string', maxLength: 35 },
    summary: { type: 'string', maxLength: 700 },
    whatChanged: { type: 'string', maxLength: 700 },
    practicalImpact: { type: 'string', maxLength: 600 },
    officeAction: { type: 'string', maxLength: 500 },
    affectedProfiles: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 80 } },
    criteria: {
      type: 'object',
      properties: {
        authority: { type: 'number' }, novelty: { type: 'number' }, legalImpact: { type: 'number' },
        financialImpact: { type: 'number' }, reach: { type: 'number' }, clientFit: { type: 'number' },
        actionPotential: { type: 'number' },
      },
      required: ['authority', 'novelty', 'legalImpact', 'financialImpact', 'reach', 'clientFit', 'actionPotential'],
    },
    opportunity: {
      anyOf: [
        { type: 'null' },
        { type: 'object', properties: { title: { type: 'string', maxLength: 160 }, period: { type: 'string', maxLength: 120 }, action: { type: 'string', maxLength: 260 }, confidence: { type: 'string', enum: ['baixo', 'médio', 'alto'] } }, required: ['title', 'period', 'action', 'confidence'], additionalProperties: false },
      ],
    },
  },
  required: ['relevant', 'title', 'theme', 'agency', 'taxes', 'status', 'kind', 'impactType', 'publishedAt', 'summary', 'whatChanged', 'practicalImpact', 'officeAction', 'affectedProfiles', 'criteria', 'opportunity'],
  additionalProperties: false,
};

const systemPrompt = `Você é um analista de inteligência tributária brasileira. Analise somente o documento fornecido.
Priorize fonte oficial, novidade real, impacto jurídico e financeiro, abrangência, aderência a clientes e potencial de atuação.
Separe rigorosamente fato confirmado, assunto em andamento, análise e oportunidade potencial.
Não invente fatos, datas, tributos, efeitos ou direitos a crédito. Quando o documento não trouxer a informação, diga que ela não foi identificada.
Notas: 0–3 irrelevante; 4–5 baixa; 6–7 relevante; 8 alta; 9–10 urgente. O campo publishedAt deve ser ISO 8601 ou vazio.
Seja conciso: use no máximo duas frases curtas em cada campo textual. Responda exclusivamente conforme o schema JSON.`;

export function prepareDocumentText(text = '', limit = config.ollamaMaxInputCharacters) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;

  const headSize = Math.floor(limit * 0.72);
  const tailSize = limit - headSize;
  return `${normalized.slice(0, headSize)}\n\n[trecho intermediário omitido para desempenho]\n\n${normalized.slice(-tailSize)}`;
}

export async function analyzeWithOllama(document) {
  if (config.analysisProvider === 'github') return analyzeWithGitHubModels(document);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);
  const documentText = prepareDocumentText(document.text);
  try {
    const response = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        think: false,
        keep_alive: '10m',
        format: analysisSchema,
        options: { temperature: 0.1, num_ctx: 8192, num_predict: 1700 },
        messages: [
          { role: 'system', content: `${systemPrompt}\nFinalize each sentence before the character limit; never cut a word or sentence.` },
          { role: 'user', content: `URL oficial: ${document.url}\nTítulo da página: ${document.title}\n\nConteúdo:\n${documentText}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama respondeu com status ${response.status}.`);
    const result = await response.json();
    try {
      return JSON.parse(result.message.content);
    } catch {
      const reason = result.done_reason === 'length' ? 'A resposta atingiu o limite de geração.' : 'O modelo devolveu JSON incompleto.';
      throw new Error(`${reason} Tente novamente com uma publicação individual mais curta.`);
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`A análise do Ollama excedeu ${Math.round(config.ollamaTimeoutMs / 60000)} minutos.`);
    if (error.cause?.code === 'ECONNREFUSED') throw new Error('Ollama não está em execução em localhost:11434.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeWithGitHubModels(document) {
  if (!config.githubToken) throw new Error('GITHUB_TOKEN não foi disponibilizado para a análise na nuvem.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);
  const documentText = prepareDocumentText(document.text);
  try {
    const response = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.githubToken}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.githubModel,
        temperature: 0.1,
        max_tokens: 1400,
        response_format: { type: 'json_schema', json_schema: { name: 'analise_tributaria', strict: true, schema: analysisSchema } },
        messages: [
          { role: 'system', content: `${systemPrompt}\nFinalize each sentence before the character limit; never cut a word or sentence.` },
          { role: 'user', content: `URL oficial: ${document.url}\nTítulo da página: ${document.title}\n\nConteúdo:\n${documentText}` },
        ],
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`GitHub Models respondeu com status ${response.status}: ${details.slice(0, 240)}`);
    }
    const result = await response.json();
    return JSON.parse(result.choices?.[0]?.message?.content || '');
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('A análise do GitHub Models excedeu o tempo limite.');
    if (error instanceof SyntaxError) throw new Error('O GitHub Models devolveu uma análise em formato inválido.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function ollamaStatus() {
  if (config.analysisProvider === 'github') {
    return { available: Boolean(config.githubToken), model: config.githubModel, provider: 'GitHub Models', installed: true };
  }
  try {
    const response = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { available: false, model: config.ollamaModel };
    const data = await response.json();
    return { available: true, model: config.ollamaModel, installed: data.models?.some((item) => item.name === config.ollamaModel || item.model === config.ollamaModel) };
  } catch {
    return { available: false, model: config.ollamaModel };
  }
}
