import { test, expect } from '@playwright/test';
import forge from 'node-forge';
import {
  decideTailscaleCertRenewal,
  decideLocalLeafRenewal,
  decideCaRenewal,
  certExpiresWithinDays
} from '../electron/tls/certRenewalPolicy';
import { ensureLocalTlsMaterial } from '../electron/tls/localCa';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { startPhoneToolServer } from '../electron/tls/phoneServer';
import tls from 'node:tls';

function makeServerCertPem(hosts: string[], daysValid: number): string {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + daysValid * 24 * 60 * 60 * 1000);
  cert.setSubject([{ name: 'commonName', value: 'test' }]);
  cert.setIssuer(cert.subject.attributes);
  const altNames = hosts.map(h => (/^\d/.test(h) ? { type: 7, ip: h } : { type: 2, value: h }));
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

test.describe('certificate renewal policy', () => {
  test('tailscale: missing, expired, expiring, hostname mismatch, ok', () => {
    expect(decideTailscaleCertRenewal({ certPem: '', expectedHostname: 'a.ts.net' })).toBe('missing');
    const expired = makeServerCertPem(['a.ts.net'], -1);
    expect(decideTailscaleCertRenewal({ certPem: expired, expectedHostname: 'a.ts.net' })).toBe('expired');
    const soon = makeServerCertPem(['a.ts.net'], 10);
    expect(decideTailscaleCertRenewal({ certPem: soon, expectedHostname: 'a.ts.net', renewWithinDays: 30 })).toBe('expiring_soon');
    const wrongHost = makeServerCertPem(['other.ts.net'], 120);
    expect(decideTailscaleCertRenewal({ certPem: wrongHost, expectedHostname: 'a.ts.net' })).toBe('hostname_mismatch');
    const ok = makeServerCertPem(['a.ts.net'], 120);
    expect(decideTailscaleCertRenewal({ certPem: ok, expectedHostname: 'a.ts.net' })).toBe('ok');
  });

  test('local leaf and CA decisions', async () => {
    const root = path.resolve('.cache/cert-policy', randomUUID());
    const material = await ensureLocalTlsMaterial(root, false, ['192.168.1.50']);
    expect(decideCaRenewal(material.caCertPem)).toBe('ok');
    expect(
      decideLocalLeafRenewal({
        certPem: material.serverCertPem,
        requiredSans: material.sans,
        storedSansKey: material.sans.sort().join(',')
      })
    ).toBe('ok');
    expect(certExpiresWithinDays(material.serverCertPem, 30)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  test('phone HTTPS server hot-swaps TLS without restart', async () => {
    const root = path.resolve('.cache/cert-hotswap', randomUUID());
    const first = await ensureLocalTlsMaterial(root, false, ['127.0.0.1']);
    const second = await ensureLocalTlsMaterial(root, true, ['127.0.0.1']);
    const port = 48796;
    const handle = await startPhoneToolServer({
      port,
      tls: { cert: first.serverCertPem, key: first.serverKeyPem },
      allowInsecureHttp: false,
      handler: (_req, res) => {
        res.writeHead(200);
        res.end('ok');
      }
    });
    handle.updateTls({ cert: second.serverCertPem, key: second.serverKeyPem });
    const peer = await new Promise<tls.PeerCertificate>(resolve => {
      const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
        resolve(socket.getPeerCertificate());
        socket.end();
      });
    });
    expect(peer.serialNumber).toBeTruthy();
    await handle.close();
    await rm(root, { recursive: true, force: true });
  });
});
