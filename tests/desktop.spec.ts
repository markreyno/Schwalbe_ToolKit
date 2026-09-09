import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';

let app: ElectronApplication;
test.beforeEach(async () => {
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), TOOLKIT_TEST_DATA: path.resolve('.cache/electron-test') };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.TOOLKIT_EXECUTABLE) env.PYTHON_PATH = 'Z:\\python-is-not-installed\\python.exe';
  app = await electron.launch({ ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }), env });
});
test.afterEach(async () => { await app?.close(); });

test('desktop counter counts rapid presses, resets on reopen and reload, and supports keyboard', async () => {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'A place for every tool.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/tool-hub.png' });
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Counter', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
  const count = page.getByLabel('Current count', { exact: true });
  await expect(count).toHaveText('0');
  const button = page.getByRole('button', { name: 'Add one' });
  await button.evaluate((element: HTMLButtonElement) => { for (let i = 0; i < 10; i++) element.click(); });
  await expect(count).toHaveText('10');
  await button.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(count).toHaveText('12');
  await page.screenshot({ path: 'test-results/counter.png' });
  await page.getByRole('link', { name: 'All tools', exact: true }).click();
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Counter', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
  await expect(count).toHaveText('0');
  await page.reload();
  await expect(count).toHaveText('0');
  await button.click();
  await expect(count).toHaveText('1');
  await button.evaluate((element: HTMLButtonElement) => { for (let i = 0; i < 100; i++) element.click(); });
  await page.getByRole('link', { name: 'All tools', exact: true }).click();
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Counter', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
  await expect(count).toHaveText('0');
  // Renderer has no direct Node access.
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
});

test('backend failure can recover with a new session', async () => {
  const page = await app.firstWindow();
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Counter', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
  await expect(page.getByLabel('Current count', { exact: true })).toHaveText('0');
  // Kill the actual backend through the main process's active child handle.
  await app.evaluate(() => {
    const handles = (process as any)._getActiveHandles();
    const backend = handles.find((handle: any) => handle.constructor.name === 'ChildProcess' && handle.spawnargs?.some((arg: string) => /python|toolkit-backend/i.test(arg)));
    if (!backend) throw new Error('Backend child was not found');
    backend.kill();
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add one' })).toBeDisabled();
  await page.getByRole('button', { name: 'Start fresh at 0' }).click();
  await expect(page.getByRole('button', { name: 'Add one' })).toBeEnabled();
  await expect(page.getByLabel('Current count', { exact: true })).toHaveText('0');
  await page.getByRole('button', { name: 'Add one' }).click();
  await expect(page.getByLabel('Current count', { exact: true })).toHaveText('1');
});

test('hub search and available tools are clear', async () => {
  const page = await app.firstWindow();
  await expect(page.getByRole('textbox', { name: 'Search tools' })).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Search tools' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Search tools' }).fill('no matching tool');
  await expect(page.getByRole('heading', { name: 'No tools found' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByRole('heading', { name: 'Pallet Label Printer' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open tool' })).toHaveCount(3);
});


test('pallet labels select OS printers and submit adjacent pairs at label size', async () => {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0];
    (owner.webContents as any).getPrintersAsync = async () => [
      { name: 'label-a', displayName: 'Label Printer A', isDefault: true },
      { name: 'label-b', displayName: 'Label Printer B', isDefault: false }
    ];
    (globalThis as any).printJobs = [];

    // Intercept only the native spool call, preserving real document generation and layout.
    const contentsPrototype = Object.getPrototypeOf(owner.webContents);
    contentsPrototype.print = function(options: any, callback: any) {
      const contents = this;
      void contents.executeJavaScript(`Array.from(document.querySelectorAll('.label')).map(label => ({ text: label.innerText, width: label.offsetWidth, height: label.offsetHeight }))`).then((labels: any) => {
        (globalThis as any).printJobs.push({ options, labels });
        callback(true, '');
      });
    };
  });
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Pallet Label Printer' }) }).getByRole('link').click();
  await page.getByLabel('Company', { exact: true }).fill('YMC');
  await page.getByLabel('Total pallets').fill('10');
  await page.getByLabel('Printer', { exact: true }).selectOption('label-b');
  await page.screenshot({ path: 'test-results/pallet-labels.png' });
  await page.getByRole('button', { name: 'Print 20 labels', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('20 labels sent to Label Printer B');
  const jobs = await app.evaluate(() => (globalThis as any).printJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0].options.deviceName).toBe('label-b');
  expect(jobs[0].options.pageSize).toEqual({ width: 38100, height: 25400 });
  expect(jobs[0].options.copies).toBe(1);
  expect(jobs[0].labels.map((label: any) => label.text.replace(/\s+/g, ' '))).toEqual(Array.from({ length: 20 }, (_, i) => `YMC ${Math.floor(i / 2) + 1}/10`));
  expect(jobs[0].labels.every((label: any) => label.width === 144 && label.height === 96)).toBe(true);
  await page.getByLabel('Total pallets').fill('0');
  await expect(page.getByRole('button', { name: 'Print labels', exact: true })).toBeDisabled();
  await app.evaluate(({ BrowserWindow }) => { (BrowserWindow.getAllWindows()[0].webContents as any).getPrintersAsync = async () => []; });
  await page.getByRole('button', { name: 'Refresh printers' }).click();
  await expect(page.getByText('No printers found.', { exact: false })).toBeVisible();
});

test('pallet printing rejects invalid requests and reports driver failure', async () => {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    (contents as any).getPrintersAsync = async () => [{ name: 'test-label', displayName: 'Test Label' }];
    Object.getPrototypeOf(contents).print = (_options: any, callback: any) => callback(false, 'Printer unavailable');
  });
  const invalid = await page.evaluate(async () => {
    try { await window.toolkit.printPalletLabels({ company: 'YMC', total: 0, printerName: 'test-label' }); return ''; }
    catch (error) { return String(error); }
  });
  expect(invalid).toContain('whole number');
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Pallet Label Printer' }) }).getByRole('link').click();
  await page.getByLabel('Company', { exact: true }).fill('YMC');
  await page.getByLabel('Total pallets').fill('1');
  await page.getByLabel('Printer', { exact: true }).selectOption('test-label');
  await page.getByRole('button', { name: 'Print 2 labels', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Printer unavailable');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Print 2 labels', exact: true })).toBeEnabled();
});



