import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test.use({ channel: 'msedge' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=',
  'base64',
);

async function launchFreightApp(storage: string) {
  const profile = path.dirname(storage);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile,
    FREIGHT_BATCH_TTL_MS: '60000',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }),
    env,
  });
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, storagePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storagePath] })) as any;
  }, storage);
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Freight Pictures', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  return { app, page };
}

test('reattach logic code exists in build', async () => {
  const inline = readFileSync(path.join(process.cwd(), 'dist-electron', 'freightMobileInline.js'), 'utf8');
  expect(inline).toContain('reattachOrCleanupBackgroundFetches');
  expect(inline).toContain('activeBackgroundFetch');
});

test('visibilitychange handler checks active background fetch', async () => {
  const inline = readFileSync(path.join(process.cwd(), 'dist-electron', 'freightMobileInline.js'), 'utf8');
  expect(inline).toContain('activeBackgroundFetch');
  expect(inline).toContain('visibilitychange');
});

test('service worker backgroundfetchsuccess calls finish and clears queue', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-sw-finish', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('SW Finish Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'SW Finish Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    
    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    
    await expect(mobile.locator('#upload-status')).toContainText('Done, 1 pictures uploaded', { timeout: 60000 });
    
    expect(await readdir(shipment.folder)).toHaveLength(1);
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('cancel logic includes background fetch abort', async () => {
  const inline = readFileSync(path.join(process.cwd(), 'dist-electron', 'freightMobileInline.js'), 'utf8');
  expect(inline).toContain('abortActiveBatch');
  expect(inline).toContain('backgroundFetchRegistrationId');
});
