import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFingerprint, candidateId, normalizeMonitorTargetDate } from '../src/services/monitor.js';
import { hasStjTaxSubject, hasStrongTaxSignal, isCandidateEligible, isDjenDecision, isTaxRelated, mapDjenDecisions, mapStjDailyDecisions, normalizeSearchText, selectStjMetadataResources, sourceDateCoverage, stjPublicationDate } from '../src/services/sourceAdapters.js';
import { hasCandidateText, packCandidateText, unpackCandidateText } from '../src/services/candidateText.js';

test('filtro tributário ignora acentos e identifica tributos', () => {
  assert.equal(normalizeSearchText('Execução e Contribuição'), 'execucao e contribuicao');
  assert.equal(isTaxRelated('Decisão sobre crédito tributário e ICMS'), true);
  assert.equal(isTaxRelated('Licitação para compra de móveis'), false);
  assert.equal(isTaxRelated('Comissão de fiscalização'), false);
  assert.equal(hasStrongTaxSignal('Gratificação de atividade tributária'), false);
  assert.equal(hasStrongTaxSignal('Crédito tributário de ICMS'), true);
});

test('id do candidato é estável por URL', () => {
  const url = 'https://www.stj.jus.br/decisao/123';
  assert.equal(candidateId(url), candidateId(url));
  assert.notEqual(candidateId(url), candidateId(`${url}4`));
});

test('fingerprint agrupa processos com a mesma ementa', () => {
  const base = { sourceId: 'stj' };
  assert.equal(candidateFingerprint({ ...base, title: 'REsp 1 — Ementa tributária idêntica' }), candidateFingerprint({ ...base, title: 'REsp 2 — Ementa tributária idêntica' }));
  assert.notEqual(candidateFingerprint({ ...base, fingerprintKey: 'stj-djen:1' }), candidateFingerprint({ ...base, fingerprintKey: 'stj-djen:2' }));
});

test('TRFs aceitam notícia tributária e rejeitam navegação institucional', () => {
  assert.equal(isCandidateEligible('trf1', 'Informativos Avisos Infojef', 'https://www.trf1.jus.br/trf1/informativos'), false);
  assert.equal(isCandidateEligible('trf1', 'Sistemas Imposto de Renda', 'https://www.trf1.jus.br/trf1/magistrado/sistemas'), false);
  assert.equal(isCandidateEligible('trf4', 'Turma decide incidência de Cofins sobre receita', 'https://www.trf4.jus.br/noticia/123'), true);
});

test('data manual aceita apenas dia civil válido e não futuro', () => {
  const now = new Date('2026-08-19T15:00:00-03:00');
  assert.equal(normalizeMonitorTargetDate('2026-08-19', now), '2026-08-19');
  assert.equal(normalizeMonitorTargetDate('', now), null);
  assert.throws(() => normalizeMonitorTargetDate('2026-02-30', now), /data válida/);
  assert.throws(() => normalizeMonitorTargetDate('2026-08-20', now), /futuro/);
});

test('STJ seleciona o arquivo diário pedido e somente assuntos da raiz tributária 14', () => {
  const resources = [
    { name: 'metadados20260817', format: 'JSON', url: 'https://stj.example/17.json' },
    { name: 'metadados20260818.json', format: 'JSON', url: 'https://stj.example/18.json' },
    { name: '20260818.zip', format: 'ZIP', url: 'https://stj.example/18.zip' },
  ];
  assert.equal(selectStjMetadataResources(resources, '2026-08-17')[0].url, 'https://stj.example/17.json');
  assert.equal(selectStjMetadataResources(resources)[0].publicationDate, '2026-08-18');
  assert.equal(hasStjTaxSubject('00014.06017.14951.'), true);
  assert.equal(hasStjTaxSubject('00110.00014.06017.'), false);
});

