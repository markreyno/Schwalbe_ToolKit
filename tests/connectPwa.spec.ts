import { test, expect } from '@playwright/test';
import { ConnectPwaServer, CONNECT_PWA_PORT } from '../electron/connectPwaServer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import http from 'node:http';

test.describe('Connect PWA server', () => {
  let server: ConnectPwaServer;
  let settingsPath: string;
  let testRoot: string;
  let baseUrl: string;

  test.beforeAll(async () => {
    testRoot = path.resolve('.cache/connect-pwa-test', randomUUID());
    settingsPath = path.join(testRoot, 'settings.json');
    server = new ConnectPwaServer(settingsPath);
    await server.start();
    const status = await server.status();
    expect(status.running).toBe(true);
    expect(status.port).toBe(CONNECT_PWA_PORT);
    baseUrl = `http://127.0.0.1:${CONNECT_PWA_PORT}`;
  });

  test.afterAll(async () => {
    server?.stop();
    await rm(testRoot, { recursive: true, force: true });
  });

  test('serves manifest, service worker, and hub page', async () => {
    const hub = await fetch(`${baseUrl}/`);
    expect(hub.ok).toBe(true);
    expect(hub.headers.get('content-type')).toContain('text/html');
    const html = await hub.text();
    expect(html).toContain('Schwalbe ToolKit');

    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    expect(manifest.ok).toBe(true);
    const manifestJson = await manifest.json();
    expect(manifestJson.name).toBe('Schwalbe ToolKit');
    expect(manifestJson.display).toBe('standalone');

    const sw = await fetch(`${baseUrl}/sw.js`);
    expect(sw.ok).toBe(true);
    expect(await sw.text()).toContain('schwalbe-toolkit-connect');
  });

  test('rejects connections from public IP addresses', async () => {
    let status = 0;
    let text = '';
    const req = { method: 'GET', url: '/', headers: {}, socket: { remoteAddress: '8.8.8.8' } } as http.IncomingMessage;
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead(code: number) { status = code; },
      end(chunk: string) { text = chunk; }
    } as http.ServerResponse;
    await (server as unknown as { handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> }).handle(req, res);
    expect(status).toBe(403);
    expect(text).toContain('Access denied');
  });

  test('status API reports reachability flags', async () => {
    const resp = await fetch(`${baseUrl}/api/status`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data).toHaveProperty('desktopReachable');
    expect(data).toHaveProperty('freightReachable');
    expect(data).toHaveProperty('palletvisionReachable');
  });
});
