import { test } from '@playwright/test';
import { ConnectPwaServer, CONNECT_PWA_PORT } from '../electron/connectPwaServer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createTestPhoneTlsManager } from './helpers/phoneTlsTest';

const out = process.env.CONNECT_PWA_SCREENSHOT_OUT;

test('capture connect hub screenshot', async ({ browser }) => {
  if (!out) test.skip();
  const testRoot = path.resolve('.cache/connect-pwa-screenshot', randomUUID());
  const tlsManager = await createTestPhoneTlsManager(testRoot);
  const server = new ConnectPwaServer(path.join(testRoot, 'settings.json'), tlsManager, async host => [
    {
      id: 'freight-pictures',
      title: 'Freight Pictures',
      category: 'SHIPPING & WAREHOUSE',
      ready: true,
      url: `https://${host}:48731/?key=demo`
    },
    {
      id: 'palletvision-collector',
      title: 'PalletVision Data Collector',
      category: 'DATA COLLECTION',
      ready: true,
      url: `https://${host}:48732/`
    }
  ]);
  await server.start();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  await page.goto(`http://127.0.0.1:${CONNECT_PWA_PORT}/`);
  await page.getByRole('heading', { name: 'Warehouse tools', level: 1 }).waitFor();
  await page.getByRole('heading', { name: 'Freight Pictures', level: 3 }).waitFor();
  await page.screenshot({ path: out, fullPage: true });
  server.stop();
  await rm(testRoot, { recursive: true, force: true });
});
