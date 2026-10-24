import { test, expect } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import https from 'node:https';
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

test.describe('phone TLS infrastructure', () => {
  test('local CA material includes LAN IP in SANs', async () => {
    const root = path.resolve('.cache/phone-tls-unit', randomUUID());
    const material = await ensureLocalTlsMaterial(root);
    expect(material.sans).toContain('127.0.0.1');
    expect(material.fingerprintSha256).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2})+$/);
    await rm(root, { recursive: true, force: true });
  });

  test('phone tool server serves HTTPS', async () => {
    const root = path.resolve('.cache/phone-tls-server', randomUUID());
    const manager = await createTestPhoneTlsManager(root);
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

  test('buildPhoneOrigin always uses https unless insecure', () => {
    expect(buildPhoneOrigin('192.168.1.5', 48731)).toBe('https://192.168.1.5:48731');
    expect(buildPhoneOrigin('192.168.1.5', 48731, true)).toBe('http://192.168.1.5:48731');
  });
});
