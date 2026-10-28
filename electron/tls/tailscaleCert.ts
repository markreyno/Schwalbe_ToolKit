import forge from 'node-forge';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runTailscaleCert } from './tailscaleExec';

export type TailscaleCertFiles = { certPem: string; keyPem: string; certPath: string; keyPath: string };

const RENEW_WITHIN_DAYS = 30;

export function certExpiresSoon(pem: string, days = RENEW_WITHIN_DAYS): boolean {
  try {
    const cert = forge.pki.certificateFromPem(pem);
    const ms = cert.validity.notAfter.getTime() - Date.now();
    return ms < days * 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

export function tailscaleCertExpiryIso(pem: string): string {
  try {
    const cert = forge.pki.certificateFromPem(pem);
    return cert.validity.notAfter.toISOString();
  } catch {
    return '';
  }
}

export async function obtainTailscaleCert(hostname: string, certDir: string, options?: { forceRenew?: boolean }): Promise<TailscaleCertFiles> {
  const cleanHost = hostname.replace(/\.$/, '');
  await fs.mkdir(certDir, { recursive: true });
  const certPath = path.join(certDir, `${cleanHost}.crt`);
  const keyPath = path.join(certDir, `${cleanHost}.key`);
  const existingCert = await fs.readFile(certPath, 'utf8').catch(() => '');
  if (existingCert && !options?.forceRenew && !certExpiresSoon(existingCert)) {
    const keyPem = await fs.readFile(keyPath, 'utf8');
    return { certPem: existingCert, keyPem, certPath, keyPath };
  }
  await runTailscaleCert(cleanHost, certPath, keyPath);
  const [certPem, keyPem] = await Promise.all([fs.readFile(certPath, 'utf8'), fs.readFile(keyPath, 'utf8')]);
  return { certPem, keyPem, certPath, keyPath };
}
