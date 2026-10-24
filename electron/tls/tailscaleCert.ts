import forge from 'node-forge';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type TailscaleCertFiles = { certPem: string; keyPem: string; certPath: string; keyPath: string };

function certExpiresSoon(pem: string, days = 21): boolean {
  try {
    const cert = forge.pki.certificateFromPem(pem);
    const ms = cert.validity.notAfter.getTime() - Date.now();
    return ms < days * 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

export async function obtainTailscaleCert(hostname: string, certDir: string): Promise<TailscaleCertFiles> {
  const cleanHost = hostname.replace(/\.$/, '');
  await fs.mkdir(certDir, { recursive: true });
  const certPath = path.join(certDir, `${cleanHost}.crt`);
  const keyPath = path.join(certDir, `${cleanHost}.key`);
  const existingCert = await fs.readFile(certPath, 'utf8').catch(() => '');
  if (existingCert && !certExpiresSoon(existingCert)) {
    const keyPem = await fs.readFile(keyPath, 'utf8');
    return { certPem: existingCert, keyPem, certPath, keyPath };
  }
  const tailscaleCmd = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  await exec(tailscaleCmd, ['cert', '--cert-file', certPath, '--key-file', keyPath, cleanHost], { timeout: 30000 });
  const [certPem, keyPem] = await Promise.all([fs.readFile(certPath, 'utf8'), fs.readFile(keyPath, 'utf8')]);
  return { certPem, keyPem, certPath, keyPath };
}
