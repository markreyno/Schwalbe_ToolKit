import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyPhoneSecurityHeaders } from './securityHeaders';

export type PhoneToolHandler = (req: IncomingMessage, res: ServerResponse, secure: boolean) => void | Promise<void>;

export type PhoneServerTls = {
  cert: string | Buffer;
  key: string | Buffer;
  /** When set, HTTPS requests whose SNI ends with this suffix use the alternate certificate (e.g. Tailscale *.ts.net). */
  sniSuffix?: string;
  sniCert?: string | Buffer;
  sniKey?: string | Buffer;
};

export type PhoneServerHandle = {
  port: number;
  close: () => Promise<void>;
  updateTls: (tlsMaterial: PhoneServerTls) => void;
};

function wrapHandler(handler: PhoneToolHandler, secure: boolean): http.RequestListener {
  return (req, res) => {
    applyPhoneSecurityHeaders(res, secure);
    void Promise.resolve(handler(req, res, secure)).catch(e => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(e instanceof Error ? e.message : String(e));
      }
    });
  };
}

function createHttpsServer(tlsMaterial: PhoneServerTls, handler: http.RequestListener) {
  const state = { material: tlsMaterial };
  const buildContexts = () => {
    const defaultContext = tls.createSecureContext({ cert: state.material.cert, key: state.material.key });
    let sniContext: tls.SecureContext | undefined;
    const suffix = (state.material.sniSuffix || '').toLowerCase();
    if (suffix && state.material.sniCert && state.material.sniKey) {
      sniContext = tls.createSecureContext({ cert: state.material.sniCert, key: state.material.sniKey });
    }
    return { defaultContext, sniContext, suffix };
  };
  const options: https.ServerOptions = {
    cert: tlsMaterial.cert,
    key: tlsMaterial.key,
    SNICallback: (servername, cb) => {
      const { defaultContext, sniContext, suffix } = buildContexts();
      const host = (servername || '').toLowerCase();
      if (sniContext && suffix && host.endsWith(suffix)) {
        cb(null, sniContext);
        return;
      }
      cb(null, defaultContext);
    }
  };
  const server = https.createServer(options, handler);
  return {
    server,
    updateTls(next: PhoneServerTls) {
      state.material = next;
      server.setSecureContext({ cert: next.cert, key: next.key });
    }
  };
}

/** Start a phone tool listener on a fixed port (HTTPS when TLS material is present). */
export async function startPhoneToolServer(options: {
  port: number;
  handler: PhoneToolHandler;
  tls?: PhoneServerTls | null;
  allowInsecureHttp: boolean;
}): Promise<PhoneServerHandle> {
  const { port, handler, tls: tlsMaterial, allowInsecureHttp } = options;
  const httpsHandler = wrapHandler(handler, true);
  const httpHandler = wrapHandler(handler, false);

  if (!tlsMaterial) {
    if (!allowInsecureHttp) throw new Error('HTTPS is required but no certificate is available.');
    const server = http.createServer(httpHandler);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => resolve());
    });
    return {
      port,
      updateTls: () => { /* HTTP-only listener has no TLS context */ },
      close: async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        server.closeAllConnections();
      }
    };
  }

  const server = createHttpsServer(tlsMaterial, httpsHandler);
  await new Promise<void>((resolve, reject) => {
    server.server.once('error', reject);
    server.server.listen(port, '0.0.0.0', () => resolve());
  });

  return {
    port,
    updateTls: (next: PhoneServerTls) => {
      server.updateTls(next);
    },
    close: async () => {
      await new Promise<void>(resolve => server.server.close(() => resolve()));
      server.server.closeAllConnections();
    }
  };
}
