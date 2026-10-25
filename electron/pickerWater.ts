import { app, ipcMain, BrowserWindow } from 'electron';
import path from 'node:path';
import { PickerWaterBridge } from './pickerWaterBridge';
import type { Picker } from '../shared/pickerWater';

let bridge: PickerWaterBridge | null = null;

export async function registerPickerWater(window: () => BrowserWindow | null) {
  bridge = new PickerWaterBridge(path.join(app.getPath('userData'), 'picker-water-hub.json'));
  await bridge.load();

  ipcMain.handle('toolkit:picker-water', async (event, action: string, data?: { pickers?: Picker[] }) => {
    const win = window();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted request.');
    if (!bridge) throw new Error('Picker water bridge unavailable.');
    if (action === 'sync') {
      await bridge.sync(data?.pickers ?? []);
      return { ok: true };
    }
    throw new Error('Unsupported action.');
  });
}

export function getPickerWaterBridge() {
  return bridge;
}
