import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTaxIntelligenceCandidate } from '../src/services/taxIntelligencePolicy.js';

function candidate(overrides = {}) {
  return {
    sourceId: 'receita-federal',
    sourceType: 'official',
    title: 'Publicacao tributaria empresarial',
    documentKind: 'Ato oficial',
    content: '',
    ...overrides,
  };
}

test('exclui decisao monocratica do feed geral', () => {
  const result = assessTaxIntelligenceCandidate(candidate({
    sourceId: 'stf',
    title: 'STF publica decisao monocratica sobre creditos de PIS e Cofins',
    documentKind: 'Decisao judicial',
    content: 'A decisao monocratica trata da compensacao de credito tributario de empresas.',
  }));

  assert.equal(result.negativeCategory, 'DECISAO_MONOCRATICA');
  assert.equal(result.eligible, false);
});

test('exclui consulta DISIT sem vinculacao expressa e aceita a vinculada', () => {
  const local = assessTaxIntelligenceCandidate(candidate({
    sourceId: 'receita-cosit',
    title: 'Solucao de Consulta DISIT/SRRF05 n 5.001-2023 sobre creditos de PIS e Cofins',
    documentKind: 'Solucao de Consulta',
    content: 'A DISIT responde consulta de contribuinte e altera o procedimento de compensacao tributaria.',
  }));
  assert.equal(local.negativeCategory, 'CONSULTA_DISIT_SEM_VINCULACAO');
  assert.equal(local.eligible, false);

  const linked = assessTaxIntelligenceCandidate(candidate({
    sourceId: 'receita-cosit',
    title: 'Solucao de Consulta DISIT/SRRF05 n 5.001-2026',
    documentKind: 'Solucao de Consulta',
    content: 'A solucao vincula-se a Solucao de Consulta Cosit n 100-2026, reproduz a interpretacao da COSIT e altera o procedimento de compensacao tributaria das empresas.',
  }));
  assert.equal(linked.negativeCategory, null);
  assert.equal(linked.eligible, true);
});
