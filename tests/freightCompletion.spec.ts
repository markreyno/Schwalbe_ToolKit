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

async function progressFillPercent(page: import('@playwright/test').Page) {
  return page.evaluate(() => parseFloat(document.getElementById('upload-progress-fill')?.style.width || '0') || 0);
}

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

async function startBatchUpload(mobile: import('@playwright/test').Page, localUrl: string, count = 26) {
  await mobile.goto(localUrl);
  await expect(mobile.locator('#upload')).toBeVisible();
  await expect(mobile.locator('#capture-block')).toBeVisible();
  await mobile.locator('#files').setInputFiles(Array.from({ length: count }, (_, i) => ({ name: `pallet-${i}.png`, mimeType: 'image/png', buffer: PNG })));
  await mobile.getByLabel('Pallet amount', { exact: true }).fill(String(count));
  await mobile.locator('#confirm').check();
  await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
}


async function setup(browser: import('@playwright/test').Browser) {
  const profile = path.resolve('.cache/freight-completion', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  await page.getByLabel('Company', { exact: true }).fill('Completion Co');
  await page.getByLabel('Date shipped').fill('2026-11-04');
  await page.getByRole('button', { name: 'Create shipment & QR code' }).click();
  const state = await page.evaluate(() => window.toolkit.freight('status'));
  const shipment = state.shipments[0];
  const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');
  const mobile = await browser.newPage({ ignoreHTTPSErrors: true });
  return { app, mobile, localUrl, shipment };
}

test('refresh with every picture saved finishes verification and keeps the completion screen', async ({ browser }) => {
  const { app, mobile, localUrl, shipment } = await setup(browser);
  try {
    await mobile.route(/\/finish\?/, route => route.abort());
    await startBatchUpload(mobile, localUrl, 26);
    await expect(mobile.locator('#upload-error')).toBeVisible();
    expect(await readdir(shipment.folder)).toHaveLength(26);
    const pending = await mobile.evaluate(() => (window as any).FreightUploadQueue.getPending());
    expect(pending.uploadedIndices).toHaveLength(26);
    await mobile.unroute(/\/finish\?/);
    await mobile.reload();
    await expect(mobile.locator('#upload-status')).toContainText('Done, 26 pictures uploaded');
    await expect(mobile.locator('#upload-done-mark')).toBeVisible();
    await mobile.reload();
    await expect(mobile.locator('#upload-status')).toContainText('Done, 26 pictures uploaded');
    await expect(mobile.locator('#capture-block')).toBeHidden();
    expect(await readdir(shipment.folder)).toHaveLength(26);
  } finally { await mobile.close(); await app.close(); }
});

test('stalled installed phone worker falls back without refreshing', async ({ browser }) => {
  const { app, mobile, localUrl, shipment } = await setup(browser);
  try {
    await mobile.goto(localUrl);
    await mobile.evaluate(() => {
      (window as any).probeBackgroundUploadSupport = async () => ({ installedPwa: true, backgroundFetchPermission: 'denied' });
      (window as any).ensureUploadServiceWorker = async () => null;
      (window as any).notifyServiceWorkerToContinueUploads = () => {};
    });
    await mobile.locator('#files').setInputFiles(Array.from({ length: 26 }, (_, i) => ({ name: `p-${i}.png`, mimeType: 'image/png', buffer: PNG })));
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('26');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    await expect(mobile.locator('#upload-status')).toContainText('Done, 26 pictures uploaded', { timeout: 35000 });
    expect(await readdir(shipment.folder)).toHaveLength(26);
  } finally { await mobile.close(); await app.close(); }
});

test('desktop saved acknowledgments advance phone when an upload response is lost', async ({ browser }) => {
  const { app, mobile, localUrl, shipment } = await setup(browser);
  try {
    await mobile.route(/\/file\?/, async route => {
      if (route.request().url().includes('index=0')) {
        await route.fetch(); // File is saved, but the phone never receives its response.
        await new Promise(() => {});
      } else await route.continue();
    });
    await startBatchUpload(mobile, localUrl);
    await expect(mobile.locator('#upload-status')).toContainText('Done, 26 pictures uploaded', { timeout: 20000 });
    expect(await readdir(shipment.folder)).toHaveLength(26);
  } finally { await mobile.close(); await app.close(); }
});

test('simultaneous queue acknowledgments keep all 26 indices', async ({ browser }) => {
  const { app, mobile, localUrl } = await setup(browser);
  try {
    await mobile.goto(localUrl);
    const result = await mobile.evaluate(async () => {
      const Q = (window as any).FreightUploadQueue;
      const files = Array.from({ length: 26 }, (_, i) => new File(['picture'], i + '.png', { type: 'image/png' }));
      await Q.createFromSelection({ shipmentKey: 'test', pallets: 26, files, hashFile: async () => 'hash' });
      await Q.setBatchId('batch');
      await Promise.all(Array.from({ length: 26 }, (_, i) => Q.markIndexUploaded(i, 'batch')));
      const { pending } = await Q.repairAndLoadPending();
      return pending.uploadedIndices;
    });
    expect(result).toEqual(Array.from({ length: 26 }, (_, i) => i));
  } finally { await mobile.close(); await app.close(); }
});


test('background uploads finish even when the phone receives no completion event', async ({ browser }) => {
  const { app, mobile, localUrl, shipment } = await setup(browser);
  try {
    await mobile.goto(localUrl);
    await mobile.evaluate(() => {
      (window as any).probeBackgroundUploadSupport = async () => ({ installedPwa: true, controller: true, backgroundFetchPermission: 'granted' });
      (window as any).registerServiceWorkerForUploads = async () => ({ backgroundFetch: {
        fetch: async (_id: string, requests: Request[]) => {
          for (const request of requests) {
            const response = await fetch(request);
            if (!response.ok) throw Error('Upload failed');
          }
          return { addEventListener() {}, removeEventListener() {}, abort() {}, uploaded: 0, downloadTotal: 1 };
        }
      } });
    });
    await mobile.locator('#files').setInputFiles(Array.from({ length: 26 }, (_, i) => ({ name: `p-${i}.png`, mimeType: 'image/png', buffer: PNG })));
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('26');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    await expect(mobile.locator('#upload-status')).toContainText('Done, 26 pictures uploaded');
    expect(await readdir(shipment.folder)).toHaveLength(26);
  } finally { await mobile.close(); await app.close(); }
});
