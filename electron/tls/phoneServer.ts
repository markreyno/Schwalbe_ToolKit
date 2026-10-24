import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyPhoneSecurityHeaders } from './securityHeaders';

export type PhoneToolHandler = (req: IncomingMessage, res: ServerResponse, secure: boolean) => void | Promise<void>;

export type PhoneServerTls = {
  cert: string | Buffer;
  key: string | Buffer;
};

export type PhoneServerHandle = {
  port: number;
  close: () => Promise<void>;
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
      close: async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        server.closeAllConnections();
      }
    };
  }

  const server = https.createServer({ cert: tlsMaterial.cert, key: tlsMaterial.key }, httpsHandler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });

  return {
    port,
    close: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections();
    }
  };
}
