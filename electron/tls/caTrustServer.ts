import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isPrivateIP } from '../networkAllowlist';
import { buildIosMobileConfig } from './localCa';

export const PHONE_CA_TRUST_PORT = 48730;

export type CaTrustServerHandle = { close: () => Promise<void> };

export async function startCaTrustServer(getCaPem: () => string | null): Promise<CaTrustServerHandle> {
  const server = http.createServer((req, res) => {
    void handle(req, res, getCaPem).catch(e => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(e instanceof Error ? e.message : String(e));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(PHONE_CA_TRUST_PORT, '0.0.0.0', () => resolve());
  });
  return {
    close: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections();
    }
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, getCaPem: () => string | null) {
  const clientIP = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (clientIP && !isPrivateIP(clientIP)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access denied.');
    return;
  }
  const url = new URL(req.url || '/', 'http://local');
  const ca = getCaPem();
  if (!ca) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Local certificate authority is not ready yet.');
    return;
  }
  if (req.method === 'GET' && (url.pathname === '/ca.crt' || url.pathname === '/ca.pem')) {
    res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Cache-Control': 'no-store' });
    res.end(ca);
    return;
  }
  if (req.method === 'GET' && (url.pathname === '/ios.mobileconfig' || url.pathname === '/ca.mobileconfig')) {
    res.writeHead(200, { 'Content-Type': 'application/x-apple-aspen-config', 'Cache-Control': 'no-store' });
    res.end(buildIosMobileConfig(ca));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/phoneHubNav.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(readFileSync(path.join(__dirname, '..', 'phoneHubNav.js'), 'utf8'));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trust Schwalbe ToolKit</title><style>.brand-bar{background:#fff;border-bottom:1px solid #e7eaf0;padding:18px 20px;margin:0 -24px 20px}.brand{font:600 14px system-ui,sans-serif;color:#080a0b}body{font-family:system-ui,sans-serif;padding:0 24px 24px;max-width:640px;margin:auto}</style></head><body>
<header class="brand-bar"><div class="brand">Schwalbe ToolKit · Trust</div></header>
<h1>Trust this desktop (one time)</h1>
<p>This page only distributes the desktop certificate authority. Phone tools use HTTPS on their usual ports after you trust this CA.</p>
<p><a href="/ca.crt">Download CA certificate (.crt)</a> — Android: Settings → Security → Install certificate.</p>
<p><a href="/ios.mobileconfig">Install iOS profile (.mobileconfig)</a> — then Settings → General → About → Certificate Trust Settings → enable full trust.</p>
<p>Verify the fingerprint shown on the desktop matches before trusting.</p>
<script src="/phoneHubNav.js"></script>
</body></html>`);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found. This server only provides the desktop CA for phone HTTPS setup.');
}