test('STJ transforma metadados diários tributários em links estáveis para o inteiro teor', () => {
  const items = mapStjDailyDecisions([
    { SeqDocumento: 392335421, dataPublicacao: '2026-08-17', tipoDocumento: 'ACÓRDÃO', numeroRegistro: '202504681912', processo: 'REsp 2265327', NM_MINISTRO: 'REGINA HELENA COSTA', teor: 'Negando', assuntos: '00014.06017.14951.14953.' },
    { SeqDocumento: 2, dataPublicacao: '2026-08-17', tipoDocumento: 'DECISÃO', numeroRegistro: '2', processo: 'HC 2', assuntos: '00003.00001.' },
    { SeqDocumento: 3, dataPublicacao: '2026-08-16', tipoDocumento: 'DECISÃO', numeroRegistro: '3', processo: 'REsp 3', assuntos: '00014.06017.' },
  ], '2026-08-17');
  assert.equal(items.length, 1);
  assert.equal(items[0].publishedAt, '2026-08-17');
  assert.equal(items[0].fingerprintKey, 'stj-djen:392335421');
  assert.match(items[0].url, /num_registro=202504681912/);
  assert.match(items[0].documentKind, /acórdão/);
  assert.equal(stjPublicationDate('17/08/2026'), '2026-08-17');
});

test('busca por data informa a cobertura real de cada conector', () => {
  assert.equal(sourceDateCoverage({ adapter: 'stj-open-data' }), 'exact');
  assert.equal(sourceDateCoverage({ adapter: 'camara-api' }), 'exact');
  assert.equal(sourceDateCoverage({ adapter: 'senado-api' }), 'date-filtered');
  assert.equal(sourceDateCoverage({ adapter: 'stf-jurisprudence' }), 'mixed');
  assert.equal(sourceDateCoverage({ adapter: 'trf-djen' }), 'mixed');
  assert.equal(sourceDateCoverage({ adapter: 'links' }), 'current-index');
});

test('DJEN conserva somente decisões tributárias da data e gera certidão oficial estável', () => {
  const source = { id: 'trf3', acronym: 'TRF3' };
  const payload = { items: [
    { id: 10, hash: 'hash-publico', data_disponibilizacao: '2026-08-19', tipoDocumento: 'Decisão', tipoComunicacao: 'Intimação', nomeOrgao: '3ª Turma', numeroprocessocommascara: '5000000-00.2026.4.03.0000', texto: 'Decisão sobre crédito tributário de ICMS.' },
    { id: 11, hash: 'ato', data_disponibilizacao: '2026-08-19', tipoDocumento: 'Ato ordinatório', tipoComunicacao: 'Intimação', texto: 'Parcelamento do débito tributário.' },
    { id: 12, hash: 'civil', data_disponibilizacao: '2026-08-19', tipoDocumento: 'Sentença', tipoComunicacao: 'Intimação', texto: 'Sentença de responsabilidade civil.' },
    { id: 13, hash: 'ontem', data_disponibilizacao: '2026-08-18', tipoDocumento: 'Acórdão', tipoComunicacao: 'Intimação', texto: 'Acórdão sobre imposto de renda.' },
  ] };
  const items = mapDjenDecisions(payload, source, '2026-08-19');
  assert.equal(items.length, 1);
  assert.equal(items[0].fingerprintKey, 'djen:10');
  assert.equal(items[0].publishedAt, '2026-08-19');
  assert.match(items[0].url, /hash-publico\/certidao$/);
  assert.match(items[0].title, /Direito tributário/);
  assert.match(items[0].inlineText, /crédito tributário/);
  assert.equal(items[0].inlineParser, 'API oficial do DJEN/CNJ');
  assert.equal(isDjenDecision(payload.items[0]), true);
  assert.equal(isDjenDecision(payload.items[1]), false);
});

test('texto integral grande da decisão é compactado sem perda para a fila', () => {
  const original = 'Decisão sobre crédito tributário de ICMS. '.repeat(1000);
  const packed = packCandidateText(original);
  assert.equal(packed.inlineText, undefined);
  assert.equal(hasCandidateText(packed), true);
  assert.equal(unpackCandidateText(packed), original);
  assert.ok(packed.inlineTextGzip.length < original.length / 5);
});
