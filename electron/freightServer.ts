import { MAX_FREIGHT_PICTURES, validateFreightImage } from './freightValidation';
import { resolveFreightUploadDirectory, sanitizeFreightUploadFolderName } from './freightFolderName';
import { readFileSync } from 'node:fs';
import type http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { mobilePage } from './freightMobile';
import { detectTailscale, detectPreferredLanAddress } from './networkAllowlist';
import type { PhoneTlsManager } from './tls/phoneTlsManager';
import { startPhoneToolServer, type PhoneServerHandle } from './tls/phoneServer';
import { buildPhoneAddressList, listPhoneUrlHosts } from './tls/phoneUrls';
import { FREIGHT_PHONE_PORT } from './toolPhoneUrls';

/** In-memory upload batch lock duration; overridable in tests via FREIGHT_BATCH_TTL_MS. */
export const FREIGHT_BATCH_TTL_MS = Number(process.env.FREIGHT_BATCH_TTL_MS) > 0 ? Number(process.env.FREIGHT_BATCH_TTL_MS) : 60000;

const phoneHubNavJs = () => readFileSync(path.join(__dirname, 'phoneHubNav.js'), 'utf8');
const freightMobileInlineJs = () => readFileSync(path.join(__dirname, 'freightMobileInline.js'), 'utf8');
let freightAppVersion: string | undefined;
function freightAppVersionLabel(): string {
  if (!freightAppVersion) {
    freightAppVersion = String(JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || '0.0.0');
  }
  return freightAppVersion;
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
type Shipment = { id: string; company: string; date: string; folder: string; token: string; closed: boolean; reupload: boolean; pictures: number; lastUploadSubfolder?: string; phoneSubfolder?: string };
type Batch = { id: string; shipment: Shipment; files: { name: string; size: number; hash?: string; saved?: string }[]; expires: number; uploadDir: string; uploadFolderLabel: string };
export class FreightServer {
  private phoneHandle?: PhoneServerHandle;
  private root = '';
  private master = token();
  private shipments: Shipment[] = [];
  private batch?: Batch;
  private port = 0;
  private preferredAddress = '';
  private useTailscale = false;
  private error = '';
  private writing = false;
  private persistence: Promise<void> = Promise.resolve();
  constructor(private settings: string, private tlsManager: PhoneTlsManager) {}
  async start() {
    this.preferredAddress = await detectPreferredLanAddress();
    try { const data = JSON.parse(await fs.readFile(this.settings, 'utf8')); this.root = data.root; this.master = data.master; this.shipments = data.shipments; this.useTailscale = data.useTailscale || false; } catch (e: any) { if (e.code !== 'ENOENT') this.error = 'Could not read Freight Pictures settings.'; }
    await this.restartPhoneListener();
  }
  async restartPhoneListener() {
    if (this.phoneHandle) await this.phoneHandle.close();
    this.phoneHandle = undefined;
    this.port = 0;
    const { hosts } = await listPhoneUrlHosts({
      useTailscale: this.useTailscale,
      preferredLanAddress: this.preferredAddress,
      allowInsecureHttp: this.tlsManager.getPhoneHttpMode()
    });
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
        port: FREIGHT_PHONE_PORT,
        tls,
        allowInsecureHttp: allowInsecure,
        handler: (req, res) => {
          void this.handle(req, res).catch(e => {
            if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
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
    const snapshot = JSON.stringify({ root: this.root, master: this.master, shipments: this.shipments, useTailscale: this.useTailscale });
    const next = this.persistence.catch(() => {}).then(async () => { await fs.mkdir(path.dirname(this.settings), { recursive: true }); const temp = this.settings + '.tmp'; await fs.writeFile(temp, snapshot); await fs.rename(temp, this.settings); });
    this.persistence = next;
    return next;
  }
  async setRoot(root: string) { if ((this.batch && this.batch.expires > Date.now()) || this.writing) throw new Error('Finish the active upload first.'); await fs.access(root); this.root = root; await this.persist(); }
  private async removeEmptyUploadSubfolder(uploadDir: string, shipmentFolder: string) {
    const root = path.resolve(shipmentFolder);
    const dir = path.resolve(uploadDir);
    if (dir === root || !dir.startsWith(root + path.sep)) return;
    try {
      if ((await fs.readdir(dir)).length === 0) await fs.rmdir(dir);
    } catch { /* not empty or missing */ }
  }
  private async abandonBatch() {
    const batch = this.batch;
    this.batch = undefined;
    if (!batch) return;
    const prefix = `_${batch.id.slice(0, 8)}_`;
    for (const f of batch.files) {
      if (f.saved) { try { await fs.unlink(f.saved); } catch { /* already removed */ } f.saved = undefined; }
    }
    try {
      for (const name of await fs.readdir(batch.uploadDir)) {
        if (name.includes(prefix) && name.endsWith('.part')) await fs.unlink(path.join(batch.uploadDir, name));
      }
    } catch { /* folder may be missing */ }
    await this.removeEmptyUploadSubfolder(batch.uploadDir, batch.shipment.folder);
  }
  private async listShipmentSubfolderNames(shipmentFolder: string) {
    try {
      const entries = await fs.readdir(shipmentFolder, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }
  private uploadDirForShipment(shipment: Shipment) {
    const defaultFolderName = path.basename(shipment.folder);
    const sub = (shipment.phoneSubfolder ?? '').trim();
    return resolveFreightUploadDirectory(shipment.folder, sub, defaultFolderName);
  }
  private saveTargetLabel(shipment: Shipment) {
    const base = path.basename(shipment.folder);
    const sub = (shipment.phoneSubfolder ?? '').trim();
    return sub ? `${base}/${sub}` : base;
  }
  async setPhoneSubfolder(id: string, subfolderInput: string) {
    const shipment = this.shipments.find(s => s.id === id);
    if (!shipment) throw new Error('Shipment not found.');
    if (this.batch && this.batch.shipment === shipment && this.batch.expires > Date.now()) {
      throw new Error('Finish or cancel the active phone upload before changing the subfolder.');
    }
    const trimmed = (subfolderInput ?? '').trim();
    if (!trimmed || /^none$/i.test(trimmed)) shipment.phoneSubfolder = '';
    else shipment.phoneSubfolder = sanitizeFreightUploadFolderName(trimmed, trimmed);
    await this.persist();
    return {
      phoneSubfolder: shipment.phoneSubfolder || '',
      saveTarget: this.saveTargetLabel(shipment),
      subfolders: await this.listShipmentSubfolderNames(shipment.folder)
    };
  }
  private validateShipmentMeta(company: string, date: string) {
    if (!this.root) throw new Error('Choose the desktop storage folder first.');
    if (typeof company !== 'string' || !company.trim() || company.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(company) || /[. ]$/.test(company) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error('Enter a valid company and shipment date. Avoid special characters in the company name.');
    }
    return { company: company.trim(), date };
  }
  private async mkdirShipmentFolder(company: string, date: string) {
    const base = company + '_' + date;
    let folder = path.join(this.root, base);
    for (let i = 2; ; i++) {
      try {
        await fs.mkdir(folder);
        break;
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
        folder = path.join(this.root, base + '_' + i);
      }
    }
    return folder;
  }
  async create(company: string, date: string) {
    const meta = this.validateShipmentMeta(company, date);
    const folder = await this.mkdirShipmentFolder(meta.company, meta.date);
    const shipment: Shipment = { id: token(), token: token(), company: meta.company, date: meta.date, folder, closed: false, reupload: false, pictures: 0 };
    this.shipments.unshift(shipment);
    await this.persist();
    return shipment;
  }
  private async shipmentFolderHasFiles(folder: string) {
    try {
      const entries = await fs.readdir(folder);
      return entries.length > 0;
    } catch {
      return false;
    }
  }
  /** Phone or desktop: rename empty shipment folder, or create a new shipment if pictures/files already exist. */
  async updateShipmentFromPhone(shipment: Shipment, company: string, date: string) {
    if (shipment.closed) throw new Error('This shipment is complete. Start a new shipment instead.');
    if (this.batch && this.batch.shipment === shipment && this.batch.expires > Date.now()) {
      throw new Error('Finish or cancel the active upload before changing the shipment.');
    }
    const meta = this.validateShipmentMeta(company, date);
    if (meta.company === shipment.company && meta.date === shipment.date) {
      return { key: shipment.token, strategy: 'unchanged' as const, company: shipment.company, date: shipment.date };
    }
    const hasSavedPictures = shipment.pictures > 0;
    const folderHasFiles = await this.shipmentFolderHasFiles(shipment.folder);
    if (hasSavedPictures || folderHasFiles) {
      const created = await this.create(meta.company, meta.date);
      return { key: created.token, strategy: 'created_new' as const, company: created.company, date: created.date };
    }
    const newFolder = await this.mkdirShipmentFolder(meta.company, meta.date);
    try {
      await fs.rmdir(shipment.folder);
    } catch {
      /* old folder not empty or missing; keep both */
      const created = await this.create(meta.company, meta.date);
      return { key: created.token, strategy: 'created_new' as const, company: created.company, date: created.date };
    }
    shipment.company = meta.company;
    shipment.date = meta.date;
    shipment.folder = newFolder;
    await this.persist();
    return { key: shipment.token, strategy: 'renamed_folder' as const, company: shipment.company, date: shipment.date };
  }
  async reopen(id: string) { const s = this.shipments.find(s => s.id === id); if (!s || !s.closed) throw new Error('Select a completed shipment.'); s.closed = false; s.reupload = true; s.token = token(); await this.persist(); }
  async setTailscaleMode(enabled: boolean) { this.useTailscale = enabled; await this.persist(); await this.restartPhoneListener(); }
  folder(id: string) { const s = this.shipments.find(s => s.id === id); if (!s) throw new Error('Shipment not found.'); return s.folder; }
  async status() {
    const tailscale = await detectTailscale();
    const insecure = this.tlsManager.getPhoneHttpMode();
    let urls: string[] = [];
    try {
      const { hosts } = await listPhoneUrlHosts({
        useTailscale: this.useTailscale,
        preferredLanAddress: this.preferredAddress,
        allowInsecureHttp: insecure
      });
      urls = buildPhoneAddressList(hosts, this.port || FREIGHT_PHONE_PORT, insecure);
    } catch (e: any) {
      this.error = e.message || String(e);
      urls = [this.tlsManager.buildToolBaseUrl('127.0.0.1', this.port || FREIGHT_PHONE_PORT)];
    }
    const base = urls[0] || this.tlsManager.buildToolBaseUrl('127.0.0.1', this.port || FREIGHT_PHONE_PORT);
    const phoneTls = await this.tlsManager.publicStatus(this.useTailscale, this.preferredAddress || '127.0.0.1');
    return {
      root: this.root,
      running: !!this.port,
      error: this.error || phoneTls.tlsError,
      addresses: urls,
      useTailscale: this.useTailscale,
      tailscale: { available: !tailscale.error, address: tailscale.address, hostname: tailscale.hostname, error: tailscale.error },
      phoneTls,
      masterUrl: `${base}/?key=${this.master}`,
      masterQr: await QRCode.toDataURL(`${base}/?key=${this.master}`),
      shipments: await Promise.all(
        this.shipments.map(async s => ({
          ...s,
          phoneSubfolder: s.phoneSubfolder ?? '',
          saveTarget: this.saveTargetLabel(s),
          subfolders: await this.listShipmentSubfolderNames(s.folder),
          url: `${base}/?key=${s.token}`,
          qr: s.closed ? '' : await QRCode.toDataURL(`${base}/?key=${s.token}`)
        }))
      )
    };
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
    if (req.method === 'GET' && url.pathname === '/phoneHubNav.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(phoneHubNavJs());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/freightMobileInline.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(freightMobileInlineJs());
      return;
    }
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
    if (req.method === 'GET' && url.pathname === '/state') {
      json({
        master,
        configured: !!this.root,
        appVersion: freightAppVersionLabel(),
        shipment: shipment && {
          company: shipment.company,
          date: shipment.date,
          closed: shipment.closed,
          reupload: shipment.reupload,
          pictures: shipment.pictures,
          defaultUploadFolder: path.basename(shipment.folder),
          lastUploadSubfolder: shipment.lastUploadSubfolder,
          saveTarget: this.saveTargetLabel(shipment)
        },
        shipments: master ? this.shipments.filter(s => !s.closed).map(s => ({ company: s.company, date: s.date, key: s.token })) : []
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/create' && master) { const data = JSON.parse((await this.body(req, 4096)).toString()); const s = await this.create(data.company, data.date); json({ key: s.token }); return; }
    if (req.method === 'POST' && url.pathname === '/shipment/new') {
      const data = JSON.parse((await this.body(req, 4096)).toString());
      const s = await this.create(data.company, data.date);
      json({ key: s.token, company: s.company, date: s.date });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/shipment/update' && shipment) {
      const data = JSON.parse((await this.body(req, 4096)).toString());
      json(await this.updateShipmentFromPhone(shipment, data.company, data.date));
      return;
    }
    if (!shipment || shipment.closed) throw new Error('This shipment is complete. Ask the desktop user to select Reupload.');
    if (req.method === 'POST' && url.pathname === '/cancel-active') {
      if (this.batch && this.batch.shipment === shipment && this.batch.expires > Date.now()) await this.abandonBatch();
      json({ canceled: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/batch') {
      if (this.batch && this.batch.expires > Date.now()) throw new Error('An upload is already active. Retry the current batch or wait 1 minute.');
      const data = JSON.parse((await this.body(req, 100000)).toString());
      if (!Array.isArray(data.files) || data.files.length < 1 || data.files.length > MAX_FREIGHT_PICTURES || data.pallets !== data.files.length) throw new Error('Select 1 to 26 pictures and confirm one picture per pallet.');
      for (const f of data.files) if (typeof f.name !== 'string' || !/\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?|avif)$/i.test(f.name) || !Number.isInteger(f.size) || f.size < 1 || f.size > 100 * 1024 * 1024 || (f.hash !== undefined && !/^[a-f0-9]{64}$/.test(f.hash))) throw new Error('Choose image files up to 100 MB each.');
      const uploadDir = this.uploadDirForShipment(shipment);
      await fs.mkdir(uploadDir, { recursive: true });
      this.batch = {
        id: token(),
        shipment,
        files: data.files,
        expires: Date.now() + FREIGHT_BATCH_TTL_MS,
        uploadDir,
        uploadFolderLabel: path.basename(uploadDir)
      };
      json({ id: this.batch.id, uploadFolder: this.batch.uploadFolderLabel });
      return;
    }
    const batch = this.batch;
    if (!batch || batch.shipment !== shipment || url.searchParams.get('batch') !== batch.id) throw new Error('Upload session expired. Start the upload again.');
    batch.expires = Date.now() + FREIGHT_BATCH_TTL_MS;
    if (req.method === 'POST' && url.pathname === '/cancel') { await this.abandonBatch(); json({ canceled: true }); return; }
    if (req.method === 'POST' && url.pathname === '/file') {
      if (this.writing) throw new Error('Another picture is being saved. Retry.');
      const index = Number(url.searchParams.get('index')); const f = batch.files[index]; if (!Number.isInteger(index) || !f) throw new Error('Invalid picture.');
      let clientAborted = false;
      const markAborted = () => { clientAborted = true; };
      req.once('aborted', markAborted);
      this.writing = true;
      try {
        const expectedHash = f.hash ?? req.headers['x-picture-sha256'];
        if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Picture checksum is required. Retry.');
        const bytes = await this.body(req, f.size);
        if (clientAborted || req.aborted) { await this.abandonBatch(); return; }
        if (bytes.length !== f.size || createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('Picture transfer was incomplete. Retry.');
        try { validateFreightImage(bytes, f.name); } catch (e) { await this.abandonBatch(); throw e; }
        f.hash = expectedHash;
        if (!f.saved) { const target = path.join(batch.uploadDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${batch.id.slice(0,8)}_${index + 1}${path.extname(f.name).toLowerCase()}`); const temp = target + '.part'; const handle = await fs.open(temp, 'w'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } await fs.rename(temp, target); f.saved = target; }
        json({ saved: true });
      } catch (e) {
        if (clientAborted || req.aborted) { await this.abandonBatch(); return; }
        throw e;
      } finally { this.writing = false; } return;
    }
    if (req.method === 'POST' && url.pathname === '/finish') {
      if (this.writing) throw new Error('Wait for the current picture to save.');
      for (const f of batch.files) { if (!f.saved) throw new Error('Some pictures have not uploaded. Retry the upload.'); const bytes = await fs.readFile(f.saved); if (bytes.length !== f.size || createHash('sha256').update(bytes).digest('hex') !== f.hash) throw new Error('Desktop verification failed. Retry.'); }
      shipment.closed = true; shipment.pictures += batch.files.length; shipment.lastUploadSubfolder = batch.uploadFolderLabel;
      try { await this.persist(); } catch (e) { shipment.closed = false; shipment.pictures -= batch.files.length; throw e; }
      this.batch = undefined; json({ complete: true, pictures: batch.files.length }); return;
    }
    throw new Error('Unknown request.');
  }
}
