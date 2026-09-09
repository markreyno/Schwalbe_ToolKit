import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Printer } from 'lucide-react';
import type { SystemPrinter, PalletPreview } from '../../../shared/protocol';


export function PalletPage() {
  const [preview, setPreview] = useState<PalletPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [company, setCompany] = useState('');
  const [total, setTotal] = useState('');
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const count = Number(total);
  const validCount = Number.isInteger(count) && count >= 1 && count <= 1000;
  useEffect(() => {
    let active = true;
    setPreview(null); setPreviewError('');
    if (!company.trim() || !total) return;
    const timer = setTimeout(() => {
      void window.toolkit.previewPalletLabels({ company, total: count, printerName: '' }).then(result => {
        if (active) setPreview(result);
      }).catch(error => { if (active) setPreviewError(String(error)); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [company, total, count]);
  async function refresh() {
    setLoading(true); setError(''); setMessage('');
    try {
      const found = await window.toolkit.listPrinters();
      setPrinters(found);
      setPrinterName(previous => found.some(p => p.name === previous) ? previous : '');
    } catch { setPrinters([]); setPrinterName(''); setError('Could not load printers. Check your OS printer settings and refresh.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function print(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    const job = { company: company.trim(), total: count, printerName };
    try {
      setBusy(true);
      const result = await window.toolkit.printPalletLabels(job);
      setMessage(`${result.labelCount} labels sent to ${printers.find(p => p.name === printerName)?.displayName || printerName}. Check the printer or OS queue for completion.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not submit labels. Check the OS print queue before retrying.'); }
    finally { setBusy(false); }
  }
  async function printAlignment() {
    setError(''); setMessage(''); setBusy(true);
    try {
      await window.toolkit.printAlignmentTest(printerName);
      setMessage('One alignment test label sent. Check that the border is complete, the opposite margins are equal, and the cross is centered. This does not automatically calibrate the printer.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not submit the alignment test. Check the OS print queue before retrying.'); }
    finally { setBusy(false); }
  }
  return <>
    <Link className="back-link" to="/"><ArrowLeft size={17}/> All tools</Link>
    <header className="counter-heading"><div className="tool-icon"><Printer size={29}/></div><div><p className="eyebrow">SHIPPING & WAREHOUSE</p><h1>Pallet Label Printer</h1></div></header>
    <p className="subtitle">One shipment. Two labels per pallet, paired in order.</p>
    <div className="pallet-grid">
      <form className="pallet-panel" onSubmit={print}>
        <h2>Shipment details</h2>
        <fieldset disabled={busy}>
          <label htmlFor="company">Company</label><input id="company" value={company} onChange={e => { setCompany(e.target.value); setMessage(''); }} required maxLength={80} placeholder="e.g. YMC"/>
          <label htmlFor="total">Total pallets</label><input id="total" type="number" min="1" max="1000" step="1" value={total} onChange={e => { setTotal(e.target.value); setMessage(''); }} required placeholder="e.g. 10"/>
          <label htmlFor="printer">Printer</label><select id="printer" value={printerName} onChange={e => { setPrinterName(e.target.value); setMessage(''); }} disabled={loading} required><option value="">{loading ? 'Loading printers…' : 'Select a printer'}</option>{printers.map(p => <option key={p.name} value={p.name}>{p.displayName || p.name}</option>)}</select>
          <button type="button" className="text-button" onClick={() => void refresh()} disabled={loading}>Refresh printers</button>
          {!loading && !printers.length && <p className="subtitle">No printers found. Install or connect a printer in your OS settings, then refresh.</p>}
          <p className="pallet-stock">Load 1.5 × 1-inch roll labels. Use a printer and driver that support this label size.</p>
          <button className="alignment-button" type="button" disabled={loading || !printerName} onClick={() => void printAlignment()}>Print alignment test</button>
          <p className="pallet-stock">Prints one test label with a border inset 0.08 inch and a center cross. Check for equal opposite margins and clipping before printing a batch.</p>
          <button className="increment-button" type="submit" disabled={loading || !printerName || !company.trim() || !validCount || !preview}>{busy ? 'Sending labels…' : `Print ${preview ? preview.labelCount : ''} labels`}<Printer size={19}/></button>
        </fieldset>
        {error && <div className="error-panel" role="alert">{error}</div>}
        {message && <p className="print-status" role="status">{message}</p>}
      </form>
      <section className="pallet-panel" aria-label="Label preview"><p className="eyebrow">PRINT ORDER PREVIEW</p><h2>{preview ? `${count} pallets · ${preview.labelCount} labels` : 'Your label pairs'}</h2>
        <p className="subtitle">1.5 × 1 inch per label · two adjacent copies</p>
        <p className="subtitle">{previewError || (!preview ? "Enter shipment details to preview labels." : "")}</p><div className="label-preview">{(preview?.labels || []).map((label, index) => <div className="preview-label" key={index}><strong>{company.trim() || 'Company'}</strong><span>{label}</span></div>)}</div>
        {preview && preview.labelCount > 6 && <p className="subtitle">Continues in pairs through {preview.lastLabel}, {preview.lastLabel}.</p>}
        <p className="pallet-stock">Preview shows the content and order. Long company names are fitted to the printed label.</p>
      </section>
    </div>
  </>;
}
