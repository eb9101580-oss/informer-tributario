import { monitoredSources } from '../data/officialSources.js';
import { config } from '../config.js';
import { databaseConfigured, ensureAppSchema, query } from './db.js';

export function sourceFromRow(row) {
  return {
    id: `custom-${row.id}`,
    name: row.name,
    acronym: String(row.name).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 8).toUpperCase() || 'FONTE',
    category: row.category || 'Fonte adicionada pela equipe',
    description: 'Fonte personalizada aprovada pelo administrador do Informer.',
    url: row.url,
    discoveryUrl: row.url,
    focus: ['Direito tributário'],
    monitoring: 'A cada ciclo da varredura',
    priority: 50,
    color: 'purple',
    adapter: 'custom-links',
    sourceType: row.source_type || 'journalistic',
    custom: true,
  };
}

export async function queryActiveCustomSources({
  ensureSchema = ensureAppSchema,
  queryFn = query,
} = {}) {
  await ensureSchema();
  const result = await queryFn(`SELECT * FROM custom_sources WHERE status = 'active' ORDER BY created_at ASC`);
  return result.rows.map(sourceFromRow);
}

export async function localCustomSources({
  isDatabaseConfigured = databaseConfigured,
  ensureSchema = ensureAppSchema,
  queryFn = query,
} = {}) {
  if (!isDatabaseConfigured()) return [];
  return queryActiveCustomSources({ ensureSchema, queryFn });
}

async function remoteCustomSources() {
  if (!config.customSourcesUrl) return [];
  const response = await fetch(config.customSourcesUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'Informer-Tributario/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Catálogo de fontes personalizadas respondeu com status ${response.status}.`);
  const body = await response.json();
  return Array.isArray(body.items) ? body.items.filter((source) => source.custom === true && source.adapter === 'custom-links') : [];
}

export async function loadMonitoredSources() {
  let custom = [];
  try { custom = config.customSourcesUrl ? await remoteCustomSources() : await localCustomSources(); }
  catch (error) { console.warn(`Fontes personalizadas indisponíveis; mantendo catálogo padrão: ${error.message}`); }
  const ids = new Set(monitoredSources.map((source) => source.id));
  return [...monitoredSources, ...custom.filter((source) => !ids.has(source.id))];
}
