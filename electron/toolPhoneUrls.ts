import { isPrivateIP } from './networkAllowlist';
import { buildPhoneOrigin, normalizePhoneHost } from './tls/phoneUrls';

export const FREIGHT_PHONE_PORT = 48731;
export const PALLETVISION_PHONE_PORT = 48732;

export type ConnectPwaToolLink = {
  id: 'freight-pictures' | 'palletvision-collector';
  title: string;
  category: string;
  ready: boolean;
  url?: string;
  message?: string;
};

type FreightStatusSlice = {
  root: string;
  running: boolean;
  addresses: string[];
  masterUrl: string;
  shipments: { closed: boolean; url: string }[];
};

type PalletVisionStatusSlice = {
  root: string;
  running: boolean;
  addresses: string[];
  qrUrl: string;
};

export function normalizeHubHost(host: string): string {
  return normalizePhoneHost(host);
}

export function isAllowedHubHost(host: string): boolean {
  const normalized = normalizeHubHost(host);
  if (!normalized) return false;
  if (isPrivateIP(normalized)) return true;
  if (normalized.includes('.')) return true;
  return false;
}

/** Match desktop QR address picker: use listed origin when host matches, else swap origin to the phone's host. */
export function rewriteToolUrlForHost(toolUrl: string, requestHost: string, port: number, addressList: string[], insecure = false): string {
  const normalized = normalizeHubHost(requestHost);
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

export function resolveConnectPwaTools(
  requestHost: string,
  freight: FreightStatusSlice,
  palletvision: PalletVisionStatusSlice,
  insecure = false
): ConnectPwaToolLink[] {
  const host = normalizeHubHost(requestHost);
  const tools: ConnectPwaToolLink[] = [];

  if (!freight.root) {
    tools.push({
      id: 'freight-pictures',
      title: 'Freight Pictures',
      category: 'SHIPPING & WAREHOUSE',
      ready: false,
      message: 'Open Freight Pictures on the desktop and choose a storage folder first.'
    });
  } else if (!freight.running) {
    tools.push({
      id: 'freight-pictures',
      title: 'Freight Pictures',
      category: 'SHIPPING & WAREHOUSE',
      ready: false,
      message: 'Freight Pictures upload server is not running. Keep the toolkit open on the desktop.'
    });
  } else {
    const hubOrigin = rewriteToolUrlForHost(
      `${freight.addresses[0] || buildPhoneOrigin(host, FREIGHT_PHONE_PORT, insecure)}/`,
      host,
      FREIGHT_PHONE_PORT,
      freight.addresses,
      insecure
    );
    tools.push({
      id: 'freight-pictures',
      title: 'Freight Pictures',
      category: 'SHIPPING & WAREHOUSE',
      ready: true,
      url: hubOrigin.replace(/\?.*$/, '').replace(/\/$/, '') + '/'
    });
  }

  if (!palletvision.running) {
    tools.push({
      id: 'palletvision-collector',
      title: 'PalletVision Data Collector',
      category: 'DATA COLLECTION',
      ready: false,
      message: 'PalletVision upload server is not running. Keep the toolkit open on the desktop.'
    });
  } else if (!palletvision.root) {
    tools.push({
      id: 'palletvision-collector',
      title: 'PalletVision Data Collector',
      category: 'DATA COLLECTION',
      ready: false,
      message: 'Open PalletVision Data Collector on the desktop and choose a data folder first.'
    });
  } else {
    tools.push({
      id: 'palletvision-collector',
      title: 'PalletVision Data Collector',
      category: 'DATA COLLECTION',
      ready: true,
      url: rewriteToolUrlForHost(palletvision.qrUrl, host, PALLETVISION_PHONE_PORT, palletvision.addresses, insecure)
    });
  }

  return tools;
}
