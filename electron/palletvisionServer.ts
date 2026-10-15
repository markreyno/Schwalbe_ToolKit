import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { mobilePage } from './palletvisionMobile';

function isPrivateIP(ip: string): boolean {
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

async function detectTailscale(): Promise<{ address?: string; hostname?: string; error?: string }> {
  try {
    const { stdout } = await promisify(execFile)('tailscale', ['status', '--json'], { timeout: 3000 });
    const status = JSON.parse(stdout);
    if (!status.Self) return { error: 'Tailscale is not connected' };
    const selfAddresses = status.Self.TailscaleIPs || [];
    const ipv4 = selfAddresses.find((ip: string) => ip.includes('.'));
    const hostname = status.Self.DNSName ? status.Self.DNSName.replace(/\.$/, '') : undefined;
    return { address: ipv4, hostname };
  } catch (e: any) {
    if (e.code === 'ENOENT') return { error: 'Tailscale is not installed' };
    return { error: 'Tailscale detection failed: ' + e.message };
  }
}

const token = () => randomBytes(24).toString('hex');

type Pallet = {
  id: string;
  captureId: string;
  heightInches: number;
  widthInches: number;
  lengthInches: number;
  notes?: string;
  referenceId?: string;
  capturedAt: string;
  deviceToken: string;
  folder: string;
  processingStatus: 'pending' | 'extracting' | 'complete' | 'failed';
  framesExtracted: number;
};

type Upload = { id: string; pallet: Pallet; tempPath?: string; expires: number };

export class PalletVisionServer {
  private server?: http.Server;
  private root = '';
  private deviceTokens = new Map<string, { token: string; createdAt: number }>();
  private pallets: Pallet[] = [];
  private uploads = new Map<string, Upload>();
  private port = 0;
  private preferredAddress = '';
  private useTailscale = false;
  private error = '';
  private writing = false;
  private persistence: Promise<void> = Promise.resolve();

  constructor(private settings: string) {}

  async start() {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1; if ($route) { Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress }"], { windowsHide: true, timeout: 8000 });
        const address = stdout.trim();
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) this.preferredAddress = address;
      } catch { /* Address selector remains available */ }
    }
    try { const data = JSON.parse(await fs.readFile(this.settings, 'utf8')); this.root = data.root || ''; this.deviceTokens = new Map(data.deviceTokens || []); this.pallets = data.pallets || []; this.useTailscale = data.useTailscale || false; } catch (e: any) { if (e.code !== 'ENOENT') this.error = 'Could not read PalletVision settings.'; }
    if (!this.root) this.root = path.join(os.homedir(), 'PalletVision', 'data');
    this.server = http.createServer((req, res) => { void this.handle(req, res).catch(e => { if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); } else res.end(); }); });
    await new Promise<void>(resolve => { this.server!.once('error', e => { this.error = e.message; resolve(); }); this.server!.listen(48732, '0.0.0.0', () => { this.port = 48732; resolve(); }); });
  }

  stop() { this.server?.close(); this.server?.closeAllConnections(); }

  private persist() {
    const snapshot = JSON.stringify({ root: this.root, deviceTokens: Array.from(this.deviceTokens.entries()), pallets: this.pallets, useTailscale: this.useTailscale });
    const next = this.persistence.catch(() => {}).then(async () => { await fs.mkdir(path.dirname(this.settings), { recursive: true }); const temp = this.settings + '.tmp'; await fs.writeFile(temp, snapshot); await fs.rename(temp, this.settings); });
    this.persistence = next;
    return next;
  }

  async setRoot(root: string) { if (this.writing) throw new Error('Wait for active upload to complete.'); await fs.access(root); this.root = root; await this.persist(); }
  
  async setTailscaleMode(enabled: boolean) { this.useTailscale = enabled; await this.persist(); }

  folder(id: string) { const p = this.pallets.find(p => p.id === id); if (!p) throw new Error('Pallet not found.'); return p.folder; }

  async status() {
    const tailscale = await detectTailscale();
    let urls: string[];
    if (this.useTailscale && tailscale.hostname) {
      urls = [`http://${tailscale.hostname}:${this.port}`];
    } else if (this.useTailscale && tailscale.address) {
      urls = [`http://${tailscale.address}:${this.port}`];
    } else {
      const addresses = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a!.address).sort((a, b) => Number(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(b)) - Number(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)));
      addresses.sort((a, b) => Number(b === this.preferredAddress) - Number(a === this.preferredAddress));
      urls = addresses.map(a => `http://${a}:${this.port}`);
    }
    const base = urls[0] || `http://127.0.0.1:${this.port}`;
    return { root: this.root, running: !!this.port, error: this.error, addresses: urls, useTailscale: this.useTailscale, tailscale: { available: !tailscale.error, address: tailscale.address, hostname: tailscale.hostname, error: tailscale.error }, qrUrl: `${base}/`, qr: await QRCode.toDataURL(`${base}/`), pallets: this.pallets.map(p => ({ ...p })) };
  }

  private async body(req: http.IncomingMessage, max: number) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('Upload exceeds the allowed size.'); chunks.push(chunk); } return Buffer.concat(chunks); }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const clientIP = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (clientIP && !isPrivateIP(clientIP)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied. PalletVision only accepts connections from private networks (RFC1918). Your IP: ' + clientIP);
      return;
    }
    const url = new URL(req.url || '/', 'http://local');
    if (req.headers.origin) {
      const originHost = new URL(req.headers.origin).host;
      if (originHost !== req.headers.host) {
        throw new Error('Invalid request origin. Origin host does not match request host.');
      }
    }
    const json = (value: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(mobilePage); return; }
    
    if (req.method === 'POST' && url.pathname === '/api/pair') {
      const deviceToken = token();
      this.deviceTokens.set(deviceToken, { token: deviceToken, createdAt: Date.now() });
      await this.persist();
      json({ deviceToken });
      return;
    }

    const authHeader = req.headers.authorization;
    const deviceToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!deviceToken || !this.deviceTokens.has(deviceToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized. Pair your device first.' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') { json({ status: 'ok', palletCount: this.pallets.length }); return; }

    if (req.method === 'POST' && url.pathname === '/api/pallets/upload') {
      if (this.writing) throw new Error('Another pallet is being processed. Retry.');
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) throw new Error('Expected multipart/form-data.');
      
      this.writing = true;
      try {
        const data = JSON.parse((await this.body(req, 500 * 1024 * 1024)).toString());
        const { captureId, heightInches, widthInches, lengthInches, notes, referenceId, capturedAt, videoBase64 } = data;
        
        if (!captureId || typeof captureId !== 'string') throw new Error('Missing or invalid captureId.');
        if (this.pallets.some(p => p.captureId === captureId)) {
          const existing = this.pallets.find(p => p.captureId === captureId)!;
          json({ palletId: existing.id, status: 'exists', processingStatus: existing.processingStatus });
          return;
        }
        
        if (typeof heightInches !== 'number' || heightInches <= 0) throw new Error('Invalid height.');
        if (typeof widthInches !== 'number' || widthInches <= 0) throw new Error('Invalid width.');
        if (typeof lengthInches !== 'number' || lengthInches <= 0) throw new Error('Invalid length.');
        if (!videoBase64 || typeof videoBase64 !== 'string') throw new Error('Missing video data.');
        
        const palletId = `pallet_${String(this.pallets.length + 1).padStart(4, '0')}`;
        const palletFolder = path.join(this.root, palletId);
        await fs.mkdir(palletFolder, { recursive: true });
        await fs.mkdir(path.join(palletFolder, 'frames'), { recursive: true });
        
        const videoPath = path.join(palletFolder, 'video.mp4');
        const videoBuffer = Buffer.from(videoBase64, 'base64');
        await fs.writeFile(videoPath, videoBuffer);
        
        const pallet: Pallet = {
          id: palletId,
          captureId,
          heightInches,
          widthInches,
          lengthInches,
          notes,
          referenceId,
          capturedAt: capturedAt || new Date().toISOString(),
          deviceToken,
          folder: palletFolder,
          processingStatus: 'pending',
          framesExtracted: 0
        };
        
        const metadata = {
          schema_version: 1,
          pallet_id: palletId,
          capture_id: captureId,
          captured_at: pallet.capturedAt,
          height_inches: heightInches,
          width_inches: widthInches,
          length_inches: lengthInches,
          height_includes_base: true,
          notes,
          reference_id: referenceId,
          video_file: 'video.mp4',
          device_token: deviceToken.slice(0, 8),
          annotation_status: 'unlabeled',
          processing_status: 'pending',
          frames_extracted: 0
        };
        
        await fs.writeFile(path.join(palletFolder, 'metadata.json'), JSON.stringify(metadata, null, 2));
        
        this.pallets.unshift(pallet);
        await this.persist();
        
        void this.extractFrames(pallet);
        
        json({ palletId, status: 'uploaded', processingStatus: 'pending' });
      } finally { this.writing = false; }
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/pallets/')) {
      const palletId = url.pathname.split('/')[3];
      const pallet = this.pallets.find(p => p.id === palletId);
      if (!pallet) { res.writeHead(404); res.end('Pallet not found.'); return; }
      json({ palletId: pallet.id, processingStatus: pallet.processingStatus, framesExtracted: pallet.framesExtracted });
      return;
    }

    throw new Error('Unknown request.');
  }

  private async extractFrames(pallet: Pallet) {
    try {
      pallet.processingStatus = 'extracting';
      await this.persist();
      
      const videoPath = path.join(pallet.folder, 'video.mp4');
      const framesDir = path.join(pallet.folder, 'frames');
      
      const targetFrames = 15;
      const ffmpegArgs = [
        '-i', videoPath,
        '-vf', `select='not(mod(n\\,5))',scale=640:-1`,
        '-frames:v', String(targetFrames),
        '-q:v', '2',
        path.join(framesDir, 'frame_%04d.jpg')
      ];
      
      await promisify(execFile)('ffmpeg', ffmpegArgs, { timeout: 60000 });
      
      const frames = await fs.readdir(framesDir);
      pallet.framesExtracted = frames.length;
      pallet.processingStatus = 'complete';
      
      const metadataPath = path.join(pallet.folder, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      metadata.frames_extracted = frames.length;
      metadata.processing_status = 'complete';
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      
      await this.persist();
    } catch (e: any) {
      pallet.processingStatus = 'failed';
      pallet.framesExtracted = 0;
      await this.persist();
    }
  }
}
