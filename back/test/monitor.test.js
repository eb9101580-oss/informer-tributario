import test from 'node:test';
import assert from 'node:assert/strict';
import { canFastPublishCandidate, candidateFingerprint, candidateId, classifyCandidateForQueue, enrichFastAlert, fastTriageCandidate, makeFastAlert, normalizeMonitorTargetDate, shouldRetainQueuedCandidate } from '../src/services/monitor.js';
import { carfSolrQueryUrl, hasStjTaxSubject, hasStrongTaxSignal, isCandidateEligible, isDjenDecision, isExcludedTaxTopic, isTaxRelated, mapCarfDecisions, mapDjenDecisions, mapReceitaNormasLinks, mapStjDailyDecisions, normalizeSearchText, receitaNormasQueryUrl, selectStjMetadataResources, sourceDateCoverage, stjPublicationDate, structuredDateRange } from '../src/services/sourceAdapters.js';
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
  assert.equal(isTaxRelated('Empréstimo consignado com taxa de juros e repetição de indébito bancário'), false);
  assert.equal(isTaxRelated('Atributo processual da sentença civil'), false);
  assert.equal(isTaxRelated('Regime aduaneiro e AFRMM na importação'), true);
  assert.equal(isTaxRelated('Nota técnica sobre manutenção de computadores'), false);
  assert.equal(isTaxRelated('Parecer da comissão de cultura'), false);
  assert.equal(isTaxRelated('Informativo semanal de licitações'), false);
});

