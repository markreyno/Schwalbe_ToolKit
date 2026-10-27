import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { detectPreferredLanAddress, detectTailscale, isPrivateIP } from './networkAllowlist';
import type { ConnectPwaToolLink } from './toolPhoneUrls';
import { isAllowedHubHost, normalizeHubHost } from './toolPhoneUrls';
import type { PhoneTlsManager } from './tls/phoneTlsManager';
import { startPhoneToolServer, type PhoneServerHandle } from './tls/phoneServer';
import { buildPhoneAddressList, listPhoneUrlHosts } from './tls/phoneUrls';
import { PWA_CACHE_VERSION_PLACEHOLDER } from './connectPwa/pwaCache';
import type { PickerWaterBridge } from './pickerWaterBridge';

export const CONNECT_PWA_PORT = 48734;
const FREIGHT_PORT = 48731;
const PALLETVISION_PORT = 48732;

type DeviceRecord = { id: string; userAgent: string; ip: string; lastSeen: string };

export class ConnectPwaServer {
  private phoneHandle?: PhoneServerHandle;
  private port = 0;
  private error = '';
  private preferredAddress = '';
  private manualAddress = '';
  private useTailscale = false;
  private devices = new Map<string, DeviceRecord>();
  private assetDir = path.join(__dirname, 'connectPwa');
  private appRoot = path.join(__dirname, '..');
  private appVersion?: string;

  constructor(
    private settingsPath: string,
    private tlsManager: PhoneTlsManager,
    private toolsForHost?: (host: string) => Promise<ConnectPwaToolLink[]>,
    private pickerWater: PickerWaterBridge | null = null
  ) {}

  async start() {
    this.preferredAddress = await detectPreferredLanAddress();
    try {
      const data = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      this.useTailscale = !!data.useTailscale;
      this.manualAddress = data.manualAddress || '';
    } catch (e: any) {
      if (e.code !== 'ENOENT') this.error = 'Could not read Connect PWA settings.';
    }
    await this.restartPhoneListener();
  }

  private async phoneTlsHosts() {
    const { hosts } = await listPhoneUrlHosts({
      useTailscale: this.useTailscale,
      preferredLanAddress: this.preferredAddress,
      manualAddress: this.manualAddress,
      allowInsecureHttp: this.tlsManager.getPhoneHttpMode()
    });
    return hosts;
  }

