import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('updates require download and restart consent and recover after a failed check', async () => {
  test.skip(!process.env.TOOLKIT_EXECUTABLE, 'Exercises the updater in a packaged app.');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  env.TOOLKIT_TEST_DATA = path.resolve('.cache/updater-test');
  const desktop = await electron.launch({ executablePath: process.env.TOOLKIT_EXECUTABLE, env });
  try {
    const page = await desktop.firstWindow();
    await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeVisible();
    await desktop.evaluate(async ({ app, dialog }) => {
      const { createRequire } = process.getBuiltinModule('module');
      const require = createRequire(app.getAppPath() + '/package.json');
      const updater = require('electron-updater').autoUpdater;
      (globalThis as any).updateTest = { downloads: 0, installs: 0, checks: 0 };
      const counts = (globalThis as any).updateTest;
      updater.checkForUpdates = async () => {
        counts.checks++;
        updater.emit('checking-for-update');
        if (counts.checks === 1) throw new Error('Simulated offline connection');
        updater.emit('update-available', { version: '99.0.0' });
        return null;
      };
      updater.downloadUpdate = async () => {
        counts.downloads++;
        updater.emit('download-progress', { percent: 50 });
        updater.emit('update-downloaded', { version: '99.0.0' });
        return [];
      };
      updater.quitAndInstall = () => { counts.installs++; };
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry update check' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry update check' }).click();
    await expect(page.getByRole('button', { name: 'Download v99.0.0' })).toBeVisible();
    expect(await desktop.evaluate(() => (globalThis as any).updateTest.downloads)).toBe(0);
    await page.getByRole('button', { name: 'Download v99.0.0' }).click();
    await expect(page.getByRole('button', { name: 'Restart to update' })).toBeVisible();
    await page.getByRole('button', { name: 'Restart to update' }).click();
    expect(await desktop.evaluate(() => (globalThis as any).updateTest.installs)).toBe(0);
    await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await page.getByRole('button', { name: 'Restart to update' }).click();
    await expect.poll(() => desktop.evaluate(() => (globalThis as any).updateTest.installs)).toBe(1);
    expect(await desktop.evaluate(() => (globalThis as any).updateTest.downloads)).toBe(1);
  } finally { await desktop.close(); }
});
