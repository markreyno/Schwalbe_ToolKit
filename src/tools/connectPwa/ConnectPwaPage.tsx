import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Smartphone } from 'lucide-react';
import type { ConnectPwaState } from '../../../shared/protocol';
import { isPrivateIP } from '../../../shared/networkAllowlist';
import { CollapsibleSection } from '../../components/CollapsibleSection';

export function ConnectPwaPage() {
  const [state, setState] = useState<ConnectPwaState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [manualIp, setManualIp] = useState('');
  const [copied, setCopied] = useState(false);

  async function action(action: Parameters<typeof window.toolkit.connectPwa>[0], data?: Parameters<typeof window.toolkit.connectPwa>[1]) {
    setBusy(true); setError('');
    try { const next = await window.toolkit.connectPwa(action, data); setState(next); if (action === 'setManualAddress') setManualIp(next.manualAddress || ''); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  useEffect(() => {
    void action('status');
    const timer = setInterval(() => { void window.toolkit.connectPwa('status').then(setState).catch(e => setError(String(e))); }, 5000);
    return () => clearInterval(timer);
  }, []);

  const url = address && state?.addresses.includes(address) ? state.qrUrl.replace(/^https?:\/\/[^/]+/, address.replace(/\/$/, '')) : state?.qrUrl || '';
  const [qr, setQr] = useState('');
  useEffect(() => {
    let active = true;
    if (url) {
      import('qrcode').then(q => q.toDataURL(url)).then(value => { if (active) setQr(value); }).catch(e => setError(String(e)));
    }
    return () => { active = false; };
  }, [url]);

  function applyManual() {
    const ip = manualIp.trim();
    if (ip && !isPrivateIP(ip)) { setError('Enter a private LAN or Tailscale IP address.'); return; }
    void action('setManualAddress', { address: ip });
  }

  const tls = state?.phoneTls;
  const httpMode = tls?.mode === 'http' || !tls?.phoneUseHttps;

  return <>
    <Link to="/" className="back-link"><ArrowLeft size={16}/> All tools</Link>
    <header className="page-heading">
      <div>
        <p className="eyebrow">PHONE ACCESS</p>
        <h1>Connect PWA</h1>
        <p className="subtitle">Scan once to open a phone hub with links to Freight Pictures and PalletVision.</p>
      </div>
      <Smartphone size={34}/>
    </header>
    {error && <p role="alert" className="freight-error">{error}</p>}
    <div className="freight-layout">
      <div>
        <CollapsibleSection storageKey="schwalbe-collapse-connect-phone-hub" title="Phone hub server" defaultOpen>
          <p className="freight-muted">{state?.running ? `Hub server is running on port ${state.port}.` : 'Hub server is unavailable.'} Keep the toolkit open.</p>
          <p className="freight-muted">Phone transport: {httpMode ? 'HTTP (default)' : tls?.usingTailscaleCert ? 'HTTPS · Tailscale certificate' : 'HTTPS · local desktop CA'}</p>
          {tls && !httpMode && !tls.tlsReady && <p role="alert" className="freight-error">{tls.tlsError}</p>}
          {tls && !httpMode && tls.tlsReady && tls.tlsError && <p role="alert" className="freight-error">{tls.tlsError}</p>}
          {state?.error && <p role="alert">{state.error}</p>}
          {tls && !httpMode && tls.caFingerprint && !tls.usingTailscaleCert && <>
            <p className="freight-muted">CA fingerprint (verify on phone): <code>{tls.caFingerprint}</code></p>
            <p className="freight-muted">Trust URL (HTTP, CA only): <code>{tls.caTrustHttpUrl}</code></p>
            {tls.caTrustQr && <img src={tls.caTrustQr} alt="Scan to trust desktop CA on your phone" style={{ maxWidth: 220 }}/>}
          </>}
          <label>
            <input type="checkbox" checked={!!tls?.phoneUseHttps} disabled={busy} onChange={e => void action('setPhoneUseHttps', { enabled: e.target.checked })}/>
            Use HTTPS for phone tools (requires certificate setup; off by default)
          </label>
          {httpMode && <p className="freight-muted">PWA install, service worker caching, and push notifications for Picker Water need HTTPS. The hub and uploads work in the browser over HTTP.</p>}
        </CollapsibleSection>
        <CollapsibleSection storageKey="schwalbe-collapse-connect-reachability" title="Reachability">
          <p className="freight-muted">Freight Pictures (48731): {state?.reachability.freight ? 'responding' : 'not responding'}</p>
          <p className="freight-muted">PalletVision (48732): {state?.reachability.palletvision ? 'responding' : 'not responding'}</p>
        </CollapsibleSection>
        <CollapsibleSection storageKey="schwalbe-collapse-connect-devices" title="Connected devices">
          {!state?.devices.length ? <p className="freight-muted">No phones have opened the hub yet.</p> : (
            <ul className="connect-device-list">
              {state.devices.map(device => (
                <li key={device.id}>
                  <strong>{device.ip}</strong>
                  <span>{new Date(device.lastSeen).toLocaleString()}</span>
                  <span className="freight-muted">{device.userAgent}</span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>
      </div>
      <section className="freight-panel freight-qr">
        <h2>Scan to open phone hub</h2>
        <label>Network mode
          <select value={state?.useTailscale ? 'tailscale' : 'local'} onChange={e => void action('setTailscale', { enabled: e.target.value === 'tailscale' })} disabled={busy}>
            <option value="local">Local network</option>
            <option value="tailscale">Tailscale</option>
          </select>
        </label>
        {state?.useTailscale && state.tailscale.error && <p role="alert" className="freight-error">{state.tailscale.error}</p>}
        {state?.useTailscale && state.tailscale.available && <p className="freight-muted">Using Tailscale: {state.tailscale.hostname || state.tailscale.address}</p>}
        {qr && <img src={qr} alt="Scan to open Connect PWA on your phone"/>}
        {!state?.useTailscale && <>
          <label>Desktop network address
            <select value={address || state?.addresses[0] || ''} onChange={e => setAddress(e.target.value)}>
              {state?.addresses.map(a => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label>Manual IP fallback
            <input aria-label="Manual private IP" value={manualIp} onChange={e => setManualIp(e.target.value)} placeholder="e.g. 192.168.1.50"/>
          </label>
          <button type="button" disabled={busy} onClick={() => applyManual()}>Apply manual address</button>
        </>}
        <input aria-label="Phone hub link" readOnly value={url}/>
        <button disabled={!url} onClick={() => { void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(e => setError(String(e))); }}>{copied ? 'Link copied' : 'Copy link'}</button>
        <p className="freight-muted">
          Hub links use {httpMode ? 'HTTP' : 'HTTPS'} on port {state?.port}.
          The QR opens the <strong>install</strong> page (<code>/install</code>); the warehouse hub stays free of install prompts.
        </p>
      </section>
    </div>
  </>;
}
