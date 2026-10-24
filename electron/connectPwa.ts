import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { ConnectPwaServer } from './connectPwaServer';
export async function registerConnectPwa(window: () => BrowserWindow | null) {
  const service = new ConnectPwaServer(path.join(app.getPath('userData'), 'connect-pwa.json'));
  await service.start();

  ipcMain.handle('toolkit:connect-pwa', async (event, action: string, data: any) => {
    const win = window();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted request.');
    if (action === 'setTailscale') await service.setTailscaleMode(data?.enabled);
    else if (action === 'setManualAddress') await service.setManualAddress(data?.address);
    else if (action !== 'status') throw new Error('Unsupported action.');
    return service.status();
  });

  app.on('before-quit', () => service.stop());
  app.on('window-all-closed', () => service.stop());
}
