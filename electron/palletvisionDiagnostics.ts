import fs from 'node:fs/promises';
import path from 'node:path';

export const DEVICE_TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export type PalletVisionErrorCode =
  | 'IP_REJECTED_PUBLIC'
  | 'ORIGIN_MISMATCH'
  | 'AUTH_MISSING'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'UNKNOWN_ROUTE'
  | 'UPLOAD_BUSY'
  | 'MISSING_CAPTURE_ID'
  | 'INVALID_DIMENSIONS'
  | 'MISSING_VIDEO'
  | 'FILE_TOO_LARGE'
  | 'INVALID_VIDEO_TYPE'
  | 'STORAGE_ROOT_MISSING'
  | 'DISK_WRITE_ERROR'
  | 'FRAME_EXTRACT_FAILED'
  | 'VALIDATION_ERROR';

export type PalletVisionLogEntry = {
  ts: string;
  event: 'request' | 'upload' | 'frame_extract' | 'server_start' | 'server_bind' | 'client_camera';
  outcome: 'success' | 'failure';
  method?: string;
  path?: string;
  clientIp?: string;
  ipAllowed?: boolean;
  ipRejectReason?: string;
  auth?: 'ok' | 'missing' | 'invalid' | 'expired' | 'not_required';
  captureId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  limitHit?: 'size' | 'type';
  errorCode?: PalletVisionErrorCode | string;
  message?: string;
  errno?: string;
  httpStatus?: number;
  networkMode?: 'local' | 'tailscale';
  tailscaleAvailable?: boolean;
  tailscaleError?: string;
  serverBindError?: string;
  storageRoot?: string;
  palletId?: string;
};

const LOG_BASENAME = 'palletvision-upload.jsonl';
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_LOG_FILES = 3;
const MEMORY_RING = 250;

export function apiErrorBody(code: PalletVisionErrorCode, message: string) {
  return { code, message, error: message };
}

export function humanizeLogEntry(entry: PalletVisionLogEntry): string {
  const when = new Date(entry.ts).toLocaleString();
  if (entry.event === 'server_bind' && entry.outcome === 'failure') {
    return `${when}: Server could not start (${entry.serverBindError || entry.message || 'bind error'}).`;
  }
  if (entry.ipAllowed === false) {
    return `${when}: Blocked ${entry.clientIp || 'client'} — ${entry.ipRejectReason || 'IP not allowed'}.`;
  }
  if (entry.auth && entry.auth !== 'ok' && entry.auth !== 'not_required') {
    const authMsg = entry.auth === 'missing' ? 'missing device token' : entry.auth === 'expired' ? 'expired device token' : 'invalid device token';
    return `${when}: Auth failed (${authMsg}) on ${entry.path || 'request'}.`;
  }
  if (entry.limitHit === 'size') {
    return `${when}: Upload rejected — video exceeds ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit${entry.captureId ? ` (${entry.captureId})` : ''}.`;
  }
  if (entry.limitHit === 'type') {
    return `${when}: Upload rejected — unsupported video type${entry.mimeType ? ` (${entry.mimeType})` : ''}.`;
  }
  if (entry.errno) {
    return `${when}: Disk error ${entry.errno}${entry.captureId ? ` for ${entry.captureId}` : ''}: ${entry.message || ''}`.trim();
  }
  if (entry.event === 'frame_extract' && entry.outcome === 'failure') {
    return `${when}: Frame extraction failed for ${entry.palletId || entry.captureId || 'pallet'}: ${entry.message || entry.errorCode || 'unknown error'}.`;
  }
  if (entry.event === 'client_camera') {
    return `${when}: Phone camera issue — ${entry.message || entry.errorCode || 'recording unavailable'}${entry.captureId ? ` (${entry.captureId})` : ''}.`;
  }
  if (entry.outcome === 'failure') {
    return `${when}: ${entry.message || entry.errorCode || 'Upload failed'}${entry.captureId ? ` (${entry.captureId})` : ''}.`;
  }
  return `${when}: ${entry.event} succeeded${entry.captureId ? ` (${entry.captureId})` : ''}.`;
}

export class PalletVisionUploadLog {
  private ring: PalletVisionLogEntry[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private logDir: string) {}

  directory() {
    return this.logDir;
  }

  filePath() {
    return path.join(this.logDir, LOG_BASENAME);
  }

  recent(filter: 'all' | 'failures' = 'all', limit = 50): PalletVisionLogEntry[] {
    const list = filter === 'failures' ? this.ring.filter((e) => e.outcome === 'failure') : this.ring;
    return list.slice(-limit).reverse();
  }

  async append(entry: PalletVisionLogEntry) {
    this.ring.push(entry);
    if (this.ring.length > MEMORY_RING) this.ring.splice(0, this.ring.length - MEMORY_RING);
    const line = JSON.stringify(entry) + '\n';
    this.writeChain = this.writeChain.catch(() => {}).then(() => this.writeLine(line));
    await this.writeChain;
  }

  private async writeLine(line: string) {
    await fs.mkdir(this.logDir, { recursive: true });
    const file = this.filePath();
    await this.rotateIfNeeded(file);
    await fs.appendFile(file, line, 'utf8');
  }

  private async rotateIfNeeded(file: string) {
    try {
      const stat = await fs.stat(file);
      if (stat.size < MAX_LOG_BYTES) return;
    } catch (e: any) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      const to = `${file}.${i + 1}`;
      try {
        await fs.unlink(to);
      } catch { /* ignore */ }
      try {
        await fs.rename(from, to);
      } catch { /* ignore */ }
    }
    try {
      await fs.rename(file, `${file}.1`);
    } catch { /* ignore */ }
  }

  async exportTo(destPath: string) {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const chunks: string[] = [];
    for (let i = MAX_LOG_FILES; i >= 1; i--) {
      const rotated = i === 1 ? this.filePath() : `${this.filePath()}.${i}`;
      try {
        chunks.push(await fs.readFile(rotated, 'utf8'));
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    if (!chunks.length) {
      await fs.writeFile(destPath, '', 'utf8');
      return;
    }
    await fs.writeFile(destPath, chunks.reverse().join(''), 'utf8');
  }
}
