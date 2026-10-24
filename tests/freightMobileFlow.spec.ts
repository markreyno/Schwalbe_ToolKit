import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FREIGHT_PHONE_PORT } from '../electron/toolPhoneUrls';
import { readFileSync } from 'node:fs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=',
  'base64',
);

const screenshotDir = path.resolve('test-results', 'freight-mobile-flow');
const artifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'freight-mobile-flow');

test.use({
  channel: 'msedge',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test.describe('Freight mobile folder flow (mobile viewport)', () => {
  test.beforeAll(async () => {
    await mkdir(screenshotDir, { recursive: true });
    await mkdir(artifactDir, { recursive: true });
  });

  test('folder naming, back navigation, rename during upload (dist-electron HTTPS)', async ({ browser }) => {
    const builtPage = readFileSync(path.join(process.cwd(), 'dist-electron', 'freightMobileInline.js'), 'utf8');
    expect(builtPage).toContain('folder-step');
    expect(builtPage).toContain('folder-name-upload');

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

      const state = await page.evaluate(() => window.toolkit.freight('status'));
      const shipment = state.shipments.find(s => s.company === 'Mobile Flow Co')!;
      const mobile = await browser.newPage();
      const url = shipment.url.replace(/^https?:\/\/[^/]+/, `https://127.0.0.1:${FREIGHT_PHONE_PORT}`);
      await mobile.goto(url);
      await mobile.waitForSelector('.phone-home-link');

      await mobile.locator('#files').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PNG }]);
      await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
      await mobile.locator('#confirm').check();
      await mobile.screenshot({ path: path.join(screenshotDir, '01-photos-selected.png'), fullPage: true });

      await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
      await expect(mobile.locator('#folder-step')).toBeVisible();
      await expect(mobile.locator('#folder-name')).toBeEditable();
      await mobile.locator('#folder-name').fill('Dock A');
      await mobile.screenshot({ path: path.join(screenshotDir, '02-folder-naming.png'), fullPage: true });

      let releaseFile: (() => void) | undefined;
      await mobile.route(/\/file\?/, async route => {
        if (route.request().url().includes('index=0')) {
          await new Promise<void>(resolve => { releaseFile = resolve; });
        }
        await route.continue();
      });

      await mobile.getByRole('button', { name: 'Upload', exact: true }).click();
      await expect(mobile.locator('#upload-progress-panel')).toBeVisible();
      await expect(mobile.locator('#folder-name-upload')).toBeEditable();
      await mobile.screenshot({ path: path.join(screenshotDir, '03-uploading.png'), fullPage: true });

      await mobile.locator('#back-to-folder').click();
      await expect(mobile.locator('#folder-step')).toBeVisible();
      await expect(mobile.locator('#count')).toContainText('1 pictures');
      await mobile.screenshot({ path: path.join(screenshotDir, '04-back-to-folder.png'), fullPage: true });

      await mobile.locator('#folder-name').fill('Dock B');
      await mobile.getByRole('button', { name: 'Upload', exact: true }).click();
      await expect(mobile.locator('#upload-progress-panel')).toBeVisible();
      await mobile.locator('#folder-name-upload').fill('');
      await mobile.locator('#folder-name-upload').fill('Dock C');
      await expect(mobile.locator('#folder-name-upload')).toHaveValue('Dock C');
      await mobile.getByRole('button', { name: 'Save folder name', exact: true }).click();
      await expect.poll(async () => mobile.locator('#message').textContent()).toContain('Dock C');
      releaseFile?.();
      await expect(mobile.locator('#message')).toContainText('pallet pictures verified');
      await mobile.screenshot({ path: path.join(screenshotDir, '05-upload-complete.png'), fullPage: true });

      const dockC = path.join(shipment.folder, 'Dock C');
      expect((await readdir(dockC)).length).toBe(1);
      expect(await readFile(path.join(dockC, (await readdir(dockC))[0]))).toEqual(PNG);

      for (const name of ['01-photos-selected.png', '02-folder-naming.png', '03-uploading.png', '04-back-to-folder.png', '05-upload-complete.png']) {
        await mkdir(artifactDir, { recursive: true });
        const { copyFile } = await import('node:fs/promises');
        await copyFile(path.join(screenshotDir, name), path.join(artifactDir, name));
      }

      await mobile.unroute(/\/file\?/);
      await mobile.close();
    } finally {
      await app.close();
    }
  });
});
