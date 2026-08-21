const WEIGHTS = {
  authority: 0.1,
  novelty: 0.2,
  legalImpact: 0.18,
  financialImpact: 0.15,
  reach: 0.05,
  clientFit: 0.12,
  actionPotential: 0.2,
};

const clamp = (value) => Math.min(10, Math.max(0, Number(value) || 0));

export function calculateScore(criteria = {}) {
  const score = Object.entries(WEIGHTS).reduce(
    (total, [key, weight]) => total + clamp(criteria[key]) * weight,
    0,
  );

  return Math.round(score * 10) / 10;
}

export function relevanceLabel(score) {
  if (score >= 9) return 'Urgente';
  if (score >= 8) return 'Alta relevância';
  if (score >= 6) return 'Relevante';
  if (score >= 4) return 'Baixa relevância';
  return 'Irrelevante';
}

export const scoreWeights = WEIGHTS;
