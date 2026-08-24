import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAX_POLICY_VERSION,
  alertPassesTaxIntelligencePolicy,
  assessAlertAnalysisQuality,
  assessTaxIntelligenceCandidate,
  candidatePassesHardPolicy,
} from '../src/services/taxIntelligencePolicy.js';

function officialCandidate(overrides = {}) {
  return {
    sourceId: 'receita-federal',
    sourceType: 'official',
    title: 'Publicação tributária empresarial',
    documentKind: 'Ato oficial',
    content: '',
    ...overrides,
  };
}

test('P1 exige novidade concreta e não passa pela mera citação do tributo', () => {
  const bareTopic = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'reforma-cgibs',
    title: 'IBS e CBS na Reforma Tributária',
    content: 'Página temática sobre IBS, CBS e split payment.',
  }));
  assert.equal(bareTopic.topicTier, 1);
  assert.equal(bareTopic.concreteEvent, false);
  assert.equal(bareTopic.eligible, false);
  assert.match(bareTopic.eligibilityReason, /sem fato|mudança concreta/i);

  const newAct = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'reforma-cgibs',
    title: 'CGIBS publica Resolução nº 12 sobre o split payment',
    content: 'A resolução regulamenta a CBS e o IBS e altera o fluxo de caixa e a apropriação de crédito das empresas.',
  }));
  assert.equal(newAct.topicTier, 1);
  assert.equal(newAct.concreteEvent, true);
  assert.equal(newAct.businessEffect, true);
  assert.equal(newAct.eligible, true);
  assert.ok(newAct.priorityOneTopics.includes('reforma-ibs-cbs'));
});

test('P2 exige simultaneamente evento novo e efeito empresarial concreto', () => {
  const institutionalPage = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'pgfn-pareceres',
    title: 'Panorama institucional da PGFN',
    content: 'Página sobre transação tributária e atuação institucional.',
  }));
  assert.equal(institutionalPage.topicTier, 2);
  assert.equal(institutionalPage.eligible, false);

  const concreteTransaction = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'pgfn-pareceres',
    title: 'PGFN publica novo edital de transação tributária',
    content: 'O edital estabelece desconto de juros para negociação de débitos de empresas.',
  }));
  assert.equal(concreteTransaction.topicTier, 2);
  assert.equal(concreteTransaction.concreteEvent, true);
  assert.equal(concreteTransaction.businessEffect, true);
  assert.equal(concreteTransaction.eligible, true);
  assert.ok(concreteTransaction.priorityTwoTopics.includes('transacao-regularizacao'));
});

test('filtros negativos removem promoção, especulação e pessoa física sem nexo empresarial', () => {
  const webinar = assessTaxIntelligenceCandidate(officialCandidate({
    title: 'Webinar gratuito sobre créditos de PIS e Cofins',
    content: 'Inscreva-se para o evento online.',
  }));
  assert.equal(webinar.eligible, false);
  assert.equal(webinar.negativeCategory, 'PROMOCIONAL_OU_EDUCACIONAL');
  assert.equal(candidatePassesHardPolicy(officialCandidate({ title: 'Curso online sobre IRPJ' })), false);

  const speculation = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'camara',
    title: 'Parlamentar defende mudança no IBS',
    content: 'O parlamentar afirma que pode propor uma alteração no futuro.',
  }));
  assert.equal(speculation.negativeCategory, 'POLITICA_OU_ESPECULACAO');
  assert.equal(speculation.eligible, false);

  const personalTax = assessTaxIntelligenceCandidate(officialCandidate({
    title: 'Receita publica orientações sobre a declaração de IRPF',
    content: 'As orientações tratam de deduções da pessoa física.',
  }));
  assert.equal(personalTax.negativeCategory, 'PESSOA_FISICA');
  assert.equal(personalTax.eligible, false);
});

