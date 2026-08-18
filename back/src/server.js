import { app } from './app.js';
import { config } from './config.js';
import { startMonitor } from './services/monitor.js';

app.listen(config.port, () => {
  startMonitor();
  console.log(`Informer API disponível em http://localhost:${config.port}`);
});
