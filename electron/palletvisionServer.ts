import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import { createWriteStream, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import busboy from 'busboy';
import {
  PalletVisionUploadLog,
  apiErrorBody,
  DEVICE_TOKEN_MAX_AGE_MS,
  MAX_UPLOAD_BYTES,
  type PalletVisionErrorCode,
  type PalletVisionLogEntry,
  humanizeLogEntry
} from './palletvisionDiagnostics';

function getFFmpegPath(): string {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (typeof ffmpegStatic === 'string') {
      return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
    }
    return ffmpegStatic;
  } catch {
    return 'ffmpeg';
  }
}

function getMobilePage(): string {
  return readFileSync(path.join(__dirname, 'palletvisionMobile.html'), 'utf8');
}

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

async function moveVideoFile(source: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(source, dest);
  } catch (e: any) {
    if (e?.code === 'EXDEV') {
      await fs.copyFile(source, dest);
      await fs.unlink(source).catch(() => {});
    } else {
      throw e;
    }
  }
}

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

export class PalletVisionServer {
  private server?: http.Server;
  private httpsServer?: https.Server;
  private root = '';
  private deviceTokens = new Map<string, { token: string; createdAt: number }>();
  private pallets: Pallet[] = [];
  private port = 0;
  private httpsPort = 0;
  private httpsError = '';
  private preferredAddress = '';
  private useTailscale = false;
  private useTailscaleHttps = false;
  private error = '';
  private writing = false;
  private persistence: Promise<void> = Promise.resolve();
  private uploadLog: PalletVisionUploadLog;

  constructor(private settings: string, logsDir: string) {
    this.uploadLog = new PalletVisionUploadLog(logsDir);
  }

  getLogDirectory() {
    return this.uploadLog.directory();
  }

  getUploadLogEntries(filter: 'all' | 'failures' = 'failures', limit = 50) {
    return this.uploadLog.recent(filter, limit);
  }

  async exportLogs(destPath: string) {
    await this.uploadLog.exportTo(destPath);
  }

  private async networkLogContext(): Promise<Pick<PalletVisionLogEntry, 'networkMode' | 'tailscaleAvailable' | 'tailscaleError' | 'storageRoot'>> {
    const tailscale = await detectTailscale();
    return {
      networkMode: this.useTailscale ? 'tailscale' : 'local',
      tailscaleAvailable: !tailscale.error,
      tailscaleError: tailscale.error,
      storageRoot: this.root
    };
  }

  private async log(entry: Omit<PalletVisionLogEntry, 'ts'> & { ts?: string }) {
    const full: PalletVisionLogEntry = { ts: entry.ts || new Date().toISOString(), ...entry };
    await this.uploadLog.append(full);
  }

  private resolveAuth(authHeader?: string): { ok: true; token: string } | { ok: false; reason: 'missing' | 'invalid' | 'expired' } {
    if (!authHeader?.startsWith('Bearer ')) return { ok: false, reason: 'missing' };
    const tokenValue = authHeader.slice(7);
    const record = this.deviceTokens.get(tokenValue);
    if (!record) return { ok: false, reason: 'invalid' };
    if (Date.now() - record.createdAt > DEVICE_TOKEN_MAX_AGE_MS) return { ok: false, reason: 'expired' };
    return { ok: true, token: tokenValue };
  }

  private authCode(reason: 'missing' | 'invalid' | 'expired'): PalletVisionErrorCode {
    if (reason === 'missing') return 'AUTH_MISSING';
    if (reason === 'expired') return 'AUTH_EXPIRED';
    return 'AUTH_INVALID';
  }

  private authMessage(reason: 'missing' | 'invalid' | 'expired') {
    if (reason === 'missing') return 'Pair your device before using this feature.';
    if (reason === 'expired') return 'Device pairing expired. Open this page again to pair.';
    return 'Invalid device token. Open this page again to pair.';
  }

  private async readJsonBody(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (!chunks.length) return {} as Record<string, unknown>;
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  }

  private readonly onRequest = (req: IncomingMessage, res: ServerResponse) => {
    void this.handle(req, res).catch((e) => {
      if (!res.headersSent) {
        const code = (e as { palletvisionCode?: PalletVisionErrorCode }).palletvisionCode;
        const body = code ? apiErrorBody(code, e.message) : apiErrorBody('VALIDATION_ERROR', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      } else res.end();
    });
  };

  private respondError(
    res: ServerResponse,
    status: number,
    code: PalletVisionErrorCode,
    message: string,
    logFields: Partial<PalletVisionLogEntry> = {}
  ) {
    void this.log({
      event: logFields.event || 'request',
      outcome: 'failure',
      httpStatus: status,
      errorCode: code,
      message,
      ...logFields
    });
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(apiErrorBody(code, message)));
  }

