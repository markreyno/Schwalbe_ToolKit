import { test, expect } from '@playwright/test';
import { ConnectPwaServer, CONNECT_PWA_PORT } from '../electron/connectPwaServer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, copyFile } from 'node:fs/promises';
import https from 'node:https';
import { createTestPhoneTlsManager } from './helpers/phoneTlsTest';

const screenshotDir = path.resolve('test-results', 'connect-pwa-install');
const artifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'connect-pwa-install');
const agent = new https.Agent({ rejectUnauthorized: false });

test.describe('Connect PWA /install page', () => {
  let server: ConnectPwaServer;
  let testRoot: string;
  const baseUrl = `https://127.0.0.1:${CONNECT_PWA_PORT}`;

  test.beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    testRoot = path.resolve('.cache/connect-pwa-install-test', randomUUID());
    await mkdir(screenshotDir, { recursive: true });
    await mkdir(artifactDir, { recursive: true });
    const tls = await createTestPhoneTlsManager(testRoot);
    server = new ConnectPwaServer(path.join(testRoot, 'settings.json'), tls, async () => []);
    await server.start();
    const status = await server.status();
    expect(status.qrUrl).toMatch(/\/install$/);
  });

  test.afterAll(async () => {
    server?.stop();
  });

  test('manifest includes scope, launch_handler, and related_applications', async () => {
    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`, { agent } as RequestInit).then(r => r.json());
    expect(manifest.id).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.launch_handler?.client_mode).toBe('navigate-existing');
    expect(manifest.handle_links).toBe('preferred');
    expect(manifest.related_applications?.[0]?.url).toContain('/manifest.webmanifest');
  });

  test('hub page has no install UI', async () => {
    const html = await fetch(`${baseUrl}/`, { agent } as RequestInit).then(r => r.text());
    expect(html).not.toContain('Add to Home Screen');
    expect(html).not.toContain('install-panel');
  });

  test('install page shows steps in mobile browser', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(`${baseUrl}/install`);
    await expect(page.getByRole('heading', { name: 'Install the toolkit hub' })).toBeVisible();
    await expect(page.locator('#install-panel')).toBeVisible();
    await expect(page.locator('#installed-panel')).toBeHidden();
    await page.screenshot({ path: path.join(screenshotDir, 'install-browser.png'), fullPage: true });
    await copyFile(path.join(screenshotDir, 'install-browser.png'), path.join(artifactDir, 'install-browser.png'));
    await page.close();
  });

  test('install page redirects to hub in standalone display mode', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
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
    await page.goto(`${baseUrl}/install`);
    await page.waitForURL('**/');
    expect(page.url()).toBe(`${baseUrl}/`);
    await expect(page.getByRole('heading', { name: 'Warehouse tools' })).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDir, 'install-standalone-redirect-hub.png'), fullPage: true });
    await copyFile(
      path.join(screenshotDir, 'install-standalone-redirect-hub.png'),
      path.join(artifactDir, 'install-standalone-redirect-hub.png'),
    );
    await page.close();
  });

  test('install page shows already-installed message when flag set', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await page.addInitScript(() => {
      localStorage.setItem('schwalbe-connect-pwa-installed', '1');
    });
    await page.goto(`${baseUrl}/install`);
    await expect(page.locator('#installed-panel')).toBeVisible();
    await expect(page.locator('#install-panel')).toBeHidden();
    await page.screenshot({ path: path.join(screenshotDir, 'install-already-installed.png'), fullPage: true });
    await copyFile(path.join(screenshotDir, 'install-already-installed.png'), path.join(artifactDir, 'install-already-installed.png'));
    await page.close();
  });
});
