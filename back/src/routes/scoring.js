import { Router } from 'express';
import { calculateScore, relevanceLabel, scoreWeights } from '../services/scoring.js';

export const scoringRouter = Router();

scoringRouter.get('/weights', (_request, response) => response.json(scoreWeights));

scoringRouter.post('/preview', (request, response) => {
  const score = calculateScore(request.body);
  response.json({ score, relevance: relevanceLabel(score), immediateAlert: score >= 8 });
});
