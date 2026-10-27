import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { ConnectPwaServer } from './connectPwaServer';
import type { ConnectPwaToolLink } from './toolPhoneUrls';
import type { PhoneTlsManager } from './tls/phoneTlsManager';
import type { PickerWaterBridge } from './pickerWaterBridge';

export async function registerConnectPwa(
  window: () => BrowserWindow | null,
  tlsManager: PhoneTlsManager,
  deps?: { toolsForHost: (host: string) => Promise<ConnectPwaToolLink[]> },
  pickerWater?: PickerWaterBridge | null
) {
  const service = new ConnectPwaServer(path.join(app.getPath('userData'), 'connect-pwa.json'), tlsManager, deps?.toolsForHost, pickerWater ?? null);
  await service.start();
  tlsManager.onReload(() => service.restartPhoneListener());

  ipcMain.handle('toolkit:connect-pwa', async (event, action: string, data: any) => {
    const win = window();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted request.');
    if (action === 'setTailscale') await service.setTailscaleMode(data?.enabled);
    else if (action === 'setManualAddress') await service.setManualAddress(data?.address);
    else if (action === 'setPhoneUseHttps') await tlsManager.setPhoneUseHttps(!!data?.enabled || !!data?.usePhoneHttps);
    else if (action === 'setAllowInsecureHttp') await tlsManager.setAllowInsecureHttp(!!data?.enabled);
    else if (action !== 'status') throw new Error('Unsupported action.');
    return service.status();
  });

  app.on('before-quit', () => service.stop());
  app.on('window-all-closed', () => service.stop());
}
