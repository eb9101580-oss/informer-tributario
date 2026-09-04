import { config } from '../config.js';
import { Agent, fetch as undiciFetch } from 'undici';
import { EDITORIAL_EXCLUSION_SUMMARY, policyPromptSummary, TAX_POLICY_VERSION } from './taxIntelligencePolicy.js';

export const ANALYSIS_VERSION = 'detailed-v3';
export const EDITORIAL_FORMATS = [
  'Matinal',
  'Direto da Corte',
  'Direto do CARF',
  'Direto do Legislativo',
  'Apostas da Semana',
  'Relatório especial',
  'Monitoramento',
];

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
    impactType: { type: 'string', enum: ['Oportunidade', 'Risco', 'Ambos', 'Acompanhamento'] },
    priority: { type: 'string', enum: ['Alta', 'Média', 'Acompanhamento'] },
    contentNature: { type: 'string', enum: ['Fato oficial', 'Interpretação oficial', 'Opinião ou conteúdo sem fato novo'] },
    businessActionable: { type: 'boolean' },
    noveltyType: { type: 'string', enum: ['Mudança legislativa', 'Ato regulamentar', 'Entendimento administrativo', 'Julgamento ou precedente', 'Obrigação acessória', 'Status jurídico relevante', 'Sem novidade concreta'] },
    relevanceReasons: {
      type: 'array', maxItems: 16, items: { type: 'string', enum: [
        'altera-obrigacao', 'altera-credito', 'altera-interpretacao', 'nova-tese', 'precedente-vinculante',
        'altera-obrigacao-acessoria', 'exige-sistema-processo', 'altera-prazo', 'altera-procedimento-fiscal',
        'recuperacao-credito', 'planejamento', 'risco-fiscal', 'fluxo-caixa', 'lucros-dividendos-jcp',
        'reorganizacao', 'clientes-empresariais',
      ] },
    },
    legalBasis: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 160 } },
    publishedAt: { type: 'string', maxLength: 35 },
    analysisVersion: { type: 'string', enum: [ANALYSIS_VERSION] },
    editorialFormat: { type: 'string', enum: EDITORIAL_FORMATS },
    summary: { type: 'string', maxLength: 700 },
    whatChanged: { type: 'string', maxLength: 700 },
    practicalImpact: { type: 'string', maxLength: 600 },
    officeAction: { type: 'string', maxLength: 500 },
    issueOrSubject: { type: 'string', maxLength: 600 },
    rulingOrRule: { type: 'string', maxLength: 700 },
    legalReasoning: { type: 'string', maxLength: 700 },
    effectiveDateOrDeadline: { type: 'string', maxLength: 400 },
    contextAndHistory: { type: 'string', maxLength: 700 },
    actorsAndInterests: { type: 'string', maxLength: 700 },
    nextSteps: { type: 'string', maxLength: 700 },
    watchpoints: { type: 'string', maxLength: 600 },
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
        { type: 'object', properties: { title: { type: 'string', maxLength: 160 }, period: { type: 'string', maxLength: 120 }, action: { type: 'string', maxLength: 260 }, confidence: { type: 'string', enum: ['baixo', 'médio', 'alto'] } }, required: ['title', 'action', 'confidence'], additionalProperties: false },
      ],
    },
  },
  required: ['relevant', 'title', 'theme', 'agency', 'taxes', 'status', 'kind', 'impactType', 'priority', 'contentNature', 'businessActionable', 'noveltyType', 'relevanceReasons', 'legalBasis', 'publishedAt', 'analysisVersion', 'editorialFormat', 'summary', 'whatChanged', 'practicalImpact', 'officeAction', 'issueOrSubject', 'rulingOrRule', 'legalReasoning', 'effectiveDateOrDeadline', 'contextAndHistory', 'actorsAndInterests', 'nextSteps', 'watchpoints', 'affectedProfiles', 'criteria', 'opportunity'],
  additionalProperties: false,
};

