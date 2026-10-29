import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

test.use({ channel: 'msedge' });

test('cancel upload removes partial files and releases the batch lock immediately', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-cancel-tests', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
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
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, storagePath) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storagePath] })) as any;
    }, storage);
    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Freight Pictures', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await page.getByLabel('Company', { exact: true }).fill('Cancel Test Co');
    await page.getByLabel('Date shipped').fill('2026-10-16');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();
    await expect(page.locator('.freight-shipment')).toContainText('Awaiting pictures');

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Cancel Test Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    await mobile.goto(localUrl);
    await expect(mobile.locator('#upload')).toBeVisible();

    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=',
      'base64',
    );
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: bytes },
      { name: 'pallet-b.png', mimeType: 'image/png', buffer: bytes },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('2');
    await mobile.locator('#confirm').check();

    let releaseFirstFile: (() => void) | undefined;
    await mobile.route(/\/file\?/, async route => {
      if (route.request().url().includes('index=0')) {
        await new Promise<void>(resolve => { releaseFirstFile = resolve; });
      }
      await route.continue();
    });

    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    await expect(mobile.getByRole('button', { name: 'Cancel upload', exact: true })).toBeVisible();
    await mobile.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    releaseFirstFile?.();
    await expect(mobile.locator('#message')).toContainText('Upload canceled');
    await expect(mobile.locator('#capture-block')).toBeVisible();
    await expect(mobile.locator('#count')).toContainText('2 pictures');

    const fs = await import('node:fs/promises');
    expect(await fs.readdir(shipment.folder)).toHaveLength(0);

    await mobile.unroute(/\/file\?/);
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    await expect(mobile.locator('#message')).toContainText('pallet pictures verified');
    expect(await fs.readdir(shipment.folder)).toHaveLength(2);

    await mobile.close();
  } finally {
    await app.close();
  }
});

test('batch lock expires after FREIGHT_BATCH_TTL_MS', async ({ request }) => {
  const profile = path.resolve('.cache/freight-ttl-tests', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile,
    FREIGHT_BATCH_TTL_MS: '300',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }),
    env,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, storagePath) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storagePath] })) as any;
    }, storage);
    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Freight Pictures', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await page.getByLabel('Company', { exact: true }).fill('TTL Test Co');
    await page.getByLabel('Date shipped').fill('2026-10-16');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'TTL Test Co')!;
    const api = (route: string) =>
      shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731').replace('/?', route + '&');
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=',
      'base64',
    );
    const manifest = {
      pallets: 1,
      files: [{ name: 'pallet.png', size: bytes.length }],
    };
    const first = await request.post(api('/batch?'), { data: manifest });
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    const resumed = await request.post(api('/batch?'), { data: manifest });
    expect(resumed.status()).toBe(200);
    expect((await resumed.json()).resumed).toBe(true);

    const pictureHash = createHash('sha256').update(bytes).digest('hex');
    const fileUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731').replace('/?', `/file?batch=${firstBody.id}&index=0&`);
    const uploaded = await request.post(fileUrl, {
      headers: { 'Content-Type': 'application/octet-stream', 'X-Picture-SHA256': pictureHash },
      data: bytes,
    });
    expect(uploaded.status(), await uploaded.text()).toBe(200);

    const blocked = await request.post(api('/batch?'), { data: manifest });
    expect(blocked.status()).toBe(400);
    expect((await blocked.json()).error).toContain('wait 1 minute');
    await new Promise(r => setTimeout(r, 350));
    const second = await request.post(api('/batch?'), { data: manifest });
    expect(second.status()).toBe(200);
  } finally {
    await app.close();
  }
});