test('regra editorial exclui Simples Nacional comum e permite mudança estrutural da Reforma', () => {
  assert.equal(isExcludedTaxTopic('Alteração do Simples Nacional'), true);
  assert.equal(isExcludedTaxTopic('Alteração do SIMPLES-NACIONAL'), true);
  assert.equal(isCandidateEligible('receita-in', 'Nova regra do Simples Nacional', 'https://normasinternet2.receita.fazenda.gov.br/consulta/externa/1'), false);
  assert.equal(isCandidateEligible('trf3', 'Sentença tributária', 'https://comunicaapi.pje.jus.br/certidao', 'Discussão relativa ao Simples Nacional.'), false);
  assert.equal(isCandidateEligible('receita-in', 'Resolução altera a transição do Simples Nacional para IBS e CBS', 'https://normasinternet2.receita.fazenda.gov.br/consulta/externa/2'), true);
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

test('fingerprint une o mesmo evento jurídico entre fontes e preserva fases novas', () => {
  const official = { sourceId: 'stj', title: 'STJ afeta REsp 1.985.788/RJ como repetitivo', publishedAt: '2026-08-21' };
  const secondary = { sourceId: 'jota', title: 'REsp nº 1.985.788 / RJ é afetado pelo STJ', publishedAt: '2026-08-21' };
  const merit = { sourceId: 'stj', title: 'STJ julga o mérito do REsp 1.985.788/RJ e fixa tese', publishedAt: '2026-08-21' };
  assert.equal(candidateFingerprint(official), candidateFingerprint(secondary));
  assert.notEqual(candidateFingerprint(official), candidateFingerprint(merit));
});

test('triagem rápida prioriza mérito tributário oficial sobre ato processual genérico', () => {
  const merit = fastTriageCandidate({
    sourceId: 'trf3', sourceType: 'official', discoveryMethod: 'trf-djen', publishedAt: '2026-08-19',
    documentKind: 'Acórdão', title: 'Acórdão fixa tese nova sobre restituição de crédito tributário de ICMS',
  });
  const procedural = fastTriageCandidate({
    sourceId: 'trf3', sourceType: 'official', discoveryMethod: 'trf-djen', publishedAt: '2026-08-19',
    documentKind: 'Decisão', title: 'Intimação para ciência e abertura de prazo em execução fiscal',
  });
  assert.ok(merit.score > procedural.score);
  assert.match(merit.engine, /^regras-tributarias-v2:/);
  assert.ok(procedural.signals.includes('possivel-ato-processual'));
});

test('TRFs aceitam apenas notícia com tese ou precedente e rejeitam rotina institucional', () => {
  assert.equal(isCandidateEligible('trf1', 'Informativos Avisos Infojef', 'https://www.trf1.jus.br/trf1/informativos'), false);
  assert.equal(isCandidateEligible('trf1', 'Sistemas Imposto de Renda', 'https://www.trf1.jus.br/trf1/magistrado/sistemas'), false);
  assert.equal(isCandidateEligible('trf4', 'Turma fixa tese nova sobre incidência de Cofins sobre receita', 'https://www.trf4.jus.br/noticia/123'), true);
  assert.equal(isCandidateEligible('trf1', 'Sentença — Direito tributário: empréstimo consignado', 'https://comunicaapi.pje.jus.br/certidao', 'Taxa de juros e repetição de indébito bancário.'), false);
  assert.equal(isCandidateEligible('trf1', 'Sentença — Direito tributário: empresa pública', 'https://comunicaapi.pje.jus.br/certidao', 'Imposto sobre serviços, ISS e imunidade tributária recíproca.'), false);
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

test('busca complementar de ontem preserva a fila de hoje', () => {
  const now = new Date('2026-08-20T15:00:00-03:00');
  assert.equal(shouldRetainQueuedCandidate({ publishedAt: '2026-08-20' }, '2026-08-19', now), true);
  assert.equal(shouldRetainQueuedCandidate({ publishedAt: '2026-08-19' }, null, now), true);
  assert.equal(shouldRetainQueuedCandidate({ publishedAt: '2026-08-18' }, null, now), false);
  assert.equal(shouldRetainQueuedCandidate({ publishedAt: '' }, null, now), false);
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
    { id: 10, hash: 'hash-publico', data_disponibilizacao: '2026-08-19', tipoDocumento: 'Sentença Tipo B', tipoComunicacao: 'Intimação', nomeOrgao: '3ª Turma', numeroprocessocommascara: '5000000-00.2026.4.03.0000', texto: 'A omissão foi debatida. Decisão sobre crédito tributário de ICMS.' },
    { id: 11, hash: 'ato', data_disponibilizacao: '2026-08-19', tipoDocumento: 'Ato ordinatório', tipoComunicacao: 'Intimação', texto: 'Parcelamento do débito tributário.' },
    { id: 12, hash: 'civil', data_disponibilizacao: '2026-08-19', tipoDocumento: 'Sentença', tipoComunicacao: 'Intimação', texto: 'Sentença de responsabilidade civil.' },
    { id: 13, hash: 'ontem', data_disponibilizacao: '2026-08-18', tipoDocumento: 'Acórdão', tipoComunicacao: 'Intimação', texto: 'Acórdão sobre imposto de renda.' },
    { id: 14, hash: 'consumidor', data_disponibilizacao: '2026-08-19', tipoDocumento: 'Sentença', tipoComunicacao: 'Intimação', texto: 'Empréstimo consignado com taxa de juros e repetição de indébito bancário.' },
  ] };
  const items = mapDjenDecisions(payload, source, '2026-08-19');
  assert.equal(items.length, 1);
  assert.equal(items[0].fingerprintKey, 'djen:10');
  assert.equal(items[0].publishedAt, '2026-08-19');
  assert.match(items[0].url, /hash-publico\/certidao$/);
  assert.match(items[0].title, /Direito tributário/);
  assert.match(items[0].title, /crédito tributário/);
  assert.match(items[0].title, /^Sentença ·/);
  assert.doesNotMatch(items[0].title, /Tipo B/i);
  assert.equal(items[0].sourceDocumentType, 'Sentença Tipo B');
  assert.equal(items[0].documentKind, 'Sentença judicial publicada no DJEN');
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

test('fila do Ollama contém apenas fontes oficiais aprovadas pela política', () => {
  const approved = classifyCandidateForQueue({
    sourceId: 'receita-in', sourceType: 'official', discoveryMethod: 'receita-normas', publishedAt: '2026-08-20',
    documentKind: 'Instrução Normativa', title: 'Instrução Normativa altera obrigação acessória do SPED para empresas',
    url: 'https://normasinternet2.receita.fazenda.gov.br/consulta/123',
  });
  const scouting = classifyCandidateForQueue({
    sourceId: 'jota', sourceType: 'journalistic', discoveryRole: 'scouting', publishedAt: '2026-08-20',
    title: 'Notícia tributária', url: 'https://www.jota.info/tributos/exemplo',
  });
  const excluded = classifyCandidateForQueue({
    sourceId: 'stf', sourceType: 'official', publishedAt: '2026-08-20', documentKind: 'Decisão monocrática',
    title: 'Decisão monocrática sobre ICMS', url: 'https://portal.stf.jus.br/processos/123',
  });
  assert.equal(approved.status, 'pending');
  assert.equal(scouting.status, 'scouting');
  assert.equal(excluded.status, 'discarded');
  assert.match(excluded.discardReason, /monocrática/i);
});

test('triagem nunca publica antes da análise estruturada do Ollama', () => {
  const candidate = {
    sourceId: 'trf3', sourceType: 'official', discoveryMethod: 'trf-djen', publishedAt: '2026-08-20',
    documentKind: 'Acórdão', sourceName: 'TRF3', title: 'Acórdão fixa tese nova sobre crédito tributário de ICMS',
    url: 'https://comunicaapi.pje.jus.br/certidao/123',
    inlineText: 'A Turma julgou o mérito sobre a restituição de crédito tributário de ICMS e definiu a incidência aplicável ao caso.',
  };
  assert.equal(canFastPublishCandidate(candidate), false);
  const alert = makeFastAlert(candidate);
  assert.equal(alert.provenance.analysisMode, 'fast-triage');
  assert.equal(alert.provenance.detailedAnalysisPending, true);
  assert.equal(alert.publishedAt, '2026-08-20');
  assert.match(alert.summary, /ICMS/);
  assert.ok(alert.score >= 7);
});

test('triagem rápida extrai pedido, dispositivo e impacto da sentença integral', () => {
  const candidate = {
    sourceId: 'trf3', sourceType: 'official', discoveryMethod: 'trf-djen', publishedAt: '2026-08-21',
    documentKind: 'Sentença judicial publicada no DJEN', sourceName: 'Tribunal Regional Federal da 3ª Região',
    title: 'Sentença · 5003025-06.2026.4.03.6110 — Direito tributário: PIS e Cofins nas próprias bases de cálculo',
    url: 'https://comunicaapi.pje.jus.br/certidao/resultado',
    inlineText: 'RELATÓRIO Trata-se de mandado de segurança objetivando excluir o PIS e a Cofins de suas próprias bases de cálculo. FUNDAMENTAÇÃO A pretensão não pode ser acolhida porque inexiste fundamento legal para a exclusão do PIS e da Cofins de suas próprias bases. DISPOSITIVO Ante o exposto, julgo IMPROCEDENTE o pedido e DENEGO A SEGURANÇA pleiteada, nos termos do artigo 487, I, do CPC.',
  };
  const alert = makeFastAlert(candidate);
  assert.match(alert.title, /5003025-06\.2026\.4\.03\.6110/);
  assert.match(alert.title, /tese rejeitada/i);
  assert.match(alert.summary, /pedido buscava excluir o PIS e a Cofins/i);
  assert.match(alert.whatChanged, /julgo IMPROCEDENTE.*DENEGO A SEGURANÇA/i);
  assert.match(alert.practicalImpact, /tese do contribuinte foi rejeitada/i);
  assert.match(alert.practicalImpact, /primeira instância/i);
  assert.doesNotMatch(alert.whatChanged, /triagem automática/i);

  const oldGeneric = { ...alert, summary: 'Resumo genérico', whatChanged: 'Triagem automática.', provenance: { ...alert.provenance, analysisMode: 'fast-triage' } };
  assert.match(enrichFastAlert(oldGeneric, candidate).whatChanged, /julgo IMPROCEDENTE/i);
});