const systemPrompt = `Você é um analista de inteligência tributária brasileira. Analise somente o documento fornecido.
Priorize fonte oficial, novidade real, impacto jurídico e financeiro, abrangência, aderência a clientes e potencial de atuação.
Separe rigorosamente fato confirmado, assunto em andamento, análise e oportunidade potencial.
Não invente fatos, datas, tributos, efeitos ou direitos a crédito. Quando o documento não trouxer a informação, diga que ela não foi identificada.
Preencha summary como "O que aconteceu": identifique o órgão, o ato/julgamento, o processo ou ato normativo, a data e o resultado efetivamente documentado.
Preencha whatChanged como "O que mudou": explique a nova situação jurídica, tributária ou processual em comparação com a regra/status anterior; não reescreva o resumo.
Preencha practicalImpact como "Impacto prático": diga quais empresas/operações são afetadas, qual providência concreta existe, o risco/oportunidade e, quando houver, prazo, vigência, modulação ou possibilidade de recurso.
Preencha issueOrSubject como "Questão ou objeto": qual pedido, controvérsia, operação, obrigação ou ponto regulatório foi analisado.
Preencha rulingOrRule como "Dispositivo ou regra": transcreva em paráfrase fiel o comando, conclusão, tese, resultado do julgamento ou alteração normativa; não confunda pedido com decisão.
Preencha legalReasoning como "Fundamento": explique a razão jurídica usada pelo órgão, citando o artigo, precedente, Tema, princípio ou interpretação que aparece no documento.
Preencha effectiveDateOrDeadline como "Vigência e prazo": informe datas de publicação, vigência, corte temporal, prazo, modulação, recurso ou diga claramente que isso não foi identificado.
Escolha editorialFormat conforme o fato: "Direto da Corte" para STF, STJ ou TRF; "Direto do CARF" para julgamentos do CARF; "Direto do Legislativo" para Congresso, projetos, comissões e reforma em tramitação; "Matinal" para notícia factual do dia; "Apostas da Semana" somente para agenda futura ou cenário explicitamente sustentado; "Relatório especial" para mudança ampla que exige contexto; use "Monitoramento" para andamento processual sem decisão de mérito.
Preencha contextAndHistory como "Contexto e histórico": explique o que vinha acontecendo, qual regra ou tese anterior está em jogo e por que o fato surgiu agora. Não faça conjectura.
Preencha actorsAndInterests como "Atores e interesses": identifique partes, órgãos, setores, relator, autor do projeto ou grupo afetado e o interesse explicitamente indicado; se não constar, diga isso.
Preencha nextSteps como "Próximos passos": indique a próxima etapa institucional ou operacional documentada, como publicação do acórdão, prazo recursal, votação, regulamentação, entrada em vigor ou revisão de sistema.
Preencha watchpoints como "O que acompanhar": liste até três pontos objetivos que podem alterar a leitura, como modulação, julgamento posterior, regulamentação, veto, recurso ou manual. Não crie previsões.
Em decisões judiciais, leia nesta ordem: ementa, relatório/pedido, fundamentação, dispositivo, modulação e conclusão. Diferencie pedido da parte, argumentos, precedentes citados e conclusão do julgador. Nunca apresente o pedido do contribuinte como resultado.
Não use frases genéricas como "pode afetar o tema", "entrou no feed", "verifique a fonte" ou "o alcance deve ser conferido" quando o documento trouxer pedido, fundamento ou resultado identificável.
${policyPromptSummary()}
${EDITORIAL_EXCLUSION_SUMMARY}
Antes de marcar relevant=true, responda internamente: esta novidade faria um consultor recomendar providência, revisão, oportunidade, mudança de procedimento ou avaliação de risco a uma empresa? Se não, use relevant=false, businessActionable=false, noveltyType="Sem novidade concreta" e relevanceReasons=[].
Use prioridade Alta para mudança legislativa, regulamentar ou jurisprudencial com impacto empresarial direto; Média para entendimento novo com risco ou oportunidade concreta; Acompanhamento para afetação, julgamento iniciado, projeto avançado ou regulamentação pendente. Nunca publique baixa relevância.
Classifique contentNature com rigor. Artigo, opinião, previsão ou comentário que apenas repete regra conhecida deve ser "Opinião ou conteúdo sem fato novo" e relevant=false. Uma Solução de Consulta ou parecer oficial é "Interpretação oficial"; norma, ato, decisão e movimentação oficial são "Fato oficial".
Preencha legalBasis apenas com lei, artigo, ato, Tema, processo ou precedente expressamente identificado. Não invente referência.
Notas: 0–3 irrelevante; 4–5 baixa; 6–7 relevante; 8 alta; 9–10 urgente. O campo publishedAt deve ser ISO 8601 ou vazio.
Cada campo narrativo deve ter 1–3 frases densas, com os nomes, números, datas, artigos, percentuais, valores ou comandos existentes no documento. Não use "pode afetar", "deve ser conferido", "entrou no feed" ou "publicação identificada" como conteúdo. Os campos devem responder perguntas diferentes; não copie a mesma frase entre summary, whatChanged, practicalImpact, issueOrSubject, rulingOrRule, legalReasoning, contextAndHistory, actorsAndInterests, nextSteps e watchpoints. Se um dado realmente não existir, escreva "Não identificado no documento", sem inventar.
Responda exclusivamente conforme o schema JSON.`;

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
  const legalSectionPattern = /\b(?:ementa|relat[oó]rio|fundamenta[cç][aã]o|dispositivo|ante o exposto|conclus[aã]o|decido|julgo|tese fixada|modula[cç][aã]o|art(?:igo)?\.?\s*\d+)\b/gi;
  const windows = [];
  let match;
  while ((match = legalSectionPattern.exec(normalized)) && windows.length < 5) {
    const start = Math.max(0, match.index - 280);
    const end = Math.min(normalized.length, match.index + 1_050);
    if (!windows.some((window) => start <= window.end + 160 && end >= window.start - 160)) windows.push({ start, end });
  }
  if (!windows.length) {
    const headSize = Math.floor(available * 0.68);
    return `${normalized.slice(0, headSize)}${marker}${normalized.slice(-(available - headSize))}`;
  }

  const focusMarker = '\n\n[trechos jurídicos centrais preservados]\n\n';
  const focusBudget = Math.floor(available * 0.5);
  const focused = windows.map((window) => normalized.slice(window.start, window.end)).join('\n\n…\n\n').slice(0, focusBudget);
  const outsideBudget = Math.max(0, available - focused.length - focusMarker.length);
  const headSize = Math.floor(outsideBudget * 0.62);
  const tailSize = outsideBudget - headSize;
  const tail = tailSize ? normalized.slice(-tailSize) : '';
  return `${normalized.slice(0, headSize)}${focusMarker}${focused}${marker}${tail}`.slice(0, limit);
}

