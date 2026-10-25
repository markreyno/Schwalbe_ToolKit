import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const artifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'desktop-collapsible');

test.use({ channel: 'msedge' });

async function launchApp() {
  const testProfile = path.resolve('.cache/electron-collapsible', randomUUID());
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: testProfile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }),
    env,
  });
  const page = await app.firstWindow();
  return { app, page };
}

test.describe('Desktop collapsible sections', () => {
  test.beforeAll(async () => {
    await mkdir(artifactDir, { recursive: true });
  });

  test('Connect PWA sections collapse, persist, and keep QR visible', async () => {
    const { app, page } = await launchApp();
    await page.evaluate(() => {
      localStorage.removeItem('schwalbe-collapse-connect-phone-hub');
      localStorage.removeItem('schwalbe-collapse-connect-reachability');
      localStorage.removeItem('schwalbe-collapse-connect-devices');
    });
    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Connect PWA', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    await expect(page.getByRole('heading', { name: 'Connect PWA', level: 1 })).toBeVisible();

    const phoneHub = page.getByRole('button', { name: 'Phone hub server', exact: true });
    const reachability = page.getByRole('button', { name: 'Reachability', exact: true });
    const devices = page.getByRole('button', { name: 'Connected devices', exact: true });

    await expect(phoneHub).toHaveAttribute('aria-expanded', 'true');
    await expect(reachability).toHaveAttribute('aria-expanded', 'false');
    await expect(devices).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('heading', { name: 'Scan to open phone hub', exact: true })).toBeVisible();

    await page.screenshot({ path: path.join(artifactDir, 'connect-pwa-collapsed-sections.png'), fullPage: true });

    await reachability.click();
    await expect(reachability).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Freight Pictures (48731):', { exact: false })).toBeVisible();
    await devices.click();
    await expect(devices).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('No phones have opened the hub yet.', { exact: true })).toBeVisible();

    await page.screenshot({ path: path.join(artifactDir, 'connect-pwa-expanded-sections.png'), fullPage: true });

    await phoneHub.click();
    await expect(phoneHub).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await expect(phoneHub).toHaveAttribute('aria-expanded', 'false');
    await expect(reachability).toHaveAttribute('aria-expanded', 'true');

    await app.close();
  });

  test('PalletVision collected pallets section collapses and persists', async () => {
    const { app, page } = await launchApp();
    await page.evaluate(() => localStorage.removeItem('schwalbe-collapse-palletvision-collected'));
    await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'PalletVision Data Collector', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
    const trigger = page.getByRole('button', { name: 'Collected pallets', exact: true });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('No pallets collected yet.')).toBeHidden();

    await page.screenshot({ path: path.join(artifactDir, 'palletvision-collected-collapsed.png'), fullPage: true });

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('No pallets collected yet.')).toBeVisible();

    await page.screenshot({ path: path.join(artifactDir, 'palletvision-collected-expanded.png'), fullPage: true });

    await page.reload();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await app.close();
  });
});
