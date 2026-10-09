import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { FreightServer } from './freightServer';
export async function registerFreight(window: () => BrowserWindow | null) {
  const service = new FreightServer(path.join(app.getPath('userData'), 'freight-pictures.json'));
  await service.start();
  ipcMain.handle('toolkit:freight', async (event, action: string, data: any) => {
    const win = window();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted request.');
    if (action === 'choose') { const result = await dialog.showOpenDialog(win, { title: 'Choose Freight Pictures storage folder', properties: ['openDirectory', 'createDirectory'] }); if (!result.canceled) await service.setRoot(result.filePaths[0]); }
    else if (action === 'create') await service.create(data?.company, data?.date);
    else if (action === 'reupload') await service.reopen(data?.id);
    else if (action === 'open') { const error = await shell.openPath(service.folder(data?.id)); if (error) throw new Error(error); }
    else if (action === 'setTailscale') await service.setTailscaleMode(data?.enabled);
    else if (action !== 'status') throw new Error('Unsupported action.');
    return service.status();
  });
  app.on('before-quit', () => service.stop());
  app.on('window-all-closed', () => service.stop());
}
