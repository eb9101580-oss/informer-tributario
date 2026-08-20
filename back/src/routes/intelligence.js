import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { collectOfficialPage, officialDomains, validateOfficialUrl } from '../services/collector.js';
import { analyzeDocument, llamaCppStatus, ollamaStatus } from '../services/ollama.js';
import { calculateScore, relevanceLabel } from '../services/scoring.js';
import { readDatabase, updateDatabase } from '../services/store.js';
import { config } from '../config.js';

export const intelligenceRouter = Router();

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
    const analysis = await analyzeDocument(document);
    const score = calculateScore(analysis.criteria);
    const alert = {
      ...analysis,
      id: randomUUID(),
      score,
      relevance: relevanceLabel(score),
      officialUrl: url,
      publishedAt: Number.isNaN(Date.parse(analysis.publishedAt)) ? new Date().toISOString() : analysis.publishedAt,
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: { collector: 'Scrapling', analyzer: `${config.analysisProvider} (${process.env.OLLAMA_MODEL || 'qwen3:4b'})`, sourceCharacters: document.characters },
    };

    if (request.body.persist === true && analysis.relevant && score >= 4) {
      await updateDatabase((data) => ({ ...data, alerts: [alert, ...data.alerts], meta: { ...data.meta, lastUpdatedAt: new Date().toISOString() } }));
    }

    response.status(201).json({ alert, persisted: request.body.persist === true && analysis.relevant && score >= 4 });
  } catch (error) {
    if (/URL|HTTPS|domínios oficiais/.test(error.message)) error.statusCode = 400;
    else if (/Scrapling não está disponível|Ollama não está/.test(error.message)) error.statusCode = 503;
    else error.statusCode ||= 502;
    next(error);
  }
});
