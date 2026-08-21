import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasStrongTaxSignal,
  isCandidateEligible,
  isTaxRelated,
  taxTerms,
} from '../src/services/sourceAdapters.js';

test('vocabulário cobre os temas empresariais prioritários P1 e P2', () => {
  const priorityTopics = [
    'Receita publica nova versão do PER/DCOMP Web para ressarcimento de créditos.',
    'STJ decide a dedutibilidade dos juros sobre capital próprio (JCP).',
    'RFB atualiza a DCTFWeb e o MIT para a nova apuração.',
    'CGIBS regulamenta o split payment previsto na LC nº 214/2025.',
    'Lei Complementar n° 227/2026 altera a transição para o IBS.',
    'Receita implanta a DUIMP no Siscomex para operações de drawback.',
    'Novo regime de preços de transferência conforme a Lei nº 14.596/2023.',
    'OCDE publica orientação do Pilar 2 sobre tributação mínima global.',
    'CARF altera entendimento sobre voto de qualidade e ágio.',
    'PGFN publica novo edital de transação tributária.',
  ];

  for (const topic of priorityTopics) {
    assert.equal(isTaxRelated(topic), true, topic);
    assert.equal(hasStrongTaxSignal(topic), true, topic);
  }
});

test('sigla MIT só é sinal tributário quando contextualizada com DCTFWeb', () => {
  assert.equal(isTaxRelated('Receita atualiza o MIT da DCTFWeb.'), true);
  assert.equal(isTaxRelated('MIT anuncia novo laboratório de inteligência artificial.'), false);
});

test('tributos pessoais genéricos não são sinal positivo sem contexto empresarial', () => {
  for (const topic of [
    'Calendário de restituição do IRPF 2026.',
    'Prefeitura reajusta o IPTU residencial.',
    'Estado divulga o calendário anual do IPVA.',
    'ITCMD incidente em doação familiar.',
    'MEI abre inscrições para curso gratuito.',
    'Mero despacho em execução fiscal sem tese nova.',
  ]) assert.equal(isTaxRelated(topic), false, topic);

  assert.equal(isTaxRelated('IPTU empresarial sobre imóvel operacional.'), true);
  assert.equal(isTaxRelated('IPVA de frota empresarial.'), true);
  assert.equal(isTaxRelated('ITCMD em reorganização societária.'), true);
  assert.equal(isTaxRelated('ITBI na integralização de capital social.'), true);

  for (const genericTerm of ['irpf', 'iptu', 'ipva', 'itcmd', 'itbi']) {
    assert.equal(taxTerms.includes(genericTerm), false, genericTerm);
  }
});

test('elegibilidade conserva a política negativa e aceita novidade operacional prioritária', () => {
  const officialNewsUrl = 'https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/receita-atualiza-perdcomp';
  assert.equal(isCandidateEligible(
    'receita-federal',
    'Receita publica nova versão do PER/DCOMP Web para compensação tributária',
    officialNewsUrl,
  ), true);
  assert.equal(isCandidateEligible(
    'jota',
    'Webinar introdutório sobre PER/DCOMP',
    'https://www.jota.info/eventos/webinar-perdcomp',
  ), false);
  assert.equal(isCandidateEligible(
    'receita-federal',
    'Receita divulga calendário de restituição do IRPF 2026',
    'https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/calendario-irpf',
  ), false);
});
