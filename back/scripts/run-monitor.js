import { runMonitor } from '../src/services/monitor.js';

const result = await runMonitor({ analyze: true, trigger: process.env.GITHUB_ACTIONS ? 'github-actions' : 'cli' });
console.log(JSON.stringify(result, null, 2));
