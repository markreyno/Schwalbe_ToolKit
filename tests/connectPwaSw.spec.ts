import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConnectPwaServer, CONNECT_PWA_PORT } from '../electron/connectPwaServer';
import { connectPwaCacheName } from '../electron/connectPwa/pwaCache';
import { createTestPhoneTlsManager } from './helpers/phoneTlsTest';
import { hubBaseUrl, hubFetch } from './helpers/hubHttps';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string };

test.describe('Connect PWA service worker', () => {
  test.use({ ignoreHTTPSErrors: true });
  let server: ConnectPwaServer;
  let testRoot: string;
  const baseUrl = hubBaseUrl(CONNECT_PWA_PORT);
  test.beforeAll(async () => {
    testRoot = path.resolve('.cache/connect-pwa-sw-test', randomUUID());
    const tls = await createTestPhoneTlsManager(testRoot);
    server = new ConnectPwaServer(path.join(testRoot, 'settings.json'), tls, async () => []);
    await server.start();
  });

  test.afterAll(async () => {
    server?.stop();
    await rm(testRoot, { recursive: true, force: true });
  });

  test('served sw.js versions cache name with package.json', async () => {
    const sw = await hubFetch(`${baseUrl}/sw.js`).then(r => r.text());
    expect(sw).toContain(`CACHE_VERSION = '${pkg.version}'`);
    expect(sw).toContain(`schwalbe-toolkit-connect-\${CACHE_VERSION}`);
    expect(sw).not.toContain('schwalbe-toolkit-connect-v1');
    expect(connectPwaCacheName(pkg.version)).toBe(`schwalbe-toolkit-connect-${pkg.version}`);
    expect(sw).toContain('networkFirstHtml');
    expect(sw).not.toMatch(/caches\.match\([^)]+\)\.then\(cached => cached \|\| fetch/);
  });

  test('hub HTML uses network-first path and has no install section', async () => {
    const html = await hubFetch(`${baseUrl}/`).then(r => r.text());
    expect(html).not.toContain('Add to Home Screen');
    expect(html).not.toContain('install-banner');
    expect(html).toContain('/pwaInstallUi.js');
  });

  test('standalone display mode strips legacy install UI', async ({ page }) => {
    await page.addInitScript(() => {
      const standalone = '(display-mode: standalone)';
      window.matchMedia = (query: string) => ({
        matches: query === standalone,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false
      }) as MediaQueryList;
    });
    await page.goto(baseUrl);
    await page.waitForFunction(() => (window as any).connectPwaInstall);
    await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.id = 'install-banner';
      banner.textContent = 'Install app';
      document.body.appendChild(banner);
      const panel = document.createElement('section');
      panel.className = 'panel';
      panel.innerHTML = '<h2 id="install-heading">Add to Home Screen</h2><p>Steps</p>';
      document.body.appendChild(panel);
      (window as any).connectPwaInstall.bindInstallUiVisibility();
    });
    await expect(page.locator('#install-banner')).toHaveCount(0);
    await expect(page.getByText('Add to Home Screen')).toHaveCount(0);
    await expect(page.locator('html')).toHaveClass(/pwa-installed/);
  });
});
