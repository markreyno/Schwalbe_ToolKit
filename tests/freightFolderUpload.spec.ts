import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

test.use({ channel: 'msedge' });

async function startFreightShipment(browser: import('@playwright/test').Browser, company: string) {
  const profile = path.resolve('.cache/freight-folder-tests', randomUUID());
  const storage = path.join(profile, 'pictures');
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
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, storagePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storagePath] })) as any;
  }, storage);
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Freight Pictures', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await page.getByLabel('Company', { exact: true }).fill(company);
  await page.getByLabel('Date shipped').fill('2026-10-20');
  await page.getByRole('button', { name: 'Create shipment & QR code' }).click();
  const state = await page.evaluate(() => window.toolkit.freight('status'));
  const shipment = state.shipments.find(s => s.company === company)!;
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const localUrl = shipment.url.replace(/^http:\/\/[^/]+/, 'http://127.0.0.1:48731');
  await mobile.goto(localUrl);
  return { app, page, mobile, shipment, bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=', 'base64') };
}

async function stagePictures(mobile: import('@playwright/test').Page, bytes: Buffer, count = 1) {
  const files = Array.from({ length: count }, (_, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: bytes }));
  await mobile.locator('#files').setInputFiles(files);
  await mobile.getByLabel('Pallet amount', { exact: true }).fill(String(count));
  await mobile.locator('#confirm').check();
}

test('freight folder confirm cancel does not start batch', async ({ browser }) => {
  const { app, mobile, shipment, bytes } = await startFreightShipment(browser, 'Folder Cancel Co');
  await stagePictures(mobile, bytes);
  let batchStarted = false;
  mobile.on('request', req => { if (req.url().includes('/batch?')) batchStarted = true; });
  await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
  await expect(mobile.locator('#folder-confirm')).toBeVisible();
  await mobile.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(mobile.locator('#folder-confirm')).toBeHidden();
  expect(batchStarted).toBe(false);
  expect(await readdir(shipment.folder)).toHaveLength(0);
  await mobile.close();
  await app.close();
});

test('freight renamed upload lands in sanitized subfolder', async ({ browser, request }) => {
  const { app, page, mobile, shipment, bytes } = await startFreightShipment(browser, 'Folder Rename Co');
  await stagePictures(mobile, bytes, 1);
  await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
  await mobile.locator('#folder-name').fill('Dock/../Trailers');
  const batchRequest = mobile.waitForRequest(r => r.url().includes('/batch?'));
  await mobile.locator('#confirm-upload').click();
  const batchBody = (await batchRequest).postDataJSON();
  expect(batchBody.folderName).toBe('Dock/../Trailers');
  await expect(mobile.locator('#message')).toContainText('pallet pictures verified');
  const subPath = path.join(shipment.folder, 'Trailers');
  const subFiles = await readdir(subPath);
  expect(subFiles).toHaveLength(1);
  expect(await readFile(path.join(subPath, subFiles[0]))).toEqual(bytes);
  expect(await readdir(shipment.folder)).toContain('Trailers');

  const state = await page.evaluate(() => window.toolkit.freight('status'));
  const updated = state.shipments.find(s => s.id === shipment.id)!;
  expect(updated.lastUploadSubfolder).toBe('Trailers');

  const api = (route: string) =>
    shipment.url.replace(/^http:\/\/[^/]+/, 'http://127.0.0.1:48731').replace('/?', route + '&');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const bad = await request.post(api('/batch?'), {
    data: { pallets: 1, files: [{ name: 'x.png', size: bytes.length, hash }], folderName: 'CON' }
  });
  expect(bad.status()).toBe(400);

  await mobile.close();
  await app.close();
});
