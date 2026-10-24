import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('library renders guides and search filters the sidebar', async () => {
  const testProfile = path.resolve('.cache/electron-test', randomUUID());
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), TOOLKIT_TEST_DATA: testProfile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }), env });
  const page = await app.firstWindow();
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Library', exact: true }) }).getByRole('link', { name: 'Open tool' }).click();
  await expect(page.locator('header').getByRole('heading', { name: 'Library', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('Searchable guides for every tool', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search library guides' }).fill('48731');
  await expect(page.getByRole('button', { name: /Freight Pictures/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect PWA/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Freight Pictures/ }).click();
  await expect(page.getByText('48731', { exact: false }).first()).toBeVisible();
  await app.close();
});
