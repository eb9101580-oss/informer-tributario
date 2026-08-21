import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore, relevanceLabel } from '../src/services/scoring.js';

test('calcula nota ponderada entre zero e dez', () => {
  assert.equal(calculateScore({ authority: 10, novelty: 10, legalImpact: 10, financialImpact: 10, reach: 10, clientFit: 10, actionPotential: 10 }), 10);
  assert.equal(calculateScore({ authority: -2, novelty: 30 }), 2);
});

test('classifica relevância', () => {
  assert.equal(relevanceLabel(9.2), 'Urgente');
  assert.equal(relevanceLabel(8), 'Alta relevância');
  assert.equal(relevanceLabel(6.5), 'Relevante');
  assert.equal(relevanceLabel(2), 'Irrelevante');
});
