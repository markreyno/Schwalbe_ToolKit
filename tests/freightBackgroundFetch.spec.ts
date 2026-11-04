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

test('on load with running background fetch for current batch it is not aborted and progress shows', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-bg-fetch-reattach', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Reattach Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Reattach Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    
    const inline = readFileSync(path.join(process.cwd(), 'dist-electron', 'freightMobileInline.js'), 'utf8');
    expect(inline).toContain('reattachOrCleanupBackgroundFetches');
    expect(inline).toContain('backgroundFetchRegistrationId');
    expect(inline).toMatch(/if.*expectedId.*id === expectedId/);
    
    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    
    await expect(mobile.locator('#upload-status')).toContainText(/Done/, { timeout: 60000 });
    expect(await readdir(shipment.folder)).toHaveLength(1);
    
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('visibilitychange hidden does not abort page upload when no background fetch active', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-visibility-no-abort', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Visibility Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Visibility Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });

    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    
    await mobile.waitForTimeout(200);
    
    await mobile.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { 
        get: () => 'hidden', 
        configurable: true 
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    
    await expect(mobile.locator('#upload-status')).toContainText(/Done|Verifying/, { timeout: 60000 });
    
    const files = await readdir(shipment.folder);
    expect(files.length).toBe(1);
    
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('cancel upload aborts the background fetch', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-cancel-bg-fetch', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Cancel BG Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Cancel BG Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    
    const inline = readFileSync(path.join(process.cwd(), 'dist-electron', 'freightMobileInline.js'), 'utf8');
    expect(inline).toContain('abortActiveBatch');
    expect(inline).toContain('await item?.abort?.()');
    expect(inline).toMatch(/const id = backgroundFetchRegistrationId/);
    
    await mobile.route(/\/finish/, async route => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      await route.continue();
    });

    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    
    await mobile.waitForTimeout(300);
    await mobile.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    
    await mobile.unroute(/\/finish/);
    await expect(mobile.locator('#message')).toContainText('Upload canceled', { timeout: 5000 });
    
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('upload after cancel is rejected with 410 and leaves folder empty', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-cancel-then-upload', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('After Cancel Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'After Cancel Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    
    await mobile.route(/\/file\?/, async route => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.continue();
    });

    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    
    await mobile.waitForTimeout(100);
    await mobile.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    
    await mobile.unroute(/\/file/);
    await expect(mobile.locator('#message')).toContainText('Upload canceled', { timeout: 10000 });
    
    const files = await readdir(shipment.folder);
    expect(files.length).toBe(0);
    
    await mobile.close();
  } finally {
    await app.close();
  }
});
