import { defineConfig } from '@playwright/test';
export default defineConfig({ 
  testDir: './tests', 
  workers: 1, 
  timeout: 60000, 
  reporter: 'list',
  use: { trace: 'retain-on-failure', ignoreHTTPSErrors: true },
  env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  testIgnore: process.env.TOOLKIT_EXECUTABLE ? '**/palletvisionServerE2E.spec.ts' : undefined
});
