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

async function startTwoPictureUpload(mobile: import('@playwright/test').Page, localUrl: string) {
  await mobile.goto(localUrl);
  await mobile.locator('#files').setInputFiles([
    { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'pallet-b.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await mobile.getByLabel('Pallet amount', { exact: true }).fill('2');
  await mobile.locator('#confirm').check();
  await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
  await mobile.getByRole('button', { name: 'Upload', exact: true }).click();
}

test('close page mid-upload then reopen and finish without duplicates', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-resume-close', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Resume Close Co');
    await page.getByLabel('Date shipped').fill('2026-10-27');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Resume Close Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    let fileAttempts = 0;
    await mobile.route(/\/file\?/, async route => {
      fileAttempts += 1;
      if (fileAttempts === 2) await route.abort();
      else await route.continue();
    });

    await startTwoPictureUpload(mobile, localUrl);
    await expect(mobile.locator('#message')).toContainText(/Connection interrupted|Retry upload/);

    await mobile.unroute(/\/file\?/);
    await mobile.reload();
    await expect(mobile.locator('#message')).toContainText('verified', { timeout: 120000 });

    expect(await readdir(shipment.folder)).toHaveLength(2);
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('offline mid-upload then online resumes', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-resume-offline', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Resume Offline Co');
    await page.getByLabel('Date shipped').fill('2026-10-27');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Resume Offline Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    let fileAttempts = 0;
    await mobile.route(/\/file\?/, async route => {
      fileAttempts += 1;
      if (fileAttempts === 2) await route.abort();
      else await route.continue();
    });

    await startTwoPictureUpload(mobile, localUrl);
    await expect(mobile.locator('#message')).toContainText(/Connection interrupted|Retry upload/);

    await mobile.unroute(/\/file\?/);
    await mobile.getByRole('button', { name: 'Retry upload', exact: true }).click();
    await expect(mobile.locator('#message')).toContainText('verified', { timeout: 120000 });
    expect(await readdir(shipment.folder)).toHaveLength(2);
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('cancel during resume deletes the batch', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-resume-cancel', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Resume Cancel Co');
    await page.getByLabel('Date shipped').fill('2026-10-27');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Resume Cancel Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    let fileAttempts = 0;
    await mobile.route(/\/file\?/, async route => {
      fileAttempts += 1;
      if (fileAttempts === 2) await route.abort();
      else await route.continue();
    });

    await startTwoPictureUpload(mobile, localUrl);
    await expect(mobile.locator('#message')).toContainText(/Connection interrupted|Retry upload/);

    await mobile.unroute(/\/file\?/);
    await mobile.route(/\/finish/, async route => {
      await new Promise(() => { });
      await route.continue();
    });
    await mobile.reload();
    await expect(mobile.locator('#message')).toContainText('Verifying every picture');
    await mobile.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    await mobile.unroute(/\/finish/);
    await expect(mobile.locator('#message')).toContainText('Upload canceled');
    expect(await readdir(shipment.folder)).toHaveLength(0);
    await mobile.close();
  } finally {
    await app.close();
  }
});
