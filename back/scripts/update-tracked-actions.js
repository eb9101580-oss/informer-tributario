import { actionsStatus, refreshAllTrackedActions } from '../src/services/trackedActions.js';

const status = actionsStatus();
if (!status.datajudConfigured) {
  console.log('DATAJUD_API_KEY não configurada; acompanhamentos não serão atualizados.');
  process.exit(0);
}
if (!status.persistenceConfigured) {
  console.log('Chave de criptografia dos acompanhamentos não configurada; nada será escrito.');
  process.exit(0);
}

const items = await refreshAllTrackedActions();
console.log(`Acompanhamentos consultados: ${items.length}.`);
items.forEach((item) => console.log(`${item.label}: ${item.status || item.lastError || 'sem status'}`));
