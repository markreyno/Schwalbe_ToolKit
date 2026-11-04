import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test.use({ channel: 'msedge' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=',
  'base64',
);

async function launchFreightApp(storage: string) {
  const profile = path.dirname(storage);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile,
    FREIGHT_BATCH_TTL_MS: '60000',
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
  return { app, page };
}

test('on load with running background fetch for current batch it is not aborted and progress shows', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-bg-fetch-reattach', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Reattach Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Reattach Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    
    let bgFetchAborted = false;
    await mobile.addInitScript(() => {
      const mockBgFetch = {
        id: 'freight-mock-batch-0',
        downloadTotal: 2000,
        uploaded: 500,
        addEventListener: (event: string, handler: Function) => {
          if (event === 'backgroundfetchprogress') {
            setTimeout(() => handler(), 100);
          }
        },
        removeEventListener: () => {},
        abort: async () => {
          (window as any).bgFetchAbortCalled = true;
        }
      };
      
      const origNavigator = window.navigator;
      Object.defineProperty(window, 'navigator', {
        get: () => new Proxy(origNavigator, {
          get: (target, prop) => {
            if (prop === 'serviceWorker' && window.isSecureContext) {
              const origSw = (target as any).serviceWorker;
              return {
                controller: {},
                ready: Promise.resolve({
                  backgroundFetch: {
                    getIds: async () => ['freight-mock-batch-0'],
                    get: async (id: string) => id === 'freight-mock-batch-0' ? mockBgFetch : null,
                  },
                  active: { postMessage: () => {} },
                }),
                register: origSw?.register?.bind(origSw) || (() => Promise.resolve({})),
                addEventListener: origSw?.addEventListener?.bind(origSw) || (() => {}),
              };
            }
            return (target as any)[prop];
          }
        })
      });
    });

    await mobile.goto(localUrl);
    
    await mobile.waitForFunction(() => {
      const uploadSession = document.getElementById('upload-session');
      const uploadStatus = document.getElementById('upload-status');
      return uploadSession && !uploadSession.hidden && uploadStatus && uploadStatus.textContent;
    }, { timeout: 10000 });
    
    bgFetchAborted = await mobile.evaluate(() => (window as any).bgFetchAbortCalled === true);
    expect(bgFetchAborted).toBe(false);
    
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('visibilitychange hidden does not abort page upload when no background fetch active', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-visibility-no-abort', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Visibility Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Visibility Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    
    let uploadRequestSeen = false;
    let uploadAbortedByVisibility = false;
    await mobile.route(/\/file\?/, async route => {
      uploadRequestSeen = true;
      await new Promise(resolve => setTimeout(resolve, 200));
      if (uploadAbortedByVisibility) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    
    await mobile.waitForFunction(() => uploadRequestSeen, { timeout: 5000 });
    
    await mobile.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { 
        get: () => 'hidden', 
        configurable: true 
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    
    await mobile.waitForTimeout(500);
    
    await expect(mobile.locator('#upload-status')).toContainText(/Done|Uploading|Verifying/, { timeout: 15000 });
    
    const files = await readdir(shipment.folder);
    expect(files.length).toBe(1);
    
    await mobile.unroute(/\/file\?/);
    await mobile.close();
  } finally {
    await app.close();
  }
});

test('cancel upload aborts the background fetch', async ({ browser }) => {
  const profile = path.resolve('.cache/freight-cancel-bg-fetch', randomUUID());
  const storage = path.join(profile, 'pictures');
  await mkdir(storage, { recursive: true });
  const { app, page } = await launchFreightApp(storage);
  try {
    await page.getByLabel('Company', { exact: true }).fill('Cancel BG Co');
    await page.getByLabel('Date shipped').fill('2026-11-04');
    await page.getByRole('button', { name: 'Create shipment & QR code' }).click();

    const state = await page.evaluate(() => window.toolkit.freight('status'));
    const shipment = state.shipments.find(s => s.company === 'Cancel BG Co')!;
    const localUrl = shipment.url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48731');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    
    await mobile.addInitScript(() => {
      const mockBgFetch = {
        id: 'freight-cancel-test',
        downloadTotal: 2000,
        uploaded: 500,
        addEventListener: () => {},
        removeEventListener: () => {},
        abort: async () => {
          (window as any).bgFetchAbortCalled = true;
        }
      };
      
      const origNavigator = window.navigator;
      Object.defineProperty(window, 'navigator', {
        get: () => new Proxy(origNavigator, {
          get: (target, prop) => {
            if (prop === 'serviceWorker' && window.isSecureContext) {
              const origSw = (target as any).serviceWorker;
              return {
                controller: {},
                ready: Promise.resolve({
                  backgroundFetch: {
                    getIds: async () => (window as any).bgFetchAbortCalled ? [] : ['freight-cancel-test'],
                    get: async (id: string) => {
                      if ((window as any).bgFetchAbortCalled) return null;
                      return id === 'freight-cancel-test' ? mockBgFetch : null;
                    },
                  },
                  active: { postMessage: () => {} },
                }),
                register: origSw?.register?.bind(origSw) || (() => Promise.resolve({})),
                addEventListener: origSw?.addEventListener?.bind(origSw) || (() => {}),
              };
            }
            return (target as any)[prop];
          }
        })
      });
    });
    
    await mobile.route(/\/finish/, async route => {
      await new Promise(resolve => setTimeout(resolve, 10000));
      await route.continue();
    });

    await mobile.goto(localUrl);
    await mobile.locator('#files').setInputFiles([
      { name: 'pallet-a.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await mobile.getByLabel('Pallet amount', { exact: true }).fill('1');
    await mobile.locator('#confirm').check();
    await mobile.getByRole('button', { name: 'Upload All', exact: true }).click();
    
    await mobile.waitForTimeout(500);
    await mobile.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    
    await mobile.unroute(/\/finish/);
    await expect(mobile.locator('#message')).toContainText('Upload canceled', { timeout: 5000 });
    
    const bgFetchAborted = await mobile.evaluate(() => (window as any).bgFetchAbortCalled === true);
    expect(bgFetchAborted).toBe(true);
    
    await mobile.close();
  } finally {
    await app.close();
  }
});
