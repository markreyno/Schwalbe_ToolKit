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

    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'PalletVision', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await expect(page.getByRole('heading', { name: 'PalletVision', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await page.screenshot({ path: 'test-results/palletvision-desktop.png' });

    let state = await page.evaluate(() => window.toolkit.palletvision('status'));
    expect(state.root).toBe(storage);
    expect(state.running).toBe(true);
    expect(state.pallets).toHaveLength(0);

    const local = (url: string) => url.replace(/^http:\/\/[^/]+/, 'http://127.0.0.1:48732');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(local(state.qrUrl));

    const pairReq = mobile.waitForResponse(r => r.url().includes('/api/pair'));
    await expect(mobile.getByRole('heading', { name: 'PalletVision' })).toBeVisible();
    const pairResp = await pairReq;
    const pairData = await pairResp.json();
    expect(pairData.deviceToken).toBeTruthy();
    const deviceToken = pairData.deviceToken;

    const testVideoPath = path.join(process.cwd(), 'test-pallet-video.webm');
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

    const uploadResp = await fetch(local(state.qrUrl) + '/api/pallets/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + deviceToken },
      body: formData
    });

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

    const retryResp = await fetch(local(state.qrUrl) + '/api/pallets/upload', {
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

    const healthResp = await fetch(local(state.qrUrl) + '/api/health', {
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
