import { runMonitor } from '../src/services/monitor.js';

// Segunda fase do workflow: analisa a fila já persistida sem repetir a coleta.
const result = await runMonitor({
  analyze: true,
  discover: false,
  trigger: process.env.GITHUB_ACTIONS ? 'github-actions-analysis' : 'cli-analysis',
});

console.log(JSON.stringify(result, null, 2));
