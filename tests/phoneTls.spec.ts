import { test, expect } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { createTestPhoneTlsManager } from './helpers/phoneTlsTest';
import { PhoneTlsManager } from '../electron/tls/phoneTlsManager';
import { startPhoneToolServer } from '../electron/tls/phoneServer';
import { startCaTrustServer } from '../electron/tls/caTrustServer';
import { ensureLocalTlsMaterial } from '../electron/tls/localCa';
import { buildPhoneOrigin } from '../electron/tls/phoneUrls';

function httpsGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

test.describe('phone TLS infrastructure', () => {
  test('phone TLS defaults to HTTP mode', async () => {
    const root = path.resolve('.cache/phone-tls-default', randomUUID());
    const manager = new PhoneTlsManager(root);
    await manager.load();
    expect(manager.getPhoneHttpMode()).toBe(true);
    expect(manager.getPhoneUseHttps()).toBe(false);
    const status = await manager.publicStatus(false, '127.0.0.1');
    expect(status.mode).toBe('http');
    expect(status.installHttpsUrl).toMatch(/^http:\/\//);
    await rm(root, { recursive: true, force: true });
  });

  test('load migrates legacy usePhoneHttps=true to HTTP', async () => {
    const root = path.resolve('.cache/phone-tls-migrate', randomUUID());
    await fs.mkdir(root, { recursive: true });
    const settingsPath = path.join(root, 'phone-tls-settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({ usePhoneHttps: true }));
    const manager = new PhoneTlsManager(root);
    await manager.load();
    expect(manager.getPhoneUseHttps()).toBe(false);
    const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(saved.usePhoneHttps).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  test('local CA material includes LAN IP in SANs', async () => {
    const root = path.resolve('.cache/phone-tls-unit', randomUUID());
    const material = await ensureLocalTlsMaterial(root);
    expect(material.sans).toContain('127.0.0.1');
    expect(material.fingerprintSha256).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2})+$/);
    await rm(root, { recursive: true, force: true });
  });

  test('phone tool server serves HTTP by default', async () => {
    const root = path.resolve('.cache/phone-tls-http', randomUUID());
    const manager = await createTestPhoneTlsManager(root);
    const port = 48798;
    const handle = await startPhoneToolServer({
      port,
      tls: manager.getServerTls(),
      allowInsecureHttp: manager.getPhoneHttpMode(),
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('http-ok');
      }
    });
    const plain = await httpGet(`http://127.0.0.1:${port}/`);
    expect(plain.status).toBe(200);
    expect(plain.body).toBe('http-ok');

    await handle.close();
    await rm(root, { recursive: true, force: true });
  });

  test('phone tool server serves HTTPS when enabled', async () => {
    const root = path.resolve('.cache/phone-tls-server', randomUUID());
    const manager = await createTestPhoneTlsManager(root, { usePhoneHttps: true });
    const port = 48799;
    const handle = await startPhoneToolServer({
      port,
      tls: manager.getServerTls(),
      allowInsecureHttp: false,
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('secure-ok');
      }
    });
    const secure = await httpsGet(`https://127.0.0.1:${port}/`);
    expect(secure.status).toBe(200);
    expect(secure.body).toBe('secure-ok');

    await handle.close();
    await rm(root, { recursive: true, force: true });
  });

  test('CA trust HTTP server only serves certificate assets', async () => {
    const root = path.resolve('.cache/phone-tls-ca', randomUUID());
    await ensureLocalTlsMaterial(root);
    const manager = new PhoneTlsManager(root);
    await manager.setPhoneUseHttps(true);
    await manager.refreshServerTls(false);
    const caServer = await startCaTrustServer(() => manager.getCaPem());
    const caResp = await fetch('http://127.0.0.1:48730/ca.crt');
    expect(caResp.ok).toBe(true);
    const pem = await caResp.text();
    expect(pem).toContain('BEGIN CERTIFICATE');
    const denied = await fetch('http://127.0.0.1:48730/secret');
    expect(denied.status).toBe(404);
    await caServer.close();
    await rm(root, { recursive: true, force: true });
  });

  test('buildPhoneOrigin uses http when insecure', () => {
    expect(buildPhoneOrigin('192.168.1.5', 48731)).toBe('https://192.168.1.5:48731');
    expect(buildPhoneOrigin('192.168.1.5', 48731, true)).toBe('http://192.168.1.5:48731');
  });
});
