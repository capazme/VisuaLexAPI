import { readConfig } from './config.js';
import { createApp } from './server.js';

const config = readConfig();
const server = createApp(config).listen(config.port, config.host, () => {
  console.info(`[mcp] VisuaLex MCP server on http://${config.host}:${config.port} — resource ${config.resource}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
