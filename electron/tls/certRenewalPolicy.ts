import forge from 'node-forge';
import { parseLeafCertInfo, leafCoversHost } from './localCa';

export const DEFAULT_RENEW_WITHIN_DAYS = 30;
export const LOCAL_LEAF_RENEW_WITHIN_DAYS = 14;

export function certNotAfterMs(pem: string): number | null {
  try {
    return forge.pki.certificateFromPem(pem).validity.notAfter.getTime();
  } catch {
    return null;
  }
}

export function certIsExpired(pem: string, nowMs = Date.now()): boolean {
  const end = certNotAfterMs(pem);
  if (end == null) return true;
  return end <= nowMs;
}

export function certExpiresWithinDays(pem: string, days: number, nowMs = Date.now()): boolean {
  const end = certNotAfterMs(pem);
  if (end == null) return true;
  return end - nowMs < days * 24 * 60 * 60 * 1000;
}

export type TailscaleRenewDecision = 'missing' | 'expired' | 'expiring_soon' | 'hostname_mismatch' | 'ok';

export function decideTailscaleCertRenewal(input: {
  certPem: string;
  expectedHostname: string;
  renewWithinDays?: number;
  nowMs?: number;
}): TailscaleRenewDecision {
  const renewWithinDays = input.renewWithinDays ?? DEFAULT_RENEW_WITHIN_DAYS;
  const host = (input.expectedHostname || '').replace(/\.$/, '').toLowerCase();
  if (!host) return 'missing';
  const pem = (input.certPem || '').trim();
  if (!pem) return 'missing';
  if (certIsExpired(pem, input.nowMs)) return 'expired';
  if (certExpiresWithinDays(pem, renewWithinDays, input.nowMs)) return 'expiring_soon';
  if (!leafCoversHost(pem, host)) return 'hostname_mismatch';
  return 'ok';
}

export type LocalLeafRenewDecision = 'missing' | 'expired' | 'expiring_soon' | 'sans_mismatch' | 'ok';

export function decideLocalLeafRenewal(input: {
  certPem: string;
  requiredSans: string[];
  storedSansKey?: string;
  renewWithinDays?: number;
  nowMs?: number;
}): LocalLeafRenewDecision {
  const renewWithinDays = input.renewWithinDays ?? LOCAL_LEAF_RENEW_WITHIN_DAYS;
  const pem = (input.certPem || '').trim();
  const sansKey = [...new Set(input.requiredSans.map(s => s.toLowerCase()).filter(Boolean))].sort().join(',');
  if (!pem) return 'missing';
  if (certIsExpired(pem, input.nowMs)) return 'expired';
  if (certExpiresWithinDays(pem, renewWithinDays, input.nowMs)) return 'expiring_soon';
  if (input.storedSansKey && input.storedSansKey !== sansKey) return 'sans_mismatch';
  for (const host of input.requiredSans) {
    if (host && !leafCoversHost(pem, host)) return 'sans_mismatch';
  }
  return 'ok';
}

export type CaRenewDecision = 'missing' | 'expired' | 'ok';

export function decideCaRenewal(certPem: string, nowMs = Date.now()): CaRenewDecision {
  const pem = (certPem || '').trim();
  if (!pem) return 'missing';
  if (certIsExpired(pem, nowMs)) return 'expired';
  return 'ok';
}