test('raffle saves names across reload and restart, draws only current entries, and guards empty lists', async () => {
  let page = await app.firstWindow();
  await page.evaluate(() => localStorage.removeItem('schwalbe-toolkit.uline-raffle.names.v1'));
  const openRaffle = async () => {
    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Uline Raffle', exact: true }) }).getByRole('link').click();
  };
  await openRaffle();
  await expect(page.getByRole('button', { name: 'Raffle', exact: true })).toBeDisabled();
  await page.getByLabel('Name', { exact: true }).fill('   ');
  await expect(page.getByRole('button', { name: 'Add name', exact: true })).toBeDisabled();
  for (const name of [' Alice ', 'Bob']) {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Name', { exact: true }).press('Enter');
  }
  await page.getByRole('link', { name: 'All tools', exact: true }).click();
  await openRaffle();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await app.close();
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), TOOLKIT_TEST_DATA: path.resolve('.cache/electron-test') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  await openRaffle();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Raffle', exact: true }).click();
    await expect(page.locator('.raffle-winner')).toHaveText(/^(Alice|Bob)$/);
  }
  await page.getByRole('button', { name: 'Remove Alice', exact: true }).click();
  await expect(page.locator('.raffle-winner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Raffle', exact: true }).click();
  await expect(page.locator('.raffle-winner')).toHaveText('Bob');
  await page.screenshot({ path: 'test-results/uline-raffle.png' });
  await page.getByRole('button', { name: 'Remove Bob', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Raffle', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(0);
});



test('alignment prints one diagnostic label without shipment inputs', async () => {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    (contents as any).getPrintersAsync = async () => [{ name: 'zebra-test', displayName: 'Zebra ZM400' }];
    (globalThis as any).alignmentJobs = [];
    Object.getPrototypeOf(contents).print = function(options: any, callback: any) {
      void this.executeJavaScript(`({ pages: document.querySelectorAll('.label').length, frame: !!document.querySelector('.frame'), cross: !!document.querySelector('.horizontal') && !!document.querySelector('.vertical') })`).then((document: any) => {
        (globalThis as any).alignmentJobs.push({ options, document }); callback(true, '');
      });
    };
  });
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Pallet Label Printer' }) }).getByRole('link').click();
  const button = page.getByRole('button', { name: 'Print alignment test', exact: true });
  await expect(button).toBeDisabled();
  await page.getByLabel('Printer', { exact: true }).selectOption('zebra-test');
  await button.click();
  await expect(page.getByRole('status')).toContainText('One alignment test label sent');
  const jobs = await app.evaluate(() => (globalThis as any).alignmentJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0].document).toEqual({ pages: 1, frame: true, cross: true });
  expect(jobs[0].options.deviceName).toBe('zebra-test');
  expect(jobs[0].options.copies).toBe(1);
  expect(jobs[0].options.pageSize).toEqual({ width: 38100, height: 25400 });
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Total pallets')).toHaveValue('');
});