  async restartPhoneListener() {
    if (this.phoneHandle) await this.phoneHandle.close();
    this.phoneHandle = undefined;
    this.port = 0;
    const hosts = await this.phoneTlsHosts();
    await this.tlsManager.refreshServerTls(this.useTailscale, hosts);
    const tls = this.tlsManager.getServerTls();
    const allowInsecure = this.tlsManager.getAllowInsecureHttp();
    if (!tls && !allowInsecure) {
      const status = await this.tlsManager.publicStatus(this.useTailscale, this.preferredAddress || '127.0.0.1');
      this.error = status.tlsError || 'HTTPS is required for phone links.';
      return;
    }
    try {
      this.phoneHandle = await startPhoneToolServer({
        port: CONNECT_PWA_PORT,
        tls,
        allowInsecureHttp: allowInsecure,
        handler: (req, res) => {
          void this.handle(req, res).catch(e => {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end(e instanceof Error ? e.message : String(e));
            }
          });
        }
      });
      this.port = this.phoneHandle.port;
      this.error = '';
    } catch (e: any) {
      this.error = e.message || String(e);
    }
  }

  stop() {
    void this.phoneHandle?.close();
  }

  async setTailscaleMode(enabled?: boolean) {
    this.useTailscale = !!enabled;
    await this.persist();
    await this.restartPhoneListener();
  }

  async setManualAddress(address?: string) {
    const trimmed = (address || '').trim();
    if (!trimmed) {
      this.manualAddress = '';
    } else if (!isPrivateIP(trimmed)) {
      throw new Error('Manual address must be a private network IP (RFC1918, link-local, or Tailscale).');
    } else {
      this.manualAddress = trimmed;
    }
    await this.persist();
    await this.restartPhoneListener();
  }

  private async persist() {
    await fs.writeFile(this.settingsPath, JSON.stringify({ useTailscale: this.useTailscale, manualAddress: this.manualAddress }));
  }

  private deviceKey(req: http.IncomingMessage) {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const ua = req.headers['user-agent'] || 'unknown';
    return createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 16);
  }

  private touchDevice(req: http.IncomingMessage) {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const id = this.deviceKey(req);
    this.devices.set(id, { id, ip, userAgent: req.headers['user-agent'] || 'unknown', lastSeen: new Date().toISOString() });
    if (this.devices.size > 50) {
      const sorted = [...this.devices.values()].sort((a, b) => a.lastSeen.localeCompare(b.lastSeen));
      for (let i = 0; i < sorted.length - 50; i++) this.devices.delete(sorted[i].id);
    }
  }

  private probePhonePort(port: number): Promise<boolean> {
    const useHttp = this.tlsManager.getPhoneHttpMode();
    return new Promise(resolve => {
      const req = (useHttp ? http.get : https.get)(
        useHttp
          ? { host: '127.0.0.1', port, path: '/', timeout: 1500 }
          : { host: '127.0.0.1', port, path: '/', timeout: 1500, rejectUnauthorized: false },
        res => {
          res.resume();
          resolve(res.statusCode !== undefined && res.statusCode < 500);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  private async reachability() {
    const [freight, palletvision] = await Promise.all([this.probePhonePort(FREIGHT_PORT), this.probePhonePort(PALLETVISION_PORT)]);
    return { freightReachable: freight, palletvisionReachable: palletvision, desktopReachable: freight || palletvision };
  }

  private async buildAddressUrls(): Promise<string[]> {
    const insecure = this.tlsManager.getPhoneHttpMode();
    const { hosts } = await listPhoneUrlHosts({
      useTailscale: this.useTailscale,
      preferredLanAddress: this.preferredAddress,
      manualAddress: this.manualAddress,
      allowInsecureHttp: insecure
    });
    return buildPhoneAddressList(hosts, this.port || CONNECT_PWA_PORT, insecure);
  }

  async status() {
    const tailscale = await detectTailscale();
    const addressUrls = await this.buildAddressUrls();
    const base = addressUrls[0] || this.tlsManager.buildToolBaseUrl('127.0.0.1', this.port || CONNECT_PWA_PORT);
    const reach = await this.reachability();
    const devices = [...this.devices.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const primaryHost = (await this.phoneTlsHosts())[0] || this.preferredAddress || this.manualAddress || '127.0.0.1';
    const phoneTls = await this.tlsManager.publicStatus(this.useTailscale, primaryHost, {
      hubPort: this.port || CONNECT_PWA_PORT
    });
    const scanUrl = phoneTls.phoneUseHttps && phoneTls.requiresCaTrust ? phoneTls.caTrustHttpUrl : phoneTls.installHttpsUrl;
    return {
      running: !!this.port,
      port: this.port,
      error: this.error || phoneTls.tlsError,
      addresses: addressUrls,
      useTailscale: this.useTailscale,
      tailscale: { available: !tailscale.error, address: tailscale.address, hostname: tailscale.hostname, error: tailscale.error },
      qrUrl: scanUrl,
      qr: await QRCode.toDataURL(scanUrl),
      phoneTls,
      devices,
      reachability: { freight: reach.freightReachable, palletvision: reach.palletvisionReachable },
      manualAddress: this.manualAddress
    };
  }

  private async readAsset(name: string) {
    return fs.readFile(path.join(this.assetDir, name));
  }

  private async getAppVersion() {
    if (!this.appVersion) {
      const pkg = JSON.parse(await fs.readFile(path.join(this.appRoot, 'package.json'), 'utf8'));
      this.appVersion = String(pkg.version || '0.0.0');
    }
    return this.appVersion;
  }

  private async readServiceWorker() {
    const template = await fs.readFile(path.join(this.assetDir, 'sw.js'), 'utf8');
    const version = await this.getAppVersion();
    return Buffer.from(template.replaceAll(PWA_CACHE_VERSION_PLACEHOLDER, version), 'utf8');
  }

  private manifestOrigin(req: http.IncomingMessage) {
    const host = req.headers.host || `127.0.0.1:${this.port || CONNECT_PWA_PORT}`;
    const scheme = this.tlsManager.getPhoneHttpMode() ? 'http' : 'https';
    return `${scheme}://${host}`;
  }

  private async readManifest(req: http.IncomingMessage) {
    const origin = this.manifestOrigin(req);
    const base = JSON.parse(await fs.readFile(path.join(this.assetDir, 'manifest.webmanifest'), 'utf8'));
    const manifest = {
      ...base,
      related_applications: [{ platform: 'webapp', url: `${origin}/manifest.webmanifest` }],
      prefer_related_applications: false
    };
    return Buffer.from(JSON.stringify(manifest), 'utf8');
  }

  private contentType(name: string) {
    if (name.endsWith('.html')) return 'text/html; charset=utf-8';
    if (name.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (name.endsWith('.webmanifest')) return 'application/manifest+json; charset=utf-8';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.css')) return 'text/css; charset=utf-8';
    return 'application/octet-stream';
  }

  private async readJsonBody(req: http.IncomingMessage, maxBytes: number) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Request body too large.');
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const clientIP = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (clientIP && !isPrivateIP(clientIP)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied. Connect PWA only accepts connections from private networks. Your IP: ' + clientIP);
      return;
    }
    this.touchDevice(req);
    const url = new URL(req.url || '/', 'http://local');
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const reach = await this.reachability();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(reach));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/picker-water/notifications') {
      if (!this.pickerWater) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ count: 0, items: [] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(this.pickerWater.notifications()));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/push/vapid-public-key') {
      const key = this.pickerWater?.vapidPublicKey();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ publicKey: key || null }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
      if (!this.pickerWater) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Push is unavailable.' }));
        return;
      }
      const body = await this.readJsonBody(req, 16_384);
      await this.pickerWater.savePushSubscription(body);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ subscribed: true }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/tools') {
      const hostParam = url.searchParams.get('host') || '';
      const host = normalizeHubHost(hostParam || req.headers.host?.split(':')[0] || '');
      if (!isAllowedHubHost(host)) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Invalid or missing host parameter.' }));
        return;
      }
      if (!this.toolsForHost) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Tool links are unavailable.' }));
        return;
      }
      const tools = await this.toolsForHost(host);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ host, tools }));
      return;
    }
    const staticMap: Record<string, string> = {
      '/': 'connectPwaMobile.html',
      '/install': 'install.html',
      '/hub.css': 'hub.css',
      '/connectPwaMobile.js': 'connectPwaMobile.js',
      '/pwaInstallUi.js': 'pwaInstallUi.js',
      '/install.js': 'install.js',
      '/manifest.webmanifest': 'manifest.webmanifest',
      '/sw.js': 'sw.js',
      '/brand-logo.png': 'brand-logo.png',
      '/icon-192.png': 'icon-192.png',
      '/icon-512.png': 'icon-512.png',
      '/apple-touch-icon.png': 'apple-touch-icon.png'
    };
    const file = staticMap[url.pathname];
    if (req.method === 'GET' && file) {
      const body =
        file === 'sw.js'
          ? await this.readServiceWorker()
          : file === 'manifest.webmanifest'
            ? await this.readManifest(req)
            : await this.readAsset(file);
      const cache =
        file === 'connectPwaMobile.html' ||
        file === 'install.html' ||
        file === 'connectPwaMobile.js' ||
        file === 'pwaInstallUi.js' ||
        file === 'install.js' ||
        file === 'manifest.webmanifest' ||
        file === 'sw.js'
          ? 'no-store'
          : 'public, max-age=3600';
      res.writeHead(200, { 'Content-Type': this.contentType(file), 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}
