import { test, expect } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { FreightServer } from '../electron/freightServer';
import { createTestPhoneTlsManager } from './helpers/phoneTlsTest';
import { resolveConnectPwaTools } from '../electron/toolPhoneUrls';
import { FREIGHT_PHONE_PORT } from '../electron/toolPhoneUrls';

test.describe('Freight phone hub entry', () => {
  test('hub tile URL has no shipment key', async () => {
    const tools = resolveConnectPwaTools(
      'desk.tailbbbe79.ts.net',
      {
        root: '/data',
        running: true,
        addresses: ['http://desk.tailbbbe79.ts.net:48731'],
        masterUrl: 'http://desk.tailbbbe79.ts.net:48731/?key=master',
        shipments: [{ closed: false, url: 'http://desk.tailbbbe79.ts.net:48731/?key=old-shipment' }]
      },
      { root: '/pv', running: true, addresses: ['http://desk.tailbbbe79.ts.net:48732'], qrUrl: 'http://desk.tailbbbe79.ts.net:48732/' },
      true
    );
    expect(tools[0].url).toBe('http://desk.tailbbbe79.ts.net:48731/');
  });

  test('bare origin opens New shipment; QR key opens active shipment', async ({ browser }) => {
    const testRoot = path.resolve('.cache/freight-hub-entry', randomUUID());
    const storage = await mkdtemp(path.join(tmpdir(), 'freight-hub-'));
    await mkdir(testRoot, { recursive: true });
    const tls = await createTestPhoneTlsManager(testRoot);
    const settings = path.join(testRoot, 'freight.json');
    const server = new FreightServer(settings, tls);
    await server.setRoot(storage);
    await server.start();
    await server.create('Bti nm', '2026-10-16');
    const status = await server.status();
    const shipment = status.shipments[0];
    const base = `http://127.0.0.1:${FREIGHT_PHONE_PORT}`;

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(`${base}/`);
    await expect(mobile.locator('#shipment-setup')).toBeVisible();
    await expect(mobile.getByRole('heading', { name: 'New shipment' })).toBeVisible();
    await expect(mobile.locator('#upload')).toBeHidden();

    const qrUrl = shipment.url.replace(/^https?:\/\/[^/]+/, base);
    await mobile.goto(qrUrl);
    await expect(mobile.locator('#upload')).toBeVisible();
    await expect(mobile.locator('#title')).toHaveText('Bti nm · 2026-10-16');
    await expect(mobile.locator('#shipment-setup')).toBeHidden();

    await mobile.close();
    server.stop();
    await rm(testRoot, { recursive: true, force: true });
    await rm(storage, { recursive: true, force: true });
  });
});
