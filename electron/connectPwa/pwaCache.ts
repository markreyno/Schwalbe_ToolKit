/** Cache bucket name for Connect PWA service worker (must match sw.js). */
export function connectPwaCacheName(appVersion: string): string {
  return `schwalbe-toolkit-connect-${appVersion}`;
}

export const PWA_CACHE_VERSION_PLACEHOLDER = '__PWA_CACHE_VERSION__';
