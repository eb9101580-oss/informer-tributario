import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFingerprint, candidateId } from '../src/services/monitor.js';
import { hasStrongTaxSignal, isCandidateEligible, isTaxRelated, normalizeSearchText } from '../src/services/sourceAdapters.js';

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
});

test('TRFs aceitam notícia tributária e rejeitam navegação institucional', () => {
  assert.equal(isCandidateEligible('trf1', 'Informativos Avisos Infojef', 'https://www.trf1.jus.br/trf1/informativos'), false);
  assert.equal(isCandidateEligible('trf1', 'Sistemas Imposto de Renda', 'https://www.trf1.jus.br/trf1/magistrado/sistemas'), false);
  assert.equal(isCandidateEligible('trf4', 'Turma decide incidência de Cofins sobre receita', 'https://www.trf4.jus.br/noticia/123'), true);
});