  async start() {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1; if ($route) { Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress }"], { windowsHide: true, timeout: 8000 });
        const address = stdout.trim();
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) this.preferredAddress = address;
      } catch { /* Address selector remains available */ }
    }
    try {
      const data = JSON.parse(await fs.readFile(this.settings, 'utf8'));
      this.root = data.root || '';
      this.deviceTokens = new Map(data.deviceTokens || []);
      this.pallets = data.pallets || [];
      this.useTailscale = data.useTailscale || false;
      this.useTailscaleHttps = data.useTailscaleHttps || false;
    } catch (e: any) { if (e.code !== 'ENOENT') this.error = 'Could not read PalletVision settings.'; }
    if (!this.root) this.root = path.join(os.homedir(), 'PalletVision', 'data');
    this.server = http.createServer(this.onRequest);
    let bindError = '';
    await new Promise<void>((resolve) => {
      this.server!.once('error', (e) => {
        bindError = e.message;
        this.error = e.message;
        resolve();
      });
      this.server!.listen(48732, '0.0.0.0', () => {
        this.port = 48732;
        resolve();
      });
    });
    const net = await this.networkLogContext();
    await this.log({
      event: bindError ? 'server_bind' : 'server_start',
      outcome: bindError ? 'failure' : 'success',
      serverBindError: bindError || undefined,
      message: bindError || 'PalletVision upload server listening on port 48732',
      ...net
    });
    await this.restartHttps();
  }

  stop() {
    this.server?.close();
    this.server?.closeAllConnections();
    this.httpsServer?.close();
    this.httpsServer = undefined;
  }

  async setTailscaleHttpsMode(enabled: boolean) {
    if (!this.useTailscale && enabled) throw new Error('Enable Tailscale network mode first.');
    this.useTailscaleHttps = enabled;
    await this.persist();
    await this.restartHttps();
  }

  private async restartHttps() {
    if (this.httpsServer) {
      this.httpsServer.close();
      this.httpsServer = undefined;
      this.httpsPort = 0;
    }
    this.httpsError = '';
    if (!this.useTailscaleHttps) return;
    const tailscale = await detectTailscale();
    if (!tailscale.hostname) {
      this.httpsError = tailscale.error || 'Tailscale MagicDNS name is not available.';
      return;
    }
    const certDir = path.join(path.dirname(this.settings), 'palletvision-https');
    await fs.mkdir(certDir, { recursive: true });
    const certFile = path.join(certDir, 'cert.pem');
    const keyFile = path.join(certDir, 'key.pem');
    try {
      await promisify(execFile)('tailscale', ['cert', '--cert-file', certFile, '--key-file', keyFile, tailscale.hostname], { timeout: 120000 });
    } catch (e: any) {
      this.httpsError = `Could not obtain Tailscale certificate: ${e.message}`;
      const net = await this.networkLogContext();
      await this.log({ event: 'server_bind', outcome: 'failure', message: this.httpsError, serverBindError: e.message, ...net });
      return;
    }
    const key = await fs.readFile(keyFile);
    const cert = await fs.readFile(certFile);
    this.httpsServer = https.createServer({ key, cert }, this.onRequest);
    let bindError = '';
    await new Promise<void>((resolve) => {
      this.httpsServer!.once('error', (e) => { bindError = e.message; resolve(); });
      this.httpsServer!.listen(48733, '0.0.0.0', () => { this.httpsPort = 48733; resolve(); });
    });
    if (bindError) {
      this.httpsError = bindError;
      this.httpsServer?.close();
      this.httpsServer = undefined;
      this.httpsPort = 0;
    }
  }

  private persist() {
    const snapshot = JSON.stringify({ root: this.root, deviceTokens: Array.from(this.deviceTokens.entries()), pallets: this.pallets, useTailscale: this.useTailscale, useTailscaleHttps: this.useTailscaleHttps });
    const next = this.persistence.catch(() => {}).then(async () => { await fs.mkdir(path.dirname(this.settings), { recursive: true }); const temp = this.settings + '.tmp'; await fs.writeFile(temp, snapshot); await fs.rename(temp, this.settings); });
    this.persistence = next;
    return next;
  }

  async setRoot(root: string) { if (this.writing) throw new Error('Wait for active upload to complete.'); await fs.access(root); this.root = root; await this.persist(); }
  
  async setTailscaleMode(enabled: boolean) {
    this.useTailscale = enabled;
    if (!enabled) this.useTailscaleHttps = false;
    await this.persist();
    await this.restartHttps();
  }

  folder(id: string) { const p = this.pallets.find(p => p.id === id); if (!p) throw new Error('Pallet not found.'); return p.folder; }

  private stagingDir() { return path.join(this.root, '.tmp'); }

  private async ensureStagingDir() {
    const dir = this.stagingDir();
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private newStagingPath(ext: string, prefix: string) {
    return path.join(this.stagingDir(), `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`);
  }

  async updateMetadata(id: string, updates: { heightInches?: number; widthInches?: number; lengthInches?: number; device?: string; notes?: string; annotationsReviewed?: boolean }) {
    const pallet = this.pallets.find(p => p.id === id);
    if (!pallet) throw new Error('Pallet not found.');
    
    if (updates.heightInches !== undefined) {
      if (updates.heightInches <= 0) throw new Error('Height must be positive.');
      pallet.heightInches = updates.heightInches;
    }
    if (updates.widthInches !== undefined) {
      if (updates.widthInches <= 0) throw new Error('Width must be positive.');
      pallet.widthInches = updates.widthInches;
    }
    if (updates.lengthInches !== undefined) {
      if (updates.lengthInches <= 0) throw new Error('Length must be a positive.');
      pallet.lengthInches = updates.lengthInches;
    }
    if (updates.notes !== undefined) pallet.notes = updates.notes;
    
    const metadataPath = path.join(pallet.folder, 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    
    if (updates.heightInches !== undefined) metadata.height_inches = updates.heightInches;
    if (updates.widthInches !== undefined) metadata.width_inches = updates.widthInches;
    if (updates.lengthInches !== undefined) metadata.length_inches = updates.lengthInches;
    if (updates.device !== undefined) metadata.device = updates.device;
    if (updates.notes !== undefined) metadata.notes = updates.notes;
    if (updates.annotationsReviewed !== undefined) metadata.annotations_reviewed = updates.annotationsReviewed;
    
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    await this.persist();
  }

  async importVideo(videoPath: string, data: { heightInches: number; widthInches: number; lengthInches: number; notes?: string; referenceId?: string }) {
    if (this.writing) throw new Error('Another pallet is being processed. Wait and retry.');
    if (!this.root) throw new Error('Choose a storage folder first.');
    
    await fs.access(videoPath);
    
    const ext = path.extname(videoPath).toLowerCase().slice(1);
    if (!['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) {
      throw new Error('Unsupported video format. Please use MP4, WebM, MOV, AVI, or MKV.');
    }
    
    const stat = await fs.stat(videoPath);
    if (stat.size > 500 * 1024 * 1024) {
      throw new Error('Video file is too large (max 500MB).');
    }
    if (stat.size === 0) {
      throw new Error('Video file is empty.');
    }
    
    const { heightInches, widthInches, lengthInches, notes, referenceId } = data;
    
    if (!heightInches || heightInches <= 0) throw new Error('Invalid height.');
    if (!widthInches || widthInches <= 0) throw new Error('Invalid width.');
    if (!lengthInches || lengthInches <= 0) throw new Error('Invalid length.');
    
    this.writing = true;
    let stagedPath: string | null = null;
    try {
      const captureId = `cap_desktop_${Date.now()}_${randomBytes(3).toString('hex')}`;
      const palletId = `pallet_${String(this.pallets.length + 1).padStart(4, '0')}`;
      const palletFolder = path.join(this.root, palletId);
      
      await fs.mkdir(palletFolder, { recursive: true });
      await fs.mkdir(path.join(palletFolder, 'frames'), { recursive: true });
      
      const videoExt = ext === 'mov' || ext === 'avi' || ext === 'mkv' ? 'mp4' : ext;
      await this.ensureStagingDir();
      stagedPath = this.newStagingPath(videoExt, 'import');
      await fs.copyFile(videoPath, stagedPath);
      const finalVideoPath = path.join(palletFolder, `video.${videoExt}`);
      await moveVideoFile(stagedPath, finalVideoPath);
      stagedPath = null;
      
      const pallet: Pallet = {
        id: palletId,
        captureId,
        heightInches,
        widthInches,
        lengthInches,
        notes,
        referenceId,
        capturedAt: new Date().toISOString(),
        deviceToken: 'desktop',
        folder: palletFolder,
        processingStatus: 'pending',
        framesExtracted: 0
      };
      
      const metadata = {
        pallet_id: palletId,
        height_inches: heightInches,
        width_inches: widthInches,
        length_inches: lengthInches,
        device: 'Desktop',
        frames_extracted: 0,
        annotations_reviewed: false,
        schema_version: 1,
        capture_id: captureId,
        captured_at: pallet.capturedAt,
        height_includes_base: true,
        notes,
        reference_id: referenceId,
        video_file: `video.${videoExt}`,
        device_token: 'desktop',
        annotation_status: 'unlabeled',
        processing_status: 'pending'
      };
      
      await fs.writeFile(path.join(palletFolder, 'metadata.json'), JSON.stringify(metadata, null, 2));
      
      this.pallets.unshift(pallet);
      await this.persist();
      
      void this.extractFrames(pallet);
    } finally {
      if (stagedPath) await fs.unlink(stagedPath).catch(() => {});
      this.writing = false;
    }
  }

  async status() {
    const tailscale = await detectTailscale();
    let urls: string[];
    if (this.useTailscale && this.useTailscaleHttps && this.httpsPort && tailscale.hostname) {
      urls = [`https://${tailscale.hostname}:${this.httpsPort}`];
    } else if (this.useTailscale && tailscale.hostname) {
      urls = [`http://${tailscale.hostname}:${this.port}`];
    } else if (this.useTailscale && tailscale.address) {
      urls = [`http://${tailscale.address}:${this.port}`];
    } else {
      const addresses = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a!.address).sort((a, b) => Number(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(b)) - Number(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)));
      addresses.sort((a, b) => Number(b === this.preferredAddress) - Number(a === this.preferredAddress));
      urls = addresses.map(a => `http://${a}:${this.port}`);
    }
    const base = urls[0] || `http://127.0.0.1:${this.port}`;
    return {
      root: this.root,
      running: !!this.port,
      port: this.port,
      httpsPort: this.httpsPort,
      httpsRunning: !!this.httpsPort,
      httpsError: this.httpsError,
      error: this.error,
      addresses: urls,
      useTailscale: this.useTailscale,
      useTailscaleHttps: this.useTailscaleHttps,
      tailscale: { available: !tailscale.error, address: tailscale.address, hostname: tailscale.hostname, error: tailscale.error },
      qrUrl: `${base}/`,
      qr: await QRCode.toDataURL(`${base}/`),
      pallets: this.pallets.map((p) => ({ ...p })),
      logFolder: this.uploadLog.directory(),
      uploadLogEntries: this.uploadLog.recent('failures', 40),
      uploadLogSummary: this.uploadLog.recent('failures', 40).map(humanizeLogEntry)
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const clientIP = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://local');
    const net = await this.networkLogContext();
    const baseLog: Partial<PalletVisionLogEntry> = { method, path: url.pathname, clientIp: clientIP, ...net };

    if (clientIP && !isPrivateIP(clientIP)) {
      this.respondError(res, 403, 'IP_REJECTED_PUBLIC', `Access denied. PalletVision only accepts private network clients. Your IP: ${clientIP}`, {
        ...baseLog,
        ipAllowed: false,
        ipRejectReason: 'Client IP is not on a private (RFC1918) network'
      });
      return;
    }

    if (req.headers.origin) {
      const originHost = new URL(req.headers.origin).host;
      if (originHost !== req.headers.host) {
        this.respondError(res, 403, 'ORIGIN_MISMATCH', 'Invalid request origin. Origin host does not match request host.', {
          ...baseLog,
          ipAllowed: true
        });
        return;
      }
    }

    const json = (value: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    
    if (req.method === 'GET' && url.pathname === '/') { 
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); 
      res.end(getMobilePage()); 
      return; 
    }

    if (req.method === 'GET' && url.pathname === '/palletvisionMobile.js') {
      const jsPath = path.join(__dirname, 'palletvisionMobile.js');
      const jsContent = await fs.readFile(jsPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(jsContent);
      return;
    }
    
    if (req.method === 'POST' && url.pathname === '/api/pair') {
      const deviceToken = token();
      this.deviceTokens.set(deviceToken, { token: deviceToken, createdAt: Date.now() });
      await this.persist();
      void this.log({ event: 'request', outcome: 'success', auth: 'not_required', ...baseLog, ipAllowed: true, message: 'Device paired' });
      json({ deviceToken });
      return;
    }

    const auth = this.resolveAuth(req.headers.authorization);
    if (!auth.ok) {
      this.respondError(res, 401, this.authCode(auth.reason), this.authMessage(auth.reason), {
        ...baseLog,
        ipAllowed: true,
        auth: auth.reason
      });
      return;
    }
    const deviceToken = auth.token;

    if (req.method === 'GET' && url.pathname === '/api/health') {
      void this.log({ event: 'request', outcome: 'success', auth: 'ok', ...baseLog, ipAllowed: true, message: 'Health check' });
      json({ status: 'ok', palletCount: this.pallets.length, auth: 'ok' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/diagnostics/client') {
      const body = await this.readJsonBody(req);
      const reason = String(body.reason || body.type || 'client_report');
      const message = String(body.message || 'Client diagnostic event');
      await this.log({
        event: body.type === 'camera' || body.kind === 'camera' ? 'client_camera' : 'request',
        outcome: 'failure',
        auth: 'ok',
        captureId: typeof body.captureId === 'string' ? body.captureId : undefined,
        errorCode: reason,
        message,
        ...baseLog,
        ipAllowed: true
      });
      json({ status: 'logged' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pallets/upload') {
      if (this.writing) {
        this.respondError(res, 409, 'UPLOAD_BUSY', 'Another pallet is being processed. Wait and retry.', { ...baseLog, ipAllowed: true, auth: 'ok', event: 'upload' });
        return;
      }
      
      this.writing = true;
      let videoPath: string | null = null;
      let logCaptureId: string | undefined;
      try {
        await this.ensureStagingDir();
        const fields: Record<string, string> = {};
        let videoSize = 0;
        let videoWriteDone: Promise<void> | null = null;

        const bb = busboy({ headers: req.headers, limits: { fileSize: 500 * 1024 * 1024 } });

        bb.on('field', (name, value) => {
          fields[name] = value;
        });

        bb.on('file', (name, file, info) => {
          if (name !== 'video') {
            file.resume();
            return;
          }
          
          const ext = info.filename?.endsWith('.mp4') ? 'mp4' : 'webm';
          const tempPath = this.newStagingPath(ext, 'upload');
          videoPath = tempPath;
          const writeStream = createWriteStream(tempPath);
          
          file.on('data', (chunk) => {
            videoSize += chunk.length;
          });
          
          videoWriteDone = new Promise<void>((resolve, reject) => {
            writeStream.on('finish', () => resolve());
            writeStream.on('error', reject);
            file.on('error', reject);
          });
          
          file.pipe(writeStream);
        });

        await new Promise((resolve, reject) => {
          bb.on('finish', resolve);
          bb.on('error', reject);
          req.pipe(bb);
        });
        if (videoWriteDone) await videoWriteDone;

        const { captureId, heightInches, widthInches, lengthInches, notes, referenceId, capturedAt } = fields;
        logCaptureId = captureId;
        
        if (!captureId || typeof captureId !== 'string') throw new Error('Missing or invalid captureId.');
        if (this.pallets.some(p => p.captureId === captureId)) {
          const existing = this.pallets.find(p => p.captureId === captureId)!;
          if (videoPath) await fs.unlink(videoPath).catch(() => {});
          json({ palletId: existing.id, status: 'exists', processingStatus: existing.processingStatus });
          return;
        }
        
        const height = parseFloat(heightInches);
        const width = parseFloat(widthInches);
        const length = parseFloat(lengthInches);
        
        if (!height || height <= 0) throw new Error('Invalid height.');
        if (!width || width <= 0) throw new Error('Invalid width.');
        if (!length || length <= 0) throw new Error('Invalid length.');
        if (!videoPath || videoSize === 0) throw new Error('Missing video data.');
        
        const palletId = `pallet_${String(this.pallets.length + 1).padStart(4, '0')}`;
        const palletFolder = path.join(this.root, palletId);
        await fs.mkdir(palletFolder, { recursive: true });
        await fs.mkdir(path.join(palletFolder, 'frames'), { recursive: true });
        
        if (!videoPath) throw new Error('Missing video data.');
        
        const videoExt = (videoPath as string).endsWith('.mp4') ? 'mp4' : 'webm';
        const finalVideoPath = path.join(palletFolder, `video.${videoExt}`);
        await moveVideoFile(videoPath as string, finalVideoPath);
        videoPath = null;
        
        const pallet: Pallet = {
          id: palletId,
          captureId,
          heightInches: height,
          widthInches: width,
          lengthInches: length,
          notes,
          referenceId,
          capturedAt: capturedAt || new Date().toISOString(),
          deviceToken,
          folder: palletFolder,
          processingStatus: 'pending',
          framesExtracted: 0
        };
        
        const userAgent = req.headers['user-agent'] || '';
        const device = userAgent.includes('iPhone') || userAgent.includes('iPad') ? 'iPhone' :
                      userAgent.includes('Android') ? 'Android' : 'Unknown';
        
        const metadata = {
          pallet_id: palletId,
          height_inches: height,
          width_inches: width,
          length_inches: length,
          device,
          frames_extracted: 0,
          annotations_reviewed: false,
          schema_version: 1,
          capture_id: captureId,
          captured_at: pallet.capturedAt,
          height_includes_base: true,
          notes,
          reference_id: referenceId,
          video_file: `video.${videoExt}`,
          device_token: deviceToken.slice(0, 8),
          annotation_status: 'unlabeled',
          processing_status: 'pending'
        };
        
        await fs.writeFile(path.join(palletFolder, 'metadata.json'), JSON.stringify(metadata, null, 2));
        
        this.pallets.unshift(pallet);
        await this.persist();
        
        void this.extractFrames(pallet);
        
        void this.log({
          event: 'upload',
          outcome: 'success',
          auth: 'ok',
          captureId,
          sizeBytes: videoSize,
          palletId,
          ...baseLog,
          ipAllowed: true
        });
        json({ palletId, status: 'uploaded', processingStatus: 'pending' });
      } catch (e: any) {
        const errno = e?.code ? String(e.code) : undefined;
        const code: PalletVisionErrorCode = errno === 'ENOSPC' || errno === 'EACCES' || errno === 'EXDEV' ? 'DISK_WRITE_ERROR' : 'VALIDATION_ERROR';
        this.respondError(res, 400, code, e.message || 'Upload failed.', {
          event: 'upload',
          auth: 'ok',
          captureId: logCaptureId,
          errno,
          ...baseLog,
          ipAllowed: true
        });
        return;
      } finally {
        if (videoPath) await fs.unlink(videoPath).catch(() => {});
        this.writing = false;
      }
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/pallets/')) {
      const palletId = url.pathname.split('/')[3];
      const pallet = this.pallets.find(p => p.id === palletId);
      if (!pallet) {
        this.respondError(res, 404, 'UNKNOWN_ROUTE', 'Pallet not found.', { ...baseLog, ipAllowed: true, auth: 'ok' });
        return;
      }
      json({ palletId: pallet.id, processingStatus: pallet.processingStatus, framesExtracted: pallet.framesExtracted });
      return;
    }

    this.respondError(res, 404, 'UNKNOWN_ROUTE', 'Unknown API route.', { ...baseLog, ipAllowed: true, auth: 'ok' });
  }

  private async extractFrames(pallet: Pallet) {
    try {
      pallet.processingStatus = 'extracting';
      await this.persist();
      
      const metadataPath = path.join(pallet.folder, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      const videoFile = metadata.video_file || 'video.webm';
      const videoPath = path.join(pallet.folder, videoFile);
      const framesDir = path.join(pallet.folder, 'frames');
      
      const targetFrames = 15;
      const ffmpegPath = getFFmpegPath();
      const ffmpegArgs = [
        '-i', videoPath,
        '-vf', `select='not(mod(n\\,5))',scale=640:-1`,
        '-frames:v', String(targetFrames),
        '-q:v', '2',
        path.join(framesDir, 'frame_%04d.jpg')
      ];
      
      await promisify(execFile)(ffmpegPath, ffmpegArgs, { timeout: 60000 });
      
      const frames = await fs.readdir(framesDir);
      pallet.framesExtracted = frames.length;
      pallet.processingStatus = 'complete';
      
      metadata.frames_extracted = frames.length;
      metadata.processing_status = 'complete';
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      
      await this.persist();
    } catch (e: any) {
      pallet.processingStatus = 'failed';
      pallet.framesExtracted = 0;
      await this.persist();
      const net = await this.networkLogContext();
      await this.log({
        event: 'frame_extract',
        outcome: 'failure',
        errorCode: 'FRAME_EXTRACT_FAILED',
        message: e.message,
        errno: e.code ? String(e.code) : undefined,
        palletId: pallet.id,
        captureId: pallet.captureId,
        ...net
      });
    }
  }
}
