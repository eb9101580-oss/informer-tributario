import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { readDatabase, updateDatabase } from '../services/store.js';

export const feedbackRouter = Router();
const allowedRatings = ['irrelevante', 'pouco relevante', 'relevante', 'muito relevante', 'urgente'];

feedbackRouter.get('/', async (_request, response, next) => {
  try {
    const database = await readDatabase();
    response.json({ items: database.feedback, total: database.feedback.length });
  } catch (error) {
    next(error);
  }
});

feedbackRouter.post('/', async (request, response, next) => {
  try {
    const { alertId, rating, reason = '' } = request.body;
    if (!alertId || !allowedRatings.includes(rating)) {
      return response.status(400).json({ message: 'Alerta e avaliação válida são obrigatórios.' });
    }
    const database = await readDatabase();
    if (!database.alerts.some((alert) => alert.id === alertId)) {
      return response.status(404).json({ message: 'Alerta não encontrado.' });
    }
    const feedback = { id: randomUUID(), alertId, rating, reason, createdAt: new Date().toISOString() };
    await updateDatabase((data) => ({ ...data, feedback: [feedback, ...data.feedback] }));
    response.status(201).json(feedback);
  } catch (error) {
    next(error);
  }
});
