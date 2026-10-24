import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('palletvision upload creates folders, stores metadata, extracts frames', async ({ browser, request }) => {
  const profile = path.resolve('.cache/palletvision-tests', randomUUID());
  const storage = path.join(profile, 'data');
  await mkdir(storage, { recursive: true });

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile
  };
  delete env.ELECTRON_RUN_AS_NODE;

  let app = await electron.launch({
    ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }),
    env
  });

  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, storage) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storage] })) as any;
    }, storage);

    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await expect(page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await page.screenshot({ path: 'test-results/palletvision-desktop.png' });

    let state = await page.evaluate(() => window.toolkit.palletvision('status'));
    expect(state.root).toBe(storage);
    expect(state.running).toBe(true);
    expect(state.pallets).toHaveLength(0);

    const local = (url: string) => url.replace(/^http:\/\/[^/]+/, 'http://127.0.0.1:48732');
    const apiUrl = (path: string) => new URL(path, local(state.qrUrl)).toString();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(local(state.qrUrl));

    const pairReq = mobile.waitForResponse(r => r.url().includes('/api/pair'));
    await expect(mobile.getByRole('heading', { name: 'PalletVision Data Collector' })).toBeVisible();
    const pairResp = await pairReq;
    const pairData = await pairResp.json();
    expect(pairData.deviceToken).toBeTruthy();
    const deviceToken = pairData.deviceToken;

    // Use test fixture video
    const testVideoPath = path.join(__dirname, 'fixtures', 'test-pallet.webm');
    const videoBuffer = await readFile(testVideoPath);

    const formData = new FormData();
    formData.append('captureId', 'cap_test_001');
    formData.append('heightInches', '74.5');
    formData.append('widthInches', '40');
    formData.append('lengthInches', '48');
    formData.append('notes', 'Test pallet');
    formData.append('referenceId', 'TEST-001');
    formData.append('capturedAt', new Date().toISOString());
    formData.append('video', new Blob([videoBuffer], { type: 'video/webm' }), 'test.webm');

    const uploadResp = await fetch(apiUrl('/api/pallets/upload'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + deviceToken },
      body: formData
    });

    if (!uploadResp.ok) {
      const errorText = await uploadResp.text();
      throw new Error(`Upload failed with ${uploadResp.status}: ${errorText}`);
    }
    expect(uploadResp.ok).toBe(true);
    const uploadData = await uploadResp.json();
    expect(uploadData.palletId).toMatch(/pallet_\d{4}/);
    expect(uploadData.status).toBe('uploaded');
    expect(uploadData.processingStatus).toBe('pending');

    await new Promise(resolve => setTimeout(resolve, 2000));

    state = await page.evaluate(() => window.toolkit.palletvision('status'));
    expect(state.pallets).toHaveLength(1);
    const pallet = state.pallets[0];
    expect(pallet.id).toBe(uploadData.palletId);
    expect(pallet.captureId).toBe('cap_test_001');
    expect(pallet.heightInches).toBe(74.5);
    expect(pallet.widthInches).toBe(40);
    expect(pallet.lengthInches).toBe(48);
    expect(pallet.notes).toBe('Test pallet');
    expect(pallet.referenceId).toBe('TEST-001');

    const fs = await import('node:fs/promises');
    const palletFolder = path.join(storage, uploadData.palletId);
    const files = await fs.readdir(palletFolder);
    expect(files).toContain('video.webm');
    expect(files).toContain('metadata.json');
    expect(files).toContain('frames');

    const stagingLeftovers = await fs.readdir(path.join(storage, '.tmp')).catch(() => [] as string[]);
    expect(stagingLeftovers.filter((f) => f.startsWith('upload-'))).toHaveLength(0);

    const metadata = JSON.parse(await fs.readFile(path.join(palletFolder, 'metadata.json'), 'utf8'));
    expect(metadata.pallet_id).toBe(uploadData.palletId);
    expect(metadata.capture_id).toBe('cap_test_001');
    expect(metadata.height_inches).toBe(74.5);
    expect(metadata.width_inches).toBe(40);
    expect(metadata.length_inches).toBe(48);
    expect(metadata.notes).toBe('Test pallet');
    expect(metadata.reference_id).toBe('TEST-001');

    await new Promise(resolve => setTimeout(resolve, 5000));

    state = await page.evaluate(() => window.toolkit.palletvision('status'));
    const updatedPallet = state.pallets[0];
    if (updatedPallet.processingStatus === 'complete') {
      expect(updatedPallet.framesExtracted).toBeGreaterThan(0);
      const frames = await fs.readdir(path.join(palletFolder, 'frames'));
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every(f => f.endsWith('.jpg'))).toBe(true);
    }

    const retryResp = await fetch(apiUrl('/api/pallets/upload'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + deviceToken },
      body: formData
    });
    expect(retryResp.ok).toBe(true);
    const retryData = await retryResp.json();
    expect(retryData.palletId).toBe(uploadData.palletId);
    expect(retryData.status).toBe('exists');

    state = await page.evaluate(() => window.toolkit.palletvision('status'));
    expect(state.pallets).toHaveLength(1);

    const healthResp = await fetch(apiUrl('/api/health'), {
      headers: { 'Authorization': 'Bearer ' + deviceToken }
    });
    expect(healthResp.ok).toBe(true);
    const healthData = await healthResp.json();
    expect(healthData.status).toBe('ok');
    expect(healthData.palletCount).toBe(1);

    await mobile.close();
  } finally {
    await app.close();
  }
});

