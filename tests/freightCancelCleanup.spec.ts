import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { FreightServer } from '../electron/freightServer';

for (const route of ['/cancel', '/cancel-active']) {
  test(`${route} waits for a late write and removes only this batch`, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freight-cancel-'));
    const server = new FreightServer(path.join(dir, 'settings.json'), null as any) as any;
    const shipment = { token: 'test-key', folder: dir, closed: false };
    const batch = { id: '12345678abcdef', shipment, uploadDir: dir, files: [{ saved: undefined }] };
    server.shipments = [shipment];
    server.batch = batch;
    server.writing = true;
    server.writingBatchId = batch.id;
    let release!: () => void;
    server.activeWrite = { request: { complete: true }, done: new Promise<void>(r => { release = r; }) };
    await fs.writeFile(path.join(dir, 'previous-upload.png'), 'keep');
    let replied = false;
    const req = { method: 'POST', url: `${route}?key=test-key&batch=${batch.id}`, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = { writeHead() {}, end() { replied = true; } };
    const cancel = server.handle(req, res);
    try {
      await new Promise(r => setTimeout(r, 200));
      expect(replied).toBe(false);
      expect(server.canceledBatches.has(batch.id)).toBe(true);
      await fs.writeFile(path.join(dir, 'late_12345678_1.png'), 'late write');
      await fs.writeFile(path.join(dir, 'late_12345678_2.png.part'), 'partial');
      release();
      await cancel;
      expect(replied).toBe(true);
      expect(await fs.readdir(dir)).toEqual(['previous-upload.png']);
      expect(server.batch).toBeUndefined();
    } finally { release(); await cancel; await fs.rm(dir, { recursive: true, force: true }); }
  });
}

test('failed cleanup retains the canceled batch so Cancel can retry', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freight-cancel-'));
  const server = new FreightServer(path.join(dir, 'settings.json'), null as any) as any;
  const blocked = path.join(dir, 'blocked_12345678_1.png');
  await fs.mkdir(blocked); // unlink must fail rather than report success.
  server.batch = { id: '12345678abcdef', shipment: { folder: dir }, uploadDir: dir, files: [] };
  try {
    await expect(server.abandonBatch()).rejects.toThrow('Could not remove canceled upload files');
    expect(server.batch.id).toBe('12345678abcdef');
    await fs.rmdir(blocked);
    await server.abandonBatch();
    expect(server.batch).toBeUndefined();
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('cancel during the actual file rename waits for the handler and removes the result', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freight-write-cancel-'));
  const server = new FreightServer(path.join(dir, 'settings.json'), null as any) as any;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=', 'base64');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const shipment = { token: 'test-key', folder: dir, closed: false };
  const batch = { id: '12345678abcdef', shipment, uploadDir: dir, files: [{ name: 'p.png', size: bytes.length, hash }] };
  server.shipments = [shipment]; server.batch = batch;
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let entered!: () => void;
  const atRename = new Promise<void>(r => { entered = r; });
  const rename = fs.rename;
  fs.rename = async (from, to) => { entered(); await gate; await rename(from, to); };
  const req = Object.assign(Readable.from([bytes]), {
    method: 'POST', url: '/file?key=test-key&batch=12345678abcdef&index=0',
    headers: {}, socket: { remoteAddress: '127.0.0.1' }, complete: true
  });
  let status = 0;
  const upload = server.handle(req, { writeHead(code: number) { status = code; }, end() {} });
  try {
    await atRename;
    let cleaned = false;
    const cancel = server.abandonBatch().then(() => { cleaned = true; });
    await new Promise(r => setTimeout(r, 200));
    expect(cleaned).toBe(false);
    release();
    await Promise.all([upload, cancel]);
    expect(status).toBe(410);
    expect(await fs.readdir(dir)).toEqual([]);
  } finally { release(); fs.rename = rename; await upload; await fs.rm(dir, { recursive: true, force: true }); }
});


test('cancel overlapping the final response rolls back only that batch and its count', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freight-finish-cancel-'));
  const server = new FreightServer(path.join(dir, 'settings.json'), null as any) as any;
  const bytes = Buffer.from('verified');
  const saved = path.join(dir, 'upload_12345678_1.png');
  await fs.writeFile(saved, bytes);
  await fs.writeFile(path.join(dir, 'previous.png'), 'keep');
  const shipment = { id: 'shipment', token: 'test-key', folder: dir, closed: false, pictures: 3 };
  const batch = { id: '12345678abcdef', shipment, uploadDir: dir, uploadFolderLabel: 'dock', files: [{ saved, size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') }] };
  server.shipments = [shipment]; server.batch = batch;
  const req = (route: string) => ({ method: 'POST', url: route + '?key=test-key&batch=' + batch.id, headers: {}, socket: { remoteAddress: '127.0.0.1' } });
  const res = { writeHead() {}, end() {} };
  try {
    await server.handle(req('/finish'), res);
    expect(shipment.pictures).toBe(4);
    await Promise.all([server.handle(req('/cancel'), res), server.handle(req('/cancel'), res)]);
    expect(shipment.closed).toBe(false);
    expect(shipment.pictures).toBe(3);
    expect(await fs.readdir(dir)).toEqual(['previous.png', 'settings.json']);
    await server.handle(req('/cancel'), res);
    expect(shipment.pictures).toBe(3);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
