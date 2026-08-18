import { runMonitor } from '../src/services/monitor.js';

const analyze = process.env.MONITOR_ANALYZE !== 'false';
const trigger = process.env.GITHUB_ACTIONS ? (analyze ? 'github-actions-analysis' : 'github-actions-discovery') : 'cli';
const result = await runMonitor({ analyze, trigger });
console.log(JSON.stringify(result, null, 2));
