import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FREIGHT_PHONE_PORT } from '../electron/toolPhoneUrls';

test.use({ channel: 'msedge', viewport: { width: 390, height: 844 }, isMobile: true });

async function launchFreight(browser: import('@playwright/test').Browser) {
  const profile = path.resolve('.cache/freight-hub-entry', randomUUID());
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
  await page.getByLabel('Company', { exact: true }).fill('Paw');
  await page.getByLabel('Date shipped').fill('2026-10-28');
  await page.getByRole('button', { name: 'Create shipment & QR code' }).click();
  const state = await page.evaluate(() => window.toolkit.freight('status'));
  const paw = state.shipments.find(s => s.company === 'Paw')!;
  const pawKey = new URL(paw.url).searchParams.get('key')!;
  const mobile = await browser.newPage({ ignoreHTTPSErrors: true });
  const hubUrl = `https://127.0.0.1:${FREIGHT_PHONE_PORT}/`;
  return { app, mobile, hubUrl, pawKey };
}

test('hub without key always shows New shipment and clears empty queue shells', async ({ browser }) => {
  const { app, mobile, hubUrl, pawKey } = await launchFreight(browser);
  try {
    await mobile.goto(hubUrl);
    await mobile.evaluate(async (key: string) => {
      const Q = (window as unknown as { FreightUploadQueue: { savePending: (r: unknown) => Promise<void>; getPending: () => Promise<unknown> } }).FreightUploadQueue;
      await Q.savePending({
        id: 'active',
        shipmentKey: key,
        pallets: 2,
        batchId: 'stale-batch',
        files: [],
        uploadedIndices: [0],
        createdAt: Date.now(),
      });
    }, pawKey);
    await mobile.reload();
    await expect(mobile.locator('#shipment-setup')).toBeVisible();
    await expect(mobile.locator('#upload')).toBeHidden();
    await expect(mobile.locator('#cancel-new-shipment')).toHaveCount(0);
    await expect(mobile.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    await expect(mobile.locator('#title')).not.toContainText('Paw');
    const pending = await mobile.evaluate(async () => {
      const Q = (window as unknown as { FreightUploadQueue: { getPending: () => Promise<unknown> } }).FreightUploadQueue;
      return Q.getPending();
    });
    expect(pending).toBeNull();
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('New shipment form has no Cancel button', async ({ browser }) => {
  const { app, mobile, hubUrl } = await launchFreight(browser);
  try {
    await mobile.goto(hubUrl);
    await expect(mobile.locator('#shipment-setup')).toBeVisible();
    await expect(mobile.locator('#cancel-new-shipment')).toHaveCount(0);
    await expect(mobile.getByRole('heading', { name: 'New shipment', exact: true })).toBeVisible();
    await expect(mobile.getByRole('button', { name: 'Start shipment', exact: true })).toBeVisible();
    await mobile.close();
  } finally {
    await app.close();
  }
});
