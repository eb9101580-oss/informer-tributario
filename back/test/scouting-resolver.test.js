import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractProcessReferences,
  officialCourtUrl,
  resolveScoutingToPrimary,
} from '../src/services/scoutingResolver.js';
import {
  assessTaxIntelligenceCandidate,
} from '../src/services/taxIntelligencePolicy.js';

test('extractProcessReferences identifica REsp, AREsp, RE e formato CNJ no texto', () => {
  const text = `
    A 1ª Turma do Superior Tribunal de Justiça julgou o REsp 2211684/SP e o REsp nº 2.177.594.
    Também analisou o AREsp 1234567/RJ e citou o RE 1002003 do STF e o processo 0012345-67.2023.4.03.0000.
  `;

  const refs = extractProcessReferences(text);
  assert.ok(refs.length >= 4, `Deveria encontrar pelo menos 4 referências, encontrou ${refs.length}`);

  const hasResp1 = refs.some((r) => r.type === 'resp' && r.number === '2211684' && r.court === 'stj');
  const hasResp2 = refs.some((r) => r.type === 'resp' && r.number === '2177594' && r.court === 'stj');
  const hasAresp = refs.some((r) => r.type === 'aresp' && r.number === '1234567');
  const hasRe = refs.some((r) => r.type === 're' && r.number === '1002003' && r.court === 'stf');
  const hasCnj = refs.some((r) => r.type === 'cnj' && r.raw === '0012345-67.2023.4.03.0000');

  assert.ok(hasResp1, 'Deve extrair REsp 2211684');
  assert.ok(hasResp2, 'Deve extrair REsp 2.177.594 normalizando pontos');
  assert.ok(hasAresp, 'Deve extrair AREsp 1234567');
  assert.ok(hasRe, 'Deve extrair RE 1002003 para o STF');
  assert.ok(hasCnj, 'Deve extrair CNJ 0012345-67.2023.4.03.0000');
});

test('officialCourtUrl gera link oficial canônico para STJ e STF', () => {
  const respRef = { type: 'resp', number: '2211684', uf: 'SP', court: 'stj' };
  const stjUrl = officialCourtUrl(respRef);
  assert.ok(stjUrl.includes('processo.stj.jus.br'), 'URL do STJ deve apontar para processo.stj.jus.br');
  assert.ok(stjUrl.includes('2211684'), 'URL deve conter o número do REsp');

  const reRef = { type: 're', number: '1002003', court: 'stf' };
  const stfUrl = officialCourtUrl(reRef);
  assert.ok(stfUrl.includes('portal.stf.jus.br'), 'URL do STF deve apontar para portal.stf.jus.br');
  assert.ok(stfUrl.includes('1002003'), 'URL deve conter o número do RE');
});

test('resolveScoutingToPrimary promove notícia de scouting para candidato oficial primário', () => {
  const scoutingItem = {
    id: 'jota-resp-fundos-imobiliarios',
    url: 'https://www.jota.info/tributos/incide-irpj-sobre-ganho-em-operacoes-entre-fundos-imobiliarios-decide-stj',
    title: 'Incide IRPJ sobre ganho em operações entre fundos imobiliários, decide STJ',
    publishedAt: '2026-09-03T11:00:00.000Z',
    sourceType: 'journalistic',
    discoveryRole: 'scouting',
    sourceAcronym: 'JOTA',
  };

  const articleText = 'A 1ª Turma do STJ julgou o REsp 2211684 e definiu que incide IRPJ sobre a operação.';
  const primaryCandidate = resolveScoutingToPrimary(scoutingItem, articleText);

  assert.ok(primaryCandidate, 'Deve gerar candidato primário promovido');
  assert.equal(primaryCandidate.sourceType, 'official');
  assert.equal(primaryCandidate.discoveryRole, 'primary');
  assert.equal(primaryCandidate.sourceId, 'stj');
  assert.ok(primaryCandidate.url.includes('processo.stj.jus.br'));
  assert.ok(primaryCandidate.title.includes('REsp 2211684'));
  assert.equal(primaryCandidate.scoutingOriginalUrl, scoutingItem.url);
  assert.ok(primaryCandidate.inlineText.includes('Processo Judicial: REsp 2211684'));
  assert.ok(primaryCandidate.inlineText.includes('Origem do Radar: JOTA'));
});

test('título com verbo no presente ("decide STJ") e REsp passa na triagem tributária com elegibilidade', () => {
  const candidate = {
    sourceId: 'stj',
    sourceType: 'official',
    title: 'Incide IRPJ sobre ganho em operações entre fundos imobiliários, decide STJ (REsp 2211684)',
    documentKind: 'Julgamento Colegiado',
    publishedAt: new Date().toISOString(),
    content: 'A 1ª Turma do STJ julgou o REsp 2211684 e definiu a incidência de IRPJ.',
  };

  const assessment = assessTaxIntelligenceCandidate(candidate);
  assert.equal(assessment.concreteEvent, true, 'Deve reconhecer "decide STJ" como evento concreto');
  assert.equal(assessment.eligible, true, 'Deve ser elegível para análise e publicação');
  assert.ok(assessment.priorityOneTopics.includes('irpj-csll-jcp'), 'Deve identificar o tópico prioritário de IRPJ');
});
