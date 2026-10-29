import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FREIGHT_PHONE_PORT } from '../electron/toolPhoneUrls';
import { readFileSync } from 'node:fs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQUR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=',
  'base64',
);

const screenshotDir = path.resolve('test-results', 'freight-mobile-flow');
const artifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'freight-mobile-flow');
const desktopArtifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'freight-desktop-subfolder');
const pvArtifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'palletvision-headers');

test.use({
  channel: 'msedge',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test.describe('Freight mobile flow (mobile viewport)', () => {
  test.beforeAll(async () => {
    await mkdir(screenshotDir, { recursive: true });
    await mkdir(artifactDir, { recursive: true });
    await mkdir(desktopArtifactDir, { recursive: true });
    await mkdir(pvArtifactDir, { recursive: true });
  });

  test('Upload All starts immediately, desktop subfolder, upload progress (dist-electron HTTPS)', async ({ browser }) => {
    const builtPage = readFileSync(path.join(process.cwd(), 'dist-electron', 'freightMobileInline.js'), 'utf8');
    expect(builtPage).toContain('saving-to');
    expect(builtPage).not.toContain('edit-shipment');
    expect(builtPage).not.toContain('start-over');

    const profile = path.resolve('.cache/freight-mobile-flow', randomUUID());
    const storage = path.join(profile, 'pictures');
    await mkdir(storage, { recursive: true });
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
      await page.getByLabel('Company', { exact: true }).fill('Mobile Flow Co');
      await page.getByLabel('Date shipped').fill('2026-10-24');
      await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

      let state = await page.evaluate(() => window.toolkit.freight('status'));
      const shipment = state.shipments.find(s => s.company === 'Mobile Flow Co')!;
      await page.evaluate(({ id }) => window.toolkit.freight('setSubfolder', { id, subfolder: 'Dock A' }), { id: shipment.id });
      await page.getByLabel('Select shipment').selectOption(shipment.id);
      await expect(page.getByRole('button', { name: 'Apply subfolder', exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(desktopArtifactDir, 'freight-desktop-subfolder.png'), fullPage: true });

      const mobile = await browser.newPage();
      const url = shipment.url.replace(/^https?:\/\/[^/]+/, `https://127.0.0.1:${FREIGHT_PHONE_PORT}`);
      await mobile.goto(url);
      await mobile.waitForSelector('.phone-home-link');
      await expect(mobile.locator('#upload')).toBeVisible();
      await expect(mobile.locator('#app-version')).toContainText(/^v\d+\.\d+\.\d+$/);
      await expect(mobile.locator('#saving-to')).toContainText('Saving to:');
      await expect(mobile.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
      await mobile.screenshot({ path: path.join(artifactDir, '01-first-screen.png'), fullPage: true });

      await mobile.locator('#files').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PNG }]);
      await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
      await mobile.locator('#confirm').check();

      let releaseFile: (() => void) | undefined;
      await mobile.route(/\/file\?/, async route => {
        if (route.request().url().includes('index=0')) {
          await new Promise<void>(resolve => { releaseFile = resolve; });
        }
        await route.continue();
      });

      await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
      await expect(mobile.locator('#upload-progress-panel')).toBeVisible();
      await mobile.screenshot({ path: path.join(artifactDir, '02-uploading.png'), fullPage: true });

      releaseFile?.();
      await expect(mobile.locator('#message')).toContainText('pallet pictures verified', { timeout: 15000 });

      const dockA = path.join(shipment.folder, 'Dock A');
      expect((await readdir(dockA)).length).toBe(1);

      const pvMobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
      const pvState = await page.evaluate(() => window.toolkit.palletvision('status'));
      await pvMobile.goto(pvState.qrUrl.replace(/^https?:\/\/[^/]+/, `https://127.0.0.1:48732`));
      await pvMobile.waitForSelector('.phone-home-link');
      await pvMobile.locator('header.brand-bar').screenshot({ path: path.join(pvArtifactDir, 'palletvision-phone-header.png') });
      await pvMobile.close();

      await page.getByRole('link', { name: 'All tools' }).click();
      await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
      await page.locator('.page-heading').screenshot({ path: path.join(pvArtifactDir, 'palletvision-desktop-header.png') });

      await mobile.unroute(/\/file\?/);
      await mobile.close();
    } finally {
      await app.close();
    }
  });
});
