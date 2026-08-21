import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { collectOfficialPage, officialDomains, validateOfficialUrl } from '../services/collector.js';
import { analyzeDocument, llamaCppStatus, ollamaStatus } from '../services/ollama.js';
import { calculateScore, relevanceLabel } from '../services/scoring.js';
import { readDatabase, updateDatabase } from '../services/store.js';
import { config } from '../config.js';
import { alertPassesTaxIntelligencePolicy, assessTaxIntelligenceCandidate, TAX_POLICY_VERSION } from '../services/taxIntelligencePolicy.js';

export const intelligenceRouter = Router();

function officialSourceId(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.endsWith('stf.jus.br')) return 'stf';
  if (hostname.endsWith('stj.jus.br')) return 'stj';
  if (/trf([1-6])\.jus\.br$/.test(hostname)) return `trf${hostname.match(/trf([1-6])\.jus\.br$/)[1]}`;
  if (hostname.endsWith('carf.economia.gov.br') || hostname.endsWith('acordaos.economia.gov.br')) return 'carf';
  if (hostname.endsWith('receita.fazenda.gov.br')) return 'receita-federal';
  return hostname;
}

intelligenceRouter.get('/status', async (_request, response) => {
  const ollama = await ollamaStatus();
  const llamaCpp = await llamaCppStatus();
  response.json({ ollama, llamaCpp, provider: config.analysisProvider, scrapling: { configured: true }, officialDomains, analysis: { optimizedInputCharacters: config.ollamaMaxInputCharacters, thinking: false } });
});

intelligenceRouter.post('/analyze-url', async (request, response, next) => {
  try {
    const url = validateOfficialUrl(request.body.url);
    const database = await readDatabase();
    const duplicate = database.alerts.find((alert) => alert.officialUrl === url);
    if (duplicate) return response.status(409).json({ message: 'Esta URL já foi analisada.', duplicateId: duplicate.id });

    const document = await collectOfficialPage(url);
    if (document.characters < 200) return response.status(422).json({ message: 'A página não contém texto suficiente para análise.' });
    const sourceId = officialSourceId(url);
    const policyAssessment = assessTaxIntelligenceCandidate({ sourceId, sourceType: 'official', title: document.title, content: document.text });
    const analysis = await analyzeDocument({ ...document, sourceName: new URL(url).hostname, sourceType: 'official', policyAssessment });
    const score = calculateScore(analysis.criteria);
    const alert = {
      ...analysis,
      id: randomUUID(),
      score,
      relevance: relevanceLabel(score),
      officialUrl: url,
      primarySourceUrl: url,
      sourceUrl: url,
      publishedAt: Number.isNaN(Date.parse(analysis.publishedAt)) ? new Date().toISOString() : analysis.publishedAt,
      isDemo: false,
      policyVersion: TAX_POLICY_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: { collector: 'Scrapling', analyzer: `${config.analysisProvider} (${process.env.OLLAMA_MODEL || 'qwen3:4b'})`, sourceCharacters: document.characters, sourceId, sourceType: 'official', policyVersion: TAX_POLICY_VERSION },
    };

    const persist = request.body.persist === true && alertPassesTaxIntelligencePolicy(alert)
      && analysis.relevant && analysis.businessActionable
      && analysis.contentNature !== 'Opinião ou conteúdo sem fato novo'
      && analysis.noveltyType !== 'Sem novidade concreta' && analysis.relevanceReasons.length > 0 && score >= 6;
    if (persist) {
      await updateDatabase((data) => ({ ...data, alerts: [alert, ...data.alerts], meta: { ...data.meta, lastUpdatedAt: new Date().toISOString() } }));
    }

    response.status(201).json({ alert, persisted: persist });
  } catch (error) {
    if (/URL|HTTPS|domínios oficiais/.test(error.message)) error.statusCode = 400;
    else if (/Scrapling não está disponível|Ollama não está/.test(error.message)) error.statusCode = 503;
    else error.statusCode ||= 502;
    next(error);
  }
});