test('demais classes de ruído recebem motivo editorial determinístico', () => {
  const cases = [
    [
      'MEI',
      officialCandidate({ title: 'Receita publica orientação para MEI', content: 'A regra trata apenas do microempreendedor individual.' }),
    ],
    [
      'ARRECADACAO_SEM_EFEITO',
      officialCandidate({ title: 'Arrecadação de IRPJ bate recorde', content: 'Os dados de arrecadação aumentaram no mês, sem alteração jurídica.' }),
    ],
    [
      'REPUBLICACAO_ANTIGA',
      officialCandidate({ title: 'Portal republica julgado antigo sobre PIS e Cofins', content: 'Retrospectiva relembra decisão antiga sem recurso ou mudança de status.' }),
    ],
    [
      'MACRO_SEM_EFEITO',
      officialCandidate({ title: 'Cenário macroeconômico e projeção do PIB', content: 'Análise do mercado financeiro sem alteração tributária concreta.' }),
    ],
    [
      'PROMOCIONAL_OU_EDUCACIONAL',
      officialCandidate({ title: 'Conteúdo patrocinado sobre CBS', content: 'Oferecimento de escritório: garanta sua vaga.' }),
    ],
  ];

  for (const [category, candidate] of cases) {
    const assessment = assessTaxIntelligenceCandidate(candidate);
    assert.equal(assessment.negativeCategory, category);
    assert.equal(assessment.eligible, false);
  }
});

test('Congresso Nacional com avanço legislativo não é confundido com evento promocional', () => {
  const approved = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'senado',
    title: 'Congresso Nacional aprovou a LC nº 227/2026',
    content: 'O texto regulamenta o IBS e altera a apropriação de créditos das empresas.',
  }));
  assert.equal(approved.negativeCategory, null);
  assert.equal(approved.eventType, 'PROJETO_AVANCADO');
  assert.equal(approved.eligible, true);
});

test('Simples Nacional só passa na exceção estrutural concreta da Reforma', () => {
  const ordinary = assessTaxIntelligenceCandidate(officialCandidate({
    title: 'Receita publica calendário do Simples Nacional',
    content: 'Datas para contribuintes optantes pelo Simples Nacional.',
  }));
  assert.equal(ordinary.negativeCategory, 'SIMPLES_NACIONAL');
  assert.equal(ordinary.eligible, false);

  const structural = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'reforma-cgibs',
    title: 'LC nº 214/2025 regulamenta mudança estrutural do Simples Nacional na transição para a CBS',
    content: 'A nova regra altera a carga tributária e o regime diferenciado aplicável às empresas durante a Reforma Tributária.',
  }));
  assert.equal(structural.negativeCategory, null);
  assert.equal(structural.exceptionApplied, 'SIMPLES_ESTRUTURAL_REFORMA');
  assert.equal(structural.eligible, true);

  const mereMention = assessTaxIntelligenceCandidate(officialCandidate({
    title: 'Simples Nacional e Reforma Tributária',
    content: 'Página temática sobre possíveis reflexos futuros.',
  }));
  assert.equal(mereMention.negativeCategory, 'SIMPLES_NACIONAL');
  assert.equal(mereMention.eligible, false);
});

test('gate do STF aceita somente eventos jurisprudenciais qualificados', () => {
  const isolated = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'stf',
    title: 'STF publica decisão monocrática sobre créditos de PIS e Cofins',
    documentKind: 'Decisão judicial',
    content: 'A decisão trata da compensação de crédito tributário.',
  }));
  assert.equal(isolated.courtGate.passed, false);
  assert.equal(isolated.eligible, false);

  const qualified = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'stf',
    title: 'STF julgou o mérito de tema de repercussão geral',
    documentKind: 'Acórdão',
    content: 'O Plenário fixou tese sobre créditos de PIS e Cofins e a compensação tributária das empresas.',
  }));
  assert.equal(qualified.courtGate.passed, true);
  assert.equal(qualified.eventType, 'TESE_FIXADA_OU_ALTERADA');
  assert.equal(qualified.eligible, true);
});

