import { Router } from 'express';
import { config } from '../config.js';
import { emailConfigured } from '../services/email.js';
import { addSubscription } from '../services/subscriptions.js';

export const subscriptionsRouter = Router();

subscriptionsRouter.get('/status', (_request, response) => {
  response.json({
    provider: 'Resend',
    enabled: emailConfigured() && Boolean(config.subscriptionEncryptionKey) && (!config.serverless || Boolean(config.githubToken)),
    emailConfigured: emailConfigured(),
    persistenceConfigured: Boolean(config.subscriptionEncryptionKey) && (!config.serverless || Boolean(config.githubToken)),
    threshold: config.emailThreshold,
  });
});

subscriptionsRouter.post('/', async (request, response, next) => {
  try {
    const result = await addSubscription(request.body?.email);
    response.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      delivery: 'registered',
      threshold: config.emailThreshold,
      message: result.created ? 'Cadastro realizado.' : 'Este e-mail já está cadastrado.',
    });
  } catch (error) {
    next(error);
  }
});
