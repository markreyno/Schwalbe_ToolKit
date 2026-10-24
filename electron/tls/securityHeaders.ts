import type { ServerResponse } from 'node:http';

export function applyPhoneSecurityHeaders(res: ServerResponse, secure: boolean) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=86400');
  }
}
