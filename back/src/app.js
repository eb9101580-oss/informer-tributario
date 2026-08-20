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
import { djenRouter } from './routes/djen.js';
import { authHandler } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { adminUsersRouter } from './routes/users.js';
import { requireAdmin } from './middleware/auth.js';
import { adminSuggestionsRouter, suggestionsRouter } from './routes/suggestions.js';

export const app = express();

app.use(helmet());
const vercelOrigin = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const allowedOrigins = new Set([
  config.frontendUrl,
  ...(vercelOrigin ? [`https://${vercelOrigin}`] : []),
  ...String(process.env.AUTH_TRUSTED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
]);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origem não autorizada.'));
  },
}));
app.all('/api/auth/*splat', authHandler);
app.use(express.json({ limit: '200kb' }));

app.use('/api', (request, response, next) => {
  const needsPersistentAnalyzer = request.path.startsWith('/intelligence') || request.path.startsWith('/monitor');
  if (config.serverless && request.method !== 'GET' && needsPersistentAnalyzer) {
    return response.status(503).json({ message: 'Esta ação exige o backend persistente com Ollama. A versão Vercel é somente leitura.' });
  }
  next();
});

app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'Informer API' }));
app.use('/api/djen', djenRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/scoring', requireAdmin, scoringRouter);
app.use('/api/intelligence', requireAdmin, intelligenceRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/monitor', requireAdmin, monitorRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/actions', actionsRouter);
app.use('/api/sections', sectionsRouter);
app.use('/api/me', meRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/admin/suggestions', adminSuggestionsRouter);

app.use((_request, response) => response.status(404).json({ message: 'Rota não encontrada.' }));
app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : 'Erro interno do servidor.',
  });
});
