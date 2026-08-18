import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDocumentText } from '../src/services/ollama.js';

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
