import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { detectPreferredLanAddress, detectTailscale, isPrivateIP, listPrivateIpv4Addresses } from './networkAllowlist';

export const CONNECT_PWA_PORT = 48734;
const FREIGHT_PORT = 48731;
const PALLETVISION_PORT = 48732;

type DeviceRecord = { id: string; userAgent: string; ip: string; lastSeen: string };

export class ConnectPwaServer {
  private server?: http.Server;
  private httpsServer?: https.Server;
  private port = 0;
  private httpsPort = 0;
  private error = '';
  private preferredAddress = '';
  private manualAddress = '';
  private useTailscale = false;
  private devices = new Map<string, DeviceRecord>();
  private httpsUrl = '';
  private certAttempted = false;
  private assetDir = path.join(__dirname, 'connectPwa');

  constructor(private settingsPath: string) {}

  async start() {
    this.preferredAddress = await detectPreferredLanAddress();
    try {
      const data = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      this.useTailscale = !!data.useTailscale;
      this.manualAddress = data.manualAddress || '';
    } catch (e: any) {
      if (e.code !== 'ENOENT') this.error = 'Could not read Connect PWA settings.';
    }
    this.server = http.createServer((req, res) => {
      void this.handle(req, res).catch(e => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(e instanceof Error ? e.message : String(e));
        }
      });
    });
    await new Promise<void>(resolve => {
      this.server!.once('error', e => { this.error = e.message; resolve(); });
      this.server!.listen(CONNECT_PWA_PORT, '0.0.0.0', () => { this.port = CONNECT_PWA_PORT; resolve(); });
    });
    if (this.useTailscale) void this.tryTailscaleHttps();
  }

  stop() {
    this.server?.close();
    this.server?.closeAllConnections();
    this.httpsServer?.close();
    this.httpsServer?.closeAllConnections();
  }

  async setTailscaleMode(enabled?: boolean) {
    this.useTailscale = !!enabled;
    await this.persist();
    if (this.useTailscale) void this.tryTailscaleHttps();
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

  private async tryTailscaleHttps() {
    if (this.certAttempted) return;
    this.certAttempted = true;
    const tailscale = await detectTailscale();
    if (!tailscale.hostname) return;
    const certDir = path.join(path.dirname(this.settingsPath), 'connect-pwa-certs');
    const certFile = path.join(certDir, 'cert.pem');
    const keyFile = path.join(certDir, 'key.pem');
    try {
      await fs.mkdir(certDir, { recursive: true });
      await promisify(execFile)('tailscale', ['cert', '--cert-file', certFile, '--key-file', keyFile, tailscale.hostname], { timeout: 20000 });
      const [cert, key] = await Promise.all([fs.readFile(certFile), fs.readFile(keyFile)]);
      const handler = (req: http.IncomingMessage, res: http.ServerResponse) => { void this.handle(req, res); };
      this.httpsServer = https.createServer({ cert, key }, handler);
      const httpsPort = CONNECT_PWA_PORT + 1;
      await new Promise<void>((resolve, reject) => {
        this.httpsServer!.once('error', reject);
        this.httpsServer!.listen(httpsPort, '0.0.0.0', () => { this.httpsPort = httpsPort; resolve(); });
      });
      this.httpsUrl = `https://${tailscale.hostname}:${httpsPort}/`;
    } catch {
      this.httpsPort = 0;
      this.httpsUrl = '';
    }
  }

  private async probeLocal(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, res => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  private async reachability() {
    const [freight, palletvision] = await Promise.all([this.probeLocal(FREIGHT_PORT), this.probeLocal(PALLETVISION_PORT)]);
    return { freightReachable: freight, palletvisionReachable: palletvision, desktopReachable: freight || palletvision };
  }

  private async buildAddressUrls(): Promise<string[]> {
    const tailscale = await detectTailscale();
    let hosts: string[] = [];
    if (this.useTailscale && tailscale.hostname) hosts = [tailscale.hostname];
    else if (this.useTailscale && tailscale.address) hosts = [tailscale.address];
    else {
      hosts = listPrivateIpv4Addresses(this.preferredAddress);
      if (this.manualAddress && !hosts.includes(this.manualAddress)) hosts.unshift(this.manualAddress);
    }
    return hosts.map(h => `http://${h}:${this.port}`);
  }

  async status() {
    const tailscale = await detectTailscale();
    const addressUrls = await this.buildAddressUrls();
    const base = addressUrls[0] || `http://127.0.0.1:${this.port}`;
    const reach = await this.reachability();
    const devices = [...this.devices.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    return {
      running: !!this.port,
      port: this.port,
      httpsPort: this.httpsPort || undefined,
      error: this.error,
      addresses: addressUrls,
      useTailscale: this.useTailscale,
      tailscale: { available: !tailscale.error, address: tailscale.address, hostname: tailscale.hostname, error: tailscale.error },
      qrUrl: this.httpsUrl || `${base}/`,
      httpsUrl: this.httpsUrl || undefined,
      qr: await QRCode.toDataURL(this.httpsUrl || `${base}/`),
      devices,
      reachability: { freight: reach.freightReachable, palletvision: reach.palletvisionReachable },
      manualAddress: this.manualAddress
    };
  }

  private async readAsset(name: string) {
    return fs.readFile(path.join(this.assetDir, name));
  }

  private contentType(name: string) {
    if (name.endsWith('.html')) return 'text/html; charset=utf-8';
    if (name.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (name.endsWith('.webmanifest')) return 'application/manifest+json; charset=utf-8';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.css')) return 'text/css; charset=utf-8';
    return 'application/octet-stream';
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
    const staticMap: Record<string, string> = {
      '/': 'connectPwaMobile.html',
      '/hub.css': 'hub.css',
      '/connectPwaMobile.js': 'connectPwaMobile.js',
      '/manifest.webmanifest': 'manifest.webmanifest',
      '/sw.js': 'sw.js',
      '/brand-logo.png': 'brand-logo.png',
      '/icon-192.png': 'icon-192.png',
      '/icon-512.png': 'icon-512.png',
      '/apple-touch-icon.png': 'apple-touch-icon.png'
    };
    const file = staticMap[url.pathname];
    if (req.method === 'GET' && file) {
      const body = await this.readAsset(file);
      const cache = file === 'connectPwaMobile.html' ? 'no-store' : 'public, max-age=3600';
      res.writeHead(200, { 'Content-Type': this.contentType(file), 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}
