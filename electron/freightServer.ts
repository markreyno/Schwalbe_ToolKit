import { MAX_FREIGHT_PICTURES, validateFreightImage } from './freightValidation';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { mobilePage } from './freightMobile';

function isPrivateIP(ip: string): boolean {
  if (ip === '::1') return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  if (parts[0] === 127) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

const token = () => randomBytes(24).toString('hex');
type Shipment = { id: string; company: string; date: string; folder: string; token: string; closed: boolean; reupload: boolean; pictures: number };
type Batch = { id: string; shipment: Shipment; files: { name: string; size: number; hash?: string; saved?: string }[]; expires: number };
export class FreightServer {
  private server?: http.Server;
  private root = '';
  private master = token();
  private shipments: Shipment[] = [];
  private batch?: Batch;
  private port = 0;
  private preferredAddress = '';
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
      } catch { /* The address selector remains available if Windows route detection fails. */ }
    }
    try { const data = JSON.parse(await fs.readFile(this.settings, 'utf8')); this.root = data.root; this.master = data.master; this.shipments = data.shipments; } catch (e: any) { if (e.code !== 'ENOENT') this.error = 'Could not read Freight Pictures settings.'; }
    this.server = http.createServer((req, res) => { void this.handle(req, res).catch(e => { if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); } else res.end(); }); });
    await new Promise<void>(resolve => { this.server!.once('error', e => { this.error = e.message; resolve(); }); this.server!.listen(48731, '0.0.0.0', () => { this.port = 48731; resolve(); }); });
  }
  stop() { this.server?.close(); this.server?.closeAllConnections(); }
  private persist() {
    const snapshot = JSON.stringify({ root: this.root, master: this.master, shipments: this.shipments });
    const next = this.persistence.catch(() => {}).then(async () => { await fs.mkdir(path.dirname(this.settings), { recursive: true }); const temp = this.settings + '.tmp'; await fs.writeFile(temp, snapshot); await fs.rename(temp, this.settings); });
    this.persistence = next;
    return next;
  }
  async setRoot(root: string) { if ((this.batch && this.batch.expires > Date.now()) || this.writing) throw new Error('Finish the active upload first.'); await fs.access(root); this.root = root; await this.persist(); }
  async create(company: string, date: string) {
    if (!this.root) throw new Error('Choose the desktop storage folder first.');
    if (typeof company !== 'string' || !company.trim() || company.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(company) || /[. ]$/.test(company) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Enter a valid company and shipment date. Avoid special characters in the company name.');
    const base = company.trim() + '_' + date;
    let folder = path.join(this.root, base);
    for (let i = 2; ; i++) { try { await fs.mkdir(folder); break; } catch (e: any) { if (e.code !== 'EEXIST') throw e; folder = path.join(this.root, base + '_' + i); } }
    const shipment: Shipment = { id: token(), token: token(), company: company.trim(), date, folder, closed: false, reupload: false, pictures: 0 };
    this.shipments.unshift(shipment); await this.persist(); return shipment;
  }
  async reopen(id: string) { const s = this.shipments.find(s => s.id === id); if (!s || !s.closed) throw new Error('Select a completed shipment.'); s.closed = false; s.reupload = true; s.token = token(); await this.persist(); }
  folder(id: string) { const s = this.shipments.find(s => s.id === id); if (!s) throw new Error('Shipment not found.'); return s.folder; }
  async status() {
    const addresses = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a!.address).sort((a, b) => Number(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(b)) - Number(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)));
    addresses.sort((a, b) => Number(b === this.preferredAddress) - Number(a === this.preferredAddress));
    const urls = addresses.map(a => `http://${a}:${this.port}`);
    const base = urls[0] || `http://127.0.0.1:${this.port}`;
    return { root: this.root, running: !!this.port, error: this.error, addresses: urls, masterUrl: `${base}/?key=${this.master}`, masterQr: await QRCode.toDataURL(`${base}/?key=${this.master}`), shipments: await Promise.all(this.shipments.map(async s => ({ ...s, url: `${base}/?key=${s.token}`, qr: s.closed ? '' : await QRCode.toDataURL(`${base}/?key=${s.token}`) }))) };
  }
  private async body(req: http.IncomingMessage, max: number) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('Upload exceeds the allowed size.'); chunks.push(chunk); } return Buffer.concat(chunks); }
  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const clientIP = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (clientIP && !isPrivateIP(clientIP)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied. Freight Pictures only accepts connections from private networks (RFC1918). Your IP: ' + clientIP);
      return;
    }
    const url = new URL(req.url || '/', 'http://local');
    const key = url.searchParams.get('key');
    const shipment = this.shipments.find(s => s.token === key);
    const master = key === this.master;
    if (!master && !shipment) { res.writeHead(403); res.end('Invalid Freight Pictures link.'); return; }
    if (req.headers.origin) {
      const originHost = new URL(req.headers.origin).host;
      if (originHost !== req.headers.host) {
        throw new Error('Invalid request origin. Origin host does not match request host.');
      }
    }
    const json = (value: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(mobilePage); return; }
    if (req.method === 'GET' && url.pathname === '/state') { json({ master, configured: !!this.root, shipment: shipment && { company: shipment.company, date: shipment.date, closed: shipment.closed, reupload: shipment.reupload }, shipments: master ? this.shipments.filter(s => !s.closed).map(s => ({ company: s.company, date: s.date, key: s.token })) : [] }); return; }
    if (req.method === 'POST' && url.pathname === '/create' && master) { const data = JSON.parse((await this.body(req, 4096)).toString()); const s = await this.create(data.company, data.date); json({ key: s.token }); return; }
    if (!shipment || shipment.closed) throw new Error('This shipment is complete. Ask the desktop user to select Reupload.');
    if (req.method === 'POST' && url.pathname === '/batch') {
      if (this.batch && this.batch.expires > Date.now()) throw new Error('An upload is already active. Retry the current batch or wait 10 minutes.');
      const data = JSON.parse((await this.body(req, 100000)).toString());
      if (!Array.isArray(data.files) || data.files.length < 1 || data.files.length > MAX_FREIGHT_PICTURES || data.pallets !== data.files.length) throw new Error('Select 1 to 26 pictures and confirm one picture per pallet.');
      for (const f of data.files) if (typeof f.name !== 'string' || !/\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?|avif)$/i.test(f.name) || !Number.isInteger(f.size) || f.size < 1 || f.size > 100 * 1024 * 1024 || (f.hash !== undefined && !/^[a-f0-9]{64}$/.test(f.hash))) throw new Error('Choose image files up to 100 MB each.');
      this.batch = { id: token(), shipment, files: data.files, expires: Date.now() + 600000 }; json({ id: this.batch.id }); return;
    }
    const batch = this.batch;
    if (!batch || batch.shipment !== shipment || url.searchParams.get('batch') !== batch.id) throw new Error('Upload session expired. Start the upload again.');
    batch.expires = Date.now() + 600000;
    if (req.method === 'POST' && url.pathname === '/file') {
      if (this.writing) throw new Error('Another picture is being saved. Retry.');
      const index = Number(url.searchParams.get('index')); const f = batch.files[index]; if (!Number.isInteger(index) || !f) throw new Error('Invalid picture.');
      this.writing = true;
      try {
        const expectedHash = f.hash ?? req.headers['x-picture-sha256'];
        if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Picture checksum is required. Retry.');
        const bytes = await this.body(req, f.size); if (bytes.length !== f.size || createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('Picture transfer was incomplete. Retry.');
        try { validateFreightImage(bytes, f.name); } catch (e) { this.batch = undefined; throw e; }
        f.hash = expectedHash;
        if (!f.saved) { const target = path.join(shipment.folder, `${new Date().toISOString().replace(/[:.]/g, '-')}_${batch.id.slice(0,8)}_${index + 1}${path.extname(f.name).toLowerCase()}`); const temp = target + '.part'; const handle = await fs.open(temp, 'w'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } await fs.rename(temp, target); f.saved = target; }
        json({ saved: true });
      } finally { this.writing = false; } return;
    }
    if (req.method === 'POST' && url.pathname === '/finish') {
      if (this.writing) throw new Error('Wait for the current picture to save.');
      for (const f of batch.files) { if (!f.saved) throw new Error('Some pictures have not uploaded. Retry the upload.'); const bytes = await fs.readFile(f.saved); if (bytes.length !== f.size || createHash('sha256').update(bytes).digest('hex') !== f.hash) throw new Error('Desktop verification failed. Retry.'); }
      shipment.closed = true; shipment.pictures += batch.files.length;
      try { await this.persist(); } catch (e) { shipment.closed = false; shipment.pictures -= batch.files.length; throw e; }
      this.batch = undefined; json({ complete: true, pictures: batch.files.length }); return;
    }
    throw new Error('Unknown request.');
  }
}
