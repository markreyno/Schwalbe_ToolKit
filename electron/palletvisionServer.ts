import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type http from 'node:http';
import fs from 'node:fs/promises';
import { createWriteStream, readFileSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import busboy from 'busboy';
import { extractPalletVideoFrames } from './palletvisionFrames';
import { detectTailscale, detectPreferredLanAddress } from './networkAllowlist';
import type { PhoneTlsManager } from './tls/phoneTlsManager';
import { startPhoneToolServer, type PhoneServerHandle } from './tls/phoneServer';
import { buildPhoneAddressList, listPhoneUrlHosts } from './tls/phoneUrls';
import { PALLETVISION_PHONE_PORT } from './toolPhoneUrls';

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
  private phoneHandle?: PhoneServerHandle;
  private root = '';
  private deviceTokens = new Map<string, { token: string; createdAt: number }>();
  private pallets: Pallet[] = [];
  private port = 0;
  private preferredAddress = '';
  private useTailscale = false;
  private error = '';
  private uploadLock: { reason: 'mobile_upload' | 'desktop_import'; startedAt: number; lastActivityAt: number; captureId?: string } | null = null;
  private uploadLockTimer: NodeJS.Timeout | null = null;
  private static readonly UPLOAD_LOCK_STALE_MS = 60_000;
  private persistence: Promise<void> = Promise.resolve();
  private events: ({ type: 'upload_canceled'; captureId?: string; at: string } | { type: 'upload_lock_released'; reason: 'stale_timeout' | 'stale_no_progress' | 'forced'; at: string; detail?: string } | { type: 'process_error'; message: string; at: string })[] = [];

  constructor(private settings: string, private tlsManager: PhoneTlsManager) {}

  async start() {
    this.preferredAddress = await detectPreferredLanAddress();
    try { const data = JSON.parse(await fs.readFile(this.settings, 'utf8')); this.root = data.root || ''; this.deviceTokens = new Map(data.deviceTokens || []); this.pallets = data.pallets || []; this.useTailscale = data.useTailscale || false; } catch (e: any) { if (e.code !== 'ENOENT') this.error = 'Could not read PalletVision settings.'; }
    if (!this.root) this.root = path.join(os.homedir(), 'PalletVision', 'data');
    await this.restartPhoneListener();
  }

  async restartPhoneListener() {
    if (this.phoneHandle) await this.phoneHandle.close();
    this.phoneHandle = undefined;
    this.port = 0;
    await this.tlsManager.refreshServerTls(this.useTailscale);
    const tls = this.tlsManager.getServerTls();
    const allowInsecure = this.tlsManager.getAllowInsecureHttp();
    if (!tls && !allowInsecure) {
      const status = await this.tlsManager.publicStatus(this.useTailscale, this.preferredAddress || '127.0.0.1');
      this.error = status.tlsError || 'HTTPS is required for phone links.';
      return;
    }
    try {
      this.phoneHandle = await startPhoneToolServer({
        port: PALLETVISION_PHONE_PORT,
        tls,
        allowInsecureHttp: allowInsecure,
        handler: (req, res) => {
          req.on('error', (err) => this.logProcessError('request error', err));
          res.on('error', (err) => this.logProcessError('response error', err));
          req.socket?.on('error', (err) => this.logProcessError('socket error', err));
          void this.handle(req, res).catch((e) => {
            this.logProcessError('upload handler', e);
            if (!res.headersSent && !res.writableEnded) {
              res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
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

  stop() { void this.phoneHandle?.close(); }

  private persist() {
    const snapshot = JSON.stringify({ root: this.root, deviceTokens: Array.from(this.deviceTokens.entries()), pallets: this.pallets, useTailscale: this.useTailscale });
    const next = this.persistence.catch(() => {}).then(async () => { await fs.mkdir(path.dirname(this.settings), { recursive: true }); const temp = this.settings + '.tmp'; await fs.writeFile(temp, snapshot); await fs.rename(temp, this.settings); });
    this.persistence = next;
    return next;
  }

  private get writing() {
    return this.uploadLock !== null;
  }

  private pushEvent(event: (typeof this.events)[number]) {
    this.events.unshift(event);
    if (this.events.length > 20) this.events.length = 20;
  }

  noteProcessError(message: string) {
    this.pushEvent({ type: 'process_error', message, at: new Date().toISOString() });
  }

  private isConnectionAbortError(err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const message = err instanceof Error ? err.message : String(err);
    return code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE'
      || /aborted|client aborted|unexpected end|truncated|premature close|unexpected end of form/i.test(message);
  }

  private logProcessError(context: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (this.isConnectionAbortError(err)) return;
    const summary = `${context}: ${message}`;
    console.error('[PalletVision]', summary, err);
    this.noteProcessError(summary);
  }

  private touchUploadLock() {
    if (!this.uploadLock) return;
    this.uploadLock.lastActivityAt = Date.now();
    this.scheduleUploadLockWatchdog();
  }

  private scheduleUploadLockWatchdog() {
    if (this.uploadLockTimer) clearTimeout(this.uploadLockTimer);
    this.uploadLockTimer = setTimeout(() => {
      void this.expireStaleUploadLock('stale_timeout').catch((err) => this.logProcessError('stale upload lock watchdog', err));
    }, PalletVisionServer.UPLOAD_LOCK_STALE_MS);
  }

  private async cleanupStagingUploads() {
    try {
      const dir = this.stagingDir();
      const entries = await fs.readdir(dir);
      for (const name of entries) {
        if (name.startsWith('upload-')) await fs.unlink(path.join(dir, name)).catch(() => {});
      }
    } catch { /* staging may not exist */ }
  }

  private releaseUploadLock(detail?: string) {
    if (this.uploadLockTimer) {
      clearTimeout(this.uploadLockTimer);
      this.uploadLockTimer = null;
    }
    if (this.uploadLock) {
      this.uploadLock = null;
      if (detail) {
        this.pushEvent({ type: 'upload_lock_released', reason: 'forced', at: new Date().toISOString(), detail });
      }
    }
  }

  private async expireStaleUploadLock(cause: 'stale_timeout' | 'stale_no_progress' = 'stale_no_progress') {
    if (!this.uploadLock) return false;
    const idleMs = Date.now() - this.uploadLock.lastActivityAt;
    if (idleMs < PalletVisionServer.UPLOAD_LOCK_STALE_MS) return false;
    const reason = cause === 'stale_timeout' ? 'stale_timeout' : 'stale_no_progress';
    this.pushEvent({
      type: 'upload_lock_released',
      reason,
      at: new Date().toISOString(),
      detail: `Released idle upload lock after ${Math.round(idleMs / 1000)}s (${this.uploadLock.reason})`
    });
    this.releaseUploadLock();
    await this.cleanupStagingUploads();
    return true;
  }

  private assertUploadIdle() {
    void this.expireStaleUploadLock();
    if (this.uploadLock) {
      throw new Error('Another pallet is being processed. Retry.');
    }
  }

  private beginUploadLock(reason: 'mobile_upload' | 'desktop_import', captureId?: string) {
    void this.expireStaleUploadLock();
    if (this.uploadLock) throw new Error('Another pallet is being processed. Retry.');
    const now = Date.now();
    this.uploadLock = { reason, startedAt: now, lastActivityAt: now, captureId };
    this.scheduleUploadLockWatchdog();
  }

  private uploadLockStatus() {
    if (!this.uploadLock) return { uploadBusy: false, uploadLock: null as null };
    return {
      uploadBusy: true,
      uploadLock: {
        reason: this.uploadLock.reason,
        startedAt: new Date(this.uploadLock.startedAt).toISOString(),
        lastActivityAt: new Date(this.uploadLock.lastActivityAt).toISOString(),
        captureId: this.uploadLock.captureId
      }
    };
  }

  private async withUploadLock<T>(reason: 'mobile_upload' | 'desktop_import', fn: () => Promise<T>): Promise<T> {
    this.beginUploadLock(reason);
    try {
      return await fn();
    } finally {
      this.releaseUploadLock();
    }
  }

  async setRoot(root: string) { if (this.uploadLock) throw new Error('Wait for active upload to complete.'); await fs.access(root); this.root = root; await this.persist(); }
  
  async setTailscaleMode(enabled: boolean) { this.useTailscale = enabled; await this.persist(); await this.restartPhoneListener(); }

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
    
    return this.withUploadLock('desktop_import', async () => {
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
    }
    });
  }

  async status() {
    const tailscale = await detectTailscale();
    const insecure = this.tlsManager.getAllowInsecureHttp() && !this.tlsManager.getServerTls();
    let urls: string[] = [];
    try {
      const { hosts } = await listPhoneUrlHosts({ useTailscale: this.useTailscale, preferredLanAddress: this.preferredAddress });
      urls = buildPhoneAddressList(hosts, this.port || PALLETVISION_PHONE_PORT, insecure);
    } catch (e: any) {
      this.error = e.message || String(e);
      urls = [this.tlsManager.buildToolBaseUrl('127.0.0.1', this.port || PALLETVISION_PHONE_PORT)];
    }
    const base = urls[0] || this.tlsManager.buildToolBaseUrl('127.0.0.1', this.port || PALLETVISION_PHONE_PORT);
    const lock = this.uploadLockStatus();
    const phoneTls = await this.tlsManager.publicStatus(this.useTailscale, this.preferredAddress || '127.0.0.1');
    return { root: this.root, running: !!this.port, port: this.port, error: this.error || phoneTls.tlsError, addresses: urls, useTailscale: this.useTailscale, tailscale: { available: !tailscale.error, address: tailscale.address, hostname: tailscale.hostname, error: tailscale.error }, phoneTls, qrUrl: `${base}/`, qr: await QRCode.toDataURL(`${base}/`), uploadBusy: lock.uploadBusy, uploadLock: lock.uploadLock, events: this.events.map(e => ({ ...e })), pallets: this.pallets.map(p => ({ ...p })) };
  }

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

    if (req.method === 'GET' && url.pathname === '/phoneHubNav.js') {
      const jsPath = path.join(__dirname, 'phoneHubNav.js');
      const jsContent = await fs.readFile(jsPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(jsContent);
      return;
    }
    
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

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const lock = this.uploadLockStatus();
      json({ status: 'ok', palletCount: this.pallets.length, uploadBusy: lock.uploadBusy, uploadLock: lock.uploadLock });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pallets/upload') {
      this.assertUploadIdle();
      this.beginUploadLock('mobile_upload');
      let videoPath: string | null = null;
      let clientAborted = false;
      let cancellationLogged = false;
      let uploadResponded = false;
      let videoWriteStream: WriteStream | null = null;
      let busboyParser: ReturnType<typeof busboy> | null = null;
      let resolveBusboyWait: (() => void) | null = null;
      let resolveVideoWrite: (() => void) | null = null;
      let videoWriteDone: Promise<void> | null = null;
      const fields: Record<string, string> = {};

      const finishVideoWrite = () => {
        resolveVideoWrite?.();
        resolveVideoWrite = null;
      };

      const drainVideoWrite = async () => {
        if (!videoWriteDone) return;
        await videoWriteDone.catch(() => {});
      };

      const recordCancellation = () => {
        if (cancellationLogged) return;
        cancellationLogged = true;
        this.pushEvent({ type: 'upload_canceled', captureId: fields.captureId, at: new Date().toISOString() });
        console.log('[PalletVision] Upload canceled by client', fields.captureId ? `(captureId=${fields.captureId})` : '');
      };

      const cleanupStaging = async () => {
        if (videoPath) {
          await fs.unlink(videoPath).catch(() => {});
          videoPath = null;
        }
      };

      const respondCanceled = () => {
        if (res.headersSent) return;
        recordCancellation();
        res.writeHead(499, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ status: 'canceled' }));
        uploadResponded = true;
      };

      const onClientAbort = () => {
        if (clientAborted) return;
        clientAborted = true;
        if (this.uploadLock) this.uploadLock.captureId = fields.captureId;
        if (busboyParser) req.unpipe(busboyParser);
        busboyParser?.removeAllListeners();
        busboyParser?.destroy();
        videoWriteStream?.destroy();
        finishVideoWrite();
        resolveBusboyWait?.();
        req.destroy();
        void cleanupStaging();
        respondCanceled();
      };

      const onConnectionFault = (err: unknown) => {
        if (this.isConnectionAbortError(err)) onClientAbort();
        else this.logProcessError('upload stream', err);
      };

      try {
        await this.ensureStagingDir();
        let videoSize = 0;

        busboyParser = busboy({ headers: req.headers, limits: { fileSize: 500 * 1024 * 1024 } });
        const bb = busboyParser;

        req.on('aborted', onClientAbort);
        req.on('close', () => {
          if (!uploadResponded && req.aborted) onClientAbort();
        });
        req.on('error', onConnectionFault);

        bb.on('field', (name, value) => {
          fields[name] = value;
          if (name === 'captureId') {
            if (this.uploadLock) this.uploadLock.captureId = value;
          }
          this.touchUploadLock();
        });

        bb.on('error', onConnectionFault);

        bb.on('file', (name, file, info) => {
          if (name !== 'video') {
            file.resume();
            return;
          }
          
          const ext = info.filename?.endsWith('.mp4') ? 'mp4' : 'webm';
          const tempPath = this.newStagingPath(ext, 'upload');
          videoPath = tempPath;
          videoWriteStream = createWriteStream(tempPath);
          videoWriteStream.on('error', onConnectionFault);
          
          file.on('data', (chunk) => {
            if (!clientAborted) {
              videoSize += chunk.length;
              this.touchUploadLock();
            }
          });

          file.on('limit', () => {
            file.resume();
          });
          file.on('error', onConnectionFault);
          
          videoWriteDone = new Promise<void>((resolve) => {
            resolveVideoWrite = resolve;
            videoWriteStream!.on('finish', () => resolve());
          });
          void videoWriteDone.catch(() => {});
          
          file.pipe(videoWriteStream);
        });

        await new Promise<void>((resolve, reject) => {
          resolveBusboyWait = resolve;
          bb.on('finish', () => resolve());
          bb.on('error', (err) => {
            if (clientAborted || this.isConnectionAbortError(err)) {
              onClientAbort();
              resolve();
            } else reject(err);
          });
          req.pipe(bb);
        });
        if (clientAborted) {
          await drainVideoWrite();
          await cleanupStaging();
          return;
        }
        await drainVideoWrite();
        if (clientAborted) {
          await cleanupStaging();
          return;
        }

        const { captureId, heightInches, widthInches, lengthInches, notes, referenceId, capturedAt } = fields;
        
        if (!captureId || typeof captureId !== 'string') throw new Error('Missing or invalid captureId.');
        if (this.pallets.some(p => p.captureId === captureId)) {
          const existing = this.pallets.find(p => p.captureId === captureId)!;
          if (videoPath) await fs.unlink(videoPath).catch(() => {});
          uploadResponded = true;
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
        
        uploadResponded = true;
        json({ palletId, status: 'uploaded', processingStatus: 'pending' });
      } catch (e) {
        if (clientAborted || this.isConnectionAbortError(e)) {
          if (!clientAborted) onClientAbort();
          await drainVideoWrite();
          await cleanupStaging();
          return;
        }
        this.logProcessError('upload', e);
        if (!uploadResponded && !res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          uploadResponded = true;
          return;
        }
      } finally {
        if (!clientAborted && videoPath) await fs.unlink(videoPath).catch(() => {});
        this.releaseUploadLock();
      }
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
      
      const metadataPath = path.join(pallet.folder, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      const videoFile = metadata.video_file || 'video.webm';
      const videoPath = path.join(pallet.folder, videoFile);
      const framesDir = path.join(pallet.folder, 'frames');
      
      const targetFrames = 15;
      const ffmpegPath = getFFmpegPath();
      const sampling = await extractPalletVideoFrames(ffmpegPath, videoPath, framesDir, targetFrames);
      
      const frames = (await fs.readdir(framesDir)).filter(name => /^frame_\d+\.jpg$/.test(name));
      if (!frames.length) throw new Error('No video frames could be extracted.');
      pallet.framesExtracted = frames.length;
      pallet.processingStatus = 'complete';
      
      metadata.frames_extracted = frames.length;
      metadata.processing_status = 'complete';
      metadata.frame_sampling = sampling;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      
      await this.persist();
    } catch (e: any) {
      pallet.processingStatus = 'failed';
      pallet.framesExtracted = 0;
      this.logProcessError('ffmpeg frame extraction', e);
      await this.persist();
    }
  }
}
