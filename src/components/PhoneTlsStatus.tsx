import type { PhoneTlsState } from '../../shared/protocol';

export function PhoneTlsStatus({ tls }: { tls?: PhoneTlsState }) {
  if (!tls) return null;
  const showError = !!tls.tlsError || !tls.tlsReady;
  return (
    <div className="phone-tls-status">
      <p className="freight-muted">Phone transport: {tls.transport || '—'}</p>
      {tls.tlsHostname && <p className="freight-muted">Hostname: <code>{tls.tlsHostname}</code></p>}
      {tls.tailscaleCertHostname && tls.usingTailscaleCert && (
        <p className="freight-muted">Tailscale cert: <code>{tls.tailscaleCertHostname}</code>{tls.tailscaleCertExpiresAt ? ` · expires ${new Date(tls.tailscaleCertExpiresAt).toLocaleString()}` : ''}</p>
      )}
      {tls.certStatusDetail && !showError && (
        <p className="freight-muted">{tls.certStatusDetail}</p>
      )}
      {tls.validUntil && tls.tlsReady && !tls.usingTailscaleCert && (
        <p className="freight-muted">Valid until {new Date(tls.validUntil).toLocaleString()}</p>
      )}
      {showError && <p role="alert" className="freight-error">{tls.tlsError}</p>}
      {showError && tls.tlsFixHint && <p className="freight-muted">{tls.tlsFixHint}</p>}
      {!tls.tlsReady && (
        <p className="freight-muted">Phone servers stay <strong>offline</strong> until HTTPS is ready. There is no HTTP fallback.</p>
      )}
      {!tls.usingTailscaleCert && tls.caFingerprint && tls.requiresCaTrust && (
        <>
          <p className="freight-muted">CA fingerprint: <code>{tls.caFingerprint}</code></p>
          <p className="freight-muted">One-time CA trust (HTTP bootstrap only, port 48730): <code>{tls.caTrustHttpUrl}</code></p>
          {tls.caTrustQr && <img src={tls.caTrustQr} alt="Scan to trust desktop CA" style={{ maxWidth: 200 }} />}
        </>
      )}
    </div>
  );
}
