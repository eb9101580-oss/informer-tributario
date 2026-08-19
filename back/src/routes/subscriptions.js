import { Router } from 'express';
import { config } from '../config.js';
import { emailConfigured, sendEmail } from '../services/email.js';
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
    let delivery = 'pending-configuration';
    if (result.created && emailConfigured()) {
      try {
        await sendEmail({
          to: result.subscriber.email,
          subject: 'Cadastro confirmado — Informer Tributário',
          text: `Seu cadastro foi recebido. Você receberá alertas do Informer quando surgir uma publicação com nota ${config.emailThreshold} ou superior.`,
          html: `<p>Seu cadastro foi recebido.</p><p>Você receberá alertas do Informer quando surgir uma publicação com nota <strong>${config.emailThreshold} ou superior</strong>.</p>`,
          idempotencyKey: `welcome-${result.subscriber.id}`,
        });
        delivery = 'sent';
      } catch (error) {
        delivery = 'failed';
        console.error('Falha ao enviar confirmação de cadastro:', error.message);
      }
    }
    response.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      delivery,
      threshold: config.emailThreshold,
      message: result.created ? 'Cadastro realizado.' : 'Este e-mail já está cadastrado.',
    });
  } catch (error) {
    next(error);
  }
});
