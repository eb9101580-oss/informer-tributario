import { config } from '../config.js';
import { Agent, fetch as undiciFetch } from 'undici';

// O Ollama pode gastar vários minutos avaliando decisões longas antes do
// primeiro token. O fetch padrão do Node encerra essa espera aos 300 segundos.
// O AbortController abaixo continua sendo o limite total da análise.
const ollamaDispatcher = new Agent({
  connectTimeout: 10_000,
  headersTimeout: config.ollamaTimeoutMs + 5_000,
  bodyTimeout: config.ollamaTimeoutMs + 5_000,
});

// llama.cpp expose uma API compatÃ­vel com OpenAI. Mantemos um dispatcher
// separado para que a tentativa opcional nÃ£o altere o comportamento do Ollama.
const llamaCppDispatcher = new Agent({
  connectTimeout: 10_000,
  headersTimeout: config.llamaCppTimeoutMs + 5_000,
  bodyTimeout: config.llamaCppTimeoutMs + 5_000,
});

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
        authority: { type: 'number', minimum: 0, maximum: 10 }, novelty: { type: 'number', minimum: 0, maximum: 10 }, legalImpact: { type: 'number', minimum: 0, maximum: 10 },
        financialImpact: { type: 'number', minimum: 0, maximum: 10 }, reach: { type: 'number', minimum: 0, maximum: 10 }, clientFit: { type: 'number', minimum: 0, maximum: 10 },
        actionPotential: { type: 'number', minimum: 0, maximum: 10 },
      },
      required: ['authority', 'novelty', 'legalImpact', 'financialImpact', 'reach', 'clientFit', 'actionPotential'],
      additionalProperties: false,
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
Preencha summary como "O que aconteceu": descreva o ato, julgamento ou publicação e o resultado efetivamente documentado.
Preencha whatChanged como "O que mudou": explique a nova situação jurídica ou processual concreta, sem repetir o resumo.
Preencha practicalImpact como "Impacto prático": diga quem é afetado, qual consequência concreta existe e se ainda cabe recurso ou depende de regulamentação.
Em decisões judiciais, localize primeiro o dispositivo. Diferencie pedido da parte, argumentos, precedentes citados e conclusão do julgador. Nunca apresente o pedido do contribuinte como resultado da decisão.
Não use frases genéricas como "pode afetar o tema", "entrou no feed", "verifique a fonte" ou "o alcance deve ser conferido" quando o documento trouxer pedido, fundamento ou resultado identificável.
Notas: 0–3 irrelevante; 4–5 baixa; 6–7 relevante; 8 alta; 9–10 urgente. O campo publishedAt deve ser ISO 8601 ou vazio.
Seja conciso: use no máximo duas frases curtas em cada campo textual. Responda exclusivamente conforme o schema JSON.`;

export function prepareDocumentText(text = '', limit = config.ollamaMaxInputCharacters) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim());
  const normalized = lines.reduce((result, line) => {
    if (line) result.push(line);
    else if (result.length && result[result.length - 1] !== '') result.push('');
    return result;
  }, []).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= limit) return normalized;

  const marker = '\n\n[trecho intermediário omitido para desempenho]\n\n';
  if (limit <= marker.length + 20) return normalized.slice(0, limit);
  const available = limit - marker.length;
  const headSize = Math.floor(available * 0.68);
  const tailSize = available - headSize;
  return `${normalized.slice(0, headSize)}${marker}${normalized.slice(-tailSize)}`;
}

const CRITERIA_KEYS = ['authority', 'novelty', 'legalImpact', 'financialImpact', 'reach', 'clientFit', 'actionPotential'];
const STATUS_VALUES = new Set(['Fato confirmado', 'Em andamento', 'Análise', 'Oportunidade potencial']);
const IMPACT_VALUES = new Set(['Oportunidade', 'Risco', 'Ambos', 'Informativo']);
const MISSING_INFORMATION = 'Informação não identificada no documento.';

function boundedText(value, maxLength, fallback = MISSING_INFORMATION) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, maxLength).trim();
}

function boundedList(value, maxItems, maxLength) {
  return Array.isArray(value) ? value.map((item) => boundedText(item, maxLength, '')).filter(Boolean).slice(0, maxItems) : [];
}

function parseStructuredContent(content) {
  const raw = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(raw); } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('O modelo devolveu JSON incompleto.');
  }
}

export function mergeOllamaStreamPayloads(payloads = []) {
  let content = '';
  let finalPayload = {};
  for (const payload of payloads) {
    if (payload?.error) throw new Error(`Ollama interrompeu a geração: ${payload.error}`);
    content += payload?.message?.content || '';
    finalPayload = payload || finalPayload;
  }
  return { ...finalPayload, message: { ...(finalPayload.message || {}), content } };
}

async function readOllamaStream(response) {
  const decoder = new TextDecoder();
  const payloads = [];
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) payloads.push(JSON.parse(line));
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) payloads.push(JSON.parse(buffer));
  return mergeOllamaStreamPayloads(payloads);
}

export function normalizeAnalysis(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.relevant !== 'boolean') {
    throw new Error('A análise devolveu um objeto fora do formato esperado.');
  }
  const criteria = {};
  for (const key of CRITERIA_KEYS) {
    const value = Number(payload.criteria?.[key]);
    if (!Number.isFinite(value)) throw new Error(`A análise não informou o critério ${key}.`);
    criteria[key] = Math.min(10, Math.max(0, value));
  }
  const status = STATUS_VALUES.has(payload.status) ? payload.status : 'Análise';
  const impactType = IMPACT_VALUES.has(payload.impactType) ? payload.impactType : 'Informativo';
  const publishedAt = String(payload.publishedAt || '').trim();
  return {
    relevant: payload.relevant,
    title: boundedText(payload.title, 180),
    theme: boundedText(payload.theme, 80),
    agency: boundedText(payload.agency, 100),
    taxes: boundedList(payload.taxes, 6, 30),
    status,
    kind: boundedText(payload.kind, 80),
    impactType,
    publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt.slice(0, 35) : '',
    summary: boundedText(payload.summary, 700),
    whatChanged: boundedText(payload.whatChanged, 700),
    practicalImpact: boundedText(payload.practicalImpact, 600),
    officeAction: boundedText(payload.officeAction, 500),
    affectedProfiles: boundedList(payload.affectedProfiles, 5, 80),
    criteria,
    opportunity: payload.opportunity && typeof payload.opportunity === 'object' ? {
      title: boundedText(payload.opportunity.title, 160),
      period: boundedText(payload.opportunity.period, 120),
      action: boundedText(payload.opportunity.action, 260),
      confidence: ['baixo', 'médio', 'alto'].includes(payload.opportunity.confidence) ? payload.opportunity.confidence : 'baixo',
    } : null,
  };
}

function analysisContext(document, documentText) {
  const schema = JSON.stringify(analysisSchema);
  return `URL oficial: ${document.url}\nFonte: ${document.sourceName || 'não identificada'}\nTipo de documento: ${document.documentKind || 'não identificado'}\nTítulo detectado: ${document.title || 'não identificado'}\nTítulo do item monitorado: ${document.candidateTitle || 'não identificado'}\nSeções: ${(document.sections || []).join(', ') || 'geral'}\n\nResponda seguindo exatamente este JSON Schema:\n${schema}\n\nConteúdo do documento:\n${documentText}`;
}

export async function analyzeWithOllama(document) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);
  const documentText = prepareDocumentText(document.text);
  try {
    const response = await undiciFetch(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      dispatcher: ollamaDispatcher,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollamaModel,
        // Depois da avaliação inicial, cada fragmento mantém a conexão ativa
        // enquanto o runner conclui a geração em CPU.
        stream: true,
        think: false,
        keep_alive: '10m',
        format: analysisSchema,
        options: { temperature: 0, num_ctx: 8192, num_predict: 1600 },
        messages: [
          { role: 'system', content: `${systemPrompt}\nUse somente evidências explícitas do texto. Diferencie norma publicada de notícia, proposta ou hipótese. Finalize cada frase; não corte palavras nem sentenças.` },
          { role: 'user', content: analysisContext(document, documentText) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama respondeu com status ${response.status}.`);
    const result = await readOllamaStream(response);
    try {
      return normalizeAnalysis(parseStructuredContent(result.message?.content));
    } catch {
      const reason = result.done_reason === 'length' ? 'A resposta atingiu o limite de geração.' : 'O modelo devolveu JSON incompleto.';
      throw new Error(`${reason} Tente novamente com uma publicação individual mais curta.`);
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`A análise do Ollama excedeu ${Math.round(config.ollamaTimeoutMs / 60000)} minutos.`);
    if (error.cause?.code === 'ECONNREFUSED') throw new Error('Ollama não está em execução em localhost:11434.');
    if (error.message === 'fetch failed') {
      const detail = error.cause?.code || error.cause?.message || 'conexão encerrada';
      throw new Error(`A conexão com o Ollama foi interrompida (${detail}).`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function llamaCppMessages(document) {
  const documentText = prepareDocumentText(document.text);
  return [
    { role: 'system', content: `${systemPrompt}\nUse somente evidÃªncias explÃ­citas do texto. Diferencie norma publicada de notÃ­cia, proposta ou hipÃ³tese. Finalize cada frase; nÃ£o corte palavras nem sentenÃ§as.` },
    { role: 'user', content: analysisContext(document, documentText) },
  ];
}

export async function analyzeWithLlamaCpp(document) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llamaCppTimeoutMs);
  try {
    const response = await undiciFetch(`${config.llamaCppUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      dispatcher: llamaCppDispatcher,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.llamaCppModel,
        messages: llamaCppMessages(document),
        temperature: 0,
        max_tokens: 1600,
        stream: false,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'tax_analysis', strict: true, schema: analysisSchema },
        },
      }),
    });
    if (!response.ok) throw new Error(`llama.cpp respondeu com status ${response.status}.`);
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('llama.cpp nÃ£o devolveu conteÃºdo para a anÃ¡lise.');
    return normalizeAnalysis(parseStructuredContent(typeof content === 'string' ? content : JSON.stringify(content)));
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`A anÃ¡lise do llama.cpp excedeu ${Math.round(config.llamaCppTimeoutMs / 60000)} minutos.`);
    if (error.cause?.code === 'ECONNREFUSED' || error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') throw new Error('llama.cpp nÃ£o estÃ¡ em execuÃ§Ã£o em localhost:8080.');
    if (error.message === 'fetch failed') {
      const detail = error.cause?.code || error.cause?.message || 'conexÃ£o encerrada';
      throw new Error(`A conexÃ£o com o llama.cpp foi interrompida (${detail}).`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeDocument(document) {
  if (config.analysisProvider === 'ollama') return analyzeWithOllama(document);
  if (config.analysisProvider === 'llama.cpp' || config.analysisProvider === 'llamacpp') return analyzeWithLlamaCpp(document);
  // auto: usa llama.cpp quando ele estiver disponÃ­vel e cai para Ollama sem
  // interromper a varredura quando o servidor opcional nÃ£o estiver instalado.
  try {
    return await analyzeWithLlamaCpp(document);
  } catch (error) {
    if (!/nÃ£o estÃ¡ em execuÃ§Ã£o|conexÃ£o foi interrompida|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT/i.test(error.message)) throw error;
    return analyzeWithOllama(document);
  }
}

export async function llamaCppStatus() {
  try {
    const response = await fetch(`${config.llamaCppUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(1800) });
    return { available: response.ok, model: config.llamaCppModel };
  } catch {
    return { available: false, model: config.llamaCppModel };
  }
}

export async function ollamaStatus() {
  try {
    const response = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { available: false, model: config.ollamaModel };
    const data = await response.json();
    return { available: true, model: config.ollamaModel, installed: data.models?.some((item) => item.name === config.ollamaModel || item.model === config.ollamaModel) };
  } catch {
    return { available: false, model: config.ollamaModel };
  }
}
