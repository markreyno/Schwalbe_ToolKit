import { test, expect, _electron as electron } from '@playwright/test';
import { ConnectPwaServer, CONNECT_PWA_PORT } from '../electron/connectPwaServer';
import { createTestPhoneTlsManager } from './helpers/phoneTlsTest';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

test.use({ channel: 'msedge' });

test('capture mobile UX screenshots for changed phone screens', async ({ browser }) => {
  const outDir = path.resolve('test-results', 'mobile-ux');
  await mkdir(outDir, { recursive: true });

  const connectRoot = path.resolve('.cache/connect-pwa-screenshot', randomUUID());
  const connectTls = await createTestPhoneTlsManager(connectRoot);
  const connectServer = new ConnectPwaServer(path.join(connectRoot, 'settings.json'), connectTls, async host => [
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
  await connectServer.start();
  const hubPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  await hubPage.goto(`https://127.0.0.1:${CONNECT_PWA_PORT}/`);
  await hubPage.getByRole('heading', { name: 'Warehouse tools', level: 1 }).waitFor();
  await hubPage.screenshot({ path: path.join(outDir, 'connect-pwa-hub.png'), fullPage: true });
  await hubPage.close();
  connectServer.stop();
  await rm(connectRoot, { recursive: true, force: true });

  const profile = path.resolve('.cache/mobile-ux-screenshots', randomUUID());
  const storage = path.join(profile, 'data');
  await mkdir(storage, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }),
    env
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, storagePath) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storagePath] })) as any;
    }, storage);

    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    const pvState = await page.evaluate(() => window.toolkit.palletvision('status'));
    const pvMobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
    await pvMobile.goto(pvState.qrUrl.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48732'));
    await expect(pvMobile.getByRole('heading', { name: 'New Pallet' })).toBeVisible();
    await pvMobile.screenshot({ path: path.join(outDir, 'palletvision-mobile-home.png'), fullPage: true });
    await pvMobile.close();

    await page.getByRole('link', { name: 'All tools' }).click();
    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Freight Pictures', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await page.getByLabel('Company', { exact: true }).fill('Screenshot Co');
    await page.getByLabel('Date shipped').fill('2026-10-24');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();
    const freightState = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = freightState.shipments.find(s => s.company === 'Screenshot Co')!;
    const freightMobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
    await freightMobile.goto(shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731'));
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=', 'base64');
    await freightMobile.locator('#files').setInputFiles({ name: 'pallet.png', mimeType: 'image/png', buffer: bytes });
    await freightMobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await freightMobile.locator('#confirm').check();
    await expect(freightMobile.locator('#saving-to')).toContainText('Saving to:');
    await freightMobile.screenshot({ path: path.join(outDir, 'freight-mobile-first-screen.png'), fullPage: true });
    await freightMobile.close();
  } finally {
    await app.close();
  }
});
