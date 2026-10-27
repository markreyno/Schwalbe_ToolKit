import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { detectTailscale } from '../networkAllowlist';
import { ensureLocalTlsMaterial, leafCoversHost, parseLeafCertInfo } from './localCa';
import { obtainTailscaleCert } from './tailscaleCert';
import { buildPhoneOrigin } from './phoneUrls';
import { PHONE_CA_TRUST_PORT } from './caTrustServer';
import type { PhoneServerTls } from './phoneServer';

export type PhoneTlsPublicStatus = {
  tlsReady: boolean;
  tlsError: string;
  /** @deprecated Use phoneUseHttps — true when plain HTTP mode is active */
  allowInsecureHttp: boolean;
  phoneUseHttps: boolean;
  mode: 'tailscale' | 'local' | 'insecure' | 'http' | 'pending';
  caFingerprint: string;
  caTrustHttpUrl: string;
  caTrustQr: string;
  usingTailscaleCert: boolean;
  tlsHostname: string;
  leafSans: string[];
  leafExpiresAt: string;
  sanCoversHostname: boolean;
  requiresCaTrust: boolean;
  installHttpsUrl: string;
};

type Settings = { usePhoneHttps?: boolean; allowInsecureHttp?: boolean };

let testTlsOverride: PhoneServerTls | null = null;

export function setPhoneTlsTestMaterial(material: PhoneServerTls | null) {
  testTlsOverride = material;
}

export class PhoneTlsManager {
  private settingsPath: string;
  /** When false (default), phone tool servers use plain HTTP. */
  private usePhoneHttps = false;
  private tlsError = '';
  private localCaPem: string | null = null;
  private localFingerprint = '';
  private serverTls: PhoneServerTls | null = null;
  private usingTailscaleCert = false;
  private lastMode: PhoneTlsPublicStatus['mode'] = 'http';
  private reloadCallbacks: Array<() => Promise<void>> = [];

  constructor(userDataDir: string) {
    this.settingsPath = path.join(userDataDir, 'phone-tls-settings.json');
  }

  onReload(callback: () => Promise<void>) {
    this.reloadCallbacks.push(callback);
  }

