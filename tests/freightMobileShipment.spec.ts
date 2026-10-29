import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FREIGHT_PHONE_PORT } from '../electron/toolPhoneUrls';

test.use({ channel: 'msedge', viewport: { width: 390, height: 844 }, isMobile: true });

const artifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'freight-mobile-shipment');

async function launchFreightWithShipment(browser: import('@playwright/test').Browser, company: string, date: string) {
  const profile = path.resolve('.cache/freight-shipment-phone', randomUUID());
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
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, storagePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storagePath] })) as any;
  }, storage);
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Freight Pictures', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await page.getByLabel('Company', { exact: true }).fill(company);
  await page.getByLabel('Date shipped').fill(date);
  await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

  const state = await page.evaluate(() => window.toolkit.freight('status'));
  const shipment = state.shipments.find(s => s.company === company)!;
  const mobile = await browser.newPage({ ignoreHTTPSErrors: true });
  const url = shipment.url.replace(/^https?:\/\/[^/]+/, `https://127.0.0.1:${FREIGHT_PHONE_PORT}`);
  return { app, page, mobile, url, shipment };
}

test('phone upload page shows no Edit control', async ({ browser }) => {
  await mkdir(artifactDir, { recursive: true });
  const { app, mobile, url } = await launchFreightWithShipment(browser, 'Taffej', '2026-10-08');
  try {
    await mobile.goto(url);
    await expect(mobile.locator('#title')).toHaveText('Taffej · 2026-10-08');
    await expect(mobile.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(mobile.locator('#edit-shipment')).toHaveCount(0);
    await expect(mobile.locator('#shipment-edit')).toHaveCount(0);
    await expect(mobile.locator('#saving-to')).toContainText('Saving to:');
    await mobile.screenshot({ path: path.join(artifactDir, '01-no-edit-control.png'), fullPage: true });
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('phone cannot rename shipment via API', async ({ browser }) => {
  const { app, mobile, url } = await launchFreightWithShipment(browser, 'No Phone Rename', '2026-10-09');
  try {
    await mobile.goto(url);
    const key = new URL(url).searchParams.get('key');
    const status = await mobile.evaluate(async shipmentKey => {
      const r = await fetch('/shipment/update?key=' + encodeURIComponent(shipmentKey!), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: 'Hacked Co', date: '2026-01-01' }),
      });
      const d = await r.json();
      return { ok: r.ok, status: r.status, error: d.error as string };
    }, key);
    expect(status.status).toBe(403);
    expect(status.error).toMatch(/desktop toolkit/i);
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('New shipment form has no Cancel button on hub or from Back / New shipment', async ({ browser }) => {
  const { app, mobile, url } = await launchFreightWithShipment(browser, 'Paw', '2026-10-28');
  try {
    await mobile.goto(url);
    await mobile.getByRole('button', { name: 'Back / New shipment', exact: true }).click();
    await expect(mobile.locator('#shipment-setup')).toBeVisible();
    await expect(mobile.locator('#cancel-new-shipment')).toHaveCount(0);
    await expect(mobile.locator('#upload')).toBeHidden();
    await expect(mobile.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    await mobile.close();
  } finally {
    await app.close();
  }
});
