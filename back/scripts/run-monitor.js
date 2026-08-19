import { runMonitor } from '../src/services/monitor.js';
import { config } from '../src/config.js';
import { scheduledBackfillDate } from '../src/services/historySweep.js';

const analyze = process.env.MONITOR_ANALYZE !== 'false';
const trigger = process.env.GITHUB_ACTIONS ? (analyze ? 'github-actions-analysis' : 'github-actions-discovery') : 'cli';
const targetDate = process.env.MONITOR_TARGET_DATE || null;
const result = await runMonitor({ analyze, trigger, targetDate });

if (process.env.GITHUB_EVENT_NAME === 'schedule' && !targetDate && config.monitorLookbackDays > 1) {
  const historyDate = scheduledBackfillDate(new Date(), config.monitorLookbackDays, 20);
  result.historyBackfill = await runMonitor({ analyze: false, trigger: 'github-actions-history', targetDate: historyDate });
}

console.log(JSON.stringify(result, null, 2));
