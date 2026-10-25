import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FREIGHT_PHONE_PORT } from '../electron/toolPhoneUrls';

test.use({ channel: 'msedge', viewport: { width: 390, height: 844 }, isMobile: true });

const artifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'freight-mobile-shipment');

test('phone can rename empty shipment and start a new shipment from setup', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-shipment-phone', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile,
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
    await page.getByLabel('Company', { exact: true }).fill('Taffej');
    await page.getByLabel('Date shipped').fill('2026-10-08');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Taffej')!;
    const mobile = await browser.newPage({ ignoreHTTPSErrors: true });
    const url = shipment.url.replace(/^https?:\/\/[^/]+/, `https://127.0.0.1:${FREIGHT_PHONE_PORT}`);
    await mobile.goto(url);

    await expect(mobile.locator('#title')).toHaveText('Taffej · 2026-10-08');
    await expect(mobile.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(mobile.getByLabel('Upload subfolder (optional)')).toBeVisible();
    await expect(mobile.getByRole('button', { name: 'Back / New shipment', exact: true })).toBeVisible();
    await mobile.screenshot({ path: path.join(artifactDir, '01-first-screen-edit-controls.png'), fullPage: true });

    await mobile.getByRole('button', { name: 'Back / New shipment', exact: true }).click();
    await expect(mobile.locator('#shipment-setup')).toBeVisible();
    await expect(mobile.locator('#new-date')).not.toHaveValue('');
    await mobile.screenshot({ path: path.join(artifactDir, '02-new-shipment-page.png'), fullPage: true });
    await mobile.getByRole('button', { name: 'Cancel', exact: true }).click();

    await mobile.getByRole('button', { name: 'Edit', exact: true }).click();
    await mobile.locator('#edit-company').fill('Renamed Co');
    await mobile.locator('#edit-date').fill('2026-10-25');
    await mobile.getByRole('button', { name: 'Save shipment', exact: true }).click();
    await expect(mobile.locator('#title')).toHaveText('Renamed Co · 2026-10-25');
    await mobile.screenshot({ path: path.join(artifactDir, '03-renamed-header.png'), fullPage: true });

    await expect.poll(async () => {
      const desktop = await page.evaluate(() => window.toolkit.freight('status'));
      return desktop.shipments.find(s => s.company === 'Renamed Co')?.date;
    }).toBe('2026-10-25');

    await mobile.close();
  } finally {
    await app.close();
  }
});
