import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { readTailscaleStatus } from './tls/tailscaleExec';

export function isPrivateIP(ip: string): boolean {
  if (ip === '::1') return true;
  if (ip.startsWith('fd7a:115c:a1e0:')) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  if (parts[0] === 127) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  return false;
}

export async function detectTailscale(): Promise<{ address?: string; hostname?: string; certDomains?: string[]; error?: string }> {
  const status = await readTailscaleStatus();
  return status;
}

export function listPrivateIpv4Addresses(preferredAddress = ''): string[] {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a!.address)
    .sort((a, b) => Number(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(b)) - Number(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)));
  addresses.sort((a, b) => Number(b === preferredAddress) - Number(a === preferredAddress));
  return addresses;
}

export async function detectPreferredLanAddress(): Promise<string> {
  if (process.platform !== 'win32') return '';
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1; if ($route) { Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress }"], { windowsHide: true, timeout: 8000 });
    const address = stdout.trim();
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(address) ? address : '';
  } catch {
    return '';
  }
}
