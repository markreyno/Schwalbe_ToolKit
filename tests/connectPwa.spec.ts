import { test, expect } from '@playwright/test';
import { ConnectPwaServer, CONNECT_PWA_PORT } from '../electron/connectPwaServer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import { createTestPhoneTlsManager } from './helpers/phoneTlsTest';

test.describe('Connect PWA server', () => {
  let server: ConnectPwaServer;
  let settingsPath: string;
  let testRoot: string;
  let baseUrl: string;

  const toolsResolver = async (host: string) => {
    return [
      {
        id: 'freight-pictures' as const,
        title: 'Freight Pictures',
        category: 'SHIPPING & WAREHOUSE',
        ready: true,
        url: `http://${host}:48731/`
      },
      {
        id: 'palletvision-collector' as const,
        title: 'PalletVision Data Collector',
        category: 'DATA COLLECTION',
        ready: true,
        url: `http://${host}:48732/`
      }
    ];
  };

  test.beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    testRoot = path.resolve('.cache/connect-pwa-test', randomUUID());
    settingsPath = path.join(testRoot, 'settings.json');
    const tlsManager = await createTestPhoneTlsManager(testRoot);
    server = new ConnectPwaServer(settingsPath, tlsManager, toolsResolver);
    await server.start();
    const status = await server.status();
    expect(status.running).toBe(true);
    expect(status.port).toBe(CONNECT_PWA_PORT);
    expect(status.qrUrl.startsWith('http://')).toBe(true);
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
    expect(html).toContain('/hub.css');
    expect(html).not.toContain('Add to Home Screen');
    expect(html).not.toContain('install-banner');

    const css = await fetch(`${baseUrl}/hub.css`);
    expect(css.ok).toBe(true);
    expect(await css.text()).toContain('--brand-blue');

    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    expect(manifest.ok).toBe(true);
    const manifestJson = await manifest.json();
    expect(manifestJson.name).toBe('Schwalbe ToolKit');
    expect(manifestJson.display).toBe('standalone');
    expect(manifestJson.theme_color).toBe('#f5f8fa');

    const touch = await fetch(`${baseUrl}/apple-touch-icon.png`);
    expect(touch.ok).toBe(true);

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

  test('tools API resolves LAN host URLs with shipment key', async () => {
    const resp = await fetch(`${baseUrl}/api/tools?host=192.168.77.3`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.host).toBe('192.168.77.3');
    expect(data.tools[0].url).toBe('http://192.168.77.3:48731/');
    expect(data.tools[1].url).toBe('http://192.168.77.3:48732/');
  });

  test('tools API resolves Tailscale MagicDNS host URLs', async () => {
    const resp = await fetch(`${baseUrl}/api/tools?host=desk.tailnet.ts.net`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.tools[0].url).toBe('http://desk.tailnet.ts.net:48731/');
    expect(data.tools[1].url).toBe('http://desk.tailnet.ts.net:48732/');
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
