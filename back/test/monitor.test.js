import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFingerprint, candidateId, fastTriageCandidate, normalizeMonitorTargetDate } from '../src/services/monitor.js';
import { carfSolrQueryUrl, hasStjTaxSubject, hasStrongTaxSignal, isCandidateEligible, isDjenDecision, isTaxRelated, mapCarfDecisions, mapDjenDecisions, mapReceitaNormasLinks, mapStjDailyDecisions, normalizeSearchText, receitaNormasQueryUrl, selectStjMetadataResources, sourceDateCoverage, stjPublicationDate, structuredDateRange } from '../src/services/sourceAdapters.js';
import { hasCandidateText, packCandidateText, unpackCandidateText } from '../src/services/candidateText.js';

test('filtro tributário ignora acentos e identifica tributos', () => {
  assert.equal(normalizeSearchText('Execução e Contribuição'), 'execucao e contribuicao');
  assert.equal(isTaxRelated('Decisão sobre crédito tributário e ICMS'), true);
  assert.equal(isTaxRelated('Licitação para compra de móveis'), false);
  assert.equal(isTaxRelated('Comissão de fiscalização'), false);
  assert.equal(hasStrongTaxSignal('Gratificação de atividade tributária'), false);
  assert.equal(hasStrongTaxSignal('Crédito tributário de ICMS'), true);
  assert.equal(isTaxRelated('Retenção de IRRF e contribuição ao PASEP'), true);
  assert.equal(isTaxRelated('Imunidade tributária e repetição de indébito de IPTU'), true);
  assert.equal(isTaxRelated('Regime aduaneiro e AFRMM na importação'), true);
  assert.equal(isTaxRelated('Nota técnica sobre manutenção de computadores'), false);
  assert.equal(isTaxRelated('Parecer da comissão de cultura'), false);
  assert.equal(isTaxRelated('Informativo semanal de licitações'), false);
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

test('triagem rápida prioriza mérito tributário oficial sobre ato processual genérico', () => {
  const merit = fastTriageCandidate({
    sourceId: 'trf3', sourceType: 'official', discoveryMethod: 'trf-djen', publishedAt: '2026-08-19',
    documentKind: 'Acórdão', title: 'Acórdão julga o mérito da restituição de crédito tributário de ICMS',
  });
  const procedural = fastTriageCandidate({
    sourceId: 'trf3', sourceType: 'official', discoveryMethod: 'trf-djen', publishedAt: '2026-08-19',
    documentKind: 'Decisão', title: 'Intimação para ciência e abertura de prazo em execução fiscal',
  });
  assert.ok(merit.score > procedural.score);
  assert.equal(merit.engine, 'regras-tributarias-v1');
  assert.ok(procedural.signals.includes('possivel-ato-processual'));
});

test('TRFs aceitam notícia tributária e rejeitam navegação institucional', () => {
  assert.equal(isCandidateEligible('trf1', 'Informativos Avisos Infojef', 'https://www.trf1.jus.br/trf1/informativos'), false);
  assert.equal(isCandidateEligible('trf1', 'Sistemas Imposto de Renda', 'https://www.trf1.jus.br/trf1/magistrado/sistemas'), false);
  assert.equal(isCandidateEligible('trf4', 'Turma decide incidência de Cofins sobre receita', 'https://www.trf4.jus.br/noticia/123'), true);
});

test('Receita aceita atos normativos tributários e elimina autorizações individuais', () => {
  const baseUrl = 'https://normasinternet2.receita.fazenda.gov.br/#/consulta/externa/152980';
  assert.equal(isCandidateEligible('receita-in', 'Instrução Normativa RFB sobre obrigações acessórias', baseUrl), true);
  assert.equal(isCandidateEligible('receita-in', 'Ato Declaratório Executivo altera o leiaute do SPED', baseUrl), true);
  assert.equal(isCandidateEligible('receita-in', 'Ato Declaratório Executivo habilita empresa no despacho aduaneiro', baseUrl), false);
  assert.equal(isCandidateEligible('receita-in', 'Ato Declaratório Executivo declara empresa habilitada no despacho aduaneiro', baseUrl), false);
  assert.equal(isCandidateEligible('receita-in', 'Ato Declaratório Executivo declara empresa habilitada conforme a Instrução Normativa RFB nº 1.381', baseUrl), false);
  assert.equal(isCandidateEligible('receita-notas', 'Nota técnica sobre manutenção predial', baseUrl), false);
  assert.equal(isCandidateEligible('receita-notas', 'Nota técnica sobre o leiaute do SPED', baseUrl), true);
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
  assert.equal(sourceDateCoverage({ adapter: 'receita-normas' }), 'exact');
  assert.equal(sourceDateCoverage({ adapter: 'carf-solr' }), 'exact');
  assert.equal(sourceDateCoverage({ adapter: 'senado-api' }), 'date-filtered');
  assert.equal(sourceDateCoverage({ adapter: 'stf-jurisprudence' }), 'mixed');
  assert.equal(sourceDateCoverage({ adapter: 'trf-djen' }), 'mixed');
  assert.equal(sourceDateCoverage({ adapter: 'links' }), 'current-index');
});

test('SIJUT consulta hoje e ontem por publicação, sem depender de termo textual', () => {
  assert.deepEqual(structuredDateRange(null, new Date('2026-08-20T15:00:00-03:00')), { startDate: '2026-08-19', endDate: '2026-08-20' });
  assert.deepEqual(structuredDateRange('2026-08-18'), { startDate: '2026-08-18', endDate: '2026-08-18' });
  const cosit = new URL(receitaNormasQueryUrl('receita-cosit', null, new Date('2026-08-20T15:00:00-03:00')));
  assert.equal(cosit.searchParams.get('tipoData'), '2');
  assert.equal(cosit.searchParams.get('dt_inicio'), '19/08/2026');
  assert.equal(cosit.searchParams.get('dt_fim'), '20/08/2026');
  assert.equal(cosit.searchParams.get('ordemColuna'), 'Publicacao');
  assert.equal(cosit.searchParams.get('ordemDirecao'), 'DESC');
  assert.equal(cosit.searchParams.get('tiposAtosSelecionados'), '72;73');
  assert.equal(cosit.searchParams.get('siglaOrgaoFacet'), 'Cosit');
  assert.equal(cosit.searchParams.has('termoBusca'), false);
  const normative = new URL(receitaNormasQueryUrl('receita-in', '2026-08-18'));
  assert.match(normative.searchParams.get('tiposAtosSelecionados'), /^42;79;7;/);
});

test('SIJUT mantém só atos da data e transforma o link de resultado em URL canônica', () => {
  const source = { id: 'receita-cosit', sections: ['geral'] };
  const items = mapReceitaNormasLinks([
    {
      title: 'Solução de Consulta 153 Cosit 20/08/2026 Assunto: IRRF',
      url: 'https://normasinternet2.receita.fazenda.gov.br/#/consulta/externa/152980/vs/abc123',
      publishedAt: '2026-08-20',
    },
    {
      title: 'Solução de Consulta 140 Cosit 18/08/2026 Assunto: IRPJ',
      url: 'https://normasinternet2.receita.fazenda.gov.br/#/consulta/externa/152900/vs/abc123',
      publishedAt: '2026-08-18',
    },
  ], source, { startDate: '2026-08-19', endDate: '2026-08-20' });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://normasinternet2.receita.fazenda.gov.br/#/consulta/externa/152980');
  assert.equal(items[0].collectionUrl, 'https://normasinternet2.receita.fazenda.gov.br/api/consulta-externa/ato/152980/visao/original');
  assert.equal(items[0].fingerprintKey, 'receita-normas:152980');
  assert.match(items[0].documentKind, /COSIT/);
});

test('CARF consulta a publicação por data e mapeia somente PDF e datas válidos', () => {
  const query = new URL(carfSolrQueryUrl('2026-08-14'));
  assert.equal(query.searchParams.get('fq'), 'dt_publicacao_tdt:[2026-08-14T00:00:00Z TO 2026-08-14T23:59:59Z]');
  assert.equal(query.searchParams.get('rows'), '200');
  const base = {
    id: '11462929', dt_publicacao_tdt: '2026-08-14T00:00:00Z', numero_processo_s: '11065.721581/2015-73',
    numero_decisao_s: '2201-012.430', materia_s: 'Contribuições Sociais Previdenciárias',
    ementa_s: 'Crédito tributário. Multa qualificada.', decisao_txt: ['Recurso parcialmente provido.'],
    nome_relator_s: 'Fernando Gomes Favacho', nome_arquivo_pdf_s: '11065721581201573_7402665.pdf',
  };
  const items = mapCarfDecisions({ response: { docs: [
    base,
    { ...base, id: 'futuro', dt_publicacao_tdt: '2209-08-14T00:00:00Z' },
    { ...base, id: 'invalido', dt_publicacao_tdt: '2026-02-30T00:00:00Z' },
    { ...base, id: 'path', nome_arquivo_pdf_s: '../segredo.pdf' },
    { ...base, id: 'fora', dt_publicacao_tdt: '2026-08-13T00:00:00Z' },
  ] } }, { startDate: '2026-08-14', endDate: '2026-08-14' }, new Date('2026-08-20T12:00:00Z'));
  assert.equal(items.length, 1);
  assert.equal(items[0].publishedAt, '2026-08-14');
  assert.equal(items[0].fingerprintKey, 'carf:11462929');
  assert.match(items[0].url, /11065721581201573_7402665\.pdf$/);
  assert.match(items[0].title, /2201-012\.430/);
  assert.match(unpackCandidateText(items[0]), /Recurso parcialmente provido/);
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
