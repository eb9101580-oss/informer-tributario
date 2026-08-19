import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { alertsRouter } from './routes/alerts.js';
import { dashboardRouter } from './routes/dashboard.js';
import { feedbackRouter } from './routes/feedback.js';
import { scoringRouter } from './routes/scoring.js';
import { intelligenceRouter } from './routes/intelligence.js';
import { sourcesRouter } from './routes/sources.js';
import { monitorRouter } from './routes/monitor.js';
import { subscriptionsRouter } from './routes/subscriptions.js';
import { actionsRouter } from './routes/actions.js';
import { sectionsRouter } from './routes/sections.js';

export const app = express();

app.use(helmet());
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: '200kb' }));

app.use('/api', (request, response, next) => {
  const isSubscriptionRequest = request.path.startsWith('/subscriptions');
  const isActionsRequest = request.path.startsWith('/actions');
  if (config.serverless && request.method !== 'GET' && !isSubscriptionRequest && !isActionsRequest) {
    return response.status(503).json({ message: 'Esta ação exige o backend persistente com Ollama. A versão Vercel é somente leitura.' });
  }
  next();
});

app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'Informer API' }));
app.use('/api/alerts', alertsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/scoring', scoringRouter);
app.use('/api/intelligence', intelligenceRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/monitor', monitorRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/actions', actionsRouter);
app.use('/api/sections', sectionsRouter);

app.use((_request, response) => response.status(404).json({ message: 'Rota não encontrada.' }));
app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : 'Erro interno do servidor.',
  });
});
