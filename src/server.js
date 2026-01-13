import { buildApp } from './app.js';

async function start() {
  let app;

  try {
    app = await buildApp();

    await app.ready();

    const { PORT, HOST, NODE_ENV } = app.config;

    await app.listen({
      port: PORT,
      host: HOST,
    });

    const signals = ['SIGINT', 'SIGTERM'];

    for (const signal of signals) {
      process.on(signal, async () => {
        app.log.warn(`Received ${signal}, closing server gracefully...`);

        try {
          await app.close();
          app.log.info('Server closed successfully');
          process.exit(0);
        } catch (err) {
          app.log.error('Error during shutdown', err);
          process.exit(1);
        }
      });
    }
  } catch (error) {
    if (app && app.log) {
      app.log.error(error, 'Failed to start server');
    } else {
      console.error('Failed to start server:', error);
    }
    process.exit(1);
  }
}

// Global Uncaught Handlers (Safety Net)
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

start();
