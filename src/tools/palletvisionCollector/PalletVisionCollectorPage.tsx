import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Video, FolderOpen, Edit2, X } from 'lucide-react';
import type { PalletVisionState } from '../../../shared/protocol';

export function PalletVisionCollectorPage() {
  const [state, setState] = useState<PalletVisionState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ heightInches: string; widthInches: string; lengthInches: string; device: string; notes: string; annotationsReviewed: boolean }>({ heightInches: '', widthInches: '', lengthInches: '', device: '', notes: '', annotationsReviewed: false });
  const [importing, setImporting] = useState(false);
  const [importForm, setImportForm] = useState<{ heightInches: string; widthInches: string; lengthInches: string; notes: string; referenceId: string; videoPath: string }>({ heightInches: '', widthInches: '40', lengthInches: '48', notes: '', referenceId: '', videoPath: '' });

  async function action(action: Parameters<typeof window.toolkit.palletvision>[0], data?: Parameters<typeof window.toolkit.palletvision>[1]) {
    setBusy(true); setError('');
    try { const next = await window.toolkit.palletvision(action, data); setState(next); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  useEffect(() => { void action('status'); const timer = setInterval(() => { void window.toolkit.palletvision('status').then(setState).catch(e => setError(String(e))); }, 3000); return () => clearInterval(timer); }, []);

  const url = address && state?.addresses.includes(address) ? state.qrUrl.replace(/^http:\/\/[^/]+/, address) : state?.qrUrl || '';
  const [qr, setQr] = useState('');
  useEffect(() => { let active = true; if (url) { import('qrcode').then(q => q.toDataURL(url)).then(value => { if (active) setQr(value); }).catch(e => setError(String(e))); } return () => { active = false; }; }, [url]);

  function startEdit(pallet: PalletVisionState['pallets'][0]) {
    setEditing(pallet.id);
    setEditForm({
      heightInches: String(pallet.heightInches),
      widthInches: String(pallet.widthInches),
      lengthInches: String(pallet.lengthInches),
      device: '',
      notes: pallet.notes || '',
      annotationsReviewed: false
    });
    
    fetch(`file:///${pallet.folder}/metadata.json`).catch(() => {}).then(() => {});
  }

  async function saveEdit() {
    if (!editing) return;
    const height = parseFloat(editForm.heightInches);
    const width = parseFloat(editForm.widthInches);
    const length = parseFloat(editForm.lengthInches);
    
    if (!height || height <= 0) { setError('Height must be a positive number.'); return; }
    if (!width || width <= 0) { setError('Width must be a positive number.'); return; }
    if (!length || length <= 0) { setError('Length must be a positive number.'); return; }
    if (!editForm.device.trim()) { setError('Device is required.'); return; }
    
    await action('update', {
      id: editing,
      updates: {
        heightInches: height,
        widthInches: width,
        lengthInches: length,
        device: editForm.device.trim(),
        notes: editForm.notes,
        annotationsReviewed: editForm.annotationsReviewed
      }
    });
    
    setEditing(null);
  }

  async function startImport() {
    setImporting(true);
    setImportForm({ heightInches: '', widthInches: '40', lengthInches: '48', notes: '', referenceId: '', videoPath: '' });
    setError('');
  }

  async function selectVideoFile() {
    try {
      const result = await window.toolkit.palletvision('selectVideo', {});
      if (result.videoPath) {
        setImportForm({ ...importForm, videoPath: result.videoPath });
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveImport() {
    if (!importForm.videoPath) {
      setError('Please select a video file first.');
      return;
    }
    
    const height = parseFloat(importForm.heightInches);
    const width = parseFloat(importForm.widthInches);
    const length = parseFloat(importForm.lengthInches);
    
    if (!height || height <= 0) { setError('Height must be a positive number.'); return; }
    if (!width || width <= 0) { setError('Width must be a positive number.'); return; }
    if (!length || length <= 0) { setError('Length must be a positive number.'); return; }
    
    await action('import', {
      videoPath: importForm.videoPath,
      heightInches: height,
      widthInches: width,
      lengthInches: length,
      notes: importForm.notes,
      referenceId: importForm.referenceId
    });
    
    setImporting(false);
  }

  return <>
    <Link to="/" className="back-link"><ArrowLeft size={16}/> All tools</Link>
    <header className="page-heading">
      <div>
        <p className="eyebrow">DATA COLLECTION</p>
        <h1>PalletVision Data Collector</h1>
        <p className="subtitle">Collect pallet training data with video and measured dimensions.</p>
      </div>
      <Video size={34}/>
    </header>
    {error && <p role="alert" className="freight-error">{error}</p>}
    <div className="freight-layout">
      <div>
        <section className="freight-panel">
          <h2>Desktop storage</h2>
          <p>{state?.root || 'Choose a folder to store pallet data.'}</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button disabled={busy} onClick={() => void action('choose')} style={{ flex: 1 }}><FolderOpen size={16}/> Choose folder</button>
            <button disabled={busy || !state?.root} onClick={() => void startImport()} style={{ flex: 1, background: '#0d7aa3' }}><Video size={16}/> Import video file</button>
          </div>
          <p className="freight-muted">{state?.running ? 'Upload server is running on port 48732.' : 'Upload server is unavailable.'} Keep the toolkit open.</p>
          {state?.error && <p role="alert">{state.error}</p>}
          {state?.events?.length ? <div style={{ marginTop: '12px', fontSize: '11px', color: '#7b8694' }}>
            <p style={{ fontWeight: 600, marginBottom: '6px' }}>Activity log</p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {state.events.slice(0, 5).map((evt, i) => <li key={evt.at + String(i)}>
                {evt.type === 'upload_canceled' ? `Upload canceled${evt.captureId ? ` (${evt.captureId})` : ''}` : evt.type}
                {' · '}{new Date(evt.at).toLocaleTimeString()}
              </li>)}
            </ul>
          </div> : null}
        </section>
        <section className="freight-panel">
          <h2>Collected Pallets</h2>
          {!state?.pallets.length ? <p>No pallets collected yet.</p> : <table style={{ width: '100%', fontSize: '12px', marginTop: '12px' }}>
            <thead style={{ textAlign: 'left', borderBottom: '1px solid #e7eaf0' }}>
              <tr><th>ID</th><th>Dimensions</th><th>Status</th><th>Frames</th><th></th></tr>
            </thead>
            <tbody>
              {state.pallets.map(p => <tr key={p.id} style={{ borderBottom: '1px solid #f5f8fa' }}>
                <td style={{ padding: '8px 0' }}>{p.id}</td>
                <td>{p.heightInches}"H × {p.widthInches}"W × {p.lengthInches}"L</td>
                <td><span style={{ color: p.processingStatus === 'complete' ? '#2d7a3f' : p.processingStatus === 'failed' ? '#8b2020' : '#8892a0' }}>{p.processingStatus}</span></td>
                <td>{p.framesExtracted}</td>
                <td style={{ display: 'flex', gap: '8px' }}>
                  <button style={{ width: 'auto', padding: '6px 12px', margin: 0, fontSize: '11px' }} onClick={() => void action('open', { id: p.id })}>Open</button>
                  <button style={{ width: 'auto', padding: '6px 12px', margin: 0, fontSize: '11px', background: '#f5f8fa', color: '#202936' }} onClick={() => startEdit(p)}><Edit2 size={12}/> Edit</button>
                </td>
              </tr>)}
            </tbody>
          </table>}
        </section>
        
        {editing && <section className="freight-panel" style={{ background: '#f5f8fa', border: '2px solid #0d7aa3' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>Edit Pallet {editing}</h2>
            <button style={{ width: 'auto', padding: '6px', background: 'transparent', border: 'none', color: '#7b8694' }} onClick={() => setEditing(null)}><X size={20}/></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <label style={{ fontSize: '12px' }}>
              Height (inches) *
              <input type="number" step="0.1" min="0.1" value={editForm.heightInches} onChange={e => setEditForm({ ...editForm, heightInches: e.target.value })} required />
            </label>
            <label style={{ fontSize: '12px' }}>
              Width (inches) *
              <input type="number" step="0.1" min="0.1" value={editForm.widthInches} onChange={e => setEditForm({ ...editForm, widthInches: e.target.value })} required />
            </label>
            <label style={{ fontSize: '12px' }}>
              Length (inches) *
              <input type="number" step="0.1" min="0.1" value={editForm.lengthInches} onChange={e => setEditForm({ ...editForm, lengthInches: e.target.value })} required />
            </label>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px' }}>
              Device *
              <input type="text" placeholder="iPhone, Android, etc." value={editForm.device} onChange={e => setEditForm({ ...editForm, device: e.target.value })} required />
            </label>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px' }}>
              Notes
              <textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Optional notes..." />
            </label>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={editForm.annotationsReviewed} onChange={e => setEditForm({ ...editForm, annotationsReviewed: e.target.checked })} />
              Annotations reviewed
            </label>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button disabled={busy} onClick={() => void saveEdit()}>Save changes</button>
            <button disabled={busy} style={{ background: '#d4ebf8', color: '#080a0b' }} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </section>}
        
        {importing && <section className="freight-panel" style={{ background: '#f5f8fa', border: '2px solid #0d7aa3' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>Import Video File</h2>
            <button style={{ width: 'auto', padding: '6px', background: 'transparent', border: 'none', color: '#7b8694' }} onClick={() => setImporting(false)}><X size={20}/></button>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px' }}>
              Video file *
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <input type="text" readOnly value={importForm.videoPath ? importForm.videoPath.split(/[\\/]/).pop() : 'No file selected'} style={{ flex: 1 }} />
                <button type="button" onClick={() => void selectVideoFile()} style={{ width: 'auto', padding: '0 16px', margin: 0 }}>Browse</button>
              </div>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <label style={{ fontSize: '12px' }}>
              Height (inches) *
              <input type="number" step="0.1" min="0.1" value={importForm.heightInches} onChange={e => setImportForm({ ...importForm, heightInches: e.target.value })} required />
            </label>
            <label style={{ fontSize: '12px' }}>
              Width (inches) *
              <input type="number" step="0.1" min="0.1" value={importForm.widthInches} onChange={e => setImportForm({ ...importForm, widthInches: e.target.value })} required />
            </label>
            <label style={{ fontSize: '12px' }}>
              Length (inches) *
              <input type="number" step="0.1" min="0.1" value={importForm.lengthInches} onChange={e => setImportForm({ ...importForm, lengthInches: e.target.value })} required />
            </label>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px' }}>
              Reference/Barcode ID
              <input type="text" value={importForm.referenceId} onChange={e => setImportForm({ ...importForm, referenceId: e.target.value })} placeholder="Optional reference ID" />
            </label>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px' }}>
              Notes
              <textarea value={importForm.notes} onChange={e => setImportForm({ ...importForm, notes: e.target.value })} placeholder="Optional notes..." />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button disabled={busy} onClick={() => void saveImport()}>Import & Process</button>
            <button disabled={busy} style={{ background: '#d4ebf8', color: '#080a0b' }} onClick={() => setImporting(false)}>Cancel</button>
          </div>
        </section>}
      </div>
      <section className="freight-panel freight-qr">
        <h2>Phone Pairing</h2>
        <p>Scan the QR code on your phone or enter the URL manually to start collecting pallet data.</p>
        <label>Network mode<select value={state?.useTailscale ? 'tailscale' : 'local'} onChange={e => void action('setTailscale', { enabled: e.target.value === 'tailscale' })} disabled={busy}><option value="local">Local network</option><option value="tailscale">Tailscale</option></select></label>
        {state?.useTailscale && state.tailscale.error && <p role="alert" className="freight-error">{state.tailscale.error}. Using local network instead.</p>}
        {state?.useTailscale && state.tailscale.available && <p className="freight-muted">Using Tailscale: {state.tailscale.hostname || state.tailscale.address}</p>}
        {qr && <img src={qr} alt="Scan to open PalletVision on your phone"/>}
        {!state?.useTailscale && <label>Desktop network address<select value={address || state?.addresses[0] || ''} onChange={e => setAddress(e.target.value)}>{state?.addresses.map(a => <option key={a}>{a}</option>)}</select></label>}
        <input aria-label="Phone pairing link" readOnly value={url}/>
        <button disabled={!url} onClick={() => { void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(e => setError(String(e))); }}>{copied ? 'Link copied' : 'Copy link'}</button>
        <p className="freight-muted">{state?.useTailscale ? 'Install Tailscale on both PC and phone, sign in to the same tailnet, and scan the QR code or copy the link.' : 'Connect your phone to a private network (RFC1918) that can reach this desktop. Scan the QR code or copy the link. The PalletVision Data Collector does not measure dimensions automatically - workers must enter actual measured values.'}</p>
      </section>
    </div>
  </>;
}
