import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const WIN_TAILSCALE = 'C:\\Program Files\\Tailscale\\tailscale.exe';

export function resolveTailscaleExecutable(): string {
  if (process.platform === 'win32') {
    if (fs.existsSync(WIN_TAILSCALE)) return WIN_TAILSCALE;
    return 'tailscale.exe';
  }
  return 'tailscale';
}

export type TailscaleStatus = {
  address?: string;
  hostname?: string;
  certDomains?: string[];
  error?: string;
};

export async function readTailscaleStatus(): Promise<TailscaleStatus> {
  const cmd = resolveTailscaleExecutable();
  try {
    const { stdout } = await exec(cmd, ['status', '--json'], { timeout: 8000 });
    const status = JSON.parse(stdout);
    if (!status.Self) return { error: 'Tailscale is not connected' };
    const selfAddresses = status.Self.TailscaleIPs || [];
    const ipv4 = selfAddresses.find((ip: string) => ip.includes('.'));
    const dnsName = status.Self.DNSName ? String(status.Self.DNSName).replace(/\.$/, '') : undefined;
    const certDomains = Array.isArray(status.Self.CertDomains)
      ? status.Self.CertDomains.map((d: string) => String(d).replace(/\.$/, '')).filter(Boolean)
      : [];
    const hostname = dnsName || certDomains[0];
    return { address: ipv4, hostname, certDomains };
  } catch (e: any) {
    if (e.code === 'ENOENT') return { error: 'Tailscale is not installed (looked for tailscale on PATH and ' + WIN_TAILSCALE + ')' };
    return { error: 'Tailscale detection failed: ' + (e.message || String(e)) };
  }
}

export async function runTailscaleCert(hostname: string, certPath: string, keyPath: string): Promise<void> {
  const cmd = resolveTailscaleExecutable();
  const cleanHost = hostname.replace(/\.$/, '');
  try {
    await exec(cmd, ['cert', '--cert-file', certPath, '--key-file', keyPath, cleanHost], { timeout: 120000 });
  } catch (e: any) {
    const stderr = e.stderr ? String(e.stderr).trim() : '';
    const stdout = e.stdout ? String(e.stdout).trim() : '';
    const detail = [stderr, stdout, e.message].filter(Boolean).join(' — ');
    throw new Error(detail || 'tailscale cert failed');
  }
}
