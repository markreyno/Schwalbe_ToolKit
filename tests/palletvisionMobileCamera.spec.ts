import { test, expect } from '@playwright/test';
import { PalletVisionServer } from '../electron/palletvisionServer';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test.describe('PalletVision mobile camera fallback', () => {
  let server: PalletVisionServer;
  let testRoot: string;
  let baseUrl: string;

  test.beforeAll(async () => {
    testRoot = path.resolve('.cache/palletvision-mobile-camera', randomUUID());
    const settingsPath = path.join(testRoot, 'settings.json');
    await mkdir(testRoot, { recursive: true });
    server = new PalletVisionServer(settingsPath, path.join(testRoot, 'logs'));
    await server.start();
    await server.setRoot(testRoot);
    baseUrl = 'http://127.0.0.1:48732';
  });

  test.afterAll(async () => {
    server?.stop();
    await rm(testRoot, { recursive: true, force: true });
  });

  test('inBrowserCameraSupported is false without mediaDevices', async ({ page }) => {
    await page.goto(`${baseUrl}/`);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => undefined });
    });
    const supported = await page.evaluate(() => (window as unknown as { inBrowserCameraSupported: () => boolean }).inBrowserCameraSupported());
    expect(supported).toBe(false);
  });

  test('Start Recording shows fallback message instead of throwing', async ({ page }) => {
    await page.goto(`${baseUrl}/`);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => undefined });
    });
    await page.getByRole('button', { name: 'Record Video' }).click();
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.locator('#message')).toContainText(/camera app|HTTPS|Live preview/i);
    await expect(page.locator('#camera-capture-input')).toHaveAttribute('capture', 'environment');
  });
});
