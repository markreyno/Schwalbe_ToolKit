import path from 'node:path';
import { PhoneTlsManager } from '../../electron/tls/phoneTlsManager';
import { ensureLocalTlsMaterial } from '../../electron/tls/localCa';

export async function createTestPhoneTlsManager(testRoot: string, options?: { usePhoneHttps?: boolean }): Promise<PhoneTlsManager> {
  const manager = new PhoneTlsManager(testRoot);
  await manager.load();
  if (options?.usePhoneHttps === false) {
    await manager.setPhoneUseHttps(false);
  } else {
    await ensureLocalTlsMaterial(testRoot);
    await manager.setPhoneUseHttps(true);
    await manager.refreshServerTls(false, ['127.0.0.1']);
  }
  return manager;
}

export function localPhoneToolUrl(url: string, port: number, useHttps = false): string {
  const scheme = useHttps ? 'https' : 'http';
  return url.replace(/^https?:\/\/[^/]+/, `${scheme}://127.0.0.1:${port}`);
}

/** @deprecated Use localPhoneToolUrl */
export function localHttpsToolUrl(url: string, port: number): string {
  return localPhoneToolUrl(url, port, true);
}