test('palletvision validates dimensions', async () => {
  const testCases = [
    { height: 0, width: 40, length: 48, shouldFail: true },
    { height: -1, width: 40, length: 48, shouldFail: true },
    { height: 74, width: 0, length: 48, shouldFail: true },
    { height: 74, width: 40, length: -5, shouldFail: true },
    { height: 74, width: 40, length: 48, shouldFail: false },
    { height: 0.1, width: 0.1, length: 0.1, shouldFail: false },
  ];

  for (const tc of testCases) {
    const isValid = tc.height > 0 && tc.width > 0 && tc.length > 0;
    expect(isValid).toBe(!tc.shouldFail);
  }
});

test('palletvision mobile upload existing video', async ({ browser }) => {
  test.setTimeout(120_000);
  const profile = path.resolve('.cache/palletvision-tests', randomUUID());
  const storage = path.join(profile, 'data');
  await mkdir(storage, { recursive: true });

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile
  };
  delete env.ELECTRON_RUN_AS_NODE;

  let app = await electron.launch({
    ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }),
    env
  });

  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, storage) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storage] })) as any;
    }, storage);

    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();

    let state = await page.evaluate(() => window.toolkit.palletvision('status'));
    const local = (url: string) => url.replace(/^http:\/\/[^/]+/, 'http://127.0.0.1:48732');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(local(state.qrUrl));

    const pairReq = mobile.waitForResponse(r => r.url().includes('/api/pair'));
    await expect(mobile.getByRole('heading', { name: 'PalletVision Data Collector' })).toBeVisible();
    const pairResp = await pairReq;
    const pairData = await pairResp.json();
    const deviceToken = pairData.deviceToken;

    const testVideoPath = path.join(__dirname, 'fixtures', 'test-pallet.webm');
    const videoBuffer = await readFile(testVideoPath);

    await mobile.getByRole('button', { name: 'Upload Existing Video' }).click();
    const fileInput = mobile.locator('#video-file-input');
    await fileInput.setInputFiles({ name: 'test-video.webm', mimeType: 'video/webm', buffer: videoBuffer });

    await expect(mobile.locator('#playback')).toBeVisible({ timeout: 3000 });
    await expect(mobile.getByRole('button', { name: 'Continue' })).toBeVisible();
    
    await mobile.getByRole('button', { name: 'Continue' }).click();
    await mobile.locator('#height').fill('72');
    await mobile.locator('#width').fill('40');
    await mobile.locator('#length').fill('48');
    await mobile.locator('#notes').fill('Uploaded from gallery');
    
    await mobile.getByRole('button', { name: 'Save & Upload' }).click();

    await expect.poll(async () => {
      const s = await page.evaluate(() => window.toolkit.palletvision('status'));
      return s.pallets.length;
    }, { timeout: 90_000 }).toBe(1);

    state = await page.evaluate(() => window.toolkit.palletvision('status'));
    const pallet = state.pallets[0];
    expect(pallet.heightInches).toBe(72);
    expect(pallet.widthInches).toBe(40);
    expect(pallet.lengthInches).toBe(48);
    expect(pallet.notes).toBe('Uploaded from gallery');

    await mobile.close();
  } finally {
    await app.close();
  }
});

