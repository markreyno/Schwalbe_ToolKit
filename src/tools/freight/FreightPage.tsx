import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Camera, FolderOpen } from 'lucide-react';
import type { FreightState } from '../../../shared/protocol';
export function FreightPage() {
  const [state, setState] = useState<FreightState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [company, setCompany] = useState('');
  const [date, setDate] = useState('');
  const [selected, setSelected] = useState('master');
  const [address, setAddress] = useState('');
  const [copied, setCopied] = useState(false);
  async function action(action: Parameters<typeof window.toolkit.freight>[0], data?: Parameters<typeof window.toolkit.freight>[1]) {
    setBusy(true); setError('');
    try { const next = await window.toolkit.freight(action, data); setState(next); if (action === 'create') { setSelected(next.shipments[0].id); setCompany(''); } }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  useEffect(() => { void action('status'); const timer = setInterval(() => { void window.toolkit.freight('status').then(setState).catch(e => setError(String(e))); }, 3000); return () => clearInterval(timer); }, []);
  const shipment = state?.shipments.find(s => s.id === selected);
  const originalUrl = shipment?.url || state?.masterUrl || '';
  const url = address && state?.addresses.includes(address) ? originalUrl.replace(/^http:\/\/[^/]+/, address) : originalUrl;
  const [qr, setQr] = useState('');
  useEffect(() => { let active = true; if (url) { import('qrcode').then(q => q.toDataURL(url)).then(value => { if (active) setQr(value); }).catch(e => setError(String(e))); } return () => { active = false; }; }, [url]);
  return <><Link to="/" className="back-link"><ArrowLeft size={16}/> All tools</Link><header className="page-heading"><div><p className="eyebrow">SHIPPING & WAREHOUSE</p><h1>Freight Pictures</h1><p className="subtitle">One picture per pallet, saved at original quality.</p></div><Camera size={34}/></header>
    {error && <p role="alert" className="freight-error">{error}</p>}
    <div className="freight-layout"><div><section className="freight-panel"><h2>Desktop storage</h2><p>{state?.root || 'Choose a parent folder for shipment pictures.'}</p><button disabled={busy} onClick={() => void action('choose')}><FolderOpen size={16}/> Choose folder</button><p className="freight-muted">{state?.running ? 'Local upload server is running.' : 'Upload server is unavailable.'} Keep the toolkit open and this desktop awake.</p>{state?.error && <p role="alert">{state.error}</p>}</section>
    <section className="freight-panel"><h2>New shipment</h2><form onSubmit={e => { e.preventDefault(); void action('create', { company, date }); }}><label>Company<input value={company} onChange={e => setCompany(e.target.value)} required maxLength={100}/></label><label>Date shipped<input type="date" value={date} onChange={e => setDate(e.target.value)} required/></label><button disabled={busy || !state?.root}>Create shipment & QR code</button></form></section>
    <section className="freight-panel"><h2>Shipments</h2>{!state?.shipments.length ? <p>No shipments yet.</p> : <><label>Select shipment<select value={selected} onChange={e => { setSelected(e.target.value); setCopied(false); }}><option value="master">Select a shipment…</option>{state.shipments.map(s => <option key={s.id} value={s.id}>{s.company} · {s.date} · {s.closed ? 'Complete' : s.reupload ? 'Reupload open' : 'Awaiting pictures'}</option>)}</select></label>{shipment && <div className="freight-shipment"><strong>{shipment.company}</strong><p>{shipment.date} · {shipment.closed ? 'Complete' : shipment.reupload ? 'Reupload open' : 'Awaiting pictures'} · {shipment.pictures} saved pictures</p><div className="freight-actions"><button onClick={() => void action('open', { id: shipment.id })}>Open folder</button>{shipment.closed ? <button disabled={busy} onClick={() => void action('reupload', { id: shipment.id })}>Reupload</button> : <button onClick={() => { setSelected(shipment.id); setCopied(false); }}>Show QR</button>}</div></div>}</>}</section></div>
    <section className="freight-panel freight-qr"><h2>{shipment ? shipment.reupload ? 'Reupload link' : 'Shipment link' : 'Master link'}</h2><button onClick={() => { setSelected('master'); setCopied(false); }}>Show master link</button><p>{shipment ? `${shipment.company} · ${shipment.date}` : 'Create a shipment or select an open shipment from your phone.'}</p>{shipment?.closed ? <p>This shipment is complete. Select Reupload to add more pictures.</p> : <>{qr && <img src={qr} alt="Scan to open Freight Pictures on your phone"/>}<label>Desktop network address<select value={address || state?.addresses[0] || ''} onChange={e => setAddress(e.target.value)}>{state?.addresses.map(a => <option key={a}>{a}</option>)}</select></label><input aria-label="Phone upload link" readOnly value={url}/><button disabled={!url} onClick={() => { void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(e => setError(String(e))); }}>{copied ? 'Link copied' : 'Copy link'}</button></>}<p className="freight-muted">Connect your phone to a private network (RFC1918) that can reach this desktop. This works across different subnets or VLANs on the same site LAN as long as routing is configured. Scan the QR code with your phone camera, or copy and paste the link. If connection fails, select the correct network address, allow the toolkit through Windows Firewall on your private network, and ensure your phone is not on guest Wi-Fi that blocks device connections.</p></section></div></>;
}
