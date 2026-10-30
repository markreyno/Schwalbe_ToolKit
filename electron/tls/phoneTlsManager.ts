import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { detectTailscale } from '../networkAllowlist';
import { ensureLocalTlsMaterial, leafCoversHost, parseLeafCertInfo, collectSans } from './localCa';
import { obtainTailscaleCert, tailscaleCertExpiryIso } from './tailscaleCert';
import { buildPhoneOrigin } from './phoneUrls';
import { PHONE_CA_TRUST_PORT } from './caTrustServer';
import type { PhoneServerTls } from './phoneServer';
import { createHash } from 'node:crypto';
import {
  decideLocalLeafRenewal,
  decideTailscaleCertRenewal,
  certNotAfterMs
} from './certRenewalPolicy';

export type PhoneTlsPublicStatus = {
  tlsReady: boolean;
  tlsError: string;
  tlsFixHint: string;
  transport: string;
  /** @deprecated Always false — phone tools are HTTPS-only */
  allowInsecureHttp: boolean;
  phoneUseHttps: boolean;
  /** @deprecated Always false — no silent HTTP downgrade */
  httpFallback: boolean;
  mode: 'tailscale' | 'local' | 'pending' | 'unavailable';
  caFingerprint: string;
  caTrustHttpUrl: string;
  caTrustQr: string;
  usingTailscaleCert: boolean;
  tlsHostname: string;
  tailscaleCertHostname: string;
  leafSans: string[];
  leafExpiresAt: string;
  tailscaleCertExpiresAt: string;
  sanCoversHostname: boolean;
  requiresCaTrust: boolean;
  installHttpsUrl: string;
  /** Human-readable certificate health (renewal / validity). */
  certStatusDetail: string;
  validUntil: string;
};

type Settings = { usePhoneHttps?: boolean; allowInsecureHttp?: boolean };

let testTlsOverride: PhoneServerTls | null = null;

export function setPhoneTlsTestMaterial(material: PhoneServerTls | null) {
  testTlsOverride = material;
}

const TAILSCALE_SNI_SUFFIX = '.ts.net';
const MAINTENANCE_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const STARTUP_TAILSCALE_RETRY_MS = 3 * 60 * 60 * 1000;

export class PhoneTlsManager {
  private settingsPath: string;
  private tlsError = '';
  private localCaPem: string | null = null;
  private localFingerprint = '';
  private serverTls: PhoneServerTls | null = null;
  private usingTailscaleCert = false;
  private tailscaleCertHostname = '';
  private tailscaleCertExpiresAt = '';
  private lastMode: PhoneTlsPublicStatus['mode'] = 'pending';
  private reloadCallbacks: Array<() => Promise<void>> = [];
  private lastRefreshOpts = { useTailscale: false, hosts: [] as string[] };
  private maintenanceTimer?: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setInterval>;
  private hadTlsReady = false;
  private certStatusDetail = '';
  private validUntilIso = '';
  private startupCheckPromise: Promise<void> | null = null;

  constructor(userDataDir: string) {
    this.settingsPath = path.join(userDataDir, 'phone-tls-settings.json');
  }

  onReload(callback: () => Promise<void>) {
    this.reloadCallbacks.push(callback);
  }

