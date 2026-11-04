import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

test.use({ channel: 'msedge' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=',
  'base64',
);
const PNG_HASH = createHash('sha256').update(PNG).digest('hex');
const GRACE_MS = 400;

async function launchFreightApp(storage: string) {
  const profile = path.dirname(storage);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile,
    FREIGHT_BATCH_TTL_MS: '60000',
    FREIGHT_FINISH_GRACE_MS: String(GRACE_MS),
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

function apiUrl(shipmentUrl: string, route: string) {
  return shipmentUrl.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731').replace('/?', route + '&');
}

test('server auto-finishes after the grace period with no page open', async ({ request, browser }) => {
  const profile = path.resolve('.cache/freight-finish-grace-auto', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Grace Auto Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Grace Auto Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const batchRes = await request.post(apiUrl(shipment.url, '/batch?'), {
      data: { pallets: 1, files: [{ name: 'pallet.png', size: PNG.length, hash: PNG_HASH }] },
    });
    expect(batchRes.status()).toBe(200);
    const batch = await batchRes.json();
    const fileRes = await request.post(
      shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731').replace('/?', `/file?batch=${batch.id}&index=0&`),
      { headers: { 'X-Picture-SHA256': PNG_HASH }, data: PNG },
    );
    expect(fileRes.status(), await fileRes.text()).toBe(200);

    await expect.poll(async () => (await readdir(shipment.folder)).length, { timeout: 5000 }).toBe(1);
    await new Promise(r => setTimeout(r, GRACE_MS + 800));
    expect(await readdir(shipment.folder)).toHaveLength(1);

    const after = await page.evaluate(() => window.toolkit.freight('status'));
    const closed = after.shipments.find(s => s.company === 'Grace Auto Co')!;
    expect(closed.closed).toBe(true);
    expect(closed.pictures).toBe(1);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    await mobile.goto(localUrl);
    await expect(mobile.locator('#message')).toContainText(/complete|Done/i);
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('cancel during the grace period deletes everything', async ({ request }) => {
  const profile = path.resolve('.cache/freight-finish-grace-cancel', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Grace Cancel Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Grace Cancel Co')!;

    const batchRes = await request.post(apiUrl(shipment.url, '/batch?'), {
      data: { pallets: 1, files: [{ name: 'pallet.png', size: PNG.length, hash: PNG_HASH }] },
    });
    expect(batchRes.status()).toBe(200);
    const batch = await batchRes.json();
    const fileRes = await request.post(
      shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731').replace('/?', `/file?batch=${batch.id}&index=0&`),
      { headers: { 'X-Picture-SHA256': PNG_HASH }, data: PNG },
    );
    expect(fileRes.status(), await fileRes.text()).toBe(200);
    await expect.poll(async () => (await readdir(shipment.folder)).length, { timeout: 5000 }).toBe(1);

    const cancelRes = await request.post(apiUrl(shipment.url, `/cancel?batch=${batch.id}&`));
    expect(cancelRes.status()).toBe(200);
    expect(await readdir(shipment.folder)).toHaveLength(0);

    await new Promise(r => setTimeout(r, GRACE_MS + 800));
    expect(await readdir(shipment.folder)).toHaveLength(0);

    const lateFile = await request.post(
      shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731').replace('/?', `/file?batch=${batch.id}&index=0&`),
      { headers: { 'X-Picture-SHA256': PNG_HASH }, data: PNG },
    );
    expect(lateFile.status()).toBe(410);
    expect(await readdir(shipment.folder)).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test('phone shows Done after returning to a server auto-finished upload', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-finish-grace-done', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Grace Done Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Grace Done Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    await mobile.route(/\/finish/, async route => {
      await new Promise(() => { });
      await route.continue();
    });
    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([{ name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG }]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    await expect.poll(async () => (await readdir(shipment.folder)).length, { timeout: 15000 }).toBe(1);
    await mobile.close();

    await new Promise(r => setTimeout(r, GRACE_MS + 800));
    expect(await readdir(shipment.folder)).toHaveLength(1);

    const again = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    await again.goto(localUrl);
    await expect(again.locator('#upload-status')).toContainText('Done, 1 pictures uploaded', { timeout: 15000 });
    await again.close();
  } finally {
    await app.close();
  }
});
