import { contextBridge, ipcRenderer } from 'electron';
import type { ToolkitAPI } from '../shared/protocol';
const api: ToolkitAPI = {
  updates: action => ipcRenderer.invoke('toolkit:updates', action),
  onUpdateState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('toolkit:update-state', listener);
    return () => ipcRenderer.removeListener('toolkit:update-state', listener);
  },
  previewPalletLabels: job => ipcRenderer.invoke('toolkit:preview-pallets', job),
  printAlignmentTest: printerName => ipcRenderer.invoke('toolkit:print-alignment', { printerName }),
  listPrinters: () => ipcRenderer.invoke('toolkit:printers'),
  printPalletLabels: job => ipcRenderer.invoke('toolkit:print-pallets', job),
  openCounter: () => ipcRenderer.invoke('toolkit:request', 'counter.open'),
  incrementCounter: sessionId => ipcRenderer.invoke('toolkit:request', 'counter.increment', sessionId),
  closeCounter: sessionId => ipcRenderer.invoke('toolkit:request', 'counter.close', sessionId),
  onBackendFailure: callback => {
    const listener = () => callback();
    ipcRenderer.on('toolkit:backend-failed', listener);
    return () => ipcRenderer.removeListener('toolkit:backend-failed', listener);
  }
};
contextBridge.exposeInMainWorld('toolkit', api);