  async load() {
    try {
      JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
    } catch (e: any) {
      if (e.code !== 'ENOENT') this.tlsError = 'Could not read phone TLS settings.';
    }
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify({ usePhoneHttps: true }));
  }

  startCertificateMaintenance() {
    if (this.maintenanceTimer) return;
    this.maintenanceTimer = setInterval(() => {
      void this.maintainCertificates();
    }, MAINTENANCE_MS);
    this.retryTimer = setInterval(() => {
      if (this.tlsError || !this.getServerTls()) void this.maintainCertificates();
    }, RETRY_MS);
  }

  /** Non-blocking startup certificate evaluation (Tailscale + local CA leaf). */
  runStartupCertificateCheck() {
    if (!this.startupCheckPromise) {
      this.startupCheckPromise = this.maintainCertificates(false, { startup: true }).finally(() => {
        this.startupCheckPromise = null;
      });
    }
    return this.startupCheckPromise;
  }

  private tlsFingerprint(material: PhoneServerTls): string {
    const parts = [material.cert, material.key, material.sniCert, material.sniKey].map(v => String(v || ''));
    return createHash('sha256').update(parts.join('\0')).digest('hex');
  }

  private formatValidUntil(iso: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  getPhoneUseHttps() {
    return true;
  }

  /** Phone tool URLs and listeners always use HTTPS. */
  getPhoneHttpMode() {
    return false;
  }

  isHttpFallback() {
    return false;
  }

  async setPhoneUseHttps(_enabled: boolean) {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify({ usePhoneHttps: true }));
    await this.maintainCertificates(true);
    await this.notifyReload();
  }

  /** @deprecated Phone tools no longer support plain HTTP. */
  async setAllowInsecureHttp(_enabled: boolean) {
    await this.setPhoneUseHttps(true);
  }

  getAllowInsecureHttp() {
    return false;
  }

  async retryCertificate() {
    await this.maintainCertificates(true);
    await this.notifyReload();
  }

  getCaPem(): string | null {
    return this.localCaPem;
  }

  getServerTls(): PhoneServerTls | null {
    if (testTlsOverride) return testTlsOverride;
    return this.serverTls;
  }

  private buildSniBundle(local: PhoneServerTls, tailscale: PhoneServerTls): PhoneServerTls {
    return {
      cert: local.cert,
      key: local.key,
      sniSuffix: TAILSCALE_SNI_SUFFIX,
      sniCert: tailscale.cert,
      sniKey: tailscale.key
    };
  }

  async maintainCertificates(forceRenew = false, options?: { startup?: boolean }) {
    const wasReady = !!this.getServerTls();
    const previousFp = this.serverTls ? this.tlsFingerprint(this.serverTls) : '';
    await this.refreshServerTls(this.lastRefreshOpts.useTailscale, this.lastRefreshOpts.hosts, {
      forceTailscaleRenew: forceRenew,
      forceLocalRenew: forceRenew,
      startup: options?.startup
    });
    const nowFp = this.serverTls ? this.tlsFingerprint(this.serverTls) : '';
    if (options?.startup && this.serverTls && previousFp && nowFp !== previousFp) {
      this.certStatusDetail = 'Certificate renewed on startup.';
      console.info('[PhoneTls] Certificate renewed on startup.');
    }
    if (!wasReady && this.getServerTls()) await this.notifyReload();
    else if (nowFp && nowFp !== previousFp && wasReady) await this.notifyReload();
  }

  async refreshServerTls(
    useTailscale: boolean,
    extraHosts: string[] = [],
    options?: { forceTailscaleRenew?: boolean; forceLocalRenew?: boolean; startup?: boolean }
  ) {
    this.lastRefreshOpts = { useTailscale, hosts: extraHosts };
    const previousTls = this.serverTls;
    const previousError = this.tlsError;
    this.tlsError = '';
    this.usingTailscaleCert = false;
    this.tailscaleCertHostname = '';
    this.tailscaleCertExpiresAt = '';
    let nextMode: PhoneTlsPublicStatus['mode'] = this.lastMode;

    if (testTlsOverride) {
      this.serverTls = testTlsOverride;
      this.lastMode = 'local';
      return;
    }

    const tailscale = await detectTailscale();
    const magicHost = (tailscale.hostname || tailscale.certDomains?.[0] || '').replace(/\.$/, '');
    let tailscaleTls: PhoneServerTls | null = null;
    let localTls: PhoneServerTls | null = null;

    if (magicHost) {
      try {
        const certDir = path.join(path.dirname(this.settingsPath), 'phone-tailscale-certs');
        const certPath = path.join(certDir, `${magicHost}.crt`);
        const existingCert = await fs.readFile(certPath, 'utf8').catch(() => '');
        const tailDecision = decideTailscaleCertRenewal({ certPem: existingCert, expectedHostname: magicHost });
        const forceTailscale =
          !!options?.forceTailscaleRenew ||
          tailDecision === 'missing' ||
          tailDecision === 'expired' ||
          tailDecision === 'expiring_soon' ||
          tailDecision === 'hostname_mismatch';
        const files = await obtainTailscaleCert(magicHost, certDir, { forceRenew: forceTailscale });
        tailscaleTls = { cert: files.certPem, key: files.keyPem };
        this.usingTailscaleCert = true;
        this.tailscaleCertHostname = magicHost;
        this.tailscaleCertExpiresAt = tailscaleCertExpiryIso(files.certPem);
        if (options?.startup && forceTailscale && tailDecision !== 'ok') {
          console.info('[PhoneTls] Tailscale certificate renewed (' + tailDecision + ').');
        }
      } catch (e: any) {
        this.tlsError = 'Tailscale certificate failed: ' + (e.message || String(e));
        if (options?.startup) {
          this.certStatusDetail = 'Tailscale certificate not ready yet. Will retry automatically.';
          console.warn('[PhoneTls] Tailscale certificate unavailable at startup:', e.message || String(e));
        }
      }
    } else if (options?.startup && useTailscale) {
      this.certStatusDetail = 'Tailscale is not running. HTTPS uses the local CA until Tailscale is available.';
    }

    const lanHosts = [...new Set([...extraHosts, tailscale.address, '127.0.0.1'].filter(Boolean) as string[])];
    const sans = collectSans(lanHosts);
    try {
      const userDataDir = path.dirname(this.settingsPath);
      const metaPath = path.join(userDataDir, 'phone-local-ca', 'server-meta.json');
      let storedSansKey = '';
      try {
        storedSansKey = JSON.parse(await fs.readFile(metaPath, 'utf8')).sansKey || '';
      } catch { /* ignore */ }
      const existingLeaf = await fs.readFile(path.join(userDataDir, 'phone-local-ca', 'server.crt'), 'utf8').catch(() => '');
      const leafDecision = decideLocalLeafRenewal({
        certPem: existingLeaf,
        requiredSans: sans,
        storedSansKey
      });
      const forceLocal =
        !!options?.forceLocalRenew ||
        leafDecision === 'missing' ||
        leafDecision === 'expired' ||
        leafDecision === 'expiring_soon' ||
        leafDecision === 'sans_mismatch';
      const material = await ensureLocalTlsMaterial(userDataDir, forceLocal, lanHosts);
      this.localCaPem = material.caCertPem;
      this.localFingerprint = material.fingerprintSha256;
      localTls = { cert: material.serverCertPem, key: material.serverKeyPem };
      const leafExpiry = certNotAfterMs(material.serverCertPem);
      if (leafExpiry) this.validUntilIso = new Date(leafExpiry).toISOString();
      if (options?.startup && forceLocal && leafDecision !== 'ok') {
        console.info('[PhoneTls] Local leaf certificate regenerated (' + leafDecision + ').');
      }
      if (!tailscaleTls) nextMode = 'local';
    } catch (e: any) {
      const msg = 'Local HTTPS certificate failed: ' + (e.message || String(e));
      this.tlsError = this.tlsError ? `${this.tlsError} · ${msg}` : msg;
    }

    let nextTls: PhoneServerTls | null = null;
    if (tailscaleTls && localTls) {
      nextTls = this.buildSniBundle(localTls, tailscaleTls);
      nextMode = 'tailscale';
    } else if (localTls) {
      nextTls = localTls;
      nextMode = 'local';
    } else if (tailscaleTls) {
      nextTls = tailscaleTls;
      nextMode = 'tailscale';
    } else {
      nextMode = 'unavailable';
      if (!this.tlsError) this.tlsError = 'HTTPS certificate is not ready. Phone tools stay offline until a certificate works.';
    }

    if (nextTls) {
      this.serverTls = nextTls;
      this.lastMode = nextMode;
      if (!this.certStatusDetail) {
        const until = this.tailscaleCertExpiresAt || this.validUntilIso;
        this.certStatusDetail = until ? `Valid until ${this.formatValidUntil(until)}.` : 'Certificate is valid.';
      }
    } else if (previousTls) {
      this.serverTls = previousTls;
      this.tlsError = this.tlsError || previousError;
      this.lastMode = previousTls.sniCert ? 'tailscale' : 'local';
    } else {
      this.serverTls = null;
      this.lastMode = 'unavailable';
    }
    this.hadTlsReady = !!this.serverTls;
  }

  private async notifyReload() {
    for (const cb of this.reloadCallbacks) await cb();
  }

  private tlsFixHint(tailscaleError?: string): string {
    return [
      'In the Tailscale admin console, enable MagicDNS and HTTPS Certificates (DNS settings).',
      'Sign in to Tailscale on this PC and confirm `tailscale status` shows your machine.',
      tailscaleError ? `Then run: tailscale cert ${this.tailscaleCertHostname || '<your-magicdns-name>'}` : '',
      'For local network mode, install the desktop CA from the trust page (port 48730), then use Retry certificate here.'
    ]
      .filter(Boolean)
      .join(' ');
  }

  transportLabel(mode: PhoneTlsPublicStatus['mode'], tlsReady: boolean): string {
    if (!tlsReady) return 'HTTPS unavailable (certificate not ready)';
    if (mode === 'tailscale') return 'HTTPS · Tailscale certificate';
    if (mode === 'local') return 'HTTPS · local CA';
    return 'HTTPS';
  }

  async publicStatus(
    useTailscale: boolean,
    primaryLanHost: string,
    options?: { hubPort?: number; installPath?: string }
  ): Promise<PhoneTlsPublicStatus> {
    const tailscale = await detectTailscale();
    const trustHost = useTailscale
      ? tailscale.hostname?.replace(/\.$/, '') || primaryLanHost
      : primaryLanHost;
    const hubPort = options?.hubPort || 48734;
    const installPath = options?.installPath || '/install';
    const installUrl = buildPhoneOrigin(trustHost, hubPort, false) + installPath;
    const caTrustHttpUrl = `http://${trustHost}:${PHONE_CA_TRUST_PORT}/?next=${encodeURIComponent(installUrl)}`;
    let caTrustQr = '';
    try {
      caTrustQr = await QRCode.toDataURL(caTrustHttpUrl);
    } catch { /* ignore */ }

    const tlsReady = !!this.getServerTls();
    const mode = tlsReady ? this.lastMode : this.lastMode === 'unavailable' ? 'unavailable' : 'pending';
    const certPem = this.serverTls?.sniCert
      ? String(this.serverTls.sniCert)
      : this.serverTls?.cert
        ? String(this.serverTls.cert)
        : '';
    let leafSans: string[] = [];
    let leafExpiresAt = this.tailscaleCertExpiresAt;
    let sanCoversHostname = true;
    if (certPem) {
      try {
        const info = parseLeafCertInfo(certPem);
        leafSans = info.sans;
        if (!leafExpiresAt) leafExpiresAt = info.notAfter;
        sanCoversHostname = leafCoversHost(certPem, trustHost);
      } catch { /* ignore */ }
    } else if (this.serverTls?.cert) {
      try {
        const info = parseLeafCertInfo(String(this.serverTls.cert));
        leafSans = info.sans;
        leafExpiresAt = info.notAfter;
        sanCoversHostname = leafCoversHost(String(this.serverTls.cert), trustHost);
      } catch { /* ignore */ }
    }
    const requiresCaTrust = !this.usingTailscaleCert && mode === 'local';
    let tlsError = this.tlsError;
    if (tlsReady && !sanCoversHostname) {
      tlsError = `Certificate does not list ${trustHost} in its names (SAN). Phones will show a TLS error until the cert is regenerated for this address.`;
    } else if (!tlsReady) {
      tlsError =
        tlsError ||
        'HTTPS certificate is not ready. Phone tools on ports 48731–48734 are offline (no HTTP fallback).';
    }
    const fixHint = tlsError ? this.tlsFixHint(tailscale.error) : '';
    return {
      tlsReady,
      tlsError,
      tlsFixHint: fixHint,
      transport: this.transportLabel(mode, tlsReady),
      allowInsecureHttp: false,
      phoneUseHttps: true,
      httpFallback: false,
      mode,
      caFingerprint: this.localFingerprint,
      caTrustHttpUrl,
      caTrustQr,
      usingTailscaleCert: this.usingTailscaleCert,
      tlsHostname: trustHost,
      tailscaleCertHostname: this.tailscaleCertHostname,
      leafSans,
      leafExpiresAt,
      tailscaleCertExpiresAt: this.tailscaleCertExpiresAt,
      sanCoversHostname,
      requiresCaTrust,
      installHttpsUrl: installUrl,
      certStatusDetail: this.certStatusDetail,
      validUntil: this.validUntilIso || leafExpiresAt || this.tailscaleCertExpiresAt
    };
  }

  buildToolBaseUrl(host: string, port: number): string {
    return buildPhoneOrigin(host, port, false);
  }
}