const CRITERIA_KEYS = ['authority', 'novelty', 'legalImpact', 'financialImpact', 'reach', 'clientFit', 'actionPotential'];
const STATUS_VALUES = new Set(['Fato confirmado', 'Em andamento', 'Análise', 'Oportunidade potencial']);
const IMPACT_VALUES = new Set(['Oportunidade', 'Risco', 'Ambos', 'Acompanhamento', 'Informativo']);
const PRIORITY_VALUES = new Set(['Alta', 'Média', 'Acompanhamento']);
const CONTENT_NATURE_VALUES = new Set(['Fato oficial', 'Interpretação oficial', 'Opinião ou conteúdo sem fato novo']);
const NOVELTY_VALUES = new Set(['Mudança legislativa', 'Ato regulamentar', 'Entendimento administrativo', 'Julgamento ou precedente', 'Obrigação acessória', 'Status jurídico relevante', 'Sem novidade concreta']);
const RELEVANCE_REASON_VALUES = new Set([
  'altera-obrigacao', 'altera-credito', 'altera-interpretacao', 'nova-tese', 'precedente-vinculante',
  'altera-obrigacao-acessoria', 'exige-sistema-processo', 'altera-prazo', 'altera-procedimento-fiscal',
  'recuperacao-credito', 'planejamento', 'risco-fiscal', 'fluxo-caixa', 'lucros-dividendos-jcp',
  'reorganizacao', 'clientes-empresariais',
]);
const MISSING_INFORMATION = 'Informação não identificada no documento.';

