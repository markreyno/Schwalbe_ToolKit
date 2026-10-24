import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { detectTailscale } from '../networkAllowlist';
import { ensureLocalTlsMaterial } from './localCa';
import { obtainTailscaleCert } from './tailscaleCert';
import { buildPhoneOrigin } from './phoneUrls';
import { PHONE_CA_TRUST_PORT } from './caTrustServer';
import type { PhoneServerTls } from './phoneServer';

export type PhoneTlsPublicStatus = {
  tlsReady: boolean;
  tlsError: string;
  allowInsecureHttp: boolean;
  mode: 'tailscale' | 'local' | 'insecure' | 'pending';
  caFingerprint: string;
  caTrustHttpUrl: string;
  caTrustQr: string;
  usingTailscaleCert: boolean;
};

type Settings = { allowInsecureHttp?: boolean };

let testTlsOverride: PhoneServerTls | null = null;

export function setPhoneTlsTestMaterial(material: PhoneServerTls | null) {
  testTlsOverride = material;
}

export class PhoneTlsManager {
  private settingsPath: string;
  private allowInsecureHttp = false;
  private tlsError = '';
  private localCaPem: string | null = null;
  private localFingerprint = '';
  private serverTls: PhoneServerTls | null = null;
  private usingTailscaleCert = false;
  private lastMode: 'tailscale' | 'local' | 'insecure' | 'pending' = 'pending';
  private reloadCallbacks: Array<() => Promise<void>> = [];

  constructor(userDataDir: string) {
    this.settingsPath = path.join(userDataDir, 'phone-tls-settings.json');
  }

  onReload(callback: () => Promise<void>) {
    this.reloadCallbacks.push(callback);
  }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.settingsPath, 'utf8')) as Settings;
      this.allowInsecureHttp = !!data.allowInsecureHttp;
    } catch (e: any) {
      if (e.code !== 'ENOENT') this.tlsError = 'Could not read phone TLS settings.';
    }
  }

  async setAllowInsecureHttp(enabled: boolean) {
    this.allowInsecureHttp = !!enabled;
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify({ allowInsecureHttp: this.allowInsecureHttp }));
    await this.refreshServerTls(false);
    await this.notifyReload();
  }

  getAllowInsecureHttp() {
    return this.allowInsecureHttp;
  }

  getCaPem(): string | null {
    return this.localCaPem;
  }

  getServerTls(): PhoneServerTls | null {
    if (testTlsOverride) return testTlsOverride;
    if (this.allowInsecureHttp && !this.serverTls) return null;
    return this.serverTls;
  }

  async refreshServerTls(useTailscale: boolean, preferredHost?: string) {
    this.tlsError = '';
    this.serverTls = null;
    this.usingTailscaleCert = false;
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
      const material = await ensureLocalTlsMaterial(userDataDir);
      this.localCaPem = material.caCertPem;
      this.localFingerprint = material.fingerprintSha256;
      this.serverTls = { cert: material.serverCertPem, key: material.serverKeyPem };
      this.lastMode = 'local';
    } catch (e: any) {
      this.tlsError = 'Local HTTPS certificate failed: ' + (e.message || String(e));
    }
  }

  private async notifyReload() {
    for (const cb of this.reloadCallbacks) await cb();
  }

  async publicStatus(useTailscale: boolean, primaryLanHost: string): Promise<PhoneTlsPublicStatus> {
    const trustHost = useTailscale ? (await detectTailscale()).hostname?.replace(/\.$/, '') || primaryLanHost : primaryLanHost;
    const caTrustHttpUrl = `http://${trustHost}:${PHONE_CA_TRUST_PORT}/`;
    let caTrustQr = '';
    try {
      caTrustQr = await QRCode.toDataURL(caTrustHttpUrl);
    } catch { /* ignore */ }
    const tlsReady = !!this.getServerTls();
    const mode = this.allowInsecureHttp && !tlsReady ? 'insecure' : this.lastMode;
    return {
      tlsReady,
      tlsError: tlsReady ? '' : this.tlsError || 'HTTPS certificate is not ready.',
      allowInsecureHttp: this.allowInsecureHttp,
      mode,
      caFingerprint: this.localFingerprint,
      caTrustHttpUrl,
      caTrustQr,
      usingTailscaleCert: this.usingTailscaleCert
    };
  }

  buildToolBaseUrl(host: string, port: number): string {
    if (this.allowInsecureHttp && !this.getServerTls()) return buildPhoneOrigin(host, port, true);
    return buildPhoneOrigin(host, port, false);
  }
}
