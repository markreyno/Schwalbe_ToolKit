import path from 'node:path';
import { PhoneTlsManager } from '../../electron/tls/phoneTlsManager';
import { ensureLocalTlsMaterial } from '../../electron/tls/localCa';

export async function createTestPhoneTlsManager(testRoot: string): Promise<PhoneTlsManager> {
  const manager = new PhoneTlsManager(testRoot);
  await manager.load();
  await ensureLocalTlsMaterial(testRoot);
  await manager.refreshServerTls(false, ['127.0.0.1']);
  return manager;
}

export function localPhoneToolUrl(url: string, port: number, useHttps = true): string {
  const scheme = useHttps ? 'https' : 'http';
  return url.replace(/^https?:\/\/[^/]+/, `${scheme}://127.0.0.1:${port}`);
}

/** @deprecated Use localPhoneToolUrl */
export function localHttpsToolUrl(url: string, port: number): string {
  return localPhoneToolUrl(url, port, true);
}
