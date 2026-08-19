import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProcessNumber, summarizeDataJudResponse } from '../src/services/datajud.js';

test('normaliza número CNJ e preserva consulta por tema', () => {
  assert.equal(normalizeProcessNumber('0000000-00.0000.0.00.0000'), '00000000000000000000');
  assert.equal(normalizeProcessNumber('ICMS'), '');
});

test('resume movimentos reais do formato DataJud em ordem decrescente', () => {
  const result = summarizeDataJudResponse({
    hits: {
      total: { value: 1 },
      hits: [{ _id: 'source-id', _source: {
        numeroProcesso: '00000000000000000000', tribunal: 'STJ',
        movimentos: [
          { codigo: 2, nome: 'Movimento antigo', dataHora: '2024-01-01T10:00:00Z' },
          { codigo: 3, nome: 'Decisão nova', dataHora: '2024-02-01T10:00:00Z', complementosTabelados: [{ descricao: 'Com efeito' }] },
        ],
      } }],
    },
  }, 'stj');

  assert.equal(result.resultCount, 1);
  assert.equal(result.status, 'Decisão nova');
  assert.equal(result.movements[0].name, 'Decisão nova');
  assert.equal(result.movements[0].complement, 'Com efeito');
});