function boundedText(value, maxLength, fallback = MISSING_INFORMATION) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, maxLength).trim();
}

function boundedList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((item) => boundedText(item, maxLength, '')).filter((item) => {
    const key = item.toLocaleLowerCase('pt-BR');
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxItems);
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
  const priority = PRIORITY_VALUES.has(payload.priority) ? payload.priority : (payload.status === 'Em andamento' ? 'Acompanhamento' : 'Média');
  const contentNature = CONTENT_NATURE_VALUES.has(payload.contentNature) ? payload.contentNature : (payload.relevant ? 'Fato oficial' : 'Opinião ou conteúdo sem fato novo');
  const noveltyType = NOVELTY_VALUES.has(payload.noveltyType) ? payload.noveltyType : (payload.relevant ? 'Status jurídico relevante' : 'Sem novidade concreta');
  const relevanceReasons = boundedList(payload.relevanceReasons, 16, 60).filter((reason) => RELEVANCE_REASON_VALUES.has(reason));
  const businessActionable = payload.businessActionable === undefined ? payload.relevant : payload.businessActionable === true;
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
    priority,
    contentNature,
    businessActionable,
    noveltyType,
    relevanceReasons: relevanceReasons.length || !payload.relevant ? relevanceReasons : ['clientes-empresariais'],
    legalBasis: boundedList(payload.legalBasis, 8, 160),
    publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt.slice(0, 35) : '',
    analysisVersion: ANALYSIS_VERSION,
    editorialFormat: EDITORIAL_FORMATS.includes(payload.editorialFormat) ? payload.editorialFormat : 'Monitoramento',
    summary: boundedText(payload.summary, 700),
    whatChanged: boundedText(payload.whatChanged, 700),
    practicalImpact: boundedText(payload.practicalImpact, 600),
    officeAction: boundedText(payload.officeAction, 500),
    issueOrSubject: boundedText(payload.issueOrSubject, 600),
    rulingOrRule: boundedText(payload.rulingOrRule, 700),
    legalReasoning: boundedText(payload.legalReasoning, 700),
    effectiveDateOrDeadline: boundedText(payload.effectiveDateOrDeadline, 400),
    contextAndHistory: boundedText(payload.contextAndHistory, 700),
    actorsAndInterests: boundedText(payload.actorsAndInterests, 700),
    nextSteps: boundedText(payload.nextSteps, 700),
    watchpoints: boundedText(payload.watchpoints, 600),
    affectedProfiles: boundedList(payload.affectedProfiles, 5, 80),
    criteria,
    opportunity: payload.opportunity && typeof payload.opportunity === 'object' ? {
      title: boundedText(payload.opportunity.title, 160),
      period: boundedText(payload.opportunity.period, 120, ''),
      action: boundedText(payload.opportunity.action, 260),
      confidence: ['baixo', 'médio', 'alto'].includes(payload.opportunity.confidence) ? payload.opportunity.confidence : 'baixo',
    } : null,
  };
}

function analysisContext(document, documentText) {
  const schema = JSON.stringify(analysisSchema);
  return `Versão da política: ${TAX_POLICY_VERSION}\nURL da fonte coletada: ${document.url}\nFonte: ${document.sourceName || 'não identificada'}\nTipo da fonte: ${document.sourceType || 'não identificado'}\nTipo de documento: ${document.documentKind || 'não identificado'}\nTítulo detectado: ${document.title || 'não identificado'}\nTítulo do item monitorado: ${document.candidateTitle || 'não identificado'}\nSeções: ${(document.sections || []).join(', ') || 'geral'}\nPré-classificação: ${JSON.stringify(document.policyAssessment || {})}\n\nResponda seguindo exatamente este JSON Schema:\n${schema}\n\nConteúdo do documento:\n${documentText}`;
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
        options: { temperature: 0, num_ctx: 8192, num_predict: 2200 },
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
        max_tokens: 2200,
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
