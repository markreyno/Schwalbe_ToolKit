import { listPrivateIpv4Addresses } from '../networkAllowlist';
import { detectTailscale } from '../networkAllowlist';

/** Build https (or optional http) origin for a phone tool server. */
export function buildPhoneOrigin(host: string, port: number, insecure = false): string {
  const trimmed = (host || '').trim();
  if (!trimmed) return `${insecure ? 'http' : 'https'}://127.0.0.1:${port}`;
  const needsBrackets = trimmed.includes(':') && !trimmed.startsWith('[');
  const hostPart = needsBrackets ? `[${trimmed}]` : trimmed;
  return `${insecure ? 'http' : 'https'}://${hostPart}:${port}`;
}

export function rewritePhoneToolUrl(toolUrl: string, requestHost: string, port: number, addressList: string[], insecure = false): string {
  const normalized = normalizePhoneHost(requestHost);
  const listed = addressList.find(entry => {
    try {
      return new URL(entry).hostname.toLowerCase() === normalized;
    } catch {
      return false;
    }
  });
  const origin = listed ? listed.replace(/\/$/, '') : buildPhoneOrigin(normalized, port, insecure);
  return toolUrl.replace(/^https?:\/\/[^/]+/i, origin);
}

export function normalizePhoneHost(host: string): string {
  const trimmed = (host || '').trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed.split(':')[0];
}

export async function listPhoneUrlHosts(options: {
  useTailscale: boolean;
  preferredLanAddress?: string;
  manualAddress?: string;
  allowInsecureHttp?: boolean;
}): Promise<{ hosts: string[]; primaryHost: string }> {
  const tailscale = await detectTailscale();
  let hosts: string[] = [];
  if (options.useTailscale) {
    if (tailscale.hostname) hosts = [tailscale.hostname.replace(/\.$/, '')];
    else if (options.allowInsecureHttp && tailscale.address) {
      hosts = [tailscale.address];
    } else if (!tailscale.error && tailscale.address) {
      throw new Error('Tailscale HTTPS requires a MagicDNS name. Enable MagicDNS on your tailnet or use local network mode.');
    }
  } else {
    hosts = listPrivateIpv4Addresses(options.preferredLanAddress || '');
    if (options.manualAddress && !hosts.includes(options.manualAddress)) hosts.unshift(options.manualAddress);
  }
  if (!hosts.length) hosts = ['127.0.0.1'];
  return { hosts, primaryHost: hosts[0] };
}

export function buildPhoneAddressList(hosts: string[], port: number, insecure = false): string[] {
  return hosts.map(h => buildPhoneOrigin(h, port, insecure));
}
