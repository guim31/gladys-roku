// -----------------------------------------------------------------------------
// Entry point of the Roku integration for Gladys Assistant.
//
// Creates the SDK client, registers the handlers (src/app.js) and connects.
// The SDK reads GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
// GLADYS_INTEGRATION_SELECTOR, injected by the Gladys supervisor.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp(gladys);

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}, shutting down`);
  app.shutdown();
});

logger.info('Starting the Roku integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
