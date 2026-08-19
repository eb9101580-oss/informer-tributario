import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { monitoredSources } from '../data/officialSources.js';
import { collectOfficialPage } from './collector.js';
import { analyzeWithOllama } from './ollama.js';
import { calculateScore, relevanceLabel } from './scoring.js';
import { discoverSourceCandidates, hasStrongTaxSignal, isCandidateEligible, isTaxRelated, sourceDateCoverage } from './sourceAdapters.js';
import { readDatabase, updateDatabase } from './store.js';
import { sectionIdsForSource } from '../data/sections.js';
import { isPublishedWithinDays, publicationDateKey } from './feedWindow.js';

const runtime = { running: false, phase: 'idle', currentSource: null, currentDocument: null, startedAt: null, error: null };
let timer;

export function monitorData(database) {
  return database.monitor || { candidates: [], runs: [], lastRunAt: null, nextRunAt: null };
}

export function candidateId(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

export function candidateFingerprint(candidate) {
  if (candidate.fingerprintKey) return createHash('sha256').update(`${candidate.sourceId}:${candidate.fingerprintKey}`).digest('hex').slice(0, 24);
  const substantiveTitle = String(candidate.title || '').split('—').slice(1).join('—').trim() || candidate.title || candidate.url;
  return createHash('sha256').update(`${candidate.sourceId}:${substantiveTitle}`).digest('hex').slice(0, 24);
}

export function normalizeMonitorTargetDate(value, now = new Date()) {
  if (value === undefined || value === null || value === '') return null;
  const targetDate = String(value).trim();
  const match = targetDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  const isValidCalendarDate = parsed
    && parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3]);
  if (!isValidCalendarDate) {
    const error = new Error('Informe uma data válida no formato AAAA-MM-DD.');
    error.statusCode = 400;
    throw error;
  }
  if (targetDate > publicationDateKey(now)) {
    const error = new Error('A data da busca não pode estar no futuro.');
    error.statusCode = 400;
    throw error;
  }
  return targetDate;
}

function makeAlert(analysis, document, candidate) {
  const score = calculateScore(analysis.criteria);
  const now = new Date().toISOString();
  const analyzedPublishedAt = Number.isNaN(Date.parse(analysis.publishedAt)) ? null : analysis.publishedAt;
  return {
    ...analysis, id: randomUUID(), score, relevance: relevanceLabel(score), officialUrl: candidate.url,
    publishedAt: candidate.publishedAt || document.publishedAt || analyzedPublishedAt,
    isDemo: false, createdAt: now, updatedAt: now,
    provenance: {
      collector: candidate.inlineText ? (candidate.inlineParser || 'Consulta oficial estruturada') : 'Scrapling', analyzer: `Ollama/${config.ollamaModel}`, collectorUrl: candidate.collectionUrl || candidate.url, sourceCharacters: document.characters,
      sourceId: candidate.sourceId, sourceName: candidate.sourceName, discoveredBy: candidate.discoveryMethod,
      sourceType: candidate.sourceType || 'official',
      documentKind: candidate.documentKind, discoveredAt: candidate.discoveredAt,
    },
    sections: candidate.sections || sectionIdsForSource(candidate.sourceId),
  };
}

function candidateSections(candidate) {
  return candidate.sections?.length ? candidate.sections : sectionIdsForSource(candidate.sourceId);
}

function operationalUpdateRank(candidate) {
  const text = `${candidate.title || ''} ${candidate.documentKind || ''}`;
  return /instru[cç][aã]o normativa|portaria|solu[cç][aã]o de (consulta|diverg[eê]ncia)|nota t[eé]cnica|ajuste sinief|manual|leiaute|layout|resolu[cç][aã]o|decreto|lei|altera[cç][aã]o/i.test(text) ? 0 : 1;
}

function sourceTypeRank(candidate) {
  return candidate.sourceType === 'official' ? 0 : 1;
}

function freshnessRank(candidate, now = Date.now()) {
  const discoveredAt = Date.parse(candidate.discoveredAt || '');
  return Number.isFinite(discoveredAt) && now - discoveredAt <= 2 * 60 * 60 * 1000 ? 0 : 1;
}

