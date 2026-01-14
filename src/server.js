import { buildApp } from './app.js';

let app;

async function start() {
  try {
    app = await buildApp();

    const { PORT, HOST } = app.config;

    await app.listen({
      port: PORT,
      host: HOST,
    });

    app.log.info(`Server running at ${HOST}:${PORT}`);
  } catch (error) {
    if (app?.log) {
      app.log.error(error, 'Failed to start server');
    } else {
      console.error('Failed to start server:', error);
    }
    process.exit(1);
  }
}

/* Graceful shutdown */
async function shutdown(signal) {
  if (!app) return;

  app.log.warn(`Received ${signal}, shutting down...`);
  try {
    await app.close();
    app.log.info('Server closed cleanly');
  } catch (err) {
    app.log.error('Error during shutdown', err);
  }
}

['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, shutdown);
});

/* Safety net (log only) */
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

start();
