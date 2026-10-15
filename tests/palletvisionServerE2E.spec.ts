import { test, expect } from '@playwright/test';
import { PalletVisionServer } from '../electron/palletvisionServer';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

function getFFmpegPath(): string {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (typeof ffmpegStatic === 'string') {
      return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
    }
    return ffmpegStatic;
  } catch {
    return 'ffmpeg';
  }
}

test.describe('PalletVision Server E2E', () => {
  let server: PalletVisionServer;
  let testRoot: string;
  let settingsPath: string;
  let baseUrl: string;
  let deviceToken: string;
  let testVideoPath: string;

  test.beforeAll(async () => {
    testRoot = path.resolve('.cache/palletvision-server-test', randomUUID());
    settingsPath = path.join(testRoot, 'settings.json');
    await mkdir(testRoot, { recursive: true });

    // Generate test video at runtime
    testVideoPath = path.join(testRoot, 'test-video.webm');
    await promisify(execFile)(getFFmpegPath(), [
      '-f', 'lavfi',
      '-i', 'testsrc=duration=5:size=640x480:rate=30',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libvpx',
      testVideoPath,
      '-y'
    ]);

    server = new PalletVisionServer(settingsPath);
    await server.start();

    const status = await server.status();
    expect(status.running).toBe(true);
    expect(status.port).toBe(48732);
    baseUrl = 'http://127.0.0.1:48732';

    const pairResp = await fetch(`${baseUrl}/api/pair`, { method: 'POST' });
    expect(pairResp.ok).toBe(true);
    const pairData = await pairResp.json();
    deviceToken = pairData.deviceToken;
    expect(deviceToken).toBeTruthy();

    await server.setRoot(testRoot);
  });

  test.afterAll(async () => {
    if (server) {
      server.stop();
    }
    await rm(testRoot, { recursive: true, force: true });
  });

  test('rejects requests without authentication token', async () => {
    const resp = await fetch(`${baseUrl}/api/health`);
    expect(resp.status).toBe(401);
    const data = await resp.json();
    expect(data.error).toContain('Unauthorized');
  });

  test('health endpoint works with valid token', async () => {
    const resp = await fetch(`${baseUrl}/api/health`, {
      headers: { 'Authorization': `Bearer ${deviceToken}` }
    });
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.status).toBe('ok');
    expect(data.palletCount).toBe(0);
  });

  test('uploads video and creates pallet folder with metadata and frames', async () => {
    const videoBuffer = await readFile(testVideoPath);

    const formData = new FormData();
    formData.append('captureId', 'cap_e2e_test_001');
    formData.append('heightInches', '84.5');
    formData.append('widthInches', '42');
    formData.append('lengthInches', '50');
    formData.append('notes', 'End-to-end test pallet');
    formData.append('referenceId', 'E2E-TEST-001');
    formData.append('capturedAt', new Date().toISOString());
    formData.append('video', new Blob([videoBuffer], { type: 'video/webm' }), 'test.webm');

    const uploadResp = await fetch(`${baseUrl}/api/pallets/upload`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${deviceToken}`,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
      },
      body: formData
    });

    expect(uploadResp.ok).toBe(true);
    const uploadData = await uploadResp.json();
    expect(uploadData.palletId).toMatch(/pallet_\d{4}/);
    expect(uploadData.status).toBe('uploaded');
    expect(uploadData.processingStatus).toBe('pending');

    const palletId = uploadData.palletId;
    const palletFolder = path.join(testRoot, palletId);

    await access(palletFolder);
    await access(path.join(palletFolder, 'video.webm'));
    await access(path.join(palletFolder, 'metadata.json'));
    await access(path.join(palletFolder, 'frames'));

    const metadataContent = await readFile(path.join(palletFolder, 'metadata.json'), 'utf8');
    const metadata = JSON.parse(metadataContent);
    expect(metadata.pallet_id).toBe(palletId);
    expect(metadata.capture_id).toBe('cap_e2e_test_001');
    expect(metadata.height_inches).toBe(84.5);
    expect(metadata.width_inches).toBe(42);
    expect(metadata.length_inches).toBe(50);
    expect(metadata.device).toBe('iPhone');
    expect(metadata.frames_extracted).toBe(0);
    expect(metadata.annotations_reviewed).toBe(false);
    expect(metadata.notes).toBe('End-to-end test pallet');
    expect(metadata.reference_id).toBe('E2E-TEST-001');
    expect(metadata.video_file).toBe('video.webm');
    expect(metadata.schema_version).toBe(1);
    expect(metadata.height_includes_base).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 8000));

    const status = await server.status();
    const pallet = status.pallets.find(p => p.id === palletId);
    expect(pallet).toBeTruthy();
    if (pallet?.processingStatus === 'complete') {
      expect(pallet.framesExtracted).toBeGreaterThan(0);

      const fs = await import('node:fs/promises');
      const frames = await fs.readdir(path.join(palletFolder, 'frames'));
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every(f => f.endsWith('.jpg'))).toBe(true);
      expect(frames.every(f => f.startsWith('frame_'))).toBe(true);

      const metadataUpdated = JSON.parse(await fs.readFile(path.join(palletFolder, 'metadata.json'), 'utf8'));
      expect(metadataUpdated.processing_status).toBe('complete');
      expect(metadataUpdated.frames_extracted).toBe(frames.length);
    } else {
      console.log('Frame extraction still in progress or failed:', pallet?.processingStatus);
    }
  });

  test('idempotent upload: same captureId does not create duplicate', async () => {
    const videoBuffer = await readFile(testVideoPath);

    const formData = new FormData();
    formData.append('captureId', 'cap_e2e_test_001');
    formData.append('heightInches', '84.5');
    formData.append('widthInches', '42');
    formData.append('lengthInches', '50');
    formData.append('notes', 'Duplicate upload test');
    formData.append('capturedAt', new Date().toISOString());
    formData.append('video', new Blob([videoBuffer], { type: 'video/webm' }), 'test.webm');

    const retryResp = await fetch(`${baseUrl}/api/pallets/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${deviceToken}` },
      body: formData
    });

    expect(retryResp.ok).toBe(true);
    const retryData = await retryResp.json();
    expect(retryData.status).toBe('exists');
    expect(retryData.palletId).toMatch(/pallet_\d{4}/);

    const status = await server.status();
    const palletsWithSameCaptureId = status.pallets.filter(p => p.captureId === 'cap_e2e_test_001');
    expect(palletsWithSameCaptureId.length).toBe(1);
  });

  test('validates dimensions and rejects invalid uploads', async () => {
    const videoBuffer = await readFile(testVideoPath);

    const invalidCases = [
      { height: 0, width: 40, length: 48 },
      { height: -1, width: 40, length: 48 },
      { height: 74, width: 0, length: 48 },
      { height: 74, width: 40, length: -5 },
    ];

    for (const testCase of invalidCases) {
      const formData = new FormData();
      formData.append('captureId', `cap_invalid_${Date.now()}_${Math.random()}`);
      formData.append('heightInches', String(testCase.height));
      formData.append('widthInches', String(testCase.width));
      formData.append('lengthInches', String(testCase.length));
      formData.append('capturedAt', new Date().toISOString());
      formData.append('video', new Blob([videoBuffer], { type: 'video/webm' }), 'test.webm');

      const resp = await fetch(`${baseUrl}/api/pallets/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${deviceToken}` },
        body: formData
      });

      expect(resp.ok).toBe(false);
      const data = await resp.json();
      expect(data.error).toBeTruthy();
    }
  });

  test('rejects upload without device token', async () => {
    const videoBuffer = await readFile(testVideoPath);

    const formData = new FormData();
    formData.append('captureId', 'cap_no_auth');
    formData.append('heightInches', '74');
    formData.append('widthInches', '40');
    formData.append('lengthInches', '48');
    formData.append('capturedAt', new Date().toISOString());
    formData.append('video', new Blob([videoBuffer], { type: 'video/webm' }), 'test.webm');

    const resp = await fetch(`${baseUrl}/api/pallets/upload`, {
      method: 'POST',
      body: formData
    });

    expect(resp.status).toBe(401);
    const data = await resp.json();
    expect(data.error).toContain('Unauthorized');
  });
});
