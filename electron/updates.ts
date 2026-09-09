import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/protocol';

export function registerUpdates(getWindow: () => BrowserWindow | null) {
  let state: UpdateState = { status: app.isPackaged ? 'idle' : 'disabled', currentVersion: app.getVersion() };
  let busy = false;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  const publish = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    getWindow()?.webContents.send('toolkit:update-state', state);
  };
  const failed = (error: Error) => {
    console.error('[Updater]', error.message);
    publish({ status: 'error', message: 'Could not reach or download the update. Check your connection and try again.' });
  };
  autoUpdater.on('error', failed);
  autoUpdater.on('checking-for-update', () => publish({ status: 'checking', message: undefined }));
  autoUpdater.on('update-available', info => publish({ status: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => publish({ status: 'current', version: undefined }));
  autoUpdater.on('download-progress', info => publish({ status: 'downloading', percent: Math.round(info.percent) }));
  autoUpdater.on('update-downloaded', info => publish({ status: 'ready', version: info.version }));

  async function check() {
    if (!app.isPackaged || busy || ['downloading', 'ready', 'available'].includes(state.status)) return;
    busy = true;
    try { await autoUpdater.checkForUpdates(); } catch (error) { failed(error as Error); }
    finally { busy = false; }
  }
  ipcMain.handle('toolkit:updates', async (event, action: unknown) => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted update request.');
    if (!['status', 'check', 'download', 'install'].includes(action as string)) throw new Error('Invalid update action.');
    if (action === 'status' || !app.isPackaged) return state;
    if (action === 'check') await check();
    if (action === 'download' && state.status === 'available' && !busy) {
      busy = true;
      publish({ status: 'downloading', percent: 0 });
      try { await autoUpdater.downloadUpdate(); } catch (error) { failed(error as Error); }
      finally { busy = false; }
    }
    if (action === 'install' && state.status === 'ready' && !busy) {
      busy = true;
      const { response } = await dialog.showMessageBox(window, {
        type: 'question', title: 'Install update',
        message: `Restart to install Schwalbe ToolKit ${state.version}?`,
        detail: 'Finish any printing first. Your current counter and other unsaved tool state will be cleared.',
        buttons: ['Restart and install', 'Later'], defaultId: 1, cancelId: 1
      });
      if (response === 0) { setImmediate(() => autoUpdater.quitAndInstall(false, true)); }
      else busy = false;
    }
    return state;
  });
  if (app.isPackaged && !process.env.TOOLKIT_TEST_DATA) {
    const startup = setTimeout(() => void check(), 15000);
    const interval = setInterval(() => void check(), 4 * 60 * 60 * 1000);
    startup.unref(); interval.unref();
    app.once('before-quit', () => { clearTimeout(startup); clearInterval(interval); });
  }
}
