import https from 'node:https';

export const hubHttpsAgent = new https.Agent({ rejectUnauthorized: false });

export function hubBaseUrl(port: number): string {
  return `https://127.0.0.1:${port}`;
}

export function hubFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, agent: hubHttpsAgent } as RequestInit);
}

function hubHttpsPost(
  url: string,
  headers: Record<string, string>,
  body?: Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'POST',
        rejectUnauthorized: false,
        agent: hubHttpsAgent,
        headers: body ? { ...headers, 'Content-Length': String(body.length) } : headers,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error(`hub HTTPS POST timed out: ${url}`));
    });
    if (body) req.end(body);
    else req.end();
  });
}

export async function hubPostJson(url: string, data: unknown): Promise<{ status: number; json: () => Promise<unknown> }> {
  const payload = JSON.stringify(data);
  const res = await hubHttpsPost(url, { 'Content-Type': 'application/json' }, Buffer.from(payload));
  return { status: res.status, json: async () => JSON.parse(res.body) };
}

export async function hubPostBytes(url: string, data: Buffer): Promise<{ status: number; json: () => Promise<unknown> }> {
  const res = await hubHttpsPost(url, { 'Content-Type': 'application/octet-stream' }, data);
  return { status: res.status, json: async () => JSON.parse(res.body) };
}
