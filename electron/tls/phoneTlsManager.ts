import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { detectTailscale } from '../networkAllowlist';
import { ensureLocalTlsMaterial, leafCoversHost, parseLeafCertInfo } from './localCa';
import { obtainTailscaleCert, tailscaleCertExpiryIso } from './tailscaleCert';
import { buildPhoneOrigin } from './phoneUrls';
import { PHONE_CA_TRUST_PORT } from './caTrustServer';
import type { PhoneServerTls } from './phoneServer';

export type PhoneTlsPublicStatus = {
  tlsReady: boolean;
  tlsError: string;
  tlsFixHint: string;
  transport: string;
  /** @deprecated Use phoneUseHttps — true when plain HTTP mode is active for URLs/servers */
  allowInsecureHttp: boolean;
  phoneUseHttps: boolean;
  httpFallback: boolean;
  mode: 'tailscale' | 'local' | 'insecure' | 'http' | 'http-fallback' | 'pending';
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
};

type Settings = { usePhoneHttps?: boolean; allowInsecureHttp?: boolean };

let testTlsOverride: PhoneServerTls | null = null;

export function setPhoneTlsTestMaterial(material: PhoneServerTls | null) {
  testTlsOverride = material;
}

const TAILSCALE_SNI_SUFFIX = '.ts.net';
const MAINTENANCE_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;

export class PhoneTlsManager {
  private settingsPath: string;
  /** User preference: HTTPS for phone tools (default on). */
  private usePhoneHttps = true;
  /** True when HTTPS is desired but no cert is available — serve and link HTTP until fixed. */
  private httpFallbackActive = false;
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

  constructor(userDataDir: string) {
    this.settingsPath = path.join(userDataDir, 'phone-tls-settings.json');
  }

  onReload(callback: () => Promise<void>) {
    this.reloadCallbacks.push(callback);
  }

