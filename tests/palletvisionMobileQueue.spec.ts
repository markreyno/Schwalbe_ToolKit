import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function openPalletVisionMobile(browser: import('@playwright/test').Browser) {
  const profile = path.resolve('.cache/palletvision-queue-tests', randomUUID());
  const storage = path.join(profile, 'data');
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

  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, storagePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storagePath] })) as any;
  }, storage);

  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).click();

  const state = await page.evaluate(() => window.toolkit.palletvision('status'));
  const local = (url: string) => url.replace(/^https?:\/\/[^/]+/, 'https://127.0.0.1:48732');
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });

  return { app, page, mobile, storage, local, qrUrl: local(state.qrUrl) };
}

async function seedQueuedCaptures(mobile: import('@playwright/test').Page, videoBuffer: Buffer, ids: string[]) {
  await mobile.evaluate(async ({ ids, videoBytes }) => {
    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('PalletVision', 1);
      req.onupgradeneeded = (e) => {
        const database = (e.target as IDBOpenDBRequest).result;
        if (!database.objectStoreNames.contains('captures')) {
          database.createObjectStore('captures', { keyPath: 'captureId' });
        }
        if (!database.objectStoreNames.contains('queue')) {
          database.createObjectStore('queue', { keyPath: 'captureId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const db = await openDb();
    const blob = new Blob([new Uint8Array(videoBytes)], { type: 'video/webm' });
    for (let i = 0; i < ids.length; i++) {
      const capture = {
        captureId: ids[i],
        capturedAt: new Date(Date.now() - i * 1000).toISOString(),
        heightInches: 70 + i,
        widthInches: 40,
        lengthInches: 48,
        notes: 'queue test',
        videoBlob: blob,
        status: 'queued'
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['captures', 'queue'], 'readwrite');
        tx.objectStore('captures').put(capture);
        tx.objectStore('queue').put(capture);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }, { ids, videoBytes: Array.from(videoBuffer) });
}

async function queueCount(mobile: import('@playwright/test').Page) {
  return mobile.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('PalletVision', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('queue', 'readonly');
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    return all.length;
  });
}

test('palletvision mobile upload queue is single-flight with three queued captures', async ({ browser }) => {
  const testVideoPath = path.join(__dirname, 'fixtures', 'test-pallet.webm');
  const videoBuffer = await readFile(testVideoPath);
  const captureIds = ['cap_queue_a', 'cap_queue_b', 'cap_queue_c'];

  const { app, page, mobile, qrUrl } = await openPalletVisionMobile(browser);

  let inFlight = 0;
  let maxInFlight = 0;
  await mobile.route('**/api/pallets/upload', async (route) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 600));
    inFlight -= 1;
    await route.continue();
  });

  const pairReq = mobile.waitForResponse((r) => r.url().includes('/api/pair'));
  await mobile.goto(qrUrl);
  await pairReq;

  await seedQueuedCaptures(mobile, videoBuffer, captureIds);
  expect(await queueCount(mobile)).toBe(3);

  await mobile.reload();

  await expect.poll(() => maxInFlight, { timeout: 25000 }).toBe(1);

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.toolkit.palletvision('status'));
    return state.pallets.length;
  }, {
    timeout: 45000
  }).toBe(3);

  expect(maxInFlight).toBe(1);

  await mobile.close();
  await app.close();
});

test('palletvision mobile delete removes queued and uploading captures', async ({ browser }) => {
  const testVideoPath = path.join(__dirname, 'fixtures', 'test-pallet.webm');
  const videoBuffer = await readFile(testVideoPath);

  const { app, mobile, qrUrl } = await openPalletVisionMobile(browser);

  mobile.on('dialog', (dialog) => dialog.accept());

  await mobile.route('**/api/pallets/upload', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.continue();
  });

  const pairReq = mobile.waitForResponse((r) => r.url().includes('/api/pair'));
  await mobile.goto(qrUrl);
  await pairReq;

  await seedQueuedCaptures(mobile, videoBuffer, ['cap_del_q1', 'cap_del_q2', 'cap_del_q3']);
  expect(await queueCount(mobile)).toBe(3);
  await mobile.reload();
  const queuedDelete = mobile.locator('#queue .item').filter({ hasText: 'QUEUED' }).first().getByRole('button', { name: 'Delete' });
  await expect(queuedDelete).toBeVisible({ timeout: 15000 });
  const countBeforeDelete = await queueCount(mobile);
  await queuedDelete.click();
  await expect.poll(() => queueCount(mobile), { timeout: 10000 }).toBe(countBeforeDelete - 1);

  const uploadingRow = mobile.locator('#queue .item').filter({ hasText: 'UPLOADING' });
  await expect(uploadingRow).toBeVisible({ timeout: 15000 });
  const countBeforeUploadingDelete = await queueCount(mobile);
  await uploadingRow.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => queueCount(mobile), { timeout: 15000 }).toBe(countBeforeUploadingDelete - 1);

  await expect.poll(async () => {
    const health = await mobile.evaluate(async () => {
      const token = localStorage.getItem('palletvision-device-token');
      const r = await fetch('/api/health', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      return r.json();
    });
    return health.uploadBusy === false;
  }, { timeout: 20000 }).toBe(true);

  await expect.poll(() => queueCount(mobile), { timeout: 60000 }).toBe(0);

  await mobile.close();
  await app.close();
});
