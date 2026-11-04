import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readdir } from 'node:fs/promises';
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

test('reattach running background fetch on page load', async ({ browser }) => {
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
    
    await mobile.addInitScript(() => {
      const mockBgFetch = {
        id: 'freight-test-batch-0',
        downloadTotal: 2000,
        uploaded: 500,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      
      (window.navigator as any).serviceWorker = {
        controller: {},
        ready: Promise.resolve({
          backgroundFetch: {
            getIds: async () => ['freight-test-batch-0'],
            get: async (id: string) => (id === 'freight-test-batch-0' ? mockBgFetch : null),
          },
          active: { postMessage: () => {} },
        }),
        register: async () => ({
          backgroundFetch: {
            getIds: async () => ['freight-test-batch-0'],
            get: async (id: string) => (id === 'freight-test-batch-0' ? mockBgFetch : null),
          },
          active: { postMessage: () => {} },
        }),
        addEventListener: () => {},
      };
    });

    await mobile.goto(localUrl);
    await expect(mobile.locator('#upload-status')).toBeVisible({ timeout: 10000 });
    
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('visibilitychange does not abort page upload when no background fetch active', async ({ browser }) => {
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
    
    let uploadAborted = false;
    await mobile.route(/\/file\?/, async route => {
      if (uploadAborted) {
        await route.abort();
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
        await route.continue();
      }
    });

    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    
    await mobile.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(mobile.locator('#upload-status')).toContainText(/Done|Uploading/, { timeout: 15000 });
    
    await mobile.close();
    expect(await readdir(shipment.folder)).toHaveLength(1);
  } finally {
    await app.close();
  }
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

test('cancel upload aborts background fetch', async ({ browser }) => {
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
    
    await mobile.route(/\/finish/, async route => {
      await new Promise(() => {});
    });

    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    
    await mobile.waitForTimeout(500);
    await mobile.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    
    await mobile.unroute(/\/finish/);
    await expect(mobile.locator('#message')).toContainText('Upload canceled', { timeout: 5000 });
    
    expect(await readdir(shipment.folder)).toHaveLength(0);
    await mobile.close();
  } finally {
    await app.close();
  }
});
