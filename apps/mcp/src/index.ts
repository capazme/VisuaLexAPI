import { readConfig } from './config.js';
import { createApp } from './server.js';

const config = readConfig();
const app = createApp(config);
const server = app.listen(config.port, config.host, () => {
  console.info(`[mcp] VisuaLex MCP server on http://${config.host}:${config.port} — resource ${config.resource}`);
});

// Idle sessions close after 30 minutes (src/sessions.ts); checked every minute.
const sweep = setInterval(() => {
  app.sessions.sweep().catch((error: unknown) => {
    console.error('[mcp] session sweep failed:', error instanceof Error ? error.message : 'unknown error');
  });
}, 60_000);
sweep.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(sweep);
    // Open streams (GET) would hold server.close() open: end the sessions first.
    void app.sessions.closeAll().finally(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
