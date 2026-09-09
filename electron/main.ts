import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { PythonBridge } from './pythonBridge';
import { registerPalletPrinter } from './palletPrinter';
import { registerUpdates } from './updates';
import type { Operation } from '../shared/protocol';

let mainWindow: BrowserWindow | null = null;
let bridge: PythonBridge;
// Keep test artifacts and Electron's writable profile inside an explicit test directory.
if (process.env.TOOLKIT_TEST_DATA) app.setPath('userData', process.env.TOOLKIT_TEST_DATA);
const developmentURL = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 620,
    title: 'Schwalbe ToolKit', backgroundColor: '#f5f6f8',
    icon: path.join(__dirname, '../assets/schwalbe.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', () => bridge.stop());
  mainWindow.webContents.on('did-start-loading', () => bridge.stop());
  mainWindow.on('closed', () => { mainWindow = null; bridge.stop(); });
  if (developmentURL) void mainWindow.loadURL(developmentURL);
  else void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.schwalbe.toolkit');
  const command = app.isPackaged ? path.join(process.resourcesPath, 'python', 'toolkit-backend.exe') : (process.env.PYTHON_PATH || 'python');
  bridge = new PythonBridge(command, app.isPackaged ? [] : ['-u', path.join(__dirname, '../python/main.py')], () => {
    mainWindow?.webContents.send('toolkit:backend-failed');
  });
  ipcMain.handle('toolkit:request', (event, operation: Operation, sessionId?: string) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Untrusted tool request.');
    if (!['counter.open', 'counter.increment', 'counter.close'].includes(operation)) throw new Error('Unsupported operation.');
    if (operation !== 'counter.open' && (typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(sessionId))) throw new Error('Invalid session.');
    return bridge.request(operation, sessionId);
  });
  registerPalletPrinter(() => mainWindow, bridge);
  registerUpdates(() => mainWindow);
  createWindow();
  app.on('activate', () => { if (!mainWindow) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => bridge?.stop());
