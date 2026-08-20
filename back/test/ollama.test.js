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
    publishedAt: '2026-08-19',
    summary: 'Resumo factual.',
    whatChanged: 'Alteração publicada.',
    practicalImpact: 'Revisar procedimentos.',
    officeAction: 'Orientar clientes afetados.',
    affectedProfiles: ['Indústrias'],
    criteria: { authority: 10, novelty: 8, legalImpact: 7, financialImpact: 6, reach: 5, clientFit: 7, actionPotential: 8 },
    opportunity: null,
  });
  assert.equal(analysis.criteria.authority, 10);
  assert.equal(analysis.impactType, 'Risco');
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