test('gate do STJ rejeita decisão comum e aceita repetitivo ou Primeira Seção', () => {
  const ordinary = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'stj',
    title: 'STJ publica decisão sobre dedutibilidade de JCP',
    documentKind: 'Decisão judicial',
    content: 'O recurso discute a base de cálculo do IRPJ e da CSLL.',
  }));
  assert.equal(ordinary.courtGate.passed, false);
  assert.equal(ordinary.eligible, false);

  const repetitive = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'stj',
    title: 'STJ afeta recurso como Tema Repetitivo sobre JCP',
    documentKind: 'Decisão judicial',
    content: 'A Primeira Seção afetou o recurso que trata da dedutibilidade do JCP no IRPJ e na CSLL.',
  }));
  assert.equal(repetitive.courtGate.passed, true);
  assert.equal(repetitive.eventType, 'REPETITIVO_AFETADO');
  assert.equal(repetitive.priority, 'Acompanhamento');
  assert.equal(repetitive.eligible, true);
});

test('gate do CARF não deixa assunto prioritário transformar acórdão isolado em alerta', () => {
  const isolated = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'carf',
    title: 'Acórdão CARF sobre dedutibilidade de JCP',
    documentKind: 'Acórdão do CARF',
    content: 'A turma decidiu um caso de IRPJ e CSLL.',
  }));
  assert.equal(isolated.courtGate.passed, false);
  assert.equal(isolated.eligible, false);

  const superior = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'carf',
    title: 'Câmara Superior do CARF publica acórdão sobre JCP',
    documentKind: 'Acórdão do CARF',
    content: 'A CSRF decidiu por voto de qualidade e alterou o entendimento sobre a dedutibilidade do JCP no IRPJ.',
  }));
  assert.equal(superior.courtGate.passed, true);
  assert.equal(superior.eligible, true);
});

test('gate dos TRFs exige tese qualificada e TRF4 é preferência, não passe livre', () => {
  const ordinary = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'trf4',
    title: 'TRF4 publica sentença sobre PIS e Cofins',
    documentKind: 'Sentença judicial',
    content: 'A sentença decidiu pedido individual de compensação tributária.',
  }));
  assert.equal(ordinary.preferredRegion, true);
  assert.equal(ordinary.courtGate.passed, false);
  assert.equal(ordinary.eligible, false);

  const precedent = assessTaxIntelligenceCandidate(officialCandidate({
    sourceId: 'trf4',
    title: 'TRF4 concede liminar sobre legislação nova da CBS',
    documentKind: 'Decisão judicial',
    content: 'A liminar discute a LC nº 214/2025 e tem impacto financeiro significativo no fluxo de caixa das empresas.',
  }));
  assert.equal(precedent.courtGate.passed, true);
  assert.equal(precedent.eligible, true);
});

function currentPolicyAlert(overrides = {}) {
  return {
    policyVersion: TAX_POLICY_VERSION,
    title: 'CGIBS publica Resolução nº 12 sobre split payment',
    kind: 'Ato regulamentar',
    summary: 'O CGIBS publicou a Resolução nº 12 para regulamentar o split payment do IBS e da CBS.',
    whatChanged: 'A resolução estabelece o momento de recolhimento e novas regras de apropriação de crédito.',
    practicalImpact: 'Empresas deverão ajustar o ERP e a conciliação financeira para preservar o fluxo de caixa.',
    officeAction: 'Mapear os processos de pagamento e adequar o sistema antes da vigência.',
    contentNature: 'Fato oficial',
    noveltyType: 'Ato regulamentar',
    priority: 'Alta',
    relevanceReasons: ['altera-credito', 'exige-sistema-processo', 'fluxo-caixa'],
    legalBasis: ['LC nº 214/2025', 'Resolução CGIBS nº 12/2026'],
    taxes: ['IBS', 'CBS'],
    provenance: { sourceId: 'reforma-cgibs', sourceType: 'official', policyVersion: TAX_POLICY_VERSION },
    ...overrides,
  };
}