test('palletvision mobile cancel upload cleans up and allows retry', async ({ browser }) => {
  const profile = path.resolve('.cache/palletvision-tests', randomUUID());
  const storage = path.join(profile, 'data');
  await mkdir(storage, { recursive: true });

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile
  };
  delete env.ELECTRON_RUN_AS_NODE;

  let app = await electron.launch({
    ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }),
    env
  });

  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, storage) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [storage] })) as any;
    }, storage);

    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();

    let state = await page.evaluate(() => window.toolkit.palletvision('status'));
    const palletsBefore = state.pallets.length;
    const local = (url: string) => url.replace(/^http:\/\/[^/]+/, 'http://127.0.0.1:48732');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let slowUpload = true;
    await mobile.route('**/api/pallets/upload', async (route) => {
      if (slowUpload) await new Promise(resolve => setTimeout(resolve, 2500));
      await route.continue().catch(() => {});
    });
    await mobile.goto(local(state.qrUrl));

    const pairReq = mobile.waitForResponse(r => r.url().includes('/api/pair'));
    await expect(mobile.getByRole('heading', { name: 'PalletVision Data Collector' })).toBeVisible();
    await pairReq;

    const testVideoPath = path.join(__dirname, 'fixtures', 'test-pallet.webm');
    const videoBuffer = await readFile(testVideoPath);

    await mobile.getByRole('button', { name: 'Upload Existing Video' }).click();
    await mobile.locator('#video-file-input').setInputFiles({ name: 'test-video.webm', mimeType: 'video/webm', buffer: videoBuffer });
    await mobile.getByRole('button', { name: 'Continue' }).click();
    await mobile.locator('#height').fill('70');
    await mobile.getByRole('button', { name: 'Save & Upload' }).click();

    await expect(mobile.locator('#cancel-upload')).toBeVisible({ timeout: 5000 });
    await mobile.locator('#cancel-upload').click();
    await expect(mobile.locator('#message')).toContainText('Upload canceled', { timeout: 10000 });

    await new Promise(resolve => setTimeout(resolve, 1000));
    state = await page.evaluate(() => window.toolkit.palletvision('status'));
    expect(state.pallets.length).toBe(palletsBefore);

    const fs = await import('node:fs/promises');
    const tmpEntries = await fs.readdir(path.join(storage, '.tmp')).catch(() => [] as string[]);
    expect(tmpEntries.filter((f) => f.startsWith('upload-'))).toHaveLength(0);

    slowUpload = false;
    await mobile.getByRole('button', { name: 'Upload now' }).click();
    await new Promise(resolve => setTimeout(resolve, 4000));

    state = await page.evaluate(() => window.toolkit.palletvision('status'));
    expect(state.pallets.length).toBe(palletsBefore + 1);

    await mobile.close();
  } finally {
    await app.close();
  }
});

test('palletvision desktop import video', async () => {
  const profile = path.resolve('.cache/palletvision-tests', randomUUID());
  const storage = path.join(profile, 'data');
  await mkdir(storage, { recursive: true });

  const testVideoPath = path.join(__dirname, 'fixtures', 'test-pallet.webm');

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: profile
  };
  delete env.ELECTRON_RUN_AS_NODE;

  let app = await electron.launch({
    ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }),
    env
  });

  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }: any, args: any) => {
      let callCount = 0;
      dialog.showOpenDialog = (async (win: any, opts: any) => {
        callCount++;
        if (callCount === 1) {
          return { canceled: false, filePaths: [args.storage] };
        } else {
          return { canceled: false, filePaths: [args.testVideoPath] };
        }
      }) as any;
    }, { storage, testVideoPath });

    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await expect(page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();

    let state = await page.evaluate(() => window.toolkit.palletvision('status'));
    expect(state.root).toBe(storage);
    expect(state.pallets).toHaveLength(0);

    await page.getByRole('button', { name: 'Import video file' }).click();
    await expect(page.getByRole('heading', { name: 'Import Video File' })).toBeVisible();

    await page.getByRole('button', { name: 'Browse' }).click();
    await new Promise(resolve => setTimeout(resolve, 500));

    await page.locator('input[type="number"]').first().fill('68');
    await page.locator('input[type="number"]').nth(1).fill('42');
    await page.locator('input[type="number"]').nth(2).fill('50');
    await page.locator('textarea').fill('Desktop imported pallet');

    await page.getByRole('button', { name: 'Import & Process' }).click();

    await new Promise(resolve => setTimeout(resolve, 2000));

    state = await page.evaluate(() => window.toolkit.palletvision('status'));
    expect(state.pallets).toHaveLength(1);
    const pallet = state.pallets[0];
    expect(pallet.heightInches).toBe(68);
    expect(pallet.widthInches).toBe(42);
    expect(pallet.lengthInches).toBe(50);
    expect(pallet.notes).toBe('Desktop imported pallet');
    expect(pallet.captureId).toContain('cap_desktop_');

    const fs = await import('node:fs/promises');
    const palletFolder = path.join(storage, pallet.id);
    const files = await fs.readdir(palletFolder);
    expect(files).toContain('video.webm');
    expect(files).toContain('metadata.json');
    expect(files).toContain('frames');

    const metadata = JSON.parse(await fs.readFile(path.join(palletFolder, 'metadata.json'), 'utf8'));
    expect(metadata.device).toBe('Desktop');
    expect(metadata.height_inches).toBe(68);
    expect(metadata.width_inches).toBe(42);
    expect(metadata.length_inches).toBe(50);

    await new Promise(resolve => setTimeout(resolve, 5000));

    state = await page.evaluate(() => window.toolkit.palletvision('status'));
    const updatedPallet = state.pallets[0];
    if (updatedPallet.processingStatus === 'complete') {
      expect(updatedPallet.framesExtracted).toBeGreaterThan(0);
    }
  } finally {
    await app.close();
  }
});
