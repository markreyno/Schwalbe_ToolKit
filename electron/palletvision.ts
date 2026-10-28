import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { PalletVisionServer } from './palletvisionServer';
import { registerMainProcessErrorHandlers } from './mainProcessLog';
import type { PhoneTlsManager } from './tls/phoneTlsManager';

export async function registerPalletVision(window: () => BrowserWindow | null, tlsManager: PhoneTlsManager) {
  const service = new PalletVisionServer(path.join(app.getPath('userData'), 'palletvision.json'), tlsManager);
  registerMainProcessErrorHandlers((summary) => service.noteProcessError(summary));
  await service.start();
  tlsManager.onReload(() => service.restartPhoneListener());

  ipcMain.handle('toolkit:palletvision', async (event, action: string, data: any) => {
    const win = window();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted request.');
    
    if (action === 'choose') {
      const result = await dialog.showOpenDialog(win, { title: 'Choose PalletVision data folder', properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled) await service.setRoot(result.filePaths[0]);
    }
    else if (action === 'selectVideo') {
      const result = await dialog.showOpenDialog(win, { 
        title: 'Select video file', 
        filters: [{ name: 'Video Files', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }],
        properties: ['openFile'] 
      });
      const videoPath = result.canceled ? null : result.filePaths[0];
      return { ...service.status(), videoPath };
    }
    else if (action === 'import') {
      await service.importVideo(data?.videoPath, {
        heightInches: data?.heightInches,
        widthInches: data?.widthInches,
        lengthInches: data?.lengthInches,
        notes: data?.notes,
        referenceId: data?.referenceId
      });
    }
    else if (action === 'open') {
      const error = await shell.openPath(service.folder(data?.id));
      if (error) throw new Error(error);
    }
    else if (action === 'setTailscale') await service.setTailscaleMode(data?.enabled);
    else if (action === 'setAllowInsecureHttp') await tlsManager.setAllowInsecureHttp(!!data?.enabled);
    else if (action === 'retryPhoneCertificate') await tlsManager.retryCertificate();
    else if (action === 'update') await service.updateMetadata(data?.id, data?.updates);
    else if (action !== 'status') throw new Error('Unsupported action.');
    
    return service.status();
  });

  app.on('before-quit', () => service.stop());
  app.on('window-all-closed', () => service.stop());
  return service;
}