function sectionRank(candidate) {
  const sections = candidateSections(candidate);
  if (sections.includes('reforma')) return 0;
  if (sections.includes('obrigacoes')) return 1;
  return 2;
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

export async function runMonitor({ analyze = true, trigger = 'manual', targetDate: rawTargetDate = null } = {}) {
  const targetDate = normalizeMonitorTargetDate(rawTargetDate);
  if (runtime.running) return { accepted: false, message: 'Já existe uma varredura em andamento.' };
  runtime.running = true;
  runtime.phase = 'discovery';
  runtime.startedAt = new Date().toISOString();
  runtime.error = null;
  const run = { id: randomUUID(), trigger, targetDate, startedAt: runtime.startedAt, finishedAt: null, discovered: 0, analyzed: 0, published: 0, discarded: 0, errors: 0, sources: [] };

  try {
    await updateDatabase((database) => ({
      ...database,
      monitor: { ...monitorData(database), candidates: monitorData(database).candidates.map((item) => item.status === 'analyzing' ? { ...item, status: 'pending', error: 'Análise retomada após reinício do servidor.' } : item) },
    }));
    const results = await mapWithConcurrency(monitoredSources, 3, async (source) => {
      runtime.currentSource = source.acronym;
      return { source, items: await discoverSourceCandidates(source, config.monitorLookbackDays, { targetDate }) };
    });
    const found = [];
    results.forEach((result, index) => {
      const source = monitoredSources[index];
      if (result.status === 'fulfilled') {
        found.push(...result.value.items);
        run.sources.push({ id: source.id, acronym: source.acronym, status: 'ok', found: result.value.items.length, dateCoverage: targetDate ? sourceDateCoverage(source) : null });
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
        if (['pending', 'error'].includes(item.status) && !item.backfillDate && !isPublishedWithinDays(item.publishedAt, config.monitorLookbackDays, new Date(), { allowUnknown: true })) return false;
        const fingerprint = candidateFingerprint(item);
        if (['pending', 'error'].includes(item.status) && (publishedFingerprints.has(fingerprint) || pendingFingerprints.has(fingerprint))) return false;
        if (['pending', 'error'].includes(item.status)) pendingFingerprints.add(fingerprint);
        return true;
      });
      const known = new Set([...retained.map((item) => item.id), ...database.alerts.map((item) => candidateId(item.officialUrl || item.id))]);
      const knownFingerprints = new Set(retained.map(candidateFingerprint));
      const additions = found.flatMap((item) => {
        if (targetDate ? publicationDateKey(item.publishedAt) !== targetDate : !isPublishedWithinDays(item.publishedAt, config.monitorLookbackDays, new Date(), { allowUnknown: true })) return [];
        const id = candidateId(item.url);
        const fingerprint = candidateFingerprint(item);
        if (known.has(id) || knownFingerprints.has(fingerprint)) return [];
        known.add(id);
        knownFingerprints.add(fingerprint);
        return [{ ...item, id, status: 'pending', attempts: 0, backfillDate: targetDate || null }];
      });
      run.discovered = additions.length;
      const sourceRank = (item) => ['stf', 'stj', 'stj-informativos', 'stf-informativos', 'carf', 'trf1', 'trf2', 'trf3', 'trf4', 'trf5', 'trf6'].includes(item.sourceId) ? 0 : ['receita-federal', 'receita-cosit', 'receita-in', 'receita-notas', 'nfe-notas-tecnicas', 'sped-notas-tecnicas', 'diario-oficial', 'pgfn-pareceres'].includes(item.sourceId) ? 1 : 2;
      additions.sort((left, right) => sourceRank(left) - sourceRank(right));
      return { ...database, monitor: { ...monitor, candidates: [...additions, ...retained].slice(0, 2000) } };
    });

    if (analyze && config.monitorMaxAnalyses > 0) {
      runtime.phase = 'analysis';
      const database = await readDatabase();
      const prioritizedQueue = monitorData(database).candidates
        .filter((item) => item.status === 'pending' || (item.status === 'error' && item.attempts < 3))
        .filter((item) => !targetDate || item.backfillDate === targetDate || publicationDateKey(item.publishedAt) === targetDate)
        .sort((left, right) => {
          const leftFreshness = freshnessRank(left);
          const rightFreshness = freshnessRank(right);
          if (leftFreshness !== rightFreshness) return leftFreshness - rightFreshness;
          const leftDecision = /inteiro teor|acórdão|decisão/i.test(left.documentKind) ? 0 : 1;
          const rightDecision = /inteiro teor|acórdão|decisão/i.test(right.documentKind) ? 0 : 1;
          if (leftDecision !== rightDecision) return leftDecision - rightDecision;
          const leftOperational = operationalUpdateRank(left);
          const rightOperational = operationalUpdateRank(right);
          if (leftOperational !== rightOperational) return leftOperational - rightOperational;
          const leftSourceType = sourceTypeRank(left);
          const rightSourceType = sourceTypeRank(right);
          if (leftSourceType !== rightSourceType) return leftSourceType - rightSourceType;
          const leftSection = sectionRank(left);
          const rightSection = sectionRank(right);
          if (leftSection !== rightSection) return leftSection - rightSection;
          const leftStrong = hasStrongTaxSignal(left.title) ? 0 : 1;
          const rightStrong = hasStrongTaxSignal(right.title) ? 0 : 1;
          if (leftStrong !== rightStrong) return leftStrong - rightStrong;
          const leftDirect = isTaxRelated(left.title) ? 0 : 1;
          const rightDirect = isTaxRelated(right.title) ? 0 : 1;
          if (leftDirect !== rightDirect) return leftDirect - rightDirect;
          return String(right.publishedAt || right.discoveredAt).localeCompare(String(left.publishedAt || left.discoveredAt));
        });
      const reserved = [];
      const reservedIds = new Set();
      const judicialCandidate = prioritizedQueue.find((candidate) => /^trf[1-6]$/.test(candidate.sourceId)
        && /inteiro teor|acórdão|decisão/i.test(candidate.documentKind))
        || prioritizedQueue.find((candidate) => /inteiro teor|acórdão|decisão/i.test(candidate.documentKind));
      if (judicialCandidate) {
        reserved.push(judicialCandidate);
        reservedIds.add(judicialCandidate.id);
      }
      // Preserva as duas curadorias quando há vagas, sem bloquear a fila judicial.
      for (const sectionId of ['reforma', 'obrigacoes']) {
        for (const candidate of prioritizedQueue) {
          if (reserved.length >= config.monitorMaxAnalyses || reservedIds.size >= Math.min(3, config.monitorMaxAnalyses)) break;
          if (reservedIds.has(candidate.id) || !candidateSections(candidate).includes(sectionId)) continue;
          reserved.push(candidate);
          reservedIds.add(candidate.id);
          break;
        }
      }
      const queue = [...reserved, ...prioritizedQueue.filter((item) => !reservedIds.has(item.id))]
        .slice(0, config.monitorMaxAnalyses);
      for (const candidate of queue) {
        runtime.currentSource = candidate.sourceAcronym;
        runtime.currentDocument = candidate.title;
        try {
          await updateDatabase((data) => ({ ...data, monitor: { ...monitorData(data), candidates: monitorData(data).candidates.map((item) => item.id === candidate.id ? { ...item, status: 'analyzing', attempts: item.attempts + 1 } : item) } }));
          const collected = candidate.inlineText
            ? { url: candidate.url, title: candidate.title, text: candidate.inlineText, characters: candidate.inlineText.length, contentType: 'text/plain', publishedAt: candidate.publishedAt, parser: candidate.inlineParser || 'Consulta oficial estruturada' }
            : await collectOfficialPage(candidate.collectionUrl || candidate.url);
          const document = {
            ...collected,
            candidateTitle: candidate.title,
            documentKind: candidate.documentKind,
            sourceName: candidate.sourceName,
            sections: candidateSections(candidate),
          };
          if (document.characters < 200) throw new Error('Documento sem texto suficiente.');
          const analysis = await analyzeWithOllama(document);
          const alert = makeAlert(analysis, document, candidate);
          const publish = analysis.relevant && alert.score >= 6
            && (targetDate ? publicationDateKey(alert.publishedAt) === targetDate : isPublishedWithinDays(alert.publishedAt, config.monitorLookbackDays));
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
