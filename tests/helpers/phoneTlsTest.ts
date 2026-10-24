import path from 'node:path';
import { PhoneTlsManager } from '../../electron/tls/phoneTlsManager';
import { ensureLocalTlsMaterial } from '../../electron/tls/localCa';

export async function createTestPhoneTlsManager(testRoot: string): Promise<PhoneTlsManager> {
  await ensureLocalTlsMaterial(testRoot);
  const manager = new PhoneTlsManager(testRoot);
  await manager.load();
  await manager.refreshServerTls(false);
  return manager;
}

export function localHttpsToolUrl(url: string, port: number): string {
  return url.replace(/^https?:\/\/[^/]+/, `https://127.0.0.1:${port}`);
}
