import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { FREIGHT_PHONE_PORT } from '../electron/toolPhoneUrls';
import type { PhoneTlsManager } from '../electron/tls/phoneTlsManager';

test.use({ channel: 'msedge' });

test('freight phone restores drafts and uploads resized and extensionless pictures', async ({ browser }, testInfo) => {
  const storage = testInfo.outputPath('pictures');
  await mkdir(storage, { recursive: true });
  const { FreightServer } = await import('../electron/freightServer');
  // Exercise the real phone server without launching Electron.
  const tls = {
    getPhoneHttpMode: () => true,
    getAllowInsecureHttp: () => true,
    refreshServerTls: async () => {},
    getServerTls: () => null,
  } as unknown as PhoneTlsManager;
  const server = new FreightServer(testInfo.outputPath('settings.json'), tls);
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await server.start();
    await server.setRoot(storage);
    const shipment = await server.create('Phone draft', '2026-11-10');
    await phone.goto('http://127.0.0.1:' + FREIGHT_PHONE_PORT + '/?key=' + shipment.token);
    await expect(phone.locator('#upload')).toBeVisible();

    const originalSize = await phone.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2400;
      canvas.height = 5000;
      const context = canvas.getContext('2d')!;
      const image = context.createImageData(canvas.width, canvas.height);
      const pixels = new Uint32Array(image.data.buffer);
      let seed = 1;
      for (let i = 0; i < pixels.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels[i] = seed | 0xff000000;
      }
      context.putImageData(image, 0, 0);
      const jpeg = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg', .98));
      const files = new DataTransfer();
      files.items.add(new File([jpeg], 'large.jpg', { type: 'image/jpeg' }));
      const input = document.querySelector<HTMLInputElement>('#camera')!;
      input.files = files.files;
      input.dispatchEvent(new Event('change'));
      return jpeg.size;
    });
    expect(originalSize).toBeGreaterThan(8 * 1024 * 1024);
    await expect(phone.locator('#camera')).toBeEnabled();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=', 'base64');
    await phone.locator('#files').setInputFiles({ name: 'extensionless', mimeType: 'application/octet-stream', buffer: png });
    await expect(phone.locator('#count')).toHaveText('2 pictures / 2 pallets');
    await phone.reload();
    await expect(phone.locator('#message')).toContainText('Your pictures are still here');

    await phone.locator('#confirm').check();
    await phone.locator('#send').click();
    await expect(phone.locator('#upload-status')).toContainText('Done, 2 pictures uploaded', { timeout: 30000 });
    await expect(phone.locator('#resize-note')).toContainText('1 large photo was resized for upload');

    const { readdir } = await import('node:fs/promises');
    const names = await readdir(shipment.folder);
    expect(names).toHaveLength(2);
    expect(await readFile(path.join(shipment.folder, names.find(name => name.endsWith('.png'))!))).toEqual(png);
    const jpeg = await readFile(path.join(shipment.folder, names.find(name => name.endsWith('.jpg'))!));
    expect(jpeg.length).toBeLessThan(originalSize);
    const dimensions = await phone.evaluate(async base64 => {
      const response = await fetch('data:image/jpeg;base64,' + base64);
      const image = await createImageBitmap(await response.blob());
      try { return [image.width, image.height]; } finally { image.close(); }
    }, jpeg.toString('base64'));
    expect(dimensions).toEqual([1920, 4000]);
  } finally {
    await phone.close();
    server.stop();
  }
});