test('policy atual exige três análises específicas e ao menos uma base jurídica', () => {
  const complete = currentPolicyAlert();
  assert.deepEqual(assessAlertAnalysisQuality(complete), { required: true, passed: true, reasons: [] });
  assert.equal(alertPassesTaxIntelligencePolicy(complete), true);

  const generic = currentPolicyAlert({
    whatChanged: 'A publicação entrou no feed e deve ser conferida na fonte oficial.',
  });
  const genericQuality = assessAlertAnalysisQuality(generic);
  assert.equal(genericQuality.passed, false);
  assert.ok(genericQuality.reasons.some((reason) => /genérico/i.test(reason)));
  assert.equal(alertPassesTaxIntelligencePolicy(generic), false);

  const noLegalBasis = currentPolicyAlert({ legalBasis: [] });
  assert.equal(assessAlertAnalysisQuality(noLegalBasis).passed, false);
  assert.equal(alertPassesTaxIntelligencePolicy(noLegalBasis), false);
});

test('policy atual rejeita todas as fórmulas genéricas proibidas', () => {
  const genericPhrases = [
    'A publicação entrou no feed.',
    'O conteúdo deve ser conferido no inteiro teor.',
    'A decisão pode afetar o tema.',
    'O alcance do tema indicado depende de análise.',
  ];
  for (const phrase of genericPhrases) {
    const quality = assessAlertAnalysisQuality(currentPolicyAlert({ whatChanged: phrase }));
    assert.equal(quality.passed, false, phrase);
    assert.ok(quality.reasons.some((reason) => /genérico|específica/i.test(reason)), phrase);
  }
});

test('análise detalhada exige leitura separada do objeto, dispositivo e fundamento', () => {
  const detailed = currentPolicyAlert({
    analysisVersion: 'detailed-v2',
    issueOrSubject: 'A controvérsia é o momento de recolhimento do IBS no split payment.',
    rulingOrRule: 'A resolução determina que o recolhimento ocorra no momento definido para a liquidação do pagamento.',
    legalReasoning: 'O CGIBS aplica a autorização prevista na LC nº 214/2025 para disciplinar a operação.',
    effectiveDateOrDeadline: 'A vigência começa na data indicada na resolução.',
  });
  assert.equal(assessAlertAnalysisQuality(detailed).passed, true);

  const repetitive = {
    ...detailed,
    rulingOrRule: detailed.issueOrSubject,
    legalReasoning: detailed.issueOrSubject,
  };
  const quality = assessAlertAnalysisQuality(repetitive);
  assert.equal(quality.passed, false);
  assert.ok(quality.reasons.some((reason) => /repetitivos/i.test(reason)));
});

test('regra de qualidade preserva legado e ações processuais acompanhadas', () => {
  const legacy = currentPolicyAlert({ policyVersion: undefined, provenance: { sourceId: 'reforma-cgibs', sourceType: 'official' }, legalBasis: [] });
  assert.deepEqual(assessAlertAnalysisQuality(legacy), { required: false, passed: true, reasons: [] });
  assert.equal(alertPassesTaxIntelligencePolicy(legacy), true);

  const legacyNoise = {
    ...legacy,
    title: 'Isenção de IRPF para aposentado com doença grave',
    theme: 'Imposto de renda da pessoa física',
    summary: 'Sentença individual concedeu isenção de IRPF sobre proventos de aposentadoria.',
    whatChanged: 'A decisão beneficia apenas o autor aposentado.',
    practicalImpact: 'A retenção pessoal deve ser interrompida.',
    officeAction: 'Cumprir a sentença individual.',
    taxes: ['IRPF'],
    provenance: { sourceId: 'trf1', sourceType: 'official' },
  };
  assert.equal(alertPassesTaxIntelligencePolicy(legacyNoise), false);

  const movement = {
    policyVersion: TAX_POLICY_VERSION,
    kind: 'Movimentação processual',
    summary: 'Nova movimentação.',
    whatChanged: 'Tema indicado.',
    practicalImpact: '',
    legalBasis: [],
  };
  assert.equal(alertPassesTaxIntelligencePolicy(movement), true);
});