  async load() {
    try {
      await fs.readFile(this.settingsPath, 'utf8');
    } catch (e: any) {
      if (e.code !== 'ENOENT') this.tlsError = 'Could not read phone TLS settings.';
    }
    // v1.6.6+: always use plain HTTP for phone tools; migrate away from legacy HTTPS settings.
    this.usePhoneHttps = false;
    this.lastMode = 'http';
    this.serverTls = null;
    this.usingTailscaleCert = false;
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify({ usePhoneHttps: false }));
  }

  getPhoneUseHttps() {
    return this.usePhoneHttps;
  }

  /** True when phone servers should listen on HTTP (default). */
  getPhoneHttpMode() {
    return !this.usePhoneHttps;
  }

  async setPhoneUseHttps(enabled: boolean) {
    this.usePhoneHttps = !!enabled;
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify({ usePhoneHttps: this.usePhoneHttps }));
    await this.notifyReload();
  }

  /** @deprecated Prefer setPhoneUseHttps(!enabled) */
  async setAllowInsecureHttp(enabled: boolean) {
    await this.setPhoneUseHttps(!enabled);
  }

  getAllowInsecureHttp() {
    return this.getPhoneHttpMode();
  }

  getCaPem(): string | null {
    return this.localCaPem;
  }

  getServerTls(): PhoneServerTls | null {
    if (this.getPhoneHttpMode()) return null;
    if (testTlsOverride) return testTlsOverride;
    return this.serverTls;
  }

  async refreshServerTls(useTailscale: boolean, extraHosts: string[] = []) {
    this.tlsError = '';
    this.serverTls = null;
    this.usingTailscaleCert = false;

    if (this.getPhoneHttpMode()) {
      this.lastMode = 'http';
      return;
    }

    this.lastMode = 'pending';

    if (testTlsOverride) {
      this.serverTls = testTlsOverride;
      this.lastMode = 'local';
      return;
    }

    const tailscale = await detectTailscale();
    if (useTailscale) {
      if (!tailscale.hostname) {
        this.tlsError = tailscale.error || 'Tailscale MagicDNS name is required for HTTPS phone links.';
        return;
      }
      try {
        const certDir = path.join(path.dirname(this.settingsPath), 'phone-tailscale-certs');
        const files = await obtainTailscaleCert(tailscale.hostname, certDir);
        this.serverTls = { cert: files.certPem, key: files.keyPem };
        this.usingTailscaleCert = true;
        this.lastMode = 'tailscale';
        return;
      } catch (e: any) {
        this.tlsError = 'Tailscale certificate failed: ' + (e.message || String(e));
        return;
      }
    }

    try {
      const userDataDir = path.dirname(this.settingsPath);
      const material = await ensureLocalTlsMaterial(userDataDir, false, extraHosts);
      this.localCaPem = material.caCertPem;
      this.localFingerprint = material.fingerprintSha256;
      this.serverTls = { cert: material.serverCertPem, key: material.serverKeyPem };
      this.lastMode = 'local';
      const primary = extraHosts[0] || '127.0.0.1';
      if (!leafCoversHost(material.serverCertPem, primary)) {
        this.tlsError = `HTTPS leaf certificate does not include ${primary}. Regenerating may be required after a network change.`;
      }
    } catch (e: any) {
      this.tlsError = 'Local HTTPS certificate failed: ' + (e.message || String(e));
    }
  }

  private async notifyReload() {
    for (const cb of this.reloadCallbacks) await cb();
  }

  async publicStatus(
    useTailscale: boolean,
    primaryLanHost: string,
    options?: { hubPort?: number; installPath?: string }
  ): Promise<PhoneTlsPublicStatus> {
    const tailscale = await detectTailscale();
    const trustHost = useTailscale ? tailscale.hostname?.replace(/\.$/, '') || primaryLanHost : primaryLanHost;
    const hubPort = options?.hubPort || 48734;
    const installPath = options?.installPath || '/install';
    const installUrl = this.buildToolBaseUrl(trustHost, hubPort) + installPath;
    const caTrustHttpUrl = `http://${trustHost}:${PHONE_CA_TRUST_PORT}/?next=${encodeURIComponent(installUrl)}`;
    let caTrustQr = '';
    try {
      caTrustQr = await QRCode.toDataURL(caTrustHttpUrl);
    } catch { /* ignore */ }

    if (this.getPhoneHttpMode()) {
      return {
        tlsReady: true,
        tlsError: '',
        allowInsecureHttp: true,
        phoneUseHttps: false,
        mode: 'http',
        caFingerprint: '',
        caTrustHttpUrl,
        caTrustQr,
        usingTailscaleCert: false,
        tlsHostname: trustHost,
        leafSans: [],
        leafExpiresAt: '',
        sanCoversHostname: true,
        requiresCaTrust: false,
        installHttpsUrl: installUrl
      };
    }

    const tlsReady = !!this.getServerTls();
    const mode = this.lastMode;
    const certPem = this.serverTls?.cert ? String(this.serverTls.cert) : '';
    let leafSans: string[] = [];
    let leafExpiresAt = '';
    let sanCoversHostname = true;
    if (certPem) {
      try {
        const info = parseLeafCertInfo(certPem);
        leafSans = info.sans;
        leafExpiresAt = info.notAfter;
        sanCoversHostname = leafCoversHost(certPem, trustHost);
      } catch { /* ignore */ }
    }
    const requiresCaTrust = !this.usingTailscaleCert && mode === 'local';
    let tlsError = this.tlsError;
    if (tlsReady && !sanCoversHostname) {
      tlsError = `Certificate does not list ${trustHost} in its names (SAN). Phones will show a TLS error until the cert is regenerated for this address.`;
    } else if (!tlsReady) {
      tlsError = tlsError || 'HTTPS certificate is not ready.';
    }
    return {
      tlsReady,
      tlsError,
      allowInsecureHttp: false,
      phoneUseHttps: true,
      mode,
      caFingerprint: this.localFingerprint,
      caTrustHttpUrl,
      caTrustQr,
      usingTailscaleCert: this.usingTailscaleCert,
      tlsHostname: trustHost,
      leafSans,
      leafExpiresAt,
      sanCoversHostname,
      requiresCaTrust,
      installHttpsUrl: installUrl
    };
  }

  buildToolBaseUrl(host: string, port: number): string {
    return buildPhoneOrigin(host, port, this.getPhoneHttpMode());
  }
}
