import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { monitoredSources } from '../data/officialSources.js';
import { collectOfficialPage } from './collector.js';
import { analyzeWithOllama } from './ollama.js';
import { calculateScore, relevanceLabel } from './scoring.js';
import { discoverSourceCandidates, hasStrongTaxSignal, isCandidateEligible, isTaxRelated } from './sourceAdapters.js';
import { readDatabase, updateDatabase } from './store.js';

const runtime = { running: false, phase: 'idle', currentSource: null, currentDocument: null, startedAt: null, error: null };
let timer;

export function monitorData(database) {
  return database.monitor || { candidates: [], runs: [], lastRunAt: null, nextRunAt: null };
}

export function candidateId(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

export function candidateFingerprint(candidate) {
  const substantiveTitle = String(candidate.title || '').split('—').slice(1).join('—').trim() || candidate.title || candidate.url;
  return createHash('sha256').update(`${candidate.sourceId}:${substantiveTitle}`).digest('hex').slice(0, 24);
}

function makeAlert(analysis, document, candidate) {
  const score = calculateScore(analysis.criteria);
  const now = new Date().toISOString();
  return {
    ...analysis, id: randomUUID(), score, relevance: relevanceLabel(score), officialUrl: candidate.url,
    publishedAt: candidate.publishedAt || (Number.isNaN(Date.parse(analysis.publishedAt)) ? now : analysis.publishedAt),
    isDemo: false, createdAt: now, updatedAt: now,
    provenance: {
      collector: 'Scrapling', analyzer: `Ollama/${config.ollamaModel}`, collectorUrl: candidate.collectionUrl || candidate.url, sourceCharacters: document.characters,
      sourceId: candidate.sourceId, sourceName: candidate.sourceName, discoveredBy: candidate.discoveryMethod,
      sourceType: candidate.sourceType || 'official',
      documentKind: candidate.documentKind, discoveredAt: candidate.discoveredAt,
    },
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: 'fulfilled', value: await mapper(items[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export function getMonitorRuntime() {
  return { ...runtime, enabled: config.monitorEnabled, intervalMinutes: config.monitorIntervalMinutes, maxAnalysesPerRun: config.monitorMaxAnalyses };
}

export async function getMonitorSnapshot() {
  const database = await readDatabase();
  const monitor = monitorData(database);
  return {
    runtime: getMonitorRuntime(), lastRunAt: monitor.lastRunAt, nextRunAt: monitor.nextRunAt,
    queued: monitor.candidates.filter((item) => item.status === 'pending').length,
    analyzed: monitor.candidates.filter((item) => item.status === 'analyzed').length,
    discarded: monitor.candidates.filter((item) => item.status === 'discarded').length,
    errors: monitor.candidates.filter((item) => item.status === 'error').length,
    sources: monitoredSources.length,
  };
}

export async function runMonitor({ analyze = true, trigger = 'manual' } = {}) {
  if (runtime.running) return { accepted: false, message: 'Já existe uma varredura em andamento.' };
  runtime.running = true;
  runtime.phase = 'discovery';
  runtime.startedAt = new Date().toISOString();
  runtime.error = null;
  const run = { id: randomUUID(), trigger, startedAt: runtime.startedAt, finishedAt: null, discovered: 0, analyzed: 0, published: 0, discarded: 0, errors: 0, sources: [] };

  try {
    await updateDatabase((database) => ({
      ...database,
      monitor: { ...monitorData(database), candidates: monitorData(database).candidates.map((item) => item.status === 'analyzing' ? { ...item, status: 'pending', error: 'Análise retomada após reinício do servidor.' } : item) },
    }));
    const results = await mapWithConcurrency(monitoredSources, 3, async (source) => {
      runtime.currentSource = source.acronym;
      return { source, items: await discoverSourceCandidates(source, config.monitorLookbackDays) };
    });
    const found = [];
    results.forEach((result, index) => {
      const source = monitoredSources[index];
      if (result.status === 'fulfilled') {
        found.push(...result.value.items);
        run.sources.push({ id: source.id, acronym: source.acronym, status: 'ok', found: result.value.items.length });
      } else {
        run.errors += 1;
        run.sources.push({ id: source.id, acronym: source.acronym, status: 'error', found: 0, message: result.reason?.message || 'Falha na fonte' });
      }
    });

    await updateDatabase((database) => {
      const monitor = monitorData(database);
      const publishedFingerprints = new Set(monitor.candidates.filter((item) => item.status === 'analyzed').map(candidateFingerprint));
      const pendingFingerprints = new Set();
      const retained = monitor.candidates.filter((item) => {
        if (['pending', 'error'].includes(item.status) && !isCandidateEligible(item.sourceId, item.title, item.url)) return false;
        const fingerprint = candidateFingerprint(item);
        if (['pending', 'error'].includes(item.status) && (publishedFingerprints.has(fingerprint) || pendingFingerprints.has(fingerprint))) return false;
        if (['pending', 'error'].includes(item.status)) pendingFingerprints.add(fingerprint);
        return true;
      });
      const known = new Set([...retained.map((item) => item.id), ...database.alerts.map((item) => candidateId(item.officialUrl || item.id))]);
      const knownFingerprints = new Set(retained.map(candidateFingerprint));
      const additions = found.flatMap((item) => {
        const id = candidateId(item.url);
        const fingerprint = candidateFingerprint(item);
        if (known.has(id) || knownFingerprints.has(fingerprint)) return [];
        known.add(id);
        knownFingerprints.add(fingerprint);
        return [{ ...item, id, status: 'pending', attempts: 0 }];
      });
      run.discovered = additions.length;
      const sourceRank = (item) => ['stf', 'stj', 'stj-informativos', 'stf-informativos', 'carf', 'trf1', 'trf2', 'trf3', 'trf4', 'trf5', 'trf6'].includes(item.sourceId) ? 0 : ['receita-federal', 'receita-cosit', 'receita-in', 'receita-notas', 'nfe-notas-tecnicas', 'sped-notas-tecnicas', 'diario-oficial', 'pgfn-pareceres'].includes(item.sourceId) ? 1 : 2;
      additions.sort((left, right) => sourceRank(left) - sourceRank(right));
      return { ...database, monitor: { ...monitor, candidates: [...additions, ...retained].slice(0, 2000) } };
    });

    if (analyze && config.monitorMaxAnalyses > 0) {
      runtime.phase = 'analysis';
      const database = await readDatabase();
      const queue = monitorData(database).candidates
        .filter((item) => item.status === 'pending' || (item.status === 'error' && item.attempts < 3))
        .sort((left, right) => {
          const leftDecision = /inteiro teor|acórdão|decisão/i.test(left.documentKind) ? 0 : 1;
          const rightDecision = /inteiro teor|acórdão|decisão/i.test(right.documentKind) ? 0 : 1;
          if (leftDecision !== rightDecision) return leftDecision - rightDecision;
          const leftStrong = hasStrongTaxSignal(left.title) ? 0 : 1;
          const rightStrong = hasStrongTaxSignal(right.title) ? 0 : 1;
          if (leftStrong !== rightStrong) return leftStrong - rightStrong;
          const leftDirect = isTaxRelated(left.title) ? 0 : 1;
          const rightDirect = isTaxRelated(right.title) ? 0 : 1;
          if (leftDirect !== rightDirect) return leftDirect - rightDirect;
          return String(right.publishedAt || right.discoveredAt).localeCompare(String(left.publishedAt || left.discoveredAt));
        })
        .slice(0, config.monitorMaxAnalyses);
      for (const candidate of queue) {
        runtime.currentSource = candidate.sourceAcronym;
        runtime.currentDocument = candidate.title;
        try {
          await updateDatabase((data) => ({ ...data, monitor: { ...monitorData(data), candidates: monitorData(data).candidates.map((item) => item.id === candidate.id ? { ...item, status: 'analyzing', attempts: item.attempts + 1 } : item) } }));
          const document = await collectOfficialPage(candidate.collectionUrl || candidate.url);
          if (document.characters < 200) throw new Error('Documento sem texto suficiente.');
          const analysis = await analyzeWithOllama(document);
          const alert = makeAlert(analysis, document, candidate);
          const publish = analysis.relevant && alert.score >= 6;
          await updateDatabase((data) => ({
            ...data,
            alerts: publish ? [alert, ...data.alerts] : data.alerts,
            meta: publish ? { ...data.meta, lastUpdatedAt: new Date().toISOString() } : data.meta,
            monitor: { ...monitorData(data), candidates: monitorData(data).candidates.map((item) => item.id === candidate.id ? { ...item, status: publish ? 'analyzed' : 'discarded', analyzedAt: new Date().toISOString(), score: alert.score, alertId: publish ? alert.id : null } : item) },
          }));
          run.analyzed += 1;
          if (publish) run.published += 1; else run.discarded += 1;
        } catch (error) {
          run.errors += 1;
          await updateDatabase((data) => ({ ...data, monitor: { ...monitorData(data), candidates: monitorData(data).candidates.map((item) => item.id === candidate.id ? { ...item, status: 'error', error: error.message, analyzedAt: new Date().toISOString() } : item) } }));
        }
      }
    }

    run.finishedAt = new Date().toISOString();
    const nextRunAt = new Date(Date.now() + config.monitorIntervalMinutes * 60000).toISOString();
    await updateDatabase((database) => ({ ...database, monitor: { ...monitorData(database), runs: [run, ...monitorData(database).runs].slice(0, 100), lastRunAt: run.finishedAt, nextRunAt } }));
    return { accepted: true, run };
  } catch (error) {
    runtime.error = error.message;
    throw error;
  } finally {
    runtime.running = false;
    runtime.phase = 'idle';
    runtime.currentSource = null;
    runtime.currentDocument = null;
  }
}

export function startMonitor() {
  if (!config.monitorEnabled || timer) return;
  setTimeout(() => runMonitor({ trigger: 'startup' }).catch((error) => console.error('Falha na varredura inicial:', error.message)), config.monitorInitialDelayMs).unref();
  timer = setInterval(() => runMonitor({ trigger: 'schedule' }).catch((error) => console.error('Falha na varredura agendada:', error.message)), config.monitorIntervalMinutes * 60000);
  timer.unref();
}
