import { readDatabase } from '../src/services/store.js';
import { notifyAlerts } from '../src/services/emailNotifications.js';

const database = await readDatabase();
const result = await notifyAlerts(database.alerts, { requireCurrentFeed: true });
console.log(`Processamento de notificações concluído: ${result.alertsSent} alerta(s), ${result.deliveries} entrega(s).`);
