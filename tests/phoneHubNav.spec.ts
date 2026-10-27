import { test, expect, _electron as electron } from '@playwright/test';
import { ConnectPwaServer, CONNECT_PWA_PORT } from '../electron/connectPwaServer';
import { startCaTrustServer, PHONE_CA_TRUST_PORT } from '../electron/tls/caTrustServer';
import { createTestPhoneTlsManager } from './helpers/phoneTlsTest';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test.use({ channel: 'msedge' });

test.describe('Phone hub home navigation', () => {
  test('Connect PWA hub has no install UI but keeps PWA assets', async () => {
    const root = path.resolve('.cache/phone-hub-nav', randomUUID());
    const tls = await createTestPhoneTlsManager(root);
    const server = new ConnectPwaServer(path.join(root, 'settings.json'), tls, async () => []);
    await server.start();
    try {
      const html = await fetch(`http://127.0.0.1:${CONNECT_PWA_PORT}/`, { agent: new (await import('node:https')).Agent({ rejectUnauthorized: false }) } as RequestInit).then(r => r.text());
      expect(html).not.toContain('Add to Home Screen');
      expect(html).not.toContain('install-banner');
      expect(html).toContain('/manifest.webmanifest');
      const sw = await fetch(`http://127.0.0.1:${CONNECT_PWA_PORT}/sw.js`, { agent: new (await import('node:https')).Agent({ rejectUnauthorized: false }) } as RequestInit);
      expect(sw.ok).toBe(true);
    } finally {
      server.stop();
    }
  });

  test('Freight mobile shows Home link to Connect PWA origin', async ({ browser }) => {
    const profile = path.resolve('.cache/phone-hub-freight', randomUUID());
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
    try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog }, storagePath) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storagePath] })) as any;
      }, storage);
      await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Freight Pictures', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
      await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
      await page.getByLabel('Company', { exact: true }).fill('Home Nav Co');
      await page.getByLabel('Date shipped').fill('2026-10-16');
      await page.getByRole('button', { name: 'Create shipment & QR code' }).click();
      const state = await page.evaluate(() => window.toolkit.freight('status'));
      const shipment = state.shipments.find(s => s.company === 'Home Nav Co')!;
      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
      await mobile.goto(shipment.url.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:48731'));
      await mobile.waitForSelector('.phone-home-link', { timeout: 15000 });
      const home = mobile.getByRole('link', { name: 'Home', exact: true });
      await expect(home).toBeVisible();
      await expect(home).toHaveAttribute('href', `http://127.0.0.1:${CONNECT_PWA_PORT}/`);
      await mobile.close();
    } finally {
      await app.close();
    }
  });

  test('CA trust page serves Home link', async ({ page }) => {
    const handle = await startCaTrustServer(() => '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----');
    try {
      await page.goto(`http://127.0.0.1:${PHONE_CA_TRUST_PORT}/`);
      const home = page.getByRole('link', { name: 'Home', exact: true });
      await expect(home).toBeVisible();
      await expect(home).toHaveAttribute('href', `http://127.0.0.1:${CONNECT_PWA_PORT}/`);
    } finally {
      await handle.close();
    }
  });
});
