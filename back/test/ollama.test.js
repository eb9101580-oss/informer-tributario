import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOllamaStreamPayloads, normalizeAnalysis, prepareDocumentText } from '../src/services/ollama.js';

test('limita documentos longos preservando início e final', () => {
  const source = `INÍCIO-${'x'.repeat(20000)}-FINAL`;
  const prepared = prepareDocumentText(source, 4000);

  assert.ok(prepared.length < 4100);
  assert.ok(prepared.startsWith('INÍCIO-'));
  assert.ok(prepared.endsWith('-FINAL'));
  assert.match(prepared, /trecho intermediário omitido/);
});

test('mantém documentos que já cabem no limite', () => {
  assert.equal(prepareDocumentText('  texto   curto  ', 4000), 'texto curto');
});

test('preserva dispositivo e fundamento no meio de decisões longas', () => {
  const source = `RELATÓRIO ${'contexto '.repeat(2_000)} DISPOSITIVO Ante o exposto, JULGO IMPROCEDENTE o pedido com fundamento no art. 170-A do CTN. ${'rodapé '.repeat(2_000)}`;
  const prepared = prepareDocumentText(source, 4_000);
  assert.ok(prepared.length <= 4_000);
  assert.match(prepared, /DISPOSITIVO/);
  assert.match(prepared, /JULGO IMPROCEDENTE/);
  assert.match(prepared, /art\. 170-A do CTN/);
});

test('preserva parágrafos e normaliza a análise estruturada', () => {
  assert.equal(prepareDocumentText('Título\n\n  Texto   da norma '), 'Título\n\nTexto da norma');
  const analysis = normalizeAnalysis({
    relevant: true,
    title: 'Portaria publicada',
    theme: 'ICMS',
    agency: 'Receita Federal',
    taxes: ['ICMS'],
    status: 'Fato confirmado',
    kind: 'Portaria',
    impactType: 'Risco',
    priority: 'Alta',
    contentNature: 'Fato oficial',
    businessActionable: true,
    noveltyType: 'Ato regulamentar',
    relevanceReasons: ['altera-obrigacao', 'altera-obrigacao'],
    legalBasis: ['Portaria RFB 123/2026'],
    publishedAt: '2026-08-19',
    analysisVersion: 'detailed-v3',
    editorialFormat: 'Direto do Legislativo',
    summary: 'Resumo factual.',
    whatChanged: 'Alteração publicada.',
    practicalImpact: 'Revisar procedimentos.',
    officeAction: 'Orientar clientes afetados.',
    issueOrSubject: 'A portaria disciplina a apuração dos créditos de ICMS nas operações industriais.',
    rulingOrRule: 'O ato substitui o procedimento anterior e determina a aplicação da nova regra a partir da publicação.',
    legalReasoning: 'A Receita fundamenta a alteração no artigo 23 da Lei Complementar nº 87/1996.',
    effectiveDateOrDeadline: 'Vigência a partir de 19/08/2026; o documento não informa prazo adicional.',
    affectedProfiles: ['Indústrias'],
    criteria: { authority: 10, novelty: 8, legalImpact: 7, financialImpact: 6, reach: 5, clientFit: 7, actionPotential: 8 },
    opportunity: null,
  });
  assert.equal(analysis.criteria.authority, 10);
  assert.equal(analysis.impactType, 'Risco');
  assert.equal(analysis.priority, 'Alta');
  assert.equal(analysis.contentNature, 'Fato oficial');
  assert.deepEqual(analysis.relevanceReasons, ['altera-obrigacao']);
  assert.deepEqual(analysis.legalBasis, ['Portaria RFB 123/2026']);
  assert.equal(analysis.analysisVersion, 'detailed-v3');
  assert.equal(analysis.editorialFormat, 'Direto do Legislativo');
  assert.match(analysis.rulingOrRule, /substitui/);
});

test('recompõe resposta NDJSON transmitida pelo Ollama', () => {
  const result = mergeOllamaStreamPayloads([
    { message: { role: 'assistant', content: '{"relevant":' }, done: false },
    { message: { role: 'assistant', content: 'true}' }, done: true, done_reason: 'stop' },
  ]);
  assert.equal(result.message.content, '{"relevant":true}');
  assert.equal(result.done, true);
  assert.throws(() => mergeOllamaStreamPayloads([{ error: 'modelo descarregado' }]), /modelo descarregado/);
});
