import { test, expect } from '@playwright/test';
import { ConnectPwaServer, CONNECT_PWA_PORT } from '../electron/connectPwaServer';
import { PickerWaterBridge } from '../electron/pickerWaterBridge';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, copyFile } from 'node:fs/promises';
import https from 'node:https';
import { createTestPhoneTlsManager } from './helpers/phoneTlsTest';

const artifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'picker-water-hub');
const agent = new https.Agent({ rejectUnauthorized: false });
const baseUrl = `http://127.0.0.1:${CONNECT_PWA_PORT}`;

test.describe('Picker water hub notifications (installed PWA only)', () => {
  let server: ConnectPwaServer;
  let bridge: PickerWaterBridge;
  let testRoot: string;

  test.beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    testRoot = path.resolve('.cache/picker-water-hub-test', randomUUID());
    await mkdir(artifactDir, { recursive: true });
    const tls = await createTestPhoneTlsManager(testRoot);
    bridge = new PickerWaterBridge(path.join(testRoot, 'picker-water-hub.json'));
    await bridge.load();
    await bridge.sync([{
      id: 'p1',
      name: 'Dock Picker',
      intervalDays: 7,
      lastWatered: '2020-01-01'
    }]);
    server = new ConnectPwaServer(path.join(testRoot, 'connect-pwa.json'), tls, async () => [], bridge);
    await server.start();
  });

  test.afterAll(() => {
    server?.stop();
  });

  test('API returns due picker notifications', async () => {
    const data = await fetch(`${baseUrl}/api/picker-water/notifications`, { agent } as RequestInit).then(r => r.json());
    expect(data.count).toBeGreaterThan(0);
    expect(data.items[0].pickerName).toBe('Dock Picker');
  });

  test('browser tab hides picker notification UI', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await page.goto(baseUrl);
    await expect(page.getByRole('heading', { name: 'Warehouse tools' })).toBeVisible();
    const panel = page.locator('#picker-water-notifications');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Enable push alerts' })).toHaveCount(0);
    await page.screenshot({ path: path.join(artifactDir, 'hub-browser-no-notifications.png'), fullPage: true });
    await page.close();
  });

  test('installed PWA shows notification list and badge', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await page.addInitScript(() => {
      window.matchMedia = (query: string) => ({
        matches: query.includes('display-mode: standalone'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
    });
    await page.goto(baseUrl);
    const panel = page.locator('#picker-water-notifications');
    await expect(panel).toBeVisible();
    await expect(page.locator('#picker-water-badge')).toBeVisible();
    await expect(page.getByText('Watering overdue', { exact: false })).toBeVisible();
    await expect(page.getByText('Dock Picker', { exact: false })).toBeVisible();
    await page.screenshot({ path: path.join(artifactDir, 'hub-standalone-notifications.png'), fullPage: true });
    await page.close();
  });
});
