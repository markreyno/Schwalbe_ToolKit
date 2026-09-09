import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { PythonBridge } from './pythonBridge';
import type { PalletPrintJob } from '../shared/protocol';

export function registerPalletPrinter(getWindow: () => BrowserWindow | null, bridge: PythonBridge) {
  let busy = false;
  function trustedWindow(event: IpcMainInvokeEvent) {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted printer request.');
    return window;
  }
  ipcMain.handle('toolkit:preview-pallets', (event, job: PalletPrintJob) => { trustedWindow(event); return bridge.request('pallet.preview', undefined, job); });
  ipcMain.handle('toolkit:printers', async event => (await trustedWindow(event).webContents.getPrintersAsync()).map(({ name, displayName }) => ({ name, displayName })));
  async function submit(event: IpcMainInvokeEvent, job: PalletPrintJob | { printerName: string }, alignment = false) {
    const owner = trustedWindow(event);

    if (busy) throw new Error('A label job is already being submitted.');
    busy = true;
    let printWindow: BrowserWindow | undefined;
    try {
      const prepared = await bridge.request(alignment ? 'pallet.alignment' : 'pallet.prepare', undefined, job);
      const printers = await owner.webContents.getPrintersAsync();
      if (!printers.some(printer => printer.name === job.printerName)) throw new Error('The selected printer is unavailable. Refresh printers and select another.');
      printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(prepared.html)}`);
      // Fit long names in the real print document; reject names that would become unreadable.
      const fits = await printWindow.webContents.executeJavaScript(`(() => {
        for (const label of document.querySelectorAll('.label')) {
          const company = label.querySelector('.company');
          if (!company) continue;
          let size = 14;
          while ((company.offsetHeight > 42 || company.scrollWidth > company.clientWidth) && size > 7) { size -= .5; company.style.fontSize = size + 'pt'; }
          if (company.offsetHeight > 42 || company.scrollWidth > company.clientWidth) return false;
        }
        return true;
      })()`);
      if (!fits) throw new Error('Company name is too long to fit clearly. Please shorten it.');
      await new Promise<void>((resolve, reject) => printWindow!.webContents.print({
        silent: true, deviceName: job.printerName, pageSize: prepared.pageSize,
        margins: { marginType: 'none' }, printBackground: true, copies: 1, pagesPerSheet: 1,
        duplexMode: 'simplex', scaleFactor: 100, header: '', footer: ''
      }, (success, reason) => success ? resolve() : reject(new Error(`Printer did not accept the job: ${reason || 'unknown error'}. Check the OS print queue before retrying.`))));
      return { labelCount: prepared.labelCount };
    } finally {
      printWindow?.destroy();
      busy = false;
    }
  }
  ipcMain.handle('toolkit:print-pallets', (event, job: PalletPrintJob) => submit(event, job));
  ipcMain.handle('toolkit:print-alignment', (event, job: { printerName: string }) => submit(event, job, true));
}
