import type { PhoneTlsState } from '../../shared/protocol';

export function PhoneTlsStatus({ tls }: { tls?: PhoneTlsState }) {
  if (!tls) return null;
  const showError = tls.tlsError && (tls.httpFallback || !tls.tlsReady || tls.mode === 'http-fallback');
  return (
    <div className="phone-tls-status">
      <p className="freight-muted">Phone transport: {tls.transport || '—'}</p>
      {tls.tlsHostname && <p className="freight-muted">Hostname: <code>{tls.tlsHostname}</code></p>}
      {tls.tailscaleCertHostname && tls.usingTailscaleCert && (
        <p className="freight-muted">Tailscale cert: <code>{tls.tailscaleCertHostname}</code>{tls.tailscaleCertExpiresAt ? ` · expires ${new Date(tls.tailscaleCertExpiresAt).toLocaleString()}` : ''}</p>
      )}
      {!tls.usingTailscaleCert && tls.leafExpiresAt && tls.phoneUseHttps && tls.mode !== 'http' && (
        <p className="freight-muted">Certificate expires: {new Date(tls.leafExpiresAt).toLocaleString()}</p>
      )}
      {tls.httpFallback && <p className="freight-muted">Links use <strong>HTTP fallback</strong> until HTTPS is ready. Uploads still work; PWA install and push need HTTPS.</p>}
      {showError && <p role="alert" className="freight-error">{tls.tlsError}</p>}
      {showError && tls.tlsFixHint && <p className="freight-muted">{tls.tlsFixHint}</p>}
      {tls.phoneUseHttps && !tls.usingTailscaleCert && tls.caFingerprint && tls.requiresCaTrust && (
        <>
          <p className="freight-muted">CA fingerprint: <code>{tls.caFingerprint}</code></p>
          <p className="freight-muted">Trust URL (HTTP, CA only): <code>{tls.caTrustHttpUrl}</code></p>
          {tls.caTrustQr && <img src={tls.caTrustQr} alt="Scan to trust desktop CA" style={{ maxWidth: 200 }} />}
        </>
      )}
    </div>
  );
}