  async load() {
    let parsed: Settings = {};
    try {
      parsed = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
    } catch (e: any) {
      if (e.code !== 'ENOENT') this.tlsError = 'Could not read phone TLS settings.';
    }
    if (parsed.usePhoneHttps === undefined && parsed.allowInsecureHttp !== undefined) {
      this.usePhoneHttps = !parsed.allowInsecureHttp;
    } else if (parsed.usePhoneHttps === undefined) {
      this.usePhoneHttps = true;
    } else {
      this.usePhoneHttps = !!parsed.usePhoneHttps;
    }
    this.httpFallbackActive = false;
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify({ usePhoneHttps: this.usePhoneHttps }));
  }

  startCertificateMaintenance() {
    if (this.maintenanceTimer) return;
    this.maintenanceTimer = setInterval(() => {
      void this.maintainCertificates();
    }, MAINTENANCE_MS);
    this.retryTimer = setInterval(() => {
      if (this.usePhoneHttps && (this.httpFallbackActive || this.tlsError)) void this.maintainCertificates();
    }, RETRY_MS);
  }

  getPhoneUseHttps() {
    return this.usePhoneHttps;
  }

  /** True when phone servers and public URLs should use HTTP. */
  getPhoneHttpMode() {
    return !this.usePhoneHttps || this.httpFallbackActive;
  }

  isHttpFallback() {
    return this.httpFallbackActive;
  }

  async setPhoneUseHttps(enabled: boolean) {
    this.usePhoneHttps = !!enabled;
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify({ usePhoneHttps: this.usePhoneHttps }));
    await this.maintainCertificates(true);
    await this.notifyReload();
  }

  /** @deprecated Prefer setPhoneUseHttps(!enabled) */
  async setAllowInsecureHttp(enabled: boolean) {
    await this.setPhoneUseHttps(!enabled);
  }

  getAllowInsecureHttp() {
    return this.getPhoneHttpMode();
  }

  async retryCertificate() {
    await this.maintainCertificates(true);
    await this.notifyReload();
  }

  getCaPem(): string | null {
    return this.localCaPem;
  }

  getServerTls(): PhoneServerTls | null {
    if (this.getPhoneHttpMode()) return null;
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

  async maintainCertificates(forceRenew = false) {
    await this.refreshServerTls(this.lastRefreshOpts.useTailscale, this.lastRefreshOpts.hosts, forceRenew);
    const wasFallback = this.httpFallbackActive;
    if (wasFallback && !this.httpFallbackActive && this.usePhoneHttps) await this.notifyReload();
  }

  async refreshServerTls(useTailscale: boolean, extraHosts: string[] = [], forceTailscaleRenew = false) {
    this.lastRefreshOpts = { useTailscale, hosts: extraHosts };
    this.tlsError = '';
    this.serverTls = null;
    this.usingTailscaleCert = false;
    this.tailscaleCertHostname = '';
    this.tailscaleCertExpiresAt = '';

    if (!this.usePhoneHttps) {
      this.httpFallbackActive = false;
      this.lastMode = 'http';
      return;
    }

    this.lastMode = 'pending';

    if (testTlsOverride) {
      this.serverTls = testTlsOverride;
      this.httpFallbackActive = false;
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
        const files = await obtainTailscaleCert(magicHost, certDir, { forceRenew: forceTailscaleRenew });
        tailscaleTls = { cert: files.certPem, key: files.keyPem };
        this.usingTailscaleCert = true;
        this.tailscaleCertHostname = magicHost;
        this.tailscaleCertExpiresAt = tailscaleCertExpiryIso(files.certPem);
      } catch (e: any) {
        this.tlsError = 'Tailscale certificate failed: ' + (e.message || String(e));
      }
    }

    const lanHosts = [...new Set([...extraHosts, tailscale.address, '127.0.0.1'].filter(Boolean) as string[])];
    try {
      const userDataDir = path.dirname(this.settingsPath);
      const material = await ensureLocalTlsMaterial(userDataDir, false, lanHosts);
      this.localCaPem = material.caCertPem;
      this.localFingerprint = material.fingerprintSha256;
      localTls = { cert: material.serverCertPem, key: material.serverKeyPem };
      if (!tailscaleTls) this.lastMode = 'local';
    } catch (e: any) {
      const msg = 'Local HTTPS certificate failed: ' + (e.message || String(e));
      this.tlsError = this.tlsError ? `${this.tlsError} · ${msg}` : msg;
    }

    if (tailscaleTls && localTls) {
      this.serverTls = this.buildSniBundle(localTls, tailscaleTls);
      this.lastMode = 'tailscale';
      this.httpFallbackActive = false;
    } else if (localTls) {
      this.serverTls = localTls;
      this.lastMode = 'local';
      this.httpFallbackActive = false;
    } else if (tailscaleTls) {
      this.serverTls = tailscaleTls;
      this.lastMode = 'tailscale';
      this.httpFallbackActive = false;
    } else {
      this.httpFallbackActive = true;
      this.lastMode = 'http-fallback';
      if (!this.tlsError) this.tlsError = 'HTTPS certificate is not ready.';
    }
  }

  private async notifyReload() {
    for (const cb of this.reloadCallbacks) await cb();
  }

  private tlsFixHint(tailscaleError?: string): string {
    return [
      'In the Tailscale admin console, enable MagicDNS and HTTPS Certificates (DNS settings).',
      'Sign in to Tailscale on this PC and confirm `tailscale status` shows your machine.',
      tailscaleError ? `Then run: tailscale cert ${this.tailscaleCertHostname || '<your-magicdns-name>'}` : '',
      'Use Retry certificate on this page after fixing Tailscale.'
    ]
      .filter(Boolean)
      .join(' ');
  }

  transportLabel(mode: PhoneTlsPublicStatus['mode'], tlsReady: boolean): string {
    if (!this.usePhoneHttps) return 'HTTP (phone HTTPS disabled)';
    if (mode === 'http-fallback') return 'HTTP fallback (certificate not ready)';
    if (!tlsReady) return 'HTTPS (pending certificate)';
    if (mode === 'tailscale') return 'HTTPS · Tailscale certificate';
    if (mode === 'local') return 'HTTPS · local CA';
    return 'HTTP';
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
    const urlInsecure = this.getPhoneHttpMode();
    const installUrl = buildPhoneOrigin(trustHost, hubPort, urlInsecure) + installPath;
    const caTrustHttpUrl = `http://${trustHost}:${PHONE_CA_TRUST_PORT}/?next=${encodeURIComponent(buildPhoneOrigin(trustHost, hubPort, false) + installPath)}`;
    let caTrustQr = '';
    try {
      caTrustQr = await QRCode.toDataURL(caTrustHttpUrl);
    } catch { /* ignore */ }

    if (!this.usePhoneHttps) {
      return {
        tlsReady: true,
        tlsError: '',
        tlsFixHint: '',
        transport: this.transportLabel('http', true),
        allowInsecureHttp: true,
        phoneUseHttps: false,
        httpFallback: false,
        mode: 'http',
        caFingerprint: '',
        caTrustHttpUrl,
        caTrustQr,
        usingTailscaleCert: false,
        tlsHostname: trustHost,
        tailscaleCertHostname: '',
        leafSans: [],
        leafExpiresAt: '',
        tailscaleCertExpiresAt: '',
        sanCoversHostname: true,
        requiresCaTrust: false,
        installHttpsUrl: installUrl
      };
    }

    const tlsReady = !!this.getServerTls();
    const mode = this.lastMode;
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
    if (this.httpFallbackActive) {
      tlsError = tlsError || 'HTTPS certificate is not ready. Phone links use HTTP until the certificate works.';
    } else if (tlsReady && !sanCoversHostname) {
      tlsError = `Certificate does not list ${trustHost} in its names (SAN). Phones will show a TLS error until the cert is regenerated for this address.`;
    } else if (!tlsReady && !this.httpFallbackActive) {
      tlsError = tlsError || 'HTTPS certificate is not ready.';
    }
    const fixHint = this.httpFallbackActive || tlsError ? this.tlsFixHint(tailscale.error) : '';
    return {
      tlsReady: tlsReady || this.httpFallbackActive,
      tlsError,
      tlsFixHint: fixHint,
      transport: this.transportLabel(mode, tlsReady),
      allowInsecureHttp: urlInsecure,
      phoneUseHttps: true,
      httpFallback: this.httpFallbackActive,
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
      installHttpsUrl: installUrl
    };
  }

  buildToolBaseUrl(host: string, port: number): string {
    return buildPhoneOrigin(host, port, this.getPhoneHttpMode());
  }
}
